using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// N2-04 milestone: test native Excel/search/trash and whole-project transfer
// against real authenticated SQLCipher HTTP with versioned original bytes.
static class NativeProjectMilestoneSmoke
{
    private static void Check(bool valid,string reason)
    {
        if(!valid)throw new IOException("N2-04: "+reason);
    }
    private static async Task<JsonElement> Read(HttpResponseMessage reply)
    {
        using(reply)
        {
            reply.EnsureSuccessStatusCode();
            return await reply.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    private static async Task<JsonElement> Upload(HttpClient client,string url,
        byte[] bytes,string name)
    {
        using var req=new HttpRequestMessage(HttpMethod.Post,url)
            {Content=new ByteArrayContent(bytes)};
        req.Headers.Add("X-File-Name",Uri.EscapeDataString(name));
        return await Read(await client.SendAsync(req));
    }
    public static async Task VerifyAsync(HttpClient client,Vault vault)
    {
        string marker="N204-"+Guid.NewGuid().ToString("N")[..8];
        long project=(await Read(await client.PostAsJsonAsync(
            "/api/v2/folders/company/project",new{project=new{
                name=marker+"项目",projectType="科研项目",projectNo=marker+"-P"}})))
            .GetProperty("id").GetInt64();
        long contract=(await Read(await client.PostAsJsonAsync(
            "/api/v2/folders/company/contract",new{parentId=project,contract=new{
                name=marker+"合同",contractNo=marker+"-C",amount="125.50"}})))
            .GetProperty("id").GetInt64();
        var original=RandomNumberGenerator.GetBytes(1901);
        var revised=RandomNumberGenerator.GetBytes(3377);
        long file=(await Upload(client,
            $"/api/v2/files/company/upload?folderId={project}",original,
            marker+"原件.pdf")).GetProperty("fileId").GetInt64();
        await Upload(client,$"/api/v2/files/company/{file}/versions",
            revised,marker+"修订版.pdf");
        using(var linked=await client.PostAsJsonAsync(
            $"/api/v2/files/company/{file}/links",new{folderId=contract}))
            linked.EnsureSuccessStatusCode();

        using(var template=await client.GetAsync("/api/v2/excel/company/project/template"))
            Check(template.IsSuccessStatusCode &&
                (await template.Content.ReadAsByteArrayAsync()).Length>700,
                "V2 project template available");
        byte[] export;
        using(var response=await client.PostAsJsonAsync(
            "/api/v2/excel/company/project/export",
            new ExcelExportInput("filtered",[project])))
        {
            response.EnsureSuccessStatusCode();
            export=await response.Content.ReadAsByteArrayAsync();
        }
        Check(export.Length>700,"V2 project selected XLSX export");
        var imported=await Read(await client.PostAsync(
            "/api/v2/excel/personal/project/import?policy=create",
            new ByteArrayContent(export)));
        Check(imported.GetProperty("created").GetInt32()==1 &&
              imported.GetProperty("failed").GetInt32()==0,
              "fixed XLSX project import creates native personal folder");
        using(var contractExcel=await client.PostAsJsonAsync(
            "/api/v2/excel/company/contract/export",
            new ExcelExportInput("filtered",[contract])))
            Check(contractExcel.IsSuccessStatusCode &&
                (await contractExcel.Content.ReadAsByteArrayAsync()).Length>700,
                "contract read-only V2 export");
        using(var prohibited=await client.PostAsync(
            "/api/v2/excel/company/contract/import?policy=create",
            new ByteArrayContent(export)))
            Check(prohibited.StatusCode==HttpStatusCode.NotFound ||
                  prohibited.StatusCode==HttpStatusCode.MethodNotAllowed,
                "contracts cannot be imported from Excel");

        var search=await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/company?q="+Uri.EscapeDataString(marker));
        Check(search is not null &&
            search.Results.Any(x=>x.Kind=="project"&&x.Id==project) &&
            search.Results.Any(x=>x.Kind=="contract"&&x.Id==contract),
            "search uses V2 FolderId for project and contract");
        var fileSearch=await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/company?q="+Uri.EscapeDataString(marker+"原件.pdf"));
        Check(fileSearch is not null &&
            fileSearch.Results.Any(x=>x.Kind=="file"&&
                x.OwnerKind=="contract"&&x.OwnerId==contract),
            "same shared file can be found at native contract link");

        var copied=await Read(await client.PostAsJsonAsync(
            $"/api/v2/projects/company/{project}/transfer",
            new{targetWorkspace="personal",move=false}));
        long target=copied.GetProperty("id").GetInt64();
        Check(copied.GetProperty("contracts").GetInt32()==1 &&
              copied.GetProperty("links").GetInt32()==2 &&
              copied.GetProperty("files").GetInt32()==1 &&
              copied.GetProperty("versions").GetInt32()==2 &&
              copied.GetProperty("newObjects").GetInt32()==2,
              "one shared source FileId cloned once with two target links");
        var copies=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/personal/contract");
        long targetContract=copies.EnumerateArray().First(x=>
            x.GetProperty("folder").GetProperty("parent").GetProperty("id")
                .GetInt64()==target).GetProperty("folder")
            .GetProperty("ref").GetProperty("id").GetInt64();
        var projectLinks=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/personal/folders/{target}/links");
        var contractLinks=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/personal/folders/{targetContract}/links");
        Check(projectLinks.GetArrayLength()==1&&contractLinks.GetArrayLength()==1 &&
              projectLinks[0].GetProperty("fileId").GetInt64()==
                contractLinks[0].GetProperty("fileId").GetInt64() &&
              projectLinks[0].GetProperty("fileId").GetInt64()!=file,
            "target project/contract share a new logical FileId");
        long copiedFile=projectLinks[0].GetProperty("fileId").GetInt64();
        // Verify the SQLCipher objects and encrypted chunk ownership, not
        // merely different logical FileIds and equal downloaded bytes.
        NativeTransferIsolationProof.Verify(vault.Db,"company",file,"personal",copiedFile);
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/personal/{copiedFile}/versions/1/download"))
            .SequenceEqual(original) &&
              (await client.GetByteArrayAsync(
            $"/api/v2/files/personal/{copiedFile}/versions/2/download"))
            .SequenceEqual(revised),"cross-workspace all historical bytes intact");
        using(var missing=await client.PostAsJsonAsync(
            "/api/v2/projects/company/9223372036854775807/transfer",
            new{targetWorkspace="personal",move=true}))
            Check(missing.StatusCode==HttpStatusCode.NotFound,
                "missing source must not create partial project");

        (await client.DeleteAsync($"/api/v2/folders/company/project/{project}"))
            .EnsureSuccessStatusCode();
        var trash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        Check(trash is not null &&
            trash.Any(x=>x.Kind=="project"&&x.Id==project),
            "new V2 project appears in existing recycle UI");
        (await client.PostAsJsonAsync("/api/trash/company/restore",
            new RecycleRequest([new RecycleKey("project",project,"")])))
            .EnsureSuccessStatusCode();
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/company/{file}/versions/2/download"))
            .SequenceEqual(revised),"restore preserves both project and contract file versions");
        Console.WriteLine("N2-04 PROJECT EXCEL SEARCH RECYCLE TRANSFER SQLCIPHER PASS");
    }
}
