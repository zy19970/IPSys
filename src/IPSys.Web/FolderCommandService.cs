using Microsoft.Data.Sqlite;

// R1-04-02 (first batch): typed common commands reuse the proven, scoped
// legacy business stores. Folder metadata has no version chain.
record FolderMutationInput(
    ProjectInput? Project = null,
    ContractInput? Contract = null,
    IpInput? Ip = null,
    long? ParentId = null,
    ArchiveInput? Archive = null,
    ArchiveFolderInput? ArchiveFolder = null,
    string? Section = null,
    TitleInput? General = null);

static class FolderCommandService
{
    public static bool Supported(string kind) =>
        kind is FolderKinds.Project or FolderKinds.Contract or FolderKinds.Ip or
            FolderKinds.Archive or FolderKinds.ArchiveFolder or FolderKinds.General;

    private static void CheckInput(string workspace, string kind, FolderMutationInput input,
        bool creating, string? section = null)
    {
        if (!Supported(kind)) throw new ArgumentException("此类型的公共写入操作尚未接入。");
        if (kind != FolderKinds.General && input.General is not null)
            throw new ArgumentException("综合资料名称不能用于其它文件夹类型。");
        bool businessOnly = input.Project is null && input.Contract is null && input.Ip is null;
        bool archiveOnly = input.Archive is null && input.ArchiveFolder is null;
        bool correct = kind switch
        {
            FolderKinds.Project => input.Project is not null && businessOnly == false &&
                input.Contract is null && input.Ip is null && archiveOnly &&
                input.ParentId is null && input.Section is null,
            FolderKinds.Contract => input.Contract is not null && input.Project is null &&
                input.Ip is null && archiveOnly && input.Section is null &&
                (creating ? input.ParentId is > 0 : input.ParentId is null),
            FolderKinds.Ip => input.Ip is not null && input.Project is null &&
                input.Contract is null && archiveOnly &&
                input.ParentId is null && input.Section is null,
            FolderKinds.Archive => businessOnly && input.Archive is not null &&
                input.ArchiveFolder is null && input.ParentId is null &&
                ArchiveStore.Module(workspace, creating ? input.Section ?? "" : section ?? "") is not null &&
                (creating ? input.Section is not null :
                    input.Section is null || input.Section == section),
            FolderKinds.ArchiveFolder => businessOnly && input.Archive is null &&
                input.ArchiveFolder is not null && input.ParentId is null &&
                workspace == "company" &&
                (creating ? input.Section == "achievement" :
                    input.Section is null or "achievement"),
            FolderKinds.General => businessOnly && archiveOnly && input.General is not null &&
                input.ParentId is null && input.Section is null,
            _ => false
        };
        if (!correct)
            throw new ArgumentException("文件夹类型、业务属性、工作区或父级不匹配。");
        string? error = kind switch
        {
            FolderKinds.Project => ProjectStore.Check(input.Project!),
            FolderKinds.Contract => ContractStore.Validate(input.Contract!),
            FolderKinds.Ip => IpStore.Validate(input.Ip!),
            FolderKinds.Archive => ArchiveStore.Validate(input.Archive!),
            FolderKinds.General => GeneralFolderCommands.Validate(input.General!),
            _ => null
        };
        if (error is not null) throw new ArgumentException(error);
    }

    public static ResourceRef Create(SqliteConnection db, string workspace,
        string kind, FolderMutationInput input)
    {
        BusinessFolderProviders.CheckWorkspace(workspace);
        CheckInput(workspace, kind, input, creating: true);
        if (kind == FolderKinds.Contract &&
            !ContractStore.ActiveProject(db, workspace, input.ParentId!.Value))
            throw new KeyNotFoundException("合同所属的项目不存在或不属于当前工作区。");

        long id = kind switch
        {
            FolderKinds.Project => ProjectStore.Insert(db, workspace, input.Project!),
            FolderKinds.Contract => ContractStore.Add(db, workspace,
                input.ParentId!.Value, input.Contract!),
            FolderKinds.Ip => IpStore.Add(db, workspace, input.Ip!),
            FolderKinds.Archive => ArchiveStore.Add(db, workspace, input.Section!, input.Archive!),
            FolderKinds.ArchiveFolder => ArchiveFolderStore.Create(db, input.ArchiveFolder!),
            FolderKinds.General => GeneralFolderCommands.Create(db, workspace, input.General!),
            _ => throw new ArgumentException("无效的文件夹类型。")
        };
        return ResourceRef.Create(workspace, kind, id,
            kind == FolderKinds.Archive ? input.Section! :
            kind == FolderKinds.ArchiveFolder ? "achievement" : "");
    }

    public static bool Update(SqliteConnection db, ResourceRef reference, FolderMutationInput input)
    {
        if (!reference.IsValid) throw new ArgumentException("无效的文件夹引用。");
        CheckInput(reference.Workspace, reference.Kind, input, creating: false, reference.Section);
        return reference.Kind switch
        {
            FolderKinds.Project => ProjectStore.Update(db, reference.Workspace, reference.Id,
                input.Project!),
            FolderKinds.Contract => ContractStore.Update(db, reference.Workspace, reference.Id,
                input.Contract!),
            FolderKinds.Ip => IpStore.Update(db, reference.Workspace, reference.Id, input.Ip!),
            FolderKinds.Archive => FolderArchiveCommands.UpdateArchive(db, reference, input.Archive!),
            FolderKinds.ArchiveFolder => FolderArchiveCommands.UpdateFolder(db, reference, input.ArchiveFolder!),
            FolderKinds.General => GeneralFolderCommands.Update(db, reference, input.General!),
            _ => throw new ArgumentException("无效的文件夹类型。")
        };
    }

    public static bool Delete(SqliteConnection db, ResourceRef reference)
    {
        if (!reference.IsValid || !Supported(reference.Kind))
            throw new ArgumentException("无效或尚未接入写入的文件夹类型。");
        return reference.Kind switch
        {
            FolderKinds.Project => ProjectStore.Delete(db, reference.Workspace, reference.Id),
            FolderKinds.Contract => ContractStore.SoftDelete(db, reference.Workspace, reference.Id),
            FolderKinds.Ip => IpStore.Delete(db, reference.Workspace, reference.Id),
            FolderKinds.Archive => ArchiveStore.Delete(db, reference.Workspace, reference.Section, reference.Id),
            FolderKinds.ArchiveFolder => ArchiveFolderStore.DeleteEmpty(db, reference.Id),
            FolderKinds.General => GeneralFolderCommands.Delete(db, reference),
            _ => false
        };
    }

    public static bool Restore(SqliteConnection db, ResourceRef reference)
    {
        if (!reference.IsValid || !Supported(reference.Kind))
            throw new ArgumentException("无效或尚未接入恢复的文件夹类型。");
        if (reference.Kind == FolderKinds.ArchiveFolder)
            throw new ArgumentException("目录只能在为空时删除，直接删除的目录不支持回收站恢复。");
        // Same all-or-nothing recycle-bin workflow as the existing UI.
        // The recycle store rejects deleted contracts with no active parent.
        return RecycleStore.Change(db, reference.Workspace,
            [new RecycleKey(reference.Kind==FolderKinds.Ip?"legacy_ip":reference.Kind,
                reference.Id,reference.Section)], purge: false);
    }
}
