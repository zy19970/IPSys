using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Security.Cryptography;

static class NativeIpUiHttpSmoke
{
    static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("N2-03-04 IP V2 UI HTTP: "+reason);
    }
    static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        string suffix=Guid.NewGuid().ToString("N")[..8];
        var input=new IpInput("前端V2文件身份"+suffix,"发明专利","已申请",
            null,null,null,null,null,null,null,null,null,null,
            null,null,null,null,null,null,null);
        var created=await Json(await client.PostAsJsonAsync(
            "/api/v2/folders/company/ip",new FolderMutationInput(Ip:input)));
        long ipId=created.GetProperty("id").GetInt64();
        string list="/api/v2/ui/ip/company";
        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await anonymous.GetAsync(list))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,
                "native UI aggregation needs session authorization");

        byte[] bytes=RandomNumberGenerator.GetBytes(1517);
        using(var prepare=new HttpRequestMessage(HttpMethod.Post,
            "/api/v2/files/company/prepare?folderId="+ipId)
            {Content=new ByteArrayContent(bytes)})
        {
            prepare.Headers.TryAddWithoutValidation("X-File-Name",
                Uri.EscapeDataString("试验申请.pdf"));
            prepare.Headers.TryAddWithoutValidation("X-Material-Category",
                Uri.EscapeDataString("证书文件"));
            var staged=await Json(await client.SendAsync(prepare));
            string ticket=staged.GetProperty("ticket").GetString()!;
            var confirmed=await Json(await client.PostAsJsonAsync(
                "/api/v2/files/company/prepared/"+ticket+"/resolve",
                new NativeFileDecision("independent")));
            Check(!confirmed.GetProperty("reusedContent").GetBoolean(),
                "independent choice creates ready original object");
        }

        var data=await client.GetFromJsonAsync<JsonElement>(list);
        var row=data.GetProperty("rows").EnumerateArray().FirstOrDefault(r=>
            r.GetProperty("id").GetInt64()==ipId);
        Check(row.ValueKind==JsonValueKind.Object &&
              row.GetProperty("data").GetProperty("name").GetString()==input.Name,
            "native IP list contains the same folder ID and full attributes");
        var file=data.GetProperty("files").EnumerateArray().FirstOrDefault(f=>
            f.GetProperty("folderId").GetInt64()==ipId);
        Check(file.ValueKind==JsonValueKind.Object &&
              file.GetProperty("linkId").GetInt64()>0 &&
              file.GetProperty("fileId").GetInt64()>0 &&
              file.GetProperty("version").GetInt32()==1 &&
              file.GetProperty("category").GetString()=="证书文件" &&
              file.GetProperty("size").GetInt64()==bytes.Length &&
              file.GetProperty("sha256").GetString()==
                Convert.ToHexString(SHA256.HashData(bytes)),
            "native UI data carries distinct link/FileId/version and category");
        long fileId=file.GetProperty("fileId").GetInt64();
        using(var response=await client.GetAsync(
            $"/api/v2/ip/company/{ipId}/files/{fileId}/versions/1/download"))
        {
            response.EnsureSuccessStatusCode();
            Check(bytes.SequenceEqual(await response.Content.ReadAsByteArrayAsync()),
                "V2 UI file ID opens encrypted original bytes");
        }
        var legacy=await client.GetFromJsonAsync<JsonElement>("/api/ip/company");
        Check(!legacy.EnumerateArray().Any(x=>
            x.GetProperty("data").GetProperty("name").GetString()==input.Name),
            "IP UI never double-writes legacy IP rows");

        var current=data.GetProperty("rows").EnumerateArray()
            .Select(r=>r.GetProperty("id").GetInt64()).ToArray();
        var reversed=current.Reverse().ToArray();
        using(var order=await client.PostAsJsonAsync(list+"/order",new{ids=reversed}))
            order.EnsureSuccessStatusCode();
        var after=await client.GetFromJsonAsync<JsonElement>(list);
        Check(after.GetProperty("rows")[0].GetProperty("id").GetInt64()==reversed[0],
            "IP order saved exclusively to native Folder.position");
        using(var stale=await client.PostAsJsonAsync(list+"/order",
            new{ids=new long[]{ipId,ipId}}))
            Check(stale.StatusCode==HttpStatusCode.Conflict,
                "duplicate or partial IP order rejected");
        using(var foreign=await client.GetAsync("/api/v2/ui/ip/personal"))
        {
            foreign.EnsureSuccessStatusCode();
            var personal=await foreign.Content.ReadFromJsonAsync<JsonElement>();
            Check(!personal.GetProperty("rows").EnumerateArray()
                .Any(r=>r.GetProperty("data").GetProperty("name").GetString()==input.Name),
                "native IP UI cannot read other workspace's records");
        }
        Console.WriteLine("N2-03-04 IP V2 UI HTTP SMOKE PASS");
    }
}
