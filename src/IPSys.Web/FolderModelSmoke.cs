// R1-01: pure model smoke, invoked by existing --smoke; does not open or migrate a user database.
static class FolderModelSmoke
{
    public static void Run()
    {
        static void Check(bool condition,string name)
        {
            if(!condition)throw new IOException("Folder model smoke failed: " + name);
        }
        static void Reject(string workspace,string kind,long id,string section,string name)
        {
            try
            {
                _ = ResourceRef.Create(workspace,kind,id,section);
                throw new IOException("Folder model accepted invalid reference: " + name);
            }
            catch(ArgumentException) { }
        }

        var project=ResourceRef.Create("company",FolderKinds.Project,7);
        var contract=ResourceRef.Create("company",FolderKinds.Contract,7);
        var personProject=ResourceRef.Create("personal",FolderKinds.Project,7);
        var archive=ResourceRef.Create("company",FolderKinds.Archive,7,"achievement");
        var certificate=ResourceRef.Create("company",FolderKinds.Archive,7,"certificate");
        var category=ResourceRef.Create("company",FolderKinds.ArchiveFolder,7,"achievement");
        Check(project != contract && project != personProject,"folder identity must include type and workspace");
        Check(archive != certificate,"folder identity must include archive section");
        Check(!default(ResourceRef).IsValid,"default record identity is invalid");
        Check(FolderTypePolicy.MandatoryParentRulesSatisfied(contract,project),"contract belongs to project");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(contract,null),"orphan contract forbidden");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(contract,personProject),"cross-workspace contract forbidden");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(contract,archive),"contract cannot belong to archive");
        Check(FolderTypePolicy.MandatoryParentRulesSatisfied(category,null),"archive system root");
        Check(FolderTypePolicy.MandatoryParentRulesSatisfied(category,category),"archive folder parent type allowed");
        Check(FolderTypePolicy.MandatoryParentRulesSatisfied(archive,category),"archive record within archive folder");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(archive,project),"archive record may not enter project");
        var folder=new FolderDescriptor(project,"科研项目 A",null,0);
        Check(folder.Ref==project && folder.Parent==null && !folder.Deleted,"folder descriptor preserves identity");
        Reject("other",FolderKinds.Project,1,"","unknown workspace");
        Reject("company","unknown",1,"","unknown kind");
        Reject("company",FolderKinds.Project,0,"","nonpositive id");
        Reject("company",FolderKinds.Contract,1,"achievement","contract section");
        Reject("company",FolderKinds.Archive,1,"academic","company academic scope");
        Reject("personal",FolderKinds.ArchiveFolder,1,"achievement","personal archive-folder scope");
        Console.WriteLine("FOLDER MODEL SMOKE PASS: identity, scope, contract parent and archive types");
    }
}
