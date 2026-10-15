using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// R1-04-02-02: common archive commands and legacy module endpoints act on the same
// disposable SQLCipher database, without granting false folder restore semantics.
static class FolderArchiveCommandSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool ok, string reason)
        {
            if (!ok) throw new IOException("Archive folder command smoke failed: " + reason);
        }
        static async Task<long> Create(HttpResponseMessage response)
        {
            using (response)
            {
                response.EnsureSuccessStatusCode();
                var json = await response.Content.ReadFromJsonAsync<JsonElement>();
                return json.GetProperty("id").GetInt64();
            }
        }
        var unique = Guid.NewGuid().ToString("N")[..8];
        const string archive = "/api/folders/company/archive";
        const string directory = "/api/folders/company/archive_folder";
        var roots = await client.GetFromJsonAsync<List<ArchiveFolderView>>("/api/archive-folders");
        var protectedRoot = roots!.First(x => x.Name == "申报与认定" && x.ParentId is null);

        using (var denied = await new HttpClient { BaseAddress=client.BaseAddress }
            .PostAsJsonAsync(directory, new FolderMutationInput(
                ArchiveFolder: new ArchiveFolderInput("未授权", protectedRoot.Id),
                Section: "achievement")))
            Check(denied.StatusCode == HttpStatusCode.Unauthorized, "no-session create denied");
        using (var wrongSpace = await client.PostAsJsonAsync(
            "/api/folders/personal/archive_folder",
            new FolderMutationInput(ArchiveFolder: new ArchiveFolderInput("错误工作区", null),
                Section: "achievement")))
            Check(wrongSpace.StatusCode == HttpStatusCode.BadRequest, "directory is company only");
        using (var wrongSection = await client.PostAsJsonAsync(archive,
            new FolderMutationInput(Archive: new ArchiveInput("无效归档", null, null, null),
                Section: "academic")))
            Check(wrongSection.StatusCode == HttpStatusCode.BadRequest,
                "company cannot create academic archive");

        long folder = await Create(await client.PostAsJsonAsync(directory,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("公共档案-"+unique, protectedRoot.Id),
                Section: "achievement")));
        long emptyChild = await Create(await client.PostAsJsonAsync(directory,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("可删除空目录-"+unique, folder),
                Section: "achievement")));
        long nonEmptyChild = await Create(await client.PostAsJsonAsync(directory,
            new FolderMutationInput(ArchiveFolder:
                new ArchiveFolderInput("含资料目录-"+unique, folder),
                Section: "achievement")));
        var archiveInput = new ArchiveInput("公共资料-"+unique, null, "原备注", "标签",
            Year:"2026", FolderId:nonEmptyChild);
        long record = await Create(await client.PostAsJsonAsync(archive,
            new FolderMutationInput(Archive:archiveInput,Section:"achievement")));
        using (var legacy = await client.GetAsync("/api/archives/company/achievement"))
        {
            legacy.EnsureSuccessStatusCode();
            var rows = await legacy.Content.ReadFromJsonAsync<List<ArchiveView>>();
            Check(rows!.Any(x=>x.Id==record && x.FolderId==nonEmptyChild),
                "new archive visible through old API");
        }
        using (var invalidParent = await client.PutAsJsonAsync(
            $"{directory}/{nonEmptyChild}", new FolderMutationInput(
                ArchiveFolder:new ArchiveFolderInput("改变父级",protectedRoot.Id))))
            Check(invalidParent.StatusCode==HttpStatusCode.BadRequest,
                "folder edit cannot silently move its parent");
        using (var invalidRecordMove = await client.PutAsJsonAsync(
            $"{archive}/{record}?section=achievement",
            new FolderMutationInput(Archive: archiveInput with { FolderId=folder })))
            Check(invalidRecordMove.StatusCode==HttpStatusCode.BadRequest,
                "archive edit cannot silently move its directory");
        using (var updateFolder = await client.PutAsJsonAsync(
            $"{directory}/{nonEmptyChild}", new FolderMutationInput(
                ArchiveFolder:new ArchiveFolderInput("含资料目录修改-"+unique,folder))))
            updateFolder.EnsureSuccessStatusCode();
        using (var updateRecord = await client.PutAsJsonAsync(
            $"{archive}/{record}?section=achievement",
            new FolderMutationInput(Archive:archiveInput with { Remarks="更新备注" })))
            updateRecord.EnsureSuccessStatusCode();
        using (var details = await client.GetAsync(
            $"/api/folders/company/detail/archive/{record}?section=achievement"))
        {
            details.EnsureSuccessStatusCode();
            var item = await details.Content.ReadFromJsonAsync<JsonElement>();
            Check(item.GetProperty("businessData").GetProperty("remarks").GetString()=="更新备注",
                "archive business fields retained after common edit");
        }
        using (var rootBlocked = await client.DeleteAsync(
            $"{directory}/{protectedRoot.Id}"))
            Check(rootBlocked.StatusCode==HttpStatusCode.Conflict,
                "system root cannot be deleted");
        using (var fullBlocked = await client.DeleteAsync(
            $"{directory}/{nonEmptyChild}"))
            Check(fullBlocked.StatusCode==HttpStatusCode.Conflict,
                "nonempty folder cannot be deleted");
        using (var deleted = await client.DeleteAsync(
            $"{archive}/{record}?section=achievement"))
            deleted.EnsureSuccessStatusCode();
        using (var hidden = await client.GetAsync(
            $"/api/folders/company/detail/archive/{record}?section=achievement"))
            Check(hidden.StatusCode==HttpStatusCode.NotFound,
                "soft deleted archive is hidden");
        using (var restored = await client.PostAsync(
            $"{archive}/{record}/restore?section=achievement",null))
            restored.EnsureSuccessStatusCode();
        using (var repeated = await client.PostAsync(
            $"{archive}/{record}/restore?section=achievement",null))
            Check(repeated.StatusCode==HttpStatusCode.NotFound,
                "only deleted records can be restored");
        using (var invalidSection = await client.DeleteAsync(
            $"{archive}/{record}?section=certificate"))
            Check(invalidSection.StatusCode==HttpStatusCode.NotFound,
                "other archive section cannot delete this record");
        using (var otherWorkspace = await client.DeleteAsync(
            $"/api/folders/personal/archive/{record}?section=achievement"))
            Check(otherWorkspace.StatusCode==HttpStatusCode.NotFound,
                "other workspace cannot delete this archive record");

        long cert = await Create(await client.PostAsJsonAsync(archive,
            new FolderMutationInput(Archive:
                new ArchiveInput("企业资质-"+unique, null, "资质备注", null),
                Section:"certificate")));
        using (var personalCert = await client.PutAsJsonAsync(
            $"/api/folders/personal/archive/{cert}?section=certificate",
            new FolderMutationInput(Archive:
                new ArchiveInput("外部资料",null,null,null))))
            Check(personalCert.StatusCode==HttpStatusCode.NotFound,
                "personal certificate cannot modify company certificate");
        long personalAcademic = await Create(await client.PostAsJsonAsync(
            "/api/folders/personal/archive",
            new FolderMutationInput(Archive:
                new ArchiveInput("学术兼职-"+unique,null,null,null),
                Section:"academic")));
        using (var wrong = await client.PostAsync(
            $"/api/folders/company/archive/{personalAcademic}/restore?section=academic",null))
            Check(wrong.StatusCode==HttpStatusCode.BadRequest,
                "incompatible archive scope denied");

        using (var emptyDeleted = await client.DeleteAsync($"{directory}/{emptyChild}"))
            emptyDeleted.EnsureSuccessStatusCode();
        using (var noDirectoryRestore = await client.PostAsync(
            $"{directory}/{emptyChild}/restore", null))
            Check(noDirectoryRestore.StatusCode==HttpStatusCode.BadRequest,
                "hard-deleted empty directory has no recycle-bin restoration");
        using (var noDirectoryDetails = await client.GetAsync(
            $"/api/folders/company/detail/archive_folder/{emptyChild}"))
            Check(noDirectoryDetails.StatusCode==HttpStatusCode.NotFound,
                "hard deleted directory is not navigable");
        Console.WriteLine("FOLDER ARCHIVE CRUD SMOKE PASS: protected roots, scoped archives, restore");
    }
}
