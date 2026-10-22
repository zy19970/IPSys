using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// F2-04 contract: owner changes without losing LinkId in the same workspace;
// cross-workspace copies hold complete independent encrypted original history.
static class NativeContractTransferHttpSmoke
{
    private static void Check(bool good,string reason)
    {
        if(!good)throw new IOException("F2-04 contract transfer: "+reason);
    }
    private static async Task<JsonElement> Ok(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    private static async Task<long> Project(HttpClient client,string ws,string name)
    {
        var result=await Ok(await client.PostAsJsonAsync(
            "/api/v2/folders/"+ws+"/project",
            new{project=new{name,projectType="科研项目"}}));
        return result.GetProperty("id").GetInt64();
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        var key=Guid.NewGuid().ToString("N")[..8];
        long a=await Project(client,"company","源项目"+key);
        long b=await Project(client,"company","目标项目"+key);
        long p=await Project(client,"personal","个人目标项目"+key);
        var created=await Ok(await client.PostAsJsonAsync(
            "/api/v2/folders/company/contract",new{parentId=a,
                contract=new{name="可转移合同"+key,contractNo="TX-"+key,amount="1234.50"}}));
        long id=created.GetProperty("id").GetInt64();
        byte[] v1=RandomNumberGenerator.GetBytes(1857),v2=RandomNumberGenerator.GetBytes(379);
        long file;
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            "/api/v2/files/company/upload?folderId="+id)
            {Content=new ByteArrayContent(v1)})
        {
            upload.Headers.TryAddWithoutValidation("X-File-Name",
                Uri.EscapeDataString("合同原件.pdf"));
            file=(await Ok(await client.SendAsync(upload)))
                .GetProperty("fileId").GetInt64();
        }
        using(var next=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(v2)})
        {
            next.Headers.TryAddWithoutValidation("X-File-Name",
                Uri.EscapeDataString("合同原件修订.pdf"));
            (await client.SendAsync(next)).EnsureSuccessStatusCode();
        }
        var linked=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{id}/links");
        long linkId=linked[0].GetProperty("id").GetInt64();
        using(var missing=await client.PostAsJsonAsync(
            $"/api/v2/contracts/company/{id}/transfer",
            new NativeContractTransferInput("personal",999999999,false)))
            Check(missing.StatusCode==HttpStatusCode.NotFound,"reject absent project");

        var moved=await Ok(await client.PostAsJsonAsync(
            $"/api/v2/contracts/company/{id}/transfer",
            new NativeContractTransferInput("company",b,true)));
        Check(moved.GetProperty("id").GetInt64()==id&&
              moved.GetProperty("moved").GetBoolean(),
              "same workspace move retains FolderId");
        linked=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{id}/links");
        Check(linked[0].GetProperty("id").GetInt64()==linkId,
              "reparented contract retains source LinkId and FileId");
        var contracts=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/contracts/company");
        Check(contracts.EnumerateArray().Any(x=>x.GetProperty("id").GetInt64()==id&&
              x.GetProperty("projectId").GetInt64()==b),
              "new owning project visible in business UI");
        using(var noOp=await client.PostAsJsonAsync(
            $"/api/v2/contracts/company/{id}/transfer",
            new NativeContractTransferInput("company",b,true)))
            Check(noOp.StatusCode==HttpStatusCode.Conflict,"no-op reparent rejected");

        var copied=await Ok(await client.PostAsJsonAsync(
            $"/api/v2/contracts/company/{id}/transfer",
            new NativeContractTransferInput("personal",p,false)));
        long copyId=copied.GetProperty("id").GetInt64();
        Check(copyId!=id && copied.GetProperty("versions").GetInt32()==2 &&
              copied.GetProperty("newObjects").GetInt32()>0,
              "cross workspace copied distinct folder with independent objects");
        var targetLinks=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/personal/folders/{copyId}/links");
        long targetFile=targetLinks[0].GetProperty("fileId").GetInt64();
        Check(targetFile!=file,"cross workspace creates independent FileId");
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/personal/{targetFile}/versions/1/download"))
                .SequenceEqual(v1),"cross workspace v1 bytes");
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/personal/{targetFile}/versions/2/download"))
                .SequenceEqual(v2),"cross workspace v2 bytes");
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/company/{file}/versions/2/download"))
                .SequenceEqual(v2),"source retained after copy");

        var transferred=await Ok(await client.PostAsJsonAsync(
            $"/api/v2/contracts/company/{id}/transfer",
            new NativeContractTransferInput("personal",p,true)));
        Check(transferred.GetProperty("moved").GetBoolean(),
              "cross workspace move committed successfully");
        using(var source=await client.GetAsync(
            $"/api/v2/folders/company/contract/{id}"))
            Check(source.StatusCode==HttpStatusCode.NotFound,
                "source contract becomes deleted only after move");
        contracts=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/contracts/personal");
        Check(contracts.EnumerateArray().Count(x=>x.GetProperty("projectId").GetInt64()==p)>=2,
            "target project receives both copied and moved contracts");
        Console.WriteLine("F2-04 CONTRACT TRANSFER SQLCIPHER PASS");
    }
}
