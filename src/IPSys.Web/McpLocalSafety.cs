using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

// MCP-only safety envelope. The encrypted journal prevents normal repeat calls
// from writing twice. A crash between HTTP side effect and journal completion
// remains uncertain and must be reconciled, never automatically re-executed.
static partial class McpLocal
{
    // Tracks in-flight requests in this process so only orphaned pending rows
    // are reconciled. Vault identity protects reopen/relock boundaries.
    private static readonly ConcurrentDictionary<(Vault vault,string workspace,string requestId),byte>
        LiveWriteOperations=new();
    private static bool IsWriteTool(string name)
    {
        return name.StartsWith("create_",StringComparison.Ordinal) ||
               name.StartsWith("update_",StringComparison.Ordinal) ||
               name.StartsWith("delete_",StringComparison.Ordinal) ||
               name is "upload_files" or "start_upload_task" || ExtraWrite(name);
    }

    private static void ValidateToolArguments(string name,JsonElement args)
    {
        var schemas=JsonSerializer.SerializeToElement(Tools(),Json);
        JsonElement tool=schemas.EnumerateArray().FirstOrDefault(x=>
            x.GetProperty("name").GetString()==name);
        if(tool.ValueKind!=JsonValueKind.Object)
            throw new IOException("未知 MCP 工具："+name);
        if(args.ValueKind!=JsonValueKind.Object)
            throw new IOException("MCP 工具参数必须为 JSON 对象。");
        var schema=tool.GetProperty("inputSchema");
        var fields=schema.GetProperty("properties");
        foreach(var required in schema.GetProperty("required").EnumerateArray())
        {
            string key=required.GetString()!;
            if(!args.TryGetProperty(key,out var value) || value.ValueKind==JsonValueKind.Null)
                throw new IOException("缺少必填参数："+key);
        }
        foreach(var param in args.EnumerateObject())
        {
            if(!fields.TryGetProperty(param.Name,out var field))
                throw new IOException("未声明的 MCP 参数："+param.Name);
            var accepted=field.GetProperty("type");
            string type=param.Value.ValueKind switch {
                JsonValueKind.String=>"string",
                JsonValueKind.Number=>param.Value.TryGetInt64(out _)?"integer":"number",
                JsonValueKind.True or JsonValueKind.False=>"boolean",
                JsonValueKind.Array=>"array",
                JsonValueKind.Object=>"object",
                JsonValueKind.Null=>"null",
                _=>"invalid"
            };
            bool valid=accepted.ValueKind==JsonValueKind.Array
                ?accepted.EnumerateArray().Any(t=>t.GetString()==type ||
                    type=="integer"&&t.GetString()=="number")
                :accepted.GetString()==type ||
                    (accepted.GetString()=="number"&&type=="integer");
            if(!valid)throw new IOException("参数类型不符："+param.Name);
            if(param.Value.ValueKind==JsonValueKind.Null)continue;
            if(field.TryGetProperty("enum",out var allowed) &&
                allowed.ValueKind==JsonValueKind.Array &&
                !allowed.EnumerateArray().Any(x=>x.ValueKind==param.Value.ValueKind &&
                    x.ToString()==param.Value.ToString()))
                throw new IOException("参数枚举值无效："+param.Name);
            if(type=="array")
            {
                int length=param.Value.GetArrayLength();
                if(field.TryGetProperty("minItems",out var lower)&&length<lower.GetInt32() ||
                    field.TryGetProperty("maxItems",out var upper)&&length>upper.GetInt32())
                    throw new IOException("数组元素数量无效："+param.Name);
                if(field.TryGetProperty("items",out var itemSchema))
                {
                    string itemType=itemSchema.GetProperty("type").GetString()!;
                    if(param.Value.EnumerateArray().Any(x=>itemType=="string" &&
                        x.ValueKind!=JsonValueKind.String))
                        throw new IOException("数组必须全部为文本："+param.Name);
                }
            }
        }
        if(IsWriteTool(name) && args.TryGetProperty("request_id",out var requestId) &&
            (requestId.ValueKind!=JsonValueKind.String ||
             requestId.GetString() is not string id || id.Length is <8 or >128 ||
             id.Any(char.IsControl)))
            throw new IOException("request_id 必须为 8–128 个字符的非控制字符字符串。");
    }

