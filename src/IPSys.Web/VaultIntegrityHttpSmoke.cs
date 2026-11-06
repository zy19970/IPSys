using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// HTTP regression over WebSmoke's disposable SQLCipher database only.
static class VaultIntegrityHttpSmoke
{
    private static void Check(bool condition,string reason)
    {
        if(!condition)throw new IOException("VAULT INTEGRITY HTTP: "+reason);
    }

    public static async Task VerifyAsync(HttpClient client)
    {
        using(var stranger=new HttpClient{BaseAddress=client.BaseAddress})
        {
            using var deniedStatus=await stranger.GetAsync("/api/vault/integrity/task");
            using var deniedStart=await stranger.PostAsync("/api/vault/integrity",null);
            Check(deniedStatus.StatusCode==HttpStatusCode.Unauthorized &&
                  deniedStart.StatusCode==HttpStatusCode.Unauthorized,
                "Status and scan initiation must require the active SQLCipher session");
        }

        // Read the fixture size BEFORE acquiring the exclusive integrity
        // file-task lock. /api/vault/storage intentionally returns 409 while
        // any database file task is active.
        var size=await client.GetFromJsonAsync<JsonElement>("/api/vault/storage");
        long bytes=size.GetProperty("totalBytes").GetInt64();
        var budget=bytes>=512L*1024*1024
            ? TimeSpan.FromMinutes(12):TimeSpan.FromSeconds(60);
        using var started=await client.PostAsync("/api/vault/integrity",null);
        Check(started.StatusCode==HttpStatusCode.Accepted,
            "Integrity check must start asynchronously and immediately return task ID");
        var first=await started.Content.ReadFromJsonAsync<JsonElement>();
        string id=first.GetProperty("taskId").GetString()??"";
        Check(id.Length>=16,"Task ID must be present");
        using var active=await client.PostAsync("/api/vault/integrity",null);
        Check(active.StatusCode==HttpStatusCode.Conflict ||
              active.StatusCode==HttpStatusCode.Accepted,
            "Concurrent start only races with a scan that has already completed");
        // If the test database is tiny, a second scan may start immediately.
        // Avoid leaving it running before the next destructive smoke step.
        string? waitId=id;
        if(active.StatusCode==HttpStatusCode.Accepted)
        {
            var next=await active.Content.ReadFromJsonAsync<JsonElement>();
            waitId=next.GetProperty("taskId").GetString();
        }

        // Large encrypted test fixtures can take much longer than a tiny vault.
        var clock=Stopwatch.StartNew();
        bool complete=false;
        while(clock.Elapsed<budget)
        {
            var state=await client.GetFromJsonAsync<JsonElement>("/api/vault/integrity/task");
            Check(state.GetProperty("taskId").GetString()==waitId,
                "Query uses the most recent task identity without entering DB Gate");
            string status=state.GetProperty("state").GetString()??"";
            Check(state.GetProperty("totalSteps").GetInt32()==2 &&
                  state.GetProperty("completedSteps").GetInt32() is >=0 and <=2,
                "Progress stages must be bounded and represent actual completed phases");
            if(status=="succeeded")
            {
                Check(state.GetProperty("result").GetString()=="ok" &&
                      state.GetProperty("incomplete").GetInt64()==0 &&
                      state.GetProperty("completedSteps").GetInt32()==2,
                    "Server completed the actual PRAGMA integrity_check and file-object count");
                complete=true;break;
            }
            if(status is "failed" or "canceled")
                throw new IOException("VAULT INTEGRITY HTTP: task ended "+status+
                    ", "+state.GetProperty("error"));
            await Task.Delay(250);
        }
        Check(complete,"Integrity scan did not finish within "+budget+" (bytes="+bytes+")");
        bool idle=false;
        for(int i=0;i<60;i++)
        {
            var status=await client.GetFromJsonAsync<JsonElement>("/api/task");
            if(!status.GetProperty("active").GetBoolean()){idle=true;break;}
            await Task.Delay(20);
        }
        Check(idle,"Integrity scan must release the exclusive file-task flag");
        Console.WriteLine("VAULT INTEGRITY HTTP PASS: background stages, auth and task status");
    }
}
