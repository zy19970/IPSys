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
            SELECT r.id,r.title,a.id,a.filename,a.size,a.sha256,a.version,a.group_id
            FROM records r LEFT JOIN attachments a
            ON r.id=a.record_id AND a.state='ready' AND a.deleted=0
            WHERE r.workspace=$w AND r.deleted=0 ORDER BY r.id DESC,a.id;
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
                    reader.GetInt64(4), reader.GetString(5),reader.GetInt32(6),reader.GetString(7)));
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

// P1 fixed Excel ledgers. Browser receives real XLSX files; never accepts
// arbitrary column mapping, formulas, contract import or file paths as records.
app.MapGet("/api/excel/{workspace}/{kind}/template", (HttpContext ctx,Vault v,string workspace,string kind,string? section) =>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace)||!ExcelLedger.ValidScope(workspace,kind,section)
        ||!ExcelLedger.SupportsImport(kind))return Fail("此模块不提供 Excel 模板或分类无效。");
    return Results.File(ExcelLedger.Template(kind),ExcelLedger.ContentType,kind+"-template.xlsx");
});
app.MapPost("/api/excel/{workspace}/{kind}/export",async (
    HttpContext ctx,Vault v,string workspace,string kind,string? section,ExcelExportInput input)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace)||!ExcelLedger.ValidScope(workspace,kind,section))
        return Fail("Excel 模块或工作区无效。");
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        try
        {
            byte[] bytes=ExcelLedger.Export(v.Db,workspace,kind,input.Mode,input.Ids,section??"");
            return Results.File(bytes,ExcelLedger.ContentType,kind+"-ledger.xlsx");
        }
        catch(InvalidDataException ex){return Fail(ex.Message);}
    }
    finally{v.Gate.Release();}
});
app.MapPost("/api/excel/{workspace}/{kind}/import",async (
    HttpContext ctx,Vault v,string workspace,string kind,string? policy,string? section)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace)||!ExcelLedger.ValidScope(workspace,kind,section))
        return Fail("Excel 模块或工作区无效。");
    if(!ExcelLedger.SupportsImport(kind))return Fail("合同仅支持导出，不能批量新建。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可批量导入。",409);
    if(ctx.Request.ContentLength>ExcelLedger.MaxWorkbookBytes)
        return Fail("Excel 文件不能超过 8 MiB。",413);
    using var buffer=new MemoryStream();
    await ctx.Request.Body.CopyToAsync(buffer);
    if(buffer.Length>ExcelLedger.MaxWorkbookBytes)
        return Fail("Excel 文件不能超过 8 MiB。",413);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可批量导入。",409);
        try{return Results.Json(ExcelLedger.Import(v.Db,workspace,kind,policy??"",buffer.ToArray(),section??""));}
        catch(InvalidDataException ex){return Fail(ex.Message);}
        catch(System.Xml.XmlException){return Fail("Excel 工作表 XML 无效。");}
    }
    finally{v.Gate.Release();}
});

