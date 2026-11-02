using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// B02: a cross-workspace business-archive transfer must name its destination
// folder by id. Directory names are user-editable, so no rule may resolve a
// target by matching "其他业务资料" or any other default label.
static class NativeTransferTargetSmoke
{
    private static void Check(bool ok,string what)
    {
        if(!ok)throw new IOException("TRANSFER TARGET: "+what);
    }
    private static async Task<JsonElement> Read(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    private static async Task<string> Failure(HttpResponseMessage response)
    {
        using(response)
        {
            string body=await response.Content.ReadAsStringAsync();
            try
            {
                using var json=JsonDocument.Parse(body);
                if(json.RootElement.TryGetProperty("error",out var error))
                    return error.GetString()??body;
            }
            catch(JsonException){}
            return body;
        }
    }

    public static async Task VerifyAsync(HttpClient client)
    {
        string mark="XFER-"+Guid.NewGuid().ToString("N")[..8];
        const string materials="/api/v2/folders/company/archive_folder";

        long source=(await Read(await client.PostAsJsonAsync(
            "/api/v2/folders/personal/archive_folder",new{
                section="achievement",archiveFolder=new{name=mark+"来源资料"}})))
            .GetProperty("id").GetInt64();
        string transfer=$"/api/v2/ui/archive/personal/achievement/{source}/transfer";

        using(var missing=await client.PostAsJsonAsync(transfer,new{
            targetWorkspace="company",targetSection="achievement",move=false}))
        {
            Check(missing.StatusCode==HttpStatusCode.BadRequest,
                "business-archive transfer without a target folder must be rejected");
            string message=await Failure(missing);
            Check(message.Contains("targetFolderId"),
                "rejection must name the missing parameter, got: "+message);
        }

        using(var unknown=await client.PostAsJsonAsync(transfer,new{
            targetWorkspace="company",targetSection="achievement",move=false,
            targetFolderId=long.MaxValue}))
        {
            Check(unknown.StatusCode==HttpStatusCode.NotFound,
                "unknown target folder must be reported as not found");
            Check((await Failure(unknown)).Contains("不存在"),
                "unknown target folder must explain that it does not exist");
        }

        // A folder that exists but belongs to another module is a distinct,
        // actionable error - not a silent fallback to some other directory.
        long certificate=(await Read(await client.PostAsJsonAsync(
            "/api/v2/folders/company/archive_folder",new{
                section="certificate",archiveFolder=new{name=mark+"资质目录"}})))
            .GetProperty("id").GetInt64();
        using(var wrongSection=await client.PostAsJsonAsync(transfer,new{
            targetWorkspace="company",targetSection="achievement",move=false,
            targetFolderId=certificate}))
        {
            Check(wrongSection.StatusCode==HttpStatusCode.BadRequest,
                "folder from another module must be rejected");
            Check((await Failure(wrongSection)).Contains("资料类别"),
                "wrong-module rejection must name the real mismatch");
        }

        long recycled=(await Read(await client.PostAsJsonAsync(materials,new{
            section="achievement",archiveFolder=new{name=mark+"回收站目录"}})))
            .GetProperty("id").GetInt64();
        using(var deleted=await client.DeleteAsync(
            materials+"/"+recycled+"?section=achievement"))
            Check(deleted.IsSuccessStatusCode,"temporary target folder deleted");
        using(var inTrash=await client.PostAsJsonAsync(transfer,new{
            targetWorkspace="company",targetSection="achievement",move=false,
            targetFolderId=recycled}))
        {
            Check(inTrash.StatusCode==HttpStatusCode.Conflict,
                "target folder in the recycle bin must be rejected as a conflict");
            Check((await Failure(inTrash)).Contains("回收站"),
                "recycle-bin rejection must tell the user to restore first");
        }

        // The positive path lands exactly in the named folder.
        long category=(await Read(await client.PostAsJsonAsync(materials,new{
            section="achievement",archiveFolder=new{name=mark+"目标分类"}})))
            .GetProperty("id").GetInt64();
        var copied=await Read(await client.PostAsJsonAsync(transfer,new{
            targetWorkspace="company",targetSection="achievement",move=false,
            targetFolderId=category}));
        long copiedId=copied.GetProperty("id").GetInt64();
        var stored=await client.GetFromJsonAsync<JsonElement>(
            materials+"/"+copiedId+"?section=achievement");
        Check(stored.GetProperty("folder").GetProperty("parent").GetProperty("id")
                .GetInt64()==category,
            "explicit target folder must be the real parent of the copy");
        Check(stored.GetProperty("folder").GetProperty("name").GetString()==
                mark+"来源资料",
            "copy keeps the source name when the target level has no clash");

        Console.WriteLine("TRANSFER TARGET SMOKE PASS");
    }
}
