using Microsoft.Data.Sqlite;

// Company business archive folders. Folder nodes and archive records are separate:
// one node can contain both subfolders and records at arbitrary depth.
record ArchiveFolderView(long Id,long? ParentId,string Name,int Position);
record ArchiveFolderInput(string Name,long? ParentId);
static class ArchiveFolderStore
{
    private static readonly string[] Defaults = {
        "申报与认定","规划与管理","汇报与宣传","会议与活动",
        "专项工作与合作","政策与行业资料","其他业务资料"
    };
    private static string Clean(string? name) => name?.Trim() ?? "";
    private static string RequiredName(string? name)
    {
        string value=Clean(name);
        if(value.Length is 0 or > 120)throw new InvalidOperationException("目录名称必填，最多120字。");
        return value;
    }
    public static void Ensure(SqliteConnection db)
    {
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                CREATE TABLE IF NOT EXISTS archive_folders(
                  id INTEGER PRIMARY KEY,
                  parent_id INTEGER REFERENCES archive_folders(id) ON DELETE RESTRICT,
                  name TEXT NOT NULL,
                  position INTEGER NOT NULL DEFAULT 0);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_folder_unique
                  ON archive_folders(COALESCE(parent_id,0),name COLLATE NOCASE);
                CREATE INDEX IF NOT EXISTS idx_archive_folder_parent ON archive_folders(parent_id,position,id);
                """;
            cmd.ExecuteNonQuery();
        }
        bool hasColumn=false;
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="PRAGMA table_info(business_archives);";
            using var r=cmd.ExecuteReader();
            while(r.Read())if(r.GetString(1)=="folder_id")hasColumn=true;
        }
        if(!hasColumn)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="ALTER TABLE business_archives ADD COLUMN folder_id INTEGER;";
            cmd.ExecuteNonQuery();
        }
        using var tx=db.BeginTransaction();
        foreach(string name in Defaults)EnsureRoot(db,tx,name);
        var legacy=new List<string>();
        using(var query=db.CreateCommand())
        {
            query.Transaction=tx;
            query.CommandText="""
                SELECT DISTINCT COALESCE(NULLIF(TRIM(category),''),'未分类')
                FROM business_archives WHERE workspace='company'
                  AND section='achievement' AND folder_id IS NULL;
                """;
            using var reader=query.ExecuteReader();
            while(reader.Read())legacy.Add(reader.GetString(0));
        }
        foreach(string name in legacy)EnsureRoot(db,tx,name);
        // Assign only legacy NULL rows. Explicit folder_id=0 is a valid root record.
        using(var update=db.CreateCommand())
        {
            update.Transaction=tx;
            update.CommandText="""
                UPDATE business_archives SET folder_id=(
                  SELECT f.id FROM archive_folders f WHERE f.parent_id IS NULL
                    AND f.name=COALESCE(NULLIF(TRIM(business_archives.category),''),'未分类')
                        COLLATE NOCASE)
                WHERE workspace='company' AND section='achievement' AND folder_id IS NULL;
                """;
            update.ExecuteNonQuery();
        }
        tx.Commit();
    }
    private static long EnsureRoot(SqliteConnection db,SqliteTransaction? tx,string name)
    {
        name=Clean(name);
        // Existing category labels can be longer than newly-entered folder names.
        // Migration must preserve them rather than reject a legacy encrypted vault.
        if(name.Length==0)name="未分类";
        using var select=db.CreateCommand();
        select.Transaction=tx;
        select.CommandText="SELECT id FROM archive_folders WHERE parent_id IS NULL AND name=$name COLLATE NOCASE;";
        select.Parameters.AddWithValue("$name",name);
        if(select.ExecuteScalar() is long old)return old;
        using var insert=db.CreateCommand();
        insert.Transaction=tx;
        insert.CommandText="""
            INSERT INTO archive_folders(parent_id,name,position)
            VALUES(NULL,$name,(SELECT COALESCE(MAX(position),-1)+1
                                FROM archive_folders WHERE parent_id IS NULL));
            SELECT last_insert_rowid();
            """;
        insert.Parameters.AddWithValue("$name",name);
        return (long)insert.ExecuteScalar()!;
    }
    public static long DefaultRoot(SqliteConnection db,string? category) =>
        EnsureRoot(db,null, string.IsNullOrWhiteSpace(category)?"未分类":category.Trim());
    public static List<ArchiveFolderView> List(SqliteConnection db)
    {
        var result=new List<ArchiveFolderView>();
        using var cmd=db.CreateCommand();
        cmd.CommandText="SELECT id,parent_id,name,position FROM archive_folders ORDER BY position,id;";
        using var r=cmd.ExecuteReader();
        while(r.Read())result.Add(new ArchiveFolderView(r.GetInt64(0),r.IsDBNull(1)?null:r.GetInt64(1),
            r.GetString(2),r.GetInt32(3)));
        return result;
    }
    private static ArchiveFolderView? Get(SqliteConnection db,long id,SqliteTransaction? tx=null)
    {
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="SELECT id,parent_id,name,position FROM archive_folders WHERE id=$id;";
        cmd.Parameters.AddWithValue("$id",id);
        using var r=cmd.ExecuteReader();
        return r.Read()?new ArchiveFolderView(r.GetInt64(0),r.IsDBNull(1)?null:r.GetInt64(1),
            r.GetString(2),r.GetInt32(3)):null;
    }
    public static bool Valid(SqliteConnection db,long id)=>id==0||id>0&&Get(db,id)!=null;
    public static string RootName(SqliteConnection db,long id)
    {
        if(id==0)return "";
        var visited=new HashSet<long>();
        ArchiveFolderView? node=Get(db,id);
        if(node is null)throw new InvalidOperationException("所选目录不存在，请刷新。");
        while(node.ParentId is long parent)
        {
            if(!visited.Add(node.Id))throw new InvalidOperationException("目录层级存在循环。");
            node=Get(db,parent)??throw new InvalidOperationException("目录上级已不存在。");
        }
        return node.Name;
    }
    private static void ValidateParent(SqliteConnection db,long? parent,SqliteTransaction? tx=null)
    {
        if(parent.HasValue && (parent<=0||Get(db,parent.Value,tx)==null))
            throw new InvalidOperationException("上级目录不存在，请刷新。");
    }
    private static void CheckSibling(SqliteConnection db,SqliteTransaction? tx,long? parent,string name,long exclude=0)
    {
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="""
            SELECT count(*) FROM archive_folders
            WHERE COALESCE(parent_id,0)=COALESCE($parent,0)
              AND name=$name COLLATE NOCASE AND id<>$exclude;
            """;
        cmd.Parameters.AddWithValue("$parent",parent is long id?id:DBNull.Value);
        cmd.Parameters.AddWithValue("$name",name);
        cmd.Parameters.AddWithValue("$exclude",exclude);
        if((long)cmd.ExecuteScalar()!>0)throw new InvalidOperationException("同级已经存在相同名称的目录。");
    }
    private static long CreateCore(SqliteConnection db,SqliteTransaction tx,string name,long? parent)
    {
        name=RequiredName(name);
        ValidateParent(db,parent,tx);
        CheckSibling(db,tx,parent,name);
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="""
            INSERT INTO archive_folders(parent_id,name,position)
            VALUES($parent,$name,(SELECT COALESCE(MAX(position),-1)+1
              FROM archive_folders WHERE COALESCE(parent_id,0)=COALESCE($parent,0)));
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$parent",parent is long id?id:DBNull.Value);
        cmd.Parameters.AddWithValue("$name",name);
        return (long)cmd.ExecuteScalar()!;
    }
    public static long Create(SqliteConnection db,ArchiveFolderInput input)
    {
        using var tx=db.BeginTransaction();
        var id=CreateCore(db,tx,input.Name,input.ParentId);
        tx.Commit();
        return id;
    }
    public static bool Update(SqliteConnection db,long id,ArchiveFolderInput input)
    {
        using var tx=db.BeginTransaction();
        var folder=Get(db,id,tx);
        if(folder is null)return false;
        string name=RequiredName(input.Name);
        if(folder.ParentId is null && Defaults.Contains(folder.Name) &&
           (input.ParentId is not null || !string.Equals(folder.Name,name,StringComparison.Ordinal)))
            throw new InvalidOperationException("预设根分类不能更名或移走。");
        ValidateParent(db,input.ParentId,tx);
        if(input.ParentId==id)throw new InvalidOperationException("不能将目录移到自身下面。");
        var visited=new HashSet<long>{id};
        var cursor=input.ParentId;
        while(cursor is long parent)
        {
            if(!visited.Add(parent))throw new InvalidOperationException("不能将目录移到自己的子目录中。");
            cursor=Get(db,parent,tx)?.ParentId;
        }
        CheckSibling(db,tx,input.ParentId,name,id);
        using var update=db.CreateCommand();
        update.Transaction=tx;
        update.CommandText="UPDATE archive_folders SET parent_id=$parent,name=$name WHERE id=$id;";
        update.Parameters.AddWithValue("$parent",input.ParentId is long p?p:DBNull.Value);
        update.Parameters.AddWithValue("$name",name);
        update.Parameters.AddWithValue("$id",id);
        update.ExecuteNonQuery();
        // Recompute the legacy top-category label for all records below this subtree.
        // Folder IDs and attachment ownership stay immutable.
        var descendants=new List<long>{id};
        for(int i=0;i<descendants.Count;i++)
        {
            using var children=db.CreateCommand();
            children.Transaction=tx;
            children.CommandText="SELECT id FROM archive_folders WHERE parent_id=$parent;";
            children.Parameters.AddWithValue("$parent",descendants[i]);
            using var r=children.ExecuteReader();
            while(r.Read())descendants.Add(r.GetInt64(0));
        }
        long root=id;
        var ancestor=input.ParentId;
        while(ancestor is long parent)
        {
            root=parent;
            ancestor=Get(db,parent,tx)?.ParentId;
        }
        string rootName=Get(db,root,tx)!.Name;
        using var recordUpdate=db.CreateCommand();
        recordUpdate.Transaction=tx;
        recordUpdate.CommandText="UPDATE business_archives SET category=$category WHERE workspace='company' AND section='achievement' AND folder_id=$folder;";
        recordUpdate.Parameters.AddWithValue("$category",rootName);
        var prm=recordUpdate.Parameters.Add("$folder",SqliteType.Integer);
        foreach(long member in descendants){prm.Value=member;recordUpdate.ExecuteNonQuery();}
        tx.Commit();
        return true;
    }
    public static bool DeleteEmpty(SqliteConnection db,long id)
    {
        using var tx=db.BeginTransaction();
        var folder=Get(db,id,tx);
        if(folder is null)return false;
        if(folder.ParentId is null && Defaults.Contains(folder.Name))
            throw new InvalidOperationException("系统预设的根分类不能删除。");
        using var check=db.CreateCommand();
        check.Transaction=tx;
        check.CommandText="""
            SELECT (SELECT count(*) FROM archive_folders WHERE parent_id=$id)+
                   (SELECT count(*) FROM business_archives
                     WHERE workspace='company' AND section='achievement' AND folder_id=$id);
            """;
        check.Parameters.AddWithValue("$id",id);
        if((long)check.ExecuteScalar()!>0)
            throw new InvalidOperationException("目录含下级目录或资料，需先转移内容后才能删除。");
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="DELETE FROM archive_folders WHERE id=$id;";
        cmd.Parameters.AddWithValue("$id",id);
        bool removed=cmd.ExecuteNonQuery()==1;
        tx.Commit();
        return removed;
    }
    public static long ExpandRecord(SqliteConnection db,long recordId)
    {
        using var tx=db.BeginTransaction();
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="""
            SELECT name,folder_id FROM business_archives
            WHERE id=$id AND workspace='company' AND section='achievement' AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$id",recordId);
        string name;
        long? parent;
        using(var reader=cmd.ExecuteReader())
        {
            if(!reader.Read())throw new InvalidOperationException("资料记录不存在。");
            name=reader.GetString(0);
            parent=reader.IsDBNull(1)?null:reader.GetInt64(1);
        }
        if(parent==0)parent=null;
        long folderId=CreateCore(db,tx,name,parent);
        using var move=db.CreateCommand();
        move.Transaction=tx;
        move.CommandText="UPDATE business_archives SET folder_id=$folder WHERE id=$id;";
        move.Parameters.AddWithValue("$folder",folderId);
        move.Parameters.AddWithValue("$id",recordId);
        move.ExecuteNonQuery();
        tx.Commit();
        return folderId;
    }
}