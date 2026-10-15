using Microsoft.Data.Sqlite;

// N2-03-02: typed IP archive endpoints over the shared V2 Folder/File system.
// FolderId is the real IP business identity. A link never owns content bytes.
record NativeIpAssociateInput(string? DisplayName=null,string? MaterialCategory=null);
static class NativeIpFileEndpoints
{
    private static readonly string[] Categories =
        ["申请材料","通知文件","证书文件","其他材料"];

    private static async Task<IResult> Read(HttpContext ctx,Vault v,string workspace,
        long ipId,Func<SqliteConnection,IResult> run)
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(!Vault.WorkspaceValid(workspace))return Results.BadRequest();
        await v.Gate.WaitAsync(ctx.RequestAborted);
        try
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!NativeIpFileStore.IpActive(v.Db,workspace,ipId))
                return Results.NotFound();
            return run(v.Db);
        }
        finally{v.Gate.Release();}
    }
    private static async Task<IResult> Write(HttpContext ctx,Vault v,string workspace,
        long ipId,Func<SqliteConnection,IResult> run,Func<string,int,IResult> fail)
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(!Vault.WorkspaceValid(workspace))return fail("工作区无效。",400);
        if(v.FileTaskActive||v.ExitRequested)
            return fail("文件任务或退出中不能修改归属。",409);
        await v.Gate.WaitAsync(ctx.RequestAborted);
        try
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)
                return fail("文件任务或退出中不能修改归属。",409);
            if(!NativeIpFileStore.IpActive(v.Db,workspace,ipId))
                return Results.NotFound();
            try{return run(v.Db);}
            catch(ArgumentException ex){return fail(ex.Message,400);}
            catch(KeyNotFoundException){return Results.NotFound();}
            catch(InvalidOperationException ex){return fail(ex.Message,409);}
            catch(SqliteException ex){return fail("原件关联约束拒绝："+ex.SqliteErrorCode,409);}
        }
        finally{v.Gate.Release();}
    }
    private static string Material(HttpContext ctx)
    {
        string x=Uri.UnescapeDataString(ctx.Request.Headers["X-Material-Category"].ToString());
        if(string.IsNullOrWhiteSpace(x))x="其他材料";
        if(!Categories.Contains(x,StringComparer.Ordinal))
            throw new ArgumentException("知识产权材料类别无效。");
        return x;
    }
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapGet("/api/v2/ip/{workspace}/{ipId:long}/files",(
            HttpContext ctx,Vault v,string workspace,long ipId,bool includeDeleted=false)=>
            Read(ctx,v,workspace,ipId,db=>
                Results.Json(NativeFileLinkStore.ListFolder(
                    db,workspace,ipId,includeDeleted))));

        app.MapPost("/api/v2/ip/{workspace}/{ipId:long}/files",(
            HttpContext ctx,Vault v,string workspace,long ipId)=>
        {
            string category;
            try{category=Material(ctx);}
            catch(ArgumentException ex){return Task.FromResult<IResult>(fail(ex.Message,400));}
            catch(UriFormatException){return Task.FromResult<IResult>(fail("材料类别编码无效。",400));}
            return NativeFileEndpoints.Upload(ctx,v,workspace,ipId,null,fail,
                requiredIpId:ipId,materialCategory:category);
        });

        app.MapGet("/api/v2/ip/{workspace}/{ipId:long}/files/{fileId:long}",(
            HttpContext ctx,Vault v,string workspace,long ipId,long fileId)=>
            Read(ctx,v,workspace,ipId,db=>
                !NativeIpFileStore.Linked(db,workspace,ipId,fileId)
                    ?Results.NotFound()
                    :NativeFileStore.Get(db,workspace,fileId) is { } file
                        ?Results.Json(file):Results.NotFound()));

        app.MapPost("/api/v2/ip/{workspace}/{ipId:long}/files/{fileId:long}/versions",(
            HttpContext ctx,Vault v,string workspace,long ipId,long fileId)=>
            NativeFileEndpoints.Upload(ctx,v,workspace,null,fileId,fail,
                requiredIpId:ipId));

        app.MapGet("/api/v2/ip/{workspace}/{ipId:long}/files/{fileId:long}/versions/{version:int}/download",
            async(HttpContext ctx,Vault v,string workspace,long ipId,long fileId,
                int version)=>
            {
                if(!v.Allowed(ctx)){ctx.Response.StatusCode=401;return;}
                if(!Vault.WorkspaceValid(workspace)){ctx.Response.StatusCode=400;return;}
                await v.Gate.WaitAsync(ctx.RequestAborted);
                try
                {
                    if(!v.Allowed(ctx)){ctx.Response.StatusCode=401;return;}
                    if(!NativeIpFileStore.Linked(v.Db,workspace,ipId,fileId))
                    {ctx.Response.StatusCode=404;return;}
                    var original=NativeFileStore.DownloadInfo(v.Db,workspace,fileId,version);
                    if(original is null){ctx.Response.StatusCode=404;return;}
                    ctx.Response.ContentType="application/octet-stream";
                    ctx.Response.ContentLength=original.Value.Size;
                    ctx.Response.Headers.ContentDisposition="attachment; filename*=UTF-8''"+
                        Uri.EscapeDataString(original.Value.OriginalName);
                    await NativeFileStore.CopyAsync(v.Db,workspace,original.Value.ObjectId,
                        ctx.Response.Body,ctx.RequestAborted);
                }
                finally{v.Gate.Release();}
            });

        app.MapPost("/api/v2/ip/{workspace}/{ipId:long}/files/{fileId:long}/associate",(
            HttpContext ctx,Vault v,string workspace,long ipId,long fileId,
            NativeIpAssociateInput input)=>
            Write(ctx,v,workspace,ipId,db=>
            {
                string category=string.IsNullOrEmpty(input.MaterialCategory)
                    ?"其他材料":input.MaterialCategory;
                if(!Categories.Contains(category,StringComparer.Ordinal))
                    return fail("知识产权材料类别无效。",400);
                long linkId=NativeFileLinkStore.Add(db,workspace,fileId,
                    new NativeFileLinkInput(ipId,input.DisplayName,category));
                return Results.Json(new{id=linkId,fileId,folderId=ipId});
            },fail));

        app.MapDelete("/api/v2/ip/{workspace}/{ipId:long}/files/{fileId:long}/links/{linkId:long}",(
            HttpContext ctx,Vault v,string workspace,long ipId,long fileId,long linkId)=>
            Write(ctx,v,workspace,ipId,db=>
                !NativeIpFileStore.OwnedLink(db,workspace,ipId,fileId,linkId)
                    ?Results.NotFound()
                    :NativeFileLinkStore.Unlink(db,workspace,fileId,linkId)
                        ?Results.Ok(new{ok=true}):Results.NotFound(),fail));

        app.MapPost("/api/v2/ip/{workspace}/{ipId:long}/files/{fileId:long}/links/{linkId:long}/restore",(
            HttpContext ctx,Vault v,string workspace,long ipId,long fileId,long linkId)=>
            Write(ctx,v,workspace,ipId,db=>
                !NativeIpFileStore.OwnedLink(db,workspace,ipId,fileId,linkId)
                    ?Results.NotFound()
                    :NativeFileLinkStore.Restore(db,workspace,fileId,linkId)
                        ?Results.Ok(new{ok=true}):Results.NotFound(),fail));
    }
}
