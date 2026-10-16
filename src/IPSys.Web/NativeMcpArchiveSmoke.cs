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
            "delete_general"}.All(names.Contains),"12 native archive/general actions registered");
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
        await Run("update_archive_folder",new{
            workspace="company",folder_id=folder,name=tag+"重命名目录"
        });
        long empty=Id(await Run("create_archive_folder",new{
            workspace="company",parent_id=root,name=tag+"空目录"
        }));
        await Run("delete_archive_folder",new{
            workspace="company",folder_id=empty
        });
        Check(!Has(await Run("list_archive_folders",new{workspace="company",parent_id=root}),empty),
            "empty archive directory deleted permanently");
        long archive=Id(await Run("create_archive",new{
            workspace="company",section="achievement",folder_id=folder,
            name=tag+"业务材料",category="报批资料",remarks="更新前",year=2026
        }));
        Check(Has(await Run("list_archives",new{
            workspace="company",section="achievement"
        }),archive),"MCP created archive appears in same Folder table as UI");
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
