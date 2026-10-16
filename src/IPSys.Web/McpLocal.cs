using System.IO.Pipes;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;

// Local Codex MCP bridge: the Codex-launched --mcp subprocess speaks JSON-RPC
// over stdio. Only the already running WinForms host can execute operations.
// The pipe is restricted to the current Windows user; no password, HTTP token,
// decrypted database, or static TCP listener is exposed to the MCP process.
static partial class McpLocal
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string PipeName = "IPSys-MCP-" +
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName)))[..24];

    private static Dictionary<string,object> Field(string type,string description,string[]? choices=null)
    {
        var result=new Dictionary<string,object>{{"type",type},{"description",description}};
        if(choices!=null)result["enum"]=choices;
        return result;
    }
    private static object Tool(string name,string description,
        Dictionary<string,object> properties,string[] required) =>
        new {name,description,inputSchema=new {
            type="object",properties,required,additionalProperties=false
        }};
    private static readonly string[] Workspaces=["company","personal"];
    internal static object[] Tools()
    {
        object[] legacy=
        [
        Tool("list_projects","列出指定工作区当前有效项目。",new(){
            ["workspace"]=Field("string","工作区：company 公司；personal 个人",Workspaces)
        },["workspace"]),
        Tool("list_ips","查询 V2 知识产权，返回与网页相同 FolderId 的业务详情。",new(){
            ["workspace"]=Field("string","工作区",Workspaces)
        },["workspace"]),
        Tool("create_ip","创建专利或知识产权。知识产权类型和状态按 IPSys 现有约束校验。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["name"]=Field("string","名称"),
            ["ip_type"]=Field("string","知识产权类型",["发明专利","实用新型专利","外观设计专利","软件著作权","其他著作权","商标","集成电路布图设计"]),
            ["status"]=Field("string","状态"),
            ["applicants"]=Field("string","申请人"),
            ["right_holders"]=Field("string","权利人"),
            ["creators"]=Field("string","发明人/设计人/作者"),
            ["application_no"]=Field("string","申请号"),
            ["application_date"]=Field("string","申请日期 yyyy-MM-dd"),
            ["publication_no"]=Field("string","公开号"),
            ["publication_date"]=Field("string","公开日期 yyyy-MM-dd"),
            ["grant_notice_no"]=Field("string","授权公告号"),
            ["grant_notice_date"]=Field("string","公告日期 yyyy-MM-dd"),
            ["publication_info"]=Field("string","公开信息"),
            ["grant_date"]=Field("string","授权日期 yyyy-MM-dd"),
            ["registration_no"]=Field("string","登记号"),
            ["first_published_date"]=Field("string","首次发表日期 yyyy-MM-dd"),
            ["registration_date"]=Field("string","登记日期 yyyy-MM-dd"),
            ["category"]=Field("string","自定义分类"),
            ["remarks"]=Field("string","备注"),
            ["tags"]=Field("string","标签")
        },["workspace","name","ip_type"]),
        Tool("update_ip","按 V2 FolderId 更新知识产权，仅改变明确传入的字段。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["ip_id"]=Field("integer","知识产权 ID"),
            ["name"]=Field("string","名称"),
            ["ip_type"]=Field("string","知识产权类型",["发明专利","实用新型专利","外观设计专利","软件著作权","其他著作权","商标","集成电路布图设计"]),
            ["status"]=Field("string","状态"),
            ["applicants"]=Field("string","申请人"),
            ["right_holders"]=Field("string","权利人"),
            ["creators"]=Field("string","发明人/设计人/作者"),
            ["application_no"]=Field("string","申请号"),
            ["application_date"]=Field("string","申请日期 yyyy-MM-dd"),
            ["publication_no"]=Field("string","公开号"),
            ["publication_date"]=Field("string","公开日期 yyyy-MM-dd"),
            ["grant_notice_no"]=Field("string","授权公告号"),
            ["grant_notice_date"]=Field("string","公告日期 yyyy-MM-dd"),
            ["publication_info"]=Field("string","公开信息"),
            ["grant_date"]=Field("string","授权日期 yyyy-MM-dd"),
            ["registration_no"]=Field("string","登记号"),
            ["first_published_date"]=Field("string","首次发表日期 yyyy-MM-dd"),
            ["registration_date"]=Field("string","登记日期 yyyy-MM-dd"),
            ["category"]=Field("string","自定义分类"),
            ["remarks"]=Field("string","备注"),
            ["tags"]=Field("string","标签")
        },["workspace","ip_id"]),
        Tool("delete_ip","按 V2 FolderId 将知识产权移入回收站。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["ip_id"]=Field("integer","知识产权 ID")
        },["workspace","ip_id"]),
        Tool("list_contracts","查询当前工作区有效合同及其所属项目 ID。",new(){
            ["workspace"]=Field("string","工作区",Workspaces)
        },["workspace"]),
        Tool("list_files","查询当前工作区有效的业务原件及链接 ID。",new(){
            ["workspace"]=Field("string","工作区",Workspaces)
        },["workspace"]),
        Tool("create_project","在已解锁的 IPSys 中创建项目。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["name"]=Field("string","项目名称"),
            ["project_type"]=Field("string","项目类别",["科研项目","横向项目","其他项目"]),
            ["project_no"]=Field("string","项目编号（可选）"),
            ["leader"]=Field("string","负责人（可选）"),
            ["undertaking_org"]=Field("string","承担单位（可选）"),
            ["start_date"]=Field("string","开始日期 yyyy-MM-dd（可选）"),
            ["end_date"]=Field("string","结束日期 yyyy-MM-dd（可选）"),
            ["project_status"]=Field("string","项目状态（可选）",["筹备中","进行中","已完成","已终止"]),
            ["category"]=Field("string","辅助分类（可选）"),
            ["remarks"]=Field("string","备注（可选）"),
            ["tags"]=Field("string","标签（可选）")
        },["workspace","name","project_type"]),
        Tool("update_project","更新项目指定字段，未提供的字段保留原值。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["project_id"]=Field("integer","项目 ID"),
            ["name"]=Field("string","项目名称"),
            ["project_type"]=Field("string","项目类别",["科研项目","横向项目","其他项目"]),
            ["project_no"]=Field("string","项目编号"),
            ["leader"]=Field("string","负责人"),
            ["undertaking_org"]=Field("string","承担单位"),
            ["start_date"]=Field("string","开始日期 yyyy-MM-dd"),
            ["end_date"]=Field("string","结束日期 yyyy-MM-dd"),
            ["project_status"]=Field("string","项目状态",["筹备中","进行中","已完成","已终止"]),
            ["category"]=Field("string","辅助分类"),
            ["remarks"]=Field("string","备注"),
            ["tags"]=Field("string","标签")
        },["workspace","project_id"]),
        Tool("delete_project","将项目及所属合同移至回收站，允许在 IPSys 中恢复。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["project_id"]=Field("integer","要移至回收站的项目 ID")
        },["workspace","project_id"]),
        Tool("create_contract","给指定的有效项目新增所属合同。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["project_id"]=Field("integer","所属项目 ID"),
            ["name"]=Field("string","合同名称"),
            ["contract_no"]=Field("string","合同编号（可选）"),
            ["sign_date"]=Field("string","签订日期 yyyy-MM-dd（可选）"),
            ["amount"]=Field("string","人民币合同金额，如 1234.00（可选）"),
            ["signing_parties"]=Field("string","签约方（可选）"),
            ["category"]=Field("string","分类（可选）"),
            ["remarks"]=Field("string","备注（可选）"),
            ["tags"]=Field("string","标签（可选）")
        },["workspace","project_id","name"]),
        Tool("delete_contract","将所选合同移至回收站，可在 IPSys 内恢复。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["contract_id"]=Field("integer","合同 ID")
        },["workspace","contract_id"]),
        Tool("delete_file","将指定业务附件关联移至回收站，不立即永久清除加密字节。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["file_id"]=Field("integer","list_files 查询到的文件链接 ID")
        },["workspace","file_id"]),
        Tool("upload_files","从本机绝对路径加密归档原件到项目、合同或专利。单份不超过 64 MiB；默认独立原件。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["kind"]=Field("string","原件归属类别",["project","contract","ip"]),
            ["owner_id"]=Field("integer","项目、合同或知识产权 ID"),
            ["paths"]=new {type="array",minItems=1,maxItems=20,items=Field("string","本机绝对文件路径")},
            ["on_conflict"]=Field("string","new 独立原件；update 更新已有原件版本",["new","update"]),
            ["material_category"]=Field("string","知识产权附件类别（默认其他材料）",["申请材料","通知文件","证书文件","其他材料"]),
            ["group_id"]=Field("string","存在多个同名原件时，更新指定组的身份 ID"),
            ["duplicate_mode"]=Field("string","物理字节保留独立或显式复用",["independent","reuse"])
        },["workspace","kind","owner_id","paths"])
        ];
        // Keep legacy tool contracts intact until N2-03 endpoint migration.
        // Add explicitly named V2 tools with the same field schemas; never
        // direct one agent action to both the old and the new resource tables.
        var supported=new HashSet<string>(StringComparer.Ordinal)
        {
            "list_projects","create_project","update_project","delete_project",
            "list_contracts","create_contract","delete_contract",
            "list_ips","create_ip","update_ip","delete_ip"
        };
        var native=legacy.Where(tool=>supported.Contains((string)tool.GetType()
                .GetProperty("name")!.GetValue(tool)!))
            .Select(tool=>
            {
                var type=tool.GetType();
                return (object)new
                {
                    name="v2_"+(string)type.GetProperty("name")!.GetValue(tool)!,
                    description="SQLCipher V2 新库操作，仅写入 folders，不写旧业务表。 "+
                        (string)type.GetProperty("description")!.GetValue(tool)!,
                    inputSchema=type.GetProperty("inputSchema")!.GetValue(tool)!
                };
            }).ToArray();
        return [..legacy,..native];
    }

    private static object Success(JsonElement id,object value)=>new {jsonrpc="2.0",id,result=value};
    private static object Error(JsonElement id,int code,string msg)=>new {
        jsonrpc="2.0",id,error=new {code,message=msg}
    };

    public static async Task RunStdioAsync()
    {
        using var input=new StreamReader(Console.OpenStandardInput(),new UTF8Encoding(false));
        using var output=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)) {AutoFlush=true,NewLine="\n"};
        while(true)
        {
            string? line=await input.ReadLineAsync();
            if(line==null)break;
            try
            {
                using var envelope=JsonDocument.Parse(line);
                var root=envelope.RootElement;
                if(root.ValueKind!=JsonValueKind.Object||!root.TryGetProperty("method",out var methodValue))
                    continue;
                string method=methodValue.GetString()??"";
                if(!root.TryGetProperty("id",out var rawId))continue; // notifications
                JsonElement id=rawId.Clone();
                object reply;
                try
                {
                    reply=method switch
                    {
                        "initialize"=>Success(id,new {
                            protocolVersion=ReadString(root.TryGetProperty("params",out var initialize)?initialize:default,
                                "protocolVersion","2025-06-18"),
                            capabilities=new {tools=new {listChanged=false}},
                            serverInfo=new {name="ipsys-local",version="1.0.0"},
                            instructions="请先在已解锁的 IPSys 系统设置中开启本机 Codex MCP。仅可操作本机当前数据库。"
                        }),
                        "ping"=>Success(id,new {}),
                        "tools/list"=>Success(id,new {tools=Tools()}),
                        "tools/call"=>await CallToolAsync(id,root),
                        "resources/list"=>Success(id,new {resources=Array.Empty<object>()}),
                        "prompts/list"=>Success(id,new {prompts=Array.Empty<object>()}),
                        _=>Error(id,-32601,"Unknown MCP method: "+method)
                    };
                }
                catch(Exception ex){reply=Error(id,-32603,ex.Message);}
                await output.WriteLineAsync(JsonSerializer.Serialize(reply,Json));
            }
            catch(Exception ex)
            {
                Console.Error.WriteLine("IPSys MCP 协议输入错误："+ex.Message);
            }
        }
    }

    private static async Task<object> CallToolAsync(JsonElement id,JsonElement root)
    {
        if(!root.TryGetProperty("params",out var args)||
           !args.TryGetProperty("name",out var n))return Error(id,-32602,"Missing tool name");
        string name=n.GetString()??"";
        if(!Tools().Any(x=>string.Equals((string)x.GetType().GetProperty("name")!.GetValue(x),name,
            StringComparison.Ordinal)))return Error(id,-32602,"Unsupported tool: "+name);
        JsonElement fields=args.TryGetProperty("arguments",out var a)&&a.ValueKind==JsonValueKind.Object?a:default;
        try
        {
            JsonNode response=await CallHostAsync(name,fields);
            return Success(id,new {content=new[] {new {type="text",text=response.ToJsonString(Json)}}});
        }
        catch(Exception ex)
        {
            return Success(id,new {content=new[] {new {type="text",text=ex.Message}},isError=true});
        }
    }

    internal static Task<JsonNode> RunSmokeToolAsync(string name,JsonElement fields) =>
        CallHostAsync(name,fields);
    private static async Task<JsonNode> CallHostAsync(string name,JsonElement fields)
    {
        using var pipe=new NamedPipeClientStream(".",
            PipeName,PipeDirection.InOut,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try{await pipe.ConnectAsync(timeout.Token);}
        catch(Exception ex)when(ex is IOException or OperationCanceledException or TimeoutException)
        {throw new IOException("请先启动 IPSys 并打开数据库，然后在系统设置中启用 Codex MCP。",ex);}
        using var writer=new StreamWriter(pipe,new UTF8Encoding(false),1024,true){AutoFlush=true};
        using var reader=new StreamReader(pipe,new UTF8Encoding(false),false,1024,true);
        await writer.WriteLineAsync(JsonSerializer.Serialize(new {name,arguments=fields},Json));
        string? line=await reader.ReadLineAsync();
        if(line==null)throw new IOException("IPSys 本机 MCP 管道已断开。");
        JsonNode? response=JsonNode.Parse(line);
        if(response?["ok"]?.GetValue<bool>()!=true)
            throw new IOException(response?["error"]?.GetValue<string>()??"MCP 操作失败");
        return response["data"]?.DeepClone()??new JsonObject();
    }

    // The named pipe server stays inside the WinForms host. A separate Codex
    // child only transports requests; the host never publishes vault secrets.
    public static async Task RunHostAsync(Vault vault,string address,CancellationToken stop)
    {
        while(!stop.IsCancellationRequested)
        {
            try
            {
                using var pipe=new NamedPipeServerStream(PipeName,PipeDirection.InOut,1,
                    PipeTransmissionMode.Byte,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(stop);
                using var reader=new StreamReader(pipe,new UTF8Encoding(false),false,1024,true);
                using var writer=new StreamWriter(pipe,new UTF8Encoding(false),1024,true){AutoFlush=true};
                object response;
                try
                {
                    var line=await reader.ReadLineAsync(stop);
                    if(line==null)continue;
                    using var doc=JsonDocument.Parse(line);
                    var args=doc.RootElement;
                    var name=ReadString(args,"name","");
                    var fields=args.TryGetProperty("arguments",out var value)?value:default;
                    var data=await ExecuteAsync(vault,address,name,fields,stop);
                    response=new {ok=true,data};
                }
                catch(Exception ex){response=new {ok=false,error=ex.Message};}
                await writer.WriteLineAsync(JsonSerializer.Serialize(response,Json));
            }
            catch(OperationCanceledException)when(stop.IsCancellationRequested){break;}
            catch(Exception ex)
            {
                Console.Error.WriteLine("IPSys MCP 本机通道错误："+ex.Message);
                try{await Task.Delay(300,stop);}catch(OperationCanceledException){break;}
            }
        }
    }

    private static string ReadString(JsonElement args,string key,string fallback="")
    {
        if(args.ValueKind!=JsonValueKind.Object||!args.TryGetProperty(key,out var val)||
           val.ValueKind==JsonValueKind.Null)return fallback;
        if(val.ValueKind!=JsonValueKind.String)throw new IOException(key+" 必须是文本");
        return val.GetString()??fallback;
    }
    private static long ReadId(JsonElement args,string key)
    {
        if(args.ValueKind!=JsonValueKind.Object||!args.TryGetProperty(key,out var node)||
           !node.TryGetInt64(out long value)||value<=0)throw new IOException(key+" 必须是有效正整数");
        return value;
    }
    private static string Workspace(JsonElement args)
    {
        string w=ReadString(args,"workspace");
        if(!Vault.WorkspaceValid(w))throw new IOException("workspace 只能为 company 或 personal");
        return w;
    }
    private static readonly Dictionary<string,string> ProjectFields=new()
    {
        ["name"]="name",["project_type"]="projectType",["project_no"]="projectNo",
        ["leader"]="leader",["undertaking_org"]="undertakingOrg",
        ["start_date"]="startDate",["end_date"]="endDate",
        ["project_status"]="projectStatus",["category"]="category",
        ["remarks"]="remarks",["tags"]="tags"
    };
    private static readonly Dictionary<string,string> ContractFields=new()
    {
        ["name"]="name",["contract_no"]="contractNo",["sign_date"]="signDate",
        ["amount"]="amount",["signing_parties"]="signingParties",
        ["category"]="category",["remarks"]="remarks",["tags"]="tags"
    };
    private static readonly Dictionary<string,string> IpFields=new()
    {
        ["name"]="name",
        ["ip_type"]="ipType",
        ["status"]="status",
        ["applicants"]="applicants",
        ["right_holders"]="rightHolders",
        ["creators"]="creators",
        ["application_no"]="applicationNo",
        ["application_date"]="applicationDate",
        ["publication_no"]="publicationNo",
        ["publication_date"]="publicationDate",
        ["grant_notice_no"]="grantNoticeNo",
        ["grant_notice_date"]="grantNoticeDate",
        ["publication_info"]="publicationInfo",
        ["grant_date"]="grantDate",
        ["registration_no"]="registrationNo",
        ["first_published_date"]="firstPublishedDate",
        ["registration_date"]="registrationDate",
        ["category"]="category",
        ["remarks"]="remarks",
        ["tags"]="tags"
    };
    private static JsonObject Patch(JsonObject baseline,JsonElement args,Dictionary<string,string> names)
    {
        foreach(var (argument,property) in names)
        {
            if(args.ValueKind==JsonValueKind.Object&&args.TryGetProperty(argument,out var val))
            {
                if(val.ValueKind!=JsonValueKind.String)throw new IOException(argument+" 必须是文本");
                baseline[property]=val.GetString();
            }
        }
        return baseline;
    }
    private static async Task<JsonNode> RequestAsync(HttpClient client,HttpMethod method,string url,JsonNode? body=null)
    {
        using var msg=new HttpRequestMessage(method,url);
        if(body!=null)msg.Content=new StringContent(body.ToJsonString(Json),Encoding.UTF8,"application/json");
        using var result=await client.SendAsync(msg);
        string text=await result.Content.ReadAsStringAsync();
        if(!result.IsSuccessStatusCode)
        {
            string reason=text;
            try{reason=JsonNode.Parse(text)?["error"]?.GetValue<string>()??text;}catch{}
            throw new IOException("IPSys "+(int)result.StatusCode+"："+reason);
        }
        return JsonNode.Parse(text)??new JsonObject();
    }
    private static async Task<JsonNode> ExecuteAsync(Vault vault,string address,
        string name,JsonElement args,CancellationToken stop)
    {
        if(!vault.McpEnabled)throw new IOException("MCP 未授权：请在 IPSys 的系统设置中手动开启 Codex MCP。");
        string workspace=Workspace(args);
        using var client=new HttpClient {BaseAddress=new Uri(address),Timeout=TimeSpan.FromMinutes(10)};
        client.DefaultRequestHeaders.TryAddWithoutValidation("X-IPSys-Token",vault.SessionToken);
        string baseProject="/api/projects/"+workspace;
        if(name.StartsWith("v2_",StringComparison.Ordinal))
            return await ExecuteNativeAsync(client,workspace,name[3..],args);
        // Legacy IP tool names now share the actual V2 IP FolderId with the UI.
        if(name is "create_ip" or "update_ip" or "delete_ip")
            return await ExecuteNativeAsync(client,workspace,name,args);
        if(name=="list_ips")
        {
            JsonNode ui=await RequestAsync(client,HttpMethod.Get,
                "/api/v2/ui/ip/"+workspace);
            return ui["rows"]?.DeepClone()??new JsonArray();
        }
        switch(name)
        {
            case "list_projects":
                return await RequestAsync(client,HttpMethod.Get,baseProject);
            case "list_ips":
                return await RequestAsync(client,HttpMethod.Get,"/api/ip/"+workspace);
            case "create_ip":
            {
                if(string.IsNullOrWhiteSpace(ReadString(args,"name"))||
                   string.IsNullOrWhiteSpace(ReadString(args,"ip_type")))
                    throw new IOException("name 和 ip_type 必填");
                return await RequestAsync(client,HttpMethod.Post,"/api/ip/"+workspace,
                    Patch(new JsonObject(),args,IpFields));
            }
            case "update_ip":
            {
                long id=ReadId(args,"ip_id");
                JsonNode records=await RequestAsync(client,HttpMethod.Get,"/api/ip/"+workspace);
                JsonObject stored=records.AsArray().OfType<JsonObject>()
                    .FirstOrDefault(x=>x["id"]?.GetValue<long>()==id)
                    ??throw new IOException("专利/知识产权不存在或不属于当前工作区。");
                JsonObject data=stored["data"]?.AsObject()
                    ??throw new IOException("知识产权数据格式无效。");
                JsonObject payload=new();
                foreach(string key in IpFields.Values)
                    payload[key]=data[key]?.DeepClone();
                Patch(payload,args,IpFields);
                return await RequestAsync(client,HttpMethod.Put,
                    "/api/ip/"+workspace+"/"+id,payload);
            }
            case "delete_ip":
                return await RequestAsync(client,HttpMethod.Delete,
                    "/api/ip/"+workspace+"/"+ReadId(args,"ip_id"));
            case "list_contracts":
                return await RequestAsync(client,HttpMethod.Get,"/api/contracts/"+workspace);
            case "list_files":
                return await RequestAsync(client,HttpMethod.Get,"/api/business-files/"+workspace);
            case "delete_project":
                return await RequestAsync(client,HttpMethod.Delete,baseProject+"/"+ReadId(args,"project_id"));
            case "delete_contract":
                return await RequestAsync(client,HttpMethod.Delete,
                    "/api/contracts/"+workspace+"/"+ReadId(args,"contract_id"));
            case "delete_file":
                return await RequestAsync(client,HttpMethod.Delete,
                    "/api/business-files/"+workspace+"/"+ReadId(args,"file_id"));
            case "create_project":
            {
                JsonObject input=Patch(new JsonObject(),args,ProjectFields);
                if(string.IsNullOrWhiteSpace(ReadString(args,"name"))||
                   string.IsNullOrWhiteSpace(ReadString(args,"project_type")))
                    throw new IOException("name 和 project_type 必填");
                return await RequestAsync(client,HttpMethod.Post,baseProject,input);
            }
            case "update_project":
            {
                long id=ReadId(args,"project_id");
                JsonNode list=await RequestAsync(client,HttpMethod.Get,baseProject);
                JsonObject row=list.AsArray().OfType<JsonObject>()
                    .FirstOrDefault(p=>p["id"]?.GetValue<long>()==id)
                    ??throw new IOException("指定项目不存在或不属于当前工作区。");
                JsonObject payload=new();
                foreach(var property in ProjectFields.Values)
                    payload[property]=row[property]?.DeepClone();
                Patch(payload,args,ProjectFields);
                return await RequestAsync(client,HttpMethod.Put,baseProject+"/"+id,payload);
            }
            case "create_contract":
            {
                long id=ReadId(args,"project_id");
                if(string.IsNullOrWhiteSpace(ReadString(args,"name")))
                    throw new IOException("合同名称必填");
                return await RequestAsync(client,HttpMethod.Post,baseProject+"/"+id+"/contracts",
                    Patch(new JsonObject(),args,ContractFields));
            }
            case "upload_files":
            {
                string kind=ReadString(args,"kind");
                if(kind is not ("project" or "contract" or "ip"))throw new IOException("kind 只能为 project、contract 或 ip");
                long owner=ReadId(args,"owner_id");
                string mode=ReadString(args,"on_conflict","new");
                string material=ReadString(args,"material_category",kind=="ip"?"其他材料":"");
                if(kind=="ip"&&material is not ("申请材料" or "通知文件" or "证书文件" or "其他材料"))
                    throw new IOException("知识产权材料类别无效。");
                if(kind!="ip"&&material.Length!=0)
                    throw new IOException("非知识产权附件不能指定材料类别。");
                string group=ReadString(args,"group_id");
                string duplicate=ReadString(args,"duplicate_mode","independent");
                if(mode is not ("new" or "update")||duplicate is not ("independent" or "reuse")||
                   group.Length>80||group.Any(char.IsControl))
                    throw new IOException("附件版本或物理复用模式无效。");
                if(!args.TryGetProperty("paths",out var files)||
                   files.ValueKind!=JsonValueKind.Array||files.GetArrayLength() is <1 or >20)
                    throw new IOException("paths 必须包含 1–20 条本机路径。");
                JsonArray outcomes=new();
                foreach(var element in files.EnumerateArray())
                {
                    if(stop.IsCancellationRequested)throw new OperationCanceledException();
                    string path=element.ValueKind==JsonValueKind.String?element.GetString()??"":"";
                    try
                    {
                        if(!Path.IsPathFullyQualified(path))throw new IOException("必须使用绝对路径。");
                        var file=new FileInfo(Path.GetFullPath(path));
                        if(!file.Exists)throw new FileNotFoundException("本机文件不存在。");
                        var bad=BusinessFileStore.CheckName(file.Name);
                        if(bad!=null)throw new IOException(bad);
                        if(file.Length>BusinessFileStore.MaxFileLength)
                            throw new IOException("文件超过 64 MiB 上限。");
                        using var stream=new FileStream(file.FullName,FileMode.Open,FileAccess.Read,
                            FileShare.Read,1024*1024,FileOptions.Asynchronous|FileOptions.SequentialScan);
                        using var msg=new HttpRequestMessage(HttpMethod.Post,
                            $"/api/business-files/{workspace}/{kind}/{owner}");
                        msg.Content=new StreamContent(stream);
                        msg.Content.Headers.ContentType=new MediaTypeHeaderValue("application/octet-stream");
                        msg.Content.Headers.ContentLength=file.Length;
                        msg.Headers.TryAddWithoutValidation("X-File-Name",Uri.EscapeDataString(file.Name));
                        msg.Headers.TryAddWithoutValidation("X-Material-Category",Uri.EscapeDataString(material));
                        msg.Headers.TryAddWithoutValidation("X-Upload-Mode",mode);
                        msg.Headers.TryAddWithoutValidation("X-File-Group",group);
                        msg.Headers.TryAddWithoutValidation("X-Duplicate-Mode",duplicate);
                        using var reply=await client.SendAsync(msg,stop);
                        string response=await reply.Content.ReadAsStringAsync(stop);
                        if(!reply.IsSuccessStatusCode)
                        {
                            string reason=response;
                            try{reason=JsonNode.Parse(response)?["error"]?.GetValue<string>()??response;}catch{}
                            throw new IOException(reason);
                        }
                        outcomes.Add(new JsonObject{
                            ["path"]=path,["ok"]=true,["result"]=JsonNode.Parse(response)
                        });
                    }
                    catch(Exception ex)when(ex is not OperationCanceledException)
                    {
                        outcomes.Add(new JsonObject{["path"]=path,["ok"]=false,["error"]=ex.Message});
                    }
                }
                return new JsonObject {
                    ["files"]=outcomes,
                    ["succeeded"]=outcomes.Count(x=>x?["ok"]?.GetValue<bool>()==true),
                    ["failed"]=outcomes.Count(x=>x?["ok"]?.GetValue<bool>()!=true)
                };
            }
            default:throw new IOException("不支持的 MCP 工具："+name);
        }
    }
}
