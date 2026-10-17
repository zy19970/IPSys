using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

// Ephemeral upload progress lives in the unlocked GUI host, while the final
// outcome and unknown-result protection remain in encrypted mcp_operations.
static partial class McpLocal
{
    private sealed class UploadTask(string workspace,string id,string digest,
        JsonElement args,CancellationTokenSource cancellation)
    {
        private readonly object _sync=new();
        private string _state="queued",_current="";
        private int _completed,_succeeded,_failed;
        private long _bytesSent;
        private bool _cancelRequested;
        public string Workspace {get;}=workspace;
        public string RequestId {get;}=id;
        public string Digest {get;}=digest;
        public JsonElement Args {get;}=args.Clone();
        public CancellationTokenSource Cancellation {get;}=cancellation;
        public int Requested {get;}=args.GetProperty("paths").GetArrayLength();
        public long TotalBytes {get;}=args.GetProperty("paths").EnumerateArray()
            .Sum(x=>{
                try {
                    var f=new FileInfo(Path.GetFullPath(x.GetString()??""));
                    return f.Exists ? f.Length : 0L;
                } catch { return 0L; }
            });
        public void Begin(string path)
        {
            lock(_sync){_state="running";_current=Path.GetFileName(path);}
        }
        public void Sent(int count)
        {
            lock(_sync){_bytesSent+=count;}
        }
        public void EndFile(bool succeeded)
        {
            lock(_sync){
                _completed++;
                if(succeeded)_succeeded++;else _failed++;
                _current="";
            }
        }
        public JsonObject Snapshot()
        {
            lock(_sync)return new JsonObject{
                ["requestId"]=RequestId,["workspace"]=Workspace,["state"]=_state,
                ["requested"]=Requested,["completed"]=_completed,
                ["succeeded"]=_succeeded,["failed"]=_failed,
                ["currentFile"]=_current,["bytesSent"]=_bytesSent,
                ["totalBytes"]=TotalBytes,["cancelRequested"]=_cancelRequested,
                ["note"]="bytesSent 是客户端已读取/发送的字节数，不代表 SQLCipher 已提交；取消后必须核对最终操作日志。"
            };
        }
        public void Cancel()
        {
            lock(_sync){_cancelRequested=true;_state="cancelling";}
            try{Cancellation.Cancel();}catch(ObjectDisposedException){}
        }
    }

    // Request IDs are only unique within a workspace, as in mcp_operations.
    private static readonly ConcurrentDictionary<string,UploadTask> UploadTasks=new();
    private static readonly SemaphoreSlim UploadStartGate=new(1,1);
    private static CancellationToken HostShutdownToken;
    private static string TaskKey(string workspace,string requestId)=>workspace+"\n"+requestId;
    private static string TaskRequestId(JsonElement args)
    {
        string id=RequiredText(args,"request_id");
        if(id.Length is <8 or >128 || id.Any(char.IsControl))
            throw new IOException("request_id 必须为 8–128 个非控制字符。");
        return id;
    }

    private static async Task<JsonNode> GetUploadTaskStatusAsync(Vault vault,
        string workspace,string requestId,CancellationToken stop)
    {
        if(UploadTasks.TryGetValue(TaskKey(workspace,requestId),out var active))
            return active.Snapshot();
        var record=await ReadOperationAsync(vault,workspace,requestId,stop);
        if(record["state"]?.GetValue<string>()!="not_found" &&
           record["tool"]?.GetValue<string>()!="upload_files")
            throw new IOException("该 request_id 属于其它写操作，不是上传任务。");
        return new JsonObject{
            ["requestId"]=requestId,["workspace"]=workspace,
            ["state"]=record["state"]?.DeepClone(),
            ["businessOk"]=record["businessOk"]?.DeepClone(),
            ["result"]=record["result"]?.DeepClone(),
            ["note"]="任务已经不在当前活动列表；done/uncertain 结果以 SQLCipher 操作日志为准。"
        };
    }

