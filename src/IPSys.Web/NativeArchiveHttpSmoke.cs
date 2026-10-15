using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

static class NativeArchiveHttpSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool ok,string message)
        {
            if(!ok)throw new IOException("N2 archive SQLCipher HTTP: "+message);
        }
        static async Task<long> Add(HttpResponseMessage response)
        {
            using(response)
            {
                response.EnsureSuccessStatusCode();
                return (await response.Content.ReadFromJsonAsync<JsonElement>())
                    .GetProperty("id").GetInt64();
            }
        }
        static async Task<JsonElement> Read(HttpClient c,string url)
        {
            using var response=await c.GetAsync(url);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
        string suffix=Guid.NewGuid().ToString("N")[..8];
        const string root="/api/v2/folders/company/";
        string dirs=root+"archive_folder";
        string archive=root+"archive";
        var roots=await Read(client,dirs);
        Check(roots.EnumerateArray().Count()>=7,"seven root categories");
        long systemRoot=roots.EnumerateArray().First(x=>x.GetProperty("folder")
            .GetProperty("name").GetString()=="申报与认定")
            .GetProperty("folder").GetProperty("ref").GetProperty("id").GetInt64();

        using(var noAuth=new HttpClient{BaseAddress=client.BaseAddress})
        using(var response=await noAuth.PostAsJsonAsync(dirs,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("未授权目录",systemRoot))))
            Check(response.StatusCode==HttpStatusCode.Unauthorized,"token required");

        long a=await Add(await client.PostAsJsonAsync(dirs,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("归档分类"+suffix,systemRoot))));
        long b=await Add(await client.PostAsJsonAsync(dirs,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("下级目录"+suffix,a))));
        long empty=await Add(await client.PostAsJsonAsync(dirs,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("空目录"+suffix,a))));
        var info=new ArchiveInput("归档资料"+suffix,"", "备注","标签",
            Year:"2026",FolderId:a);
        long doc=await Add(await client.PostAsJsonAsync(archive,
            new FolderMutationInput(Archive:info,Section:"achievement")));
        var initial=await Read(client,root+$"entries?section=achievement&parentId={a}");
        Check(initial.GetArrayLength()==3,"folder and archive mixed peers");
        using(var reordered=await client.PostAsJsonAsync(
            root+$"entries/reorder?section=achievement",
            new ArchiveEntryReorder(a,[
                new ArchiveEntryOrderItem("record",doc),
                new ArchiveEntryOrderItem("folder",empty),
                new ArchiveEntryOrderItem("folder",b)])))
            reordered.EnsureSuccessStatusCode();
        var ordered=await Read(client,root+$"entries?section=achievement&parentId={a}");
        Check(ordered[0].GetProperty("folder").GetProperty("ref").GetProperty("id")
                .GetInt64()==doc &&
              ordered[0].GetProperty("folder").GetProperty("position").GetInt32()==0 &&
              ordered[1].GetProperty("folder").GetProperty("ref").GetProperty("id")
                .GetInt64()==empty,
            "mixed persist order not folders-first");
        using(var stale=await client.PostAsJsonAsync(
            root+"entries/reorder?section=achievement",
            new ArchiveEntryReorder(a,[
                new ArchiveEntryOrderItem("folder",b)])))
            Check(stale.StatusCode==HttpStatusCode.Conflict,"exact reorder permutation");

        using(var forbidden=await client.DeleteAsync(dirs+"/"+systemRoot))
            Check(forbidden.StatusCode==HttpStatusCode.Conflict,"system root protected");
        using(var forbidden=await client.DeleteAsync(dirs+"/"+a))
            Check(forbidden.StatusCode==HttpStatusCode.Conflict,"nonempty directory protected");
        using(var cycle=await client.PostAsJsonAsync(dirs+$"/{a}/move",
            new NativeFolderMoveInput(b)))
            Check(cycle.StatusCode==HttpStatusCode.Conflict,"directory cycle rejected");
        using(var rename=await client.PutAsJsonAsync(dirs+"/"+b,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("已改名目录"+suffix,a))))
            rename.EnsureSuccessStatusCode();
        using(var invalid=await client.PutAsJsonAsync(
            archive+$"/{doc}?section=achievement",
            new FolderMutationInput(Archive:info with {FolderId=b})))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                "archive edit cannot silently move parent");

        using(var rootRejected=await client.PostAsJsonAsync(
            archive+$"/{doc}/move?section=achievement",new NativeFolderMoveInput(null)))
            Check(rootRejected.StatusCode==HttpStatusCode.BadRequest,
                "company archive cannot be moved outside all categories");
        using(var move=await client.PostAsJsonAsync(
            archive+$"/{doc}/move?section=achievement",new NativeFolderMoveInput(b)))
            move.EnsureSuccessStatusCode();
        var moved=await Read(client,archive+$"/{doc}?section=achievement");
        Check(moved.GetProperty("folder").GetProperty("parent").GetProperty("id")
                .GetInt64()==b &&
              moved.GetProperty("businessData").GetProperty("folderId").GetInt64()==b,
            "move updates relationship and business payload");
        using(var restoreMove=await client.PostAsJsonAsync(
            archive+$"/{doc}/move?section=achievement",new NativeFolderMoveInput(a)))
            restoreMove.EnsureSuccessStatusCode();
        using(var rename=await client.PutAsJsonAsync(
            archive+$"/{doc}?section=achievement",
            new FolderMutationInput(Archive:info with {
                Remarks="新备注",FolderId=null,Year=null})))
            rename.EnsureSuccessStatusCode();
        var updated=await Read(client,archive+$"/{doc}?section=achievement");
        Check(updated.GetProperty("businessData").GetProperty("remarks")
                .GetString()=="新备注" &&
              updated.GetProperty("businessData").GetProperty("folderId")
                .GetInt64()==a &&
              updated.GetProperty("businessData").GetProperty("year")
                .GetString()=="2026","edit preserves optional parent and year");

        using(var remove=await client.DeleteAsync(
            archive+$"/{doc}?section=achievement"))
            remove.EnsureSuccessStatusCode();
        using(var invisible=await client.GetAsync(
            archive+$"/{doc}?section=achievement"))
            Check(invisible.StatusCode==HttpStatusCode.NotFound,"soft delete record");
        using(var recover=await client.PostAsync(
            archive+$"/{doc}/restore?section=achievement",null))
            recover.EnsureSuccessStatusCode();
        using(var remove=await client.DeleteAsync(dirs+"/"+empty))
            remove.EnsureSuccessStatusCode();
        using(var noRestore=await client.PostAsync(dirs+$"/{empty}/restore",null))
            Check(noRestore.StatusCode==HttpStatusCode.BadRequest,
                "empty directory deletion is permanent");
        using(var duplicate=await client.PostAsJsonAsync(dirs,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("已改名目录"+suffix,a))))
            Check(duplicate.StatusCode==HttpStatusCode.Conflict,"sibling unique names");

        long certificate=await Add(await client.PostAsJsonAsync(archive,
            new FolderMutationInput(Archive:new ArchiveInput(
                "资质文件"+suffix,null,null,null),Section:"certificate")));
        var cert=await Read(client,archive+$"/{certificate}?section=certificate");
        Check(cert.GetProperty("folder").GetProperty("parent").ValueKind==
            JsonValueKind.Null,"certificate directly under virtual root");
        using(var wrong=await client.GetAsync(
            archive+$"/{certificate}?section=achievement"))
            Check(wrong.StatusCode==HttpStatusCode.NotFound,"section isolation");
        using(var invalid=await client.PostAsJsonAsync(archive,
            new FolderMutationInput(Archive:new ArchiveInput(
                "公司学术",null,null,null),Section:"academic")))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                "unsupported workspace section rejected");

        long academic=await Add(await client.PostAsJsonAsync(
            "/api/v2/folders/personal/archive",
            new FolderMutationInput(Archive:new ArchiveInput(
                "学术兼职"+suffix,null,null,null),Section:"academic")));
        var personal=await Read(client,
            $"/api/v2/folders/personal/archive/{academic}?section=academic");
        Check(personal.GetProperty("folder").GetProperty("ref")
            .GetProperty("workspace").GetString()=="personal",
            "personal academic workspace");
        long general=await Add(await client.PostAsJsonAsync(
            "/api/v2/folders/personal/general",
            new FolderMutationInput(General:new TitleInput("原生综合资料"+suffix))));
        using(var changed=await client.PutAsJsonAsync(
            $"/api/v2/folders/personal/general/{general}",
            new FolderMutationInput(General:new TitleInput("综合资料修改"+suffix))))
            changed.EnsureSuccessStatusCode();
        using(var erased=await client.DeleteAsync(
            $"/api/v2/folders/personal/general/{general}"))
            erased.EnsureSuccessStatusCode();
        using(var restored=await client.PostAsync(
            $"/api/v2/folders/personal/general/{general}/restore",null))
            restored.EnsureSuccessStatusCode();
        using(var cross=await client.GetAsync(
            $"/api/v2/folders/company/general/{general}"))
            Check(cross.StatusCode==HttpStatusCode.NotFound,"general workspace isolation");
        var legacy=await client.GetFromJsonAsync<List<ArchiveView>>(
            "/api/archives/company/achievement");
        Check(!legacy!.Any(x=>x.Name=="归档资料"+suffix),"new archive never double-writes legacy table");
        Console.WriteLine("N2 ARCHIVE SQLCIPHER HTTP SMOKE PASS");
    }
}
