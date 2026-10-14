using Microsoft.Data.Sqlite;

record ArchiveInput(string? Name, string? Category, string? Remarks, string? Tags);
record ArchiveTransfer(string TargetWorkspace, string TargetSection, bool Move);
record ArchiveView(long Id, string Workspace, string Section, string Name,
    string Category, string Remarks, string Tags);

// M0 minimal fields. Company credentials and personal credentials remain distinct
// logical modules; achievement/academic are two views of research_output.
static class ArchiveStore
{
    private static string Clean(string? s) => s?.Trim() ?? "";
    public static string? Validate(ArchiveInput value)
    {
        if (Clean(value.Name).Length is 0 or > 300) return "资料名称必填，最多 300 字。";
        foreach (var s in new[] {value.Category, value.Remarks, value.Tags})
            if (Clean(s).Length > 4000) return "字段内容过长。";
        return null;
    }
    public static string? Module(string workspace, string section) => (workspace,section) switch
    {
        ("company","certificate") => "company_certificate",
        ("personal","certificate") => "personal_certificate",
        ("company","achievement") => "research_output",
        ("personal","achievement") => "research_output",
        ("personal","academic") => "research_output",
        _ => null
    };
    public static void Ensure(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS business_archives(
              id INTEGER PRIMARY KEY,
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              module TEXT NOT NULL CHECK(module IN
                ('company_certificate','personal_certificate','research_output')),
              section TEXT NOT NULL CHECK(section IN ('certificate','achievement','academic')),
              name TEXT NOT NULL,
              category TEXT NOT NULL DEFAULT '',
              remarks TEXT NOT NULL DEFAULT '',
              tags TEXT NOT NULL DEFAULT '',
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)));
            CREATE INDEX IF NOT EXISTS idx_business_archives_scope
              ON business_archives(workspace,section,deleted,category);
            CREATE TABLE IF NOT EXISTS company_certificate_order(
              archive_id INTEGER PRIMARY KEY,
              position INTEGER NOT NULL,
              FOREIGN KEY(archive_id) REFERENCES business_archives(id));
            """;
        cmd.ExecuteNonQuery();
    }
    public static List<ArchiveView> List(SqliteConnection db,string workspace,string section)
    {
        var list=new List<ArchiveView>();
        string module=Module(workspace,section) ?? throw new ArgumentException("无效的资料模块。");
        using var cmd=db.CreateCommand();
        cmd.CommandText = workspace=="company"&&section=="certificate" ? """
            SELECT a.id,a.workspace,a.section,a.name,a.category,a.remarks,a.tags
            FROM business_archives a
            LEFT JOIN company_certificate_order o ON o.archive_id=a.id
            WHERE a.workspace=$workspace AND a.section=$section AND a.module=$module AND a.deleted=0
            ORDER BY CASE WHEN o.position IS NULL THEN 1 ELSE 0 END,
                     o.position ASC,a.id DESC;
            """ : """
            SELECT id,workspace,section,name,category,remarks,tags
            FROM business_archives
            WHERE workspace=$workspace AND section=$section AND module=$module AND deleted=0
            ORDER BY id DESC;
            """;
        cmd.Parameters.AddWithValue("$workspace",workspace);
        cmd.Parameters.AddWithValue("$section",section);
        cmd.Parameters.AddWithValue("$module",module);
        using var r=cmd.ExecuteReader();
        while(r.Read())list.Add(new ArchiveView(r.GetInt64(0),r.GetString(1),r.GetString(2),
            r.GetString(3),r.GetString(4),r.GetString(5),r.GetString(6)));
        return list;
    }

    // Persist only the ordering of existing, non-deleted company certificate records.
    // An exact ID permutation prevents stale clients from silently hiding or moving records.
    public static bool ReorderCompanyCertificates(SqliteConnection db,long[]? ids)
    {
        if(ids is null)return false;
        using var tx=db.BeginTransaction();
        var current=new List<long>();
        using(var query=db.CreateCommand())
        {
            query.Transaction=tx;
            query.CommandText="""
                SELECT id FROM business_archives
                WHERE workspace='company' AND section='certificate'
                  AND module='company_certificate' AND deleted=0
                ORDER BY id DESC;
                """;
            using var reader=query.ExecuteReader();
            while(reader.Read())current.Add(reader.GetInt64(0));
        }
        if(ids.Length!=current.Count || ids.Distinct().Count()!=ids.Length ||
           !ids.OrderBy(x=>x).SequenceEqual(current.OrderBy(x=>x)))return false;

        using(var clear=db.CreateCommand())
        {
            clear.Transaction=tx;
            clear.CommandText="DELETE FROM company_certificate_order;";
            clear.ExecuteNonQuery();
        }
        using(var insert=db.CreateCommand())
        {
            insert.Transaction=tx;
            insert.CommandText="INSERT INTO company_certificate_order(archive_id,position) VALUES($id,$position);";
            var idParam=insert.Parameters.Add("$id",SqliteType.Integer);
            var posParam=insert.Parameters.Add("$position",SqliteType.Integer);
            for(var i=0;i<ids.Length;i++)
            {
                idParam.Value=ids[i];
                posParam.Value=i;
                insert.ExecuteNonQuery();
            }
        }
        tx.Commit();
        return true;
    }

    private static void AddData(SqliteCommand cmd,ArchiveInput x)
    {
        cmd.Parameters.AddWithValue("$name",Clean(x.Name));
        cmd.Parameters.AddWithValue("$category",Clean(x.Category));
        cmd.Parameters.AddWithValue("$remarks",Clean(x.Remarks));
        cmd.Parameters.AddWithValue("$tags",Clean(x.Tags));
    }
    public static long Add(SqliteConnection db,string workspace,string section,ArchiveInput x)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO business_archives(workspace,module,section,name,category,remarks,tags)
            VALUES($workspace,$module,$section,$name,$category,$remarks,$tags);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$workspace",workspace);
        cmd.Parameters.AddWithValue("$module",Module(workspace,section)!);
        cmd.Parameters.AddWithValue("$section",section);
        AddData(cmd,x);
        return (long)cmd.ExecuteScalar()!;
    }
    public static bool Update(SqliteConnection db,string workspace,string section,long id,ArchiveInput x)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText = """
            UPDATE business_archives SET name=$name,category=$category,remarks=$remarks,tags=$tags
            WHERE id=$id AND workspace=$workspace AND module=$module
                AND section=$section AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$id",id);
        cmd.Parameters.AddWithValue("$workspace",workspace);
        cmd.Parameters.AddWithValue("$module",Module(workspace,section)!);
        cmd.Parameters.AddWithValue("$section",section);
        AddData(cmd,x);
        return cmd.ExecuteNonQuery()==1;
    }
    public static bool Delete(SqliteConnection db,string workspace,string section,long id)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText = """
            UPDATE business_archives SET deleted=1
            WHERE id=$id AND workspace=$workspace AND module=$module
                AND section=$section AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$id",id);
        cmd.Parameters.AddWithValue("$workspace",workspace);
        cmd.Parameters.AddWithValue("$module",Module(workspace,section)!);
        cmd.Parameters.AddWithValue("$section",section);
        return cmd.ExecuteNonQuery()==1;
    }
    public static long? Transfer(SqliteConnection db,string workspace,string section,long id,
        string targetWorkspace,string targetSection,bool move)
    {
        var sourceModule=Module(workspace,section);
        var targetModule=Module(targetWorkspace,targetSection);
        // Corporate certificates must not be silently retyped as personal credentials.
        if(sourceModule is null||targetModule!=sourceModule)
            throw new ArgumentException("目标类别与当前资料类型不兼容。");
        using var tx=db.BeginTransaction();
        long? newId=null;
        using(var cmd=db.CreateCommand())
        {
            cmd.Transaction=tx;
            cmd.CommandText = """
                INSERT INTO business_archives(workspace,module,section,name,category,remarks,tags)
                SELECT $toWorkspace,$module,$toSection,name,category,remarks,tags
                FROM business_archives
                WHERE id=$id AND workspace=$workspace AND module=$module
                    AND section=$section AND deleted=0;
                SELECT CASE WHEN changes()=1 THEN last_insert_rowid() ELSE NULL END;
                """;
            cmd.Parameters.AddWithValue("$toWorkspace",targetWorkspace);
            cmd.Parameters.AddWithValue("$toSection",targetSection);
            cmd.Parameters.AddWithValue("$workspace",workspace);
            cmd.Parameters.AddWithValue("$section",section);
            cmd.Parameters.AddWithValue("$module",sourceModule);
            cmd.Parameters.AddWithValue("$id",id);
            if(cmd.ExecuteScalar() is long n)newId=n;
        }
        if(!newId.HasValue)return null;
        BusinessFileStore.CloneLinks(db,tx,workspace,"archive",id,section,
            targetWorkspace,"archive",newId.Value,targetSection);
        if(move)
        {
            using var cmd=db.CreateCommand();
            cmd.Transaction=tx;
            cmd.CommandText = """
                UPDATE business_archives SET deleted=1
                WHERE id=$id AND workspace=$workspace AND module=$module
                    AND section=$section AND deleted=0;
                """;
            cmd.Parameters.AddWithValue("$id",id);
            cmd.Parameters.AddWithValue("$workspace",workspace);
            cmd.Parameters.AddWithValue("$module",sourceModule);
            cmd.Parameters.AddWithValue("$section",section);
            if(cmd.ExecuteNonQuery()!=1)throw new IOException("源资料已变化，转移取消。");
        }
        tx.Commit();
        return newId;
    }
}
