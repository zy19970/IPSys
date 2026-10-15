using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

static class NativeFileCopyHttpSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool good,string why)
        {
            if(!good)throw new IOException("N3-03 COPY HTTP: "+why);
        }
        static async Task<JsonElement> Json(HttpResponseMessage response)
        {
            using(response)
            {
                response.EnsureSuccessStatusCode();
                return await response.Content.ReadFromJsonAsync<JsonElement>();
            }
        }
        static async Task<long> Project(HttpClient http,string workspace,string suffix)
        {
            var input=new ProjectInput("文件复制"+suffix,"科研项目","COPY-"+suffix,
                null,null,null,null,null,null,null,null);
            var json=await Json(await http.PostAsJsonAsync(
                $"/api/v2/folders/{workspace}/project",
                new FolderMutationInput(Project:input)));
            return json.GetProperty("id").GetInt64();
        }
        static async Task<long> Upload(HttpClient http,long folderId,byte[] bytes)
        {
            using var req=new HttpRequestMessage(HttpMethod.Post,
                $"/api/v2/files/company/upload?folderId={folderId}")
                {Content=new ByteArrayContent(bytes)};
            req.Headers.TryAddWithoutValidation("X-File-Name",
                Uri.EscapeDataString("源原件.pdf"));
            return (await Json(await http.SendAsync(req))).GetProperty("fileId").GetInt64();
        }
        static async Task<int> NewVersion(HttpClient http,string workspace,long fileId,
            string filename,byte[] bytes)
        {
            using var req=new HttpRequestMessage(HttpMethod.Post,
                $"/api/v2/files/{workspace}/{fileId}/versions")
                {Content=new ByteArrayContent(bytes)};
            req.Headers.TryAddWithoutValidation("X-File-Name",Uri.EscapeDataString(filename));
            return (await Json(await http.SendAsync(req))).GetProperty("version").GetInt32();
        }
        static async Task<byte[]> Bytes(HttpClient http,string workspace,long fileId,int version)
        {
            using var response=await http.GetAsync(
                $"/api/v2/files/{workspace}/{fileId}/versions/{version}/download");
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsByteArrayAsync();
        }
        string suffix=Guid.NewGuid().ToString("N")[..8];
        long companyFolder=await Project(client,"company",suffix);
        long personalFolder=await Project(client,"personal",suffix);
        var a=new byte[]{0,1,2,3,4,5};
        var b=new byte[]{10,20,30};
        long source=await Upload(client,companyFolder,a);
        Check(await NewVersion(client,"company",source,"历史第二版.pdf",b)==2,
            "source second version");
        string basePath=$"/api/v2/files/company/{source}";
        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var blocked=await anonymous.PostAsJsonAsync(basePath+"/copy",
            new NativeFileCopyInput("company",companyFolder,"reuse-content")))
            Check(blocked.StatusCode==HttpStatusCode.Unauthorized,"copy requires token");
        using(var missing=await client.PostAsJsonAsync(
            "/api/v2/files/company/999999999/copy",
            new NativeFileCopyInput("company",companyFolder,"reuse-content")))
            Check(missing.StatusCode==HttpStatusCode.NotFound,"source required");
        using(var denied=await client.PostAsJsonAsync(basePath+"/copy",
            new NativeFileCopyInput("personal",personalFolder,"reuse-content")))
            Check(denied.StatusCode==HttpStatusCode.BadRequest,
                "cross workspace byte reuse rejected");
        using(var denied=await client.PostAsJsonAsync(basePath+"/copy",
            new NativeFileCopyInput("company",personalFolder,"reuse-content")))
            Check(denied.StatusCode==HttpStatusCode.NotFound,"target folder scope");
        using(var denied=await client.PostAsJsonAsync(basePath+"/copy",
            new NativeFileCopyInput("company",companyFolder,"unspecified")))
            Check(denied.StatusCode==HttpStatusCode.BadRequest,"explicit mode required");

        var reuse=await Json(await client.PostAsJsonAsync(basePath+"/copy",
            new NativeFileCopyInput("company",companyFolder,"reuse-content","异名独立档案.pdf")));
        long same=reuse.GetProperty("fileId").GetInt64();
        Check(same!=source && reuse.GetProperty("reusedObjects").GetInt32()==2 &&
              reuse.GetProperty("newObjects").GetInt32()==0 &&
              reuse.GetProperty("versions").GetInt32()==2,
              "copy FileId independent, physical objects reused");
        var copyUrl=$"/api/v2/files/company/{same}";
        var data=await client.GetFromJsonAsync<JsonElement>(copyUrl);
        Check(data.GetProperty("name").GetString()=="异名独立档案.pdf" &&
              data.GetProperty("versions").GetArrayLength()==2,
              "copy naming and independent file history");
        using(var changed=await client.PutAsJsonAsync(copyUrl+"/metadata",
            new NativeFileMetadataInput("另一个名字.pdf","另一个备注","另一标签",null,null)))
            changed.EnsureSuccessStatusCode();
        Check((await client.GetFromJsonAsync<JsonElement>(basePath))
                  .GetProperty("name").GetString()=="源原件.pdf",
            "metadata edits do not leak between FileIds");
        Check(await NewVersion(client,"company",same,"副本第三版.pdf",new byte[]{99})==3,
            "copy's independent version");
        Check((await client.GetFromJsonAsync<JsonElement>(basePath))
                  .GetProperty("versions").GetArrayLength()==2,"source versions independent");
        Check((await client.GetFromJsonAsync<JsonElement>(copyUrl))
                  .GetProperty("versions").GetArrayLength()==3,"copy version independent");
        Check(a.SequenceEqual(await Bytes(client,"company",same,1)) &&
              b.SequenceEqual(await Bytes(client,"company",same,2)),
              "history reads existing shared immutable objects");

        var cross=await Json(await client.PostAsJsonAsync(basePath+"/copy",
            new NativeFileCopyInput("personal",personalFolder,"independent-content","个人副本.pdf")));
        long crossId=cross.GetProperty("fileId").GetInt64();
        Check(crossId!=same && crossId!=source &&
              cross.GetProperty("reusedObjects").GetInt32()==0 &&
              cross.GetProperty("newObjects").GetInt32()==2,"cross copies new physical objects");
        var personal=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/personal/{crossId}");
        Check(personal.GetProperty("versions").GetArrayLength()==2 &&
              personal.GetProperty("name").GetString()=="个人副本.pdf",
            "personal independent copy");
        for(int ver=1;ver<=2;ver++)
        {
            var expected=ver==1?a:b;
            var actual=await Bytes(client,"personal",crossId,ver);
            Check(actual.SequenceEqual(expected) &&
                  Convert.ToHexString(SHA256.HashData(actual))==
                  personal.GetProperty("versions")[2-ver].GetProperty("sha256").GetString(),
                  "cross workspace original bytes and hash preserved");
        }
        using(var forbidden=await client.GetAsync(
            $"/api/v2/files/company/{crossId}"))
            Check(forbidden.StatusCode==HttpStatusCode.NotFound,
                "personal FileId not readable through company workspace");
        Console.WriteLine("N3-03 FILE COPY HTTP SMOKE PASS");
    }
}
