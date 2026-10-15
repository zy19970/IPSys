using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// N2-01: native v2 endpoints; keep existing UI attachment routes on the old path
// until the File service and business endpoints can switch together.
static class NativeFolderEndpoints
{
    public static void Map(WebApplication app, Func<string,int,IResult> fail)
    {
        IResult Bad(string text,int status=400)=>fail(text,status);

        app.MapGet("/api/v2/folders/{workspace}/{kind}",async (
            HttpContext ctx,Vault v,string workspace,string kind,long? projectId)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try {return Results.Json(NativeFolderStore.List(v.Db,workspace,kind,projectId));}
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(KeyNotFoundException){return Results.NotFound();}
            }
            finally{v.Gate.Release();}
        });

        app.MapGet("/api/v2/folders/{workspace}/{kind}/{id:long}",async (
            HttpContext ctx,Vault v,string workspace,string kind,long id)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try
                {
                    var result=NativeFolderStore.Get(v.Db,new ResourceRef(workspace,kind,id));
                    return result is null?Results.NotFound():Results.Json(result);
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/folders/{workspace}/{kind}",async (
            HttpContext ctx,Vault v,string workspace,string kind,FolderMutationInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
                try
                {
                    long id=NativeFolderStore.Create(v.Db,workspace,kind,input);
                    return Results.Json(new{id,reference=ResourceRef.Create(workspace,kind,id)});
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(KeyNotFoundException){return Results.NotFound();}
            }
            finally{v.Gate.Release();}
        });

        app.MapPut("/api/v2/folders/{workspace}/{kind}/{id:long}",async (
            HttpContext ctx,Vault v,string workspace,string kind,long id,FolderMutationInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
                try
                {
                    return NativeFolderStore.Update(v.Db,new ResourceRef(workspace,kind,id),input)
                        ? Results.Ok(new{ok=true}):Results.NotFound();
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
            }
            finally{v.Gate.Release();}
        });

        app.MapDelete("/api/v2/folders/{workspace}/{kind}/{id:long}",async (
            HttpContext ctx,Vault v,string workspace,string kind,long id)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
                try
                {
                    return NativeFolderStore.SetDeleted(v.Db,
                        new ResourceRef(workspace,kind,id),true)
                        ? Results.Ok(new{ok=true}):Results.NotFound();
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/folders/{workspace}/{kind}/{id:long}/restore",async (
            HttpContext ctx,Vault v,string workspace,string kind,long id)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
                try
                {
                    return NativeFolderStore.SetDeleted(v.Db,
                        new ResourceRef(workspace,kind,id),false)
                        ? Results.Ok(new{ok=true}):Results.NotFound();
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
            }
            finally{v.Gate.Release();}
        });
    }
}
