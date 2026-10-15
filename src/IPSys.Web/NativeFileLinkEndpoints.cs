using Microsoft.Data.Sqlite;

// N3-02 native link endpoints; N3-01 File uploads continue to use one stable FileId.
static class NativeFileLinkEndpoints
{
    private static async Task<IResult> Write(HttpContext ctx,Vault v,string workspace,
        Func<SqliteConnection,IResult> operation,Func<string,int,IResult> fail)
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(!Vault.WorkspaceValid(workspace))return fail("无效工作区。",400);
        if(v.FileTaskActive||v.ExitRequested)
            return fail("文件任务或退出中不可修改文件关联。",409);
        await v.Gate.WaitAsync(ctx.RequestAborted);
        try
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)
                return fail("文件任务或退出中不可修改文件关联。",409);
            try{return operation(v.Db);}
            catch(ArgumentException ex){return fail(ex.Message,400);}
            catch(KeyNotFoundException){return Results.NotFound();}
            catch(InvalidOperationException ex){return fail(ex.Message,409);}
            catch(SqliteException ex){return fail("文件关联约束不允许此操作："+ex.SqliteErrorCode,409);}
        }
        finally{v.Gate.Release();}
    }
    private static async Task<IResult> Read(HttpContext ctx,Vault v,string workspace,
        Func<SqliteConnection,IResult> operation,Func<string,int,IResult> fail)
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(!Vault.WorkspaceValid(workspace))return fail("无效工作区。",400);
        await v.Gate.WaitAsync(ctx.RequestAborted);
        try
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            try{return operation(v.Db);}
            catch(ArgumentException ex){return fail(ex.Message,400);}
        }
        finally{v.Gate.Release();}
    }
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/files/{workspace}/{fileId:long}/links",(
            HttpContext ctx,Vault v,string workspace,long fileId,NativeFileLinkInput input)=>
            Write(ctx,v,workspace,db=>
            {
                var linkId=NativeFileLinkStore.Add(db,workspace,fileId,input);
                return Results.Json(new{id=linkId,fileId,folderId=input.FolderId});
            },fail));

        app.MapDelete("/api/v2/files/{workspace}/{fileId:long}/links/{linkId:long}",(
            HttpContext ctx,Vault v,string workspace,long fileId,long linkId)=>
            Write(ctx,v,workspace,db=>
                NativeFileLinkStore.Unlink(db,workspace,fileId,linkId)
                    ?Results.Ok(new{ok=true}):Results.NotFound(),fail));

        app.MapPost("/api/v2/files/{workspace}/{fileId:long}/links/{linkId:long}/restore",(
            HttpContext ctx,Vault v,string workspace,long fileId,long linkId)=>
            Write(ctx,v,workspace,db=>
                NativeFileLinkStore.Restore(db,workspace,fileId,linkId)
                    ?Results.Ok(new{ok=true}):Results.NotFound(),fail));

        app.MapGet("/api/v2/files/{workspace}/{fileId:long}/links",(
            HttpContext ctx,Vault v,string workspace,long fileId)=>
            Read(ctx,v,workspace,db=>
            {
                var links=NativeFileLinkStore.ListFile(db,workspace,fileId);
                return links is null?Results.NotFound():Results.Json(links);
            },fail));

        // includeDeleted makes a completely unlinked file recoverable via its
        // previous folder; ordinary folder/file views never show tombstones.
        app.MapGet("/api/v2/files/{workspace}/folders/{folderId:long}/links",(
            HttpContext ctx,Vault v,string workspace,long folderId,bool includeDeleted=false)=>
            Read(ctx,v,workspace,db=>
            {
                var links=NativeFileLinkStore.ListFolder(db,workspace,folderId,includeDeleted);
                return links is null?Results.NotFound():Results.Json(links);
            },fail));
    }
}
