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

if(args.Contains("--mcp"))
{
    await McpLocal.RunStdioAsync();
    return;
}
SQLitePCL.Batteries_V2.Init();
var smoke = args.Contains("--smoke");
// HTML/CSS/JS are read from managed assembly resources (works in Debug or single-file Release).
byte[] html = EmbeddedWebAssets.Read("index.html");
byte[] css = EmbeddedWebAssets.Read("style.css");
byte[] javascript = EmbeddedWebAssets.Read("app.js");
byte[] exportScript = EmbeddedWebAssets.Read("export.js");
byte[] pdfScript = EmbeddedWebAssets.Read("pdf.min.js");
byte[] pdfWorker = EmbeddedWebAssets.Read("pdf.worker.min.js");
byte[] pdfPreviewScript = EmbeddedWebAssets.Read("pdf-preview.js");
byte[] pdfJsLicense = EmbeddedWebAssets.Read("pdfjs.LICENSE.txt");
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
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
        "connect-src 'self'; worker-src 'self'; frame-src blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    await next();
});
// Serve web files from within the executable, not from wwwroot on disk.
app.MapGet("/", () => Results.Bytes(html, contentType: "text/html; charset=utf-8"));
app.MapGet("/index.html", () => Results.Bytes(html, contentType: "text/html; charset=utf-8"));
app.MapGet("/style.css", () => Results.Bytes(css, contentType: "text/css; charset=utf-8"));
app.MapGet("/app.js", () => Results.Bytes(javascript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/export.js", () => Results.Bytes(exportScript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/pdfjs/pdf.min.js", () => Results.Bytes(pdfScript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/pdfjs/pdf.worker.min.js", () => Results.Bytes(pdfWorker, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/pdf-preview.js", () => Results.Bytes(pdfPreviewScript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/pdfjs/LICENSE.txt", () => Results.Bytes(pdfJsLicense, contentType: "text/plain; charset=utf-8"));
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

// MCP access is deliberately disabled for every new database session.
app.MapGet("/api/mcp", (HttpContext ctx,Vault v) =>
    !v.Allowed(ctx)?(IResult)Results.Unauthorized():Results.Json(new {enabled=v.McpEnabled}));
app.MapPost("/api/mcp", (HttpContext ctx,Vault v,McpAccessInput input) =>
{
    if(!v.Allowed(ctx))return Results.Unauthorized();
    return v.SetMcpEnabled(input.Enabled)
        ?Results.Json(new {enabled=v.McpEnabled})
        :Fail("当前数据库未打开，或正在进行文件任务/退出，无法切换 MCP。",409);
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
            ArchiveEntryOrderStore.Ensure(db);
            LedgerBatch.Ensure(db);
            BusinessFileStore.Ensure(db);
            GeneralStore.Ensure(db);
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

// P2 workspace-scoped SQLCipher search across real records and attachment metadata.
app.MapGet("/api/search/{workspace}",async (HttpContext ctx,Vault v,string workspace,string? q)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
    await v.Gate.WaitAsync(ctx.RequestAborted);
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        try{return Results.Json(SearchStore.Find(v.Db,workspace,q));}
        catch(InvalidDataException ex){return Fail(ex.Message);}
    }
    finally{v.Gate.Release();}
});

// Scoped row ordering and atomic soft delete for all non-certificate record ledgers.
app.MapGet("/api/ledger/{workspace}/order",async(HttpContext ctx,Vault v,string workspace)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        return Results.Json(LedgerBatch.Orders(v.Db,workspace));
    }
    finally{v.Gate.Release();}
});
app.MapPost("/api/ledger/{workspace}/{kind}/order",async(
    HttpContext ctx,Vault v,string workspace,string kind,LedgerIdsInput input)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可调整排序。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可调整排序。",409);
        return LedgerBatch.Reorder(v.Db,workspace,kind,input.Section??"",input.Ids)
            ?Results.Ok(new{ok=true}):Fail("资料列表已变化或模块无效，请刷新后重新排序。",409);
    }
    finally{v.Gate.Release();}
});
app.MapPost("/api/ledger/{workspace}/{kind}/batch-delete",async(
    HttpContext ctx,Vault v,string workspace,string kind,LedgerIdsInput input)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可删除资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可删除资料。",409);
        return LedgerBatch.SoftDelete(v.Db,workspace,kind,input.Section??"",input.Ids)
            ?Results.Ok(new{ok=true,count=input.Ids?.Length??0})
            :Fail("所选资料列表已变化或模块无效，请刷新后重新选择。",409);
    }
    finally{v.Gate.Release();}
});

GeneralRecordEndpoints.MapList(app, Fail);

IpEndpoints.Map(app, Fail);

ExcelEndpoints.Map(app, Fail);

ArchiveEndpoints.Map(app, Fail);

ProjectContractEndpoints.Map(app, Fail);

GeneralRecordEndpoints.MapChanges(app, Fail);

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

// Browser clients may inspect task state but must never stop the WinForms host.
// Only LauncherForm schedules application exit; /api/lock closes the database.
app.MapGet("/api/task", (HttpContext ctx, Vault v) =>
{
    if (!v.Allowed(ctx)) return (IResult)Results.Unauthorized();
    return Results.Json(new { active = v.FileTaskActive, exiting = v.ExitRequested });
});

await app.StartAsync();
string address = app.Services.GetRequiredService<IServer>().Features
    .Get<IServerAddressesFeature>()!.Addresses.Single();
Console.WriteLine("IPSys 网页验证版：" + address);
// Current-user-only local pipe; background lifecycle follows the web host.
Task mcpHost=McpLocal.RunHostAsync(app.Services.GetRequiredService<Vault>(),
    address,app.Lifetime.ApplicationStopping);
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
try{await mcpHost;}catch(OperationCanceledException){/* host has stopped */ }
await app.DisposeAsync();

static IResult Fail(string message, int status = 400) =>
    Results.Json(new { error = message }, statusCode: status);

record McpAccessInput(bool Enabled);
record ExcelExportInput(string Mode,long[]? Ids);
record CompanyCertificateOrderInput(long[]? Ids);
record CompanyCertificateBatchDeleteInput(long[]? Ids);
record OpenInput(string? Path, string? Password, bool Create);
record ResumeInput(string? Password);
record TitleInput(string? Title);
record FileView(long Id, string Name, long Size, string Sha256,int Version=1,string GroupId="");
record RecordView(long Id, string Title, List<FileView> Files);

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
