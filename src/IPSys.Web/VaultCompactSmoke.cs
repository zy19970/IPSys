using Microsoft.Data.Sqlite;

// Disposable encrypted vault only; never compact the user's actual database.
static class VaultCompactSmoke
{
    private static void Check(bool condition,string message)
    {
        if(!condition)throw new IOException("VAULT COMPACT SMOKE: "+message);
    }
    public static void Run()
    {
        string dir=Path.Combine(Path.GetTempPath(),"ipsys-compact-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        string path=Path.Combine(dir,"encrypted.db");
        const string password="compact-test-only";
        try
        {
            long before,usable;
            using(var db=Vault.Connect(path,password,true))
            {
                Vault.CreateSchema(db);
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
                before=info.FileBytes;usable=info.ReusableBytes;
                Check(info.FreePages>0 && info.ReusableBytes>0,
                    "SQLite must report reusable pages before VACUUM");
                Check(info.CanCompact,"disposable fixture has adequate scratch space");
                var task=new VaultCompactJob();
                VaultCompactStore.Compact(db,path,task,CancellationToken.None);
                var status=task.Snapshot();
                Check(status.State=="succeeded"&&status.ReusableBefore==usable,
                    "SQLCipher VACUUM must report success and the real free-page estimate");
                Check(status.BytesAfter<before,"SQLCipher VACUUM must reduce the test file");
                using var verify=db.CreateCommand();
                verify.CommandText="SELECT length(data) FROM compact_fixture;";
                Check(Convert.ToInt64(verify.ExecuteScalar())==4194304,
                    "remaining encrypted BLOB must survive");
            }
            using(var reopened=Vault.Connect(path,password,false))
            {
                Vault.ValidateSchema(reopened);
                using var cmd=reopened.CreateCommand();
                cmd.CommandText="PRAGMA integrity_check;";
                Check(Convert.ToString(cmd.ExecuteScalar())=="ok",
                    "compacted vault must reopen encrypted and pass integrity check");
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
            try{Directory.Delete(dir,true);}catch(IOException){}
        }
        Console.WriteLine("SQLCIPHER MANUAL VACUUM SMOKE PASS");
    }
}
