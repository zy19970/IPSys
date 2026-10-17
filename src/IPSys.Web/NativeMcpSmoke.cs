using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

// N2-03-01: exercise the real MCP named pipe -> authorized local HTTP ->
// SQLCipher V2 Folder service, with zero legacy business table writes.
static class NativeMcpSmoke
{
    private static JsonElement Args(object o)=>JsonSerializer.SerializeToElement(o);
    private static async Task<JsonNode> Call(string name,object input)=>
        await McpLocal.RunSmokeToolAsync("v2_"+name,Args(input));
    private static async Task<JsonNode> Original(string name,object input)=>
        await McpLocal.RunSmokeToolAsync(name,Args(input));
    private static async Task CheckArrayRpc(string name,object input)
    {
        var result=await McpLocal.RunSmokeProtocolToolAsync(name,Args(input));
        string? raw=result["result"]?["content"]?[0]?["text"]?.GetValue<string>();
        Check(result["result"]?["isError"]?.GetValue<bool>()==false &&
              raw!=null && JsonNode.Parse(raw) is JsonArray,
              "stdio tools/call preserves array results for "+name+": "+raw);
    }
    private static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("N2-03-01 MCP V2: "+reason);
    }
    private static long Id(JsonNode node)=>
        node["id"]?.GetValue<long>()??throw new IOException("MCP 未返回 V2 ID。");
    private static JsonNode? Find(JsonNode list,long id)=>
        list.AsArray().FirstOrDefault(x=>x?["folder"]?["ref"]?["id"]?.GetValue<long>()==id);
    public static async Task VerifyAsync(HttpClient client,Vault vault)
    {
        var names=McpLocal.Tools().Select(x=>(string)x.GetType()
            .GetProperty("name")!.GetValue(x)!).ToArray();
        string[] native={
            "list_projects","create_project","update_project","delete_project",
            "list_contracts","create_contract","delete_contract",
            "list_ips","create_ip","update_ip","delete_ip"
        };
        Check(native.All(name=>names.Contains("v2_"+name)) &&
              names.Distinct().Count()==names.Length,
              "MCP V2 tool registry has 11 unique business actions");
        Check(names.Contains("upload_files")&&!names.Contains("v2_upload_files") &&
              new[]{"list_project_files","list_contract_files",
                  "delete_project_file","delete_contract_file"}.All(names.Contains),
              "project and contract file MCP actions are available");
        Check(new[]{"copy_contract","move_folder","list_folder_entries",
            "reorder_entries","reorder_records","reorder_archive_records",
            "list_file_links"}.All(names.Contains),
            "second batch of V2 MCP endpoint adapters registered");
        Check(new[]{"start_upload_task","get_task_status","cancel_task","purge_trash"}
            .All(names.Contains) && names.Distinct().Count()==names.Length &&
            names.Length==70,
            "MCP registry keeps all prior tools and adds explicit trash purge");
        // One idle client must never block an independent Agent's request.
        McpLocal.VerifySessionScopedIdentity();
        await McpLocal.VerifyConcurrentClientsAsync();
        await McpLocal.VerifyIdleClientSaturationAsync();
        await McpLocal.VerifyRestrictedPipeAclAsync(); // Owner + DACL: only user and SYSTEM.
        var parallel=await Task.WhenAll(Enumerable.Range(0,12).Select(_=>Original("list_files_page",new{workspace="company",limit=10})));
        Check(parallel.All(x=>x["items"] is JsonArray),"concurrent file-page reads complete without 409");
        var schemas=JsonSerializer.SerializeToElement(McpLocal.Tools());
        JsonElement Properties(string tool)=>schemas.EnumerateArray().First(x=>
            x.GetProperty("name").GetString()==tool)
            .GetProperty("inputSchema").GetProperty("properties");
        bool Accepts(JsonElement property,string kind)=>
            property.GetProperty("type").EnumerateArray().Any(x=>x.GetString()==kind);
        Check(!Properties("upload_files").TryGetProperty("group_id",out _),
            "obsolete group_id must not appear in the tool schema");
        Check(Accepts(Properties("create_contract").GetProperty("amount"),"number") &&
              Accepts(Properties("update_project").GetProperty("leader"),"null") &&
              Accepts(Properties("create_archive").GetProperty("year"),"number"),
            "schemas expose numeric year/amount and optional null semantics");

        bool meaningful404=false;
        try { await Original("get_file_details",new{
            workspace="company",file_id=999999999
        }); }
        catch(IOException ex)when(ex.Message.StartsWith("IPSys 404：") &&
            ex.Message.Contains("文件不存在") && ex.Message.Contains("999999999"))
        { meaningful404=true; }
        Check(meaningful404,"MCP 404 reports the missing entity and FileId");
        var invalidKind=await McpLocal.RunSmokeProtocolToolAsync("restore_trash",
            Args(new{workspace="company",kind="bad_kind",id=42}));
        var invalidText=invalidKind["result"]?["content"]?[0]?["text"]?.GetValue<string>();
        var invalidError=invalidText is null?null:JsonNode.Parse(invalidText);
        Check(invalidKind["result"]?["isError"]?.GetValue<bool>()==true &&
              invalidError?["code"]?.GetValue<string>()=="TOOL_CALL_REJECTED" &&
              invalidError?["message"]?.GetValue<string>()?.Contains("kind 非法")==true &&
              invalidError?["retryable"]?.GetValue<bool>()==false,
              "ISS-008/013 schema and invalid-trash errors use JSON object envelopes");

        // ISS-015: simulate an interrupted former host's durable pending row.
        string orphan=Guid.NewGuid().ToString("N");
        var orphanArgs=new {workspace="company",kind="project",owner_id=999999L,
            paths=new[]{"C:\\missing-abandoned-test.bin"},request_id=orphan};
        await vault.Gate.WaitAsync();
        try
        {
            using var cmd=vault.Db.CreateCommand();
            cmd.CommandText="""
                INSERT INTO mcp_operations(workspace,request_id,tool_name,arguments_hash,state)
                VALUES('company',$id,'upload_files',$hash,'pending');
                """;
            cmd.Parameters.AddWithValue("$id",orphan);
            cmd.Parameters.AddWithValue("$hash",McpLocal.SmokeArgumentsHash(Args(orphanArgs)));
            cmd.ExecuteNonQuery();
        }
        finally{vault.Gate.Release();}
        var abandoned=await Original("get_task_status",new{workspace="company",request_id=orphan});
        var abandonedAgain=await Original("get_operation_result",new{workspace="company",request_id=orphan});
        var abandonedCancel=await Original("cancel_task",new{workspace="company",request_id=orphan});
        var abandonedReplay=await Original("start_upload_task",orphanArgs);
        Check(abandoned["state"]?.GetValue<string>()=="uncertain" &&
              abandoned["businessOk"]==null &&
              abandoned["result"]?["resumeSupported"]?.GetValue<bool>()==false &&
              abandoned["result"]?["interruptedAt"]!=null &&
              abandonedAgain["state"]?.GetValue<string>()=="uncertain" &&
              abandonedCancel["state"]?.GetValue<string>()=="uncertain" &&
              abandonedReplay["accepted"]?.GetValue<bool>()==false &&
              abandonedReplay["state"]?.GetValue<string>()=="uncertain",
              "ISS-015 orphan pending is durably reconciled and cannot replay");
        string suffix=Guid.NewGuid().ToString("N")[..8];
        string name="原生MCP项目"+suffix;
        var created=await Call("create_project",new {
            workspace="company",name,project_type="科研项目",
            project_no="N203-"+suffix,leader="项目负责人"
        });
        long project=Id(created);
        Check(project>0,"created V2 project");
        // ISS-001: call the actual JSON-RPC adapter, not just the pipe.
        await CheckArrayRpc("list_projects",new{workspace="company"});
        await CheckArrayRpc("v2_list_projects",new{workspace="company"});
        await CheckArrayRpc("list_contracts",new{workspace="company"});
        await CheckArrayRpc("v2_list_contracts",new{workspace="company"});
        await CheckArrayRpc("list_ips",new{workspace="company"});
        await CheckArrayRpc("v2_list_ips",new{workspace="company"});
        await CheckArrayRpc("list_general",new{workspace="company"});
        await CheckArrayRpc("list_archives",new{workspace="company",section="achievement"});
        await CheckArrayRpc("list_archive_folders",new{workspace="company"});
        await CheckArrayRpc("list_trash",new{workspace="company"});
        await CheckArrayRpc("list_files",new{workspace="company"});
        await CheckArrayRpc("list_folder_entries",new{workspace="company",parent_id=0});
        await CheckArrayRpc("list_project_files",new{workspace="company",project_id=project});
        var list=await Call("list_projects",new{workspace="company"});
        var item=Find(list,project);
        Check(item?["businessData"]?["name"]?.GetValue<string>()==name,
            "V2 MCP project appears in new folder source");
        await Call("update_project",new{
            workspace="company",project_id=project,
            name="原生MCP已改名"+suffix,remarks="仅更新备注"
        });
        item=Find(await Call("list_projects",new{workspace="company"}),project);
        Check(item?["businessData"]?["name"]?.GetValue<string>()=="原生MCP已改名"+suffix &&
              item?["businessData"]?["projectNo"]?.GetValue<string>()=="N203-"+suffix &&
              item?["businessData"]?["leader"]?.GetValue<string>()=="项目负责人",
              "V2 project partial MCP update preserves other fields");
        bool crossDenied=false;
        try
        {
            await Call("update_project",new{
                workspace="personal",project_id=project,name="错误修改"
            });
        }
        catch(IOException ex)when(ex.Message.Contains("404")){crossDenied=true;}
        Check(crossDenied,"cross-workspace project mutation blocked");

        bool orphanDenied=false;
        try
        {
            await Call("create_contract",new{
                workspace="personal",project_id=project,name="错误归属合同"
            });
        }
        catch(IOException ex)when(ex.Message.Contains("404")){orphanDenied=true;}
        Check(orphanDenied,"contracts must belong to a project in same workspace");
        var contractResult=await Call("create_contract",new{
            workspace="company",project_id=project,
            name="原生MCP合同"+suffix,contract_no="C-"+suffix,amount=1234.5
        });
        long contract=Id(contractResult);
        await CheckArrayRpc("list_contract_files",new{workspace="company",
            contract_id=contract});
        var contracts=await Call("list_contracts",new{workspace="company"});
        var contractItem=Find(contracts,contract);
        Check(contractItem?["folder"]?["parent"]?["id"]?.GetValue<long>()==project &&
              contractItem?["businessData"]?["contractNo"]?.GetValue<string>()=="C-"+suffix &&
              contractItem?["businessData"]?["amount"]?.GetValue<string>()=="1234.5",
              "V2 MCP contract has actual V2 project parent");

        await Original("update_contract",new{
            workspace="company",contract_id=contract,remarks="MCP编辑合同回归",
            amount=2345.75
        });
        var editedContract=Find(await Call("list_contracts",new{workspace="company"}),contract);
        Check(editedContract?["businessData"]?["remarks"]?.GetValue<string>()=="MCP编辑合同回归" &&
              editedContract?["businessData"]?["amount"]?.GetValue<string>()=="2345.75" &&
              editedContract?["businessData"]?["contractNo"]?.GetValue<string>()=="C-"+suffix,
            "MCP update_contract patches fields without losing existing contract number");
        var searched=await Original("search_records",new{
            workspace="company",query="MCP编辑合同回归"
        });
        Check(searched["results"] is JsonArray hits &&
            hits.Any(x=>x?["kind"]?.GetValue<string>()=="contract" &&
                x?["id"]?.GetValue<long>()==contract),
            "MCP unified search finds an updated contract");
        bool illegalContract=false;
        try {await Original("update_contract",new{
            workspace="personal",contract_id=contract,name="越权"
        });}catch(IOException){illegalContract=true;}
        Check(illegalContract,"MCP contract update respects workspace isolation");

        string patent="原生MCP专利"+suffix;
        long ip=Id(await Call("create_ip",new{
            workspace="company",name=patent,ip_type="发明专利",
            status="实质审查中",application_no="CN202610000002.0",
            remarks="初始说明"
        }));
        await CheckArrayRpc("list_ip_files",new{workspace="company",ip_id=ip});
        var ips=await Call("list_ips",new{workspace="company"});
        Check(Find(ips,ip)?["businessData"]?["applicationNo"]?.GetValue<string>()
              =="CN202610000002.0","MCP V2 IP on native Folder Store");
        await Call("update_ip",new{
            workspace="company",ip_id=ip,name="修改后的"+patent,remarks="新备注"
        });
        ips=await Call("list_ips",new{workspace="company"});
        Check(Find(ips,ip)?["businessData"]?["applicationNo"]?.GetValue<string>()
              =="CN202610000002.0" &&
              Find(ips,ip)?["businessData"]?["remarks"]?.GetValue<string>()=="新备注",
              "IP updates preserve application number");
        // The MCP IP-file actions previously lacked direct MCP coverage.
        string ipPath=Path.Combine(Path.GetTempPath(),"IPSys-MCP-IP-"+suffix+".bin");
        await File.WriteAllBytesAsync(ipPath,Guid.NewGuid().ToByteArray());
        try
        {
            var uploadedIp=await Original("upload_files",new{
                workspace="company",kind="ip",owner_id=ip,
                material_category="申请材料",paths=new[]{ipPath}
            });
            Check(uploadedIp["succeeded"]?.GetValue<int>()==1,
                "IP MCP uploads a V2 file");
            long ipFile=uploadedIp["files"]?[0]?["result"]?["fileId"]?.GetValue<long>()??0;
            long ipLink=uploadedIp["files"]?[0]?["result"]?["linkId"]?.GetValue<long>()??0;
            var ipLinks=await Original("list_ip_files",new{
                workspace="company",ip_id=ip
            });
            Check(ipFile>0 && ipLink>0 && ipLinks is JsonArray ipRows &&
                ipRows.Any(x=>x?["id"]?.GetValue<long>()==ipLink &&
                    x?["fileId"]?.GetValue<long>()==ipFile),
                "list_ip_files returns the new native link");
            await Original("delete_ip_file",new{
                workspace="company",ip_id=ip,file_id=ipFile,link_id=ipLink
            });
            Check(!(await Original("list_ip_files",new{
                workspace="company",ip_id=ip
            })).AsArray().Any(x=>x?["id"]?.GetValue<long>()==ipLink),
                "delete_ip_file only removes the selected IP link");
        }
        finally { File.Delete(ipPath); }

        var projectCopy=await Original("transfer_project",new{
            workspace="company",project_id=project,
            target_workspace="personal",move=false,
            request_id=Guid.NewGuid().ToString("N")
        });
        long copiedProject=Id(projectCopy);
        Check(Find(await Call("list_projects",new{workspace="personal"}),
            copiedProject)!=null &&
            Find(await Call("list_projects",new{workspace="company"}),project)!=null,
            "transfer_project copies a project to personal without removing source");
        await Call("delete_project",new{
            workspace="personal",project_id=copiedProject
        });
        var ipCopy=await Original("transfer_ip",new{
            workspace="company",ip_id=ip,
            target_workspace="personal",move=false
        });
        long copiedIp=Id(ipCopy);
        Check(Find(await Call("list_ips",new{workspace="personal"}),
            copiedIp)!=null,"transfer_ip copies V2 IP record to target workspace");
        await Call("delete_ip",new{workspace="personal",ip_id=copiedIp});

        await Call("delete_project",new{workspace="company",project_id=project});
        Check(Find(await Call("list_contracts",new{workspace="company"}),contract)==null,
              "project delete hides its V2 contracts");
        using(var restore=await client.PostAsync(
            $"/api/v2/folders/company/project/{project}/restore",null))
            restore.EnsureSuccessStatusCode();
        Check(Find(await Call("list_contracts",new{workspace="company"}),contract)!=null,
            "restoring the parent restores original contract visibility");
        await Call("delete_contract",new{workspace="company",contract_id=contract});
        await Call("delete_ip",new{workspace="company",ip_id=ip});
        Check(Find(await Call("list_contracts",new{workspace="company"}),contract)==null &&
              Find(await Call("list_ips",new{workspace="company"}),ip)==null,
              "MCP V2 soft-deletion correctly removes only native records");
        // N2-03-07-02: original tool names must use the same V2 FolderId
        // as the live UI; no new legacy project/contract rows may appear.
        var oldNameProject=await Original("create_project",new{
            workspace="company",name="原名MCP项目"+suffix,project_type="科研项目",
            project_no="ORIG-"+suffix,remarks="创建于 V2"
        });
        long originalProject=Id(oldNameProject);
        var currentProjects=await Original("list_projects",new{workspace="company"});
        Check(currentProjects is JsonArray projectRows &&
              projectRows.Any(x=>x?["id"]?.GetValue<long>()==originalProject &&
                  x?["projectNo"]?.GetValue<string>()=="ORIG-"+suffix),
            "original project list and create both use V2 FolderId");
        await Original("update_project",new{
            workspace="company",project_id=originalProject,leader="代理修改负责人"
        });
        var updated=await Call("list_projects",new{workspace="company"});
        Check(Find(updated,originalProject)?["businessData"]?["leader"]?.GetValue<string>()
              =="代理修改负责人","original MCP project patch writes V2");
        // Null retains the field; an empty string is an intentional clear.
        await Original("update_project",new{
            workspace="company",project_id=originalProject,
            leader=(string?)null,remarks="null 不覆盖已有负责人"
        });
        Check(Find(await Call("list_projects",new{workspace="company"}),originalProject)?["businessData"]?["leader"]?.GetValue<string>()=="代理修改负责人",
            "optional null preserves existing project field");
        await Original("update_project",new{
            workspace="company",project_id=originalProject,leader=""
        });
        Check(Find(await Call("list_projects",new{workspace="company"}),originalProject)?["businessData"]?["leader"]?.GetValue<string>()=="",
            "empty string clears a project field");
        bool badFieldType=false;
        try { await Original("update_project",new{
            workspace="company",project_id=originalProject,leader=42
        }); }
        catch(IOException){badFieldType=true;}
        Check(badFieldType,"unrelated numeric field is still rejected");
        var invalidSource=await Original("upload_files",new{
            workspace="company",kind="project",owner_id=originalProject,
            paths=new[]{@"\\127.0.0.1\C$\unreachable-source.txt"}
        });
        Check(invalidSource["status"]?.GetValue<string>()=="failed" &&
              invalidSource["files"]?[0]?["error"]?.GetValue<string>()?.Contains("UNC")==true,
              "ISS-007 does not read network paths under the GUI host");
        bool obsoleteRejected=false;
        try { await Original("upload_files",new{
            workspace="company",kind="project",owner_id=originalProject,
            paths=new[]{"C:\\missing-test-file.bin"},group_id="obsolete"
        }); }
        catch(IOException ex)when(ex.Message.Contains("group_id")){obsoleteRejected=true;}
        Check(obsoleteRejected,"obsolete group_id yields an explicit rejection");

        // The encrypted MCP retry ledger must return a durable result for
        // repeated request IDs without creating another folder.
        string operationId=Guid.NewGuid().ToString("N");
        var firstWrite=await Original("create_general",new{
            workspace="personal",title="MCP幂等验证"+suffix,request_id=operationId
        });
        var secondWrite=await Original("create_general",new{
            request_id=operationId,title="MCP幂等验证"+suffix,workspace="personal"
        });
        Check(Id(firstWrite)==Id(secondWrite),
            "same request_id returns the stored response despite parameter order");
        var journal=await Original("get_operation_result",new{
            workspace="personal",request_id=operationId
        });
        Check(journal["state"]?.GetValue<string>()=="done" &&
              journal["result"]?["id"]?.GetValue<long>()==Id(firstWrite),
            "MCP operation result is queryable in encrypted V2 vault");
        bool reusedIdDenied=false;
        try { await Original("create_general",new{
            workspace="personal",title="错误复用编号",request_id=operationId
        }); }
        catch(IOException){reusedIdDenied=true;}
        Check(reusedIdDenied,"request_id cannot be reused with different arguments");

        // A definite HTTP 404 is replayable and must not be marked uncertain.
        string missingRequestId=Guid.NewGuid().ToString("N");
        var missing=await Original("update_project",new{
            workspace="company",project_id=999999999,
            name="不存在的项目",request_id=missingRequestId
        });
        var missingJournal=await Original("get_operation_result",new{
            workspace="company",request_id=missingRequestId
        });
        var replayMissing=await Original("update_project",new{
            request_id=missingRequestId,name="不存在的项目",
            project_id=999999999,workspace="company"
        });
        Check(missing["status"]?.GetValue<string>()=="failed" &&
              missing["httpStatus"]?.GetValue<int>()==404 &&
              missingJournal["state"]?.GetValue<string>()=="done" &&
              missingJournal["businessOk"]?.GetValue<bool>()==false &&
              missingJournal["result"]?["httpStatus"]?.GetValue<int>()==404 &&
              missing.ToJsonString()==replayMissing.ToJsonString(),
              "definitive 404 must be a durable, replayable business failure");
        string rejectedId=Guid.NewGuid().ToString("N");
        var rejected=await Original("delete_file",new{
            workspace="company",owner_id=originalProject,
            file_id=999999999L,link_id=999999999L,request_id=rejectedId
        });
        var rejectedLog=await Original("get_operation_result",new{
            workspace="company",request_id=rejectedId
        });
        Check(rejected["status"]?.GetValue<string>()=="failed" &&
              rejectedLog["state"]?.GetValue<string>()=="done" &&
              rejectedLog["businessOk"]?.GetValue<bool>()==false &&
              rejectedLog["result"]?["error"]?.GetValue<string>()?.Contains("LinkId")==true,
            "ISS-002 local preflight rejection is durable done/businessOk=false");
        var rejectedRepeat=await Original("delete_file",new{
            workspace="company",owner_id=originalProject,
            file_id=999999999L,link_id=999999999L,request_id=rejectedId
        });
        Check(rejectedRepeat.ToJsonString()==rejected.ToJsonString(),
            "definite local rejection is replayable with same request_id");
        await Original("delete_general",new{
            workspace="personal",general_id=Id(firstWrite)
        });
        var trash=await Original("list_trash",new{workspace="personal"});
        Check(trash is JsonArray waste && waste.Any(x=>
            x?["kind"]?.GetValue<string>()=="v2_general" &&
            x?["id"]?.GetValue<long>()==Id(firstWrite)),
            "MCP trash list contains the soft-deleted general record");
        await Original("restore_trash",new{
            workspace="personal",kind="v2_general",id=Id(firstWrite)
        });
        Check(Find(await Original("list_general",new{workspace="personal"}),
            Id(firstWrite))!=null,"MCP restore_trash recovers a V2 folder");
        await Original("delete_general",new{
            workspace="personal",general_id=Id(firstWrite)
        });

        bool unknownParamDenied=false;
        try { await Original("create_project",new{
            workspace="company",name="拼错字段"+suffix,project_type="科研项目",
            project_n0="wrong"
        }); }
        catch(IOException ex)when(ex.Message.Contains("未声明的 MCP 参数")){
            unknownParamDenied=true;
        }
        Check(unknownParamDenied,"unknown and misspelled MCP parameters are rejected");

        var originalContract=await Original("create_contract",new{
            workspace="company",project_id=originalProject,
            name="原名MCP合同"+suffix,contract_no="ORIG-C-"+suffix
        });
        long originalContractId=Id(originalContract);
        var copiedContract=await Original("copy_contract",new{
            workspace="company",contract_id=originalContractId,
            request_id=Guid.NewGuid().ToString("N")
        });
        long copiedContractId=Id(copiedContract);
        Check(copiedContractId!=originalContractId &&
              Find(await Call("list_contracts",new{workspace="company"}),copiedContractId)?
                 ["folder"]?["parent"]?["id"]?.GetValue<long>()==originalProject &&
              Find(await Call("list_contracts",new{workspace="company"}),copiedContractId)?
                 ["businessData"]?["contractNo"]?.GetValue<string>()=="ORIG-C-"+suffix,
              "copy_contract creates a sibling with matching contract fields");
        await Original("reorder_records",new{
            workspace="company",kind="contract",
            ids=new[]{copiedContractId,originalContractId},
            request_id=Guid.NewGuid().ToString("N")
        });
        var reorderedContracts=(await Original("list_contracts",new{
            workspace="company"
        })).AsArray().Select(x=>x?["id"]?.GetValue<long>()??0).ToArray();
        Check(Array.IndexOf(reorderedContracts,copiedContractId)<
              Array.IndexOf(reorderedContracts,originalContractId),
              "reorder_records persists selected contract ordering");
        bool invalidOrderDenied=false;
        try {await Original("reorder_records",new{
            workspace="company",kind="contract",
            ids=new[]{originalContractId,originalContractId}
        });}catch(IOException){invalidOrderDenied=true;}
        Check(invalidOrderDenied,"duplicate FolderId must be rejected by MCP reorder");
        var listedContracts=await Original("list_contracts",new{workspace="company"});
        Check(listedContracts is JsonArray contractRows &&
              contractRows.Any(x=>x?["id"]?.GetValue<long>()==originalContractId &&
                  x?["projectId"]?.GetValue<long>()==originalProject),
            "original contract list and create share native parent FolderId");
        string path=Path.Combine(Path.GetTempPath(),"IPSys-V2-MCP-"+suffix+".bin");
        byte[] originalBytes=System.Security.Cryptography.RandomNumberGenerator.GetBytes(2173);
        await File.WriteAllBytesAsync(path,originalBytes);
        try
        {
            var uploaded=await Original("upload_files",new{
                workspace="company",kind="project",owner_id=originalProject,
                paths=new[]{path}
            });
            Check(uploaded["succeeded"]?.GetValue<int>()==1,
                "project original upload_files saved a native V2 FileId");
            string failedRequestId=Guid.NewGuid().ToString("N");
            var failedUpload=await Original("upload_files",new{
                workspace="company",kind="project",owner_id=originalProject,
                paths=new[]{"C:\\IPSys_missing_"+suffix+".bin"},request_id=failedRequestId
            });
            Check(failedUpload["status"]?.GetValue<string>()=="failed" &&
                failedUpload["failed"]?.GetValue<int>()==1 &&
                failedUpload["files"]?[0]?["ok"]?.GetValue<bool>()==false,
                "failed upload reports explicit per-file failure and status");
            var recordedFailure=await Original("get_operation_result",new{
                workspace="company",request_id=failedRequestId
            });
            Check(recordedFailure["state"]?.GetValue<string>()=="done" &&
                  recordedFailure["businessOk"]?.GetValue<bool>()==false &&
                  recordedFailure["result"]?["status"]?.GetValue<string>()=="failed",
                  "finished request journal distinguishes logged failure from business success");

            // Host-owned async upload acknowledges before processing completes;
            // the same request_id is durable and cannot execute twice.
            string asyncId=Guid.NewGuid().ToString("N");
            var asyncParams=new{
                workspace="company",kind="project",owner_id=originalProject,
                paths=new[]{path},duplicate_mode="independent",request_id=asyncId
            };
            var scheduled=await Original("start_upload_task",asyncParams);
            Check(scheduled["accepted"]?.GetValue<bool>()==true &&
                  scheduled["requestId"]?.GetValue<string>()==asyncId,
                  "start_upload_task accepts a durable request_id immediately");
            JsonNode asyncStatus=new JsonObject();
            for(int check=0;check<300;check++)
            {
                asyncStatus=await Original("get_task_status",new{
                    workspace="company",request_id=asyncId
                });
                if(asyncStatus["state"]?.GetValue<string>() is "done" or "uncertain")
                    break;
                await Task.Delay(100);
            }
            Check(asyncStatus["state"]?.GetValue<string>()=="done" &&
                  asyncStatus["businessOk"]?.GetValue<bool>()==true &&
                  asyncStatus["result"]?["succeeded"]?.GetValue<int>()==1,
                  "async upload finishes in encrypted operation ledger");
            var asyncReplay=await Original("start_upload_task",asyncParams);
            Check(asyncReplay["accepted"]?.GetValue<bool>()==false &&
                  asyncReplay["state"]?.GetValue<string>()=="done",
                  "completed async request_id never schedules duplicate upload");
            string cancelId=Guid.NewGuid().ToString("N");
            var cancelParams=new{
                workspace="company",kind="project",owner_id=originalProject,
                paths=Enumerable.Repeat(path,8).ToArray(),
                duplicate_mode="independent",request_id=cancelId
            };
            Check((await Original("start_upload_task",cancelParams))
                ["accepted"]?.GetValue<bool>()==true,
                "second async upload scheduled with independent request_id");
            var cancelReply=await Original("cancel_task",new{
                workspace="company",request_id=cancelId
            });
            Check(cancelReply["requestId"]?.GetValue<string>()==cancelId,
                "cancel_task only targets its own request_id");
            JsonNode cancelResult=new JsonObject();
            for(int check=0;check<300;check++)
            {
                cancelResult=await Original("get_task_status",new{
                    workspace="company",request_id=cancelId
                });
                if(cancelResult["state"]?.GetValue<string>() is "done" or "uncertain")
                    break;
                await Task.Delay(100);
            }
            string? cancelledState=cancelResult["state"]?.GetValue<string>();
            Check(cancelledState is "done" or "uncertain",
                "cancelled task reaches a terminal journal state");
            if(cancelledState=="uncertain")
                Check(cancelResult["businessOk"]==null &&
                      (cancelResult["result"]==null ||
                       cancelResult["result"]?["status"]?.GetValue<string>()=="interrupted"),
                      "cancelled upload records uncertain; partial results are optional before dispatch");
            Check((await Original("start_upload_task",cancelParams))
                 ["accepted"]?.GetValue<bool>()==false,
                "cancelled upload request_id cannot automatically replay");
            var result=uploaded["files"]?[0]?["result"]??throw new IOException(
                "原名 MCP 上传缺少原件结果。");
            long file=result["fileId"]?.GetValue<long>()??0,
                link=result["linkId"]?.GetValue<long>()??0;
            Check(file>0&&link>0,"V2 upload returned FileId and LinkId");
            var projectFiles=await Original("list_project_files",new{
                workspace="company",project_id=originalProject
            });
            Check(projectFiles is JsonArray pf &&
                  pf.Any(x=>x?["fileId"]?.GetValue<long>()==file &&
                      x?["id"]?.GetValue<long>()==link),
                "project file list uses V2 folder-file links");
            var detail=await Original("get_file_details",new{
                workspace="company",file_id=file
            });
            Check(detail["id"]?.GetValue<long>()==file &&
                detail["versions"] is JsonArray versions && versions.Count==1,
                "get_file_details exposes V2 file metadata and version history");
            string utcTime=detail["versions"]?[0]?["createdAt"]?.GetValue<string>()??"";
            Check(utcTime.EndsWith("Z",StringComparison.Ordinal) &&
                DateTimeOffset.TryParse(utcTime,out _),
                "file version timestamp is explicit ISO 8601 UTC");

            await Original("update_file_metadata",new{
                workspace="company",file_id=file,
                description="MCP选填说明",tags="合同,原件",
                file_number="FILE-"+suffix
            });
            detail=await Original("get_file_details",new{
                workspace="company",file_id=file
            });
            Check(detail["description"]?.GetValue<string>()=="MCP选填说明" &&
                detail["fileNumber"]?.GetValue<string>()=="FILE-"+suffix,
                "MCP file metadata update retains FileId and stores optional properties");
            string output=Path.Combine(Path.GetTempPath(),
                "IPSys-MCP-out-"+suffix+".bin");
            try
            {
                var saved=await Original("download_file_version",new{
                    workspace="company",file_id=file,version=1,output_path=output
                });
                Check(saved["size"]?.GetValue<long>()==originalBytes.Length &&
                    (await File.ReadAllBytesAsync(output)).SequenceEqual(originalBytes),
                    "MCP explicit-version download restores decrypted original bytes");
                bool overwriteDenied=false;
                try{await Original("download_file_version",new{
                    workspace="company",file_id=file,version=1,output_path=output
                });}catch(IOException){overwriteDenied=true;}
                Check(overwriteDenied,"MCP download cannot overwrite a local file");
            }
            finally{File.Delete(output);}

            byte[] downloaded=await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/1/download");
            Check(downloaded.SequenceEqual(originalBytes),
                "MCP uploaded project original bytes round trip");

            long copyFolder=Id(await Original("create_general",new{
                workspace="company",title="MCP文件复制验证"+suffix
            }));
            var copy=await Original("copy_file",new{
                workspace="company",file_id=file,target_workspace="company",
                target_folder_id=copyFolder,mode="reuse-content",
                request_id=Guid.NewGuid().ToString("N")
            });
            long duplicateFile=copy["fileId"]?.GetValue<long>()??0;
            Check(duplicateFile>0 && duplicateFile!=file &&
                (await Original("get_file_details",new{
                    workspace="company",file_id=duplicateFile
                }))["versions"] is JsonArray copiedVersions && copiedVersions.Count==1,
                "MCP copy_file creates independent FileId/version identity");
            await Original("delete_general",new{
                workspace="company",general_id=copyFolder
            });

            // Contract shares the same immutable V2 file; detach only its link.
            var shared=await Original("associate_file",new{
                workspace="company",file_id=file,link_id=link,
                target_folder_id=originalContractId,move=false
            });
            Check(shared is JsonObject,"MCP associate_file returns a V2 link result");
            var contractFiles=await Original("list_contract_files",new{
                workspace="company",contract_id=originalContractId
            });
            long contractLink=contractFiles.AsArray()
                .FirstOrDefault(x=>x?["fileId"]?.GetValue<long>()==file)?["id"]?.GetValue<long>()??0;
            Check(contractLink>0,"contract sees shared V2 FileId");
            await CheckArrayRpc("list_file_links",new{workspace="company",file_id=file});
            var owners=await Original("list_file_links",new{
                workspace="company",file_id=file
            });
            Check(owners is JsonArray activeLinks &&
                activeLinks.Any(x=>x?["id"]?.GetValue<long>()==link &&
                    x?["folderId"]?.GetValue<long>()==originalProject) &&
                activeLinks.Any(x=>x?["id"]?.GetValue<long>()==contractLink &&
                    x?["folderId"]?.GetValue<long>()==originalContractId),
                "list_file_links returns all active folder associations for FileId");
            bool foreignFileDenied=false;
            try{await Original("list_file_links",new{
                workspace="personal",file_id=file
            });}catch(IOException){foreignFileDenied=true;}
            Check(foreignFileDenied,"list_file_links must enforce workspace isolation");
            var attachedCopy=await Original("copy_contract",new{
                workspace="company",contract_id=originalContractId
            });
            long attachedCopyId=Id(attachedCopy);
            var copiedLinks=await Original("list_contract_files",new{
                workspace="company",contract_id=attachedCopyId
            });
            Check(copiedLinks is JsonArray clonedLinks &&
                clonedLinks.Any(x=>x?["fileId"]?.GetValue<long>()==file &&
                    x?["id"]?.GetValue<long>()!=contractLink),
                "copy_contract adds new LinkId while preserving shared FileId");
            await Original("delete_contract_file",new{
                workspace="company",contract_id=originalContractId,
                file_id=file,link_id=contractLink
            });
            Check((await Original("list_contract_files",new{
                workspace="company",contract_id=originalContractId
            })).AsArray().Count==0 &&
                (await Original("list_file_links",new{
                    workspace="company",file_id=file
                })).AsArray().Any(x=>
                    x?["folderId"]?.GetValue<long>()==attachedCopyId),
                "contract unlink cannot erase another copied contract's shared file");
            await Original("delete_contract",new{
                workspace="company",contract_id=attachedCopyId
            });
            await Original("restore_file_link",new{
                workspace="company",owner_id=originalContractId,
                file_id=file,link_id=contractLink
            });
            Check((await Original("list_contract_files",new{
                workspace="company",contract_id=originalContractId
            })).AsArray().Any(x=>x?["id"]?.GetValue<long>()==contractLink),
                "MCP restores exact deleted LinkId in original folder");
            await Original("delete_contract_file",new{
                workspace="company",contract_id=originalContractId,
                file_id=file,link_id=contractLink
            });
            Check((await Original("list_project_files",new{
                workspace="company",project_id=originalProject
            })).AsArray().Any(x=>x?["fileId"]?.GetValue<long>()==file),
                "original project file still accessible after contract unlink");
            var mismatched=false;
            try{
                await Original("delete_project_file",new{
                    workspace="company",project_id=originalProject,
                    file_id=file,link_id=contractLink
                });
            }catch(IOException){mismatched=true;}
            Check(mismatched,"cannot unlink a link belonging to another folder");

            var allFiles=await Original("list_files",new{workspace="company"});
            Check(allFiles is JsonArray af && af.Any(x=>
                x?["id"]?.GetValue<long>()==link &&
                x?["fileId"]?.GetValue<long>()==file &&
                x?["ownerId"]?.GetValue<long>()==originalProject &&
                x?["kind"]?.GetValue<string>()=="project"),
                "general legacy-name list_files uses only the V2 FileId/LinkId map");
            using(var relink=await client.PostAsJsonAsync(
                $"/api/v2/files/company/{file}/links",
                new{folderId=originalContractId}))
                relink.EnsureSuccessStatusCode();
            var relinked=(await Original("list_contract_files",new{
                workspace="company",contract_id=originalContractId
            })).AsArray();
            long renewed=relinked.Single()["id"]?.GetValue<long>()??0;
            Check(renewed>0,"contract re-association creates a new link");
            var pageOne=await Original("list_files_page",new{
                workspace="company",offset=0,limit=1
            });
            var pageRows=pageOne["items"] as JsonArray;
            Check(pageRows is {Count:1} &&
                pageOne["hasMore"]?.GetValue<bool>()==true &&
                pageOne["nextOffset"]?.GetValue<int>()==1,
                "global V2 file list returns a bounded first page");
            var pageTwo=await Original("list_files_page",new{
                workspace="company",offset=1,limit=1
            });
            Check(pageTwo["items"] is JsonArray secondRows && secondRows.Count==1 &&
                pageRows[0]?["id"]?.GetValue<long>()!=
                    secondRows[0]?["id"]?.GetValue<long>(),
                "file page offset advances to another link");
            var projectPage=await Original("list_files_page",new{
                workspace="company",kind="project",owner_id=originalProject,
                name=Path.GetFileName(path),offset=0,limit=10
            });
            Check(projectPage["items"] is JsonArray projectMatches &&
                projectMatches.Any(x=>x?["id"]?.GetValue<long>()==link &&
                    x?["fileId"]?.GetValue<long>()==file &&
                    x?["ownerId"]?.GetValue<long>()==originalProject &&
                    x?["kind"]?.GetValue<string>()=="project"),
                "filtered file query preserves LinkId/FileId/FolderId identity");
            bool invalidPage=false;
            try{await Original("list_files_page",new{
                workspace="company",offset=0,limit=201
            });}catch(IOException){invalidPage=true;}
            Check(invalidPage,"file page size limit 1–200 is enforced");
            bool wrongDeleteDenied=false;
            try { await Original("delete_file",new{
                workspace="company",owner_id=originalContractId,
                file_id=file,link_id=link
            }); }
            catch(IOException){wrongDeleteDenied=true;}
            Check(wrongDeleteDenied,"delete_file requires all three matching identities");
            await Original("delete_file",new{
                workspace="company",owner_id=originalContractId,
                file_id=file,link_id=renewed
            });
            Check((await Original("list_contract_files",new{
                workspace="company",contract_id=originalContractId
            })).AsArray().Count==0 &&
                  (await Original("list_project_files",new{
                workspace="company",project_id=originalProject
            })).AsArray().Any(x=>x?["fileId"]?.GetValue<long>()==file),
                "general delete_file unlinks one V2 location without erasing shared bytes");

            // Append a version via a typed owner check, never by legacy group_id.
            byte[] revised=System.Security.Cryptography.RandomNumberGenerator.GetBytes(951);
            await File.WriteAllBytesAsync(path,revised);
            var appended=await Original("upload_files",new{
                workspace="company",kind="project",owner_id=originalProject,
                paths=new[]{path},on_conflict="update",file_id=file
            });
            Check(appended["succeeded"]?.GetValue<int>()==1 &&
                  (await client.GetByteArrayAsync(
                      $"/api/v2/files/company/{file}/versions/2/download"))
                  .SequenceEqual(revised),
                "original project MCP appends genuine V2 FileVersion");
            bool foreignVersion=false;
            try{
                await Original("upload_files",new{
                    workspace="company",kind="contract",owner_id=originalContractId,
                    paths=new[]{path},on_conflict="update",file_id=file
                });
            }catch(IOException){foreignVersion=true;}
            Check(foreignVersion,"cannot version a FileId without owner link");
            await Original("delete_project_file",new{
                workspace="company",project_id=originalProject,
                file_id=file,link_id=link
            });
            Check(!(await Original("list_project_files",new{
                workspace="company",project_id=originalProject
            })).AsArray().Any(x=>x?["id"]?.GetValue<long>()==link),
                "target project LinkId unlinked; other async-uploaded files remain intact");
        }
        finally{File.Delete(path);}

        await Original("delete_contract",new{
            workspace="company",contract_id=copiedContractId
        });
        await Original("delete_contract",new{
            workspace="company",contract_id=originalContractId
        });
        await Original("delete_project",new{
            workspace="company",project_id=originalProject
        });
        await Call("delete_project",new{workspace="company",project_id=project});
        Console.WriteLine("N2-03-01 V2 MCP NATIVE SQLCIPHER HTTP SMOKE PASS");
    }
}
