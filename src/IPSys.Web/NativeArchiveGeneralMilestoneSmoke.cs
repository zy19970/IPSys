using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.IO.Compression;
using System.Xml.Linq;

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
        string query="?section="+section;
        using var response=await client.PostAsJsonAsync(
            $"/api/v2/excel/{workspace}/{kind}/export"+query,
            new ExcelExportInput("filtered",[id]));
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync();
    }
    private static async Task<JsonElement> Import(HttpClient client,string kind,
        string workspace,string section,string policy,byte[] bytes)
    {
        string query="?policy="+policy+"&section="+section;
        return await Read(await client.PostAsync(
            $"/api/v2/excel/{workspace}/{kind}/import"+query,
            new ByteArrayContent(bytes)));
    }
    // Mutate only the synthetic workbook XML. Test the public HTTP importer
    // against real 4-column/1-column historical exports and newer cells.
    private static byte[] RewriteSheet(byte[] workbook,int keepColumns=99,
        string? cell=null,string? value=null)
    {
        using var input=new ZipArchive(new MemoryStream(workbook),ZipArchiveMode.Read);
        using var buffer=new MemoryStream();
        using(var output=new ZipArchive(buffer,ZipArchiveMode.Create,true))
        foreach(var entry in input.Entries)
        {
            var copy=output.CreateEntry(entry.FullName);
            using var src=entry.Open();
            using var dst=copy.Open();
            if(entry.FullName!="xl/worksheets/sheet1.xml")
            {src.CopyTo(dst);continue;}
            var xml=XDocument.Load(src);
            XNamespace x="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            foreach(var row in xml.Descendants(x+"sheetData").Elements(x+"row"))
            foreach(var c in row.Elements(x+"c").ToArray())
            {
                string address=(string?)c.Attribute("r")??"";
                int col=address[0]-'A'+1;
                if(col>keepColumns){c.Remove();continue;}
                if(address==cell)
                {
                    var t=c.Descendants(x+"t").FirstOrDefault();
                    if(t is null)throw new IOException("test sheet cell missing: "+cell);
                    t.Value=value??"";
                }
            }
            xml.Save(dst);
        }
        return buffer.ToArray();
    }

    // Prove importer dependency sorting independently from worksheet order.
    private static byte[] ReverseDataRows(byte[] workbook)
    {
        using var input=new ZipArchive(new MemoryStream(workbook),ZipArchiveMode.Read);
        using var buffer=new MemoryStream();
        using(var output=new ZipArchive(buffer,ZipArchiveMode.Create,true))
        foreach(var entry in input.Entries)
        {
            var copy=output.CreateEntry(entry.FullName);
            using var src=entry.Open();
            using var dst=copy.Open();
            if(entry.FullName!="xl/worksheets/sheet1.xml")
            {src.CopyTo(dst);continue;}
            var xml=XDocument.Load(src);
            XNamespace x="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            var sheet=xml.Descendants(x+"sheetData").Single();
            var data=sheet.Elements(x+"row").Skip(1).ToArray();
            foreach(var row in data)row.Remove();
            sheet.Add(data.Reverse());
            xml.Save(dst);
        }
        return buffer.ToArray();
    }

    public static async Task VerifyAsync(HttpClient client)
    {
        string mark="AG204-"+Guid.NewGuid().ToString("N")[..8];
        // A02/N2: ordinary materials are archive_folder; the Excel module name
        // ("archive"/"general") survives only in the workbook routes below.
        const string ca="/api/v2/folders/company/archive_folder";
        const string cg="/api/v2/folders/company/archive_folder";
        long certificate=(await Read(await client.PostAsJsonAsync(ca,new{
            section="certificate",archiveFolder=new{
                name=mark+"企业资质",category="企业资质",
                remarks="可检索备注",tags="专属标签"}}))).GetProperty("id").GetInt64();
        long general=(await Read(await client.PostAsJsonAsync(cg,new{
            section="general",archiveFolder=new{
                name=mark+"综合资料",category="综合分类",
                year="2024",tags="资料标签;财务",
                remarks=mark+"综合备注"}}))).GetProperty("id").GetInt64();
        var generalRecord=await client.GetFromJsonAsync<JsonElement>(
            $"{cg}/{general}?section=general");
        Check(generalRecord.GetProperty("businessData").GetProperty("remarks")
                .GetString()==mark+"综合备注","general remarks round-trip through SQLCipher");
        var generalSearch=await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/company?q="+Uri.EscapeDataString(mark+"综合备注"));
        Check(generalSearch?.Results.Any(x=>x.Kind=="archive_folder"&&
              x.Section=="general"&&x.Id==general&&
              x.MatchedFields.Contains("remarks"))==true,
            "general remarks participate in unified search");
        var roots=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/company/archive_folder?section=achievement");
        long root=roots.EnumerateArray().First(x=>x.GetProperty("folder")
            .GetProperty("name").GetString()=="申报与认定")
            .GetProperty("folder").GetProperty("ref").GetProperty("id").GetInt64();
        long business=(await Read(await client.PostAsJsonAsync(ca,new{
            section="achievement",archiveFolder=new{
                name=mark+"项目申报",category="申报与认定",parentId=root,
                year="2026"}}))).GetProperty("id").GetInt64();
        var search=await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/company?q="+Uri.EscapeDataString(mark));
        Check(search is not null &&
            search.Results.Any(x=>x.Kind=="archive_folder"&&x.Section=="certificate"&&
                x.Id==certificate) &&
            search.Results.Any(x=>x.Kind=="archive_folder"&&x.Section=="achievement"&&
                x.Id==business) &&
            search.Results.Any(x=>x.Kind=="archive_folder"&&x.Section=="general"&&
                x.Id==general),
            "all ordinary material hits use native FolderId");
        var ancestor=await client.GetFromJsonAsync<SearchResponse>(
            "/api/v2/search/company?q="+Uri.EscapeDataString("申报与认定"));
        Check(ancestor is not null && ancestor.Results.Any(x=>x.Kind=="archive_folder"&&
            x.Id==business),"ancestor folder names searchable");

        // Nested directories are independent from editable business categories.
        long nested=(await Read(await client.PostAsJsonAsync(
            "/api/v2/folders/company/archive_folder",
            new{archiveFolder=new{name=mark+"二级目录",parentId=root},
                section="achievement"}))).GetProperty("id").GetInt64();
        long nestedRecord=(await Read(await client.PostAsJsonAsync(ca,new{
            section="achievement",archiveFolder=new{
                name=mark+"深层资料",category="自定义业务标签",
                parentId=nested,year="2024"}}))).GetProperty("id").GetInt64();
        var nestedSheet=await Export(client,"archive_folder","company","achievement",nestedRecord);
        var nestedImport=await Import(client,"archive_folder","company","achievement",
            "update",nestedSheet);
        Check(nestedImport.GetProperty("updated").GetInt32()==1 &&
              nestedImport.GetProperty("created").GetInt32()==0,
            "nested directory survives Excel roundtrip with independent category");
        var nestedStored=await client.GetFromJsonAsync<JsonElement>(
            $"{ca}/{nestedRecord}?section=achievement");
        Check(nestedStored.GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==nested &&
              nestedStored.GetProperty("businessData").GetProperty("year")
                .GetString()=="2024",
            "nested archive keeps directory FolderId and year");

        // A real top-level company business folder has no directory path.
        // All selected levels must import into a fresh personal module even
        // if the workbook rows are reversed (the export is position-sorted).
        string treeRootName=mark+"树根",treeChildName=mark+"树二级",
            treeLeafName=mark+"树三级";
        long treeRoot=(await Read(await client.PostAsJsonAsync(ca,new{
            section="achievement",archiveFolder=new{
                name=treeRootName,category="自定义类别",year="2026",
                tags="甲;乙",remarks="根级备注"}}))).GetProperty("id").GetInt64();
        long treeChild=(await Read(await client.PostAsJsonAsync(ca,new{
            section="achievement",archiveFolder=new{
                name=treeChildName,parentId=treeRoot,category="次级"}})))
                .GetProperty("id").GetInt64();
        long treeLeaf=(await Read(await client.PostAsJsonAsync(ca,new{
            section="achievement",archiveFolder=new{
                name=treeLeafName,parentId=treeChild,remarks="叶级备注"}})))
                .GetProperty("id").GetInt64();
        var rootWorkbook=await Export(client,"archive_folder","company","achievement",treeRoot);
        var rootSkip=await Import(client,"archive_folder","company","achievement",
            "skip",rootWorkbook);
        Check(rootSkip.GetProperty("skipped").GetInt32()==1 &&
              rootSkip.GetProperty("failed").GetInt32()==0,
            "company achievement root with blank directory can round-trip");
        var rootConflict=await Import(client,"archive_folder","company","achievement",
            "create",rootWorkbook);
        Check(rootConflict.GetProperty("failed").GetInt32()==1 &&
              rootConflict.GetProperty("errors")[0].GetProperty("error")
                  .GetString()!.Contains("同名文件夹"),
            "same-parent Excel create yields actionable name conflict");
        byte[] fullTree;
        using(var response=await client.PostAsJsonAsync(
            "/api/v2/excel/company/archive_folder/export?section=achievement",
            new ExcelExportInput("filtered",[treeRoot,treeChild,treeLeaf])))
        {
            response.EnsureSuccessStatusCode();
            fullTree=ReverseDataRows(await response.Content.ReadAsByteArrayAsync());
        }
        var treeImport=await Import(client,"archive_folder","personal","achievement",
            "create",fullTree);
        Check(treeImport.GetProperty("created").GetInt32()==3 &&
              treeImport.GetProperty("failed").GetInt32()==0,
            "reversed three-level folder workbook imports into empty module: "+
            treeImport.GetRawText());
        var personalTree=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/personal/archive_folder?section=achievement&flat=true");
        JsonElement At(string name)=>personalTree.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("name").GetString()==name);
        var r0=At(treeRootName);var r1=At(treeChildName);var r2=At(treeLeafName);
        Check(r0.GetProperty("folder").GetProperty("parent").ValueKind==
                  JsonValueKind.Null &&
              r1.GetProperty("folder").GetProperty("parent").GetProperty("id")
                  .GetInt64()==r0.GetProperty("folder").GetProperty("ref")
                  .GetProperty("id").GetInt64() &&
              r2.GetProperty("folder").GetProperty("parent").GetProperty("id")
                  .GetInt64()==r1.GetProperty("folder").GetProperty("ref")
                  .GetProperty("id").GetInt64() &&
              r0.GetProperty("businessData").GetProperty("category")
                  .GetString()=="自定义类别" &&
              r0.GetProperty("businessData").GetProperty("tags")
                  .GetString()=="甲;乙" &&
              r0.GetProperty("businessData").GetProperty("year")
                  .GetString()=="2026",
            "three-level import preserves folder ancestry and all attributes");
        var repeated=await Import(client,"archive_folder","personal","achievement",
            "skip",fullTree);
        Check(repeated.GetProperty("skipped").GetInt32()==3 &&
              repeated.GetProperty("failed").GetInt32()==0,
            "reimport of same folder tree skips every level");

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
        var display=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/folders/company");
        Check(display.GetProperty("files").EnumerateArray().Any(x=>
            x.GetProperty("linkId").GetInt64()==link &&
            x.GetProperty("displayName").GetString()==mark+"资质.pdf"),
            "archive snapshot exposes per-link display name, not version filename");
        byte[] workbook=await Export(client,"archive_folder","company","certificate",certificate);
        Check(workbook.Length>750,"archive fixed XLSX export");
        using(var template=await client.GetAsync(
            "/api/v2/excel/company/archive_folder/template?section=certificate"))
            template.EnsureSuccessStatusCode();
        // Old four-column layouts are deliberately rejected by the current contract.
        using(var outdated=await client.PostAsync(
            "/api/v2/excel/company/archive_folder/import?section=certificate&policy=skip",
            new ByteArrayContent(RewriteSheet(workbook,4))))
            Check(outdated.StatusCode==HttpStatusCode.BadRequest,
                "retired four-column template is rejected");
        var skip=await Import(client,"archive_folder","company","certificate","skip",workbook);
        Check(skip.GetProperty("skipped").GetInt32()==1,"native duplicate skipping");
        var update=await Import(client,"archive_folder","company","certificate","update",workbook);
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
        var personal=await Import(client,"archive_folder","personal","certificate",
            "create",workbook);
        Check(personal.GetProperty("created").GetInt32()==1,
            "personal archive import independent");
        var personalRows=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/personal/archive_folder?section=certificate");
        var matched=personalRows.EnumerateArray().First(x=>
            x.GetProperty("folder").GetProperty("name").GetString()==mark+"企业资质");
        long personalId=matched.GetProperty("folder").GetProperty("ref")
            .GetProperty("id").GetInt64();
        var emptyFiles=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/personal/folders/{personalId}/links");
        Check(emptyFiles.GetArrayLength()==0,"Excel does not copy attachments across workspaces");

        byte[] generalWorkbook=await Export(client,"archive_folder","company","general",general);
        using(var outdated=await client.PostAsync(
            "/api/v2/excel/company/archive_folder/import?section=general&policy=skip",
            new ByteArrayContent(RewriteSheet(generalWorkbook,1))))
            Check(outdated.StatusCode==HttpStatusCode.BadRequest,
                "retired one-column template is rejected");
        var copied=await Import(client,"archive_folder","personal","general","create",generalWorkbook);
        Check(copied.GetProperty("created").GetInt32()==1,
            "native general fixed XLSX import");
        var copiedGeneral=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/personal/archive_folder?section=general");
        Check(copiedGeneral.EnumerateArray().Any(x=>
            x.GetProperty("businessData").GetProperty("remarks").GetString()==
            mark+"综合备注"),
            "general XLSX preserves remarks in another workspace");
        // A six-column general workbook must round-trip all folder fields.
        // A blank Excel cell means retain, whereas other nonblank fields update.
        byte[] updatedGeneral=RewriteSheet(generalWorkbook,99,"B2","修改后的类别");
        updatedGeneral=RewriteSheet(updatedGeneral,99,"C2","");
        updatedGeneral=RewriteSheet(updatedGeneral,99,"D2","更新标签");
        updatedGeneral=RewriteSheet(updatedGeneral,99,"E2","2027");
        var updatedGeneralReport=await Import(client,"archive_folder","personal","general",
            "update",updatedGeneral);
        Check(updatedGeneralReport.GetProperty("updated").GetInt32()==1 &&
              updatedGeneralReport.GetProperty("failed").GetInt32()==0,
            "general six-column workbook updates optional metadata");
        var personalGeneral=(await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/personal/archive_folder?section=general&flat=true"))
            .EnumerateArray().Single(x=>x.GetProperty("folder")
                .GetProperty("name").GetString()==mark+"综合资料");
        var generalData=personalGeneral.GetProperty("businessData");
        long personalGeneralId=personalGeneral.GetProperty("folder")
            .GetProperty("ref").GetProperty("id").GetInt64();
        Check(generalData.GetProperty("category").GetString()=="修改后的类别" &&
              generalData.GetProperty("year").GetString()=="2027" &&
              generalData.GetProperty("tags").GetString()=="更新标签" &&
              generalData.GetProperty("remarks").GetString()==mark+"综合备注",
            "blank remark retains value while category/year/tags are updated");

        long generalChild=(await Read(await client.PostAsJsonAsync(cg,new{
            section="general",archiveFolder=new{
                name=mark+"综合下级",parentId=general,
                category="下级类别",year="2023",remarks="下级备注"}})))
            .GetProperty("id").GetInt64();
        byte[] generalTree;
        using(var exported=await client.PostAsJsonAsync(
            "/api/v2/excel/company/archive_folder/export?section=general",
            new ExcelExportInput("filtered",[general,generalChild])))
        {
            exported.EnsureSuccessStatusCode();
            generalTree=ReverseDataRows(await exported.Content.ReadAsByteArrayAsync());
        }
        var generalTreeResult=await Import(client,"archive_folder","personal","general",
            "skip",generalTree);
        Check(generalTreeResult.GetProperty("skipped").GetInt32()==1 &&
              generalTreeResult.GetProperty("created").GetInt32()==1 &&
              generalTreeResult.GetProperty("failed").GetInt32()==0,
            "general hierarchy respects existing root even with reversed rows");
        var personalGeneralEntries=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/personal/archive_folder?section=general&flat=true");
        var personalGeneralChild=personalGeneralEntries.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("name").GetString()==mark+"综合下级");
        Check(personalGeneralChild.GetProperty("folder").GetProperty("parent")
                  .GetProperty("id").GetInt64()==personalGeneralId &&
              personalGeneralChild.GetProperty("businessData").GetProperty("year")
                  .GetString()=="2023" &&
              personalGeneralChild.GetProperty("businessData").GetProperty("category")
                  .GetString()=="下级类别",
            "general nested folder relationship and optional fields are retained");

        var invalidGeneralChild=RewriteSheet(
            await Export(client,"archive_folder","company","general",generalChild),
            99,"F2","不存在的上级目录");
        var missingParent=await Import(client,"archive_folder","personal","general",
            "create",invalidGeneralChild);
        Check(missingParent.GetProperty("failed").GetInt32()==1 &&
              missingParent.GetProperty("created").GetInt32()==0,
            "missing parent directory must report an error instead of guessing");

        byte[] businessWorkbook=await Export(client,"archive_folder","company","achievement",business);
        var businessSkip=await Import(client,"archive_folder","company","achievement",
            "skip",businessWorkbook);
        Check(businessSkip.GetProperty("skipped").GetInt32()==1,
            "business directory-aware deduplication respects root");
        var yearAndFolder=RewriteSheet(businessWorkbook,99,"E2","2027");
        yearAndFolder=RewriteSheet(yearAndFolder,99,"B2","独立业务类别");
        var changed=await Import(client,"archive_folder","company","achievement",
            "update",yearAndFolder);
        Check(changed.GetProperty("updated").GetInt32()==1 &&
              changed.GetProperty("created").GetInt32()==0,
            "editing category updates existing record matched by directory");
        var changedBusiness=await client.GetFromJsonAsync<JsonElement>(
            $"{ca}/{business}?section=achievement");
        Check(changedBusiness.GetProperty("businessData").GetProperty("year")
                .GetString()=="2027" &&
              changedBusiness.GetProperty("businessData").GetProperty("category")
                .GetString()=="独立业务类别" &&
              changedBusiness.GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==root,
            "year/category change does not move archive out of its parent");
        var wrongFolder=RewriteSheet(businessWorkbook,99,"F2","不存在的目录");
        var rejected=await Import(client,"archive_folder","company","achievement",
            "update",wrongFolder);
        Check(rejected.GetProperty("failed").GetInt32()==1 &&
              rejected.GetProperty("created").GetInt32()==0,
            "nonexistent directory cannot silently change parent or create record");
        using(var invalid=await client.PostAsync(
            "/api/v2/excel/company/archive_folder/import?section=certificate&policy=create",
            new ByteArrayContent(new byte[]{1,2,3,4})))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                "invalid workbook rejected");
        using(var guest=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await guest.GetAsync(
            "/api/v2/excel/company/archive_folder/template?section=certificate"))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"auth required");

        using(var removed=await client.DeleteAsync(
            $"{ca}/{certificate}?section=certificate"))
            removed.EnsureSuccessStatusCode();
        var trash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        Check(trash is not null && trash.Any(x=>x.Kind=="v2_archive_folder"&&
            x.Id==certificate&&x.Section=="certificate"),"V2 material recycle identity");
        // The attachment route is intentionally hidden while its owner is in
        // trash; the restore below validates that both versions remain intact.
        using(var restored=await client.PostAsJsonAsync(
            "/api/trash/company/restore",
            new RecycleRequest([new RecycleKey("v2_archive_folder",certificate,"certificate")])))
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
        using(var gone=await client.DeleteAsync($"{cg}/{general}?section=general"))
            gone.EnsureSuccessStatusCode();
        trash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        Check(trash is not null && trash.Any(x=>x.Kind=="v2_archive_folder"&&
            x.Id==general&&x.Section=="general"),"general material FolderId in recycle");
        using(var restored=await client.PostAsJsonAsync(
            "/api/trash/company/restore",
            new RecycleRequest([new RecycleKey("v2_archive_folder",general,"general")])))
            restored.EnsureSuccessStatusCode();
        // A second deletion is deliberately permanent. The archive's own
        // active LinkId and all of its history must be cleaned first, in one
        // transaction; the parent FolderId is deleted only after those links.
        using(var removedAgain=await client.DeleteAsync(
            $"{ca}/{certificate}?section=certificate"))
            removedAgain.EnsureSuccessStatusCode();
        using(var purged=await client.PostAsJsonAsync(
            "/api/trash/company/purge",
            new RecycleRequest([new RecycleKey("v2_archive_folder",certificate,"certificate")])))
            purged.EnsureSuccessStatusCode();
        using(var missing=await client.GetAsync(
            $"/api/v2/files/company/{file}/versions/2/download"))
            Check(missing.StatusCode==HttpStatusCode.NotFound,
                "permanent material purge removes its orphan file history");
        Console.WriteLine("N2-04 NATIVE ARCHIVE/GENERAL EXCEL SEARCH RECYCLE SMOKE PASS");
    }
}
