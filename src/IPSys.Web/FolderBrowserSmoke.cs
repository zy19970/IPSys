using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// R1-04-01: HTTP authorization, workspace isolation, parent validation,
// archive interleaving and persisted order through the disposable SQLCipher web smoke vault.
static class FolderBrowserSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool success, string reason)
        {
            if (!success) throw new IOException("Folder browser HTTP smoke: " + reason);
        }
        static async Task<JsonElement> Json(HttpClient client, string url)
        {
            using var response = await client.GetAsync(url);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
        static bool Has(JsonElement rows, string kind, long id) =>
            rows.EnumerateArray().Any(x =>
                x.GetProperty("ref").GetProperty("kind").GetString() == kind &&
                x.GetProperty("ref").GetProperty("id").GetInt64() == id);

        var denied = await new HttpClient { BaseAddress = client.BaseAddress }
            .GetAsync("/api/folders/company/children?scope=project");
        Check(denied.StatusCode == HttpStatusCode.Unauthorized, "anonymous browse must fail");
        var unique = Guid.NewGuid().ToString("N")[..8];
        using var projectAdded = await client.PostAsJsonAsync("/api/projects/company",
            new ProjectInput("树导航项目-"+unique, "科研项目", "TREE-"+unique, null,
                null, null, null, null, null, null, null));
        projectAdded.EnsureSuccessStatusCode();
        long projectId = (await projectAdded.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();
        using var contractAdded = await client.PostAsJsonAsync(
            $"/api/projects/company/{projectId}/contracts",
            new ContractInput("树导航合同-"+unique, "TREE-C-"+unique, null,
                "20.00", null, null, null, null));
        contractAdded.EnsureSuccessStatusCode();
        long contractId = (await contractAdded.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();

        var projects = await Json(client, "/api/folders/company/children?scope=project");
        Check(Has(projects, FolderKinds.Project, projectId), "project virtual root");
        var contracts = await Json(client,
            $"/api/folders/company/children?scope=project&parentKind=project&parentId={projectId}");
        Check(contracts.GetArrayLength() == 1 && Has(contracts, FolderKinds.Contract, contractId),
            "project contains its actual contract");
        var contractDetail = await Json(client,
            $"/api/folders/company/detail/contract/{contractId}");
        Check(contractDetail.GetProperty("folder").GetProperty("parent")
                .GetProperty("id").GetInt64() == projectId &&
              contractDetail.GetProperty("businessData").GetProperty("contractNo")
                .GetString() == "TREE-C-"+unique,
            "contract detail preserves parent and business fields");
        Check((await client.GetAsync(
            $"/api/folders/personal/detail/contract/{contractId}")).StatusCode ==
              HttpStatusCode.NotFound, "contract cross-workspace isolation");
        Check((await client.GetAsync(
            "/api/folders/invalid/children?scope=project")).StatusCode ==
              HttpStatusCode.BadRequest, "invalid workspace");
        Check((await client.GetAsync(
            "/api/folders/company/children?scope=contract")).StatusCode ==
              HttpStatusCode.BadRequest, "orphan contracts not browsable");
        Check((await client.GetAsync(
            "/api/folders/company/children?scope=project&parentKind=project")).StatusCode ==
              HttpStatusCode.BadRequest, "partial parent reference");
        Check((await client.GetAsync(
            "/api/folders/company/children?scope=project&parentKind=project&parentId=999999999"))
              .StatusCode == HttpStatusCode.NotFound, "missing project parent");
        Check((await client.GetAsync(
            $"/api/folders/company/children?scope=project&parentKind=contract&parentId={contractId}"))
              .StatusCode == HttpStatusCode.BadRequest, "contract cannot be a project parent");
        Check((await client.GetAsync(
            $"/api/folders/personal/children?scope=project&parentKind=project&parentId={projectId}"))
              .StatusCode == HttpStatusCode.NotFound, "parent must exist in requested workspace");

        var rootRows = await client.GetFromJsonAsync<List<ArchiveFolderView>>("/api/archive-folders");
        var root = rootRows!.First(x => x.Name == "申报与认定" && x.ParentId is null);
        var archiveRoot = await Json(client,
            "/api/folders/company/children?scope=archive&section=achievement");
        Check(Has(archiveRoot, FolderKinds.ArchiveFolder, root.Id),
            "archive category appears under virtual module root");
        using var categoryAdded = await client.PostAsJsonAsync("/api/archive-folders",
            new ArchiveFolderInput("导航分类-"+unique, root.Id));
        categoryAdded.EnsureSuccessStatusCode();
        long categoryId = (await categoryAdded.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();
        using var childAdded = await client.PostAsJsonAsync("/api/archive-folders",
            new ArchiveFolderInput("导航子分类-"+unique, categoryId));
        childAdded.EnsureSuccessStatusCode();
        long childId = (await childAdded.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();
        using var archiveAdded = await client.PostAsJsonAsync(
            "/api/archives/company/achievement",
            new ArchiveInput("导航资料-"+unique, null, "归档备注", null,
                Year: "2026", FolderId: categoryId));
        archiveAdded.EnsureSuccessStatusCode();
        long archiveId = (await archiveAdded.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();

        string categoryUrl =
            $"/api/folders/company/children?scope=archive&section=achievement"+
            $"&parentKind=archive_folder&parentId={categoryId}";
        var children = await Json(client, categoryUrl);
        Check(children.GetArrayLength() == 2 &&
              Has(children, FolderKinds.ArchiveFolder, childId) &&
              Has(children, FolderKinds.Archive, archiveId),
            "folder and archive record are peers");
        var archiveDetail = await Json(client,
            $"/api/folders/company/detail/archive/{archiveId}?section=achievement");
        Check(archiveDetail.GetProperty("folder").GetProperty("parent").GetProperty("id")
                .GetInt64() == categoryId &&
              archiveDetail.GetProperty("businessData").GetProperty("year").GetString() == "2026",
            "archive detail retains date and parent");
        using var reordered = await client.PostAsJsonAsync("/api/archive-entry-order",
            new ArchiveEntryReorder(categoryId, [
                new ArchiveEntryOrderItem("record", archiveId),
                new ArchiveEntryOrderItem("folder", childId)]));
        reordered.EnsureSuccessStatusCode();
        var ordered = await Json(client, categoryUrl);
        Check(ordered[0].GetProperty("ref").GetProperty("kind").GetString() ==
              FolderKinds.Archive && ordered[0].GetProperty("position").GetInt32() == 0 &&
              ordered[1].GetProperty("ref").GetProperty("kind").GetString() ==
              FolderKinds.ArchiveFolder && ordered[1].GetProperty("position").GetInt32() == 1,
            "persisted order interleaves records before folders");
        Check((await client.GetAsync(
            $"/api/folders/personal/children?scope=archive&section=achievement"+
            $"&parentKind=archive_folder&parentId={categoryId}")).StatusCode ==
              HttpStatusCode.BadRequest, "company archive directory cannot be read in personal");
        Check((await client.GetAsync(
            "/api/folders/company/children?scope=archive&section=academic")).StatusCode ==
              HttpStatusCode.BadRequest, "invalid company academic module");
        Check((await client.GetAsync(
            $"/api/folders/company/children?scope=archive&section=achievement"+
            $"&parentKind=project&parentId={projectId}")).StatusCode ==
              HttpStatusCode.BadRequest, "archive folder cannot be nested under project");

        var companyCert = await Json(client,
            "/api/folders/company/children?scope=archive&section=certificate");
        var existingCerts = await client.GetFromJsonAsync<List<ArchiveView>>(
            "/api/archives/company/certificate");
        Check(existingCerts!.All(cert => Has(companyCert, FolderKinds.Archive, cert.Id)),
            "company certificate root retains all certificate records");
        var personalAcademic = await Json(client,
            "/api/folders/personal/children?scope=archive&section=academic");
        var academicRows = await client.GetFromJsonAsync<List<ArchiveView>>(
            "/api/archives/personal/academic");
        Check(academicRows!.All(row => Has(personalAcademic, FolderKinds.Archive, row.Id)),
            "personal academic module remains independent");
        var general = await Json(client,
            "/api/folders/company/children?scope=general");
        var allGeneral = await client.GetFromJsonAsync<List<RecordView>>("/api/records/company");
        Check(allGeneral!.All(x => Has(general, FolderKinds.General, x.Id)),
            "general records can be browsed as folders");
        Check((await client.GetAsync(
            "/api/folders/company/children?scope=general&parentKind=project&parentId=1"))
              .StatusCode == HttpStatusCode.BadRequest, "general arbitrary nesting rejected");

        using var deleted = await client.DeleteAsync($"/api/projects/company/{projectId}");
        deleted.EnsureSuccessStatusCode();
        Check((await client.GetAsync(
            $"/api/folders/company/children?scope=project&parentKind=project&parentId={projectId}"))
              .StatusCode == HttpStatusCode.NotFound, "deleted parent is not navigable");
        Check((await client.GetAsync(
            $"/api/folders/company/detail/contract/{contractId}")).StatusCode ==
              HttpStatusCode.NotFound, "contract under deleted project hidden");
        Console.WriteLine("FOLDER BROWSER HTTP SMOKE PASS: workspace, parents, sorting and auth");
    }
}
