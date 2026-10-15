using Microsoft.Data.Sqlite;

static class NativeFileCopyEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/files/{workspace}/{fileId:long}/copy",
            async (HttpContext ctx,Vault v,string workspace,long fileId,
                NativeFileCopyInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace) ||
               !Vault.WorkspaceValid(input.TargetWorkspace))
                return fail("无效工作区。",400);
            if(input.Mode is not ("reuse-content" or "independent-content") ||
               (workspace!=input.TargetWorkspace && input.Mode=="reuse-content"))
                return fail("跨工作区复制必须使用独立物理原件。",400);
            if(!v.TryBeginFileTask(ctx,out var canceled))
                return fail("已有文件任务或程序正在退出。",409);
            try
            {
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    ctx.RequestAborted,canceled);
                if(!await v.Gate.WaitAsync(0))
                    return fail("数据库忙，请完成当前操作后再试。",409);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    try
                    {
                        if(input.Mode=="independent-content")
                        {
                            long required=NativeFileCopyStore.EstimateIndependentBytes(
                                v.Db,workspace,fileId);
                            long reserve=Math.Max(128L*1024*1024,required/3);
                            long free=new DriveInfo(Path.GetPathRoot(v.Path)!)
                                .AvailableFreeSpace;
                            if(free<required+reserve)
                                return fail("数据库空间不足以独立复制所有原件版本。",507);
                        }
                        var result=await NativeFileCopyStore.CopyAsync(v.Db,
                            workspace,fileId,input,linked.Token);
                        return Results.Json(result);
                    }
                    catch(ArgumentException ex){return fail(ex.Message,400);}
                    catch(KeyNotFoundException){return Results.NotFound();}
                    catch(OperationCanceledException){return fail("复制已取消。",409);}
                    catch(SqliteException ex){return fail("数据库约束拒绝复制："+ex.SqliteErrorCode,409);}
                    catch(IOException ex){return fail(ex.Message,409);}
                }
                finally{v.Gate.Release();}
            }
            finally{v.CompleteFileTask();}
        });
    }
}
