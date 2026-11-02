using System.Text.Json;
using Microsoft.Data.Sqlite;

// Native archive operations needed by the frozen card/table UI.
// Whole-file-history copy is always transactional.
static class NativeArchiveActionsEndpoints
{
    private static ResourceRef Folder(string w,string section,long id)=>
        ResourceRef.Create(w,FolderKinds.ArchiveFolder,id,section);

    // B02: the destination folder is named by id only. Directory names are
    // user-editable, so no lookup may depend on a Chinese default name.
    // Each rejection states the real reason so callers can correct the input.
    private static (int Status,string Message) TargetFolderError(SqliteConnection db,
        string workspace,string section,long id)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="SELECT workspace,kind,section,deleted FROM folders WHERE id=$id;";
        cmd.Parameters.AddWithValue("$id",id);
        using var reader=cmd.ExecuteReader();
        if(!reader.Read())return (404,"目标目录不存在。");
        string actualWorkspace=reader.GetString(0),kind=reader.GetString(1);
        string actualSection=reader.IsDBNull(2)?"":reader.GetString(2);
        bool deleted=reader.GetInt64(3)==1;
        if(kind!=FolderKinds.ArchiveFolder)return (400,"目标不是普通资料文件夹。");
        if(actualWorkspace!=workspace)
            return (400,"目标目录不属于目标工作区（实际属于 "+actualWorkspace+"）。");
        if(actualSection!=section)
            return (400,"目标目录不属于目标资料类别（实际为 "+actualSection+"）。");
        if(deleted)return (409,"目标目录已在回收站，请先恢复后再转移。");
        return (0,"");
    }

    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ui/archive/{workspace}/{section}/{id:long}/transfer",async(
            HttpContext ctx,Vault v,string workspace,string section,long id,
            ArchiveTransfer input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            var from=ArchiveRules.Module(workspace,section);
            var to=ArchiveRules.Module(input.TargetWorkspace,input.TargetSection);
            if(from is null||from!=to)return fail(
                "目标资料类别不兼容：科研成果可在 company/achievement 与 personal/achievement、personal/academic 之间转移；certificate 不支持跨工作区转移。",400);
            if(input.Move&&workspace==input.TargetWorkspace&&
                section==input.TargetSection)
                return fail("同一工作区同类别无需转移。",400);
            if(!v.TryBeginFileTask(ctx,out var aborted))
                return fail("文件任务正在执行或程序正在退出。",409);
            try
            {
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    ctx.RequestAborted,aborted);
                if(!await v.Gate.WaitAsync(0,linked.Token))
                    return fail("当前数据库有文件任务。",409);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    var source=NativeArchiveStore.Get(v.Db,Folder(workspace,section,id));
                    if(source is null)return Results.NotFound();
                    var material=(ArchiveFolderInput)source.BusinessData;
                    using(var children=v.Db.CreateCommand())
                    {
                        children.CommandText="""
                            SELECT count(*) FROM folders WHERE workspace=$w
                              AND kind='archive_folder' AND parent_id=$id AND deleted=0;
                            """;
                        children.Parameters.AddWithValue("$w",workspace);
                        children.Parameters.AddWithValue("$id",id);
                        if((long)children.ExecuteScalar()!>0)return fail(
                            "该资料下还有子文件夹，请先把子文件夹移出后再转移。",409);
                    }
                    var links=NativeFileLinkStore.ListFolder(v.Db,workspace,id,false)!;
                    long needed=0;
                    if(workspace!=input.TargetWorkspace)
                        foreach(long file in links.Select(x=>x.FileId).Distinct())
                            needed=checked(needed+NativeFileCopyStore.EstimateIndependentBytes(
                                v.Db,workspace,file));
                    if(needed>0)
                    {
                        var free=new DriveInfo(Path.GetPathRoot(v.Path)!).AvailableFreeSpace;
                        if(free<checked(needed+Math.Max(128L*1024*1024,needed/3)))
                            return fail("目标工作区所在磁盘空间不足。",507);
                    }
                    long? parent=null;
                    if(input.TargetFolderId is long explicitTarget)
                    {
                        if(explicitTarget<=0)return fail("目标目录编号无效。",400);
                        if(explicitTarget==id&&workspace==input.TargetWorkspace)
                            return fail("不能把资料转移到它自己。",400);
                        var (status,message)=TargetFolderError(v.Db,input.TargetWorkspace,
                            input.TargetSection,explicitTarget);
                        if(status!=0)return fail(message,status);
                        parent=explicitTarget;
                    }
                    else if(input.TargetWorkspace=="company"&&
                        input.TargetSection=="achievement")
                        /* 业务档案资料必须归属具体分类目录；没有显式目标就拒绝，
                           绝不再按名称猜测"其他业务资料"。 */
                        return fail("公司业务档案必须明确指定目标分类目录 targetFolderId。",400);
                    linked.Token.ThrowIfCancellationRequested();
                    using var tx=v.Db.BeginTransaction();
                    long copied;
                    using(var cmd=v.Db.CreateCommand())
                    {
                        cmd.Transaction=tx;
                        cmd.CommandText="""
                            INSERT INTO folders(workspace,kind,section,parent_id,name,
                                attributes_json,position)
                            VALUES($w,'archive_folder',$section,$parent,$name,$json,
                                (SELECT COALESCE(MAX(position),-1)+1 FROM folders
                                WHERE workspace=$w AND kind='archive_folder'
                                  AND section=$section AND deleted=0
                                  AND COALESCE(parent_id,0)=COALESCE($parent,0)));
                            SELECT last_insert_rowid();
                            """;
                        cmd.Parameters.AddWithValue("$w",input.TargetWorkspace);
                        cmd.Parameters.AddWithValue("$section",input.TargetSection);
                        cmd.Parameters.AddWithValue("$parent",(object?)parent??DBNull.Value);
                        cmd.Parameters.AddWithValue("$name",NativeArchiveStore.UniqueName(v.Db,tx,
                            input.TargetWorkspace,input.TargetSection,parent,
                            source.Folder.Name));
                        cmd.Parameters.AddWithValue("$json",JsonSerializer.Serialize(
                            material with {Name=source.Folder.Name,ParentId=parent}));
                        copied=(long)cmd.ExecuteScalar()!;
                    }
                    int versions=0;
                    foreach(var link in links)
                    {
                        linked.Token.ThrowIfCancellationRequested();
                        var data=await NativeFileCopyStore.CopyAsync(v.Db,workspace,
                            link.FileId,new NativeFileCopyInput(input.TargetWorkspace,
                                copied,workspace==input.TargetWorkspace
                                ?"reuse-content":"independent-content"),linked.Token,tx);
                        versions+=data.Versions;
                        using var cmd=v.Db.CreateCommand();
                        cmd.Transaction=tx;
                        cmd.CommandText="""
                            UPDATE folder_file_links SET display_name=$display,
                                material_category=$category,position=$position
                            WHERE workspace=$w AND folder_id=$folder AND file_id=$file
                              AND deleted=0;
                            """;
                        cmd.Parameters.AddWithValue("$display",
                            (object?)link.DisplayName??DBNull.Value);
                        cmd.Parameters.AddWithValue("$category",
                            (object?)link.MaterialCategory??DBNull.Value);
                        cmd.Parameters.AddWithValue("$position",link.Position);
                        cmd.Parameters.AddWithValue("$w",input.TargetWorkspace);
                        cmd.Parameters.AddWithValue("$folder",copied);
                        cmd.Parameters.AddWithValue("$file",data.FileId);
                        if(cmd.ExecuteNonQuery()!=1)
                            throw new IOException("目标原件关联复制不完整。");
                    }
                    if(input.Move)
                    {
                        using var cmd=v.Db.CreateCommand();
                        cmd.Transaction=tx;
                        cmd.CommandText="""
                            UPDATE folders SET deleted=1
                            WHERE id=$id AND workspace=$w AND kind='archive_folder'
                              AND section=$section AND deleted=0;
                            """;
                        cmd.Parameters.AddWithValue("$id",id);
                        cmd.Parameters.AddWithValue("$w",workspace);
                        cmd.Parameters.AddWithValue("$section",section);
                        if(cmd.ExecuteNonQuery()!=1)
                            throw new IOException("来源资料状态已变化，操作已回滚。");
                    }
                    linked.Token.ThrowIfCancellationRequested();
                    tx.Commit();
                    return Results.Json(new{id=copied,files=links.Count,versions});
                }
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(InvalidOperationException ex){return fail(ex.Message,409);}
                catch(InvalidDataException ex){return fail(ex.Message,409);}
                catch(IOException ex){return fail(ex.Message,409);}
                catch(SqliteException){return fail("事务执行失败，资料未发生部分转移。",409);}
                finally{v.Gate.Release();}
            }
            finally{v.CompleteFileTask();}
        });
    }
}
