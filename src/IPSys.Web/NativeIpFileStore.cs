using Microsoft.Data.Sqlite;

// N2-03-02: bind every IP attachment operation to an active V2 IP FolderId.
// The underlying V2 FileId/version remains shareable, but the typed IP route
// cannot inspect or modify it unless it has an active link to this IP.
static class NativeIpFileStore
{
    public static bool IpActive(SqliteConnection db,string workspace,long ipId)
    {
        if(!Vault.WorkspaceValid(workspace)||ipId<=0)return false;
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT COUNT(*) FROM folders
            WHERE workspace=$w AND id=$id AND kind='ip' AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$id",ipId);
        return (long)cmd.ExecuteScalar()! == 1 &&
            NativeFileStore.FolderActive(db,workspace,ipId);
    }
    public static bool Linked(SqliteConnection db,string workspace,long ipId,long fileId)
    {
        if(!IpActive(db,workspace,ipId)||fileId<=0)return false;
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT COUNT(*) FROM folder_file_links l
            JOIN files f ON f.id=l.file_id AND f.workspace=l.workspace
            WHERE l.workspace=$w AND l.folder_id=$folder AND l.file_id=$file
              AND l.deleted=0 AND f.deleted=0;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$folder",ipId);
        cmd.Parameters.AddWithValue("$file",fileId);
        return (long)cmd.ExecuteScalar()! == 1;
    }
    public static bool OwnedLink(SqliteConnection db,string workspace,long ipId,
        long fileId,long linkId)
    {
        if(!IpActive(db,workspace,ipId)||fileId<=0||linkId<=0)return false;
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT COUNT(*) FROM folder_file_links
            WHERE workspace=$w AND folder_id=$folder AND file_id=$file AND id=$link;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$folder",ipId);
        cmd.Parameters.AddWithValue("$file",fileId);
        cmd.Parameters.AddWithValue("$link",linkId);
        return (long)cmd.ExecuteScalar()! == 1;
    }
}
