using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// Project UI and direct attachment checks; retired contract routes must fail closed.
static class NativeProjectContractUiHttpSmoke
{
    private static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("PROJECT UI HTTP SMOKE: "+reason);
    }
    private static async Task<JsonElement> Read(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    public static async Task VerifyAsync(HttpClient client,Vault vault)
    {
        string marker="PUI-"+Guid.NewGuid().ToString("N")[..8];
        using(var guest=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await guest.GetAsync("/api/v2/ui/projects/company"))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"authorization");

        long project=(await Read(await client.PostAsJsonAsync(
            "/api/v2/folders/company/project",new{project=new{
                name=marker+"甲",projectType="科研项目",projectNo=marker+"-A",
                leader="负责人",projectStatus="进行中"}}))).GetProperty("id").GetInt64();
        long other=(await Read(await client.PostAsJsonAsync(
            "/api/v2/folders/company/project",new{project=new{
                name=marker+"乙",projectType="横向项目"}}))).GetProperty("id").GetInt64();
        long folder=(await Read(await client.PostAsJsonAsync(
            "/api/v2/folders/company/archive_folder",new{
                section="project",archiveFolder=new{name=marker+"合同资料",parentId=project}
            }))).GetProperty("id").GetInt64();
        long nested=(await Read(await client.PostAsJsonAsync(
            "/api/v2/folders/company/archive_folder",new{
                section="project",archiveFolder=new{name=marker+"附件",parentId=folder}
            }))).GetProperty("id").GetInt64();
        byte[] first=[1,9,4],second=[2,7,6,3];
        long file;
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={project}")
            {Content=new ByteArrayContent(first)})
        {
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString(marker+".pdf"));
            file=(await Read(await client.SendAsync(upload)))
                .GetProperty("fileId").GetInt64();
        }
        using(var newer=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(second)})
        {
            newer.Headers.Add("X-File-Name",Uri.EscapeDataString(marker+"-v2.pdf"));
            await Read(await client.SendAsync(newer));
        }
        using(var association=await client.PostAsJsonAsync(
            $"/api/v2/files/company/{file}/links",new{folderId=nested}))
            association.EnsureSuccessStatusCode();

        var projects=await client.GetFromJsonAsync<JsonElement>("/api/v2/ui/projects/company");
        Check(projects.EnumerateArray().Any(x=>
              x.GetProperty("id").GetInt64()==project &&
              x.GetProperty("projectNo").GetString()==marker+"-A"),
            "project GUI has actual project FolderId and attributes");
        var folders=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/company/archive_folder?section=project&flat=true");
        var direct=folders.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("ref").GetProperty("id").GetInt64()==folder);
        var child=folders.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("ref").GetProperty("id").GetInt64()==nested);
        Check(direct.GetProperty("folder").GetProperty("parent").GetProperty("id").GetInt64()==project &&
              child.GetProperty("folder").GetProperty("parent").GetProperty("id").GetInt64()==folder,
            "project folder tree uses real project and parent identities");
        var directFiles=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/project-files/company");
        var entries=directFiles.EnumerateArray().Where(x=>
            x.GetProperty("folderId").GetInt64()==project &&
            x.GetProperty("fileId").GetInt64()==file).ToArray();
        Check(entries.Length==2 && entries.All(x=>
              x.GetProperty("kind").GetString()=="project"),
            "project direct files expose two versions");
        var linked=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{nested}/links");
        Check(linked.GetArrayLength()==1 &&
              linked[0].GetProperty("fileId").GetInt64()==file,
            "nested project folder shares original FileId");
        for(int version=1;version<=2;version++)
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/{version}/download"))
                .SequenceEqual(version==1?first:second),
                "project and nested folder retain historical bytes");

        using(var order=await client.PostAsJsonAsync(
            "/api/v2/ui/order/company/project",
            new NativeProjectContractOrderInput([other,project])))
            order.EnsureSuccessStatusCode();
        projects=await client.GetFromJsonAsync<JsonElement>("/api/v2/ui/projects/company");
        var positions=projects.EnumerateArray()
            .Select(x=>x.GetProperty("id").GetInt64()).ToArray();
        Check(Array.IndexOf(positions,other)<Array.IndexOf(positions,project),
            "project ledger ordering persists");
        using(var invalid=await client.PostAsJsonAsync(
            "/api/v2/ui/order/company/contract",new NativeProjectContractOrderInput([project])))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,"contract reorder rejected");
        using(var oldUi=await client.GetAsync("/api/v2/ui/contracts/company"))
            Check(oldUi.StatusCode==HttpStatusCode.NotFound,
                "old contract list route removed");
        using(var oldCopy=await client.PostAsync(
            $"/api/v2/ui/contracts/company/{project}/copy",null))
            Check(oldCopy.StatusCode==HttpStatusCode.NotFound,
                "old contract copy route removed");
        using(var oldCreate=await client.PostAsJsonAsync(
            "/api/v2/folders/company/contract",
            new{parentId=project,contract=new{name="旧合同"}}))
            Check(oldCreate.StatusCode==HttpStatusCode.BadRequest,
                "generic folder route cannot create retired contract");
        Console.WriteLine("PROJECT UI / RETIRED CONTRACT HTTP SMOKE PASS");
    }
}