    internal static string SmokeArgumentsHash(JsonElement args)=>ArgumentsHash(args);
    private static string ArgumentsHash(JsonElement args)
    {
        // Sort top-level keys to make retries with a different property order
        // equivalent; omit the retry identifier from the business payload.
        using var doc=JsonDocument.Parse(JsonSerializer.Serialize(
            args.EnumerateObject().Where(x=>x.Name!="request_id")
                .OrderBy(x=>x.Name,StringComparer.Ordinal)
                .ToDictionary(x=>x.Name,x=>x.Value)));
        string normalized=doc.RootElement.GetRawText();
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
    }

    private static bool BusinessResultOk(string raw)
    {
        var node=JsonNode.Parse(raw);
        var status=node?["status"]?.GetValue<string>();
        return status is not ("failed" or "partial_success" or "interrupted") &&
            node?["ok"]?.ToJsonString()!="false";
    }

    private static async Task<JsonNode> ReadOperationAsync(Vault vault,string workspace,
        string requestId,CancellationToken stop)
    {
        await vault.Gate.WaitAsync(stop);
        try
        {
            using var cmd=vault.Db.CreateCommand();
            cmd.CommandText="SELECT tool_name,state,result_json FROM mcp_operations WHERE workspace=$w AND request_id=$id;";
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$id",requestId);
            string name,state;
            string? raw;
            using(var rd=cmd.ExecuteReader())
            {
                if(!rd.Read())return new JsonObject{["state"]="not_found",["requestId"]=requestId};
                name=rd.GetString(0);
                state=rd.GetString(1);
                raw=rd.IsDBNull(2)?null:rd.GetString(2);
            }
            // Reconcile on first query after reopening the vault. An active
            // write or upload must never be mistaken for a crashed host.
            if(state=="pending" &&
               !LiveWriteOperations.ContainsKey((vault,workspace,requestId)) &&
               !UploadTasks.ContainsKey(TaskKey(workspace,requestId)))
            {
                var abandoned=new JsonObject{
                    ["status"]="interrupted",["reason"]="host_restarted",
                    ["interruptedAt"]=DateTimeOffset.UtcNow.ToString("O"),
                    ["resumeSupported"]=false,
                    ["note"]="任务执行者已不存在，可能存在已提交的部分结果；请核对后再决定是否新建请求。"
                };
                using var fix=vault.Db.CreateCommand();
                fix.CommandText="""
                    UPDATE mcp_operations SET state='uncertain',
                        result_json=COALESCE(result_json,$reason),
                        updated_at=CURRENT_TIMESTAMP
                    WHERE workspace=$w AND request_id=$id AND state='pending';
                    """;
                fix.Parameters.AddWithValue("$w",workspace);
                fix.Parameters.AddWithValue("$id",requestId);
                fix.Parameters.AddWithValue("$reason",abandoned.ToJsonString(Json));
                if(fix.ExecuteNonQuery()==1)
                {
                    state="uncertain";
                    raw??=abandoned.ToJsonString(Json);
                }
            }
            return new JsonObject{
                ["requestId"]=requestId,["state"]=state,["tool"]=name,
                ["result"]=raw is null?null:JsonNode.Parse(raw),
                ["businessOk"]=state=="done" && raw is not null
                    ? BusinessResultOk(raw) : null
            };
        }
        finally { vault.Gate.Release(); }
    }

