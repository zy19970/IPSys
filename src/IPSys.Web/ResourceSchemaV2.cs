using Microsoft.Data.Sqlite;

// SQLCipher v2: canonical model for newly created vaults. No legacy migration.
static class ResourceSchemaV2
{
    public const long Version = 2;

    public static void Create(SqliteConnection db)
    {
        using var tx = db.BeginTransaction();
        using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            CREATE TABLE resource_schema_version(
              id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=2));
            INSERT INTO resource_schema_version VALUES(1,2);

            CREATE TABLE folders(
              id INTEGER PRIMARY KEY,
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              kind TEXT NOT NULL CHECK(kind IN
                ('project','contract','ip','archive','archive_folder','general')),
              section TEXT NOT NULL DEFAULT '',
              parent_id INTEGER,
              name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 300),
              attributes_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(attributes_json)),
              position INTEGER NOT NULL DEFAULT 0,
              is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
              UNIQUE(id,workspace),
              FOREIGN KEY(parent_id,workspace) REFERENCES folders(id,workspace) ON DELETE RESTRICT,
              CHECK(kind!='contract' OR parent_id IS NOT NULL),
              CHECK(kind NOT IN ('project','contract','ip','general') OR section=''),
              CHECK(kind!='archive_folder' OR
                (workspace='company' AND section='achievement')),
              CHECK(kind!='archive' OR
                (workspace='company' AND section IN ('certificate','achievement') OR
                 workspace='personal' AND section IN ('certificate','achievement','academic'))),
              CHECK(parent_id IS NULL OR kind IN ('contract','archive_folder','archive')),
              CHECK(kind!='archive' OR section='achievement' OR parent_id IS NULL),
              CHECK(is_system=0 OR
                (kind='archive_folder' AND parent_id IS NULL AND workspace='company')));
            CREATE INDEX idx_folder_children ON folders(workspace,parent_id,position,id)
              WHERE deleted=0;
            CREATE UNIQUE INDEX idx_archive_sibling_names
              ON folders(workspace,section,COALESCE(parent_id,0),name COLLATE NOCASE)
              WHERE kind='archive_folder' AND deleted=0;
            CREATE INDEX idx_folder_type ON folders(workspace,kind,section,deleted);

            CREATE TRIGGER folder_parent_insert BEFORE INSERT ON folders
            WHEN NEW.parent_id IS NOT NULL BEGIN
              SELECT RAISE(ABORT,'invalid folder parent') WHERE NOT EXISTS(
                SELECT 1 FROM folders p
                WHERE p.id=NEW.parent_id AND p.workspace=NEW.workspace AND p.deleted=0
                  AND ((NEW.kind='contract' AND p.kind='project')
                    OR (NEW.kind='archive_folder' AND p.kind='archive_folder'
                        AND p.section='achievement')
                    OR (NEW.kind='archive' AND NEW.section='achievement'
                        AND NEW.workspace='company' AND p.kind='archive_folder'
                        AND p.section='achievement')));
            END;
            CREATE TRIGGER folder_parent_update BEFORE UPDATE OF parent_id ON folders
            WHEN NEW.parent_id IS NOT NULL BEGIN
              SELECT RAISE(ABORT,'invalid folder parent') WHERE NOT EXISTS(
                SELECT 1 FROM folders p
                WHERE p.id=NEW.parent_id AND p.workspace=NEW.workspace AND p.deleted=0
                  AND ((NEW.kind='contract' AND p.kind='project')
                    OR (NEW.kind='archive_folder' AND p.kind='archive_folder'
                        AND p.section='achievement')
                    OR (NEW.kind='archive' AND NEW.section='achievement'
                        AND NEW.workspace='company' AND p.kind='archive_folder'
                        AND p.section='achievement')));
              SELECT RAISE(ABORT,'folder cycle') WHERE NEW.parent_id=NEW.id
                OR EXISTS(WITH RECURSIVE ancestors(id,parent_id) AS (
                  SELECT id,parent_id FROM folders WHERE id=NEW.parent_id
                  UNION ALL
                  SELECT p.id,p.parent_id FROM folders p JOIN ancestors a ON p.id=a.parent_id
                ) SELECT 1 FROM ancestors WHERE id=NEW.id);
            END;
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

            CREATE TABLE files(
              id INTEGER PRIMARY KEY,
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 240),
              description TEXT, tags TEXT, file_number TEXT, file_date TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
              UNIQUE(id,workspace));
            CREATE INDEX idx_files_name ON files(workspace,name,deleted);

            CREATE TABLE file_objects(
              id INTEGER PRIMARY KEY,
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              state TEXT NOT NULL CHECK(state IN ('writing','ready')),
              expected_size INTEGER NOT NULL CHECK(expected_size>=0),
              size INTEGER CHECK(size>=0),sha256 TEXT,
              UNIQUE(id,workspace),
              CHECK(state!='ready' OR
                (size IS NOT NULL AND length(sha256)=64 AND size=expected_size)));
            CREATE INDEX idx_object_content ON file_objects(workspace,size,sha256)
              WHERE state='ready';
            CREATE TRIGGER object_immutable_ready BEFORE UPDATE ON file_objects
              WHEN OLD.state='ready' BEGIN
              SELECT RAISE(ABORT,'completed content object is immutable');
            END;
            CREATE TABLE file_chunks(
              object_id INTEGER NOT NULL,workspace TEXT NOT NULL,
              idx INTEGER NOT NULL CHECK(idx>=0),bytes BLOB NOT NULL,
              PRIMARY KEY(object_id,idx),
              FOREIGN KEY(object_id,workspace) REFERENCES file_objects(id,workspace)
                ON DELETE RESTRICT);

            CREATE TRIGGER chunk_insert_ready BEFORE INSERT ON file_chunks
              WHEN EXISTS(SELECT 1 FROM file_objects
                WHERE id=NEW.object_id AND workspace=NEW.workspace AND state='ready')
              BEGIN SELECT RAISE(ABORT,'completed content bytes are immutable'); END;
            CREATE TRIGGER chunk_update_ready BEFORE UPDATE ON file_chunks
              WHEN EXISTS(SELECT 1 FROM file_objects
                WHERE id=OLD.object_id AND workspace=OLD.workspace AND state='ready')
              BEGIN SELECT RAISE(ABORT,'completed content bytes are immutable'); END;
            CREATE TRIGGER chunk_delete_ready BEFORE DELETE ON file_chunks
              WHEN EXISTS(SELECT 1 FROM file_objects
                WHERE id=OLD.object_id AND workspace=OLD.workspace AND state='ready')
              BEGIN SELECT RAISE(ABORT,'completed content bytes are immutable'); END;

            CREATE TABLE file_versions(
              id INTEGER PRIMARY KEY,file_id INTEGER NOT NULL,
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              version INTEGER NOT NULL CHECK(version>0),object_id INTEGER NOT NULL,
              original_name TEXT NOT NULL CHECK(length(trim(original_name)) BETWEEN 1 AND 240),
              version_note TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
              UNIQUE(file_id,version),
              FOREIGN KEY(file_id,workspace) REFERENCES files(id,workspace) ON DELETE RESTRICT,
              FOREIGN KEY(object_id,workspace) REFERENCES file_objects(id,workspace) ON DELETE RESTRICT);
            CREATE INDEX idx_versions_latest ON file_versions(file_id,version DESC)
              WHERE deleted=0;
            CREATE TRIGGER version_ready_insert BEFORE INSERT ON file_versions BEGIN
              SELECT RAISE(ABORT,'physical object is not ready') WHERE NOT EXISTS(
                SELECT 1 FROM file_objects WHERE id=NEW.object_id
                 AND workspace=NEW.workspace AND state='ready');
            END;
            CREATE TRIGGER version_immutable BEFORE UPDATE OF
              file_id,workspace,version,object_id,original_name ON file_versions BEGIN
              SELECT RAISE(ABORT,'file history immutable');
            END;

            CREATE TABLE folder_file_links(
              id INTEGER PRIMARY KEY,
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              folder_id INTEGER NOT NULL,file_id INTEGER NOT NULL,
              display_name TEXT,material_category TEXT,
              position INTEGER NOT NULL DEFAULT 0,
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
              FOREIGN KEY(folder_id,workspace) REFERENCES folders(id,workspace) ON DELETE RESTRICT,
              FOREIGN KEY(file_id,workspace) REFERENCES files(id,workspace) ON DELETE RESTRICT);
            CREATE UNIQUE INDEX idx_folder_file_active ON folder_file_links(folder_id,file_id)
              WHERE deleted=0;
            CREATE INDEX idx_folder_file_list ON folder_file_links(workspace,folder_id,position,id)
              WHERE deleted=0;
            CREATE INDEX idx_folder_file_reverse ON folder_file_links(workspace,file_id)
              WHERE deleted=0;
            CREATE TRIGGER link_active_targets BEFORE INSERT ON folder_file_links BEGIN
              SELECT RAISE(ABORT,'invalid folder/file association') WHERE
                NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id
                  AND workspace=NEW.workspace AND deleted=0)
                OR NOT EXISTS(SELECT 1 FROM files WHERE id=NEW.file_id
                  AND workspace=NEW.workspace AND deleted=0);
            END;

            INSERT INTO folders(workspace,kind,section,name,position,is_system)
            VALUES('company','archive_folder','achievement','申报与认定',0,1),
                  ('company','archive_folder','achievement','规划与管理',1,1),
                  ('company','archive_folder','achievement','汇报与宣传',2,1),
                  ('company','archive_folder','achievement','会议与活动',3,1),
                  ('company','archive_folder','achievement','专项工作与合作',4,1),
                  ('company','archive_folder','achievement','政策与行业资料',5,1),
                  ('company','archive_folder','achievement','其他业务资料',6,1);
            """;
        cmd.ExecuteNonQuery();
        tx.Commit();
    }

    public static void Validate(SqliteConnection db)
    {
        using var cmd=db.CreateCommand();
        try
        {
            cmd.CommandText="SELECT version FROM resource_schema_version WHERE id=1;";
            if (Convert.ToInt64(cmd.ExecuteScalar())!=Version)
                throw new IOException("资料库不是新版统一资源数据库，请新建资料库。");
            foreach(var table in new[]{"folders","files","file_versions","file_objects",
                "file_chunks","folder_file_links"})
            {
                cmd.CommandText="SELECT count(*) FROM sqlite_master WHERE type='table' AND name=$table;";
                cmd.Parameters.Clear();
                cmd.Parameters.AddWithValue("$table",table);
                if((long)cmd.ExecuteScalar()! != 1)
                    throw new IOException("新版资料库缺少表："+table);
            }
        }
        catch(SqliteException ex)
        {
            throw new IOException("旧测试库不再兼容，请新建新版资料库；旧文件不会被覆盖。",ex);
        }
    }
}
