using System.Text.Json;
using Microsoft.Data.Sqlite;

// Whole project transfer: project, every active child contract and all
// linked immutable FileVersions in one SQLCipher transaction.
record NativeProjectTransferInput(string TargetWorkspace,bool Move=false);
record NativeProjectTransferResult(long SourceId,long Id,string SourceWorkspace,
    string TargetWorkspace,bool Moved,int Contracts,int Links,int Files,
    int Versions,int NewObjects);
static class NativeProjectTransferStore
{
    private sealed record SourceLink(long FolderId,NativeFolderFileLink Link);
    private static IReadOnlyList<FolderSnapshot> Contracts(SqliteConnection db,
        string w,long project)=>
        NativeFolderStore.List(db,w,FolderKinds.Contract)
            .Where(x=>x.Folder.Parent is ResourceRef p&&p.Id==project).ToArray();

    private static List<SourceLink> Links(SqliteConnection db,string w,
        long project,IReadOnlyList<FolderSnapshot> contracts)
    {
        var folders=new[]{project}.Concat(contracts.Select(c=>c.Folder.Ref.Id));
        var result=new List<SourceLink>();
        foreach(var folder in folders)
            foreach(var link in NativeFileLinkStore.ListFolder(db,w,folder,false)??[])
                result.Add(new(folder,link));
        return result;
    }
    public static long Estimate(SqliteConnection db,string w,long id,string target)
    {
        if(!Vault.WorkspaceValid(w)||!Vault.WorkspaceValid(target))
            throw new ArgumentException("工作区无效。");
        if(NativeFolderStore.Get(db,ResourceRef.Create(w,FolderKinds.Project,id)) is null)
            throw new KeyNotFoundException("来源项目不存在。");
        if(w==target)return 0;
        var links=Links(db,w,id,Contracts(db,w,id));
        long total=0;
        foreach(long file in links.Select(x=>x.Link.FileId).Distinct())
            total=checked(total+NativeFileCopyStore.EstimateIndependentBytes(db,w,file));
        return total;
    }
    private static long InsertFolder(SqliteConnection db,SqliteTransaction tx,string workspace,
        string kind,string name,string json,long? parent)
    {
        using var cmd=db.CreateCommand();cmd.Transaction=tx;
        cmd.CommandText="""
            INSERT INTO folders(workspace,kind,name,attributes_json,parent_id,position)
            VALUES($w,$kind,$name,$json,$parent,
                (SELECT COALESCE(MAX(position),-1)+1 FROM folders
                 WHERE workspace=$w AND kind=$kind AND deleted=0));
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$kind",kind);
        cmd.Parameters.AddWithValue("$name",name);
        cmd.Parameters.AddWithValue("$json",json);
        cmd.Parameters.AddWithValue("$parent",(object?)parent??DBNull.Value);
        return (long)cmd.ExecuteScalar()!;
    }

    public static async Task<NativeProjectTransferResult> TransferAsync(
        SqliteConnection db,string w,long id,NativeProjectTransferInput input,
        CancellationToken stop)
    {
        if(!Vault.WorkspaceValid(w)||!Vault.WorkspaceValid(input.TargetWorkspace)||id<=0)
            throw new ArgumentException("工作区或项目 ID 无效。");
        if(input.Move&&w==input.TargetWorkspace)
            throw new ArgumentException("同一工作区不执行移动。");
        var project=NativeFolderStore.Get(db,ResourceRef.Create(w,FolderKinds.Project,id))
            ??throw new KeyNotFoundException("来源项目已删除或不存在。");
        var contracts=Contracts(db,w,id);
        var links=Links(db,w,id,contracts);
        stop.ThrowIfCancellationRequested();
        using var tx=db.BeginTransaction();
        long target=InsertFolder(db,tx,input.TargetWorkspace,FolderKinds.Project,
            project.Folder.Name,JsonSerializer.Serialize((ProjectInput)project.BusinessData),null);
        var folderMap=new Dictionary<long,long>{{id,target}};
        foreach(var child in contracts)
        {
            stop.ThrowIfCancellationRequested();
            folderMap[child.Folder.Ref.Id]=InsertFolder(db,tx,input.TargetWorkspace,
                FolderKinds.Contract,child.Folder.Name,
                JsonSerializer.Serialize((ContractInput)child.BusinessData),target);
        }
        var mappedFiles=new Dictionary<long,long>();
        int versions=0,objects=0;
        foreach(var item in links)
        {
            stop.ThrowIfCancellationRequested();
            long targetFolder=folderMap[item.FolderId];
            long newFile;
            if(!mappedFiles.TryGetValue(item.Link.FileId,out newFile))
            {
                var copy=await NativeFileCopyStore.CopyAsync(db,w,item.Link.FileId,
                    new NativeFileCopyInput(input.TargetWorkspace,targetFolder,
                        w==input.TargetWorkspace?"reuse-content":"independent-content"),
                    stop,tx);
                newFile=copy.FileId;
                mappedFiles.Add(item.Link.FileId,newFile);
                versions+=copy.Versions;objects+=copy.NewObjects;
                using var metadata=db.CreateCommand();metadata.Transaction=tx;
                metadata.CommandText="""
                    UPDATE folder_file_links SET display_name=$display,
                      material_category=$category,position=$position
                    WHERE workspace=$w AND folder_id=$folder AND file_id=$file
                      AND deleted=0;
                    """;
                metadata.Parameters.AddWithValue("$w",input.TargetWorkspace);
                metadata.Parameters.AddWithValue("$folder",targetFolder);
                metadata.Parameters.AddWithValue("$file",newFile);
                metadata.Parameters.AddWithValue("$display",
                    (object?)item.Link.DisplayName??DBNull.Value);
                metadata.Parameters.AddWithValue("$category",
                    (object?)item.Link.MaterialCategory??DBNull.Value);
                metadata.Parameters.AddWithValue("$position",item.Link.Position);
                if(metadata.ExecuteNonQuery()!=1)
                    throw new IOException("目标文件链接未完整创建。");
            }
            else
            {
                using var extra=db.CreateCommand();extra.Transaction=tx;
                extra.CommandText="""
                    INSERT INTO folder_file_links(workspace,folder_id,file_id,
                        display_name,material_category,position)
                    VALUES($w,$folder,$file,$display,$category,$position);
                    """;
                extra.Parameters.AddWithValue("$w",input.TargetWorkspace);
                extra.Parameters.AddWithValue("$folder",targetFolder);
                extra.Parameters.AddWithValue("$file",newFile);
                extra.Parameters.AddWithValue("$display",
                    (object?)item.Link.DisplayName??DBNull.Value);
                extra.Parameters.AddWithValue("$category",
                    (object?)item.Link.MaterialCategory??DBNull.Value);
                extra.Parameters.AddWithValue("$position",item.Link.Position);
                extra.ExecuteNonQuery();
            }
        }
        if(input.Move)
        {
            using var deletion=db.CreateCommand();deletion.Transaction=tx;
            deletion.CommandText="""
                UPDATE folders SET deleted=1 WHERE id=$id AND workspace=$w
                AND kind='project' AND deleted=0;
                """;
            deletion.Parameters.AddWithValue("$id",id);
            deletion.Parameters.AddWithValue("$w",w);
            if(deletion.ExecuteNonQuery()!=1)throw new IOException("原项目状态已改变。");
        }
        stop.ThrowIfCancellationRequested();
        tx.Commit();
        return new(id,target,w,input.TargetWorkspace,input.Move,
            contracts.Count,links.Count,mappedFiles.Count,versions,objects);
    }
}

static class NativeProjectTransferEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/projects/{workspace}/{id:long}/transfer",async(
            HttpContext ctx,Vault v,string workspace,long id,NativeProjectTransferInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace)||!Vault.WorkspaceValid(input.TargetWorkspace))
                return fail("工作区无效。",400);
            if(!v.TryBeginFileTask(ctx,out var aborted))
                return fail("正在处理文件或程序退出。",409);
            try
            {
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    ctx.RequestAborted,aborted);
                if(!await v.Gate.WaitAsync(0,linked.Token))
                    return fail("数据库忙，请稍后重试。",409);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    try
                    {
                        long required=NativeProjectTransferStore.Estimate(v.Db,workspace,id,
                            input.TargetWorkspace);
                        if(required>0)
                        {
                            long free=new DriveInfo(Path.GetPathRoot(v.Path)!).AvailableFreeSpace;
                            if(free<checked(required+Math.Max(128L*1024*1024,required/3)))
                                return fail("空间不足以复制项目与合同的全部原件。",507);
                        }
                        return Results.Json(await NativeProjectTransferStore.TransferAsync(
                            v.Db,workspace,id,input,linked.Token));
                    }
                    catch(ArgumentException ex){return fail(ex.Message,400);}
                    catch(KeyNotFoundException){return Results.NotFound();}
                    catch(InvalidDataException ex){return fail(ex.Message,409);}
                    catch(InvalidOperationException ex){return fail(ex.Message,409);}
                    catch(SqliteException ex){return fail("事务约束失败："+ex.SqliteErrorCode,409);}
                    catch(OverflowException){return fail("文件大小超限。",409);}
                    catch(IOException ex){return fail(ex.Message,409);}
                    catch(OperationCanceledException){return fail("操作已取消。",409);}
                }
                finally{v.Gate.Release();}
            }
            finally{v.CompleteFileTask();}
        });
    }
}
