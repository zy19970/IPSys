using System.Data;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Data.Sqlite;
using IPSys.Web;

SQLitePCL.Batteries_V2.Init();
var smoke = args.Contains("--smoke");
// HTML/CSS/JS are read from managed assembly resources (works in Debug or single-file Release).
byte[] html = EmbeddedWebAssets.Read("index.html");
byte[] css = EmbeddedWebAssets.Read("style.css");
byte[] javascript = EmbeddedWebAssets.Read("app.js");
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = Array.Empty<string>(),
    ContentRootPath = AppContext.BaseDirectory
});
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 66L * 1024 * 1024);
builder.Services.AddSingleton<Vault>();
var app = builder.Build();
app.Urls.Add("http://127.0.0.1:0");

app.Use(async (ctx, next) =>
{
    // Host/origin pinning protects loopback-only prototype from DNS rebinding/CSRF.
    if (ctx.Request.Host.Host != "127.0.0.1")
    {
        ctx.Response.StatusCode = 403;
        return;
    }
    string? origin = ctx.Request.Headers.Origin;
    if (!string.IsNullOrEmpty(origin) &&
        origin != $"http://127.0.0.1:{ctx.Request.Host.Port}")
    {
        ctx.Response.StatusCode = 403;
        return;
    }
    ctx.Response.Headers["Cache-Control"] = "no-store";
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["Content-Security-Policy"] =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    await next();
});
// Serve web files from within the executable, not from wwwroot on disk.
app.MapGet("/", () => Results.Bytes(html, contentType: "text/html; charset=utf-8"));
app.MapGet("/index.html", () => Results.Bytes(html, contentType: "text/html; charset=utf-8"));
app.MapGet("/style.css", () => Results.Bytes(css, contentType: "text/css; charset=utf-8"));
app.MapGet("/app.js", () => Results.Bytes(javascript, contentType: "text/javascript; charset=utf-8"));

app.MapGet("/api/status", (Vault v) => Results.Json(new
{
    unlocked = v.Unlocked,
    suggestion = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) is var d && d.Length > 0
            ? d : AppContext.BaseDirectory, "IPSys-web-test.db"),
    prototype = true
}));

app.MapPost("/api/open", async (OpenInput input, Vault v) =>
{
    if (v.ExitRequested) return Fail("程序正在安全退出。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (v.ExitRequested) return Fail("程序正在安全退出。", 409);
        if (v.Unlocked) return Fail("请先关闭当前数据库。", 409);
        string path = input.Path?.Trim() ?? "";
        if (!Path.IsPathFullyQualified(path)) return Fail("请输入数据库的绝对路径。");
        path = Path.GetFullPath(path);
        if (string.IsNullOrWhiteSpace(input.Password)) return Fail("数据库密码不能为空。");
        if (!Directory.Exists(Path.GetDirectoryName(path))) return Fail("数据库所在文件夹不存在。");
        if (input.Create && File.Exists(path)) return Fail("文件已存在；不会覆盖原数据库。");
        if (!input.Create && !File.Exists(path)) return Fail("找不到数据库文件。");
        SqliteConnection? db = null;
        try
        {
            db = Vault.Connect(path, input.Password, input.Create);
            if (input.Create) Vault.CreateSchema(db);
            else Vault.ValidateSchema(db);
            string token = v.SetOpen(db, path);
            db = null;
            return Results.Json(new { token, name = Path.GetFileName(path) });
        }
        catch (Exception e)
        {
            db?.Dispose();
            return Fail("数据库打开失败：" + e.Message);
        }
    }
    finally { v.Gate.Release(); }
});

// A browser tab may close while the WinForms-owned database stays open.
// Re-authenticate against the existing encrypted file; do not close or replace it.
app.MapPost("/api/resume", async (ResumeInput input, Vault v) =>
{
    if (string.IsNullOrWhiteSpace(input.Password)) return Fail("请输入数据库密码。");
    await v.Gate.WaitAsync();
    try
    {
        if (v.ExitRequested) return Fail("程序正在安全退出。", 409);
        if (!v.Unlocked) return Fail("当前没有已打开的数据库，请正常打开数据库。", 409);
        if (!v.PasswordMatches(input.Password))
            return Fail("数据库密码错误，无法恢复会话。", 403);
        return Results.Json(new
        {
            token = v.SessionToken,
            name = Path.GetFileName(v.Path),
            resumed = true
        });
    }
    catch (Exception)
    {
        // The current SQLCipher connection is not modified on authentication failure.
        return Fail("验证失败，数据库仍保持打开。", 403);
    }
    finally { v.Gate.Release(); }
});

