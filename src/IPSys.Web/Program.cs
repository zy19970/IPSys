using System.Data;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Data.Sqlite;

SQLitePCL.Batteries_V2.Init();
var smoke = args.Contains("--smoke");
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = Array.Empty<string>(),
    ContentRootPath = AppContext.BaseDirectory,
    WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
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
app.UseDefaultFiles();
app.UseStaticFiles();

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
    await v.Gate.WaitAsync();
    try
    {
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

app.MapPost("/api/lock", async (HttpContext ctx, Vault v) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    await v.Gate.WaitAsync();
    try { v.Close(); return Results.Ok(new { ok = true }); }
    finally { v.Gate.Release(); }
});

app.MapGet("/api/records/{workspace}", async (HttpContext ctx, Vault v, string workspace) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    await v.Gate.WaitAsync();
    try
    {
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
    await v.Gate.WaitAsync();
    try
    {
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
    if (!await v.Gate.WaitAsync(0)) return Fail("另一项数据库操作正在执行，请稍后重试。", 409);
    try
    {
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
                while ((read = await ctx.Request.Body.ReadAsync(buffer, ctx.RequestAborted)) > 0)
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
});

app.MapGet("/api/files/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    await v.Gate.WaitAsync();
    try
    {
        string name;
        using (var cmd = v.Db.CreateCommand())
        {
            cmd.CommandText = """
                SELECT a.filename FROM attachments a JOIN records r ON a.record_id=r.id
                WHERE a.id=$id AND a.state='ready' AND r.workspace=$w;
                """;
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$w", workspace);
            name = cmd.ExecuteScalar() as string ?? "";
        }
        if (name.Length == 0) return Results.NotFound();
        return Results.Stream(async output =>
        {
            await v.Gate.WaitAsync();
            try
            {
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
                    var bytes = (byte[])reader.GetValue(0);
                    await output.WriteAsync(bytes, ctx.RequestAborted);
                }
            }
            finally { v.Gate.Release(); }
        }, "application/octet-stream", name);
    }
    finally { v.Gate.Release(); }
});

app.MapGet("/api/check", async (HttpContext ctx, Vault v) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    await v.Gate.WaitAsync();
    try
    {
        using var cmd = v.Db.CreateCommand();
        cmd.CommandText = "PRAGMA integrity_check;";
        string result = Convert.ToString(cmd.ExecuteScalar()) ?? "";
        cmd.CommandText = "SELECT count(*) FROM attachments WHERE state='writing';";
        long incomplete = (long)cmd.ExecuteScalar()!;
        return Results.Json(new { result, incomplete });
    }
    finally { v.Gate.Release(); }
});

app.MapPost("/api/exit", async (HttpContext ctx, Vault v, IHostApplicationLifetime life) =>
{
    if (v.Unlocked && !v.Allowed(ctx)) return Results.Unauthorized();
    await v.Gate.WaitAsync();
    try { v.Close(); }
    finally { v.Gate.Release(); }
    _ = Task.Run(async () => { await Task.Delay(350); life.StopApplication(); });
    return Results.Json(new { ok = true });
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
        Console.WriteLine("WEB SMOKE PASS");
    }
    finally { await app.StopAsync(); }
}
else
{
    try { Process.Start(new ProcessStartInfo(address) { UseShellExecute = true }); }
    catch { Console.WriteLine("请在 Edge/Chrome 手工打开：" + address); }
    await app.WaitForShutdownAsync();
}
await app.DisposeAsync();

static IResult Fail(string message, int status = 400) =>
    Results.Json(new { error = message }, statusCode: status);

record OpenInput(string? Path, string? Password, bool Create);
record TitleInput(string? Title);
record FileView(long Id, string Name, long Size, string Sha256);
record RecordView(long Id, string Title, List<FileView> Files);

sealed class Vault : IDisposable
{
    public SemaphoreSlim Gate { get; } = new(1, 1);
    private SqliteConnection? _db;
    private string? _token;
    public bool Unlocked => _db != null;
    public SqliteConnection Db => _db ?? throw new InvalidOperationException("请先解锁数据库。");
    public string Path { get; private set; } = "";
    public bool Allowed(HttpContext context)
    {
        if (_db == null || _token == null) return false;
        string header = context.Request.Headers["X-IPSys-Token"].ToString();
        return header.Length == _token.Length &&
               CryptographicOperations.FixedTimeEquals(
                   Encoding.ASCII.GetBytes(header), Encoding.ASCII.GetBytes(_token));
    }
    public string SetOpen(SqliteConnection db, string path)
    {
        if (_db != null) throw new InvalidOperationException("已经打开另一数据库。");
        _db = db; Path = path;
        _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        return _token;
    }
    public void Close() { _db?.Dispose(); _db = null; _token = null; Path = ""; }
    public void Dispose() { Close(); Gate.Dispose(); }
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
            if (!landing.Contains("IPSys")) throw new IOException("未找到网页首页。");
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
            using var locked = await client.PostAsync("/api/lock", null);
            locked.EnsureSuccessStatusCode();
            client.DefaultRequestHeaders.Remove("X-IPSys-Token");
            var bad = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, "wrong", false));
            if (bad.IsSuccessStatusCode) throw new IOException("错误密码竟能打开。");
            var again = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, password, false));
            again.EnsureSuccessStatusCode();
            string newToken = (await again.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("token").GetString()!;
            client.DefaultRequestHeaders.Add("X-IPSys-Token", newToken);
            using var finalLock = await client.PostAsync("/api/lock", null);
            finalLock.EnsureSuccessStatusCode();
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }
}
