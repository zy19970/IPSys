using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// Local per-Windows-user configuration, intentionally independent of SQLCipher.
// Never serve it via a static file route or store user overrides in the EXE.
sealed class AgentGuidanceStore
{
    internal sealed class OverrideText
    {
        public string Content {get;set;}="";
        public string UpdatedAt {get;set;}="";
    }
    private sealed class Package
    {
        public int SchemaVersion {get;set;}=1;
        public Dictionary<string,OverrideText> Overrides {get;set;}=new(StringComparer.Ordinal);
    }
    private static readonly JsonSerializerOptions Options=new(JsonSerializerDefaults.Web);
    private readonly object gate=new();
    private readonly string path;
    private const int MaxTopicBytes=48*1024;
    private const int MaxPackageBytes=256*1024;
    private static AgentGuidanceStore current=new(DefaultPath());
    internal static AgentGuidanceStore Current=>Volatile.Read(ref current);
    private sealed class SmokeScope(AgentGuidanceStore previous,string directory) : IDisposable
    {
        public void Dispose()
        {
            Interlocked.Exchange(ref current,previous);
            try{Directory.Delete(directory,true);}catch(IOException){}
            catch(UnauthorizedAccessException){}
        }
    }
    internal static IDisposable UseTemporaryForSmoke()
    {
        string directory=Path.Combine(Path.GetTempPath(),
            "ipsys-guidance-smoke-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var before=Interlocked.Exchange(ref current,
            new AgentGuidanceStore(Path.Combine(directory,"agent-guidance.json")));
        return new SmokeScope(before,directory);
    }

