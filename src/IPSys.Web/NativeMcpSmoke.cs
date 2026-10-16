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
    private static void Check(bool ok,string reason)
    {
        if(!ok)throw new IOException("N2-03-01 MCP V2: "+reason);
    }
    private static long Id(JsonNode node)=>
        node["id"]?.GetValue<long>()??throw new IOException("MCP 未返回 V2 ID。");
    private static JsonNode? Find(JsonNode list,long id)=>
        list.AsArray().FirstOrDefault(x=>x?["folder"]?["ref"]?["id"]?.GetValue<long>()==id);
    public static async Task VerifyAsync(HttpClient client)
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
        // One idle client must never block an independent Agent's request.
        await McpLocal.VerifyConcurrentClientsAsync();
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

        string suffix=Guid.NewGuid().ToString("N")[..8];
        string name="原生MCP项目"+suffix;
        var created=await Call("create_project",new {
            workspace="company",name,project_type="科研项目",
            project_no="N203-"+suffix,leader="项目负责人"
        });
        long project=Id(created);
        Check(project>0,"created V2 project");
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
        var contracts=await Call("list_contracts",new{workspace="company"});
        var contractItem=Find(contracts,contract);
        Check(contractItem?["folder"]?["parent"]?["id"]?.GetValue<long>()==project &&
              contractItem?["businessData"]?["contractNo"]?.GetValue<string>()=="C-"+suffix &&
              contractItem?["businessData"]?["amount"]?.GetValue<string>()=="1234.5",
              "V2 MCP contract has actual V2 project parent");

        string patent="原生MCP专利"+suffix;
        long ip=Id(await Call("create_ip",new{
            workspace="company",name=patent,ip_type="发明专利",
            status="实质审查中",application_no="CN202610000002.0",
            remarks="初始说明"
        }));
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
            var failedUpload=await Original("upload_files",new{
                workspace="company",kind="project",owner_id=originalProject,
                paths=new[]{"C:\\IPSys_missing_"+suffix+".bin"}
            });
            Check(failedUpload["status"]?.GetValue<string>()=="failed" &&
                failedUpload["failed"]?.GetValue<int>()==1 &&
                failedUpload["files"]?[0]?["ok"]?.GetValue<bool>()==false,
                "failed upload reports explicit per-file failure and status");
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
            byte[] downloaded=await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/1/download");
            Check(downloaded.SequenceEqual(originalBytes),
                "MCP uploaded project original bytes round trip");

            // Contract shares the same immutable V2 file; detach only its link.
            using(var linked=await client.PostAsJsonAsync(
                $"/api/v2/files/company/{file}/links",
                new{folderId=originalContractId}))
                linked.EnsureSuccessStatusCode();
            var contractFiles=await Original("list_contract_files",new{
                workspace="company",contract_id=originalContractId
            });
            long contractLink=contractFiles.AsArray()
                .FirstOrDefault(x=>x?["fileId"]?.GetValue<long>()==file)?["id"]?.GetValue<long>()??0;
            Check(contractLink>0,"contract sees shared V2 FileId");
            await Original("delete_contract_file",new{
                workspace="company",contract_id=originalContractId,
                file_id=file,link_id=contractLink
            });
            Check((await Original("list_contract_files",new{
                workspace="company",contract_id=originalContractId
            })).AsArray().Count==0,
                "contract unlink only deletes the selected LinkId");
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
            Check(pageOne["items"] is JsonArray pageRows && pageRows.Count==1 &&
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
            Check((await Original("list_project_files",new{
                workspace="company",project_id=originalProject
            })).AsArray().Count==0,"project file unlinked without physical deletion");
        }
        finally{File.Delete(path);}

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
