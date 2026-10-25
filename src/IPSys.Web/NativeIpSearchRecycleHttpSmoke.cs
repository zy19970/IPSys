using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Security.Cryptography;

// The frozen IP UI, MCP, search and recycle must address one native FolderId.
static class NativeIpSearchRecycleHttpSmoke
{
    private static void Check(bool value,string reason)
    {
        if(!value)throw new IOException("N2-03-05 V2 IP search/recycle: "+reason);
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        string tag="IPNATIVE-"+Guid.NewGuid().ToString("N")[..9];
        var ip=await client.PostAsJsonAsync("/api/v2/folders/company/ip",
            new{ip=new{name=tag+"申请",ipType="发明专利",status="实质审查中",
                number=tag+"CN"}});
        ip.EnsureSuccessStatusCode();
        long id=(await ip.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();
        var hits=await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/company?q="+Uri.EscapeDataString(tag+"CN"));
        Check(hits!.Results.Any(x=>x.Kind=="ip"&&x.Id==id),
            "application number must return native FolderId");

        byte[] content=RandomNumberGenerator.GetBytes(4700);
        string filename=tag+"原件.pdf";
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/ip/company/{id}/files"){Content=new ByteArrayContent(content)})
        {
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString(filename));
            upload.Headers.Add("X-Material-Category",Uri.EscapeDataString("申请材料"));
            using var response=await client.SendAsync(upload);
            response.EnsureSuccessStatusCode();
        }
        var links=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/ip/company/{id}/files");
        var file=links.EnumerateArray().Single();
        long fileId=file.GetProperty("fileId").GetInt64();
        long linkId=file.GetProperty("id").GetInt64();

        var found=await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/company?q="+Uri.EscapeDataString(filename));
        Check(found!.Results.Any(x=>x.Kind=="file"&&x.OwnerKind=="ip"
             &&x.OwnerId==id&&x.Id==fileId),
             "V2 file search must refer to native FileId and FolderId");
        var privateHits=await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/personal?q="+Uri.EscapeDataString(filename));
        Check(privateHits!.Results.Count==0,"cross-workspace IP original isolation");

        using(var del=await client.DeleteAsync(
            $"/api/v2/ip/company/{id}/files/{fileId}/links/{linkId}"))
            del.EnsureSuccessStatusCode();
        Check(!(await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/company?q="+Uri.EscapeDataString(filename)))!
            .Results.Any(x=>x.OwnerKind=="ip"&&x.OwnerId==id),
            "unlinked original should not appear in search");

        var trash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        Check(trash!.Any(x=>x.Kind=="v2_ip_file"&&x.Id==linkId),
            "removed native file link visible in recycle");
        // A removed link must remain restorable until the user explicitly
        // chooses permanent deletion from the recycle bin.
        using(var restored=await client.PostAsJsonAsync(
            "/api/trash/company/restore",
            new RecycleRequest([new RecycleKey("v2_ip_file",linkId,"")])))
            restored.EnsureSuccessStatusCode();
        Check((await client.GetByteArrayAsync(
            $"/api/v2/ip/company/{id}/files/{fileId}/versions/1/download"))
            .SequenceEqual(content),"recovered link preserves original bytes");

        using(var del=await client.DeleteAsync($"/api/v2/folders/company/ip/{id}"))
            del.EnsureSuccessStatusCode();
        Check(!(await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/company?q="+Uri.EscapeDataString(tag)))!
            .Results.Any(x=>x.OwnerKind=="ip"||x.Kind=="ip"),
            "deleted native IP and its file are hidden from search");
        var after=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        Check(after!.Any(x=>x.Kind=="ip"&&x.Id==id),
            "deleted V2 IP listed in shared recycle");
        // Soft-deleted owners hide downloads, but their original version
        // history must still be preserved until explicit purge. The restore
        // and exact byte comparison below verify recoverability.
        using(var restore=await client.PostAsJsonAsync(
            "/api/trash/company/restore",
            new RecycleRequest([new RecycleKey("ip",id,"")])))
            restore.EnsureSuccessStatusCode();
        Check((await client.GetByteArrayAsync(
            $"/api/v2/ip/company/{id}/files/{fileId}/versions/1/download"))
            .SequenceEqual(content),"IP restore preserves link and raw bytes");
        // Permanent deletion of the LAST LinkId must remove this FileId and
        // make its entire version stream inaccessible.
        using(var unlink=await client.DeleteAsync(
            $"/api/v2/ip/company/{id}/files/{fileId}/links/{linkId}"))
            unlink.EnsureSuccessStatusCode();
        using(var purgeFile=await client.PostAsJsonAsync(
            "/api/trash/company/purge",
            new RecycleRequest([new RecycleKey("v2_ip_file",linkId,"")])))
            purgeFile.EnsureSuccessStatusCode();
        using(var missing=await client.GetAsync(
            $"/api/v2/ip/company/{id}/files/{fileId}/versions/1/download"))
            Check(missing.StatusCode==HttpStatusCode.NotFound,
                "permanently purged FileId has no downloadable versions");
        using(var deletedFolder=await client.DeleteAsync($"/api/v2/folders/company/ip/{id}"))
            deletedFolder.EnsureSuccessStatusCode();
        using(var purgeFolder=await client.PostAsJsonAsync(
            "/api/trash/company/purge",
            new RecycleRequest([new RecycleKey("ip",id,"")])))
            purgeFolder.EnsureSuccessStatusCode();

        // Whole-IP permanent purge: an IP folder may still own an active
        // LinkId (soft deletion hides rather than unlinks it). This is distinct
        // from the detached-link purge verified above and must cascade safely.
        using var withFile=await client.PostAsJsonAsync("/api/v2/folders/company/ip",
            new{ip=new{name=tag+"级联删除",ipType="发明专利",status="已申请"}});
        withFile.EnsureSuccessStatusCode();
        long cascadeId=(await withFile.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();
        byte[] cascadeBytes=RandomNumberGenerator.GetBytes(6271);
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/ip/company/{cascadeId}/files")
            {Content=new ByteArrayContent(cascadeBytes)})
        {
            upload.Headers.Add("X-File-Name",
                Uri.EscapeDataString(tag+"级联原件.pdf"));
            using var result=await client.SendAsync(upload);
            result.EnsureSuccessStatusCode();
        }
        var linked=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/ip/company/{cascadeId}/files");
        long cascadeFile=linked.EnumerateArray().Single()
            .GetProperty("fileId").GetInt64();
        Check((await client.GetByteArrayAsync(
            $"/api/v2/ip/company/{cascadeId}/files/{cascadeFile}/versions/1/download"))
            .SequenceEqual(cascadeBytes),"active IP original bytes intact");
        using(var deleted=await client.DeleteAsync(
            $"/api/v2/folders/company/ip/{cascadeId}"))
            deleted.EnsureSuccessStatusCode();
        using(var cascade=await client.PostAsJsonAsync("/api/trash/company/purge",
            new RecycleRequest([new RecycleKey("ip",cascadeId,"")])))
            cascade.EnsureSuccessStatusCode();
        using(var noHistory=await client.GetAsync(
            $"/api/v2/files/company/{cascadeFile}/versions/1/download"))
            Check(noHistory.StatusCode==HttpStatusCode.NotFound,
                "whole-IP purge removes its last-link original versions");
        var afterCascade=await client.GetFromJsonAsync<List<RecycleItem>>(
            "/api/trash/company");
        Check(!afterCascade!.Any(x=>x.Kind=="ip"&&x.Id==cascadeId),
            "whole-IP purge clears the selected folder tombstone");

        var empty=await client.PostAsJsonAsync("/api/v2/folders/personal/ip",
            new{ip=new{name=tag+"无附件",ipType="发明专利",status="已申请"}});
        empty.EnsureSuccessStatusCode();
        long emptyId=(await empty.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();
        using(var del=await client.DeleteAsync($"/api/v2/folders/personal/ip/{emptyId}"))
            del.EnsureSuccessStatusCode();
        using(var purge=await client.PostAsJsonAsync("/api/trash/personal/purge",
            new RecycleRequest([new RecycleKey("ip",emptyId,"")])))
            purge.EnsureSuccessStatusCode();
        var personalTrash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/personal");
        Check(!personalTrash!.Any(x=>x.Kind=="ip"&&x.Id==emptyId),
            "empty native IP permanently deletes only its own folder");
        Console.WriteLine("N2-03-05 V2 IP SEARCH RECYCLE SQLCIPHER HTTP PASS");
    }
}
