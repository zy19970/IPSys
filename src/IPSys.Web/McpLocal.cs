using System.Diagnostics;
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
    // The named pipe and Local single-host event share a Windows logon-session scope.
    internal static string SessionPipeName(string userSid,int sessionId) =>
        "IPSys-MCP-" + Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes(userSid+":"+sessionId)))[..24];
    private static readonly string PipeName=SessionPipeName(
        WindowsIdentity.GetCurrent().User?.Value ??
            throw new UnauthorizedAccessException("无法确定 Windows 用户。"),
        Process.GetCurrentProcess().SessionId);
    internal static string HostInstanceName => @"Local\IPSys-Host-" + PipeName["IPSys-MCP-".Length..];
    internal static void VerifySessionScopedIdentity()
    {
        string sid=WindowsIdentity.GetCurrent().User?.Value ??
            throw new IOException("MCP 无法读取 Windows 用户 SID。");
        int session=Process.GetCurrentProcess().SessionId;
        int other=session==int.MaxValue?session-1:session+1;
        if(SessionPipeName(sid,session)!=PipeName ||
           SessionPipeName(sid,other)==PipeName ||
           SessionPipeName(sid+"-other",session)==PipeName)
            throw new IOException("MCP 管道没有按登录会话和用户隔离。");
    }
    internal static bool IsHostRunning()
    {
        try { using var handle=EventWaitHandle.OpenExisting(HostInstanceName); return true; }
        catch(WaitHandleCannotBeOpenedException) { return false; }
        catch(UnauthorizedAccessException) { return true; }
    }

    private static Dictionary<string,object> Field(string type,string description,string[]? choices=null)
    {
        var result=new Dictionary<string,object>{{"type",type},{"description",description}};
        if(choices!=null)result["enum"]=choices;
        return result;
    }
    private static object Tool(string name,string description,
        Dictionary<string,object> properties,string[] required)
    {
        if(IsWriteTool(name))
            properties["request_id"]=Field("string",
                "写操作幂等请求编号（8–128 字符），重试必须复用原编号；强烈建议始终提供");
        // Optional null means unspecified; year and amount can be strings or numbers.
        foreach(var (key,value) in properties)
        {
            if(required.Contains(key,StringComparer.Ordinal) ||
                value is not Dictionary<string,object> field ||
                !field.TryGetValue("type",out var t) || t is not string type)continue;
            field["type"]=key is "year" or "amount"
                ? new[]{"string","number","null"} : new[]{type,"null"};
            if(field.TryGetValue("enum",out var choices) && choices is string[] options)
                field["enum"]=options.Cast<object?>().Append(null).ToArray();
        }
        return new {name,description,inputSchema=new {
            type="object",properties,required,additionalProperties=false
        }};
    }
    private static readonly string[] Workspaces=["company","personal"];
    internal static object[] Tools()
    {
        object[] legacy=
        [
        Tool("list_projects","列出 V2 当前工作区有效项目，ID 与现有项目网页 FolderId 一致。",new(){
            ["workspace"]=Field("string","工作区：company 公司；personal 个人",Workspaces)
        },["workspace"]),
        Tool("list_ips","查询 V2 知识产权，返回与网页相同 FolderId 的业务详情。",new(){
            ["workspace"]=Field("string","工作区",Workspaces)
        },["workspace"]),
        Tool("create_ip","创建专利或知识产权。知识产权类型和状态按 IPSys 现有约束校验。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["name"]=Field("string","名称"),
            ["ip_type"]=Field("string","知识产权类型",["发明专利","实用新型专利","外观设计专利","软件著作权","其他著作权","商标","集成电路布图设计"]),
            ["status"]=Field("string","状态随 ip_type 变化：发明专利可选准备中/已申请/已公开/实质审查中/已授权/已失效；实用新型/外观设计为准备中/已申请/已授权/已失效；软件/其他著作权和集成电路布图设计为准备中/登记中/已登记；商标为准备中/申请中/已注册/已失效。可留空。"),
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
            ["status"]=Field("string","状态随 ip_type 变化：发明专利可选准备中/已申请/已公开/实质审查中/已授权/已失效；实用新型/外观设计为准备中/已申请/已授权/已失效；软件/其他著作权和集成电路布图设计为准备中/登记中/已登记；商标为准备中/申请中/已注册/已失效。可留空。"),
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
        Tool("list_contracts","查询 V2 有效合同及其所属项目 FolderId。",new(){
            ["workspace"]=Field("string","工作区",Workspaces)
        },["workspace"]),
        Tool("list_files","列出工作区全部 V2 项目、合同、知识产权、档案和综合资料有效原件；id 是 LinkId，fileId 是逻辑文件身份。",new(){
            ["workspace"]=Field("string","工作区",Workspaces)
        },["workspace"]),
        Tool("list_files_page","分页查询同一工作区 V2 文件关联；返回 items/offset/limit/hasMore/nextOffset，支持按资料类别、所属 FolderId 和名称过滤。建议代替不分页的 list_files。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["kind"]=Field("string","业务资料类别",["project","contract","ip","archive","general"]),
            ["owner_id"]=Field("integer","仅返回指定所属 FolderId 的关联"),
            ["name"]=Field("string","文件位置显示名或文件名的部分匹配"),
            ["offset"]=Field("integer","从零开始的偏移量（默认 0）"),
            ["limit"]=Field("integer","每页 1–200 条（默认 100）")
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
        Tool("delete_file","解除一处 V2 文件关联；必须同时校验 FolderId、FileId、LinkId，误用旧参数将被拒绝。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["owner_id"]=Field("integer","list_files 中的 ownerId（所属 FolderId）"),
            ["file_id"]=Field("integer","list_files 中的 fileId（真实 FileId）"),
            ["link_id"]=Field("integer","list_files 中的 id（关联 LinkId）")
        },["workspace","owner_id","file_id","link_id"]),
        Tool("list_project_files","查询 V2 项目 FolderId 下的有效 FileId、LinkId 与最新版本。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["project_id"]=Field("integer","项目 FolderId")
        },["workspace","project_id"]),
        Tool("list_contract_files","查询 V2 合同 FolderId 下的有效 FileId、LinkId 与最新版本。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["contract_id"]=Field("integer","合同 FolderId")
        },["workspace","contract_id"]),
        Tool("delete_project_file","仅解除指定 V2 项目中的一条文件关联，不删除共享原件和历史版本。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["project_id"]=Field("integer","项目 FolderId"),
            ["file_id"]=Field("integer","原件 FileId"),
            ["link_id"]=Field("integer","项目文件 LinkId")
        },["workspace","project_id","file_id","link_id"]),
        Tool("delete_contract_file","仅解除指定 V2 合同中的一条文件关联，不删除共享原件和历史版本。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["contract_id"]=Field("integer","合同 FolderId"),
            ["file_id"]=Field("integer","原件 FileId"),
            ["link_id"]=Field("integer","合同文件 LinkId")
        },["workspace","contract_id","file_id","link_id"]),
        Tool("list_ip_files","查询 V2 知识产权下的有效原件；返回 LinkId、FileId、最新版与材料类别。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["ip_id"]=Field("integer","知识产权 FolderId")
        },["workspace","ip_id"]),
        Tool("delete_ip_file","仅解除指定知识产权中的一条 V2 原件关联，不删除共享 FileId 或历史版本。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["ip_id"]=Field("integer","知识产权 FolderId"),
            ["file_id"]=Field("integer","原件 FileId"),
            ["link_id"]=Field("integer","关联 LinkId")
        },["workspace","ip_id","file_id","link_id"]),
        Tool("upload_files","本机上传到 V2 项目/合同/知识产权/档案/综合资料 FolderId；同内容必须显式确认 duplicate_mode；追加版本需为本 Folder 已关联 FileId。每份上限 64 MiB。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["kind"]=Field("string","原件归属类别",["project","contract","ip","archive","general"]),
            ["section"]=Field("string","归档分类 archive 必填：certificate、achievement、academic；其它类型不需要"),
            ["owner_id"]=Field("integer","归属资料 FolderId"),
            ["paths"]=new {type="array",minItems=1,maxItems=20,items=Field("string","本机绝对文件路径")},
            ["on_conflict"]=Field("string","new 独立原件；update 更新已有原件版本",["new","update"]),
            ["material_category"]=Field("string","知识产权附件类别（默认其他材料）",["申请材料","通知文件","证书文件","其他材料"]),
            ["duplicate_mode"]=Field("string","V2 同内容查重后独立保存、复用内容或共享 FileId",["independent","reuse","share"]),
            ["source_file_id"]=Field("integer","选择 reuse/share 时与 SHA-256 匹配的已有 FileId"),
            ["file_id"]=Field("integer","on_conflict=update 指向已有 FileId，必须归属于 owner_id")
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
                    description="V2 Folder 原生响应；旧名列表返回网页友好结构，写操作共用同一业务源，保留别名仅为兼容已有 Agent。 "+
                        (string)type.GetProperty("description")!.GetValue(tool)!,
                    inputSchema=type.GetProperty("inputSchema")!.GetValue(tool)!
                };
            }).ToArray();
        return [..legacy,..native,..ArchiveTools(),..ExtraTools(),
            Tool("start_upload_task","异步启动 1–20 个本机原件上传，立即返回 request_id；其余参数与 upload_files 相同。请使用 get_task_status/cancel_task。",new(){
                ["workspace"]=Field("string","工作区",Workspaces),
                ["kind"]=Field("string","归属资源",["project","contract","ip","archive","general"]),
                ["section"]=Field("string","archive 所属分类"),
                ["owner_id"]=Field("integer","资料 FolderId"),
                ["paths"]=new {type="array",minItems=1,maxItems=20,items=Field("string","本机绝对路径")},
                ["on_conflict"]=Field("string","new 或 update",["new","update"]),
                ["material_category"]=Field("string","知识产权材料类别",["申请材料","通知文件","证书文件","其他材料"]),
                ["duplicate_mode"]=Field("string","重复文件处理选择",["independent","reuse","share"]),
                ["source_file_id"]=Field("integer","复用/共享的源 FileId"),
                ["file_id"]=Field("integer","追加版本使用的 FileId")
            },["workspace","kind","owner_id","paths","request_id"]),
            Tool("get_task_status","按 request_id 查询当前文件数、发送字节和 SQLCipher 持久操作结果。",new(){
                ["workspace"]=Field("string","工作区",Workspaces),
                ["request_id"]=Field("string","上传任务 request_id")
            },["workspace","request_id"]),
            Tool("cancel_task","按 request_id 请求取消当前活动异步上传；已发送文件和在途写入仍须人工核对。",new(){
                ["workspace"]=Field("string","工作区",Workspaces),
                ["request_id"]=Field("string","上传任务 request_id")
            },["workspace","request_id"]),
            Tool("get_operation_result","查询 request_id 日志：state=done 仅表示请求已完成并存档，实际成功需检查 businessOk 和 result.status；pending/uncertain 不可自动重试。",new(){
                ["workspace"]=Field("string","工作区",Workspaces),
                ["request_id"]=Field("string","此前写操作的幂等编号")
            },["workspace","request_id"])];
    }

    private static object Success(JsonElement id,object value)=>new {jsonrpc="2.0",id,result=value};
    private static object Error(JsonElement id,int code,string msg)=>new {
        jsonrpc="2.0",id,error=new {code,message=msg}
    };

    public static async Task RunStdioAsync()
    {
        Console.SetError(new StreamWriter(Console.OpenStandardError(),new UTF8Encoding(false)){AutoFlush=true});
        using var input=new StreamReader(Console.OpenStandardInput(),new UTF8Encoding(false));
        using var output=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)) {AutoFlush=true,NewLine="\n"};
        bool initialized=false;
        while(true)
        {
            string? line=await input.ReadLineAsync();
            if(line==null)break;
            if(string.IsNullOrWhiteSpace(line))continue;
            try
            {
                using var envelope=JsonDocument.Parse(line);
                var root=envelope.RootElement;
                if(root.ValueKind!=JsonValueKind.Object)
                {
                    using var nullId=JsonDocument.Parse("null");
                    await output.WriteLineAsync(JsonSerializer.Serialize(
                        Error(nullId.RootElement,-32600,"不支持 JSON-RPC 批量请求，请逐条发送。"),Json));
                    continue;
                }
                if(!root.TryGetProperty("method",out var methodValue) ||
                   methodValue.ValueKind!=JsonValueKind.String)
                {
                    using var nullId=JsonDocument.Parse("null");
                    await output.WriteLineAsync(JsonSerializer.Serialize(
                        Error(nullId.RootElement,-32600,"JSON-RPC 请求缺少 method。"),Json));
                    continue;
                }
                string method=methodValue.GetString()??"";
                if(!root.TryGetProperty("id",out var rawId))continue; // notifications
                JsonElement id=rawId.Clone();
                object reply;
                try
                {
                    if(method=="initialize")initialized=true;
                    reply=!initialized?Error(id,-32002,"请先发送 initialize 初始化 MCP 连接。") :
                        method switch
                    {
                        "initialize"=>Success(id,new {
                            protocolVersion="2025-06-18",
                            capabilities=new {tools=new {listChanged=false}},
                            serverInfo=new {name="ipsys-local",version="1.0.0"},
                            instructions="请在已解锁的 IPSys 系统设置中开启本机 MCP 授权。仅可操作本机当前数据库。"
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
            ValidateToolArguments(name,fields);
            JsonNode response=await CallHostAsync(name,fields);
            // Array-valued list tools must not be indexed like JsonObject.
            bool partial=name=="upload_files" && response is JsonObject batch &&
                batch["failed"] is JsonNode failed && failed.GetValue<int>()>0;
            bool businessFailure=response is JsonObject result &&
                (result["ok"]?.ToJsonString()=="false" ||
                 result["status"]?.GetValue<string>() is
                    "failed" or "partial_success" or "interrupted");
            bool isError=partial||businessFailure;
            JsonNode visible=response;
            if(isError && response is JsonObject original)
            {
                var failure=(JsonObject)original.DeepClone();
                string status=failure["status"]?.GetValue<string>()??"failed";
                string detail=failure["error"]?.GetValue<string>()??
                    (status=="partial_success"?"批量操作部分失败。":"操作未成功。");
                failure["ok"]=false;
                failure["message"]=detail;
                failure["error"]=detail;
                failure["code"]=status switch {
                    "partial_success"=>"PARTIAL_FAILURE",
                    "interrupted"=>"EXECUTION_UNCERTAIN",
                    _=>"BUSINESS_REJECTED"
                };
                failure["retryable"]=false;
                visible=failure;
            }
            return Success(id,new {
                content=new[] {new {type="text",text=visible.ToJsonString(Json)}},
                isError
            });
        }
        catch(Exception ex)
        {
            var failure=new JsonObject{
                ["ok"]=false,["status"]="failed",
                ["code"]="TOOL_CALL_REJECTED",
                ["message"]=ex.Message,["error"]=ex.Message,["retryable"]=false
            };
            if(ex.Message.Contains("结果可能不确定",StringComparison.Ordinal) ||
               ex.Message.Contains("结果若不确定",StringComparison.Ordinal))
                failure["code"]="EXECUTION_UNCERTAIN";
            return Success(id,new {content=new[] {new {
                type="text",text=failure.ToJsonString(Json)}},isError=true});
        }
    }

    internal static async Task VerifyConcurrentClientsAsync()
    {
        // Reproduce a second independent Agent connection while the first
        // has an accepted request but deliberately sends no bytes yet.
        using var guard=new EventWaitHandle(false,EventResetMode.ManualReset,
            HostInstanceName,out bool createdNew);
        if(createdNew)throw new IOException("MCP 单宿主命名事件未保持运行期占用。");
        using var idle=McpPipeSecurity.CreateClient(PipeName);
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await idle.ConnectAsync(timeout.Token);
        McpPipeSecurity.VerifyServerOwner(idle);
        await Task.Delay(120,timeout.Token);
        var list=await CallHostAsync("v2_list_projects",
            JsonSerializer.SerializeToElement(new{workspace="company"}))
            .WaitAsync(TimeSpan.FromSeconds(8));
        if(list is not JsonArray)
            throw new IOException("多客户端 MCP 并发查询没有返回有效列表。");
    }

    internal static async Task VerifyIdleClientSaturationAsync()
    {
        // All eight clients can stall before sending a full line. The ninth
        // must recover as the bounded first-message waits expire.
        var idle=new List<NamedPipeClientStream>();
        try
        {
            using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(20));
            for(int i=0;i<MaxMcpClients;i++)
            {
                var client=McpPipeSecurity.CreateClient(PipeName);
                idle.Add(client);
                await client.ConnectAsync(timeout.Token);
                McpPipeSecurity.VerifyServerOwner(client);
            }
            var result=await CallHostAsync("v2_list_projects",
                JsonSerializer.SerializeToElement(new{workspace="company"}))
                .WaitAsync(TimeSpan.FromSeconds(15));
            if(result is not JsonArray)
                throw new IOException("八路空闲 MCP 管道阻塞了后续 Agent 查询。");
        }
        finally { foreach(var client in idle)client.Dispose(); }
    }

    internal static async Task VerifyRestrictedPipeAclAsync()
    {
        using var pipe=McpPipeSecurity.CreateClient(PipeName);
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await pipe.ConnectAsync(timeout.Token);
        McpPipeSecurity.VerifyServerOwner(pipe);
        McpPipeSecurity.VerifyRestrictedAcl(pipe);
    }

    internal static Task<JsonNode> RunSmokeToolAsync(string name,JsonElement fields) =>
        CallHostAsync(name,fields);
    internal static async Task<JsonNode> RunSmokeProtocolToolAsync(string name,JsonElement fields)
    {
        using var input=JsonDocument.Parse(JsonSerializer.Serialize(new {
            jsonrpc="2.0",id=1,method="tools/call",
            @params=new {name,arguments=fields}
        },Json));
        var result=await CallToolAsync(JsonSerializer.SerializeToElement(1),input.RootElement);
        return JsonSerializer.SerializeToNode(result,Json)??new JsonObject();
    }
    private static async Task<JsonNode> CallHostAsync(string name,JsonElement fields)
    {
        using var pipe=McpPipeSecurity.CreateClient(PipeName);
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(15));
        try{await pipe.ConnectAsync(timeout.Token); McpPipeSecurity.VerifyServerOwner(pipe);}
        catch(UnauthorizedAccessException ex)
        {
            throw new IOException("MCP 管道安全校验或 Windows 访问权限拒绝连接。"+
                "请确认 Agent 与 IPSys 属于同一 Windows 登录用户；"+
                "若宿主以管理员权限运行，建议关闭宿主并以普通用户重新启动，"+
                "不要放宽管道 ACL。原始原因："+ex.Message,ex);
        }
        catch(System.Security.SecurityException ex)
        {
            throw new IOException("MCP 管道安全描述符无法读取；"+
                "请检查当前登录用户、应用提权状态和安全策略。原始原因："+ex.Message,ex);
        }
        catch(Exception ex)when(ex is IOException or OperationCanceledException or TimeoutException)
        {
            string message=IsHostRunning()
                ? "IPSys 宿主已运行，但 MCP 连接繁忙或暂时不可用。请稍后重试，并检查软件中的 MCP 授权状态。"
                : "未找到运行中的 IPSys 宿主，请先启动软件、打开数据库并手动启用 MCP。";
            throw new IOException(message,ex);
        }
        using var writer=new StreamWriter(pipe,new UTF8Encoding(false),1024,true){AutoFlush=true};
        using var reader=new StreamReader(pipe,new UTF8Encoding(false),false,1024,true);
        await writer.WriteLineAsync(JsonSerializer.Serialize(new {name,arguments=fields},Json));
        string? line;
        try { line=await reader.ReadLineAsync().WaitAsync(TimeSpan.FromMinutes(12)); }
        catch(TimeoutException ex)
        {
            throw new IOException("MCP 请求等待超过 12 分钟，执行结果可能不确定。"+
                "请通过相同 request_id 查询 get_operation_result，切勿盲目重试写操作。",ex);
        }
        if(line==null)throw new IOException("IPSys 本机 MCP 管道已断开；"+
            "写入结果若不确定，请根据 request_id 查询后再决定是否重试。");
        JsonNode? response=JsonNode.Parse(line);
        if(response?["ok"]?.GetValue<bool>()!=true)
            throw new IOException(response?["error"]?.GetValue<string>()??"MCP 操作失败");
        return response["data"]?.DeepClone()??new JsonObject();
    }

    // The named pipe server stays inside the WinForms host. A separate Codex
    // child only transports requests; the host never publishes vault secrets.
    // Independent Agent stdio sessions may connect concurrently.
    // SQLCipher writes are still protected by Vault.Gate and its file-task lock.
    private const int MaxMcpClients=8;
    private static readonly TimeSpan FirstMessageTimeout=TimeSpan.FromSeconds(5);
    public static async Task RunHostAsync(Vault vault,string address,CancellationToken stop)
    {
        HostShutdownToken=stop;
        using var slots=new SemaphoreSlim(MaxMcpClients,MaxMcpClients);
        var active=new List<Task>();
        try
        {
            while(!stop.IsCancellationRequested)
            {
                await slots.WaitAsync(stop);
                NamedPipeServerStream? listener=null;
                try
                {
                    listener=McpPipeSecurity.CreateServer(PipeName,MaxMcpClients);
                    await listener.WaitForConnectionAsync(stop);
                    var connected=listener;
                    listener=null;
                    active.Add(Task.Run(async () =>
                    {
                        try { await ServeHostClientAsync(connected,vault,address,stop); }
                        finally { connected.Dispose(); slots.Release(); }
                    }));
                    if(active.Count>MaxMcpClients*2)
                        active.RemoveAll(task=>task.IsCompleted);
                }
                catch(OperationCanceledException)when(stop.IsCancellationRequested)
                {
                    listener?.Dispose();
                    slots.Release();
                    break;
                }
                catch(Exception ex)
                {
                    listener?.Dispose();
                    slots.Release();
                    Console.Error.WriteLine("IPSys MCP 监听错误："+ex.Message);
                    try{await Task.Delay(300,stop);}
                    catch(OperationCanceledException)when(stop.IsCancellationRequested){break;}
                }
            }
        }
        catch(OperationCanceledException)when(stop.IsCancellationRequested){}
        finally { await Task.WhenAll(active); }
    }

    private static async Task ServeHostClientAsync(NamedPipeServerStream pipe,
        Vault vault,string address,CancellationToken stop)
    {
        try
        {
            using var reader=new StreamReader(pipe,new UTF8Encoding(false),false,1024,true);
            using var writer=new StreamWriter(pipe,new UTF8Encoding(false),1024,true){AutoFlush=true};
            object response;
            try
            {
                // Silent or partial-line peers cannot occupy a host slot forever.
                using var firstMessage=CancellationTokenSource.CreateLinkedTokenSource(stop);
                firstMessage.CancelAfter(FirstMessageTimeout);
                string? line;
                try { line=await reader.ReadLineAsync(firstMessage.Token); }
                catch(OperationCanceledException)when(firstMessage.IsCancellationRequested &&
                    !stop.IsCancellationRequested){return;}
                if(line==null)return;
                using var doc=JsonDocument.Parse(line);
                var args=doc.RootElement;
                var name=ReadString(args,"name","");
                var fields=args.TryGetProperty("arguments",out var value)?value:default;
                ValidateToolArguments(name,fields);
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    stop,vault.McpCancellation);
                var data=await ExecuteProtectedAsync(vault,address,name,fields,linked.Token);
                response=new {ok=true,data};
            }
            catch(OperationCanceledException)when(stop.IsCancellationRequested){return;}
            catch(OperationCanceledException)
            {
                response=new {ok=false,error="MCP 操作已取消或授权已撤销；"+
                    "写操作结果可能不确定，请先核对 request_id。"};
            }
            catch(Exception ex){response=new {ok=false,error=ex.Message};}
            await writer.WriteLineAsync(JsonSerializer.Serialize(response,Json));
        }
        catch(Exception ex)when(ex is IOException or ObjectDisposedException)
        {
            Console.Error.WriteLine("IPSys MCP 客户端断开："+ex.Message);
        }
    }

    private static string ReadString(JsonElement args,string key,string fallback="")
    {
        if(args.ValueKind!=JsonValueKind.Object||!args.TryGetProperty(key,out var val)||
           val.ValueKind==JsonValueKind.Null)return fallback;
        if(val.ValueKind==JsonValueKind.Number && key is "year" or "amount")
            return val.GetRawText();
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
                if(val.ValueKind==JsonValueKind.Null)continue;
                baseline[property]=val.ValueKind switch
                {
                    JsonValueKind.String=>val.GetString(),
                    JsonValueKind.Number when argument is "year" or "amount"=>val.GetRawText(),
                    _=>throw new IOException(argument+" 必须是文本"+(argument is "year" or "amount"?"或数字":""))
                };
            }
        }
        return baseline;
    }
    private static string ExplainNotFound(string path)
    {
        var p=path.Split('?',2)[0].Split('/',StringSplitOptions.RemoveEmptyEntries);
        if(p.Length>=5 && p[0]=="api" && p[1]=="v2" && p[2]=="folders")
        {
            string kind=p[4] switch {
                "project"=>"项目","contract"=>"合同","ip"=>"知识产权",
                "archive"=>"档案","general"=>"综合资料",_=>"资料"
            };
            return kind+"不存在或当前工作区无权访问（id="+
                (p.Length>5?p[5]:"未知")+"）";
        }
        if(p.Length>=5 && p[0]=="api" && p[1]=="v2" && p[2]=="files")
        {
            if(p[4]=="folders")
                return "文件夹或关联不存在（FolderId="+
                    (p.Length>5?p[5]:"未知")+"）";
            return "文件不存在或当前工作区无权访问（FileId="+p[4]+"）";
        }
        return "目标资源不存在（接口 "+path+"）";
    }

    // Use local drive paths only for MCP file import/export.
    private static string McpLocalFilePath(string path,string field)
    {
        if(!Path.IsPathFullyQualified(path) ||
           path.StartsWith(@"\\",StringComparison.Ordinal))
            throw new McpKnownRejectionException(field+
                " 仅支持本机磁盘的绝对路径，不接受 UNC 共享地址。");
        string full=Path.GetFullPath(path);
        string root=Path.GetPathRoot(full)??"";
        if(root.Length!=3 || root[1]!=':' || root[2]!='\\')
            throw new McpKnownRejectionException(field+" 必须位于本机盘符下。");
        if(new DriveInfo(root).DriveType is DriveType.Network or DriveType.Unknown)
            throw new McpKnownRejectionException(field+
                " 不支持网络映射盘；请先将文件复制到本机磁盘。");
        return full;
    }
    private sealed class McpKnownRejectionException(string reason) : IOException(reason);
    private sealed class McpPreflightBusyException(string reason) : IOException(reason);
    // Explicit HTTP 400/404/nonbusy 409 business rejections are definitive.
    private sealed class McpDefinitiveFailureException(int status,string reason)
        : IOException(reason)
    {
        public int StatusCode {get;}=status;
    }

    private static async Task<JsonNode> RequestAsync(HttpClient client,HttpMethod method,string url,JsonNode? body=null)
    {
        // Retry only known pre-execution busy rejections. A timeout or network
        // failure after dispatch is *never* safe to automatically retry writes.
        for(int attempt=0;attempt<3;attempt++)
        {
            using var msg=new HttpRequestMessage(method,url);
            if(body!=null)msg.Content=new StringContent(body.ToJsonString(Json),Encoding.UTF8,"application/json");
            using var result=await client.SendAsync(msg);
            string content=await result.Content.ReadAsStringAsync();
            if(result.IsSuccessStatusCode)
                return JsonNode.Parse(content)??new JsonObject();
            string reason=content;
            try{reason=JsonNode.Parse(content)?["error"]?.GetValue<string>()??content;}catch{}
            bool preflightBusy=result.StatusCode==System.Net.HttpStatusCode.Conflict &&
                (reason.Contains("数据库忙",StringComparison.Ordinal) ||
                 reason.Contains("正在处理文件或程序退出",StringComparison.Ordinal) ||
                 reason.Contains("文件任务或退出",StringComparison.Ordinal) ||
                 reason.Contains("资料库正在执行其他操作",StringComparison.Ordinal));
            if(preflightBusy&&attempt<2)
            {
                await Task.Delay(120*(attempt+1));
                continue;
            }
            if(preflightBusy)
                throw new McpPreflightBusyException("IPSys "+(int)result.StatusCode+
                    "："+reason+"；请求尚未开始执行，可使用原 request_id 稍后重试。");
            string message="IPSys "+(int)result.StatusCode+"："+
                (string.IsNullOrWhiteSpace(reason)?
                    (result.StatusCode==System.Net.HttpStatusCode.NotFound
                        ?ExplainNotFound(url):"操作未完成（"+method.Method+" "+url+"）"):
                    reason);
            if(result.StatusCode is System.Net.HttpStatusCode.BadRequest or
                System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Conflict)
                throw new McpDefinitiveFailureException((int)result.StatusCode,message);
            throw new IOException(message);
        }
        throw new IOException("MCP 请求超过有限重试次数。");
    }
    private static async Task<JsonNode> ExecuteAsync(Vault vault,string address,
        string name,JsonElement args,CancellationToken stop,UploadTask? progress=null)
    {
        if(!vault.McpEnabled)throw new IOException("MCP 未授权：请在 IPSys 的系统设置中手动开启本机 MCP。");
        string workspace=Workspace(args);
        using var client=new HttpClient {BaseAddress=new Uri(address),Timeout=TimeSpan.FromMinutes(10)};
        using var cancelOnExit=stop.Register(static state=>
            ((HttpClient)state!).CancelPendingRequests(),client);
        client.DefaultRequestHeaders.TryAddWithoutValidation("X-IPSys-Token",vault.SessionToken);
        if(name.StartsWith("v2_",StringComparison.Ordinal))
            return await ExecuteNativeAsync(client,workspace,name[3..],args);
        // 原名项目/合同/IP CRUD 与已有 v2_* 共用同一 FolderId，不双写旧表。
        if(name is "create_project" or "update_project" or "delete_project" or
           "create_contract" or "delete_contract" or
           "create_ip" or "update_ip" or "delete_ip")
            return await ExecuteNativeAsync(client,workspace,name,args);
        if(name is "update_contract" or "copy_contract" or
           "get_file_details" or "list_file_links" or
           "update_file_metadata" or "download_file_version" or
           "associate_file" or "copy_file" or "restore_file_link" or
           "transfer_project" or "transfer_ip" or "transfer_archive" or
           "transfer_general" or "move_folder" or "list_folder_entries" or
           "reorder_entries" or "reorder_records" or "reorder_archive_records" or
           "search_records" or "list_trash" or "restore_trash")
            return await ExecuteExtraAsync(client,workspace,name,args,stop);
        if(name is "list_archives" or "create_archive" or "update_archive" or
           "delete_archive" or "list_archive_folders" or "create_archive_folder" or
           "update_archive_folder" or "delete_archive_folder" or "list_general" or
           "create_general" or "update_general" or "delete_general")
            return await ExecuteArchiveAsync(client,workspace,name,args);
        if(name=="list_projects")
        {
            var ui=await RequestAsync(client,HttpMethod.Get,
                "/api/v2/ui/projects/"+workspace);
            return ui.DeepClone();
        }
        if(name=="list_contracts")
        {
            var ui=await RequestAsync(client,HttpMethod.Get,
                "/api/v2/ui/contracts/"+workspace);
            return ui.DeepClone();
        }
        if(name=="list_ips")
        {
            JsonNode ui=await RequestAsync(client,HttpMethod.Get,
                "/api/v2/ui/ip/"+workspace);
            return ui["rows"]?.DeepClone()??new JsonArray();
        }
        switch(name)
        {
            case "list_files":
                return await ListBusinessFiles(client,workspace);
            case "list_files_page":
                return await PageBusinessFiles(client,workspace,args);
            case "list_project_files":
                return await ProjectContractLinks(client,workspace,"project",args);
            case "list_contract_files":
                return await ProjectContractLinks(client,workspace,"contract",args);
            case "delete_project_file":
                return await DeleteProjectContractLink(client,workspace,"project",args);
            case "delete_contract_file":
                return await DeleteProjectContractLink(client,workspace,"contract",args);
            case "list_ip_files":
                return await IpLinks(client,workspace,args);
            case "delete_ip_file":
                return await DeleteIpLink(client,workspace,args);
            case "delete_file":
                return await DeleteBusinessFile(client,workspace,args);
            case "upload_files":
            {
                string kind=ReadString(args,"kind");
                if(kind is not ("project" or "contract" or "ip" or "archive" or "general"))
                    throw new IOException("kind 只能为 project、contract、ip、archive 或 general");
                return await IpUploadFiles(client,workspace,args,stop,kind,progress);
            }
            default:throw new IOException("不支持的 MCP 工具："+name);
        }
    }
}
