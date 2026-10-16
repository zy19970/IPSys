using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

// MCP projection of pre-existing authenticated V2 business endpoints.
// All data mutations still pass the normal HTTP route + SQLCipher guards.
static partial class McpLocal
{
    private static object[] ExtraTools() =>
    [
        Tool("update_contract","修改已有合同的指定字段，其余字段保留；不能借此更改所属项目。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["contract_id"]=Field("integer","合同 FolderId"),
            ["name"]=Field("string","合同名称"),
            ["contract_no"]=Field("string","合同编号"),
            ["sign_date"]=Field("string","签订日期 yyyy-MM-dd"),
            ["amount"]=Field("string","合同金额，可为数字"),
            ["signing_parties"]=Field("string","签约方"),
            ["category"]=Field("string","合同类别"),
            ["remarks"]=Field("string","备注"),
            ["tags"]=Field("string","检索标签")
        },["workspace","contract_id"]),
        Tool("get_file_details","获取 FileId 的元数据及全部有效历史版本（不读取原件字节）。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["file_id"]=Field("integer","实际逻辑 FileId，不是 LinkId")
        },["workspace","file_id"]),
        Tool("update_file_metadata","更新 FileId 的可选属性及名称；null 保留原值，空文本清空可选属性。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["file_id"]=Field("integer","FileId"),
            ["name"]=Field("string","新文件名称"),
            ["description"]=Field("string","选填说明"),
            ["tags"]=Field("string","选填检索标签"),
            ["file_number"]=Field("string","文件编号"),
            ["file_date"]=Field("string","文件日期 yyyy-MM-dd")
        },["workspace","file_id"]),
        Tool("download_file_version","将明确版本原件解密保存到 IPSys 宿主电脑的绝对路径；禁止覆盖已有文件，不会向 Agent 文本输出原件。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["file_id"]=Field("integer","FileId"),
            ["version"]=Field("integer","历史版本编号，从 1 开始"),
            ["output_path"]=Field("string","IPSys 宿主本机绝对文件路径，必须不存在")
        },["workspace","file_id","version","output_path"]),
        Tool("associate_file","共享或移动一处现有 FileId/LinkId 到同一工作区另一个 FolderId，保留全部版本。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["file_id"]=Field("integer","FileId"),
            ["link_id"]=Field("integer","当前已激活的关联 LinkId"),
            ["target_folder_id"]=Field("integer","目标文件夹 FolderId"),
            ["move"]=new Dictionary<string,object>{{"type","boolean"},{"description","true 移动当前链接；false 增加共享关联"}}
        },["workspace","file_id","link_id","target_folder_id"]),
        Tool("copy_file","复制 FileId 及全部有效历史版本到目标 FolderId；跨工作区必须 independent-content。",new(){
            ["workspace"]=Field("string","来源工作区",Workspaces),
            ["file_id"]=Field("integer","来源 FileId"),
            ["target_workspace"]=Field("string","目标工作区",Workspaces),
            ["target_folder_id"]=Field("integer","目标 FolderId"),
            ["mode"]=Field("string","reuse-content（仅同工作区）或 independent-content",["reuse-content","independent-content"]),
            ["name"]=Field("string","可选新名称")
        },["workspace","file_id","target_workspace","target_folder_id","mode"]),
        Tool("restore_file_link","恢复某 FileId 的已解除关联；须同时证明原所属 FolderId 和 LinkId。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["owner_id"]=Field("integer","原所属 FolderId"),
            ["file_id"]=Field("integer","FileId"),
            ["link_id"]=Field("integer","待恢复的已删除 LinkId")
        },["workspace","owner_id","file_id","link_id"]),
        Tool("transfer_project","复制/移动整个项目与合同及有效原件版本。move=true 会在目标工作区新建身份和 ID，源工作区旧记录软删除并进入回收站；恢复来源会形成并存副本。",new(){
            ["workspace"]=Field("string","来源工作区",Workspaces),
            ["project_id"]=Field("integer","项目 FolderId"),
            ["target_workspace"]=Field("string","目标工作区",Workspaces),
            ["move"]=new Dictionary<string,object>{{"type","boolean"},{"description","true 移动，false 复制"}}
        },["workspace","project_id","target_workspace"]),
        Tool("transfer_ip","复制/移动知识产权及版本。move=true 返回目标新 ID，来源软删除入原工作区回收站；恢复来源会形成并存副本。",new(){
            ["workspace"]=Field("string","来源工作区",Workspaces),
            ["ip_id"]=Field("integer","知识产权 FolderId"),
            ["target_workspace"]=Field("string","目标工作区",Workspaces),
            ["move"]=new Dictionary<string,object>{{"type","boolean"},{"description","true 移动，false 复制"}}
        },["workspace","ip_id","target_workspace"]),
        Tool("transfer_archive","在语义兼容类别间复制/移动档案与版本。move=true 返回目标新 ID，来源软删除入原工作区回收站；恢复来源会形成并存副本。",new(){
            ["workspace"]=Field("string","来源工作区",Workspaces),
            ["section"]=Field("string","来源资料类别"),
            ["archive_id"]=Field("integer","档案 FolderId"),
            ["target_workspace"]=Field("string","目标工作区",Workspaces),
            ["target_section"]=Field("string","目标档案类别"),
            ["move"]=new Dictionary<string,object>{{"type","boolean"},{"description","true 移动，false 复制"}}
        },["workspace","section","archive_id","target_workspace","target_section"]),
        Tool("transfer_general","复制/移动综合资料及历史文件。move=true 返回目标新 ID，来源软删除入原工作区回收站；恢复来源会形成并存副本。",new(){
            ["workspace"]=Field("string","来源工作区",Workspaces),
            ["general_id"]=Field("integer","综合资料 FolderId"),
            ["target_workspace"]=Field("string","目标工作区",Workspaces),
            ["move"]=new Dictionary<string,object>{{"type","boolean"},{"description","true 移动，false 复制"}}
        },["workspace","general_id","target_workspace"]),
        Tool("search_records","工作区统一搜索；文件命中 kind=file 只是搜索结果种类，不等于回收站 kind=v2_file/v2_ip_file。恢复前必须 list_trash。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["query"]=Field("string","检索词，最长 100 字")
        },["workspace","query"]),
        Tool("list_trash","查询工作区回收站；文件关联 kind=v2_file 或 v2_ip_file，与搜索结果 kind=file 不同。恢复必须采用本工具返回原值。",new(){
            ["workspace"]=Field("string","工作区",Workspaces)
        },["workspace"]),
        Tool("restore_trash","按 list_trash 返回的 kind/id/section 精确恢复一条回收站记录。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["kind"]=Field("string","回收站返回的原始 kind；不能自行推测"),
            ["id"]=Field("integer","待恢复条目 ID"),
            ["section"]=Field("string","回收站返回的 section，空可省略")
        },["workspace","kind","id"])
    ];

    private static bool ExtraWrite(string name) => name is
        "associate_file" or "copy_file" or "restore_file_link" or
        "transfer_project" or "transfer_ip" or "transfer_archive" or
        "transfer_general" or "restore_trash";

    private static long Positive(JsonElement args,string key)=>ReadId(args,key);
    private static bool Bool(JsonElement args,string key)
    {
        if(!args.TryGetProperty(key,out var item) || item.ValueKind==JsonValueKind.Null)
            return false;
        if(item.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new IOException(key+" 必须是 true 或 false。");
        return item.GetBoolean();
    }

    private static string RequiredText(JsonElement args,string key)
    {
        string value=ReadString(args,key);
        if(string.IsNullOrWhiteSpace(value))
            throw new IOException(key+" 不能为空。");
        return value;
    }

    private static async Task<JsonNode> ExecuteExtraAsync(HttpClient client,
        string workspace,string name,JsonElement args,CancellationToken stop)
    {
        string Files(long fileId)=>$"/api/v2/files/{workspace}/{fileId}";
        JsonObject TransferBody(bool withSection=false)
        {
            var body=new JsonObject{
                ["targetWorkspace"]=RequiredText(args,"target_workspace"),
                ["move"]=Bool(args,"move")
            };
            if(withSection)body["targetSection"]=RequiredText(args,"target_section");
            return body;
        }
        switch(name)
        {
            case "update_contract":
            {
                long id=Positive(args,"contract_id");
                var current=await NativeCurrentAsync(client,workspace,"contract",id);
                return await RequestAsync(client,HttpMethod.Put,
                    V2Url(workspace,"contract",id),
                    NativePayload("contract",NativePatch(current,args,ContractFields)));
            }
            case "get_file_details":
                return await RequestAsync(client,HttpMethod.Get,
                    Files(Positive(args,"file_id")));
            case "update_file_metadata":
            {
                long file=Positive(args,"file_id");
                var current=await RequestAsync(client,HttpMethod.Get,Files(file));
                var payload=new JsonObject();
                string[] input={"name","description","tags","file_number","file_date"};
                string[] stored={"name","description","tags","fileNumber","fileDate"};
                for(int i=0;i<input.Length;i++)
                {
                    string key=input[i];
                    JsonNode? original=current[stored[i]];
                    if(args.TryGetProperty(key,out var val)&&val.ValueKind!=JsonValueKind.Null)
                        payload[stored[i]]=ReadString(args,key);
                    else payload[stored[i]]=original?.DeepClone();
                }
                return await RequestAsync(client,HttpMethod.Put,
                    Files(file)+"/metadata",payload);
            }
            case "download_file_version":
            {
                long file=Positive(args,"file_id"),version=Positive(args,"version");
                if(version>int.MaxValue)throw new IOException("版本号超出支持范围。");
                string path=RequiredText(args,"output_path");
                if(!Path.IsPathFullyQualified(path) ||
                    path.IndexOfAny(Path.GetInvalidPathChars())>=0)
                    throw new IOException("output_path 必须是有效的绝对路径。");
                string full=Path.GetFullPath(path);
                // Do not truncate any local user file, even on retries.
                using var response=await client.GetAsync(
                    Files(file)+$"/versions/{version}/download",
                    HttpCompletionOption.ResponseHeadersRead,stop);
                if(!response.IsSuccessStatusCode)
                    throw new IOException("原件下载失败，HTTP "+(int)response.StatusCode);
                long size=response.Content.Headers.ContentLength??-1;
                if(size<0)throw new IOException("下载缺少 Content-Length，已拒绝写入。");
                await using(var dest=new FileStream(full,FileMode.CreateNew,
                    FileAccess.Write,FileShare.None,1024*1024,FileOptions.Asynchronous))
                {
                    try
                    {
                        await using var stream=await response.Content.ReadAsStreamAsync(stop);
                        await stream.CopyToAsync(dest,stop);
                        if(dest.Length!=size)throw new IOException("原件长度核对失败。");
                    }
                    catch
                    {
                        dest.Dispose();
                        try { File.Delete(full); } catch { }
                        throw;
                    }
                }
                return new JsonObject{["path"]=full,["fileId"]=file,
                    ["version"]=version,["size"]=size};
            }
            case "associate_file":
                return await RequestAsync(client,HttpMethod.Post,
                    Files(Positive(args,"file_id"))+"/associate",
                    new JsonObject{["linkId"]=Positive(args,"link_id"),
                        ["targetFolderId"]=Positive(args,"target_folder_id"),
                        ["move"]=Bool(args,"move")});
            case "copy_file":
            {
                long file=Positive(args,"file_id");
                var body=new JsonObject{
                    ["targetWorkspace"]=RequiredText(args,"target_workspace"),
                    ["targetFolderId"]=Positive(args,"target_folder_id"),
                    ["mode"]=RequiredText(args,"mode")
                };
                if(args.TryGetProperty("name",out var rename)&&rename.ValueKind!=JsonValueKind.Null)
                    body["name"]=ReadString(args,"name");
                return await RequestAsync(client,HttpMethod.Post,Files(file)+"/copy",body);
            }
            case "restore_file_link":
            {
                long folder=Positive(args,"owner_id"),file=Positive(args,"file_id"),
                    link=Positive(args,"link_id");
                var links=await RequestAsync(client,HttpMethod.Get,
                    $"/api/v2/files/{workspace}/folders/{folder}/links?includeDeleted=true");
                if(links is not JsonArray rows || !rows.Any(x=>
                    x?["id"]?.GetValue<long>()==link &&
                    x?["fileId"]?.GetValue<long>()==file &&
                    x?["deleted"]?.GetValue<bool>()==true))
                    throw new IOException("原 FolderId/FileId/LinkId 不匹配或关联不是已删除状态。");
                return await RequestAsync(client,HttpMethod.Post,
                    Files(file)+$"/links/{link}/restore");
            }
            case "transfer_project":
                return await RequestAsync(client,HttpMethod.Post,
                    $"/api/v2/projects/{workspace}/{Positive(args,"project_id")}/transfer",
                    TransferBody());
            case "transfer_ip":
                return await RequestAsync(client,HttpMethod.Post,
                    $"/api/v2/ip/{workspace}/{Positive(args,"ip_id")}/transfer",
                    TransferBody());
            case "transfer_archive":
                return await RequestAsync(client,HttpMethod.Post,
                    $"/api/v2/ui/archive/{workspace}/"+
                    Uri.EscapeDataString(ArchiveSection(workspace,args))+
                    $"/{Positive(args,"archive_id")}/transfer",TransferBody(true));
            case "transfer_general":
                return await RequestAsync(client,HttpMethod.Post,
                    $"/api/v2/ui/general/{workspace}/{Positive(args,"general_id")}/transfer",
                    TransferBody());
            case "search_records":
                return await RequestAsync(client,HttpMethod.Get,
                    "/api/v2/search/"+workspace+"?q="+
                    Uri.EscapeDataString(ReadString(args,"query")));
            case "list_trash":
                return await RequestAsync(client,HttpMethod.Get,"/api/trash/"+workspace);
            case "restore_trash":
            {
                string kind=RequiredText(args,"kind");
                long id=Positive(args,"id");
                string section=ReadString(args,"section");
                var trash=await RequestAsync(client,HttpMethod.Get,"/api/trash/"+workspace);
                if(trash is not JsonArray rows || !rows.Any(x=>
                    x?["kind"]?.GetValue<string>()==kind &&
                    x?["id"]?.GetValue<long>()==id &&
                    x?["section"]?.GetValue<string>()==section))
                    throw new IOException("回收站不存在匹配的 kind/id/section 记录，拒绝恢复。");
                return await RequestAsync(client,HttpMethod.Post,
                    "/api/trash/"+workspace+"/restore",
                    new JsonObject{["items"]=new JsonArray(new JsonObject{
                        ["kind"]=kind,["id"]=id,["section"]=section})});
            }
            default:throw new IOException("未实现的 MCP 扩展工具："+name);
        }
    }
}
