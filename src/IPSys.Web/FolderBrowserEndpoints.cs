using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// R1-04-01: read-only authenticated endpoints; existing module URLs remain unchanged.
static class FolderBrowserEndpoints
{
    public static void Map(WebApplication app, Func<string,int,IResult> fail)
    {
        IResult Fail(string message, int status = 400) => fail(message, status);

        // Examples:
        // /api/folders/company/children?scope=project
        // /api/folders/company/children?scope=project&parentKind=project&parentId=1
        // /api/folders/company/children?scope=archive&section=achievement&parentKind=archive_folder&parentId=1
        app.MapGet("/api/folders/{workspace}/children", async (
            HttpContext ctx, Vault v, string workspace, string? scope,
            string? section, string? parentKind, long? parentId) =>
        {
            if (!v.Allowed(ctx)) return (IResult)Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if (string.IsNullOrWhiteSpace(scope)) return Fail("必须指定文件夹模块。");
            if ((parentKind is null) != (parentId is null))
                return Fail("上级文件夹类型和编号必须同时提供。");
            ResourceRef? parent = null;
            if (parentId is long id)
            {
                if (parentKind == FolderKinds.ArchiveFolder)
                    parent = new ResourceRef(workspace, parentKind, id, "achievement");
                else parent = new ResourceRef(workspace, parentKind!, id);
                if (!parent.Value.IsValid) return Fail("无效的上级文件夹引用。");
            }
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                try
                {
                    return Results.Json(FolderBrowserService.Children(v.Db, workspace,
                        scope, section ?? "", parent));
                }
                catch (KeyNotFoundException) { return Results.NotFound(); }
                catch (ArgumentException ex) { return Fail(ex.Message); }
                catch (InvalidDataException ex) { return Fail(ex.Message, 409); }
            }
            finally { v.Gate.Release(); }
        });

        app.MapGet("/api/folders/{workspace}/detail/{kind}/{id:long}", async (
            HttpContext ctx, Vault v, string workspace, string kind, long id, string? section) =>
        {
            if (!v.Allowed(ctx)) return (IResult)Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            var reference = new ResourceRef(workspace, kind, id,
                kind == FolderKinds.ArchiveFolder ? "achievement" : section ?? "");
            if (!reference.IsValid) return Fail("无效的文件夹引用。");
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                try
                {
                    var result = FolderBrowserService.Detail(v.Db, reference);
                    return result is null ? Results.NotFound() : Results.Json(result);
                }
                catch (ArgumentException ex) { return Fail(ex.Message); }
                catch (InvalidDataException ex) { return Fail(ex.Message, 409); }
            }
            finally { v.Gate.Release(); }
        });
    }
}
