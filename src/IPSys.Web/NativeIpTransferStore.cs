using System.Text.Json;
using Microsoft.Data.Sqlite;

// N2-03-05: whole-IP copy/move is one SQLCipher transaction; a failure
// must not strand a target folder with only part of its original versions.
// Moving means copying then soft-deleting the source in the SAME transaction.
record NativeIpTransferInput(string TargetWorkspace,bool Move=false);
record NativeIpTransferResult(long SourceId,long Id,string SourceWorkspace,
    string TargetWorkspace,bool Moved,int Files,int Versions,int NewObjects);
static class NativeIpTransferStore
{
    public static long EstimatedBytes(SqliteConnection db,string workspace,long id,
        string targetWorkspace)
    {
        if(!Vault.WorkspaceValid(workspace)||!Vault.WorkspaceValid(targetWorkspace))
            throw new ArgumentException("工作区无效。");
        var reference=ResourceRef.Create(workspace,FolderKinds.Ip,id);
        if(NativeFolderStore.Get(db,reference) is null)
            throw new KeyNotFoundException("知识产权不存在。");
        if(workspace==targetWorkspace)return 0;
        var links=NativeFileLinkStore.ListFolder(db,workspace,id,false)!;
        long total=0;
        foreach(var fileId in links.Select(x=>x.FileId).Distinct())
            total=checked(total+NativeFileCopyStore.EstimateIndependentBytes(
                db,workspace,fileId));
        return total;
    }

    public static async Task<NativeIpTransferResult> TransferAsync(SqliteConnection db,
        string workspace,long id,NativeIpTransferInput input,CancellationToken cancellation)
    {
        if(!Vault.WorkspaceValid(workspace) ||
           !Vault.WorkspaceValid(input.TargetWorkspace) || id<=0)
            throw new ArgumentException("工作区或知识产权 ID 无效。");
        if(input.Move && workspace==input.TargetWorkspace)
            throw new ArgumentException("同工作区无需执行跨工作区移动。");
        var reference=ResourceRef.Create(workspace,FolderKinds.Ip,id);
        var source=NativeFolderStore.Get(db,reference)
            ??throw new KeyNotFoundException("知识产权不存在或已删除。");
        var links=NativeFileLinkStore.ListFolder(db,workspace,id,false)
            ??throw new KeyNotFoundException("知识产权文件夹不存在。");
        // Duplicate source locations cannot trigger duplicate FileId clones.
        if(links.Select(x=>x.FileId).Distinct().Count()!=links.Count)
            throw new InvalidDataException("同一个知识产权存在重复文件关联。");
        string attributes=JsonSerializer.Serialize((IpInput)source.BusinessData);
        cancellation.ThrowIfCancellationRequested();
        using var tx=db.BeginTransaction();
        long targetId;
        using(var folder=db.CreateCommand())
        {
            folder.Transaction=tx;
            folder.CommandText="""
                INSERT INTO folders(workspace,kind,name,attributes_json,position)
                VALUES($workspace,'ip',$name,$attributes,
                    (SELECT COALESCE(MAX(position),-1)+1 FROM folders
                     WHERE workspace=$workspace AND kind='ip' AND deleted=0));
                SELECT last_insert_rowid();
                """;
            folder.Parameters.AddWithValue("$workspace",input.TargetWorkspace);
            folder.Parameters.AddWithValue("$name",source.Folder.Name);
            folder.Parameters.AddWithValue("$attributes",attributes);
            targetId=(long)folder.ExecuteScalar()!;
        }

        int versionCount=0,newObjects=0;
        foreach(var link in links)
        {
            cancellation.ThrowIfCancellationRequested();
            // Same workspace: only immutable physical bytes may be shared;
            // different workspace: all versions receive new physical objects.
            string mode=workspace==input.TargetWorkspace
                ?"reuse-content":"independent-content";
            var copy=await NativeFileCopyStore.CopyAsync(db,workspace,link.FileId,
                new NativeFileCopyInput(input.TargetWorkspace,targetId,mode),
                cancellation,tx);
            versionCount+=copy.Versions;newObjects+=copy.NewObjects;
            using var metadata=db.CreateCommand();
            metadata.Transaction=tx;
            metadata.CommandText="""
                UPDATE folder_file_links
                SET display_name=$display,material_category=$category
                WHERE workspace=$workspace AND folder_id=$folder AND file_id=$file
                  AND deleted=0;
                """;
            metadata.Parameters.AddWithValue("$workspace",input.TargetWorkspace);
            metadata.Parameters.AddWithValue("$folder",targetId);
            metadata.Parameters.AddWithValue("$file",copy.FileId);
            metadata.Parameters.AddWithValue("$display",
                (object?)link.DisplayName??DBNull.Value);
            metadata.Parameters.AddWithValue("$category",
                (object?)link.MaterialCategory??DBNull.Value);
            if(metadata.ExecuteNonQuery()!=1)
                throw new IOException("目标原件的材料分类未完整复制。");
        }
        if(input.Move)
        {
            using var delete=db.CreateCommand();
            delete.Transaction=tx;
            delete.CommandText="""
                UPDATE folders SET deleted=1
                WHERE workspace=$workspace AND kind='ip' AND id=$id AND deleted=0;
                """;
            delete.Parameters.AddWithValue("$workspace",workspace);
            delete.Parameters.AddWithValue("$id",id);
            if(delete.ExecuteNonQuery()!=1)
                throw new IOException("来源知识产权状态已变化，转移已回滚。");
        }
        cancellation.ThrowIfCancellationRequested();
        tx.Commit();
        return new(id,targetId,workspace,input.TargetWorkspace,input.Move,
            links.Count,versionCount,newObjects);
    }
}
