record NativeIpUiOrderInput(long[] Ids);
// N2-03-04: supply the frozen IP table/detail with V2 FolderId + FileId rows.
static class NativeIpUiEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ui/ip/{workspace}/order",async(
            HttpContext ctx,Vault v,string workspace,NativeIpUiOrderInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return fail("工作区无效。",400);
            if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
                var current=NativeFolderStore.List(v.Db,workspace,FolderKinds.Ip)
                    .Select(x=>x.Folder.Ref.Id).ToArray();
                if(input.Ids is null || input.Ids.Length!=current.Length ||
                   input.Ids.Distinct().Count()!=current.Length ||
                   !input.Ids.Order().SequenceEqual(current.Order()))
                    return fail("排序必须包含当前工作区所有知识产权记录。",409);
                using var tx=v.Db.BeginTransaction();
                for(int i=0;i<input.Ids.Length;i++)
                {
                    using var cmd=v.Db.CreateCommand();
                    cmd.Transaction=tx;
                    cmd.CommandText="""
                        UPDATE folders SET position=$position
                        WHERE id=$id AND workspace=$w AND kind='ip' AND deleted=0;
                        """;
                    cmd.Parameters.AddWithValue("$position",i);
                    cmd.Parameters.AddWithValue("$id",input.Ids[i]);
                    cmd.Parameters.AddWithValue("$w",workspace);
                    if(cmd.ExecuteNonQuery()!=1)throw new IOException("知识产权排序已发生变化。");
                }
                tx.Commit();
                return Results.Ok(new{ok=true});
            }
            finally{v.Gate.Release();}
        });
        app.MapGet("/api/v2/ui/ip/{workspace}",async(HttpContext ctx,Vault v,string workspace)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return fail("工作区无效。",400);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                var folders=NativeFolderStore.List(v.Db,workspace,FolderKinds.Ip);
                var rows=folders.Select(x=>new
                {
                    id=x.Folder.Ref.Id,workspace,data=x.BusinessData
                }).ToArray();
                var files=new List<object>();
                foreach(var f in folders)
                {
                    long ipId=f.Folder.Ref.Id;
                    foreach(var link in NativeFileLinkStore.ListFolder(v.Db,workspace,ipId,false)??[])
                    {
                        var details=NativeFileStore.Get(v.Db,workspace,link.FileId);
                        if(details is null)continue;
                        foreach(var version in details.Versions)
                            files.Add(new {
                                linkId=link.Id,folderId=ipId,fileId=link.FileId,
                                version=version.Version,
                                name=version.OriginalName,
                                category=link.MaterialCategory??"",
                                size=version.Size,sha256=version.Sha256,
                                displayName=link.DisplayName??link.FileName
                            });
                    }
                }
                return Results.Json(new{rows,files});
            }
            finally{v.Gate.Release();}
        });
    }
}
