using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

static class NativeFileHttpSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool ok,string message)
        {
            if(!ok)throw new IOException("N3-01 native File HTTP: "+message);
        }
        static HttpRequestMessage Request(HttpMethod method,string path,byte[] bytes,
            string filename,string? note=null)
        {
            var r=new HttpRequestMessage(method,path){Content=new ByteArrayContent(bytes)};
            r.Headers.TryAddWithoutValidation("X-File-Name",Uri.EscapeDataString(filename));
            if(note!=null)r.Headers.TryAddWithoutValidation("X-Version-Note",Uri.EscapeDataString(note));
            return r;
        }
        static async Task<byte[]> Download(HttpClient client,string path)
        {
            using var response=await client.GetAsync(path);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsByteArrayAsync();
        }
        string suffix=Guid.NewGuid().ToString("N")[..8];
        var folder=new ProjectInput("N3-01上传项目"+suffix,"科研项目","N3-"+suffix,
            null,null,null,null,null,null,null,null);
        long folderId;
        using(var created=await client.PostAsJsonAsync("/api/v2/folders/company/project",
            new FolderMutationInput(Project:folder)))
        {
            created.EnsureSuccessStatusCode();
            folderId=(await created.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("id").GetInt64();
        }
        var large=new byte[2*1024*1024+37];
        RandomNumberGenerator.Fill(large);
        var originalDigest=Convert.ToHexString(SHA256.HashData(large));
        string path=$"/api/v2/files/company/upload?folderId={folderId}";
        using(var unauth=new HttpClient{BaseAddress=client.BaseAddress})
        using(var req=Request(HttpMethod.Post,path,large,"无权限.pdf"))
        using(var denied=await unauth.SendAsync(req))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"authentication required");
        using(var badWorkspace=Request(HttpMethod.Post,
            $"/api/v2/files/personal/upload?folderId={folderId}",large,"cross.pdf"))
        using(var response=await client.SendAsync(badWorkspace))
            Check(response.StatusCode==HttpStatusCode.NotFound,"folder workspace isolation");
        using(var missing=Request(HttpMethod.Post,
            "/api/v2/files/company/upload?folderId=999999999",large,"orphan.pdf"))
        using(var response=await client.SendAsync(missing))
            Check(response.StatusCode==HttpStatusCode.NotFound,"orphan file rejected");

        long fileId;
        using(var request=Request(HttpMethod.Post,path,large,"原始图纸.pdf"))
        using(var response=await client.SendAsync(request))
        {
            response.EnsureSuccessStatusCode();
            var data=await response.Content.ReadFromJsonAsync<JsonElement>();
            fileId=data.GetProperty("fileId").GetInt64();
            Check(data.GetProperty("version").GetInt32()==1,"first version");
            Check(data.GetProperty("size").GetInt64()==large.Length,"multi-chunk size");
            Check(data.GetProperty("sha256").GetString()==originalDigest,"multi-chunk digest");
        }
        var url=$"/api/v2/files/company/{fileId}";
        var detail=await client.GetFromJsonAsync<JsonElement>(url);
        Check(detail.GetProperty("name").GetString()=="原始图纸.pdf","first metadata");
        Check(detail.GetProperty("description").ValueKind==JsonValueKind.Null &&
              detail.GetProperty("tags").ValueKind==JsonValueKind.Null &&
              detail.GetProperty("fileNumber").ValueKind==JsonValueKind.Null &&
              detail.GetProperty("fileDate").ValueKind==JsonValueKind.Null,
              "optional metadata omitted");
        Check(detail.GetProperty("versions").GetArrayLength()==1,"one version");
        Check(large.SequenceEqual(await Download(client,url+"/versions/1/download")),"v1 bytes");
        using(var other=await client.GetAsync($"/api/v2/files/personal/{fileId}"))
            Check(other.StatusCode==HttpStatusCode.NotFound,"read isolation");

        var meta=new NativeFileMetadataInput("界面别名.pdf","可检索的说明","图纸,测试",
            "DOC-00001","2026-10-15");
        using(var edited=await client.PutAsJsonAsync(url+"/metadata",meta))
            edited.EnsureSuccessStatusCode();
        detail=await client.GetFromJsonAsync<JsonElement>(url);
        Check(detail.GetProperty("name").GetString()=="界面别名.pdf" &&
              detail.GetProperty("description").GetString()=="可检索的说明" &&
              detail.GetProperty("fileNumber").GetString()=="DOC-00001" &&
              detail.GetProperty("versions").GetArrayLength()==1,"metadata without version");
        using(var invalid=await client.PutAsJsonAsync(url+"/metadata",
            meta with{FileDate="2026-99-99"}))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,"invalid date");

        var newVersion=new byte[]{0,1,2,3,4,5,6,7,8,9};
        using(var req=Request(HttpMethod.Post,url+"/versions",newVersion,"第二版本.pdf","内容修订"))
        using(var response=await client.SendAsync(req))
        {
            response.EnsureSuccessStatusCode();
            var info=await response.Content.ReadFromJsonAsync<JsonElement>();
            Check(info.GetProperty("fileId").GetInt64()==fileId &&
                  info.GetProperty("version").GetInt32()==2,"same FileId second version");
        }
        detail=await client.GetFromJsonAsync<JsonElement>(url);
        var versions=detail.GetProperty("versions");
        Check(versions.GetArrayLength()==2 &&
              versions[0].GetProperty("originalName").GetString()=="第二版本.pdf" &&
              versions[0].GetProperty("versionNote").GetString()=="内容修订" &&
              versions[1].GetProperty("originalName").GetString()=="原始图纸.pdf",
              "immutable original names and ordered history");
        Check(large.SequenceEqual(await Download(client,url+"/versions/1/download")),
            "v1 remains original after metadata edit and v2 upload");
        Check(newVersion.SequenceEqual(await Download(client,url+"/versions/2/download")),
            "v2 bytes roundtrip");
        using(var missingVersion=await client.GetAsync(url+"/versions/3/download"))
            Check(missingVersion.StatusCode==HttpStatusCode.NotFound,"nonexistent version");
        Console.WriteLine("N3-01 NATIVE FILE HTTP SMOKE PASS");
    }
}
