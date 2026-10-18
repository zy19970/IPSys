using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

sealed class Vault : IDisposable
{
    public SemaphoreSlim Gate { get; } = new(1, 1);
    // Protected by Gate: a single unconfirmed encrypted N3-04 upload per vault.
    internal NativeFilePreparation? PendingFile { get; set; }
    private readonly object _taskSync = new();
    private TaskCompletionSource<bool>? _fileTaskCompletion;
    private RecyclePurgeJob? _lastRecyclePurge;
    private VaultCompactJob? _lastVaultCompact;
    public VaultCompactJob? LastVaultCompact
    {
        get { lock(_taskSync)return _lastVaultCompact; }
    }
    public void SetVaultCompact(VaultCompactJob job)
    {
        lock(_taskSync)_lastVaultCompact=job;
    }
    public RecyclePurgeJob? LastRecyclePurge
    {
        get { lock(_taskSync)return _lastRecyclePurge; }
    }
    public void SetRecyclePurge(RecyclePurgeJob task)
    {
        lock(_taskSync)_lastRecyclePurge=task;
    }
    private CancellationTokenSource? _fileTaskCancellation;
    private bool _exitRequested;
    private bool _mcpEnabled;
    private CancellationTokenSource _mcpCancellation = new();
    private readonly List<CancellationTokenSource> _retiredMcpTokens = new();
    public CancellationToken McpCancellation
    {
        get { lock(_taskSync)return _mcpCancellation.Token; }
    }
    public bool McpEnabled {get {lock(_taskSync)return _db!=null&&_mcpEnabled;}}
    public bool SetMcpEnabled(bool enabled)
    {
        lock(_taskSync)
        {
            if(_db==null||_exitRequested)return false;
            if(enabled && _fileTaskCompletion!=null)return false;
            if(!enabled)
            {
                _mcpEnabled=false;
                _mcpCancellation.Cancel();
            }
            else if(!_mcpEnabled)
            {
                _retiredMcpTokens.Add(_mcpCancellation);
                _mcpCancellation=new CancellationTokenSource();
                _mcpEnabled=true;
            }
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
            _retiredMcpTokens.Add(_mcpCancellation);
            _mcpCancellation=new CancellationTokenSource();
            _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            return _token;
        }
    }
    public void Close()
    {
        lock (_taskSync)
        {
            if (_db != null) NativeFileChoiceStore.CleanupWriting(_db);
            PendingFile = null;
            _lastRecyclePurge = null;
            _lastVaultCompact = null;
            // Keep the existing connection state if disposal fails so the caller
            // can report a close failure rather than silently treating it as safe.
            _db?.Dispose();
            _db = null;
            _mcpEnabled=false;
            _mcpCancellation.Cancel();
            _token = null;
            Path = "";
        }
    }
    public void Dispose()
    {
        Close();
        _fileTaskCancellation?.Dispose();
        _mcpCancellation.Dispose();
        foreach(var token in _retiredMcpTokens)token.Dispose();
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
        // New vaults use only the canonical resource model.
        ResourceSchemaV2.Create(db);
    }
    public static void ValidateSchema(SqliteConnection db)
    {
        ResourceSchemaV2.Validate(db);
        // An existing V2 database may have the original immutable-byte trigger.
        // Update only that guard, atomically, without changing FileId/Version/LinkId.
        ResourceSchemaV2.EnsureOrphanPurgeTrigger(db);
    }
}
