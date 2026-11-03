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
                // Simulate a V2 vault predating modification timestamps.
                using(var legacyTime=db.CreateCommand())
                {
                    legacyTime.CommandText="ALTER TABLE folders DROP COLUMN modified_at; ALTER TABLE folders DROP COLUMN created_at;";
                    legacyTime.ExecuteNonQuery();
                }
                Vault.ValidateSchema(db);
                using(var upgradedTime=db.CreateCommand())
                {
                    upgradedTime.CommandText="SELECT count(*) FROM pragma_table_info('folders') WHERE name='modified_at';";
                    Check((long)upgradedTime.ExecuteScalar()! == 1,
                        "old V2 folder timestamp column upgraded in-place");
                    upgradedTime.CommandText="SELECT count(*) FROM folders WHERE modified_at IS NOT NULL;";
                    Check((long)upgradedTime.ExecuteScalar()! == 0,
                        "unknown historical modification times remain unknown");
                    upgradedTime.CommandText="SELECT count(*) FROM pragma_table_info('folders') WHERE name='created_at';";
                    Check((long)upgradedTime.ExecuteScalar()! == 1,
                        "old V2 folder creation column upgraded in-place");
                    upgradedTime.CommandText="SELECT count(*) FROM folders WHERE created_at IS NOT NULL;";
                    Check((long)upgradedTime.ExecuteScalar()! == 0,
                        "unknown historical creation times remain NULL, not overwritten by modified_at");
                }
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
                using(var creation=db.CreateCommand())
                {
                    creation.CommandText=$"SELECT created_at FROM folders WHERE id={legacyChild};";
                    var initial=creation.ExecuteScalar() as string;
                    Check(!string.IsNullOrWhiteSpace(initial),
                        "new folder has a real creation timestamp after V2 upgrade");
                    creation.CommandText=$"UPDATE folders SET name='重命名子目录' WHERE id={legacyChild};";
                    creation.ExecuteNonQuery();
                    creation.CommandText=$"SELECT created_at FROM folders WHERE id={legacyChild};";
                    Check(initial==creation.ExecuteScalar() as string,
                        "rename cannot change the original creation timestamp");
                }
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
                    normalized.CommandText=$"SELECT modified_at FROM folders WHERE id={legacyFolder};";
                    Check(!string.IsNullOrWhiteSpace(normalized.ExecuteScalar() as string),
                        "editing an old V2 folder starts a real timestamp");
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
                using(var newTime=db.CreateCommand())
                {
                    newTime.CommandText=$"SELECT modified_at FROM folders WHERE id={contract};";
                    Check(!string.IsNullOrWhiteSpace(newTime.ExecuteScalar() as string),
                        "new business folders carry an actual timestamp");
                }
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

                var partyFolder=ExecuteId(db,
                    "INSERT INTO folders(workspace,kind,section,name) VALUES('company','archive_folder','party','党团建设资料')");
                Check(partyFolder>0,"company party records share canonical folder kind");
                Reject(db,"INSERT INTO folders(workspace,kind,section,name) VALUES('personal','archive_folder','party','非法个人党团资料')",
                    "party section is company-only");
                Reject(db,$"INSERT INTO folders(workspace,kind,section,parent_id,name) VALUES('company','archive_folder','party',{linkFolder},'非法党团子记录')",
                    "party folders cannot cross module scope");
                Reject(db,"INSERT INTO folders(workspace,kind,section,name) VALUES('company','archive','party','废弃档案类型')",
                    "new schema refuses retired archive kind");
                Reject(db,"INSERT INTO folders(workspace,kind,section,name) VALUES('company','general','general','废弃综合资料类型')",
                    "new schema refuses retired general kind");
                ResourceSchemaV2.EnsurePartyArchiveSection(db); // idempotent on new V2 vaults
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
        // A V2-shaped legacy vault must fail BEFORE any in-place upgrade,
        // including when the retired record is only in the recycle bin.
        // Use a disposable encrypted fixture, never a user's existing file.
        string oldPath=Path.Combine(Path.GetTempPath(),
            "ipsys-v2-retired-"+Guid.NewGuid().ToString("N")+".db");
        try
        {
            using var old=Vault.Connect(oldPath,"v2-retired-key",create:true);
            using var cmd=old.CreateCommand();
            cmd.CommandText="""
                CREATE TABLE resource_schema_version(id INTEGER PRIMARY KEY,version INTEGER);
                INSERT INTO resource_schema_version VALUES(1,2);
                CREATE TABLE folders(id INTEGER PRIMARY KEY,kind TEXT,deleted INTEGER);
                INSERT INTO folders(kind,deleted) VALUES('archive',0),('general',1);
                CREATE TABLE files(id INTEGER PRIMARY KEY);
                CREATE TABLE file_versions(id INTEGER PRIMARY KEY);
                CREATE TABLE file_objects(id INTEGER PRIMARY KEY);
                CREATE TABLE file_chunks(id INTEGER PRIMARY KEY);
                CREATE TABLE folder_file_links(id INTEGER PRIMARY KEY);
                CREATE TABLE mcp_operations(id INTEGER PRIMARY KEY);
                """;
            cmd.ExecuteNonQuery();
            bool blocked=false;
            try {Vault.ValidateSchema(old);}
            catch(IOException ex) when(ex.Message.Contains("archive/general",
                StringComparison.Ordinal)){blocked=true;}
            Check(blocked,"V2 retired record kinds must be rejected with explicit guidance");
            cmd.CommandText="SELECT count(*) FROM folders WHERE kind IN ('archive','general');";
            Check((long)cmd.ExecuteScalar()! == 2,
                "rejected old V2 vault remains intact, including deleted entries");
        }
        finally
        {
            foreach(var suffix in new[]{"","-wal","-shm","-journal"})
                if(File.Exists(oldPath+suffix))File.Delete(oldPath+suffix);
        }
        Console.WriteLine("RESOURCE V2 SQLCIPHER SMOKE PASS");
    }
}
