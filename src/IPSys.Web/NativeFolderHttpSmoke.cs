using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// The generic V2 HTTP folder surface now exposes project, IP and ordinary folders.
// "contract" is a retired business kind and must fail closed.
static class NativeFolderHttpSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool ok,string reason)
        {
            if(!ok)throw new IOException("NATIVE FOLDER HTTP SMOKE: "+reason);
        }
        static async Task<long> Created(HttpResponseMessage reply)
        {
            using(reply)
            {
                reply.EnsureSuccessStatusCode();
                return (await reply.Content.ReadFromJsonAsync<JsonElement>())
                    .GetProperty("id").GetInt64();
            }
        }
        string suffix=Guid.NewGuid().ToString("N")[..8];
        const string root="/api/v2/folders/company/";
        var projectInput=new ProjectInput("项目"+suffix,"科研项目","P-"+suffix,
            null,null,null,null,null,null,null,null);
        using(var guest=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await guest.PostAsJsonAsync(root+"project",
            new FolderMutationInput(Project:projectInput)))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,
                "unauthorized create blocked");
        long project=await Created(await client.PostAsJsonAsync(root+"project",
            new FolderMutationInput(Project:projectInput)));
        var nested=new FolderMutationInput(
            ArchiveFolder:new ArchiveFolderInput("项目下合同文件夹"+suffix,project),
            Section:"project");
        long folder=await Created(await client.PostAsJsonAsync(root+"archive_folder",nested));
        long grandchild=await Created(await client.PostAsJsonAsync(root+"archive_folder",
            new FolderMutationInput(
                ArchiveFolder:new ArchiveFolderInput("二级目录"+suffix,folder),
                Section:"project")));
        using(var orphan=await client.PostAsJsonAsync(root+"archive_folder",
            new FolderMutationInput(ArchiveFolder:new ArchiveFolderInput("无主项目目录",null),
                Section:"project")))
            Check(orphan.StatusCode==HttpStatusCode.Conflict ||
                  orphan.StatusCode==HttpStatusCode.BadRequest,
                "project directory cannot be orphaned");
        using(var retired=await client.PostAsJsonAsync(root+"contract",
            new{parentId=project,contract=new{name="不允许的旧合同业务"}}))
            Check(retired.StatusCode==HttpStatusCode.BadRequest,
                "retired contract POST is rejected");
        using(var retiredGet=await client.GetAsync(root+"contract"))
            Check(retiredGet.StatusCode==HttpStatusCode.BadRequest,
                "retired contract GET is rejected");
        var details=await client.GetFromJsonAsync<JsonElement>(
            root+"archive_folder/"+grandchild+"?section=project");
        Check(details.GetProperty("folder").GetProperty("parent")
            .GetProperty("id").GetInt64()==folder,
            "second-level directory has the real parent FolderId");
        var ip=new IpInput("专利"+suffix,"发明专利","已申请",
            null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null);
        long patent=await Created(await client.PostAsJsonAsync(
            "/api/v2/folders/personal/ip",new FolderMutationInput(Ip:ip)));
        Check(patent>0,"native IP CRUD unchanged");
        using(var deleted=await client.DeleteAsync(root+"project/"+project))
            deleted.EnsureSuccessStatusCode();
        using(var hidden=await client.GetAsync(root+"archive_folder/"+grandchild+"?section=project"))
            Check(hidden.StatusCode==HttpStatusCode.NotFound,
                "project soft-delete hides its descendant folders");
        using(var restored=await client.PostAsync(root+"project/"+project+"/restore",null))
            restored.EnsureSuccessStatusCode();
        using(var visible=await client.GetAsync(
            root+"archive_folder/"+grandchild+"?section=project"))
            visible.EnsureSuccessStatusCode();
        Console.WriteLine("NATIVE FOLDER HTTP PROJECT DIRECTORY PASS");
    }
}
