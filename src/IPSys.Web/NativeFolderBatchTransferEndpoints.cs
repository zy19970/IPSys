using System.Text.Json;
using Microsoft.Data.Sqlite;

record FolderBatchTransferInput(long TargetFolderId,bool Move,long[]? Items,
    string? TargetSection=null);

// Share = clone folder hierarchy and link the SAME logical FileIds (versions remain shared).
// Move = change parent_id in place, preserving every FolderId and attachment link.
// All selected roots and their descendants are committed or rolled back together.
static class NativeFolderBatchTransferEndpoints
{
    private sealed record TreeEntry(FolderSnapshot Snapshot,
        IReadOnlyList<NativeFolderFileLink> Links);

    // Move uses the complete owned subtree, including recycled directories.
    // Share/copy intentionally continues to operate on active content only.
    private static IReadOnlyList<long> PhysicalMoveTree(SqliteConnection db,
        string workspace,string section,long root,CancellationToken stop)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            WITH RECURSIVE owned(id,depth) AS (
              SELECT id,0 FROM folders WHERE id=$root AND workspace=$w
              UNION ALL
              SELECT child.id,owned.depth+1 FROM folders child
                JOIN owned ON child.parent_id=owned.id
              WHERE child.workspace=$w AND owned.depth<10000
            )
            SELECT f.id,f.kind,f.section FROM owned
            JOIN folders f ON f.id=owned.id AND f.workspace=$w
            ORDER BY owned.depth,f.id;
            """;
        cmd.Parameters.AddWithValue("$root",root);
        cmd.Parameters.AddWithValue("$w",workspace);
        var result=new List<long>();
        var seen=new HashSet<long>();
        using var rd=cmd.ExecuteReader();
        while(rd.Read())
        {
            stop.ThrowIfCancellationRequested();
            long id=rd.GetInt64(0);
            if(!seen.Add(id) || rd.GetString(1)!=FolderKinds.ArchiveFolder ||
               rd.GetString(2)!=section)
                throw new TransferRejection(
                    "来源文件夹物理子树归属异常，全部移动已取消。",409);
            result.Add(id);
            if(result.Count>10000)
                throw new TransferRejection("单次操作最多包含10000个文件夹。",400);
        }
        if(result.Count==0 || result[0]!=root)
            throw new TransferRejection("来源文件夹已发生变化，请刷新重试。",409);
        return result;
    }

    internal sealed record BatchOutcome(bool Moved,string SourceSection,
        string TargetSection,int Count,int Folders,int Links,long[] Ids);
    internal sealed class TransferRejection(string message,int status):Exception(message)
    {
        public int Status {get;}=status;
    }

    // One SQLCipher transaction core for GUI batch move/share, the legacy
    // single-folder /move route, and MCP transfer_folder same-workspace move.
    // The caller owns the file-task lease and Vault.Gate; this routine never
    // re-enters HTTP or takes another Gate.
    internal static BatchOutcome Execute(SqliteConnection db,string workspace,
        string section,FolderBatchTransferInput input,CancellationToken stop)
    {
        var ids=input.Items;
        var targetSection=input.TargetSection??section;
        if(!ArchiveDirectoryScopes.Allowed(workspace,section) ||
           !ArchiveDirectoryScopes.Allowed(workspace,targetSection) ||
           input.TargetFolderId<0 ||
           (targetSection=="project" && input.TargetFolderId==0) ||
           ids is null || ids.Length is 0 or >100 || ids.Any(id=>id<=0) ||
           ids.Distinct().Count()!=ids.Length)
            throw new TransferRejection("批量文件夹参数无效，单次最多100个不同的普通文件夹。",400);
            var all=NativeArchiveStore.ListAll(db,workspace,section)
                .ToDictionary(item=>item.Folder.Ref.Id);
            var targetFolders=targetSection==section?all:
                NativeArchiveStore.ListAll(db,workspace,targetSection)
                    .ToDictionary(item=>item.Folder.Ref.Id);
            long? parent=input.TargetFolderId==0?null:input.TargetFolderId;
            if(parent is long target &&
               (!(targetFolders.ContainsKey(target) ||
                  (targetSection=="project" &&
                   NativeFolderStore.Get(db,ResourceRef.Create(
                       workspace,FolderKinds.Project,target)) is not null)) ||
                !NativeFileStore.FolderActive(db,workspace,target)))
                throw new TransferRejection("目标文件夹或项目不存在或不属于目标模块。",404);
            foreach(long id in ids)
                if(!all.ContainsKey(id) ||
                   !NativeFileStore.FolderActive(db,workspace,id))
                    throw new TransferRejection("所选文件夹不存在或其上级目录已被删除，请刷新重试。",404);

            var children=all.Values
                .Where(item=>item.Folder.Parent is not null)
                .GroupBy(item=>item.Folder.Parent!.Value.Id)
                .ToDictionary(group=>group.Key,group=>group
                    .OrderBy(item=>item.Folder.Position)
                    .ThenBy(item=>item.Folder.Ref.Id).ToArray());
            var trees=new List<List<TreeEntry>>();
            var included=new HashSet<long>();
            foreach(long root in ids)
            {
                var queue=new Queue<long>();
                queue.Enqueue(root);
                var entries=new List<TreeEntry>();
                while(queue.Count>0)
                {
                    stop.ThrowIfCancellationRequested();
                    long id=queue.Dequeue();
                    if(!included.Add(id))
                        throw new TransferRejection("选中的文件夹存在父子包含关系，请只选最上层文件夹。",400);
                    if(included.Count>10000)
                        throw new TransferRejection("单次操作最多包含10000个文件夹。",400);
                    if(parent==id)
                        throw new TransferRejection("目标不能是被操作的文件夹或它的子文件夹。",400);
                    var links=NativeFileLinkStore.ListFolder(db,workspace,id,false);
                    if(links is null)
                        throw new TransferRejection("文件夹或附件关联已发生变化，请刷新重试。",409);
                    entries.Add(new TreeEntry(all[id],links));
                    if(children.TryGetValue(id,out var nested))
                        foreach(var child in nested)queue.Enqueue(child.Folder.Ref.Id);
                }
                trees.Add(entries);
            }

            // Complete physical descendants are required for cross-section
            // moves so that restored tombstones remain inside their ancestor.
            // Read and validate every selected subtree before any mutation.
            var physicalMoves=new List<IReadOnlyList<long>>();
            if(input.Move && targetSection!=section)
            {
                var acrossAllRoots=new HashSet<long>();
                foreach(long root in ids)
                {
                    var full=PhysicalMoveTree(db,workspace,section,root,stop);
                    foreach(long node in full)
                    {
                        if(!acrossAllRoots.Add(node))
                            throw new TransferRejection(
                                "所选目录的完整子树互相包含，请只选最上层文件夹。",400);
                        if(acrossAllRoots.Count>10000)
                            throw new TransferRejection("单次操作最多包含10000个文件夹。",400);
                    }
                    physicalMoves.Add(full);
                }
            }

            if(input.Move)
            {
                // Moving to the existing parent is not a useful operation.
                if(targetSection==section &&
                    ids.Any(id=>all[id].Folder.Parent?.Id==parent))
                    throw new TransferRejection("所选文件夹中有文件夹已经位于目标目录，请选择其它位置。",409);
                // A rename on move must never happen silently.
                var existing=targetFolders.Values.Where(item=>item.Folder.Parent?.Id==parent)
                    .Select(item=>item.Folder.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
                if(ids.Any(id=>existing.Contains(all[id].Folder.Name)) ||
                   ids.Select(id=>all[id].Folder.Name)
                     .Distinct(StringComparer.OrdinalIgnoreCase).Count()!=ids.Length)
                    throw new TransferRejection("目标目录存在同名文件夹冲突，本批次没有移动。",409);
            }

            using var tx=db.BeginTransaction();
            int folders=0,linksCount=0;
            var targets=new List<long>();
            for(int groupIndex=0;groupIndex<trees.Count;groupIndex++)
            {
                var tree=trees[groupIndex];
                long root=ids[groupIndex];
                if(input.Move)
                {
                    var snapshot=all[root];
                    var original=(ArchiveFolderInput)snapshot.BusinessData;
                    var json=JsonSerializer.Serialize(original with {
                        Name=snapshot.Folder.Name,ParentId=parent
                    });
                    using var cmd=db.CreateCommand();
                    cmd.Transaction=tx;
                    cmd.CommandText="""
                        UPDATE folders SET parent_id=$parent,section=$targetSection,
                          attributes_json=$json,
                          position=(SELECT COALESCE(MAX(position),-1)+1 FROM folders
                            WHERE workspace=$w AND section=$targetSection
                              AND kind='archive_folder' AND deleted=0
                              AND COALESCE(parent_id,0)=COALESCE($parent,0))
                        WHERE id=$id AND workspace=$w AND section=$sourceSection
                          AND kind='archive_folder' AND deleted=0;
                        """;
                    cmd.Parameters.AddWithValue("$parent",(object?)parent??DBNull.Value);
                    cmd.Parameters.AddWithValue("$json",json);
                    cmd.Parameters.AddWithValue("$w",workspace);
                    cmd.Parameters.AddWithValue("$sourceSection",section);
                    cmd.Parameters.AddWithValue("$targetSection",targetSection);
                    cmd.Parameters.AddWithValue("$id",root);
                    if(cmd.ExecuteNonQuery()!=1)
                        throw new InvalidOperationException("来源文件夹已发生变化，全部移动已回滚。");
                    // Parent is moved before descendants, so the final
                    // tree keeps the same IDs, parent links and FileIds.
                    // Only ordinary archive_folder.section changes.
                    if(targetSection!=section)
                    {
                        using var childUpdate=db.CreateCommand();
                        childUpdate.Transaction=tx;
                        childUpdate.CommandText="""
                            UPDATE folders SET section=$targetSection
                            WHERE id=$id AND workspace=$w
                              AND kind='archive_folder' AND section=$sourceSection;
                            """;
                        childUpdate.Parameters.AddWithValue("$targetSection",targetSection);
                        childUpdate.Parameters.AddWithValue("$sourceSection",section);
                        childUpdate.Parameters.AddWithValue("$w",workspace);
                        var childId=childUpdate.Parameters.Add("$id",SqliteType.Integer);
                        foreach(long descendant in physicalMoves[groupIndex].Skip(1))
                        {
                            stop.ThrowIfCancellationRequested();
                            childId.Value=descendant;
                            if(childUpdate.ExecuteNonQuery()!=1)
                                throw new InvalidOperationException("子目录已发生变化，全部移动已回滚。");
                        }
                    }
                    folders+=targetSection==section?tree.Count:physicalMoves[groupIndex].Count;
                    targets.Add(root);
                    continue;
                }

                var folderIds=new Dictionary<long,long>();
                foreach(var entry in tree)
                {
                    stop.ThrowIfCancellationRequested();
                    var folder=entry.Snapshot.Folder;
                    long? targetParent=folder.Ref.Id==root?parent:
                        folder.Parent is ResourceRef ancestor?folderIds[ancestor.Id]:
                        throw new InvalidDataException("来源文件夹的父级结构无效。");
                    string name=NativeArchiveStore.UniqueName(db,tx,
                        workspace,targetSection,targetParent,folder.Name);
                    var metadata=((ArchiveFolderInput)entry.Snapshot.BusinessData) with {
                        Name=name,ParentId=targetParent
                    };
                    long targetId;
                    using(var insert=db.CreateCommand())
                    {
                        insert.Transaction=tx;
                        insert.CommandText="""
                            INSERT INTO folders(workspace,kind,section,parent_id,name,
                                attributes_json,position)
                            VALUES($w,'archive_folder',$section,$parent,$name,$json,
                                (SELECT COALESCE(MAX(position),-1)+1 FROM folders
                                  WHERE workspace=$w AND section=$section
                                    AND kind='archive_folder' AND deleted=0
                                    AND COALESCE(parent_id,0)=COALESCE($parent,0)));
                            SELECT last_insert_rowid();
                            """;
                        insert.Parameters.AddWithValue("$w",workspace);
                        insert.Parameters.AddWithValue("$section",targetSection);
                        insert.Parameters.AddWithValue("$parent",
                            (object?)targetParent??DBNull.Value);
                        insert.Parameters.AddWithValue("$name",name);
                        insert.Parameters.AddWithValue("$json",JsonSerializer.Serialize(metadata));
                        targetId=(long)insert.ExecuteScalar()!;
                    }
                    folderIds.Add(folder.Ref.Id,targetId);
                    folders++;
                    foreach(var link in entry.Links)
                    {
                        using var associate=db.CreateCommand();
                        associate.Transaction=tx;
                        associate.CommandText="""
                            INSERT INTO folder_file_links(workspace,folder_id,file_id,
                                display_name,material_category,position)
                            VALUES($w,$folder,$file,$display,$category,$position);
                            """;
                        associate.Parameters.AddWithValue("$w",workspace);
                        associate.Parameters.AddWithValue("$folder",targetId);
                        associate.Parameters.AddWithValue("$file",link.FileId);
                        associate.Parameters.AddWithValue("$display",
                            (object?)link.DisplayName??DBNull.Value);
                        associate.Parameters.AddWithValue("$category",
                            (object?)link.MaterialCategory??DBNull.Value);
                        associate.Parameters.AddWithValue("$position",link.Position);
                        if(associate.ExecuteNonQuery()!=1)
                            throw new InvalidDataException("共享附件关联未完整建立，全部共享已回滚。");
                        linksCount++;
                    }
                }
                targets.Add(folderIds[root]);
            }
            stop.ThrowIfCancellationRequested();
            tx.Commit();
            return new BatchOutcome(input.Move,section,targetSection,ids.Length,
                folders,linksCount,targets.ToArray());
    }

    internal static IResult ToResponse(BatchOutcome result) => Results.Json(new {
        ok=true,moved=result.Moved,sourceSection=result.SourceSection,
        targetSection=result.TargetSection,count=result.Count,
        folders=result.Folders,links=result.Links,ids=result.Ids,
        id=result.Ids.Length==1?(long?)result.Ids[0]:null
    });

    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ui/folders/{workspace}/{section}/transfer-batch",async(
            HttpContext ctx,Vault vault,string workspace,string section,
            FolderBatchTransferInput input)=>
        {
            if(!vault.Allowed(ctx))return (IResult)Results.Unauthorized();
            var ids=input.Items;
            var targetSection=input.TargetSection??section;
            if(!ArchiveDirectoryScopes.Allowed(workspace,section) ||
               !ArchiveDirectoryScopes.Allowed(workspace,targetSection) ||
               input.TargetFolderId<0 || (targetSection=="project" && input.TargetFolderId==0) ||
               ids is null || ids.Length is 0 or >100 ||
               ids.Any(id=>id<=0) || ids.Distinct().Count()!=ids.Length)
                return fail("批量文件夹参数无效，单次最多100个不同的普通文件夹。",400);
            if(!vault.TryBeginFileTask(ctx,out var aborted))
                return fail("文件任务正在执行或程序正在退出。",409);
            try
            {
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    ctx.RequestAborted,aborted);
                if(!await vault.Gate.WaitAsync(0,linked.Token))
                    return fail("当前数据库有文件任务。",409);
                try
                {
                    if(!vault.Allowed(ctx))return Results.Unauthorized();
                    return ToResponse(Execute(vault.Db,workspace,section,input,
                        linked.Token));
                }
                catch(TransferRejection ex){return fail(ex.Message,ex.Status);}
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(KeyNotFoundException ex){return fail(ex.Message,409);}
                catch(InvalidOperationException ex){return fail(ex.Message,409);}
                catch(InvalidDataException ex){return fail(ex.Message,409);}
                catch(IOException ex){return fail(ex.Message,409);}
                catch(OperationCanceledException){return fail("操作已取消。",409);}
                catch(SqliteException){return fail("文件夹批量操作失败，事务已回滚。",409);}
                finally{vault.Gate.Release();}
            }
            finally{vault.CompleteFileTask();}
        });
    }
}
