using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

static class NativeFileLinkHttpSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool success,string reason)
        {
            if(!success)throw new IOException("N3-02 FILE LINK HTTP: "+reason);
        }
        static async Task<long> Id(HttpResponseMessage response)
        {
            using(response)
            {
                response.EnsureSuccessStatusCode();
                return (await response.Content.ReadFromJsonAsync<JsonElement>())
                    .GetProperty("id").GetInt64();
            }
        }
        static async Task<JsonElement> Json(HttpClient http,string path)
        {
            using var response=await http.GetAsync(path);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
        static async Task<long> Project(HttpClient http,string name,string number,
            string workspace="company")
        {
            var p=new ProjectInput(name,"科研项目",number,
                null,null,null,null,null,null,null,null);
            return await Id(await http.PostAsJsonAsync(
                "/api/v2/folders/"+workspace+"/project",
                new FolderMutationInput(Project:p)));
        }
        static async Task<long> NewFile(HttpClient http,long folderId)
        {
            using var req=new HttpRequestMessage(HttpMethod.Post,
                $"/api/v2/files/company/upload?folderId={folderId}")
                {Content=new ByteArrayContent(new byte[]{1,2,3})};
            req.Headers.TryAddWithoutValidation("X-File-Name",
                Uri.EscapeDataString("共享原件.pdf"));
            using var response=await http.SendAsync(req);
            response.EnsureSuccessStatusCode();
            return (await response.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("fileId").GetInt64();
        }
        static async Task<int> UploadVersion(HttpClient http,long fileId,string name,byte[] data)
        {
            using var req=new HttpRequestMessage(HttpMethod.Post,
                $"/api/v2/files/company/{fileId}/versions")
                {Content=new ByteArrayContent(data)};
            req.Headers.TryAddWithoutValidation("X-File-Name",Uri.EscapeDataString(name));
            using var response=await http.SendAsync(req);
            response.EnsureSuccessStatusCode();
            return (await response.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("version").GetInt32();
        }
        string suffix=Guid.NewGuid().ToString("N")[..8];
        long a=await Project(client,"共享A"+suffix,"N3-A-"+suffix);
        long b=await Project(client,"共享B"+suffix,"N3-B-"+suffix);
        long personal=await Project(client,"私人"+suffix,"N3-P-"+suffix,"personal");
        long fileId=await NewFile(client,a);
        string filePath=$"/api/v2/files/company/{fileId}";
        string aPath=$"/api/v2/files/company/folders/{a}/links";
        string bPath=$"/api/v2/files/company/folders/{b}/links";
        var aList=await Json(client,aPath);
        Check(aList.GetArrayLength()==1,"initial folder association");
        long initialLink=aList[0].GetProperty("id").GetInt64();

        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await anonymous.PostAsJsonAsync(filePath+"/links",
            new NativeFileLinkInput(b)))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"unauthorized linking");
        using(var cross=await client.PostAsJsonAsync(
            $"/api/v2/files/personal/{fileId}/links",new NativeFileLinkInput(personal)))
            Check(cross.StatusCode==HttpStatusCode.NotFound,"cross-workspace sharing rejected");
        using(var invalid=await client.PostAsJsonAsync(filePath+"/links",
            new NativeFileLinkInput(999999999)))
            Check(invalid.StatusCode==HttpStatusCode.NotFound,"missing target denied");

        long sharedLink=await Id(await client.PostAsJsonAsync(filePath+"/links",
            new NativeFileLinkInput(b,"另一个显示名","其他材料")));
        using(var duplicate=await client.PostAsJsonAsync(filePath+"/links",
            new NativeFileLinkInput(b)))
            Check(duplicate.StatusCode==HttpStatusCode.Conflict,"duplicate active link rejected");
        var bList=await Json(client,bPath);
        Check(bList.GetArrayLength()==1 &&
              bList[0].GetProperty("id").GetInt64()==sharedLink &&
              bList[0].GetProperty("fileId").GetInt64()==fileId &&
              bList[0].GetProperty("displayName").GetString()=="另一个显示名" &&
              bList[0].GetProperty("materialCategory").GetString()=="其他材料",
            "secondary link owns placement-only attributes");
        Check((await Json(client,filePath+"/links")).GetArrayLength()==2,
            "one logical file two active folders");
        Check(await UploadVersion(client,fileId,"版本2.pdf",new byte[]{2,3,4})==2,
            "second version upload");
        aList=await Json(client,aPath);
        bList=await Json(client,bPath);
        Check(aList[0].GetProperty("latestVersion").GetInt32()==2 &&
              bList[0].GetProperty("latestVersion").GetInt32()==2,
            "shared FileId reflects latest version in both folders");
        using(var edited=await client.PutAsJsonAsync(filePath+"/metadata",
            new NativeFileMetadataInput("统一属性名称.pdf","统一备注","共享",null,null)))
            edited.EnsureSuccessStatusCode();
        Check((await Json(client,aPath))[0].GetProperty("fileName")
                   .GetString()=="统一属性名称.pdf" &&
              (await Json(client,bPath))[0].GetProperty("fileName")
                   .GetString()=="统一属性名称.pdf",
            "metadata is shared, link display alias remains local");
        using(var wrong=await client.DeleteAsync(
            $"/api/v2/files/company/{fileId}/links/{sharedLink+999999}"))
            Check(wrong.StatusCode==HttpStatusCode.NotFound,"unrelated link cannot be removed");

        using(var unlinked=await client.DeleteAsync(filePath+"/links/"+initialLink))
            unlinked.EnsureSuccessStatusCode();
        Check((await Json(client,aPath)).GetArrayLength()==0 &&
              (await Json(client,bPath)).GetArrayLength()==1,
            "unlink only removes one place");
        Check((await Json(client,filePath)).GetProperty("versions").GetArrayLength()==2,
            "other association preserves version history");
        Check(await UploadVersion(client,fileId,"版本3.pdf",new byte[]{5,6,7,8})==3,
            "version 3 while folder A unlinked");
        Check((await Json(client,aPath)).GetArrayLength()==0 &&
              (await Json(client,bPath))[0].GetProperty("latestVersion").GetInt32()==3,
            "v3 never silently revives unlinked folder");
        aList=await Json(client,aPath+"?includeDeleted=true");
        Check(aList.GetArrayLength()==1 &&
              aList[0].GetProperty("deleted").GetBoolean() &&
              aList[0].GetProperty("id").GetInt64()==initialLink,
            "recoverable link tombstone discoverable only on explicit query");

        using(var restored=await client.PostAsync(
            filePath+"/links/"+initialLink+"/restore",null))
            restored.EnsureSuccessStatusCode();
        Check((await Json(client,aPath))[0].GetProperty("latestVersion").GetInt32()==3,
            "explicit restore sees all latest versions");
        using(var redundantRestore=await client.PostAsync(
            filePath+"/links/"+initialLink+"/restore",null))
            Check(redundantRestore.StatusCode==HttpStatusCode.Conflict,
                "active link cannot be restored twice");

        using(var deleteB=await client.DeleteAsync(filePath+"/links/"+sharedLink))
            deleteB.EnsureSuccessStatusCode();
        using(var deleteA=await client.DeleteAsync(filePath+"/links/"+initialLink))
            deleteA.EnsureSuccessStatusCode();
        using(var inaccessible=await client.GetAsync(filePath))
            Check(inaccessible.StatusCode==HttpStatusCode.NotFound,
                "last unlink hides direct file access");
        using(var inaccessibleVersion=await client.GetAsync(filePath+"/versions/1/download"))
            Check(inaccessibleVersion.StatusCode==HttpStatusCode.NotFound,
                "last unlink hides original bytes");
        using(var cannotAttach=await client.PostAsJsonAsync(
            filePath+"/links",new NativeFileLinkInput(b)))
            Check(cannotAttach.StatusCode==HttpStatusCode.NotFound,
                "fully unlinked file needs deliberate restore, not implicit reattachment");
        Check((await Json(client,aPath+"?includeDeleted=true"))
                   [0].GetProperty("deleted").GetBoolean(),
            "last removed link remains in recoverable folder view");

        using(var restoredLast=await client.PostAsync(
            filePath+"/links/"+initialLink+"/restore",null))
            restoredLast.EnsureSuccessStatusCode();
        Check((await Json(client,filePath)).GetProperty("versions").GetArrayLength()==3,
            "restoring last link recovers preserved history");
        using(var wrongWorkspace=await client.GetAsync(
            $"/api/v2/files/personal/folders/{a}/links"))
            Check(wrongWorkspace.StatusCode==HttpStatusCode.NotFound,
                "foreign workspace folder list denied");

        // A deleted folder must not confer direct file access or accept a link.
        using(var softDelete=await client.DeleteAsync(
            $"/api/v2/folders/company/project/{b}"))
            softDelete.EnsureSuccessStatusCode();
        using(var deletedTarget=await client.PostAsJsonAsync(filePath+"/links",
            new NativeFileLinkInput(b)))
            Check(deletedTarget.StatusCode==HttpStatusCode.NotFound,
                "deleted destination rejected");
        using(var deletedList=await client.GetAsync(bPath+"?includeDeleted=true"))
            Check(deletedList.StatusCode==HttpStatusCode.NotFound,
                "deleted folder cannot expose tombstones");
        Console.WriteLine("N3-02 SHARED FILE LINK HTTP SMOKE PASS");
    }
}
