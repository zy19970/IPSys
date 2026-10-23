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
var smoke = args.Contains("--smoke");
// One GUI/SQLCipher host per interactive Windows user session.
// Named EventWaitHandle lifetime is handle-based (safe across async continuations).
// --mcp exits above this guard: Agent bridge subprocesses remain unlimited.
using var hostInstance=new EventWaitHandle(false,EventResetMode.ManualReset,
    McpLocal.HostInstanceName,out bool firstHost);
if(!firstHost)
{
    const string duplicate="IPSys 已在当前 Windows 用户会话中运行。请使用现有窗口打开资料库；不要同时启动另一个宿主。";
    if(smoke)throw new InvalidOperationException(duplicate);
    System.Windows.Forms.MessageBox.Show(duplicate,"IPSys",
        System.Windows.Forms.MessageBoxButtons.OK,System.Windows.Forms.MessageBoxIcon.Information);
    return;
}
SQLitePCL.Batteries_V2.Init();
// HTML/CSS/JS are read from managed assembly resources (works in Debug or single-file Release).
byte[] html = EmbeddedWebAssets.Read("index.html");
byte[] favicon = EmbeddedWebAssets.Read("favicon.ico");
byte[] css = EmbeddedWebAssets.Read("style.css");
byte[] javascript = EmbeddedWebAssets.Read("app.js");
byte[] nativeIpScript = EmbeddedWebAssets.Read("ip-v2.js");
byte[] uploadProgressScript = EmbeddedWebAssets.Read("upload-progress.js");
byte[] exportScript = EmbeddedWebAssets.Read("export.js");
byte[] pdfScript = EmbeddedWebAssets.Read("pdf.min.js");
byte[] pdfWorker = EmbeddedWebAssets.Read("pdf.worker.min.js");
byte[] pdfPreviewScript = EmbeddedWebAssets.Read("pdf-preview.js");
byte[] pdfJsLicense = EmbeddedWebAssets.Read("pdfjs.LICENSE.txt");
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
        // style-src needs unsafe-inline: the explorer shell writes inline styles for
        // category icon plates, progress widths and dialog sizing. Trade-off accepted
        // for the shell swap; moving those to CSS classes is tracked as follow-up debt.
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "connect-src 'self'; worker-src 'self'; frame-src blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    await next();
});
// Serve web files from within the executable, not from wwwroot on disk.
app.MapGet("/", () => Results.Bytes(html, contentType: "text/html; charset=utf-8"));
app.MapGet("/index.html", () => Results.Bytes(html, contentType: "text/html; charset=utf-8"));
app.MapGet("/favicon.ico", () => Results.Bytes(favicon, contentType: "image/x-icon"));
app.MapGet("/style.css", () => Results.Bytes(css, contentType: "text/css; charset=utf-8"));
app.MapGet("/app.js", () => Results.Bytes(javascript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/ip-v2.js", () => Results.Bytes(nativeIpScript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/upload-progress.js", () => Results.Bytes(uploadProgressScript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/export.js", () => Results.Bytes(exportScript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/pdfjs/pdf.min.js", () => Results.Bytes(pdfScript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/pdfjs/pdf.worker.min.js", () => Results.Bytes(pdfWorker, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/pdf-preview.js", () => Results.Bytes(pdfPreviewScript, contentType: "text/javascript; charset=utf-8"));
app.MapGet("/pdfjs/LICENSE.txt", () => Results.Bytes(pdfJsLicense, contentType: "text/plain; charset=utf-8"));

SessionEndpoints.Map(app, Fail);

SearchLedgerEndpoints.Map(app, Fail);

// Only canonical V2 business HTTP routes are registered, including in --smoke.
NativeFolderEndpoints.Map(app, Fail);
NativeFileEndpoints.Map(app, Fail);
NativeFileLinkEndpoints.Map(app, Fail);
NativeMcpFileQuery.Map(app, Fail);
NativeFileAssociateEndpoints.Map(app, Fail);
NativeFileCopyEndpoints.Map(app, Fail);
NativeFileChoiceEndpoints.Map(app, Fail);
NativeIpFileEndpoints.Map(app, Fail);
NativeIpExcelEndpoints.Map(app, Fail);
NativeProjectExcelEndpoints.Map(app, Fail);
NativeArchiveGeneralExcelEndpoints.Map(app, Fail);
NativeIpUiEndpoints.Map(app, Fail);
NativeProjectContractUiEndpoints.Map(app, Fail);
NativeArchiveUiEndpoints.Map(app, Fail);
NativeArchiveUiOrderEndpoints.Map(app, Fail);
NativeArchiveActionsEndpoints.Map(app, Fail);
NativeGeneralTransferEndpoints.Map(app, Fail);
NativeIpTransferEndpoints.Map(app, Fail);
NativeProjectTransferEndpoints.Map(app, Fail);
NativeContractTransferEndpoints.Map(app, Fail);

RecycleEndpoints.Map(app);
VaultCompactEndpoints.Map(app);
VaultStorageEndpoints.Map(app);

SessionEndpoints.MapDiagnostics(app);

await app.StartAsync();
string address = app.Services.GetRequiredService<IServer>().Features
    .Get<IServerAddressesFeature>()!.Addresses.Single();
Console.WriteLine("IPSys 本地服务：" + address);
// Current-user-only local pipe; background lifecycle follows the web host.
Task mcpHost=McpLocal.RunHostAsync(app.Services.GetRequiredService<Vault>(),
    address,app.Lifetime.ApplicationStopping);
if (smoke)
{
    try
    {
        FolderModelSmoke.Run();
        ResourceSchemaV2Smoke.Run();
        NativeFileStoreSmoke.Run();
        RecyclePurgeSmoke.Run();
        VaultCompactSmoke.Run();
        NativeFileLinkStoreSmoke.Run();
        NativeFileCopyStoreSmoke.Run();
        NativeFileChoiceStoreSmoke.Run();
        await WebSmoke.Run(address,app.Services.GetRequiredService<Vault>());
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
