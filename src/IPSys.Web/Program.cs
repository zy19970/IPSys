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

SessionEndpoints.Map(app, Fail);

SearchLedgerEndpoints.Map(app, Fail);

GeneralRecordEndpoints.MapList(app, Fail);

IpEndpoints.Map(app, Fail);

ExcelEndpoints.Map(app, Fail);

ArchiveEndpoints.Map(app, Fail);

ProjectContractEndpoints.Map(app, Fail);
FolderBrowserEndpoints.Map(app, Fail);
FolderCommandEndpoints.Map(app, Fail);

GeneralRecordEndpoints.MapChanges(app, Fail);

BusinessFileEndpoints.Map(app);
RecycleEndpoints.Map(app);

SessionEndpoints.MapDiagnostics(app);

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
        FolderModelSmoke.Run();
        FolderProviderSmoke.Run();
        ArchiveFolderProviderSmoke.Run();
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
