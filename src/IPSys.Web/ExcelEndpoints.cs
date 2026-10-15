using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// R0-03: original fixed Excel ledger endpoints, unchanged request and response behavior.
static class ExcelEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        IResult Fail(string message,int status=400)=>fail(message,status);
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
    }
}
