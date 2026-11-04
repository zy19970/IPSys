// Pure folder identity and parent rules, exercised by the normal --smoke entrypoint.
static class FolderModelSmoke
{
    public static void Run()
    {
        static void Check(bool ok,string name)
        {
            if(!ok)throw new IOException("Folder model smoke failed: "+name);
        }
        static void Reject(string workspace,string kind,long id,string section,string label)
        {
            bool rejected=false;
            try { _=ResourceRef.Create(workspace,kind,id,section); }
            catch(ArgumentException) { rejected=true; }
            Check(rejected,label);
        }

        var project=ResourceRef.Create("company",FolderKinds.Project,7);
        var otherProject=ResourceRef.Create("personal",FolderKinds.Project,7);
        var ip=ResourceRef.Create("company",FolderKinds.Ip,9);
        var archive=ResourceRef.Create("company",FolderKinds.ArchiveFolder,7,"achievement");
        var archiveParent=ResourceRef.Create("company",FolderKinds.ArchiveFolder,8,"achievement");
        var certificate=ResourceRef.Create("company",FolderKinds.ArchiveFolder,7,"certificate");
        var projectFolder=ResourceRef.Create("company",FolderKinds.ArchiveFolder,10,"project");
        var nestedProject=ResourceRef.Create("company",FolderKinds.ArchiveFolder,11,"project");

        Check(project!=otherProject,"workspace is part of Folder identity");
        Check(project!=archive && archive!=certificate,
            "kind and section are part of Folder identity");
        Check(!default(ResourceRef).IsValid,"default identity is invalid");
        Check(FolderTypePolicy.MandatoryParentRulesSatisfied(archive,null),
            "ordinary archive folder may belong to module root");
        Check(FolderTypePolicy.MandatoryParentRulesSatisfied(archive,archiveParent),
            "ordinary archive folder accepts matching parent");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(archive,certificate),
            "different section cannot be parent");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(archive,project),
            "non-project section cannot be nested in project");
        Check(FolderTypePolicy.MandatoryParentRulesSatisfied(projectFolder,project),
            "project is real parent of project-section folder");
        Check(FolderTypePolicy.MandatoryParentRulesSatisfied(nestedProject,projectFolder),
            "project directories may nest without depth limit in model");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(projectFolder,null),
            "project module root is not a physical parent");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(projectFolder,ip),
            "IP cannot be project directory parent");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(projectFolder,otherProject),
            "cross-workspace parent denied");
        Check(!FolderTypePolicy.MandatoryParentRulesSatisfied(projectFolder,projectFolder),
            "self-parent denied");
        var descriptor=new FolderDescriptor(project,"项目",null,0);
        Check(descriptor.Ref==project && descriptor.Parent is null && !descriptor.Deleted,
            "business descriptor retains FolderId without a child contract");
        Reject("company","contract",1,"","retired contract kind");
        Reject("company","archive",1,"achievement","retired archive kind");
        Reject("company","general",1,"","retired general kind");
        Reject("company",FolderKinds.Project,0,"","nonpositive id");
        Reject("company",FolderKinds.Project,1,"achievement","project has no section");
        Reject("company",FolderKinds.ArchiveFolder,1,"","ordinary folder requires section");
        Reject("company",FolderKinds.ArchiveFolder,1,"academic","academic not in company");
        Console.WriteLine("FOLDER MODEL SMOKE PASS: project/IP/ordinary directory identity and parents");
    }
}
