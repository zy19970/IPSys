using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// Real HTTP + encrypted disposable database: nested folders, shared FileIds,
// complete versions, independent destination objects and source recycle state.
static class NativeFolderTreeTransferSmoke
{
    private static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("FOLDER TREE TRANSFER: "+reason);
    }
    private static async Task<JsonElement> Read(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    private static async Task<long> Folder(HttpClient client,string workspace,
        string section,string name,long? parent=null)
    {
        var r=await Read(await client.PostAsJsonAsync(
            $"/api/v2/folders/{workspace}/archive_folder",
            new{section,archiveFolder=new{name,parentId=parent,
                category="类别",tags="标记",remarks="目录备注"}}));
        return r.GetProperty("id").GetInt64();
    }
    private static async Task<JsonElement> Flat(HttpClient client,
        string workspace,string section)=>await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/folders/{workspace}/archive_folder?section={section}&flat=true");
    private static JsonElement Named(JsonElement rows,string name)=>
        rows.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("name").GetString()==name);
    private static long Id(JsonElement item)=>
        item.GetProperty("folder").GetProperty("ref").GetProperty("id").GetInt64();
    private static async Task<JsonElement> Links(HttpClient client,
        string workspace,long folder)=>
        await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/{workspace}/folders/{folder}/links");

    // A batch shares FileId history without copying bytes; moving retains
    // original FolderIds. All roots are included in one SQLCipher transaction.
    private static async Task VerifyFolderBatchAsync(HttpClient client,Vault vault)
    {
        string mark="FOLDER-BATCH-"+Guid.NewGuid().ToString("N")[..8];
        long a=await Folder(client,"company","certificate",mark+"甲");
        long child=await Folder(client,"company","certificate",mark+"子",a);
        long b=await Folder(client,"company","certificate",mark+"乙");
        long target=await Folder(client,"company","certificate",mark+"目标");
        long rollbackTarget=await Folder(client,"company","certificate",mark+"回滚");
        byte[] first=[2,4,6],second=[9,7,5];
        long file;
        using(var req=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={child}")
            {Content=new ByteArrayContent(first)})
        {
            req.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+".pdf"));
            file=(await Read(await client.SendAsync(req)))
                .GetProperty("fileId").GetInt64();
        }
        using(var req=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(second)})
        {
            req.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+"-v2.pdf"));
            await Read(await client.SendAsync(req));
        }
        const string endpoint="/api/v2/ui/folders/company/certificate/transfer-batch";
        var copied=await Read(await client.PostAsJsonAsync(endpoint,new{
            targetFolderId=target,move=false,items=new[]{a,b}}));
        var cloneIds=copied.GetProperty("ids").EnumerateArray()
            .Select(x=>x.GetInt64()).ToArray();
        Check(cloneIds.Length==2 &&
              copied.GetProperty("folders").GetInt32()==3 &&
              copied.GetProperty("links").GetInt32()==1,
            "batch clone includes both roots, nested child and file");
        var flat=await Flat(client,"company","certificate");
        long childClone=Id(flat.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("parent").ValueKind!=JsonValueKind.Null &&
            x.GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==cloneIds[0] &&
            x.GetProperty("folder").GetProperty("name").GetString()==mark+"子"));
        Check((await Links(client,"company",childClone))[0]
                .GetProperty("fileId").GetInt64()==file &&
              (await Links(client,"company",child))[0]
                .GetProperty("fileId").GetInt64()==file,
            "shared folders preserve the same live file identity");
        for(int v=1;v<=2;v++)
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/{v}/download"))
                .SequenceEqual(v==1?first:second),"all versions remain readable");

        // A database failure on the second selected root must roll back
        // the first root and all its descendant attachment links.
        using(var trigger=vault.Db.CreateCommand())
        {
            trigger.CommandText=$"""
                CREATE TEMP TRIGGER fail_folder_batch BEFORE INSERT ON folders
                WHEN NEW.workspace='company' AND NEW.section='certificate'
                     AND NEW.parent_id={rollbackTarget} AND NEW.name='{mark}乙'
                BEGIN SELECT RAISE(ABORT,'rollback batch'); END;
                """;
            trigger.ExecuteNonQuery();
        }
        try
        {
            using var fail=await client.PostAsJsonAsync(endpoint,new{
                targetFolderId=rollbackTarget,move=false,items=new[]{a,b}});
            Check(fail.StatusCode==HttpStatusCode.Conflict,
                "second root insertion rejects whole shared batch");
            flat=await Flat(client,"company","certificate");
            Check(!flat.EnumerateArray().Any(x=>
                  x.GetProperty("folder").GetProperty("parent").ValueKind!=JsonValueKind.Null &&
                  x.GetProperty("folder").GetProperty("parent")
                    .GetProperty("id").GetInt64()==rollbackTarget),
                "rollback leaves no cloned root in target");
        }
        finally
        {
            using var drop=vault.Db.CreateCommand();
            drop.CommandText="DROP TRIGGER IF EXISTS fail_folder_batch;";
            drop.ExecuteNonQuery();
        }
        using(var cyclic=await client.PostAsJsonAsync(endpoint,new{
            targetFolderId=child,move=true,items=new[]{a}}))
            Check(cyclic.StatusCode==HttpStatusCode.BadRequest,
                "move into own child must be rejected");
        using(var overlap=await client.PostAsJsonAsync(endpoint,new{
            targetFolderId=target,move=false,items=new[]{a,child}}))
            Check(overlap.StatusCode==HttpStatusCode.BadRequest,
                "parent and child double-selection must be rejected");
        // Existing shared clones have the same names, so moving originals
        // into that target must be refused without modifying either source.
        using(var collision=await client.PostAsJsonAsync(endpoint,new{
            targetFolderId=target,move=true,items=new[]{a,b}}))
            Check(collision.StatusCode==HttpStatusCode.Conflict,
                "moving into a folder already containing same-name clones must fail");
        var afterConflict=await Flat(client,"company","certificate");
        Check(new[]{a,b}.All(id=>afterConflict.EnumerateArray().Single(x=>Id(x)==id)
                .GetProperty("folder").GetProperty("parent").ValueKind==JsonValueKind.Null),
            "name conflict must preserve both original folder locations");
        long moveTarget=await Folder(client,"company","certificate",mark+"移动位置");
        var moved=await Read(await client.PostAsJsonAsync(endpoint,new{
            targetFolderId=moveTarget,move=true,items=new[]{a,b}}));
        Check(moved.GetProperty("ids").EnumerateArray()
            .Select(x=>x.GetInt64()).SequenceEqual(new[]{a,b}),
            "move preserves stable original FolderIds");
        flat=await Flat(client,"company","certificate");
        foreach(long id in new[]{a,b})
            Check(flat.EnumerateArray().Single(x=>Id(x)==id)
                .GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==moveTarget,
                "each original folder moved under target");
        Check(flat.EnumerateArray().Single(x=>Id(x)==child)
                .GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==a &&
              (await Links(client,"company",child))[0]
                .GetProperty("fileId").GetInt64()==file,
            "moving preserves descendant and original attachment identity");
    }

    // Cross-module relocation keeps folder/attachment identity and history;
    // the section change, descendant updates and parent change are atomic.
    private static async Task VerifyCrossSectionFolderMoveAsync(HttpClient client,Vault vault)
    {
        string mark="CROSS-"+Guid.NewGuid().ToString("N")[..8];
        long first=await Folder(client,"company","certificate",mark+"甲");
        long child=await Folder(client,"company","certificate",mark+"子",first);
        long second=await Folder(client,"company","certificate",mark+"乙");
        long target=await Folder(client,"company","achievement",mark+"目标");
        long shareTarget=await Folder(client,"company","general",mark+"共享目标");
        byte[] version1=[3,2,1],version2=[8,7,6];
        long file;
        using(var req=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={child}")
            {Content=new ByteArrayContent(version1)})
        {
            req.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+".pdf"));
            file=(await Read(await client.SendAsync(req))).GetProperty("fileId").GetInt64();
        }
        using(var req=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(version2)})
        {
            req.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+"-v2.pdf"));
            await Read(await client.SendAsync(req));
        }
        var oldLink=(await Links(client,"company",child))[0].GetProperty("id").GetInt64();
        const string endpoint="/api/v2/ui/folders/company/certificate/transfer-batch";

        using(var wrong=await client.PostAsJsonAsync(endpoint,new {
            targetFolderId=target,targetSection="project",move=true,items=new[]{first}}))
            Check(wrong.StatusCode==HttpStatusCode.NotFound,
                "destination section must match the real target");
        using(var wrong=await client.PostAsJsonAsync(endpoint,new {
            targetFolderId=target,targetSection="certificate",move=true,items=new[]{first}}))
            Check(wrong.StatusCode==HttpStatusCode.NotFound,
                "destination's module must match its actual database section");

        // Induce failure during the second root after first root + child move.
        using(var trigger=vault.Db.CreateCommand())
        {
            trigger.CommandText=$"""
                CREATE TEMP TRIGGER fail_cross_move BEFORE UPDATE OF section ON folders
                WHEN OLD.name='{mark}乙' AND NEW.section='achievement'
                BEGIN SELECT RAISE(ABORT,'cross move rollback'); END;
                """;
            trigger.ExecuteNonQuery();
        }
        try
        {
            using var failed=await client.PostAsJsonAsync(endpoint,new {
                targetFolderId=target,targetSection="achievement",
                move=true,items=new[]{first,second}});
            Check(failed.StatusCode==HttpStatusCode.Conflict,
                "cross-module second-root failure must abort entire transaction");
            var stillSource=await Flat(client,"company","certificate");
            Check(new[]{first,child,second}.All(id=>
                stillSource.EnumerateArray().Any(x=>Id(x)==id)),
                "rollback restores the complete original source subtree");
            var notMoved=await Flat(client,"company","achievement");
            Check(!notMoved.EnumerateArray().Any(x=>
                new[]{first,child,second}.Contains(Id(x))),
                "rollback creates no orphan destination record");
        }
        finally
        {
            using var drop=vault.Db.CreateCommand();
            drop.CommandText="DROP TRIGGER IF EXISTS fail_cross_move;";
            drop.ExecuteNonQuery();
        }

        var moved=await Read(await client.PostAsJsonAsync(endpoint,new {
            targetFolderId=target,targetSection="achievement",
            move=true,items=new[]{first,second}}));
        Check(moved.GetProperty("ids").EnumerateArray().Select(x=>x.GetInt64())
              .SequenceEqual(new[]{first,second}) &&
              moved.GetProperty("targetSection").GetString()=="achievement",
            "cross-section move preserves both original FolderIds");
        var inTarget=await Flat(client,"company","achievement");
        Check(new[]{first,child,second}.All(id=>
            inTarget.EnumerateArray().Any(x=>Id(x)==id)),
            "every folder in the subtree now belongs to destination module");
        Check(inTarget.EnumerateArray().Single(x=>Id(x)==first)
            .GetProperty("folder").GetProperty("parent")
            .GetProperty("id").GetInt64()==target &&
          inTarget.EnumerateArray().Single(x=>Id(x)==child)
            .GetProperty("folder").GetProperty("parent")
            .GetProperty("id").GetInt64()==first,
            "root parent changed while nested parent relationships stay intact");
        var noSource=await Flat(client,"company","certificate");
        Check(!noSource.EnumerateArray().Any(x=>
            new[]{first,child,second}.Contains(Id(x))),
            "moved folder tree no longer appears in original module");
        var links=await Links(client,"company",child);
        Check(links[0].GetProperty("id").GetInt64()==oldLink &&
              links[0].GetProperty("fileId").GetInt64()==file,
            "cross-module move must not recreate FileId or LinkId");
        for(int v=1;v<=2;v++)
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/{v}/download"))
                  .SequenceEqual(v==1?version1:version2),
                "cross-module moved attachment retains original history bytes");

        // Cross-module sharing uses distinct folder IDs but shared file IDs.
        var shared=await Read(await client.PostAsJsonAsync(
            "/api/v2/ui/folders/company/achievement/transfer-batch",new {
                targetFolderId=shareTarget,targetSection="general",
                move=false,items=new[]{first}}));
        long shareRoot=shared.GetProperty("ids")[0].GetInt64();
        var inGeneral=await Flat(client,"company","general");
        long shareChild=Id(inGeneral.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("parent").ValueKind!=JsonValueKind.Null &&
            x.GetProperty("folder").GetProperty("parent")
              .GetProperty("id").GetInt64()==shareRoot));
        Check(shareRoot!=first && shareChild!=child &&
              (await Links(client,"company",shareChild))[0]
                .GetProperty("fileId").GetInt64()==file,
            "cross-section share clones folder structure and keeps FileId shared");
        using(var crossWorkspace=await client.PostAsJsonAsync(
            "/api/v2/ui/folders/personal/certificate/transfer-batch",new {
                targetFolderId=target,targetSection="achievement",
                move=true,items=new[]{first}}))
            Check(crossWorkspace.StatusCode!=HttpStatusCode.OK,
                "folder move cannot change workspaces through section endpoint");
    }

    private static async Task VerifyProjectDirectoriesAsync(HttpClient client,Vault vault)
    {
        string mark="PROJECT-DIR-"+Guid.NewGuid().ToString("N")[..8];
        async Task<long> Project(string workspace,string suffix)
        {
            var response=await Read(await client.PostAsJsonAsync(
                $"/api/v2/folders/{workspace}/project",
                new{project=new{name=mark+suffix,projectType="科研项目"}}));
            return response.GetProperty("id").GetInt64();
        }
        long firstProject=await Project("company","甲");
        long secondProject=await Project("company","乙");
        long root=await Folder(client,"company","project",mark+"项目目录",firstProject);
        long child=await Folder(client,"company","project",mark+"多级子目录",root);
        byte[] original=[11,21,31],updated=[41,51,61];
        long file;
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={child}")
            {Content=new ByteArrayContent(original)})
        {
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+".txt"));
            file=(await Read(await client.SendAsync(upload)))
                .GetProperty("fileId").GetInt64();
        }
        using(var newer=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(updated)})
        {
            newer.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+"-2.txt"));
            await Read(await client.SendAsync(newer));
        }
        long sourceLink=(await Links(client,"company",child))[0]
            .GetProperty("id").GetInt64();
        var flat=await Flat(client,"company","project");
        var projectRoot=flat.EnumerateArray().Single(x=>Id(x)==root);
        Check(projectRoot.GetProperty("folder").GetProperty("parent")
                .GetProperty("kind").GetString()=="project" &&
              projectRoot.GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==firstProject,
            "ordinary folder root has a real project as parent");
        Check(flat.EnumerateArray().Single(x=>Id(x)==child)
                .GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==root,
            "project folders support nested ordinary directory trees");
        var browser=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/folders/company");
        Check(browser.GetProperty("folders").EnumerateArray().Any(x=>
            x.GetProperty("id").GetInt64()==child &&
            x.GetProperty("section").GetString()=="project"),
            "Explorer snapshot contains ordinary project directories");
        using(var invalid=await client.PostAsJsonAsync(
            "/api/v2/folders/company/archive_folder",new {
              section="project",archiveFolder=new{name=mark+"没有所属项目"}}))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                "project section cannot have a virtual top-level directory");
        using(var invalid=await client.PostAsJsonAsync(
            "/api/v2/ui/folders/company/project/transfer-batch",new {
              targetFolderId=0,targetSection="project",move=true,items=new[]{root}}))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                "project tree may not be moved to virtual project section root");

        // Same-section cross-project movement changes only the root parent.
        var transferred=await Read(await client.PostAsJsonAsync(
            "/api/v2/ui/folders/company/project/transfer-batch",new {
                targetFolderId=secondProject,targetSection="project",
                move=true,items=new[]{root}}));
        Check(transferred.GetProperty("ids")[0].GetInt64()==root,
            "cross-project move retains source FolderId");
        flat=await Flat(client,"company","project");
        Check(flat.EnumerateArray().Single(x=>Id(x)==root)
              .GetProperty("folder").GetProperty("parent")
              .GetProperty("id").GetInt64()==secondProject &&
              flat.EnumerateArray().Single(x=>Id(x)==child)
              .GetProperty("folder").GetProperty("parent")
              .GetProperty("id").GetInt64()==root,
            "cross-project move keeps the complete original subtree");
        Check((await Links(client,"company",child))[0]
               .GetProperty("id").GetInt64()==sourceLink,
            "cross-project move preserves existing attachment LinkId");

        // Folder in another archive module can be moved into a project.
        long incoming=await Folder(client,"company","general",mark+"待归档");
        var intoProject=await Read(await client.PostAsJsonAsync(
            "/api/v2/ui/folders/company/general/transfer-batch",new {
                targetFolderId=firstProject,targetSection="project",
                move=true,items=new[]{incoming}}));
        Check(intoProject.GetProperty("ids")[0].GetInt64()==incoming &&
              (await Flat(client,"company","project")).EnumerateArray().Any(x=>
                Id(x)==incoming && x.GetProperty("folder").GetProperty("parent")
                  .GetProperty("id").GetInt64()==firstProject),
            "ordinary folder may move from general materials into a project");

        // Whole project cross-workspace copy must include all levels and versions.
        var copy=await Read(await client.PostAsJsonAsync(
            $"/api/v2/projects/company/{secondProject}/transfer",new {
                targetWorkspace="personal",move=false}));
        Check(copy.GetProperty("directories").GetInt32()==2,
            "whole-project copy traverses both nested ordinary folders");
        long projectCopy=copy.GetProperty("id").GetInt64();
        var personalFolders=await Flat(client,"personal","project");
        var rootCopy=personalFolders.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("name").GetString()==mark+"项目目录");
        var childCopy=personalFolders.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("name").GetString()==mark+"多级子目录");
        Check(rootCopy.GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==projectCopy &&
              childCopy.GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==Id(rootCopy),
            "cross-workspace project copy retains all parent relationships");
        long copiedFile=(await Links(client,"personal",Id(childCopy)))[0]
            .GetProperty("fileId").GetInt64();
        Check(copiedFile!=file,
            "cross-workspace project copy creates an independent FileId");
        for(int i=1;i<=2;i++)
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/personal/{copiedFile}/versions/{i}/download"))
                 .SequenceEqual(i==1?original:updated),
                "project clone preserves every complete version");

        // Sharing an entire project subfolder to general materials preserves
        // FileId and must survive permanent deletion of the source project.
        var shared=await Read(await client.PostAsJsonAsync(
            "/api/v2/ui/folders/company/project/transfer-batch",new {
                targetFolderId=0,targetSection="general",
                move=false,items=new[]{root}}));
        long sharedRoot=shared.GetProperty("ids")[0].GetInt64();
        var general=await Flat(client,"company","general");
        var sharedChild=general.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("parent").ValueKind!=JsonValueKind.Null &&
            x.GetProperty("folder").GetProperty("parent")
              .GetProperty("id").GetInt64()==sharedRoot);
        Check((await Links(client,"company",Id(sharedChild)))[0]
            .GetProperty("fileId").GetInt64()==file,
            "cross-module share keeps same FileId and complete history");
        using(var deletion=await client.DeleteAsync(
            $"/api/v2/folders/company/project/{secondProject}"))
            deletion.EnsureSuccessStatusCode();
        Check(RecycleStore.Change(vault.Db,"company",
            [new RecycleKey("project",secondProject,"")],true),
            "permanent project purge traverses arbitrarily nested subfolders");
        Check(!(await Flat(client,"company","project")).EnumerateArray()
            .Any(x=>Id(x)==root||Id(x)==child),
            "purged project tree cannot reappear in project listings");
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/company/{file}/versions/2/download"))
            .SequenceEqual(updated),
            "project purge does not delete files shared to another module");
    }

    public static async Task VerifyAsync(HttpClient client,Vault vault)
    {
        string mark="TREE-"+Guid.NewGuid().ToString("N")[..8];
        long root=await Folder(client,"company","achievement",mark+"主目录");
        long child=await Folder(client,"company","achievement",mark+"子目录",root);
        long leaf=await Folder(client,"company","achievement",mark+"三级",child);
        byte[] a=[1,7,3,9,2],b=[6,4,8,5];
        long file;
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={root}")
            {Content=new ByteArrayContent(a)})
        {
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+".pdf"));
            file=(await Read(await client.SendAsync(upload)))
                .GetProperty("fileId").GetInt64();
        }
        using(var version=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(b)})
        {
            version.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+"新版.pdf"));
            await Read(await client.SendAsync(version));
        }
        var firstLink=(await Links(client,"company",root))[0];
        long linkId=firstLink.GetProperty("id").GetInt64();
        using(var association=await client.PostAsJsonAsync(
            $"/api/v2/files/company/{file}/associate",
            new NativeFileAssociateInput(linkId,child,false)))
            association.EnsureSuccessStatusCode();
        Check((await Links(client,"company",child))[0]
            .GetProperty("fileId").GetInt64()==file,
            "source root and child share the same FileId");

        string url=$"/api/v2/ui/folders/company/achievement/{root}/transfer";
        using(var rejected=await client.PostAsJsonAsync(url,new{
            targetWorkspace="personal",targetSection="achievement",
            targetFolderId=long.MaxValue,move=false}))
            Check(rejected.StatusCode==HttpStatusCode.NotFound,
                "invalid target must not create a partial tree");
        // Force an error at the SECOND folder insert. SQLCipher must roll
        // back the previously inserted destination root and every link/object.
        using(var createTrigger=vault.Db.CreateCommand())
        {
            createTrigger.CommandText=$"""
                CREATE TEMP TRIGGER fail_tree_child BEFORE INSERT ON folders
                WHEN NEW.workspace='personal' AND NEW.section='achievement'
                     AND NEW.name='{mark}子目录'
                BEGIN SELECT RAISE(ABORT,'deliberate tree rollback'); END;
                """;
            createTrigger.ExecuteNonQuery();
        }
        try
        {
            using var aborted=await client.PostAsJsonAsync(url,new{
                targetWorkspace="personal",targetSection="achievement",move=false});
            Check(aborted.StatusCode==HttpStatusCode.Conflict,
                "mid-tree SQLite failure returns an explicit conflict");
            Check(!(await Flat(client,"personal","achievement"))
                .EnumerateArray().Any(x=>x.GetProperty("folder")
                    .GetProperty("name").GetString()==mark+"主目录"),
                "a failed second insert rolls back the first folder");
            Check((await Flat(client,"company","achievement"))
                .EnumerateArray().Any(x=>Id(x)==root),
                "a failed transaction never deletes the source");
        }
        finally
        {
            using var drop=vault.Db.CreateCommand();
            drop.CommandText="DROP TRIGGER IF EXISTS fail_tree_child;";
            drop.ExecuteNonQuery();
        }
        var copied=await Read(await client.PostAsJsonAsync(url,new{
            targetWorkspace="personal",targetSection="achievement",move=false}));
        long copyRoot=copied.GetProperty("id").GetInt64();
        Check(copied.GetProperty("folders").GetInt32()==3 &&
              copied.GetProperty("files").GetInt32()==2 &&
              copied.GetProperty("versions").GetInt32()==2 &&
              copied.GetProperty("newObjects").GetInt32()==2,
            "three folders, two shared links, one file history and new objects");

        var target=await Flat(client,"personal","achievement");
        var c=Named(target,mark+"子目录");
        var leafCopy=Named(target,mark+"三级");
        Check(c.GetProperty("folder").GetProperty("parent")
                   .GetProperty("id").GetInt64()==copyRoot &&
              leafCopy.GetProperty("folder").GetProperty("parent")
                   .GetProperty("id").GetInt64()==Id(c),
            "full three-level hierarchy and parent IDs copied");
        var rootLinks=await Links(client,"personal",copyRoot);
        var childLinks=await Links(client,"personal",Id(c));
        long targetFile=rootLinks[0].GetProperty("fileId").GetInt64();
        Check(targetFile!=file &&
              targetFile==childLinks[0].GetProperty("fileId").GetInt64(),
            "source sharing becomes one independent destination FileId");
        for(int ver=1;ver<=2;ver++)
        {
            byte[] actual=await client.GetByteArrayAsync(
                $"/api/v2/files/personal/{targetFile}/versions/{ver}/download");
            Check(actual.SequenceEqual(ver==1?a:b),
                "entire byte-for-byte version history copied");
        }
        Check((await Flat(client,"company","achievement")).EnumerateArray()
            .Any(x=>Id(x)==root),"copy must leave source visible");

        var duplicate=await Read(await client.PostAsJsonAsync(url,new{
            targetWorkspace="personal",targetSection="achievement",move=false}));
        var renamed=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/folders/personal/archive_folder/{duplicate.GetProperty("id").GetInt64()}?section=achievement");
        Check(renamed.GetProperty("folder").GetProperty("name").GetString()==
              renamed.GetProperty("businessData").GetProperty("name").GetString(),
            "conflicting root name and JSON Name stay identical");

        long general=await Folder(client,"company","general",mark+"综合目录");
        long generalChild=await Folder(client,"company","general",
            mark+"综合下级",general);
        var moved=await Read(await client.PostAsJsonAsync(
            $"/api/v2/ui/folders/company/general/{general}/transfer",
            new{targetWorkspace="personal",targetSection="general",move=true}));
        Check(moved.GetProperty("files").GetInt32()==0,
            "empty general folder tree moves without attachments");
        var personal=await Flat(client,"personal","general");
        Check(Named(personal,mark+"综合下级").GetProperty("folder")
                 .GetProperty("parent").GetProperty("id").GetInt64()==
              moved.GetProperty("id").GetInt64(),
            "general transfer preserves nested folder ancestry");
        using(var gone=await client.GetAsync(
            $"/api/v2/folders/company/archive_folder/{general}?section=general"))
            Check(gone.StatusCode==HttpStatusCode.NotFound,
                "move soft-deletes source root after target commit");
        Check(!(await Flat(client,"company","general"))
            .EnumerateArray().Any(x=>Id(x)==generalChild),
            "source descendants are hidden with deleted ancestor");
        await VerifyFolderBatchAsync(client,vault);
        await VerifyCrossSectionFolderMoveAsync(client,vault);
        await VerifyProjectDirectoriesAsync(client,vault);
        Console.WriteLine("FOLDER TREE TRANSFER SMOKE PASS");
    }
}