app.MapPost("/api/lock", async (HttpContext ctx, Vault v) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务执行中或程序正在退出，不能关闭数据库。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务执行中或程序正在退出，不能关闭数据库。", 409);
        v.Close();
        return Results.Ok(new { ok = true });
    }
    finally { v.Gate.Release(); }
});

app.MapGet("/api/records/{workspace}", async (HttpContext ctx, Vault v, string workspace) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    await v.Gate.WaitAsync();
    try
    {
        // The token may have expired while this request waited for the database gate.
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        var rows = new List<RecordView>();
        using var cmd = v.Db.CreateCommand();
        cmd.CommandText = """
            SELECT r.id,r.title,a.id,a.filename,a.size,a.sha256
            FROM records r LEFT JOIN attachments a
            ON r.id=a.record_id AND a.state='ready'
            WHERE r.workspace=$w ORDER BY r.id DESC,a.id;
            """;
        cmd.Parameters.AddWithValue("$w", workspace);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            long id = reader.GetInt64(0);
            if (rows.Count == 0 || rows[^1].Id != id)
                rows.Add(new RecordView(id, reader.GetString(1), new()));
            if (!reader.IsDBNull(2))
                rows[^1].Files.Add(new FileView(reader.GetInt64(2), reader.GetString(3),
                    reader.GetInt64(4), reader.GetString(5)));
        }
        return Results.Json(rows);
    }
    catch (Exception e) { return Fail(e.Message, 500); }
    finally { v.Gate.Release(); }
});

app.MapPost("/api/records/{workspace}", async (HttpContext ctx, Vault v, string workspace, TitleInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    if (string.IsNullOrWhiteSpace(input.Title)) return Fail("名称不能为空。");
    if (input.Title.Length > 300) return Fail("名称不能超过 300 字。");
    if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务执行中，暂不能修改资料。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务执行中，暂不能修改资料。", 409);
        using var cmd = v.Db.CreateCommand();
        cmd.CommandText = "INSERT INTO records(workspace,title) VALUES($w,$n); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$w", workspace);
        cmd.Parameters.AddWithValue("$n", input.Title.Trim());
        long id = (long)cmd.ExecuteScalar()!;
        return Results.Json(new { id });
    }
    catch (Exception e) { return Fail(e.Message, 500); }
    finally { v.Gate.Release(); }
});

