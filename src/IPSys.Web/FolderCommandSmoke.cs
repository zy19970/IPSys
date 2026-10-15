using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// R1-04-02 first batch: legacy stores and common Folder CRUD share the same encrypted
// database, session checks, validation, and recycle-bin restoration.
static class FolderCommandSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool ok, string reason)
        {
            if (!ok) throw new IOException("Folder command HTTP smoke failed: " + reason);
        }

        string unique = Guid.NewGuid().ToString("N")[..8];
        string prefix = "/api/folders/company/";
        var projectInput = new ProjectInput("统一项目-"+unique, "科研项目", "P-"+unique,
            null, null, null, null, null, null, "项目备注", null);
        var contractInput = new ContractInput("统一合同-"+unique, "C-"+unique,
            null, "28.5", null, null, "合同备注", null);
        var ipInput = new IpInput("统一知识产权-"+unique, "发明专利", "已申请",
            null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, "专利备注", null);
        static async Task<long> Created(HttpResponseMessage response)
        {
            using (response)
            {
                response.EnsureSuccessStatusCode();
                var data = await response.Content.ReadFromJsonAsync<JsonElement>();
                return data.GetProperty("id").GetInt64();
            }
        }
        using (var noToken = new HttpClient { BaseAddress = client.BaseAddress })
        {
            using var denied = await noToken.PostAsJsonAsync(
                prefix+"project", new FolderMutationInput(Project: projectInput));
            Check(denied.StatusCode == HttpStatusCode.Unauthorized,
                "create without session");
        }
        long projectId = await Created(await client.PostAsJsonAsync(
            prefix+"project", new FolderMutationInput(Project: projectInput)));
        using (var oldGet = await client.GetAsync("/api/projects/company"))
        {
            oldGet.EnsureSuccessStatusCode();
            var rows = await oldGet.Content.ReadFromJsonAsync<List<ProjectView>>();
            Check(rows!.Any(x=>x.Id==projectId && x.ProjectNo=="P-"+unique),
                "common insert visible through legacy project API");
        }
        using (var noParent = await client.PostAsJsonAsync(
            prefix+"contract", new FolderMutationInput(Contract: contractInput)))
            Check(noParent.StatusCode == HttpStatusCode.BadRequest,
                "contract without parent denied");
        using (var badParent = await client.PostAsJsonAsync(
            prefix+"contract", new FolderMutationInput(Contract: contractInput,
                ParentId: 99999999)))
            Check(badParent.StatusCode == HttpStatusCode.NotFound,
                "nonexistent contract parent denied");
        using (var personalParent = await client.PostAsJsonAsync(
            "/api/folders/personal/contract",
            new FolderMutationInput(Contract: contractInput, ParentId: projectId)))
            Check(personalParent.StatusCode == HttpStatusCode.NotFound,
                "cross-workspace contract parent denied");

        long contractId = await Created(await client.PostAsJsonAsync(
            prefix+"contract", new FolderMutationInput(Contract: contractInput,
                ParentId: projectId)));
        var projectUpdated = projectInput with {Name = "统一项目修改-"+unique};
        using (var edited = await client.PutAsJsonAsync(
            prefix+$"project/{projectId}", new FolderMutationInput(Project: projectUpdated)))
            edited.EnsureSuccessStatusCode();
        var contractUpdated = contractInput with {Amount="0"};
        using (var edited = await client.PutAsJsonAsync(
            prefix+$"contract/{contractId}", new FolderMutationInput(Contract: contractUpdated)))
            edited.EnsureSuccessStatusCode();
        using (var moved = await client.PutAsJsonAsync(
            prefix+$"contract/{contractId}",
            new FolderMutationInput(Contract: contractUpdated, ParentId: projectId)))
            Check(moved.StatusCode == HttpStatusCode.BadRequest,
                "parent transfer is not a CRUD edit");
        using (var wrong = await client.PutAsJsonAsync(
            prefix+$"contract/{contractId}", new FolderMutationInput(Project: projectUpdated)))
            Check(wrong.StatusCode == HttpStatusCode.BadRequest,
                "business payload must match kind");
        using (var badValidation = await client.PostAsJsonAsync(
            prefix+"project", new FolderMutationInput(Project: projectInput with { ProjectType="无效" })))
            Check(badValidation.StatusCode == HttpStatusCode.BadRequest,
                "existing project type validation retained");
        using (var wrongWorkspace = await client.PutAsJsonAsync(
            $"/api/folders/personal/project/{projectId}",
            new FolderMutationInput(Project: projectUpdated)))
            Check(wrongWorkspace.StatusCode == HttpStatusCode.NotFound,
                "project write requires matching workspace");

        long ipId = await Created(await client.PostAsJsonAsync(
            prefix+"ip", new FolderMutationInput(Ip: ipInput)));
        var ipUpdated = ipInput with {Status="已授权"};
        using (var edited = await client.PutAsJsonAsync(
            prefix+$"ip/{ipId}", new FolderMutationInput(Ip: ipUpdated)))
            edited.EnsureSuccessStatusCode();
        using (var wrongScope = await client.DeleteAsync($"/api/folders/personal/ip/{ipId}"))
            Check(wrongScope.StatusCode == HttpStatusCode.NotFound,
                "IP delete workspace isolated");
        using (var unsupported = await client.PostAsJsonAsync(
            prefix+"general", new FolderMutationInput(Project: projectInput)))
            Check(unsupported.StatusCode == HttpStatusCode.BadRequest,
                "archive writes wait for next batch");

        using (var deleted = await client.DeleteAsync(prefix+$"contract/{contractId}"))
            deleted.EnsureSuccessStatusCode();
        using (var missing = await client.GetAsync(
            $"/api/folders/company/detail/contract/{contractId}"))
            Check(missing.StatusCode == HttpStatusCode.NotFound, "deleted contract hidden");
        using (var restored = await client.PostAsync(
            prefix+$"contract/{contractId}/restore", null))
            restored.EnsureSuccessStatusCode();

        using (var deleted = await client.DeleteAsync(prefix+$"ip/{ipId}"))
            deleted.EnsureSuccessStatusCode();
        using (var restored = await client.PostAsync(prefix+$"ip/{ipId}/restore", null))
            restored.EnsureSuccessStatusCode();
        using (var legacy = await client.GetAsync("/api/ip/company"))
        {
            legacy.EnsureSuccessStatusCode();
            var ips = await legacy.Content.ReadFromJsonAsync<List<IpView>>();
            Check(ips!.Any(x=>x.Id==ipId && x.Data.Status=="已授权"),
                "IP write and restore through legacy API");
        }
        using (var deleted = await client.DeleteAsync(prefix+$"project/{projectId}"))
            deleted.EnsureSuccessStatusCode();
        using (var forbiddenRestore = await client.PostAsync(
            prefix+$"contract/{contractId}/restore",null))
            Check(forbiddenRestore.StatusCode == HttpStatusCode.NotFound,
                "contract restore cannot bypass deleted project");
        using (var restored = await client.PostAsync(
            prefix+$"project/{projectId}/restore", null))
            restored.EnsureSuccessStatusCode();
        using (var legacy = await client.GetAsync("/api/contracts/company"))
        {
            legacy.EnsureSuccessStatusCode();
            var contracts = await legacy.Content.ReadFromJsonAsync<List<ContractView>>();
            Check(contracts!.Any(x => x.Id==contractId &&
                x.ProjectId==projectId && x.Amount=="0"),
                "contract preserved under restored project");
        }
        Console.WriteLine("FOLDER COMMAND HTTP SMOKE PASS: project/contract/IP CRUD and restore");
    }
}
