using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;

// R0-03: unchanged auth, database lifetime and diagnostics endpoints.
static class SessionEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        IResult Fail(string message,int status=400)=>fail(message,status);
        // MCP access is deliberately disabled for every new database session.
        app.MapGet("/api/mcp", (HttpContext ctx,Vault v) =>
            !v.Allowed(ctx)?(IResult)Results.Unauthorized():Results.Json(new {enabled=v.McpEnabled}));
        app.MapPost("/api/mcp", (HttpContext ctx,Vault v,McpAccessInput input) =>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            return v.SetMcpEnabled(input.Enabled)
                ?Results.Json(new {enabled=v.McpEnabled})
                :Fail("当前数据库未打开，或正在进行文件任务/退出，无法切换 MCP。",409);
        });
        
        app.MapGet("/api/status", (Vault v) => Results.Json(new
        {
            unlocked = v.Unlocked,
            suggestion = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) is var d && d.Length > 0
                    ? d : AppContext.BaseDirectory, "IPSys-web-test.db"),
            prototype = true
        }));
        
        app.MapPost("/api/open", async (OpenInput input, Vault v) =>
        {
            if (v.ExitRequested) return Fail("程序正在安全退出。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (v.ExitRequested) return Fail("程序正在安全退出。", 409);
                if (v.Unlocked) return Fail("请先关闭当前数据库。", 409);
                string path = input.Path?.Trim() ?? "";
                if (!Path.IsPathFullyQualified(path)) return Fail("请输入数据库的绝对路径。");
                path = Path.GetFullPath(path);
                if (string.IsNullOrWhiteSpace(input.Password)) return Fail("数据库密码不能为空。");
                if (!Directory.Exists(Path.GetDirectoryName(path))) return Fail("数据库所在文件夹不存在。");
                if (input.Create && File.Exists(path)) return Fail("文件已存在；不会覆盖原数据库。");
                if (!input.Create && !File.Exists(path)) return Fail("找不到数据库文件。");
                SqliteConnection? db = null;
                try
                {
                    db = Vault.Connect(path, input.Password, input.Create);
                    if (input.Create) Vault.CreateSchema(db);
                    else Vault.ValidateSchema(db);
                    // V2 schema is complete; opening must not silently rebuild V1 tables.
                    // Remove only incomplete V2 writing objects abandoned by a crash.
                    NativeFileChoiceStore.CleanupWriting(db);
                    string token = v.SetOpen(db, path);
                    db = null;
                    return Results.Json(new { token, name = Path.GetFileName(path) });
                }
                catch (Exception e)
                {
                    db?.Dispose();
                    return Fail("数据库打开失败：" + e.Message);
                }
            }
            finally { v.Gate.Release(); }
        });
        
        // A browser tab may close while the WinForms-owned database stays open.
        // Re-authenticate against the existing encrypted file; do not close or replace it.
        app.MapPost("/api/resume", async (ResumeInput input, Vault v) =>
        {
            if (string.IsNullOrWhiteSpace(input.Password)) return Fail("请输入数据库密码。");
            await v.Gate.WaitAsync();
            try
            {
                if (v.ExitRequested) return Fail("程序正在安全退出。", 409);
                if (!v.Unlocked) return Fail("当前没有已打开的数据库，请正常打开数据库。", 409);
                if (!v.PasswordMatches(input.Password))
                    return Fail("数据库密码错误，无法恢复会话。", 403);
                return Results.Json(new
                {
                    token = v.SessionToken,
                    name = Path.GetFileName(v.Path),
                    resumed = true
                });
            }
            catch (Exception)
            {
                // The current SQLCipher connection is not modified on authentication failure.
                return Fail("验证失败，数据库仍保持打开。", 403);
            }
            finally { v.Gate.Release(); }
        });
        
        app.MapPost("/api/lock", async (HttpContext ctx, Vault v) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务执行中或程序正在退出，不能关闭数据库。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务执行中或程序正在退出，不能关闭数据库。", 409);
                v.Close();
                return Results.Ok(new { ok = true });
            }
            finally { v.Gate.Release(); }
        });
    }

    public static void MapDiagnostics(WebApplication app)
    {
        app.MapGet("/api/check", async (HttpContext ctx, Vault v) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                using var cmd = v.Db.CreateCommand();
                cmd.CommandText = "PRAGMA integrity_check;";
                string result = Convert.ToString(cmd.ExecuteScalar()) ?? "";
                cmd.CommandText = "SELECT count(*) FROM file_objects WHERE state='writing';";
                long incomplete = (long)cmd.ExecuteScalar()!;
                return Results.Json(new { result, incomplete });
            }
            finally { v.Gate.Release(); }
        });
        
        // Browser clients may inspect task state but must never stop the WinForms host.
        // Only LauncherForm schedules application exit; /api/lock closes the database.
        app.MapGet("/api/task", (HttpContext ctx, Vault v) =>
        {
            if (!v.Allowed(ctx)) return (IResult)Results.Unauthorized();
            return Results.Json(new { active = v.FileTaskActive, exiting = v.ExitRequested });
        });
    }
}
