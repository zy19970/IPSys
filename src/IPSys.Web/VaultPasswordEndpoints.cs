using Microsoft.Data.Sqlite;

// The database password is the SQLCipher encryption passphrase, not a UI-only
// login secret. Rotation must take the same exclusive file-task/Gate locks as
// large uploads, purge and VACUUM. Do not log passwords or PRAGMA rekey SQL.
record VaultPasswordChangeInput(string? CurrentPassword,string? NewPassword,
    string? ConfirmPassword);

static class VaultPasswordEndpoints
{
    private static IResult Fail(string message,int status=400)=>
        Results.Json(new {error=message},statusCode:status);

    public static void Map(WebApplication app)
    {
        app.MapPost("/api/vault/change-password",async(
            HttpContext ctx,Vault v,VaultPasswordChangeInput input)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(v.ExitRequested || v.FileTaskActive)
                return Fail("有文件任务执行中或程序正在退出，请完成后再修改密码。",409);
            string oldPassword=input.CurrentPassword??"";
            string newPassword=input.NewPassword??"";
            if(string.IsNullOrEmpty(oldPassword))return Fail("请输入当前资料库密码。");
            if(string.IsNullOrWhiteSpace(newPassword) || newPassword.Length<8 ||
               newPassword.Length>256 || newPassword.Contains('\0'))
                return Fail("新密码长度应为 8 至 256 个字符。");
            if(newPassword!=input.ConfirmPassword)
                return Fail("两次输入的新密码不一致。");
            if(oldPassword==newPassword)
                return Fail("新密码不能与当前密码相同。");

            // Reserve the exclusive file-task slot before acquiring Gate so no
            // upload/purge/VACUUM can start while rekey is waiting.
            if(!v.TryBeginFileTask(ctx,out _))
                return Fail("当前有上传、删除或其它文件任务，请完成后重试。",409);
            bool entered=false;
            bool rekeyAttempted=false;
            try
            {
                // Cancellation is honored only BEFORE the irreversible rekey
                // starts. A closed tab must not leave a half-finished rotation.
                await v.Gate.WaitAsync(ctx.RequestAborted);
                entered=true;
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.ExitRequested || v.PendingFile is not null)
                    return Fail("资料库正在退出或仍有待确认原件，请先处理完成。",409);
                if(!v.PasswordMatches(oldPassword))
                    return Fail("当前资料库密码错误。",403);

                using(var command=v.Db.CreateCommand())
                {
                    command.CommandTimeout=0; // a multi-gigabyte vault can take time
                    command.CommandText="SELECT COUNT(*) FROM file_objects WHERE state='writing';";
                    if(Convert.ToInt64(command.ExecuteScalar())!=0)
                        return Fail("数据库仍有未完成的原件写入，不能修改密码。",409);
                    command.CommandText="PRAGMA integrity_check;";
                    if(!string.Equals(Convert.ToString(command.ExecuteScalar()),"ok",
                        StringComparison.OrdinalIgnoreCase))
                        return Fail("资料库完整性检查未通过，请先修复或备份。",409);

                    // PRAGMAs cannot bind parameters. Quote with SQLite's own
                    // quote() and a bound argument (including quotes/Unicode).
                    command.CommandText="SELECT quote($next);";
                    command.Parameters.AddWithValue("$next",newPassword);
                    string quoted=Convert.ToString(command.ExecuteScalar()) ??
                        throw new IOException("无法处理新密码。");
                    command.Parameters.Clear();
                    v.SetMcpEnabled(false);
                    command.CommandText="PRAGMA rekey = "+quoted+";";
                    rekeyAttempted=true;
                    command.ExecuteNonQuery();
                    command.CommandText="PRAGMA integrity_check;";
                    if(!string.Equals(Convert.ToString(command.ExecuteScalar()),"ok",
                        StringComparison.OrdinalIgnoreCase))
                        throw new IOException("密钥修改后完整性校验未通过。");
                }
                // Verify against independent SQLCipher connections before
                // revoking the current session. No password is returned.
                if(!v.PasswordMatches(newPassword) || v.PasswordMatches(oldPassword))
                    throw new IOException("新旧密钥验证未通过。");
                // Closing invalidates every browser token and stops local MCP.
                // A fresh /api/open is required with the new passphrase.
                v.Close();
                return Results.Json(new {ok=true,locked=true});
            }
            catch(OperationCanceledException)
            {
                return Fail("修改密码已取消，数据库未开始重新加密。",409);
            }
            catch(Exception)
            {
                if(rekeyAttempted)
                {
                    // Unknown failure after rekey: never leave a potentially
                    // changed key in a still-authorized browser/MCP session.
                    try {v.Close();}catch { /* Preserve the failure warning. */ }
                    return Fail("密钥修改未能完成验证，已尝试关闭资料库。请分别尝试新密码和旧密码重新打开；如无法打开请使用此前备份恢复。",409);
                }
                return Fail("未能开始修改密码，资料库仍保持原状态。请检查磁盘及数据库状态。",409);
            }
            finally
            {
                if(entered)v.Gate.Release();
                v.CompleteFileTask();
            }
        });
    }
}
