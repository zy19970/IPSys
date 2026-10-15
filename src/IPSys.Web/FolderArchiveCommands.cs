using Microsoft.Data.Sqlite;

// R1-04-02-02: keep archive-folder parent changes for the separate move operation.
// Archive record metadata edits also cannot silently switch their owning directory.
static class FolderArchiveCommands
{
    public static bool UpdateFolder(SqliteConnection db, ResourceRef reference,
        ArchiveFolderInput input)
    {
        if (reference.Workspace != "company" || reference.Section != "achievement")
            throw new ArgumentException("业务档案目录仅属于公司业务档案。");
        var current = ArchiveFolderStore.List(db).FirstOrDefault(x => x.Id == reference.Id);
        if (current is null) return false;
        if (current.ParentId != input.ParentId)
            throw new ArgumentException("调整文件夹父级请使用移动操作。");
        return ArchiveFolderStore.Update(db, reference.Id, input);
    }

    public static bool UpdateArchive(SqliteConnection db, ResourceRef reference,
        ArchiveInput input)
    {
        if (ArchiveStore.Module(reference.Workspace, reference.Section) is null)
            throw new ArgumentException("工作区中不存在该资料类别。");
        var current = ArchiveStore.List(db, reference.Workspace, reference.Section)
            .FirstOrDefault(x => x.Id == reference.Id);
        if (current is null) return false;
        if (input.FolderId.HasValue &&
            (reference.Workspace != "company" || reference.Section != "achievement" ||
             input.FolderId != current.FolderId))
            throw new ArgumentException("调整资料所属目录请使用移动操作。");
        return ArchiveStore.Update(db, reference.Workspace, reference.Section,
            reference.Id, input);
    }
}
