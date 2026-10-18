using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// Real HTTP with WebSmoke's disposable encrypted V2 vault.
static class VaultCompactHttpSmoke
{
    private static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("VAULT COMPACT HTTP: "+reason);
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var deny=await anonymous.GetAsync("/api/vault/compact/info"))
            Check(deny.StatusCode==HttpStatusCode.Unauthorized,
                "database statistics must require the session token");
        var info=await client.GetFromJsonAsync<JsonElement>("/api/vault/compact/info");
        Check(info.GetProperty("fileBytes").GetInt64()>0 &&
              info.GetProperty("requiredFreeBytes").GetInt64()>0 &&
              info.GetProperty("canCompact").GetBoolean(),
            "SQLCipher size, scratch-space check and status must be available");
        using(var refuse=await client.PostAsJsonAsync("/api/vault/compact",
            new VaultCompactRequest(false)))
            Check(refuse.StatusCode==HttpStatusCode.BadRequest,
                "server must refuse compaction without explicit confirmation");
        using var started=await client.PostAsJsonAsync("/api/vault/compact",
            new VaultCompactRequest(true));
        Check(started.StatusCode==HttpStatusCode.Accepted,
            "compaction must be an asynchronous server-side task");
        var id=(await started.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("taskId").GetString()!;
        // On fast machines a small disposable database can finish before the
        // next request. Demand 409 only while the task is actually active.
        var firstState=await client.GetFromJsonAsync<JsonElement>("/api/vault/compact/task");
        if(firstState.GetProperty("state").GetString() is "queued" or "running")
        {
            using var second=await client.PostAsJsonAsync("/api/vault/compact",
                new VaultCompactRequest(true));
            Check(second.StatusCode==HttpStatusCode.Conflict,
                "two compactions may not run concurrently");
        }
        JsonElement snapshot=default;
        bool completed=false;
        for(int i=0;i<360;i++)
        {
            using var poll=await client.GetAsync("/api/vault/compact/task");
            poll.EnsureSuccessStatusCode();
            snapshot=await poll.Content.ReadFromJsonAsync<JsonElement>();
            Check(snapshot.GetProperty("taskId").GetString()==id,
                "status must preserve task identity without database Gate");
            string state=snapshot.GetProperty("state").GetString()!;
            if(state is "succeeded" or "failed" or "canceled")
            {
                completed=true;break;
            }
            await Task.Delay(100);
        }
        Check(completed,"SQLCipher VACUUM must finish or report an explicit failure");
        Check(snapshot.GetProperty("state").GetString()=="succeeded",
            "compaction failed: "+snapshot.GetProperty("error").ToString());
        Check(snapshot.GetProperty("bytesAfter").GetInt64()>0,
            "compaction must report the final file size");
        bool idle=false;
        for(int i=0;i<150;i++)
        {
            var task=await client.GetFromJsonAsync<JsonElement>("/api/task");
            if(!task.GetProperty("active").GetBoolean()){idle=true;break;}
            await Task.Delay(20);
        }
        Check(idle,"VACUUM must release exclusive file-task lock");
        using var check=await client.GetAsync("/api/check");
        check.EnsureSuccessStatusCode();
        var verified=await check.Content.ReadFromJsonAsync<JsonElement>();
        Check(verified.GetProperty("result").GetString()=="ok",
            "encrypted database remains readable after compaction");
        Console.WriteLine("VAULT COMPACT ENCRYPTED HTTP SMOKE PASS");
    }
}
