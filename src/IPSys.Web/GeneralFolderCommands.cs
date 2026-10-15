using Microsoft.Data.Sqlite;

// R1-04-02-03: the old general-record APIs and new Folder API must share
// exactly one SQL implementation; attachment/chunk tables remain untouched.
static class GeneralFolderCommands
{
    public static string? Validate(TitleInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title)) return "名称不能为空。";
        if (input.Title.Length > 300) return "名称不能超过 300 字。";
        return null;
    }

    public static long Create(SqliteConnection db, string workspace, TitleInput input)
    {
        if (Validate(input) is string error) throw new ArgumentException(error);
        BusinessFolderProviders.CheckWorkspace(workspace);
        using var cmd=db.CreateCommand();
        cmd.CommandText="INSERT INTO records(workspace,title) VALUES($w,$n); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$n",input.Title!.Trim());
        return (long)cmd.ExecuteScalar()!;
    }

    public static bool Update(SqliteConnection db, ResourceRef reference, TitleInput input)
    {
        if (reference.Kind!=FolderKinds.General || !reference.IsValid)
            throw new ArgumentException("综合资料文件夹引用无效。");
        if (Validate(input) is string error) throw new ArgumentException(error);
        using var cmd=db.CreateCommand();
        cmd.CommandText="UPDATE records SET title=$title WHERE id=$id AND workspace=$workspace AND deleted=0;";
        cmd.Parameters.AddWithValue("$title",input.Title!.Trim());
        cmd.Parameters.AddWithValue("$id",reference.Id);
        cmd.Parameters.AddWithValue("$workspace",reference.Workspace);
        return cmd.ExecuteNonQuery()==1;
    }

    public static bool Delete(SqliteConnection db, ResourceRef reference)
    {
        if (reference.Kind!=FolderKinds.General || !reference.IsValid)
            throw new ArgumentException("综合资料文件夹引用无效。");
        using var cmd=db.CreateCommand();
        cmd.CommandText="UPDATE records SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;";
        cmd.Parameters.AddWithValue("$id",reference.Id);
        cmd.Parameters.AddWithValue("$w",reference.Workspace);
        return cmd.ExecuteNonQuery()==1;
    }
}
