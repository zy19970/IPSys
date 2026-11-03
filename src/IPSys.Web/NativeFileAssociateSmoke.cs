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
            "/api/v2/folders/company/archive_folder",
            new {section="general",archiveFolder=new{name=tag+"来源"}}))).GetProperty("id").GetInt64();
        long b=(await Create(await client.PostAsJsonAsync(
            "/api/v2/folders/company/archive_folder",
            new {section="general",archiveFolder=new{name=tag+"目标"}}))).GetProperty("id").GetInt64();
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
            "/api/v2/folders/company/archive_folder",
            new {section="general",archiveFolder=new{name=tag+"第三位置"}}))).GetProperty("id").GetInt64();
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
        // Batch share and move must be all-or-nothing, retaining logical FileIds.
        var added=new List<(long FileId,long LinkId,byte[] Bytes)>();
        for(int n=0;n<2;n++)
        {
            byte[] payload=RandomNumberGenerator.GetBytes(801+n);
            using var req=new HttpRequestMessage(HttpMethod.Post,
                "/api/v2/files/company/upload?folderId="+a)
                {Content=new ByteArrayContent(payload)};
            req.Headers.Add("X-File-Name",Uri.EscapeDataString(tag+"-batch-"+n+".pdf"));
            long id=(await Create(await client.SendAsync(req)))
                .GetProperty("fileId").GetInt64();
            var active=await client.GetFromJsonAsync<JsonElement>(
                $"/api/v2/files/company/folders/{a}/links");
            long link=active.EnumerateArray().Single(x=>
                x.GetProperty("fileId").GetInt64()==id).GetProperty("id").GetInt64();
            added.Add((id,link,payload));
        }
        NativeBatchFileLink[] selected=added.Select(x=>
            new NativeBatchFileLink(x.FileId,x.LinkId)).ToArray();
        var shared=await Create(await client.PostAsJsonAsync(
            "/api/v2/files/company/associate-batch",
            new NativeBatchAssociateInput(b,false,selected)));
        if(shared.GetProperty("count").GetInt32()!=2)
            throw new IOException("Batch share must create both links");
        using(var conflict=await client.PostAsJsonAsync(
            "/api/v2/files/company/associate-batch",
            new NativeBatchAssociateInput(b,true,selected)))
            if(conflict.StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("Batch with duplicate target must conflict");
        links=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{a}/links");
        if(links.GetArrayLength()!=2)
            throw new IOException("Conflicted batch must retain both source links");
        var moved=await Create(await client.PostAsJsonAsync(
            "/api/v2/files/company/associate-batch",
            new NativeBatchAssociateInput(c,true,selected)));
        if(!moved.GetProperty("moved").GetBoolean()||
           moved.GetProperty("count").GetInt32()!=2)
            throw new IOException("Batch move count incorrect");
        links=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{a}/links");
        if(links.GetArrayLength()!=0)
            throw new IOException("Batch move must remove both source associations");
        foreach(var item in added)
        {
            var targetLinks=await client.GetFromJsonAsync<JsonElement>(
                $"/api/v2/files/company/folders/{c}/links");
            if(!targetLinks.EnumerateArray().Any(x=>
                x.GetProperty("fileId").GetInt64()==item.FileId))
                throw new IOException("Batch move missing target association");
            if(!(await client.GetByteArrayAsync(
                $"/api/v2/files/company/{item.FileId}/versions/1/download"))
               .SequenceEqual(item.Bytes))
                throw new IOException("Batch move changed original file bytes");
        }
        long d=(await Create(await client.PostAsJsonAsync(
            "/api/v2/folders/company/archive_folder",
            new {section="general",archiveFolder=new{name=tag+"批量失败位置"}})))
            .GetProperty("id").GetInt64();
        var bLinks=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{b}/links");
        long shareLink=bLinks.EnumerateArray().Single(x=>
            x.GetProperty("fileId").GetInt64()==added[0].FileId)
            .GetProperty("id").GetInt64();
        using(var stale=await client.PostAsJsonAsync(
            "/api/v2/files/company/associate-batch",
            new NativeBatchAssociateInput(d,true,
            [new NativeBatchFileLink(added[0].FileId,shareLink),
             new NativeBatchFileLink(added[1].FileId,added[1].LinkId)])))
            if(stale.StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("Stale link must cancel complete batch");
        var empty=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{d}/links");
        if(empty.GetArrayLength()!=0)
            throw new IOException("Stale link must not leave partial target links");
        using(var duplicateOriginal=await client.PostAsJsonAsync(
            "/api/v2/files/company/associate-batch",
            new NativeBatchAssociateInput(d,false,
            [new NativeBatchFileLink(added[0].FileId,shareLink),
             new NativeBatchFileLink(added[0].FileId,shareLink)])))
            if(duplicateOriginal.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("Duplicate FileId in batch must be rejected");
        using(var crossBatch=await client.PostAsJsonAsync(
            "/api/v2/files/personal/associate-batch",
            new NativeBatchAssociateInput(d,false,
            [new NativeBatchFileLink(added[0].FileId,shareLink)])))
            if(crossBatch.StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("Cross-workspace batch must fail");
        Console.WriteLine("N2-04 ATOMIC MULTI-FILE SHARE/MOVE SQLCIPHER PASS");
        Console.WriteLine("N2-04 V2 SHARED LINK COPY/MOVE SQLCIPHER PASS");
    }
}
