using System.Text.Json;
using Microsoft.Data.Sqlite;

// Project and IP business records; nested project folders use NativeArchiveStore.
static class NativeFolderStore
{
    private static void Scope(string workspace,string kind)
    {
        if(!Vault.WorkspaceValid(workspace))throw new ArgumentException("无效工作区。");
        if(kind is not (FolderKinds.Project or FolderKinds.Ip))
            throw new ArgumentException("业务类型不受支持；合同资料请使用项目内普通文件夹。");
    }
    private static (string Name,string Json) Payload(string kind,FolderMutationInput x)
    {
        if(x.ArchiveFolder is not null || x.Section is not null || x.ParentId is not null)
            throw new ArgumentException("业务属性与文件夹类型不匹配。");
        switch(kind)
        {
            case FolderKinds.Project when x.Project is not null && x.Ip is null:
                if(ProjectRules.Check(x.Project) is string pe)throw new ArgumentException(pe);
                var project=x.Project with {
                    Name=x.Project.Name!.Trim(), ProjectType=x.Project.ProjectType!.Trim(),
                    ProjectStatus=string.IsNullOrWhiteSpace(x.Project.ProjectStatus)
                        ?"筹备中":x.Project.ProjectStatus.Trim(),
                    Tags=TagRules.Normalize(x.Project.Tags)
                };
                return (project.Name!,JsonSerializer.Serialize(project));
            case FolderKinds.Ip when x.Ip is not null && x.Project is null:
                if(IpRules.Validate(x.Ip) is string ie)throw new ArgumentException(ie);
                var ip=IpRules.Normalize(x.Ip) with {Tags=TagRules.Normalize(x.Ip.Tags)};
                return (ip.Name!,JsonSerializer.Serialize(ip));
            default:throw new ArgumentException("业务属性与文件夹类型不匹配或缺少字段。");
        }
    }
    private static void Reference(ResourceRef r)
    {
        if(!r.IsValid || r.Section.Length!=0)throw new ArgumentException("无效文件夹引用。");
        Scope(r.Workspace,r.Kind);
    }
    private static void Bind(SqliteCommand cmd,ResourceRef r)
    {
        cmd.Parameters.AddWithValue("$w",r.Workspace);
        cmd.Parameters.AddWithValue("$kind",r.Kind);
        cmd.Parameters.AddWithValue("$id",r.Id);
    }
    public static long Create(SqliteConnection db,string workspace,string kind,FolderMutationInput input)
    {
        Scope(workspace,kind);
        var (name,json)=Payload(kind,input);
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            INSERT INTO folders(workspace,kind,name,attributes_json)
            VALUES($w,$kind,$name,$json);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$kind",kind);
        cmd.Parameters.AddWithValue("$name",name);
        cmd.Parameters.AddWithValue("$json",json);
        return (long)cmd.ExecuteScalar()!;
    }
    public static bool Update(SqliteConnection db,ResourceRef r,FolderMutationInput input)
    {
        Reference(r);
        var (name,json)=Payload(r.Kind,input);
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            UPDATE folders SET name=$name,attributes_json=$json
            WHERE workspace=$w AND kind=$kind AND id=$id AND deleted=0;
            """;
        Bind(cmd,r);
        cmd.Parameters.AddWithValue("$name",name);
        cmd.Parameters.AddWithValue("$json",json);
        return cmd.ExecuteNonQuery()==1;
    }
    public static bool SetDeleted(SqliteConnection db,ResourceRef r,bool deleted)
    {
        Reference(r);
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            UPDATE folders SET deleted=$next WHERE workspace=$w AND kind=$kind
              AND id=$id AND deleted=$previous;
            """;
        Bind(cmd,r);
        cmd.Parameters.AddWithValue("$next",deleted?1:0);
        cmd.Parameters.AddWithValue("$previous",deleted?0:1);
        return cmd.ExecuteNonQuery()==1;
    }
    private static FolderSnapshot Read(SqliteDataReader rd)
    {
        long id=rd.GetInt64(0);
        string workspace=rd.GetString(1),kind=rd.GetString(2);
        object data=kind switch
        {
            FolderKinds.Project=>JsonSerializer.Deserialize<ProjectInput>(rd.GetString(6))!,
            FolderKinds.Ip=>JsonSerializer.Deserialize<IpInput>(rd.GetString(6))!,
            _=>throw new InvalidDataException("不支持的业务类型。")
        };
        return new FolderSnapshot(new FolderDescriptor(
            ResourceRef.Create(workspace,kind,id),rd.GetString(3),null,
            rd.GetInt32(5),ModifiedAt:rd.IsDBNull(7)?null:rd.GetString(7)),data);
    }
    public static FolderSnapshot? Get(SqliteConnection db,ResourceRef r)
    {
        Reference(r);
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,workspace,kind,name,parent_id,position,attributes_json,modified_at
            FROM folders WHERE workspace=$w AND kind=$kind AND id=$id AND deleted=0;
            """;
        Bind(cmd,r);
        using var reader=cmd.ExecuteReader();
        return reader.Read()?Read(reader):null;
    }
    public static IReadOnlyList<FolderSnapshot> List(
        SqliteConnection db,string workspace,string kind,long? projectId=null)
    {
        Scope(workspace,kind);
        if(projectId is not null)throw new ArgumentException("此记录不支持项目父级筛选。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,workspace,kind,name,parent_id,position,attributes_json,modified_at
            FROM folders WHERE workspace=$w AND kind=$kind AND deleted=0
            ORDER BY position,id;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$kind",kind);
        var rows=new List<FolderSnapshot>();
        using var reader=cmd.ExecuteReader();
        while(reader.Read())rows.Add(Read(reader));
        return rows;
    }
}
