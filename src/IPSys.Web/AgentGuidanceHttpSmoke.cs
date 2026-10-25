using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

// Real loopback HTTP + named-pipe MCP regression on the disposable smoke
// profile. User's production LocalAppData file is never touched by --smoke.
static class AgentGuidanceHttpSmoke
{
    private static void Check(bool result,string reason)
    {
        if(!result)throw new IOException("Agent guidance HTTP smoke: "+reason);
    }
    public static async Task VerifyAsync(HttpClient client,Vault vault)
    {
        var root=await client.GetFromJsonAsync<JsonElement>("/api/agent-guidance");
        Check(root.GetProperty("entries").GetArrayLength()==3 &&
              !root.TryGetProperty("content",out _),
            "directory returns only metadata");
        using(var unauth=new HttpClient{BaseAddress=client.BaseAddress})
        {
            using var denied=await unauth.GetAsync("/api/agent-guidance/search");
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,
                "unauthorized browser cannot read effective custom content");
            using var deniedWrite=await unauth.PutAsJsonAsync("/api/agent-guidance/search",
                new {content="unauthorized",expectedRevision="bad"});
            Check(deniedWrite.StatusCode==HttpStatusCode.Unauthorized,
                "unauthorized browser cannot update custom content");
        }
        var original=await client.GetFromJsonAsync<JsonElement>("/api/agent-guidance/search");
        string originalVersion=original.GetProperty("version").GetString()!;
        string originalRevision=original.GetProperty("revision").GetString()!;
        Check(original.GetProperty("source").GetString()=="builtin" &&
              original.GetProperty("editableContent").GetString()!.Contains("search_records"),
            "new disposable profile shows built-in text");
        string customized="# 机构检索约定\n仅处理测试工作区中的资料，检索时保留业务关联。";
        using(var saved=await client.PutAsJsonAsync("/api/agent-guidance/search",
            new {content=customized,expectedRevision=originalRevision}))
        {
            saved.EnsureSuccessStatusCode();
            var item=await saved.Content.ReadFromJsonAsync<JsonElement>();
            Check(item.GetProperty("source").GetString()=="user_override" &&
                  item.GetProperty("version").GetString()!=originalVersion &&
                  item.GetProperty("content").GetString()==customized,
                "saving a UI override immediately yields a new effective version");
        }
        var mcp=await McpLocal.RunSmokeToolAsync("get_agent_guidance",
            JsonSerializer.SerializeToElement(new{topic="search"}));
        Check(mcp["content"]?.GetValue<string>()==customized &&
              mcp["source"]?.GetValue<string>()=="user_override",
            "same running MCP host gets the new browser-saved rules immediately");
        var prompt=await McpLocal.RunSmokeProtocolPromptAsync("search");
        Check(prompt["result"]?["messages"]?[0]?["content"]?["text"]?
                .GetValue<string>()==customized,
            "standard Prompts reuses the current override");
        var concurrent=await Task.WhenAll(Enumerable.Range(0,8).Select(_=>
            McpLocal.RunSmokeProtocolPromptAsync("search")));
        Check(concurrent.All(x=>x["result"]?["messages"]?[0]?["content"]?["text"]?
            .GetValue<string>()==customized),
            "independent MCP readers see the same current user override");
        var fresh=await client.GetFromJsonAsync<JsonElement>("/api/agent-guidance/search");
        using(var stale=await client.PutAsJsonAsync("/api/agent-guidance/search",
            new {content="stale writer",expectedRevision=originalRevision}))
            Check(stale.StatusCode==HttpStatusCode.Conflict,
                "stale browser edit returns HTTP 409 without overwrite");

        var index=await client.GetFromJsonAsync<JsonElement>("/api/agent-guidance");
        var search=index.GetProperty("entries").EnumerateArray().First(x=>
            x.GetProperty("id").GetString()=="search");
        Check(search.GetProperty("source").GetString()=="user_override" &&
              search.GetProperty("version").GetString()==
                fresh.GetProperty("version").GetString(),
            "dynamic index includes updated effective source/version");
        using(var restore=await client.PostAsJsonAsync("/api/agent-guidance/search/restore",
            new {expectedRevision=fresh.GetProperty("revision").GetString()}))
        {
            restore.EnsureSuccessStatusCode();
            var state=await restore.Content.ReadFromJsonAsync<JsonElement>();
            Check(state.GetProperty("source").GetString()=="builtin" &&
                  state.GetProperty("version").GetString()==originalVersion,
                "restore recovers the built-in rules");
        }
        var exported=await client.GetFromJsonAsync<JsonElement>("/api/agent-guidance/export");
        string revision=exported.GetProperty("revision").GetString()!;
        using(var imported=await client.PostAsJsonAsync("/api/agent-guidance/import",new {
            config=new{schemaVersion=1,overrides=new{
                metadata="# 本机补录规范\n先检查缺失属性，不凭空补日期。"
            }},
            expectedRevision=revision
        }))
        {
            imported.EnsureSuccessStatusCode();
        }
        var metadata=await client.GetFromJsonAsync<JsonElement>("/api/agent-guidance/metadata");
        Check(metadata.GetProperty("source").GetString()=="user_override" &&
              metadata.GetProperty("content").GetString()!.Contains("文件内容读取共用规范"),
            "import overrides only the chosen topic and preserves shared safety rules");
        using(var invalid=await client.PostAsJsonAsync("/api/agent-guidance/import",new {
            config=new{schemaVersion=1,overrides=new {index="bypass safety"}},
            expectedRevision=metadata.GetProperty("revision").GetString()
        }))
            Check(invalid.StatusCode==HttpStatusCode.BadRequest,
                "import rejects immutable root and unauthorized topic names");

        using(var reset=await client.PostAsJsonAsync("/api/agent-guidance/import",new{
            config=new{schemaVersion=1,overrides=new{}},
            expectedRevision=metadata.GetProperty("revision").GetString()
        }))
            reset.EnsureSuccessStatusCode();
        Check(AgentGuidance.Read("metadata")["source"]?.GetValue<string>()=="builtin",
            "importing empty overrides restores defaults without touching SQLCipher");
        var restored=await client.GetFromJsonAsync<JsonElement>("/api/agent-guidance/export");
        Check(restored.GetProperty("overrides").EnumerateObject().Count()==0,
            "export after reset is empty");
        using(var cmd=vault.Db.CreateCommand())
        {
            cmd.CommandText="SELECT count(*) FROM mcp_operations WHERE tool_name='get_agent_guidance';";
            Check((long)cmd.ExecuteScalar()! == 0,
                "guidance reads do not write MCP operation log");
        }
    }
}
