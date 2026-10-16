using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// Native N2-04 archive/general XLSX, search and recycle against SQLCipher.
static class NativeArchiveGeneralMilestoneSmoke
{
    private static void Check(bool valid,string reason)
    {
        if(!valid)throw new IOException("N2-04 archive/general: "+reason);
    }
    private static async Task<JsonElement> Read(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    private static async Task<byte[]> Export(HttpClient client,string kind,
        string workspace,string section,long id)
    {
        string query=kind=="archive"?"?section="+section:"";
        using var response=await client.PostAsJsonAsync(
            $"/api/v2/excel/{workspace}/{kind}/export"+query,
            new ExcelExportInput("filtered",[id]));
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync();
    }
    private static async Task<JsonElement> Import(HttpClient client,string kind,
        string workspace,string section,string policy,byte[] bytes)
    {
        string query="?policy="+policy+(kind=="archive"?"&section="+section:"");
        return await Read(await client.PostAsync(
            $"/api/v2/excel/{workspace}/{kind}/import"+query,
            new ByteArrayContent(bytes)));
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        string mark="AG204-"+Guid.NewGuid().ToString("N")[..8];
        const string ca="/api/v2/folders/company/archive";
        const string cg="/api/v2/folders/company/general";
        long certificate=(await Read(await client.PostAsJsonAsync(ca,new{
            section="certificate",archive=new{
                name=mark+"企业资质",category="企业资质",
                remarks="可检索备注",tags="专属标签"}}))).GetProperty("id").GetInt64();
        long general=(await Read(await client.PostAsJsonAsync(cg,new{
            general=new{title=mark+"综合资料"}}))).GetProperty("id").GetInt64();
        var roots=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/company/archive_folder");
        long root=roots.EnumerateArray().First(x=>x.GetProperty("folder")
            .GetProperty("name").GetString()=="申报与认定")
            .GetProperty("folder").GetProperty("ref").GetProperty("id").GetInt64();
        long business=(await Read(await client.PostAsJsonAsync(ca,new{
            section="achievement",archive=new{
                name=mark+"项目申报",category="申报与认定",folderId=root,
                year="2026"}}))).GetProperty("id").GetInt64();
        var search=await client.GetFromJsonAsync<SearchResponse>(
            "/api/search/company?q="+Uri.EscapeDataString(mark));
        Check(search is not null &&
            search.Results.Any(x=>x.Kind=="archive"&&x.Section=="certificate"&&
                x.Id==certificate) &&
            search.Results.Any(x=>x.Kind=="archive"&&x.Section=="achievement"&&
                x.Id==business) &&
            search.Results.Any(x=>x.Kind=="general"&&x.Id==general),
            "all archive/general hits use native FolderId");
        var ancestor=await client.GetFromJsonAsync<SearchResponse>(
            "/api/search/company?q="+Uri.EscapeDataString("申报与认定"));
        Check(ancestor is not null && ancestor.Results.Any(x=>x.Kind=="archive"&&
            x.Id==business),"ancestor folder names searchable");

        byte[] original=RandomNumberGenerator.GetBytes(1317);
        byte[] revised=RandomNumberGenerator.GetBytes(2379);
        long file;
        using(var body=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={certificate}")
            {Content=new ByteArrayContent(original)})
        {
            body.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+"资质.pdf"));
            file=(await Read(await client.SendAsync(body)))
                .GetProperty("fileId").GetInt64();
        }
        using(var version=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(revised)})
        {
            version.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+"修订.pdf"));
            await Read(await client.SendAsync(version));
        }
        var files=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{certificate}/links");
        long link=files[0].GetProperty("id").GetInt64();
        byte[] workbook=await Export(client,"archive","company","certificate",certificate);
        Check(workbook.Length>750,"archive fixed XLSX export");
        var skip=await Import(client,"archive","company","certificate","skip",workbook);
        Check(skip.GetProperty("skipped").GetInt32()==1,"native duplicate skipping");
        var update=await Import(client,"archive","company","certificate","update",workbook);
        Check(update.GetProperty("updated").GetInt32()==1,"native in-place update");
        var persisted=await client.GetFromJsonAsync<JsonElement>(
            $"{ca}/{certificate}?section=certificate");
        Check(persisted.GetProperty("folder").GetProperty("ref").GetProperty("id")
            .GetInt64()==certificate,"Excel update retains same FolderId");
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/company/{file}/versions/1/download")).SequenceEqual(original)
            && (await client.GetByteArrayAsync(
            $"/api/v2/files/company/{file}/versions/2/download")).SequenceEqual(revised),
            "Excel update retains complete original file history");
        var personal=await Import(client,"archive","personal","certificate",
            "create",workbook);
        Check(personal.GetProperty("created").GetInt32()==1,
            "personal archive import independent");
        var personalRows=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/personal/archive?section=certificate");
        var matched=personalRows.EnumerateArray().First(x=>
            x.GetProperty("folder").GetProperty("name").GetString()==mark+"企业资质");
        long personalId=matched.GetProperty("folder").GetProperty("ref")
            .GetProperty("id").GetInt64();
        var emptyFiles=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/personal/folders/{personalId}/links");
        Check(emptyFiles.GetArrayLength()==0,"Excel does not copy attachments across workspaces");

        byte[] generalWorkbook=await Export(client,"general","company","",general);
        var copied=await Import(client,"general","personal","","create",generalWorkbook);
        Check(copied.GetProperty("created").GetInt32()==1,
            "native general fixed XLSX import");
        byte[] businessWorkbook=await Export(client,"archive","company","achievement",business);
        var businessSkip=await Import(client,"archive","company","achievement",
            "skip",businessWorkbook);
        Check(businessSkip.GetProperty("skipped").GetInt32()==1,
            "business category deduplication respects root");
        using(var invalid=await client.PostAsync(
            "/api/v2/excel/company/archive/import?section=certificate&policy=create",
            new ByteArrayContent(new byte[]{1,2,3,4})))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                "invalid workbook rejected");
        using(var guest=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await guest.GetAsync(
            "/api/v2/excel/company/archive/template?section=certificate"))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"auth required");

        using(var removed=await client.DeleteAsync(
            $"{ca}/{certificate}?section=certificate"))
            removed.EnsureSuccessStatusCode();
        var trash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        Check(trash is not null && trash.Any(x=>x.Kind=="v2_archive"&&
            x.Id==certificate&&x.Section=="certificate"),"V2 archive recycle identity");
        using(var unsafeDelete=await client.PostAsJsonAsync(
            "/api/trash/company/purge",
            new RecycleRequest([new RecycleKey("v2_archive",certificate,"certificate")])))
            Check(unsafeDelete.StatusCode==HttpStatusCode.Conflict,
                "file history blocks permanent deletion");
        using(var restored=await client.PostAsJsonAsync(
            "/api/trash/company/restore",
            new RecycleRequest([new RecycleKey("v2_archive",certificate,"certificate")])))
            restored.EnsureSuccessStatusCode();
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/company/{file}/versions/2/download")).SequenceEqual(revised),
            "restore preserves V2 file history");
        using(var unlinked=await client.DeleteAsync(
            $"/api/v2/files/company/{file}/links/{link}"))
            unlinked.EnsureSuccessStatusCode();
        trash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        Check(trash is not null && trash.Any(x=>x.Kind=="v2_file"&&x.Id==link),
            "V2 archive detached link in recycle");
        using(var relink=await client.PostAsJsonAsync(
            "/api/trash/company/restore",
            new RecycleRequest([new RecycleKey("v2_file",link,"")])))
            relink.EnsureSuccessStatusCode();
        using(var gone=await client.DeleteAsync($"{cg}/{general}"))
            gone.EnsureSuccessStatusCode();
        trash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        Check(trash is not null && trash.Any(x=>x.Kind=="v2_general"&&x.Id==general),
            "general FolderId in recycle");
        using(var restored=await client.PostAsJsonAsync(
            "/api/trash/company/restore",
            new RecycleRequest([new RecycleKey("v2_general",general,"")])))
            restored.EnsureSuccessStatusCode();
        Console.WriteLine("N2-04 NATIVE ARCHIVE/GENERAL EXCEL SEARCH RECYCLE SMOKE PASS");
    }
}