    private static string DefaultPath()
    {
        string root=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if(string.IsNullOrWhiteSpace(root))
            throw new IOException("无法确定 Windows 用户应用配置目录。");
        return Path.Combine(root,"IPSys","agent-guidance.json");
    }
    internal AgentGuidanceStore(string filePath)
    {
        path=Path.GetFullPath(filePath);
    }
    private static void ValidateTopic(string topic)
    {
        if(topic is not ("search" or "upload" or "metadata"))
            throw new ArgumentException("仅允许修改 search、upload、metadata 专项规范。");
    }
    private static void ValidateContent(string content)
    {
        if(string.IsNullOrWhiteSpace(content))
            throw new ArgumentException("规范内容不能为空。");
        if(Encoding.UTF8.GetByteCount(content)>MaxTopicBytes)
            throw new ArgumentException("单篇规范不得超过 48 KiB。");
        if(content.Any(c=>c=='\0'))
            throw new ArgumentException("规范包含非法控制字符。");
    }
    private static void ValidatePackage(Package data)
    {
        if(data.SchemaVersion!=1 || data.Overrides==null ||
           data.Overrides.Count>3)
            throw new ArgumentException("Agent 规范配置格式或版本无效。");
        foreach(var (topic,entry) in data.Overrides)
        {
            ValidateTopic(topic);
            if(entry==null)throw new ArgumentException("规范内容不能为空。");
            ValidateContent(entry.Content);
        }
    }
    private Package Load()
    {
        if(!File.Exists(path))return new Package();
        Package config;
        try
        {
            // FileShare.Delete allows atomic profile replacement while an
            // independent MCP reader holds the previous complete snapshot.
            using var input=new FileStream(path,FileMode.Open,FileAccess.Read,
                FileShare.ReadWrite|FileShare.Delete);
            if(input.Length>MaxPackageBytes)
                throw new IOException("Agent 规范配置超过大小限制。");
            using var reader=new StreamReader(input,Encoding.UTF8,true);
            config=JsonSerializer.Deserialize<Package>(
                reader.ReadToEnd(),Options) ??
                throw new IOException("Agent 规范配置为空。");
        }
        catch(JsonException ex){throw new IOException("Agent 规范配置 JSON 已损坏。",ex);}
        ValidatePackage(config);
        return config;
    }
    private static string Revision(Package config)
    {
        string normalized=string.Join("\n",config.Overrides.OrderBy(x=>x.Key,
            StringComparer.Ordinal).Select(x=>x.Key+"\n"+x.Value.UpdatedAt+
            "\n"+x.Value.Content));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)))
            .ToLowerInvariant();
    }
    private void CheckExpected(Package config,string expectedRevision)
    {
        if(string.IsNullOrWhiteSpace(expectedRevision)||
           !string.Equals(Revision(config),expectedRevision,StringComparison.Ordinal))
            throw new InvalidOperationException(
                "Agent 规范已在其他窗口更新，请重新加载后再保存。");
    }
    private void Persist(Package config)
    {
        ValidatePackage(config);
        string json=JsonSerializer.Serialize(config,Options);
        if(Encoding.UTF8.GetByteCount(json)>MaxPackageBytes)
            throw new ArgumentException("Agent 规范配置超过大小限制。");
        string directory=Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);
        string staging=Path.Combine(directory,"."+Path.GetFileName(path)+"."+
            Guid.NewGuid().ToString("N")+".tmp");
        try
        {
            File.WriteAllText(staging,json,new UTF8Encoding(false));
            // Replacement within the same directory makes readers observe a
            // complete old or new snapshot, never a partially written JSON.
            File.Move(staging,path,true);
        }
        finally
        {
            if(File.Exists(staging))File.Delete(staging);
        }
    }
    internal (string? Content,string? UpdatedAt,string Revision) Get(string topic)
    {
        ValidateTopic(topic);
        lock(gate)
        {
            var config=Load();
            config.Overrides.TryGetValue(topic,out var custom);
            return (custom?.Content,custom?.UpdatedAt,Revision(config));
        }
    }
    internal string RevisionNow()
    {
        lock(gate)return Revision(Load());
    }
    internal string Save(string topic,string content,string expectedRevision)
    {
        ValidateTopic(topic);
        ValidateContent(content);
        lock(gate)
        {
            var config=Load();
            CheckExpected(config,expectedRevision);
            config.Overrides[topic]=new OverrideText{
                Content=content,UpdatedAt=DateTimeOffset.UtcNow.ToString("O")
            };
            Persist(config);
            return Revision(config);
        }
    }
    internal string Restore(string topic,string expectedRevision)
    {
        ValidateTopic(topic);
        lock(gate)
        {
            var config=Load();
            CheckExpected(config,expectedRevision);
            config.Overrides.Remove(topic);
            Persist(config);
            return Revision(config);
        }
    }
    internal object Export()
    {
        lock(gate)
        {
            var config=Load();
            return new {
                schemaVersion=1,
                overrides=config.Overrides.ToDictionary(x=>x.Key,
                    x=>x.Value.Content,StringComparer.Ordinal),
                revision=Revision(config)
            };
        }
    }
    internal string Import(JsonElement package,string expectedRevision)
    {
        if(package.ValueKind!=JsonValueKind.Object)
            throw new ArgumentException("导入配置必须为 JSON 对象。");
        string json=package.GetRawText();
        if(Encoding.UTF8.GetByteCount(json)>MaxPackageBytes)
            throw new ArgumentException("导入配置超过大小限制。");
        if(package.ValueKind!=JsonValueKind.Object ||
           !package.TryGetProperty("schemaVersion",out var schema) ||
           schema.ValueKind!=JsonValueKind.Number ||
           !schema.TryGetInt32(out int schemaVersion) ||
           schemaVersion!=1 ||
           !package.TryGetProperty("overrides",out var overrides) ||
           overrides.ValueKind!=JsonValueKind.Object)
            throw new ArgumentException("导入文件必须包含 schemaVersion=1 和 overrides 对象。");
        var replacement=new Package();
        foreach(var item in overrides.EnumerateObject())
        {
            ValidateTopic(item.Name);
            if(item.Value.ValueKind!=JsonValueKind.String)
                throw new ArgumentException("导入的规范内容必须为字符串。");
            string content=item.Value.GetString()??"";
            ValidateContent(content);
            replacement.Overrides[item.Name]=new OverrideText{
                Content=content,UpdatedAt=DateTimeOffset.UtcNow.ToString("O")
            };
        }
        ValidatePackage(replacement);
        lock(gate)
        {
            var existing=Load();
            CheckExpected(existing,expectedRevision);
            Persist(replacement);
            return Revision(replacement);
        }
    }
}
