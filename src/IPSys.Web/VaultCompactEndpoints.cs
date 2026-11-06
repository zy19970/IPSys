using Microsoft.Data.Sqlite;

// Manual only. Two maintenance paths share one exclusive file task:
//   1. Reclaim  — in-place incremental_vacuum, for vaults built with
//                  auto_vacuum=INCREMENTAL. Needs one batch of rollback journal,
//                  not a second copy of the database.
//   2. Compact  — full VACUUM, kept as an emergency escape hatch. Still needs
//                  2x the database size, and is never reachable from the UI.
// Neither is ever called by delete/purge or automatically on open.
record VaultCompactInfo(long FileBytes,long PageCount,long FreePages,long PageSize,
    long ReusableBytes,long RequiredFreeBytes,long AvailableBytes,
    long TempAvailableBytes,bool CanCompact,string Mode,long FullVacuumRequiredBytes);

static class VaultCompactStore
{
    private const long Margin=128L*1024*1024;
    // One batch is 256 pages = 1 MiB at the project's 4 KiB page size. Measured
    // 3.3x faster than 4096-page batches, which inflate the rollback journal.
    internal const int ReclaimBatchPages=256;
    // Journal headroom for one batch, plus slack for SQLite's own scratch use.
    private const long ReclaimMargin=64L*1024*1024;

    private static long Scalar(SqliteConnection db,string sql)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText=sql;
        return Convert.ToInt64(cmd.ExecuteScalar());
    }
    private static long Space(string path)
    {
        string full=Path.GetFullPath(path);
        string root=Path.GetPathRoot(full) ??
            throw new IOException("无法识别数据库所在磁盘。");
        return new DriveInfo(root).AvailableFreeSpace;
    }
    public static VaultCompactInfo Inspect(SqliteConnection db,string path)
    {
        long fileBytes=new FileInfo(path).Length;
        long pages=Scalar(db,"PRAGMA page_count;");
        long free=Scalar(db,"PRAGMA freelist_count;");
        long pageSize=Scalar(db,"PRAGMA page_size;");
        bool incremental=Scalar(db,"PRAGMA auto_vacuum;")==2;
        long full=checked(fileBytes*2+Margin);
        // Demanding 2x here would block reclaim exactly when it matters most:
        // on a disk that is nearly full but still has room for one batch.
        long required=incremental
            ?checked(ReclaimBatchPages*pageSize+ReclaimMargin) : full;
        long disk=Space(path),temp=Space(Path.GetTempPath());
        // A full VACUUM builds an intermediate database, possibly in %TEMP%.
        bool can=incremental?disk>=required : disk>=required&&temp>=required;
        return new(fileBytes,pages,free,pageSize,checked(free*pageSize),
            required,disk,temp,can,incremental?"incremental":"none",full);
    }
    private static void RequireIntegrity(SqliteConnection db,string when)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandTimeout=0;
        cmd.CommandText="PRAGMA integrity_check;";
        if(!string.Equals(Convert.ToString(cmd.ExecuteScalar()),"ok",StringComparison.OrdinalIgnoreCase))
            throw new IOException(when+"数据库完整性检查未通过，已拒绝继续。");
    }
    private static void RequireNoPendingWrite(SqliteConnection db,string when)
    {
        if(Scalar(db,"SELECT COUNT(*) FROM file_objects WHERE state='writing';")!=0)
            throw new IOException(when+"仍有尚未完成的原件写入，禁止整理数据库。");
    }

    // In-place reclaim. No temporary database is created, so the only additional
    // space needed is the rollback journal for one batch.
    public static void Reclaim(SqliteConnection db,string path,
        VaultCompactJob job,CancellationToken cancellation)
    {
        var info=Inspect(db,path);
        if(info.Mode!="incremental")
            throw new IOException("此资料库创建于旧版本，不支持原地回收。请重建资料库后使用。");
        job.Begin(info.FileBytes,info.ReusableBytes,info.FreePages,"reclaim");
        if(!info.CanCompact)
            throw new IOException("磁盘可用空间不足，原地回收至少需要 "+
                info.RequiredFreeBytes+" 字节。");
        cancellation.ThrowIfCancellationRequested();
        RequireNoPendingWrite(db,"回收前");
        RequireIntegrity(db,"回收前");
        if(info.FreePages==0)
        {
            job.Finish(new FileInfo(path).Length);
            return;
        }
        using var cmd=db.CreateCommand();
        cmd.CommandTimeout=0; // never time out a batch halfway through
        long total=info.FreePages,remaining=total,done=0;
        while(remaining>0)
        {
            cancellation.ThrowIfCancellationRequested();
            cmd.CommandText=$"PRAGMA incremental_vacuum({ReclaimBatchPages});";
            cmd.ExecuteNonQuery();
            // Always re-read the real freelist; never infer it from the batch size.
            long now=Scalar(db,"PRAGMA freelist_count;");
            if(now>=remaining)
                throw new IOException($"原地回收无进展（已回收 {done} 页，仍剩 {now} 页），已停止。");
            done+=remaining-now;
            remaining=now;
            job.Progress(done,total,new FileInfo(path).Length);
        }
        RequireIntegrity(db,"回收后");
        RequireNoPendingWrite(db,"回收完成后");
        job.Finish(new FileInfo(path).Length);
    }

    // Full rebuild. Only reachable through full:true; kept because it is the only
    // way to reorganise a vault whose reclaim path ever misbehaves.
    public static void Compact(SqliteConnection db,string path,
        VaultCompactJob job,CancellationToken cancellation)
    {
        var info=Inspect(db,path);
        job.Begin(info.FileBytes,info.ReusableBytes,0,"full");
        if(info.AvailableBytes<info.FullVacuumRequiredBytes||
           info.TempAvailableBytes<info.FullVacuumRequiredBytes)
            throw new IOException("磁盘可用空间不足，安全压缩至少需要 "+
                info.FullVacuumRequiredBytes+" 字节。数据库所在磁盘和系统临时目录均须满足要求。");
        cancellation.ThrowIfCancellationRequested();
        RequireNoPendingWrite(db,"压缩前");
        RequireIntegrity(db,"压缩前");
        cancellation.ThrowIfCancellationRequested();
        job.Stage("正在重整加密数据页（不提供虚假的百分比）");
        // No transaction around VACUUM: SQLite manages its own atomic rebuild.
        // Once started, do not interrupt or replace the open database file.
        using var cmd=db.CreateCommand();
        cmd.CommandTimeout=0;
        cmd.CommandText="VACUUM;";
        cmd.ExecuteNonQuery();
        job.Stage("正在进行压缩后完整性校验");
        RequireIntegrity(db,"压缩后");
        RequireNoPendingWrite(db,"压缩完成后");
        job.Finish(new FileInfo(path).Length);
    }
}

