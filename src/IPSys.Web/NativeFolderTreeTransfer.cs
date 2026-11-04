using System.Text.Json;
using Microsoft.Data.Sqlite;

// Copy an entire active ordinary-folder tree under ONE SQLCipher transaction.
// FileId sharing within the source tree is preserved as shared links between
// target folders. Cross-workspace copies never reuse source FileObjects.
internal static class NativeFolderTreeTransfer
{
    internal sealed record Result(long Id,int Folders,int Files,int Versions,
        int NewObjects);
    private sealed record Node(FolderSnapshot Folder,
        IReadOnlyList<NativeFolderFileLink> Links);

    private static List<Node> Snapshot(SqliteConnection db,string workspace,
        string section,long rootId)
    {
        var flat=NativeArchiveStore.ListAll(db,workspace,section)
            .ToDictionary(x=>x.Folder.Ref.Id);
        if(!flat.ContainsKey(rootId))
            throw new InvalidOperationException("来源资料已不存在或不允许访问。");
        var children=flat.Values
            .Where(x=>x.Folder.Parent is not null)
            .GroupBy(x=>x.Folder.Parent!.Value.Id)
            .ToDictionary(g=>g.Key,g=>g.OrderBy(x=>x.Folder.Position)
                .ThenBy(x=>x.Folder.Ref.Id).ToArray());
        var result=new List<Node>();
        var seen=new HashSet<long>();
        var queue=new Queue<long>();
        queue.Enqueue(rootId);
        while(queue.Count>0)
        {
            long id=queue.Dequeue();
            if(!seen.Add(id))throw new InvalidDataException("文件夹层级存在循环。");
            var folder=flat[id];
            var links=NativeFileLinkStore.ListFolder(db,workspace,id,false)
                ??throw new InvalidDataException("来源文件夹的附件引用不可访问。");
            result.Add(new Node(folder,links));
            if(result.Count>10000)
                throw new InvalidDataException("单次整树转移最多包含10000个文件夹。");
            if(children.TryGetValue(id,out var descendants))
                foreach(var next in descendants)queue.Enqueue(next.Folder.Ref.Id);
        }
        return result;
    }