app.MapPost("/api/records/{workspace}/{id:long}/files", async (HttpContext ctx, Vault v, string workspace, long id) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    long? length = ctx.Request.ContentLength;
    const long limit = 64L * 1024 * 1024; // Intentionally small for first web prototype.
    if (length is null or < 0 or > limit) return Fail("测试版仅支持已知大小、最多 64 MiB 的单文件。", 413);
    string name = Uri.UnescapeDataString(ctx.Request.Headers["X-File-Name"].ToString());
    if (string.IsNullOrWhiteSpace(name) || name != Path.GetFileName(name) ||
        name is "." or ".." || name.Contains('\\') || name.Contains('/') || name.Length > 240)
        return Fail("文件名无效。");
    if (!v.TryBeginFileTask(ctx, out var taskCancellation))
        return Fail("当前有文件任务正在执行，或程序正在安全退出。", 409);
    try
    {
        using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted, taskCancellation);
        if (!await v.Gate.WaitAsync(0))
            return Fail("另一项数据库操作正在执行，请稍后重试。", 409);
        try
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
        using (var exists = v.Db.CreateCommand())
        {
            exists.CommandText = "SELECT count(*) FROM records WHERE id=$id AND workspace=$w;";
            exists.Parameters.AddWithValue("$id", id);
            exists.Parameters.AddWithValue("$w", workspace);
            if ((long)exists.ExecuteScalar()! != 1L) return Results.NotFound();
        }
        long reserve = Math.Max(128L * 1024 * 1024, length.Value / 3);
        long free = new DriveInfo(Path.GetPathRoot(v.Path)!).AvailableFreeSpace;
        if (free < length + reserve) return Fail("数据库所在磁盘剩余空间不足。", 507);
        long fileId;
        using (var insert = v.Db.CreateCommand())
        {
            insert.CommandText = """
                INSERT INTO attachments(record_id,filename,expected_size,state)
                VALUES($r,$n,$size,'writing'); SELECT last_insert_rowid();
                """;
            insert.Parameters.AddWithValue("$r", id);
            insert.Parameters.AddWithValue("$n", name);
            insert.Parameters.AddWithValue("$size", length.Value);
            fileId = (long)insert.ExecuteScalar()!;
        }
        try
        {
            byte[] buffer = new byte[1024 * 1024];
            long size = 0;
            int part = 0;
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            SqliteTransaction tx = v.Db.BeginTransaction();
            try
            {
                int read;
                while ((read = await ctx.Request.Body.ReadAsync(buffer, linkedCancellation.Token)) > 0)
                {
                    using var cmd = v.Db.CreateCommand();
                    cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO chunks(attachment_id,idx,bytes) VALUES($id,$i,$b);";
                    cmd.Parameters.AddWithValue("$id", fileId);
                    cmd.Parameters.AddWithValue("$i", part);
                    cmd.Parameters.Add("$b", SqliteType.Blob).Value = buffer.AsSpan(0, read).ToArray();
                    cmd.ExecuteNonQuery();
                    hash.AppendData(buffer, 0, read);
                    size += read;
                    if (size > limit || size > length.Value) throw new IOException("文件长度不符合声明。");
                    if (++part % 8 == 0)
                    {
                        tx.Commit(); tx.Dispose();
                        tx = v.Db.BeginTransaction();
                    }
                }
                tx.Commit();
            }
            finally { tx.Dispose(); }
            linkedCancellation.Token.ThrowIfCancellationRequested();
            if (size != length.Value) throw new IOException("上传不完整。");
            string digest = Convert.ToHexString(hash.GetHashAndReset());
            using var update = v.Db.CreateCommand();
            update.CommandText = "UPDATE attachments SET state='ready',size=$s,sha256=$h WHERE id=$id;";
            update.Parameters.AddWithValue("$s", size);
            update.Parameters.AddWithValue("$h", digest);
            update.Parameters.AddWithValue("$id", fileId);
            update.ExecuteNonQuery();
            return Results.Json(new { id = fileId, size, sha256 = digest });
        }
        catch
        {
            // Best effort cleanup, with 'writing' non-exportable even on abrupt interruption.
            try
            {
                using var tx = v.Db.BeginTransaction();
                using var cmd = v.Db.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = """
                    DELETE FROM chunks WHERE attachment_id=$id;
                    DELETE FROM attachments WHERE id=$id AND state='writing';
                    """;
                cmd.Parameters.AddWithValue("$id", fileId);
                cmd.ExecuteNonQuery();
                tx.Commit();
            }
            catch { /* interrupted storage: retain writing state for later inspection */ }
            throw;
        }
    }
        catch (Exception e) { return Fail("上传失败：" + e.Message); }
        finally { v.Gate.Release(); }
    }
    finally { v.CompleteFileTask(); }
});

