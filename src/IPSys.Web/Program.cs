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
// The approved evolving UI draft lives in demo/ui-preview.html and is embedded as-is.
byte[] previewHtml = EmbeddedWebAssets.Read("ui-preview.html");
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
// Isolate the single-file mock UI in an opaque-origin CSP sandbox. It needs
// inline handlers/styles, but must not acquire application origin or network access.
app.MapGet("/ui-preview", (HttpContext ctx) =>
{
    ctx.Response.Headers["Content-Security-Policy"] =
        "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; " +
        "style-src 'unsafe-inline'; img-src data:; connect-src 'none'; " +
        "object-src 'none'; base-uri 'none'; form-action 'none'";
    return Results.Bytes(previewHtml, contentType: "text/html; charset=utf-8");
});

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
            ProjectStore.Ensure(db);
            IpStore.Ensure(db);
            ContractStore.Ensure(db);
            ArchiveStore.Ensure(db);
            BusinessFileStore.Ensure(db);
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

// Project ledger: encrypted in the same SQLCipher file, isolated by workspace.
// Intellectual property management. All operations require an unlocked session
// and workspace-scoped SQL queries; attachments are a separate upcoming stage.
app.MapGet("/api/ip/{workspace}", async (HttpContext ctx, Vault v, string workspace) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        return Results.Json(IpStore.List(v.Db, workspace));
    }
    finally { v.Gate.Release(); }
});
app.MapPost("/api/ip/{workspace}", async (HttpContext ctx, Vault v, string workspace, IpInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    string? error=IpStore.Validate(input);
    if(error!=null)return Fail(error);
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
        return Results.Json(new { id=IpStore.Add(v.Db,workspace,input) });
    }
    finally { v.Gate.Release(); }
});
app.MapPut("/api/ip/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id, IpInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    string? error=IpStore.Validate(input);
    if(error!=null)return Fail(error);
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
        return IpStore.Update(v.Db,workspace,id,input)?Results.Ok(new {ok=true}):Results.NotFound();
    }
    finally { v.Gate.Release(); }
});
app.MapDelete("/api/ip/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
        return IpStore.Delete(v.Db,workspace,id)?Results.Ok(new {ok=true}):Results.NotFound();
    }
    finally { v.Gate.Release(); }
});
app.MapPost("/api/ip/{workspace}/{id:long}/transfer", async (
    HttpContext ctx, Vault v, string workspace, long id, IpTransfer input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)||!Vault.WorkspaceValid(input.TargetWorkspace))
        return Fail("无效工作区。");
    if(workspace==input.TargetWorkspace && input.Move)return Fail("同一工作区无需转移。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
        long? copied=IpStore.Transfer(v.Db,workspace,id,input.TargetWorkspace,input.Move);
        return copied.HasValue?Results.Json(new {id=copied.Value}):Results.NotFound();
    }
    finally { v.Gate.Release(); }
});

// Contract creation requires an existing, active project in the same workspace.
// "All contracts" is a read-only aggregation; it cannot create orphan records.
// B04 minimal archives: the section is a validated view inside a fixed M0 module.
app.MapGet("/api/archives/{workspace}/{section}", async (
    HttpContext ctx, Vault v, string workspace, string section) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (ArchiveStore.Module(workspace,section)==null) return Fail("无效的归档工作区或模块。");
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        return Results.Json(ArchiveStore.List(v.Db,workspace,section));
    }
    finally { v.Gate.Release(); }
});
app.MapPost("/api/archives/{workspace}/{section}", async (
    HttpContext ctx, Vault v, string workspace, string section, ArchiveInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (ArchiveStore.Module(workspace,section)==null) return Fail("无效的归档工作区或模块。");
    var validation=ArchiveStore.Validate(input);
    if(validation!=null)return Fail(validation);
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
        return Results.Json(new {id=ArchiveStore.Add(v.Db,workspace,section,input)});
    }
    finally { v.Gate.Release(); }
});
app.MapPut("/api/archives/{workspace}/{section}/{id:long}", async (
    HttpContext ctx, Vault v, string workspace, string section, long id, ArchiveInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (ArchiveStore.Module(workspace,section)==null) return Fail("无效的归档工作区或模块。");
    var validation=ArchiveStore.Validate(input);
    if(validation!=null)return Fail(validation);
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
        return ArchiveStore.Update(v.Db,workspace,section,id,input)
            ? Results.Ok(new {ok=true}) : Results.NotFound();
    }
    finally { v.Gate.Release(); }
});
app.MapDelete("/api/archives/{workspace}/{section}/{id:long}", async (
    HttpContext ctx, Vault v, string workspace, string section, long id) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (ArchiveStore.Module(workspace,section)==null) return Fail("无效的归档工作区或模块。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
        return ArchiveStore.Delete(v.Db,workspace,section,id)
            ? Results.Ok(new {ok=true}) : Results.NotFound();
    }
    finally { v.Gate.Release(); }
});
app.MapPost("/api/archives/{workspace}/{section}/{id:long}/transfer", async (
    HttpContext ctx, Vault v, string workspace, string section, long id, ArchiveTransfer input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    string? source=ArchiveStore.Module(workspace,section);
    string? target=ArchiveStore.Module(input.TargetWorkspace,input.TargetSection);
    if(source==null||target!=source)return Fail("不可转移至不兼容的资料类别。");
    if(input.Move&&workspace==input.TargetWorkspace&&section==input.TargetSection)
        return Fail("同一类别无需转移。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
        long? newId=ArchiveStore.Transfer(v.Db,workspace,section,id,input.TargetWorkspace,input.TargetSection,input.Move);
        return newId.HasValue?Results.Json(new {id=newId.Value}):Results.NotFound();
    }
    finally { v.Gate.Release(); }
});

