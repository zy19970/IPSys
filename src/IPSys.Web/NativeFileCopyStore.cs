using Microsoft.Data.Sqlite;

record NativeFileCopyInput(string TargetWorkspace,long TargetFolderId,string Mode,
    string? Name=null);
record NativeFileCopyResult(long SourceFileId,long FileId,string Workspace,
    string Mode,int Versions,int ReusedObjects,int NewObjects);

// N3-03: a copied logical FileId always owns its own metadata and version rows.
// Only an explicit same-workspace "reuse-content" copy may reference existing
// immutable ready FileObjects; cross-workspace copies always allocate new bytes.
static class NativeFileCopyStore
{
    private sealed record SourceVersion(int Version,long ObjectId,string OriginalName,
        string? Note,string CreatedAt,long Size,string Sha256);
    private static SqliteCommand Command(SqliteConnection db,SqliteTransaction tx,string sql)
    {
        var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText=sql;
        return cmd;
    }
    private static void Source(SqliteCommand cmd,string workspace,long fileId)
    {
        cmd.Parameters.AddWithValue("$sourceWorkspace",workspace);
        cmd.Parameters.AddWithValue("$sourceId",fileId);
    }
    private static void Target(SqliteCommand cmd,NativeFileCopyInput input)
    {
        cmd.Parameters.AddWithValue("$targetWorkspace",input.TargetWorkspace);
        cmd.Parameters.AddWithValue("$folderId",input.TargetFolderId);
    }
    public static long EstimateIndependentBytes(SqliteConnection db,
        string sourceWorkspace,long sourceId)
    {
        if(!Vault.WorkspaceValid(sourceWorkspace)||sourceId<=0)
            throw new ArgumentException("源工作区或文件 ID 无效。");
        if(!NativeFileStore.Accessible(db,sourceWorkspace,sourceId))
            throw new KeyNotFoundException("源文件不可访问。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT COALESCE(SUM(size),0) FROM file_objects WHERE id IN
              (SELECT DISTINCT object_id FROM file_versions
               WHERE file_id=$sourceId AND workspace=$sourceWorkspace AND deleted=0)
               AND workspace=$sourceWorkspace AND state='ready';
            """;
        Source(cmd,sourceWorkspace,sourceId);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }
    public static async Task<NativeFileCopyResult> CopyAsync(SqliteConnection db,
        string sourceWorkspace,long sourceId,NativeFileCopyInput input,
        CancellationToken cancellation,SqliteTransaction? parentTransaction=null)
    {
        if(!Vault.WorkspaceValid(sourceWorkspace) ||
           !Vault.WorkspaceValid(input.TargetWorkspace) ||
           sourceId<=0 || input.TargetFolderId<=0)
            throw new ArgumentException("复制所使用的工作区或资源 ID 无效。");
        if(input.Mode is not ("reuse-content" or "independent-content"))
            throw new ArgumentException("请选择明确的内容存储模式。");
        if(input.Mode=="reuse-content" && sourceWorkspace!=input.TargetWorkspace)
            throw new ArgumentException("跨工作区禁止共享物理 FileObject，请使用独立内容复制。");
        var customName=input.Name is null?null:NativeFileStore.ValidName(input.Name);
        if(!NativeFileStore.Accessible(db,sourceWorkspace,sourceId) ||
           !NativeFileStore.FolderActive(db,input.TargetWorkspace,input.TargetFolderId))
            throw new KeyNotFoundException("源文件或目标文件夹不可访问。");
        cancellation.ThrowIfCancellationRequested();

        using var ownedTx=parentTransaction is null?db.BeginTransaction():null;
        var tx=parentTransaction??ownedTx!;
        string name;
        string? description,tags,number,date;
        using(var cmd=Command(db,tx,"""
            SELECT name,description,tags,file_number,file_date
            FROM files WHERE id=$sourceId AND workspace=$sourceWorkspace AND deleted=0;
            """))
        {
            Source(cmd,sourceWorkspace,sourceId);
            using var rd=cmd.ExecuteReader();
            if(!rd.Read())throw new KeyNotFoundException("源文件不存在。");
            name=customName??rd.GetString(0);
            description=rd.IsDBNull(1)?null:rd.GetString(1);
            tags=rd.IsDBNull(2)?null:rd.GetString(2);
            number=rd.IsDBNull(3)?null:rd.GetString(3);
            date=rd.IsDBNull(4)?null:rd.GetString(4);
        }
        var versions=new List<SourceVersion>();
        using(var cmd=Command(db,tx,"""
            SELECT v.version,v.object_id,v.original_name,v.version_note,v.created_at,
                   o.size,o.sha256
            FROM file_versions v JOIN file_objects o
              ON v.object_id=o.id AND v.workspace=o.workspace
            WHERE v.file_id=$sourceId AND v.workspace=$sourceWorkspace
              AND v.deleted=0 AND o.state='ready'
            ORDER BY v.version;
            """))
        {
            Source(cmd,sourceWorkspace,sourceId);
            using var rd=cmd.ExecuteReader();
            while(rd.Read())
                versions.Add(new(rd.GetInt32(0),rd.GetInt64(1),rd.GetString(2),
                    rd.IsDBNull(3)?null:rd.GetString(3),rd.GetString(4),
                    rd.GetInt64(5),rd.GetString(6)));
        }
        // Refuse partial history if a corrupt/unfinished object has slipped in.
        using(var cmd=Command(db,tx,"""
            SELECT COUNT(*) FROM file_versions
            WHERE file_id=$sourceId AND workspace=$sourceWorkspace AND deleted=0;
            """))
        {
            Source(cmd,sourceWorkspace,sourceId);
            if(versions.Count==0 || versions.Count!=(long)cmd.ExecuteScalar()!)
                throw new IOException("源文件版本存在未完成的物理对象，已拒绝复制。");
        }

        using(var cmd=Command(db,tx,"""
            INSERT INTO files(workspace,name,description,tags,file_number,file_date)
            VALUES($targetWorkspace,$name,$desc,$tags,$number,$date);
            SELECT last_insert_rowid();
            """))
        {
            cmd.Parameters.AddWithValue("$targetWorkspace",input.TargetWorkspace);
            cmd.Parameters.AddWithValue("$name",name);
            cmd.Parameters.AddWithValue("$desc",(object?)description??DBNull.Value);
            cmd.Parameters.AddWithValue("$tags",(object?)tags??DBNull.Value);
            cmd.Parameters.AddWithValue("$number",(object?)number??DBNull.Value);
            cmd.Parameters.AddWithValue("$date",(object?)date??DBNull.Value);
            // Executed below after initialization
            _ = cmd.ExecuteScalar();
        }
        long fileId;
        using(var id=Command(db,tx,"SELECT last_insert_rowid();"))
            fileId=(long)id.ExecuteScalar()!;

        var objectMap=new Dictionary<long,long>();
        int created=0;
        foreach(var version in versions)
        {
            cancellation.ThrowIfCancellationRequested();
            if(objectMap.ContainsKey(version.ObjectId))continue;
            if(input.Mode=="reuse-content")
            {
                objectMap[version.ObjectId]=version.ObjectId;
                continue;
            }
            long objectId;
            using(var start=Command(db,tx,"""
                INSERT INTO file_objects(workspace,state,expected_size)
                VALUES($targetWorkspace,'writing',$size);
                SELECT last_insert_rowid();
                """))
            {
                start.Parameters.AddWithValue("$targetWorkspace",input.TargetWorkspace);
                start.Parameters.AddWithValue("$size",version.Size);
                objectId=(long)start.ExecuteScalar()!;
            }
            // Source is a ready immutable object. Copy its encrypted-database
            // payload through SQLCipher into NEW target rows, not a shared FK.
            using(var chunks=Command(db,tx,"""
                INSERT INTO file_chunks(object_id,workspace,idx,bytes)
                SELECT $newId,$targetWorkspace,idx,bytes
                FROM file_chunks WHERE object_id=$sourceObject
                  AND workspace=$sourceWorkspace ORDER BY idx;
                """))
            {
                chunks.Parameters.AddWithValue("$newId",objectId);
                chunks.Parameters.AddWithValue("$targetWorkspace",input.TargetWorkspace);
                chunks.Parameters.AddWithValue("$sourceObject",version.ObjectId);
                chunks.Parameters.AddWithValue("$sourceWorkspace",sourceWorkspace);
                await chunks.ExecuteNonQueryAsync(cancellation);
            }
            cancellation.ThrowIfCancellationRequested();
            using(var finish=Command(db,tx,"""
                UPDATE file_objects SET state='ready',size=$size,sha256=$sha
                WHERE id=$id AND workspace=$targetWorkspace AND state='writing';
                """))
            {
                finish.Parameters.AddWithValue("$size",version.Size);
                finish.Parameters.AddWithValue("$sha",version.Sha256);
                finish.Parameters.AddWithValue("$id",objectId);
                finish.Parameters.AddWithValue("$targetWorkspace",input.TargetWorkspace);
                if(await finish.ExecuteNonQueryAsync(cancellation)!=1)
                    throw new IOException("独立原件写入未完成。");
            }
            objectMap.Add(version.ObjectId,objectId);
            created++;
        }
        foreach(var version in versions)
        {
            cancellation.ThrowIfCancellationRequested();
            using var row=Command(db,tx,"""
                INSERT INTO file_versions(file_id,workspace,version,object_id,
                    original_name,version_note,created_at)
                VALUES($file,$w,$version,$object,$original,$note,$time);
                """);
            row.Parameters.AddWithValue("$file",fileId);
            row.Parameters.AddWithValue("$w",input.TargetWorkspace);
            row.Parameters.AddWithValue("$version",version.Version);
            row.Parameters.AddWithValue("$object",objectMap[version.ObjectId]);
            row.Parameters.AddWithValue("$original",version.OriginalName);
            row.Parameters.AddWithValue("$note",(object?)version.Note??DBNull.Value);
            row.Parameters.AddWithValue("$time",version.CreatedAt);
            if(await row.ExecuteNonQueryAsync(cancellation)!=1)
                throw new IOException("复制 FileVersion 失败。");
        }
        using(var link=Command(db,tx,"""
            INSERT INTO folder_file_links(workspace,folder_id,file_id,position)
            VALUES($targetWorkspace,$folderId,$fileId,
                (SELECT COALESCE(MAX(position),-1)+1
                 FROM folder_file_links WHERE workspace=$targetWorkspace
                    AND folder_id=$folderId AND deleted=0));
            """))
        {
            Target(link,input);
            link.Parameters.AddWithValue("$fileId",fileId);
            if(await link.ExecuteNonQueryAsync(cancellation)!=1)
                throw new IOException("文件归属关联失败。");
        }
        cancellation.ThrowIfCancellationRequested();
        if(parentTransaction is null)tx.Commit();
        return new(sourceId,fileId,input.TargetWorkspace,input.Mode,
            versions.Count,objectMap.Count-created,created);
    }
}
