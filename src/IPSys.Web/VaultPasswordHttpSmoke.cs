using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// Exercises actual SQLCipher rekey against WebSmoke's disposable encrypted DB.
// No user database, hard-coded production credential or offline fixture is touched.
static class VaultPasswordHttpSmoke
{
    private static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("VAULT PASSWORD HTTP: "+reason);
    }

    public static async Task VerifyAsync(HttpClient client,Vault vault,
        string dbPath,string oldPassword,long projectId,string previousToken)
    {
        var newPassword="新密码'安全验证_Emoji😀_"+Guid.NewGuid().ToString("N");
        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await anonymous.PostAsJsonAsync("/api/vault/change-password",
            new VaultPasswordChangeInput(oldPassword,newPassword,newPassword)))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,
                "rotation must require current authorized session");
        using(var wrongOld=await client.PostAsJsonAsync("/api/vault/change-password",
            new VaultPasswordChangeInput("not-the-old-password",newPassword,newPassword)))
            Check(wrongOld.StatusCode==HttpStatusCode.Forbidden,
                "incorrect current password must be refused");
        using(var mismatch=await client.PostAsJsonAsync("/api/vault/change-password",
            new VaultPasswordChangeInput(oldPassword,newPassword,"different-confirmation")))
            Check(mismatch.StatusCode==HttpStatusCode.BadRequest,
                "confirmation mismatch must be refused");
        using(var tooShort=await client.PostAsJsonAsync("/api/vault/change-password",
            new VaultPasswordChangeInput(oldPassword,"short","short")))
            Check(tooShort.StatusCode==HttpStatusCode.BadRequest,
                "weak short replacement passwords must be refused");
        using(var unchanged=await client.PostAsJsonAsync("/api/vault/change-password",
            new VaultPasswordChangeInput(oldPassword,oldPassword,oldPassword)))
            Check(unchanged.StatusCode==HttpStatusCode.BadRequest,
                "unchanged password must be refused");
        Check(vault.Unlocked && vault.PasswordMatches(oldPassword),
            "validation failures must not modify the live SQLCipher key");
        using(var missingToken=new HttpClient{BaseAddress=client.BaseAddress})
        using(var checkDenied=await missingToken.GetAsync("/api/check"))
            Check(checkDenied.StatusCode==HttpStatusCode.Unauthorized,
                "integrity query must still require auth");

        // Successful rotation invalidates all previous browser tokens and
        // stops the MCP bridge. Validate old/new key on reopening.
        using(var change=await client.PostAsJsonAsync("/api/vault/change-password",
            new VaultPasswordChangeInput(oldPassword,newPassword,newPassword)))
        {
            string response=await change.Content.ReadAsStringAsync();
            Check(change.StatusCode==HttpStatusCode.OK,
                "actual encrypted rekey must succeed; HTTP "+(int)change.StatusCode+
                "; body "+response);
            var json=JsonDocument.Parse(response).RootElement;
            Check(json.GetProperty("ok").GetBoolean() &&
                json.GetProperty("locked").GetBoolean(),
                "rekey must return an explicit locked success");
            Check(!response.Contains(oldPassword,StringComparison.Ordinal) &&
                !response.Contains(newPassword,StringComparison.Ordinal),
                "password material must never appear in the API success response");
        }
        Check(!vault.Unlocked && !vault.McpEnabled,
            "successful rekey must close the live database and disable MCP");
        using(var stale=await client.GetAsync("/api/check"))
            Check(stale.StatusCode==HttpStatusCode.Unauthorized,
                "session token must be revoked immediately after rekey");
        using(var oldAttempt=await client.PostAsJsonAsync("/api/open",
            new OpenInput(dbPath,oldPassword,false)))
            Check(!oldAttempt.IsSuccessStatusCode,
                "old SQLCipher passphrase must stop decrypting the database");
        client.DefaultRequestHeaders.Remove("X-IPSys-Token");
        using(var afterOld=new HttpClient{BaseAddress=client.BaseAddress})
        using(var resume=await afterOld.PostAsJsonAsync("/api/resume",
            new ResumeInput(newPassword)))
            Check(resume.StatusCode==HttpStatusCode.Conflict,
                "password change must close DB, not silently resume another tab");

        using var fresh=await client.PostAsJsonAsync("/api/open",
            new OpenInput(dbPath,newPassword,false));
        Check(fresh.StatusCode==HttpStatusCode.OK,
            "database must reopen with the new SQLCipher passphrase");
        var freshToken=(await fresh.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("token").GetString()??"";
        Check(freshToken.Length>0 && freshToken!=previousToken,
            "new DB session token must differ from old token");
        client.DefaultRequestHeaders.Add("X-IPSys-Token",freshToken);
        var data=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/company/project/"+projectId);
        Check(data.GetProperty("folder").GetProperty("ref").GetProperty("id")
            .GetInt64()==projectId,
            "existing records and IDs must survive re-encryption");
        using(var status=await client.GetAsync("/api/check"))
        {
            status.EnsureSuccessStatusCode();
            var integrity=await status.Content.ReadFromJsonAsync<JsonElement>();
            Check(integrity.GetProperty("result").GetString()=="ok",
                "SQLCipher integrity_check must stay successful after reopen");
        }
        using(var other=new HttpClient{BaseAddress=client.BaseAddress})
        {
            using(var denied=await other.PostAsJsonAsync("/api/resume",
                new ResumeInput(oldPassword)))
                Check(denied.StatusCode==HttpStatusCode.Forbidden,
                    "old password must fail resumed sessions");
            var ok=await other.PostAsJsonAsync("/api/resume",
                new ResumeInput(newPassword));
            Check(ok.IsSuccessStatusCode,
                "new password must resume existing SQLCipher session");
            ok.Dispose();
        }
        Console.WriteLine("VAULT PASSWORD SQLCIPHER HTTP SMOKE PASS: validation, Unicode/quoted rekey, old-key rejection, session invalidation, existing data, integrity");
    }
}