    private static async Task<JsonNode> StartUploadTaskAsync(Vault vault,
        string address,string workspace,JsonElement args,CancellationToken stop)
    {
        if(!vault.McpEnabled)throw new IOException("MCP 未授权。");
        // Reuse the exact synchronous upload schema, except that async entry
        // additionally makes request_id mandatory.
        ValidateToolArguments("upload_files",args);
        string id=TaskRequestId(args),key=TaskKey(workspace,id),
            digest=ArgumentsHash(args);
        await UploadStartGate.WaitAsync(stop);
        try
        {
            if(UploadTasks.TryGetValue(key,out var active))
            {
                if(active.Digest!=digest)
                    throw new IOException("request_id 已被不同上传参数占用。");
                return new JsonObject{["accepted"]=true,["requestId"]=id,
                    ["state"]=active.Snapshot()["state"]?.DeepClone()};
            }
            await vault.Gate.WaitAsync(stop);
            try
            {
                if(!vault.McpEnabled)throw new IOException("MCP 授权已撤销。");
                using var cmd=vault.Db.CreateCommand();
                cmd.CommandText="SELECT tool_name,arguments_hash,state FROM mcp_operations WHERE workspace=$w AND request_id=$id;";
                cmd.Parameters.AddWithValue("$w",workspace);
                cmd.Parameters.AddWithValue("$id",id);
                using(var reader=cmd.ExecuteReader())
                {
                    if(reader.Read())
                    {
                        if(reader.GetString(0)!="upload_files"||reader.GetString(1)!=digest)
                            throw new IOException("request_id 已被其它操作或不同上传参数使用。");
                        return new JsonObject{["accepted"]=false,["requestId"]=id,
                            ["state"]=reader.GetString(2),
                            ["note"]="已有请求日志；用 get_task_status 或 get_operation_result 查询，不会再执行上传。"};
                    }
                }
                using var insert=vault.Db.CreateCommand();
                insert.CommandText="INSERT INTO mcp_operations(workspace,request_id,tool_name,arguments_hash,state) VALUES($w,$id,'upload_files',$hash,'pending');";
                insert.Parameters.AddWithValue("$w",workspace);
                insert.Parameters.AddWithValue("$id",id);
                insert.Parameters.AddWithValue("$hash",digest);
                insert.ExecuteNonQuery();
                // The journal exists BEFORE acknowledging an async request.
                var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    vault.McpCancellation,HostShutdownToken);
                var task=new UploadTask(workspace,id,digest,args,linked);
                if(!UploadTasks.TryAdd(key,task))
                {
                    linked.Dispose();
                    throw new IOException("同编号上传任务已启动，请查询状态。");
                }
                _=Task.Run(async ()=>{
                    try {
                        await ExecuteProtectedAsync(vault,address,"upload_files",
                            task.Args,task.Cancellation.Token,task,true);
                    }
                    catch(Exception ex) {
                        Console.Error.WriteLine("MCP 异步上传 "+id+" 结束："+ex.Message);
                    }
                    finally {
                        UploadTasks.TryRemove(key,out _);
                        task.Cancellation.Dispose();
                    }
                });
            }
            finally{vault.Gate.Release();}
        }
        finally{UploadStartGate.Release();}
        return new JsonObject{["accepted"]=true,["requestId"]=id,
            ["state"]="pending",["note"]="通过 get_task_status 轮询，必要时调用 cancel_task；结果以 get_operation_result 为准。"};
    }

    private static async Task<JsonNode> ManageUploadTaskAsync(Vault vault,
        string workspace,string name,JsonElement args,CancellationToken stop)
    {
        string requestId=TaskRequestId(args);
        if(name=="cancel_task" && UploadTasks.TryGetValue(
            TaskKey(workspace,requestId),out var task))
        {
            task.Cancel();
            return task.Snapshot();
        }
        return await GetUploadTaskStatusAsync(vault,workspace,requestId,stop);
    }

    // Measure bytes as StreamContent reads them, without buffering 64 MiB.
    private sealed class ProgressReadStream(Stream source,UploadTask progress):Stream
    {
        public override bool CanRead=>true;
        public override bool CanSeek=>false;
        public override bool CanWrite=>false;
        public override long Length=>throw new NotSupportedException();
        public override long Position {get=>throw new NotSupportedException();set=>throw new NotSupportedException();}
        public override int Read(byte[] b,int o,int n)
        {
            int count=source.Read(b,o,n);progress.Sent(count);return count;
        }
        public override int Read(Span<byte> b)
        {
            int count=source.Read(b);progress.Sent(count);return count;
        }
        public override async Task<int> ReadAsync(byte[] b,int o,int n,CancellationToken c)
        {
            int count=await source.ReadAsync(b.AsMemory(o,n),c);
            progress.Sent(count);return count;
        }
        public override async ValueTask<int> ReadAsync(Memory<byte> b,CancellationToken c=default)
        {
            int count=await source.ReadAsync(b,c);progress.Sent(count);return count;
        }
        public override void Flush()=>source.Flush();
        public override Task FlushAsync(CancellationToken c)=>source.FlushAsync(c);
        public override long Seek(long o,SeekOrigin origin)=>throw new NotSupportedException();
        public override void SetLength(long value)=>throw new NotSupportedException();
        public override void Write(byte[] b,int o,int n)=>throw new NotSupportedException();
        protected override void Dispose(bool disposing)
        {
            if(disposing)source.Dispose();
            base.Dispose(disposing);
        }
    }
}
