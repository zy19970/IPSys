using Microsoft.Data.Sqlite;

// Disposable SQLCipher tests for permanent LinkId purge and orphaned physical
// chunks. Shared FileId, independent reused FileObject and workspaces are
// intentionally independent identities.
static class RecyclePurgeSmoke
{
    private static void Check(bool ok,string what)
    {
        if(!ok)throw new IOException("RECYCLE PURGE: "+what);
    }
    private static long Scalar(SqliteConnection db,string sql,long id=0)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText=sql;
        cmd.Parameters.AddWithValue("$id",id);
        return (long)cmd.ExecuteScalar()!;
    }
    private static long Folder(SqliteConnection db,string workspace,string name)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="INSERT INTO folders(workspace,kind,name) VALUES($w,'project',$name); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$name",name);
        return (long)cmd.ExecuteScalar()!;
    }
    private static long Link(SqliteConnection db,long fileId,long folderId)
    {
        return Scalar(db,"SELECT id FROM folder_file_links WHERE file_id=$id AND folder_id="+folderId+";",fileId);
    }
    private static void Remove(SqliteConnection db,string workspace,long fileId,long linkId)
    {
        Check(NativeFileLinkStore.Unlink(db,workspace,fileId,linkId),"soft unlink");
        Check(RecycleStore.Change(db,workspace,
            [new RecycleKey("v2_file",linkId,"")],true),"permanent LinkId purge");
    }
    public static void Run()
    {
        string path=Path.Combine(Path.GetTempPath(),"ipsys-recycle-gc-"+
            Guid.NewGuid().ToString("N")+".db");
        try
        {
            using(var db=Vault.Connect(path,"recycle-gc-disposable",create:true))
            {
                Vault.CreateSchema(db);
                long a=Folder(db,"company","共享甲"),b=Folder(db,"company","共享乙");
                long personal=Folder(db,"personal","个人项目");
                byte[] payload={1,3,5,7,9,11};
                var first=NativeFileStore.UploadAsync(db,"company",a,null,
                    new NativeFileMetadataInput("共享文件.bin"),null,payload.Length,
                    new MemoryStream(payload),CancellationToken.None)
                    .GetAwaiter().GetResult();
                long originalId=Scalar(db,
                    "SELECT object_id FROM file_versions WHERE file_id=$id;",first.FileId);
                byte[] revision={2,4,6,8,10};
                var next=NativeFileStore.UploadAsync(db,"company",null,first.FileId,
                    new NativeFileMetadataInput("共享文件-v2.bin"),"第二版",
                    revision.Length,new MemoryStream(revision),CancellationToken.None)
                    .GetAwaiter().GetResult();
                Check(next.Version==2,"version history is appended");
                long secondObject=Scalar(db,
                    "SELECT object_id FROM file_versions WHERE file_id=$id AND version=2;",first.FileId);
                long linkA=Link(db,first.FileId,a);
                long linkB=NativeFileLinkStore.Add(db,"company",first.FileId,
                    new NativeFileLinkInput(b));
                Remove(db,"company",first.FileId,linkA);
                Check(Scalar(db,"SELECT COUNT(*) FROM file_chunks WHERE object_id=$id;",originalId)==1,
                    "one remaining shared LinkId must protect original chunks");
                Check(NativeFileStore.DownloadInfo(db,"company",first.FileId,1)!=null,
                    "other folder can still read shared original");
                Check(NativeFileStore.DownloadInfo(db,"company",first.FileId,2)!=null,
                    "other folder can still read second historical version");
                Check(NativeFileLinkStore.Unlink(db,"company",first.FileId,linkB),
                    "second link unlinked");
                Check(NativeFileLinkStore.Restore(db,"company",first.FileId,linkB),
                    "remaining restorable link still intact");
                Remove(db,"company",first.FileId,linkB);
                Check(Scalar(db,"SELECT COUNT(*) FROM file_versions WHERE file_id=$id;",first.FileId)==0,
                    "last LinkId purge removes all versions");
                Check(Scalar(db,"SELECT COUNT(*) FROM files WHERE id=$id;",first.FileId)==0,
                    "last LinkId purge removes orphan FileId");
                Check(Scalar(db,"SELECT COUNT(*) FROM file_chunks WHERE object_id=$id;",originalId)==0,
                    "last LinkId purge removes physical chunks");
                Check(Scalar(db,"SELECT COUNT(*) FROM file_objects WHERE id=$id;",originalId)==0,
                    "last LinkId purge removes orphan object metadata");
                Check(Scalar(db,"SELECT COUNT(*) FROM file_chunks WHERE object_id=$id;",secondObject)==0 &&
                      Scalar(db,"SELECT COUNT(*) FROM file_objects WHERE id=$id;",secondObject)==0,
                    "last LinkId purge removes every historical version content object");

                // A different FileId may reuse the SAME immutable FileObject.
                var independent=NativeFileStore.UploadAsync(db,"company",a,null,
                    new NativeFileMetadataInput("独立甲.bin"),null,payload.Length,
                    new MemoryStream(payload),CancellationToken.None)
                    .GetAwaiter().GetResult();
                long reusedObj=Scalar(db,
                    "SELECT object_id FROM file_versions WHERE file_id=$id;",independent.FileId);
                long secondFile;
                using(var create=db.CreateCommand())
                {
                    create.CommandText="INSERT INTO files(workspace,name) VALUES('company','独立乙.bin'); SELECT last_insert_rowid();";
                    secondFile=(long)create.ExecuteScalar()!;
                    create.CommandText="""
                        INSERT INTO file_versions(file_id,workspace,version,object_id,original_name)
                        VALUES($file,'company',1,$obj,'独立乙.bin');
                        INSERT INTO folder_file_links(workspace,folder_id,file_id)
                        VALUES('company',$folder,$file);
                        """;
                    create.Parameters.AddWithValue("$file",secondFile);
                    create.Parameters.AddWithValue("$obj",reusedObj);
                    create.Parameters.AddWithValue("$folder",b);
                    create.ExecuteNonQuery();
                }
                long independentA=Link(db,independent.FileId,a);
                long independentB=Link(db,secondFile,b);
                Remove(db,"company",independent.FileId,independentA);
                Check(Scalar(db,"SELECT COUNT(*) FROM file_chunks WHERE object_id=$id;",reusedObj)==1,
                    "independent FileId version still protects reused immutable bytes");
                Check(NativeFileStore.DownloadInfo(db,"company",secondFile,1)!=null,
                    "independent reused content remains accessible");
                Remove(db,"company",secondFile,independentB);
                Check(Scalar(db,"SELECT COUNT(*) FROM file_chunks WHERE object_id=$id;",reusedObj)==0,
                    "last independent FileId removal reclaims shared physical bytes");

                // Real byte progress is transactional: an interrupted delete
                // must restore every data chunk and the tombstoned LinkId.
                byte[] large=new byte[2*1024*1024+9];
                for(int i=0;i<large.Length;i++)large[i]=(byte)(i%251);
                var progressFile=NativeFileStore.UploadAsync(db,"company",a,null,
                    new NativeFileMetadataInput("进度回收.bin"),null,large.LongLength,
                    new MemoryStream(large),CancellationToken.None)
                    .GetAwaiter().GetResult();
                long progressLink=Link(db,progressFile.FileId,a);
                long progressObject=Scalar(db,
                    "SELECT object_id FROM file_versions WHERE file_id=$id;",progressFile.FileId);
                Check(NativeFileLinkStore.Unlink(db,"company",progressFile.FileId,progressLink),
                    "progress fixture tombstone");
                var progressItems=new[]{new RecycleKey("v2_file",progressLink,"")};
                using(var canceled=new CancellationTokenSource())
                {
                    bool caught=false;
                    try
                    {
                        RecycleStore.Change(db,"company",progressItems,true,
                            (done,total,stage)=>
                            {
                                Check(total==large.LongLength,"accurate planned bytes");
                                if(done>0)canceled.Cancel();
                            },canceled.Token);
                    }
                    catch(OperationCanceledException){caught=true;}
                    Check(caught,"requested cancellation before commit must rollback");
                }
                Check(Scalar(db,
                    "SELECT COUNT(*) FROM folder_file_links WHERE id=$id AND deleted=1;",progressLink)==1,
                    "canceled purge preserves restorable tombstone");
                Check(Scalar(db,
                    "SELECT COUNT(*) FROM file_chunks WHERE object_id=$id;",progressObject)==3,
                    "canceled purge restores all three SQLCipher chunks");
                var reports=new List<(long Done,long Total,string Stage)>();
                Check(RecycleStore.Change(db,"company",progressItems,true,
                    (done,total,stage)=>reports.Add((done,total,stage))),
                    "reported purge succeeds");
                Check(reports.Any(x=>x.Stage=="正在清理加密原件数据块" &&
                     x.Done==large.LongLength && x.Total==large.LongLength),
                    "progress counts actual removed bytes");
                Check(reports.Last().Stage=="数据清理已执行，正在提交事务",
                    "commit is distinguished from physical deletion");
                Check(Scalar(db,"SELECT COUNT(*) FROM file_chunks WHERE object_id=$id;",progressObject)==0,
                    "success physically reclaims orphan chunks");

                // The other workspace must never lose its own physical object.
                var personalFile=NativeFileStore.UploadAsync(db,"personal",personal,null,
                    new NativeFileMetadataInput("私人.bin"),null,payload.Length,
                    new MemoryStream(payload),CancellationToken.None)
                    .GetAwaiter().GetResult();
                Check(NativeFileStore.DownloadInfo(db,"personal",personalFile.FileId,1)!=null,
                    "personal original independent of company cleanup");
            }
            // Existing V2 vaults originally shipped a trigger that rejects even
            // orphan-ready chunk deletion. Validation upgrades only that trigger.
            using(var db=Vault.Connect(path,"recycle-gc-disposable",create:false))
            {
                using(var legacy=db.CreateCommand())
                {
                    legacy.CommandText="""
                        DROP TRIGGER chunk_delete_ready;
                        CREATE TRIGGER chunk_delete_ready BEFORE DELETE ON file_chunks
                        WHEN EXISTS(SELECT 1 FROM file_objects
                          WHERE id=OLD.object_id AND workspace=OLD.workspace AND state='ready')
                        BEGIN SELECT RAISE(ABORT,'completed content bytes are immutable'); END;
                        """;
                    legacy.ExecuteNonQuery();
                }
                Vault.ValidateSchema(db);
                Check(Scalar(db,"SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='chunk_delete_ready' AND sql LIKE '%file_versions%';")==1,
                    "existing V2 cleanup trigger updated safely without replacing data");
                Vault.ValidateSchema(db); // Idempotent.
            }
        }
        finally{try{File.Delete(path);}catch(IOException){}}
        Console.WriteLine("RECYCLE PHYSICAL GARBAGE COLLECTION SMOKE PASS");
    }
}
