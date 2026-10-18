// Database compaction is an exclusive Vault file task. Its status must remain
// readable while the SQLCipher connection Gate is held by VACUUM.
record VaultCompactSnapshot(string TaskId,string State,string Stage,
    long BytesBefore,long BytesAfter,long ReusableBefore,string? Error);

sealed class VaultCompactJob
{
    private readonly object _sync=new();
    private readonly string _id=Guid.NewGuid().ToString("N");
    private string _state="queued",_stage="等待数据库锁";
    private long _before,_after,_reusable;
    private string? _error;
    public VaultCompactSnapshot Snapshot()
    {
        lock(_sync)return new(_id,_state,_stage,_before,_after,_reusable,_error);
    }
    public void Begin(long before,long reusable)
    {
        lock(_sync)
        {
            _before=before;_reusable=reusable;
            _state="running";_stage="压缩前完整性检查";
        }
    }
    public void Stage(string stage)
    {
        lock(_sync){_stage=stage;_state="running";}
    }
    public void Finish(long bytes)
    {
        lock(_sync)
        {
            _after=bytes;_state="succeeded";
            _stage="压缩完成，SQLCipher 完整性校验通过";
        }
    }
    public void Fail(string error,bool canceled=false)
    {
        lock(_sync)
        {
            _state=canceled?"canceled":"failed";
            _stage=canceled?"任务在开始压缩前已取消":"数据库压缩未完成，请检查资料库";
            _error=canceled?null:error;
        }
    }
}
