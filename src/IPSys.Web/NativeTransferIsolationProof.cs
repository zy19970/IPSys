using Microsoft.Data.Sqlite;

// QA-only evidence from a fresh disposable SQLCipher V2 vault. This checks
// physical FileObject and FileChunk provenance rather than trusting API flags.
static class NativeTransferIsolationProof
{
    private sealed record Item(int Version,long ObjectId,string Workspace,
        string State,long Size,string Hash,long Chunks,long ChunkBytes);

    private static List<Item> Snapshot(SqliteConnection db,string workspace,long fileId)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT v.version,v.object_id,o.workspace,o.state,o.size,o.sha256,
                   (SELECT COUNT(*) FROM file_chunks c
                    WHERE c.object_id=o.id AND c.workspace=o.workspace),
                   (SELECT COALESCE(SUM(length(c.bytes)),0) FROM file_chunks c
                    WHERE c.object_id=o.id AND c.workspace=o.workspace)
            FROM file_versions v
            JOIN file_objects o ON o.id=v.object_id AND o.workspace=v.workspace
            WHERE v.file_id=$file AND v.workspace=$workspace AND v.deleted=0
            ORDER BY v.version;
            """;
        cmd.Parameters.AddWithValue("$file",fileId);
        cmd.Parameters.AddWithValue("$workspace",workspace);
        var result=new List<Item>();
        using var reader=cmd.ExecuteReader();
        while(reader.Read())
            result.Add(new(reader.GetInt32(0),reader.GetInt64(1),
                reader.GetString(2),reader.GetString(3),reader.GetInt64(4),
                reader.GetString(5),reader.GetInt64(6),reader.GetInt64(7)));
        return result;
    }

    public static void Verify(SqliteConnection db,string from,long fromFile,
        string to,long toFile)
    {
        static void Check(bool valid,string why)
        {
            if(!valid)throw new IOException("PHYSICAL ISOLATION: "+why);
        }
        Check(from!=to && fromFile>0 && toFile>0 && fromFile!=toFile,
            "test must compare distinct cross-workspace logical files");
        var src=Snapshot(db,from,fromFile);
        var dst=Snapshot(db,to,toFile);
        Check(src.Count>0 && src.Count==dst.Count,"versions missing or unbalanced");
        for(int i=0;i<src.Count;i++)
        {
            var s=src[i];var d=dst[i];
            Check(s.Version==d.Version,"version sequence changed");
            Check(s.Workspace==from && d.Workspace==to &&
                  s.State=="ready" && d.State=="ready",
                  "physical object belongs to wrong workspace or is not ready");
            Check(s.ObjectId!=d.ObjectId,
                  "cross-workspace versions point to the same physical FileObject");
            Check(s.Size==d.Size && s.Hash==d.Hash,
                  "independently stored version size/hash differs");
            Check(s.ChunkBytes==s.Size && d.ChunkBytes==d.Size &&
                  (s.Size==0 || s.Chunks>0 && d.Chunks>0),
                  "encrypted chunks are incomplete or attached to wrong workspace");
            Console.WriteLine("PHYSICAL ISOLATION PASS: version="+s.Version+
                " companyObject="+(from=="company"?s.ObjectId:d.ObjectId)+
                " personalObject="+(to=="personal"?d.ObjectId:s.ObjectId)+
                " size="+s.Size+" SHA256="+s.Hash);
        }
    }
}
