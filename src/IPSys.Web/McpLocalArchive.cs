using System.Text.Json;
using System.Text.Json.Nodes;

// A single ordinary-folder MCP contract. Business modules are sections, not kinds.
static partial class McpLocal
{
    private static readonly Dictionary<string,string> FolderFields=new()
    {
        ["name"]="name",["category"]="category",["remarks"]="remarks",
        ["tags"]="tags",["year"]="year"
    };

    private static string DirectoryScope(string workspace,JsonElement args)
    {
        string section=ReadString(args,"section");
        if(!ArchiveDirectoryScopes.Allowed(workspace,section))
            throw new McpKnownRejectionException("必须明确指定当前工作区支持的 section。");
        return section;
    }

    private static string MaterialUrl(string workspace,string section,long? id=null)=>
        V2Url(workspace,"archive_folder",id)+"?section="+Uri.EscapeDataString(section)+
        (id.HasValue?"":"&flat=true");

    private static JsonObject MaterialPayload(JsonObject fields,string section)=>
        new(){["archiveFolder"]=fields,["section"]=section};

    private static object[] ArchiveTools() =>
    [
        Tool("list_folders","按工作区和 section 列出普通文件夹。section=project 时，parent_id 可以是项目 FolderId（直属目录）或子文件夹 FolderId。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","必须明确的资料模块，含 general"),
            ["parent_id"]=Field("integer","可选父文件夹 FolderId")
        },["workspace","section"]),
        Tool("create_folder","创建普通文件夹；section=project 时必须传入所属项目或项目子目录的 parent_id，其它模块可在根目录创建。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","资料模块"),
            ["name"]=Field("string","文件夹名称"),
            ["parent_id"]=Field("integer","section=project 时必填，传项目 FolderId 或上级文件夹 FolderId；其它模块可省略"),
            ["category"]=Field("string","可选类别"),
            ["year"]=Field("string","可选年度"),
            ["tags"]=Field("string","可选分号分隔标签"),
            ["remarks"]=Field("string","可选备注")
        },["workspace","section","name"]),
        Tool("update_folder","按 FolderId 更新普通文件夹属性，未传字段保留原值，移动请使用 move_folder。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","资料模块"),
            ["folder_id"]=Field("integer","文件夹 FolderId"),
            ["name"]=Field("string","可选新名称"),
            ["category"]=Field("string","可选类别"),
            ["year"]=Field("string","可选年度"),
            ["tags"]=Field("string","可选标签"),
            ["remarks"]=Field("string","可选备注")
        },["workspace","section","folder_id"]),
        Tool("delete_folder","将指定普通文件夹及子目录移入回收站，文件历史与共享关联按统一规则保护。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","资料模块"),
            ["folder_id"]=Field("integer","待删除 FolderId")
        },["workspace","section","folder_id"]),
        Tool("move_folder","同工作区将普通文件夹原位移动到任意合法资料模块，保留 FolderId/FileId/LinkId；目标为 project 必须提供真实项目或目录 FolderId。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","来源资料模块"),
            ["folder_id"]=Field("integer","待移动 FolderId"),
            ["parent_id"]=Field("integer","目标父 FolderId；非 project 模块可省略或传0表示根目录"),
            ["target_section"]=Field("string","可选目标资料模块，省略则与来源 section 相同")
        },["workspace","section","folder_id"]),
        Tool("transfer_folder","跨工作区或允许的模块间复制/移动完整目录树及附件版本；目标为 project 时必须指定目标项目或子目录。",new(){
            ["workspace"]=Field("string","来源工作区",Workspaces),
            ["section"]=Field("string","来源资料模块"),
            ["folder_id"]=Field("integer","来源 FolderId"),
            ["target_workspace"]=Field("string","目标工作区",Workspaces),
            ["target_section"]=Field("string","目标资料模块"),
            ["target_folder_id"]=Field("integer","可选目标父目录，省略表示模块根目录"),
            ["move"]=new Dictionary<string,object>{{"type","boolean"},{"description","true 移动；false 复制"}}
        },["workspace","section","folder_id","target_workspace","target_section"])
    ];

    private static async Task<JsonNode> ExecuteArchiveAsync(HttpClient client,
        string workspace,string name,JsonElement args)
    {
        string section=DirectoryScope(workspace,args);
        long FolderId()=>FolderIdFrom("folder_id");
        switch(name)
        {
            case "list_folders":
            {
                if(!args.TryGetProperty("parent_id",out var parent) ||
                   parent.ValueKind==JsonValueKind.Null)
                    return await RequestAsync(client,HttpMethod.Get,MaterialUrl(workspace,section));
                long id=FolderIdFrom("parent_id");
                return await RequestAsync(client,HttpMethod.Get,
                    V2Url(workspace,"archive_folder")+"?section="+Uri.EscapeDataString(section)+
                    "&parentId="+id);
            }
            case "create_folder":
            {
                string nameValue=RequiredFolderText("name");
                var fields=Patch(new JsonObject(),args,FolderFields);
                fields["name"]=nameValue;
                if(args.TryGetProperty("parent_id",out var parent) &&
                   parent.ValueKind!=JsonValueKind.Null)
                    fields["parentId"]=FolderIdFrom("parent_id");
                else if(section=="project")
                    throw new McpKnownRejectionException(
                        "项目内部创建目录必须指定 parent_id（项目或上级文件夹）。");
                return await RequestAsync(client,HttpMethod.Post,
                    V2Url(workspace,"archive_folder"),MaterialPayload(fields,section));
            }
            case "update_folder":
            {
                long id=FolderId();
                if(args.TryGetProperty("parent_id",out _))
                    throw new McpKnownRejectionException("修改父目录请使用 move_folder。");
                var current=await RequestAsync(client,HttpMethod.Get,MaterialUrl(workspace,section,id));
                if(current["businessData"] is not JsonObject original)
                    throw new McpKnownRejectionException("文件夹业务属性无效。");
                var fields=Patch((JsonObject)original.DeepClone(),args,FolderFields);
                return await RequestAsync(client,HttpMethod.Put,
                    MaterialUrl(workspace,section,id),MaterialPayload(fields,section));
            }
            case "delete_folder":
                return await RequestAsync(client,HttpMethod.Delete,
                    MaterialUrl(workspace,section,FolderId()));
            case "move_folder":
            {
                string targetSection=ReadString(args,"target_section",section);
                if(!ArchiveDirectoryScopes.Allowed(workspace,targetSection))
                    throw new McpKnownRejectionException("目标 section 不属于当前工作区。");
                long parent=RootOrFolderId("parent_id");
                if(targetSection=="project" && parent==0)
                    throw new McpKnownRejectionException("目标项目必须指定真实项目或目录 FolderId。");
                long id=FolderId();
                var body=new JsonObject{
                    ["targetFolderId"]=parent,["targetSection"]=targetSection,
                    ["move"]=true,["items"]=new JsonArray(JsonValue.Create(id))
                };
                // The GUI batch move and both MCP move routes share one
                // transaction; same-workspace moves never clone FileIds.
                return await RequestAsync(client,HttpMethod.Post,
                    "/api/v2/ui/folders/"+workspace+"/"+Uri.EscapeDataString(section)+
                    "/transfer-batch",body);
            }
            case "transfer_folder":
            {
                string targetWorkspace=RequiredFolderText("target_workspace");
                string targetSection=RequiredFolderText("target_section");
                if(!FolderTransferPolicy.Allowed(workspace,section,targetWorkspace,targetSection))
                    throw new McpKnownRejectionException("工作区与资料模块不在合法转移范围。");
                var body=new JsonObject{
                    ["targetWorkspace"]=targetWorkspace,
                    ["targetSection"]=targetSection,
                    ["move"]=Bool(args,"move")
                };
                long target=RootOrFolderId("target_folder_id");
                if(targetSection=="project" && target==0)
                    throw new McpKnownRejectionException("目标为项目时必须指定 target_folder_id。");
                if(target>0)body["targetFolderId"]=target;
                return await RequestAsync(client,HttpMethod.Post,
                    "/api/v2/ui/folders/"+workspace+"/"+Uri.EscapeDataString(section)+
                    "/"+FolderId()+"/transfer",body);
            }
            default:throw new IOException("不支持的普通文件夹 MCP 操作："+name);
        }

        // Invalid local arguments have a definite outcome: no HTTP write was
        // issued. Record them as done/businessOk=false, never uncertain.
        long RootOrFolderId(string key)
        {
            if(!args.TryGetProperty(key,out var value) ||
               value.ValueKind==JsonValueKind.Null)return 0;
            if(value.ValueKind!=JsonValueKind.Number ||
               !value.TryGetInt64(out long id) || id<0)
                throw new McpKnownRejectionException(key+" 必须是非负整数 FolderId（0 表示非项目模块根目录）。");
            return id;
        }
        long FolderIdFrom(string key)
        {
            try { return ReadId(args,key); }
            catch(IOException ex) { throw new McpKnownRejectionException(ex.Message); }
        }
        string RequiredFolderText(string key)
        {
            try { return RequiredText(args,key); }
            catch(IOException ex) { throw new McpKnownRejectionException(ex.Message); }
        }
    }
}
