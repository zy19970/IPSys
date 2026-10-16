using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// The unified production and smoke search endpoint uses V2 IDs exclusively.
static class SearchLedgerEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapGet("/api/v2/search/{workspace}",async (
            HttpContext ctx,Vault v,string workspace,string? q)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return fail("无效工作区。",400);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try{return Results.Json(SearchStore.Find(v.Db,workspace,q));}
                catch(InvalidDataException ex){return fail(ex.Message,400);}
            }
            finally{v.Gate.Release();}
        });
    }
}