// Hierarchical directories are limited to the company business archives. All
// operations reuse the existing unlocked SQLCipher session and the shared gate.
app.MapGet("/api/archive-folders",async(HttpContext ctx,Vault v)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        return Results.Json(ArchiveFolderStore.List(v.Db));
    }
    finally{v.Gate.Release();}
});
// Business archive folders and records can be interleaved in the same persisted list.
app.MapGet("/api/archive-entry-order",async(HttpContext ctx,Vault v)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        return Results.Json(ArchiveEntryOrderStore.Orders(v.Db));
    }
    finally{v.Gate.Release();}
});
app.MapPost("/api/archive-entry-order",async(HttpContext ctx,Vault v,ArchiveEntryReorder input)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整排序。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整排序。",409);
        return ArchiveEntryOrderStore.Reorder(v.Db,input)
            ?Results.Ok(new{ok=true}):Fail("当前目录内容已变化，请刷新后重新排序。",409);
    }
    finally{v.Gate.Release();}
});
app.MapPost("/api/archive-folders",async(HttpContext ctx,Vault v,ArchiveFolderInput input)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
        try{return Results.Json(new {id=ArchiveFolderStore.Create(v.Db,input)});}
        catch(InvalidOperationException ex){return Fail(ex.Message,409);}
    }
    finally{v.Gate.Release();}
});
app.MapPut("/api/archive-folders/{id:long}",async(HttpContext ctx,Vault v,long id,ArchiveFolderInput input)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
        try{return ArchiveFolderStore.Update(v.Db,id,input)
            ?Results.Ok(new {ok=true}):Results.NotFound();}
        catch(InvalidOperationException ex){return Fail(ex.Message,409);}
    }
    finally{v.Gate.Release();}
});
app.MapDelete("/api/archive-folders/{id:long}",async(HttpContext ctx,Vault v,long id)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
        try{return ArchiveFolderStore.DeleteEmpty(v.Db,id)
            ?Results.Ok(new {ok=true}):Results.NotFound();}
        catch(InvalidOperationException ex){return Fail(ex.Message,409);}
    }
    finally{v.Gate.Release();}
});
app.MapPost("/api/archive-folders/from-record/{id:long}",async(HttpContext ctx,Vault v,long id)=>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
        try{return Results.Json(new {id=ArchiveFolderStore.ExpandRecord(v.Db,id)});}
        catch(InvalidOperationException ex){return Fail(ex.Message,409);}
    }
    finally{v.Gate.Release();}
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
// Only company certificates expose manual list ordering; no other archive view is changed.
app.MapPost("/api/archives/company/certificate/order", async (
    HttpContext ctx,Vault v,CompanyCertificateOrderInput input) =>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可调整排序。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可调整排序。",409);
        return ArchiveStore.ReorderCompanyCertificates(v.Db,input.Ids)
            ?Results.Ok(new {ok=true}):Fail("资料列表已经变化，请刷新后重新调整顺序。",409);
    }
    finally{v.Gate.Release();}
});
// Selected company certificates are soft-deleted in one transaction.
app.MapPost("/api/archives/company/certificate/batch-delete", async (
    HttpContext ctx,Vault v,CompanyCertificateBatchDeleteInput input) =>
{
    if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
        return ArchiveStore.DeleteCompanyCertificates(v.Db,input.Ids)
            ?Results.Ok(new {ok=true,count=input.Ids?.Length??0})
            :Fail("所选资料已发生变化，请刷新列表后重新选择。",409);
    }
    finally{v.Gate.Release();}
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
        try{return Results.Json(new {id=ArchiveStore.Add(v.Db,workspace,section,input)});}
        catch(InvalidOperationException ex){return Fail(ex.Message,409);}
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
        try{return ArchiveStore.Update(v.Db,workspace,section,id,input)
            ? Results.Ok(new {ok=true}) : Results.NotFound();}
        catch(InvalidOperationException ex){return Fail(ex.Message,409);}
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

ProjectContractEndpoints.Map(app, Fail);

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
        cmd.CommandText = "UPDATE records SET title=$title WHERE id=$id AND workspace=$workspace AND deleted=0;";
        cmd.Parameters.AddWithValue("$title", input.Title.Trim());
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$workspace", workspace);
        if (cmd.ExecuteNonQuery() != 1) return Results.NotFound();
        return Results.Ok(new { ok = true });
    }
    catch (Exception e) { return Fail(e.Message, 500); }
    finally { v.Gate.Release(); }
});

// Legacy general records share the same authenticated soft-delete and trash policy.
app.MapDelete("/api/records/{workspace}/{id:long}",async(
    HttpContext ctx,Vault v,string workspace,long id)=>
{
    if(!v.Allowed(ctx))return Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务执行中，不可删除。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务执行中，不可删除。",409);
        using var cmd=v.Db.CreateCommand();
        cmd.CommandText="UPDATE records SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;";
        cmd.Parameters.AddWithValue("$id",id);
        cmd.Parameters.AddWithValue("$w",workspace);
        return cmd.ExecuteNonQuery()==1?Results.Ok(new{ok=true}):Results.NotFound();
    }
    finally{v.Gate.Release();}
});

