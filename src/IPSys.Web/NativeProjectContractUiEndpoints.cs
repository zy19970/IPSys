record NativeProjectContractOrderInput(long[] Ids);
// N2-03-07: the frozen project/contract ledgers use the SAME FolderId,
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
               kind is not (FolderKinds.Project or FolderKinds.Contract))
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

        app.MapPost("/api/v2/ui/contracts/{workspace}/{id:long}/copy",async(
            HttpContext ctx,Vault v,string workspace,long id)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return fail("工作区无效。",400);
            if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
                var record=NativeFolderStore.Get(v.Db,
                    ResourceRef.Create(workspace,FolderKinds.Contract,id));
                if(record is null || record.Folder.Parent is not ResourceRef parent)
                    return Results.NotFound();
                using var tx=v.Db.BeginTransaction();
                long copiedId;
                using(var folder=v.Db.CreateCommand())
                {
                    folder.Transaction=tx;
                    folder.CommandText="""
                        INSERT INTO folders(workspace,kind,name,parent_id,
                            position,attributes_json)
                        VALUES($w,'contract',$name,$parent,
                            (SELECT COALESCE(MAX(position),-1)+1 FROM folders
                             WHERE workspace=$w AND kind='contract' AND deleted=0),
                            $json);
                        SELECT last_insert_rowid();
                        """;
                    folder.Parameters.AddWithValue("$w",workspace);
                    folder.Parameters.AddWithValue("$name",record.Folder.Name);
                    folder.Parameters.AddWithValue("$parent",parent.Id);
                    folder.Parameters.AddWithValue("$json",
                        System.Text.Json.JsonSerializer.Serialize(
                            (ContractInput)record.BusinessData));
                    copiedId=(long)folder.ExecuteScalar()!;
                }
                using(var links=v.Db.CreateCommand())
                {
                    links.Transaction=tx;
                    links.CommandText="""
                        INSERT INTO folder_file_links(workspace,folder_id,file_id,
                            display_name,material_category,position)
                        SELECT workspace,$new,file_id,display_name,
                            material_category,position
                        FROM folder_file_links WHERE workspace=$w
                          AND folder_id=$source AND deleted=0;
                        """;
                    links.Parameters.AddWithValue("$w",workspace);
                    links.Parameters.AddWithValue("$source",id);
                    links.Parameters.AddWithValue("$new",copiedId);
                    links.ExecuteNonQuery();
                }
                tx.Commit();
                return Results.Json(new{id=copiedId});
            }
            finally{v.Gate.Release();}
        });

        app.MapGet("/api/v2/ui/projects/{workspace}",(
            HttpContext ctx,Vault v,string workspace)=>
            Read(ctx,v,workspace,db=>Results.Json(
                NativeFolderStore.List(db,workspace,FolderKinds.Project)
                .Select(x=>new {
                    id=x.Folder.Ref.Id,workspace,
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

        app.MapGet("/api/v2/ui/contracts/{workspace}",(
            HttpContext ctx,Vault v,string workspace)=>
            Read(ctx,v,workspace,db=>
            {
                var names=NativeFolderStore.List(db,workspace,FolderKinds.Project)
                    .ToDictionary(x=>x.Folder.Ref.Id,x=>x.Folder.Name);
                return Results.Json(
                    NativeFolderStore.List(db,workspace,FolderKinds.Contract)
                    .Where(x=>x.Folder.Parent is ResourceRef p &&
                        names.ContainsKey(p.Id))
                    .Select(x=>new {
                        id=x.Folder.Ref.Id,
                        projectId=x.Folder.Parent!.Value.Id,workspace,
                        projectName=names[x.Folder.Parent.Value.Id],
                        name=((ContractInput)x.BusinessData).Name,
                        contractNo=((ContractInput)x.BusinessData).ContractNo,
                        signDate=((ContractInput)x.BusinessData).SignDate,
                        amount=((ContractInput)x.BusinessData).Amount,
                        signingParties=((ContractInput)x.BusinessData).SigningParties,
                        category=((ContractInput)x.BusinessData).Category,
                        remarks=((ContractInput)x.BusinessData).Remarks,
                        tags=((ContractInput)x.BusinessData).Tags
                    }).ToArray());
            }));

        app.MapGet("/api/v2/ui/project-files/{workspace}",(
            HttpContext ctx,Vault v,string workspace)=>
            Read(ctx,v,workspace,db=>
            {
                var result=new List<object>();
                foreach(string kind in new[]{FolderKinds.Project,FolderKinds.Contract})
                foreach(var folder in NativeFolderStore.List(db,workspace,kind))
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
                                kind,version=version.Version,
                                name=version.OriginalName,
                                displayName=link.DisplayName??link.FileName,
                                category=link.MaterialCategory??"",
                                size=version.Size,sha256=version.Sha256
                            });
                    }
                }
                return Results.Json(result);
            }));
    }
}
