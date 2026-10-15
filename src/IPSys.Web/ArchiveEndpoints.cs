using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// R0-03: registration of the existing directory and archive endpoints.
static class ArchiveEndpoints
{
    public static void Map(WebApplication app, Func<string,int,IResult> fail)
    {
        IResult Fail(string message,int status=400)=>fail(message,status);
        // Hierarchical directories are limited to the company business archives. All
        // operations reuse the existing unlocked SQLCipher session and the shared gate.
        app.MapGet("/api/archive-folders",async(HttpContext ctx,Vault v)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                return Results.Json(ArchiveFolderStore.List(v.Db));
            }
            finally{v.Gate.Release();}
        });
        // Business archive folders and records can be interleaved in the same persisted list.
        app.MapGet("/api/archive-entry-order",async(HttpContext ctx,Vault v)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                return Results.Json(ArchiveEntryOrderStore.Orders(v.Db));
            }
            finally{v.Gate.Release();}
        });
        app.MapPost("/api/archive-entry-order",async(HttpContext ctx,Vault v,ArchiveEntryReorder input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整排序。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整排序。",409);
                return ArchiveEntryOrderStore.Reorder(v.Db,input)
                    ?Results.Ok(new{ok=true}):Fail("当前目录内容已变化，请刷新后重新排序。",409);
            }
            finally{v.Gate.Release();}
        });
        app.MapPost("/api/archive-folders",async(HttpContext ctx,Vault v,ArchiveFolderInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
                try{return Results.Json(new {id=ArchiveFolderStore.Create(v.Db,input)});}
                catch(InvalidOperationException ex){return Fail(ex.Message,409);}
            }
            finally{v.Gate.Release();}
        });
        app.MapPut("/api/archive-folders/{id:long}",async(HttpContext ctx,Vault v,long id,ArchiveFolderInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
                try{return ArchiveFolderStore.Update(v.Db,id,input)
                    ?Results.Ok(new {ok=true}):Results.NotFound();}
                catch(InvalidOperationException ex){return Fail(ex.Message,409);}
            }
            finally{v.Gate.Release();}
        });
        app.MapDelete("/api/archive-folders/{id:long}",async(HttpContext ctx,Vault v,long id)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
                try{return ArchiveFolderStore.DeleteEmpty(v.Db,id)
                    ?Results.Ok(new {ok=true}):Results.NotFound();}
                catch(InvalidOperationException ex){return Fail(ex.Message,409);}
            }
            finally{v.Gate.Release();}
        });
        app.MapPost("/api/archive-folders/from-record/{id:long}",async(HttpContext ctx,Vault v,long id)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中不能调整目录。",409);
                try{return Results.Json(new {id=ArchiveFolderStore.ExpandRecord(v.Db,id)});}
                catch(InvalidOperationException ex){return Fail(ex.Message,409);}
            }
            finally{v.Gate.Release();}
        });
        
        // Contract creation requires an existing, active project in the same workspace.
        // "All contracts" is a read-only aggregation; it cannot create orphan records.
        // B04 minimal archives: the section is a validated view inside a fixed M0 module.
        app.MapGet("/api/archives/{workspace}/{section}", async (
            HttpContext ctx, Vault v, string workspace, string section) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (ArchiveStore.Module(workspace,section)==null) return Fail("无效的归档工作区或模块。");
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                return Results.Json(ArchiveStore.List(v.Db,workspace,section));
            }
            finally { v.Gate.Release(); }
        });
        // Only company certificates expose manual list ordering; no other archive view is changed.
        app.MapPost("/api/archives/company/certificate/order", async (
            HttpContext ctx,Vault v,CompanyCertificateOrderInput input) =>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可调整排序。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可调整排序。",409);
                return ArchiveStore.ReorderCompanyCertificates(v.Db,input.Ids)
                    ?Results.Ok(new {ok=true}):Fail("资料列表已经变化，请刷新后重新调整顺序。",409);
            }
            finally{v.Gate.Release();}
        });
        // Selected company certificates are soft-deleted in one transaction.
        app.MapPost("/api/archives/company/certificate/batch-delete", async (
            HttpContext ctx,Vault v,CompanyCertificateBatchDeleteInput input) =>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
                return ArchiveStore.DeleteCompanyCertificates(v.Db,input.Ids)
                    ?Results.Ok(new {ok=true,count=input.Ids?.Length??0})
                    :Fail("所选资料已发生变化，请刷新列表后重新选择。",409);
            }
            finally{v.Gate.Release();}
        });
        app.MapPost("/api/archives/{workspace}/{section}", async (
            HttpContext ctx, Vault v, string workspace, string section, ArchiveInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (ArchiveStore.Module(workspace,section)==null) return Fail("无效的归档工作区或模块。");
            var validation=ArchiveStore.Validate(input);
            if(validation!=null)return Fail(validation);
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
                try{return Results.Json(new {id=ArchiveStore.Add(v.Db,workspace,section,input)});}
                catch(InvalidOperationException ex){return Fail(ex.Message,409);}
            }
            finally { v.Gate.Release(); }
        });
        app.MapPut("/api/archives/{workspace}/{section}/{id:long}", async (
            HttpContext ctx, Vault v, string workspace, string section, long id, ArchiveInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (ArchiveStore.Module(workspace,section)==null) return Fail("无效的归档工作区或模块。");
            var validation=ArchiveStore.Validate(input);
            if(validation!=null)return Fail(validation);
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
                try{return ArchiveStore.Update(v.Db,workspace,section,id,input)
                    ? Results.Ok(new {ok=true}) : Results.NotFound();}
                catch(InvalidOperationException ex){return Fail(ex.Message,409);}
            }
            finally { v.Gate.Release(); }
        });
        app.MapDelete("/api/archives/{workspace}/{section}/{id:long}", async (
            HttpContext ctx, Vault v, string workspace, string section, long id) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (ArchiveStore.Module(workspace,section)==null) return Fail("无效的归档工作区或模块。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
                return ArchiveStore.Delete(v.Db,workspace,section,id)
                    ? Results.Ok(new {ok=true}) : Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
        app.MapPost("/api/archives/{workspace}/{section}/{id:long}/transfer", async (
            HttpContext ctx, Vault v, string workspace, string section, long id, ArchiveTransfer input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            string? source=ArchiveStore.Module(workspace,section);
            string? target=ArchiveStore.Module(input.TargetWorkspace,input.TargetSection);
            if(source==null||target!=source)return Fail("不可转移至不兼容的资料类别。");
            if(input.Move&&workspace==input.TargetWorkspace&&section==input.TargetSection)
                return Fail("同一类别无需转移。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可更改资料。",409);
                long? newId=ArchiveStore.Transfer(v.Db,workspace,section,id,input.TargetWorkspace,input.TargetSection,input.Move);
                return newId.HasValue?Results.Json(new {id=newId.Value}):Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
    }
}
