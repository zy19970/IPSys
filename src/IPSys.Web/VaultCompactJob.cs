// Database compaction is an exclusive Vault file task. Its status must remain
// readable while the SQLCipher connection Gate is held by VACUUM or reclaim.
// Mode distinguishes full VACUUM ("full") from in-place page reclaim ("reclaim");
// progress counters are only meaningful for reclaim, where pages are known.
record VaultCompactSnapshot(string TaskId,string State,string Stage,
    long BytesBefore,long BytesAfter,long ReusableBefore,string? Error,
    string Mode,long PagesDone,long PagesTotal);

sealed class VaultCompactJob
{
    private readonly object _sync=new();
    private readonly string _id=Guid.NewGuid().ToString("N");
    private string _state="queued",_stage="等待数据库锁",_mode="reclaim";
    private long _before,_after,_reusable,_done,_total;
    private string? _error;
    public VaultCompactSnapshot Snapshot()
    {
        lock(_sync)return new(_id,_state,_stage,_before,_after,_reusable,_error,
            _mode,_done,_total);
    }
    public void Begin(long before,long reusable,long totalPages,string mode)
    {
        lock(_sync)
        {
            _before=before;_reusable=reusable;_total=totalPages;_done=0;_mode=mode;
            _state="running";
            _stage=mode=="reclaim"?"回收前完整性检查":"压缩前完整性检查";
        }
    }
    // Pages are the only honest progress unit here: the reclaim loop knows how
    // many free pages it started with and re-reads the remainder after each batch.
    public void Progress(long done,long total,long bytesNow)
    {
        lock(_sync)
        {
            _done=done;_total=total;_after=bytesNow;_state="running";
            _stage=total>0?$"正在原地回收空闲页 {done}/{total}":"正在原地回收空闲页";
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
            _stage=_mode=="reclaim"
                ?"回收完成，SQLCipher 完整性校验通过"
                :"压缩完成，SQLCipher 完整性校验通过";
        }
    }
    // Cancellation is cooperative: batches already committed stay reclaimed, so the
    // counter is reported instead of being reset to zero.
    public void Cancel()
    {
        lock(_sync)
        {
            _state="canceled";
            _stage=_done>0
                ?$"回收已取消，已回收 {_done} 页（这部分空间已归还磁盘）"
                :"回收已取消，尚未开始搬移数据页";
            _error=null;
        }
    }
    public void Fail(string error,bool canceled=false)
    {
        lock(_sync)
        {
            _state=canceled?"canceled":"failed";
            _stage=canceled?"任务在开始前已取消":"数据库空间回收未完成，请检查资料库";
            _error=canceled?null:error;
        }
    }
}
