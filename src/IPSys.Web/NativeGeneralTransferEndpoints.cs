using System.Text.Json;
using Microsoft.Data.Sqlite;

// A general record is a real V2 folder; its FileIds and all immutable
// FileVersions must accompany every copy/move in one SQLCipher transaction.
record NativeGeneralTransferInput(string TargetWorkspace,bool Move=false);
record NativeGeneralTransferResult(long SourceId,long Id,
    string SourceWorkspace,string TargetWorkspace,bool Moved,
    int Files,int Versions,int NewObjects);
static class NativeGeneralTransferEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ui/general/{workspace}/{id:long}/transfer",async(
            HttpContext ctx,Vault v,string workspace,long id,
            NativeGeneralTransferInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace) ||
               !Vault.WorkspaceValid(input.TargetWorkspace) || id<=0)
                return fail("工作区或资料编号无效。",400);
            if(input.Move&&workspace==input.TargetWorkspace)
                return fail("同一工作区不执行移动。",400);
            if(!v.TryBeginFileTask(ctx,out var aborted))
                return fail("存在其他文件任务或正在退出。",409);
            try
            {
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    ctx.RequestAborted,aborted);
                if(!await v.Gate.WaitAsync(0,linked.Token))
                    return fail("数据库忙，请稍后重试。",409);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    var source=NativeArchiveStore.Get(v.Db,
                        ResourceRef.Create(workspace,FolderKinds.General,id));
                    if(source is null)return Results.NotFound();
                    var links=NativeFileLinkStore.ListFolder(v.Db,workspace,id,false)!;
                    try
                    {
                        long required=0;
                        if(workspace!=input.TargetWorkspace)
                            foreach(var fileId in links.Select(x=>x.FileId).Distinct())
                                required=checked(required+
                                    NativeFileCopyStore.EstimateIndependentBytes(
                                        v.Db,workspace,fileId));
                        if(required>0)
                        {
                            long free=new DriveInfo(Path.GetPathRoot(v.Path)!)
                                .AvailableFreeSpace;
                            if(free<checked(required+
                                Math.Max(128L*1024*1024,required/3)))
                                return fail("磁盘空间不足以复制原件历史。",507);
                        }
                        linked.Token.ThrowIfCancellationRequested();
                        using var tx=v.Db.BeginTransaction();
                        long target;
                        using(var folder=v.Db.CreateCommand())
                        {
                            folder.Transaction=tx;
                            folder.CommandText="""
                                INSERT INTO folders(workspace,kind,name,
                                    section,attributes_json,position)
                                VALUES($w,'general',$name,'',$json,
                                    (SELECT COALESCE(MAX(position),-1)+1 FROM folders
                                    WHERE workspace=$w AND kind='general' AND deleted=0));
                                SELECT last_insert_rowid();
                                """;
                            folder.Parameters.AddWithValue("$w",input.TargetWorkspace);
                            folder.Parameters.AddWithValue("$name",source.Folder.Name);
                            folder.Parameters.AddWithValue("$json",JsonSerializer.Serialize(
                                (TitleInput)source.BusinessData));
                            target=(long)folder.ExecuteScalar()!;
                        }
                        int versions=0,newObjects=0;
                        foreach(var link in links)
                        {
                            linked.Token.ThrowIfCancellationRequested();
                            var copied=await NativeFileCopyStore.CopyAsync(
                                v.Db,workspace,link.FileId,
                                new NativeFileCopyInput(input.TargetWorkspace,target,
                                    workspace==input.TargetWorkspace?
                                        "reuse-content":"independent-content"),
                                linked.Token,tx);
                            versions+=copied.Versions;
                            newObjects+=copied.NewObjects;
                            using var metadata=v.Db.CreateCommand();
                            metadata.Transaction=tx;
                            metadata.CommandText="""
                                UPDATE folder_file_links SET display_name=$display,
                                    material_category=$category,position=$position
                                WHERE workspace=$w AND folder_id=$folder
                                    AND file_id=$file AND deleted=0;
                                """;
                            metadata.Parameters.AddWithValue("$w",input.TargetWorkspace);
                            metadata.Parameters.AddWithValue("$folder",target);
                            metadata.Parameters.AddWithValue("$file",copied.FileId);
                            metadata.Parameters.AddWithValue("$position",link.Position);
                            metadata.Parameters.AddWithValue("$display",
                                (object?)link.DisplayName??DBNull.Value);
                            metadata.Parameters.AddWithValue("$category",
                                (object?)link.MaterialCategory??DBNull.Value);
                            if(metadata.ExecuteNonQuery()!=1)
                                throw new IOException("目标原件关联未完整写入。");
                        }
                        if(input.Move)
                        {
                            using var deletion=v.Db.CreateCommand();
                            deletion.Transaction=tx;
                            deletion.CommandText="""
                                UPDATE folders SET deleted=1
                                WHERE id=$id AND workspace=$w AND kind='general'
                                  AND deleted=0;
                                """;
                            deletion.Parameters.AddWithValue("$id",id);
                            deletion.Parameters.AddWithValue("$w",workspace);
                            if(deletion.ExecuteNonQuery()!=1)
                                throw new IOException("原资料状态发生变化，转移已回滚。");
                        }
                        linked.Token.ThrowIfCancellationRequested();
                        tx.Commit();
                        return Results.Json(new NativeGeneralTransferResult(
                            id,target,workspace,input.TargetWorkspace,input.Move,
                            links.Count,versions,newObjects));
                    }
                    catch(ArgumentException e){return fail(e.Message,400);}
                    catch(InvalidDataException e){return fail(e.Message,409);}
                    catch(InvalidOperationException e){return fail(e.Message,409);}
                    catch(IOException e){return fail(e.Message,409);}
                    catch(OverflowException){return fail("原件大小超限。",409);}
                    catch(SqliteException){return fail("复制事务失败，所有修改已回滚。",409);}
                }
                finally{v.Gate.Release();}
            }
            finally{v.CompleteFileTask();}
        });
    }
}
