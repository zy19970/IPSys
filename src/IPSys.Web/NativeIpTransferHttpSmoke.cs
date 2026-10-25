using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// Whole knowledge-property folder copy/move must commit all FileVersions
// or roll back the target folder; cross workspace must never share FileObjects.
static class NativeIpTransferHttpSmoke
{
    static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("N2-03-05 native IP transfer: "+reason);
    }
    static async Task<JsonElement> Response(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    static async Task<JsonElement> Upload(HttpClient client,string url,byte[] bytes,
        string name,string? category=null)
    {
        using var request=new HttpRequestMessage(HttpMethod.Post,url)
            {Content=new ByteArrayContent(bytes)};
        request.Headers.Add("X-File-Name",Uri.EscapeDataString(name));
        if(category!=null)
            request.Headers.Add("X-Material-Category",Uri.EscapeDataString(category));
        return await Response(await client.SendAsync(request));
    }
    static async Task<JsonElement> Transfer(HttpClient client,string workspace,long id,
        string target,bool move=false)=>await Response(await client.PostAsJsonAsync(
            $"/api/v2/ip/{workspace}/{id}/transfer",new{targetWorkspace=target,move}));
    public static async Task VerifyAsync(HttpClient client,Vault vault)
    {
        string unique="XFER-"+Guid.NewGuid().ToString("N")[..8];
        var created=await Response(await client.PostAsJsonAsync(
            "/api/v2/folders/company/ip",new{
                ip=new{name=unique,ipType="发明专利",status="实质审查中",
                    number=unique+"-CN",remarks="复制全文档版本"}
            }));
        long id=created.GetProperty("id").GetInt64();
        byte[] a=RandomNumberGenerator.GetBytes(3333),
            b=RandomNumberGenerator.GetBytes(6789),
            a2=RandomNumberGenerator.GetBytes(4444);
        var f1=await Upload(client,$"/api/v2/ip/company/{id}/files",a,
            unique+"申请.pdf","申请材料");
        var f2=await Upload(client,$"/api/v2/ip/company/{id}/files",b,
            unique+"证书.pdf","证书文件");
        long file1=f1.GetProperty("fileId").GetInt64();
        long file2=f2.GetProperty("fileId").GetInt64();
        await Upload(client,$"/api/v2/ip/company/{id}/files/{file1}/versions",
            a2,unique+"申请修订版.pdf");
        var list=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/ip/company/{id}/files");
        Check(list.GetArrayLength()==2,"source IP two independent files");

        var copied=await Transfer(client,"company",id,"personal");
        long to=copied.GetProperty("id").GetInt64();
        Check(copied.GetProperty("files").GetInt32()==2 &&
              copied.GetProperty("versions").GetInt32()==3 &&
              copied.GetProperty("newObjects").GetInt32()==3,
            "all three original version objects independently cloned cross workspace");
        var target=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/ip/personal/{to}/files");
        Check(target.GetArrayLength()==2 &&
              target.EnumerateArray().Any(x=>
                  x.GetProperty("materialCategory").GetString()=="申请材料") &&
              target.EnumerateArray().Any(x=>
                  x.GetProperty("materialCategory").GetString()=="证书文件"),
            "all associations and material classifications copied");
        var sourceIds=new[]{file1,file2};
        var copies=target.EnumerateArray().Select(x=>x.GetProperty("fileId")
            .GetInt64()).ToArray();
        Check(copies.All(x=>!sourceIds.Contains(x)),"independent FileIds across workspaces");
        var lengths=new List<int>();
        foreach(var link in target.EnumerateArray())
        {
            long targetFile=link.GetProperty("fileId").GetInt64();
            var details=await client.GetFromJsonAsync<JsonElement>(
                $"/api/v2/ip/personal/{to}/files/{targetFile}");
            long originalFile=details.GetProperty("versions").GetArrayLength()==2?file1:file2;
            NativeTransferIsolationProof.Verify(vault.Db,"company",originalFile,
                "personal",targetFile);
            foreach(var version in details.GetProperty("versions").EnumerateArray())
            {
                int number=version.GetProperty("version").GetInt32();
                byte[] bytes=await client.GetByteArrayAsync(
                    $"/api/v2/ip/personal/{to}/files/{targetFile}/versions/{number}/download");
                Check(bytes.SequenceEqual(a)||bytes.SequenceEqual(a2)||
                      bytes.SequenceEqual(b),"new workspace original bytes intact");
                lengths.Add(bytes.Length);
            }
        }
        Check(lengths.Count==3&&lengths.Contains(a.Length)&&
              lengths.Contains(a2.Length)&&lengths.Contains(b.Length),
              "three distinct version contents preserved");
        Check((await client.GetByteArrayAsync(
            $"/api/v2/ip/company/{id}/files/{file1}/versions/1/download"))
            .SequenceEqual(a),"copy must not alter source original");

        var same=await Transfer(client,"company",id,"company");
        Check(same.GetProperty("files").GetInt32()==2 &&
              same.GetProperty("versions").GetInt32()==3 &&
              same.GetProperty("newObjects").GetInt32()==0,
            "same workspace creates independent FileIds with immutable object reuse");
        var before=(await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/personal/ip")).GetArrayLength();
        using(var missing=await client.PostAsJsonAsync(
            "/api/v2/ip/company/9223372036854775807/transfer",
            new{targetWorkspace="personal",move=false}))
            Check(missing.StatusCode==HttpStatusCode.NotFound,"invalid source denied");
        Check((await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/personal/ip")).GetArrayLength()==before,
            "failed copy cannot leave partial target");
        using(var wrong=await client.PostAsJsonAsync(
            $"/api/v2/ip/company/{id}/transfer",
            new{targetWorkspace="unknown",move=true}))
            Check(wrong.StatusCode==HttpStatusCode.BadRequest,"invalid workspace denied");
        using(var guest=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await guest.PostAsJsonAsync(
            $"/api/v2/ip/company/{id}/transfer",
            new{targetWorkspace="personal",move=true}))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"auth required");

        var moved=await Transfer(client,"company",id,"personal",true);
        Check(moved.GetProperty("moved").GetBoolean()&&
              moved.GetProperty("newObjects").GetInt32()==3,
              "move is independent cross-workspace copy and soft-delete");
        using(var deleted=await client.GetAsync($"/api/v2/folders/company/ip/{id}"))
            Check(deleted.StatusCode==HttpStatusCode.NotFound,
                "original IP hidden only after all copy versions committed");
        var deletedRows=await client.GetFromJsonAsync<List<RecycleItem>>(
            "/api/trash/company");
        Check(deletedRows!.Any(x=>x.Kind=="ip"&&x.Id==id),
            "moved original remains restorable");
        Check((await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/ip/personal/{moved.GetProperty("id").GetInt64()}/files"))
                .GetArrayLength()==2,"moved IP target contains all original links");
        Console.WriteLine("N2-03-05 IP WHOLE FOLDER ATOMIC TRANSFER SQLCIPHER HTTP PASS");
    }
}
