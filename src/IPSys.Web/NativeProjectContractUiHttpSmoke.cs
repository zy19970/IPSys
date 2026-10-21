using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// N2-03-07: the EXISTING project/contract browser view must use one V2 FolderId
// and native FileId, without silently creating old business_projects/contracts.
static class NativeProjectContractUiHttpSmoke
{
    private static void Check(bool okay,string message)
    {
        if(!okay)throw new IOException("N2-03-07 project/contract V2 UI: "+message);
    }
    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }
    private static async Task<JsonElement> Upload(HttpClient client,string route,
        byte[] bytes,string name)
    {
        using var request=new HttpRequestMessage(HttpMethod.Post,route)
        {Content=new ByteArrayContent(bytes)};
        request.Headers.TryAddWithoutValidation("X-File-Name",
            Uri.EscapeDataString(name));
        return await Json(await client.SendAsync(request));
    }
    public static async Task VerifyAsync(HttpClient client,Vault vault)
    {
        string suffix=Guid.NewGuid().ToString("N")[..8];
        string name="V2UI项目"+suffix;
        using(var anonymous=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await anonymous.GetAsync("/api/v2/ui/projects/company"))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,
                "native UI must require unlocked session token");

        var project=await Json(await client.PostAsJsonAsync(
            "/api/v2/folders/company/project",
            new{project=new{name,projectType="科研项目",
                projectNo="N207-"+suffix,leader="负责人",projectStatus="进行中"}}));
        long projectId=project.GetProperty("id").GetInt64();
        var second=await Json(await client.PostAsJsonAsync(
            "/api/v2/folders/company/project",
            new{project=new{name="第二项目"+suffix,projectType="横向项目"}}));
        long secondId=second.GetProperty("id").GetInt64();
        var contract=await Json(await client.PostAsJsonAsync(
            "/api/v2/folders/company/contract",
            new{parentId=projectId,contract=new{
                name="本项目合同"+suffix,contractNo="CT-"+suffix,
                amount="2100.50",remarks="合同备注"}}));
        long contractId=contract.GetProperty("id").GetInt64();

        /* 归属项目有三个等价写法：顶层 parentId、顶层 projectId、contract.projectId。
           最后一种是把 GET /api/v2/ui/contracts 的对象原样回传时的形状，旧实现
           会把它静默丢掉再回一句"合同父级不符合要求"。 */
        var nestedOwner=await Json(await client.PostAsJsonAsync(
            "/api/v2/folders/company/contract",
            new{contract=new{name="嵌套归属合同"+suffix,projectId=secondId}}));
        long nestedId=nestedOwner.GetProperty("id").GetInt64();
        var aliasedOwner=await Json(await client.PostAsJsonAsync(
            "/api/v2/folders/company/contract",
            new{projectId=secondId,contract=new{name="顶层别名合同"+suffix}}));
        long aliasedId=aliasedOwner.GetProperty("id").GetInt64();
        var owned=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/contracts/company");
        Check(owned.EnumerateArray().Count(x=>
                (x.GetProperty("id").GetInt64()==nestedId||
                 x.GetProperty("id").GetInt64()==aliasedId) &&
                x.GetProperty("projectId").GetInt64()==secondId)==2,
              "contract owner accepts parentId, projectId and contract.projectId alike");

        /* 真正的归属只存在 folders.parent_id。属性 JSON 里再存一份就会漂移：
           改了 parent_id 却留下旧 projectId，导出层级和项目汇总会对不上。 */
        using(var raw=vault.Db.CreateCommand())
        {
            raw.CommandText="""
                SELECT attributes_json FROM folders
                WHERE workspace='company' AND kind='contract' AND id IN ($a,$b);
                """;
            raw.Parameters.AddWithValue("$a",nestedId);
            raw.Parameters.AddWithValue("$b",aliasedId);
            int rows=0;
            using var rd=raw.ExecuteReader();
            while(rd.Read())
            {
                rows++;
                Check(!rd.GetString(0).Contains("projectId",StringComparison.Ordinal),
                    "projectId must never be persisted inside attributes_json");
            }
            Check(rows==2,"both aliased contracts must exist in the folders table");
        }

        using(var conflict=await client.PostAsJsonAsync(
            "/api/v2/folders/company/contract",
            new{parentId=projectId,projectId=secondId,contract=new{name="归属矛盾"+suffix}}))
        {
            string text=await conflict.Content.ReadAsStringAsync();
            Check(conflict.StatusCode==HttpStatusCode.BadRequest&&
                  text.Contains("冲突",StringComparison.Ordinal),
                "contradictory owner fields must be rejected with both values named");
        }
        using(var orphan=await client.PostAsJsonAsync(
            "/api/v2/folders/company/contract",
            new{contract=new{name="无归属"+suffix}}))
        {
            string text=await orphan.Content.ReadAsStringAsync();
            Check(orphan.StatusCode==HttpStatusCode.BadRequest&&
                  text.Contains("parentId",StringComparison.Ordinal),
                "an ownerless contract must name the field that fixes it");
        }

        /* 读-改-写是正常用法：归属一致时要接受，真的想换项目才拒绝。 */
        using(var rewrite=await client.PutAsJsonAsync(
            $"/api/v2/folders/company/contract/{contractId}",
            new{contract=new{name="本项目合同"+suffix,contractNo="CT-"+suffix,
                amount="2100.50",remarks="合同备注",projectId=projectId}}))
            Check(rewrite.StatusCode==HttpStatusCode.OK,
                "round-tripping an unchanged projectId must not be treated as a move");
        using(var moved=await client.PutAsJsonAsync(
            $"/api/v2/folders/company/contract/{contractId}",
            new{contract=new{name="本项目合同"+suffix,projectId=secondId}}))
        {
            string text=await moved.Content.ReadAsStringAsync();
            Check(moved.StatusCode==HttpStatusCode.BadRequest&&
                  text.Contains("不能更换所属项目",StringComparison.Ordinal),
                "moving a contract to another project must be refused");
        }

        var projects=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/projects/company");
        var visibleProject=projects.EnumerateArray().FirstOrDefault(x=>
            x.GetProperty("id").GetInt64()==projectId);
        Check(visibleProject.ValueKind==JsonValueKind.Object &&
              visibleProject.GetProperty("projectType").GetString()=="科研项目" &&
              visibleProject.GetProperty("projectNo").GetString()=="N207-"+suffix,
              "native project is same V2 FolderId and business fields");
        var contracts=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/contracts/company");
        var visibleContract=contracts.EnumerateArray().FirstOrDefault(x=>
            x.GetProperty("id").GetInt64()==contractId);
        Check(visibleContract.ValueKind==JsonValueKind.Object &&
              visibleContract.GetProperty("projectId").GetInt64()==projectId &&
              visibleContract.GetProperty("projectName").GetString()==name &&
              visibleContract.GetProperty("amount").GetString()=="2100.50",
              "contract is children-only and uses real V2 parent FolderId");

        byte[] source=RandomNumberGenerator.GetBytes(4083);
        byte[] revised=RandomNumberGenerator.GetBytes(153);
        long projectFile=(await Upload(client,
            $"/api/v2/files/company/upload?folderId={projectId}",source,
            "项目原件"+suffix+".pdf")).GetProperty("fileId").GetInt64();
        long contractFile=(await Upload(client,
            $"/api/v2/files/company/upload?folderId={contractId}",source,
            "合同原件"+suffix+".pdf")).GetProperty("fileId").GetInt64();
        await Upload(client,$"/api/v2/files/company/{contractFile}/versions",revised,
            "合同修订"+suffix+".pdf");
        var files=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/project-files/company");
        var fProject=files.EnumerateArray().FirstOrDefault(x=>
            x.GetProperty("fileId").GetInt64()==projectFile);
        var fContract=files.EnumerateArray().Where(x=>
            x.GetProperty("fileId").GetInt64()==contractFile).ToArray();
        Check(fProject.ValueKind==JsonValueKind.Object &&
              fProject.GetProperty("kind").GetString()=="project" &&
              fProject.GetProperty("folderId").GetInt64()==projectId &&
              fContract.Length==2 &&
              fContract.All(x=>x.GetProperty("kind").GetString()=="contract" &&
                  x.GetProperty("folderId").GetInt64()==contractId),
              "native project and contract attachments own their actual FolderId/versions");
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/company/{contractFile}/versions/1/download"))
             .SequenceEqual(source) &&
              (await client.GetByteArrayAsync(
            $"/api/v2/files/company/{contractFile}/versions/2/download"))
             .SequenceEqual(revised),
              "both encrypted file version bytes survive roundtrip");

        var duplicate=await Json(await client.PostAsync(
            $"/api/v2/ui/contracts/company/{contractId}/copy",null));
        long copiedContract=duplicate.GetProperty("id").GetInt64();
        Check(copiedContract!=contractId,
            "duplicated contract has independent V2 FolderId");
        var afterCopy=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/project-files/company");
        Check(afterCopy.EnumerateArray().Count(x=>
                x.GetProperty("fileId").GetInt64()==contractFile &&
                x.GetProperty("folderId").GetInt64()==copiedContract)==2,
            "duplicated contract links same immutable FileId with two versions");
        using(var order=await client.PostAsJsonAsync(
            "/api/v2/ui/order/company/project",
            new {ids=new[]{secondId,projectId}}))
            order.EnsureSuccessStatusCode();
        projects=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/projects/company");
        var selected=projects.EnumerateArray().Where(x=>
            x.GetProperty("id").GetInt64()==secondId ||
            x.GetProperty("id").GetInt64()==projectId).ToArray();
        Check(Array.FindIndex(selected,x=>x.GetProperty("id").GetInt64()==secondId)
              < Array.FindIndex(selected,x=>x.GetProperty("id").GetInt64()==projectId),
            "native list follows stored Folder.position");
        using(var mismatch=await client.PostAsJsonAsync(
            "/api/v2/ui/order/company/contract",
            new{ids=new[]{contractId,contractId}}))
            Check(mismatch.StatusCode==HttpStatusCode.Conflict,
                "duplicate FolderIds must be rejected");

        using(var invalid=await client.PostAsJsonAsync(
            "/api/v2/folders/personal/contract",
            new{parentId=projectId,contract=new{name="越权合同"}}))
            Check(invalid.StatusCode is HttpStatusCode.NotFound
                or HttpStatusCode.BadRequest or HttpStatusCode.Conflict,
                "cannot create contract under project from another workspace");
        using(var deleted=await client.DeleteAsync(
            $"/api/v2/folders/company/project/{projectId}"))
            deleted.EnsureSuccessStatusCode();
        contracts=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/contracts/company");
        Check(!contracts.EnumerateArray().Any(x=>
            x.GetProperty("id").GetInt64()==contractId),
            "deleted project hides all child contracts");
        using(var restore=await client.PostAsync(
            $"/api/v2/folders/company/project/{projectId}/restore",null))
            restore.EnsureSuccessStatusCode();
        contracts=await client.GetFromJsonAsync<JsonElement>(
            "/api/v2/ui/contracts/company");
        Check(contracts.EnumerateArray().Any(x=>
            x.GetProperty("id").GetInt64()==contractId),
            "restored parent re-exposes exact same contract identity");
        Check((await client.GetByteArrayAsync(
            $"/api/v2/files/company/{contractFile}/versions/1/download"))
            .SequenceEqual(source),"folder restore must preserve file history");
        Console.WriteLine("N2-03-07 PROJECT CONTRACT V2 UI HTTP SQLCIPHER PASS");
    }
}
