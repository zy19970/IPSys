using System.Text.Json;
using Microsoft.Data.Sqlite;

// F2-04: A contract always belongs to an existing project. Reparenting within
// one workspace preserves its FolderId and LinkIds; cross-workspace transfer
// clones the complete FileId/Version chain and independent physical objects.
record NativeContractTransferInput(string TargetWorkspace,long TargetProjectId,bool Move=false);
record NativeContractTransferResult(long SourceId,long Id,string SourceWorkspace,
    string TargetWorkspace,bool Moved,int Links,int Versions,int NewObjects);

static class NativeContractTransferEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/contracts/{workspace}/{id:long}/transfer",async(
            HttpContext ctx,Vault v,string workspace,long id,
            NativeContractTransferInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace)||
               !Vault.WorkspaceValid(input.TargetWorkspace)||
               id<=0||input.TargetProjectId<=0)
                return fail("工作区、合同或目标项目无效。",400);
            if(!v.TryBeginFileTask(ctx,out var aborted))
                return fail("有文件任务正在执行或程序正在退出。",409);
            try
            {
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    ctx.RequestAborted,aborted);
                if(!await v.Gate.WaitAsync(0,linked.Token))
                    return fail("数据库繁忙，请稍后重试。",409);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    try
                    {
                        var source=NativeFolderStore.Get(v.Db,ResourceRef.Create(
                            workspace,FolderKinds.Contract,id));
                        if(source is null)return Results.NotFound();
                        var targetProject=NativeFolderStore.Get(v.Db,ResourceRef.Create(
                            input.TargetWorkspace,FolderKinds.Project,input.TargetProjectId));
                        if(targetProject is null)return fail("目标项目不存在或已经删除。",404);
                        long originProject=source.Folder.Parent?.Id??0;
                        if(workspace==input.TargetWorkspace && originProject==input.TargetProjectId)
                            return fail("合同已经属于目标项目。",409);

                        var links=NativeFileLinkStore.ListFolder(v.Db,workspace,id,false)!;
                        if(workspace!=input.TargetWorkspace)
                        {
                            long required=0;
                            foreach(long file in links.Select(x=>x.FileId).Distinct())
                                required=checked(required+NativeFileCopyStore.EstimateIndependentBytes(
                                    v.Db,workspace,file));
                            if(required>0)
                            {
                                var free=new DriveInfo(Path.GetPathRoot(v.Path)!).AvailableFreeSpace;
                                if(free<checked(required+Math.Max(128L*1024*1024,required/3)))
                                    return fail("磁盘空间不足以复制合同全部原件历史。",507);
                            }
                        }

                        linked.Token.ThrowIfCancellationRequested();
                        using var tx=v.Db.BeginTransaction();
                        // Same-workspace moves are pure folder reparenting:
                        // no fresh file metadata, no new link and no original deletion.
                        if(input.Move && workspace==input.TargetWorkspace)
                        {
                            using var move=v.Db.CreateCommand();
                            move.Transaction=tx;
                            move.CommandText="""
                                UPDATE folders SET parent_id=$target
                                WHERE id=$id AND workspace=$w AND kind='contract'
                                  AND parent_id=$old AND deleted=0;
                                """;
                            move.Parameters.AddWithValue("$target",input.TargetProjectId);
                            move.Parameters.AddWithValue("$id",id);
                            move.Parameters.AddWithValue("$w",workspace);
                            move.Parameters.AddWithValue("$old",originProject);
                            if(move.ExecuteNonQuery()!=1)
                                return fail("合同所属项目状态变化，移动已回滚。",409);
                            linked.Token.ThrowIfCancellationRequested();
                            tx.Commit();
                            return Results.Json(new NativeContractTransferResult(id,id,workspace,
                                input.TargetWorkspace,true,links.Count,0,0));
                        }

                        long target;
                        using(var folder=v.Db.CreateCommand())
                        {
                            folder.Transaction=tx;
                            folder.CommandText="""
                                INSERT INTO folders(workspace,kind,parent_id,name,
                                    attributes_json,position)
                                VALUES($w,'contract',$parent,$name,$attrs,0);
                                SELECT last_insert_rowid();
                                """;
                            folder.Parameters.AddWithValue("$w",input.TargetWorkspace);
                            folder.Parameters.AddWithValue("$parent",input.TargetProjectId);
                            folder.Parameters.AddWithValue("$name",source.Folder.Name);
                            folder.Parameters.AddWithValue("$attrs",JsonSerializer.Serialize(
                                (ContractInput)source.BusinessData));
                            target=(long)folder.ExecuteScalar()!;
                        }
                        var mapped=new Dictionary<long,long>();
                        int versions=0,objects=0;
                        foreach(var link in links)
                        {
                            linked.Token.ThrowIfCancellationRequested();
                            if(!mapped.TryGetValue(link.FileId,out long targetFile))
                            {
                                var copy=await NativeFileCopyStore.CopyAsync(v.Db,workspace,
                                    link.FileId,new NativeFileCopyInput(input.TargetWorkspace,
                                        target,workspace==input.TargetWorkspace?
                                        "reuse-content":"independent-content"),linked.Token,tx);
                                targetFile=copy.FileId;
                                mapped[link.FileId]=targetFile;
                                versions+=copy.Versions;
                                objects+=copy.NewObjects;
                                using var update=v.Db.CreateCommand();
                                update.Transaction=tx;
                                update.CommandText="""
                                    UPDATE folder_file_links SET display_name=$display,
                                      material_category=$category,position=$position
                                    WHERE workspace=$w AND folder_id=$folder
                                      AND file_id=$file AND deleted=0;
                                    """;
                                update.Parameters.AddWithValue("$display",
                                    (object?)link.DisplayName??DBNull.Value);
                                update.Parameters.AddWithValue("$category",
                                    (object?)link.MaterialCategory??DBNull.Value);
                                update.Parameters.AddWithValue("$position",link.Position);
                                update.Parameters.AddWithValue("$w",input.TargetWorkspace);
                                update.Parameters.AddWithValue("$folder",target);
                                update.Parameters.AddWithValue("$file",targetFile);
                                if(update.ExecuteNonQuery()!=1)
                                    throw new IOException("目标合同原件关联写入不完整。");
                            }
                            else
                            {
                                using var extra=v.Db.CreateCommand();
                                extra.Transaction=tx;
                                extra.CommandText="""
                                    INSERT INTO folder_file_links(workspace,folder_id,file_id,
                                      display_name,material_category,position)
                                    VALUES($w,$folder,$file,$display,$category,$position);
                                    """;
                                extra.Parameters.AddWithValue("$w",input.TargetWorkspace);
                                extra.Parameters.AddWithValue("$folder",target);
                                extra.Parameters.AddWithValue("$file",targetFile);
                                extra.Parameters.AddWithValue("$display",
                                    (object?)link.DisplayName??DBNull.Value);
                                extra.Parameters.AddWithValue("$category",
                                    (object?)link.MaterialCategory??DBNull.Value);
                                extra.Parameters.AddWithValue("$position",link.Position);
                                extra.ExecuteNonQuery();
                            }
                        }
                        if(input.Move)
                        {
                            using var deletion=v.Db.CreateCommand();
                            deletion.Transaction=tx;
                            deletion.CommandText="""
                                UPDATE folders SET deleted=1
                                WHERE id=$id AND workspace=$w AND kind='contract'
                                  AND parent_id=$parent AND deleted=0;
                                """;
                            deletion.Parameters.AddWithValue("$id",id);
                            deletion.Parameters.AddWithValue("$w",workspace);
                            deletion.Parameters.AddWithValue("$parent",originProject);
                            if(deletion.ExecuteNonQuery()!=1)
                                throw new IOException("来源合同状态发生变化，转移已回滚。");
                        }
                        linked.Token.ThrowIfCancellationRequested();
                        tx.Commit();
                        return Results.Json(new NativeContractTransferResult(id,target,workspace,
                            input.TargetWorkspace,input.Move,links.Count,versions,objects));
                    }
                    catch(ArgumentException e){return fail(e.Message,400);}
                    catch(KeyNotFoundException){return Results.NotFound();}
                    catch(InvalidDataException e){return fail(e.Message,409);}
                    catch(InvalidOperationException e){return fail(e.Message,409);}
                    catch(IOException e){return fail(e.Message,409);}
                    catch(OverflowException){return fail("原件大小超出安全限制。",409);}
                    catch(SqliteException){return fail("合同转移事务失败，已回滚所有修改。",409);}
                    catch(OperationCanceledException){return fail("合同转移已取消。",409);}
                }
                finally{v.Gate.Release();}
            }
            finally{v.CompleteFileTask();}
        });
    }
}
