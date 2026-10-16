using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// A V2-generated fixed-column workbook is imported across isolated workspaces.
// No V1 data source is required to exercise the full Excel update cycle.
static class NativeIpExcelHttpSmoke
{
    static void Check(bool ok,string why)
    {
        if(!ok)throw new IOException("N2-03-03 V2 Excel: "+why);
    }
    static IpInput Ip(string name,string applicationNo,string remark)=>new(
        name,"发明专利","已申请","测试申请人",null,null,applicationNo,null,
        null,null,null,null,null,null,null,null,null,null,remark,null);

    static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    static async Task<byte[]> Export(HttpClient client,string path,string mode,
        long[]? ids=null)
    {
        using var r=await client.PostAsJsonAsync(path,
            new ExcelExportInput(mode,ids));
        r.EnsureSuccessStatusCode();
        return await r.Content.ReadAsByteArrayAsync();
    }
    static async Task<JsonElement> Import(HttpClient client,string path,string policy,
        byte[] bytes)
    {
        using var r=await client.PostAsync(path+"?policy="+policy,
            new ByteArrayContent(bytes));
        return await Json(r);
    }
    static async Task<JsonElement> GetNativeIp(HttpClient client,string workspace,long id)=>
        await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/folders/{workspace}/ip/{id}");

    public static async Task VerifyAsync(HttpClient client)
    {
        string code=Guid.NewGuid().ToString("N")[..8];
        string originalName="Excel来源专利"+code;
        string appNo="CN2026"+code;
        string company="/api/v2/excel/company/ip";
        string personal="/api/v2/excel/personal/ip";
        // V2 export is itself the fixed-column workbook fixture.
        var fixture=await Json(await client.PostAsJsonAsync(
            "/api/v2/folders/personal/ip",
            new FolderMutationInput(Ip:Ip(originalName,appNo,"初始说明"))));
        long fixtureId=fixture.GetProperty("id").GetInt64();
        var source=await Export(client,personal+"/export","filtered",[fixtureId]);
        Check(source.Length>800,"V2 20-column Excel workbook fixture");

        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var blocked=await anonymous.PostAsJsonAsync(company+"/export",
            new ExcelExportInput("all",null)))
            Check(blocked.StatusCode==HttpStatusCode.Unauthorized,"auth required");
        using(var template=await client.GetAsync(company+"/template"))
        {
            template.EnsureSuccessStatusCode();
            Check((await template.Content.ReadAsByteArrayAsync()).Length>700,
                "same fixed template accessible under V2");
        }

        var imported=await Import(client,company+"/import","create",source);
        Check(imported.GetProperty("created").GetInt32()==1 &&
              imported.GetProperty("failed").GetInt32()==0,"new native IP created");
        var natives=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/folders/company/ip");
        var entry=natives.EnumerateArray().FirstOrDefault(x=>
            x.GetProperty("businessData").GetProperty("applicationNo")
                .GetString()==appNo);
        Check(entry.ValueKind==JsonValueKind.Object,"new IP exists only in native folders");
        long nativeId=entry.GetProperty("folder").GetProperty("ref")
            .GetProperty("id").GetInt64();
        Check(nativeId>0,"import created a V2 FolderId");

        byte[] raw=RandomNumberGenerator.GetBytes(5127);
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/ip/company/{nativeId}/files")
            {Content=new ByteArrayContent(raw)})
        {
            upload.Headers.TryAddWithoutValidation("X-File-Name","source.pdf");
            var file=await Json(await client.SendAsync(upload));
            long fileId=file.GetProperty("fileId").GetInt64();
            Check(fileId>0,"attached encrypted original by V2 FolderId");
            var skipping=await Import(client,company+"/import","skip",source);
            Check(skipping.GetProperty("skipped").GetInt32()==1 &&
                  skipping.GetProperty("created").GetInt32()==0,
                  "skip mode matches stable application number");

            using(var changed=await client.PutAsJsonAsync(
                "/api/v2/folders/personal/ip/"+fixtureId,
                new FolderMutationInput(Ip:Ip("Excel新名称"+code,appNo,"更新后说明"))))
                changed.EnsureSuccessStatusCode();
            var revised=await Export(client,personal+"/export","filtered",[fixtureId]);
            var updating=await Import(client,company+"/import","update",revised);
            Check(updating.GetProperty("updated").GetInt32()==1 &&
                  updating.GetProperty("created").GetInt32()==0,
                  "update mode changes exactly one V2 IP");
            var updated=await GetNativeIp(client,"company",nativeId);
            Check(updated.GetProperty("businessData").GetProperty("name")
                   .GetString()=="Excel新名称"+code &&
                  updated.GetProperty("businessData").GetProperty("remarks")
                   .GetString()=="更新后说明",
                  "V2 IP updated in-place, keeps its FolderId");

            var files=await client.GetFromJsonAsync<JsonElement>(
                $"/api/v2/ip/company/{nativeId}/files");
            Check(files.GetArrayLength()==1 &&
                  files[0].GetProperty("fileId").GetInt64()==fileId &&
                  files[0].GetProperty("latestVersion").GetInt32()==1,
                  "Excel update preserves FileId/link/version");
            var bytes=await client.GetByteArrayAsync(
                $"/api/v2/ip/company/{nativeId}/files/{fileId}/versions/1/download");
            Check(bytes.SequenceEqual(raw),"updated IP preserves actual original bytes");

            var selected=await Export(client,company+"/export","filtered",[nativeId]);
            Check(selected.Length>800,"native id selected export");
            var addPersonal=await Import(client,personal+"/import","create",selected);
            Check(addPersonal.GetProperty("created").GetInt32()==1,
                "personal import creates independent V2 IP without source attachments");
            var personalRows=await client.GetFromJsonAsync<JsonElement>(
                "/api/v2/folders/personal/ip");
            var personalIp=personalRows.EnumerateArray().First(x=>
                x.GetProperty("businessData").GetProperty("applicationNo")
                    .GetString()==appNo);
            long personalId=personalIp.GetProperty("folder")
                .GetProperty("ref").GetProperty("id").GetInt64();
            var personalFiles=await client.GetFromJsonAsync<JsonElement>(
                $"/api/v2/ip/personal/{personalId}/files");
            Check(personalFiles.GetArrayLength()==0,"Excel doesn't leak original bytes or FileId");
            Check((await GetNativeIp(client,"company",nativeId))
                .GetProperty("businessData").GetProperty("name")
                .GetString()=="Excel新名称"+code,
                "cross-workspace import does not mutate company IP");

            using(var invalid=await client.PostAsync(company+"/import?policy=create",
                new ByteArrayContent(new byte[]{1,2,3,4,5})))
                Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                    "corrupt workbook rejected without new IP");
        }
        Console.WriteLine("N2-03-03 V2 IP XLSX HTTP SQLCIPHER SMOKE PASS");
    }
}
