using Microsoft.Data.Sqlite;

// R1-04-03-01: shared typed transfer/copy dispatcher. Business stores own the
// atomic SQLCipher transactions, including all dependent contract/file versions.
record FolderTransferInput(string TargetWorkspace, bool Move);

static class FolderTransferService
{
    public static ResourceRef? Apply(SqliteConnection db, ResourceRef source, FolderTransferInput input)
    {
        if (!source.IsValid || source.Section.Length != 0 ||
            source.Kind is not (FolderKinds.Project or FolderKinds.Contract or FolderKinds.Ip))
            throw new ArgumentException("此文件夹类型不支持当前复制或转移操作。");
        if (!Vault.WorkspaceValid(input.TargetWorkspace))
            throw new ArgumentException("无效的目标工作区。");
        if (input.Move && source.Workspace == input.TargetWorkspace)
            throw new ArgumentException("同一工作区无需转移。");
        if (source.Kind == FolderKinds.Contract &&
            (input.Move || source.Workspace != input.TargetWorkspace))
            throw new ArgumentException("合同仅支持在所属项目下复制；跨工作区应复制或转移整个项目。");

        long? newId = source.Kind switch
        {
            FolderKinds.Project => ProjectStore.Transfer(db, source.Workspace,
                source.Id, input.TargetWorkspace, input.Move),
            FolderKinds.Ip => IpStore.Transfer(db, source.Workspace,
                source.Id, input.TargetWorkspace, input.Move),
            FolderKinds.Contract => ContractStore.Duplicate(db, source.Workspace, source.Id),
            _ => null
        };
        return newId is long id
            ? ResourceRef.Create(input.TargetWorkspace, source.Kind, id)
            : null;
    }
}
