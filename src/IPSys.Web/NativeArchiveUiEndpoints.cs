using Microsoft.Data.Sqlite;

// N2-04 snapshot for frozen company/personal archive and general browser.
// All IDs in this response are native FolderId/FileId/LinkId; never query
// business_archives, records, attachments or business_file_links.
static class NativeArchiveUiEndpoints
{
    private static string[] Sections(string w)=>w=="company"?
        ["certificate","achievement"]:
        ["certificate","achievement","academic"];

    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapGet("/api/v2/ui/archive/{workspace}",async(
            HttpContext ctx,Vault v,string workspace)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))
                return fail("工作区无效。",400);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                var archives=new List<object>();
                var general=new List<object>();
                var fileRows=new List<object>();
                var folders=new List<object>();
                var orders=new Dictionary<string,object>();
                foreach(string section in Sections(workspace))
                foreach(var snapshot in NativeArchiveStore.List(v.Db,workspace,
                    FolderKinds.Archive,section))
                {
                    var data=(ArchiveInput)snapshot.BusinessData;
                    long id=snapshot.Folder.Ref.Id;
                    archives.Add(new {
                        id,workspace,section,name=snapshot.Folder.Name,
                        category=data.Category??"",remarks=data.Remarks??"",
                        tags=data.Tags??"",year=data.Year??"",
                        folderId=snapshot.Folder.Parent?.Id,
                        position=snapshot.Folder.Position
                    });
                    AddFiles(v.Db,workspace,id,"archive",section,fileRows);
                }
                foreach(var snapshot in NativeArchiveStore.List(v.Db,workspace,
                    FolderKinds.General,null))
                {
                    long id=snapshot.Folder.Ref.Id;
                    var files=new List<object>();
                    foreach(var link in NativeFileLinkStore.ListFolder(v.Db,workspace,id,false)??[])
                    {
                        var file=NativeFileStore.Get(v.Db,workspace,link.FileId);
                        if(file is null)continue;
                        foreach(var version in file.Versions)
                            files.Add(new {
                                id=-(link.Id*100000+version.Version),
                                linkId=link.Id,fileId=link.FileId,
                                kind="general",ownerId=id,
                                name=version.OriginalName,
                                size=version.Size,sha256=version.Sha256,
                                version=version.Version,groupId="v2-file-"+link.Id,
                                v2=true
                            });
                    }
                    general.Add(new{id,title=snapshot.Folder.Name,files});
                }
                if(workspace=="company")
                {
                    var parentIds=new List<long>{0};
                    using(var cmd=v.Db.CreateCommand())
                    {
                        cmd.CommandText="""
                            SELECT id,parent_id,name,position,is_system FROM folders
                            WHERE workspace='company' AND kind='archive_folder'
                              AND section='achievement' AND deleted=0
                            ORDER BY position,id;
                            """;
                        using var rd=cmd.ExecuteReader();
                        while(rd.Read())
                        {
                            long id=rd.GetInt64(0);
                            long? parent=rd.IsDBNull(1)?null:rd.GetInt64(1);
                            folders.Add(new {
                                id,parentId=parent,name=rd.GetString(2),
                                position=rd.GetInt32(3),isSystem=rd.GetInt64(4)!=0
                            });
                            parentIds.Add(id);
                        }
                    }
                    foreach(long parentId in parentIds)
                    {
                        var peers=NativeArchiveOrder.Entries(v.Db,workspace,
                            "achievement",parentId==0?null:parentId);
                        orders[parentId.ToString()]=peers.Select(x=>new {
                            kind=x.Folder.Ref.Kind==FolderKinds.ArchiveFolder?
                                "folder":"record",
                            id=x.Folder.Ref.Id
                        }).ToArray();
                    }
                }
                return Results.Json(new{archives,general,folders,orders,files=fileRows});
            }
            finally{v.Gate.Release();}
        });
    }
    private static void AddFiles(SqliteConnection db,string workspace,long folderId,
        string kind,string section,List<object> result)
    {
        foreach(var link in NativeFileLinkStore.ListFolder(
            db,workspace,folderId,false)??[])
        {
            var file=NativeFileStore.Get(db,workspace,link.FileId);
            if(file is null)continue;
            foreach(var version in file.Versions)
                result.Add(new{
                    id=-(link.Id*100000+version.Version),
                    linkId=link.Id,fileId=link.FileId,
                    ownerId=folderId,kind,section,
                    groupId="v2-file-"+link.Id,v2=true,
                    version=version.Version,name=version.OriginalName,
                    category=link.MaterialCategory??"",
                    size=version.Size,sha256=version.Sha256
                });
        }
    }
}