    internal static async Task<Result> CopyAsync(SqliteConnection db,
        string databasePath,string sourceWorkspace,string sourceSection,
        long rootId,string targetWorkspace,string targetSection,long? parentId,
        bool move,CancellationToken cancellation)
    {
        if(!Vault.WorkspaceValid(sourceWorkspace) ||
           !Vault.WorkspaceValid(targetWorkspace) ||
           !FolderTransferPolicy.Allowed(sourceWorkspace,sourceSection,
               targetWorkspace,targetSection))
            throw new ArgumentException("目标工作区或资料类别不在允许的转移范围。");
        if(parentId is <=0 || (targetSection=="project" && parentId is null))
            throw new ArgumentException("目标项目必须提供真实项目或目录 FolderId。");
        if(!NativeFileStore.FolderActive(db,sourceWorkspace,rootId))
            throw new InvalidOperationException("来源目录或其父目录已被删除。");
        var tree=Snapshot(db,sourceWorkspace,sourceSection,rootId);
        if(sourceWorkspace==targetWorkspace && parentId is long destination &&
           tree.Any(node=>node.Folder.Folder.Ref.Id==destination))
            throw new ArgumentException("不能复制到来源文件夹自身或它的子目录。");
        // A move never silently renames the source root, even when copying
        // its content across workspaces. Ordinary independent copies/shares
        // may still allocate a conflict-free name through UniqueName.
        if(move && NativeArchiveStore.List(db,targetWorkspace,
            FolderKinds.ArchiveFolder,targetSection,parentId).Any(x=>
            string.Equals(x.Folder.Name,tree[0].Folder.Folder.Name,
                StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException(
                "目标目录存在同名文件夹，转移未执行。");
        var files=tree.SelectMany(x=>x.Links).Select(x=>x.FileId)
            .Distinct().ToArray();
        long required=0;
        if(sourceWorkspace!=targetWorkspace)
            foreach(long file in files)
            {
                cancellation.ThrowIfCancellationRequested();
                required=checked(required+NativeFileCopyStore
                    .EstimateIndependentBytes(db,sourceWorkspace,file));
            }
        if(required>0)
        {
            long free=new DriveInfo(Path.GetPathRoot(databasePath)!)
                .AvailableFreeSpace;
            if(free<checked(required+Math.Max(128L*1024*1024,required/3)))
                throw new IOException("磁盘空间不足以复制全部文件夹附件版本。");
        }

        cancellation.ThrowIfCancellationRequested();
        using var tx=db.BeginTransaction();
        var folderMap=new Dictionary<long,long>();
        var fileMap=new Dictionary<long,long>();
        int linksCount=0,versions=0,newObjects=0;
        foreach(var item in tree)
        {
            cancellation.ThrowIfCancellationRequested();
            var original=item.Folder.Folder;
            long? targetParent=original.Ref.Id==rootId?parentId:
                original.Parent is ResourceRef p?folderMap[p.Id]:
                throw new InvalidDataException("文件夹的父级结构已损坏。");
            string name=NativeArchiveStore.UniqueName(db,tx,targetWorkspace,
                targetSection,targetParent,original.Name);
            var data=((ArchiveFolderInput)item.Folder.BusinessData) with {
                Name=name,ParentId=targetParent
            };
            long targetId;
            using(var folder=db.CreateCommand())
            {
                folder.Transaction=tx;
                folder.CommandText="""
                    INSERT INTO folders(workspace,kind,section,parent_id,name,
                        attributes_json,position)
                    VALUES($w,'archive_folder',$section,$parent,$name,$json,
                      (SELECT COALESCE(MAX(position),-1)+1 FROM folders
                       WHERE workspace=$w AND kind='archive_folder'
                         AND section=$section AND deleted=0
                         AND COALESCE(parent_id,0)=COALESCE($parent,0)));
                    SELECT last_insert_rowid();
                    """;
                folder.Parameters.AddWithValue("$w",targetWorkspace);
                folder.Parameters.AddWithValue("$section",targetSection);
                folder.Parameters.AddWithValue("$parent",
                    (object?)targetParent??DBNull.Value);
                folder.Parameters.AddWithValue("$name",name);
                folder.Parameters.AddWithValue("$json",
                    JsonSerializer.Serialize(data));
                targetId=(long)folder.ExecuteScalar()!;
            }
            folderMap.Add(original.Ref.Id,targetId);
            foreach(var link in item.Links)
            {
                cancellation.ThrowIfCancellationRequested();
                long targetFile;
                bool newLink=!fileMap.TryGetValue(link.FileId,out targetFile);
                if(newLink)
                {
                    var result=await NativeFileCopyStore.CopyAsync(db,
                        sourceWorkspace,link.FileId,
                        new NativeFileCopyInput(targetWorkspace,targetId,
                            sourceWorkspace==targetWorkspace
                                ?"reuse-content":"independent-content"),
                        cancellation,tx);
                    targetFile=result.FileId;
                    fileMap.Add(link.FileId,targetFile);
                    versions+=result.Versions;
                    newObjects+=result.NewObjects;
                }
                using var linkRow=db.CreateCommand();
                linkRow.Transaction=tx;
                if(newLink)
                    linkRow.CommandText="""
                        UPDATE folder_file_links SET display_name=$display,
                            material_category=$category,position=$position
                        WHERE workspace=$w AND folder_id=$folder
                          AND file_id=$file AND deleted=0;
                        """;
                else
                    linkRow.CommandText="""
                        INSERT INTO folder_file_links(workspace,folder_id,
                          file_id,display_name,material_category,position)
                        VALUES($w,$folder,$file,$display,$category,$position);
                        """;
                linkRow.Parameters.AddWithValue("$w",targetWorkspace);
                linkRow.Parameters.AddWithValue("$folder",targetId);
                linkRow.Parameters.AddWithValue("$file",targetFile);
                linkRow.Parameters.AddWithValue("$display",
                    (object?)link.DisplayName??DBNull.Value);
                linkRow.Parameters.AddWithValue("$category",
                    (object?)link.MaterialCategory??DBNull.Value);
                linkRow.Parameters.AddWithValue("$position",link.Position);
                if(await linkRow.ExecuteNonQueryAsync(cancellation)!=1)
                    throw new IOException("目标附件引用复制不完整。");
                linksCount++;
            }
        }
        if(move)
        {
            using var deletion=db.CreateCommand();
            deletion.Transaction=tx;
            deletion.CommandText="""
                UPDATE folders SET deleted=1 WHERE workspace=$w AND id=$id
                AND kind='archive_folder' AND section=$section AND deleted=0;
                """;
            deletion.Parameters.AddWithValue("$w",sourceWorkspace);
            deletion.Parameters.AddWithValue("$id",rootId);
            deletion.Parameters.AddWithValue("$section",sourceSection);
            if(deletion.ExecuteNonQuery()!=1)
                throw new IOException("来源文件夹状态变化，已回滚转移。");
        }
        cancellation.ThrowIfCancellationRequested();
        tx.Commit();
        return new Result(folderMap[rootId],tree.Count,linksCount,
            versions,newObjects);
    }
}
