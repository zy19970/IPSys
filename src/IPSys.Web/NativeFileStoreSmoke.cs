using Microsoft.Data.Sqlite;

// N3-01: encrypted SQLite transaction rollback and persistence, beyond HTTP happy path.
static class NativeFileStoreSmoke
{
    public static void Run()
    {
        static void Check(bool ok,string why)
        {
            if(!ok)throw new IOException("N3 native file store: "+why);
        }
        static long Count(SqliteConnection db,string table)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="SELECT count(*) FROM "+table+";";
            return (long)cmd.ExecuteScalar()!;
        }
        var path=Path.Combine(Path.GetTempPath(),
            "ipsys-n3-file-"+Guid.NewGuid().ToString("N")+".db");
        try
        {
            long fileId,folderId;
            using(var db=Vault.Connect(path,"n3-disposable-secret",create:true))
            {
                Vault.CreateSchema(db);
                using(var cmd=db.CreateCommand())
                {
                    cmd.CommandText="""
                        INSERT INTO folders(workspace,kind,name)
                        VALUES('company','project','测试项目');
                        SELECT last_insert_rowid();
                        """;
                    folderId=(long)cmd.ExecuteScalar()!;
                }
                try
                {
                    NativeFileStore.UploadAsync(db,"company",folderId,null,
                        new NativeFileMetadataInput("不完整.pdf"),null,5,
                        new MemoryStream(new byte[]{1,2}),CancellationToken.None)
                        .GetAwaiter().GetResult();
                    throw new IOException("short body was accepted");
                }
                catch(IOException ex) when(ex.Message.Contains("原件字节数")){}
                Check(Count(db,"files")==0 && Count(db,"file_objects")==0 &&
                      Count(db,"file_versions")==0 && Count(db,"file_chunks")==0 &&
                      Count(db,"folder_file_links")==0,"short input must rollback everything");

                using var canceled=new CancellationTokenSource();
                canceled.Cancel();
                try
                {
                    NativeFileStore.UploadAsync(db,"company",folderId,null,
                        new NativeFileMetadataInput("取消.pdf"),null,3,
                        new MemoryStream(new byte[]{1,2,3}),canceled.Token)
                        .GetAwaiter().GetResult();
                    throw new IOException("cancel was accepted");
                }
                catch(OperationCanceledException){}
                Check(Count(db,"files")==0 && Count(db,"file_objects")==0,
                    "cancel must rollback all uncommitted objects");
                var good=NativeFileStore.UploadAsync(db,"company",folderId,null,
                    new NativeFileMetadataInput("持久文件.pdf"),null,3,
                    new MemoryStream(new byte[]{1,2,3}),CancellationToken.None)
                    .GetAwaiter().GetResult();
                fileId=good.FileId;
                Check(good.Version==1 && Count(db,"file_objects")==1 &&
                      Count(db,"folder_file_links")==1,"atomic first link");
                using var output=new MemoryStream();
                var info=NativeFileStore.DownloadInfo(db,"company",fileId,1);
                Check(info.HasValue,"download metadata");
                NativeFileStore.CopyAsync(db,"company",info!.Value.ObjectId,output,
                    CancellationToken.None).GetAwaiter().GetResult();
                Check(output.ToArray().SequenceEqual(new byte[]{1,2,3}),"content bytes");
            }
            using(var db=Vault.Connect(path,"n3-disposable-secret",create:false))
            {
                Vault.ValidateSchema(db);
                Check(NativeFileStore.Get(db,"company",fileId)?.Versions.Count==1,
                    "reopen and query historical versions");
                Check(NativeFileStore.Get(db,"personal",fileId)==null,
                    "workspace isolation after reopen");
            }
        }
        finally
        {
            try{File.Delete(path);}catch(IOException){}
        }
        Console.WriteLine("N3-01 NATIVE FILE STORE SMOKE PASS");
    }
}
