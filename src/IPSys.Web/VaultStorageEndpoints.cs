using Microsoft.Data.Sqlite;

record VaultStorageInfo(long TotalBytes,long UsedBytes,long FreeBytes,
    long PageCount,long FreePages,long PageSize);

// Whole-vault allocated SQLite pages, not per-workspace attachments or disk free.
static class VaultStorageEndpoints
{
    private static long Scalar(SqliteConnection db,string pragma)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText=pragma;
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    internal static VaultStorageInfo Inspect(SqliteConnection db)
    {
        long pages=Scalar(db,"PRAGMA page_count;");
        long free=Scalar(db,"PRAGMA freelist_count;");
        long size=Scalar(db,"PRAGMA page_size;");
        if(pages<=0||size<=0||free<0||free>pages)
            throw new IOException("数据库页面统计值无效。");
        long total=checked(pages*size);
        long freeBytes=checked(free*size);
        return new(total,checked(total-freeBytes),freeBytes,pages,free,size);
    }

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/vault/storage",async(HttpContext ctx,Vault v)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive)return Results.Conflict(new{error="文件任务进行中，请完成后刷新容量。"});
            // Do not queue UI display behind an upload/purge/VACUUM.
            bool entered=await v.Gate.WaitAsync(TimeSpan.FromMilliseconds(250),ctx.RequestAborted);
            if(!entered)return Results.Conflict(new{error="数据库忙，请稍后刷新容量。"});
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)
                    return Results.Conflict(new{error="数据库正在处理任务，请稍后刷新容量。"});
                try{return Results.Json(Inspect(v.Db));}
                catch(Exception ex){return Results.Problem("读取数据库页面统计失败："+ex.Message,statusCode:500);}
            }
            finally{v.Gate.Release();}
        });
    }
}
