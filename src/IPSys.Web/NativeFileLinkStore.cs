using Microsoft.Data.Sqlite;

record NativeFileLinkInput(long FolderId,string? DisplayName=null,string? MaterialCategory=null);
record NativeFolderFileLink(long Id,long FileId,long FolderId,string FileName,
    string? DisplayName,string? MaterialCategory,int Position,bool Deleted,
    int? LatestVersion,long? Size,string? Sha256);

// N3-02: one stable FileId can appear in many folders of the same workspace.
// Unlinking is a tombstone on one link; it never removes file history or bytes.
static class NativeFileLinkStore
{
    private static void Scope(string workspace)
    {
        if(!Vault.WorkspaceValid(workspace))
            throw new ArgumentException("工作区无效。");
    }
    private static void Bind(SqliteCommand cmd,string workspace,long id)
    {
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$id",id);
    }
    private static string? Optional(string? text,int max,string label)
    {
        if(text is null)return null;
        text=text.Trim();
        if(text.Length>max || text.Any(char.IsControl))
            throw new ArgumentException(label+"格式不正确。");
        return text.Length==0?null:text;
    }
    private static List<NativeFolderFileLink> Read(SqliteCommand cmd)
    {
        var result=new List<NativeFolderFileLink>();
        using var rd=cmd.ExecuteReader();
        while(rd.Read())
            result.Add(new(rd.GetInt64(0),rd.GetInt64(1),rd.GetInt64(2),
                rd.GetString(3),rd.IsDBNull(4)?null:rd.GetString(4),
                rd.IsDBNull(5)?null:rd.GetString(5),rd.GetInt32(6),
                rd.GetInt32(7)!=0,rd.IsDBNull(8)?null:rd.GetInt32(8),
                rd.IsDBNull(9)?null:rd.GetInt64(9),
                rd.IsDBNull(10)?null:rd.GetString(10)));
        return result;
    }
    private const string LinkProjection="""
        SELECT l.id,l.file_id,l.folder_id,f.name,l.display_name,
               l.material_category,l.position,l.deleted,
               v.version,o.size,o.sha256
        FROM folder_file_links l
        JOIN files f ON f.id=l.file_id AND f.workspace=l.workspace AND f.deleted=0
        LEFT JOIN file_versions v ON v.file_id=l.file_id AND v.workspace=l.workspace
          AND v.deleted=0 AND v.version=(SELECT MAX(x.version) FROM file_versions x
              WHERE x.file_id=l.file_id AND x.workspace=l.workspace AND x.deleted=0)
        LEFT JOIN file_objects o ON o.id=v.object_id AND o.workspace=v.workspace
          AND o.state='ready'
        """;
    private static bool ActiveLinkExists(SqliteConnection db,string workspace,
        long folderId,long fileId)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT count(*) FROM folder_file_links
            WHERE workspace=$w AND folder_id=$folder AND file_id=$file AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$folder",folderId);
        cmd.Parameters.AddWithValue("$file",fileId);
        return (long)cmd.ExecuteScalar()!>0;
    }
    private static (long FolderId,long FileId,bool Deleted)? FindLink(
        SqliteConnection db,string workspace,long fileId,long linkId)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT folder_id,file_id,deleted FROM folder_file_links
            WHERE id=$id AND file_id=$file AND workspace=$w;
            """;
        Bind(cmd,workspace,linkId);
        cmd.Parameters.AddWithValue("$file",fileId);
        using var rd=cmd.ExecuteReader();
        return rd.Read()?(rd.GetInt64(0),rd.GetInt64(1),rd.GetInt32(2)!=0):null;
    }
    private static bool FileExists(SqliteConnection db,string workspace,long fileId)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="SELECT count(*) FROM files WHERE id=$id AND workspace=$w AND deleted=0;";
        Bind(cmd,workspace,fileId);
        return (long)cmd.ExecuteScalar()! == 1;
    }
    public static long Add(SqliteConnection db,string workspace,long fileId,
        NativeFileLinkInput input)
    {
        Scope(workspace);
        if(input.FolderId<=0 || fileId<=0)
            throw new ArgumentException("文件和文件夹 ID 必须为正数。");
        string? display=Optional(input.DisplayName,240,"位置显示名");
        string? category=Optional(input.MaterialCategory,120,"材料类别");
        // Only an already-accessible file can gain another association.
        // Once every link is removed, use the explicit restore operation instead.
        if(!NativeFileStore.Accessible(db,workspace,fileId) ||
           !NativeFileStore.FolderActive(db,workspace,input.FolderId))
            throw new KeyNotFoundException("文件或目标文件夹不存在。");
        if(ActiveLinkExists(db,workspace,input.FolderId,fileId))
            throw new InvalidOperationException("此文件已关联目标文件夹。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            INSERT INTO folder_file_links(workspace,folder_id,file_id,
                display_name,material_category,position)
            VALUES($w,$folder,$file,$display,$category,
                (SELECT COALESCE(MAX(position),-1)+1
                 FROM folder_file_links WHERE workspace=$w AND folder_id=$folder AND deleted=0));
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$folder",input.FolderId);
        cmd.Parameters.AddWithValue("$file",fileId);
        cmd.Parameters.AddWithValue("$display",(object?)display??DBNull.Value);
        cmd.Parameters.AddWithValue("$category",(object?)category??DBNull.Value);
        return (long)cmd.ExecuteScalar()!;
    }
    public static bool Unlink(SqliteConnection db,string workspace,long fileId,long linkId)
    {
        Scope(workspace);
        var row=FindLink(db,workspace,fileId,linkId);
        if(row is null || !NativeFileStore.FolderActive(db,workspace,row.Value.FolderId))
            return false;
        if(row.Value.Deleted)throw new InvalidOperationException("关联已解除。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            UPDATE folder_file_links SET deleted=1
            WHERE id=$id AND file_id=$file AND workspace=$w AND deleted=0;
            """;
        Bind(cmd,workspace,linkId);
        cmd.Parameters.AddWithValue("$file",fileId);
        return cmd.ExecuteNonQuery()==1;
    }
    public static bool Restore(SqliteConnection db,string workspace,long fileId,long linkId)
    {
        Scope(workspace);
        var row=FindLink(db,workspace,fileId,linkId);
        if(row is null)return false;
        if(!row.Value.Deleted)
            throw new InvalidOperationException("文件关联尚未解除。");
        if(!FileExists(db,workspace,fileId) ||
           !NativeFileStore.FolderActive(db,workspace,row.Value.FolderId))
            throw new InvalidOperationException("原文件或所属文件夹不可恢复访问。");
        if(ActiveLinkExists(db,workspace,row.Value.FolderId,fileId))
            throw new InvalidOperationException("该文件夹已有有效的同一文件关联。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            UPDATE folder_file_links SET deleted=0
            WHERE id=$id AND file_id=$file AND workspace=$w AND deleted=1;
            """;
        Bind(cmd,workspace,linkId);
        cmd.Parameters.AddWithValue("$file",fileId);
        return cmd.ExecuteNonQuery()==1;
    }
    public static IReadOnlyList<NativeFolderFileLink>? ListFolder(SqliteConnection db,
        string workspace,long folderId,bool includeDeleted)
    {
        Scope(workspace);
        if(!NativeFileStore.FolderActive(db,workspace,folderId))return null;
        using var cmd=db.CreateCommand();
        cmd.CommandText=LinkProjection+"\n"+"""
            WHERE l.workspace=$w AND l.folder_id=$id
              AND (l.deleted=0 OR $include=1)
            ORDER BY l.position,l.id;
            """;
        Bind(cmd,workspace,folderId);
        cmd.Parameters.AddWithValue("$include",includeDeleted?1:0);
        return Read(cmd);
    }
    public static IReadOnlyList<NativeFolderFileLink>? ListFile(SqliteConnection db,
        string workspace,long fileId)
    {
        Scope(workspace);
        if(!NativeFileStore.Accessible(db,workspace,fileId))return null;
        using var cmd=db.CreateCommand();
        cmd.CommandText=LinkProjection+"\n"+"""
            WHERE l.workspace=$w AND l.file_id=$id AND l.deleted=0
            ORDER BY l.folder_id,l.position,l.id;
            """;
        Bind(cmd,workspace,fileId);
        // A parent folder can be soft-deleted while its link remains active.
        // Never reveal that location until all ancestors are active again.
        return Read(cmd).Where(x=>NativeFileStore.FolderActive(db,workspace,x.FolderId)).ToList();
    }
}
