using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// R0-03: project and contract route bodies are preserved.
static class ProjectContractEndpoints
{
    public static void Map(WebApplication app, Func<string,int,IResult> fail)
    {
        IResult Fail(string message,int status=400)=>fail(message,status);
        app.MapGet("/api/contracts/{workspace}", async (HttpContext ctx, Vault v, string workspace) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                return Results.Json(ContractStore.List(v.Db, workspace));
            }
            finally { v.Gate.Release(); }
        });
        app.MapPost("/api/projects/{workspace}/{projectId:long}/contracts", async (
            HttpContext ctx, Vault v, string workspace, long projectId, ContractInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            var invalid = ContractStore.Validate(input);
            if (invalid != null) return Fail(invalid);
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
                if (!ContractStore.ActiveProject(v.Db, workspace, projectId)) return Results.NotFound();
                return Results.Json(new { id = ContractStore.Add(v.Db, workspace, projectId, input) });
            }
            finally { v.Gate.Release(); }
        });
        // Duplicate a contract and its file references in a single SQLCipher transaction.
        app.MapPost("/api/contracts/{workspace}/{id:long}/copy",async(
            HttpContext ctx,Vault v,string workspace,long id)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中或程序正在退出。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务进行中或程序正在退出。",409);
                var copied=ContractStore.Duplicate(v.Db,workspace,id);
                return copied.HasValue?Results.Json(new{id=copied.Value}):Results.NotFound();
            }
            finally{v.Gate.Release();}
        });
        app.MapPut("/api/contracts/{workspace}/{id:long}", async (
            HttpContext ctx, Vault v, string workspace, long id, ContractInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            var invalid = ContractStore.Validate(input);
            if (invalid != null) return Fail(invalid);
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
                return ContractStore.Update(v.Db, workspace, id, input)
                    ? Results.Ok(new { ok = true }) : Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
        app.MapDelete("/api/contracts/{workspace}/{id:long}", async (
            HttpContext ctx, Vault v, string workspace, long id) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务或退出期间不可修改合同。", 409);
                return ContractStore.SoftDelete(v.Db, workspace, id)
                    ? Results.Ok(new { ok = true }) : Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
        
        app.MapGet("/api/projects/{workspace}", async (HttpContext ctx, Vault v, string workspace) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                return Results.Json(ProjectStore.List(v.Db, workspace));
            }
            finally { v.Gate.Release(); }
        });
        
        app.MapPost("/api/projects/{workspace}", async (HttpContext ctx, Vault v, string workspace, ProjectInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            var validation = ProjectStore.Check(input);
            if (validation != null) return Fail(validation);
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
                return Results.Json(new { id = ProjectStore.Insert(v.Db, workspace, input) });
            }
            finally { v.Gate.Release(); }
        });
        
        app.MapPut("/api/projects/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id, ProjectInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            var validation = ProjectStore.Check(input);
            if (validation != null) return Fail(validation);
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
                return ProjectStore.Update(v.Db, workspace, id, input) ? Results.Ok(new { ok = true }) : Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
        
        app.MapDelete("/api/projects/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
                return ProjectStore.Delete(v.Db, workspace, id) ? Results.Ok(new { ok = true }) : Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
        
        // Copy keeps the source; move switches workspace. Both are scoped to a known source.
        app.MapPost("/api/projects/{workspace}/{id:long}/transfer", async (
            HttpContext ctx, Vault v, string workspace, long id, ProjectTransfer input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace) || !Vault.WorkspaceValid(input.TargetWorkspace))
                return Fail("无效工作区。");
            if (input.TargetWorkspace == workspace && input.Move) return Fail("同一工作区无需转移。");
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务进行中。", 409);
                var newId = ProjectStore.Transfer(v.Db, workspace, id, input.TargetWorkspace, input.Move);
                return newId.HasValue ? Results.Json(new { id = newId.Value }) : Results.NotFound();
            }
            finally { v.Gate.Release(); }
        });
    }
}
