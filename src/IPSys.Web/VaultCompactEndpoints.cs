using Microsoft.Data.Sqlite;

// Manual only. VACUUM rebuilds the current encrypted SQLCipher database with
// its existing key. It is never called by delete/purge or automatically on open.
record VaultCompactInfo(long FileBytes,long PageCount,long FreePages,long PageSize,
    long ReusableBytes,long RequiredFreeBytes,long AvailableBytes,
    long TempAvailableBytes,bool CanCompact);

static class VaultCompactStore
{
    private const long Margin=128L*1024*1024;
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
        // Conservative: SQLite may need an intermediate database plus rollback
        // journaling. Check both target and temp volumes even if they differ.
        long required=checked(fileBytes*2+Margin);
        long disk=Space(path),temp=Space(Path.GetTempPath());
        return new(fileBytes,pages,free,pageSize,checked(free*pageSize),
            required,disk,temp,disk>=required&&temp>=required);
    }
    public static void Compact(SqliteConnection db,string path,
        VaultCompactJob job,CancellationToken cancellation)
    {
        var info=Inspect(db,path);
        job.Begin(info.FileBytes,info.ReusableBytes);
        if(!info.CanCompact)
            throw new IOException("磁盘可用空间不足，安全压缩至少需要 "+
                info.RequiredFreeBytes+" 字节。数据库所在磁盘和系统临时目录均须满足要求。");
        cancellation.ThrowIfCancellationRequested();
        if(Scalar(db,"SELECT COUNT(*) FROM file_objects WHERE state='writing';")!=0)
            throw new IOException("仍有尚未完成的原件写入，禁止压缩。");
        using var cmd=db.CreateCommand();
        cmd.CommandTimeout=0; // potentially tens of GiB; never time out midway
        cmd.CommandText="PRAGMA integrity_check;";
        if(!string.Equals(Convert.ToString(cmd.ExecuteScalar()),"ok",StringComparison.OrdinalIgnoreCase))
            throw new IOException("压缩前数据库完整性检查未通过，已拒绝压缩。");
        cancellation.ThrowIfCancellationRequested();
        job.Stage("正在重整加密数据页（不提供虚假的百分比）");
        // No transaction around VACUUM: SQLite manages its own atomic rebuild.
        // Once started, do not interrupt or replace the open database file.
        cmd.CommandText="VACUUM;";
        cmd.ExecuteNonQuery();
        job.Stage("正在进行压缩后完整性校验");
        cmd.CommandText="PRAGMA integrity_check;";
        if(!string.Equals(Convert.ToString(cmd.ExecuteScalar()),"ok",StringComparison.OrdinalIgnoreCase))
            throw new IOException("压缩后数据库完整性检查未通过，请停止写入并核查备份。");
        cmd.CommandText="SELECT COUNT(*) FROM file_objects WHERE state='writing';";
        if(Convert.ToInt64(cmd.ExecuteScalar())!=0)
            throw new IOException("压缩完成后出现未完成原件，请检查数据库。");
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
                catch(Exception ex){return Fail("读取压缩空间信息失败："+ex.Message,409);}
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
        app.MapPost("/api/vault/compact",(HttpContext ctx,Vault v,
            VaultCompactRequest request)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!request.Confirm)return Fail("请确认压缩可能耗时并需要额外磁盘空间。");
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
                    VaultCompactStore.Compact(v.Db,v.Path,job,cancellation);
                }
                catch(OperationCanceledException){job.Fail("",true);}
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
record VaultCompactRequest(bool Confirm);
