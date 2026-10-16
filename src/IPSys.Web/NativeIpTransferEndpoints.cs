using Microsoft.Data.Sqlite;

// Copy or move the entire IP evidence folder atomically, including every
// linked FileId and ALL currently effective historical versions.
static class NativeIpTransferEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ip/{workspace}/{ipId:long}/transfer",async(
            HttpContext ctx,Vault v,string workspace,long ipId,
            NativeIpTransferInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace)||
               !Vault.WorkspaceValid(input.TargetWorkspace))
                return fail("工作区无效。",400);
            if(!v.TryBeginFileTask(ctx,out var canceled))
                return fail("已有文件任务或退出流程。",409);
            try
            {
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    ctx.RequestAborted,canceled);
                if(!await v.Gate.WaitAsync(0,linked.Token))
                    return fail("数据库忙，请完成当前操作。",409);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    try
                    {
                        long required=NativeIpTransferStore.EstimatedBytes(
                            v.Db,workspace,ipId,input.TargetWorkspace);
                        if(required>0)
                        {
                            long reserve=Math.Max(128L*1024*1024,required/3);
                            long free=new DriveInfo(Path.GetPathRoot(v.Path)!)
                                .AvailableFreeSpace;
                            if(free<checked(required+reserve))
                                return fail("空间不足以复制全部知识产权历史原件。",507);
                        }
                        var result=await NativeIpTransferStore.TransferAsync(
                            v.Db,workspace,ipId,input,linked.Token);
                        return Results.Json(result);
                    }
                    catch(ArgumentException ex){return fail(ex.Message,400);}
                    catch(KeyNotFoundException){return Results.NotFound();}
                    catch(InvalidDataException ex){return fail(ex.Message,409);}
                    catch(InvalidOperationException ex){return fail(ex.Message,409);}
                    catch(SqliteException ex){return fail("事务不符合文件结构约束："+ex.SqliteErrorCode,409);}
                    catch(OverflowException){return fail("原件总大小超出安全计算范围。",409);}
                    catch(IOException ex){return fail(ex.Message,409);}
                    catch(OperationCanceledException){return fail("复制或移动已取消。",409);}
                }
                finally{v.Gate.Release();}
            }
            finally{v.CompleteFileTask();}
        });
    }
}
