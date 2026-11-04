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
        var moved=await Read(await client.PostAsJsonAsync(endpoint,new{
            targetFolderId=target,move=true,items=new[]{a,b}}));
        Check(moved.GetProperty("ids").EnumerateArray()
            .Select(x=>x.GetInt64()).SequenceEqual(new[]{a,b}),
            "move preserves stable original FolderIds");
        flat=await Flat(client,"company","certificate");
        foreach(long id in new[]{a,b})
            Check(flat.EnumerateArray().Single(x=>Id(x)==id)
                .GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==target,
                "each original folder moved under target");
        Check(flat.EnumerateArray().Single(x=>Id(x)==child)
                .GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64()==a &&
              (await Links(client,"company",child))[0]
                .GetProperty("fileId").GetInt64()==file,
            "moving preserves descendant and original attachment identity");
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
        Console.WriteLine("FOLDER TREE TRANSFER SMOKE PASS");
    }
}
