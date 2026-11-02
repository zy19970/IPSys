using Microsoft.Data.Sqlite;
using System.Text.Json;

// N2-04 snapshot for frozen company/personal archive and general browser.
// All IDs in this response are native FolderId/FileId/LinkId; never query
// business_archives, records, attachments or business_file_links.
static class NativeArchiveUiEndpoints
{
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
                var fileRows=new List<object>();
                var folders=new List<object>();
                var orders=new Dictionary<string,object>();
                /* A02/N2: every ordinary material IS a folder, so one loop over the
                   directory table already returns the whole module - there is no
                   second "record" collection to merge any more. */
                foreach(string scope in workspace=="company"
                    ?new[]{"certificate","achievement","party","general"}
                    :new[]{"certificate","achievement","academic","general"})
                {
                    var parentIds=new List<long>{0};
                    var directoryRows=new List<(long Id,long? Parent,string Name,
                        int Position,bool IsSystem,string? ModifiedAt,string? CreatedAt,string Metadata)>();
                    using(var cmd=v.Db.CreateCommand())
                    {
                        cmd.CommandText="""
                            SELECT id,parent_id,name,position,is_system,modified_at,created_at,attributes_json FROM folders
                            WHERE workspace=$w AND kind='archive_folder'
                              AND section=$section AND deleted=0
                            ORDER BY position,id;
                            """;
                        cmd.Parameters.AddWithValue("$w",workspace);
                        cmd.Parameters.AddWithValue("$section",scope);
                        using var rd=cmd.ExecuteReader();
                        while(rd.Read())
                        {
                            long id=rd.GetInt64(0);
                            long? parent=rd.IsDBNull(1)?null:rd.GetInt64(1);
                            directoryRows.Add((id,parent,rd.GetString(2),
                                rd.GetInt32(3),rd.GetInt64(4)!=0,
                                rd.IsDBNull(5)?null:rd.GetString(5),
                                rd.IsDBNull(6)?null:rd.GetString(6),rd.GetString(7)));
                        }
                    }
                    foreach(var row in directoryRows)
                    {
                        // A tombstoned ancestor hides every nested directory;
                        // a child whose immediate parent is still active must
                        // not reappear as an orphan at the category root.
                        if(!NativeFileStore.FolderActive(v.Db,workspace,row.Id))
                            continue;
                        var meta=JsonSerializer.Deserialize<ArchiveFolderInput>(row.Metadata);
                        folders.Add(new{
                            id=row.Id,section=scope,parentId=row.Parent,
                            name=row.Name,position=row.Position,isSystem=row.IsSystem,
                            category=meta?.Category??"",year=meta?.Year??"",
                            tags=meta?.Tags??"",remarks=meta?.Remarks??"",
                            modifiedAt=row.ModifiedAt,createdAt=row.CreatedAt
                        });
                        // A directory is also a file owner; its direct attachments
                        // must be returned just like those belonging to records.
                        AddFiles(v.Db,workspace,row.Id,"archive_folder",scope,fileRows);
                        parentIds.Add(row.Id);
                    }
                    foreach(long parentId in parentIds)
                    {
                        var peers=NativeArchiveOrder.Entries(v.Db,workspace,
                            scope,parentId==0?null:parentId);
                        var order=peers.Select(x=>new{
                            kind=x.Folder.Ref.Kind==FolderKinds.ArchiveFolder?"folder":"record",
                            id=x.Folder.Ref.Id
                        }).ToArray();
                        orders[scope+":"+parentId]=order;
                        if(scope=="achievement"&&workspace=="company")
                            orders[parentId.ToString()]=order;
                    }
                }
                return Results.Json(new{folders,orders,files=fileRows});
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
                    displayName=link.DisplayName??link.FileName,
                    category=link.MaterialCategory??"",
                    size=version.Size,sha256=version.Sha256,
                    modifiedAt=version.CreatedAt
                });
        }
    }
}
