// Progress lives with the opened Vault, not the browser request. The GET poll
// never waits for the SQLCipher Gate held by the deletion transaction.
record RecyclePurgeSnapshot(string TaskId,string Workspace,string State,string Stage,
    long BytesDone,long BytesTotal,int Count,string? Error);

sealed class RecyclePurgeJob(string workspace,int count)
{
    private readonly object _sync=new();
    private readonly string _id=Guid.NewGuid().ToString("N");
    private string _state="queued",_stage="等待数据库执行";
    private long _done,_total;
    private string? _error;

    public RecyclePurgeSnapshot Snapshot()
    {
        lock(_sync)return new(_id,workspace,_state,_stage,_done,_total,count,_error);
    }
    public void Report(long done,long total,string stage)
    {
        lock(_sync)
        {
            _done=Math.Max(0,done);
            _total=Math.Max(0,total);
            _stage=stage;
            _state=stage=="数据清理已执行，正在提交事务"?"committing":"running";
        }
    }
    public void Finish()
    {
        lock(_sync){_state="succeeded";_stage="已提交数据库事务，永久删除成功";}
    }
    public void Fail(string message,bool canceled)
    {
        lock(_sync)
        {
            _state=canceled?"canceled":"failed";
            _stage=canceled?"删除已取消，数据库已回滚":"永久删除失败，数据库已回滚";
            _error=canceled?null:message;
        }
    }
}
