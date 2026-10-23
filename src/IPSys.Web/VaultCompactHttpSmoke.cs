using System.Diagnostics;
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
    private static void CheckStorage(JsonElement stats)
    {
        long count=stats.GetProperty("pageCount").GetInt64();
        long free=stats.GetProperty("freePages").GetInt64();
        long size=stats.GetProperty("pageSize").GetInt64();
        long total=stats.GetProperty("totalBytes").GetInt64();
        long used=stats.GetProperty("usedBytes").GetInt64();
        long available=stats.GetProperty("freeBytes").GetInt64();
        Check(count>0&&size>0&&free>=0&&free<=count,
            "SQLite page_count / freelist_count / page_size must be valid");
        Check(total==checked(count*size)&&
              available==checked(free*size)&&
              used==checked((count-free)*size)&&
              total==used+available,
            "total, used and free pages must reconcile exactly");
    }

    public static async Task VerifyAsync(HttpClient client)
    {
        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var deny=await anonymous.GetAsync("/api/vault/compact/info"))
            Check(deny.StatusCode==HttpStatusCode.Unauthorized,
                "database statistics must require the session token");
        using(var anonymousStorage=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await anonymousStorage.GetAsync("/api/vault/storage"))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,
                "vault page statistics must be authenticated");
        var pagesBefore=await client.GetFromJsonAsync<JsonElement>("/api/vault/storage");
        CheckStorage(pagesBefore);
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
        // A >2 GiB encrypted database cannot be expected to VACUUM in the
        // same fixed 36-second budget as a small QA database. Use a monotonic
        // wall clock and report the last actual server stage on timeout.
        // Do not mark an unfinished background VACUUM as a product failure.
        long before=info.GetProperty("fileBytes").GetInt64();
        var budget=before>=512L*1024*1024
            ? TimeSpan.FromMinutes(12):TimeSpan.FromSeconds(55);
        var clock=Stopwatch.StartNew();
        JsonElement snapshot=default;
        bool completed=false;
        while(clock.Elapsed<budget)
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
            await Task.Delay(250);
        }
        string lastState=snapshot.ValueKind==JsonValueKind.Object
            ? snapshot.GetProperty("state").GetString()??"unknown":"no status";
        string lastStage=snapshot.ValueKind==JsonValueKind.Object
            ? snapshot.GetProperty("stage").GetString()??"unknown":"no stage";
        Check(completed,"VACUUM exceeded "+budget+
            " (elapsed "+clock.Elapsed+", bytes "+before+
            ", state "+lastState+", stage "+lastStage+
            "). Task may still be running; this is a test timeout, not proof of corruption.");
        Check(lastState=="succeeded",
            "compaction ended in "+lastState+": "+snapshot.GetProperty("error").ToString()+
            " (elapsed "+clock.Elapsed+", stage "+lastStage+")");
        Console.WriteLine("VAULT COMPACT: "+before+" bytes, "+clock.Elapsed+
            ", terminal state="+lastState);
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
        var pagesAfter=await client.GetFromJsonAsync<JsonElement>("/api/vault/storage");
        CheckStorage(pagesAfter);
        Check(pagesAfter.GetProperty("totalBytes").GetInt64()<=
              pagesBefore.GetProperty("totalBytes").GetInt64(),
            "VACUUM should not grow this test database's allocated pages");
        Console.WriteLine("VAULT COMPACT ENCRYPTED HTTP SMOKE PASS");
    }
}