app.MapPost("/api/records/{workspace}/{id:long}/files", async (HttpContext ctx, Vault v, string workspace, long id) =>
{
    if (!v.Allowed(ctx)) return Results.Unauthorized();
    if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
    long? length = ctx.Request.ContentLength;
    const long limit = 64L * 1024 * 1024; // Intentionally small for first web prototype.
    if (length is null or < 0 or > limit) return Fail("测试版仅支持已知大小、最多 64 MiB 的单文件。", 413);
    string name = Uri.UnescapeDataString(ctx.Request.Headers["X-File-Name"].ToString());
    if(BusinessFileStore.CheckName(name) is string badName)return Fail(badName);
    string mode=ctx.Request.Headers["X-Upload-Mode"].ToString();
    if(mode=="")mode="update";
    string requestedGroup=ctx.Request.Headers["X-File-Group"].ToString();
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
            exists.CommandText = "SELECT count(*) FROM records WHERE id=$id AND workspace=$w AND deleted=0;";
            exists.Parameters.AddWithValue("$id", id);
            exists.Parameters.AddWithValue("$w", workspace);
            if ((long)exists.ExecuteScalar()! != 1L) return Results.NotFound();
        }
        long reserve = Math.Max(128L * 1024 * 1024, length.Value / 3);
        long free = new DriveInfo(Path.GetPathRoot(v.Path)!).AvailableFreeSpace;
        if (free < length + reserve) return Fail("数据库所在磁盘剩余空间不足。", 507);
        var choice=GeneralStore.ChooseVersion(v.Db,workspace,id,name,mode,requestedGroup);
        long fileId;
        using (var insert = v.Db.CreateCommand())
        {
            insert.CommandText = """
                INSERT INTO attachments(record_id,filename,expected_size,state,version,group_id)
                VALUES($r,$n,$size,'writing',$version,$group); SELECT last_insert_rowid();
                """;
            insert.Parameters.AddWithValue("$r", id);
            insert.Parameters.AddWithValue("$n", name);
            insert.Parameters.AddWithValue("$size", length.Value);
            insert.Parameters.AddWithValue("$version",choice.Version);
            insert.Parameters.AddWithValue("$group",choice.Group);
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
            return Results.Json(new { id = fileId, size, sha256 = digest,version=choice.Version,groupId=choice.Group });
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
                WHERE a.id=$id AND a.state='ready' AND a.deleted=0 AND r.deleted=0 AND r.workspace=$w;
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
            WHERE a.id=$id AND a.state='ready' AND a.deleted=0 AND r.deleted=0 AND r.workspace=$w ORDER BY c.idx;
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

app.MapDelete("/api/files/{workspace}/{id:long}",async(
    HttpContext ctx,Vault v,string workspace,long id)=>
{
    if(!v.Allowed(ctx))return Results.Unauthorized();
    if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
    if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务执行中，不可删除原件。",409);
    await v.Gate.WaitAsync();
    try
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务执行中，不可删除原件。",409);
        using var cmd=v.Db.CreateCommand();
        cmd.CommandText="""
            UPDATE attachments SET deleted=1 WHERE id=$id AND deleted=0
            AND state='ready' AND EXISTS(SELECT 1 FROM records r
              WHERE r.id=record_id AND r.workspace=$w AND r.deleted=0);
            """;
        cmd.Parameters.AddWithValue("$id",id);
        cmd.Parameters.AddWithValue("$w",workspace);
        return cmd.ExecuteNonQuery()==1?Results.Ok(new{ok=true}):Results.NotFound();
    }
    finally{v.Gate.Release();}
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
