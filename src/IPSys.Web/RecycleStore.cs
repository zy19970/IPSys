using Microsoft.Data.Sqlite;

record RecycleItem(string Kind,long Id,string Name,string Section,string? Parent);
record RecycleKey(string Kind,long Id,string Section);
record RecycleRequest(List<RecycleKey>? Items);

// Recycle is based exclusively on V2 FolderId and LinkId.
static class RecycleStore
{
    private static List<RecycleItem> Simple(SqliteConnection db,string workspace,
        string sql,string kind)
    {
        var rows=new List<RecycleItem>();
        using var cmd=db.CreateCommand();
        cmd.CommandText=sql;
        cmd.Parameters.AddWithValue("$w",workspace);
        using var reader=cmd.ExecuteReader();
        while(reader.Read())
            rows.Add(new RecycleItem(kind,reader.GetInt64(0),reader.GetString(1),
                reader.IsDBNull(2)?"":reader.GetString(2),
                reader.FieldCount<4||reader.IsDBNull(3)?null:reader.GetString(3)));
        return rows;
    }
    public static List<RecycleItem> List(SqliteConnection db,string workspace)
    {
        var rows=new List<RecycleItem>();
        rows.AddRange(Simple(db,workspace,"""
            SELECT id,name,'' FROM folders
            WHERE workspace=$w AND kind='project' AND deleted=1 ORDER BY id DESC;
            ""","project"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT id,name,'' FROM folders
            WHERE workspace=$w AND kind='general' AND deleted=1 ORDER BY id DESC;
            ""","v2_general"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT id,name,'' FROM folders
            WHERE workspace=$w AND kind='ip' AND deleted=1 ORDER BY id DESC;
            ""","ip"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT a.id,a.name,a.section FROM folders a
            WHERE a.workspace=$w AND a.kind='archive' AND a.deleted=1
              AND (a.parent_id IS NULL OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=a.parent_id
                  AND p.workspace=a.workspace AND p.deleted=0))
            ORDER BY a.id DESC;
            ""","v2_archive"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT c.id,c.name,'',p.name FROM folders c
            JOIN folders p ON p.id=c.parent_id AND p.workspace=c.workspace
            WHERE c.workspace=$w AND c.kind='contract' AND c.deleted=1
              AND p.kind='project' AND p.deleted=0 ORDER BY c.id DESC;
            ""","contract"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT l.id,COALESCE(l.display_name,f.name),'',p.name
            FROM folder_file_links l JOIN folders p ON p.id=l.folder_id
              AND p.workspace=l.workspace
            JOIN files f ON f.id=l.file_id AND f.workspace=l.workspace
            WHERE l.workspace=$w AND l.deleted=1 AND p.kind='ip'
              AND p.deleted=0 AND f.deleted=0 ORDER BY l.id DESC;
            ""","v2_ip_file"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT l.id,COALESCE(l.display_name,f.name),'',p.name
            FROM folder_file_links l JOIN folders p ON p.id=l.folder_id
              AND p.workspace=l.workspace
            JOIN files f ON f.id=l.file_id AND f.workspace=l.workspace
            WHERE l.workspace=$w AND l.deleted=1
              AND p.kind IN ('project','contract','archive','general')
              AND p.deleted=0 AND f.deleted=0
              AND (p.parent_id IS NULL OR EXISTS(
                SELECT 1 FROM folders parent WHERE parent.id=p.parent_id
                  AND parent.workspace=p.workspace AND parent.deleted=0))
            ORDER BY l.id DESC;
            ""","v2_file"));
        return rows;
    }
    private static bool Deleted(SqliteConnection db,string workspace,RecycleKey item)
    {
        if(item.Id<=0)return false;
        if(item.Kind!="v2_archive" && item.Section.Length!=0)return false;
        using var cmd=db.CreateCommand();
        cmd.Parameters.AddWithValue("$id",item.Id);
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$section",item.Section);
        switch(item.Kind)
        {
            case "project":
            case "ip":
            case "v2_general":
                cmd.CommandText="SELECT COUNT(*) FROM folders WHERE id=$id AND workspace=$w AND kind=$kind AND deleted=1;";
                cmd.Parameters.AddWithValue("$kind",item.Kind=="v2_general"?"general":item.Kind);
                break;
            case "contract":
                cmd.CommandText="""
                    SELECT COUNT(*) FROM folders c JOIN folders p ON p.id=c.parent_id
                    AND p.workspace=c.workspace WHERE c.id=$id AND c.workspace=$w
                    AND c.kind='contract' AND c.deleted=1
                    AND p.kind='project' AND p.deleted=0;
                    """;
                break;
            case "v2_archive":
                cmd.CommandText="""
                    SELECT COUNT(*) FROM folders a WHERE a.id=$id AND a.workspace=$w
                    AND a.kind='archive' AND a.section=$section AND a.deleted=1
                    AND (a.parent_id IS NULL OR EXISTS(
                        SELECT 1 FROM folders p WHERE p.id=a.parent_id
                          AND p.workspace=a.workspace AND p.deleted=0));
                    """;
                break;
            case "v2_ip_file":
            case "v2_file":
                cmd.CommandText="""
                    SELECT COUNT(*) FROM folder_file_links l
                    JOIN folders p ON p.id=l.folder_id AND p.workspace=l.workspace
                    JOIN files f ON f.id=l.file_id AND f.workspace=l.workspace
                    WHERE l.id=$id AND l.workspace=$w AND l.deleted=1
                      AND p.deleted=0 AND f.deleted=0
                      AND ((p.kind='ip' AND $kind='v2_ip_file')
                        OR (p.kind IN ('project','contract','archive','general')
                            AND $kind='v2_file'))
                      AND (p.parent_id IS NULL OR EXISTS(
                        SELECT 1 FROM folders parent WHERE parent.id=p.parent_id
                          AND parent.workspace=p.workspace AND parent.deleted=0));
                    """;
                cmd.Parameters.AddWithValue("$kind",item.Kind);
                break;
            default:return false;
        }
        return (long)cmd.ExecuteScalar()! == 1;
    }
    private static void Apply(SqliteConnection db,SqliteTransaction tx,string workspace,
        RecycleKey item,bool purge)
    {
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$id",item.Id);
        cmd.Parameters.AddWithValue("$section",item.Section);
        string sql= item.Kind switch
        {
            "project" or "contract" or "ip" or "v2_general" or "v2_archive" =>
                purge
                ? "DELETE FROM folders WHERE id=$id AND workspace=$w AND deleted=1;"
                : "UPDATE folders SET deleted=0 WHERE id=$id AND workspace=$w AND deleted=1;",
            "v2_file" or "v2_ip_file" =>
                purge
                ? "DELETE FROM folder_file_links WHERE id=$id AND workspace=$w AND deleted=1;"
                : "UPDATE folder_file_links SET deleted=0 WHERE id=$id AND workspace=$w AND deleted=1;",
            _ => throw new ArgumentException("无效回收站记录类型。")
        };
        cmd.CommandText=sql;
        if(cmd.ExecuteNonQuery()!=1)throw new InvalidOperationException("回收站记录已变化。");
    }
    private static SqliteCommand InTransaction(SqliteConnection db,SqliteTransaction tx,
        string workspace,string sql,long id)
    {
        var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText=sql;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$id",id);
        return cmd;
    }
    private static long Count(SqliteConnection db,SqliteTransaction tx,
        string workspace,string sql,long id)
    {
        using var cmd=InTransaction(db,tx,workspace,sql,id);
        return (long)cmd.ExecuteScalar()!;
    }
    // Snapshot candidate objects before the transaction. This is only a
    // display denominator: the actual deleted bytes come from chunk records.
    // The caller serializes DB access with Vault.Gate for the full operation.
    private static long PlannedReclaimBytes(SqliteConnection db,string workspace,
        IReadOnlyList<RecycleKey> items)
    {
        var selected=items.Where(x=>x.Kind is "v2_file" or "v2_ip_file")
            .Select(x=>x.Id).ToHashSet();
        var candidateFiles=new HashSet<long>();
        foreach(long linkId in selected)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="SELECT file_id FROM folder_file_links WHERE workspace=$w AND id=$id;";
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$id",linkId);
            if(cmd.ExecuteScalar() is long file)candidateFiles.Add(file);
        }
        var unlinkedFiles=new HashSet<long>();
        foreach(long file in candidateFiles)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="SELECT id FROM folder_file_links WHERE workspace=$w AND file_id=$id;";
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$id",file);
            var links=new List<long>();
            using(var reader=cmd.ExecuteReader())
                while(reader.Read())links.Add(reader.GetInt64(0));
            if(links.All(selected.Contains))unlinkedFiles.Add(file);
        }
        var objects=new HashSet<long>();
        foreach(long file in unlinkedFiles)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="SELECT object_id FROM file_versions WHERE workspace=$w AND file_id=$id;";
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$id",file);
            using var reader=cmd.ExecuteReader();
            while(reader.Read())objects.Add(reader.GetInt64(0));
        }
        long total=0;
        foreach(long obj in objects)
        {
            using var references=db.CreateCommand();
            references.CommandText="SELECT file_id FROM file_versions WHERE workspace=$w AND object_id=$id;";
            references.Parameters.AddWithValue("$w",workspace);
            references.Parameters.AddWithValue("$id",obj);
            var files=new List<long>();
            using(var reader=references.ExecuteReader())
                while(reader.Read())files.Add(reader.GetInt64(0));
            if(!files.All(unlinkedFiles.Contains))continue;
            using var size=db.CreateCommand();
            size.CommandText="SELECT size FROM file_objects WHERE workspace=$w AND id=$id;";
            size.Parameters.AddWithValue("$w",workspace);
            size.Parameters.AddWithValue("$id",obj);
            total=checked(total+Convert.ToInt64(size.ExecuteScalar()));
        }
        return total;
    }
    private static void DeleteChunksWithProgress(SqliteConnection db,SqliteTransaction tx,
        string workspace,long objectId,long total,ref long removed,
        Action<long,long,string> report,CancellationToken cancellation)
    {
        // 32 MiB for standard 1 MiB chunks; never delete a multi-GiB BLOB in
        // one opaque SQL statement. Rollback protects every batch until commit.
        while(true)
        {
            cancellation.ThrowIfCancellationRequested();
            using var pick=InTransaction(db,tx,workspace,"""
                SELECT idx,length(bytes) FROM file_chunks
                WHERE workspace=$w AND object_id=$id ORDER BY idx LIMIT 32;
                """,objectId);
            int count=0,last=-1;long bytes=0;
            using(var rd=pick.ExecuteReader())
                while(rd.Read())
                {
                    count++;last=rd.GetInt32(0);bytes+=rd.GetInt64(1);
                }
            if(count==0)break;
            using var delete=InTransaction(db,tx,workspace,"""
                DELETE FROM file_chunks WHERE workspace=$w AND object_id=$id
                  AND idx<=$last;
                """,objectId);
            delete.Parameters.AddWithValue("$last",last);
            if(delete.ExecuteNonQuery()!=count)
                throw new IOException("加密原件清理计数不一致，已回滚事务。");
            removed=checked(removed+bytes);
            report(removed,total,"正在清理加密原件数据块");
        }
    }
    // The only irreversible path for original bytes: first remove the exact
    // tombstoned LinkId, then delete a FileId only when ZERO links remain,
    // including links in other folders and tombstones still restorable there.
    private static void PurgeFileLink(SqliteConnection db,SqliteTransaction tx,
        string workspace,RecycleKey item,long total,ref long removed,
        Action<long,long,string>? report,CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        long fileId=Count(db,tx,workspace,
            "SELECT file_id FROM folder_file_links WHERE id=$id AND workspace=$w AND deleted=1;",
            item.Id);
        Apply(db,tx,workspace,item,true);
        if(Count(db,tx,workspace,
            "SELECT COUNT(*) FROM folder_file_links WHERE workspace=$w AND file_id=$id;",
            fileId)!=0)return;

        var objectIds=new List<long>();
        using(var versions=InTransaction(db,tx,workspace,
            "SELECT DISTINCT object_id FROM file_versions WHERE workspace=$w AND file_id=$id;",
            fileId))
        using(var reader=versions.ExecuteReader())
            while(reader.Read())objectIds.Add(reader.GetInt64(0));

        using(var versions=InTransaction(db,tx,workspace,
            "DELETE FROM file_versions WHERE workspace=$w AND file_id=$id;",fileId))
            versions.ExecuteNonQuery();
        using(var file=InTransaction(db,tx,workspace,
            "DELETE FROM files WHERE workspace=$w AND id=$id;",fileId))
        {
            if(file.ExecuteNonQuery()!=1)
                throw new InvalidOperationException("待清理的原件身份已变化。");
        }
        foreach(long objectId in objectIds)
        {
            // An independent FileId or any historical version can reference the
            // same immutable object; only truly orphaned content may be removed.
            if(Count(db,tx,workspace,
                "SELECT COUNT(*) FROM file_versions WHERE workspace=$w AND object_id=$id;",
                objectId)!=0)continue;
            if(report is null)
            {
                using var chunks=InTransaction(db,tx,workspace,
                    "DELETE FROM file_chunks WHERE workspace=$w AND object_id=$id;",objectId);
                chunks.ExecuteNonQuery();
            }
            else DeleteChunksWithProgress(db,tx,workspace,objectId,total,
                ref removed,report,cancellation);
            using(var obj=InTransaction(db,tx,workspace,
                "DELETE FROM file_objects WHERE workspace=$w AND id=$id AND state='ready';",
                objectId))
            {
                if(obj.ExecuteNonQuery()!=1)
                    throw new InvalidOperationException("物理原件清理状态已变化。");
            }
        }
    }
    public static bool Change(SqliteConnection db,string workspace,
        IReadOnlyList<RecycleKey> items,bool purge,
        Action<long,long,string>? report=null,CancellationToken cancellation=default)
    {
        if(items.Count is <1 or >200 || items.Distinct().Count()!=items.Count)return false;
        if(items.Any(x=>!Deleted(db,workspace,x)))return false;
        if(purge)
        {
            foreach(var item in items)
            {
                if(item.Kind is "v2_file" or "v2_ip_file")continue;
                using var cmd=db.CreateCommand();
                cmd.CommandText=item.Kind=="project"?"""
                    SELECT (SELECT COUNT(*) FROM folders WHERE workspace=$w
                      AND kind='contract' AND parent_id=$id) +
                      (SELECT COUNT(*) FROM folder_file_links WHERE workspace=$w
                      AND (folder_id=$id OR folder_id IN
                        (SELECT id FROM folders WHERE workspace=$w AND kind='contract'
                        AND parent_id=$id)));
                    """:"""
                    SELECT COUNT(*) FROM folder_file_links
                    WHERE workspace=$w AND folder_id=$id;
                    """;
                cmd.Parameters.AddWithValue("$w",workspace);
                cmd.Parameters.AddWithValue("$id",item.Id);
                if((long)cmd.ExecuteScalar()!>0)
                    throw new InvalidOperationException("记录仍有关联目录或文件历史，禁止永久删除。");
            }
        }
        cancellation.ThrowIfCancellationRequested();
        long total=purge && report!=null?PlannedReclaimBytes(db,workspace,items):0;
        long removed=0;
        report?.Invoke(0,total,"正在处理回收站关联");
        using var tx=db.BeginTransaction();
        if(purge)
        {
            // Purge selected tombstoned links first. A single FileId may occur
            // in multiple selected folders; its bytes are reclaimed only last.
            foreach(var item in items.Where(x=>x.Kind is "v2_file" or "v2_ip_file"))
                PurgeFileLink(db,tx,workspace,item,total,ref removed,report,cancellation);
            foreach(var item in items.Where(x=>x.Kind is not ("v2_file" or "v2_ip_file")))
                Apply(db,tx,workspace,item,true);
        }
        else foreach(var item in items)Apply(db,tx,workspace,item,false);
        cancellation.ThrowIfCancellationRequested();
        report?.Invoke(removed,total,"数据清理已执行，正在提交事务");
        tx.Commit();
        return true;
    }
}

