using Microsoft.Data.Sqlite;

// Disposable encrypted V3 vault only; open validation must not mutate an older vault.
static class ResourceSchemaV2Smoke
{
    public static void Run()
    {
        static void Check(bool ok,string message)
        {
            if(!ok)throw new IOException("RESOURCE V3 SQLCIPHER SMOKE: "+message);
        }
        static long Scalar(SqliteConnection db,string sql)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText=sql;
            return Convert.ToInt64(cmd.ExecuteScalar());
        }
        static long Id(SqliteConnection db,string sql)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText=sql+"; SELECT last_insert_rowid();";
            return Convert.ToInt64(cmd.ExecuteScalar());
        }
        static void Reject(SqliteConnection db,string sql,string message)
        {
            bool rejected=false;
            try
            {
                using var cmd=db.CreateCommand();
                cmd.CommandText=sql;
                cmd.ExecuteNonQuery();
            }
            catch(SqliteException){rejected=true;}
            Check(rejected,message);
        }
        static string? Sql(SqliteConnection db,string type,string name)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="SELECT sql FROM sqlite_master WHERE type=$type AND name=$name;";
            cmd.Parameters.AddWithValue("$type",type);
            cmd.Parameters.AddWithValue("$name",name);
            return cmd.ExecuteScalar() as string;
        }
        static void Clean(string path)
        {
            foreach(var suffix in new[]{"","-wal","-shm","-journal"})
                if(File.Exists(path+suffix))File.Delete(path+suffix);
        }

        string path=Path.Combine(Path.GetTempPath(),
            "ipsys-schema3-"+Guid.NewGuid().ToString("N")+".db");
        try
        {
            long project,projectDir,child,file,objectId,link;
            using(var db=Vault.Connect(path,"schema3-test-key",create:true))
            {
                Vault.CreateSchema(db);
                Vault.ValidateSchema(db);
                Check(Scalar(db,"SELECT version FROM resource_schema_version WHERE id=1;")==3,
                    "new vault schema version is exactly 3");
                Check(Scalar(db,"SELECT count(*) FROM folders WHERE kind='archive_folder' AND is_system=0;")==7,
                    "seven ordinary editable initial folders");
                Check(Scalar(db,"SELECT count(*) FROM folders WHERE kind='contract';")==0,
                    "new V3 vault has no independent contract rows");
                Check(Sql(db,"table","folders")?.Contains("'contract'")==false,
                    "V3 CHECK cannot admit retired contract kind");
                Check(Sql(db,"trigger","folder_modified_business")?.Contains("section") == true,
                    "new creation transaction already installs section-aware modified timestamp");
                Check(Sql(db,"trigger","chunk_delete_ready")?.Contains("file_versions")==true,
                    "new creation transaction already protects referenced ready objects");

                Reject(db,"INSERT INTO folders(workspace,kind,name) VALUES('company','contract','不可创建合同')",
                    "retired contract kind rejected at SQL level");
                Reject(db,"INSERT INTO folders(workspace,kind,section,name) VALUES('company','archive','achievement','旧档案')",
                    "retired archive kind rejected");
                project=Id(db,"INSERT INTO folders(workspace,kind,name) VALUES('company','project','测试项目')");
                long ip=Id(db,"INSERT INTO folders(workspace,kind,name) VALUES('company','ip','测试专利')");
                projectDir=Id(db,$"INSERT INTO folders(workspace,kind,section,parent_id,name) VALUES('company','archive_folder','project',{project},'项目内合同资料')");
                child=Id(db,$"INSERT INTO folders(workspace,kind,section,parent_id,name) VALUES('company','archive_folder','project',{projectDir},'二级附件')");
                Check(projectDir>0 && child>0 && ip>0,"project directory nesting is valid");
                Reject(db,"INSERT INTO folders(workspace,kind,section,name) VALUES('company','archive_folder','project','无归属项目目录')",
                    "project directory without actual project parent rejected");
                Reject(db,$"INSERT INTO folders(workspace,kind,section,parent_id,name) VALUES('personal','archive_folder','project',{project},'跨工作区')",
                    "project folder cannot cross workspaces");
                Reject(db,$"INSERT INTO folders(workspace,kind,section,parent_id,name) VALUES('company','archive_folder','project',{ip},'知识产权父级')",
                    "IP cannot parent project folder");
                Reject(db,$"UPDATE folders SET parent_id={child} WHERE id={projectDir}",
                    "directory cycle rejected");
                Reject(db,$"UPDATE folders SET section='general' WHERE id={child}",
                    "section change cannot violate its parent scope");
                Check(Scalar(db,$"SELECT count(*) FROM folders WHERE id={child} AND parent_id={projectDir} AND section='project';")==1,
                    "failed scope update leaves original directory unchanged");

                file=Id(db,"INSERT INTO files(workspace,name) VALUES('company','原件.pdf')");
                objectId=Id(db,"INSERT INTO file_objects(workspace,state,expected_size) VALUES('company','writing',3)");
                string sha=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(new byte[]{1,2,3}));
                using(var cmd=db.CreateCommand())
                {
                    cmd.CommandText=$"INSERT INTO file_chunks(object_id,workspace,idx,bytes) VALUES({objectId},'company',0,X'010203');";
                    cmd.ExecuteNonQuery();
                    cmd.CommandText=$"UPDATE file_objects SET state='ready',size=3,sha256='{sha}' WHERE id={objectId};";
                    Check(cmd.ExecuteNonQuery()==1,"finalize immutable object");
                }
                Reject(db,$"UPDATE file_objects SET size=0 WHERE id={objectId}",
                    "ready object immutable");
                Id(db,$"INSERT INTO file_versions(file_id,workspace,version,object_id,original_name) VALUES({file},'company',1,{objectId},'原件.pdf')");
                Id(db,$"INSERT INTO file_versions(file_id,workspace,version,object_id,original_name) VALUES({file},'company',2,{objectId},'历史版本.pdf')");
                Reject(db,$"DELETE FROM file_chunks WHERE object_id={objectId}",
                    "referenced immutable content bytes protected");
                link=Id(db,$"INSERT INTO folder_file_links(workspace,folder_id,file_id) VALUES('company',{child},{file})");
                Reject(db,$"INSERT INTO folder_file_links(workspace,folder_id,file_id) VALUES('personal',{project},{file})",
                    "cross workspace link cannot exist");
                Reject(db,$"INSERT INTO folder_file_links(workspace,folder_id,file_id) VALUES('company',{child},{file})",
                    "duplicate active FileId link rejected");
                Check(Scalar(db,$"SELECT count(*) FROM file_versions WHERE file_id={file};")==2,
                    "both versions maintained");

                // Read-only validation is observed by total_changes and schema SQL.
                long before=Scalar(db,"SELECT total_changes();");
                string? schemaBefore=Sql(db,"table","folders");
                Vault.ValidateSchema(db);
                Check(Scalar(db,"SELECT total_changes();")==before &&
                      Sql(db,"table","folders")==schemaBefore,
                    "V3 validation has no writes or DDL changes");
                using(var cmd=db.CreateCommand())
                {
                    cmd.CommandText="DELETE FROM folders WHERE workspace='company' AND kind='archive_folder' AND name='其他业务资料';";
                    Check(cmd.ExecuteNonQuery()==1,"starter folder can be removed");
                    cmd.CommandText=$"UPDATE folders SET name='二级已更新' WHERE id={child};";
                    Check(cmd.ExecuteNonQuery()==1,"project child can be modified immediately after CREATE");
                    cmd.CommandText=$"SELECT modified_at FROM folders WHERE id={child};";
                    Check(!string.IsNullOrWhiteSpace(cmd.ExecuteScalar() as string),
                        "new folder has modification timestamp without reopen");
                }
                // A changed section with unchanged NULL parent must still be an
                // observable metadata edit for cross-module root moves.
                long root=Id(db,"INSERT INTO folders(workspace,kind,section,name) VALUES('company','archive_folder','certificate','跨模块移动')");
                using(var cmd=db.CreateCommand())
                {
                    cmd.CommandText=$"UPDATE folders SET section='general' WHERE id={root};";
                    Check(cmd.ExecuteNonQuery()==1,"same-workspace root section update");
                }
                Check(Scalar(db,$"SELECT count(*) FROM folders WHERE id={root} AND section='general' AND modified_at IS NOT NULL;")==1,
                    "cross-module root modification timestamp is available");
            }

            using(var reopened=Vault.Connect(path,"schema3-test-key",create:false))
            {
                Vault.ValidateSchema(reopened);
                Check(Scalar(reopened,"SELECT version FROM resource_schema_version;")==3,
                    "reopen preserves V3 schema version");
                Check(Scalar(reopened,$"SELECT count(*) FROM file_versions WHERE file_id={file};")==2 &&
                      Scalar(reopened,$"SELECT count(*) FROM folder_file_links WHERE id={link};")==1,
                    "both file versions and stable LinkId survive reopened validation");
                Check(Scalar(reopened,"SELECT count(*) FROM folders WHERE name='其他业务资料';")==0,
                    "deleted initial folder is not reseeded on reopen");
                Check(Scalar(reopened,$"SELECT count(*) FROM folders WHERE id={child} AND name='二级已更新';")==1,
                    "project tree edits survive reopen");
            }
        }
        finally{Clean(path);}

        // Two distinct V2-style schemas: an older ordinary-folder scope and
        // a legacy contract-per-project schema. Both are refused untouched.
        for(int fixture=0;fixture<2;fixture++)
        {
            string legacyPath=Path.Combine(Path.GetTempPath(),
                "ipsys-v2-refuse-"+Guid.NewGuid().ToString("N")+".db");
            try
            {
                using var db=Vault.Connect(legacyPath,"old-schema-test-key",create:true);
                using var setup=db.CreateCommand();
                setup.CommandText=$"""
                    CREATE TABLE resource_schema_version(id INTEGER PRIMARY KEY,version INTEGER);
                    INSERT INTO resource_schema_version VALUES(1,2);
                    CREATE TABLE folders(id INTEGER PRIMARY KEY,kind TEXT,section TEXT,deleted INTEGER);
                    INSERT INTO folders(kind,section,deleted) VALUES('{(fixture==0?"archive_folder":"contract")}','{(fixture==0?"achievement":"")}',1);
                    """;
                setup.ExecuteNonQuery();
                long before=Scalar(db,"SELECT total_changes();");
                string? definition=Sql(db,"table","folders");
                bool blocked=false;
                try{Vault.ValidateSchema(db);}
                catch(IOException ex)when(ex.Message.Contains("新建资料库",StringComparison.Ordinal))
                {blocked=true;}
                Check(blocked,"both legacy V2 structures are explicitly rejected");
                Check(Scalar(db,"SELECT total_changes();")==before &&
                      Sql(db,"table","folders")==definition &&
                      Scalar(db,"SELECT count(*) FROM folders WHERE deleted=1;")==1,
                    "legacy rows and old DDL remain untouched on rejection");
            }
            finally{Clean(legacyPath);}
        }

        string brokenPath=Path.Combine(Path.GetTempPath(),
            "ipsys-v3-invalid-"+Guid.NewGuid().ToString("N")+".db");
        try
        {
            using var db=Vault.Connect(brokenPath,"broken-schema-key",create:true);
            Vault.CreateSchema(db);
            using(var change=db.CreateCommand())
            {
                change.CommandText="DROP TRIGGER folder_modified_business;";
                change.ExecuteNonQuery();
            }
            long before=Scalar(db,"SELECT total_changes();");
            bool blocked=false;
            try{Vault.ValidateSchema(db);}
            catch(IOException ex)when(ex.Message.Contains("结构不完整",StringComparison.Ordinal))
            {blocked=true;}
            Check(blocked,"V3 missing a required timestamp trigger is rejected");
            Check(Scalar(db,"SELECT total_changes();")==before &&
                  Sql(db,"trigger","folder_modified_business") is null,
                "validation does not silently recreate a missing trigger");
        }
        finally{Clean(brokenPath);}
        Console.WriteLine("RESOURCE V3 SQLCIPHER SMOKE PASS");
    }
}
