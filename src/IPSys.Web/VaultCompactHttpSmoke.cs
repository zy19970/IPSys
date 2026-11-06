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
    private static async Task WaitIdleAsync(HttpClient client)
    {
        for(int i=0;i<150;i++)
        {
            var task=await client.GetFromJsonAsync<JsonElement>("/api/task");
            if(!task.GetProperty("active").GetBoolean())return;
            await Task.Delay(20);
        }
        Check(false,"the exclusive file task must be released");
    }
    private static async Task<JsonElement> RunTaskAsync(HttpClient client,bool full,
        long beforeBytes)
    {
        using var started=await client.PostAsJsonAsync("/api/vault/compact",
            new VaultCompactRequest(true,full));
        Check(started.StatusCode==HttpStatusCode.Accepted,
            "database maintenance must be an asynchronous server-side task");
        var id=(await started.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("taskId").GetString()!;
        // On fast machines a small disposable database can finish before the next
        // request. Demand 409 only while the task is actually active.
        var firstState=await client.GetFromJsonAsync<JsonElement>("/api/vault/compact/task");
        if(firstState.GetProperty("state").GetString() is "queued" or "running")
        {
            using var second=await client.PostAsJsonAsync("/api/vault/compact",
                new VaultCompactRequest(true,full));
            Check(second.StatusCode==HttpStatusCode.Conflict,
                "two maintenance tasks may not run concurrently");
        }
        // A >2 GiB encrypted database cannot be expected to finish in the same
        // fixed budget as a small QA database. Never mark an unfinished
        // background task as a product failure.
        var budget=beforeBytes>=512L*1024*1024
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
            if(state is "succeeded" or "failed" or "canceled"){completed=true;break;}
            await Task.Delay(250);
        }
        string lastState=snapshot.ValueKind==JsonValueKind.Object
            ? snapshot.GetProperty("state").GetString()??"unknown":"no status";
        string lastStage=snapshot.ValueKind==JsonValueKind.Object
            ? snapshot.GetProperty("stage").GetString()??"unknown":"no stage";
        Check(completed,"maintenance exceeded "+budget+
            " (elapsed "+clock.Elapsed+", bytes "+beforeBytes+
            ", state "+lastState+", stage "+lastStage+
            "). Task may still be running; this is a test timeout, not proof of corruption.");
        Check(lastState=="succeeded",
            "maintenance ended in "+lastState+": "+snapshot.GetProperty("error")+
            " (elapsed "+clock.Elapsed+", stage "+lastStage+")");
        Check(snapshot.GetProperty("bytesAfter").GetInt64()>0,
            "maintenance must report the final file size");
        // A full VACUUM is a rebuild; an in-place reclaim must never grow the file.
        if(!full)
            Check(snapshot.GetProperty("bytesAfter").GetInt64()<=beforeBytes,
                "in-place reclaim must not increase the database file size");
        Console.WriteLine("VAULT MAINTENANCE ("+(full?"full":"reclaim")+"): "+
            beforeBytes+" bytes -> "+snapshot.GetProperty("bytesAfter").GetInt64()+
            ", "+clock.Elapsed+", mode="+snapshot.GetProperty("mode").GetString());
        await WaitIdleAsync(client);
        return snapshot.Clone();
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
        // Cancelling when nothing runs is a no-op, not an error.
        var idleCancel=await (await client.PostAsync("/api/vault/compact/cancel",null))
            .Content.ReadFromJsonAsync<JsonElement>();
        Check(!idleCancel.GetProperty("requested").GetBoolean(),
            "cancel must report false when no maintenance task is running");
        var pagesBefore=await client.GetFromJsonAsync<JsonElement>("/api/vault/storage");
        CheckStorage(pagesBefore);
        var info=await client.GetFromJsonAsync<JsonElement>("/api/vault/compact/info");
        Check(info.GetProperty("fileBytes").GetInt64()>0 &&
              info.GetProperty("requiredFreeBytes").GetInt64()>0 &&
              info.GetProperty("canCompact").GetBoolean(),
            "SQLCipher size, scratch-space check and status must be available");
        Check(info.GetProperty("mode").GetString()=="incremental",
            "a vault created by this build must report incremental mode");
        Check(info.GetProperty("requiredFreeBytes").GetInt64()<
              info.GetProperty("fullVacuumRequiredBytes").GetInt64(),
            "reclaim must not inherit the 2x full-VACUUM space requirement");
        using(var refuse=await client.PostAsJsonAsync("/api/vault/compact",
            new VaultCompactRequest(false)))
            Check(refuse.StatusCode==HttpStatusCode.BadRequest,
                "server must refuse maintenance without explicit confirmation");

        long before=info.GetProperty("fileBytes").GetInt64();
        var reclaimed=await RunTaskAsync(client,full:false,beforeBytes:before);
        Check(reclaimed.GetProperty("mode").GetString()=="reclaim",
            "the default request must run in-place reclaim, not a rebuild");
        long afterReclaim=reclaimed.GetProperty("bytesAfter").GetInt64();

        var rebuilt=await RunTaskAsync(client,full:true,beforeBytes:afterReclaim);
        Check(rebuilt.GetProperty("mode").GetString()=="full",
            "full:true must still reach the rebuild path");
        var infoAfter=await client.GetFromJsonAsync<JsonElement>("/api/vault/compact/info");
        Check(infoAfter.GetProperty("mode").GetString()=="incremental",
            "a rebuild must preserve the incremental mode");

        using var check=await client.GetAsync("/api/check");
        check.EnsureSuccessStatusCode();
        var verified=await check.Content.ReadFromJsonAsync<JsonElement>();
        Check(verified.GetProperty("result").GetString()=="ok",
            "encrypted database remains readable after maintenance");
        var pagesAfter=await client.GetFromJsonAsync<JsonElement>("/api/vault/storage");
        CheckStorage(pagesAfter);
        Check(pagesAfter.GetProperty("totalBytes").GetInt64()<=
              pagesBefore.GetProperty("totalBytes").GetInt64(),
            "maintenance should not grow this test database's allocated pages");
        Console.WriteLine("VAULT COMPACT ENCRYPTED HTTP SMOKE PASS");
    }
}
