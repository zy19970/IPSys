using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

// V2 IP attachment MCP tools always use authenticated local HTTP and the
// native FolderId/FileId/LinkId scope. No legacy business-file IDs are read.
static partial class McpLocal
{
    private static async Task<JsonNode> IpLinks(HttpClient client,string workspace,
        JsonElement args)
    {
        long folder=ReadId(args,"ip_id");
        return await RequestAsync(client,HttpMethod.Get,
            $"/api/v2/ip/{workspace}/{folder}/files");
    }

    private static async Task<JsonNode> DeleteIpLink(HttpClient client,string workspace,
        JsonElement args)
    {
        long folder=ReadId(args,"ip_id"),file=ReadId(args,"file_id"),
             link=ReadId(args,"link_id");
        return await RequestAsync(client,HttpMethod.Delete,
            $"/api/v2/ip/{workspace}/{folder}/files/{file}/links/{link}");
    }

    private static async Task<JsonNode> IpUploadFiles(HttpClient client,string workspace,
        JsonElement args,CancellationToken stop)
    {
        long folder=ReadId(args,"owner_id");
        string mode=ReadString(args,"on_conflict","new");
        string choice=ReadString(args,"duplicate_mode","");
        string category=ReadString(args,"material_category","其他材料");
        if(mode is not ("new" or "update"))
            throw new IOException("on_conflict 仅支持 new 或 update。");
        if(category is not ("申请材料" or "通知文件" or "证书文件" or "其他材料"))
            throw new IOException("知识产权材料类别无效。");
        if(choice is not ("" or "independent" or "reuse" or "share"))
            throw new IOException("duplicate_mode 仅支持 independent、reuse、share。");
        if(mode=="update"&&choice!="")
            throw new IOException("追加版本时不能同时选择共享或去重。");
        if(!args.TryGetProperty("paths",out var files)||
           files.ValueKind!=JsonValueKind.Array||files.GetArrayLength() is <1 or >20)
            throw new IOException("paths 必须包含 1–20 条本机路径。");
        long? versionFile=mode=="update"?ReadId(args,"file_id"):null;
        long? source=choice is "reuse" or "share"
            ?ReadId(args,"source_file_id"):null;
        JsonArray outcomes=new();
        foreach(var element in files.EnumerateArray())
        {
            stop.ThrowIfCancellationRequested();
            string path=element.ValueKind==JsonValueKind.String?element.GetString()??"":"";
            string? ticket=null;
            try
            {
                if(!Path.IsPathFullyQualified(path))
                    throw new IOException("必须使用绝对路径。");
                var local=new FileInfo(Path.GetFullPath(path));
                if(!local.Exists)throw new FileNotFoundException("本机文件不存在。");
                if(local.Length>NativeFileStore.MaxFileLength)
                    throw new IOException("文件超过 64 MiB 上限。");
                string original=NativeFileStore.ValidName(local.Name);
                using(var stream=new FileStream(local.FullName,FileMode.Open,
                    FileAccess.Read,FileShare.Read,1024*1024,
                    FileOptions.Asynchronous|FileOptions.SequentialScan))
                using(var request=new HttpRequestMessage(HttpMethod.Post,
                    mode=="update"
                      ?$"/api/v2/ip/{workspace}/{folder}/files/{versionFile}/versions"
                      :$"/api/v2/files/{workspace}/prepare?folderId={folder}"))
                {
                    request.Content=new StreamContent(stream);
                    request.Content.Headers.ContentType=
                        new MediaTypeHeaderValue("application/octet-stream");
                    request.Content.Headers.ContentLength=local.Length;
                    request.Headers.TryAddWithoutValidation("X-File-Name",
                        Uri.EscapeDataString(original));
                    if(mode=="new")
                        request.Headers.TryAddWithoutValidation("X-Material-Category",
                            Uri.EscapeDataString(category));
                    using var response=await client.SendAsync(request,stop);
                    string payload=await response.Content.ReadAsStringAsync(stop);
                    if(!response.IsSuccessStatusCode)
                        throw new IOException(DescribeUploadFailure(response,payload));
                    JsonNode saved=JsonNode.Parse(payload)??new JsonObject();
                    if(mode=="update")
                    {
                        outcomes.Add(new JsonObject{["path"]=path,["ok"]=true,
                            ["result"]=saved});
                        continue;
                    }
                    ticket=saved["ticket"]?.GetValue<string>()
                        ??throw new IOException("待确认原件缺少票据。");
                    var matched=saved["matches"] as JsonArray;
                    if(matched is {Count:>0}&&choice=="")
                        throw new IOException("发现内容一致的原件："+matched.ToJsonString()+
                            "。请显式提供 duplicate_mode=independent/reuse/share；"+
                            "reuse/share 还须指定匹配的 source_file_id。"+
                            "本次暂存内容已取消，不会自动合并。");
                    string resolved=choice switch {
                        "reuse"=>"reuse-content",
                        "share"=>"share-file",
                        _=>"independent"
                    };
                    var result=await RequestAsync(client,HttpMethod.Post,
                        $"/api/v2/files/{workspace}/prepared/{ticket}/resolve",
                        new JsonObject{["choice"]=resolved,
                            ["sourceFileId"]=source.HasValue?JsonValue.Create(source.Value):null});
                    ticket=null;
                    outcomes.Add(new JsonObject{["path"]=path,["ok"]=true,
                        ["result"]=result});
                }
            }
            catch(Exception ex)when(ex is not OperationCanceledException)
            {
                outcomes.Add(new JsonObject{["path"]=path,["ok"]=false,
                    ["error"]=ex.Message});
            }
            finally
            {
                if(ticket is not null)
                {
                    try{
                        await RequestAsync(client,HttpMethod.Delete,
                            $"/api/v2/files/{workspace}/prepared/{ticket}");
                    }catch(Exception){/* closing vault also discards writing rows */}
                }
            }
        }
        return new JsonObject{
            ["files"]=outcomes,
            ["succeeded"]=outcomes.Count(x=>x?["ok"]?.GetValue<bool>()==true),
            ["failed"]=outcomes.Count(x=>x?["ok"]?.GetValue<bool>()!=true)
        };
    }
    private static string DescribeUploadFailure(HttpResponseMessage response,string raw)
    {
        try{return "IPSys "+(int)response.StatusCode+"："+
            (JsonNode.Parse(raw)?["error"]?.GetValue<string>()??raw);}
        catch{return "IPSys "+(int)response.StatusCode+"："+raw;}
    }
}
