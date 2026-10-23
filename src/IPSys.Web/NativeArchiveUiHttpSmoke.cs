using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// N2-04 existing card/table integration: native identities and file history.
static class NativeArchiveUiHttpSmoke
{
    private static void Assert(bool ok,string msg)
    {
        if(!ok)throw new IOException("N2-04 archive browser: "+msg);
    }
    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    private static async Task<long> Add(HttpClient c,string path,object body)=>
        (await Json(await c.PostAsJsonAsync(path,body))).GetProperty("id").GetInt64();

    private static async Task<long> Upload(HttpClient c,string folder,byte[] bytes,
        string name)
    {
        using var msg=new HttpRequestMessage(HttpMethod.Post,folder)
            {Content=new ByteArrayContent(bytes)};
        msg.Headers.Add("X-File-Name",Uri.EscapeDataString(name));
        return (await Json(await c.SendAsync(msg))).GetProperty("fileId").GetInt64();
    }

    public static async Task VerifyAsync(HttpClient client)
    {
        string marker="V2UI-"+Guid.NewGuid().ToString("N")[..8];
        long certificate=await Add(client,"/api/v2/folders/company/archive",
            new {section="certificate",archive=new {
                name=marker+"证书",remarks="档案页面"}});
        long party=await Add(client,"/api/v2/folders/company/archive",
            new {section="party",archive=new {
                name=marker+"党团会议",year="2026",remarks="党团建设档案"}});
        byte[] partyBytes=RandomNumberGenerator.GetBytes(97);
        await Upload(client,$"/api/v2/files/company/upload?folderId={party}",
            partyBytes,marker+"党团材料.pdf");
        using(var blocked=await client.PostAsJsonAsync(
            "/api/v2/folders/personal/archive",new{section="party",archive=new{name="越界党团"}}))
            Assert(!blocked.IsSuccessStatusCode,"party section must be company-only");
        long general=await Add(client,"/api/v2/folders/company/general",
            new {general=new{title=marker+"综合资料"}});
        var baseSnapshot=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/archive/company");
        Assert(baseSnapshot.GetProperty("archives").EnumerateArray().Any(x=>
                x.GetProperty("id").GetInt64()==certificate) &&
               baseSnapshot.GetProperty("general").EnumerateArray().Any(x=>
                x.GetProperty("id").GetInt64()==general),
               "current archive/general browser reads same native FolderId as CRUD");
        Assert(baseSnapshot.GetProperty("archives").EnumerateArray().Any(x=>
                x.GetProperty("id").GetInt64()==party &&
                x.GetProperty("section").GetString()=="party") &&
               baseSnapshot.GetProperty("files").EnumerateArray().Any(x=>
                x.GetProperty("ownerId").GetInt64()==party &&
                x.GetProperty("section").GetString()=="party"),
               "company party record and original must appear in Explorer snapshot");
        var roots=baseSnapshot.GetProperty("folders");
        long root=roots.EnumerateArray().First(x=>x.GetProperty("name").GetString()
            =="申报与认定").GetProperty("id").GetInt64();
        long child=await Add(client,"/api/v2/folders/company/archive_folder",
            new{archiveFolder=new{name=marker+"下级目录",parentId=root}});
        long record=await Add(client,"/api/v2/folders/company/archive",
            new{section="achievement",archive=new{
                name=marker+"申报",folderId=child,year="2026"}});
        var historyA=RandomNumberGenerator.GetBytes(1203);
        var historyB=RandomNumberGenerator.GetBytes(1967);
        long file=await Upload(client,
            $"/api/v2/files/company/upload?folderId={record}",
            historyA,marker+"原件.pdf");
        using(var version=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{file}/versions")
            {Content=new ByteArrayContent(historyB)})
        {
            version.Headers.Add("X-File-Name",Uri.EscapeDataString(marker+"更新.pdf"));
            await Json(await client.SendAsync(version));
        }
        var v=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/archive/company");
        Assert(v.GetProperty("folders").EnumerateArray().Any(x=>
            x.GetProperty("id").GetInt64()==child),
            "nested folders must be visible beyond first-level root");
        Assert(v.GetProperty("files").EnumerateArray().Count(x=>
            x.GetProperty("ownerId").GetInt64()==record)==2,
            "both FileVersions displayed with one stable FolderId and FileId");
        var parentOrder=v.GetProperty("orders").GetProperty(root.ToString());
        Assert(parentOrder.EnumerateArray().Any(x=>
            x.GetProperty("kind").GetString()=="folder"&&
            x.GetProperty("id").GetInt64()==child),
            "mixed-order navigation includes nested folder");

        long expanded=(await Json(await client.PostAsync(
            $"/api/v2/ui/archive/company/achievement/{record}/expand",null)))
            .GetProperty("id").GetInt64();
        var expandedUi=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/archive/company");
        Assert(expandedUi.GetProperty("folders").EnumerateArray().Any(x=>
                x.GetProperty("id").GetInt64()==expanded)&&
               expandedUi.GetProperty("archives").EnumerateArray().Any(x=>
                x.GetProperty("id").GetInt64()==record&&
                x.GetProperty("folderId").GetInt64()==expanded),
            "expanding archive preserves the record inside new child directory");
        Assert((await client.GetByteArrayAsync(
            $"/api/v2/files/company/{file}/versions/2/download"))
            .SequenceEqual(historyB),"expansion preserves historical attachment bytes");

        var transferred=await Json(await client.PostAsJsonAsync(
            $"/api/v2/ui/archive/company/achievement/{record}/transfer",
            new{targetWorkspace="personal",targetSection="achievement",move=false}));
        long targetId=transferred.GetProperty("id").GetInt64();
        Assert(transferred.GetProperty("versions").GetInt32()==2,
            "whole archive copy includes historical versions");
        var personalUi=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/archive/personal");
        Assert(personalUi.GetProperty("archives").EnumerateArray().Any(x=>
            x.GetProperty("id").GetInt64()==targetId),
            "personal archive visible after cross-workspace copy");
        var personalLinks=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/personal/folders/{targetId}/links");
        long copiedFile=personalLinks[0].GetProperty("fileId").GetInt64();
        Assert(copiedFile!=file &&
            (await client.GetByteArrayAsync(
              $"/api/v2/files/personal/{copiedFile}/versions/1/download"))
            .SequenceEqual(historyA) &&
            (await client.GetByteArrayAsync(
              $"/api/v2/files/personal/{copiedFile}/versions/2/download"))
            .SequenceEqual(historyB),
            "independent cross-workspace FileId and full version bytes");

        byte[] generalOriginal=RandomNumberGenerator.GetBytes(117);
        byte[] generalRevision=RandomNumberGenerator.GetBytes(269);
        long generalFile=await Upload(client,
            $"/api/v2/files/company/upload?folderId={general}",
            generalOriginal,marker+"综合附件.txt");
        using(var revision=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/files/company/{generalFile}/versions")
            {Content=new ByteArrayContent(generalRevision)})
        {
            revision.Headers.Add("X-File-Name",
                Uri.EscapeDataString(marker+"综合附件新版本.txt"));
            await Json(await client.SendAsync(revision));
        }
        v=await client.GetFromJsonAsync<JsonElement>("/api/v2/ui/archive/company");
        var row=v.GetProperty("general").EnumerateArray().First(x=>
            x.GetProperty("id").GetInt64()==general);
        Assert(row.GetProperty("files").EnumerateArray().Any(x=>
            x.GetProperty("fileId").GetInt64()==generalFile&&
            x.GetProperty("kind").GetString()=="general"),
            "general detail links use native FileId/LinkId");

        // A duplicate in the same workspace gets a separate FileId and retains
        // both versions. Cross-workspace move copies independent physical bytes.
        var same=await Json(await client.PostAsJsonAsync(
            $"/api/v2/ui/general/company/{general}/transfer",
            new {targetWorkspace="company",move=false}));
        long duplicatedGeneral=same.GetProperty("id").GetInt64();
        Assert(duplicatedGeneral!=general &&
            same.GetProperty("versions").GetInt32()==2,
            "same-workspace general duplicate retains two revisions");
        var sameLinks=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/company/folders/{duplicatedGeneral}/links");
        long duplicateFile=sameLinks[0].GetProperty("fileId").GetInt64();
        Assert(duplicateFile!=generalFile &&
            (await client.GetByteArrayAsync(
            $"/api/v2/files/company/{duplicateFile}/versions/2/download"))
                .SequenceEqual(generalRevision),
            "general clone has independent logical file history");
        var moved=await Json(await client.PostAsJsonAsync(
            $"/api/v2/ui/general/company/{general}/transfer",
            new {targetWorkspace="personal",move=true}));
        long movedId=moved.GetProperty("id").GetInt64();
        Assert(moved.GetProperty("versions").GetInt32()==2 &&
            moved.GetProperty("newObjects").GetInt32()==2,
            "cross-workspace general move must clone every immutable object");
        using(var missing=await client.GetAsync(
            $"/api/v2/folders/company/general/{general}"))
            Assert(missing.StatusCode==System.Net.HttpStatusCode.NotFound,
                "moving general record soft-deletes only the source record");
        var movedLinks=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/files/personal/folders/{movedId}/links");
        long movedFile=movedLinks[0].GetProperty("fileId").GetInt64();
        Assert(movedFile!=generalFile &&
            (await client.GetByteArrayAsync(
            $"/api/v2/files/personal/{movedFile}/versions/1/download"))
                .SequenceEqual(generalOriginal) &&
            (await client.GetByteArrayAsync(
            $"/api/v2/files/personal/{movedFile}/versions/2/download"))
                .SequenceEqual(generalRevision),
            "general cross-workspace copy is isolated and preserves full history");

        var certificateIds=v.GetProperty("archives").EnumerateArray()
            .Where(x=>x.GetProperty("section").GetString()=="certificate")
            .Select(x=>x.GetProperty("id").GetInt64()).Reverse().ToArray();
        using(var order=await client.PostAsJsonAsync(
            "/api/v2/ui/archive/company/certificate/order",
            new NativeIpUiOrderInput(certificateIds)))
            order.EnsureSuccessStatusCode();
        Console.WriteLine("N2-04 NATIVE ARCHIVE BROWSER SQLCIPHER PASS");
    }
}
