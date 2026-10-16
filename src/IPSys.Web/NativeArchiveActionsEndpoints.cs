using System.Text.Json;
using Microsoft.Data.Sqlite;

// Native archive operations needed by the frozen card/table UI.
// Folder conversion and whole-file-history copy are always transactional.
static class NativeArchiveActionsEndpoints
{
    private static ResourceRef Archive(string w,string section,long id)=>
        ResourceRef.Create(w,FolderKinds.Archive,id,section);

    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ui/archive/company/achievement/{id:long}/expand",async(
            HttpContext ctx,Vault v,long id)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                var source=NativeArchiveStore.Get(v.Db,Archive("company","achievement",id));
                if(source is null)return Results.NotFound();
                long? parent=source.Folder.Parent?.Id;
                if(parent is null)return fail("资料须先归入具体业务档案目录。",400);
                using var tx=v.Db.BeginTransaction();
                long folder;
                using(var cmd=v.Db.CreateCommand())
                {
                    cmd.Transaction=tx;
                    cmd.CommandText="""
                        INSERT INTO folders(workspace,kind,section,parent_id,name,
                            attributes_json,position)
                        VALUES('company','archive_folder','achievement',$parent,$name,
                            $json,(SELECT COALESCE(MAX(position),-1)+1 FROM folders
                              WHERE workspace='company' AND section='achievement'
                                AND COALESCE(parent_id,0)=$parent AND deleted=0));
                        SELECT last_insert_rowid();
                        """;
                    cmd.Parameters.AddWithValue("$parent",parent.Value);
                    cmd.Parameters.AddWithValue("$name",source.Folder.Name);
                    cmd.Parameters.AddWithValue("$json",JsonSerializer.Serialize(
                        new ArchiveFolderInput(source.Folder.Name,parent)));
                    folder=(long)cmd.ExecuteScalar()!;
                }
                using(var cmd=v.Db.CreateCommand())
                {
                    cmd.Transaction=tx;
                    cmd.CommandText="""
                        UPDATE folders SET parent_id=$parent,attributes_json=$json,
                            position=0 WHERE workspace='company' AND id=$id
                            AND kind='archive' AND section='achievement' AND deleted=0
                            AND parent_id=$old;
                        """;
                    cmd.Parameters.AddWithValue("$id",id);
                    cmd.Parameters.AddWithValue("$parent",folder);
                    cmd.Parameters.AddWithValue("$old",parent.Value);
                    cmd.Parameters.AddWithValue("$json",JsonSerializer.Serialize(
                        ((ArchiveInput)source.BusinessData) with {FolderId=folder}));
                    if(cmd.ExecuteNonQuery()!=1)
                        throw new IOException("归档记录状态已变化，已回滚。");
                }
                tx.Commit();
                return Results.Json(new{id=folder});
            }
            catch(SqliteException){return fail("目录名称冲突或资料状态已变化。",409);}
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/ui/archive/{workspace}/{section}/{id:long}/transfer",async(
            HttpContext ctx,Vault v,string workspace,string section,long id,
            ArchiveTransfer input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            var from=ArchiveRules.Module(workspace,section);
            var to=ArchiveRules.Module(input.TargetWorkspace,input.TargetSection);
            if(from is null||from!=to)return fail("目标资料类别不兼容。",400);
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
                    var source=NativeArchiveStore.Get(v.Db,Archive(workspace,section,id));
                    if(source is null)return Results.NotFound();
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
                    var archive=(ArchiveInput)source.BusinessData;
                    long? parent=null;
                    if(input.TargetWorkspace=="company"&&input.TargetSection=="achievement")
                    {
                        if(workspace=="company"&&section=="achievement")
                            parent=source.Folder.Parent?.Id;
                        else
                        {
                            var roots=NativeArchiveStore.List(v.Db,"company",
                                FolderKinds.ArchiveFolder,"achievement")
                                .Where(x=>x.Folder.Parent is null).ToArray();
                            parent=(roots.FirstOrDefault(x=>
                                string.Equals(x.Folder.Name,archive.Category,
                                    StringComparison.OrdinalIgnoreCase))
                                ??roots.First(x=>x.Folder.Name=="其他业务资料"))
                                .Folder.Ref.Id;
                        }
                        if(parent is null)
                            return fail("目标业务档案没有可用分类。",409);
                    }
                    linked.Token.ThrowIfCancellationRequested();
                    using var tx=v.Db.BeginTransaction();
                    long copied;
                    using(var cmd=v.Db.CreateCommand())
                    {
                        cmd.Transaction=tx;
                        cmd.CommandText="""
                            INSERT INTO folders(workspace,kind,section,parent_id,name,
                                attributes_json,position)
                            VALUES($w,'archive',$section,$parent,$name,$json,
                                (SELECT COALESCE(MAX(position),-1)+1 FROM folders
                                WHERE workspace=$w AND kind='archive'
                                  AND section=$section AND deleted=0));
                            SELECT last_insert_rowid();
                            """;
                        cmd.Parameters.AddWithValue("$w",input.TargetWorkspace);
                        cmd.Parameters.AddWithValue("$section",input.TargetSection);
                        cmd.Parameters.AddWithValue("$parent",(object?)parent??DBNull.Value);
                        cmd.Parameters.AddWithValue("$name",source.Folder.Name);
                        cmd.Parameters.AddWithValue("$json",JsonSerializer.Serialize(
                            archive with {FolderId=parent}));
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
                            WHERE id=$id AND workspace=$w AND kind='archive'
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
