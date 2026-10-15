using Microsoft.Data.Sqlite;

// R1-04-01: one read-only navigation layer above the six legacy Folder Providers.
// Module roots are virtual; no new SQL table and no versions on folders.
static class FolderBrowserService
{
    private static IReadOnlyList<FolderDescriptor> Rows(
        SqliteConnection db, string workspace, string kind, string? section = null, ResourceRef? parent = null)
    {
        var provider = BusinessFolderProviders.Resolve(kind)
            ?? throw new ArgumentException("无效的文件夹类型。");
        return provider.List(db, workspace)
            .Select(x => x.Folder)
            .Where(x => (section is null || x.Ref.Section == section) && x.Parent == parent)
            .ToArray();
    }

    private static IReadOnlyList<FolderDescriptor> Indexed(IEnumerable<FolderDescriptor> folders) =>
        folders.Select((folder, index) => folder with { Position = index }).ToArray();

    public static FolderSnapshot? Detail(SqliteConnection db, ResourceRef reference)
    {
        if (!reference.IsValid) throw new ArgumentException("无效的文件夹引用。");
        var provider = BusinessFolderProviders.Resolve(reference.Kind)
            ?? throw new ArgumentException("无效的文件夹类型。");
        return provider.Get(db, reference);
    }

    public static IReadOnlyList<FolderDescriptor> Children(SqliteConnection db,
        string workspace, string scope, string section, ResourceRef? parent)
    {
        BusinessFolderProviders.CheckWorkspace(workspace);
        if (parent is ResourceRef p && (!p.IsValid || p.Workspace != workspace))
            throw new ArgumentException("上级文件夹不属于当前工作区。");

        switch (scope)
        {
            case FolderKinds.Project when section.Length == 0:
                if (parent is null) return Indexed(Rows(db, workspace, FolderKinds.Project));
                if (parent.Value.Kind != FolderKinds.Project || parent.Value.Section.Length != 0)
                    throw new ArgumentException("只有项目可以包含合同文件夹。");
                if (Detail(db, parent.Value) is null) throw new KeyNotFoundException("项目不存在。");
                return Indexed(Rows(db, workspace, FolderKinds.Contract, parent: parent));

            case FolderKinds.Ip when section.Length == 0:
                if (parent is not null) throw new ArgumentException("知识产权不支持任意子目录。");
                return Indexed(Rows(db, workspace, FolderKinds.Ip));

            case FolderKinds.General when section.Length == 0:
                if (parent is not null) throw new ArgumentException("综合资料不支持任意子目录。");
                return Indexed(Rows(db, workspace, FolderKinds.General));

            case FolderKinds.Archive:
                if (ArchiveStore.Module(workspace, section) is null)
                    throw new ArgumentException("当前工作区没有该资料类别。");
                if (workspace != "company" || section != "achievement")
                {
                    if (parent is not null) throw new ArgumentException("此资料类别不支持下级分类。");
                    return Indexed(Rows(db, workspace, FolderKinds.Archive, section));
                }
                if (parent is ResourceRef category)
                {
                    if (category.Kind != FolderKinds.ArchiveFolder || category.Section != "achievement")
                        throw new ArgumentException("业务档案的上级必须是业务档案分类。");
                    if (Detail(db, category) is null)
                        throw new KeyNotFoundException("上级业务档案目录不存在。");
                }
                var folders = Rows(db, workspace, FolderKinds.ArchiveFolder, "achievement", parent);
                var records = Rows(db, workspace, FolderKinds.Archive, "achievement", parent);
                return OrderArchive(db, parent?.Id ?? 0, folders.Concat(records));

            default:
                throw new ArgumentException("无效的文件夹模块或资料类别。");
        }
    }

    private static IReadOnlyList<FolderDescriptor> OrderArchive(SqliteConnection db, long parentId,
        IEnumerable<FolderDescriptor> children)
    {
        // Existing mixed archive-entry order is authoritative when present. New/unordered
        // entries are appended deterministically, with no "folders first" rule.
        string key = parentId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var stored = ArchiveEntryOrderStore.Orders(db);
        var ranks = new Dictionary<(string Kind, long Id), int>();
        if (stored.TryGetValue(key, out var items))
            for (int i = 0; i < items.Count; i++)
                ranks[(items[i].Kind, items[i].Id)] = i;
        return Indexed(children.OrderBy(x =>
                ranks.ContainsKey((x.Ref.Kind == FolderKinds.ArchiveFolder ? "folder" : "record", x.Ref.Id))
                    ? 0 : 1)
            .ThenBy(x => ranks.TryGetValue(
                    (x.Ref.Kind == FolderKinds.ArchiveFolder ? "folder" : "record", x.Ref.Id),
                    out int rank) ? rank : int.MaxValue)
            .ThenBy(x => x.Position)
            .ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase));
    }
}
