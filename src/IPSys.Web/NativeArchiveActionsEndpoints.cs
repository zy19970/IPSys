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
        if(kind!=FolderKinds.ArchiveFolder &&
           !(kind==FolderKinds.Project && section=="project"))
            return (400,"目标不是普通资料文件夹或项目。");
        if(actualWorkspace!=workspace)
            return (400,"目标目录不属于目标工作区（实际属于 "+actualWorkspace+"）。");
        if(kind==FolderKinds.ArchiveFolder && actualSection!=section)
            return (400,"目标目录不属于目标资料类别（实际为 "+actualSection+"）。");
        if(deleted)return (409,"目标目录已在回收站，请先恢复后再转移。");
        return (0,"");
    }

    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ui/folders/{workspace}/{section}/{id:long}/transfer",async(
            HttpContext ctx,Vault v,string workspace,string section,long id,
            FolderTransfer input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!ArchiveDirectoryScopes.Allowed(workspace,section) ||
               !ArchiveDirectoryScopes.Allowed(input.TargetWorkspace,input.TargetSection))
                return fail("资料模块与工作区不匹配。",400);
            var from=section=="general"?"general":ArchiveRules.Module(workspace,section);
            var to=input.TargetSection=="general"?"general":ArchiveRules.Module(input.TargetWorkspace,input.TargetSection);
            if(from is null||from!=to)return fail(
                "目标资料类别不兼容，请确认来源与目标模块的允许转移范围。",400);
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
                    // Source and destination folders are resolved before any
                    // write. The shared helper snapshots the full subtree and
                    // commits all folders, links and versions atomically.
                    long? parent=null;
                    if(input.TargetSection=="project" && input.TargetFolderId is null)
                        return fail("转入项目内部必须指定目标项目或其下级文件夹。",400);
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
                    var copied=await NativeFolderTreeTransfer.CopyAsync(v.Db,v.Path,
                        workspace,section,id,input.TargetWorkspace,
                        input.TargetSection,parent,input.Move,linked.Token);
                    return Results.Json(new{id=copied.Id,folders=copied.Folders,
                        files=copied.Files,versions=copied.Versions,
                        newObjects=copied.NewObjects});
                }
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(InvalidOperationException ex){return fail(ex.Message,409);}
                catch(InvalidDataException ex){return fail(ex.Message,409);}
                catch(IOException ex){return fail(ex.Message,409);}
                catch(OverflowException){return fail("原件大小超限。",409);}
                catch(SqliteException){return fail("事务执行失败，资料未发生部分转移。",409);}
                finally{v.Gate.Release();}
            }
            finally{v.CompleteFileTask();}
        });
    }
}