static class RecycleEndpoints
{
    private static IResult Fail(string message,int status=400)=>
        Results.Json(new {error=message},statusCode:status);
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/trash/{workspace}/purge-task",(HttpContext ctx,Vault v,string workspace)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            var state=v.LastRecyclePurge?.Snapshot();
            return state is null || state.Workspace!=workspace
                ?Results.NotFound():Results.Json(state);
        });
        app.MapPost("/api/trash/{workspace}/purge-task",(
            HttpContext ctx,Vault v,string workspace,RecycleRequest request)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            if(request.Items is null || request.Items.Count is <1 or >200 ||
               request.Items.Distinct().Count()!=request.Items.Count)
                return Fail("请选择 1 至 200 条不重复的回收站记录。");
            if(!v.TryBeginFileTask(ctx,out var cancellation))
                return Fail("已有文件任务正在执行或程序准备退出。",409);
            var items=request.Items.ToArray();
            var job=new RecyclePurgeJob(workspace,items.Length);
            v.SetRecyclePurge(job);
            // No HttpContext or HTTP cancellation token is retained: closing the
            // page never silently cancels an irreversible database transaction.
            _=Task.Run(async ()=>
            {
                bool entered=false;
                try
                {
                    await v.Gate.WaitAsync(cancellation);
                    entered=true;
                    bool changed=RecycleStore.Change(v.Db,workspace,items,true,
                        job.Report,cancellation);
                    if(!changed)throw new InvalidOperationException(
                        "回收站记录已变化，未执行永久删除。");
                    job.Finish();
                }
                catch(OperationCanceledException)
                {
                    job.Fail("",true);
                }
                catch(Exception ex)
                {
                    string error=ex is SqliteException sqlite
                        ?"SQLCipher 清理受约束或存储错误："+sqlite.SqliteErrorCode
                        :ex.Message;
                    job.Fail(error,false);
                }
                finally
                {
                    if(entered)v.Gate.Release();
                    v.CompleteFileTask();
                }
            });
            return Results.Json(new {taskId=job.Snapshot().TaskId},statusCode:202);
        });
        app.MapGet("/api/trash/{workspace}",async(HttpContext ctx,Vault v,string workspace)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                return Results.Json(RecycleStore.List(v.Db,workspace));
            }
            finally{v.Gate.Release();}
        });
        app.MapPost("/api/trash/{workspace}/{operation}",async(
            HttpContext ctx,Vault v,string workspace,string operation,RecycleRequest request)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            if(operation is not ("restore" or "purge"))return Fail("无效回收站操作。");
            if(request.Items is null||request.Items.Count is <1 or >200)return Fail("请选择 1 至 200 条记录。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可修改数据。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可修改数据。",409);
                try
                {
                    return RecycleStore.Change(v.Db,workspace,request.Items,operation=="purge")
                        ?Results.Ok(new {ok=true,count=request.Items.Count})
                        :Results.NotFound();
                }
                catch(InvalidOperationException ex){return Fail(ex.Message,409);}
                catch(SqliteException ex){return Fail("引用约束拒绝此操作："+ex.SqliteErrorCode,409);}
            }
            finally{v.Gate.Release();}
        });
    }
}
