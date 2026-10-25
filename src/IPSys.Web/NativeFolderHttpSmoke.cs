using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

static class NativeFolderHttpSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool ok,string reason)
        {
            if(!ok)throw new IOException("N2 native folder smoke: "+reason);
        }
        static async Task<long> Created(HttpResponseMessage r)
        {
            using(r)
            {
                r.EnsureSuccessStatusCode();
                return (await r.Content.ReadFromJsonAsync<JsonElement>())
                    .GetProperty("id").GetInt64();
            }
        }
        string suffix=Guid.NewGuid().ToString("N")[..8];
        const string root="/api/v2/folders/company/";
        var p=new ProjectInput("V2项目"+suffix,"科研项目","N2-"+suffix,
            null,null,null,null,null,null,null,null);
        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await anonymous.PostAsJsonAsync(root+"project",
            new FolderMutationInput(Project:p)))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"auth");
        long project=await Created(await client.PostAsJsonAsync(root+"project",
            new FolderMutationInput(Project:p)));
        var c=new ContractInput("V2合同"+suffix,"C-"+suffix,null,"20.00",
            null,null,null,null);
        using(var orphan=await client.PostAsJsonAsync(root+"contract",
            new FolderMutationInput(Contract:c)))
            Check(orphan.StatusCode==HttpStatusCode.BadRequest,"orphan");
        using(var cross=await client.PostAsJsonAsync("/api/v2/folders/personal/contract",
            new FolderMutationInput(ParentId:project,Contract:c)))
            Check(cross.StatusCode==HttpStatusCode.NotFound,"parent isolation");
        long contract=await Created(await client.PostAsJsonAsync(root+"contract",
            new FolderMutationInput(ParentId:project,Contract:c)));
        var details=await client.GetFromJsonAsync<JsonElement>(root+"contract/"+contract);
        Check(details.GetProperty("folder").GetProperty("parent")
            .GetProperty("id").GetInt64()==project,"parent reference");
        Check(details.GetProperty("businessData").GetProperty("amount")
            .GetString()=="20.00","contract metadata");
        var ip=new IpInput("V2专利"+suffix,"发明专利","已申请",
            null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null);
        long patent=await Created(await client.PostAsJsonAsync("/api/v2/folders/personal/ip",
            new FolderMutationInput(Ip:ip)));
        Check(patent>0,"IP");
        using(var deleted=await client.DeleteAsync(root+"project/"+project))
            deleted.EnsureSuccessStatusCode();
        using(var missing=await client.GetAsync(root+"contract/"+contract))
            Check(missing.StatusCode==HttpStatusCode.NotFound,"hidden child");
        using(var restored=await client.PostAsync(root+"project/"+project+"/restore",null))
            restored.EnsureSuccessStatusCode();
        using(var visible=await client.GetAsync(root+"contract/"+contract))
            visible.EnsureSuccessStatusCode();
        Console.WriteLine("N2 NATIVE FOLDER HTTP SMOKE PASS");
    }
}
