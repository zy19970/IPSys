using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// N2-04: native same-workspace file link copy/move is one SQLCipher transaction.
static class NativeFileAssociateSmoke
{
    private static async Task<JsonElement> Create(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        string tag="LINK204-"+Guid.NewGuid().ToString("N")[..8];
        long a=(await Create(await client.PostAsJsonAsync(
            "/api/v2/folders/company/general",
            new {general=new{title=tag+"来源"}}))).GetProperty("id").GetInt64();
        long b=(await Create(await client.PostAsJsonAsync(
            "/api/v2/folders/company/general",
            new {general=new{title=tag+"目标"}}))).GetProperty("id").GetInt64();
        byte[] original=RandomNumberGenerator.GetBytes(701);
        long file;
        using(var request=new HttpRequestMessage(HttpMethod.Post,
            "/api/v2/files/company/upload?folderId="+a)
            {Content=new ByteArrayContent(original)})
        {
            request.Headers.Add("X-File-Name",Uri.EscapeDataString(tag+".pdf"));
            file=(await Create(await client.SendAsync(request)))
                .GetProperty("fileId").GetInt64();
        }
        var links=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{a}/links");
        long source=links[0].GetProperty("id").GetInt64();
        var share=await Create(await client.PostAsJsonAsync(
            $"/api/v2/files/company/{file}/associate",
            new NativeFileAssociateInput(source,b,false)));
        if(!share.GetProperty("ok").GetBoolean())
            throw new IOException("N2-04 shared link creation failed");
        links=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{b}/links");
        if(links.GetArrayLength()!=1||links[0].GetProperty("fileId").GetInt64()!=file)
            throw new IOException("N2-04 must share same FileId");
        using(var duplicate=await client.PostAsJsonAsync(
            $"/api/v2/files/company/{file}/associate",
            new NativeFileAssociateInput(source,b,true)))
            if(duplicate.StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("duplicate target must rollback");
        links=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{a}/links");
        if(links.GetArrayLength()!=1)
            throw new IOException("duplicate move must preserve source");
        long c=(await Create(await client.PostAsJsonAsync(
            "/api/v2/folders/company/general",
            new {general=new{title=tag+"第三位置"}}))).GetProperty("id").GetInt64();
        await Create(await client.PostAsJsonAsync(
            $"/api/v2/files/company/{file}/associate",
            new NativeFileAssociateInput(source,c,true)));
        links=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{a}/links");
        if(links.GetArrayLength()!=0)
            throw new IOException("native move source not unlinked");
        foreach(long owner in new[]{b,c})
        {
            links=await client.GetFromJsonAsync<JsonElement>(
                $"/api/v2/files/company/folders/{owner}/links");
            if(links.GetArrayLength()!=1||
               links[0].GetProperty("fileId").GetInt64()!=file)
                throw new IOException("native move must preserve other shared links");
        }
        if(!(await client.GetByteArrayAsync(
            $"/api/v2/files/company/{file}/versions/1/download"))
            .SequenceEqual(original))
            throw new IOException("original bytes lost after share/move");
        using(var cross=await client.PostAsJsonAsync(
            $"/api/v2/files/personal/{file}/associate",
            new NativeFileAssociateInput(source,c,true)))
            if(cross.StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("cross-workspace V2 association must fail");
        Console.WriteLine("N2-04 V2 SHARED LINK COPY/MOVE SQLCIPHER PASS");
    }
}
