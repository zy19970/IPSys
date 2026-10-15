using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

// N2-03-01: exercise the real MCP named pipe -> authorized local HTTP ->
// SQLCipher V2 Folder service, with zero legacy business table writes.
static class NativeMcpSmoke
{
    private static JsonElement Args(object o)=>JsonSerializer.SerializeToElement(o);
    private static async Task<JsonNode> Call(string name,object input)=>
        await McpLocal.RunSmokeToolAsync("v2_"+name,Args(input));
    private static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("N2-03-01 MCP V2: "+reason);
    }
    private static long Id(JsonNode node)=>
        node["id"]?.GetValue<long>()??throw new IOException("MCP 未返回 V2 ID。");
    private static JsonNode? Find(JsonNode list,long id)=>
        list.AsArray().FirstOrDefault(x=>x?["folder"]?["ref"]?["id"]?.GetValue<long>()==id);
    public static async Task VerifyAsync(HttpClient client)
    {
        var names=McpLocal.Tools().Select(x=>(string)x.GetType()
            .GetProperty("name")!.GetValue(x)!).ToArray();
        string[] native={
            "list_projects","create_project","update_project","delete_project",
            "list_contracts","create_contract","delete_contract",
            "list_ips","create_ip","update_ip","delete_ip"
        };
        Check(native.All(name=>names.Contains("v2_"+name)) &&
              names.Distinct().Count()==names.Length,
              "MCP V2 tool registry has 11 unique business actions");
        Check(names.Contains("upload_files")&&!names.Contains("v2_upload_files"),
              "old file MCP route remains explicit while V2 file upload needs UI choice");
        string suffix=Guid.NewGuid().ToString("N")[..8];
        string name="原生MCP项目"+suffix;
        var created=await Call("create_project",new {
            workspace="company",name,project_type="科研项目",
            project_no="N203-"+suffix,leader="项目负责人"
        });
        long project=Id(created);
        Check(project>0,"created V2 project");
        var list=await Call("list_projects",new{workspace="company"});
        var item=Find(list,project);
        Check(item?["businessData"]?["name"]?.GetValue<string>()==name,
            "V2 MCP project appears in new folder source");
        var old=await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/company");
        Check(old is not null && !old.Any(x=>x.Name==name),
            "V2 MCP create did not double-write legacy business projects");
        await Call("update_project",new{
            workspace="company",project_id=project,
            name="原生MCP已改名"+suffix,remarks="仅更新备注"
        });
        item=Find(await Call("list_projects",new{workspace="company"}),project);
        Check(item?["businessData"]?["name"]?.GetValue<string>()=="原生MCP已改名"+suffix &&
              item?["businessData"]?["projectNo"]?.GetValue<string>()=="N203-"+suffix &&
              item?["businessData"]?["leader"]?.GetValue<string>()=="项目负责人",
              "V2 project partial MCP update preserves other fields");
        bool crossDenied=false;
        try
        {
            await Call("update_project",new{
                workspace="personal",project_id=project,name="错误修改"
            });
        }
        catch(IOException ex)when(ex.Message.Contains("404")){crossDenied=true;}
        Check(crossDenied,"cross-workspace project mutation blocked");

        bool orphanDenied=false;
        try
        {
            await Call("create_contract",new{
                workspace="personal",project_id=project,name="错误归属合同"
            });
        }
        catch(IOException ex)when(ex.Message.Contains("404")){orphanDenied=true;}
        Check(orphanDenied,"contracts must belong to a project in same workspace");
        var contractResult=await Call("create_contract",new{
            workspace="company",project_id=project,
            name="原生MCP合同"+suffix,contract_no="C-"+suffix,amount="1234.00"
        });
        long contract=Id(contractResult);
        var contracts=await Call("list_contracts",new{workspace="company"});
        var contractItem=Find(contracts,contract);
        Check(contractItem?["folder"]?["parent"]?["id"]?.GetValue<long>()==project &&
              contractItem?["businessData"]?["contractNo"]?.GetValue<string>()=="C-"+suffix,
              "V2 MCP contract has actual V2 project parent");

        string patent="原生MCP专利"+suffix;
        long ip=Id(await Call("create_ip",new{
            workspace="company",name=patent,ip_type="发明专利",
            status="实质审查中",application_no="CN202610000002.0",
            remarks="初始说明"
        }));
        var ips=await Call("list_ips",new{workspace="company"});
        Check(Find(ips,ip)?["businessData"]?["applicationNo"]?.GetValue<string>()
              =="CN202610000002.0","MCP V2 IP on native Folder Store");
        await Call("update_ip",new{
            workspace="company",ip_id=ip,name="修改后的"+patent,remarks="新备注"
        });
        ips=await Call("list_ips",new{workspace="company"});
        Check(Find(ips,ip)?["businessData"]?["applicationNo"]?.GetValue<string>()
              =="CN202610000002.0" &&
              Find(ips,ip)?["businessData"]?["remarks"]?.GetValue<string>()=="新备注",
              "IP updates preserve application number");
        var legacyIps=await client.GetFromJsonAsync<List<IpView>>("/api/ip/company");
        Check(legacyIps is not null && !legacyIps.Any(x=>x.Data.Name==patent),
              "IP V2 mutation never double-writes legacy IP");

        await Call("delete_project",new{workspace="company",project_id=project});
        Check(Find(await Call("list_contracts",new{workspace="company"}),contract)==null,
              "project delete hides its V2 contracts");
        using(var restore=await client.PostAsync(
            $"/api/v2/folders/company/project/{project}/restore",null))
            restore.EnsureSuccessStatusCode();
        Check(Find(await Call("list_contracts",new{workspace="company"}),contract)!=null,
            "restoring the parent restores original contract visibility");
        await Call("delete_contract",new{workspace="company",contract_id=contract});
        await Call("delete_ip",new{workspace="company",ip_id=ip});
        Check(Find(await Call("list_contracts",new{workspace="company"}),contract)==null &&
              Find(await Call("list_ips",new{workspace="company"}),ip)==null,
              "MCP V2 soft-deletion correctly removes only native records");
        await Call("delete_project",new{workspace="company",project_id=project});
        Console.WriteLine("N2-03-01 V2 MCP NATIVE SQLCIPHER HTTP SMOKE PASS");
    }
}
