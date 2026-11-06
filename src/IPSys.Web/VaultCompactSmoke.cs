using Microsoft.Data.Sqlite;

// Disposable encrypted vault only; never compact the user's actual database.
static class VaultCompactSmoke
{
    private static void Check(bool condition,string message)
    {
        if(!condition)throw new IOException("VAULT COMPACT SMOKE: "+message);
    }
    private static long Scalar(SqliteConnection db,string sql)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText=sql;
        return Convert.ToInt64(cmd.ExecuteScalar());
    }
    public static void Run()
    {
        string dir=Path.Combine(Path.GetTempPath(),"ipsys-compact-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        string path=Path.Combine(dir,"encrypted.db");
        const string password="compact-test-only";
        try
        {
            using(var db=Vault.Connect(path,password,true))
            {
                Vault.CreateSchema(db);
                Check(Scalar(db,"PRAGMA auto_vacuum;")==2,
                    "new vaults must be created with auto_vacuum=INCREMENTAL");
                using(var cmd=db.CreateCommand())
                {
                    cmd.CommandText="""
                        CREATE TABLE compact_fixture(id INTEGER PRIMARY KEY,data BLOB);
                        INSERT INTO compact_fixture(data) VALUES(zeroblob(4194304));
                        INSERT INTO compact_fixture(data) VALUES(zeroblob(4194304));
                        DELETE FROM compact_fixture WHERE id=1;
                        """;
                    cmd.ExecuteNonQuery();
                }
                var info=VaultCompactStore.Inspect(db,path);
                Check(info.Mode=="incremental",
                    "inspected mode must match the created vault");
                Check(info.FreePages>0&&info.ReusableBytes>0,
                    "SQLite must report reusable pages before reclaim");
                Check(info.CanCompact,"disposable fixture has adequate scratch space");
                // The reclaim precheck must not be the 2x VACUUM figure, otherwise a
                // nearly full disk could never reclaim the space it needs.
                Check(info.RequiredFreeBytes<info.FullVacuumRequiredBytes,
                    "reclaim scratch requirement must be far below the full VACUUM one");
                long before=info.FileBytes,usable=info.ReusableBytes;

                var reclaim=new VaultCompactJob();
                VaultCompactStore.Reclaim(db,path,reclaim,CancellationToken.None);
                var reclaimed=reclaim.Snapshot();
                Check(reclaimed.State=="succeeded"&&reclaimed.Mode=="reclaim",
                    "in-place reclaim must report success");
                Check(reclaimed.ReusableBefore==usable,
                    "reclaim must report the real free-page estimate");
                Check(Scalar(db,"PRAGMA freelist_count;")==0,
                    "reclaim must leave no free pages behind");
                Check(new FileInfo(path).Length<before,
                    "reclaim must reduce the encrypted file size");

                var full=new VaultCompactJob();
                VaultCompactStore.Compact(db,path,full,CancellationToken.None);
                Check(full.Snapshot().State=="succeeded",
                    "full VACUUM must remain available as an escape hatch");
                Check(Scalar(db,"PRAGMA auto_vacuum;")==2,
                    "VACUUM must preserve the incremental mode");

                using var verify=db.CreateCommand();
                verify.CommandText="SELECT length(data) FROM compact_fixture;";
                Check(Convert.ToInt64(verify.ExecuteScalar())==4194304,
                    "remaining encrypted BLOB must survive both paths");
            }
            using(var reopened=Vault.Connect(path,password,false))
            {
                Vault.ValidateSchema(reopened);
                Check(Scalar(reopened,"PRAGMA auto_vacuum;")==2,
                    "reopened vault must still report the incremental mode");
                using var cmd=reopened.CreateCommand();
                cmd.CommandText="PRAGMA integrity_check;";
                Check(Convert.ToString(cmd.ExecuteScalar())=="ok",
                    "reclaimed vault must reopen encrypted and pass integrity check");
            }
            try
            {
                using var wrong=Vault.Connect(path,"wrong-compact-password",false);
                throw new IOException("VAULT COMPACT SMOKE: incorrect key opened encrypted vault");
            }
            catch(SqliteException){/* expected SQLCipher rejection */}
        }
        finally
        {
            // A rejected key keeps the SQLCipher handle alive until finalization,
            // so a single delete attempt is not reliable.
            for(int attempt=0;attempt<6;attempt++)
            {
                try
                {
                    if(!Directory.Exists(dir))break;
                    Directory.Delete(dir,true);
                    break;
                }
                catch(IOException)
                {
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                    Thread.Sleep(100);
                }
            }
        }
        Console.WriteLine("SQLCIPHER IN-PLACE RECLAIM + FULL VACUUM SMOKE PASS");
    }
}
