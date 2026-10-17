using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

// V2 business attachment MCP tools use authenticated local HTTP
// and one FolderId/FileId/LinkId identity. No legacy business-file writes.
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

    // A single parameterized native V2 SQL query replaces the former per-Folder
    // HTTP loop. The original list_files shape remains a JSON array for agents.
    private static Task<JsonNode> ListBusinessFiles(HttpClient client,string workspace)=>
        RequestAsync(client,HttpMethod.Get,
            "/api/v2/mcp/files/"+workspace);

    private static async Task<JsonNode> PageBusinessFiles(HttpClient client,
        string workspace,JsonElement args)
    {
        int offset=0,limit=100;
        if(args.TryGetProperty("offset",out var start)&&
            start.ValueKind!=JsonValueKind.Null)
        {
            if(!start.TryGetInt32(out offset)||offset<0)
                throw new IOException("offset 必须是非负整数。");
        }
        if(args.TryGetProperty("limit",out var size)&&
            size.ValueKind!=JsonValueKind.Null)
        {
            if(!size.TryGetInt32(out limit)||limit is <1 or >200)
                throw new IOException("limit 必须介于 1–200。");
        }
        string kind=ReadString(args,"kind"),name=ReadString(args,"name");
        long ownerId=args.TryGetProperty("owner_id",out var owner)&&
            owner.ValueKind!=JsonValueKind.Null?ReadId(args,"owner_id"):0;
        var query=$"?paged=true&offset={offset}&limit={limit}&ownerId={ownerId}"+
            "&kind="+Uri.EscapeDataString(kind)+
            "&name="+Uri.EscapeDataString(name);
        return await RequestAsync(client,HttpMethod.Get,
            "/api/v2/mcp/files/"+workspace+query);
    }

    private static async Task<JsonNode> DeleteBusinessFile(HttpClient client,
        string workspace,JsonElement args)
    {
        long folder=ReadId(args,"owner_id"),
            file=ReadId(args,"file_id"),
            link=ReadId(args,"link_id");
        var links=await RequestAsync(client,HttpMethod.Get,
            $"/api/v2/files/{workspace}/folders/{folder}/links");
        if(links is not JsonArray found || !found.Any(x=>
            x?["id"]?.GetValue<long>()==link &&
            x?["fileId"]?.GetValue<long>()==file))
            throw new IOException("FolderId、FileId、LinkId 不一致或文件已解除；拒绝删除。");
        return await RequestAsync(client,HttpMethod.Delete,
            $"/api/v2/files/{workspace}/{file}/links/{link}");
    }

    private static async Task<JsonNode> ProjectContractLinks(HttpClient client,
        string workspace,string kind,JsonElement args)
    {
        if(kind is not ("project" or "contract"))
            throw new IOException("无效项目合同类别。");
        long folder=ReadId(args,kind=="project"?"project_id":"contract_id");
        // Ensure a numeric FolderId belongs to the requested kind, not just
        // any active folder in the current workspace.
        await RequestAsync(client,HttpMethod.Get,V2Url(workspace,kind,folder));
        return await RequestAsync(client,HttpMethod.Get,
            $"/api/v2/files/{workspace}/folders/{folder}/links");
    }

    private static async Task<JsonNode> DeleteProjectContractLink(HttpClient client,
        string workspace,string kind,JsonElement args)
    {
        long file=ReadId(args,"file_id"),link=ReadId(args,"link_id");
        var links=await ProjectContractLinks(client,workspace,kind,args);
        if(links is not JsonArray list || !list.Any(x=>
            x?["id"]?.GetValue<long>()==link &&
            x?["fileId"]?.GetValue<long>()==file))
            throw new IOException("文件关联不存在或不属于所选项目/合同。");
        return await RequestAsync(client,HttpMethod.Delete,
            $"/api/v2/files/{workspace}/{file}/links/{link}");
    }

    private static async Task<JsonNode> IpUploadFiles(HttpClient client,string workspace,
        JsonElement args,CancellationToken stop,string kind="ip",UploadTask? progress=null)
    {
        // Fail explicitly for stale clients; group_id is a deleted V1 identity,
        // never silently ignore it on a V2 write.
        if(args.TryGetProperty("group_id",out _))
            throw new IOException("group_id 为已废弃的 V1 参数。追加版本请使用 on_conflict=update 与 file_id=FileId。");
        long folder=ReadId(args,"owner_id");
        if(kind is not ("project" or "contract" or "ip" or "archive" or "general"))
            throw new IOException("文件归属类型无效。");
        string section=kind=="archive"?ArchiveSection(workspace,args):
            ReadString(args,"section","");
        if(kind!="archive"&&section!="")
            throw new IOException("非归档文件类型不能指定 section。");
        await RequestAsync(client,HttpMethod.Get,
            V2Url(workspace,kind,folder)+(kind=="archive"?"?section="+section:""));
        string mode=ReadString(args,"on_conflict","new");
        string choice=ReadString(args,"duplicate_mode","");
        string category=ReadString(args,"material_category",kind=="ip"?"其他材料":"");
        if(mode is not ("new" or "update"))
            throw new IOException("on_conflict 仅支持 new 或 update。");
        if(kind=="ip"&&category is not ("申请材料" or "通知文件" or "证书文件" or "其他材料"))
            throw new IOException("知识产权材料类别无效。");
        if(kind!="ip"&&category.Length!=0)
            throw new IOException("非知识产权的附件不能指定知识产权材料类别。");
        if(choice is not ("" or "independent" or "reuse" or "share"))
            throw new IOException("duplicate_mode 仅支持 independent、reuse、share。");
        if(mode=="update"&&choice!="")
            throw new IOException("追加版本时不能同时选择共享或去重。");
        if(!args.TryGetProperty("paths",out var files)||
           files.ValueKind!=JsonValueKind.Array||files.GetArrayLength() is <1 or >20)
            throw new IOException("paths 必须包含 1–20 条本机路径。");
        long? versionFile=mode=="update"?ReadId(args,"file_id"):null;
        if(kind!="ip"&&versionFile is long current)
        {
            // Generic V2 version-upload endpoint checks file accessibility;
            // MCP must additionally prove this FileId belongs to owner_id.
            var linked=await RequestAsync(client,HttpMethod.Get,
                $"/api/v2/files/{workspace}/folders/{folder}/links");
            if(linked is not JsonArray links || !links.Any(x=>
                x?["fileId"]?.GetValue<long>()==current))
                throw new IOException("指定 FileId 未关联所选资源文件夹，拒绝追加版本。");
        }
        long? source=choice is "reuse" or "share"
            ?ReadId(args,"source_file_id"):null;
        JsonArray outcomes=new();
        bool interrupted=false;
        foreach(var element in files.EnumerateArray())
        {
            string path=element.ValueKind==JsonValueKind.String?element.GetString()??"":"";
            string? ticket=null;
            bool fileSucceeded=false;
            progress?.Begin(path);
            try
            {
                stop.ThrowIfCancellationRequested();
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
                using(var counted=progress is null?stream:new ProgressReadStream(stream,progress))
                using(var request=new HttpRequestMessage(HttpMethod.Post,
                    mode=="update"
                      ?kind=="ip"
                          ?$"/api/v2/ip/{workspace}/{folder}/files/{versionFile}/versions"
                          :$"/api/v2/files/{workspace}/{versionFile}/versions"
                      :$"/api/v2/files/{workspace}/prepare?folderId={folder}"))
                {
                    request.Content=new StreamContent(counted);
                    request.Content.Headers.ContentType=
                        new MediaTypeHeaderValue("application/octet-stream");
                    request.Content.Headers.ContentLength=local.Length;
                    request.Headers.TryAddWithoutValidation("X-File-Name",
                        Uri.EscapeDataString(original));
                    if(mode=="new"&&kind=="ip")
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
                        fileSucceeded=true;
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
                    fileSucceeded=true;
                }
            }
            catch(OperationCanceledException)
            {
                interrupted=true;
                outcomes.Add(new JsonObject{["path"]=path,["ok"]=false,
                    ["error"]="已取消或撤销 MCP 授权；之前成功的文件不会自动回滚。"});
            }
            catch(Exception ex)
            {
                outcomes.Add(new JsonObject{["path"]=path,["ok"]=false,
                    ["error"]=ex.Message});
            }
            finally
            {
                progress?.EndFile(fileSucceeded);
                if(ticket is not null)
                {
                    try{
                        await RequestAsync(client,HttpMethod.Delete,
                            $"/api/v2/files/{workspace}/prepared/{ticket}");
                    }catch(Exception){/* closing vault also discards writing rows */}
                }
            }
            if(interrupted)break;
        }
        int succeeded=outcomes.Count(x=>x?["ok"]?.GetValue<bool>()==true);
        int failed=outcomes.Count(x=>x?["ok"]?.GetValue<bool>()!=true);
        return new JsonObject{
            ["files"]=outcomes,["succeeded"]=succeeded,["failed"]=failed,
            ["requested"]=files.GetArrayLength(),
            ["status"]=interrupted?"interrupted":failed>0?
                (succeeded>0?"partial_success":"failed"):"success",
            ["retryAdvice"]=failed>0 || interrupted?
                "仅按返回的失败路径进行人工核对；已成功文件不应盲目重传。":null
        };
    }
    private static string DescribeUploadFailure(HttpResponseMessage response,string raw)
    {
        try{return "IPSys "+(int)response.StatusCode+"："+
            (JsonNode.Parse(raw)?["error"]?.GetValue<string>()??raw);}
        catch{return "IPSys "+(int)response.StatusCode+"："+raw;}
    }
}
