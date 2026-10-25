using System.Xml;

// N2-04: reuse the fixed-layout XLSX contract against V2 archive/general
// Folder identities. Old Excel endpoints remain only for legacy smoke fixtures.
static class NativeArchiveGeneralExcelEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        foreach(string kind in new[]{"archive","general"})
        {
            app.MapGet($"/api/v2/excel/{{workspace}}/{kind}/template",(
                HttpContext ctx,Vault v,string workspace,string? section)=>
            {
                if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
                if(!Valid(workspace,kind,section))return fail("无效的资料分类或工作区。",400);
                return Results.File(ExcelLedger.Template(kind),
                    ExcelLedger.ContentType,kind+"-template.xlsx");
            });
            app.MapPost($"/api/v2/excel/{{workspace}}/{kind}/export",async(
                HttpContext ctx,Vault v,string workspace,string? section,ExcelExportInput input)=>
            {
                if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
                if(!Valid(workspace,kind,section))return fail("无效的资料分类或工作区。",400);
                await v.Gate.WaitAsync(ctx.RequestAborted);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    try
                    {
                        return Results.File(ExcelLedger.NativeArchiveGeneralExport(
                            v.Db,workspace,kind,section??"",input.Mode,
                            ExcelLedger.ExportIds(v.Db,workspace,kind,section??"",input)),
                            ExcelLedger.ContentType,kind+"-ledger.xlsx");
                    }
                    catch(ArgumentException ex){return fail(ex.Message,400);}
                    catch(InvalidDataException ex){return fail(ex.Message,400);}
                }
                finally{v.Gate.Release();}
            });
            app.MapPost($"/api/v2/excel/{{workspace}}/{kind}/import",async(
                HttpContext ctx,Vault v,string workspace,string? section,string? policy)=>
            {
                if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
                if(!Valid(workspace,kind,section))return fail("无效的资料分类或工作区。",400);
                if(v.FileTaskActive||v.ExitRequested)
                    return fail("文件任务或退出期间不可批量导入。",409);
                if(ctx.Request.ContentLength>ExcelLedger.MaxWorkbookBytes)
                    return fail("Excel 不得超过 8 MiB。",413);
                using var memory=new MemoryStream();
                var buffer=new byte[64*1024];int n;
                while((n=await ctx.Request.Body.ReadAsync(buffer,ctx.RequestAborted))>0)
                {
                    if(memory.Length+n>ExcelLedger.MaxWorkbookBytes)
                        return fail("Excel 不得超过 8 MiB。",413);
                    memory.Write(buffer,0,n);
                }
                await v.Gate.WaitAsync(ctx.RequestAborted);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    if(v.FileTaskActive||v.ExitRequested)
                        return fail("文件任务或退出期间不可批量导入。",409);
                    try
                    {
                        return Results.Json(ExcelLedger.NativeArchiveGeneralImport(
                            v.Db,workspace,kind,section??"",policy??"",
                            memory.ToArray()));
                    }
                    catch(InvalidDataException ex){return fail(ex.Message,400);}
                    catch(ArgumentException ex){return fail(ex.Message,400);}
                    catch(XmlException){return fail("Excel 文件 XML 无效。",400);}
                }
                finally{v.Gate.Release();}
            });
        }
    }
    private static bool Valid(string workspace,string kind,string? section)=>
        Vault.WorkspaceValid(workspace) &&
        (kind=="general"?string.IsNullOrEmpty(section):
          kind=="archive"&&ArchiveRules.Module(workspace,section??"")!=null);
}
