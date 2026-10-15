using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// R0-03: existing workspace-scoped unified search and ledger ordering endpoints.
static class SearchLedgerEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        IResult Fail(string message,int status=400)=>fail(message,status);
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
    }
}
