using System.Text.Json.Nodes;

// Vault-level maintenance tools. Unlike every business tool, these are not scoped
// to a workspace: one encrypted file holds both the company and the personal data,
// so page accounting and space reclaim apply to the whole database.
static partial class McpLocal
{
    private static readonly string[] VaultToolNames=
    [
        "get_vault_storage","reclaim_vault_space",
        "get_vault_reclaim_status","cancel_vault_reclaim"
    ];

    private static bool IsVaultTool(string name)=>VaultToolNames.Contains(name);

    private static object[] VaultTools()=>[
        Tool("get_vault_storage",
            "只读查询资料库整体空间：库模式、文件大小、页数与空闲页、可回收字节、磁盘余量和回收前置条件。"+
            "不需要 workspace——回收针对整个加密库，不是某个工作区。canReclaim 由服务端按库模式核算，"+
            "不要用磁盘余量自行推算：旧库（mode=none）永远为 false。",
            new(),[]),
        Tool("reclaim_vault_space",
            "原地回收空闲页并截断库文件：不创建临时副本、不需要额外磁盘空间，但会短暂独占资料库。"+
            "立即返回 taskId，必须用 get_vault_reclaim_status 轮询到终态；cancel_vault_reclaim 可中途停止。"+
            "仅在用户明确要求整理空间时调用，不要当作日常清理。不需要 workspace。",
            new(),[]),
        Tool("get_vault_reclaim_status",
            "查询当前或最近一次回收任务：state、stage、真实页进度 pagesDone/pagesTotal、回收前后字节。"+
            "从未执行过返回 state=idle；failed 时 error 给出原因。不需要 workspace。",
            new(),[]),
        Tool("cancel_vault_reclaim",
            "请求取消正在执行的回收。取消是协作式的：服务端在当前批次结束后停下，"+
            "已回收的部分保留（不会回滚）；requested=false 表示当时没有可取消的任务。不需要 workspace。",
            new(),[])
    ];

    private static async Task<JsonNode> ExecuteVaultAsync(Vault vault,string address,
        string name,CancellationToken stop)
    {
        if(!vault.McpEnabled)
            throw new IOException("MCP 已关闭或资料库未解锁：请检查 IPSys 的资料库及本机 MCP 设置。");
        // The reclaim itself may run for minutes, but no call here blocks on it:
        // start returns 202 immediately and status reads the job snapshot without
        // ever entering the database gate.
        using var client=new HttpClient{BaseAddress=new Uri(address),
            Timeout=TimeSpan.FromMinutes(2)};
        using var cancelOnExit=stop.Register(static state=>
            ((HttpClient)state!).CancelPendingRequests(),client);
        client.DefaultRequestHeaders.TryAddWithoutValidation("X-IPSys-Token",vault.SessionToken);
        switch(name)
        {
            case "get_vault_storage":
            {
                JsonNode info=await RequestAsync(client,HttpMethod.Get,
                    "/api/vault/compact/info");
                string mode=info["mode"]?.GetValue<string>()??"none";
                return new JsonObject{
                    ["mode"]=mode,
                    ["fileBytes"]=info["fileBytes"]?.DeepClone(),
                    ["pageCount"]=info["pageCount"]?.DeepClone(),
                    ["freePages"]=info["freePages"]?.DeepClone(),
                    ["reclaimableBytes"]=info["reusableBytes"]?.DeepClone(),
                    ["pageSize"]=info["pageSize"]?.DeepClone(),
                    ["diskFreeBytes"]=info["availableBytes"]?.DeepClone(),
                    ["requiredFreeBytes"]=info["requiredFreeBytes"]?.DeepClone(),
                    ["canReclaim"]=info["canCompact"]?.DeepClone(),
                    ["note"]=mode=="incremental"
                        ?"canReclaim=true 时可调用 reclaim_vault_space"
                        :"此库创建于旧版本，不支持原地回收；只能重建资料库"
                };
            }
            case "reclaim_vault_space":
                return await RequestAsync(client,HttpMethod.Post,"/api/vault/compact",
                    new JsonObject{["confirm"]=true});
            case "get_vault_reclaim_status":
                try
                {
                    return await RequestAsync(client,HttpMethod.Get,
                        "/api/vault/compact/task");
                }
                catch(McpDefinitiveFailureException rejected) when(rejected.StatusCode==404)
                {
                    // Never reclaimed in this session. That is a state, not an error.
                    return new JsonObject{["state"]="idle"};
                }
            case "cancel_vault_reclaim":
                return await RequestAsync(client,HttpMethod.Post,
                    "/api/vault/compact/cancel");
            default:
                throw new IOException("未知的资料库工具："+name);
        }
    }
}
