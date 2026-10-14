using Microsoft.Data.Sqlite;

record RecycleItem(string Kind,long Id,string Name,string Section,string? Parent);
record RecycleKey(string Kind,long Id,string Section);
record RecycleRequest(List<RecycleKey>? Items);

static class RecycleStore
{
    private static List<RecycleItem> Simple(SqliteConnection db,string workspace,string sql,string kind)
    {
        var rows=new List<RecycleItem>();
        using var cmd=db.CreateCommand();
        cmd.CommandText=sql;
        cmd.Parameters.AddWithValue("$w",workspace);
        using var reader=cmd.ExecuteReader();
        while(reader.Read())
            rows.Add(new RecycleItem(kind,reader.GetInt64(0),reader.GetString(1),
                reader.IsDBNull(2)?"":reader.GetString(2),
                reader.FieldCount<4||reader.IsDBNull(3)?null:reader.GetString(3)));
        return rows;
    }
    public static List<RecycleItem> List(SqliteConnection db,string workspace)
    {
        var rows=Simple(db,workspace,"""
            SELECT id,name,'' FROM business_projects WHERE workspace=$w AND deleted=1
            ORDER BY id DESC;
            ""","project");
        rows.AddRange(Simple(db,workspace,"""
            SELECT id,title,'' FROM records WHERE workspace=$w AND deleted=1 ORDER BY id DESC;
            ""","general"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT id,name,'' FROM business_ips WHERE workspace=$w AND deleted=1
            ORDER BY id DESC;
            ""","ip"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT a.id,a.name,a.section FROM business_archives a
            WHERE a.workspace=$w AND a.deleted=1 ORDER BY a.id DESC;
            ""","archive"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT c.id,c.name,'',p.name FROM business_contracts c
            JOIN business_projects p ON p.id=c.project_id AND p.workspace=c.workspace
            WHERE c.workspace=$w AND c.deleted=1 AND p.deleted=0
            ORDER BY c.id DESC;
            ""","contract"));
        // Deleted attachments under deleted business records are restored by first
        // restoring their parent; they cannot be independently resurrected as orphans.
        var dead=Simple(db,workspace,"""
            SELECT l.id,l.filename,l.section FROM business_file_links l
            JOIN business_file_objects o ON o.id=l.object_id
            WHERE l.workspace=$w AND l.deleted=1 AND o.state='ready'
            ORDER BY l.id DESC;
            ""","file");
        foreach(var r in dead)
            if(BusinessFileStore.OwnerForDeletedLink(db,workspace,r.Id))
                rows.Add(new RecycleItem("file",r.Id,r.Name,"",null));
        rows.AddRange(Simple(db,workspace,"""
            SELECT a.id,a.filename,'' FROM attachments a
            JOIN records r ON r.id=a.record_id
            WHERE r.workspace=$w AND r.deleted=0 AND a.deleted=1 AND a.state='ready'
            ORDER BY a.id DESC;
            ""","general_file"));
        return rows;
    }
    private static bool Deleted(SqliteConnection db,string workspace,RecycleKey r)
    {
        if(r.Id<=0)return false;
        using var cmd=db.CreateCommand();
        cmd.Parameters.AddWithValue("$id",r.Id);
        cmd.Parameters.AddWithValue("$w",workspace);
        switch(r.Kind)
        {
            case "general":
                if(r.Section!="")return false;
                cmd.CommandText="SELECT count(*) FROM records WHERE id=$id AND workspace=$w AND deleted=1;";
                break;
            case "general_file":
                if(r.Section!="")return false;
                cmd.CommandText="""
                    SELECT count(*) FROM attachments a JOIN records r ON r.id=a.record_id
                    WHERE a.id=$id AND a.deleted=1 AND a.state='ready'
                    AND r.workspace=$w AND r.deleted=0;
                    """;
                break;
            case "project":
                if(r.Section!="")return false;
                cmd.CommandText="SELECT count(*) FROM business_projects WHERE id=$id AND workspace=$w AND deleted=1;";
                break;
            case "ip":
                if(r.Section!="")return false;
                cmd.CommandText="SELECT count(*) FROM business_ips WHERE id=$id AND workspace=$w AND deleted=1;";
                break;
            case "archive":
                if(ArchiveStore.Module(workspace,r.Section)==null)return false;
                cmd.CommandText="""
                    SELECT count(*) FROM business_archives
                    WHERE id=$id AND workspace=$w AND section=$section AND module=$module AND deleted=1;
                    """;
                cmd.Parameters.AddWithValue("$section",r.Section);
                cmd.Parameters.AddWithValue("$module",ArchiveStore.Module(workspace,r.Section)!);
                break;
            case "contract":
                if(r.Section!="")return false;
                cmd.CommandText="""
                    SELECT count(*) FROM business_contracts c JOIN business_projects p
                    ON p.id=c.project_id AND p.workspace=c.workspace
                    WHERE c.id=$id AND c.workspace=$w AND c.deleted=1 AND p.deleted=0;
                    """;
                break;
            case "file":
                if(r.Section!="")return false;
                return BusinessFileStore.OwnerForDeletedLink(db,workspace,r.Id);
            default:return false;
        }
        return (long)cmd.ExecuteScalar()! == 1;
    }
    private static void Execute(SqliteConnection db,SqliteTransaction tx,string sql,
        string workspace,long id,string section="")
    {
        using var cmd=db.CreateCommand();cmd.Transaction=tx;
        cmd.CommandText=sql;
        cmd.Parameters.AddWithValue("$id",id);
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$section",section);
        cmd.ExecuteNonQuery();
    }
    private static void Apply(SqliteConnection db,SqliteTransaction tx,string workspace,
        RecycleKey item,bool purge)
    {
        var id=item.Id;var section=item.Section;
        switch(item.Kind)
        {
            case "general":
                if(purge)
                {
                    Execute(db,tx,"DELETE FROM chunks WHERE attachment_id IN (SELECT id FROM attachments WHERE record_id=$id);",workspace,id);
                    Execute(db,tx,"DELETE FROM attachments WHERE record_id=$id;",workspace,id);
                    Execute(db,tx,"DELETE FROM records WHERE id=$id AND workspace=$w AND deleted=1;",workspace,id);
                }
                else Execute(db,tx,"UPDATE records SET deleted=0 WHERE id=$id AND workspace=$w AND deleted=1;",workspace,id);
                break;
            case "general_file":
                if(purge)
                {
                    Execute(db,tx,"DELETE FROM chunks WHERE attachment_id=$id;",workspace,id);
                    Execute(db,tx,"DELETE FROM attachments WHERE id=$id AND deleted=1;",workspace,id);
                }
                else Execute(db,tx,"UPDATE attachments SET deleted=0 WHERE id=$id AND deleted=1;",workspace,id);
                break;
            case "file":
                Execute(db,tx,purge?
                    "DELETE FROM business_file_links WHERE id=$id AND workspace=$w AND deleted=1;":
                    "UPDATE business_file_links SET deleted=0 WHERE id=$id AND workspace=$w AND deleted=1;",
                    workspace,id);
                break;
            case "project":
                if(purge)
                {
                    Execute(db,tx,"""
                        DELETE FROM business_file_links WHERE workspace=$w AND (
                          (kind='project' AND owner_id=$id) OR
                          (kind='contract' AND owner_id IN
                            (SELECT id FROM business_contracts WHERE workspace=$w AND project_id=$id))
                        );
                        """,workspace,id);
                    Execute(db,tx,"DELETE FROM business_contracts WHERE project_id=$id AND workspace=$w;",workspace,id);
                    Execute(db,tx,"DELETE FROM business_projects WHERE id=$id AND workspace=$w AND deleted=1;",workspace,id);
                }
                else Execute(db,tx,"UPDATE business_projects SET deleted=0 WHERE id=$id AND workspace=$w AND deleted=1;",workspace,id);
                break;
            case "contract":
                if(purge)Execute(db,tx,"DELETE FROM business_file_links WHERE kind='contract' AND owner_id=$id AND workspace=$w;",workspace,id);
                Execute(db,tx,purge?
                    "DELETE FROM business_contracts WHERE id=$id AND workspace=$w AND deleted=1;":
                    "UPDATE business_contracts SET deleted=0 WHERE id=$id AND workspace=$w AND deleted=1;",
                    workspace,id);
                break;
            case "ip":
                if(purge)Execute(db,tx,"DELETE FROM business_file_links WHERE kind='ip' AND owner_id=$id AND workspace=$w;",workspace,id);
                Execute(db,tx,purge?
                    "DELETE FROM business_ips WHERE id=$id AND workspace=$w AND deleted=1;":
                    "UPDATE business_ips SET deleted=0 WHERE id=$id AND workspace=$w AND deleted=1;",
                    workspace,id);
                break;
            case "archive":
                if(purge)Execute(db,tx,"""
                    DELETE FROM business_file_links WHERE kind='archive' AND owner_id=$id
                    AND workspace=$w AND section=$section;
                    """,workspace,id,section);
                Execute(db,tx,purge?
                    "DELETE FROM business_archives WHERE id=$id AND workspace=$w AND section=$section AND deleted=1;":
                    "UPDATE business_archives SET deleted=0 WHERE id=$id AND workspace=$w AND section=$section AND deleted=1;",
                    workspace,id,section);
                break;
        }
    }
    private static void CleanupUnreferenced(SqliteConnection db,SqliteTransaction tx)
    {
        using var cmd=db.CreateCommand();cmd.Transaction=tx;
        cmd.CommandText="""
            DELETE FROM business_file_chunks
            WHERE object_id IN (
                SELECT id FROM business_file_objects
                WHERE id NOT IN (SELECT object_id FROM business_file_links)
                AND state='ready'
            );
            DELETE FROM business_file_objects
            WHERE id NOT IN (SELECT object_id FROM business_file_links)
                AND state='ready';
            """;
        cmd.ExecuteNonQuery();
    }
    public static bool Change(SqliteConnection db,string workspace,
        IReadOnlyList<RecycleKey> items,bool purge)
    {
        if(items.Count is <1 or >200)return false;
        if(items.Distinct().Count()!=items.Count)return false;
        // All-or-nothing: validate every item before touching the database.
        if(items.Any(x=>!Deleted(db,workspace,x)))return false;
        using var tx=db.BeginTransaction();
        foreach(var item in items)Apply(db,tx,workspace,item,purge);
        if(purge)CleanupUnreferenced(db,tx);
        tx.Commit();
        return true;
    }
}

static class RecycleEndpoints
{
    private static IResult Fail(string message,int status=400)=>
        Results.Json(new {error=message},statusCode:status);
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/trash/{workspace}",async(HttpContext ctx,Vault v,string workspace)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                return Results.Json(RecycleStore.List(v.Db,workspace));
            }
            finally{v.Gate.Release();}
        });
        app.MapPost("/api/trash/{workspace}/{operation}",async(
            HttpContext ctx,Vault v,string workspace,string operation,RecycleRequest request)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            if(operation is not ("restore" or "purge"))return Fail("无效回收站操作。");
            if(request.Items is null||request.Items.Count is <1 or >200)return Fail("请选择 1 至 200 条记录。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可修改数据。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可修改数据。",409);
                return RecycleStore.Change(v.Db,workspace,request.Items,operation=="purge")
                    ?Results.Ok(new {ok=true,count=request.Items.Count})
                    :Results.NotFound();
            }
            finally{v.Gate.Release();}
        });
    }
}
