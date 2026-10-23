using System.Text.Json;
using Microsoft.Data.Sqlite;

// N2-02: business archives, archive directories and general records use ONLY folders.
static class NativeArchiveStore
{
    public static bool Handles(string kind) =>
        kind is FolderKinds.ArchiveFolder or FolderKinds.Archive or FolderKinds.General;

    private static string Section(string workspace,string kind,string? section)
    {
        if(!Vault.WorkspaceValid(workspace))throw new ArgumentException("无效的工作区。");
        if(kind==FolderKinds.ArchiveFolder)
        {
            if(workspace!="company" || section is not (null or "" or "achievement"))
                throw new ArgumentException("业务档案目录仅属于公司业务档案。");
            return "achievement";
        }
        if(kind==FolderKinds.General)
        {
            if(!string.IsNullOrEmpty(section))throw new ArgumentException("综合资料没有分段。");
            return "";
        }
        if(kind==FolderKinds.Archive && ArchiveRules.Module(workspace,section??"")!=null)
            return section!;
        throw new ArgumentException("当前工作区不支持该资料类别。");
    }

    private static (string Name,string Json,long? Parent,string Section) Prepare(
        string workspace,string kind,FolderMutationInput input,bool creating,string? section)
    {
        if(input.Project is not null || input.Contract is not null || input.Ip is not null ||
           input.ParentId is not null)
            throw new ArgumentException("资料的业务类型或父级参数不匹配。");
        string scope=Section(workspace,kind,creating?input.Section:section);
        if(!creating && input.Section is not null && input.Section!=scope)
            throw new ArgumentException("修改资料属性不能改变资料类型。");

        switch(kind)
        {
            case FolderKinds.ArchiveFolder when input.ArchiveFolder is not null &&
                input.Archive is null && input.General is null:
                var folder=input.ArchiveFolder;
                string folderName=folder.Name?.Trim()??"";
                if(folderName.Length is 0 or >120)
                    throw new ArgumentException("目录名称必填，最多120字。");
                if(folder.ParentId is <=0)
                    throw new ArgumentException("无效的上级目录。");
                return (folderName,JsonSerializer.Serialize(new ArchiveFolderInput(
                    folderName,folder.ParentId)),folder.ParentId,scope);

            case FolderKinds.Archive when input.Archive is not null &&
                input.ArchiveFolder is null && input.General is null:
                var archive=input.Archive;
                if(ArchiveRules.Validate(archive) is string error)
                    throw new ArgumentException(error);
                if(scope=="achievement" && workspace=="company")
                {
                    if(archive.FolderId is not >0)
                        throw new ArgumentException("公司业务档案资料必须指定有效目录。");
                }
                else if(archive.FolderId is not null)
                    throw new ArgumentException("该资料类型不能指定业务档案目录。");
                archive=archive with {Name=archive.Name!.Trim()};
                return (archive.Name!,JsonSerializer.Serialize(archive),
                    archive.FolderId,scope);

            case FolderKinds.General when input.General is not null &&
                input.Archive is null && input.ArchiveFolder is null:
                if(GeneralRules.Validate(input.General) is string bad)
                    throw new ArgumentException(bad);
                string title=input.General.Title!.Trim();
                return (title,JsonSerializer.Serialize(new TitleInput(title)),null,scope);
            default:
                throw new ArgumentException("文件夹类型和业务属性不匹配。");
        }
    }

