using System.Text.Json;
using System.Text.Json.Nodes;

// N2-04 MCP for archive directories, archive records and general materials.
// All operations use the same authorized V2 HTTP FolderId as the visible UI.
static partial class McpLocal
{
    private static readonly Dictionary<string,string> ArchiveFields=new()
    {
        ["name"]="name",["category"]="category",["remarks"]="remarks",
        ["tags"]="tags",["year"]="year"
    };
    private static string ArchiveSection(string workspace,JsonElement args)
    {
        string section=ReadString(args,"section");
        if(ArchiveRules.Module(workspace,section) is null)
            throw new McpKnownRejectionException("section 与当前工作区不匹配。");
        return section;
    }
    private static string ArchiveUrl(string workspace,string section,long? id=null)=>
        V2Url(workspace,"archive",id)+"?section="+Uri.EscapeDataString(section);
    private static JsonObject ArchivePayload(JsonObject fields,string section)=>
        new(){["archive"]=fields,["section"]=section};

    private static object[] ArchiveTools() =>
    [
        Tool("list_archives","列出当前工作区指定资料分类的 V2 档案 FolderId。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","certificate、achievement；个人另有 academic")
        },["workspace","section"]),
        Tool("create_archive","创建 V2 档案；公司 achievement 必须指定有效业务目录 folder_id。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","certificate、achievement 或 academic"),
            ["name"]=Field("string","档案名称"),
            ["category"]=Field("string","可选类别"),
            ["remarks"]=Field("string","可选备注"),
            ["tags"]=Field("string","可选标签"),
            ["year"]=Field("string","可选年度"),
            ["folder_id"]=Field("integer","公司业务档案的父目录 FolderId")
        },["workspace","section","name"]),
        Tool("update_archive","按 V2 FolderId 修改档案属性，保留原目录及附件。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","所属资料分类"),
            ["archive_id"]=Field("integer","档案 FolderId"),
            ["name"]=Field("string","新名称"),
            ["category"]=Field("string","类别"),
            ["remarks"]=Field("string","备注"),
            ["tags"]=Field("string","标签"),
            ["year"]=Field("string","年度")
        },["workspace","section","archive_id"]),
        Tool("delete_archive","按 V2 FolderId 将档案移入回收站。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["section"]=Field("string","所属资料分类"),
            ["archive_id"]=Field("integer","档案 FolderId")
        },["workspace","section","archive_id"]),
        Tool("list_archive_folders","列出公司业务档案 V2 根目录或指定 parent_id 下的直接子目录。",new(){
            ["workspace"]=Field("string","仅公司工作区",["company"]),
            ["parent_id"]=Field("integer","可选父目录 FolderId；省略则列出当前顶层目录")
        },["workspace"]),
        Tool("create_archive_folder","在有效父目录中新建公司业务档案下级目录。",new(){
            ["workspace"]=Field("string","仅公司工作区",["company"]),
            ["parent_id"]=Field("integer","有效父目录 FolderId"),
            ["name"]=Field("string","目录名称")
        },["workspace","parent_id","name"]),
        Tool("update_archive_folder","更改 V2 业务档案目录名称，不移动原父级。",new(){
            ["workspace"]=Field("string","仅公司工作区",["company"]),
            ["folder_id"]=Field("integer","目录 FolderId"),
            ["name"]=Field("string","新目录名称")
        },["workspace","folder_id","name"]),
        Tool("delete_archive_folder","删除空业务档案目录（包括初始目录）；非空目录不可删除。",new(){
            ["workspace"]=Field("string","仅公司工作区",["company"]),
            ["folder_id"]=Field("integer","目录 FolderId")
        },["workspace","folder_id"]),
        Tool("list_general","列出当前工作区 V2 综合资料 FolderId。",new(){
            ["workspace"]=Field("string","工作区",Workspaces)
        },["workspace"]),
        Tool("create_general","新增 V2 综合资料文件夹，仅名称必填。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["title"]=Field("string","资料名称")
        },["workspace","title"]),
        Tool("update_general","按 FolderId 修改综合资料名称，保留全部附件版本。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["general_id"]=Field("integer","综合资料 FolderId"),
            ["title"]=Field("string","新名称")
        },["workspace","general_id","title"]),
        Tool("delete_general","按 FolderId 将综合资料移入回收站。",new(){
            ["workspace"]=Field("string","工作区",Workspaces),
            ["general_id"]=Field("integer","综合资料 FolderId")
        },["workspace","general_id"])
    ];
    private static async Task<JsonNode> ExecuteArchiveAsync(HttpClient client,
        string workspace,string name,JsonElement args)
    {
        switch(name)
        {
            case "list_archives":
                return await RequestAsync(client,HttpMethod.Get,
                    ArchiveUrl(workspace,ArchiveSection(workspace,args)));
            case "create_archive":
            {
                string section=ArchiveSection(workspace,args);
                if(string.IsNullOrWhiteSpace(ReadString(args,"name")))
                    throw new McpKnownRejectionException("档案名称不能为空。");
                var data=Patch(new JsonObject(),args,ArchiveFields);
                if(section=="achievement"&&workspace=="company")
                    data["folderId"]=ReadId(args,"folder_id");
                else if(args.TryGetProperty("folder_id",out var supplied)&&
                    supplied.ValueKind!=JsonValueKind.Null)
                    throw new McpKnownRejectionException("该档案分类不使用父目录 ID。");
                return await RequestAsync(client,HttpMethod.Post,
                    V2Url(workspace,"archive"),ArchivePayload(data,section));
            }
            case "update_archive":
            {
                string section=ArchiveSection(workspace,args);
                if(args.TryGetProperty("folder_id",out _))
                    throw new McpKnownRejectionException("更新档案属性不能改变归属目录，请在页面中执行转移。");
                long id=ReadId(args,"archive_id");
                var current=await RequestAsync(client,HttpMethod.Get,ArchiveUrl(workspace,section,id));
                if(current["businessData"] is not JsonObject data)
                    throw new McpKnownRejectionException("档案业务数据无效。");
                return await RequestAsync(client,HttpMethod.Put,ArchiveUrl(workspace,section,id),
                    ArchivePayload(Patch((JsonObject)data.DeepClone(),args,ArchiveFields),section));
            }
            case "delete_archive":
                return await RequestAsync(client,HttpMethod.Delete,
                    ArchiveUrl(workspace,ArchiveSection(workspace,args),
                        ReadId(args,"archive_id")));
            case "list_archive_folders":
            {
                RequireCompany(workspace);
                string query=args.TryGetProperty("parent_id",out var parent)&&
                    parent.ValueKind!=JsonValueKind.Null?
                    "?parentId="+ReadId(args,"parent_id"):"";
                return await RequestAsync(client,HttpMethod.Get,
                    V2Url(workspace,"archive_folder")+query);
            }
            case "create_archive_folder":
            {
                RequireCompany(workspace);
                // A nonpositive parent is rejected before any HTTP dispatch:
                // this is a known bad argument, never an uncertain write.
                if(!args.TryGetProperty("parent_id",out var parent) ||
                   parent.ValueKind!=JsonValueKind.Number ||
                   !parent.TryGetInt64(out long parentId) || parentId<=0)
                    throw new McpKnownRejectionException(
                        "parent_id 必须是有效正整数；请先查询 list_archive_folders 获取父目录 ID。");
                var fields=new JsonObject{
                    ["name"]=ReadString(args,"name"),
                    ["parentId"]=parentId
                };
                return await RequestAsync(client,HttpMethod.Post,
                    V2Url(workspace,"archive_folder"),
                    new JsonObject{["archiveFolder"]=fields,["section"]="achievement"});
            }
            case "update_archive_folder":
            {
                RequireCompany(workspace);
                long id=ReadId(args,"folder_id");
                var current=await RequestAsync(client,HttpMethod.Get,
                    V2Url(workspace,"archive_folder",id));
                long parent=current["folder"]?["parent"]?["id"]?.GetValue<long>()
                    ??throw new McpKnownRejectionException("系统根目录不可修改。");
                return await RequestAsync(client,HttpMethod.Put,
                    V2Url(workspace,"archive_folder",id),
                    new JsonObject{["archiveFolder"]=new JsonObject{
                        ["name"]=ReadString(args,"name"),["parentId"]=parent}});
            }
            case "delete_archive_folder":
                RequireCompany(workspace);
                return await RequestAsync(client,HttpMethod.Delete,
                    V2Url(workspace,"archive_folder",ReadId(args,"folder_id")));
            case "list_general":
                return await RequestAsync(client,HttpMethod.Get,V2Url(workspace,"general"));
            case "create_general":
                return await RequestAsync(client,HttpMethod.Post,V2Url(workspace,"general"),
                    new JsonObject{["general"]=new JsonObject{
                        ["title"]=ReadString(args,"title")}});
            case "update_general":
            {
                long id=ReadId(args,"general_id");
                return await RequestAsync(client,HttpMethod.Put,
                    V2Url(workspace,"general",id),
                    new JsonObject{["general"]=new JsonObject{
                        ["title"]=ReadString(args,"title")}});
            }
            case "delete_general":
                return await RequestAsync(client,HttpMethod.Delete,
                    V2Url(workspace,"general",ReadId(args,"general_id")));
            default:throw new IOException("未实现的档案 MCP 操作："+name);
        }
    }
    private static void RequireCompany(string workspace)
    {
        if(workspace!="company")throw new McpKnownRejectionException("业务档案实体目录只属于公司工作区。");
    }
}