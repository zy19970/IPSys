using System.Text.Json;
using Microsoft.Data.Sqlite;

// N2-02: business archives, archive directories and general records use ONLY folders.
static class NativeArchiveStore
{
    public static bool Handles(string kind) =>
        kind is FolderKinds.ArchiveFolder or FolderKinds.Archive or FolderKinds.General;

    // A02/N2: one ordinary material and one ordinary folder are the same object.
    // Callers still name them "archive"/"general" (module names, kept on purpose);
    // that request vocabulary is translated here exactly once, so no new row is
    // ever written under the retired kinds and there is only one read path.
    public static ResourceRef Unify(ResourceRef r) => r.Kind switch
    {
        FolderKinds.Archive => ResourceRef.Create(r.Workspace,
            FolderKinds.ArchiveFolder,r.Id,r.Section),
        FolderKinds.General => ResourceRef.Create(r.Workspace,
            FolderKinds.ArchiveFolder,r.Id,"general"),
        _ => r
    };

    // Legacy create bodies (ArchiveInput/TitleInput) carry the same six business
    // fields as a folder, so the conversion is lossless and needs no data fixup.
    private static FolderMutationInput AsFolder(string kind,FolderMutationInput input)=>
        kind switch
        {
            FolderKinds.Archive when input.Archive is ArchiveInput a => input with {
                Archive=null,ArchiveFolder=new ArchiveFolderInput(
                    a.Name?.Trim()??"",a.FolderId,a.Category,a.Year,a.Tags,a.Remarks)},
            FolderKinds.General when input.General is TitleInput g => input with {
                General=null,Section="general",
                ArchiveFolder=new ArchiveFolderInput(
                    g.Title?.Trim()??"",input.ParentId,null,null,null,g.Remarks)},
            _ => throw new ArgumentException("文件夹类型和业务属性不匹配。")
        };