    private static async Task<JsonNode> ExecuteProtectedAsync(Vault vault,string address,
        string name,JsonElement args,CancellationToken stop,
        UploadTask? progress=null,bool preReserved=false)
    {
        if(!vault.McpEnabled && !preReserved)
            throw new IOException("MCP 未授权或授权已撤销。");
        string workspace=Workspace(args);
        if(name=="get_operation_result")
            return await ReadOperationAsync(vault,workspace,
                ReadString(args,"request_id"),stop);
        if(name is "get_task_status" or "cancel_task")
            return await ManageUploadTaskAsync(vault,workspace,name,args,stop);
        if(name=="start_upload_task")
            return await StartUploadTaskAsync(vault,address,workspace,args,stop);

        string requestId=ReadString(args,"request_id");
        if(!IsWriteTool(name)||requestId.Length==0)
            return await ExecuteAsync(vault,address,name,args,stop);

        string digest=ArgumentsHash(args);
        if(!preReserved)
        {
        await vault.Gate.WaitAsync(stop);
        try
        {
            using var select=vault.Db.CreateCommand();
            select.CommandText="SELECT tool_name,arguments_hash,state,result_json FROM mcp_operations WHERE workspace=$w AND request_id=$id;";
            select.Parameters.AddWithValue("$w",workspace);
            select.Parameters.AddWithValue("$id",requestId);
            using(var r=select.ExecuteReader())
            {
                if(r.Read())
                {
                    string storedTool=r.GetString(0),storedHash=r.GetString(1),
                        state=r.GetString(2);
                    string? result=r.IsDBNull(3)?null:r.GetString(3);
                    if(storedTool!=name||storedHash!=digest)
                        throw new IOException("request_id 已被其他操作或不同参数使用。");
                    if(state=="done"&&result is not null)
                        return JsonNode.Parse(result)??new JsonObject();
                    throw new IOException("该请求状态为 "+state+
                        "，不能自动重试。请先核对资料库并使用 get_operation_result 查询；结果不明时换用人工确认。");
                }
            }
            using var insert=vault.Db.CreateCommand();
            insert.CommandText="INSERT INTO mcp_operations(workspace,request_id,tool_name,arguments_hash,state) VALUES($w,$id,$name,$sha,'pending');";
            insert.Parameters.AddWithValue("$w",workspace);
            insert.Parameters.AddWithValue("$id",requestId);
            insert.Parameters.AddWithValue("$name",name);
            insert.Parameters.AddWithValue("$sha",digest);
            insert.ExecuteNonQuery();
            LiveWriteOperations.TryAdd((vault,workspace,requestId),0);
        }
        finally { vault.Gate.Release(); }
        }

        JsonNode? value=null;
        Exception? failure=null;
        try { value=await ExecuteAsync(vault,address,name,args,stop,progress); }
        catch(Exception ex){failure=ex;}
        if(failure is McpDefinitiveFailureException or McpKnownRejectionException)
            value=new JsonObject{
                ["ok"]=false,["status"]="failed",
                ["httpStatus"]=failure is McpDefinitiveFailureException rejected
                    ? rejected.StatusCode : 400,
                ["error"]=failure.Message
            };

        // The journal must finish even when a caller disconnects or revokes
        // authorization. A known result is reusable; otherwise it is uncertain.
        await vault.Gate.WaitAsync(CancellationToken.None);
        try
        {
            if(failure is McpPreflightBusyException)
            {
                using var undo=vault.Db.CreateCommand();
                undo.CommandText="DELETE FROM mcp_operations WHERE workspace=$w AND request_id=$id AND state='pending';";
                undo.Parameters.AddWithValue("$w",workspace);
                undo.Parameters.AddWithValue("$id",requestId);
                undo.ExecuteNonQuery();
            }
            else
            {
            using var update=vault.Db.CreateCommand();
            update.CommandText="""
                UPDATE mcp_operations SET state=$state,result_json=$result,
                    updated_at=CURRENT_TIMESTAMP
                WHERE workspace=$w AND request_id=$id AND state='pending';
                """;
            // Cancellation of a dispatched HTTP upload can leave an unknown
            // server-side side effect; retain partial outcomes for reconciliation.
            bool interrupted=value?["status"]?.GetValue<string>()=="interrupted";
            bool definitive=(failure is null or McpDefinitiveFailureException or
                McpKnownRejectionException)&&!interrupted;
            update.Parameters.AddWithValue("$state",definitive?"done":"uncertain");
            update.Parameters.AddWithValue("$result",failure is null or McpDefinitiveFailureException or
                McpKnownRejectionException?
                (object)(value?.ToJsonString(Json)??"{}"):DBNull.Value);
            update.Parameters.AddWithValue("$w",workspace);
            update.Parameters.AddWithValue("$id",requestId);
            update.ExecuteNonQuery();
            }
        }
        finally
        {
            vault.Gate.Release();
            if(!preReserved)LiveWriteOperations.TryRemove((vault,workspace,requestId),out _);
        }
        if(failure is McpPreflightBusyException)
            throw new IOException("MCP 请求在写入前因数据库忙被拒绝，可等待后使用相同 request_id 重试："+failure.Message,failure);
        // A definite HTTP 400/404 is a durable business failure, and replay
        // must produce the same error payload rather than an uncertain result.
        if(failure is McpDefinitiveFailureException or McpKnownRejectionException)
            return value??new JsonObject();
        if(failure!=null)throw new IOException("写操作返回异常，执行结果可能不确定；"+
            "禁止盲目重试。请用 get_operation_result 查询 request_id="+requestId+
            " 并检查对应业务记录。原始错误："+failure.Message,failure);
        return value??new JsonObject();
    }
}
