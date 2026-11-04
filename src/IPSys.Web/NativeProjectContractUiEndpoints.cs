record NativeProjectContractOrderInput(long[] Ids);
// N2-03-07: the project ledger use the SAME FolderId,
// FileId and LinkId as the V2 Folder/File/MCP APIs. No legacy table reads.
static class NativeProjectContractUiEndpoints
{
    private static async Task<IResult> Read(HttpContext ctx,Vault v,string workspace,
        Func<Microsoft.Data.Sqlite.SqliteConnection,IResult> build)
    {
        if(!v.Allowed(ctx))return Results.Unauthorized();
        if(!Vault.WorkspaceValid(workspace))return Results.BadRequest();
        await v.Gate.WaitAsync(ctx.RequestAborted);
        try
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            return build(v.Db);
        }
        finally{v.Gate.Release();}
    }

    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ui/order/{workspace}/{kind}",async(
            HttpContext ctx,Vault v,string workspace,string kind,
            NativeProjectContractOrderInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace) ||
               kind!=FolderKinds.Project)
                return fail("无效工作区或排序类型。",400);
            if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
                var original=NativeFolderStore.List(v.Db,workspace,kind)
                    .Select(x=>x.Folder.Ref.Id).ToArray();
                var chosen=input.Ids??[];
                if(chosen.Length==0 || chosen.Distinct().Count()!=chosen.Length ||
                   chosen.Except(original).Any())
                    return fail("排序中存在无效或重复记录。",409);
                var selected=new HashSet<long>(chosen);
                var queue=new Queue<long>(chosen);
                var ordered=original.Select(id=>selected.Contains(id)?queue.Dequeue():id)
                    .ToArray();
                using var tx=v.Db.BeginTransaction();
                for(int i=0;i<ordered.Length;i++)
                {
                    using var cmd=v.Db.CreateCommand();
                    cmd.Transaction=tx;
                    cmd.CommandText="""
                        UPDATE folders SET position=$position
                        WHERE workspace=$w AND kind=$kind AND deleted=0 AND id=$id;
                        """;
                    cmd.Parameters.AddWithValue("$position",i);
                    cmd.Parameters.AddWithValue("$w",workspace);
                    cmd.Parameters.AddWithValue("$kind",kind);
                    cmd.Parameters.AddWithValue("$id",ordered[i]);
                    if(cmd.ExecuteNonQuery()!=1)
                        throw new IOException("排序时资料状态发生变化。");
                }
                tx.Commit();
                return Results.Ok(new{ok=true});
            }
            finally{v.Gate.Release();}
        });

        app.MapGet("/api/v2/ui/projects/{workspace}",(
            HttpContext ctx,Vault v,string workspace)=>
            Read(ctx,v,workspace,db=>Results.Json(
                NativeFolderStore.List(db,workspace,FolderKinds.Project)
                .Select(x=>new {
                    id=x.Folder.Ref.Id,workspace,
                    modifiedAt=x.Folder.ModifiedAt,
                    name=((ProjectInput)x.BusinessData).Name,
                    projectType=((ProjectInput)x.BusinessData).ProjectType,
                    projectNo=((ProjectInput)x.BusinessData).ProjectNo,
                    leader=((ProjectInput)x.BusinessData).Leader,
                    undertakingOrg=((ProjectInput)x.BusinessData).UndertakingOrg,
                    startDate=((ProjectInput)x.BusinessData).StartDate,
                    endDate=((ProjectInput)x.BusinessData).EndDate,
                    projectStatus=((ProjectInput)x.BusinessData).ProjectStatus,
                    category=((ProjectInput)x.BusinessData).Category,
                    remarks=((ProjectInput)x.BusinessData).Remarks,
                    tags=((ProjectInput)x.BusinessData).Tags
                }).ToArray())));

        app.MapGet("/api/v2/ui/project-files/{workspace}",(
            HttpContext ctx,Vault v,string workspace)=>
            Read(ctx,v,workspace,db=>
            {
                var result=new List<object>();
                foreach(var folder in NativeFolderStore.List(db,workspace,FolderKinds.Project))
                {
                    long ownerId=folder.Folder.Ref.Id;
                    foreach(var link in NativeFileLinkStore.ListFolder(
                        db,workspace,ownerId,false)??[])
                    {
                        var file=NativeFileStore.Get(db,workspace,link.FileId);
                        if(file is null)continue;
                        foreach(var version in file.Versions)
                            result.Add(new {
                                linkId=link.Id,fileId=link.FileId,folderId=ownerId,
                                kind=FolderKinds.Project,version=version.Version,
                                name=version.OriginalName,
                                displayName=link.DisplayName??link.FileName,
                                category=link.MaterialCategory??"",
                                size=version.Size,sha256=version.Sha256,
                                modifiedAt=version.CreatedAt
                            });
                    }
                }
                return Results.Json(result);
            }));
    }
}
