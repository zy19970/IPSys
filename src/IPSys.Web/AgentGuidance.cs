using System.Text;
using System.Text.Json.Nodes;

// Built-in, read-only MCP Agent guidance. One registry powers the lightweight
// initialize entry and individual topics; later Prompts/UI must reuse it.
static class AgentGuidance
{
    private sealed record Guide(string Id,string Title,string Summary,string Resource);
    private const string Version="1.0.0";
    private const string UpdatedAt="2026-10-25";
    private const string Source="builtin";
    private static readonly Guide[] Guides =
    [
        new("search","智能检索规范","关键词扩展、完整分页、文件身份及原件核实","search.md"),
        new("upload","智能入库规范","默认先读原件、提取可信属性并核对上传；支持明确跳过分析","upload.md"),
        new("metadata","属性维护规范","已入库文件按可补录缺项筛选、去重阅读并保守回写","metadata.md")
    ];

    // The standard MCP Prompts listing and tool directory use the same records.
    // Built-in names and metadata are non-sensitive; full prompt text still
    // requires an authorized host connection.
    internal static object[] Prompts()=>
    [
        new {name="index",title="Agent 工作规范目录",
            description="列出 search、upload、metadata 的 ID、摘要和版本，不加载全文"},
        ..Guides.Select(g=>(object)new {
            name=g.Id,title=g.Title,description=g.Summary
        })
    ];

    internal static bool HasTopic(string name)=>
        name=="index" || Guides.Any(g=>g.Id==name);

    internal static object PromptFromGuidance(JsonNode guidance)
    {
        string name=guidance["id"]?.GetValue<string>()??"";
        if(!HasTopic(name))throw new IOException("未知 Agent 规范："+name);
        // MCP protocol 2025-06-18 uses role=user and type=text.
        string body=name=="index"?guidance.ToJsonString():
            guidance["content"]?.GetValue<string>()??
            throw new IOException("规范正文不可用："+name);
        return new {
            description=guidance["summary"]?.GetValue<string>(),
            messages=new[] { new { role="user",content=new {type="text",text=body} } }
        };
    }

    private static string ReadEmbedded(string name)
    {
        string resource="IPSys.Web.AgentGuidance."+name;
        using Stream stream=typeof(AgentGuidance).Assembly.GetManifestResourceStream(resource)
            ?? throw new IOException("缺少内置 Agent 规范资源："+name);
        using var reader=new StreamReader(stream,Encoding.UTF8);
        return reader.ReadToEnd().Trim();
    }

    // The short root is the sole source for the initialize instructions.
    internal static string InitializeInstructions=>ReadEmbedded("index.md");

    internal static JsonNode Read(string topic)
    {
        if(topic=="index")
        {
            var entries=new JsonArray();
            foreach(var guide in Guides)
                entries.Add(new JsonObject{
                    ["id"]=guide.Id,["title"]=guide.Title,["summary"]=guide.Summary,
                    ["version"]=Version,["updatedAt"]=UpdatedAt,["source"]=Source
                });
            return new JsonObject{
                ["id"]="index",["title"]="Agent 工作规范目录",
                ["summary"]="仅列出可单独获取的专项规范，不包含专项正文",
                ["version"]=Version,["updatedAt"]=UpdatedAt,["source"]=Source,
                ["guidanceOnly"]=true,["entries"]=entries
            };
        }

        Guide? selected=Guides.FirstOrDefault(x=>x.Id==topic);
        if(selected==null)
            throw new IOException("未知 Agent 规范 topic："+topic+
                "；可用值：index、search、upload、metadata。");
        string content=ReadEmbedded(selected.Resource);
        if(topic is "upload" or "metadata")
            content+="\n\n"+ReadEmbedded("file-reading.md");
        return new JsonObject{
            ["id"]=selected.Id,["title"]=selected.Title,
            ["summary"]=selected.Summary,
            ["version"]=Version,["updatedAt"]=UpdatedAt,["source"]=Source,
            ["guidanceOnly"]=true,["content"]=content
        };
    }
}