app.MapGet("/api/contracts/{workspace}", async (HttpContext ctx, Vault v, string workspace) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        return Results.Json(ContractStore.List(v.Db, workspace));
    }
    finally { v.Gate.Release(); }
});
app.MapPost("/api/projects/{workspace}/{projectId:long}/contracts", async (
    HttpContext ctx, Vault v, string workspace, long projectId, ContractInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    var invalid = ContractStore.Validate(input);
    if (invalid != null) return Fail(invalid);
    if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
        if (!ContractStore.ActiveProject(v.Db, workspace, projectId)) return Results.NotFound();
        return Results.Json(new { id = ContractStore.Add(v.Db, workspace, projectId, input) });
    }
    finally { v.Gate.Release(); }
});
// Duplicate a contract and its file references in a single SQLCipher transaction.
app.MapPost("/api/contracts/{workspace}/{id:long}/copy",async(
    HttpContext ctx,Vault v,string workspace,long id)=>
{
    if(!v.Allowed(ctx))return Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中或程序正在退出。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中或程序正在退出。",409);
        var copied=ContractStore.Duplicate(v.Db,workspace,id);
        return copied.HasValue?Results.Json(new{id=copied.Value}):Results.NotFound();
    }
    finally{v.Gate.Release();}
});
app.MapPut("/api/contracts/{workspace}/{id:long}", async (
    HttpContext ctx, Vault v, string workspace, long id, ContractInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    var invalid = ContractStore.Validate(input);
    if (invalid != null) return Fail(invalid);
    if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
        return ContractStore.Update(v.Db, workspace, id, input)
            ? Results.Ok(new { ok = true }) : Results.NotFound();
    }
    finally { v.Gate.Release(); }
});
app.MapDelete("/api/contracts/{workspace}/{id:long}", async (
    HttpContext ctx, Vault v, string workspace, long id) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
        return ContractStore.SoftDelete(v.Db, workspace, id)
            ? Results.Ok(new { ok = true }) : Results.NotFound();
    }
    finally { v.Gate.Release(); }
});

app.MapGet("/api/projects/{workspace}", async (HttpContext ctx, Vault v, string workspace) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        return Results.Json(ProjectStore.List(v.Db, workspace));
    }
    finally { v.Gate.Release(); }
});

app.MapPost("/api/projects/{workspace}", async (HttpContext ctx, Vault v, string workspace, ProjectInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    var validation = ProjectStore.Check(input);
    if (validation != null) return Fail(validation);
    if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
        return Results.Json(new { id = ProjectStore.Insert(v.Db, workspace, input) });
    }
    finally { v.Gate.Release(); }
});

app.MapPut("/api/projects/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id, ProjectInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    var validation = ProjectStore.Check(input);
    if (validation != null) return Fail(validation);
    if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
        return ProjectStore.Update(v.Db, workspace, id, input) ? Results.Ok(new { ok = true }) : Results.NotFound();
    }
    finally { v.Gate.Release(); }
});

app.MapDelete("/api/projects/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
        return ProjectStore.Delete(v.Db, workspace, id) ? Results.Ok(new { ok = true }) : Results.NotFound();
    }
    finally { v.Gate.Release(); }
});

// Copy keeps the source; move switches workspace. Both are scoped to a known source.
app.MapPost("/api/projects/{workspace}/{id:long}/transfer", async (
    HttpContext ctx, Vault v, string workspace, long id, ProjectTransfer input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace) || !Vault.WorkspaceValid(input.TargetWorkspace))
        return Fail("无效工作区。");
    if (input.TargetWorkspace == workspace && input.Move) return Fail("同一工作区无需转移。");
    if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
    await v.Gate.WaitAsync();
    try
    {
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
        var newId = ProjectStore.Transfer(v.Db, workspace, id, input.TargetWorkspace, input.Move);
        return newId.HasValue ? Results.Json(new { id = newId.Value }) : Results.NotFound();
    }
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

