using Microsoft.Data.Sqlite;

// Exercise the v2 model in a disposable, encrypted database.
static class ResourceSchemaV2Smoke
{
    public static void Run()
    {
        static void Check(bool value,string name)
        {
            if(!value)throw new IOException("V2 SCHEMA SMOKE FAIL: "+name);
        }
        static long ExecuteId(SqliteConnection db,string sql)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText=sql+"; SELECT last_insert_rowid();";
            return (long)cmd.ExecuteScalar()!;
        }
        static void Reject(SqliteConnection db,string sql,string name)
        {
            try
            {
                using var cmd=db.CreateCommand();
                cmd.CommandText=sql;
                cmd.ExecuteNonQuery();
                throw new IOException("Invalid mutation accepted: "+name);
            }
            catch(SqliteException) { }
        }
        string path=Path.Combine(Path.GetTempPath(),
            "ipsys-v2-"+Guid.NewGuid().ToString("N")+".db");
        try
        {
            long folderId,fileId,linkFolder,objectId;
            using(var db=Vault.Connect(path,"v2-temporary-key",create:true))
            {
                Vault.CreateSchema(db);
                Vault.ValidateSchema(db);
                using(var legacy=db.CreateCommand())
                {
                    legacy.CommandText="SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('records','attachments','chunks','business_projects','business_contracts','business_ips','business_archives','business_file_links','business_file_objects','business_file_chunks','archive_folders');";
                    Check((long)legacy.ExecuteScalar()! == 0,"new V2 vault contains no legacy business tables");
                }
                using(var count=db.CreateCommand())
                {
                    count.CommandText="SELECT count(*) FROM folders WHERE is_system<>0;";
                    Check((long)count.ExecuteScalar()! == 0,"initial archive folders are ordinary");
                    count.CommandText="SELECT count(*) FROM folders WHERE workspace='company' AND kind='archive_folder';";
                    Check((long)count.ExecuteScalar()! == 7,"seven initial archive folders");
                }

                // Simulate an older V2 vault's protected first directory.
                // Normalization must preserve its FolderId, undo old triggers
                // and never seed deleted folders again on a later open.
                long legacyFolder;
                using(var old=db.CreateCommand())
                {
                    old.CommandText="SELECT id FROM folders WHERE name='申报与认定' AND workspace='company';";
                    legacyFolder=(long)old.ExecuteScalar()!;
                    old.CommandText=$"""
                        DROP TRIGGER folder_immutable_scope;
                        UPDATE folders SET is_system=1 WHERE id={legacyFolder};
                        CREATE TRIGGER folder_immutable_scope BEFORE UPDATE OF
                          workspace,kind,section,is_system ON folders BEGIN
                          SELECT RAISE(ABORT,'folder identity immutable');
                        END;
                        CREATE TRIGGER folder_protect_system BEFORE UPDATE OF name,parent_id,deleted
                          ON folders WHEN OLD.is_system=1 BEGIN
                          SELECT RAISE(ABORT,'system category is protected');
                        END;
                        CREATE TRIGGER folder_protect_system_delete BEFORE DELETE ON folders
                          WHEN OLD.is_system=1 BEGIN
                          SELECT RAISE(ABORT,'system category is protected');
                        END;
                        """;
                    old.ExecuteNonQuery();
                }
                long legacyChild=ExecuteId(db,
                    $"INSERT INTO folders(workspace,kind,section,parent_id,name) VALUES('company','archive_folder','achievement',{legacyFolder},'历史子目录')");
                Reject(db,$"UPDATE folders SET name='曾受保护' WHERE id={legacyFolder}",
                    "legacy protected initial folder rejects rename");
                Vault.ValidateSchema(db);
                using(var normalized=db.CreateCommand())
                {
                    normalized.CommandText=$"SELECT is_system FROM folders WHERE id={legacyFolder};";
                    Check((long)normalized.ExecuteScalar()! == 0,
                        "legacy FolderId retained and protection flag cleared");
                    normalized.CommandText="SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name IN ('folder_protect_system','folder_protect_system_delete');";
                    Check((long)normalized.ExecuteScalar()! == 0,
                        "legacy protections removed permanently");
                    normalized.CommandText=$"SELECT count(*) FROM folders WHERE id={legacyChild} AND parent_id={legacyFolder};";
                    Check((long)normalized.ExecuteScalar()! == 1,
                        "historical child relationships remain intact");
                    normalized.CommandText=$"UPDATE folders SET name='更名后的初始文件夹' WHERE id={legacyFolder};";
                    Check(normalized.ExecuteNonQuery()==1,"initial folder can be renamed");
                    normalized.CommandText=$"UPDATE folders SET parent_id=(SELECT id FROM folders WHERE name='其他业务资料') WHERE id={legacyFolder};";
                    Check(normalized.ExecuteNonQuery()==1,"initial folder can move with existing children");
                    normalized.CommandText=$"UPDATE folders SET parent_id=NULL WHERE id={legacyFolder};";
                    Check(normalized.ExecuteNonQuery()==1,"initial folder can return to top level");
                    normalized.CommandText=$"UPDATE folders SET name='申报与认定' WHERE id={legacyFolder};";
                    Check(normalized.ExecuteNonQuery()==1,"initial folder rename can be reverted");
                    normalized.CommandText="DELETE FROM folders WHERE name='其他业务资料' AND workspace='company' AND kind='archive_folder';";
                    Check(normalized.ExecuteNonQuery()==1,"an empty initial folder can be deleted");
                    normalized.CommandText="SELECT count(*) FROM folders WHERE kind='archive_folder' AND parent_id IS NULL;";
                    Check((long)normalized.ExecuteScalar()! == 6,
                        "the deleted starter is not automatically recreated");
                }
                folderId=ExecuteId(db,
                    "INSERT INTO folders(workspace,kind,name) VALUES('company','project','项目')");
                var contract=ExecuteId(db,
                    $"INSERT INTO folders(workspace,kind,name,parent_id) VALUES('company','contract','合同',{folderId})");
                Check(contract>0,"project-contract parent");
                Reject(db,"INSERT INTO folders(workspace,kind,name) VALUES('company','contract','孤立合同')",
                    "orphan contract");
                Reject(db,$"INSERT INTO folders(workspace,kind,name,parent_id) VALUES('personal','contract','跨区合同',{folderId})",
                    "cross-workspace parent");
                Reject(db,$"INSERT INTO folders(workspace,kind,name,parent_id) VALUES('company','ip','非法父级',{folderId})",
                    "invalid parent kind");
                linkFolder=ExecuteId(db,
                    "INSERT INTO folders(workspace,kind,section,name) VALUES('company','archive_folder','achievement','自建分类')");
                var child=ExecuteId(db,
                    $"INSERT INTO folders(workspace,kind,section,name,parent_id) VALUES('company','archive_folder','achievement','下级分类',{linkFolder})");
                Reject(db,$"UPDATE folders SET parent_id={child} WHERE id={linkFolder}",
                    "cycle detection");
                Reject(db,"UPDATE folders SET deleted=1 WHERE is_system=1 AND name='申报与认定'",
                    "system root protection");

                fileId=ExecuteId(db,"INSERT INTO files(workspace,name) VALUES('company','原件.pdf')");
                objectId=ExecuteId(db,
                    "INSERT INTO file_objects(workspace,state,expected_size) VALUES('company','writing',3)");
                using(var finalize=db.CreateCommand())
                {
                    finalize.CommandText=$"INSERT INTO file_chunks(object_id,workspace,idx,bytes) VALUES({objectId},'company',0,X'010203');";
                    finalize.ExecuteNonQuery();
                    var digest=Convert.ToHexString(
                        System.Security.Cryptography.SHA256.HashData(new byte[]{1,2,3}));
                    finalize.CommandText=$"UPDATE file_objects SET state='ready',size=3,sha256='{digest}' WHERE id={objectId};";
                    Check(finalize.ExecuteNonQuery()==1,"finalize content object");
                }
                Reject(db,$"UPDATE file_objects SET size=0 WHERE id={objectId}",
                    "ready object immutability");
                Reject(db,$"UPDATE file_chunks SET bytes=X'00' WHERE object_id={objectId}",
                    "ready file chunk immutability");
                // A ready orphan may be purged; referenced versions stay immutable.
                Reject(db,$"INSERT INTO file_chunks(object_id,workspace,idx,bytes) VALUES({objectId},'company',1,X'00')",
                    "cannot append bytes after object is ready");
                ExecuteId(db,
                    $"INSERT INTO file_versions(file_id,workspace,version,object_id,original_name) VALUES({fileId},'company',1,{objectId},'原件.pdf')");
                Reject(db,$"DELETE FROM file_chunks WHERE object_id={objectId}",
                    "referenced ready bytes must not be deleted");
                ExecuteId(db,
                    $"INSERT INTO folder_file_links(workspace,folder_id,file_id) VALUES('company',{folderId},{fileId})");
                ExecuteId(db,
                    $"INSERT INTO folder_file_links(workspace,folder_id,file_id) VALUES('company',{linkFolder},{fileId})");
                Reject(db,$"INSERT INTO folder_file_links(workspace,folder_id,file_id) VALUES('personal',{folderId},{fileId})",
                    "cross workspace file link");
                Reject(db,$"INSERT INTO folder_file_links(workspace,folder_id,file_id) VALUES('company',{folderId},{fileId})",
                    "duplicate active file link");
                var secondFile=ExecuteId(db,
                    "INSERT INTO files(workspace,name) VALUES('company','独立文件.pdf')");
                ExecuteId(db,
                    $"INSERT INTO file_versions(file_id,workspace,version,object_id,original_name) VALUES({secondFile},'company',1,{objectId},'独立文件.pdf')");
                ExecuteId(db,
                    $"INSERT INTO file_versions(file_id,workspace,version,object_id,original_name) VALUES({fileId},'company',2,{objectId},'原件第二版.pdf')");
                using(var count=db.CreateCommand())
                {
                    count.CommandText=$"SELECT count(*) FROM file_versions WHERE file_id={fileId};";
                    Check((long)count.ExecuteScalar()! == 2,"shared logical file has two versions");
                    count.CommandText=$"SELECT count(*) FROM file_versions WHERE file_id={secondFile};";
                    Check((long)count.ExecuteScalar()! == 1,
                        "same byte content does not merge different file histories");
                }
                Reject(db,$"UPDATE file_versions SET original_name='伪造原名' WHERE file_id={fileId}",
                    "immutable version identity");
                var otherObject=ExecuteId(db,
                    "INSERT INTO file_objects(workspace,state,expected_size,size,sha256) VALUES('personal','ready',3,3,'"+
                    new string('A',64)+"')");
                Reject(db,$"INSERT INTO file_versions(file_id,workspace,version,object_id,original_name) VALUES({fileId},'company',3,{otherObject},'越区.pdf')",
                    "physical object workspace isolation");
                var writing=ExecuteId(db,
                    "INSERT INTO file_objects(workspace,state,expected_size) VALUES('company','writing',3)");
                Reject(db,$"INSERT INTO file_versions(file_id,workspace,version,object_id,original_name) VALUES({fileId},'company',3,{writing},'暂存.pdf')",
                    "unfinished content");
                using(var unlink=db.CreateCommand())
                {
                    unlink.CommandText=$"UPDATE folder_file_links SET deleted=1 WHERE folder_id={folderId} AND file_id={fileId};";
                    Check(unlink.ExecuteNonQuery()==1,"unlink one association");
                    unlink.CommandText=$"SELECT count(*) FROM folder_file_links WHERE folder_id={linkFolder} AND file_id={fileId} AND deleted=0;";
                    Check((long)unlink.ExecuteScalar()! == 1,
                        "other folder retains shared FileId");
                }
            }
            using(var reopen=Vault.Connect(path,"v2-temporary-key",create:false))
            {
                Vault.ValidateSchema(reopen);
                using var cmd=reopen.CreateCommand();
                cmd.CommandText="SELECT count(*) FROM files;";
                Check((long)cmd.ExecuteScalar()! == 2,"encrypted files survive reopen");
                cmd.CommandText="SELECT count(*) FROM folders WHERE kind='archive_folder' AND parent_id IS NULL;";
                Check((long)cmd.ExecuteScalar()! == 7,
                    "only six surviving initial folders plus one user-created folder after reopen");
                cmd.CommandText="SELECT count(*) FROM folders WHERE is_system<>0;";
                Check((long)cmd.ExecuteScalar()! == 0,
                    "legacy starter flags remain cleared after reopen");
            }
        }
        finally
        {
            foreach(var suffix in new[]{"","-wal","-shm","-journal"})
                if(File.Exists(path+suffix))File.Delete(path+suffix);
        }
        Console.WriteLine("RESOURCE V2 SQLCIPHER SMOKE PASS");
    }
}
