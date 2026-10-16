using System.Xml;

// Fixed-template XLSX for native project folders and read-only contracts.
static class NativeProjectExcelEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapGet("/api/v2/excel/{workspace}/project/template",(
            HttpContext ctx,Vault v,string workspace)=>
            !v.Allowed(ctx)?Results.Unauthorized():
            !Vault.WorkspaceValid(workspace)?fail("工作区无效。",400):
            Results.File(ExcelLedger.Template("project"),ExcelLedger.ContentType,
                "project-template.xlsx"));

        app.MapPost("/api/v2/excel/{workspace}/{kind}/export",async(
            HttpContext ctx,Vault v,string workspace,string kind,ExcelExportInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace)||kind is not ("project" or "contract"))
                return fail("工作区或 Excel 模块无效。",400);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try{return Results.File(ExcelLedger.NativeProjectExport(v.Db,workspace,
                    kind,input.Mode,input.Ids),ExcelLedger.ContentType,kind+"-ledger.xlsx");}
                catch(InvalidDataException ex){return fail(ex.Message,400);}
                catch(ArgumentException ex){return fail(ex.Message,400);}
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/excel/{workspace}/project/import",async(
            HttpContext ctx,Vault v,string workspace,string? policy)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return fail("工作区无效。",400);
            if(v.FileTaskActive||v.ExitRequested)return fail("当前有文件任务或正在退出。",409);
            if(ctx.Request.ContentLength>ExcelLedger.MaxWorkbookBytes)
                return fail("Excel 文件不得超过 8 MiB。",413);
            using var input=new MemoryStream();
            var buffer=new byte[64*1024];int n;
            while((n=await ctx.Request.Body.ReadAsync(buffer,ctx.RequestAborted))>0)
            {
                if(input.Length+n>ExcelLedger.MaxWorkbookBytes)
                    return fail("Excel 文件不得超过 8 MiB。",413);
                input.Write(buffer,0,n);
            }
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
                try{return Results.Json(ExcelLedger.NativeProjectImport(v.Db,workspace,
                    policy??"",input.ToArray()));}
                catch(InvalidDataException ex){return fail(ex.Message,400);}
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(XmlException){return fail("Excel 文件 XML 不合法。",400);}
            }
            finally{v.Gate.Release();}
        });
    }
}
