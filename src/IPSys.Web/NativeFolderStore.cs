using System.Text.Json;
using Microsoft.Data.Sqlite;

// N2-01: native project, contract and IP folder operations. Never writes legacy tables.
static class NativeFolderStore
{
    private static void Scope(string workspace, string kind)
    {
        if (!Vault.WorkspaceValid(workspace)) throw new ArgumentException("无效工作区。");
        if (kind is not (FolderKinds.Project or FolderKinds.Contract or FolderKinds.Ip))
            throw new ArgumentException("该业务类型尚未接入新库。");
    }

    private static (string Name,string Json) Payload(string kind, FolderMutationInput x, bool create)
    {
        if (x.Archive is not null || x.ArchiveFolder is not null ||
            x.General is not null || x.Section is not null)
            throw new ArgumentException("业务属性和文件夹类型不匹配。");
        switch (kind)
        {
            case FolderKinds.Project when x.Project is not null && x.Ip is null &&
                x.Contract is null && x.ParentId is null:
                if (ProjectStore.Check(x.Project) is string pe) throw new ArgumentException(pe);
                var p=x.Project with {Name=x.Project.Name!.Trim(),
                    ProjectType=x.Project.ProjectType!.Trim(),
                    ProjectStatus=string.IsNullOrWhiteSpace(x.Project.ProjectStatus)
                        ? "筹备中" : x.Project.ProjectStatus.Trim()};
                return (p.Name!,JsonSerializer.Serialize(p));
            case FolderKinds.Contract when x.Contract is not null && x.Project is null &&
                x.Ip is null && (create ? x.ParentId is > 0 : x.ParentId is null):
                if (ContractStore.Validate(x.Contract) is string ce) throw new ArgumentException(ce);
                var c=x.Contract with {Name=x.Contract.Name!.Trim(),
                    Amount=x.Contract.Amount?.Trim()};
                return (c.Name!,JsonSerializer.Serialize(c));
            case FolderKinds.Ip when x.Ip is not null && x.Project is null &&
                x.Contract is null && x.ParentId is null:
                if (IpStore.Validate(x.Ip) is string ie) throw new ArgumentException(ie);
                var ip=IpStore.Normalize(x.Ip);
                return (ip.Name!,JsonSerializer.Serialize(ip));
            default:
                throw new ArgumentException("文件夹业务属性或合同父级不符合要求。");
        }
    }

    private static bool ActiveProject(SqliteConnection db,string workspace,long id)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="SELECT count(*) FROM folders WHERE workspace=$w AND id=$id AND kind='project' AND deleted=0;";
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$id",id);
        return (long)cmd.ExecuteScalar()! == 1;
    }

    public static long Create(SqliteConnection db,string workspace,string kind,FolderMutationInput input)
    {
        Scope(workspace,kind);
        var (name,json)=Payload(kind,input,true);
        if(kind==FolderKinds.Contract && !ActiveProject(db,workspace,input.ParentId!.Value))
            throw new KeyNotFoundException("合同所属项目不存在。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            INSERT INTO folders(workspace,kind,parent_id,name,attributes_json)
            VALUES($w,$kind,$parent,$name,$json); SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$kind",kind);
        cmd.Parameters.AddWithValue("$parent",(object?)input.ParentId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$name",name);
        cmd.Parameters.AddWithValue("$json",json);
        return (long)cmd.ExecuteScalar()!;
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

    public static bool Update(SqliteConnection db,ResourceRef r,FolderMutationInput input)
    {
        Reference(r);
        var (name,json)=Payload(r.Kind,input,false);
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            UPDATE folders SET name=$name,attributes_json=$json
            WHERE workspace=$w AND kind=$kind AND id=$id AND deleted=0
              AND (kind!='contract' OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=folders.parent_id
                AND p.workspace=folders.workspace AND p.kind='project' AND p.deleted=0));
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
            UPDATE folders SET deleted=$next
            WHERE workspace=$w AND kind=$kind AND id=$id AND deleted=$previous
              AND (kind!='contract' OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=folders.parent_id
                AND p.workspace=folders.workspace AND p.kind='project' AND p.deleted=0));
            """;
        Bind(cmd,r);
        cmd.Parameters.AddWithValue("$next",deleted?1:0);
        cmd.Parameters.AddWithValue("$previous",deleted?0:1);
        return cmd.ExecuteNonQuery()==1;
    }

    private static FolderSnapshot Read(SqliteDataReader rd)
    {
        long id=rd.GetInt64(0);
        string w=rd.GetString(1),kind=rd.GetString(2);
        long? parent=rd.IsDBNull(4)?null:rd.GetInt64(4);
        string json=rd.GetString(6);
        object data=kind switch
        {
            FolderKinds.Project => JsonSerializer.Deserialize<ProjectInput>(json)!,
            FolderKinds.Contract => JsonSerializer.Deserialize<ContractInput>(json)!,
            FolderKinds.Ip => JsonSerializer.Deserialize<IpInput>(json)!,
            _ => throw new InvalidDataException("不支持的业务类型。")
        };
        if(data is null) throw new InvalidDataException("业务属性无效。");
        return new FolderSnapshot(new FolderDescriptor(
            ResourceRef.Create(w,kind,id),rd.GetString(3),
            parent is long p?ResourceRef.Create(w,FolderKinds.Project,p):null,
            rd.GetInt32(5)),data);
    }

    public static FolderSnapshot? Get(SqliteConnection db,ResourceRef r)
    {
        Reference(r);
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,workspace,kind,name,parent_id,position,attributes_json
            FROM folders f WHERE workspace=$w AND kind=$kind AND id=$id
            AND deleted=0 AND (kind!='contract' OR EXISTS(
              SELECT 1 FROM folders p WHERE p.id=f.parent_id
              AND p.workspace=f.workspace AND p.kind='project' AND p.deleted=0));
            """;
        Bind(cmd,r);
        using var rd=cmd.ExecuteReader();
        return rd.Read()?Read(rd):null;
    }

    public static IReadOnlyList<FolderSnapshot> List(
        SqliteConnection db,string workspace,string kind,long? projectId=null)
    {
        Scope(workspace,kind);
        if(kind!=FolderKinds.Contract && projectId is not null)
            throw new ArgumentException("只有合同可以按项目筛选。");
        if(projectId is long id && !ActiveProject(db,workspace,id))
            throw new KeyNotFoundException("项目不存在。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,workspace,kind,name,parent_id,position,attributes_json
            FROM folders f WHERE workspace=$w AND kind=$kind AND deleted=0
              AND ($parent IS NULL OR parent_id=$parent)
              AND (kind!='contract' OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=f.parent_id
                AND p.workspace=f.workspace AND p.kind='project' AND p.deleted=0))
            ORDER BY position,id;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$kind",kind);
        cmd.Parameters.AddWithValue("$parent",(object?)projectId ?? DBNull.Value);
        var result=new List<FolderSnapshot>();
        using var rd=cmd.ExecuteReader();
        while(rd.Read())result.Add(Read(rd));
        return result;
    }
}