// Keep authentication, file lookup and the complete download under one gate.
// Returning Results.Stream before acquiring the stream's gate allowed a concurrent
// /api/lock + /api/open to swap databases between authorization and the first byte.
app.MapGet("/api/files/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id) =>
{
    if (!v.Allowed(ctx)) { ctx.Response.StatusCode = 401; return; }
    if (!Vault.WorkspaceValid(workspace))
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsJsonAsync(new { error = "无效工作区。" });
        return;
    }
    await v.Gate.WaitAsync(ctx.RequestAborted);
    try
    {
        if (!v.Allowed(ctx)) { ctx.Response.StatusCode = 401; return; }
        string name;
        using (var lookup = v.Db.CreateCommand())
        {
            lookup.CommandText = """
                SELECT a.filename FROM attachments a JOIN records r ON a.record_id=r.id
                WHERE a.id=$id AND a.state='ready' AND r.workspace=$w;
                """;
            lookup.Parameters.AddWithValue("$id", id);
            lookup.Parameters.AddWithValue("$w", workspace);
            name = lookup.ExecuteScalar() as string ?? "";
        }
        if (name.Length == 0) { ctx.Response.StatusCode = 404; return; }

        ctx.Response.ContentType = "application/octet-stream";
        ctx.Response.Headers.ContentDisposition =
            "attachment; filename*=UTF-8''" + Uri.EscapeDataString(name);
        using var cmd = v.Db.CreateCommand();
        cmd.CommandText = """
            SELECT c.bytes FROM chunks c
            JOIN attachments a ON a.id=c.attachment_id
            JOIN records r ON a.record_id=r.id
            WHERE a.id=$id AND a.state='ready' AND r.workspace=$w ORDER BY c.idx;
            """;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$w", workspace);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            byte[] bytes = (byte[])reader.GetValue(0);
            await ctx.Response.Body.WriteAsync(bytes, ctx.RequestAborted);
        }
    }
    finally { v.Gate.Release(); }
});

app.MapGet("/api/check", async (HttpContext ctx, Vault v) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        using var cmd = v.Db.CreateCommand();
        cmd.CommandText = "PRAGMA integrity_check;";
        string result = Convert.ToString(cmd.ExecuteScalar()) ?? "";
        cmd.CommandText = "SELECT count(*) FROM attachments WHERE state='writing';";
        long incomplete = (long)cmd.ExecuteScalar()!;
        return Results.Json(new { result, incomplete });
    }
    finally { v.Gate.Release(); }
});

// The web page and WinForms launcher share one exit coordinator.
app.MapGet("/api/task", (HttpContext ctx, Vault v) =>
{
    if (!v.Allowed(ctx)) return (IResult)Results.Unauthorized();
    return Results.Json(new { active = v.FileTaskActive, exiting = v.ExitRequested });
});

app.MapPost("/api/exit", async (HttpContext ctx, Vault v, IHostApplicationLifetime life) =>
{
    if (v.Unlocked && !v.Allowed(ctx)) return Results.Unauthorized();
    // JSON requests may be chunked and have no Content-Length.
    ExitInput? input = ctx.Request.ContentType?.StartsWith(
        "application/json", StringComparison.OrdinalIgnoreCase) == true
        ? await ctx.Request.ReadFromJsonAsync<ExitInput>() : null;
    string choice = input?.Choice ?? "normal";
    if (choice is not ("normal" or "cancel" or "wait" or "stay"))
        return Fail("无效的退出选项。");
    if (!v.TryScheduleExit(choice, life, out string error, ctx))
        return Fail(error, 409);
    return Results.Json(new { ok = true, exiting = choice != "stay" });
});

await app.StartAsync();
string address = app.Services.GetRequiredService<IServer>().Features
    .Get<IServerAddressesFeature>()!.Addresses.Single();
Console.WriteLine("IPSys 网页验证版：" + address);
if (smoke)
{
    try
    {
        await WebSmoke.Run(address);
        string? smokeReport = Environment.GetEnvironmentVariable("IPSYS_SMOKE_REPORT");
        if (!string.IsNullOrWhiteSpace(smokeReport))
            File.WriteAllText(smokeReport, "WEB SMOKE PASS", Encoding.UTF8);
        Console.WriteLine("WEB SMOKE PASS");
    }
    catch (Exception ex)
    {
        string? report = Environment.GetEnvironmentVariable("IPSYS_SMOKE_REPORT");
        try
        {
            if (!string.IsNullOrWhiteSpace(report))
                File.WriteAllText(report, "WEB SMOKE FAIL\n" + ex, Encoding.UTF8);
        }
        catch { /* Report failures must not hide the original smoke exception. */ }
        Console.Error.WriteLine(ex);
        throw;
    }
    finally { await app.StopAsync(); }
}
else
{
    // This is a Windows GUI application. WinForms owns the lifetime of the HTTP host.
    // The browser is opened only when the user presses the launcher button.
    try
    {
        await LauncherHost.WaitForExitAsync(address, app.Lifetime.ApplicationStopping,
            app.Services.GetRequiredService<Vault>(), app.Lifetime);
    }
    finally
    {
        // Give in-flight requests time to stop and release the SQLCipher connection.
        await app.StopAsync();
    }
}
await app.DisposeAsync();

