using Microsoft.AspNetCore.Http.Features;
using Microsoft.Data.Sqlite;

static class NativeFileChoiceEndpoints
{
    private static NativeFileMetadataInput Headers(HttpContext ctx)
    {
        string Header(string key)=>Uri.UnescapeDataString(ctx.Request.Headers[key].ToString());
        return new(Header("X-File-Name"),Header("X-File-Description"),
            Header("X-File-Tags"),Header("X-File-Number"),Header("X-File-Date"));
    }
    private static async Task<IResult> Locked(HttpContext ctx,Vault v,
        Func<CancellationToken,Task<IResult>> work,Func<string,int,IResult> fail)
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(!v.TryBeginFileTask(ctx,out var canceled))
            return fail("存在其他文件任务或程序正在退出。",409);
        try
        {
            using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                ctx.RequestAborted,canceled);
            if(!await v.Gate.WaitAsync(0))
                return fail("数据库忙，请完成当前操作后重试。",409);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try{return await work(linked.Token);}
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(KeyNotFoundException){return Results.NotFound();}
                catch(InvalidOperationException ex){return fail(ex.Message,409);}
                catch(OperationCanceledException){return fail("文件任务已取消。",409);}
                catch(SqliteException){return fail("文件关联或版本写入冲突，请检查目标文件夹是否已关联该文件。",409);}
                catch(IOException ex){return fail(ex.Message,409);}
            }
            finally{v.Gate.Release();}
        }
        finally{v.CompleteFileTask();}
    }
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        // Read-only recovery metadata for a tab that lost its upload dialog.
        // Always authenticate and serialize with the vault Gate: the ticket is
        // not a general-purpose file deletion or a cross-session capability.
        app.MapGet("/api/v2/files/pending",async(HttpContext ctx,Vault v)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)
                return fail("当前有文件任务，请完成后查看待确认上传。",409);
            if(!await v.Gate.WaitAsync(0))
                return fail("数据库忙，请稍后重试。",409);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)
                    return fail("当前有文件任务，请完成后查看待确认上传。",409);
                using var cmd=v.Db.CreateCommand();
                cmd.CommandText="SELECT COUNT(*) FROM file_objects WHERE state='writing';";
                long count=(long)cmd.ExecuteScalar()!;
                var pending=v.PendingFile;
                return Results.Json(new {
                    writingCount=count,
                    pending=pending is null?null:new {
                        pending.Ticket,pending.Workspace,
                        name=pending.Metadata.Name,
                        pending.Size,pending.ExpiresAt
                    }
                });
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/files/{workspace}/prepare",async(
            HttpContext ctx,Vault v,string workspace,long folderId)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return fail("无效工作区。",400);
            long? length=ctx.Request.ContentLength;
            if(length is null or <0 or >NativeFileStore.MaxFileLength)
                return fail("文件必须声明准确大小且不超过 8 GiB。",413);
            NativeFileMetadataInput input;
            string? note;
            string? category;
            try
            {
                input=Headers(ctx);
                note=Uri.UnescapeDataString(ctx.Request.Headers["X-Version-Note"].ToString());
                category=ctx.Request.Headers["X-Material-Category"].ToString();
                category=string.IsNullOrWhiteSpace(category)?null:Uri.UnescapeDataString(category);
            }
            catch(UriFormatException){return fail("文件属性编码无效。",400);}
            var max=ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if(max is {IsReadOnly:false})max.MaxRequestBodySize=NativeFileStore.MaxFileLength;
            return await Locked(ctx,v,async cancellation=>
            {
                if(v.PendingFile is { } previous)
                {
                    if(DateTimeOffset.UtcNow<previous.ExpiresAt)
                        return fail("已有待确认文件，请先选择保存方式或取消。",409);
                    NativeFileChoiceStore.Discard(v.Db,previous);
                    v.PendingFile=null;
                }
                long reserve=Math.Max(128L*1024*1024,length.Value/3);
                if(new DriveInfo(Path.GetPathRoot(v.Path)!).AvailableFreeSpace
                   <length.Value+reserve)
                    return fail("加密数据库磁盘空间不足。",507);
                var pending=await NativeFileChoiceStore.PrepareAsync(v.Db,
                    workspace,folderId,input,note,length.Value,ctx.Request.Body,cancellation,category);
                try
                {
                    var matches=NativeFileChoiceStore.Matches(v.Db,
                        workspace,pending.Size,pending.Sha256);
                    cancellation.ThrowIfCancellationRequested();
                    v.PendingFile=pending;
                    return Results.Json(new NativeFilePrepareResult(pending.Ticket,
                        pending.Metadata.Name!,pending.Size,pending.Sha256,
                        pending.ExpiresAt,matches));
                }
                catch
                {
                    NativeFileChoiceStore.Discard(v.Db,pending);
                    throw;
                }
            },fail);
        });

        app.MapPost("/api/v2/files/{workspace}/prepared/{ticket}/resolve",(
            HttpContext ctx,Vault v,string workspace,string ticket,NativeFileDecision choice)=>
            Locked(ctx,v,cancellation=>
            {
                var result=NativeFileChoiceStore.Resolve(v,workspace,ticket,
                    choice,cancellation);
                return Task.FromResult<IResult>(Results.Json(result));
            },fail));

        app.MapDelete("/api/v2/files/{workspace}/prepared/{ticket}",(
            HttpContext ctx,Vault v,string workspace,string ticket)=>
            Locked(ctx,v,cancellation=>
            {
                // Expiry prevents resolving a file, not explicitly discarding it.
                var pending=NativeFileChoiceStore.Require(v,workspace,ticket,allowExpired:true);
                cancellation.ThrowIfCancellationRequested();
                NativeFileChoiceStore.Discard(v.Db,pending);
                v.PendingFile=null;
                return Task.FromResult<IResult>(Results.Ok(new{canceled=true}));
            },fail));
    }
}
