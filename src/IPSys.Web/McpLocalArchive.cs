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
        Tool("list_folders","按工作区和 section 列出普通资料文件夹，默认遍历全层级；指定 parent_id 时仅列直属子文件夹。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","必须明确的资料模块，含 general"),
            ["parent_id"]=Field("integer","可选父文件夹 FolderId")
        },["workspace","section"]),
        Tool("create_folder","创建普通资料文件夹，可在模块根目录或任意同模块目录下创建。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","资料模块"),
            ["name"]=Field("string","文件夹名称"),
            ["parent_id"]=Field("integer","可选父文件夹 FolderId，不填表示模块根目录"),
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
        Tool("move_folder","调整普通文件夹在同工作区同模块内的父目录，省略 parent_id 表示模块根目录。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","资料模块"),
            ["folder_id"]=Field("integer","待移动 FolderId"),
            ["parent_id"]=Field("integer","可选目标父 FolderId")
        },["workspace","section","folder_id"]),
        Tool("transfer_folder","跨工作区或允许的模块间复制/移动完整目录树及其附件所有版本，根目录可作为目标。",new(){
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
        long FolderId()=>ReadId(args,"folder_id");
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
                string nameValue=RequiredText(args,"name");
                var fields=Patch(new JsonObject(),args,FolderFields);
                fields["name"]=nameValue;
                if(args.TryGetProperty("parent_id",out var parent) &&
                   parent.ValueKind!=JsonValueKind.Null)
                    fields["parentId"]=FolderIdFrom("parent_id");
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
                long? parent=null;
                if(args.TryGetProperty("parent_id",out var target) &&
                   target.ValueKind!=JsonValueKind.Null)
                    parent=FolderIdFrom("parent_id");
                return await RequestAsync(client,HttpMethod.Post,
                    V2Url(workspace,"archive_folder",FolderId())+
                    "/move?section="+Uri.EscapeDataString(section),
                    new JsonObject{["parentId"]=parent is long n?JsonValue.Create(n):null});
            }
            case "transfer_folder":
            {
                string targetWorkspace=RequiredText(args,"target_workspace");
                string targetSection=RequiredText(args,"target_section");
                if(!ArchiveDirectoryScopes.Allowed(targetWorkspace,targetSection))
                    throw new McpKnownRejectionException("目标工作区或 section 无效。");
                var body=new JsonObject{
                    ["targetWorkspace"]=targetWorkspace,
                    ["targetSection"]=targetSection,
                    ["move"]=Bool(args,"move")
                };
                if(args.TryGetProperty("target_folder_id",out var target) &&
                   target.ValueKind!=JsonValueKind.Null)
                    body["targetFolderId"]=FolderIdFrom("target_folder_id");
                return await RequestAsync(client,HttpMethod.Post,
                    "/api/v2/ui/folders/"+workspace+"/"+Uri.EscapeDataString(section)+
                    "/"+FolderId()+"/transfer",body);
            }
            default:throw new IOException("不支持的普通文件夹 MCP 操作："+name);
        }

        long FolderIdFrom(string key)=>ReadId(args,key);
    }
}