static IResult Fail(string message, int status = 400) =>
    Results.Json(new { error = message }, statusCode: status);

record OpenInput(string? Path, string? Password, bool Create);
record ResumeInput(string? Password);
record ExitInput(string? Choice);
record TitleInput(string? Title);
record FileView(long Id, string Name, long Size, string Sha256);
record RecordView(long Id, string Title, List<FileView> Files);

sealed class Vault : IDisposable
{
    public SemaphoreSlim Gate { get; } = new(1, 1);
    private readonly object _taskSync = new();
    private TaskCompletionSource<bool>? _fileTaskCompletion;
    private CancellationTokenSource? _fileTaskCancellation;
    private bool _exitRequested;
    public bool FileTaskActive { get { lock (_taskSync) return _fileTaskCompletion != null; } }
    public bool ExitRequested { get { lock (_taskSync) return _exitRequested; } }
    public bool TryBeginFileTask(HttpContext context, out CancellationToken cancellation)
    {
        lock (_taskSync)
        {
            if (!Allowed(context) || _fileTaskCompletion != null || _exitRequested)
            {
                cancellation = default;
                return false;
            }
            _fileTaskCancellation = new CancellationTokenSource();
            _fileTaskCompletion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            cancellation = _fileTaskCancellation.Token;
            return true;
        }
    }
    public void CompleteFileTask()
    {
        TaskCompletionSource<bool>? completion;
        CancellationTokenSource? cancellation;
        lock (_taskSync)
        {
            completion = _fileTaskCompletion;
            cancellation = _fileTaskCancellation;
            _fileTaskCompletion = null;
            _fileTaskCancellation = null;
        }
        completion?.TrySetResult(true);
        cancellation?.Dispose();
    }
    public bool TryScheduleExit(string choice, IHostApplicationLifetime life, out string error,
        HttpContext? context = null)
    {
        Task pending;
        lock (_taskSync)
        {
            // Authentication must be rechecked atomically with exit scheduling:
            // the old tab cannot terminate a newly opened database.
            if (context != null && _db != null && !Allowed(context))
            {
                error = "会话已经失效，不能退出当前数据库。";
                return false;
            }
            if (choice == "stay")
            {
                error = "";
                return true;
            }
            if (_exitRequested)
            {
                error = "程序已进入安全退出流程。";
                return false;
            }
            if (_fileTaskCompletion != null && choice is not ("cancel" or "wait"))
            {
                error = "有文件任务正在执行，请选择取消任务并退出、任务完成后退出或暂不退出。";
                return false;
            }
            _exitRequested = true;
            pending = _fileTaskCompletion?.Task ?? Task.CompletedTask;
            if (choice == "cancel") _fileTaskCancellation?.Cancel();
            error = "";
        }
        _ = Task.Run(async () =>
        {
            try
            {
                // Let the browser receive the response before shutting down the host.
                await Task.Delay(200);
                await pending;
                await Gate.WaitAsync();
                try { Close(); }
                finally { Gate.Release(); }
                life.StopApplication();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("安全退出失败：" + ex.Message);
                lock (_taskSync) _exitRequested = false;
            }
        });
        return true;
    }
    private SqliteConnection? _db;
    private string? _token;
    public bool Unlocked => _db != null;
    public SqliteConnection Db => _db ?? throw new InvalidOperationException("请先解锁数据库。");
    public string Path { get; private set; } = "";
    public string SessionToken => _token ?? throw new InvalidOperationException("当前没有已打开的数据库。");

