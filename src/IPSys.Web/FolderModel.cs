// R1-01: logical identity for existing business-backed folders, independent of the physical SQL tables.
// Virtual module roots are not stored ResourceRefs; ID 0 is never a materialized folder identity.
static class FolderKinds
{
    public const string Project = "project";
    public const string Contract = "contract";
    public const string Ip = "ip";
    public const string ArchiveFolder = "archive_folder";
}

readonly record struct ResourceRef(string Workspace,string Kind,long Id,string Section = "")
{
    public bool IsValid => Id > 0 && Vault.WorkspaceValid(Workspace) && (Kind switch
    {
        FolderKinds.Project or FolderKinds.Contract or FolderKinds.Ip => Section == "",
        FolderKinds.ArchiveFolder => ArchiveDirectoryScopes.Allowed(Workspace,Section),
        _ => false
    });

    public static ResourceRef Create(string workspace,string kind,long id,string section = "")
    {
        var reference=new ResourceRef(workspace,kind,id,section);
        if(!reference.IsValid)throw new ArgumentException("无效的文件夹资源引用。");
        return reference;
    }
}

// Stable shared DTO: specific project, contract, IP and archive properties stay with the provider.
// The position and deletion marker belong to the folder, never to file versions.
record FolderDescriptor(ResourceRef Ref,string Name,ResourceRef? Parent,int Position,bool Deleted = false,string? ModifiedAt = null,string? CreatedAt = null);

record FolderSnapshot(FolderDescriptor Folder,object BusinessData);

static class FolderTypePolicy
{
    // Only global mandatory constraints live here; adapters enforce further module-specific permissions.
    // In particular, a true return value does not grant arbitrary nesting or database write permission.
    public static bool MandatoryParentRulesSatisfied(ResourceRef child,ResourceRef? parent)
    {
        if(!child.IsValid)return false;
        if(parent is ResourceRef p && (!p.IsValid || p.Workspace != child.Workspace || p == child))return false;
        if(child.Kind == FolderKinds.Contract)
            return parent is ResourceRef project && project.Kind == FolderKinds.Project;
        if(child.Kind == FolderKinds.ArchiveFolder)
            return child.Section=="project"
                ? parent is ResourceRef owner && (owner.Kind==FolderKinds.Project ||
                    owner.Kind==FolderKinds.ArchiveFolder && owner.Section=="project")
                : parent is null || parent is ResourceRef folder &&
                    folder.Kind == FolderKinds.ArchiveFolder && folder.Section == child.Section;
        return true;
    }
}

static class ArchiveDirectoryScopes
{
    public static bool Allowed(string workspace,string section) =>
        workspace=="company" && section is ("certificate" or "achievement" or "party" or "general" or "project") ||
        workspace=="personal" && section is ("certificate" or "achievement" or "academic" or "general" or "project");
}
