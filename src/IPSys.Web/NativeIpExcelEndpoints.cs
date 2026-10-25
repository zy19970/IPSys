using System.Xml;

// N2-03-03: V2 IP Excel uses exactly the legacy fixed-column XLSX contract,
// but the rows and identities come exclusively from native folders.
static class NativeIpExcelEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapGet("/api/v2/excel/{workspace}/ip/template",(
            HttpContext ctx,Vault v,string workspace)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return fail("无效工作区。",400);
            return Results.File(ExcelLedger.Template("ip"),ExcelLedger.ContentType,
                "ip-template.xlsx");
        });

        app.MapPost("/api/v2/excel/{workspace}/ip/export",async(
            HttpContext ctx,Vault v,string workspace,ExcelExportInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return fail("无效工作区。",400);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try
                {
                    var bytes=ExcelLedger.NativeIpExport(v.Db,workspace,input.Mode,
                        ExcelLedger.ExportIds(v.Db,workspace,"ip","",input));
                    return Results.File(bytes,ExcelLedger.ContentType,"ip-ledger.xlsx");
                }
                catch(InvalidDataException ex){return fail(ex.Message,400);}
                catch(ArgumentException ex){return fail(ex.Message,400);}
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/excel/{workspace}/ip/import",async(
            HttpContext ctx,Vault v,string workspace,string? policy)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return fail("无效工作区。",400);
            if(v.FileTaskActive||v.ExitRequested)
                return fail("文件任务或退出期间不可批量导入。",409);
            if(ctx.Request.ContentLength>ExcelLedger.MaxWorkbookBytes)
                return fail("Excel 文件不能超过 8 MiB。",413);
            using var memory=new MemoryStream();
            // Bound the actual body even when HTTP omits Content-Length.
            var bytes=new byte[64*1024];
            int read;
            while((read=await ctx.Request.Body.ReadAsync(bytes,ctx.RequestAborted))>0)
            {
                if(memory.Length+read>ExcelLedger.MaxWorkbookBytes)
                    return fail("Excel 文件不能超过 8 MiB。",413);
                memory.Write(bytes,0,read);
            }
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)
                    return fail("文件任务或退出期间不可批量导入。",409);
                try
                {
                    return Results.Json(ExcelLedger.NativeIpImport(v.Db,workspace,
                        policy??"",memory.ToArray()));
                }
                catch(InvalidDataException ex){return fail(ex.Message,400);}
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(XmlException){return fail("Excel 工作表 XML 无效。",400);}
            }
            finally{v.Gate.Release();}
        });
    }
}
