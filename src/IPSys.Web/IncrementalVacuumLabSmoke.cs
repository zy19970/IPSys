using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;

// Only disposable SQLCipher databases under Path.GetTempPath().
// This laboratory does not change production Vault.Connect/CreateSchema defaults.
static class IncrementalVacuumLabSmoke
{
    private const int MiB = 1024 * 1024;
    private const int BatchPages = 256;

    private sealed record ModeMetrics(
        string Mode, int PayloadMiB, int ActualAutoVacuum,
        long FileBytesAfterPurge, long FileBytesAfterReclaim,
        long PagesBefore, long PagesAfter, long FreePagesBefore, long FreePagesAfter,
        int VacuumBatches, long UploadMilliseconds, long ReclaimMilliseconds);

    private static void Check(bool ok, string detail)
    {
        if (!ok) throw new IOException("SQLCIPHER INCREMENTAL LAB: " + detail);
    }

    private static long Scalar(SqliteConnection db, string sql)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    private static void Exec(SqliteConnection db, string sql)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 0;
        cmd.ExecuteNonQuery();
    }

    private static long Project(SqliteConnection db, string name)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO folders(workspace,kind,name)
            VALUES('company','project',$name);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$name",name);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    private static long Link(SqliteConnection db, long fileId, long folderId)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT id FROM folder_file_links WHERE file_id=$file AND folder_id=$folder;
            """;
        cmd.Parameters.AddWithValue("$file",fileId);
        cmd.Parameters.AddWithValue("$folder",folderId);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    private static void Purge(SqliteConnection db, long fileId, long linkId)
    {
        Check(NativeFileLinkStore.Unlink(db,"company",fileId,linkId),
            "soft unlink must succeed before physical purge");
        Check(RecycleStore.Change(db,"company",
            [new RecycleKey("v2_file",linkId,"")],true),
            "permanent purge must succeed and obey shared reference rules");
    }

    private static byte[] Bytes(int count, int seed)
    {
        byte[] bytes = new byte[count];
        new Random(seed).NextBytes(bytes);
        return bytes;
    }

    private static void VerifyFile(SqliteConnection db, long fileId,
        int version, byte[] expected)
    {
        var info = NativeFileStore.DownloadInfo(db,"company",fileId,version);
        Check(info.HasValue, "preserved file/version must remain accessible");
        using var output = new MemoryStream();
        NativeFileStore.CopyAsync(db,"company",info!.Value.ObjectId,output,
            CancellationToken.None).GetAwaiter().GetResult();
        byte[] actual = output.ToArray();
        Check(actual.AsSpan().SequenceEqual(expected) &&
              SHA256.HashData(actual).AsSpan().SequenceEqual(SHA256.HashData(expected)),
            "content bytes/SHA-256 changed during delete or incremental reclaim");
    }

    private static void Integrity(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandTimeout = 0;
        cmd.CommandText = "PRAGMA integrity_check;";
        Check(string.Equals(Convert.ToString(cmd.ExecuteScalar()),"ok",
                StringComparison.OrdinalIgnoreCase),
            "SQLCipher integrity_check must return ok");
        cmd.CommandText = "PRAGMA foreign_key_check;";
        using var rows = cmd.ExecuteReader();
        Check(!rows.Read(),"schema foreign-key check must have zero violations");
    }

    private static ModeMetrics One(bool incremental, int sizeMiB)
    {
        string mode = incremental ? "INCREMENTAL" : "NONE";
        string dir = Path.Combine(Path.GetTempPath(),
            "ipsys-incremental-lab-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        string path = Path.Combine(dir,"lab.db");
        string password = "lab-only-" + Guid.NewGuid().ToString("N");
        byte[] survivor = Bytes(MiB + 67,201);
        byte[] disposable = Bytes(checked(sizeMiB * MiB + 19),202);
        byte[] revision = Bytes(checked(sizeMiB * MiB / 2 + 31),203);
        long keepId;
        long beforeBytes, afterBytes, beforePages, afterPages, beforeFree, afterFree;
        int batches=0;
        var uploadClock = new Stopwatch();
        var reclaimClock = new Stopwatch();

        try
        {
            using (var db = Vault.Connect(path,password,create:true))
            {
                // Set mode on a NEW, EMPTY encrypted database only, before tables.
                Exec(db,incremental
                    ? "PRAGMA auto_vacuum=INCREMENTAL;"
                    : "PRAGMA auto_vacuum=NONE;");
                Check(Scalar(db,"PRAGMA auto_vacuum;")==(incremental?2:0),
                    "mode must be set before schema creation");
                Vault.CreateSchema(db);
                Vault.ValidateSchema(db);
                Check(Scalar(db,"PRAGMA auto_vacuum;")==(incremental?2:0),
                    "mode must persist after IPSys schema creation");

                long source = Project(db,"实验源目录");
                long target = Project(db,"实验共享目录");
                uploadClock.Start();
                var keep = NativeFileStore.UploadAsync(db,"company",target,null,
                    new NativeFileMetadataInput("保留原件.bin"),null,survivor.LongLength,
                    new MemoryStream(survivor),CancellationToken.None)
                    .GetAwaiter().GetResult();
                keepId = keep.FileId;
                var file = NativeFileStore.UploadAsync(db,"company",source,null,
                    new NativeFileMetadataInput("待清理原件.bin"),null,disposable.LongLength,
                    new MemoryStream(disposable),CancellationToken.None)
                    .GetAwaiter().GetResult();
                var second = NativeFileStore.UploadAsync(db,"company",null,file.FileId,
                    new NativeFileMetadataInput("待清理第二版本.bin"),"增量实验版本2",
                    revision.LongLength,new MemoryStream(revision),CancellationToken.None)
                    .GetAwaiter().GetResult();
                Check(second.Version==2,"file version 2 must be created");
                long sourceLink=Link(db,file.FileId,source);
                long targetLink=NativeFileLinkStore.Add(db,"company",file.FileId,
                    new NativeFileLinkInput(target));
                uploadClock.Stop();

                // Purge only one placement: other placement protects both versions.
                Purge(db,file.FileId,sourceLink);
                VerifyFile(db,file.FileId,1,disposable);
                VerifyFile(db,file.FileId,2,revision);
                VerifyFile(db,keepId,1,survivor);
                Check(Scalar(db,
                    $"SELECT count(*) FROM file_versions WHERE file_id={file.FileId};")==2,
                    "both versions must survive deletion of only one shared link");

                // Final physical purge must release BOTH versions' BLOB chunks.
                Purge(db,file.FileId,targetLink);
                Check(Scalar(db,
                    $"SELECT count(*) FROM file_versions WHERE file_id={file.FileId};")==0 &&
                      Scalar(db,
                    $"SELECT count(*) FROM files WHERE id={file.FileId};")==0,
                    "last LinkId purge must release file metadata and all versions");
                Check(Scalar(db,"SELECT count(*) FROM file_objects;")==1,
                    "only the independent retained content object may remain");
                VerifyFile(db,keepId,1,survivor);
                Integrity(db);

                beforeBytes = new FileInfo(path).Length;
                beforePages = Scalar(db,"PRAGMA page_count;");
                beforeFree = Scalar(db,"PRAGMA freelist_count;");
                Check(beforeFree>0,"permanent deletion must create SQLite free pages");
                reclaimClock.Start();
                long previousFree=beforeFree;
                // Identical operation on both modes. NONE should be a no-op;
                // INCREMENTAL must release real filesystem bytes.
                for (int i=0; i<512 && previousFree>0; i++)
                {
                    Exec(db,$"PRAGMA incremental_vacuum({BatchPages});");
                    batches++;
                    long nowFree=Scalar(db,"PRAGMA freelist_count;");
                    Check(nowFree<=previousFree,
                        "incremental_vacuum must not add free pages");
                    if (nowFree==previousFree) break;
                    previousFree=nowFree;
                }
                reclaimClock.Stop();
                afterBytes = new FileInfo(path).Length;
                afterPages = Scalar(db,"PRAGMA page_count;");
                afterFree = Scalar(db,"PRAGMA freelist_count;");
                Check(afterBytes<=beforeBytes && afterPages<=beforePages,
                    "reclaim must not grow encrypted database");
                if (incremental)
                    Check(afterBytes<beforeBytes && afterPages<beforePages &&
                          afterFree<beforeFree,
                        "incremental mode must return some physical disk space");
                else
                    Check(afterBytes==beforeBytes && afterPages==beforePages &&
                          afterFree==beforeFree,
                        "NONE mode must not reclaim physical pages");
                VerifyFile(db,keepId,1,survivor);
                Integrity(db);
            }

            using (var reopened = Vault.Connect(path,password,create:false))
            {
                Vault.ValidateSchema(reopened);
                Check(Scalar(reopened,"PRAGMA auto_vacuum;")==(incremental?2:0),
                    "configured mode must survive encrypted reopen");
                VerifyFile(reopened,keepId,1,survivor);
                Integrity(reopened);
            }
            try
            {
                using var wrong = Vault.Connect(path,"not-the-lab-key",create:false);
                throw new IOException("SQLCIPHER INCREMENTAL LAB: wrong password opened DB");
            }
            catch (SqliteException) { /* Expected key rejection. */ }

            return new(mode,sizeMiB,incremental?2:0,beforeBytes,afterBytes,
                beforePages,afterPages,beforeFree,afterFree,batches,
                uploadClock.ElapsedMilliseconds,reclaimClock.ElapsedMilliseconds);
        }
        finally
        {
            try { Directory.Delete(dir,recursive:true); }
            catch (IOException) { /* Temp-only test files; report cleanup trouble separately. */ }
        }
    }

    // Call from regular small Debug smoke, or dedicated --vacuum-lab process.
    public static void Run(int sizeMiB=4)
    {
        if (sizeMiB<1 || sizeMiB>128)
            throw new ArgumentOutOfRangeException(nameof(sizeMiB),
                "Disposable vacuum-lab data size must be within 1..128 MiB.");
        var control=One(false,sizeMiB);
        var treatment=One(true,sizeMiB);
        Check(treatment.FileBytesAfterReclaim<treatment.FileBytesAfterPurge,
            "incremental file shrink evidence is mandatory");
        var report=JsonSerializer.Serialize(new {
            status="PASS",
            test="SQLCipher auto_vacuum isolated IPSys business-data comparison",
            payloadMiB=sizeMiB,
            none=control,
            incremental=treatment,
            recoveredBytes=treatment.FileBytesAfterPurge-treatment.FileBytesAfterReclaim,
            note="Synthetic temporary encrypted databases only; not a 500 GB stress or power-loss test."
        },new JsonSerializerOptions { WriteIndented=true });
        string? output=Environment.GetEnvironmentVariable("IPSYS_VACUUM_LAB_REPORT");
        if (!string.IsNullOrWhiteSpace(output))
            File.WriteAllText(output,report);
        Console.WriteLine(report);
        Console.WriteLine("SQLCIPHER INCREMENTAL VACUUM LAB PASS");
    }

    public static void RunFromEnvironment()
    {
        string? input=Environment.GetEnvironmentVariable("IPSYS_VACUUM_LAB_MIB");
        if (!int.TryParse(input,out int sizeMiB)) sizeMiB=32;
        Run(sizeMiB);
    }
}
