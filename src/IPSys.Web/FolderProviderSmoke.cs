using Microsoft.Data.Sqlite;

// R1-02: read-only Folder Provider verification using a disposable *encrypted*
// SQLCipher database with the existing physical tables and existing business Stores.
static class FolderProviderSmoke
{
    public static void Run()
    {
        static void Check(bool ok, string message)
        {
            if (!ok) throw new IOException("Folder provider smoke failed: " + message);
        }

        string path = Path.Combine(Path.GetTempPath(), "ipsys-folder-provider-" +
            Guid.NewGuid().ToString("N") + ".db");
        try
        {
            using (var db = Vault.Connect(path, "R1-02-temporary-key", create: true))
            {
                Vault.CreateSchema(db);
                ProjectStore.Ensure(db);
                ContractStore.Ensure(db);
                IpStore.Ensure(db);

                var projectId = ProjectStore.Insert(db, "company",
                    new ProjectInput("机器人项目", "科研项目", "XM-2026-01", "张工",
                        "研发中心", null, null, "进行中", null, "项目原有备注", "矿山"));
                var personalId = ProjectStore.Insert(db, "personal",
                    new ProjectInput("个人科研", "横向项目", "PR-02", null,
                        null, null, null, null, null, null, null));
                var contractId = ContractStore.Add(db, "company", projectId,
                    new ContractInput("技术服务合同", "HT-2026", null, "120.5",
                        "甲乙双方", null, "合同原有备注", null));
                var ipId = IpStore.Add(db, "company", new IpInput("设备专利", "发明专利", "已授权", "项目组", null, null, null, null, null, null, null, null, null, null, null, null, null, null, "保留完整字段", "检测"));

                var projectProvider = BusinessFolderProviders.Resolve(FolderKinds.Project)!;
                var contractProvider = BusinessFolderProviders.Resolve(FolderKinds.Contract)!;
                var ipProvider = BusinessFolderProviders.Resolve(FolderKinds.Ip)!;

                Check(BusinessFolderProviders.Resolve("unknown") is null,
                    "unknown provider must not exist");
                Check(projectProvider.List(db, "company").Count == 1,
                    "company project view");
                Check(projectProvider.List(db, "personal").Count == 1,
                    "personal project view");
                Check(contractProvider.List(db, "personal").Count == 0,
                    "contracts must not leak to personal");
                Check(ipProvider.List(db, "personal").Count == 0,
                    "IP must not leak to personal");

                var projectRef = ResourceRef.Create("company", FolderKinds.Project, projectId);
                var personalProject = ResourceRef.Create("personal", FolderKinds.Project, personalId);
                var contractRef = ResourceRef.Create("company", FolderKinds.Contract, contractId);
                var ipRef = ResourceRef.Create("company", FolderKinds.Ip, ipId);

                var project = projectProvider.Get(db, projectRef);
                var contract = contractProvider.Get(db, contractRef);
                var ip = ipProvider.Get(db, ipRef);
                Check(project?.Folder.Parent is null &&
                      project.Folder.Name == "机器人项目" &&
                      project.BusinessData is ProjectView pv &&
                      pv.ProjectNo == "XM-2026-01" && pv.Remarks == "项目原有备注",
                    "project folder identity and full business fields");
                Check(contract?.Folder.Parent == projectRef &&
                      contract.Folder.Name == "技术服务合同" &&
                      contract.BusinessData is ContractView cv &&
                      cv.ContractNo == "HT-2026" && cv.Amount == "120.5" &&
                      cv.ProjectName == "机器人项目",
                    "contract parent and all business fields");
                Check(ip?.Folder.Parent is null &&
                      ip.BusinessData is IpView iv &&
                      iv.Data.IpType == "发明专利" &&
                      iv.Data.Applicants == "项目组" &&
                      iv.Data.Remarks == "保留完整字段",
                    "IP folder type and full JSON business fields");

                Check(projectRef.Id == contractRef.Id && contractRef.Id == ipRef.Id &&
                      projectRef != contractRef && contractRef != ipRef,
                    "same legacy integer ID must not collide across types");
                Check(projectProvider.Get(db, personalProject)?.Folder.Ref == personalProject,
                    "personal project must keep its scope");
                Check(projectProvider.Get(db, contractRef) is null &&
                      contractProvider.Get(db, projectRef) is null &&
                      ipProvider.Get(db, contractRef) is null,
                    "provider kind mismatch cannot resolve another table");
                Check(projectProvider.Get(db, new ResourceRef("personal", FolderKinds.Project,
                      projectId)) is null,
                    "same ID in another workspace is not a matching project");
                Check(contractProvider.Get(db, new ResourceRef("personal", FolderKinds.Contract,
                      contractId)) is null,
                    "cross-workspace contract must remain hidden");

                bool invalidWorkspaceRejected = false;
                try { _ = projectProvider.List(db, "unknown"); }
                catch (ArgumentException) { invalidWorkspaceRejected = true; }
                Check(invalidWorkspaceRejected, "invalid workspace must be rejected");

                Check(IpStore.Delete(db, "company", ipId), "soft-delete IP");
                Check(ipProvider.Get(db, ipRef) is null, "deleted IP cannot be opened");
                Check(ProjectStore.Delete(db, "company", projectId), "soft-delete project");
                Check(projectProvider.Get(db, projectRef) is null,
                    "deleted project cannot be opened");
                Check(contractProvider.Get(db, contractRef) is null &&
                      contractProvider.List(db, "company").Count == 0,
                    "contracts under a deleted parent cannot be listed");

                // Folder adapters only call existing Store.List; no physical schema changes.
                using var count = db.CreateCommand();
                count.CommandText = "SELECT count(*) FROM sqlite_master WHERE type='table';";
                Check((long)count.ExecuteScalar()! == 6,
                    "read-only providers must not create any new tables");
            }
        }
        finally
        {
            // The temporary test database is never a user database.
            foreach (var suffix in new[] { "", "-wal", "-shm", "-journal" })
                if (File.Exists(path + suffix)) File.Delete(path + suffix);
        }
        Console.WriteLine("FOLDER PROVIDER SMOKE PASS: encrypted legacy project/contract/IP adapters");
    }
}