    // A copied folder keeps its own name only when the target level is free;
    // otherwise it gets the first free "名称 (n)" suffix. The sibling-name index
    // is unique per parent, so guessing a name would fail the whole transfer.
    public static string UniqueName(SqliteConnection db,SqliteTransaction tx,
        string workspace,string section,long? parent,string name)
    {
        string candidate=name;
        for(int n=2;n<=1000;n++)
        {
            using var cmd=db.CreateCommand();
            cmd.Transaction=tx;
            cmd.CommandText="""
                SELECT count(*) FROM folders WHERE workspace=$w AND section=$section
                  AND kind='archive_folder' AND deleted=0
                  AND COALESCE(parent_id,0)=COALESCE($parent,0)
                  AND name=$name COLLATE NOCASE;
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$section",section);
            cmd.Parameters.AddWithValue("$parent",(object?)parent??DBNull.Value);
            cmd.Parameters.AddWithValue("$name",candidate);
            if((long)cmd.ExecuteScalar()! ==0)return candidate;
            candidate=$"{name} ({n})";
        }
        throw new IOException("目标目录下同名资料过多，请先整理后再转移。");
    }

    private static string Section(string workspace,string kind,string? section)
    {
        if(!Vault.WorkspaceValid(workspace))throw new ArgumentException("无效的工作区。");
        if(kind==FolderKinds.ArchiveFolder)
        {
            string scope=string.IsNullOrEmpty(section)&&workspace=="company"
                ?"achievement":section??"";
            if(!ArchiveDirectoryScopes.Allowed(workspace,scope))
                throw new ArgumentException("目录与工作区或模块不匹配。");
            return scope;
        }
        if(kind==FolderKinds.General)
        {
            // "general" is the storage section of the 综合资料 module; an explicit
            // section is accepted because the folded kind carries it, but any
            // other value is still a caller error.
            if(!string.IsNullOrEmpty(section) && section!="general")
                throw new ArgumentException("综合资料没有分段。");
            return "general";
        }
        if(kind==FolderKinds.Archive && ArchiveRules.Module(workspace,section??"")!=null)
            return section!;
        throw new ArgumentException("当前工作区不支持该资料类别。");
    }

    private static (string Name,string Json,long? Parent,string Section) Prepare(
        string workspace,string kind,FolderMutationInput input,bool creating,string? section)
    {
        if(input.Project is not null || input.Contract is not null || input.Ip is not null ||
           input.ParentId is not null && kind!=FolderKinds.General &&
               input.ArchiveFolder is null)
            throw new ArgumentException("资料的业务类型或父级参数不匹配。");
        string scope=Section(workspace,kind,creating?input.Section:section);
        if(!creating && input.Section is not null && input.Section!=scope)
            throw new ArgumentException("修改资料属性不能改变资料类型。");

        switch(kind)
        {
            case FolderKinds.ArchiveFolder when input.ArchiveFolder is not null &&
                input.Archive is null && input.General is null:
                // parentId is the shared parent alias of the whole folder API, so a
                // body that only carries parentId still lands in the same place.
                var folder=input.ArchiveFolder with {
                    ParentId=input.ArchiveFolder.ParentId??input.ParentId};
                string folderName=folder.Name?.Trim()??"";
                if(folderName.Length is 0 or >120)
                    throw new ArgumentException("目录名称必填，最多120字。");
                if(folder.ParentId is <=0)
                    throw new ArgumentException("无效的上级目录。");
                string? year=string.IsNullOrWhiteSpace(folder.Year)?null:folder.Year.Trim();
                if(year is not null && (year.Length!=4 || !year.All(char.IsDigit)))
                    throw new ArgumentException("年度须为四位数字。");
                var normalized=folder with {
                    Name=folderName,Year=year,
                    Category=folder.Category?.Trim(),
                    Tags=TagRules.Normalize(folder.Tags),
                    Remarks=folder.Remarks?.Trim()
                };
                return (folderName,JsonSerializer.Serialize(normalized),folder.ParentId,scope);

            default:
                throw new ArgumentException("文件夹类型和业务属性不匹配。");
        }
    }

    private static bool ActiveDirectory(SqliteConnection db,string workspace,string scope,long id)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT count(*) FROM folders
            WHERE id=$id AND workspace=$w AND kind='archive_folder'
              AND section=$scope AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$id",id);
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$scope",scope);
        return (long)cmd.ExecuteScalar()! ==1 &&
            NativeFileStore.FolderActive(db,workspace,id);
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
        if(kind!=FolderKinds.ArchiveFolder)input=AsFolder(kind,input);
        var data=Prepare(workspace,FolderKinds.ArchiveFolder,input,true,null);
        if(data.Parent is long parent && !ActiveDirectory(db,workspace,
            data.Section,parent))
            throw new KeyNotFoundException("上级目录不存在或不属于当前模块。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            INSERT INTO folders(workspace,kind,section,parent_id,name,attributes_json,position)
            VALUES($w,'archive_folder',$section,$parent,$name,$json,
             (SELECT COALESCE(MAX(position),-1)+1 FROM folders
              WHERE workspace=$w AND kind='archive_folder' AND section=$section
                AND deleted=0 AND COALESCE(parent_id,0)=COALESCE($parent,0)));
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
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
        if(r.Kind!=FolderKinds.ArchiveFolder)input=AsFolder(r.Kind,input);
        r=Unify(r);
        long? current;
        try{current=Parent(db,r);}
        catch(KeyNotFoundException){return false;}
        // Omitted parent/year mean "retain": an edit form only ever sends the
        // business fields it shows, and must not silently unparent the folder.
        if(input.ArchiveFolder is ArchiveFolderInput folder)
        {
            var existing=Get(db,r)?.BusinessData as ArchiveFolderInput;
            input=input with {ArchiveFolder=folder with {
                ParentId=folder.ParentId??current,
                Year=folder.Year??existing?.Year
            }};
        }
        var data=Prepare(r.Workspace,r.Kind,input,false,r.Section);
        if(data.Parent.HasValue && data.Parent!=current)
            throw new ArgumentException("更换父级必须使用单独的移动操作。");
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
        // Tombstone the folder root only. Descendants and their LinkIds stay
        // intact, so restore is lossless. Physical unlinking belongs exclusively
        // to recycle purge in one rollback-safe transaction.
        r=Unify(r);
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            UPDATE folders SET deleted=$next WHERE id=$id AND workspace=$w
            AND kind=$kind AND section=$section AND deleted=$old
            AND (parent_id IS NULL OR EXISTS(
               SELECT 1 FROM folders p WHERE p.id=folders.parent_id
                 AND p.workspace=folders.workspace AND p.deleted=0));
            """;
        Bind(cmd,r);
        cmd.Parameters.AddWithValue("$next",deleted?1:0);
        cmd.Parameters.AddWithValue("$old",deleted?0:1);
        return cmd.ExecuteNonQuery()==1;
    }

    public static FolderSnapshot? Get(SqliteConnection db,ResourceRef r)
    {
        if(!r.IsValid || !Handles(r.Kind))
            throw new ArgumentException("资料引用无效。");
        r=Unify(r);
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,workspace,kind,section,name,parent_id,position,attributes_json,modified_at,created_at
            FROM folders f WHERE id=$id AND workspace=$w AND kind=$kind
              AND section=$section AND deleted=0 AND (parent_id IS NULL OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=f.parent_id
                AND p.workspace=f.workspace AND p.deleted=0));
            """;
        Bind(cmd,r);
        FolderSnapshot? found;
        using(var rd=cmd.ExecuteReader())
            found=rd.Read()?Read(rd):null;
        return found is not null &&
            NativeFileStore.FolderActive(db,r.Workspace,found.Folder.Ref.Id)
                ?found:null;
    }

    private static FolderSnapshot Read(SqliteDataReader rd)
    {
        string w=rd.GetString(1),kind=rd.GetString(2),section=rd.GetString(3);
        long id=rd.GetInt64(0);
        long? parent=rd.IsDBNull(5)?null:rd.GetInt64(5);
        string name=rd.GetString(4);
        object metadata=kind switch
        {
            FolderKinds.ArchiveFolder => (JsonSerializer.Deserialize<ArchiveFolderInput>(rd.GetString(7))
                ?? new ArchiveFolderInput(name,parent)) with {Name=name,ParentId=parent},
            FolderKinds.Archive => JsonSerializer.Deserialize<ArchiveInput>(rd.GetString(7))
                ?? throw new InvalidDataException("档案资料属性无效。"),
            FolderKinds.General => JsonSerializer.Deserialize<TitleInput>(rd.GetString(7))
                ?? throw new InvalidDataException("综合资料属性无效。"),
            _ => throw new InvalidDataException("不支持的业务类型。")
        };
        return new FolderSnapshot(new FolderDescriptor(
            ResourceRef.Create(w,kind,id,section),name,
            parent is long p ? ResourceRef.Create(w,FolderKinds.ArchiveFolder,p,
                ArchiveDirectoryScopes.ForRecord(kind,section)):null,
            rd.GetInt32(6),ModifiedAt:rd.IsDBNull(8)?null:rd.GetString(8),
            CreatedAt:rd.IsDBNull(9)?null:rd.GetString(9)),metadata);
    }

    public static IReadOnlyList<FolderSnapshot> List(SqliteConnection db,
        string workspace,string kind,string? section,long? parentId=null)
    {
        if(!Handles(kind))throw new ArgumentException("不支持的资料类型。");
        string scope=Section(workspace,kind,section);
        if(parentId is <=0)throw new ArgumentException("无效上级目录。");
        if(parentId is long parent && !ActiveDirectory(db,workspace,scope,parent))
            throw new KeyNotFoundException("上级目录不存在或不属于当前模块。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,workspace,kind,section,name,parent_id,position,attributes_json,modified_at,created_at
            FROM folders WHERE workspace=$w AND kind='archive_folder' AND section=$section
              AND deleted=0 AND COALESCE(parent_id,0)=COALESCE($parent,0)
              AND (parent_id IS NULL OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=folders.parent_id
                AND p.workspace=folders.workspace AND p.deleted=0))
            ORDER BY position,id;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$section",scope);
        cmd.Parameters.AddWithValue("$parent",(object?)parentId??DBNull.Value);
        var rows=new List<FolderSnapshot>();
        using(var rd=cmd.ExecuteReader())
            while(rd.Read())rows.Add(Read(rd));
        return rows.Where(x=>NativeFileStore.FolderActive(db,workspace,x.Folder.Ref.Id))
            .ToArray();
    }

    // Flat, active-only listing of every ordinary material in one module scope.
    // Excel export and search need the whole subtree, while List() intentionally
    // answers "what is directly under this parent" for the browser.
    public static IReadOnlyList<FolderSnapshot> ListAll(SqliteConnection db,
        string workspace,string section)
    {
        if(!Vault.WorkspaceValid(workspace) ||
           !ArchiveDirectoryScopes.Allowed(workspace,section))
            throw new ArgumentException("目录与工作区或模块不匹配。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,workspace,kind,section,name,parent_id,position,attributes_json,modified_at,created_at
            FROM folders WHERE workspace=$w AND kind='archive_folder' AND section=$section
              AND deleted=0 AND (parent_id IS NULL OR EXISTS(
                SELECT 1 FROM folders p WHERE p.id=folders.parent_id
                AND p.workspace=folders.workspace AND p.deleted=0))
            ORDER BY position,id;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$section",section);
        var rows=new List<FolderSnapshot>();
        using(var rd=cmd.ExecuteReader())
            while(rd.Read())rows.Add(Read(rd));
        return rows.Where(x=>NativeFileStore.FolderActive(db,workspace,x.Folder.Ref.Id))
            .ToArray();
    }
}
