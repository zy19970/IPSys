using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Xml.Linq;

// A03/B01: an Excel import may auto-update only when the row identifies exactly
// one existing record. Duplicated project numbers must be refused with row and
// candidate identities, while create/skip keep working on the same input.
static class NativeExcelAmbiguitySmoke
{
    private static void Check(bool ok,string what)
    {
        if(!ok)throw new IOException("EXCEL AMBIGUITY: "+what);
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
        long id,string? section=null)
    {
        string query=section is null?"":"?section="+section;
        using var response=await client.PostAsJsonAsync(
            $"/api/v2/excel/company/{kind}/export"+query,
            new ExcelExportInput("filtered",[id]));
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync();
    }
    private static async Task<JsonElement> Import(HttpClient client,string kind,
        string policy,byte[] bytes,string? section=null)
    {
        string query="?policy="+policy+(section is null?"":"&section="+section);
        return await Read(await client.PostAsync(
            $"/api/v2/excel/company/{kind}/import"+query,new ByteArrayContent(bytes)));
    }
    // Only the sheet XML is rewritten so the import path still parses a real
    // workbook produced by the export endpoint.
    private static byte[] BlankCell(byte[] workbook,string cell)
    {
        using var input=new ZipArchive(new MemoryStream(workbook),ZipArchiveMode.Read);
        using var buffer=new MemoryStream();
        using(var output=new ZipArchive(buffer,ZipArchiveMode.Create,true))
        foreach(var entry in input.Entries)
        {
            var copy=output.CreateEntry(entry.FullName);
            using var src=entry.Open();
            using var dst=copy.Open();
            if(entry.FullName!="xl/worksheets/sheet1.xml"){src.CopyTo(dst);continue;}
            var xml=XDocument.Load(src);
            XNamespace x="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            var target=xml.Descendants(x+"sheetData").Elements(x+"row")
                .Elements(x+"c").FirstOrDefault(c=>(string?)c.Attribute("r")==cell)
                ??throw new IOException("测试工作簿缺少单元格 "+cell);
            target.Descendants(x+"t").First().Value="";
            xml.Save(dst);
        }
        return buffer.ToArray();
    }

    public static async Task VerifyAsync(HttpClient client)
    {
        string mark="AMB-"+Guid.NewGuid().ToString("N")[..8];
        const string projects="/api/v2/folders/company/project";
        const string materials="/api/v2/folders/company/archive_folder";

        async Task<long> NewProject(string name,string number,string? remarks,
            string? leader)
        {
            var row=await Read(await client.PostAsJsonAsync(projects,new{
                project=new{name,projectType="科研项目",projectNo=number,remarks,leader}}));
            return row.GetProperty("id").GetInt64();
        }
        async Task<JsonElement> GetProject(long id)=>
            await client.GetFromJsonAsync<JsonElement>($"{projects}/{id}");

        // Two projects already share one number: a real business situation,
        // because the project number is deliberately not a unique key.
        long first=await NewProject(mark+"甲",mark+"-NO","原备注一","张三");
        long second=await NewProject(mark+"乙",mark+"-NO","原备注二","李四");
        byte[] ambiguous=await Export(client,"project",first);

        var update=await Import(client,"project","update",ambiguous);
        Check(update.GetProperty("updated").GetInt32()==0 &&
              update.GetProperty("created").GetInt32()==0 &&
              update.GetProperty("failed").GetInt32()==1,
            "ambiguous update must refuse the row instead of rewriting the first match");
        var ambiguousError=update.GetProperty("errors")[0];
        Check(ambiguousError.GetProperty("row").GetInt32()==2,
            "ambiguous update must report the Excel row number");
        string message=ambiguousError.GetProperty("error").GetString()??"";
        Check(message.Contains(first.ToString())&&message.Contains(second.ToString()),
            "ambiguous update must name every candidate identity");
        Check((await GetProject(first)).GetProperty("businessData")
                .GetProperty("remarks").GetString()=="原备注一" &&
              (await GetProject(second)).GetProperty("businessData")
                .GetProperty("remarks").GetString()=="原备注二",
            "ambiguous update must leave all candidates untouched");

        // B01: create and skip keep working on the very same ambiguous input.
        var create=await Import(client,"project","create",ambiguous);
        Check(create.GetProperty("created").GetInt32()==1 &&
              create.GetProperty("failed").GetInt32()==0,
            "create must add a new project even when the number already repeats");
        var skip=await Import(client,"project","skip",ambiguous);
        Check(skip.GetProperty("skipped").GetInt32()==1 &&
              skip.GetProperty("created").GetInt32()==0 &&
              skip.GetProperty("failed").GetInt32()==0,
            "skip must count the existing project without touching it");

        // A unique match updates normally, and blank Excel cells keep the
        // stored value instead of clearing it.
        long solo=await NewProject(mark+"独有",mark+"-SOLO","保留备注","王五");
        byte[] soloBook=await Export(client,"project",solo);
        var merged=await Import(client,"project","update",BlankCell(soloBook,"D2"));
        Check(merged.GetProperty("updated").GetInt32()==1 &&
              merged.GetProperty("failed").GetInt32()==0,
            "unique match must still update under the update policy");
        var kept=await GetProject(solo);
        Check(kept.GetProperty("businessData").GetProperty("leader").GetString()=="王五" &&
              kept.GetProperty("businessData").GetProperty("remarks").GetString()=="保留备注",
            "blank Excel cells must not clear stored project fields");

        // Ordinary materials are now plain folders, so the sibling-name index
        // makes same-name ambiguity impossible at the data layer.
        long material=(await Read(await client.PostAsJsonAsync(materials,new{
            section="general",archiveFolder=new{name=mark+"综合资料"}})))
            .GetProperty("id").GetInt64();
        using(var duplicate=await client.PostAsJsonAsync(materials,new{
            section="general",archiveFolder=new{name=mark+"综合资料"}}))
        {
            Check(duplicate.StatusCode==HttpStatusCode.Conflict,
                "duplicate material name in one directory must be rejected");
            string conflict=await duplicate.Content.ReadAsStringAsync();
            Check(conflict.Contains("同名"),"duplicate rejection must explain the name clash");
        }
        byte[] materialBook=await Export(client,"archive_folder",material,"general");
        var materialUpdate=await Import(client,"archive_folder","update",materialBook,"general");
        Check(materialUpdate.GetProperty("updated").GetInt32()==1 &&
              materialUpdate.GetProperty("failed").GetInt32()==0,
            "unique material name updates through the general workbook");
        var materialSkip=await Import(client,"archive_folder","skip",materialBook,"general");
        Check(materialSkip.GetProperty("skipped").GetInt32()==1 &&
              materialSkip.GetProperty("failed").GetInt32()==0,
            "skip counts an existing material without changing it");
        var materialCreate=await Import(client,"archive_folder","create",materialBook,"general");
        Check(materialCreate.GetProperty("created").GetInt32()==0 &&
              materialCreate.GetProperty("failed").GetInt32()==1 &&
              materialCreate.GetProperty("errors")[0].GetProperty("row").GetInt32()==2,
            "create reports the duplicate material row instead of silently succeeding");
        Console.WriteLine("EXCEL AMBIGUITY SMOKE PASS");
    }
}
