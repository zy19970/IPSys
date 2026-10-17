using Microsoft.Data.Sqlite;

static partial class NativeFileChoiceStore
{
    private static long InsertId(SqliteConnection db,SqliteTransaction tx,
        string sql,Action<SqliteCommand> bind)
    {
        using var cmd=Sql(db,tx,sql+"; SELECT last_insert_rowid();");
        bind(cmd);
        return (long)cmd.ExecuteScalar()!;
    }
    private static void RemoveStaged(SqliteConnection db,SqliteTransaction tx,
        NativeFilePreparation p)
    {
        using(var chunks=Sql(db,tx,"""
            DELETE FROM file_chunks WHERE workspace=$w AND object_id=$id;
            """))
        {
            Bind(chunks,p.Workspace,p.ObjectId);
            chunks.ExecuteNonQuery();
        }
        using(var obj=Sql(db,tx,"""
            DELETE FROM file_objects WHERE workspace=$w AND id=$id AND state='writing';
            """))
        {
            Bind(obj,p.Workspace,p.ObjectId);
            if(obj.ExecuteNonQuery()!=1)
                throw new InvalidOperationException("待处理原件已不存在。");
        }
    }
    public static NativeFileDecisionResult Resolve(Vault v,string workspace,
        string ticket,NativeFileDecision decision,CancellationToken cancellation)
    {
        var pending=Require(v,workspace,ticket);
        string choice=decision.Choice??"";
        if(choice is not ("share-file" or "reuse-content" or "independent"))
            throw new ArgumentException("必须明确选择引用已有文件、仅复用内容或独立保存。");
        if(!NativeFileStore.FolderActive(v.Db,workspace,pending.FolderId))
            throw new KeyNotFoundException("目标文件夹已不存在。");
        NativeFileDuplicate? candidate=null;
        if(choice!="independent")
        {
            candidate=Matches(v.Db,workspace,pending.Size,pending.Sha256)
                .FirstOrDefault(x=>x.FileId==decision.SourceFileId);
            if(candidate is null)
                throw new InvalidOperationException("未找到匹配文件：所选 source_file_id 在当前工作区没有相同内容；share/reuse 仅允许同一工作区，跨工作区复制请使用 independent-content。");
        }
        // Sharing an already linked FileId inside the same folder would
        // violate the unique active Folder/File link, so reject explicitly.
        if(choice=="share-file")
        {
            using var exists=v.Db.CreateCommand();
            exists.CommandText="""
                SELECT COUNT(*) FROM folder_file_links
                WHERE workspace=$w AND folder_id=$folder
                  AND file_id=$file AND deleted=0;
                """;
            exists.Parameters.AddWithValue("$w",workspace);
            exists.Parameters.AddWithValue("$folder",pending.FolderId);
            exists.Parameters.AddWithValue("$file",candidate!.FileId);
            if((long)exists.ExecuteScalar()!>0)
                throw new InvalidOperationException(
                    "该文件已关联当前文件夹，无需重复共享。可选择 independent 创建独立文件，或取消本次上传。");
        }
        cancellation.ThrowIfCancellationRequested();
        using var tx=v.Db.BeginTransaction();
        long fileId;
        bool reused=choice!="independent";
        if(choice=="share-file")
            fileId=candidate!.FileId;
        else
        {
            fileId=InsertId(v.Db,tx,"""
                INSERT INTO files(workspace,name,description,tags,file_number,file_date)
                VALUES($w,$name,$description,$tags,$number,$date)
                """,cmd=>
            {
                cmd.Parameters.AddWithValue("$w",workspace);
                cmd.Parameters.AddWithValue("$name",pending.Metadata.Name!);
                cmd.Parameters.AddWithValue("$description",
                    (object?)pending.Metadata.Description??DBNull.Value);
                cmd.Parameters.AddWithValue("$tags",
                    (object?)pending.Metadata.Tags??DBNull.Value);
                cmd.Parameters.AddWithValue("$number",
                    (object?)pending.Metadata.FileNumber??DBNull.Value);
                cmd.Parameters.AddWithValue("$date",
                    (object?)pending.Metadata.FileDate??DBNull.Value);
            });
            long objectId=choice=="reuse-content"?candidate!.ObjectId:pending.ObjectId;
            if(choice=="independent")
            {
                using var ready=Sql(v.Db,tx,"""
                    UPDATE file_objects SET state='ready'
                    WHERE id=$id AND workspace=$w AND state='writing'
                      AND size=expected_size AND sha256=$sha;
                    """);
                Bind(ready,workspace,pending.ObjectId);
                ready.Parameters.AddWithValue("$sha",pending.Sha256);
                if(ready.ExecuteNonQuery()!=1)
                    throw new InvalidOperationException("原件暂存数据已失效。");
            }
            using(var version=Sql(v.Db,tx,"""
                INSERT INTO file_versions(file_id,workspace,version,
                    object_id,original_name,version_note)
                VALUES($file,$w,1,$object,$name,$note);
                """))
            {
                version.Parameters.AddWithValue("$file",fileId);
                version.Parameters.AddWithValue("$w",workspace);
                version.Parameters.AddWithValue("$object",objectId);
                version.Parameters.AddWithValue("$name",pending.Metadata.Name!);
                version.Parameters.AddWithValue("$note",
                    (object?)pending.VersionNote??DBNull.Value);
                if(version.ExecuteNonQuery()!=1)
                    throw new IOException("文件版本记录写入失败。");
            }
        }
        cancellation.ThrowIfCancellationRequested();
        long linkId=InsertId(v.Db,tx,"""
            INSERT INTO folder_file_links(workspace,folder_id,file_id,display_name,material_category,position)
            VALUES($w,$folder,$file,$display,$category,
                (SELECT COALESCE(MAX(position),-1)+1 FROM folder_file_links
                WHERE workspace=$w AND folder_id=$folder AND deleted=0))
            """,cmd=>
        {
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$folder",pending.FolderId);
            cmd.Parameters.AddWithValue("$file",fileId);
            string? alias=choice=="share-file" &&
                !string.Equals(pending.Metadata.Name,candidate!.Name,
                    StringComparison.Ordinal)
                ?pending.Metadata.Name:null;
            cmd.Parameters.AddWithValue("$display",(object?)alias??DBNull.Value);
            cmd.Parameters.AddWithValue("$category",(object?)pending.MaterialCategory??DBNull.Value);
        });
        if(choice!="independent")RemoveStaged(v.Db,tx,pending);
        cancellation.ThrowIfCancellationRequested();
        tx.Commit();
        v.PendingFile=null;
        return new(choice,fileId,linkId,pending.Size,pending.Sha256,reused);
    }
}
