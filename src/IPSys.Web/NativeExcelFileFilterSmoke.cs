using System.IO.Compression;
using System.Net.Http.Json;
using System.Text.Json;
using System.Xml.Linq;

// Real HTTP + SQLCipher regression: a folder must be exported when ONLY one
// of its attachment filenames matches the filtered Excel search query.
static class NativeExcelFileFilterSmoke
{
    private static void Check(bool condition,string message)
    {
        if(!condition)throw new IOException("EXCEL FILE FILTER: "+message);
    }

    private static async Task<long> NewFolder(HttpClient client,string url,object body)
    {
        using var response=await client.PostAsJsonAsync(url,body);
        response.EnsureSuccessStatusCode();
        var value=await response.Content.ReadFromJsonAsync<JsonElement>();
        return value.GetProperty("id").GetInt64();
    }

    private static async Task Upload(HttpClient client,string url,string filename)
    {
        using var request=new HttpRequestMessage(HttpMethod.Post,url)
        {
            Content=new ByteArrayContent([1,2,3,4,5])
        };
        request.Headers.TryAddWithoutValidation(
            "X-File-Name",Uri.EscapeDataString(filename));
        using var response=await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
    }

    private static async Task<int> Rows(HttpClient client,string workspace,
        string kind,string section,string query)
    {
        string path="/api/v2/excel/"+workspace+"/"+kind+"/export";
        if(kind=="archive_folder")path+="?section="+Uri.EscapeDataString(section);
        using var response=await client.PostAsJsonAsync(path,
            new ExcelExportInput("filtered",null,query));
        response.EnsureSuccessStatusCode();
        using var bytes=new MemoryStream(await response.Content.ReadAsByteArrayAsync());
        using var zip=new ZipArchive(bytes,ZipArchiveMode.Read);
        var sheet=zip.GetEntry("xl/worksheets/sheet1.xml")
            ??throw new IOException("Excel workbook has no worksheet");
        using var stream=sheet.Open();
        var xml=XDocument.Load(stream);
        XNamespace x="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var lines=xml.Descendants(x+"sheetData").Elements(x+"row").Count();
        Check(lines>0,"Excel workbook has no header");
        return lines-1;
    }

    public static async Task VerifyAsync(HttpClient client)
    {
        string mark="EXF-"+Guid.NewGuid().ToString("N")[..8];
        long project=await NewFolder(client,"/api/v2/folders/company/project",
            new{project=new{name=mark+"项目",projectType="科研项目"}});
        long ip=await NewFolder(client,"/api/v2/folders/company/ip",
            new{ip=new{name=mark+"专利",ipType="发明专利"}});
        long archive=await NewFolder(client,"/api/v2/folders/company/archive_folder",
            new{section="certificate",archiveFolder=new{name=mark+"资质"}});
        long general=await NewFolder(client,"/api/v2/folders/company/archive_folder",
            new{section="general",archiveFolder=new{name=mark+"综合"}});

        string projectFile=mark+"-project-only.pdf";
        string ipFile=mark+"-ip-only.pdf";
        string archiveFile=mark+"-archive-only.pdf";
        string generalFile=mark+"-general-only.pdf";
        await Upload(client,$"/api/v2/files/company/upload?folderId={project}",projectFile);
        await Upload(client,$"/api/v2/ip/company/{ip}/files",ipFile);
        await Upload(client,$"/api/v2/files/company/upload?folderId={archive}",archiveFile);
        await Upload(client,$"/api/v2/files/company/upload?folderId={general}",generalFile);

        Check(await Rows(client,"company","project","",projectFile)==1,
            "project Excel omits folder matched solely through its file");
        Check(await Rows(client,"company","ip","",ipFile)==1,
            "IP Excel omits folder matched solely through its file");
        Check(await Rows(client,"company","archive_folder","certificate",archiveFile)==1,
            "archive Excel omits folder matched solely through its file");
        Check(await Rows(client,"company","archive_folder","general",generalFile)==1,
            "general Excel omits folder matched solely through its file");
        Check(await Rows(client,"company","archive_folder","certificate",generalFile)==0,
            "general file must not leak into archive module");
        Check(await Rows(client,"company","archive_folder","general",archiveFile)==0,
            "archive file must not leak into general module");
        Check(await Rows(client,"personal","archive_folder","certificate",archiveFile)==0,
            "company file must not leak into personal workspace");
        Console.WriteLine("EXCEL FILE FILTER SMOKE PASS");
    }
}
