using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// R1-04-03-01: verify new and legacy HTTP transfer endpoints using one disposable
// SQLCipher vault, including project-child copies and complete file version chains.
static class FolderTransferHttpSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool ok, string message)
        {
            if (!ok) throw new IOException("Folder transfer HTTP smoke failed: " + message);
        }
        static async Task<long> NewId(HttpResponseMessage response)
        {
            using (response)
            {
                response.EnsureSuccessStatusCode();
                return (await response.Content.ReadFromJsonAsync<JsonElement>())
                    .GetProperty("id").GetInt64();
            }
        }
        static async Task<List<BusinessFileView>> Files(HttpClient client, string workspace)
            => await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/"+workspace) ?? [];
        static async Task Upload(HttpClient client, string workspace,
            string kind, long id, byte[] bytes, string name)
        {
            using var request=new HttpRequestMessage(HttpMethod.Post,
                $"/api/business-files/{workspace}/{kind}/{id}")
                {Content=new ByteArrayContent(bytes)};
            request.Headers.Add("X-File-Name",Uri.EscapeDataString(name));
            request.Headers.Add("X-Upload-Mode","update");
            using var response=await client.SendAsync(request);
            response.EnsureSuccessStatusCode();
        }
        static async Task CheckVersions(HttpClient client, string workspace, string kind,
            long owner, string name, byte[][] original)
        {
            var versions=(await Files(client,workspace))
                .Where(x=>x.Kind==kind && x.OwnerId==owner && x.Name==name)
                .OrderBy(x=>x.Version).ToArray();
            Check(versions.Length==original.Length, "attachment version count");
            Check(versions.Select(x=>x.Version).SequenceEqual(
                Enumerable.Range(1,original.Length)), "attachment version numbers preserved");
            Check(versions.All(x=>x.GroupId==versions[0].GroupId),
                "version chain remains one logical file");
            for(int i=0;i<original.Length;i++)
            {
                Check(versions[i].Sha256==Convert.ToHexString(SHA256.HashData(original[i])),
                    "attachment hash retained");
                using var response=await client.GetAsync(
                    $"/api/business-files/{workspace}/download/{versions[i].Id}");
                response.EnsureSuccessStatusCode();
                Check((await response.Content.ReadAsByteArrayAsync()).SequenceEqual(original[i]),
                    "attachment source bytes retained");
            }
        }

        string token=Guid.NewGuid().ToString("N")[..8];
        const string source="/api/folders/company/";
        var project=new ProjectInput("转移项目-"+token,"科研项目","TR-"+token,
            null,null,null,null,null,null,null,null);
        long projectId=await NewId(await client.PostAsJsonAsync(
            source+"project",new FolderMutationInput(Project:project)));
        long contractId=await NewId(await client.PostAsJsonAsync(
            source+"contract",new FolderMutationInput(ParentId:projectId,
                Contract:new ContractInput("转移合同-"+token,"CTR-"+token,
                    null,"20.00",null,null,null,null))));
        var first=Encoding.UTF8.GetBytes("project version one "+token);
        var second=Encoding.UTF8.GetBytes("project version two "+token);
        var contractBytes=Encoding.UTF8.GetBytes("contract attached "+token);
        await Upload(client,"company","project",projectId,first,"project-"+token+".bin");
        await Upload(client,"company","project",projectId,second,"project-"+token+".bin");
        await Upload(client,"company","contract",contractId,contractBytes,"contract-"+token+".bin");
        await CheckVersions(client,"company","project",projectId,"project-"+token+".bin",
            [first,second]);

        using(var noAuth=new HttpClient{BaseAddress=client.BaseAddress})
        using(var response=await noAuth.PostAsJsonAsync(
            source+$"project/{projectId}/transfer",
            new FolderTransferInput("company",false)))
            Check(response.StatusCode==HttpStatusCode.Unauthorized,"copy needs token");

        using(var bad=await client.PostAsJsonAsync(
            source+$"project/{projectId}/transfer",
            new FolderTransferInput("invalid",false)))
            Check(bad.StatusCode==HttpStatusCode.BadRequest,"target workspace validated");
        using(var bad=await client.PostAsJsonAsync(
            source+$"project/{projectId}/transfer",
            new FolderTransferInput("company",true)))
            Check(bad.StatusCode==HttpStatusCode.BadRequest,"same workspace move rejected");
        using(var bad=await client.PostAsJsonAsync(
            source+$"contract/{contractId}/transfer",
            new FolderTransferInput("personal",false)))
            Check(bad.StatusCode==HttpStatusCode.BadRequest,
                "standalone contract cannot cross workspaces");
        using(var bad=await client.PostAsJsonAsync(
            source+$"contract/{contractId}/transfer",
            new FolderTransferInput("company",true)))
            Check(bad.StatusCode==HttpStatusCode.BadRequest,
                "contract cannot be independently moved");

        long copiedContract=await NewId(await client.PostAsJsonAsync(
            source+$"contract/{contractId}/transfer",
            new FolderTransferInput("company",false)));
        var contracts=await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company");
        Check(contracts!.Any(x=>x.Id==copiedContract && x.ProjectId==projectId),
            "contract copy retains original project");
        await CheckVersions(client,"company","contract",copiedContract,
            "contract-"+token+".bin",[contractBytes]);

        long clonedProject=await NewId(await client.PostAsJsonAsync(
            source+$"project/{projectId}/transfer",
            new FolderTransferInput("company",false)));
        contracts=await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company");
        var cloneChildren=contracts!.Where(x=>x.ProjectId==clonedProject).ToArray();
        Check(cloneChildren.Length==2 && cloneChildren.All(x=>x.ProjectId!=projectId),
            "project copy clones all contracts and re-parents to new project");
        await CheckVersions(client,"company","project",clonedProject,
            "project-"+token+".bin",[first,second]);

        long movedProject=await NewId(await client.PostAsJsonAsync(
            source+$"project/{projectId}/transfer",
            new FolderTransferInput("personal",true)));
        var companyProjects=await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/company");
        var personalProjects=await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/personal");
        Check(!companyProjects!.Any(x=>x.Id==projectId) &&
              personalProjects!.Any(x=>x.Id==movedProject),
            "cross-workspace move hides source and creates target");
        var personalContracts=await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/personal");
        var transferredContracts=personalContracts!.Where(x=>x.ProjectId==movedProject &&
            x.ContractNo=="CTR-"+token).ToArray();
        Check(transferredContracts.Length==2,
            "project move copies every original and duplicated child contract");
        await CheckVersions(client,"personal","project",movedProject,
            "project-"+token+".bin",[first,second]);
        foreach(var movedChild in transferredContracts)
            await CheckVersions(client,"personal","contract",movedChild.Id,
                "contract-"+token+".bin",[contractBytes]);
        Check((await Files(client,"company")).All(x=>x.OwnerId!=projectId ||
              x.Kind!="project"),
            "moved project source attachment inaccessible in old workspace");
        using(var bad=await client.PostAsJsonAsync(
            source+$"project/{projectId}/transfer",new FolderTransferInput("personal",false)))
            Check(bad.StatusCode==HttpStatusCode.NotFound,"moved project cannot transfer again");

        var ipInput=new IpInput("转移IP-"+token,"发明专利","已申请",null,null,null,
            null,null,null,null,null,null,null,null,null,null,null,null,null,null);
        long ipId=await NewId(await client.PostAsJsonAsync(
            source+"ip",new FolderMutationInput(Ip:ipInput)));
        byte[] ipBytes=Encoding.UTF8.GetBytes("ip certificate "+token);
        await Upload(client,"company","ip",ipId,ipBytes,"ip-"+token+".bin");
        long cloneIp=await NewId(await client.PostAsJsonAsync(
            source+$"ip/{ipId}/transfer",new FolderTransferInput("company",false)));
        await CheckVersions(client,"company","ip",cloneIp,"ip-"+token+".bin",[ipBytes]);
        long movedIp=await NewId(await client.PostAsJsonAsync(
            $"/api/ip/company/{ipId}/transfer",new IpTransfer("personal",true)));
        await CheckVersions(client,"personal","ip",movedIp,"ip-"+token+".bin",[ipBytes]);
        var personalIps=await client.GetFromJsonAsync<List<IpView>>("/api/ip/personal");
        Check(personalIps!.Any(x=>x.Id==movedIp && x.Data.Name=="转移IP-"+token),
            "legacy IP transfer uses the shared service");
        long oldCopy=await NewId(await client.PostAsJsonAsync(
            $"/api/projects/company/{clonedProject}/transfer",
            new ProjectTransfer("company",false)));
        await CheckVersions(client,"company","project",oldCopy,
            "project-"+token+".bin",[first,second]);
        long oldContractCopy=await NewId(await client.PostAsync(
            $"/api/contracts/company/{copiedContract}/copy",null));
        await CheckVersions(client,"company","contract",oldContractCopy,
            "contract-"+token+".bin",[contractBytes]);

        Console.WriteLine("FOLDER TRANSFER HTTP SMOKE PASS: project, contract, IP and all file versions");
    }
}
