using Microsoft.Data.Sqlite;

record RecycleItem(string Kind,long Id,string Name,string Section,string? Parent);
record RecycleKey(string Kind,long Id,string Section);
record RecycleRequest(List<RecycleKey>? Items);

// Recycle is based exclusively on V2 FolderId and LinkId.
static class RecycleStore
{
    private static List<RecycleItem> Simple(SqliteConnection db,string workspace,
        string sql,string kind)
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
        var rows=new List<RecycleItem>();
        rows.AddRange(Simple(db,workspace,"""
            SELECT id,name,'' FROM folders
            WHERE workspace=$w AND kind='project' AND deleted=1 ORDER BY id DESC;
            ""","project"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT id,name,'' FROM folders
            WHERE workspace=$w AND kind='general' AND deleted=1 ORDER BY id DESC;
            ""","v2_general"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT id,name,'' FROM folders
            WHERE workspace=$w AND kind='ip' AND deleted=1 ORDER BY id DESC;
            ""","ip"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT a.id,a.name,a.section FROM folders a
            WHERE a.workspace=$w AND a.kind='archive' AND a.deleted=1
              AND (a.parent_id IS NULL OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=a.parent_id
                  AND p.workspace=a.workspace AND p.deleted=0))
            ORDER BY a.id DESC;
            ""","v2_archive"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT c.id,c.name,'',p.name FROM folders c
            JOIN folders p ON p.id=c.parent_id AND p.workspace=c.workspace
            WHERE c.workspace=$w AND c.kind='contract' AND c.deleted=1
              AND p.kind='project' AND p.deleted=0 ORDER BY c.id DESC;
            ""","contract"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT l.id,COALESCE(l.display_name,f.name),'',p.name
            FROM folder_file_links l JOIN folders p ON p.id=l.folder_id
              AND p.workspace=l.workspace
            JOIN files f ON f.id=l.file_id AND f.workspace=l.workspace
            WHERE l.workspace=$w AND l.deleted=1 AND p.kind='ip'
              AND p.deleted=0 AND f.deleted=0 ORDER BY l.id DESC;
            ""","v2_ip_file"));
        rows.AddRange(Simple(db,workspace,"""
            SELECT l.id,COALESCE(l.display_name,f.name),'',p.name
            FROM folder_file_links l JOIN folders p ON p.id=l.folder_id
              AND p.workspace=l.workspace
            JOIN files f ON f.id=l.file_id AND f.workspace=l.workspace
            WHERE l.workspace=$w AND l.deleted=1
              AND p.kind IN ('project','contract','archive','general')
              AND p.deleted=0 AND f.deleted=0
              AND (p.parent_id IS NULL OR EXISTS(
                SELECT 1 FROM folders parent WHERE parent.id=p.parent_id
                  AND parent.workspace=p.workspace AND parent.deleted=0))
            ORDER BY l.id DESC;
            ""","v2_file"));
        return rows;
    }
    private static bool Deleted(SqliteConnection db,string workspace,RecycleKey item)
    {
        if(item.Id<=0)return false;
        if(item.Kind!="v2_archive" && item.Section.Length!=0)return false;
        using var cmd=db.CreateCommand();
        cmd.Parameters.AddWithValue("$id",item.Id);
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$section",item.Section);
        switch(item.Kind)
        {
            case "project":
            case "ip":
            case "v2_general":
                cmd.CommandText="SELECT COUNT(*) FROM folders WHERE id=$id AND workspace=$w AND kind=$kind AND deleted=1;";
                cmd.Parameters.AddWithValue("$kind",item.Kind=="v2_general"?"general":item.Kind);
                break;
            case "contract":
                cmd.CommandText="""
                    SELECT COUNT(*) FROM folders c JOIN folders p ON p.id=c.parent_id
                    AND p.workspace=c.workspace WHERE c.id=$id AND c.workspace=$w
                    AND c.kind='contract' AND c.deleted=1
                    AND p.kind='project' AND p.deleted=0;
                    """;
                break;
            case "v2_archive":
                cmd.CommandText="""
                    SELECT COUNT(*) FROM folders a WHERE a.id=$id AND a.workspace=$w
                    AND a.kind='archive' AND a.section=$section AND a.deleted=1
                    AND (a.parent_id IS NULL OR EXISTS(
                        SELECT 1 FROM folders p WHERE p.id=a.parent_id
                          AND p.workspace=a.workspace AND p.deleted=0));
                    """;
                break;
            case "v2_ip_file":
            case "v2_file":
                cmd.CommandText="""
                    SELECT COUNT(*) FROM folder_file_links l
                    JOIN folders p ON p.id=l.folder_id AND p.workspace=l.workspace
                    JOIN files f ON f.id=l.file_id AND f.workspace=l.workspace
                    WHERE l.id=$id AND l.workspace=$w AND l.deleted=1
                      AND p.deleted=0 AND f.deleted=0
                      AND ((p.kind='ip' AND $kind='v2_ip_file')
                        OR (p.kind IN ('project','contract','archive','general')
                            AND $kind='v2_file'))
                      AND (p.parent_id IS NULL OR EXISTS(
                        SELECT 1 FROM folders parent WHERE parent.id=p.parent_id
                          AND parent.workspace=p.workspace AND parent.deleted=0));
                    """;
                cmd.Parameters.AddWithValue("$kind",item.Kind);
                break;
            default:return false;
        }
        return (long)cmd.ExecuteScalar()! == 1;
    }
    private static void Apply(SqliteConnection db,SqliteTransaction tx,string workspace,
        RecycleKey item,bool purge)
    {
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$id",item.Id);
        cmd.Parameters.AddWithValue("$section",item.Section);
        string sql= item.Kind switch
        {
            "project" or "contract" or "ip" or "v2_general" or "v2_archive" =>
                purge
                ? "DELETE FROM folders WHERE id=$id AND workspace=$w AND deleted=1;"
                : "UPDATE folders SET deleted=0 WHERE id=$id AND workspace=$w AND deleted=1;",
            "v2_file" or "v2_ip_file" =>
                purge
                ? "DELETE FROM folder_file_links WHERE id=$id AND workspace=$w AND deleted=1;"
                : "UPDATE folder_file_links SET deleted=0 WHERE id=$id AND workspace=$w AND deleted=1;",
            _ => throw new ArgumentException("无效回收站记录类型。")
        };
        cmd.CommandText=sql;
        if(cmd.ExecuteNonQuery()!=1)throw new InvalidOperationException("回收站记录已变化。");
    }
    public static bool Change(SqliteConnection db,string workspace,
        IReadOnlyList<RecycleKey> items,bool purge)
    {
        if(items.Count is <1 or >200 || items.Distinct().Count()!=items.Count)return false;
        if(items.Any(x=>!Deleted(db,workspace,x)))return false;
        if(purge)
        {
            foreach(var item in items)
            {
                if(item.Kind is "v2_ip_file" or "v2_file")
                    throw new InvalidOperationException("共享原件物理回收尚未提供，不能永久删除该关联。");
                using var cmd=db.CreateCommand();
                cmd.CommandText=item.Kind=="project"?"""
                    SELECT (SELECT COUNT(*) FROM folders WHERE workspace=$w
                      AND kind='contract' AND parent_id=$id) +
                      (SELECT COUNT(*) FROM folder_file_links WHERE workspace=$w
                      AND (folder_id=$id OR folder_id IN
                        (SELECT id FROM folders WHERE workspace=$w AND kind='contract'
                        AND parent_id=$id)));
                    """:"""
                    SELECT COUNT(*) FROM folder_file_links
                    WHERE workspace=$w AND folder_id=$id;
                    """;
                cmd.Parameters.AddWithValue("$w",workspace);
                cmd.Parameters.AddWithValue("$id",item.Id);
                if((long)cmd.ExecuteScalar()!>0)
                    throw new InvalidOperationException("记录仍有关联目录或文件历史，禁止永久删除。");
            }
        }
        using var tx=db.BeginTransaction();
        foreach(var item in items)Apply(db,tx,workspace,item,purge);
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
                try
                {
                    return RecycleStore.Change(v.Db,workspace,request.Items,operation=="purge")
                        ?Results.Ok(new {ok=true,count=request.Items.Count})
                        :Results.NotFound();
                }
                catch(InvalidOperationException ex){return Fail(ex.Message,409);}
                catch(SqliteException ex){return Fail("引用约束拒绝此操作："+ex.SqliteErrorCode,409);}
            }
            finally{v.Gate.Release();}
        });
    }
}