    public bool PasswordMatches(string password)
    {
        if (!Unlocked || string.IsNullOrEmpty(password)) return false;
        try
        {
            // Open a SECOND read-only connection. It cannot modify or replace the
            // WinForms-owned connection and fails when the SQLCipher key is invalid.
            var builder = new SqliteConnectionStringBuilder
            {
                DataSource = Path,
                Mode = SqliteOpenMode.ReadOnly,
                Password = password,
                Pooling = false
            };
            using var check = new SqliteConnection(builder.ToString());
            check.Open();
            using var cmd = check.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM sqlite_master;";
            _ = cmd.ExecuteScalar();
            return true;
        }
        catch (SqliteException)
        {
            return false;
        }
    }
    public bool Allowed(HttpContext context)
    {
        lock (_taskSync)
        {
            if (_db == null || _token == null) return false;
            string header = context.Request.Headers["X-IPSys-Token"].ToString();
            return header.Length == _token.Length &&
                   CryptographicOperations.FixedTimeEquals(
                       Encoding.ASCII.GetBytes(header), Encoding.ASCII.GetBytes(_token));
        }
    }
    public string SetOpen(SqliteConnection db, string path)
    {
        lock (_taskSync)
        {
            if (_db != null) throw new InvalidOperationException("已经打开另一数据库。");
            _db = db; Path = path;
            _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            return _token;
        }
    }
    public void Close()
    {
        lock (_taskSync)
        {
            // Keep the existing connection state if disposal fails so the caller
            // can report a close failure rather than silently treating it as safe.
            _db?.Dispose();
            _db = null;
            _token = null;
            Path = "";
        }
    }
    public void Dispose()
    {
        Close();
        _fileTaskCancellation?.Dispose();
        Gate.Dispose();
    }
    public static bool WorkspaceValid(string work) => work is "company" or "personal";
    public static SqliteConnection Connect(string path, string password, bool create)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = create ? SqliteOpenMode.ReadWriteCreate : SqliteOpenMode.ReadWrite,
            Password = password,
            Pooling = false
        };
        var db = new SqliteConnection(builder.ToString());
        try
        {
            db.Open();
            using var cmd = db.CreateCommand();
            cmd.CommandText = "PRAGMA cipher_version;";
            if (string.IsNullOrWhiteSpace(Convert.ToString(cmd.ExecuteScalar())))
                throw new IOException("当前 SQLite 不支持 SQLCipher，拒绝明文降级。");
            cmd.CommandText = "SELECT count(*) FROM sqlite_master;";
            cmd.ExecuteScalar(); // Throws when database password is incorrect.
            cmd.CommandText = "PRAGMA foreign_keys=ON;"; cmd.ExecuteNonQuery();
            cmd.CommandText = "PRAGMA journal_mode=DELETE;"; cmd.ExecuteScalar();
            cmd.CommandText = "PRAGMA synchronous=FULL;"; cmd.ExecuteNonQuery();
            return db;
        }
        catch { db.Dispose(); throw; }
    }
    public static void CreateSchema(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE records(id INTEGER PRIMARY KEY,workspace TEXT NOT NULL
                CHECK(workspace IN ('company','personal')), title TEXT NOT NULL
                CHECK(length(trim(title))>0));
            CREATE TABLE attachments(id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL
                REFERENCES records(id),filename TEXT NOT NULL,expected_size INTEGER NOT NULL,
                size INTEGER,sha256 TEXT,state TEXT NOT NULL CHECK(state IN ('writing','ready')));
            CREATE TABLE chunks(attachment_id INTEGER NOT NULL REFERENCES attachments(id)
                ON DELETE CASCADE,idx INTEGER NOT NULL,bytes BLOB NOT NULL,
                PRIMARY KEY(attachment_id,idx));
            """;
        cmd.ExecuteNonQuery();
    }
    public static void ValidateSchema(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('records','attachments','chunks');";
        if ((long)cmd.ExecuteScalar()! != 3L)
            throw new IOException("不支持该数据库的表结构；请使用独立的网页版测试库。");
    }
}

static class WebSmoke
{
    public static async Task Run(string address)
    {
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "IPSys-Web-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            string dbPath = System.IO.Path.Combine(dir, "smoke.db");
            string password = "test-" + Guid.NewGuid().ToString("N");
            string landing = await client.GetStringAsync("/");
            if (!landing.Contains("IPSys") || !landing.Contains("app.js"))
                throw new IOException("网页首页不可用。");
            string css = await client.GetStringAsync("/style.css");
            string javascript = await client.GetStringAsync("/app.js");
            if (!css.Contains(":root") || !javascript.Contains("openForm"))
                throw new IOException("HTML/CSS/JS 静态文件未完整加载。");
            var open = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, password, true));
            open.EnsureSuccessStatusCode();
            string token = (await open.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("token").GetString()!;
            client.DefaultRequestHeaders.Add("X-IPSys-Token", token);

            var record = await client.PostAsJsonAsync("/api/records/company", new TitleInput("测试资料"));
            record.EnsureSuccessStatusCode();
            long id = (await record.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();

            var data = RandomNumberGenerator.GetBytes(1024 * 1024 + 31);
            using var body = new ByteArrayContent(data);
            body.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            // X-File-Name is a request header, not a content header.
            using var req = new HttpRequestMessage(HttpMethod.Post, $"/api/records/company/{id}/files")
                { Content = body };
            req.Headers.Add("X-File-Name", Uri.EscapeDataString("test.bin"));
            var uploaded = await client.SendAsync(req);
            uploaded.EnsureSuccessStatusCode();
            long fileId = (await uploaded.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            byte[] exported = await client.GetByteArrayAsync($"/api/files/company/{fileId}");
            if (!exported.AsSpan().SequenceEqual(data)) throw new IOException("文件往返不一致。");
            var isolated = await client.GetAsync($"/api/files/personal/{fileId}");
            if (isolated.StatusCode != HttpStatusCode.NotFound) throw new IOException("工作区数据越权。");
            var check = await client.GetAsync("/api/check");
            check.EnsureSuccessStatusCode();
            // Simulate closing the browser tab: a second browser has NO session token.
            using var newTab = new HttpClient { BaseAddress = new Uri(address) };
            var badResume = await newTab.PostAsJsonAsync("/api/resume", new ResumeInput("wrong"));
            if (badResume.IsSuccessStatusCode)
                throw new IOException("错误密码不应恢复会话。");
            if ((await newTab.GetAsync("/api/records/company")).StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("未认证的新标签页不得读取业务记录。");

            var restored = await newTab.PostAsJsonAsync("/api/resume", new ResumeInput(password));
            restored.EnsureSuccessStatusCode();
            string restoredToken = (await restored.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("token").GetString()!;
            newTab.DefaultRequestHeaders.Add("X-IPSys-Token", restoredToken);
            var restoredRecords = await newTab.GetAsync("/api/records/company");
            restoredRecords.EnsureSuccessStatusCode();
            string bodyText = await restoredRecords.Content.ReadAsStringAsync();
            if (!bodyText.Contains("测试资料"))
                throw new IOException("恢复会话后没有读到原有记录。");
            // Reauthorization must not invalidate the original live tab.
            (await client.GetAsync("/api/check")).EnsureSuccessStatusCode();

            using var locked = await client.PostAsync("/api/lock", null);
            locked.EnsureSuccessStatusCode();
            // Locking must invalidate the recovered tab as well.
            if ((await newTab.GetAsync("/api/records/company")).StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("关闭数据库后旧会话未失效。");
            var resumeAfterLock = await newTab.PostAsJsonAsync("/api/resume", new ResumeInput(password));
            if (resumeAfterLock.IsSuccessStatusCode)
                throw new IOException("关闭数据库后不得恢复会话。");
            client.DefaultRequestHeaders.Remove("X-IPSys-Token");
            var bad = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, "wrong", false));
            if (bad.IsSuccessStatusCode) throw new IOException("错误密码竟能打开。");
            var again = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, password, false));
            again.EnsureSuccessStatusCode();
            string newToken = (await again.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("token").GetString()!;
            client.DefaultRequestHeaders.Add("X-IPSys-Token", newToken);
            // A prior browser tab must not touch the newly opened database.
            using var staleTab = new HttpClient { BaseAddress = new Uri(address) };
            staleTab.DefaultRequestHeaders.Add("X-IPSys-Token", token);
            if ((await staleTab.GetAsync("/api/records/company")).StatusCode != HttpStatusCode.Unauthorized ||
                (await staleTab.GetAsync($"/api/files/company/{fileId}")).StatusCode != HttpStatusCode.Unauthorized ||
                (await staleTab.GetAsync("/api/check")).StatusCode != HttpStatusCode.Unauthorized ||
                (await staleTab.PostAsync("/api/lock", null)).StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("旧标签令牌不得访问或关闭新会话的数据库。");
            (await client.GetAsync("/api/check")).EnsureSuccessStatusCode();
            using var finalLock = await client.PostAsync("/api/lock", null);
            finalLock.EnsureSuccessStatusCode();

            // A paused HTTP upload exercises Q153 without relying on GUI timing.
            var lastOpen = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, password, false));
            lastOpen.EnsureSuccessStatusCode();
            string lastToken = (await lastOpen.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("token").GetString()!;
            client.DefaultRequestHeaders.Remove("X-IPSys-Token");
            client.DefaultRequestHeaders.Add("X-IPSys-Token", lastToken);
            using var paused = new PausedUploadContent();
            using var slowRequest = new HttpRequestMessage(HttpMethod.Post,
                $"/api/records/company/{id}/files") { Content = paused };
            slowRequest.Headers.Add("X-File-Name", Uri.EscapeDataString("paused.bin"));
            Task<HttpResponseMessage> runningUpload = client.SendAsync(slowRequest);
            await paused.FirstChunkSent.WaitAsync(TimeSpan.FromSeconds(10));
            bool active = false;
            for (int i = 0; i < 80; ++i)
            {
                var taskState = await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/task");
                active = taskState.GetProperty("active").GetBoolean();
                if (active) break;
                await Task.Delay(50);
            }
            if (!active) throw new IOException("慢速上传未被标识为进行中的文件任务。");
            var missingChoice = await client.PostAsJsonAsync("/api/exit", new ExitInput("normal"));
            if (missingChoice.StatusCode != HttpStatusCode.Conflict)
                throw new IOException("上传进行中不应绕过退出三选项。");
            var stay = await client.PostAsJsonAsync("/api/exit", new ExitInput("stay"));
            stay.EnsureSuccessStatusCode();
            var prematureLock = await client.PostAsync("/api/lock", null);
            if (prematureLock.StatusCode != HttpStatusCode.Conflict)
                throw new IOException("上传期间不得直接关库。");
            var cancel = await client.PostAsJsonAsync("/api/exit", new ExitInput("cancel"));
            cancel.EnsureSuccessStatusCode();
            paused.Release();
            try { using var cancelledResponse = await runningUpload.WaitAsync(TimeSpan.FromSeconds(10)); }
            catch (HttpRequestException) { /* Cancellation may close an in-flight request. */ }
            catch (OperationCanceledException) { /* Host exit may cancel the test HTTP client. */ }
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }
}

// HTTP body sends a first chunk then pauses, permitting reproducible exit tests.
sealed class PausedUploadContent : HttpContent
{
    private readonly TaskCompletionSource<bool> _first = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource<bool> _release = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task FirstChunkSent => _first.Task;
    public void Release() => _release.TrySetResult(true);
    public PausedUploadContent()
    {
        Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
    }
    protected override bool TryComputeLength(out long length) { length = 8192; return true; }
    protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
        SendBodyAsync(stream, CancellationToken.None);
    protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context,
        CancellationToken cancellationToken) => SendBodyAsync(stream, cancellationToken);
    private async Task SendBodyAsync(Stream stream, CancellationToken cancellation)
    {
        await stream.WriteAsync(new byte[4096], cancellation);
        await stream.FlushAsync(cancellation);
        _first.TrySetResult(true);
        await _release.Task.WaitAsync(cancellation);
        await stream.WriteAsync(new byte[4096], cancellation);
    }
}

internal static class EmbeddedWebAssets
{
    internal static byte[] Read(string filename)
    {
        string name = "IPSys.Web.Embedded." + filename;
        using var resource = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
            ?? throw new InvalidOperationException("Missing embedded web resource: " + name);
        using var memory = new MemoryStream();
        resource.CopyTo(memory);
        return memory.ToArray();
    }
}