static class VaultCompactEndpoints
{
    private static IResult Fail(string message,int status=400)=>
        Results.Json(new {error=message},statusCode:status);
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/vault/compact/info",async(HttpContext ctx,Vault v)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(v.FileTaskActive)return Fail("当前有文件任务，请完成后重试。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("当前数据库正在处理任务。",409);
                try{return Results.Json(VaultCompactStore.Inspect(v.Db,v.Path));}
                catch(Exception ex){return Fail("读取空间信息失败："+ex.Message,409);}
            }
            finally{v.Gate.Release();}
        });
        // Reads of the task state intentionally never enter the database Gate.
        app.MapGet("/api/vault/compact/task",(HttpContext ctx,Vault v)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            var status=v.LastVaultCompact?.Snapshot();
            return status is null?Results.NotFound():Results.Json(status);
        });
        // Cancellation is cooperative: the running loop stops between batches and
        // keeps whatever was already reclaimed.
        app.MapPost("/api/vault/compact/cancel",(HttpContext ctx,Vault v)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            return Results.Json(new {requested=v.CancelVaultCompact()});
        });
        app.MapPost("/api/vault/compact",(HttpContext ctx,Vault v,
            VaultCompactRequest request)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!request.Confirm)return Fail("请确认整理可能耗时并会短暂独占资料库。");
            if(!v.TryBeginFileTask(ctx,out var cancellation))
                return Fail("已有上传、删除或其他文件任务正在执行。",409);
            var job=new VaultCompactJob();
            v.SetVaultCompact(job);
            _=Task.Run(async()=>
            {
                bool entered=false;
                try
                {
                    await v.Gate.WaitAsync(cancellation);
                    entered=true;
                    if(request.Full)
                        VaultCompactStore.Compact(v.Db,v.Path,job,cancellation);
                    else
                        VaultCompactStore.Reclaim(v.Db,v.Path,job,cancellation);
                }
                catch(OperationCanceledException){job.Cancel();}
                catch(Exception ex){job.Fail(ex.Message);}
                finally
                {
                    if(entered)v.Gate.Release();
                    v.CompleteFileTask();
                }
            });
            return Results.Json(new {taskId=job.Snapshot().TaskId},statusCode:202);
        });
    }
}
record VaultCompactRequest(bool Confirm,bool Full=false);
