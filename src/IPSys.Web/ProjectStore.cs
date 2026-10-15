using Microsoft.Data.Sqlite;

record ProjectInput(string? Name, string? ProjectType, string? ProjectNo, string? Leader,
    string? UndertakingOrg, string? StartDate, string? EndDate, string? ProjectStatus,
    string? Category, string? Remarks, string? Tags);
record ProjectTransfer(string TargetWorkspace, bool Move);
record ProjectView(long Id, string Workspace, string Name, string ProjectType, string ProjectNo,
    string Leader, string UndertakingOrg, string StartDate, string EndDate, string ProjectStatus,
    string Category, string Remarks, string Tags);

static class ProjectStore
{
    private static readonly string[] Types = ["科研项目", "横向项目", "其他项目"];
    private static readonly string[] Statuses = ["筹备中", "进行中", "已完成", "已终止"];
    public static void Ensure(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS business_projects(
              id INTEGER PRIMARY KEY, workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              name TEXT NOT NULL, project_type TEXT NOT NULL, project_no TEXT NOT NULL DEFAULT '',
              leader TEXT NOT NULL DEFAULT '', undertaking_org TEXT NOT NULL DEFAULT '',
              start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '',
              project_status TEXT NOT NULL DEFAULT '筹备中', category TEXT NOT NULL DEFAULT '',
              remarks TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)));
            CREATE INDEX IF NOT EXISTS idx_business_projects_scope
              ON business_projects(workspace,deleted,project_type);
            """;
        cmd.ExecuteNonQuery();
    }
    private static string Text(string? s) => s?.Trim() ?? "";
    public static string? Check(ProjectInput x)
    {
        if (Text(x.Name).Length is 0 or > 300) return "项目名称必须填写，最多 300 字。";
        if (!Types.Contains(Text(x.ProjectType))) return "请选择科研项目、横向项目或其他项目。";
        if (Text(x.ProjectStatus).Length > 0 && !Statuses.Contains(Text(x.ProjectStatus)))
            return "项目状态无效。";
        foreach (var s in new[] {x.ProjectNo,x.Leader,x.UndertakingOrg,x.StartDate,x.EndDate,x.Category,x.Remarks,x.Tags})
            if (Text(s).Length > 4000) return "项目字段内容过长。";
        foreach (var date in new[] {Text(x.StartDate),Text(x.EndDate)})
            if (date.Length != 0 && (!DateOnly.TryParseExact(date, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsed) ||
                parsed.ToString("yyyy-MM-dd") != date)) return "日期格式必须是 yyyy-MM-dd。";
        return null;
    }
    private static void Params(SqliteCommand cmd, ProjectInput x)
    {
        cmd.Parameters.AddWithValue("$name", Text(x.Name));
        cmd.Parameters.AddWithValue("$type", Text(x.ProjectType));
        cmd.Parameters.AddWithValue("$no", Text(x.ProjectNo));
        cmd.Parameters.AddWithValue("$leader", Text(x.Leader));
        cmd.Parameters.AddWithValue("$org", Text(x.UndertakingOrg));
        cmd.Parameters.AddWithValue("$start", Text(x.StartDate));
        cmd.Parameters.AddWithValue("$end", Text(x.EndDate));
        cmd.Parameters.AddWithValue("$status", Text(x.ProjectStatus) is var st && st.Length > 0 ? st : "筹备中");
        cmd.Parameters.AddWithValue("$category", Text(x.Category));
        cmd.Parameters.AddWithValue("$remarks", Text(x.Remarks));
        cmd.Parameters.AddWithValue("$tags", Text(x.Tags));
    }
    private const string Fields = "name,project_type,project_no,leader,undertaking_org,start_date,end_date,project_status,category,remarks,tags";
    private const string Values = "$name,$type,$no,$leader,$org,$start,$end,$status,$category,$remarks,$tags";
    public static long Insert(SqliteConnection db, string workspace, ProjectInput x)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = "INSERT INTO business_projects(workspace," + Fields + ") VALUES($w," + Values + "); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$w", workspace);
        Params(cmd,x);
        return (long)cmd.ExecuteScalar()!;
    }
    public static bool Update(SqliteConnection db, string workspace, long id, ProjectInput x)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            UPDATE business_projects SET name=$name,project_type=$type,project_no=$no,
            leader=$leader,undertaking_org=$org,start_date=$start,end_date=$end,
            project_status=$status,category=$category,remarks=$remarks,tags=$tags
            WHERE id=$id AND workspace=$w AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$id",id);cmd.Parameters.AddWithValue("$w",workspace);Params(cmd,x);
        return cmd.ExecuteNonQuery()==1;
    }
    public static bool Delete(SqliteConnection db,string workspace,long id)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="UPDATE business_projects SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;";
        cmd.Parameters.AddWithValue("$id",id);cmd.Parameters.AddWithValue("$w",workspace);
        return cmd.ExecuteNonQuery()==1;
    }
    public static List<ProjectView> List(SqliteConnection db,string workspace)
    {
        var list=new List<ProjectView>();
        using var cmd=db.CreateCommand();
        cmd.CommandText="SELECT id,workspace,"+Fields+" FROM business_projects WHERE workspace=$w AND deleted=0 ORDER BY id DESC;";
        cmd.Parameters.AddWithValue("$w",workspace);
        using var reader=cmd.ExecuteReader();
        while(reader.Read()) list.Add(new ProjectView(reader.GetInt64(0),reader.GetString(1),
            reader.GetString(2),reader.GetString(3),reader.GetString(4),reader.GetString(5),
            reader.GetString(6),reader.GetString(7),reader.GetString(8),reader.GetString(9),
            reader.GetString(10),reader.GetString(11),reader.GetString(12)));
        return list;
    }
    public static long? Transfer(SqliteConnection db,string workspace,long id,string target,bool move)
    {
        using var lookup=db.CreateCommand();
        lookup.CommandText="SELECT "+Fields+" FROM business_projects WHERE id=$id AND workspace=$w AND deleted=0;";
        lookup.Parameters.AddWithValue("$id",id);lookup.Parameters.AddWithValue("$w",workspace);
        using var reader=lookup.ExecuteReader();
        if(!reader.Read())return null;
        var values=Enumerable.Range(0,11).Select(reader.GetString).ToArray();
        reader.Close();
        var input=new ProjectInput(values[0],values[1],values[2],values[3],values[4],
            values[5],values[6],values[7],values[8],values[9],values[10]);
        using var tx=db.BeginTransaction();
        long newId;
        using(var insert=db.CreateCommand())
        {
            insert.Transaction=tx;
            insert.CommandText="INSERT INTO business_projects(workspace,"+Fields+") VALUES($w,"+Values+"); SELECT last_insert_rowid();";
            insert.Parameters.AddWithValue("$w",target);Params(insert,input);
            newId=(long)insert.ExecuteScalar()!;
        }
        ContractStore.CopyChildren(db,tx,workspace,id,target,newId);
        BusinessFileStore.CloneLinks(db,tx,workspace,"project",id,"",
            target,"project",newId,"");
        if(move)
        {
            using var delete=db.CreateCommand();delete.Transaction=tx;
            delete.CommandText="UPDATE business_projects SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;";
            delete.Parameters.AddWithValue("$id",id);delete.Parameters.AddWithValue("$w",workspace);
            if(delete.ExecuteNonQuery()!=1)throw new IOException("源项目已发生变化，转移取消。");
        }
        tx.Commit();return newId;
    }
}
