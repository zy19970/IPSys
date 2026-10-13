using System.Buffers;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

namespace IPSys.M1;

// M1 technical prototype only: a single encrypted database and streaming attachments.
internal static class Program
{
    const int Chunk = 1024 * 1024;

    static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        try
        {
            SQLitePCL.Batteries_V2.Init();
            if (args.Length == 1 && args[0] == "smoke") { Smoke(); return 0; }
            if (args.Length < 2) { Help(); return 2; }
            string action = args[0].ToLowerInvariant(), path = Path.GetFullPath(args[1]);
            if (action == "init" && args.Length == 2)
            {
                if (File.Exists(path)) throw new IOException("数据库已存在，不允许覆盖。");
                string password = ReadSecret("设置数据库密码：");
                if (password != ReadSecret("再次输入密码：")) throw new IOException("密码不一致。");
                using var created = Open(path, password, true);
                CreateTables(created);
                Console.WriteLine("已创建加密数据库：" + path);
                return 0;
            }
            if (!File.Exists(path)) throw new FileNotFoundException("数据库不存在。", path);
            using var db = Open(path, ReadSecret("数据库密码："), false);
            switch (action)
            {
                case "record" when args.Length == 4:
                    Console.WriteLine("记录 ID：" + Record(db, args[2], args[3]));
                    break;
                case "put" when args.Length == 4 && long.TryParse(args[2], out long recordId):
                    Console.WriteLine("附件 ID：" + Put(db, recordId, args[3]));
                    break;
                case "get" when args.Length == 4 && long.TryParse(args[2], out long fileId):
                    Console.WriteLine("已校验并导出：" + Get(db, fileId, args[3]));
                    break;
                case "list" when args.Length == 2: List(db); break;
                case "check" when args.Length == 2: Check(db); break;
                default: Help(); return 2;
            }
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine("失败：" + ex.Message); return 1; }
    }

    static void Help() => Console.WriteLine("""
        IPSys M1 SQLCipher 验证程序（非正式应用）
          IPSys.M1.exe smoke
          IPSys.M1.exe init <数据库.db>
          IPSys.M1.exe record <数据库.db> <company|personal> <记录名称>
          IPSys.M1.exe put <数据库.db> <记录ID> <原件路径>
          IPSys.M1.exe get <数据库.db> <附件ID> <已存在的导出目录>
          IPSys.M1.exe list <数据库.db>
          IPSys.M1.exe check <数据库.db>
        只用于无敏感信息的测试数据；不会删除源文件或自动备份。
        """);

    static string ReadSecret(string prompt)
    {
        Console.Write(prompt);
        var pass = new StringBuilder();
        for (;;)
        {
            var k = Console.ReadKey(true);
            if (k.Key == ConsoleKey.Enter) break;
            if (k.Key == ConsoleKey.Backspace)
            { if (pass.Length != 0) pass.Length--; continue; }
            if (!char.IsControl(k.KeyChar)) pass.Append(k.KeyChar);
        }
        Console.WriteLine();
        if (pass.Length == 0) throw new InvalidOperationException("密码不能为空。");
        return pass.ToString();
    }

    static SqliteConnection Open(string path, string password, bool isNew)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = isNew ? SqliteOpenMode.ReadWriteCreate : SqliteOpenMode.ReadWrite,
            Password = password,
            Pooling = false
        };
        var db = new SqliteConnection(builder.ToString());
        try
        {
            db.Open();
            using var cmd = db.CreateCommand();
            cmd.CommandText = "PRAGMA cipher_version;";
            if (string.IsNullOrWhiteSpace(Convert.ToString(cmd.ExecuteScalar())))
                throw new InvalidOperationException("SQLCipher 不可用，拒绝退回明文数据库。");
            cmd.CommandText = "SELECT count(*) FROM sqlite_master;";
            cmd.ExecuteScalar(); // Validate password.
            cmd.CommandText = "PRAGMA foreign_keys=ON;"; cmd.ExecuteNonQuery();
            cmd.CommandText = "PRAGMA journal_mode=DELETE;"; cmd.ExecuteScalar();
            cmd.CommandText = "PRAGMA synchronous=FULL;"; cmd.ExecuteNonQuery();
            return db;
        }
        catch { db.Dispose(); throw; }
    }

    static void CreateTables(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
        CREATE TABLE records(
            id INTEGER PRIMARY KEY,
            workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
            title TEXT NOT NULL CHECK(length(trim(title))>0));
        CREATE TABLE attachments(
            id INTEGER PRIMARY KEY,
            record_id INTEGER NOT NULL REFERENCES records(id),
            filename TEXT NOT NULL,
            expected_size INTEGER NOT NULL,
            size INTEGER,
            sha256 TEXT,
            state TEXT NOT NULL CHECK(state IN ('writing','ready')));
        CREATE TABLE chunks(
            attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
            idx INTEGER NOT NULL,
            bytes BLOB NOT NULL,
            PRIMARY KEY(attachment_id,idx));
        """;
        cmd.ExecuteNonQuery();
    }

    static long Record(SqliteConnection db, string workspace, string name)
    {
        if (workspace is not ("company" or "personal")) throw new ArgumentException("请选择 company 或 personal。");
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("记录名称不能为空。");
        using var cmd = db.CreateCommand();
        cmd.CommandText = "INSERT INTO records(workspace,title) VALUES($w,$n); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$w", workspace);
        cmd.Parameters.AddWithValue("$n", name);
        return (long)cmd.ExecuteScalar()!;
    }

    static long Put(SqliteConnection db, long recordId, string filename)
    {
        var file = new FileInfo(filename);
        if (!file.Exists) throw new FileNotFoundException("原件不存在。", filename);
        using (var cmd = db.CreateCommand())
        {
            cmd.CommandText = "SELECT count(*) FROM records WHERE id=$id;";
            cmd.Parameters.AddWithValue("$id", recordId);
            if ((long)cmd.ExecuteScalar()! != 1L)
                throw new InvalidOperationException("请先创建所属业务记录。");
        }

        // Conservative estimate for demo. It cannot guarantee against external disk changes.
        string root = Path.GetPathRoot(Path.GetFullPath(db.DataSource))!;
        long available = new DriveInfo(root).AvailableFreeSpace;
        long reserve = Math.Max(128L * 1024 * 1024, file.Length / 3);
        if (file.Length > long.MaxValue - reserve || available < file.Length + reserve)
            throw new IOException("数据库所在磁盘空间不足，拒绝启动导入。");

        long id;
        using (var cmd = db.CreateCommand())
        {
            cmd.CommandText = """
            INSERT INTO attachments(record_id,filename,expected_size,state)
            VALUES($r,$n,$size,'writing'); SELECT last_insert_rowid();
            """;
            cmd.Parameters.AddWithValue("$r", recordId);
            cmd.Parameters.AddWithValue("$n", file.Name);
            cmd.Parameters.AddWithValue("$size", file.Length);
            id = (long)cmd.ExecuteScalar()!;
        }

        byte[] buffer = ArrayPool<byte>.Shared.Rent(Chunk);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long size = 0;
        int index = 0;
        try
        {
            using var input = new FileStream(file.FullName, FileMode.Open, FileAccess.Read,
                                             FileShare.Read, Chunk, FileOptions.SequentialScan);
            // Commit each batch of chunks: interrupted imports stay 'writing', never appear ready.
            SqliteTransaction tx = db.BeginTransaction();
            try
            {
                int read;
                while ((read = input.Read(buffer, 0, Chunk)) > 0)
                {
                    using var cmd = db.CreateCommand();
                    cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO chunks VALUES($id,$idx,$bytes);";
                    cmd.Parameters.AddWithValue("$id", id);
                    cmd.Parameters.AddWithValue("$idx", index);
                    cmd.Parameters.Add("$bytes", SqliteType.Blob).Value = buffer.AsSpan(0, read).ToArray();
                    cmd.ExecuteNonQuery();
                    hash.AppendData(buffer, 0, read);
                    size += read;
                    if (++index % 8 == 0)
                    {
                        tx.Commit();
                        tx.Dispose();
                        tx = db.BeginTransaction();
                    }
                }
                tx.Commit();
            }
            finally { tx.Dispose(); }
            if (size != file.Length) throw new IOException("源文件大小在导入中变化。");
            string digest = Convert.ToHexString(hash.GetHashAndReset());
            using var update = db.CreateCommand();
            update.CommandText = "UPDATE attachments SET state='ready',size=$s,sha256=$h WHERE id=$id;";
            update.Parameters.AddWithValue("$s", size);
            update.Parameters.AddWithValue("$h", digest);
            update.Parameters.AddWithValue("$id", id);
            if (update.ExecuteNonQuery() != 1) throw new IOException("完整文件提交失败。");
            Console.WriteLine($"导入完成：{size:N0} 字节，SHA-256={digest}");
            return id;
        }
        catch
        {
            Console.Error.WriteLine("当前附件保留为 writing 未完成状态，程序绝不会将其作为有效附件导出。");
            throw;
        }
        finally { ArrayPool<byte>.Shared.Return(buffer); }
    }

    static string Get(SqliteConnection db, long attachmentId, string folder)
    {
        if (!Directory.Exists(folder)) throw new DirectoryNotFoundException("请先创建导出目录：" + folder);
        string name, digest;
        long expected;
        using (var cmd = db.CreateCommand())
        {
            cmd.CommandText = "SELECT filename,size,sha256 FROM attachments WHERE id=$id AND state='ready';";
            cmd.Parameters.AddWithValue("$id", attachmentId);
            using var rd = cmd.ExecuteReader();
            if (!rd.Read()) throw new IOException("附件不存在或尚未完整导入。");
            name = rd.GetString(0); expected = rd.GetInt64(1); digest = rd.GetString(2);
        }
        if (name != Path.GetFileName(name)) throw new IOException("不安全的原文件名。");
        string target = Path.Combine(folder, name);
        if (File.Exists(target)) throw new IOException("目标文件已存在；不会覆盖：" + target);
        string partial = Path.Combine(folder, "." + Guid.NewGuid().ToString("N") + ".partial");
        try
        {
            using (var output = new FileStream(partial, FileMode.CreateNew, FileAccess.Write))
            using (var h = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
            using (var cmd = db.CreateCommand())
            {
                cmd.CommandText = "SELECT bytes FROM chunks WHERE attachment_id=$id ORDER BY idx;";
                cmd.Parameters.AddWithValue("$id", attachmentId);
                using var rd = cmd.ExecuteReader();
                long count = 0;
                while (rd.Read())
                {
                    byte[] bytes = (byte[])rd.GetValue(0);
                    output.Write(bytes);
                    h.AppendData(bytes);
                    count += bytes.Length;
                }
                output.Flush(true);
                if (count != expected ||
                    !Convert.ToHexString(h.GetHashAndReset()).Equals(digest, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("SHA-256/大小校验失败，不生成正式文件。");
            }
            File.Move(partial, target);
            return target;
        }
        finally { if (File.Exists(partial)) File.Delete(partial); }
    }

    static void List(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
        SELECT r.id,r.workspace,r.title,a.id,a.filename,a.state
        FROM records r LEFT JOIN attachments a ON a.record_id=r.id ORDER BY r.id,a.id;
        """;
        using var rd = cmd.ExecuteReader();
        while (rd.Read())
            Console.WriteLine($"{rd.GetInt64(0)} {rd.GetString(1)} {rd.GetString(2)}" +
                (rd.IsDBNull(3) ? "" : $" | 附件 {rd.GetInt64(3)} {rd.GetString(4)} [{rd.GetString(5)}]"));
    }

    static void Check(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = "PRAGMA integrity_check;";
        string result = Convert.ToString(cmd.ExecuteScalar()) ?? "";
        Console.WriteLine("SQLCipher integrity_check: " + result);
        if (result != "ok") throw new IOException("数据库校验失败。");
        cmd.CommandText = "SELECT count(*) FROM attachments WHERE state='writing';";
        Console.WriteLine("未完成的导入：" + cmd.ExecuteScalar() + "（不会自动清理）");
    }

    static void Smoke()
    {
        string dir = Path.Combine(Path.GetTempPath(), "IPSysM1-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            string dbPath = Path.Combine(dir, "test.db"), original = Path.Combine(dir, "source.bin");
            string destination = Path.Combine(dir, "export");
            Directory.CreateDirectory(destination);
            byte[] bytes = RandomNumberGenerator.GetBytes(1024 * 1024 + 31);
            File.WriteAllBytes(original, bytes);
            string password = Guid.NewGuid().ToString("N");
            using (var db = Open(dbPath, password, true))
            {
                CreateTables(db);
                long record = Record(db, "company", "综合资料");
                string exported = Get(db, Put(db, record, original), destination);
                if (!SHA256.HashData(File.ReadAllBytes(original))
                           .SequenceEqual(SHA256.HashData(File.ReadAllBytes(exported))))
                    throw new IOException("文件往返哈希不一致。");
                Check(db);
            }
            byte[] header = new byte[16];
            using (var f = File.OpenRead(dbPath)) f.ReadExactly(header);
            if (Encoding.ASCII.GetString(header).StartsWith("SQLite format 3"))
                throw new IOException("数据库未加密！");

            bool wrongPasswordRejected = false;
            try { using var wrong = Open(dbPath, "wrong-password", false); }
            catch (SqliteException) { wrongPasswordRejected = true; }
            if (!wrongPasswordRejected) throw new IOException("错误密码未拒绝。");

            string copy = Path.Combine(dir, "copied.db");
            File.Copy(dbPath, copy); // Connections have closed.
            using (var reopened = Open(copy, password, false)) Check(reopened);
            Console.WriteLine("SMOKE PASS：加密、错误密码、分块往返、SHA-256、关闭后复制及重开通过。");
        }
        finally
        {
            try { Directory.Delete(dir, recursive: true); }
            catch (IOException) { Console.Error.WriteLine("临时测试目录清理失败：" + dir); }
        }
    }
}
