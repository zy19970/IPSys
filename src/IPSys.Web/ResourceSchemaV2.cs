using Microsoft.Data.Sqlite;

// SQLCipher V3: project, IP and ordinary folders; no legacy migrations.
static class ResourceSchemaV2
{
    public const long Version = 3;

    public static void Create(SqliteConnection db)
    {
        using var tx = db.BeginTransaction();
        using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            CREATE TABLE resource_schema_version(
              id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=3));
            INSERT INTO resource_schema_version VALUES(1,3);

            CREATE TABLE folders(
              id INTEGER PRIMARY KEY,
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              kind TEXT NOT NULL CHECK(kind IN
                ('project','ip','archive_folder')),
              section TEXT NOT NULL DEFAULT '',
              parent_id INTEGER,
              name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 300),
              attributes_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(attributes_json)),
              position INTEGER NOT NULL DEFAULT 0,
              is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(id,workspace),
              FOREIGN KEY(parent_id,workspace) REFERENCES folders(id,workspace) ON DELETE RESTRICT,
              CHECK(kind NOT IN ('project','ip') OR section=''),
              CHECK(kind!='archive_folder' OR
                (workspace='company' AND section IN ('certificate','achievement','party','general','project') OR
                 workspace='personal' AND section IN ('certificate','achievement','academic','general','project'))),
              CHECK(parent_id IS NULL OR kind='archive_folder'),
              CHECK(kind!='archive_folder' OR section!='project' OR parent_id IS NOT NULL),
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
                  AND (NEW.kind='archive_folder' AND
                        ((p.kind='archive_folder' AND p.section=NEW.section)
                         OR (p.kind='project' AND NEW.section='project')))
                  );
            END;
            CREATE TRIGGER folder_parent_update BEFORE UPDATE OF parent_id,section ON folders
            WHEN NEW.parent_id IS NOT NULL BEGIN
              SELECT RAISE(ABORT,'invalid folder parent') WHERE NOT EXISTS(
                SELECT 1 FROM folders p
                WHERE p.id=NEW.parent_id AND p.workspace=NEW.workspace AND p.deleted=0
                  AND (NEW.kind='archive_folder' AND
                        ((p.kind='archive_folder' AND p.section=NEW.section)
                         OR (p.kind='project' AND NEW.section='project')))
                  );
              SELECT RAISE(ABORT,'folder cycle') WHERE NEW.parent_id=NEW.id
                OR EXISTS(WITH RECURSIVE ancestors(id,parent_id) AS (
                  SELECT id,parent_id FROM folders WHERE id=NEW.parent_id
                  UNION ALL
                  SELECT p.id,p.parent_id FROM folders p JOIN ancestors a ON p.id=a.parent_id
                ) SELECT 1 FROM ancestors WHERE id=NEW.id);
            END;
            CREATE TRIGGER folder_immutable_scope BEFORE UPDATE OF
              workspace,kind,section,is_system ON folders
            WHEN NEW.workspace<>OLD.workspace OR NEW.kind<>OLD.kind
              OR NEW.is_system<>OLD.is_system
              OR (NEW.section<>OLD.section AND OLD.kind<>'archive_folder') BEGIN
              SELECT RAISE(ABORT,'folder identity immutable');
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
                AND EXISTS(SELECT 1 FROM file_versions
                  WHERE object_id=OLD.object_id AND workspace=OLD.workspace)
              BEGIN SELECT RAISE(ABORT,'completed content bytes are still referenced'); END;

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

            CREATE TRIGGER folder_created_insert
            AFTER INSERT ON folders WHEN NEW.created_at IS NULL BEGIN
              UPDATE folders SET created_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
              WHERE id=NEW.id;
            END;
            CREATE TRIGGER folder_modified_insert
            AFTER INSERT ON folders BEGIN
              UPDATE folders SET modified_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
              WHERE id=NEW.id;
            END;
            CREATE TRIGGER folder_modified_business
            AFTER UPDATE OF name,attributes_json,parent_id,section ON folders
            WHEN NEW.name IS NOT OLD.name OR NEW.attributes_json IS NOT OLD.attributes_json
              OR NEW.parent_id IS NOT OLD.parent_id OR NEW.section IS NOT OLD.section
            BEGIN
              UPDATE folders SET modified_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
              WHERE id=NEW.id;
            END;
            CREATE TRIGGER folder_modified_link_insert
            AFTER INSERT ON folder_file_links BEGIN
              UPDATE folders SET modified_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
              WHERE id=NEW.folder_id;
            END;
            CREATE TRIGGER folder_modified_link_update
            AFTER UPDATE OF deleted,folder_id,file_id ON folder_file_links
            WHEN NEW.deleted IS NOT OLD.deleted OR NEW.folder_id IS NOT OLD.folder_id
              OR NEW.file_id IS NOT OLD.file_id
            BEGIN
              UPDATE folders SET modified_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
              WHERE id=OLD.folder_id;
              UPDATE folders SET modified_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
              WHERE id=NEW.folder_id;
            END;
            CREATE TRIGGER folder_modified_version_insert
            AFTER INSERT ON file_versions BEGIN
              UPDATE folders SET modified_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
              WHERE id IN (SELECT folder_id FROM folder_file_links
                  WHERE workspace=NEW.workspace AND file_id=NEW.file_id AND deleted=0);
            END;

            -- MCP retry ledger lives inside the encrypted vault. A pending row
            -- after abnormal shutdown is intentionally not re-executed automatically.
            CREATE TABLE mcp_operations(
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 8 AND 128),
              tool_name TEXT NOT NULL,
              arguments_hash TEXT NOT NULL CHECK(length(arguments_hash)=64),
              state TEXT NOT NULL CHECK(state IN ('pending','done','uncertain')),
              result_json TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(workspace,request_id));
            CREATE INDEX idx_mcp_operations_created ON mcp_operations(workspace,created_at DESC);

            -- Initial archive folders are ordinary user-manageable folders.
            -- Do not recreate missing seeds on later vault opens.
            INSERT INTO folders(workspace,kind,section,name,position)
            VALUES('company','archive_folder','achievement','申报与认定',0),
                  ('company','archive_folder','achievement','规划与管理',1),
                  ('company','archive_folder','achievement','汇报与宣传',2),
                  ('company','archive_folder','achievement','会议与活动',3),
                  ('company','archive_folder','achievement','专项工作与合作',4),
                  ('company','archive_folder','achievement','政策与行业资料',5),
                  ('company','archive_folder','achievement','其他业务资料',6);
            """;
        cmd.ExecuteNonQuery();
        tx.Commit();
    }

    // An existing vault is only inspected, never repaired or migrated.
    public static void Validate(SqliteConnection db)
    {
        using var cmd=db.CreateCommand();
        try
        {
            cmd.CommandText="SELECT version FROM resource_schema_version WHERE id=1;";
            var actual=cmd.ExecuteScalar();
            if(actual is null || actual is DBNull || Convert.ToInt64(actual)!=Version)
                throw new IOException("此资料库结构不受当前版本支持，请保留原库并新建资料库。旧库不会被迁移或覆盖。");
            string Definition(string type,string name)
            {
                cmd.Parameters.Clear();
                cmd.CommandText="SELECT sql FROM sqlite_master WHERE type=$type AND name=$name;";
                cmd.Parameters.AddWithValue("$type",type);
                cmd.Parameters.AddWithValue("$name",name);
                return cmd.ExecuteScalar() as string ?? "";
            }
            string[] tables=["resource_schema_version","folders","files","file_versions",
                "file_objects","file_chunks","folder_file_links","mcp_operations"];
            string[] indexes=["idx_folder_children","idx_archive_sibling_names",
                "idx_folder_type","idx_files_name","idx_versions_latest",
                "idx_folder_file_active","idx_folder_file_list","idx_folder_file_reverse",
                "idx_mcp_operations_created"];
            string[] triggers=["folder_parent_insert","folder_parent_update",
                "folder_immutable_scope","object_immutable_ready","chunk_insert_ready",
                "chunk_update_ready","chunk_delete_ready","version_ready_insert",
                "version_immutable","link_active_targets","folder_created_insert",
                "folder_modified_insert","folder_modified_business",
                "folder_modified_link_insert","folder_modified_link_update",
                "folder_modified_version_insert"];
            foreach(var table in tables)
                if(Definition("table",table).Length==0)
                    throw new IOException("资料库结构不完整：缺少表 "+table+"。");
            foreach(var index in indexes)
                if(Definition("index",index).Length==0)
                    throw new IOException("资料库结构不完整：缺少索引 "+index+"。");
            foreach(var trigger in triggers)
                if(Definition("trigger",trigger).Length==0)
                    throw new IOException("资料库结构不完整：缺少触发器 "+trigger+"。");
            var missing=new HashSet<string>(StringComparer.Ordinal){
                "id","workspace","kind","section","parent_id","name",
                "attributes_json","position","is_system","deleted","created_at","modified_at"};
            cmd.Parameters.Clear();
            cmd.CommandText="PRAGMA table_info(folders);";
            using(var rd=cmd.ExecuteReader())
                while(rd.Read())missing.Remove(rd.GetString(1));
            if(missing.Count>0)
                throw new IOException("资料库结构不完整：缺少文件夹字段 "+string.Join(",",missing)+"。");
            string folders=Definition("table","folders");
            if(folders.Contains("'contract'",StringComparison.Ordinal) ||
               !folders.Contains("'project'",StringComparison.Ordinal) ||
               !folders.Contains("'ip'",StringComparison.Ordinal) ||
               !folders.Contains("'archive_folder'",StringComparison.Ordinal) ||
               !folders.Contains("section!='project' OR parent_id IS NOT NULL",StringComparison.Ordinal))
                throw new IOException("资料库结构不完整：文件夹模型约束无效。");
            string parent=Definition("trigger","folder_parent_update");
            if(!parent.Contains("NEW.section",StringComparison.Ordinal) ||
               !parent.Contains("p.kind='project'",StringComparison.Ordinal) ||
               !parent.Contains("folder cycle",StringComparison.Ordinal))
                throw new IOException("资料库结构不完整：项目目录父级约束无效。");
            if(!Definition("trigger","folder_modified_business")
                .Contains("NEW.section",StringComparison.Ordinal))
                throw new IOException("资料库结构不完整：目录更新时间触发器无效。");
            if(!Definition("trigger","chunk_delete_ready")
                .Contains("file_versions",StringComparison.Ordinal))
                throw new IOException("资料库结构不完整：原件清理保护无效。");
            cmd.Parameters.Clear();
            cmd.CommandText="SELECT count(*) FROM folders WHERE kind NOT IN ('project','ip','archive_folder');";
            if((long)cmd.ExecuteScalar()!>0)
                throw new IOException("资料库包含已退出的业务对象，请保留原库并新建资料库。");
        }
        catch(SqliteException ex)
        {
            throw new IOException("此资料库结构不受当前版本支持或结构不完整，请保留原库并新建资料库。",ex);
        }
    }
}
