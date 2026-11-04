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


    // M01-M08: move a top-level ordinary folder to a DIFFERENT module's
    // virtual root. Different sections may both have parent_id NULL.
    private static async Task VerifyCrossModuleRootMovesAsync(HttpClient client,
        Vault vault)
    {
        string mark="ROOT-MOVE-"+Guid.NewGuid().ToString("N")[..8];
        const string cert="/api/v2/ui/folders/company/certificate/transfer-batch";
        const string general="/api/v2/ui/folders/company/general/transfer-batch";
        const string achievement="/api/v2/ui/folders/company/achievement/transfer-batch";

        // M01: source and target have NULL parents, but different sections.
        long root=await Folder(client,"company","certificate",mark+"证书根");
        long child=await Folder(client,"company","certificate",mark+"证书子",root);
        byte[] v1=[1,4,9,2],v2=[9,1,3,7];
        long file;
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={child}")
            {Content=new ByteArrayContent(v1)})
        {
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+".dat"));
            file=(await Read(await client.SendAsync(upload)))
                .GetProperty("fileId").GetInt64();
        }
        using(var version=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(v2)})
        {
            version.Headers.Add("X-File-Name",Uri.EscapeDataString(mark+"-v2.dat"));
            await Read(await client.SendAsync(version));
        }
        long link=(await Links(client,"company",child))[0].GetProperty("id").GetInt64();
        var m01=await Read(await client.PostAsJsonAsync(cert,new {
            targetFolderId=0,targetSection="general",move=true,items=new[]{root}}));
        Check(m01.GetProperty("ids")[0].GetInt64()==root &&
              m01.GetProperty("targetSection").GetString()=="general" &&
              m01.GetProperty("folders").GetInt32()==2,
            "M01 cross-module root move preserves root identity and subtree");
        var inGeneral=await Flat(client,"company","general");
        var movedRoot=inGeneral.EnumerateArray().Single(x=>Id(x)==root);
        var movedChild=inGeneral.EnumerateArray().Single(x=>Id(x)==child);
        Check(movedRoot.GetProperty("folder").GetProperty("parent")
                  .ValueKind==JsonValueKind.Null &&
              movedChild.GetProperty("folder").GetProperty("parent")
                  .GetProperty("id").GetInt64()==root &&
              !(await Flat(client,"company","certificate"))
                  .EnumerateArray().Any(x=>Id(x)==root||Id(x)==child),
            "M01 root remains at NULL parent and all children change section");
        var rootLink=(await Links(client,"company",child))[0];
        Check(rootLink.GetProperty("id").GetInt64()==link &&
              rootLink.GetProperty("fileId").GetInt64()==file,
            "M01 FolderId, LinkId and FileId do not change");
        for(int version=1;version<=2;version++)
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/{version}/download"))
                .SequenceEqual(version==1?v1:v2),
                "M01 full version history remains byte-for-byte identical");

        // M02: the exact same module and parent still reject a no-op move.
        using(var same=await client.PostAsJsonAsync(general,new {
            targetFolderId=0,targetSection="general",move=true,items=new[]{root}}))
            Check(same.StatusCode==HttpStatusCode.Conflict,
                "M02 unchanged module/root must reject a no-op move");
        Check(Named(await Flat(client,"company","general"),mark+"证书根")
                .GetProperty("folder").GetProperty("parent")
                .ValueKind==JsonValueKind.Null,
            "M02 rejected move must leave the root unchanged");

        // M03: moving a nested source to another module root must move all
        // descendants and retain an existing shared file's version history.
        long achRoot=await Folder(client,"company","achievement",mark+"档案根");
        long branch=await Folder(client,"company","achievement",mark+"档案枝",achRoot);
        long leaf=await Folder(client,"company","achievement",mark+"档案叶",branch);
        using(var attach=await client.PostAsJsonAsync(
            $"/api/v2/files/company/{file}/associate",
            new NativeFileAssociateInput(link,branch,false)))
            attach.EnsureSuccessStatusCode();
        long branchLink=(await Links(client,"company",branch))[0]
            .GetProperty("id").GetInt64();
        var m03=await Read(await client.PostAsJsonAsync(achievement,new {
            targetFolderId=0,targetSection="general",move=true,items=new[]{branch}}));
        Check(m03.GetProperty("ids")[0].GetInt64()==branch &&
              m03.GetProperty("folders").GetInt32()==2,
            "M03 nested source moves to a different module root");
        inGeneral=await Flat(client,"company","general");
        Check(inGeneral.EnumerateArray().Single(x=>Id(x)==branch)
                  .GetProperty("folder").GetProperty("parent")
                  .ValueKind==JsonValueKind.Null &&
              inGeneral.EnumerateArray().Single(x=>Id(x)==leaf)
                  .GetProperty("folder").GetProperty("parent")
                  .GetProperty("id").GetInt64()==branch &&
              (await Flat(client,"company","achievement"))
                  .EnumerateArray().Any(x=>Id(x)==achRoot) &&
              (await Links(client,"company",branch))[0]
                  .GetProperty("id").GetInt64()==branchLink,
            "M03 child hierarchy, original parent and LinkId are correct");
        Check((await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/1/download")).SequenceEqual(v1) &&
              (await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/2/download")).SequenceEqual(v2),
            "M03 historical file contents remain readable");

        // M04: two top-level roots transfer atomically to another module root.
        long batchA=await Folder(client,"company","certificate",mark+"批量甲");
        long batchChild=await Folder(client,"company","certificate",mark+"批量子",batchA);
        long batchB=await Folder(client,"company","certificate",mark+"批量乙");
        var m04=await Read(await client.PostAsJsonAsync(cert,new {
            targetFolderId=0,targetSection="general",move=true,
            items=new[]{batchA,batchB}}));
        Check(m04.GetProperty("ids").EnumerateArray().Select(x=>x.GetInt64())
                  .SequenceEqual(new[]{batchA,batchB}) &&
              m04.GetProperty("folders").GetInt32()==3,
            "M04 two roots and nested child move in one batch");
        inGeneral=await Flat(client,"company","general");
        Check(new[]{batchA,batchB}.All(id=>inGeneral.EnumerateArray()
                  .Single(x=>Id(x)==id).GetProperty("folder")
                  .GetProperty("parent").ValueKind==JsonValueKind.Null) &&
              inGeneral.EnumerateArray().Single(x=>Id(x)==batchChild)
                  .GetProperty("folder").GetProperty("parent")
                  .GetProperty("id").GetInt64()==batchA,
            "M04 both roots and descendant appear in target section");

        // M05: actual same-name collision at the destination root rejects.
        long conflictSource=await Folder(client,"company","certificate",mark+"冲突");
        long conflictTarget=await Folder(client,"company","general",mark+"冲突");
        using(var clash=await client.PostAsJsonAsync(cert,new {
            targetFolderId=0,targetSection="general",move=true,
            items=new[]{conflictSource}}))
            Check(clash.StatusCode==HttpStatusCode.Conflict,
                "M05 target root same-name collision must reject");
        Check((await Flat(client,"company","certificate")).EnumerateArray()
                  .Any(x=>Id(x)==conflictSource) &&
              (await Flat(client,"company","general")).EnumerateArray()
                  .Any(x=>Id(x)==conflictTarget),
            "M05 both original folders remain after collision");

        // M06: fail on the SECOND root update after the first root update.
        // Checking the rollback-specific error also proves the trigger fired,
        // rather than accidentally treating the old false no-op as a pass.
        long failA=await Folder(client,"company","certificate",mark+"故障甲");
        long failB=await Folder(client,"company","certificate",mark+"故障乙");
        using(var create=vault.Db.CreateCommand())
        {
            create.CommandText=$"""
                CREATE TEMP TRIGGER fail_root_batch
                BEFORE UPDATE OF section ON folders
                WHEN OLD.id={failB} AND NEW.section='general'
                BEGIN SELECT RAISE(ABORT,'injected second root failure'); END;
                """;
            create.ExecuteNonQuery();
        }
        try
        {
            using var failure=await client.PostAsJsonAsync(cert,new {
                targetFolderId=0,targetSection="general",move=true,
                items=new[]{failA,failB}});
            string detail=await failure.Content.ReadAsStringAsync();
            Check(failure.StatusCode==HttpStatusCode.Conflict &&
                  detail.Contains("事务已回滚",StringComparison.Ordinal),
                "M06 injected second update reached SQL transaction rollback");
            var stillSource=await Flat(client,"company","certificate");
            var noDestination=await Flat(client,"company","general");
            Check(new[]{failA,failB}.All(id=>stillSource.EnumerateArray()
                  .Any(x=>Id(x)==id)),
                "M06 both roots remain in source after rollback");
            Check(!new[]{failA,failB}.Any(id=>noDestination.EnumerateArray()
                  .Any(x=>Id(x)==id)),
                "M06 neither root persists in destination after rollback");
        }
        finally
        {
            using var drop=vault.Db.CreateCommand();
            drop.CommandText="DROP TRIGGER IF EXISTS fail_root_batch;";
            drop.ExecuteNonQuery();
        }

        // M07 and M08 preserve existing invalid-target and cycle guards.
        using(var noProject=await client.PostAsJsonAsync(general,new {
            targetFolderId=0,targetSection="project",move=true,items=new[]{root}}))
            Check(noProject.StatusCode==HttpStatusCode.BadRequest,
                "M07 virtual project root is never a folder target");
        using(var self=await client.PostAsJsonAsync(general,new {
            targetFolderId=root,targetSection="general",move=true,items=new[]{root}}))
            Check(self.StatusCode==HttpStatusCode.BadRequest,
                "M08 a folder cannot move into itself");
        using(var descendant=await client.PostAsJsonAsync(general,new {
            targetFolderId=child,targetSection="general",move=true,items=new[]{root}}))
            Check(descendant.StatusCode==HttpStatusCode.BadRequest,
                "M08 a folder cannot move into a descendant");
        Check((await Flat(client,"company","general")).EnumerateArray()
                  .Single(x=>Id(x)==root).GetProperty("folder")
                  .GetProperty("parent").ValueKind==JsonValueKind.Null,
            "M08 rejected self/descendant moves leave source unchanged");
        Console.WriteLine("S1 M01-M08 ROOT MOVE SQLCIPHER HTTP PASS");
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

    // S3 X01-X06/X08/X12: real HTTP calls backed by a disposable SQLCipher
    // database. Every identity and version assertion uses actual return IDs.
    private static async Task VerifyS3ContractAsync(HttpClient client,Vault vault)
    {
        string key="S3-"+Guid.NewGuid().ToString("N")[..8];
        async Task<long> Project(string workspace,string name)
        {
            var response=await Read(await client.PostAsJsonAsync(
                $"/api/v2/folders/{workspace}/project",
                new{project=new{name=key+name,projectType="科研项目"}}));
            return response.GetProperty("id").GetInt64();
        }
        long first=await Project("company","原项目");
        long second=await Project("company","复制目标");
        long third=await Project("company","移动目标");
        long personalProject=await Project("personal","跨区目标");
        long original=await Folder(client,"company","project",key+"源目录",first);
        long child=await Folder(client,"company","project",key+"深层",original);
        byte[] a=[10,20,30,40],b=[50,60,70,80],c=[90,100,110,120];
        long file;
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={child}")
            {Content=new ByteArrayContent(a)})
        {
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString(key+".txt"));
            file=(await Read(await client.SendAsync(upload)))
                .GetProperty("fileId").GetInt64();
        }
        using(var version=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(b)})
        {
            version.Headers.Add("X-File-Name",Uri.EscapeDataString(key+"-v2.txt"));
            await Read(await client.SendAsync(version));
        }
        long link=(await Links(client,"company",child))[0]
            .GetProperty("id").GetInt64();
        using(var sharedLink=await client.PostAsJsonAsync(
            $"/api/v2/files/company/{file}/associate",
            new NativeFileAssociateInput(link,original,false)))
            sharedLink.EnsureSuccessStatusCode();

        // X01: independent copy inside the same workspace to a real project.
        const string sourceRoute="/api/v2/ui/folders/company/project/";
        var localCopy=await Read(await client.PostAsJsonAsync(
            sourceRoute+original+"/transfer",
            new{targetWorkspace="company",targetSection="project",
                targetFolderId=second,move=false}));
        long copyId=localCopy.GetProperty("id").GetInt64();
        var localTree=await Flat(client,"company","project");
        long copyChild=Id(localTree.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("name").GetString()==key+"深层" &&
            x.GetProperty("folder").GetProperty("parent").GetProperty("id")
              .GetInt64()==copyId));
        long copyFile=(await Links(client,"company",copyId))[0]
            .GetProperty("fileId").GetInt64();
        var copiedChildLink=(await Links(client,"company",copyChild))[0];
        Check(copyId!=original && copyChild!=child && copyFile!=file &&
              copiedChildLink.GetProperty("id").GetInt64()!=link &&
              copiedChildLink.GetProperty("fileId").GetInt64()==copyFile &&
              localCopy.GetProperty("versions").GetInt32()==2,
            "X01 independent project copy remaps all folders/links/one logical file");
        for(int v=1;v<=2;v++)
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/company/{copyFile}/versions/{v}/download"))
                    .SequenceEqual(v==1?a:b),
                "X01 same-workspace independent copy preserves both file versions");

        long shareContainer=await Folder(client,"company","general",key+"共享父级");
        var shared=await Read(await client.PostAsJsonAsync(
            "/api/v2/ui/folders/company/project/transfer-batch",new{
                targetFolderId=shareContainer,targetSection="general",
                move=false,items=new[]{original}}));
        long sharedRoot=shared.GetProperty("ids")[0].GetInt64();
        var generalFolders=await Flat(client,"company","general");
        long sharedChild=Id(generalFolders.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("parent").ValueKind!=
                JsonValueKind.Null &&
            x.GetProperty("folder").GetProperty("parent").GetProperty("id")
                .GetInt64()==sharedRoot));
        Check((await Links(client,"company",sharedChild))[0]
                .GetProperty("fileId").GetInt64()==file,
            "X04 shared subtree keeps source FileId and historical versions");

        // X03: cross-workspace independent copy under a real target project.
        var cross=await Read(await client.PostAsJsonAsync(
            sourceRoute+original+"/transfer",
            new{targetWorkspace="personal",targetSection="project",
                targetFolderId=personalProject,move=false}));
        long crossId=cross.GetProperty("id").GetInt64();
        var crossFlat=await Flat(client,"personal","project");
        long crossChild=Id(crossFlat.EnumerateArray().Single(x=>
            x.GetProperty("folder").GetProperty("parent").ValueKind!=JsonValueKind.Null &&
            x.GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==crossId));
        long crossFile=(await Links(client,"personal",crossChild))[0]
            .GetProperty("fileId").GetInt64();
        Check(crossId!=original && crossFile!=file &&
              cross.GetProperty("newObjects").GetInt32()==2 &&
              cross.GetProperty("versions").GetInt32()==2,
            "X03 cross-workspace copy creates separate FileId and two FileObjects");

        // Physical FileObjects must not cross workspace boundaries.
        static long ObjectId(Microsoft.Data.Sqlite.SqliteConnection db,
            string workspace,long fileId)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="""
                SELECT object_id FROM file_versions
                WHERE workspace=$w AND file_id=$f AND version=1;
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$f",fileId);
            return (long)(cmd.ExecuteScalar()
                ??throw new IOException("缺少原件文件对象。"));
        }
        Check(ObjectId(vault.Db,"company",file)!=
              ObjectId(vault.Db,"personal",crossFile),
            "X03 source/target FileObjects are physically different");

        // X04: new source version is visible via shared FileId, but not in
        // either independent copy, including the cross-workspace clone.
        using(var version=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(c)})
        {
            version.Headers.Add("X-File-Name",Uri.EscapeDataString(key+"-v3.txt"));
            await Read(await client.SendAsync(version));
        }
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/company/{file}/versions/3/download")).SequenceEqual(c),
            "X04 source can append third historical version");
        Check((await Links(client,"company",sharedChild))[0]
                .GetProperty("fileId").GetInt64()==file,
            "X04 shared folder still points to updated source FileId");
        using(var localThird=await client.GetAsync(
            $"/api/v2/files/company/{copyFile}/versions/3/download"))
            Check(localThird.StatusCode==HttpStatusCode.NotFound,
                "X04 independent same-workspace copy never receives source v3");
        using(var remoteThird=await client.GetAsync(
            $"/api/v2/files/personal/{crossFile}/versions/3/download"))
            Check(remoteThird.StatusCode==HttpStatusCode.NotFound,
                "X03 independent cross-workspace copy never receives source v3");
        for(int v=1;v<=2;v++)
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/personal/{crossFile}/versions/{v}/download"))
                    .SequenceEqual(v==1?a:b),
                "X03 physically independent copy retains exact version bytes");

        // X08/X12: prevent copies into own tree, project virtual root and
        // unsupported cross-workspace module mappings before writing.
        using(var self=await client.PostAsJsonAsync(
            sourceRoute+original+"/transfer",new{
                targetWorkspace="company",targetSection="project",
                targetFolderId=original,move=false}))
            Check(self.StatusCode==HttpStatusCode.BadRequest,
                "X08 independent copy into itself must be rejected");
        using(var descendant=await client.PostAsJsonAsync(
            sourceRoute+original+"/transfer",new{
                targetWorkspace="company",targetSection="project",
                targetFolderId=child,move=false}))
            Check(descendant.StatusCode==HttpStatusCode.BadRequest,
                "X08 independent copy into descendant must be rejected");
        using(var virtualRoot=await client.PostAsJsonAsync(
            sourceRoute+original+"/transfer",new{
                targetWorkspace="company",targetSection="project",move=false}))
            Check(virtualRoot.StatusCode==HttpStatusCode.BadRequest,
                "X08 project virtual root never receives a folder");
        using(var forbidden=await client.PostAsJsonAsync(
            sourceRoute+original+"/transfer",new{
                targetWorkspace="personal",targetSection="general",move=false}))
            Check(forbidden.StatusCode==HttpStatusCode.BadRequest,
                "X12 cross-workspace project-to-general mapping is forbidden");

        // X02: GUI batch move to a non-project root leaves all identities,
        // while the legacy /move endpoint delegates to the exact same core.
        var batch=await Read(await client.PostAsJsonAsync(
            "/api/v2/ui/folders/company/project/transfer-batch",
            new{targetFolderId=0,targetSection="general",
                move=true,items=new[]{original}}));
        Check(batch.GetProperty("ids")[0].GetInt64()==original,
            "X02 project-to-general batch move retains FolderId");
        Check((await Links(client,"company",child))[0]
            .GetProperty("id").GetInt64()==link &&
            (await Links(client,"company",child))[0]
            .GetProperty("fileId").GetInt64()==file,
            "X02 project-to-general move preserves link and logical FileId");
        var legacy=await Read(await client.PostAsJsonAsync(
            $"/api/v2/folders/company/archive_folder/{original}/move?section=general",
            new{parentId=third,targetSection="project"}));
        Check(legacy.GetProperty("id").GetInt64()==original &&
              (await Flat(client,"company","project")).EnumerateArray()
                .Any(x=>Id(x)==original && x.GetProperty("folder")
                    .GetProperty("parent").GetProperty("id").GetInt64()==third),
            "X02 legacy move thin adapter retains the original project-folder ID");
        // X05: the single-record transfer endpoint must likewise perform an
        // in-place same-workspace move (no soft-deleted source duplicate).
        var single=await Read(await client.PostAsJsonAsync(
            sourceRoute+original+"/transfer",new{
                targetWorkspace="company",targetSection="project",
                targetFolderId=first,move=true}));
        Check(single.GetProperty("id").GetInt64()==original &&
              single.GetProperty("moved").GetBoolean() &&
              (await Links(client,"company",child))[0]
                  .GetProperty("id").GetInt64()==link &&
              !RecycleStore.List(vault.Db,"company").Any(x=>
                  x.Kind=="v2_archive_folder" && x.Id==original),
            "X05 same-workspace transfer move preserves all identities and no tombstone");

        // X06: cross-workspace move is independent copy followed by a source
        // soft-delete, and restoring source leaves two physically separate trees.
        long moveRoot=await Folder(client,"company","general",key+"跨区移动");
        long blockedHolder=await Folder(client,"personal","general",key+"同名冲突容器");
        await Folder(client,"personal","general",
            key+"跨区移动",blockedHolder);
        using(var blocked=await client.PostAsJsonAsync(
            $"/api/v2/ui/folders/company/general/{moveRoot}/transfer",
            new{targetWorkspace="personal",targetSection="general",
                targetFolderId=blockedHolder,move=true}))
            Check(blocked.StatusCode==HttpStatusCode.Conflict &&
                (await Flat(client,"company","general")).EnumerateArray()
                  .Any(x=>Id(x)==moveRoot) &&
                (await Flat(client,"personal","general")).EnumerateArray()
                  .Count(x=>x.GetProperty("folder")
                      .GetProperty("parent").ValueKind!=JsonValueKind.Null &&
                    x.GetProperty("folder").GetProperty("parent")
                      .GetProperty("id").GetInt64()==blockedHolder)==1,
                "X06 cross-workspace move rejects root name conflicts atomically");
        long targetHolder=await Folder(client,"personal","general",key+"跨区目标目录");
        var moved=await Read(await client.PostAsJsonAsync(
            $"/api/v2/ui/folders/company/general/{moveRoot}/transfer",
            new{targetWorkspace="personal",targetSection="general",
                targetFolderId=targetHolder,move=true}));
        long newRoot=moved.GetProperty("id").GetInt64();
        Check(newRoot!=moveRoot &&
              (await Flat(client,"personal","general")).EnumerateArray()
                .Any(x=>Id(x)==newRoot) &&
              !(await Flat(client,"company","general")).EnumerateArray()
                .Any(x=>Id(x)==moveRoot),
            "X06 cross-workspace move creates new root and tombstones source");
        Check(RecycleStore.Change(vault.Db,"company",
            [new RecycleKey("v2_archive_folder",moveRoot,"general")],false) &&
              (await Flat(client,"company","general")).EnumerateArray()
                .Any(x=>Id(x)==moveRoot),
            "X06 restoring source creates two independent, active trees");
        Console.WriteLine("S3 X01-X06/X08/X12 SQLCIPHER HTTP PASS");
    }

    private static async Task VerifyS4OrderAsync(HttpClient client,Vault vault)
    {
        string tag="S4-"+Guid.NewGuid().ToString("N")[..8];
        async Task<long[]> Ids(string ws,string sec,long parent)
        {
            var result=await client.GetFromJsonAsync<JsonElement>(
                $"/api/v2/folders/{ws}/entries?section={sec}"+
                (parent==0?"":"&parentId="+parent));
            return result.EnumerateArray().Select(x=>
                x.GetProperty("folder").GetProperty("ref")
                .GetProperty("id").GetInt64()).ToArray();
        }
        static ArchiveEntryReorder Payload(long parent,long[] ids)=>
            new(parent,ids.Select(x=>new ArchiveEntryOrderItem("folder",x)).ToList());
        Task<HttpResponseMessage> Send(string ws,string sec,ArchiveEntryReorder payload)=>
            client.PostAsJsonAsync(
                $"/api/v2/folders/{ws}/entries/reorder?section={sec}",payload);
        foreach(var (ws,sec) in new[]{
            ("company","certificate"),("company","achievement"),
            ("company","party"),("company","general"),("company","project"),
            ("personal","certificate"),("personal","achievement"),
            ("personal","academic"),("personal","general"),("personal","project")})
        {
            long parent=0;
            if(sec=="project")
            {
                var p=await Read(await client.PostAsJsonAsync(
                    $"/api/v2/folders/{ws}/project",
                    new{project=new{name=tag+"项目",projectType="科研项目"}}));
                parent=p.GetProperty("id").GetInt64();
            }
            long a=await Folder(client,ws,sec,tag+"甲"+sec,parent==0?null:parent);
            long b=await Folder(client,ws,sec,tag+"乙"+sec,parent==0?null:parent);
            var previous=await Ids(ws,sec,parent);
            Check(previous.Contains(a)&&previous.Contains(b),
                "O01 eligible direct siblings visible in "+ws+"/"+sec);
            var reversed=previous.Reverse().ToArray();
            using(var response=await Send(ws,sec,Payload(parent,reversed)))
                response.EnsureSuccessStatusCode();
            Check((await Ids(ws,sec,parent)).SequenceEqual(reversed),
                "O01 same-parent order persists across HTTP reload");

            long d=await Folder(client,ws,sec,tag+"深层甲",a);
            long e=await Folder(client,ws,sec,tag+"深层乙",a);
            using(var response=await Send(ws,sec,Payload(a,[e,d])))
                response.EnsureSuccessStatusCode();
            Check((await Ids(ws,sec,a)).SequenceEqual(new[]{e,d}) &&
                  (await Ids(ws,sec,parent)).SequenceEqual(reversed),
                "O01 nested reorder isolated from neighboring parents");
            foreach(var wrong in new[]{
                new long[]{e},new long[]{e,e},new long[]{e,d,b}})
            {
                using var response=await Send(ws,sec,Payload(a,wrong));
                Check(response.StatusCode==HttpStatusCode.Conflict &&
                     (await Ids(ws,sec,a)).SequenceEqual(new[]{e,d}),
                    "O03 missing, duplicated or foreign ID must rollback");
            }
            using(var invalid=await Send(ws,sec,
                new ArchiveEntryReorder(a,[new ArchiveEntryOrderItem("record",d),
                    new ArchiveEntryOrderItem("folder",e)])))
                Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                    "O04 kind=record must be rejected");
        }
        using(var invalid=await Send("company","project",Payload(0,[1])))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                "O04 project virtual root cannot be sorted");
        using(var invalid=await Send("company","general",Payload(999999999,[1])))
            Check(invalid.StatusCode==HttpStatusCode.NotFound,
                "O04 nonexistent parent must be rejected");
        // O02: folder position changes cannot touch file links or versions.
        long mixed=await Folder(client,"company","general",tag+"混排父");
        long mixedA=await Folder(client,"company","general",tag+"混排甲",mixed);
        long mixedB=await Folder(client,"company","general",tag+"混排乙",mixed);
        byte[] firstBytes=[2,4,6,8],secondBytes=[1,3,5,7];
        long fileId;
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/upload?folderId={mixedA}")
            {Content=new ByteArrayContent(firstBytes)})
        {
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString(tag+"-first.txt"));
            fileId=(await Read(await client.SendAsync(upload)))
                .GetProperty("fileId").GetInt64();
        }
        using(var version=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{fileId}/versions")
            {Content=new ByteArrayContent(secondBytes)})
        {
            version.Headers.Add("X-File-Name",Uri.EscapeDataString(tag+"-second.txt"));
            await Read(await client.SendAsync(version));
        }
        long linkId=(await Links(client,"company",mixedA))[0]
            .GetProperty("id").GetInt64();
        using(var response=await Send("company","general",Payload(mixed,[mixedB,mixedA])))
            response.EnsureSuccessStatusCode();
        Check((await Links(client,"company",mixedA))[0]
                .GetProperty("id").GetInt64()==linkId &&
              (await Links(client,"company",mixedA))[0]
                .GetProperty("fileId").GetInt64()==fileId,
            "O02 mixed-level folder reorder never rewrites FileId/LinkId");
        for(int v=1;v<=2;v++)
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/company/{fileId}/versions/{v}/download"))
                    .SequenceEqual(v==1?firstBytes:secondBytes),
                "O02 mixed attachments retain exact version bytes");
        // O05: a stale complete-sibling request cannot overwrite newly
        // inserted or soft-deleted entries.
        long stale=await Folder(client,"company","general",tag+"过期父");
        await Folder(client,"company","general",tag+"过期甲",stale);
        await Folder(client,"company","general",tag+"过期乙",stale);
        var snapshot=await Ids("company","general",stale);
        long added=await Folder(client,"company","general",tag+"过期丙",stale);
        using(var response=await Send("company","general",Payload(stale,snapshot)))
            Check(response.StatusCode==HttpStatusCode.Conflict,
                "O05 inserting a sibling invalidates previous complete-set input");
        var withNew=await Ids("company","general",stale);
        using(var deleted=await client.DeleteAsync(
            $"/api/v2/folders/company/archive_folder/{added}?section=general"))
            deleted.EnsureSuccessStatusCode();
        using(var response=await Send("company","general",Payload(stale,withNew)))
            Check(response.StatusCode==HttpStatusCode.Conflict,
                "O05 deleting a sibling invalidates previous complete-set input");
        Check((await Ids("company","general",stale)).SequenceEqual(snapshot),
            "O05 rejected reorder did not mutate any active sibling");
        // O07: force an error on the SECOND row update. The first update
        // must roll back atomically, rather than persist partial ordering.
        long holder=await Folder(client,"company","general",tag+"事务父");
        long first=await Folder(client,"company","general",tag+"事务甲",holder);
        long second=await Folder(client,"company","general",tag+"事务乙",holder);
        long third=await Folder(client,"company","general",tag+"事务丙",holder);
        var baseline=await Ids("company","general",holder);
        using(var trigger=vault.Db.CreateCommand())
        {
            trigger.CommandText=$"""
                CREATE TEMP TRIGGER s4_reorder_failure
                BEFORE UPDATE OF position ON main.folders
                WHEN NEW.id={second}
                BEGIN SELECT RAISE(FAIL,'s4 test rollback'); END;
                """;
            trigger.ExecuteNonQuery();
        }
        try
        {
            using var response=await Send("company","general",
                Payload(holder,[third,second,first]));
            Check((int)response.StatusCode>=500,
                "O07 injected second-row SQL error fails the HTTP write");
            Check((await Ids("company","general",holder)).SequenceEqual(baseline),
                "O07 all positions roll back after second-row failure");
        }
        finally
        {
            using var drop=vault.Db.CreateCommand();
            drop.CommandText="DROP TRIGGER IF EXISTS temp.s4_reorder_failure;";
            drop.ExecuteNonQuery();
        }
        Console.WriteLine("S4 O01/O03/O04/O05/O07 SQLCIPHER HTTP PASS");
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
        await VerifyCrossModuleRootMovesAsync(client,vault);
        await VerifyProjectDirectoriesAsync(client,vault);
        await VerifyS3ContractAsync(client,vault);
        await VerifyS4OrderAsync(client,vault);
        Console.WriteLine("FOLDER TREE TRANSFER SMOKE PASS");
    }
}
