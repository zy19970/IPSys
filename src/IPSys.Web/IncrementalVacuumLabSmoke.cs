using System.Buffers.Binary;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;

// Only disposable SQLCipher databases under an explicit lab root (default: OS temp).
// This laboratory does not change production Vault.Connect/CreateSchema defaults.
// Payloads are streamed and hashed incrementally so multi-GiB runs never hold the
// whole file in memory. Business paths used here are the real IPSys stores.
static class IncrementalVacuumLabSmoke
{
    private const int MiB = 1024 * 1024;
    private const int DefaultBatchPages = 256;
    private const int HashBuffer = 4 * MiB;

    // ---------- primitives ----------

    private static void Check(bool ok, string detail)
    {
        if (!ok) throw new IOException("SQLCIPHER INCREMENTAL LAB: " + detail);
    }

    private static long Scalar(SqliteConnection db, string sql)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 0;
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    private static string Text(SqliteConnection db, string sql)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 0;
        return Convert.ToString(cmd.ExecuteScalar()) ?? "";
    }

    private static void Exec(SqliteConnection db, string sql)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 0;
        cmd.ExecuteNonQuery();
    }

    // File length only reflects incremental truncation once the journal is settled.
    private static void FlushToDisk(SqliteConnection db)
    {
        string mode = Text(db, "PRAGMA journal_mode;");
        if (mode.Equals("wal", StringComparison.OrdinalIgnoreCase))
            Exec(db, "PRAGMA wal_checkpoint(TRUNCATE);");
    }

    private static long Project(SqliteConnection db, string name)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO folders(workspace,kind,name)
            VALUES('company','project',$name);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$name", name);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    private static long Link(SqliteConnection db, long fileId, long folderId)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT id FROM folder_file_links WHERE file_id=$file AND folder_id=$folder;
            """;
        cmd.Parameters.AddWithValue("$file", fileId);
        cmd.Parameters.AddWithValue("$folder", folderId);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    private static void Purge(SqliteConnection db, long fileId, long linkId)
    {
        Check(NativeFileLinkStore.Unlink(db, "company", fileId, linkId),
            "soft unlink must succeed before physical purge");
        Check(RecycleStore.Change(db, "company",
            [new RecycleKey("v2_file", linkId, "")], true),
            "permanent purge must succeed and obey shared reference rules");
    }

    // ---------- deterministic streamed payload ----------

    // Reproducible content addressed by (blockIndex, seed); never buffered as a whole.
    private sealed class DeterministicContent(long length, ulong seed) : Stream
    {
        private const int BlockSize = 1 * MiB;
        private readonly byte[] _block = new byte[BlockSize];
        private long _blockIndex = -1;
        private long _position;

        private void Fill(long blockIndex)
        {
            ulong x = seed ^ (((ulong)blockIndex + 0x9E3779B97F4A7C15UL) * 0xBF58476D1CE4E5B9UL);
            if (x == 0) x = 0x9E3779B97F4A7C15UL;
            Span<byte> span = _block;
            int i = 0;
            for (; i + 8 <= span.Length; i += 8)
            {
                x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
                BinaryPrimitives.WriteUInt64LittleEndian(span.Slice(i, 8),
                    x * 0x2545F4914F6CDD1DUL);
            }
            for (; i < span.Length; i++)
            {
                x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
                span[i] = (byte)(x >> 32);
            }
        }

        public override int Read(Span<byte> buffer)
        {
            if (_position >= length || buffer.Length == 0) return 0;
            long index = _position / BlockSize;
            if (index != _blockIndex) { Fill(index); _blockIndex = index; }
            int offset = (int)(_position % BlockSize);
            int count = (int)Math.Min(buffer.Length,
                Math.Min(length - _position, BlockSize - (long)offset));
            _block.AsSpan(offset, count).CopyTo(buffer);
            _position += count;
            return count;
        }

        public override int Read(byte[] buffer, int offset, int count)
            => Read(buffer.AsSpan(offset, count));

        public override ValueTask<int> ReadAsync(Memory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return ValueTask.FromResult(Read(buffer.Span));
        }

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position
        {
            get => _position;
            set => throw new NotSupportedException();
        }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin)
            => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count)
            => throw new NotSupportedException();
    }

    // Discards bytes while hashing, so verification is O(1) memory.
    private sealed class HashSinkStream : Stream
    {
        private readonly IncrementalHash _hash =
            IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        public long Written { get; private set; }
        public string Digest() => Convert.ToHexString(_hash.GetHashAndReset());

        public override void Write(ReadOnlySpan<byte> buffer)
        {
            _hash.AppendData(buffer);
            Written += buffer.Length;
        }

        public override void Write(byte[] buffer, int offset, int count)
            => Write(buffer.AsSpan(offset, count));

        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Write(buffer.Span);
            return ValueTask.CompletedTask;
        }

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => Written;
        public override long Position
        {
            get => Written;
            set => throw new NotSupportedException();
        }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin)
            => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override int Read(byte[] buffer, int offset, int count)
            => throw new NotSupportedException();
    }

    private static (string Digest, long Length) HashContent(long length, ulong seed)
    {
        using var source = new DeterministicContent(length, seed);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        byte[] buffer = new byte[HashBuffer];
        int read;
        long total = 0;
        while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
        {
            hash.AppendData(buffer, 0, read);
            total += read;
        }
        Check(total == length, "deterministic stream must yield the declared length");
        return (Convert.ToHexString(hash.GetHashAndReset()), total);
    }

    private static long Put(SqliteConnection db, long? folderId, long? fileId,
        string name, string? note, long length, ulong seed)
    {
        using var source = new DeterministicContent(length, seed);
        var result = NativeFileStore.UploadAsync(db, "company", folderId, fileId,
            new NativeFileMetadataInput(name), note, length, source,
            CancellationToken.None).GetAwaiter().GetResult();
        return result.FileId;
    }

    private static void Verify(SqliteConnection db, long fileId, int version,
        long expectedLength, string expectedDigest)
    {
        var info = NativeFileStore.DownloadInfo(db, "company", fileId, version);
        Check(info.HasValue, "preserved file/version must remain accessible");
        Check(info!.Value.Size == expectedLength,
            $"version {version} length changed: expected {expectedLength}, got {info.Value.Size}");
        using var sink = new HashSinkStream();
        NativeFileStore.CopyAsync(db, "company", info.Value.ObjectId, sink,
            CancellationToken.None).GetAwaiter().GetResult();
        Check(sink.Written == expectedLength,
            $"version {version} streamed {sink.Written} bytes, expected {expectedLength}");
        Check(string.Equals(sink.Digest(), expectedDigest, StringComparison.Ordinal),
            $"version {version} SHA-256 mismatch after delete/reclaim");
    }

    private static void Integrity(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandTimeout = 0;
        cmd.CommandText = "PRAGMA integrity_check;";
        Check(string.Equals(Convert.ToString(cmd.ExecuteScalar()), "ok",
                StringComparison.OrdinalIgnoreCase),
            "SQLCipher integrity_check must return ok");
        cmd.CommandText = "PRAGMA foreign_key_check;";
        using var rows = cmd.ExecuteReader();
        Check(!rows.Read(), "schema foreign-key check must have zero violations");
    }

    // ---------- metrics ----------

    private sealed record Phase(long FileBytes, long Pages, long FreePages)
    {
        public long LivePages => Pages - FreePages;
    }

    private static Phase Snap(SqliteConnection db, string path)
    {
        FlushToDisk(db);
        return new Phase(new FileInfo(path).Length,
            Scalar(db, "PRAGMA page_count;"),
            Scalar(db, "PRAGMA freelist_count;"));
    }

    private sealed record ReclaimRun(
        string Mode, int Repeat, int SizeMiB, int BatchPages,
        Phase AfterPurge, Phase AfterReclaim, Phase AfterReopen,
        int Batches, bool Truncated, long UploadMilliseconds, long ReclaimMilliseconds,
        long KeptObjectCount, bool AutoVacuumPersisted, bool WrongKeyRejected);

    private sealed record ReuseRun(
        string Mode, int Repeat, int BaseMiB, int DisposableMiB, int NewMiB, int BatchPages,
        Phase AfterWrite, Phase AfterPurge, Phase AfterReclaim, Phase AfterGrow,
        long ExpectedPagesAfterGrow, long NoReusePagesUpperBound,
        long UploadMilliseconds, long ReclaimMilliseconds);

    private sealed record EnvironmentInfo(
        string SqliteVersion, string CipherVersion, long PageSize,
        string JournalMode, long Synchronous, long AutoVacuumDefault,
        string CompileOptions);

    private static EnvironmentInfo CaptureEnvironment(SqliteConnection db)
    {
        string options = Text(db, "PRAGMA compile_options;");
        return new EnvironmentInfo(
            Text(db, "SELECT sqlite_version();"),
            SafeText(db, "PRAGMA cipher_version;"),
            SafeScalar(db, "PRAGMA page_size;"),
            SafeText(db, "PRAGMA journal_mode;"),
            SafeScalar(db, "PRAGMA synchronous;"),
            SafeScalar(db, "PRAGMA auto_vacuum;"),
            options.Length > 800 ? options[..800] : options);
    }

    private static string SafeText(SqliteConnection db, string sql)
    {
        try { return Text(db, sql); } catch (SqliteException) { return "<unsupported>"; }
    }

    private static long SafeScalar(SqliteConnection db, string sql)
    {
        try { return Scalar(db, sql); } catch (SqliteException) { return -1; }
    }

    private static string LabRoot()
    {
        string? configured = Environment.GetEnvironmentVariable("IPSYS_VACUUM_LAB_DIR");
        string root = string.IsNullOrWhiteSpace(configured)
            ? Path.GetTempPath()
            : Path.GetFullPath(configured);
        Directory.CreateDirectory(root);
        return root;
    }

    private static (string Directory, string Path, string Password) NewLabDatabase()
    {
        string dir = Path.Combine(LabRoot(),
            "ipsys-lab-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" +
            Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(dir);
        // Marker proves ownership before any recursive cleanup.
        File.WriteAllText(Path.Combine(dir, ".ipsys-vacuum-lab"), "disposable");
        string path = Path.Combine(dir, "lab.db");
        Check(!File.Exists(path), "lab database must not pre-exist");
        return (dir, path, "lab-only-" + Guid.NewGuid().ToString("N"));
    }

    private static readonly List<string> CleanupFailures = new();

    // 所有权只在第一次判定：递归删除可能先删掉标记文件、再在仍被占用的
    // lab.db 上失败；若每次都重新检查标记，第二次就会误判"不是我的目录"而放弃。
    private static void DropLabDatabase(string dir)
    {
        if (!Directory.Exists(dir) || !File.Exists(Path.Combine(dir, ".ipsys-vacuum-lab")))
            return;
        for (int attempt = 0; attempt < 8; attempt++)
        {
            try
            {
                SqliteConnection.ClearAllPools();
                Directory.Delete(dir, recursive: true);
                return;
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            GC.Collect();
            GC.WaitForPendingFinalizers();
            Thread.Sleep(200);
        }
        CleanupFailures.Add(dir);
        Console.WriteLine($"[cleanup] 临时目录删除失败，已记入报告：{dir}");
    }

    // ---------- case A: purge then reclaim ----------

    private static ReclaimRun RunReclaim(bool incremental, int sizeMiB, int batchPages, int repeat)
    {
        string mode = incremental ? "INCREMENTAL" : "NONE";
        var (dir, path, password) = NewLabDatabase();
        long keepId = 0;
        int batches = 0;
        bool truncated = false;
        long uploaded = 0, reclaimed = 0;
        long disposableLength = (long)sizeMiB * MiB + 19;
        long revisionLength = (long)sizeMiB * MiB / 2 + 31;
        long keepLength = 1L * MiB + 67;
        string keepDigest = "", disposableDigest = "", revisionDigest = "";
        Phase afterPurge, afterReclaim;
        var uploadClock = new Stopwatch();
        var reclaimClock = new Stopwatch();
        try
        {
            using (var db = Vault.Connect(path, password, create: true))
            {
                Exec(db, incremental
                    ? "PRAGMA auto_vacuum=INCREMENTAL;"
                    : "PRAGMA auto_vacuum=NONE;");
                Check(Scalar(db, "PRAGMA auto_vacuum;") == (incremental ? 2 : 0),
                    "mode must be set before schema creation");
                Vault.CreateSchema(db);
                Vault.ValidateSchema(db);
                Check(Scalar(db, "PRAGMA auto_vacuum;") == (incremental ? 2 : 0),
                    "mode must persist after IPSys schema creation");

                (keepDigest, _) = HashContent(keepLength, 201);
                (disposableDigest, _) = HashContent(disposableLength, 202);
                (revisionDigest, _) = HashContent(revisionLength, 203);

                long source = Project(db, "实验源目录");
                long target = Project(db, "实验共享目录");

                uploadClock.Start();
                keepId = Put(db, target, null, "保留原件.bin", null, keepLength, 201);
                long fileId = Put(db, source, null, "待清理原件.bin", null,
                    disposableLength, 202);
                long second = Put(db, null, fileId, "待清理第二版本.bin", "增量实验版本2",
                    revisionLength, 203);
                Check(Scalar(db, $"SELECT max(version) FROM file_versions WHERE file_id={fileId};") == 2,
                    "file version 2 must be created");
                long sourceLink = Link(db, fileId, source);
                long targetLink = NativeFileLinkStore.Add(db, "company", fileId,
                    new NativeFileLinkInput(target));
                uploadClock.Stop();
                uploaded = uploadClock.ElapsedMilliseconds;

                // Purge one placement only: the other placement protects both versions.
                Purge(db, fileId, sourceLink);
                Verify(db, fileId, 1, disposableLength, disposableDigest);
                Verify(db, fileId, 2, revisionLength, revisionDigest);
                Verify(db, keepId, 1, keepLength, keepDigest);
                Check(Scalar(db,
                    $"SELECT count(*) FROM file_versions WHERE file_id={fileId};") == 2,
                    "both versions must survive deletion of only one shared link");

                // Final purge must release BOTH versions' chunks.
                Purge(db, fileId, targetLink);
                Check(Scalar(db, $"SELECT count(*) FROM file_versions WHERE file_id={fileId};") == 0
                      && Scalar(db, $"SELECT count(*) FROM files WHERE id={fileId};") == 0,
                    "last LinkId purge must release file metadata and all versions");
                long keptObjects = Scalar(db, "SELECT count(*) FROM file_objects;");
                Check(keptObjects == 1,
                    "only the independent retained content object may remain");
                Verify(db, keepId, 1, keepLength, keepDigest);
                Integrity(db);

                Phase afterPurgeLocal = Snap(db, path);
                Check(afterPurgeLocal.FreePages > 0,
                    "permanent deletion must create SQLite free pages");
                afterPurge = afterPurgeLocal;

                reclaimClock.Start();
                long previousFree = afterPurge.FreePages;
                // Bound derives from the actual freelist, never a fixed 512-batch ceiling.
                long ceiling = afterPurge.FreePages / batchPages + 8;
                while (previousFree > 0 && batches < ceiling)
                {
                    Exec(db, $"PRAGMA incremental_vacuum({batchPages});");
                    batches++;
                    long nowFree = Scalar(db, "PRAGMA freelist_count;");
                    Check(nowFree <= previousFree,
                        "incremental_vacuum must not add free pages");
                    if (nowFree == previousFree) break;
                    previousFree = nowFree;
                }
                truncated = incremental && previousFree > 0;
                reclaimClock.Stop();
                reclaimed = reclaimClock.ElapsedMilliseconds;

                Phase afterReclaimLocal = Snap(db, path);
                afterReclaim = afterReclaimLocal;
                Check(afterReclaim.FileBytes <= afterPurge.FileBytes
                      && afterReclaim.Pages <= afterPurge.Pages,
                    "reclaim must not grow the encrypted database");
                if (incremental)
                {
                    Check(afterReclaim.FileBytes < afterPurge.FileBytes
                          && afterReclaim.Pages < afterPurge.Pages,
                        "incremental mode must return physical disk space");
                    Check(!truncated && afterReclaim.FreePages == 0,
                        $"incremental reclaim must drain the freelist (left {previousFree} pages)");
                }
                else
                {
                    Check(afterReclaim.FileBytes == afterPurge.FileBytes
                          && afterReclaim.Pages == afterPurge.Pages
                          && afterReclaim.FreePages == afterPurge.FreePages,
                        "NONE mode must not reclaim physical pages");
                    Check(afterReclaim.FreePages == afterPurge.FreePages,
                        "NONE mode freelist must be untouched");
                }
                Verify(db, keepId, 1, keepLength, keepDigest);
                Integrity(db);
            }

            bool modePersisted;
            Phase afterReopen;
            using (var reopened = Vault.Connect(path, password, create: false))
            {
                Vault.ValidateSchema(reopened);
                modePersisted = Scalar(reopened, "PRAGMA auto_vacuum;") == (incremental ? 2 : 0);
                Check(modePersisted, "configured mode must survive encrypted reopen");
                afterReopen = Snap(reopened, path);
                Verify(reopened, keepId, 1, keepLength, keepDigest);
                Integrity(reopened);
            }

            bool wrongKeyRejected;
            try
            {
                using var wrong = Vault.Connect(path, "not-the-lab-key", create: false);
                wrongKeyRejected = false;
            }
            catch (SqliteException) { wrongKeyRejected = true; }
            Check(wrongKeyRejected, "wrong password must be rejected");

            return new ReclaimRun(mode, repeat, sizeMiB, batchPages,
                afterPurge, afterReclaim, afterReopen, batches, truncated,
                uploaded, reclaimed, 1, modePersisted, wrongKeyRejected);
        }
        finally
        {
            DropLabDatabase(dir);
        }
    }

    // ---------- case B: freelist reuse (delete -> grow, no VACUUM) ----------

    private static ReuseRun RunReuse(bool incremental, int baseMiB, int disposableMiB,
        int newMiB, int batchPages, int repeat)
    {
        string mode = incremental ? "INCREMENTAL" : "NONE";
        var (dir, path, password) = NewLabDatabase();
        long keepId = 0;
        long uploadMs = 0, reclaimMs = 0;
        long baseLength = (long)baseMiB * MiB;
        long disposableLength = (long)disposableMiB * MiB;
        long newLength = (long)newMiB * MiB;
        string keepDigest = "", newDigest = "";
        try
        {
            using var db = Vault.Connect(path, password, create: true);
            Exec(db, incremental
                ? "PRAGMA auto_vacuum=INCREMENTAL;"
                : "PRAGMA auto_vacuum=NONE;");
            Check(Scalar(db, "PRAGMA auto_vacuum;") == (incremental ? 2 : 0),
                "mode must be set before schema creation");
            Vault.CreateSchema(db);
            Vault.ValidateSchema(db);

            (keepDigest, _) = HashContent(baseLength, 301);
            (newDigest, _) = HashContent(newLength, 303);

            long baseFolder = Project(db, "复用基准目录");
            long tempFolder = Project(db, "复用临时目录");

            var clock = Stopwatch.StartNew();
            keepId = Put(db, baseFolder, null, "长期保留.bin", null, baseLength, 301);
            long churnId = Put(db, tempFolder, null, "将被删除.bin", null,
                disposableLength, 302);
            clock.Stop();
            uploadMs += clock.ElapsedMilliseconds;

            Phase afterWrite = Snap(db, path);

            Purge(db, churnId, Link(db, churnId, tempFolder));
            Check(Scalar(db, "SELECT count(*) FROM files WHERE id=" + churnId + ";") == 0,
                "disposable file must be physically purged");
            Phase afterPurge = Snap(db, path);
            Check(afterPurge.FreePages > 0,
                "purge must leave free pages for reuse");

            Phase afterReclaim = afterPurge;
            if (incremental)
            {
                var reclaimClock = Stopwatch.StartNew();
                long previousFree = afterPurge.FreePages;
                long ceiling = afterPurge.FreePages / batchPages + 8;
                long batches = 0;
                while (previousFree > 0 && batches < ceiling)
                {
                    Exec(db, $"PRAGMA incremental_vacuum({batchPages});");
                    batches++;
                    long nowFree = Scalar(db, "PRAGMA freelist_count;");
                    if (nowFree == previousFree) break;
                    previousFree = nowFree;
                }
                reclaimClock.Stop();
                reclaimMs = reclaimClock.ElapsedMilliseconds;
                afterReclaim = Snap(db, path);
                Check(afterReclaim.FreePages == 0,
                    $"reclaim before regrow must drain the freelist (left {previousFree})");
                Check(afterReclaim.Pages < afterPurge.Pages,
                    "reclaim before regrow must shrink page count");
            }

            clock.Restart();
            long grownId = Put(db, baseFolder, null, "回收后新增.bin", null, newLength, 303);
            clock.Stop();
            uploadMs += clock.ElapsedMilliseconds;

            Phase afterGrow = Snap(db, path);

            long pageSize = Scalar(db, "PRAGMA page_size;");
            long pagesPerMiB = MiB / pageSize;
            long expectedPages = (baseLength + newLength) / pageSize;
            // Without freelist reuse the file would hold base + disposable + new.
            long noReuseUpperBound = (baseLength + disposableLength + newLength) / pageSize;
            Check(afterGrow.Pages <= noReuseUpperBound,
                $"file grew to {afterGrow.Pages} pages, beyond the no-reuse bound " +
                $"{noReuseUpperBound}; free pages were not reusable");

            Verify(db, keepId, 1, baseLength, keepDigest);
            Verify(db, grownId, 1, newLength, newDigest);
            Integrity(db);

            return new ReuseRun(mode, repeat, baseMiB, disposableMiB, newMiB, batchPages,
                afterWrite, afterPurge, afterReclaim, afterGrow,
                expectedPages, noReuseUpperBound, uploadMs, reclaimMs);
        }
        finally
        {
            DropLabDatabase(dir);
        }
    }

    // ---------- entry points ----------

    private static string? Attempt(Action action)
    {
        try { action(); return null; }
        catch (Exception ex) { return ex.GetType().Name + ": " + ex.Message; }
    }

    public static void RunSuite()
    {
        int sizeMiB = ReadInt("IPSYS_VACUUM_LAB_MIB", 2048);
        int batchPages = ReadInt("IPSYS_VACUUM_LAB_BATCH_PAGES", DefaultBatchPages);
        int repeat = ReadInt("IPSYS_VACUUM_LAB_REPEAT", 3);
        int compareMiB = ReadInt("IPSYS_VACUUM_LAB_COMPARE_MIB", sizeMiB);
        int comparePages = ReadInt("IPSYS_VACUUM_LAB_COMPARE_PAGES", 4096);
        int reuseBase = ReadInt("IPSYS_VACUUM_LAB_REUSE_BASE_MIB", (int)(sizeMiB * 1.0));
        int reuseDisposable = ReadInt("IPSYS_VACUUM_LAB_REUSE_DROP_MIB", (int)(reuseBase * 0.4));
        int reuseNew = ReadInt("IPSYS_VACUUM_LAB_REUSE_NEW_MIB", (int)(reuseBase * 0.6));
        LabRoot();
        Check(sizeMiB >= 1, "lab payload must be at least 1 MiB");

        Console.WriteLine($"[lab] root={LabRoot()} size={sizeMiB}MiB batch={batchPages}p " +
                          $"repeat={repeat} compare={compareMiB}MiB/{comparePages}p " +
                          $"reuse={reuseBase}/{reuseDisposable}/{reuseNew}MiB");

        var environment = new List<EnvironmentInfo>();
        var reclaim = new List<ReclaimRun>();
        var reuse = new List<ReuseRun>();
        var compare = new List<ReclaimRun>();
        var failures = new List<string>();

        string probeDir = Path.Combine(LabRoot(), "probe-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(probeDir);
        // 和正式实验目录一样先立所有权标记，否则 DropLabDatabase 会拒绝删除。
        File.WriteAllText(Path.Combine(probeDir, ".ipsys-vacuum-lab"), "disposable");
        try
        {
            using var probe = Vault.Connect(Path.Combine(probeDir, "probe.db"),
                "lab-probe-only", create: true);
            environment.Add(CaptureEnvironment(probe));
        }
        finally { DropLabDatabase(probeDir); }
        EnvironmentInfo env = environment[0];
        Console.WriteLine($"[env] sqlite={env.SqliteVersion} cipher={env.CipherVersion} " +
                          $"page={env.PageSize} journal={env.JournalMode} " +
                          $"sync={env.Synchronous} autoVacuum={env.AutoVacuumDefault}");

        for (int i = 1; i <= repeat; i++)
        {
            foreach (bool incremental in new[] { false, true })
            {
                string label = incremental ? "INCREMENTAL" : "NONE";
                Console.WriteLine($"[reclaim {i}/{repeat}] {label} {sizeMiB}MiB ...");
                var clock = Stopwatch.StartNew();
                string? error = Attempt(() => reclaim.Add(
                    RunReclaim(incremental, sizeMiB, batchPages, i)));
                clock.Stop();
                Console.WriteLine(error is null
                    ? $"[reclaim {i}/{repeat}] {label} ok in {clock.Elapsed.TotalSeconds:F1}s"
                    : $"[reclaim {i}/{repeat}] {label} FAILED: {error}");
                if (error is not null) failures.Add("reclaim/" + label + "/" + i + ": " + error);
            }
        }

        for (int i = 1; i <= repeat; i++)
        {
            foreach (bool incremental in new[] { false, true })
            {
                string label = incremental ? "INCREMENTAL" : "NONE";
                Console.WriteLine($"[reuse {i}/{repeat}] {label} " +
                                  $"{reuseBase}/{reuseDisposable}/{reuseNew}MiB ...");
                var clock = Stopwatch.StartNew();
                string? error = Attempt(() => reuse.Add(
                    RunReuse(incremental, reuseBase, reuseDisposable, reuseNew, batchPages, i)));
                clock.Stop();
                Console.WriteLine(error is null
                    ? $"[reuse {i}/{repeat}] {label} ok in {clock.Elapsed.TotalSeconds:F1}s"
                    : $"[reuse {i}/{repeat}] {label} FAILED: {error}");
                if (error is not null) failures.Add("reuse/" + label + "/" + i + ": " + error);
            }
        }

        for (int i = 1; i <= repeat; i++)
        {
            foreach (bool incremental in new[] { false, true })
            {
                string label = incremental ? "INCREMENTAL" : "NONE";
                Console.WriteLine($"[compare {i}/{repeat}] {label} {compareMiB}MiB " +
                                  $"batch={comparePages}p ...");
                var clock = Stopwatch.StartNew();
                string? error = Attempt(() => compare.Add(
                    RunReclaim(incremental, compareMiB, comparePages, i)));
                clock.Stop();
                Console.WriteLine(error is null
                    ? $"[compare {i}/{repeat}] {label} ok in {clock.Elapsed.TotalSeconds:F1}s"
                    : $"[compare {i}/{repeat}] {label} FAILED: {error}");
                if (error is not null) failures.Add("compare/" + label + "/" + i + ": " + error);
            }
        }

        var report = new
        {
            status = failures.Count == 0 ? "PASS" : "FAIL",
            test = "SQLCipher auto_vacuum incremental reclaim + freelist reuse on real IPSys business paths",
            generatedAtUtc = DateTime.UtcNow.ToString("O"),
            environment = env,
            parameters = new
            {
                sizeMiB, batchPages, repeat,
                compareMiB, comparePages,
                reuseBaseMiB = reuseBase,
                reuseDisposableMiB = reuseDisposable,
                reuseNewMiB = reuseNew,
                labRoot = LabRoot()
            },
            reclaim,
            reuse,
            batchCompare = new
            {
                batchPages,
                comparePages,
                baseline = reclaim.Where(r => r.Mode == "INCREMENTAL").ToList(),
                comparison = compare.Where(r => r.Mode == "INCREMENTAL").ToList()
            },
            failures,
            cleanupFailures = CleanupFailures,
            note = "Synthetic disposable encrypted databases only. Payloads are streamed. " +
                   "Few-GiB runs sit inside the OS page cache, so timings are indicative only; " +
                   "this is not a hundreds-of-GB, power-loss, or disk-full test."
        };
        string json = JsonSerializer.Serialize(report,
            new JsonSerializerOptions { WriteIndented = true });
        string? output = Environment.GetEnvironmentVariable("IPSYS_VACUUM_LAB_REPORT");
        if (!string.IsNullOrWhiteSpace(output))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
            File.WriteAllText(output, json);
        }
        Console.WriteLine(json);
        if (failures.Count > 0)
            throw new IOException("SQLCIPHER INCREMENTAL LAB FAILED: " +
                string.Join(" | ", failures));
        Console.WriteLine("SQLCIPHER INCREMENTAL VACUUM LAB PASS");
    }

    private static int ReadInt(string name, int fallback)
        => int.TryParse(Environment.GetEnvironmentVariable(name), out int value)
            ? value : fallback;

    // Kept for the existing small CI smoke and --vacuum-lab default path.
    public static void Run(int sizeMiB = 4)
    {
        if (sizeMiB < 1 || sizeMiB > 4096)
            throw new ArgumentOutOfRangeException(nameof(sizeMiB),
                "Disposable vacuum-lab data size must be within 1..4096 MiB.");
        var control = RunReclaim(false, sizeMiB, DefaultBatchPages, 1);
        var treatment = RunReclaim(true, sizeMiB, DefaultBatchPages, 1);
        Check(treatment.AfterReclaim.FileBytes < treatment.AfterPurge.FileBytes,
            "incremental file shrink evidence is mandatory");
        var report = JsonSerializer.Serialize(new
        {
            status = "PASS",
            test = "SQLCipher auto_vacuum isolated IPSys business-data comparison",
            payloadMiB = sizeMiB,
            none = control,
            incremental = treatment,
            recoveredBytes = treatment.AfterPurge.FileBytes - treatment.AfterReclaim.FileBytes,
            note = "Synthetic temporary encrypted databases only; not a 500 GB stress or power-loss test."
        }, new JsonSerializerOptions { WriteIndented = true });
        string? output = Environment.GetEnvironmentVariable("IPSYS_VACUUM_LAB_REPORT");
        if (!string.IsNullOrWhiteSpace(output))
            File.WriteAllText(output, report);
        Console.WriteLine(report);
        Console.WriteLine("SQLCIPHER INCREMENTAL VACUUM LAB PASS");
    }

    public static void RunFromEnvironment()
    {
        string? suite = Environment.GetEnvironmentVariable("IPSYS_VACUUM_LAB_SUITE");
        if (!string.IsNullOrWhiteSpace(suite)
            && !suite.Equals("single", StringComparison.OrdinalIgnoreCase))
        {
            RunSuite();
            return;
        }
        string? input = Environment.GetEnvironmentVariable("IPSYS_VACUUM_LAB_MIB");
        if (!int.TryParse(input, out int sizeMiB)) sizeMiB = 32;
        Run(sizeMiB);
    }
}
