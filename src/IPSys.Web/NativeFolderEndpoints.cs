using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

record NativeFolderMoveInput(long? ParentId);

// N2-01/N2-02: native v2 endpoints; keep existing UI attachment routes on the old path
// until the File service and business endpoints can switch together.
static class NativeFolderEndpoints
{
    private static ResourceRef Ref(string w,string kind,long id,string? section) =>
        new(w,kind,id,kind==FolderKinds.ArchiveFolder?"achievement":section??"");

    private static string FolderConstraintMessage(
        Microsoft.Data.Sqlite.SqliteException ex,string kind)
    {
        // SQLITE_CONSTRAINT_UNIQUE on idx_archive_sibling_names is a
        // same-parent, case-insensitive duplicate; do not expose code 19.
        if(kind==FolderKinds.ArchiveFolder && ex.SqliteExtendedErrorCode==2067)
            return "同一目录下已存在同名目录，请修改目录名称。";
        // Other triggers/foreign-key violations have different causes; do
        // not misreport every constraint violation as a duplicate name.
        return "资料结构约束不允许此操作，请检查名称、父级目录和文件关联。";
    }

    public static void Map(WebApplication app, Func<string,int,IResult> fail)
    {
        IResult Bad(string text,int status=400)=>fail(text,status);

        app.MapGet("/api/v2/folders/{workspace}/{kind}",async (
            HttpContext ctx,Vault v,string workspace,string kind,long? projectId,long? parentId,string? section)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try
                {
                    if(NativeArchiveStore.Handles(kind))
                    {
                        if(projectId.HasValue) return Bad("该资料类别不使用 projectId。");
                        return Results.Json(NativeArchiveStore.List(v.Db,workspace,kind,section,parentId));
                    }
                    if(parentId.HasValue || !string.IsNullOrEmpty(section))
                        return Bad("该业务模块不使用资料目录参数。");
                    return Results.Json(NativeFolderStore.List(v.Db,workspace,kind,projectId));
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(InvalidOperationException ex){return Bad(ex.Message,409);}
                catch(Microsoft.Data.Sqlite.SqliteException ex){return Bad(FolderConstraintMessage(ex,kind),409);}
                catch(KeyNotFoundException){return Results.NotFound();}
            }
            finally{v.Gate.Release();}
        });

        app.MapGet("/api/v2/folders/{workspace}/{kind}/{id:long}",async (
            HttpContext ctx,Vault v,string workspace,string kind,long id,string? section)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try
                {
                    var reference=Ref(workspace,kind,id,section);
                    var result=NativeArchiveStore.Handles(kind)
                        ?NativeArchiveStore.Get(v.Db,reference)
                        :NativeFolderStore.Get(v.Db,reference);
                    return result is null?Results.NotFound():Results.Json(result);
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(InvalidOperationException ex){return Bad(ex.Message,409);}
                catch(Microsoft.Data.Sqlite.SqliteException ex){return Bad(FolderConstraintMessage(ex,kind),409);}
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/folders/{workspace}/{kind}",async (
            HttpContext ctx,Vault v,string workspace,string kind,FolderMutationInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
                try
                {
                    long id=NativeArchiveStore.Handles(kind)
                        ?NativeArchiveStore.Create(v.Db,workspace,kind,input)
                        :NativeFolderStore.Create(v.Db,workspace,kind,input);
                    return Results.Json(new{id,reference=ResourceRef.Create(workspace,kind,id,
                        kind==FolderKinds.ArchiveFolder?"achievement":input.Section??"")});
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(InvalidOperationException ex){return Bad(ex.Message,409);}
                catch(Microsoft.Data.Sqlite.SqliteException ex){return Bad(FolderConstraintMessage(ex,kind),409);}
                // 404 with the reason: an empty body leaves the caller guessing
                // whether the project id was wrong, deleted or in another workspace.
                catch(KeyNotFoundException ex){return Bad(ex.Message,404);}
            }
            finally{v.Gate.Release();}
        });

