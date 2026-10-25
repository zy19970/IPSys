using System.Text.Json;
using System.Text.Json.Nodes;

// Runs only against a disposable local user-settings file, not the actual
// Windows profile or any SQLCipher business database.
static class AgentGuidanceStoreSmoke
{
    public static void Run()
    {
        static void Check(bool ok,string reason)
        {
            if(!ok)throw new IOException("Agent guidance config smoke: "+reason);
        }
        string folder=Path.Combine(Path.GetTempPath(),
            "ipsys-guidance-unit-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try
        {
            string path=Path.Combine(folder,"agent-guidance.json");
            var store=new AgentGuidanceStore(path);
            var baseline=AgentGuidance.Read("search",store);
            var initialRevision=store.RevisionNow();
            Check(baseline["source"]?.GetValue<string>()=="builtin" &&
                !File.Exists(path),"new profile uses in-assembly default without writing file");
            var index=AgentGuidance.Read("index",store);
            Check(index["entries"] is JsonArray list && list.Count==3 &&
                index["content"]==null,"index lists entries only");
            string custom="# 定制智能检索规则\n使用用户授权的工作区。";
            var newRevision=store.Save("search",custom,initialRevision);
            Check(newRevision!=initialRevision && File.Exists(path),
                "saving an override persists a distinct state revision");
            var effective=AgentGuidance.Read("search",store);
            Check(effective["source"]?.GetValue<string>()=="user_override" &&
                  effective["content"]?.GetValue<string>()==custom &&
                  effective["version"]?.GetValue<string>()!=
                      baseline["version"]?.GetValue<string>(),
                "effective content, source and hash-version update immediately");
            var other=new AgentGuidanceStore(path);
            Check(AgentGuidance.Read("search",other)["content"]?.GetValue<string>()==custom,
                "a separate process-style reader reloads the same file");
            Check(AgentGuidance.Read("upload",other)["source"]?.GetValue<string>()=="builtin",
                "unmodified topics keep built-in defaults");
            Check(AgentGuidance.InitializeInstructions.Contains("get_agent_guidance") &&
                !AgentGuidance.InitializeInstructions.Contains("定制智能检索规则"),
                "initialize root remains fixed and cannot leak user overrides");
            bool stale=false;
            try{store.Save("upload","自定义上传说明",initialRevision);}
            catch(InvalidOperationException){stale=true;}
            Check(stale,"stale profile revision cannot overwrite a newer edit");
            Check(store.RevisionNow()==newRevision,
                "stale write does not mutate the configuration");
            var metadata=store.Save("metadata","我的补录步骤",newRevision);
            var text=AgentGuidance.Read("metadata",store)["content"]?.GetValue<string>()??"";
            Check(text.StartsWith("我的补录步骤") &&
                text.Contains("文件内容读取共用规范") &&
                text.Contains("不能被提升为 Agent"),
                "shared safety/reading rules remain immutable with custom topic");
            Check(metadata!=newRevision,"second topic changes profile version");

            var exported=JsonSerializer.SerializeToElement(store.Export());
            Check(exported.GetProperty("overrides").GetProperty("search")
                .GetString()==custom && !exported.TryGetProperty("password",out _),
                "portable config exports only user override content");
            string importedPath=Path.Combine(folder,"imported.json");
            var imported=new AgentGuidanceStore(importedPath);
            imported.Import(exported,imported.RevisionNow());
            Check(AgentGuidance.Read("search",imported)["content"]?.GetValue<string>()==custom &&
                  AgentGuidance.Read("metadata",imported)["source"]?.GetValue<string>()=="user_override",
                  "imported overrides survive a new storage instance");
            bool badId=false;
            try
            {
                using var invalid=JsonDocument.Parse(
                    """{"schemaVersion":1,"overrides":{"index":"replace protected root"}}""");
                imported.Import(invalid.RootElement,imported.RevisionNow());
            }
            catch(ArgumentException){badId=true;}
            Check(badId && AgentGuidance.InitializeInstructions.Contains("MCP 授权"),
                "import cannot overwrite root safety instructions");
            bool badSchema=false;
            try
            {
                using var invalid=JsonDocument.Parse("""{"schemaVersion":5,"overrides":{}}""");
                imported.Import(invalid.RootElement,imported.RevisionNow());
            }
            catch(ArgumentException){badSchema=true;}
            Check(badSchema,"unknown config schema fails closed");
            bool staleImport=false;
            try{imported.Import(exported,initialRevision);}
            catch(InvalidOperationException){staleImport=true;}
            Check(staleImport,"import is protected from concurrent overwrites");
            bool huge=false;
            try {store.Save("search",new string('X',50*1024),store.RevisionNow());}
            catch(ArgumentException){huge=true;}
            Check(huge,"oversized user prompt is rejected");

            var restoredRevision=store.Restore("search",store.RevisionNow());
            Check(AgentGuidance.Read("search",store)["source"]?.GetValue<string>()=="builtin" &&
                  restoredRevision!=metadata &&
                  AgentGuidance.Read("metadata",store)["source"]?.GetValue<string>()=="user_override",
                "restore affects only selected topic");
            using var clear=JsonDocument.Parse("""{"schemaVersion":1,"overrides":{}}""");
            store.Import(clear.RootElement,restoredRevision);
            Check(AgentGuidance.Read("metadata",store)["source"]?.GetValue<string>()=="builtin",
                "empty import restores all built-in defaults");
            bool readFailed=false;
            File.WriteAllText(path,"{ invalid JSON",System.Text.Encoding.UTF8);
            try { AgentGuidance.Read("search",store); }
            catch(IOException){readFailed=true;}
            Check(readFailed,"corrupted configuration must not silently reset to defaults");
        }
        finally
        {
            try{Directory.Delete(folder,true);}catch(IOException){}
            catch(UnauthorizedAccessException){}
        }
    }
}
