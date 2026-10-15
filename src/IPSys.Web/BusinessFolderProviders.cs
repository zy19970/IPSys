using Microsoft.Data.Sqlite;

// R1-02: non-mutating adapters from legacy project, contract and IP rows to logical folders.
// These providers deliberately use the existing Stores' workspace/deleted filtering and field DTOs.
record FolderSnapshot(FolderDescriptor Folder, object BusinessData);

// No new SQL tables or folder versions. The displayed Position is an ordinal in the
// legacy Store's read order, NOT a persisted folder sort key.
interface IFolderProvider
{
    string Kind { get; }
    IReadOnlyList<FolderSnapshot> List(SqliteConnection db, string workspace);
    FolderSnapshot? Get(SqliteConnection db, ResourceRef reference);
}

static class BusinessFolderProviders
{
    private static readonly IReadOnlyDictionary<string, IFolderProvider> Providers =
        new Dictionary<string, IFolderProvider>(StringComparer.Ordinal)
        {
            [FolderKinds.Project] = new ProjectFolderProvider(),
            [FolderKinds.Contract] = new ContractFolderProvider(),
            [FolderKinds.Ip] = new IpFolderProvider(),
            [FolderKinds.ArchiveFolder] = new ArchiveFolderProvider(),
            [FolderKinds.Archive] = new ArchiveRecordProvider(),
            [FolderKinds.General] = new GeneralFolderProvider()
        };

    public static IFolderProvider? Resolve(string kind) =>
        Providers.TryGetValue(kind, out var provider) ? provider : null;

    internal static void CheckWorkspace(string workspace)
    {
        if (!Vault.WorkspaceValid(workspace))
            throw new ArgumentException("无效的工作区。", nameof(workspace));
    }

    internal static FolderSnapshot? Find(IFolderProvider provider, SqliteConnection db, ResourceRef reference)
    {
        // Return null for invalid/mismatched identities, never fall back to another workspace.
        if (!reference.IsValid || reference.Kind != provider.Kind) return null;
        return provider.List(db, reference.Workspace)
            .FirstOrDefault(row => row.Folder.Ref == reference);
    }
}

sealed class ProjectFolderProvider : IFolderProvider
{
    public string Kind => FolderKinds.Project;

    public IReadOnlyList<FolderSnapshot> List(SqliteConnection db, string workspace)
    {
        BusinessFolderProviders.CheckWorkspace(workspace);
        return ProjectStore.List(db, workspace).Select((project, index) =>
            new FolderSnapshot(
                new FolderDescriptor(ResourceRef.Create(workspace, Kind, project.Id), project.Name,
                    Parent: null, Position: index),
                BusinessData: project)).ToArray();
    }

    public FolderSnapshot? Get(SqliteConnection db, ResourceRef reference) =>
        BusinessFolderProviders.Find(this, db, reference);
}

sealed class ContractFolderProvider : IFolderProvider
{
    public string Kind => FolderKinds.Contract;

    public IReadOnlyList<FolderSnapshot> List(SqliteConnection db, string workspace)
    {
        BusinessFolderProviders.CheckWorkspace(workspace);
        return ContractStore.List(db, workspace).Select((contract, index) =>
        {
            var child = ResourceRef.Create(workspace, Kind, contract.Id);
            var parent = ResourceRef.Create(workspace, FolderKinds.Project, contract.ProjectId);
            if (!FolderTypePolicy.MandatoryParentRulesSatisfied(child, parent))
                throw new InvalidDataException("合同文件夹的项目归属无效。");
            return new FolderSnapshot(
                new FolderDescriptor(child, contract.Name, parent, index),
                BusinessData: contract);
        }).ToArray();
    }

    public FolderSnapshot? Get(SqliteConnection db, ResourceRef reference) =>
        BusinessFolderProviders.Find(this, db, reference);
}

sealed class IpFolderProvider : IFolderProvider
{
    public string Kind => FolderKinds.Ip;

    public IReadOnlyList<FolderSnapshot> List(SqliteConnection db, string workspace)
    {
        BusinessFolderProviders.CheckWorkspace(workspace);
        return IpStore.List(db, workspace).Select((ip, index) =>
            new FolderSnapshot(
                new FolderDescriptor(ResourceRef.Create(workspace, Kind, ip.Id),
                    ip.Data.Name ?? "", Parent: null, Position: index),
                BusinessData: ip)).ToArray();
    }

    public FolderSnapshot? Get(SqliteConnection db, ResourceRef reference) =>
        BusinessFolderProviders.Find(this, db, reference);
}
