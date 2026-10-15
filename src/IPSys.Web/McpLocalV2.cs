using System.Text.Json;
using System.Text.Json.Nodes;

// N2-03-01: V2-namespaced MCP CRUD. The MCP pipe still enforces explicit
// user authorization and sends requests to the same local authenticated host.
// No legacy SQL tables are written by any v2_* tool.
static partial class McpLocal
{
    private static string V2Url(string workspace,string kind,long? id=null) =>
        "/api/v2/folders/"+workspace+"/"+kind+(id.HasValue?"/"+id.Value:"");

    private static JsonObject NativePayload(string kind,JsonObject properties,
        long? parentId=null)
    {
        var result=new JsonObject();
        result[kind]=properties;
        if(parentId.HasValue)result["parentId"]=parentId.Value;
        return result;
    }
    private static async Task<JsonObject> NativeCurrentAsync(HttpClient client,
        string workspace,string kind,long id)
    {
        var result=await RequestAsync(client,HttpMethod.Get,V2Url(workspace,kind,id));
        if(result is not JsonObject snapshot ||
           snapshot["businessData"] is not JsonObject properties)
            throw new IOException("V2 资源业务属性格式无效。");
        return properties;
    }
    private static JsonObject NativePatch(JsonObject stored,JsonElement args,
        Dictionary<string,string> mapping)
    {
        var payload=new JsonObject();
        foreach(var property in mapping.Values.Distinct())
            payload[property]=stored[property]?.DeepClone();
        return Patch(payload,args,mapping);
    }
    private static async Task<JsonNode> ExecuteNativeAsync(HttpClient client,
        string workspace,string name,JsonElement args)
    {
        switch(name)
        {
            case "list_projects":
                return await RequestAsync(client,HttpMethod.Get,V2Url(workspace,"project"));
            case "list_contracts":
                return await RequestAsync(client,HttpMethod.Get,V2Url(workspace,"contract"));
            case "list_ips":
                return await RequestAsync(client,HttpMethod.Get,V2Url(workspace,"ip"));
            case "create_project":
            {
                if(string.IsNullOrWhiteSpace(ReadString(args,"name")) ||
                   string.IsNullOrWhiteSpace(ReadString(args,"project_type")))
                    throw new IOException("项目名称和项目类型不能为空。");
                return await RequestAsync(client,HttpMethod.Post,V2Url(workspace,"project"),
                    NativePayload("project",Patch(new JsonObject(),args,ProjectFields)));
            }
            case "update_project":
            {
                long id=ReadId(args,"project_id");
                var data=await NativeCurrentAsync(client,workspace,"project",id);
                return await RequestAsync(client,HttpMethod.Put,V2Url(workspace,"project",id),
                    NativePayload("project",NativePatch(data,args,ProjectFields)));
            }
            case "delete_project":
                return await RequestAsync(client,HttpMethod.Delete,
                    V2Url(workspace,"project",ReadId(args,"project_id")));
            case "create_contract":
            {
                long parentId=ReadId(args,"project_id");
                if(string.IsNullOrWhiteSpace(ReadString(args,"name")))
                    throw new IOException("合同名称不能为空。");
                return await RequestAsync(client,HttpMethod.Post,V2Url(workspace,"contract"),
                    NativePayload("contract",Patch(new JsonObject(),args,ContractFields),
                        parentId));
            }
            case "delete_contract":
                return await RequestAsync(client,HttpMethod.Delete,
                    V2Url(workspace,"contract",ReadId(args,"contract_id")));
            case "create_ip":
            {
                if(string.IsNullOrWhiteSpace(ReadString(args,"name")) ||
                   string.IsNullOrWhiteSpace(ReadString(args,"ip_type")))
                    throw new IOException("知识产权名称和类型不能为空。");
                return await RequestAsync(client,HttpMethod.Post,V2Url(workspace,"ip"),
                    NativePayload("ip",Patch(new JsonObject(),args,IpFields)));
            }
            case "update_ip":
            {
                long id=ReadId(args,"ip_id");
                var data=await NativeCurrentAsync(client,workspace,"ip",id);
                return await RequestAsync(client,HttpMethod.Put,V2Url(workspace,"ip",id),
                    NativePayload("ip",NativePatch(data,args,IpFields)));
            }
            case "delete_ip":
                return await RequestAsync(client,HttpMethod.Delete,
                    V2Url(workspace,"ip",ReadId(args,"ip_id")));
            default:
                throw new IOException("尚未提供 V2 MCP 操作："+name);
        }
    }
}
