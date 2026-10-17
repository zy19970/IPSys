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
        Tool("copy_contract","在同一工作区和所属项目下复制合同业务属性及全部有效文件关联；返回新合同 FolderId，附件共享 FileId/历史版本，不重复写原件。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["contract_id"]=Field("integer","源合同 FolderId")
        },["workspace","contract_id"]),
        Tool("get_file_details","获取 FileId 的元数据及全部有效历史版本（不读取原件字节）。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["file_id"]=Field("integer","实际逻辑 FileId，不是 LinkId")
        },["workspace","file_id"]),
        Tool("list_file_links","按 FileId 查询同工作区所有有效关联，包含关联 LinkId、所属 FolderId；可用于查明哪些目录共享同一原件。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["file_id"]=Field("integer","原件 FileId，不是 LinkId")
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
        Tool("move_folder","调整公司业务档案目录或资料在 achievement 分类下的所属目录；kind=archive_folder 可移到根，kind=archive 必须指定目标目录。保留 FolderId 与附件。",new(){
            ["workspace"]=Field("string","必须为 company",["company"]),
            ["kind"]=Field("string","archive_folder 为目录，archive 为资料",["archive_folder","archive"]),
            ["entry_id"]=Field("integer","待移动的目录或资料 FolderId"),
            ["parent_id"]=Field("integer","新父目录 FolderId；省略或 null 表示根，仅 archive_folder 适用")
        },["workspace","kind","entry_id"]),
        Tool("list_folder_entries","获取公司业务档案 achievement 指定父目录下的目录与资料混排列表，供 reorder_entries 使用。parent_id=0 表示根。",new(){
            ["workspace"]=Field("string","必须为 company",["company"]),
            ["parent_id"]=Field("integer","目录 FolderId；0 表示根目录")
        },["workspace","parent_id"]),
        Tool("reorder_entries","按当前父目录下全部目录和资料的精确排列持久化排序；须提供完整 items，每项为 kind=folder/record 和 id；parent_id=0 为根。",new(){
            ["workspace"]=Field("string","必须为 company",["company"]),
            ["parent_id"]=Field("integer","父目录 FolderId；0 为根"),
            ["items"]=new {type="array",minItems=1,maxItems=1000,
                items=Field("object","按顺序排列的 {kind:folder/record,id:FolderId}")}
        },["workspace","parent_id","items"]),
        Tool("reorder_records","调整同工作区项目或合同列表中选中记录的相对顺序；ids 按目标顺序提供，未选择的记录保持原有槽位。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["kind"]=Field("string","project 或 contract",["project","contract"]),
            ["ids"]=new {type="array",minItems=1,maxItems=1000,
                items=Field("integer","待排序记录 FolderId")}
        },["workspace","kind","ids"]),
        Tool("reorder_archive_records","调整证书、科研成果、个人履历等非混排档案模块的全部记录顺序；ids 必须包含该模块当前全部有效 FolderId。公司 achievement 混排应使用 reorder_entries。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","archive 资料类别"),
            ["ids"]=new {type="array",minItems=1,maxItems=1000,
                items=Field("integer","全量档案 FolderId")}
        },["workspace","section","ids"]),
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
        "copy_contract" or "move_folder" or "reorder_entries" or
        "reorder_records" or "reorder_archive_records" or
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

    private static long Nonnegative(JsonElement args,string key)
    {
        if(!args.TryGetProperty(key,out var value) ||
           value.ValueKind!=JsonValueKind.Number ||
           !value.TryGetInt64(out long id) || id<0)
            throw new IOException(key+" 必须是非负整数（0 表示根目录）。");
        return id;
    }

    private static long[] ReorderIds(JsonElement args)
    {
        var ids=args.GetProperty("ids").EnumerateArray().Select(x=>
        {
            if(x.ValueKind!=JsonValueKind.Number||!x.TryGetInt64(out long id)||id<=0)
                throw new IOException("ids 必须全部为正整数 FolderId。");
            return id;
        }).ToArray();
        if(ids.Length==0||ids.Distinct().Count()!=ids.Length)
            throw new IOException("ids 不允许为空或包含重复 FolderId。");
        return ids;
    }

    private static JsonArray ReorderItems(JsonElement args)
    {
        var result=new JsonArray();
        var seen=new HashSet<long>();
        foreach(var item in args.GetProperty("items").EnumerateArray())
        {
            if(item.ValueKind!=JsonValueKind.Object||item.EnumerateObject().Count()!=2||
               !item.TryGetProperty("kind",out var kind)||
               !item.TryGetProperty("id",out var id)||
               kind.ValueKind!=JsonValueKind.String ||
               kind.GetString() is not ("folder" or "record") ||
               id.ValueKind!=JsonValueKind.Number ||
               !id.TryGetInt64(out long number)||number<=0||!seen.Add(number))
                throw new IOException("items 每项必须仅含 kind=folder/record 与唯一正整数 id。");
            result.Add(new JsonObject{["kind"]=kind.GetString(),["id"]=number});
        }
        if(result.Count==0)throw new IOException("items 不能为空。");
        return result;
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
            case "copy_contract":
                return await RequestAsync(client,HttpMethod.Post,
                    $"/api/v2/ui/contracts/{workspace}/{Positive(args,"contract_id")}/copy");
            case "get_file_details":
                return await RequestAsync(client,HttpMethod.Get,
                    Files(Positive(args,"file_id")));
            case "list_file_links":
                return await RequestAsync(client,HttpMethod.Get,
                    Files(Positive(args,"file_id"))+"/links");
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
            case "move_folder":
            {
                if(workspace!="company")throw new IOException("仅支持公司业务档案目录移动。");
                string kind=RequiredText(args,"kind");
                if(kind is not ("archive_folder" or "archive"))
                    throw new IOException("kind 仅允许 archive_folder 或 archive。");
                long id=Positive(args,"entry_id");
                long? parent=null;
                if(args.TryGetProperty("parent_id",out var destination) &&
                   destination.ValueKind!=JsonValueKind.Null)
                {
                    long target=Nonnegative(args,"parent_id");
                    if(target>0)parent=target;
                }
                if(kind=="archive"&&parent is null)
                    throw new IOException("业务档案资料必须指定正整数父目录 parent_id。");
                return await RequestAsync(client,HttpMethod.Post,
                    $"/api/v2/folders/company/{kind}/{id}/move?section=achievement",
                    new JsonObject{["parentId"]=parent});
            }
            case "list_folder_entries":
            {
                if(workspace!="company")throw new IOException("仅支持公司业务档案混排列举。");
                long parent=Nonnegative(args,"parent_id");
                return await RequestAsync(client,HttpMethod.Get,
                    "/api/v2/folders/company/entries?section=achievement"+
                    (parent==0?"":"&parentId="+parent));
            }
            case "reorder_entries":
            {
                if(workspace!="company")throw new IOException("仅支持公司业务档案混排。");
                long parent=Nonnegative(args,"parent_id");
                return await RequestAsync(client,HttpMethod.Post,
                    "/api/v2/folders/company/entries/reorder?section=achievement",
                    new JsonObject{["parentId"]=parent,
                        ["items"]=ReorderItems(args)});
            }
            case "reorder_records":
            {
                string kind=RequiredText(args,"kind");
                if(kind is not ("project" or "contract"))
                    throw new IOException("kind 仅允许 project 或 contract。");
                long[] ids=ReorderIds(args);
                return await RequestAsync(client,HttpMethod.Post,
                    $"/api/v2/ui/order/{workspace}/{kind}",
                    JsonSerializer.SerializeToNode(new {ids})!);
            }
            case "reorder_archive_records":
            {
                string section=RequiredText(args,"section");
                if(ArchiveRules.Module(workspace,section)==null)
                    throw new IOException("工作区不支持此资料类别。");
                if(workspace=="company"&&section=="achievement")
                    throw new IOException("公司业务档案请使用 reorder_entries 保证目录混排。");
                long[] ids=ReorderIds(args);
                return await RequestAsync(client,HttpMethod.Post,
                    $"/api/v2/ui/archive/{workspace}/{Uri.EscapeDataString(section)}/order",
                    JsonSerializer.SerializeToNode(new {ids})!);
            }
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
