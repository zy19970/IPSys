using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// R0-03: unchanged existing IP registration and handler bodies.
static class IpEndpoints
{
    public static void Map(WebApplication app, Func<string,int,IResult> fail)
    {
        IResult Fail(string message,int status=400)=>fail(message,status);
        // Project ledger: encrypted in the same SQLCipher file, isolated by workspace.
        // Intellectual property management. All operations require an unlocked session
        // and workspace-scoped SQL queries; attachments are a separate upcoming stage.
        app.MapGet("/api/ip/{workspace}", async (HttpContext ctx, Vault v, string workspace) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                return Results.Json(IpStore.List(v.Db, workspace));
            }
            finally { v.Gate.Release(); }
        });
        app.MapPost("/api/ip/{workspace}", async (HttpContext ctx, Vault v, string workspace, IpInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            string? error=IpStore.Validate(input);
            if(error!=null)return Fail(error);
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
                return Results.Json(new { id=IpStore.Add(v.Db,workspace,input) });
            }
            finally { v.Gate.Release(); }
        });
        app.MapPut("/api/ip/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id, IpInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            string? error=IpStore.Validate(input);
            if(error!=null)return Fail(error);
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
                return IpStore.Update(v.Db,workspace,id,input)?Results.Ok(new {ok=true}):Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
        app.MapDelete("/api/ip/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
                return IpStore.Delete(v.Db,workspace,id)?Results.Ok(new {ok=true}):Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
        app.MapPost("/api/ip/{workspace}/{id:long}/transfer", async (
            HttpContext ctx, Vault v, string workspace, long id, IpTransfer input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)||!Vault.WorkspaceValid(input.TargetWorkspace))
                return Fail("无效工作区。");
            if(workspace==input.TargetWorkspace && input.Move)return Fail("同一工作区无需转移。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间暂不能修改资料。",409);
                long? copied=FolderTransferService.Apply(v.Db,
                    new ResourceRef(workspace,FolderKinds.Ip,id),
                    new FolderTransferInput(input.TargetWorkspace,input.Move))?.Id;
                return copied.HasValue?Results.Json(new {id=copied.Value}):Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
    }
}
