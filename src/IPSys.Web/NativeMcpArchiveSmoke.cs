using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;

// N2-04 complete archive/general MCP commands through the user-authorized
// local bridge and real encrypted SQLCipher HTTP data, not test stubs.
static class NativeMcpArchiveSmoke
{
    private static JsonElement Args(object value)=>JsonSerializer.SerializeToElement(value);
    private static Task<JsonNode> Run(string name,object args)=>
        McpLocal.RunSmokeToolAsync(name,Args(args));
    private static long Id(JsonNode value)=>value["id"]?.GetValue<long>()
        ??throw new IOException("档案 MCP 缺少原生 FolderId。");
    private static void Check(bool condition,string message)
    {
        if(!condition)throw new IOException("N2-04 ARCHIVE MCP: "+message);
    }
    private static bool Has(JsonNode rows,long id)=>rows is JsonArray a &&
        a.Any(x=>x?["folder"]?["ref"]?["id"]?.GetValue<long>()==id);

    public static async Task VerifyAsync(HttpClient client)
    {
        var names=McpLocal.Tools().Select(x=>(string)x.GetType()
            .GetProperty("name")!.GetValue(x)!).ToArray();
        Check(new[]{"list_archives","create_archive","update_archive","delete_archive",
            "list_archive_folders","create_archive_folder","update_archive_folder",
            "delete_archive_folder","list_general","create_general","update_general",
            "delete_general","list_party_archives","create_party_archive",
            "update_party_archive","delete_party_archive"}.All(names.Contains),
            "archive/general and four company party actions registered");
        // ISS-002: invalid archive classification is a known local refusal,
        // not an unknown write outcome.
        string badSectionId=Guid.NewGuid().ToString("N");
        var badSection=await Run("create_archive",new{
            workspace="company",section="academic",name="错误分类测试",
            request_id=badSectionId
        });
        var badSectionLog=await Run("get_operation_result",new{
            workspace="company",request_id=badSectionId
        });
        Check(badSection["status"]?.GetValue<string>()=="failed" &&
              badSectionLog["state"]?.GetValue<string>()=="done" &&
              badSectionLog["businessOk"]?.GetValue<bool>()==false,
              "invalid section is a durable, definitive local rejection");
        string tag="N204-MCP-"+Guid.NewGuid().ToString("N")[..8];
        var roots=await Run("list_archive_folders",new{workspace="company"});
        long root=roots.AsArray().First(x=>
            x?["folder"]?["name"]?.GetValue<string>()=="申报与认定")!
            ["folder"]!["ref"]!["id"]!.GetValue<long>();
        long folder=Id(await Run("create_archive_folder",new{
            workspace="company",parent_id=root,name=tag+"子目录"
        }));
        Check(Has(await Run("list_archive_folders",new{workspace="company",parent_id=root}),folder),
            "new directory uses live V2 FolderId");
        // ISS-016: deterministic local rejects must be replayable done/false,
        // not an uncertain operation requiring manual reconciliation.
        string missingTrashId=Guid.NewGuid().ToString("N");
        var missingTrash=await Run("restore_trash",new{
            workspace="company",kind="project",id=999999999L,
            request_id=missingTrashId
        });
        var missingTrashLedger=await Run("get_operation_result",new{
            workspace="company",request_id=missingTrashId
        });
        Check(missingTrash["status"]?.GetValue<string>()=="failed" &&
              missingTrashLedger["state"]?.GetValue<string>()=="done" &&
              missingTrashLedger["businessOk"]?.GetValue<bool>()==false &&
              missingTrashLedger["result"]?["error"]?.GetValue<string>()?.Contains("回收站不存在")==true,
              "ISS-016 missing trash record is a known rejection");
        string invalidParentId=Guid.NewGuid().ToString("N");
        var invalidParent=await Run("create_archive_folder",new{
            workspace="company",parent_id=0,name=tag+"父目录错误",
            request_id=invalidParentId
        });
        var invalidParentLedger=await Run("get_operation_result",new{
            workspace="company",request_id=invalidParentId
        });
        Check(invalidParent["status"]?.GetValue<string>()=="failed" &&
              invalidParentLedger["state"]?.GetValue<string>()=="done" &&
              invalidParentLedger["businessOk"]?.GetValue<bool>()==false &&
              invalidParentLedger["result"]?["error"]?.GetValue<string>()?.Contains("parent_id")==true,
              "ISS-016 invalid folder parent is a known rejection");
        // ISS-017: duplicate sibling name is reported as a business conflict,
        // never the internal SQLITE_CONSTRAINT code 19.
        string duplicateId=Guid.NewGuid().ToString("N");
        var duplicate=await Run("create_archive_folder",new{
            workspace="company",parent_id=root,name=tag+"子目录",
            request_id=duplicateId
        });
        var duplicateLedger=await Run("get_operation_result",new{
            workspace="company",request_id=duplicateId
        });
        Check(duplicate["status"]?.GetValue<string>()=="failed" &&
              duplicate["httpStatus"]?.GetValue<int>()==409 &&
              duplicate["error"]?.GetValue<string>()?.Contains("同一目录下已存在同名目录")==true &&
              duplicateLedger["state"]?.GetValue<string>()=="done" &&
              duplicateLedger["businessOk"]?.GetValue<bool>()==false,
              "ISS-017 duplicate directory name has actionable Chinese error");
        string reject409Id=Guid.NewGuid().ToString("N");
        var reject409=await Run("move_folder",new{
            workspace="company",kind="archive_folder",entry_id=folder,
            parent_id=folder,request_id=reject409Id
        });
        var reject409Log=await Run("get_operation_result",new{
            workspace="company",request_id=reject409Id
        });
        Check(reject409["status"]?.GetValue<string>()=="failed" &&
              reject409["httpStatus"]?.GetValue<int>()==409 &&
              reject409Log["state"]?.GetValue<string>()=="done" &&
              reject409Log["businessOk"]?.GetValue<bool>()==false,
              "ISS-002 known 409 validation rejection is durable, not uncertain");
        await Run("update_archive_folder",new{
            workspace="company",folder_id=folder,name=tag+"重命名目录"
        });
        long empty=Id(await Run("create_archive_folder",new{
            workspace="company",parent_id=root,name=tag+"空目录"
        }));
        await Run("move_folder",new{
            workspace="company",kind="archive_folder",entry_id=empty,
            parent_id=folder,request_id=Guid.NewGuid().ToString("N")
        });
        Check(Has(await Run("list_archive_folders",new{
            workspace="company",parent_id=folder
        }),empty),"move_folder places directory under requested parent");
        await Run("move_folder",new{
            workspace="company",kind="archive_folder",entry_id=empty,parent_id=root
        });
        Check(Has(await Run("list_archive_folders",new{
            workspace="company",parent_id=root
        }),empty),"move_folder restores previous parent without new FolderId");
        await Run("delete_archive_folder",new{
            workspace="company",folder_id=empty
        });
        Check(!Has(await Run("list_archive_folders",new{workspace="company",parent_id=root}),empty),
            "empty archive directory deleted permanently");
        // ISS-014: explicitly purge an already-deleted attachment-free record
        // before removing its parent directory. A direct delete must not
        // silently wipe soft-deleted references.
        long purgeFolder=Id(await Run("create_archive_folder",new{
            workspace="company",parent_id=root,name=tag+"清理目录"
        }));
        long purgeRecord=Id(await Run("create_archive",new{
            workspace="company",section="achievement",folder_id=purgeFolder,
            name=tag+"清理测试资料"
        }));
        await Run("delete_archive",new{
            workspace="company",section="achievement",archive_id=purgeRecord
        });
        bool explicitConfirmRequired=false;
        try{await Run("purge_trash",new{
            workspace="company",kind="v2_archive",section="achievement",
            id=purgeRecord,confirm=false
        });}catch(IOException){explicitConfirmRequired=true;}
        Check(explicitConfirmRequired,"permanent deletion requires explicit confirmation");
        var purged=await Run("purge_trash",new{
            workspace="company",kind="v2_archive",section="achievement",
            id=purgeRecord,confirm=true,request_id=Guid.NewGuid().ToString("N")
        });
        Check(purged["ok"]?.GetValue<bool>()==true,
            "permanent trash operation removes only the selected empty record");
        await Run("delete_archive_folder",new{
            workspace="company",folder_id=purgeFolder
        });
        Check(!Has(await Run("list_archive_folders",new{
            workspace="company",parent_id=root
        }),purgeFolder),"after explicit purge, the empty directory can be deleted");
        long archive=Id(await Run("create_archive",new{
            workspace="company",section="achievement",folder_id=folder,
            name=tag+"业务材料",category="报批资料",remarks="更新前",year=2026
        }));
        Check(Has(await Run("list_archives",new{
            workspace="company",section="achievement"
        }),archive),"MCP created archive appears in same Folder table as UI");
        long peer=Id(await Run("create_archive_folder",new{
            workspace="company",parent_id=folder,name=tag+"混排目录"
        }));
        var entries=await Run("list_folder_entries",new{
            workspace="company",parent_id=folder
        });
        Check(entries is JsonArray before &&
            before.Count==2,"list_folder_entries returns mixed direct children");
        await Run("reorder_entries",new{
            workspace="company",parent_id=folder,
            items=new object[]{new {kind="record",id=archive},
                new {kind="folder",id=peer}},
            request_id=Guid.NewGuid().ToString("N")
        });
        var ordered=await Run("list_folder_entries",new{
            workspace="company",parent_id=folder
        });
        Check(ordered is JsonArray arr && arr.Count==2 &&
              arr[0]?["folder"]?["ref"]?["id"]?.GetValue<long>()==archive &&
              arr[1]?["folder"]?["ref"]?["id"]?.GetValue<long>()==peer,
              "reorder_entries persists mixed folder/record order");
        bool staleRejected=false;
        try{await Run("reorder_entries",new{
            workspace="company",parent_id=folder,
            items=new object[]{new {kind="record",id=archive}}
        });}catch(IOException ex)when(ex.Message.Contains("409")){
            staleRejected=true;
        }
        Check(staleRejected,"mixed reorder rejects missing siblings");
        bool cycleRejected=false;
        try{await Run("move_folder",new{
            workspace="company",kind="archive_folder",entry_id=folder,
            parent_id=peer
        });}catch(IOException){cycleRejected=true;}
        Check(cycleRejected,"move_folder rejects descendant cycles");
        await Run("move_folder",new{
            workspace="company",kind="archive",entry_id=archive,parent_id=peer
        });
        var movedArchive=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/folders/company/archive/{archive}?section=achievement");
        Check(movedArchive.GetProperty("businessData").GetProperty("folderId").GetInt64()==peer,
            "move_folder updates archive's persisted business parent");
        await Run("move_folder",new{
            workspace="company",kind="archive",entry_id=archive,parent_id=folder
        });
        await Run("delete_archive_folder",new{
            workspace="company",folder_id=peer
        });
        await Run("update_archive",new{
            workspace="company",section="achievement",archive_id=archive,
            remarks="已更新",year=(string?)null
        });
        var edited=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/folders/company/archive/{archive}?section=achievement");
        Check(edited.GetProperty("businessData").GetProperty("remarks")
            .GetString()=="已更新" &&
            edited.GetProperty("businessData").GetProperty("year").GetString()=="2026" &&
            edited.GetProperty("folder").GetProperty("parent")
            .GetProperty("id").GetInt64()==folder,
            "partial edit preserves archive folder and other fields");
        bool crossDenied=false;
        try
        {
            await Run("update_archive",new{workspace="personal",
                section="achievement",archive_id=archive,name="错误操作"});
        }
        catch(IOException){crossDenied=true;}
        Check(crossDenied,"foreign workspace archive cannot be updated");
        bool sectionDenied=false;
        try
        {
            await Run("create_archive",new{workspace="company",
                section="academic",name=tag+"错误分类"});
        }
        catch(IOException){sectionDenied=true;}
        Check(sectionDenied,"archive section must match workspace");


        // Company-only 党团建设: dedicated tools share the canonical
        // archive FolderId, SQLCipher files and existing MCP safety envelope.
        var partySchema=JsonSerializer.SerializeToElement(McpLocal.Tools())
            .EnumerateArray().First(x=>x.GetProperty("name").GetString()=="create_party_archive")
            .GetProperty("inputSchema").GetProperty("properties");
        Check(!partySchema.TryGetProperty("section",out _) &&
            !partySchema.TryGetProperty("folder_id",out _) &&
            partySchema.GetProperty("workspace").GetProperty("enum")[0].GetString()=="company",
            "party MCP schema is discoverable, company-only and needs no parent directory");
        var partyProtocol=await McpLocal.RunSmokeProtocolToolAsync("list_party_archives",
            Args(new{workspace="company"}));
        Check(partyProtocol["result"]?["isError"]?.GetValue<bool>()==false &&
            partyProtocol["result"]?["content"]?[0]?["text"]?.GetValue<string>() is string partyJson &&
            JsonNode.Parse(partyJson) is JsonArray,
            "public stdio MCP party listing returns a JSON array");
        string partyKey="N204-PARTY-"+Guid.NewGuid().ToString("N")[..8];
        var rejectedParty=await McpLocal.RunSmokeProtocolToolAsync(
            "create_party_archive",Args(new{
                workspace="personal",name=partyKey+"越区"
            }));
        Check(rejectedParty["result"]?["isError"]?.GetValue<bool>()==true,
            "party tool schema rejects personal-workspace writes");
        long party=Id(await Run("create_party_archive",new{
            workspace="company",name=partyKey+"党团活动",category="组织活动",
            remarks="新增记录",year=2026
        }));
        Check(Has(await Run("list_party_archives",new{workspace="company"}),party) &&
            Has(await Run("list_archives",new{workspace="company",section="party"}),party),
            "party dedicated list and generic archive list share FolderId");
        await Run("update_party_archive",new{
            workspace="company",archive_id=party,remarks="更新后的活动资料"
        });
        var partyEdited=await client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/folders/company/archive/{party}?section=party");
        Check(partyEdited.GetProperty("businessData").GetProperty("remarks")
            .GetString()=="更新后的活动资料" &&
            partyEdited.GetProperty("businessData").GetProperty("year").GetString()=="2026",
            "party partial edit preserves historical archive fields");
        bool cannotCrossParty=false;
        try
        {
            await Run("transfer_archive",new{
                workspace="company",section="party",archive_id=party,
                target_workspace="personal",target_section="academic",move=false
            });
        }
        catch(IOException){cannotCrossParty=true;}
        Check(cannotCrossParty,"party archives cannot leak into the personal workspace");
        var copiedParty=await Run("transfer_archive",new{
            workspace="company",section="party",archive_id=party,
            target_workspace="company",target_section="party",move=false
        });
        long copiedPartyId=Id(copiedParty);
        Check(copiedPartyId!=party &&
            Has(await Run("list_party_archives",new{workspace="company"}),copiedPartyId),
            "generic transfer_archive supports same-category company party copies");
        await Run("delete_party_archive",new{
            workspace="company",archive_id=copiedPartyId
        });
        Check(!Has(await Run("list_party_archives",new{workspace="company"}),copiedPartyId),
            "party deletion soft-deletes copied record");
        var partyTrash=await Run("list_trash",new{workspace="company"});
        Check(partyTrash is JsonArray trash && trash.Any(x=>
                x?["kind"]?.GetValue<string>()=="v2_archive" &&
                x?["id"]?.GetValue<long>()==copiedPartyId &&
                x?["section"]?.GetValue<string>()=="party"),
            "party trash exposes exact section for restore_trash");
        await Run("restore_trash",new{
            workspace="company",kind="v2_archive",id=copiedPartyId,section="party"
        });
        Check(Has(await Run("list_party_archives",new{workspace="company"}),copiedPartyId),
            "restored party record returns to its original category");
        await Run("delete_party_archive",new{
            workspace="company",archive_id=copiedPartyId
        });
        // Also exercise the same standard archive upload path and file listing.
        string partyPath=Path.Combine(Path.GetTempPath(),partyKey+".txt");
        await File.WriteAllBytesAsync(partyPath,RandomNumberGenerator.GetBytes(102));
        try
        {
            var upload=await Run("upload_files",new{
                workspace="company",kind="archive",section="party",
                owner_id=party,paths=new[]{partyPath}
            });
            Check(upload["succeeded"]?.GetValue<int>()==1,
                "company party uploads via existing archive upload_files");
            long partyLink=upload["files"]?[0]?["result"]?["linkId"]?.GetValue<long>()??0;
            long partyFile=upload["files"]?[0]?["result"]?["fileId"]?.GetValue<long>()??0;
            var page=await Run("list_files_page",new{
                workspace="company",kind="archive",owner_id=party,limit=10
            });
            Check(partyLink>0 && partyFile>0 &&
                page["items"] is JsonArray partyFiles && partyFiles.Any(x=>
                    x?["id"]?.GetValue<long>()==partyLink &&
                    x?["section"]?.GetValue<string>()=="party"),
                "party attachment is visible in paginated MCP file queries");
            await Run("delete_file",new{
                workspace="company",owner_id=party,file_id=partyFile,link_id=partyLink
            });
            Check((await Run("list_files_page",new{
                workspace="company",kind="archive",owner_id=party
            }))["items"] is JsonArray unlinked && unlinked.Count==0,
                "party attachment can be unlinked using the standard file tool");
        }
        finally{File.Delete(partyPath);}
        await Run("delete_party_archive",new{workspace="company",archive_id=party});
        long general=Id(await Run("create_general",new{
            workspace="company",title=tag+"综合资料"
        }));
        Check(Has(await Run("list_general",new{workspace="company"}),general),
            "MCP general listed by V2 FolderId");
        await Run("update_general",new{
            workspace="company",general_id=general,title=tag+"改名"
        });
        Check(Has(await Run("list_general",new{workspace="company"}),general),
            "general rename preserves FolderId");
        var generalCopied=await Run("transfer_general",new{
            workspace="company",general_id=general,
            target_workspace="personal",move=false
        });
        long newGeneral=Id(generalCopied);
        Check(Has(await Run("list_general",new{workspace="personal"}),newGeneral),
            "transfer_general copies V2 general folder to another workspace");
        await Run("delete_general",new{
            workspace="personal",general_id=newGeneral
        });
        var archiveCopied=await Run("transfer_archive",new{
            workspace="company",section="achievement",archive_id=archive,
            target_workspace="personal",target_section="achievement",move=false
        });
        long newArchive=Id(archiveCopied);
        Check(Has(await Run("list_archives",new{
            workspace="personal",section="achievement"
        }),newArchive),"transfer_archive preserves V2 archive in target workspace");
        var personalArchives=await Run("list_archives",new{
            workspace="personal",section="achievement"
        });
        var ids=personalArchives.AsArray().Select(x=>
            x?["folder"]?["ref"]?["id"]?.GetValue<long>()??0).ToArray();
        Check(ids.Length>0&&ids.All(x=>x>0),
            "personal archive ordering input comes from current V2 folders");
        await Run("reorder_archive_records",new{
            workspace="personal",section="achievement",ids,
            request_id=Guid.NewGuid().ToString("N")
        });
        bool wrongSectionOrder=false;
        try{await Run("reorder_archive_records",new{
            workspace="company",section="achievement",ids=new[]{archive}
        });}catch(IOException){wrongSectionOrder=true;}
        Check(wrongSectionOrder,"company achievement must use mixed-entry reorder");
        await Run("delete_archive",new{
            workspace="personal",section="achievement",archive_id=newArchive
        });

        byte[] source=RandomNumberGenerator.GetBytes(1301);
        string path=Path.Combine(Path.GetTempPath(),tag+".pdf");
        await File.WriteAllBytesAsync(path,source);
        try
        {
            var attached=await Run("upload_files",new{
                workspace="company",kind="archive",section="achievement",
                owner_id=archive,paths=new[]{path}
            });
            Check(attached["succeeded"]?.GetValue<int>()==1,
                "MCP archive upload uses native preflight/resolve");
            long file=attached["files"]?[0]?["result"]?["fileId"]?.GetValue<long>()??0;
            long link=attached["files"]?[0]?["result"]?["linkId"]?.GetValue<long>()??0;
            Check(file>0&&link>0,"archive link and file identities returned");
            var files=await Run("list_files",new{workspace="company"});
            Check(files.AsArray().Any(x=>x?["id"]?.GetValue<long>()==link &&
                  x?["fileId"]?.GetValue<long>()==file &&
                  x?["ownerId"]?.GetValue<long>()==archive &&
                  x?["kind"]?.GetValue<string>()=="archive" &&
                  x?["section"]?.GetValue<string>()=="achievement"),
                "global list_files includes archive with valid section and ownership");
            var archivePage=await Run("list_files_page",new{
                workspace="company",kind="archive",owner_id=archive,
                name=Path.GetFileName(path),offset=0,limit=5
            });
            Check(archivePage["items"] is JsonArray archiveRows &&
                archiveRows.Count==1 &&
                archiveRows[0]?["id"]?.GetValue<long>()==link &&
                archiveRows[0]?["fileId"]?.GetValue<long>()==file &&
                archiveRows[0]?["kind"]?.GetValue<string>()=="archive" &&
                archiveRows[0]?["section"]?.GetValue<string>()=="achievement" &&
                archivePage["hasMore"]?.GetValue<bool>()==false,
                "paged SQL query returns only the archive's active file link");

            byte[] revised=RandomNumberGenerator.GetBytes(971);
            await File.WriteAllBytesAsync(path,revised);
            var version=await Run("upload_files",new{
                workspace="company",kind="archive",section="achievement",
                owner_id=archive,paths=new[]{path},on_conflict="update",file_id=file
            });
            Check(version["succeeded"]?.GetValue<int>()==1,
                "archive MCP append creates V2 FileVersion");
            Check((await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/1/download")).SequenceEqual(source) &&
                  (await client.GetByteArrayAsync(
                $"/api/v2/files/company/{file}/versions/2/download")).SequenceEqual(revised),
                "both archive original bytes and latest are immutable and readable");
            bool wrongOwner=false;
            try{
                await Run("upload_files",new{
                    workspace="company",kind="general",owner_id=general,
                    paths=new[]{path},on_conflict="update",file_id=file
                });
            }catch(IOException){wrongOwner=true;}
            Check(wrongOwner,"general folder cannot append version to archive-owned FileId");

            // Independent general attachment, then soft-unlink without losing
            // either kind's original versions or another folder's links.
            await File.WriteAllBytesAsync(path,RandomNumberGenerator.GetBytes(977));
            var generalUpload=await Run("upload_files",new{
                workspace="company",kind="general",owner_id=general,
                paths=new[]{path}
            });
            Check(generalUpload["succeeded"]?.GetValue<int>()==1,
                "general MCP uploads native V2 original");
            long generalLink=generalUpload["files"]?[0]?["result"]?["linkId"]?.GetValue<long>()??0;
            Check(generalLink>0&&(await Run("list_files",new{workspace="company"}))
                .AsArray().Any(x=>x?["id"]?.GetValue<long>()==generalLink &&
                  x?["kind"]?.GetValue<string>()=="general"),
                "global list_files includes general");
            await Run("delete_file",new{workspace="company",owner_id=general,file_id=generalUpload["files"]?[0]?["result"]?["fileId"]?.GetValue<long>()??0,link_id=generalLink});
            Check(!(await Run("list_files",new{workspace="company"}))
                .AsArray().Any(x=>x?["id"]?.GetValue<long>()==generalLink),
                "deleting general LinkId does not erase FileId");
            await Run("delete_file",new{workspace="company",owner_id=archive,file_id=file,link_id=link});
            Check(!(await Run("list_files",new{workspace="company"}))
                .AsArray().Any(x=>x?["id"]?.GetValue<long>()==link),
                "archive unlink removed just selected link");
        }
        finally{File.Delete(path);}
        await Run("delete_archive",new{
            workspace="company",section="achievement",archive_id=archive
        });
        Check(!Has(await Run("list_archives",new{
            workspace="company",section="achievement"
        }),archive),"soft-deleted archive excluded from active MCP list");
        await Run("delete_general",new{workspace="company",general_id=general});
        Check(!Has(await Run("list_general",new{workspace="company"}),general),
            "soft-deleted general excluded from active MCP list");
        // A directory with deleted archive history still has child references
        // and must not be physically removed without deleting that history.
        bool childProtected=false;
        try{await Run("delete_archive_folder",new{
            workspace="company",folder_id=folder
        });}catch(IOException){childProtected=true;}
        Check(childProtected,"archive directory with historical children must be protected");
        // Company-only archive folder tools must never access a personal root.
        bool personalDenied=false;
        try{await Run("list_archive_folders",new{workspace="personal"});}
        catch(IOException){personalDenied=true;}
        Check(personalDenied,"no company archive folders in personal workspace");
        Console.WriteLine("N2-04 ARCHIVE GENERAL MCP V2 SQLCIPHER PASS");
    }
}