        app.MapPut("/api/v2/folders/{workspace}/{kind}/{id:long}",async (
            HttpContext ctx,Vault v,string workspace,string kind,long id,FolderMutationInput input,string? section)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
                try
                {
                    var reference=Ref(workspace,kind,id,section);
                    return (NativeArchiveStore.Handles(kind)
                        ?NativeArchiveStore.Update(v.Db,reference,input)
                        :NativeFolderStore.Update(v.Db,reference,input))
                        ? Results.Ok(new{ok=true}):Results.NotFound();
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(InvalidOperationException ex){return Bad(ex.Message,409);}
                catch(Microsoft.Data.Sqlite.SqliteException ex){return Bad(FolderConstraintMessage(ex,kind),409);}
            }
            finally{v.Gate.Release();}
        });

        app.MapDelete("/api/v2/folders/{workspace}/{kind}/{id:long}",async (
            HttpContext ctx,Vault v,string workspace,string kind,long id,string? section)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
                try
                {
                    var reference=Ref(workspace,kind,id,section);
                    return (NativeArchiveStore.Handles(kind)
                        ?NativeArchiveStore.SetDeleted(v.Db,reference,true)
                        :NativeFolderStore.SetDeleted(v.Db,reference,true))
                        ? Results.Ok(new{ok=true}):Results.NotFound();
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(InvalidOperationException ex){return Bad(ex.Message,409);}
                catch(Microsoft.Data.Sqlite.SqliteException ex){return Bad(FolderConstraintMessage(ex,kind),409);}
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/folders/{workspace}/{kind}/{id:long}/restore",async (
            HttpContext ctx,Vault v,string workspace,string kind,long id,string? section)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可写入。",409);
                try
                {
                    var reference=Ref(workspace,kind,id,section);
                    return (NativeArchiveStore.Handles(kind)
                        ?NativeArchiveStore.SetDeleted(v.Db,reference,false)
                        :NativeFolderStore.SetDeleted(v.Db,reference,false))
                        ? Results.Ok(new{ok=true}):Results.NotFound();
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(InvalidOperationException ex){return Bad(ex.Message,409);}
                catch(Microsoft.Data.Sqlite.SqliteException ex){return Bad(FolderConstraintMessage(ex,kind),409);}
            }
            finally{v.Gate.Release();}
        });

        app.MapGet("/api/v2/folders/{workspace}/entries",async (
            HttpContext ctx,Vault v,string workspace,string? section,long? parentId)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                try{return Results.Json(NativeArchiveOrder.Entries(v.Db,workspace,section??"",parentId));}
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(KeyNotFoundException){return Results.NotFound();}
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/folders/{workspace}/entries/reorder",async (
            HttpContext ctx,Vault v,string workspace,string? section,ArchiveEntryReorder input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可排序。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可排序。",409);
                try
                {
                    return NativeArchiveOrder.Reorder(v.Db,workspace,section??"",input)
                        ?Results.Ok(new{ok=true}):Bad("排序内容已变化，请刷新后重试。",409);
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(KeyNotFoundException){return Results.NotFound();}
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/v2/folders/{workspace}/{kind}/{id:long}/move",async (
            HttpContext ctx,Vault v,string workspace,string kind,long id,
            string? section,NativeFolderMoveInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可移动。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Bad("文件任务或退出中不可移动。",409);
                try
                {
                    return NativeArchiveOrder.Move(v.Db,Ref(workspace,kind,id,section),
                        input.ParentId)
                        ?Results.Ok(new{ok=true}):Results.NotFound();
                }
                catch(ArgumentException ex){return Bad(ex.Message);}
                catch(KeyNotFoundException){return Results.NotFound();}
                catch(InvalidOperationException ex){return Bad(ex.Message,409);}
                catch(Microsoft.Data.Sqlite.SqliteException ex)
                    {return Bad("目录层级不合法、目标不可用或发生名称冲突，请重新检查目标目录。",409);}
            }
            finally{v.Gate.Release();}
        });
    }
}