// Update only a record name in the existing encrypted prototype schema.
// Business modules will get their own validated API after M2 schema design.
app.MapPut("/api/records/{workspace}/{id:long}", async (
    HttpContext ctx, Vault v, string workspace, long id, TitleInput input) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    if (string.IsNullOrWhiteSpace(input.Title)) return Fail("名称不能为空。");
    if (input.Title.Length > 300) return Fail("名称不能超过 300 字。");
    if (v.FileTaskActive || v.ExitRequested)
        return Fail("文件任务执行中或程序正在退出，暂不能修改资料。", 409);
    await v.Gate.WaitAsync();
    try
    {
        // Reauthorize after waiting, and scope the SQL UPDATE to the workspace.
        if (!v.Allowed(ctx)) return Results.Unauthorized();
        if (v.FileTaskActive || v.ExitRequested)
            return Fail("文件任务执行中或程序正在退出，暂不能修改资料。", 409);
        using var cmd = v.Db.CreateCommand();
        cmd.CommandText = "UPDATE records SET title=$title WHERE id=$id AND workspace=$workspace;";
        cmd.Parameters.AddWithValue("$title", input.Title.Trim());
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$workspace", workspace);
        if (cmd.ExecuteNonQuery() != 1) return Results.NotFound();
        return Results.Ok(new { ok = true });
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

BusinessFileEndpoints.Map(app);
RecycleEndpoints.Map(app);

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

record ProjectInput(string? Name, string? ProjectType, string? ProjectNo, string? Leader,
    string? UndertakingOrg, string? StartDate, string? EndDate, string? ProjectStatus,
    string? Category, string? Remarks, string? Tags);
record ProjectTransfer(string TargetWorkspace, bool Move);
record ProjectView(long Id, string Workspace, string Name, string ProjectType, string ProjectNo,
    string Leader, string UndertakingOrg, string StartDate, string EndDate, string ProjectStatus,
    string Category, string Remarks, string Tags);

static class ProjectStore
{
    private static readonly string[] Types = ["科研项目", "横向项目", "其他项目"];
    private static readonly string[] Statuses = ["筹备中", "进行中", "已完成", "已终止"];
    public static void Ensure(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS business_projects(
              id INTEGER PRIMARY KEY, workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              name TEXT NOT NULL, project_type TEXT NOT NULL, project_no TEXT NOT NULL DEFAULT '',
              leader TEXT NOT NULL DEFAULT '', undertaking_org TEXT NOT NULL DEFAULT '',
              start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '',
              project_status TEXT NOT NULL DEFAULT '筹备中', category TEXT NOT NULL DEFAULT '',
              remarks TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)));
            CREATE INDEX IF NOT EXISTS idx_business_projects_scope
              ON business_projects(workspace,deleted,project_type);
            """;
        cmd.ExecuteNonQuery();
    }
    private static string Text(string? s) => s?.Trim() ?? "";
    public static string? Check(ProjectInput x)
    {
        if (Text(x.Name).Length is 0 or > 300) return "项目名称必须填写，最多 300 字。";
        if (!Types.Contains(Text(x.ProjectType))) return "请选择科研项目、横向项目或其他项目。";
        if (Text(x.ProjectStatus).Length > 0 && !Statuses.Contains(Text(x.ProjectStatus)))
            return "项目状态无效。";
        foreach (var s in new[] {x.ProjectNo,x.Leader,x.UndertakingOrg,x.StartDate,x.EndDate,x.Category,x.Remarks,x.Tags})
            if (Text(s).Length > 4000) return "项目字段内容过长。";
        foreach (var date in new[] {Text(x.StartDate),Text(x.EndDate)})
            if (date.Length != 0 && (!DateOnly.TryParseExact(date, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsed) ||
                parsed.ToString("yyyy-MM-dd") != date)) return "日期格式必须是 yyyy-MM-dd。";
        return null;
    }
    private static void Params(SqliteCommand cmd, ProjectInput x)
    {
        cmd.Parameters.AddWithValue("$name", Text(x.Name));
        cmd.Parameters.AddWithValue("$type", Text(x.ProjectType));
        cmd.Parameters.AddWithValue("$no", Text(x.ProjectNo));
        cmd.Parameters.AddWithValue("$leader", Text(x.Leader));
        cmd.Parameters.AddWithValue("$org", Text(x.UndertakingOrg));
        cmd.Parameters.AddWithValue("$start", Text(x.StartDate));
        cmd.Parameters.AddWithValue("$end", Text(x.EndDate));
        cmd.Parameters.AddWithValue("$status", Text(x.ProjectStatus) is var st && st.Length > 0 ? st : "筹备中");
        cmd.Parameters.AddWithValue("$category", Text(x.Category));
        cmd.Parameters.AddWithValue("$remarks", Text(x.Remarks));
        cmd.Parameters.AddWithValue("$tags", Text(x.Tags));
    }
    private const string Fields = "name,project_type,project_no,leader,undertaking_org,start_date,end_date,project_status,category,remarks,tags";
    private const string Values = "$name,$type,$no,$leader,$org,$start,$end,$status,$category,$remarks,$tags";
    public static long Insert(SqliteConnection db, string workspace, ProjectInput x)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = "INSERT INTO business_projects(workspace," + Fields + ") VALUES($w," + Values + "); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$w", workspace);
        Params(cmd,x);
        return (long)cmd.ExecuteScalar()!;
    }
    public static bool Update(SqliteConnection db, string workspace, long id, ProjectInput x)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            UPDATE business_projects SET name=$name,project_type=$type,project_no=$no,
            leader=$leader,undertaking_org=$org,start_date=$start,end_date=$end,
            project_status=$status,category=$category,remarks=$remarks,tags=$tags
            WHERE id=$id AND workspace=$w AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$id",id);cmd.Parameters.AddWithValue("$w",workspace);Params(cmd,x);
        return cmd.ExecuteNonQuery()==1;
    }
    public static bool Delete(SqliteConnection db,string workspace,long id)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="UPDATE business_projects SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;";
        cmd.Parameters.AddWithValue("$id",id);cmd.Parameters.AddWithValue("$w",workspace);
        return cmd.ExecuteNonQuery()==1;
    }
    public static List<ProjectView> List(SqliteConnection db,string workspace)
    {
        var list=new List<ProjectView>();
        using var cmd=db.CreateCommand();
        cmd.CommandText="SELECT id,workspace,"+Fields+" FROM business_projects WHERE workspace=$w AND deleted=0 ORDER BY id DESC;";
        cmd.Parameters.AddWithValue("$w",workspace);
        using var reader=cmd.ExecuteReader();
        while(reader.Read()) list.Add(new ProjectView(reader.GetInt64(0),reader.GetString(1),
            reader.GetString(2),reader.GetString(3),reader.GetString(4),reader.GetString(5),
            reader.GetString(6),reader.GetString(7),reader.GetString(8),reader.GetString(9),
            reader.GetString(10),reader.GetString(11),reader.GetString(12)));
        return list;
    }
    public static long? Transfer(SqliteConnection db,string workspace,long id,string target,bool move)
    {
        using var lookup=db.CreateCommand();
        lookup.CommandText="SELECT "+Fields+" FROM business_projects WHERE id=$id AND workspace=$w AND deleted=0;";
        lookup.Parameters.AddWithValue("$id",id);lookup.Parameters.AddWithValue("$w",workspace);
        using var reader=lookup.ExecuteReader();
        if(!reader.Read())return null;
        var values=Enumerable.Range(0,11).Select(reader.GetString).ToArray();
        reader.Close();
        var input=new ProjectInput(values[0],values[1],values[2],values[3],values[4],
            values[5],values[6],values[7],values[8],values[9],values[10]);
        using var tx=db.BeginTransaction();
        long newId;
        using(var insert=db.CreateCommand())
        {
            insert.Transaction=tx;
            insert.CommandText="INSERT INTO business_projects(workspace,"+Fields+") VALUES($w,"+Values+"); SELECT last_insert_rowid();";
            insert.Parameters.AddWithValue("$w",target);Params(insert,input);
            newId=(long)insert.ExecuteScalar()!;
        }
        ContractStore.CopyChildren(db,tx,workspace,id,target,newId);
        BusinessFileStore.CloneLinks(db,tx,workspace,"project",id,"",
            target,"project",newId,"");
        if(move)
        {
            using var delete=db.CreateCommand();delete.Transaction=tx;
            delete.CommandText="UPDATE business_projects SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;";
            delete.Parameters.AddWithValue("$id",id);delete.Parameters.AddWithValue("$w",workspace);
            if(delete.ExecuteNonQuery()!=1)throw new IOException("源项目已发生变化，转移取消。");
        }
        tx.Commit();return newId;
    }
}

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
    private static async Task<(long Id,int Version)> UploadBusinessFile(HttpClient client,
        string workspace,string kind,long ownerId,byte[] data,string name,
        string section="",string category="")
    {
        var path=$"/api/business-files/{workspace}/{kind}/{ownerId}"+
            (section.Length>0?"?section="+Uri.EscapeDataString(section):"");
        using var body=new ByteArrayContent(data);
        body.Headers.ContentType=new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
        using var request=new HttpRequestMessage(HttpMethod.Post,path){Content=body};
        request.Headers.Add("X-File-Name",Uri.EscapeDataString(name));
        if(category.Length>0)request.Headers.Add("X-Material-Category",Uri.EscapeDataString(category));
        using var response=await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var json=(await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>());
        if(json.GetProperty("sha256").GetString()!=Convert.ToHexString(SHA256.HashData(data)))
            throw new IOException("入库原件 SHA-256 与源文件不一致。");
        return (json.GetProperty("id").GetInt64(),json.GetProperty("version").GetInt32());
    }
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
            if (!landing.Contains("IPSys") || !landing.Contains("app.js") ||
                !landing.Contains("id=\"chooseWorkspace\"") ||
                !landing.Contains("id=\"sidebar\"") ||
                !landing.Contains("id=\"content\""))
                throw new IOException("新版主界面或工作区选择未成功加载。");
            string css = await client.GetStringAsync("/style.css");
            string javascript = await client.GetStringAsync("/app.js");
            if (!css.Contains(":root") || !javascript.Contains("openForm") ||
                !javascript.Contains("function realDetail") ||
                !javascript.Contains("function mockDetail"))
                throw new IOException("新版主界面 CSS/JS 未完整加载。");
            using var previewResponse = await client.GetAsync("/ui-preview");
            previewResponse.EnsureSuccessStatusCode();
            string preview = await previewResponse.Content.ReadAsStringAsync();
            string previewPolicy = previewResponse.Headers.GetValues("Content-Security-Policy").Single();
            if (!preview.Contains("科研项目") || !preview.Contains("横向项目") ||
                !preview.Contains("个人资料") || !preview.Contains("公司资料") ||
                !preview.Contains("<script>") ||
                !previewPolicy.Contains("sandbox allow-scripts") ||
                !previewPolicy.Contains("connect-src 'none'"))
                throw new IOException("UI 预览缺失或未与真实业务数据隔离。");
            var open = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, password, true));
            open.EnsureSuccessStatusCode();
            string token = (await open.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("token").GetString()!;
            client.DefaultRequestHeaders.Add("X-IPSys-Token", token);

            var record = await client.PostAsJsonAsync("/api/records/company", new TitleInput("测试资料"));
            record.EnsureSuccessStatusCode();
            long id = (await record.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();

            // Real project CRUD, soft deletion, copy and cross-workspace transfer.
            var projectInput = new ProjectInput("采矿研发项目", "科研项目", "XM-001",
                "负责人甲", "研发中心", "2026-01-01", "", "", "", "测试记录", "");
            var projectCreate = await client.PostAsJsonAsync("/api/projects/company", projectInput);
            projectCreate.EnsureSuccessStatusCode();
            long projectId = (await projectCreate.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var projectEdited = projectInput with { Name = "项目已修改", ProjectStatus = "进行中" };
            (await client.PutAsJsonAsync($"/api/projects/company/{projectId}", projectEdited)).EnsureSuccessStatusCode();
            var projectRecords = await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/company");
            if (projectRecords is null || projectRecords.Count != 1 ||
                projectRecords[0].Name != "项目已修改" ||
                projectRecords[0].ProjectStatus != "进行中")
                throw new IOException("真实项目新增、修改或状态默认值不正确。");
            var deniedProject = await client.PutAsJsonAsync($"/api/projects/personal/{projectId}", projectEdited);
            if (deniedProject.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("跨工作区不允许直接修改项目。");
            var invalidProject = await client.PostAsJsonAsync("/api/projects/company",
                projectEdited with { ProjectType = "无效类别" });
            if (invalidProject.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("项目固定类别未严格校验。");
            var noTokenProject = await new HttpClient { BaseAddress = new Uri(address) }
                .GetAsync("/api/projects/company");
            if (noTokenProject.StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("未登录不能查询项目。");
            // B03: a contract must belong to one active project. Only a project
            // detail may create a contract; the workspace aggregate is read-only.
            var contractInput = new ContractInput("科研技术服务合同", "HT-2026-001",
                "2026-10-12", "12.3", "甲方和乙方", "", "合同测试", "");
            var noParentContract = await client.PostAsJsonAsync(
                "/api/contracts/company", contractInput);
            if (noParentContract.IsSuccessStatusCode)
                throw new IOException("全部合同汇总接口不能独立新建合同。");
            var orphanContract = await client.PostAsJsonAsync(
                "/api/projects/company/987654321/contracts", contractInput);
            if (orphanContract.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("不得为不存在的项目新增合同。");
            var wrongScopeContract = await client.PostAsJsonAsync(
                $"/api/projects/personal/{projectId}/contracts", contractInput);
            if (wrongScopeContract.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("合同项目归属不能跨工作区。");
            var invalidContract = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/contracts",
                contractInput with { SignDate = "2026-99-99" });
            if (invalidContract.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("合同签订日期必须经过校验。");
            var negativeAmount = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/contracts",
                contractInput with { Amount = "-1" });
            if (negativeAmount.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("合同金额不能为负数。");
            var contractCreate = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/contracts", contractInput);
            contractCreate.EnsureSuccessStatusCode();
            long contractId = (await contractCreate.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var contractEdited = contractInput with { Name = "合同已修改", Amount = "0" };
            (await client.PutAsJsonAsync(
                $"/api/contracts/company/{contractId}", contractEdited)).EnsureSuccessStatusCode();
            var sourceContracts = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company");
            if (sourceContracts is null || sourceContracts.Count != 1 ||
                sourceContracts[0].ProjectId != projectId ||
                sourceContracts[0].ProjectName != "项目已修改" ||
                sourceContracts[0].Name != "合同已修改" || sourceContracts[0].Amount != "0")
                throw new IOException("合同必须关联所属项目且保留零金额。");
            var cannotEditOtherWorkspace = await client.PutAsJsonAsync(
                $"/api/contracts/personal/{contractId}", contractEdited);
            if (cannotEditOtherWorkspace.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("跨工作区直接修改合同应被拒绝。");
            using (var unauthenticated = new HttpClient { BaseAddress = new Uri(address) })
            {
                if ((await unauthenticated.GetAsync("/api/contracts/company"))
                        .StatusCode != HttpStatusCode.Unauthorized)
                    throw new IOException("无会话不得读取合同台账。");
            }
            var secondaryContract = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/contracts",
                contractInput with { Name = "待删除合同", Amount = "" });
            secondaryContract.EnsureSuccessStatusCode();
            long temporaryContract = (await secondaryContract.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            (await client.DeleteAsync($"/api/contracts/company/{temporaryContract}"))
                .EnsureSuccessStatusCode();
            if ((await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company"))?.Count != 1)
                throw new IOException("删除合同后不得在汇总台账继续显示。");
            // B05: business originals are scoped by their exact owning records.
            byte[] businessData=RandomNumberGenerator.GetBytes(1024*1024+23);
            var projectOriginal=await UploadBusinessFile(client,"company","project",
                projectId,businessData,"方案.pdf");
            var contractOriginal=await UploadBusinessFile(client,"company","contract",
                contractId,businessData,"合同原件.pdf");
            if(projectOriginal.Version!=1||contractOriginal.Version!=1)
                throw new IOException("业务附件首版本必须为 v1。");
            if(! (await client.GetByteArrayAsync(
                $"/api/business-files/company/download/{projectOriginal.Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("项目附件下载内容与原始数据不一致。");
            using(var otherWorkspace=new HttpClient{BaseAddress=new Uri(address)})
            {
                if((await otherWorkspace.GetAsync("/api/business-files/company"))
                    .StatusCode!=HttpStatusCode.Unauthorized)
                    throw new IOException("未登录不得读取业务附件列表。");
            }
            if((await client.GetAsync(
                $"/api/business-files/personal/download/{projectOriginal.Id}"))
                .StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("跨工作区不得下载原件。");
            using(var invalidUpload=new ByteArrayContent(businessData))
            using(var request=new HttpRequestMessage(HttpMethod.Post,
                "/api/business-files/company/project/999999999"){Content=invalidUpload})
            {
                request.Headers.Add("X-File-Name","not-owned.txt");
                if((await client.SendAsync(request)).StatusCode!=HttpStatusCode.NotFound)
                    throw new IOException("无主业务附件应拒绝写入。");
            }
            var clonedContract=await client.PostAsync(
                $"/api/contracts/company/{contractId}/copy",null);
            clonedContract.EnsureSuccessStatusCode();
            long clonedContractId=(await clonedContract.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var copiedFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(copiedFiles is null||!copiedFiles.Any(f=>f.Kind=="contract"&&
                f.OwnerId==clonedContractId&&f.Name=="合同原件.pdf"))
                throw new IOException("合同同项目复制必须携带关联原件。");
            (await client.DeleteAsync($"/api/contracts/company/{clonedContractId}"))
                .EnsureSuccessStatusCode();
            var copyProject = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/transfer",new ProjectTransfer("company", false));
            copyProject.EnsureSuccessStatusCode();
            long copiedProjectId = (await copyProject.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var projectsWithFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(projectsWithFiles is null||
                !projectsWithFiles.Any(f=>f.Kind=="project"&&f.OwnerId==copiedProjectId)||
                !projectsWithFiles.Any(f=>f.Kind=="contract"&&f.OwnerId!=contractId&&
                    f.OwnerId!=clonedContractId))
                throw new IOException("复制项目必须携带自身及子合同的原件。");
            var afterProjectCopy = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company");
            if (afterProjectCopy is null || afterProjectCopy.Count != 2 ||
                afterProjectCopy.Count(c => c.ProjectId == copiedProjectId) != 1 ||
                afterProjectCopy.Count(c => c.ProjectId == projectId) != 1)
                throw new IOException("复制项目未连同有效合同生成新的独立关联记录。");
            var moveProject = await client.PostAsJsonAsync(
                $"/api/projects/company/{copiedProjectId}/transfer",new ProjectTransfer("personal", true));
            moveProject.EnsureSuccessStatusCode();
            long movedProjectId = (await moveProject.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var movedFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/personal");
            if(movedFiles is null ||
                !movedFiles.Any(f=>f.Kind=="project"&&f.OwnerId==movedProjectId)||
                !movedFiles.Any(f=>f.Kind=="contract"))
                throw new IOException("项目转移时文件与子合同附件必须保留。");
            var movedContracts = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/personal");
            if (movedContracts is null || movedContracts.Count != 1 ||
                movedContracts[0].ProjectId != movedProjectId ||
                movedContracts[0].Workspace != "personal" ||
                movedContracts[0].Name != "合同已修改")
                throw new IOException("跨工作区转移项目时必须保留新项目下的合同关系。");
            var hiddenOldCopy = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company");
            if (hiddenOldCopy is null || hiddenOldCopy.Count != 1 ||
                hiddenOldCopy[0].ProjectId != projectId)
                throw new IOException("转移后源项目所属合同应从原工作区隐藏。");
            var inPersonal = await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/personal");
            if (inPersonal is null || inPersonal.Count != 1 ||
                inPersonal[0].Name != "项目已修改")
                throw new IOException("项目跨工作区转移失败。");
            (await client.DeleteAsync($"/api/projects/company/{projectId}")).EnsureSuccessStatusCode();
            var deletedProjects = await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/company");
            if (deletedProjects is null || deletedProjects.Count != 0)
                throw new IOException("项目软删除后不应继续在台账显示。");
            if ((await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company"))?.Count != 0)
                throw new IOException("原项目软删除后所属合同不得单独出现在汇总视图。");
            // IP register: seven fixed types, type-scoped statuses and persistence.
            var ipCreate = await client.PostAsJsonAsync("/api/ip/company",
                new {name="测试发明",ipType="发明专利",status="已申请",applicationNo="CN-2026-01"});
            ipCreate.EnsureSuccessStatusCode();
            long ipId=(await ipCreate.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var ipEdit = await client.PutAsJsonAsync($"/api/ip/company/{ipId}",
                new {name="已修改发明",ipType="发明专利",status="实质审查中",applicants="申请人甲"});
            ipEdit.EnsureSuccessStatusCode();
            var ipRows = await client.GetFromJsonAsync<List<IpView>>("/api/ip/company");
            if(ipRows is null || ipRows.Count!=1 || ipRows[0].Data.Name!="已修改发明" ||
                ipRows[0].Data.Applicants!="申请人甲")
                throw new IOException("知识产权创建或修改后未持久化。");
            var ipIllegal = await client.PostAsJsonAsync("/api/ip/company",
                new {name="无效状态",ipType="软件著作权",status="已授权"});
            if(ipIllegal.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("不同知识产权类型的状态必须分别校验。");
            var ipWrongWorkspace=await client.DeleteAsync($"/api/ip/personal/{ipId}");
            if(ipWrongWorkspace.StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("跨工作区删除知识产权必须拒绝。");
            var ipOriginal=await UploadBusinessFile(client,"company","ip",ipId,
                businessData,"专利申请书.pdf",category:"申请材料");
            var ipNextVersion=await UploadBusinessFile(client,"company","ip",ipId,
                businessData,"专利申请书.pdf",category:"申请材料");
            if(ipOriginal.Version!=1||ipNextVersion.Version!=2)
                throw new IOException("知识产权同名同类别附件应生成历史版本。");
            if((await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company"))?.Count(f=>f.Kind=="ip"&&f.OwnerId==ipId)!=2)
                throw new IOException("同名版本必须保留两份真实元数据。");
            var ipCopy=await client.PostAsJsonAsync(
                $"/api/ip/company/{ipId}/transfer",new IpTransfer("company",false));
            ipCopy.EnsureSuccessStatusCode();
            long copiedIp=(await ipCopy.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var ipMove=await client.PostAsJsonAsync(
                $"/api/ip/company/{copiedIp}/transfer",new IpTransfer("personal",true));
            ipMove.EnsureSuccessStatusCode();
            var personalIpFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/personal");
            if(personalIpFiles is null||personalIpFiles.Count(f=>f.Kind=="ip")!=2)
                throw new IOException("知识产权跨工作区转移必须携带全部附件版本。");
            if(! (await client.GetByteArrayAsync(
                $"/api/business-files/personal/download/{personalIpFiles.First(f=>f.Kind=="ip").Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("转移知识产权后的原件下载校验失败。");

            (await client.DeleteAsync($"/api/ip/company/{ipId}")).EnsureSuccessStatusCode();
            if((await client.GetFromJsonAsync<List<IpView>>("/api/ip/company"))?.Count!=0 ||
               (await client.GetFromJsonAsync<List<IpView>>("/api/ip/personal"))?.Count!=1)
                throw new IOException("知识产权删除、复制、转移结果不符合预期。");
            // B04 minimal archives: independent certificate scopes and the two
            // personal research-output views keep all records out of sample data.
            var companyCertificate = new ArchiveInput(
                "ISO体系证书", "企业资质", "公司测试证件", "测试");
            var certCreated = await client.PostAsJsonAsync(
                "/api/archives/company/certificate", companyCertificate);
            certCreated.EnsureSuccessStatusCode();
            long companyCertificateId = (await certCreated.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var certChange = companyCertificate with {Name="更新后的体系证书", Remarks="已修改"};
            (await client.PutAsJsonAsync(
                $"/api/archives/company/certificate/{companyCertificateId}",certChange))
                .EnsureSuccessStatusCode();
            var personalCertificate = await client.PostAsJsonAsync(
                "/api/archives/personal/certificate",
                new ArchiveInput("职称资格证书","职称资格","",""));
            personalCertificate.EnsureSuccessStatusCode();
            var allCompanyCerts=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate");
            var allPersonalCerts=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/certificate");
            if (allCompanyCerts?.Count!=1 ||
                allCompanyCerts[0].Name!="更新后的体系证书" ||
                allCompanyCerts[0].Remarks!="已修改" ||
                allPersonalCerts?.Count!=1 ||
                allPersonalCerts[0].Name!="职称资格证书")
                throw new IOException("公司和个人资质证件的独立 CRUD 失败。");
            var crossCertEdit=await client.PutAsJsonAsync(
                $"/api/archives/personal/certificate/{companyCertificateId}",certChange);
            if(crossCertEdit.StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("跨工作区或模块修改证件必须拒绝。");
            var badArchive=await client.PostAsJsonAsync("/api/archives/personal/academic",
                new ArchiveInput("  ","论文论著","",""));
            if(badArchive.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("极简资料名称必填限制未生效。");
            var invalidModule=await client.GetAsync("/api/archives/company/academic");
            if(invalidModule.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("公司工作区不得读取个人学术模块。");
            using(var noArchiveToken=new HttpClient{BaseAddress=new Uri(address)})
            {
                if((await noArchiveToken.GetAsync("/api/archives/personal/certificate"))
                    .StatusCode!=HttpStatusCode.Unauthorized)
                    throw new IOException("未授权不能读取归档资料。");
            }
            var certFile=await UploadBusinessFile(client,"company","archive",
                companyCertificateId,businessData,"企业证书.pdf",section:"certificate");
            var invalidMaterial=await client.GetAsync("/api/business-files/company");
            invalidMaterial.EnsureSuccessStatusCode();
            var certCopy=await client.PostAsJsonAsync(
                $"/api/archives/company/certificate/{companyCertificateId}/transfer",
                new ArchiveTransfer("company","certificate",false));
            certCopy.EnsureSuccessStatusCode();
            long duplicateCertId=(await certCopy.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var copiedCertFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(copiedCertFiles is null || !copiedCertFiles.Any(f=>f.Kind=="archive"&&
                f.OwnerId==duplicateCertId&&f.Section=="certificate"))
                throw new IOException("归档证件复制应携带附件关联。");
            var crossCertificate=await client.PostAsJsonAsync(
                $"/api/archives/company/certificate/{companyCertificateId}/transfer",
                new ArchiveTransfer("personal","certificate",true));
            if(crossCertificate.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("公司资质证件不得直接转型为个人证件。");
            (await client.DeleteAsync(
                $"/api/archives/company/certificate/{duplicateCertId}")).EnsureSuccessStatusCode();
            if((await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate"))?.Count!=1)
                throw new IOException("同工作区复制和软删除证书未按预期处理。");

            var personalAward=await client.PostAsJsonAsync(
                "/api/archives/personal/achievement",
                new ArchiveInput("矿山技术创新奖","个人奖励","获奖说明","奖项"));
            personalAward.EnsureSuccessStatusCode();
            var personalAcademic=await client.PostAsJsonAsync(
                "/api/archives/personal/academic",
                new ArchiveInput("学术任职证明","学术兼职","委员",""));
            personalAcademic.EnsureSuccessStatusCode();
            var companyOutput=await client.PostAsJsonAsync(
                "/api/archives/company/achievement",
                new ArchiveInput("企业科研成果","技术成果","研发表现",""));
            companyOutput.EnsureSuccessStatusCode();
            long companyOutputId=(await companyOutput.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var copyToPersonalAcademic=await client.PostAsJsonAsync(
                $"/api/archives/company/achievement/{companyOutputId}/transfer",
                new ArchiveTransfer("personal","academic",false));
            copyToPersonalAcademic.EnsureSuccessStatusCode();
            var sameCategoryMove=await client.PostAsJsonAsync(
                $"/api/archives/company/achievement/{companyOutputId}/transfer",
                new ArchiveTransfer("company","achievement",true));
            if(sameCategoryMove.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("同类别原地转移应该拒绝。");
            var moveToPersonalAward=await client.PostAsJsonAsync(
                $"/api/archives/company/achievement/{companyOutputId}/transfer",
                new ArchiveTransfer("personal","achievement",true));
            moveToPersonalAward.EnsureSuccessStatusCode();
            var companyAfterMove=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/achievement");
            var personalAwards=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/achievement");
            var personalAcademics=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/academic");
            if(companyAfterMove?.Count!=0 || personalAwards?.Count!=2 ||
                personalAcademics?.Count!=2 ||
                !personalAcademics.Any(a=>a.Name=="学术任职证明"&&a.Category=="学术兼职") ||
                !personalAcademics.Any(a=>a.Name=="企业科研成果"&&a.Category=="技术成果"))
                throw new IOException("科研成果跨工作区复制/转移或多条学术记录不正确。");
            // B05b: recover a removed attachment link without removing another
            // active reference to the same immutable bytes.
            var associateTarget=await client.PostAsJsonAsync("/api/archives/company/certificate",
                new ArchiveInput("原件引用目标证书","职称","",""));
            associateTarget.EnsureSuccessStatusCode();
            long associateTargetId=(await associateTarget.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var associateCopy=await client.PostAsJsonAsync(
                $"/api/business-files/company/{certFile.Id}/associate",
                new BusinessAssociateInput("archive",associateTargetId,"certificate",false));
            associateCopy.EnsureSuccessStatusCode();
            var linkedCopies=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            var associatedFile=linkedCopies?.SingleOrDefault(f=>f.Kind=="archive"&&
                f.OwnerId==associateTargetId);
            if(associatedFile is null||
               !(await client.GetByteArrayAsync($"/api/business-files/company/download/{associatedFile.Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("同工作区附件引用复制未能复用可下载原件。");
            (await client.DeleteAsync($"/api/business-files/company/{certFile.Id}")).EnsureSuccessStatusCode();
            var trashCompany=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
            if(trashCompany is null||!trashCompany.Any(r=>r.Kind=="file"&&r.Id==certFile.Id))
                throw new IOException("解除附件关联后回收站必须可找到原链接。");
            var restoredFile=await client.PostAsJsonAsync("/api/trash/company/restore",
                new RecycleRequest([new RecycleKey("file",certFile.Id,"")]));
            restoredFile.EnsureSuccessStatusCode();
            if(!(await client.GetByteArrayAsync($"/api/business-files/company/download/{certFile.Id}"))
                 .AsSpan().SequenceEqual(businessData))
                throw new IOException("回收站恢复后的附件 SHA-256 往返失败。");
            var moveTarget=await client.PostAsJsonAsync("/api/archives/company/certificate",
                new ArchiveInput("附件移动目标","证书","",""));
            moveTarget.EnsureSuccessStatusCode();
            long moveTargetId=(await moveTarget.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            (await client.PostAsJsonAsync($"/api/business-files/company/{certFile.Id}/associate",
                new BusinessAssociateInput("archive",moveTargetId,"certificate",true)))
                .EnsureSuccessStatusCode();
            var afterAssociateMove=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(afterAssociateMove is null||
                afterAssociateMove.Any(f=>f.Id==certFile.Id)||
                !afterAssociateMove.Any(f=>f.OwnerId==moveTargetId&&f.Name=="企业证书.pdf")||
                !afterAssociateMove.Any(f=>f.OwnerId==associateTargetId&&f.Name=="企业证书.pdf"))
                throw new IOException("移动附件时原关联必须隐藏，已共享的目标仍有效。");

            // Recovering a project restores its project-owned contracts and files.
            var recoveryProject=await client.PostAsJsonAsync("/api/projects/company",
                new ProjectInput("回收站项目","科研项目","","","","","","","","",""));
            recoveryProject.EnsureSuccessStatusCode();
            long recoveryProjectId=(await recoveryProject.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var recoveryContract=await client.PostAsJsonAsync(
                $"/api/projects/company/{recoveryProjectId}/contracts",
                new ContractInput("回收站合同","","","","","","",""));
            recoveryContract.EnsureSuccessStatusCode();
            long recoveryContractId=(await recoveryContract.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var recoveryAttachment=await UploadBusinessFile(client,"company","contract",
                recoveryContractId,businessData,"合同附件.pdf");
            (await client.DeleteAsync($"/api/projects/company/{recoveryProjectId}"))
                .EnsureSuccessStatusCode();
            var recycleBefore=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
            if(recycleBefore is null||!recycleBefore.Any(r=>r.Kind=="project"&&r.Id==recoveryProjectId)||
                recycleBefore.Any(r=>r.Kind=="contract"&&r.Id==recoveryContractId))
                throw new IOException("已删除项目应连同子合同归属进入回收站。");
            (await client.PostAsJsonAsync("/api/trash/company/restore",
                new RecycleRequest([new RecycleKey("project",recoveryProjectId,"")])))
                .EnsureSuccessStatusCode();
            if(!(await client.GetByteArrayAsync(
                $"/api/business-files/company/download/{recoveryAttachment.Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("恢复项目必须使所属合同原件重新可下载。");
            (await client.DeleteAsync($"/api/projects/company/{recoveryProjectId}"))
                .EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync("/api/trash/company/purge",
                new RecycleRequest([new RecycleKey("project",recoveryProjectId,"")])))
                .EnsureSuccessStatusCode();
            if((await client.GetAsync(
                $"/api/business-files/company/download/{recoveryAttachment.Id}"))
                .StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("永久删除项目及其合同后原附件不能继续访问。");
            // Purging another reference must not remove data shared by a valid owner.
            (await client.DeleteAsync($"/api/archives/company/certificate/{moveTargetId}"))
                .EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync("/api/trash/company/purge",
                new RecycleRequest([new RecycleKey("archive",moveTargetId,"certificate")])))
                .EnsureSuccessStatusCode();
            if(!(await client.GetByteArrayAsync(
                $"/api/business-files/company/download/{associatedFile.Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("永久删除一处引用不能删除仍被其它记录引用的原件。");
            (await client.DeleteAsync($"/api/archives/company/certificate/{associateTargetId}"))
                .EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync("/api/trash/company/purge",
                new RecycleRequest([new RecycleKey("archive",associateTargetId,"certificate")])))
                .EnsureSuccessStatusCode();
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
            // First persisted business edit: update a general-record title, preserving
            // its attachment and refusing unauthorized/cross-workspace updates.
            using var anonymous = new HttpClient { BaseAddress = new Uri(address) };
            var noTokenEdit = await anonymous.PutAsJsonAsync(
                $"/api/records/company/{id}", new TitleInput("匿名修改"));
            if (noTokenEdit.StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("未登录请求不得修改资料名称。");
            var wrongWorkspaceEdit = await client.PutAsJsonAsync(
                $"/api/records/personal/{id}", new TitleInput("越权修改"));
            if (wrongWorkspaceEdit.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("不得通过其它工作区修改资料。");
            var emptyEdit = await client.PutAsJsonAsync(
                $"/api/records/company/{id}", new TitleInput("   "));
            if (emptyEdit.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("资料名称不允许为空。");
            var oversizedEdit = await client.PutAsJsonAsync(
                $"/api/records/company/{id}", new TitleInput(new string('字', 301)));
            if (oversizedEdit.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("资料名称不得超过 300 字。");
            var unknownEdit = await client.PutAsJsonAsync(
                "/api/records/company/987654321", new TitleInput("不存在的记录"));
            if (unknownEdit.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("不存在的资料不能修改。");
            using var updated = await client.PutAsJsonAsync(
                $"/api/records/company/{id}", new TitleInput("  测试资料（已修改）  "));
            updated.EnsureSuccessStatusCode();
            var afterEdit = await client.GetFromJsonAsync<List<RecordView>>("/api/records/company");
            if (afterEdit is null || afterEdit.Count != 1 ||
                afterEdit[0].Title != "测试资料（已修改）" ||
                afterEdit[0].Files.Count != 1 || afterEdit[0].Files[0].Id != fileId)
                throw new IOException("修改名称后记录、工作区或原有附件发生异常。");
            var otherWorkspaceRows = await client.GetFromJsonAsync<List<RecordView>>("/api/records/personal");
            if (otherWorkspaceRows is null || otherWorkspaceRows.Count != 0)
                throw new IOException("修改记录后个人工作区发生数据泄漏。");
            var stillExported = await client.GetByteArrayAsync($"/api/files/company/{fileId}");
            if (!stillExported.AsSpan().SequenceEqual(data))
                throw new IOException("修改资料名称后附件原件内容发生变化。");
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
            if (!bodyText.Contains("测试资料（已修改）"))
                throw new IOException("恢复会话后没有读到已修改的记录。");
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
            var afterReopenFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/personal");
            if(afterReopenFiles is null||
                !afterReopenFiles.Any(f=>f.Kind=="project"&&f.OwnerId==movedProjectId)||
                afterReopenFiles.Count(f=>f.Kind=="ip")!=2)
                throw new IOException("重开资料库后业务原件元数据丢失。");
            var persistedIp = await client.GetFromJsonAsync<List<IpView>>("/api/ip/personal");
            if(persistedIp is null || persistedIp.Count!=1 ||
                persistedIp[0].Data.Name!="已修改发明" || persistedIp[0].Data.Status!="实质审查中")
                throw new IOException("重新打开加密库后知识产权转移数据丢失。");
            var persistedCompanyCertificates=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate");
            var persistedPersonalCertificates=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/certificate");
            var persistedAwards=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/achievement");
            var persistedAcademic=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/academic");
            if(persistedCompanyCertificates?.Count!=1 ||
                persistedPersonalCertificates?.Count!=1 ||
                persistedAwards?.Count!=2 || persistedAcademic?.Count!=2)
                throw new IOException("重新打开加密库后 B04 资料缺少或工作区不一致。");
            var restoredContracts = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/personal");
            if (restoredContracts is null || restoredContracts.Count != 1 ||
                restoredContracts[0].ProjectId != movedProjectId ||
                restoredContracts[0].Name != "合同已修改")
                throw new IOException("关闭重开数据库后合同项目关系未能持久化。");
            var recoveredProject = await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/personal");
            if (recoveredProject is null || recoveredProject.Count != 1 ||
                recoveredProject[0].ProjectStatus != "进行中")
                throw new IOException("关闭重开后项目转移结果未持久化。");
            var persisted = await client.GetFromJsonAsync<List<RecordView>>("/api/records/company");
            if (persisted is null || persisted.Count != 1 ||
                persisted[0].Title != "测试资料（已修改）" ||
                persisted[0].Files.Count != 1 || persisted[0].Files[0].Id != fileId)
                throw new IOException("数据库重新打开后修改的名称或附件未能持久化。");
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
