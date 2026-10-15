using Microsoft.Data.Sqlite;

// R1-03: use a throwaway encrypted SQLCipher database and the current business Stores.
static class ArchiveFolderProviderSmoke
{
    public static void Run()
    {
        static void Check(bool ok, string message)
        {
            if (!ok) throw new IOException("Archive folder provider smoke failed: " + message);
        }

        string path = Path.Combine(Path.GetTempPath(), "ipsys-archive-provider-" +
            Guid.NewGuid().ToString("N") + ".db");
        try
        {
            using (var db = Vault.Connect(path, "R1-03-temporary-key", create: true))
            {
                Vault.CreateSchema(db);
                GeneralStore.Ensure(db);
                ArchiveStore.Ensure(db);

                var root = ArchiveFolderStore.List(db).First(folder =>
                    folder.Name == "申报与认定" && folder.ParentId is null);
                long childId = ArchiveFolderStore.Create(db,
                    new ArchiveFolderInput("机器人申报材料", root.Id));
                long itemId = ArchiveStore.Add(db, "company", "achievement",
                    new ArchiveInput("2026 年项目申请书", "申报与认定",
                        "业务档案备注", "申报", Year: "2026", FolderId: childId));
                long certificateId = ArchiveStore.Add(db, "company", "certificate",
                    new ArchiveInput("企业资质 A", "资质", "公司证件", null));
                long academicId = ArchiveStore.Add(db, "personal", "academic",
                    new ArchiveInput("学术兼职 A", "学术兼职", "个人记录", null));
                long generalId;
                using (var insert = db.CreateCommand())
                {
                    insert.CommandText = """
                        INSERT INTO records(workspace,title) VALUES('company','综合资料 A');
                        SELECT last_insert_rowid();
                        """;
                    generalId = (long)insert.ExecuteScalar()!;
                }

                var folderProvider = BusinessFolderProviders.Resolve(FolderKinds.ArchiveFolder)!;
                var archiveProvider = BusinessFolderProviders.Resolve(FolderKinds.Archive)!;
                var generalProvider = BusinessFolderProviders.Resolve(FolderKinds.General)!;
                var rootRef = ResourceRef.Create("company", FolderKinds.ArchiveFolder,
                    root.Id, "achievement");
                var childRef = ResourceRef.Create("company", FolderKinds.ArchiveFolder,
                    childId, "achievement");
                var archiveRef = ResourceRef.Create("company", FolderKinds.Archive,
                    itemId, "achievement");
                var certificateRef = ResourceRef.Create("company", FolderKinds.Archive,
                    certificateId, "certificate");
                var academicRef = ResourceRef.Create("personal", FolderKinds.Archive,
                    academicId, "academic");
                var generalRef = ResourceRef.Create("company", FolderKinds.General, generalId);

                Check(folderProvider.List(db, "personal").Count == 0,
                    "personal workspace has no company archive-folder tree");
                Check(folderProvider.Get(db, rootRef)?.Folder.Parent is null,
                    "predefined archive category is a root folder");
                Check(folderProvider.Get(db, childRef)?.Folder.Parent == rootRef,
                    "nested archive folder parent");
                Check(folderProvider.Get(db, childRef)?.BusinessData is ArchiveFolderView fv &&
                      fv.Name == "机器人申报材料",
                    "archive folder original position and identity");
                Check(archiveProvider.Get(db, archiveRef)?.Folder.Parent == childRef &&
                      archiveProvider.Get(db, archiveRef)?.BusinessData is ArchiveView av &&
                      av.Year == "2026" && av.Remarks == "业务档案备注" &&
                      av.FolderId == childId,
                    "archive record folder must retain business data and actual parent");
                Check(archiveProvider.Get(db, certificateRef)?.Folder.Parent is null,
                    "company certificate is a folder under virtual module root");
                Check(archiveProvider.Get(db, academicRef)?.BusinessData is ArchiveView pv &&
                      pv.Workspace == "personal" && pv.Section == "academic",
                    "personal academic record remains scoped");
                Check(archiveProvider.Get(db, new ResourceRef("personal", FolderKinds.Archive,
                      certificateId, "certificate")) is null &&
                      archiveProvider.Get(db, new ResourceRef("company", FolderKinds.Archive,
                      academicId, "academic")) is null,
                    "invalid or cross-workspace archive sections cannot resolve records");
                Check(generalProvider.Get(db, generalRef)?.BusinessData is GeneralFolderBusinessData gv &&
                      gv.Title == "综合资料 A",
                    "general record becomes a folder with original title");
                Check(generalProvider.Get(db, new ResourceRef("personal", FolderKinds.General,
                      generalId)) is null, "general record workspace isolation");
                Check(rootRef.Id == archiveRef.Id && rootRef != archiveRef,
                    "same archive integer ID differs by folder/record kind");
                Check(archiveProvider.Get(db, childRef) is null &&
                      folderProvider.Get(db, archiveRef) is null,
                    "folder and archive record cannot masquerade as each other");

                bool invalidRejected = false;
                try { _ = archiveProvider.List(db, "invalid"); }
                catch (ArgumentException) { invalidRejected = true; }
                Check(invalidRejected, "unknown workspace rejected");
                Check(ArchiveStore.Delete(db, "company", "achievement", itemId),
                    "soft delete archive record");
                Check(archiveProvider.Get(db, archiveRef) is null,
                    "deleted archive record cannot be read");
                using (var softDelete = db.CreateCommand())
                {
                    softDelete.CommandText = "UPDATE records SET deleted=1 WHERE id=$id;";
                    softDelete.Parameters.AddWithValue("$id", generalId);
                    Check(softDelete.ExecuteNonQuery() == 1, "soft delete general record");
                }
                Check(generalProvider.Get(db, generalRef) is null,
                    "deleted general record cannot be read");
                Check(folderProvider.Get(db, childRef) is not null,
                    "directory remains after deleting its archive record");
            }
        }
        finally
        {
            foreach (var suffix in new[] { "", "-wal", "-shm", "-journal" })
                if (File.Exists(path + suffix)) File.Delete(path + suffix);
        }
        Console.WriteLine("ARCHIVE FOLDER PROVIDER SMOKE PASS: encrypted archive/general tree");
    }
}
