using Microsoft.AspNetCore.Http.Features;
using Microsoft.Data.Sqlite;

// N3-01 native v2 File HTTP. Existing attachment/UI APIs remain unchanged until N2-03.
static class NativeFileEndpoints
{
    private static NativeFileMetadataInput FromHeaders(HttpContext ctx)
    {
        string Header(string key)=>Uri.UnescapeDataString(ctx.Request.Headers[key].ToString());
        return new(Header("X-File-Name"),Header("X-File-Description"),
            Header("X-File-Tags"),Header("X-File-Number"),Header("X-File-Date"));
    }
    internal static async Task<IResult> Upload(HttpContext ctx,Vault v,string workspace,
        long? folderId,long? fileId,Func<string,int,IResult> fail,
        long? requiredIpId=null,string? materialCategory=null)
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(!Vault.WorkspaceValid(workspace))return fail("无效工作区。",400);
        long? length=ctx.Request.ContentLength;
        if(length is null or <0 or >NativeFileStore.MaxFileLength)
            return fail("本阶段文件必须声明长度且不超过 64 MiB。",413);
        NativeFileMetadataInput input;
        string? note;
        try
        {
            input=FromHeaders(ctx);
            note=Uri.UnescapeDataString(ctx.Request.Headers["X-Version-Note"].ToString());
        }
        catch(UriFormatException){return fail("文件元数据编码无效。",400);}
        var limit=ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if(limit is {IsReadOnly:false})limit.MaxRequestBodySize=NativeFileStore.MaxFileLength;
        if(!v.TryBeginFileTask(ctx,out var cancel))
            return fail("已有文件任务或程序正在退出。",409);
        try
        {
            using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                ctx.RequestAborted,cancel);
            if(!await v.Gate.WaitAsync(0))
                return fail("数据库忙，请完成当前操作后再试。",409);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try
                {
                    // Typed V2 IP routes require the FileId to be actively
                    // linked to the exact requested IP, even if another folder
                    // still grants generic file access.
                    if(requiredIpId is long ip &&
                       (!NativeIpFileStore.IpActive(v.Db,workspace,ip) ||
                        folderId.HasValue && folderId.Value!=ip ||
                        fileId.HasValue && !NativeIpFileStore.Linked(v.Db,workspace,ip,fileId.Value)))
                        return Results.NotFound();
                    long reserve=Math.Max(128L*1024*1024,length.Value/3);
                    long free=new DriveInfo(Path.GetPathRoot(v.Path)!).AvailableFreeSpace;
                    if(free<length.Value+reserve)return fail("数据库所在磁盘剩余空间不足。",507);
                    var result=await NativeFileStore.UploadAsync(v.Db,workspace,
                        folderId,fileId,input,note,length.Value,
                        ctx.Request.Body,linked.Token,materialCategory);
                    return Results.Json(result);
                }
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(KeyNotFoundException){return Results.NotFound();}
                catch(OperationCanceledException){return fail("文件写入已取消。",409);}
                catch(SqliteException ex){return fail("数据库资源约束失败："+ex.SqliteErrorCode,409);}
                catch(IOException ex){return fail("原件写入失败："+ex.Message,409);}
            }
            finally{v.Gate.Release();}
        }
        finally{v.CompleteFileTask();}
    }

    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/files/{workspace}/upload",(
            HttpContext ctx,Vault v,string workspace,long? folderId)=>
            Upload(ctx,v,workspace,folderId,null,fail));

        app.MapPost("/api/v2/files/{workspace}/{fileId:long}/versions",(
            HttpContext ctx,Vault v,string workspace,long fileId)=>
            Upload(ctx,v,workspace,null,fileId,fail));

        app.MapGet("/api/v2/files/{workspace}/{id:long}",async(
            HttpContext ctx,Vault v,string workspace,long id)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try
                {
                    var file=NativeFileStore.Get(v.Db,workspace,id);
                    return file is null?Results.NotFound():Results.Json(file);
                }
                catch(ArgumentException ex){return fail(ex.Message,400);}
            }
            finally{v.Gate.Release();}
        });

        app.MapPut("/api/v2/files/{workspace}/{id:long}/metadata",async(
            HttpContext ctx,Vault v,string workspace,long id,NativeFileMetadataInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)
                return fail("文件任务或退出中不可修改文件属性。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)
                    return fail("文件任务或退出中不可修改文件属性。",409);
                try
                {
                    bool changed=NativeFileStore.UpdateMetadata(v.Db,workspace,id,input);
                    return changed?Results.Ok(new{ok=true}):Results.NotFound();
                }
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(SqliteException ex){return fail("数据库资源约束失败："+ex.SqliteErrorCode,409);}
            }
            finally{v.Gate.Release();}
        });

        app.MapGet("/api/v2/files/{workspace}/{id:long}/versions/{version:int}/download",
            async (HttpContext ctx,Vault v,string workspace,long id,int version)=>
        {
            if(!v.Allowed(ctx)){ctx.Response.StatusCode=401;return;}
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx)){ctx.Response.StatusCode=401;return;}
                var info=NativeFileStore.DownloadInfo(v.Db,workspace,id,version);
                if(info is null){ctx.Response.StatusCode=404;return;}
                ctx.Response.ContentType="application/octet-stream";
                ctx.Response.ContentLength=info.Value.Size;
                ctx.Response.Headers.ContentDisposition=
                    "attachment; filename*=UTF-8''"+Uri.EscapeDataString(info.Value.OriginalName);
                await NativeFileStore.CopyAsync(v.Db,workspace,info.Value.ObjectId,
                    ctx.Response.Body,ctx.RequestAborted);
            }
            finally{v.Gate.Release();}
        });
    }
}
