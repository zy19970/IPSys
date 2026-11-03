using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// Fresh SQLCipher database: one ordinary folder type, explicit workspace and section.
static class NativeArchiveHttpSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool ok,string message)
        {
            if(!ok)throw new IOException("FOLDER HTTP SMOKE: "+message);
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
        static async Task<JsonElement> Read(HttpClient c,string path)
        {
            using var response=await c.GetAsync(path);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
        const string company="/api/v2/folders/company/archive_folder";
        string mark=Guid.NewGuid().ToString("N")[..8];
        var roots=await Read(client,company+"?section=achievement");
        Check(roots.GetArrayLength()>=7,"seven initial folders in business archives");
        long starter=roots.EnumerateArray().First(x=>x.GetProperty("folder")
            .GetProperty("name").GetString()=="申报与认定")
            .GetProperty("folder").GetProperty("ref").GetProperty("id").GetInt64();

        using(var noAuth=new HttpClient{BaseAddress=client.BaseAddress})
        using(var res=await noAuth.PostAsJsonAsync(company,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("无授权",null),Section:"achievement")))
            Check(res.StatusCode==HttpStatusCode.Unauthorized,"token required");

        using(var missing=await client.PostAsJsonAsync(company,
            new FolderMutationInput(ArchiveFolder:new ArchiveFolderInput("缺少模块",null))))
            Check(missing.StatusCode==HttpStatusCode.BadRequest,"section must be explicit");
        using(var old=await client.PostAsJsonAsync("/api/v2/folders/company/archive",
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("旧类型",null),Section:"achievement")))
            Check(old.StatusCode==HttpStatusCode.BadRequest,"retired archive kind rejected");
        using(var old=await client.PostAsJsonAsync("/api/v2/folders/company/general",
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("旧类型",null),Section:"general")))
            Check(old.StatusCode==HttpStatusCode.BadRequest,"retired general kind rejected");
        using(var academic=await client.PostAsJsonAsync(company,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("公司无学术模块",null),Section:"academic")))
            Check(academic.StatusCode==HttpStatusCode.BadRequest,"workspace section scope");

        long root=await Add(await client.PostAsJsonAsync(company,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("根资料"+mark,null),Section:"achievement")));
        long child=await Add(await client.PostAsJsonAsync(company,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("子目录"+mark,root,"文档","2026","标签","备注"),Section:"achievement")));
        long sibling=await Add(await client.PostAsJsonAsync(company,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("同层目录"+mark,root),Section:"achievement")));
        var listed=await Read(client,company+"?section=achievement&parentId="+root);
        Check(listed.EnumerateArray().Count()==2,"nested folder siblings");
        using(var order=await client.PostAsJsonAsync(
            "/api/v2/folders/company/entries/reorder?section=achievement",
            new ArchiveEntryReorder(root,[
                new ArchiveEntryOrderItem("folder",sibling),
                new ArchiveEntryOrderItem("folder",child)])))
            order.EnsureSuccessStatusCode();
        var sorted=await Read(client,company+"?section=achievement&parentId="+root);
        Check(sorted[0].GetProperty("folder").GetProperty("ref").GetProperty("id")
            .GetInt64()==sibling,"same-folder ordering");
        using(var oldOrder=await client.PostAsJsonAsync(
            "/api/v2/folders/company/entries/reorder?section=achievement",
            new ArchiveEntryReorder(root,[
                new ArchiveEntryOrderItem("record",sibling),
                new ArchiveEntryOrderItem("folder",child)])))
            Check(oldOrder.StatusCode==HttpStatusCode.BadRequest,"retired record marker rejected");

        using(var invalidMove=await client.PostAsJsonAsync(
            company+"/"+root+"/move?section=achievement",new NativeFolderMoveInput(child)))
            Check(invalidMove.StatusCode==HttpStatusCode.Conflict,"directory cycle rejected");
        using(var move=await client.PostAsJsonAsync(
            company+"/"+child+"/move?section=achievement",new NativeFolderMoveInput(null)))
            move.EnsureSuccessStatusCode();
        var toRoot=await Read(client,company+"/"+child+"?section=achievement");
        Check(toRoot.GetProperty("folder").GetProperty("parent").ValueKind==
            JsonValueKind.Null,"ordinary folder can move to module root");
        using(var move=await client.PostAsJsonAsync(
            company+"/"+child+"/move?section=achievement",new NativeFolderMoveInput(root)))
            move.EnsureSuccessStatusCode();
        using(var patch=await client.PutAsJsonAsync(company+"/"+child+"?section=achievement",
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("已更新"+mark,null,Remarks:"新备注"))))
            patch.EnsureSuccessStatusCode();
        var changed=await Read(client,company+"/"+child+"?section=achievement");
        Check(changed.GetProperty("businessData").GetProperty("parentId").GetInt64()==root &&
            changed.GetProperty("businessData").GetProperty("year").GetString()=="2026" &&
            changed.GetProperty("businessData").GetProperty("remarks").GetString()=="新备注",
            "partial edit retains parent and optional year");

        foreach(var (workspace,section) in new[]{
            ("company","certificate"),("company","party"),("company","general"),
            ("personal","certificate"),("personal","achievement"),("personal","academic"),
            ("personal","general")})
        {
            var path="/api/v2/folders/"+workspace+"/archive_folder";
            long id=await Add(await client.PostAsJsonAsync(path,
                new FolderMutationInput(ArchiveFolder:
                    new ArchiveFolderInput("模块资料"+mark,null),Section:section)));
            var item=await Read(client,path+"/"+id+"?section="+section);
            Check(item.GetProperty("folder").GetProperty("ref").GetProperty("kind")
                .GetString()=="archive_folder",workspace+"/"+section+" canonical kind");
            using var wrong=await client.GetAsync(path+"/"+id+"?section="+
                (section=="general"?"certificate":"general"));
            Check(wrong.StatusCode==HttpStatusCode.NotFound,"cross-section isolation");
        }
        using(var deleted=await client.DeleteAsync(company+"/"+root+"?section=achievement"))
            deleted.EnsureSuccessStatusCode();
        var trash=await Read(client,"/api/trash/company");
        Check(trash.EnumerateArray().Any(x=>x.GetProperty("kind").GetString()==
            "v2_archive_folder" && x.GetProperty("id").GetInt64()==root),
            "single canonical folder recycle kind");
        using(var restored=await client.PostAsJsonAsync("/api/trash/company/restore",
            new RecycleRequest([new RecycleKey("v2_archive_folder",root,"achievement")])))
            restored.EnsureSuccessStatusCode();
        var recovered=await Read(client,company+"/"+child+"?section=achievement");
        Check(recovered.GetProperty("folder").GetProperty("parent").GetProperty("id")
            .GetInt64()==root,"recursive folder restored");
        using(var rename=await client.PutAsJsonAsync(company+"/"+starter+"?section=achievement",
            new FolderMutationInput(ArchiveFolder:new ArchiveFolderInput("测试改名"+mark,null))))
            rename.EnsureSuccessStatusCode();
        using(var revert=await client.PutAsJsonAsync(company+"/"+starter+"?section=achievement",
            new FolderMutationInput(ArchiveFolder:new ArchiveFolderInput("申报与认定",null))))
            revert.EnsureSuccessStatusCode();
        Console.WriteLine("FOLDER HTTP SMOKE PASS: unified kind, sections, root, CRUD, order, recycle");
    }
}
