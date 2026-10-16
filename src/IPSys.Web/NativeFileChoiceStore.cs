using Microsoft.Data.Sqlite;
using System.Security.Cryptography;

record NativeFilePreparation(string Ticket,string Workspace,long FolderId,long ObjectId,
    NativeFileMetadataInput Metadata,string? VersionNote,long Size,string Sha256,
    DateTimeOffset ExpiresAt,string? MaterialCategory=null);
record NativeFileDuplicate(long FileId,string Name,int Version,long ObjectId,
    IReadOnlyList<string> Folders);
record NativeFilePrepareResult(string Ticket,string Name,long Size,string Sha256,
    DateTimeOffset ExpiresAt,IReadOnlyList<NativeFileDuplicate> Matches);
record NativeFileDecision(string Choice,long? SourceFileId=null);
record NativeFileDecisionResult(string Choice,long FileId,long LinkId,long Size,
    string Sha256,bool ReusedContent);

static partial class NativeFileChoiceStore
{
    public const int ExpiryMinutes=30;
    private const int ChunkSize=1024*1024;
    internal static SqliteCommand Sql(SqliteConnection db,SqliteTransaction? tx,string text)
    {
        var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText=text;
        return cmd;
    }
    internal static void Bind(SqliteCommand cmd,string workspace,long objectId)
    {
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$id",objectId);
    }
    // Called on opening and closing an encrypted vault. Only uncommitted
    // writing objects are removed; immutable ready objects are never touched.
    public static void CleanupWriting(SqliteConnection db)
    {
        using var tx=db.BeginTransaction();
        using(var chunks=Sql(db,tx,"""
            DELETE FROM file_chunks WHERE object_id IN
            (SELECT id FROM file_objects WHERE state='writing');
            """))chunks.ExecuteNonQuery();
        using(var objs=Sql(db,tx,"DELETE FROM file_objects WHERE state='writing';"))
            objs.ExecuteNonQuery();
        tx.Commit();
    }
    internal static void Discard(SqliteConnection db,NativeFilePreparation pending)
    {
        using var tx=db.BeginTransaction();
        using(var chunks=Sql(db,tx,"""
            DELETE FROM file_chunks WHERE object_id=$id AND workspace=$w
              AND EXISTS(SELECT 1 FROM file_objects
                  WHERE id=$id AND workspace=$w AND state='writing');
            """))
        {
            Bind(chunks,pending.Workspace,pending.ObjectId);
            chunks.ExecuteNonQuery();
        }
        using(var obj=Sql(db,tx,"""
            DELETE FROM file_objects WHERE id=$id AND workspace=$w AND state='writing';
            """))
        {
            Bind(obj,pending.Workspace,pending.ObjectId);
            obj.ExecuteNonQuery();
        }
        tx.Commit();
    }
    internal static NativeFilePreparation Require(Vault vault,string workspace,string ticket)
    {
        var pending=vault.PendingFile;
        if(pending is null || pending.Workspace!=workspace ||
           ticket.Length!=pending.Ticket.Length ||
           !CryptographicOperations.FixedTimeEquals(
               System.Text.Encoding.ASCII.GetBytes(pending.Ticket),
               System.Text.Encoding.ASCII.GetBytes(ticket)))
            throw new KeyNotFoundException("不存在该待确认上传。");
        if(DateTimeOffset.UtcNow>=pending.ExpiresAt)
        {
            Discard(vault.Db,pending);
            vault.PendingFile=null;
            throw new InvalidOperationException("待确认上传已过期，请重新上传。");
        }
        return pending;
    }
    public static async Task<NativeFilePreparation> PrepareAsync(
        SqliteConnection db,string workspace,long folderId,
        NativeFileMetadataInput input,string? versionNote,long expectedSize,
        Stream source,CancellationToken cancellation,string? materialCategory=null)
    {
        if(!Vault.WorkspaceValid(workspace) || folderId<=0)
            throw new ArgumentException("目标工作区或文件夹无效。");
        if(!NativeFileStore.FolderActive(db,workspace,folderId))
            throw new KeyNotFoundException("目标文件夹不存在。");
        if(expectedSize<0 || expectedSize>NativeFileStore.MaxFileLength)
            throw new ArgumentException("待上传文件超过当前 64 MiB 限制。");
        input=NativeFileStore.Normalize(input);
        if(materialCategory!=null &&
           (materialCategory is not ("申请材料" or "通知文件" or "证书文件" or "其他材料") ||
           !NativeIpFileStore.IpActive(db,workspace,folderId)))
            throw new ArgumentException("知识产权材料类别或原件所属分类无效。");
        if(versionNote?.Length>500 || versionNote?.Any(char.IsControl)==true)
            throw new ArgumentException("版本说明无效。");
        versionNote=string.IsNullOrWhiteSpace(versionNote)?null:versionNote.Trim();

        // The complete stream is staged in one SQLCipher transaction. A short,
        // canceled or oversized request rolls back every writing row.
        using var tx=db.BeginTransaction();
        long objectId;
        using(var insert=Sql(db,tx,"""
            INSERT INTO file_objects(workspace,state,expected_size)
            VALUES($w,'writing',$size);
            SELECT last_insert_rowid();
            """))
        {
            insert.Parameters.AddWithValue("$w",workspace);
            insert.Parameters.AddWithValue("$size",expectedSize);
            objectId=(long)insert.ExecuteScalar()!;
        }
        long size=0;int index=0;
        byte[] buffer=new byte[ChunkSize];
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        int read;
        while((read=await source.ReadAsync(buffer,cancellation))>0)
        {
            cancellation.ThrowIfCancellationRequested();
            size+=read;
            if(size>expectedSize || size>NativeFileStore.MaxFileLength)
                throw new IOException("文件实际大小超过声明值。");
            using var chunk=Sql(db,tx,"""
                INSERT INTO file_chunks(object_id,workspace,idx,bytes)
                VALUES($id,$w,$idx,$bytes);
                """);
            Bind(chunk,workspace,objectId);
            chunk.Parameters.AddWithValue("$idx",index++);
            chunk.Parameters.Add("$bytes",SqliteType.Blob).Value=buffer.AsSpan(0,read).ToArray();
            chunk.ExecuteNonQuery();
            hash.AppendData(buffer,0,read);
        }
        cancellation.ThrowIfCancellationRequested();
        if(size!=expectedSize)throw new IOException("文件实际字节数不完整。");
        string digest=Convert.ToHexString(hash.GetHashAndReset());
        using(var update=Sql(db,tx,"""
            UPDATE file_objects SET size=$size,sha256=$digest
            WHERE id=$id AND workspace=$w AND state='writing';
            """))
        {
            Bind(update,workspace,objectId);
            update.Parameters.AddWithValue("$size",size);
            update.Parameters.AddWithValue("$digest",digest);
            if(update.ExecuteNonQuery()!=1)throw new IOException("暂存原件状态异常。");
        }
        tx.Commit();
        return new(Convert.ToHexString(RandomNumberGenerator.GetBytes(24)),
            workspace,folderId,objectId,input,versionNote,size,digest,
            DateTimeOffset.UtcNow.AddMinutes(ExpiryMinutes),materialCategory);
    }
    private static string? FolderPath(SqliteConnection db,string workspace,long folderId)
    {
        var segments=new List<string>();
        var visited=new HashSet<long>();
        long current=folderId;
        while(current>0)
        {
            if(!visited.Add(current))return null;
            using var cmd=Sql(db,null,"""
                SELECT name,parent_id FROM folders
                WHERE workspace=$w AND id=$id AND deleted=0;
                """);
            Bind(cmd,workspace,current);
            using var rd=cmd.ExecuteReader();
            if(!rd.Read())return null;
            segments.Add(rd.GetString(0));
            current=rd.IsDBNull(1)?0:rd.GetInt64(1);
        }
        segments.Reverse();
        return string.Join(" / ",segments);
    }
    public static IReadOnlyList<NativeFileDuplicate> Matches(SqliteConnection db,
        string workspace,long size,string sha256)
    {
        if(!Vault.WorkspaceValid(workspace) || size<0 ||
            sha256.Length!=64 || !sha256.All(Uri.IsHexDigit))
            throw new ArgumentException("查重范围或摘要无效。");
        var result=new List<NativeFileDuplicate>();
        using var cmd=Sql(db,null,"""
            SELECT f.id,f.name,v.version,o.id,l.folder_id
            FROM file_objects o JOIN file_versions v
              ON v.object_id=o.id AND v.workspace=o.workspace AND v.deleted=0
            JOIN files f ON f.id=v.file_id AND f.workspace=v.workspace AND f.deleted=0
            JOIN folder_file_links l ON l.file_id=f.id
              AND l.workspace=f.workspace AND l.deleted=0
            WHERE o.workspace=$w AND o.state='ready'
              AND o.size=$size AND o.sha256=$sha
              AND v.version=(SELECT MAX(other.version) FROM file_versions other
                  WHERE other.file_id=f.id AND other.workspace=f.workspace
                  AND other.deleted=0)
            ORDER BY f.id,l.folder_id;
            """);
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$size",size);
        cmd.Parameters.AddWithValue("$sha",sha256.ToUpperInvariant());
        var rows=new List<(long Id,string Name,int Version,long ObjectId,long FolderId)>();
        using(var rd=cmd.ExecuteReader())
            while(rd.Read())rows.Add((rd.GetInt64(0),rd.GetString(1),rd.GetInt32(2),
                rd.GetInt64(3),rd.GetInt64(4)));
        foreach(var group in rows.GroupBy(x=>x.Id))
        {
            var paths=group.Select(x=>FolderPath(db,workspace,x.FolderId))
                .Where(x=>x is not null).Select(x=>x!).Distinct().ToList();
            if(paths.Count==0)continue;
            var f=group.First();
            result.Add(new(f.Id,f.Name,f.Version,f.ObjectId,paths));
        }
        return result;
    }
}