    private static bool ActiveDirectory(SqliteConnection db,long id)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT count(*) FROM folders
            WHERE id=$id AND workspace='company' AND kind='archive_folder'
              AND section='achievement' AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$id",id);
        return (long)cmd.ExecuteScalar()! ==1;
    }

    private static long? Parent(SqliteConnection db,ResourceRef r,bool includeDeleted=false)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT parent_id FROM folders
            WHERE id=$id AND workspace=$w AND kind=$kind AND section=$section
              AND ($deleted=1 OR deleted=0);
            """;
        Bind(cmd,r);
        cmd.Parameters.AddWithValue("$deleted",includeDeleted?1:0);
        using var rd=cmd.ExecuteReader();
        if(!rd.Read())throw new KeyNotFoundException("资料或目录不存在。");
        return rd.IsDBNull(0)?null:rd.GetInt64(0);
    }

    private static void Bind(SqliteCommand cmd,ResourceRef r)
    {
        cmd.Parameters.AddWithValue("$id",r.Id);
        cmd.Parameters.AddWithValue("$w",r.Workspace);
        cmd.Parameters.AddWithValue("$kind",r.Kind);
        cmd.Parameters.AddWithValue("$section",r.Section);
    }

    public static long Create(SqliteConnection db,string workspace,string kind,FolderMutationInput input)
    {
        if(!Handles(kind))throw new ArgumentException("不支持的资料类型。");
        var data=Prepare(workspace,kind,input,true,null);
        if(data.Parent is long parent && !ActiveDirectory(db,parent))
            throw new KeyNotFoundException("上级业务档案目录不存在。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            INSERT INTO folders(workspace,kind,section,parent_id,name,attributes_json,position)
            VALUES($w,$kind,$section,$parent,$name,$json,
             (SELECT COALESCE(MAX(position),-1)+1 FROM folders
              WHERE workspace=$w AND section=$section AND deleted=0
                AND COALESCE(parent_id,0)=COALESCE($parent,0)
                AND (kind=$kind OR ($section='achievement' AND $w='company'
                    AND kind IN ('archive','archive_folder')))));
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$kind",kind);
        cmd.Parameters.AddWithValue("$section",data.Section);
        cmd.Parameters.AddWithValue("$parent",(object?)data.Parent??DBNull.Value);
        cmd.Parameters.AddWithValue("$name",data.Name);
        cmd.Parameters.AddWithValue("$json",data.Json);
        return (long)cmd.ExecuteScalar()!;
    }

    public static bool Update(SqliteConnection db,ResourceRef r,FolderMutationInput input)
    {
        if(!r.IsValid || !Handles(r.Kind))
            throw new ArgumentException("资料引用无效。");
        long? current;
        try{current=Parent(db,r);}
        catch(KeyNotFoundException){return false;}
        if(r.Kind==FolderKinds.Archive && input.Archive is ArchiveInput archive)
        {
            var existing=Get(db,r)?.BusinessData as ArchiveInput;
            input=input with {Archive=archive with {
                FolderId=archive.FolderId??current,
                Year=archive.Year??existing?.Year
            }};
        }
        var data=Prepare(r.Workspace,r.Kind,input,false,r.Section);
        if(data.Parent.HasValue && data.Parent!=current)
            throw new ArgumentException("更换父级必须使用单独的移动操作。");
        // Omitted parent in an edit means "retain"; for directories explicit
        // null cannot clear a parent except via the separate move API.
        if(r.Kind==FolderKinds.ArchiveFolder && input.ArchiveFolder!.ParentId!=current)
            throw new ArgumentException("更换目录父级请使用移动操作。");
        if(r.Kind==FolderKinds.Archive && data.Parent.HasValue && data.Parent!=current)
            throw new ArgumentException("更换资料所属目录请使用移动操作。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            UPDATE folders SET name=$name,attributes_json=$json
            WHERE id=$id AND workspace=$w AND kind=$kind AND section=$section
              AND deleted=0;
            """;
        Bind(cmd,r);
        cmd.Parameters.AddWithValue("$name",data.Name);
        cmd.Parameters.AddWithValue("$json",data.Json);
        return cmd.ExecuteNonQuery()==1;
    }

    public static bool SetDeleted(SqliteConnection db,ResourceRef r,bool deleted)
    {
        if(!r.IsValid || !Handles(r.Kind))
            throw new ArgumentException("资料引用无效。");
        if(r.Kind==FolderKinds.ArchiveFolder)
        {
            if(!deleted)throw new ArgumentException("目录直接删除，不支持回收站恢复。");
            using var cmd=db.CreateCommand();
            cmd.CommandText="""
                DELETE FROM folders WHERE id=$id AND workspace=$w
                AND kind='archive_folder' AND section='achievement'
                AND NOT EXISTS(SELECT 1 FROM folders c WHERE c.parent_id=folders.id)
                AND NOT EXISTS(SELECT 1 FROM folder_file_links l WHERE l.folder_id=folders.id);
                """;
            Bind(cmd,r);
            if(cmd.ExecuteNonQuery()==1)return true;
            if(Get(db,r) is null)return false;
            throw new InvalidOperationException("目录内有下级资料或附件，不能删除非空目录。");
        }
        using var update=db.CreateCommand();
        update.CommandText="""
            UPDATE folders SET deleted=$next WHERE id=$id AND workspace=$w
            AND kind=$kind AND section=$section AND deleted=$old
            AND (parent_id IS NULL OR EXISTS(
               SELECT 1 FROM folders p WHERE p.id=folders.parent_id
                 AND p.workspace=folders.workspace AND p.deleted=0));
            """;
        Bind(update,r);
        update.Parameters.AddWithValue("$next",deleted?1:0);
        update.Parameters.AddWithValue("$old",deleted?0:1);
        return update.ExecuteNonQuery()==1;
    }

    public static FolderSnapshot? Get(SqliteConnection db,ResourceRef r)
    {
        if(!r.IsValid || !Handles(r.Kind))
            throw new ArgumentException("资料引用无效。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,workspace,kind,section,name,parent_id,position,attributes_json
            FROM folders f WHERE id=$id AND workspace=$w AND kind=$kind
              AND section=$section AND deleted=0 AND (parent_id IS NULL OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=f.parent_id
                AND p.workspace=f.workspace AND p.deleted=0));
            """;
        Bind(cmd,r);
        using var rd=cmd.ExecuteReader();
        return rd.Read()?Read(rd):null;
    }

    private static FolderSnapshot Read(SqliteDataReader rd)
    {
        string w=rd.GetString(1),kind=rd.GetString(2),section=rd.GetString(3);
        long id=rd.GetInt64(0);
        long? parent=rd.IsDBNull(5)?null:rd.GetInt64(5);
        string name=rd.GetString(4);
        object metadata=kind switch
        {
            FolderKinds.ArchiveFolder => new ArchiveFolderInput(name,parent),
            FolderKinds.Archive => JsonSerializer.Deserialize<ArchiveInput>(rd.GetString(7))
                ?? throw new InvalidDataException("档案资料属性无效。"),
            FolderKinds.General => JsonSerializer.Deserialize<TitleInput>(rd.GetString(7))
                ?? throw new InvalidDataException("综合资料属性无效。"),
            _ => throw new InvalidDataException("不支持的业务类型。")
        };
        return new FolderSnapshot(new FolderDescriptor(
            ResourceRef.Create(w,kind,id,section),name,
            parent is long p ? ResourceRef.Create(w,FolderKinds.ArchiveFolder,p,"achievement"):null,
            rd.GetInt32(6)),metadata);
    }

    public static IReadOnlyList<FolderSnapshot> List(SqliteConnection db,
        string workspace,string kind,string? section,long? parentId=null)
    {
        if(!Handles(kind))throw new ArgumentException("不支持的资料类型。");
        string scope=Section(workspace,kind,section);
        if(parentId is <=0)throw new ArgumentException("无效上级目录。");
        if(parentId.HasValue && (kind==FolderKinds.General ||
           (kind==FolderKinds.Archive && (workspace!="company"||scope!="achievement"))))
            throw new ArgumentException("该资料类别不支持下级分类。");
        if(parentId is long parent && !ActiveDirectory(db,parent))
            throw new KeyNotFoundException("上级业务档案目录不存在。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,workspace,kind,section,name,parent_id,position,attributes_json
            FROM folders WHERE workspace=$w AND kind=$kind AND section=$section
              AND deleted=0 AND (
                 ($kind='archive_folder' AND COALESCE(parent_id,0)=COALESCE($parent,0))
                 OR ($kind='archive' AND ($parent IS NULL OR parent_id=$parent))
                 OR ($kind='general' AND parent_id IS NULL))
              AND (parent_id IS NULL OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=folders.parent_id
                AND p.workspace=folders.workspace AND p.deleted=0))
            ORDER BY position,id;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$kind",kind);
        cmd.Parameters.AddWithValue("$section",scope);
        cmd.Parameters.AddWithValue("$parent",(object?)parentId??DBNull.Value);
        var rows=new List<FolderSnapshot>();
        using var rd=cmd.ExecuteReader();
        while(rd.Read())rows.Add(Read(rd));
        return rows;
    }
}
