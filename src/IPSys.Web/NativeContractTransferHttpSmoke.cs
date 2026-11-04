using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// Retired contract transfer rejects; real project ordinary folders can be moved.
static class NativeContractTransferHttpSmoke
{
    private static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("PROJECT DIRECTORY TRANSFER SMOKE: "+reason);
    }
    private static async Task<long> NewId(HttpResponseMessage reply)
    {
        using(reply)
        {
            reply.EnsureSuccessStatusCode();
            return (await reply.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("id").GetInt64();
        }
    }
    public static async Task VerifyAsync(HttpClient client,Vault vault)
    {
        string mark="PDT-"+Guid.NewGuid().ToString("N")[..8];
        long a=await NewId(await client.PostAsJsonAsync(
            "/api/v2/folders/company/project",
            new{project=new{name=mark+"甲",projectType="科研项目"}}));
        long b=await NewId(await client.PostAsJsonAsync(
            "/api/v2/folders/company/project",
            new{project=new{name=mark+"乙",projectType="科研项目"}}));
        long folder=await NewId(await client.PostAsJsonAsync(
            "/api/v2/folders/company/archive_folder",new{
                section="project",archiveFolder=new{name=mark+"合同目录",parentId=a}}));
        long child=await NewId(await client.PostAsJsonAsync(
            "/api/v2/folders/company/archive_folder",new{
                section="project",archiveFolder=new{name=mark+"附件",parentId=folder}}));
        byte[] first=[9,8,7,6],revised=[5,4,3,2,1];
        long file;
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={child}")
            {Content=new ByteArrayContent(first)})
        {
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+".pdf"));
            file=await NewIdFromUpload(await client.SendAsync(upload));
        }
        using(var req=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(revised)})
        {
            req.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+"-v2.pdf"));
            using var result=await client.SendAsync(req);
            result.EnsureSuccessStatusCode();
        }
        var before=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{child}/links");
        long link=before[0].GetProperty("id").GetInt64();
        using(var retired=await client.PostAsJsonAsync(
            $"/api/v2/contracts/company/{folder}/transfer",
            new{targetWorkspace="personal",targetProjectId=b,move=true}))
            Check(retired.StatusCode==HttpStatusCode.NotFound,
                "retired contract transfer HTTP route is absent");

        using(var move=await client.PostAsJsonAsync(
            $"/api/v2/folders/company/archive_folder/{folder}/move?section=project",
            new NativeFolderMoveInput(b)))
            move.EnsureSuccessStatusCode();
        var moved=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/folders/company/archive_folder/{folder}?section=project");
        Check(moved.GetProperty("folder").GetProperty("parent")
            .GetProperty("id").GetInt64()==b,"directory reparented to another project");
        var nested=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/folders/company/archive_folder/{child}?section=project");
        Check(nested.GetProperty("folder").GetProperty("parent")
            .GetProperty("id").GetInt64()==folder,
            "nested directory identity remains stable after parent move");
        var after=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{child}/links");
        Check(after[0].GetProperty("id").GetInt64()==link &&
              after[0].GetProperty("fileId").GetInt64()==file,
            "project folder move retains LinkId/FileId");
        for(int ver=1;ver<=2;ver++)
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/{ver}/download"))
                .SequenceEqual(ver==1?first:revised),
                "folder move retains all original version bytes");
        Console.WriteLine("PROJECT DIRECTORY TRANSFER / CONTRACT RETIREMENT PASS");
    }
    private static async Task<long> NewIdFromUpload(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            var result=await response.Content.ReadFromJsonAsync<JsonElement>();
            return result.GetProperty("fileId").GetInt64();
        }
    }
}
