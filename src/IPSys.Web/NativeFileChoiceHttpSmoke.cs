using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

static class NativeFileChoiceHttpSmoke
{
    static void Check(bool value,string why)
    {
        if(!value)throw new IOException("N3-04 FILE CHOICE HTTP: "+why);
    }
    static async Task<JsonElement> Data(HttpResponseMessage r)
    {
        using(r)
        {
            r.EnsureSuccessStatusCode();
            return await r.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    static async Task<long> Project(HttpClient client,string workspace,string suffix)
    {
        var p=new ProjectInput("查重目录"+suffix,"科研项目","DUP-"+suffix,
            null,null,null,null,null,null,null,null);
        var result=await Data(await client.PostAsJsonAsync(
            $"/api/v2/folders/{workspace}/project",new FolderMutationInput(Project:p)));
        return result.GetProperty("id").GetInt64();
    }
    static HttpRequestMessage UploadRequest(string path,string name,byte[] bytes)
    {
        var req=new HttpRequestMessage(HttpMethod.Post,path)
            {Content=new ByteArrayContent(bytes)};
        req.Headers.TryAddWithoutValidation("X-File-Name",Uri.EscapeDataString(name));
        return req;
    }
    static async Task<long> Upload(HttpClient client,string workspace,long folder,
        string name,byte[] bytes)
    {
        using var req=UploadRequest(
            $"/api/v2/files/{workspace}/upload?folderId={folder}",name,bytes);
        var result=await Data(await client.SendAsync(req));
        return result.GetProperty("fileId").GetInt64();
    }
    static async Task<JsonElement> Prepare(HttpClient client,string workspace,long folder,
        string name,byte[] bytes)
    {
        using var req=UploadRequest(
            $"/api/v2/files/{workspace}/prepare?folderId={folder}",name,bytes);
        return await Data(await client.SendAsync(req));
    }
    static async Task<JsonElement> Decide(HttpClient client,string workspace,string ticket,
        string choice,long? fileId=null)
    {
        return await Data(await client.PostAsJsonAsync(
            $"/api/v2/files/{workspace}/prepared/{ticket}/resolve",
            new NativeFileDecision(choice,fileId)));
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        string suffix=Guid.NewGuid().ToString("N")[..8];
        long a=await Project(client,"company",suffix);
        long b=await Project(client,"company",suffix+"B");
        long personal=await Project(client,"personal",suffix+"P");
        byte[] raw=new byte[1024*1024+5];
        RandomNumberGenerator.Fill(raw);
        long source=await Upload(client,"company",a,"公司原件.pdf",raw);
        await Upload(client,"personal",personal,"个人私有文件.pdf",raw);
        string basePath="/api/v2/files/company/";
        string folderPath=$"{basePath}folders/{b}/links";
        var sameNameDifferentBytes=await Prepare(client,"company",b,
            "公司原件.pdf",new byte[]{9,9,9});
        Check(sameNameDifferentBytes.GetProperty("matches").GetArrayLength()==0,
            "same filename but different bytes must not match");
        using(var discard=await client.DeleteAsync(
            $"/api/v2/files/company/prepared/{sameNameDifferentBytes.GetProperty("ticket").GetString()}"))
            discard.EnsureSuccessStatusCode();
        var match=await Prepare(client,"company",b,"同字节不同名字.docx",raw);
        string ticket=match.GetProperty("ticket").GetString()!;
        Check(match.GetProperty("size").GetInt64()==raw.Length &&
              match.GetProperty("sha256").GetString()==
                    Convert.ToHexString(SHA256.HashData(raw)),
            "hash and size reflect whole stream");
        var duplicates=match.GetProperty("matches");
        Check(duplicates.GetArrayLength()==1 &&
              duplicates[0].GetProperty("fileId").GetInt64()==source &&
              duplicates[0].GetProperty("name").GetString()=="公司原件.pdf" &&
              duplicates[0].GetProperty("folders")[0].GetString()!.Contains("查重目录"),
            "cross-workspace excluded, original name and path shown for renamed content");
        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await anonymous.PostAsJsonAsync(
            $"/api/v2/files/company/prepared/{ticket}/resolve",
            new NativeFileDecision("independent")))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"auth required");
        using(var mismatch=await client.PostAsJsonAsync(
            $"/api/v2/files/personal/prepared/{ticket}/resolve",
            new NativeFileDecision("independent")))
            Check(mismatch.StatusCode==HttpStatusCode.NotFound,"ticket workspace isolation");
        using(var missing=await client.PostAsJsonAsync(
            $"/api/v2/files/company/prepared/invalid-ticket/resolve",
            new NativeFileDecision("independent")))
            Check(missing.StatusCode==HttpStatusCode.NotFound,"ticket cannot be guessed");
        using(var concurrent=UploadRequest(
            $"/api/v2/files/company/prepare?folderId={b}","并行.pdf",raw))
        using(var rejected=await client.SendAsync(concurrent))
            Check(rejected.StatusCode==HttpStatusCode.Conflict,
                "second preparation requires first decision");
        using(var bad=await client.PostAsJsonAsync(
            $"/api/v2/files/company/prepared/{ticket}/resolve",
            new NativeFileDecision("reuse-content",999999)))
            Check(bad.StatusCode==HttpStatusCode.Conflict,
                "chosen source must match file digest");

        var share=await Decide(client,"company",ticket,"share-file",source);
        Check(share.GetProperty("fileId").GetInt64()==source &&
              share.GetProperty("reusedContent").GetBoolean(),"share one FileId");
        var links=await client.GetFromJsonAsync<JsonElement>(folderPath);
        Check(links.GetArrayLength()==1 &&
              links[0].GetProperty("displayName").GetString()=="同字节不同名字.docx",
            "original identity and location alias");
        using(var replay=await client.PostAsJsonAsync(
            $"/api/v2/files/company/prepared/{ticket}/resolve",
            new NativeFileDecision("independent")))
            Check(replay.StatusCode==HttpStatusCode.NotFound,"ticket consumed exactly once");

        var second=await Prepare(client,"company",b,"不同身份.docx",raw);
        var newFile=await Decide(client,"company",
            second.GetProperty("ticket").GetString()!,"reuse-content",source);
        long independentId=newFile.GetProperty("fileId").GetInt64();
        Check(independentId!=source && newFile.GetProperty("reusedContent").GetBoolean(),
            "different FileId, same bytes");
        using(var edit=await client.PutAsJsonAsync(
            $"{basePath}{independentId}/metadata",
            new NativeFileMetadataInput("副本新名字.docx","独立说明")))
            edit.EnsureSuccessStatusCode();
        var sourceInfo=await client.GetFromJsonAsync<JsonElement>(basePath+source);
        Check(sourceInfo.GetProperty("name").GetString()=="公司原件.pdf" &&
              sourceInfo.GetProperty("description").ValueKind==JsonValueKind.Null,
            "source untouched by independent metadata edit");
        var third=await Prepare(client,"company",b,"完全单独保存.pdf",raw);
        var saved=await Decide(client,"company",
            third.GetProperty("ticket").GetString()!,"independent");
        long savedId=saved.GetProperty("fileId").GetInt64();
        Check(savedId!=source && savedId!=independentId &&
              !saved.GetProperty("reusedContent").GetBoolean(),"fully independent object");
        using(var downloaded=await client.GetAsync(
            $"{basePath}{savedId}/versions/1/download"))
        {
            downloaded.EnsureSuccessStatusCode();
            Check(raw.SequenceEqual(await downloaded.Content.ReadAsByteArrayAsync()),
                "independent ready bytes roundtrip");
        }

        var fourth=await Prepare(client,"company",b,"取消上传.pdf",raw);
        string canceledTicket=fourth.GetProperty("ticket").GetString()!;
        using(var cancel=await client.DeleteAsync(
            $"/api/v2/files/company/prepared/{canceledTicket}"))
            cancel.EnsureSuccessStatusCode();
        using(var afterCancel=await client.PostAsJsonAsync(
            $"/api/v2/files/company/prepared/{canceledTicket}/resolve",
            new NativeFileDecision("independent")))
            Check(afterCancel.StatusCode==HttpStatusCode.NotFound,
                "cancel discards pending ticket");
        var bLinks=await client.GetFromJsonAsync<JsonElement>(folderPath);
        Check(bLinks.GetArrayLength()==3,"cancel created no visible file");
        var fifth=await Prepare(client,"company",b,"待确认清理测试.pdf",raw);
        using(var cleanup=await client.DeleteAsync(
            $"/api/v2/files/company/prepared/{fifth.GetProperty("ticket").GetString()}"))
            cleanup.EnsureSuccessStatusCode();
        Console.WriteLine("N3-04 DUPLICATE CHOICE HTTP SMOKE PASS");
    }
}
