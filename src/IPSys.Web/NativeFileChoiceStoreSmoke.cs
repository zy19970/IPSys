using Microsoft.Data.Sqlite;

static class NativeFileChoiceStoreSmoke
{
    static void Check(bool ok,string text)
    {
        if(!ok)throw new IOException("N3-04 SQLCipher: "+text);
    }
    static long Count(SqliteConnection db,string table,string where="1=1")
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText=$"SELECT COUNT(*) FROM {table} WHERE {where};";
        return (long)cmd.ExecuteScalar()!;
    }
    static long Folder(SqliteConnection db,string workspace,string name)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            INSERT INTO folders(workspace,kind,name)
            VALUES($w,'project',$name); SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$name",name);
        return (long)cmd.ExecuteScalar()!;
    }
    static long Object(SqliteConnection db,long fileId)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="SELECT object_id FROM file_versions WHERE file_id=$file AND version=1;";
        cmd.Parameters.AddWithValue("$file",fileId);
        return (long)cmd.ExecuteScalar()!;
    }
    public static void Run()
    {
        string path=Path.Combine(Path.GetTempPath(),
            "ipsys-n3-choice-"+Guid.NewGuid().ToString("N")+".db");
        try
        {
            using var v=new Vault();
            using(var db=Vault.Connect(path,"choice-test-key",create:true))
            {
                Vault.CreateSchema(db);
                v.SetOpen(db,path);
                long a=Folder(db,"company","目录甲");
                long b=Folder(db,"company","目录乙");
                long personal=Folder(db,"personal","私人目录");
                byte[] bytes={0,1,2,3,4,5,6,7,8};
                long source=NativeFileStore.UploadAsync(db,"company",a,null,
                    new NativeFileMetadataInput("已有资料.pdf","说明甲"),null,bytes.Length,
                    new MemoryStream(bytes),CancellationToken.None)
                    .GetAwaiter().GetResult().FileId;
                NativeFileStore.UploadAsync(db,"personal",personal,null,
                    new NativeFileMetadataInput("私有.pdf"),null,bytes.Length,
                    new MemoryStream(bytes),CancellationToken.None)
                    .GetAwaiter().GetResult();
                long originalObject=Object(db,source),readyBefore=Count(db,"file_objects","state='ready'");
                var pending=NativeFileChoiceStore.PrepareAsync(db,"company",b,
                    new NativeFileMetadataInput("同字节异名.docx","副本说明","标签"),
                    "首次上传",bytes.Length,new MemoryStream(bytes),CancellationToken.None)
                    .GetAwaiter().GetResult();
                v.PendingFile=pending;
                var matches=NativeFileChoiceStore.Matches(db,"company",pending.Size,pending.Sha256);
                Check(matches.Count==1 && matches[0].FileId==source &&
                      matches[0].Name=="已有资料.pdf" &&
                      matches[0].Folders.Any(x=>x.Contains("目录甲")),
                    "same-content different name shows original folder");
                Check(Count(db,"file_objects","state='writing'")==1,
                    "stage is an unfinished SQLCipher object");
                try
                {
                    NativeFileChoiceStore.Resolve(v,"company",pending.Ticket,
                        new NativeFileDecision("reuse-content",99999999),CancellationToken.None);
                    throw new IOException("unmatched source accepted");
                }
                catch(InvalidOperationException ex) when(
                    ex.Message.Contains("匹配文件")){}
                Check(v.PendingFile is not null &&
                      Count(db,"file_objects","state='writing'")==1,
                    "invalid choice retains stage for retry");
                var shared=NativeFileChoiceStore.Resolve(v,"company",pending.Ticket,
                    new NativeFileDecision("share-file",source),CancellationToken.None);
                Check(shared.FileId==source && shared.ReusedContent &&
                      Count(db,"files")==2 &&
                      Count(db,"file_objects","state='ready'")==readyBefore &&
                      Count(db,"file_objects","state='writing'")==0,
                    "share FileId adds link only and drops pending bytes");
                Check(NativeFileLinkStore.ListFolder(db,"company",b,false)!.Single()
                    .DisplayName=="同字节异名.docx","new link preserves user upload alias");
                try
                {
                    NativeFileChoiceStore.Require(v,"company",pending.Ticket);
                    throw new IOException("replay accepted");
                }
                catch(KeyNotFoundException){}

                // ISS-003: same Folder/FileId cannot be shared twice; return
                // a business explanation instead of a raw SQLite constraint.
                var repeated=NativeFileChoiceStore.PrepareAsync(db,"company",b,
                    new NativeFileMetadataInput("重复共享测试.pdf"),null,
                    bytes.Length,new MemoryStream(bytes),CancellationToken.None)
                    .GetAwaiter().GetResult();
                v.PendingFile=repeated;
                bool duplicateLinkRejected=false;
                try
                {
                    NativeFileChoiceStore.Resolve(v,"company",repeated.Ticket,
                        new NativeFileDecision("share-file",source),CancellationToken.None);
                }
                catch(InvalidOperationException ex) when(
                    ex.Message.Contains("已关联当前文件夹"))
                { duplicateLinkRejected=true; }
                Check(duplicateLinkRejected &&
                      NativeFileLinkStore.ListFolder(db,"company",b,false)!.Count==1,
                    "same-folder share fails with a readable error and no new link");
                NativeFileChoiceStore.Discard(db,repeated);
                v.PendingFile=null;

                var reuse=NativeFileChoiceStore.PrepareAsync(db,"company",b,
                    new NativeFileMetadataInput("仅复用物理字节.docx","副本单独备注"),
                    null,bytes.Length,new MemoryStream(bytes),CancellationToken.None)
                    .GetAwaiter().GetResult();
                v.PendingFile=reuse;
                var separate=NativeFileChoiceStore.Resolve(v,"company",reuse.Ticket,
                    new NativeFileDecision("reuse-content",source),CancellationToken.None);
                Check(separate.FileId!=source && Object(db,separate.FileId)==originalObject &&
                      Count(db,"file_objects","state='ready'")==readyBefore,
                    "two FileIds only share one ready physical object");
                Check(NativeFileStore.Get(db,"company",separate.FileId)!.Description=="副本单独备注",
                    "fresh independent metadata");
                NativeFileStore.UploadAsync(db,"company",null,separate.FileId,
                    new NativeFileMetadataInput("第二版.pdf"),null,1,
                    new MemoryStream(new byte[]{99}),CancellationToken.None)
                    .GetAwaiter().GetResult();
                Check(NativeFileStore.Get(db,"company",source)!.Versions.Count==1 &&
                      NativeFileStore.Get(db,"company",separate.FileId)!.Versions.Count==2,
                    "independent version history after content reuse");

                var indep=NativeFileChoiceStore.PrepareAsync(db,"company",b,
                    new NativeFileMetadataInput("真正单独原件.pdf"),
                    null,bytes.Length,new MemoryStream(bytes),CancellationToken.None)
                    .GetAwaiter().GetResult();
                v.PendingFile=indep;
                long before=Count(db,"file_objects","state='ready'");
                var standalone=NativeFileChoiceStore.Resolve(v,"company",indep.Ticket,
                    new NativeFileDecision("independent"),CancellationToken.None);
                Check(standalone.FileId!=source &&
                      Object(db,standalone.FileId)!=originalObject &&
                      Count(db,"file_objects","state='ready'")==before+1 &&
                      Count(db,"file_objects","state='writing'")==0,
                    "explicit independent creates one ready object");
                var downloaded=NativeFileStore.DownloadInfo(db,"company",standalone.FileId,1);
                using(var output=new MemoryStream())
                {
                    NativeFileStore.CopyAsync(db,"company",downloaded!.Value.ObjectId,
                        output,CancellationToken.None).GetAwaiter().GetResult();
                    Check(output.ToArray().SequenceEqual(bytes),"independent original bytes");
                }

                var cancel=NativeFileChoiceStore.PrepareAsync(db,"company",b,
                    new NativeFileMetadataInput("取消.pdf"),
                    null,bytes.Length,new MemoryStream(bytes),CancellationToken.None)
                    .GetAwaiter().GetResult();
                v.PendingFile=cancel;
                NativeFileChoiceStore.Discard(db,cancel);
                v.PendingFile=null;
                Check(Count(db,"file_objects","state='writing'")==0 &&
                      Count(db,"files")==4,"cancel removes staging only");
                long ready=Count(db,"file_objects","state='ready'");
                try
                {
                    NativeFileChoiceStore.PrepareAsync(db,"company",b,
                        new NativeFileMetadataInput("短文件.pdf"),
                        null,bytes.Length,new MemoryStream(new byte[]{7}),
                        CancellationToken.None).GetAwaiter().GetResult();
                    throw new IOException("short body accepted");
                }
                catch(IOException ex) when(ex.Message.Contains("不完整")){}
                Check(Count(db,"file_objects")==ready,"short input rollback");
                var abandoned=NativeFileChoiceStore.PrepareAsync(db,"company",b,
                    new NativeFileMetadataInput("未确认文件.pdf"),
                    null,bytes.Length,new MemoryStream(bytes),CancellationToken.None)
                    .GetAwaiter().GetResult();
                v.PendingFile=abandoned;
                Check(Count(db,"file_objects","state='writing'")==1,"abandoned stage exists");
                v.Close();
            }
            using(var reopened=Vault.Connect(path,"choice-test-key",create:false))
            {
                Vault.ValidateSchema(reopened);
                NativeFileChoiceStore.CleanupWriting(reopened);
                Check(Count(reopened,"file_objects","state='writing'")==0,
                    "close and reopen clean abandoned objects");
                Check(Count(reopened,"file_versions")>=4 &&
                      Count(reopened,"file_objects","state='ready'")>=4,
                    "ready original objects kept");
            }
        }
        finally{try{File.Delete(path);}catch(IOException){}}
        Console.WriteLine("N3-04 DUPLICATE CHOICE SQLCIPHER SMOKE PASS");
    }
}
