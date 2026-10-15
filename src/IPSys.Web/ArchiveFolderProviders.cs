using Microsoft.Data.Sqlite;

// R1-03: read-only views of existing archive folders, archive records and general records.
// Physical tables, mixed ordering, and the card/table layout remain unchanged.
sealed class ArchiveFolderProvider : IFolderProvider
{
    public string Kind => FolderKinds.ArchiveFolder;

    public IReadOnlyList<FolderSnapshot> List(SqliteConnection db, string workspace)
    {
        BusinessFolderProviders.CheckWorkspace(workspace);
        if (workspace != "company") return Array.Empty<FolderSnapshot>();
        return ArchiveFolderStore.List(db).Select(folder =>
        {
            var child = ResourceRef.Create(workspace, Kind, folder.Id, "achievement");
            ResourceRef? parent = folder.ParentId is long id
                ? ResourceRef.Create(workspace, Kind, id, "achievement") : null;
            if (!FolderTypePolicy.MandatoryParentRulesSatisfied(child, parent))
                throw new InvalidDataException("业务档案目录存在非法的父子关系。");
            return new FolderSnapshot(
                new FolderDescriptor(child, folder.Name, parent, folder.Position), folder);
        }).ToArray();
    }

    public FolderSnapshot? Get(SqliteConnection db, ResourceRef reference) =>
        BusinessFolderProviders.Find(this, db, reference);
}

sealed class ArchiveRecordProvider : IFolderProvider
{
    private static readonly string[] Sections = ["certificate", "achievement", "academic"];
    public string Kind => FolderKinds.Archive;

    public IReadOnlyList<FolderSnapshot> List(SqliteConnection db, string workspace)
    {
        BusinessFolderProviders.CheckWorkspace(workspace);
        var result = new List<FolderSnapshot>();
        HashSet<long>? validFolders = null;
        foreach (string section in Sections)
        {
            if (ArchiveStore.Module(workspace, section) is null) continue;
            if (workspace == "company" && section == "achievement")
                validFolders = ArchiveFolderStore.List(db).Select(folder => folder.Id).ToHashSet();
            int position = 0;
            foreach (var archive in ArchiveStore.List(db, workspace, section))
            {
                var child = ResourceRef.Create(workspace, Kind, archive.Id, section);
                ResourceRef? parent = null;
                if (workspace == "company" && section == "achievement" && archive.FolderId is > 0)
                {
                    long folderId = archive.FolderId.Value;
                    if (validFolders is null || !validFolders.Contains(folderId))
                        throw new InvalidDataException("业务资料所指向的父目录不存在。");
                    parent = ResourceRef.Create(workspace, FolderKinds.ArchiveFolder, folderId, "achievement");
                }
                if (!FolderTypePolicy.MandatoryParentRulesSatisfied(child, parent))
                    throw new InvalidDataException("归档资料的父子关系无效。");
                result.Add(new FolderSnapshot(
                    new FolderDescriptor(child, archive.Name, parent, position++), archive));
            }
        }
        return result;
    }

    public FolderSnapshot? Get(SqliteConnection db, ResourceRef reference) =>
        BusinessFolderProviders.Find(this, db, reference);
}

// General records have no dedicated Store.List. Read the existing records table
// without loading or mutating attachment bytes.
record GeneralFolderBusinessData(long Id, string Workspace, string Title);

sealed class GeneralFolderProvider : IFolderProvider
{
    public string Kind => FolderKinds.General;

    public IReadOnlyList<FolderSnapshot> List(SqliteConnection db, string workspace)
    {
        BusinessFolderProviders.CheckWorkspace(workspace);
        var result = new List<FolderSnapshot>();
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT id,title FROM records
            WHERE workspace=$workspace AND deleted=0 ORDER BY id DESC;
            """;
        cmd.Parameters.AddWithValue("$workspace", workspace);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            long id = reader.GetInt64(0);
            string title = reader.GetString(1);
            var data = new GeneralFolderBusinessData(id, workspace, title);
            result.Add(new FolderSnapshot(
                new FolderDescriptor(ResourceRef.Create(workspace, Kind, id),
                    title, Parent: null, Position: result.Count), data));
        }
        return result;
    }

    public FolderSnapshot? Get(SqliteConnection db, ResourceRef reference) =>
        BusinessFolderProviders.Find(this, db, reference);
}
