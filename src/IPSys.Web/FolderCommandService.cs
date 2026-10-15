using Microsoft.Data.Sqlite;

// R1-04-02 (first batch): typed common commands reuse the proven, scoped
// legacy business stores. Folder metadata has no version chain.
record FolderMutationInput(
    ProjectInput? Project = null,
    ContractInput? Contract = null,
    IpInput? Ip = null,
    long? ParentId = null);

static class FolderCommandService
{
    public static bool Supported(string kind) =>
        kind is FolderKinds.Project or FolderKinds.Contract or FolderKinds.Ip;

    private static void CheckInput(string kind, FolderMutationInput input, bool creating)
    {
        if (!Supported(kind)) throw new ArgumentException("此类型的公共写入操作尚未接入。");
        bool correct = kind switch
        {
            FolderKinds.Project => input.Project is not null &&
                input.Contract is null && input.Ip is null && input.ParentId is null,
            FolderKinds.Contract => input.Contract is not null &&
                input.Project is null && input.Ip is null &&
                (creating ? input.ParentId is > 0 : input.ParentId is null),
            FolderKinds.Ip => input.Ip is not null &&
                input.Project is null && input.Contract is null && input.ParentId is null,
            _ => false
        };
        if (!correct)
            throw new ArgumentException("文件夹类型、业务属性或父级不匹配；合同只能在有效项目下创建，编辑不能转移父级。");
        string? error = kind switch
        {
            FolderKinds.Project => ProjectStore.Check(input.Project!),
            FolderKinds.Contract => ContractStore.Validate(input.Contract!),
            FolderKinds.Ip => IpStore.Validate(input.Ip!),
            _ => "无效的文件夹类型。"
        };
        if (error is not null) throw new ArgumentException(error);
    }

    public static ResourceRef Create(SqliteConnection db, string workspace,
        string kind, FolderMutationInput input)
    {
        BusinessFolderProviders.CheckWorkspace(workspace);
        CheckInput(kind, input, creating: true);
        if (kind == FolderKinds.Contract &&
            !ContractStore.ActiveProject(db, workspace, input.ParentId!.Value))
            throw new KeyNotFoundException("合同所属的项目不存在或不属于当前工作区。");

        long id = kind switch
        {
            FolderKinds.Project => ProjectStore.Insert(db, workspace, input.Project!),
            FolderKinds.Contract => ContractStore.Add(db, workspace,
                input.ParentId!.Value, input.Contract!),
            FolderKinds.Ip => IpStore.Add(db, workspace, input.Ip!),
            _ => throw new ArgumentException("无效的文件夹类型。")
        };
        return ResourceRef.Create(workspace, kind, id);
    }

    public static bool Update(SqliteConnection db, ResourceRef reference, FolderMutationInput input)
    {
        if (!reference.IsValid) throw new ArgumentException("无效的文件夹引用。");
        CheckInput(reference.Kind, input, creating: false);
        return reference.Kind switch
        {
            FolderKinds.Project => ProjectStore.Update(db, reference.Workspace, reference.Id,
                input.Project!),
            FolderKinds.Contract => ContractStore.Update(db, reference.Workspace, reference.Id,
                input.Contract!),
            FolderKinds.Ip => IpStore.Update(db, reference.Workspace, reference.Id, input.Ip!),
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
            _ => false
        };
    }

    public static bool Restore(SqliteConnection db, ResourceRef reference)
    {
        if (!reference.IsValid || !Supported(reference.Kind))
            throw new ArgumentException("无效或尚未接入恢复的文件夹类型。");
        // Same all-or-nothing recycle-bin workflow as the existing UI.
        // The recycle store rejects deleted contracts with no active parent.
        return RecycleStore.Change(db, reference.Workspace,
            [new RecycleKey(reference.Kind, reference.Id, "")], purge: false);
    }
}
