// PRAGMA integrity_check has no trustworthy percent-complete API exposed by
// Microsoft.Data.Sqlite. Report real server stages and an indeterminate meter.
record VaultIntegritySnapshot(
    string TaskId,string State,string Stage,
    int CompletedSteps,int TotalSteps,string? Result,long Incomplete,string? Error);

sealed class VaultIntegrityJob
{
    private readonly object _sync=new();
    private readonly string _id=Guid.NewGuid().ToString("N");
    private string _state="queued",_stage="等待数据库锁";
    private int _step;
    private string? _result,_error;
    private long _incomplete;
    public VaultIntegritySnapshot Snapshot()
    {
        lock(_sync)
            return new(_id,_state,_stage,_step,2,_result,_incomplete,_error);
    }
    public void Running()
    {
        lock(_sync){_state="running";_stage="正在校验加密数据库页面";_step=0;}
    }
    public void PagesComplete(string result)
    {
        lock(_sync){_result=result;_step=1;_stage="正在统计未完成附件";}
    }
    public void Finish(long incomplete)
    {
        lock(_sync)
        {
            _incomplete=incomplete;_step=2;_state="succeeded";
            _stage="完整性检查完成";
        }
    }
    public void Fail(string error,bool canceled=false)
    {
        lock(_sync)
        {
            _state=canceled?"canceled":"failed";
            _stage=canceled?"检查任务已取消":"完整性检查失败";
            _error=canceled?null:error;
        }
    }
}

static class VaultIntegrityEndpoints
{
    private static IResult Fail(string message,int status=400)=>
        Results.Json(new {error=message},statusCode:status);

    public static void Map(WebApplication app)
    {
        // Status reads must NOT wait for Vault.Gate: integrity_check may run
        // for many minutes and the browser needs to keep showing live progress.
        app.MapGet("/api/vault/integrity/task",(HttpContext ctx,Vault vault)=>
        {
            if(!vault.Allowed(ctx))return (IResult)Results.Unauthorized();
            var task=vault.LastIntegrityCheck?.Snapshot();
            return task is null?Results.NotFound():Results.Json(task);
        });
        app.MapPost("/api/vault/integrity",(HttpContext ctx,Vault vault)=>
        {
            if(!vault.Allowed(ctx))return Results.Unauthorized();
            if(!vault.TryBeginFileTask(ctx,out var cancellation))
                return Fail("上传、删除、压缩或其他数据库任务正在执行，完成后再检查。",409);

            var job=new VaultIntegrityJob();
            vault.SetIntegrityCheck(job);
            _=Task.Run(async ()=>
            {
                bool entered=false;
                try
                {
                    await vault.Gate.WaitAsync(cancellation);
                    entered=true;
                    cancellation.ThrowIfCancellationRequested();
                    job.Running();
                    using var cmd=vault.Db.CreateCommand();
                    // Some large SQLCipher files take longer than the default
                    // 30s command timeout; do not report a fake timeout.
                    cmd.CommandTimeout=0;
                    cmd.CommandText="PRAGMA integrity_check;";
                    string result=Convert.ToString(cmd.ExecuteScalar())??"";
                    job.PagesComplete(result);
                    cancellation.ThrowIfCancellationRequested();
                    cmd.CommandText="SELECT count(*) FROM file_objects WHERE state='writing';";
                    long incomplete=Convert.ToInt64(cmd.ExecuteScalar());
                    job.Finish(incomplete);
                }
                catch(OperationCanceledException){job.Fail("",true);}
                catch(Exception ex){job.Fail(ex.Message);}
                finally
                {
                    if(entered)vault.Gate.Release();
                    vault.CompleteFileTask();
                }
            });
            return Results.Json(new {taskId=job.Snapshot().TaskId},statusCode:202);
        });
    }
}
