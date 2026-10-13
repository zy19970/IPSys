using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;

// Encrypted IP register. Extended optional M0 fields live in an explicit
// version-one JSON payload; fixed type/status and workspace stay queryable.
record IpInput(
    string? Name, string? IpType, string? Status,
    string? Applicants, string? RightHolders, string? Creators,
    string? ApplicationNo, string? ApplicationDate,
    string? PublicationNo, string? PublicationDate,
    string? GrantNoticeNo, string? GrantNoticeDate, string? PublicationInfo,
    string? GrantDate, string? RegistrationNo,
    string? FirstPublishedDate, string? RegistrationDate,
    string? Category, string? Remarks, string? Tags);
record IpView(long Id, string Workspace, IpInput Data);
record IpTransfer(string TargetWorkspace, bool Move);

static class IpStore
{
    private static readonly Dictionary<string, string[]> AllowedStatuses = new()
    {
        ["发明专利"] = ["准备中", "已申请", "已公开", "实质审查中", "已授权", "已失效"],
        ["实用新型专利"] = ["准备中", "已申请", "已授权", "已失效"],
        ["外观设计专利"] = ["准备中", "已申请", "已授权", "已失效"],
        ["软件著作权"] = ["准备中", "登记中", "已登记"],
        ["其他著作权"] = ["准备中", "登记中", "已登记"],
        ["商标"] = ["准备中", "申请中", "已注册", "已失效"],
        ["集成电路布图设计"] = ["准备中", "登记中", "已登记"]
    };

    private static string Clean(string? value) => value?.Trim() ?? "";
    public static IpInput Normalize(IpInput x) => x with
    {
        Name = Clean(x.Name), IpType = Clean(x.IpType), Status = Clean(x.Status)
    };
    public static string? Validate(IpInput x)
    {
        if (Clean(x.Name).Length is 0 or > 300) return "知识产权名称必填，最多 300 字。";
        if (!AllowedStatuses.TryGetValue(Clean(x.IpType), out var legal))
            return "必须选择已确认的七种知识产权类型。";
        if (Clean(x.Status).Length != 0 && !legal.Contains(Clean(x.Status)))
            return "所选状态不适用于该知识产权类型。";
        foreach (var field in new [] {x.Applicants,x.RightHolders,x.Creators,x.ApplicationNo,
            x.PublicationNo,x.GrantNoticeNo,x.PublicationInfo,x.RegistrationNo,
            x.Category,x.Remarks,x.Tags})
            if (field?.Length > 4000) return "字段内容超过可保存长度。";
        foreach (var date in new [] {x.ApplicationDate,x.PublicationDate,x.GrantNoticeDate,
            x.GrantDate,x.FirstPublishedDate,x.RegistrationDate})
        {
            if (string.IsNullOrWhiteSpace(date)) continue;
            if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out var d) || d.ToString("yyyy-MM-dd") != date)
                return "日期应填写 yyyy-MM-dd。";
        }
        return null;
    }
    public static void Ensure(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS business_ips (
              id INTEGER PRIMARY KEY,workspace TEXT NOT NULL CHECK(workspace IN('company','personal')),
              name TEXT NOT NULL,ip_type TEXT NOT NULL,status TEXT NOT NULL DEFAULT '',
              payload TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)));
            CREATE INDEX IF NOT EXISTS idx_business_ips_scope
              ON business_ips(workspace,deleted,ip_type);
            """;
        cmd.ExecuteNonQuery();
    }
    public static List<IpView> List(SqliteConnection db,string workspace)
    {
        var rows = new List<IpView>();
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT id,payload FROM business_ips WHERE workspace=$w AND deleted=0 ORDER BY id DESC;";
        cmd.Parameters.AddWithValue("$w",workspace);
        using var reader = cmd.ExecuteReader();
        while(reader.Read())
        {
            var value = JsonSerializer.Deserialize<IpInput>(reader.GetString(1))
                ?? throw new IOException("知识产权记录内容无效。");
            rows.Add(new IpView(reader.GetInt64(0),workspace,value));
        }
        return rows;
    }
    private static void AddFields(SqliteCommand cmd,IpInput x)
    {
        x=Normalize(x);
        cmd.Parameters.AddWithValue("$name",x.Name!);
        cmd.Parameters.AddWithValue("$type",x.IpType!);
        cmd.Parameters.AddWithValue("$status",x.Status!);
        cmd.Parameters.AddWithValue("$payload",JsonSerializer.Serialize(x));
    }
    public static long Add(SqliteConnection db,string workspace,IpInput input)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO business_ips(workspace,name,ip_type,status,payload)
            VALUES($w,$name,$type,$status,$payload);SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        AddFields(cmd,input);
        return (long)cmd.ExecuteScalar()!;
    }
    public static bool Update(SqliteConnection db,string workspace,long id,IpInput input)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText = """
            UPDATE business_ips SET name=$name,ip_type=$type,status=$status,payload=$payload
            WHERE id=$id AND workspace=$w AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$id",id);cmd.Parameters.AddWithValue("$w",workspace);
        AddFields(cmd,input);
        return cmd.ExecuteNonQuery()==1;
    }
    public static bool Delete(SqliteConnection db,string workspace,long id)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="UPDATE business_ips SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;";
        cmd.Parameters.AddWithValue("$id",id);cmd.Parameters.AddWithValue("$w",workspace);
        return cmd.ExecuteNonQuery()==1;
    }
    public static long? Transfer(SqliteConnection db,string workspace,long id,string target,bool move)
    {
        using var transaction=db.BeginTransaction();
        long? copied=null;
        using(var copy=db.CreateCommand())
        {
            copy.Transaction=transaction;
            copy.CommandText = """
                INSERT INTO business_ips(workspace,name,ip_type,status,payload)
                SELECT $target,name,ip_type,status,payload FROM business_ips
                WHERE id=$id AND workspace=$w AND deleted=0;
                SELECT CASE WHEN changes()=1 THEN last_insert_rowid() ELSE NULL END;
                """;
            copy.Parameters.AddWithValue("$id",id);
            copy.Parameters.AddWithValue("$w",workspace);
            copy.Parameters.AddWithValue("$target",target);
            var value=copy.ExecuteScalar();
            if(value is long n)copied=n;
        }
        if(!copied.HasValue)return null;
        if(move)
        {
            using var remove=db.CreateCommand();remove.Transaction=transaction;
            remove.CommandText = "UPDATE business_ips SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;";
            remove.Parameters.AddWithValue("$id",id);remove.Parameters.AddWithValue("$w",workspace);
            if(remove.ExecuteNonQuery()!=1)throw new IOException("源记录已变化，转移终止。");
        }
        transaction.Commit();
        return copied;
    }
}
