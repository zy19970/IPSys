using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// N2-03-02: complete V2 IP Folder -> FileLink -> FileVersion -> encrypted
// content roundtrip. Legacy business APIs are read only for no-dual-write checks.
static class NativeIpFileHttpSmoke
{
    static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("N2-03-02 V2 IP attachments: "+reason);
    }
    static async Task<long> CreateIp(HttpClient client,string workspace,string name)
    {
        var ip=new IpInput(name,"发明专利","已申请",
            null,null,null,null,null,null,null,null,null,null,
            null,null,null,null,null,null,null);
        using var r=await client.PostAsJsonAsync(
            $"/api/v2/folders/{workspace}/ip",new FolderMutationInput(Ip:ip));
        r.EnsureSuccessStatusCode();
        var json=await r.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("id").GetInt64();
    }
    static HttpRequestMessage Upload(string path,string name,byte[] bytes,string? category=null)
    {
        var req=new HttpRequestMessage(HttpMethod.Post,path)
            {Content=new ByteArrayContent(bytes)};
        req.Headers.TryAddWithoutValidation("X-File-Name",
            Uri.EscapeDataString(name));
        if(category!=null)
            req.Headers.TryAddWithoutValidation("X-Material-Category",
                Uri.EscapeDataString(category));
        return req;
    }
    static async Task<JsonElement> UploadSuccess(HttpClient client,HttpRequestMessage req)
    {
        using(req)
        using(var response=await client.SendAsync(req))
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    static async Task<byte[]> Download(HttpClient client,string url)
    {
        using var r=await client.GetAsync(url);
        r.EnsureSuccessStatusCode();
        return await r.Content.ReadAsByteArrayAsync();
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        string key=Guid.NewGuid().ToString("N")[..8];
        long ip=await CreateIp(client,"company","原生IP原件"+key);
        long second=await CreateIp(client,"company","共享IP"+key);
        long foreign=await CreateIp(client,"personal","跨区IP"+key);
        byte[] v1=RandomNumberGenerator.GetBytes(1024*1024+37);
        byte[] v2=RandomNumberGenerator.GetBytes(135);
        string root=$"/api/v2/ip/company/{ip}/files";
        string other=$"/api/v2/ip/company/{second}/files";
        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await anonymous.GetAsync(root))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"requires session token");
        using(var wrong=await client.GetAsync($"/api/v2/ip/personal/{ip}/files"))
            Check(wrong.StatusCode==HttpStatusCode.NotFound,"foreign IP id not resolved");
        using(var bad=Upload(root,"非法分类.pdf",new byte[]{1},"没定义的材料类别"))
        using(var denied=await client.SendAsync(bad))
            Check(denied.StatusCode==HttpStatusCode.BadRequest,"invalid material category");
        var created=await UploadSuccess(client,
            Upload(root,"原件申请.pdf",v1,"申请材料"));
        long fileId=created.GetProperty("fileId").GetInt64();
        Check(created.GetProperty("version").GetInt32()==1 &&
              created.GetProperty("size").GetInt64()==v1.Length,
            "v1 committed with stable file identity");
        string fileUrl=root+"/"+fileId;
        var list=await client.GetFromJsonAsync<JsonElement>(root);
        Check(list.GetArrayLength()==1 &&
              list[0].GetProperty("fileId").GetInt64()==fileId &&
              list[0].GetProperty("materialCategory").GetString()=="申请材料",
            "IP attachment category and folder linkage");
        long firstLink=list[0].GetProperty("id").GetInt64();
        Check(v1.SequenceEqual(await Download(client,fileUrl+"/versions/1/download")),
            "encrypted first version matches source bytes");
        using(var wrong=await client.GetAsync(other+"/"+fileId))
            Check(wrong.StatusCode==HttpStatusCode.NotFound,
                "another IP cannot see unlinked file");
        using(var wrong=Upload(other+"/"+fileId+"/versions","越权v2.pdf",new byte[]{8}))
        using(var denied=await client.SendAsync(wrong))
            Check(denied.StatusCode==HttpStatusCode.NotFound,
                "cannot upload version through another IP");

        var ver=await UploadSuccess(client,
            Upload(fileUrl+"/versions","补充材料v2.pdf",v2));
        Check(ver.GetProperty("version").GetInt32()==2,"same logical file v2");
        var details=await client.GetFromJsonAsync<JsonElement>(fileUrl);
        Check(details.GetProperty("versions").GetArrayLength()==2 &&
              details.GetProperty("versions")[0].GetProperty("version").GetInt32()==2,
              "V2 details expose all version history");
        Check(v1.SequenceEqual(await Download(client,fileUrl+"/versions/1/download")) &&
              v2.SequenceEqual(await Download(client,fileUrl+"/versions/2/download")),
              "old and new version encrypted bytes preserved");

        using(var associated=await client.PostAsJsonAsync(
            other+"/"+fileId+"/associate",
            new NativeIpAssociateInput("共享的申请文件","其他材料")))
            associated.EnsureSuccessStatusCode();
        var otherLinks=await client.GetFromJsonAsync<JsonElement>(other);
        Check(otherLinks.GetArrayLength()==1 &&
              otherLinks[0].GetProperty("fileId").GetInt64()==fileId &&
              otherLinks[0].GetProperty("latestVersion").GetInt32()==2,
              "new IP links exactly the same FileId and version");
        long secondLink=otherLinks[0].GetProperty("id").GetInt64();
        using(var wrong=await client.DeleteAsync(
            fileUrl+"/links/"+secondLink))
            Check(wrong.StatusCode==HttpStatusCode.NotFound,
                "IP cannot unlink another IP association");
        using(var unlinked=await client.DeleteAsync(
            fileUrl+"/links/"+firstLink))
            unlinked.EnsureSuccessStatusCode();
        Check((await client.GetFromJsonAsync<JsonElement>(root)).GetArrayLength()==0,
              "one IP unlink hides only its own link");
        using(var noAccess=await client.GetAsync(fileUrl+"/versions/1/download"))
            Check(noAccess.StatusCode==HttpStatusCode.NotFound,
                "unlinked IP has no access to shared bytes");
        var third=await UploadSuccess(client,
            Upload(other+"/"+fileId+"/versions","共享v3.pdf",new byte[]{3,4,5}));
        Check(third.GetProperty("version").GetInt32()==3 &&
              (await client.GetFromJsonAsync<JsonElement>(root)).GetArrayLength()==0,
              "new shared version never resurrects removed link");
        using(var restore=await client.PostAsync(
            fileUrl+"/links/"+firstLink+"/restore",null))
            restore.EnsureSuccessStatusCode();
        Check((await client.GetFromJsonAsync<JsonElement>(root))[0]
                  .GetProperty("latestVersion").GetInt32()==3,
              "explicit restore sees common newest version");
        using(var edit=await client.PutAsJsonAsync(
            $"/api/v2/folders/company/ip/{ip}",
            new FolderMutationInput(Ip:new IpInput("修改的IP原件"+key,
                "发明专利","已申请",null,null,null,null,null,null,null,null,
                null,null,null,null,null,null,null,null,null))))
            edit.EnsureSuccessStatusCode();
        Check((await client.GetFromJsonAsync<JsonElement>(fileUrl))
                 .GetProperty("versions").GetArrayLength()==3,
              "changing IP Folder properties creates no file version");

        using(var deleted=await client.DeleteAsync(
            $"/api/v2/folders/company/ip/{ip}"))
            deleted.EnsureSuccessStatusCode();
        using(var hidden=await client.GetAsync(fileUrl))
            Check(hidden.StatusCode==HttpStatusCode.NotFound,"deleted IP hides original");
        using(var restored=await client.PostAsync(
            $"/api/v2/folders/company/ip/{ip}/restore",null))
            restored.EnsureSuccessStatusCode();
        Check(v1.SequenceEqual(await Download(client,fileUrl+"/versions/1/download")),
            "restored IP retains original bytes");
        using(var foreignScope=await client.GetAsync(
            $"/api/v2/ip/personal/{foreign}/files/{fileId}"))
            Check(foreignScope.StatusCode==HttpStatusCode.NotFound,
                "cannot reach company file from personal IP");
        var legacy=await client.GetFromJsonAsync<JsonElement>(
            "/api/business-files/company");
        Check(!legacy.EnumerateArray().Any(x=>
            x.TryGetProperty("name",out var n)&&n.GetString()=="原件申请.pdf"),
            "V2 IP attachment never double-writes old business attachment tables");
        Console.WriteLine("N2-03-02 V2 IP FILE HTTP SMOKE PASS");
    }
}
