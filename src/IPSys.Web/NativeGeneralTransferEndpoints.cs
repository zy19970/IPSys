using System.Text.Json;
using Microsoft.Data.Sqlite;

// A general record is a real V2 folder; its FileIds and all immutable
// FileVersions must accompany every copy/move in one SQLCipher transaction.
record NativeGeneralTransferInput(string TargetWorkspace,bool Move=false);
record NativeGeneralTransferResult(long SourceId,long Id,
    string SourceWorkspace,string TargetWorkspace,bool Moved,
    int Files,int Versions,int NewObjects);
static class NativeGeneralTransferEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ui/general/{workspace}/{id:long}/transfer",async(
            HttpContext ctx,Vault v,string workspace,long id,
            NativeGeneralTransferInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace) ||
               !Vault.WorkspaceValid(input.TargetWorkspace) || id<=0)
                return fail("工作区或资料编号无效。",400);
            if(input.Move&&workspace==input.TargetWorkspace)
                return fail("同一工作区不执行移动。",400);
            if(!v.TryBeginFileTask(ctx,out var aborted))
                return fail("存在其他文件任务或正在退出。",409);
            try
            {
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    ctx.RequestAborted,aborted);
                if(!await v.Gate.WaitAsync(0,linked.Token))
                    return fail("数据库忙，请稍后重试。",409);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    var source=NativeArchiveStore.Get(v.Db,ResourceRef.Create(
                        workspace,FolderKinds.ArchiveFolder,id,"general"));
                    if(source is null)return Results.NotFound();
                    try
                    {
                        var copied=await NativeFolderTreeTransfer.CopyAsync(
                            v.Db,v.Path,workspace,"general",id,
                            input.TargetWorkspace,"general",null,input.Move,
                            linked.Token);
                        return Results.Json(new NativeGeneralTransferResult(
                            id,copied.Id,workspace,input.TargetWorkspace,input.Move,
                            copied.Files,copied.Versions,copied.NewObjects));
                    }
                    catch(ArgumentException e){return fail(e.Message,400);}
                    catch(InvalidDataException e){return fail(e.Message,409);}
                    catch(InvalidOperationException e){return fail(e.Message,409);}
                    catch(IOException e){return fail(e.Message,409);}
                    catch(OverflowException){return fail("原件大小超限。",409);}
                    catch(SqliteException){return fail("复制事务失败，所有修改已回滚。",409);}
                }
                finally{v.Gate.Release();}
            }
            finally{v.CompleteFileTask();}
        });
    }
}
