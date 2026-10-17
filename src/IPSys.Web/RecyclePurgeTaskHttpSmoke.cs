using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// Real HTTP + disposable SQLCipher: the long-running purge is independently
// pollable, not a synchronous POST waiting for one giant DELETE statement.
static class RecyclePurgeTaskHttpSmoke
{
    private static void Check(bool value,string message)
    {
        if(!value)throw new IOException("RECYCLE PURGE TASK HTTP: "+message);
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        string tag=Guid.NewGuid().ToString("N")[..8];
        var project=new ProjectInput("永久删除进度"+tag,"科研项目","PURGE-"+tag,
            null,null,null,null,null,null,null,null);
        using var created=await client.PostAsJsonAsync(
            "/api/v2/folders/company/project",new FolderMutationInput(Project:project));
        created.EnsureSuccessStatusCode();
        long folder=(await created.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();

        byte[] content=new byte[2*1024*1024+9];
        for(int i=0;i<content.Length;i++)content[i]=(byte)(i%251);
        using var req=new HttpRequestMessage(HttpMethod.Post,
            "/api/v2/files/company/upload?folderId="+folder)
            {Content=new ByteArrayContent(content)};
        req.Headers.TryAddWithoutValidation("X-File-Name",
            Uri.EscapeDataString("进度原件.bin"));
        using var uploaded=await client.SendAsync(req);
        uploaded.EnsureSuccessStatusCode();
        long fileId=(await uploaded.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("fileId").GetInt64();
        var links=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{folder}/links");
        long linkId=links.EnumerateArray().Single().GetProperty("id").GetInt64();
        using(var removed=await client.DeleteAsync(
            $"/api/v2/files/company/{fileId}/links/{linkId}"))
            removed.EnsureSuccessStatusCode();
        using var request=await client.PostAsJsonAsync("/api/trash/company/purge-task",
            new RecycleRequest([new RecycleKey("v2_file",linkId,"")]));
        Check(request.StatusCode==HttpStatusCode.Accepted,
            "server must return a task instead of blocking until completion");
        string id=(await request.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("taskId").GetString()!;

        // The current user may switch to personal workspace while the
        // company job is running. Vault-wide status must stay readable.
        using(var wrongScoped=await client.GetAsync("/api/trash/personal/purge-task"))
            Check(wrongScoped.StatusCode==HttpStatusCode.NotFound,
                "workspace-scoped status remains isolated");
        using(var crossSpace=await client.GetAsync("/api/trash/purge-task"))
        {
            crossSpace.EnsureSuccessStatusCode();
            var snapshot=await crossSpace.Content.ReadFromJsonAsync<JsonElement>();
            Check(snapshot.GetProperty("workspace").GetString()=="company" &&
                  snapshot.GetProperty("taskId").GetString()==id,
                  "global lock-free task status survives selecting personal workspace");
        }

        // Poll the task without blocking on the SQLCipher connection Gate.
        JsonElement status=default;
        bool terminal=false;
        for(int i=0;i<200;i++)
        {
            using var result=await client.GetAsync("/api/trash/purge-task");
            result.EnsureSuccessStatusCode();
            status=await result.Content.ReadFromJsonAsync<JsonElement>();
            Check(status.GetProperty("taskId").GetString()==id,"stable task identity");
            Check(status.GetProperty("count").GetInt32()==1,"selection count");
            string state=status.GetProperty("state").GetString()!;
            if(state is "succeeded" or "failed" or "canceled"){terminal=true;break;}
            await Task.Delay(60);
        }
        Check(terminal,"task must reach a terminal status");
        Check(status.GetProperty("state").GetString()=="succeeded",
            "task failure: "+status.GetProperty("error").ToString());
        Check(status.GetProperty("bytesTotal").GetInt64()==content.LongLength,
            "total physical bytes must equal the orphaned chunk content");
        Check(status.GetProperty("bytesDone").GetInt64()==content.LongLength,
            "task must count actual removed chunk bytes");
        using(var missing=await client.GetAsync(
            $"/api/v2/files/company/{fileId}/versions/1/download"))
            Check(missing.StatusCode==HttpStatusCode.NotFound,
                "success returned only after file history permanently removed");
        // The successful task state can become visible a moment before the
        // FileTaskActive lock is released. Observe both before another request.
        bool idle=false;
        for(int i=0;i<100;i++)
        {
            var fileTask=await client.GetFromJsonAsync<JsonElement>("/api/task");
            if(!fileTask.GetProperty("active").GetBoolean()){idle=true;break;}
            await Task.Delay(20);
        }
        Check(idle,"completed purge must release the file-task lock");
        using(var repeat=await client.PostAsJsonAsync("/api/trash/company/purge-task",
            new RecycleRequest([new RecycleKey("v2_file",linkId,"")])))
        {
            Check(repeat.StatusCode==HttpStatusCode.Accepted,
                "repeat request must be separately tracked as a failed task");
        }
        // A repeated request must NOT transform a failed delete into success.
        bool rejected=false;
        for(int i=0;i<100;i++)
        {
            var result=await client.GetFromJsonAsync<JsonElement>(
                "/api/trash/company/purge-task");
            if(result.GetProperty("state").GetString()=="failed")
            {rejected=true;break;}
            await Task.Delay(30);
        }
        Check(rejected,"duplicate purge must report failure, never false success");
        Console.WriteLine("RECYCLE PURGE TASK SQLCIPHER HTTP SMOKE PASS");
    }
}
