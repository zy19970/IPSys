using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// R1-04-02: first common mutation surface, keeping all existing business APIs operational.
static class FolderCommandEndpoints
{
    public static void Map(WebApplication app, Func<string,int,IResult> fail)
    {
        IResult Fail(string message, int status = 400) => fail(message, status);

        app.MapPost("/api/folders/{workspace}/{kind}", async (
            HttpContext ctx, Vault v, string workspace, string kind, FolderMutationInput input) =>
        {
            if (!v.Allowed(ctx)) return (IResult)Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不能修改文件夹。", 409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不能修改文件夹。", 409);
                try
                {
                    var reference = FolderCommandService.Create(v.Db, workspace, kind, input);
                    return Results.Json(new { id = reference.Id, reference });
                }
                catch (ArgumentException ex) { return Fail(ex.Message); }
                catch (KeyNotFoundException) { return Results.NotFound(); }
            }
            finally { v.Gate.Release(); }
        });

        app.MapPut("/api/folders/{workspace}/{kind}/{id:long}", async (
            HttpContext ctx, Vault v, string workspace, string kind, long id, FolderMutationInput input) =>
        {
            if (!v.Allowed(ctx)) return (IResult)Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不能修改文件夹。", 409);
            var reference = new ResourceRef(workspace, kind, id);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不能修改文件夹。", 409);
                try
                {
                    return FolderCommandService.Update(v.Db, reference, input)
                        ? Results.Ok(new { ok = true }) : Results.NotFound();
                }
                catch (ArgumentException ex) { return Fail(ex.Message); }
            }
            finally { v.Gate.Release(); }
        });

        app.MapDelete("/api/folders/{workspace}/{kind}/{id:long}", async (
            HttpContext ctx, Vault v, string workspace, string kind, long id) =>
        {
            if (!v.Allowed(ctx)) return (IResult)Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不能修改文件夹。", 409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不能修改文件夹。", 409);
                try
                {
                    var reference = new ResourceRef(workspace, kind, id);
                    return FolderCommandService.Delete(v.Db, reference)
                        ? Results.Ok(new { ok = true }) : Results.NotFound();
                }
                catch (ArgumentException ex) { return Fail(ex.Message); }
            }
            finally { v.Gate.Release(); }
        });

        app.MapPost("/api/folders/{workspace}/{kind}/{id:long}/restore", async (
            HttpContext ctx, Vault v, string workspace, string kind, long id) =>
        {
            if (!v.Allowed(ctx)) return (IResult)Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不能恢复文件夹。", 409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不能恢复文件夹。", 409);
                try
                {
                    var reference = new ResourceRef(workspace, kind, id);
                    return FolderCommandService.Restore(v.Db, reference)
                        ? Results.Ok(new { ok = true }) : Results.NotFound();
                }
                catch (ArgumentException ex) { return Fail(ex.Message); }
            }
            finally { v.Gate.Release(); }
        });
    }
}
