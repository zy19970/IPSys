using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

record NativeFileMetadataInput(string? Name,string? Description=null,string? Tags=null,
    string? FileNumber=null,string? FileDate=null);
record NativeFileVersion(long Id,int Version,string OriginalName,string? VersionNote,
    long Size,string Sha256,string CreatedAt);
record NativeFileDetails(long Id,string Workspace,string Name,string? Description,
    string? Tags,string? FileNumber,string? FileDate,
    IReadOnlyList<NativeFileVersion> Versions);
record NativeFileUploadResult(long FileId,int Version,long Size,string Sha256);

// N3-01: one FileId / independent content per upload. Link to the first folder
// is atomic with creation; general sharing and deduplication are N3-02/N3-03/04.
static class NativeFileStore
{
    public const long MaxFileLength=64L*1024*1024;
    private const int ChunkSize=1024*1024;

    private static string ValidName(string? name)
    {
        name=name?.Trim()??"";
        if(name.Length is 0 or >240 || name is "." or ".." ||
           name.Any(c=>char.IsControl(c) || "\\/:*?\"<>|".Contains(c)))
            throw new ArgumentException("文件名不合法（须为原始文件名，不含路径）。");
        return name;
    }
    private static string? Optional(string? value,int limit,string label)
    {
        if(value==null)return null;
        value=value.Trim();
        if(value.Length>limit || value.Any(char.IsControl))
            throw new ArgumentException(label+"包含无效字符或过长。");
        return value.Length==0?null:value;
    }
    private static NativeFileMetadataInput Normalize(NativeFileMetadataInput input)
    {
        string? date=Optional(input.FileDate,32,"文件日期");
        if(date!=null && (!DateOnly.TryParseExact(date,"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.None,out _)))
            throw new ArgumentException("文件日期格式应为 yyyy-MM-dd。");
        return new(ValidName(input.Name),Optional(input.Description,2000,"文件说明"),
            Optional(input.Tags,500,"标签"),Optional(input.FileNumber,120,"文件编号"),date);
    }
    private static void Scope(string workspace)
    {
        if(!Vault.WorkspaceValid(workspace))throw new ArgumentException("工作区无效。");
    }
    private static void Bind(SqliteCommand cmd,string workspace,long id)
    {
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$id",id);
    }
    private static bool FolderActive(SqliteConnection db,string workspace,long folderId)
    {
        if(folderId<=0)return false;
        long current=folderId;
        var visited=new HashSet<long>();
        while(current>0)
        {
            if(!visited.Add(current))return false;
            using var cmd=db.CreateCommand();
            cmd.CommandText="SELECT parent_id FROM folders WHERE id=$id AND workspace=$w AND deleted=0;";
            Bind(cmd,workspace,current);
            var parent=cmd.ExecuteScalar();
            if(parent==null)return false;
            current=parent==DBNull.Value?0:Convert.ToInt64(parent);
        }
        return true;
    }
    private static bool Accessible(SqliteConnection db,string workspace,long fileId)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT folder_id FROM folder_file_links
            WHERE workspace=$w AND file_id=$id AND deleted=0
              AND EXISTS(SELECT 1 FROM files WHERE id=$id AND workspace=$w AND deleted=0);
            """;
        Bind(cmd,workspace,fileId);
        using var rd=cmd.ExecuteReader();
        var ids=new List<long>();
        while(rd.Read())ids.Add(rd.GetInt64(0));
        // Dispose the reader before executing queries against the same connection.
        rd.Close();
        return ids.Any(id=>FolderActive(db,workspace,id));
    }
    private static long NewId(SqliteConnection db,SqliteTransaction tx,string sql,
        Action<SqliteCommand> bind)
    {
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;cmd.CommandText=sql+"; SELECT last_insert_rowid();";
        bind(cmd);
        return (long)cmd.ExecuteScalar()!;
    }
    private static void Exec(SqliteConnection db,SqliteTransaction tx,string sql,
        Action<SqliteCommand> bind)
    {
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;cmd.CommandText=sql;bind(cmd);
        if(cmd.ExecuteNonQuery()!=1)throw new IOException("写入加密资源失败。");
    }
    public static async Task<NativeFileUploadResult> UploadAsync(
        SqliteConnection db,string workspace,long? folderId,long? fileId,
        NativeFileMetadataInput input,string? versionNote,long expectedLength,
        Stream body,CancellationToken cancellation)
    {
        Scope(workspace);
        if(expectedLength<0 || expectedLength>MaxFileLength)
            throw new ArgumentException("本阶段单文件限制 64 MiB 且必须声明准确长度。");
        var data=Normalize(input);
        versionNote=Optional(versionNote,500,"版本说明");
        if((folderId is null)==(fileId is null))
            throw new ArgumentException("新文件须指定 FolderId，新增版本须指定 FileId。");
        if(folderId.HasValue && !FolderActive(db,workspace,folderId.Value))
            throw new KeyNotFoundException("文件所属文件夹不存在或已删除。");
        if(fileId.HasValue && !Accessible(db,workspace,fileId.Value))
            throw new KeyNotFoundException("文件不可访问或没有有效文件夹归属。");

        // Keep a single transaction until ready content, version and first link all exist.
        // Cancellation/short body/IO errors dispose the transaction without any orphan.
        using var tx=db.BeginTransaction();
        long id=fileId??NewId(db,tx,
            "INSERT INTO files(workspace,name,description,tags,file_number,file_date) VALUES($w,$name,$desc,$tags,$num,$date)",
            cmd=>{
                cmd.Parameters.AddWithValue("$w",workspace);
                cmd.Parameters.AddWithValue("$name",data.Name!);
                cmd.Parameters.AddWithValue("$desc",(object?)data.Description??DBNull.Value);
                cmd.Parameters.AddWithValue("$tags",(object?)data.Tags??DBNull.Value);
                cmd.Parameters.AddWithValue("$num",(object?)data.FileNumber??DBNull.Value);
                cmd.Parameters.AddWithValue("$date",(object?)data.FileDate??DBNull.Value);
            });
        long objectId=NewId(db,tx,
            "INSERT INTO file_objects(workspace,state,expected_size) VALUES($w,'writing',$size)",
            cmd=>{
                cmd.Parameters.AddWithValue("$w",workspace);
                cmd.Parameters.AddWithValue("$size",expectedLength);
            });
        long total=0;int idx=0;var buffer=new byte[ChunkSize];
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        int count;
        while((count=await body.ReadAsync(buffer,cancellation))>0)
        {
            cancellation.ThrowIfCancellationRequested();
            total+=count;
            if(total>expectedLength || total>MaxFileLength)
                throw new IOException("实际原件长度超过声明长度。");
            Exec(db,tx,
                "INSERT INTO file_chunks(object_id,workspace,idx,bytes) VALUES($obj,$w,$idx,$bytes)",
                cmd=>{
                    cmd.Parameters.AddWithValue("$obj",objectId);
                    cmd.Parameters.AddWithValue("$w",workspace);
                    cmd.Parameters.AddWithValue("$idx",idx++);
                    cmd.Parameters.Add("$bytes",SqliteType.Blob).Value=buffer.AsSpan(0,count).ToArray();
                });
            hash.AppendData(buffer,0,count);
        }
        cancellation.ThrowIfCancellationRequested();
        if(total!=expectedLength)throw new IOException("原件字节数与声明长度不符，已取消本次写入。");
        string digest=Convert.ToHexString(hash.GetHashAndReset());
        Exec(db,tx,"UPDATE file_objects SET state='ready',size=$size,sha256=$sha WHERE id=$id AND workspace=$w AND state='writing'",
            cmd=>{
                Bind(cmd,workspace,objectId);
                cmd.Parameters.AddWithValue("$size",total);
                cmd.Parameters.AddWithValue("$sha",digest);
            });
        int version=1;
        if(fileId.HasValue)
        {
            using var latest=db.CreateCommand();
            latest.Transaction=tx;
            latest.CommandText="SELECT COALESCE(MAX(version),0)+1 FROM file_versions WHERE file_id=$id AND workspace=$w;";
            Bind(latest,workspace,id);
            version=Convert.ToInt32(latest.ExecuteScalar());
        }
        NewId(db,tx,
            "INSERT INTO file_versions(file_id,workspace,version,object_id,original_name,version_note) VALUES($file,$w,$v,$obj,$name,$note)",
            cmd=>{
                cmd.Parameters.AddWithValue("$file",id);
                cmd.Parameters.AddWithValue("$w",workspace);
                cmd.Parameters.AddWithValue("$v",version);
                cmd.Parameters.AddWithValue("$obj",objectId);
                cmd.Parameters.AddWithValue("$name",data.Name!);
                cmd.Parameters.AddWithValue("$note",(object?)versionNote??DBNull.Value);
            });
        if(folderId.HasValue)
        {
            NewId(db,tx,
                "INSERT INTO folder_file_links(workspace,folder_id,file_id) VALUES($w,$folder,$file)",
                cmd=>{
                    cmd.Parameters.AddWithValue("$w",workspace);
                    cmd.Parameters.AddWithValue("$folder",folderId.Value);
                    cmd.Parameters.AddWithValue("$file",id);
                });
        }
        tx.Commit();
        return new(id,version,total,digest);
    }
    public static NativeFileDetails? Get(SqliteConnection db,string workspace,long fileId)
    {
        Scope(workspace);
        if(!Accessible(db,workspace,fileId))return null;
        string name;string? description,tags,number,date;
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="SELECT name,description,tags,file_number,file_date FROM files WHERE id=$id AND workspace=$w AND deleted=0;";
            Bind(cmd,workspace,fileId);
            using var rd=cmd.ExecuteReader();
            if(!rd.Read())return null;
            name=rd.GetString(0);description=rd.IsDBNull(1)?null:rd.GetString(1);
            tags=rd.IsDBNull(2)?null:rd.GetString(2);
            number=rd.IsDBNull(3)?null:rd.GetString(3);
            date=rd.IsDBNull(4)?null:rd.GetString(4);
        }
        var versions=new List<NativeFileVersion>();
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                SELECT v.id,v.version,v.original_name,v.version_note,
                       o.size,o.sha256,v.created_at
                FROM file_versions v JOIN file_objects o
                  ON o.id=v.object_id AND o.workspace=v.workspace
                WHERE v.file_id=$id AND v.workspace=$w AND v.deleted=0
                  AND o.state='ready' ORDER BY v.version DESC;
                """;
            Bind(cmd,workspace,fileId);
            using var rd=cmd.ExecuteReader();
            while(rd.Read())
                versions.Add(new(rd.GetInt64(0),rd.GetInt32(1),rd.GetString(2),
                    rd.IsDBNull(3)?null:rd.GetString(3),rd.GetInt64(4),
                    rd.GetString(5),rd.GetString(6)));
        }
        return new(fileId,workspace,name,description,tags,number,date,versions);
    }
    public static bool UpdateMetadata(SqliteConnection db,string workspace,long fileId,
        NativeFileMetadataInput input)
    {
        Scope(workspace);
        var data=Normalize(input);
        if(!Accessible(db,workspace,fileId))return false;
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            UPDATE files SET name=$name,description=$desc,tags=$tags,
            file_number=$num,file_date=$date
            WHERE id=$id AND workspace=$w AND deleted=0;
            """;
        Bind(cmd,workspace,fileId);
        cmd.Parameters.AddWithValue("$name",data.Name!);
        cmd.Parameters.AddWithValue("$desc",(object?)data.Description??DBNull.Value);
        cmd.Parameters.AddWithValue("$tags",(object?)data.Tags??DBNull.Value);
        cmd.Parameters.AddWithValue("$num",(object?)data.FileNumber??DBNull.Value);
        cmd.Parameters.AddWithValue("$date",(object?)data.FileDate??DBNull.Value);
        return cmd.ExecuteNonQuery()==1;
    }
    public static (long ObjectId,string OriginalName,long Size,string Digest)? DownloadInfo(
        SqliteConnection db,string workspace,long fileId,int version)
    {
        if(!Vault.WorkspaceValid(workspace) || version<=0 ||
            !Accessible(db,workspace,fileId))return null;
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT v.object_id,v.original_name,o.size,o.sha256
            FROM file_versions v JOIN file_objects o ON o.id=v.object_id
            AND o.workspace=v.workspace
            WHERE v.file_id=$id AND v.workspace=$w AND v.version=$version
            AND v.deleted=0 AND o.state='ready';
            """;
        Bind(cmd,workspace,fileId);
        cmd.Parameters.AddWithValue("$version",version);
        using var rd=cmd.ExecuteReader();
        return rd.Read()?(rd.GetInt64(0),rd.GetString(1),rd.GetInt64(2),rd.GetString(3)):null;
    }
    public static async Task CopyAsync(SqliteConnection db,string workspace,long objectId,
        Stream destination,CancellationToken cancellation)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT bytes FROM file_chunks WHERE object_id=$id AND workspace=$w ORDER BY idx;
            """;
        Bind(cmd,workspace,objectId);
        using var rd=cmd.ExecuteReader();
        while(rd.Read())
            await destination.WriteAsync(rd.GetFieldValue<byte[]>(0),cancellation);
    }
}
