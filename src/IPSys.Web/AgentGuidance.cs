using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

// One embedded registry for MCP tools, standard Prompts and settings.
// Only optional topic bodies may be overridden; root security guidance and
// shared file-reading safeguards always come from immutable EXE resources.
static class AgentGuidance
{
    private sealed record Guide(string Id,string Title,string Summary,string Resource);
    private const string BuiltinVersion="1.0.0";
    private const string BuiltinUpdatedAt="2026-10-25";
    private static readonly Guide[] Guides =
    [
        new("search","智能检索规范","关键词扩展、完整分页、文件身份及原件核实","search.md"),
        new("upload","智能入库规范","默认先读原件、提取可信属性并核对上传；支持明确跳过分析","upload.md"),
        new("metadata","属性维护规范","已入库文件按可补录缺项筛选、去重阅读并保守回写","metadata.md")
    ];
    private static string ReadEmbedded(string name)
    {
        string resource="IPSys.Web.AgentGuidance."+name;
        using Stream stream=typeof(AgentGuidance).Assembly.GetManifestResourceStream(resource)
            ?? throw new IOException("缺少内置 Agent 规范资源："+name);
        using var reader=new StreamReader(stream,Encoding.UTF8);
        return reader.ReadToEnd().Trim();
    }
    internal static string InitializeInstructions=>ReadEmbedded("index.md");

    internal static bool HasTopic(string topic)=>
        topic=="index"||Guides.Any(g=>g.Id==topic);

    // Keep built-in text linked to this EXE when restoring an unchanged snapshot.
    internal static string BuiltinEditable(string topic)=>
        ReadEmbedded(Guides.FirstOrDefault(g=>g.Id==topic)?.Resource
            ?? throw new ArgumentException("未知 Agent 专项规范。"));

    internal static object[] Prompts()=>
    [
        new {name="index",title="Agent 工作规范目录",
            description="仅列出 search、upload、metadata 的 ID 和摘要，不加载全文"},
        ..Guides.Select(g=>(object)new{
            name=g.Id,title=g.Title,description=g.Summary
        })
    ];

    private static string Fingerprint(string content)=>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content)))
            .ToLowerInvariant()[..12];

    private static (string Content,string Base,string Version,
        string Updated,string Source,string Revision) Effective(
        Guide guide,AgentGuidanceStore store)
    {
        string builtin=ReadEmbedded(guide.Resource);
        var (custom,updated,revision)=store.Get(guide.Id);
        string baseContent=guide.Id is "upload" or "metadata"
            ?builtin+"\n\n"+ReadEmbedded("file-reading.md"):builtin;
        string effective=custom==null?baseContent:
            guide.Id is "upload" or "metadata"
                ?custom+"\n\n"+ReadEmbedded("file-reading.md"):custom;
        return (effective,builtin,BuiltinVersion+"+"+Fingerprint(effective),
            updated??BuiltinUpdatedAt,
            custom==null?"builtin":"user_override",revision);
    }

    internal static JsonNode Read(string topic,AgentGuidanceStore? storage=null)
    {
        var store=storage??AgentGuidanceStore.Current;
        if(topic=="index")
        {
            var entries=new JsonArray();
            foreach(var guide in Guides)
            {
                var item=Effective(guide,store);
                entries.Add(new JsonObject{
                    ["id"]=guide.Id,["title"]=guide.Title,["summary"]=guide.Summary,
                    ["version"]=item.Version,["updatedAt"]=item.Updated,
                    ["source"]=item.Source
                });
            }
            return new JsonObject{
                ["id"]="index",["title"]="Agent 工作规范目录",
                ["summary"]="仅列出可单独获取的专项规范，不包含专项正文",
                ["version"]=BuiltinVersion+"+"+Fingerprint(
                    string.Join("|",entries.Select(x=>x?["version"]?.GetValue<string>()))),
                ["updatedAt"]=entries.Select(x=>x?["updatedAt"]?.GetValue<string>())
                    .Where(x=>!string.IsNullOrEmpty(x))
                    .OrderByDescending(x=>x,StringComparer.Ordinal)
                    .FirstOrDefault()??BuiltinUpdatedAt,
                ["source"]="builtin",
                ["guidanceOnly"]=true,["entries"]=entries
            };
        }
        Guide? selected=Guides.FirstOrDefault(x=>x.Id==topic);
        if(selected==null)
            throw new IOException("未知 Agent 规范 topic："+topic+
                "；可用值：index、search、upload、metadata。");
        var effective=Effective(selected,store);
        return new JsonObject{
            ["id"]=selected.Id,["title"]=selected.Title,
            ["summary"]=selected.Summary,
            ["version"]=effective.Version,["updatedAt"]=effective.Updated,
            ["source"]=effective.Source,["guidanceOnly"]=true,
            ["content"]=effective.Content
        };
    }

    internal static JsonNode Editable(string topic,
        AgentGuidanceStore? storage=null)
    {
        if(topic=="index")
            return Read("index",storage);
        var store=storage??AgentGuidanceStore.Current;
        Guide selected=Guides.FirstOrDefault(g=>g.Id==topic)??
            throw new ArgumentException("规范 ID 无效。");
        var effective=Effective(selected,store);
        return new JsonObject{
            ["id"]=selected.Id,["title"]=selected.Title,
            ["summary"]=selected.Summary,
            ["version"]=effective.Version,
            ["updatedAt"]=effective.Updated,["source"]=effective.Source,
            ["baseContent"]=effective.Base,
            ["editableContent"]=store.Get(topic).Content??effective.Base,
            ["content"]=effective.Content,
            ["revision"]=effective.Revision,
            ["guidanceOnly"]=true
        };
    }

    internal static object PromptFromGuidance(JsonNode guidance)
    {
        string name=guidance["id"]?.GetValue<string>()??"";
        if(!HasTopic(name))throw new IOException("未知 Agent 规范："+name);
        string body=name=="index"?guidance.ToJsonString():
            guidance["content"]?.GetValue<string>()??
            throw new IOException("规范正文不可用："+name);
        return new {
            description=guidance["summary"]?.GetValue<string>(),
            messages=new[] { new { role="user",content=new {type="text",text=body} } }
        };
    }
}
