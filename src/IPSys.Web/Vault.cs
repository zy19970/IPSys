using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

sealed class Vault : IDisposable
{
    public SemaphoreSlim Gate { get; } = new(1, 1);
    private readonly object _taskSync = new();
    private TaskCompletionSource<bool>? _fileTaskCompletion;
    private CancellationTokenSource? _fileTaskCancellation;
    private bool _exitRequested;
    private bool _mcpEnabled;
    public bool McpEnabled {get {lock(_taskSync)return _db!=null&&_mcpEnabled;}}
    public bool SetMcpEnabled(bool enabled)
    {
        lock(_taskSync)
        {
            if(_db==null||_exitRequested||_fileTaskCompletion!=null)return false;
            _mcpEnabled=enabled;
            return true;
        }
    }
    public bool FileTaskActive { get { lock (_taskSync) return _fileTaskCompletion != null; } }
    public bool ExitRequested { get { lock (_taskSync) return _exitRequested; } }
    public bool TryBeginFileTask(HttpContext context, out CancellationToken cancellation)
    {
        lock (_taskSync)
        {
            if (!Allowed(context) || _fileTaskCompletion != null || _exitRequested)
            {
                cancellation = default;
                return false;
            }
            _fileTaskCancellation = new CancellationTokenSource();
            _fileTaskCompletion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            cancellation = _fileTaskCancellation.Token;
            return true;
        }
    }
    public void CompleteFileTask()
    {
        TaskCompletionSource<bool>? completion;
        CancellationTokenSource? cancellation;
        lock (_taskSync)
        {
            completion = _fileTaskCompletion;
            cancellation = _fileTaskCancellation;
            _fileTaskCompletion = null;
            _fileTaskCancellation = null;
        }
        completion?.TrySetResult(true);
        cancellation?.Dispose();
    }
    public bool TryScheduleExit(string choice, IHostApplicationLifetime life, out string error)
    {
        Task pending;
        lock (_taskSync)
        {
            if (choice == "stay")
            {
                error = "";
                return true;
            }
            if (_exitRequested)
            {
                error = "程序已进入安全退出流程。";
                return false;
            }
            if (_fileTaskCompletion != null && choice is not ("cancel" or "wait"))
            {
                error = "有文件任务正在执行，请选择取消任务并退出、任务完成后退出或暂不退出。";
                return false;
            }
            _exitRequested = true;
            pending = _fileTaskCompletion?.Task ?? Task.CompletedTask;
            if (choice == "cancel") _fileTaskCancellation?.Cancel();
            error = "";
        }
        _ = Task.Run(async () =>
        {
            try
            {
                // Let the browser receive the response before shutting down the host.
                await Task.Delay(200);
                await pending;
                await Gate.WaitAsync();
                try { Close(); }
                finally { Gate.Release(); }
                life.StopApplication();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("安全退出失败：" + ex.Message);
                lock (_taskSync) _exitRequested = false;
            }
        });
        return true;
    }
    private SqliteConnection? _db;
    private string? _token;
    public bool Unlocked => _db != null;
    public SqliteConnection Db => _db ?? throw new InvalidOperationException("请先解锁数据库。");
    public string Path { get; private set; } = "";
    public string SessionToken => _token ?? throw new InvalidOperationException("当前没有已打开的数据库。");

    public bool PasswordMatches(string password)
    {
        if (!Unlocked || string.IsNullOrEmpty(password)) return false;
        try
        {
            // Open a SECOND read-only connection. It cannot modify or replace the
            // WinForms-owned connection and fails when the SQLCipher key is invalid.
            var builder = new SqliteConnectionStringBuilder
            {
                DataSource = Path,
                Mode = SqliteOpenMode.ReadOnly,
                Password = password,
                Pooling = false
            };
            using var check = new SqliteConnection(builder.ToString());
            check.Open();
            using var cmd = check.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM sqlite_master;";
            _ = cmd.ExecuteScalar();
            return true;
        }
        catch (SqliteException)
        {
            return false;
        }
    }
    public bool Allowed(HttpContext context)
    {
        lock (_taskSync)
        {
            if (_db == null || _token == null) return false;
            string header = context.Request.Headers["X-IPSys-Token"].ToString();
            return header.Length == _token.Length &&
                   CryptographicOperations.FixedTimeEquals(
                       Encoding.ASCII.GetBytes(header), Encoding.ASCII.GetBytes(_token));
        }
    }
    public string SetOpen(SqliteConnection db, string path)
    {
        lock (_taskSync)
        {
            if (_db != null) throw new InvalidOperationException("已经打开另一数据库。");
            _db = db; Path = path;_mcpEnabled=false;
            _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            return _token;
        }
    }
    public void Close()
    {
        lock (_taskSync)
        {
            // Keep the existing connection state if disposal fails so the caller
            // can report a close failure rather than silently treating it as safe.
            _db?.Dispose();
            _db = null;
            _mcpEnabled=false;
            _token = null;
            Path = "";
        }
    }
    public void Dispose()
    {
        Close();
        _fileTaskCancellation?.Dispose();
        Gate.Dispose();
    }
    public static bool WorkspaceValid(string work) => work is "company" or "personal";
    public static SqliteConnection Connect(string path, string password, bool create)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = create ? SqliteOpenMode.ReadWriteCreate : SqliteOpenMode.ReadWrite,
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
                throw new IOException("当前 SQLite 不支持 SQLCipher，拒绝明文降级。");
            cmd.CommandText = "SELECT count(*) FROM sqlite_master;";
            cmd.ExecuteScalar(); // Throws when database password is incorrect.
            cmd.CommandText = "PRAGMA foreign_keys=ON;"; cmd.ExecuteNonQuery();
            cmd.CommandText = "PRAGMA journal_mode=DELETE;"; cmd.ExecuteScalar();
            cmd.CommandText = "PRAGMA synchronous=FULL;"; cmd.ExecuteNonQuery();
            return db;
        }
        catch { db.Dispose(); throw; }
    }
    public static void CreateSchema(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE records(id INTEGER PRIMARY KEY,workspace TEXT NOT NULL
                CHECK(workspace IN ('company','personal')), title TEXT NOT NULL
                CHECK(length(trim(title))>0));
            CREATE TABLE attachments(id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL
                REFERENCES records(id),filename TEXT NOT NULL,expected_size INTEGER NOT NULL,
                size INTEGER,sha256 TEXT,state TEXT NOT NULL CHECK(state IN ('writing','ready')));
            CREATE TABLE chunks(attachment_id INTEGER NOT NULL REFERENCES attachments(id)
                ON DELETE CASCADE,idx INTEGER NOT NULL,bytes BLOB NOT NULL,
                PRIMARY KEY(attachment_id,idx));
            """;
        cmd.ExecuteNonQuery();
        ResourceSchemaV2.Create(db);
    }
    public static void ValidateSchema(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('records','attachments','chunks');";
        if ((long)cmd.ExecuteScalar()! != 3L)
            throw new IOException("不支持该数据库的表结构；请新建新版资料库。");
        ResourceSchemaV2.Validate(db);
    }
}
