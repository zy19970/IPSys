using Microsoft.Data.Sqlite;
using System.Security.Cryptography;

static class NativeFileCopyStoreSmoke
{
    public static void Run()
    {
        static void Check(bool good,string reason)
        {
            if(!good)throw new IOException("N3-03 copy SQLCipher: "+reason);
        }
        static long Folder(SqliteConnection db,string workspace)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="""
                INSERT INTO folders(workspace,kind,name)
                VALUES($w,'project','复制测试');
                SELECT last_insert_rowid();
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            return (long)cmd.ExecuteScalar()!;
        }
        static long Count(SqliteConnection db,string table)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="SELECT count(*) FROM "+table+";";
            return (long)cmd.ExecuteScalar()!;
        }
        static long Object(SqliteConnection db,long fileId,int version)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="SELECT object_id FROM file_versions WHERE file_id=$file AND version=$v;";
            cmd.Parameters.AddWithValue("$file",fileId);
            cmd.Parameters.AddWithValue("$v",version);
            return (long)cmd.ExecuteScalar()!;
        }
        var path=Path.Combine(Path.GetTempPath(),
            "ipsys-n3-copy-"+Guid.NewGuid().ToString("N")+".db");
        try
        {
            using var db=Vault.Connect(path,"n3-copy-temporary-key",create:true);
            Vault.CreateSchema(db);
            long companyFolder=Folder(db,"company"),personalFolder=Folder(db,"personal");
            byte[] first=new byte[]{11,22,33,44,55};
            byte[] second=new byte[]{4,3,2,1};
            long source=NativeFileStore.UploadAsync(db,"company",companyFolder,null,
                new NativeFileMetadataInput("甲.pdf","原始说明","原始标签","NO-1","2026-10-15"),
                "初稿",first.Length,new MemoryStream(first),CancellationToken.None)
                .GetAwaiter().GetResult().FileId;
            NativeFileStore.UploadAsync(db,"company",null,source,
                new NativeFileMetadataInput("乙.pdf"),"新版",second.Length,
                new MemoryStream(second),CancellationToken.None).GetAwaiter().GetResult();
            long originalObject1=Object(db,source,1),originalObject2=Object(db,source,2);
            var reused=NativeFileCopyStore.CopyAsync(db,"company",source,
                new NativeFileCopyInput("company",companyFolder,"reuse-content","异名副本.pdf"),
                CancellationToken.None).GetAwaiter().GetResult();
            Check(reused.FileId!=source && reused.FileId>0 &&
                reused.Versions==2 && reused.ReusedObjects==2 &&
                reused.NewObjects==0,"new logical identity reuses two existing objects");
            Check(Count(db,"file_objects")==2 && Count(db,"file_chunks")==2,
                "same workspace reuse doesn't duplicate bytes");
            Check(Object(db,reused.FileId,1)==originalObject1 &&
                  Object(db,reused.FileId,2)==originalObject2,
                "identical physical object ID but separate version records");
            Check(NativeFileStore.Get(db,"company",reused.FileId)!.Name=="异名副本.pdf" &&
                  NativeFileStore.Get(db,"company",reused.FileId)!.Versions.Count==2,
                  "independent copy name, full history");
            var renamed=new NativeFileMetadataInput("独立版本管理.pdf","副本备注","副本",
                "NO-2",null);
            Check(NativeFileStore.UpdateMetadata(db,"company",reused.FileId,renamed),
                "edit copy metadata");
            Check(NativeFileStore.Get(db,"company",source)!.Description=="原始说明" &&
                  NativeFileStore.Get(db,"company",reused.FileId)!.Description=="副本备注",
                "metadata independent");
            NativeFileStore.UploadAsync(db,"company",null,reused.FileId,
                new NativeFileMetadataInput("仅副本v3.pdf"),"副本修订",1,
                new MemoryStream(new byte[]{99}),CancellationToken.None)
                .GetAwaiter().GetResult();
            Check(NativeFileStore.Get(db,"company",source)!.Versions.Count==2 &&
                  NativeFileStore.Get(db,"company",reused.FileId)!.Versions.Count==3,
                "different FileId version numbers and histories independent");
            Check(Object(db,reused.FileId,1)==originalObject1,
                "updating copied file doesn't change shared immutable older objects");

            try
            {
                NativeFileCopyStore.CopyAsync(db,"company",source,
                    new NativeFileCopyInput("personal",personalFolder,"reuse-content"),
                    CancellationToken.None).GetAwaiter().GetResult();
                throw new IOException("cross workspace physical reuse accepted");
            }
            catch(ArgumentException){}
            Check(Count(db,"files")==2,"cross reuse rejection leaves no file");
            var cross=NativeFileCopyStore.CopyAsync(db,"company",source,
                new NativeFileCopyInput("personal",personalFolder,"independent-content"),
                CancellationToken.None).GetAwaiter().GetResult();
            Check(cross.Versions==2 && cross.ReusedObjects==0 && cross.NewObjects==2,
                "cross workspace creates new independent objects");
            Check(Object(db,cross.FileId,1)!=originalObject1 &&
                  Object(db,cross.FileId,2)!=originalObject2,
                "separate encrypted physical objects");
            using(var cmd=db.CreateCommand())
            {
                cmd.CommandText="SELECT count(*) FROM file_objects WHERE workspace='personal';";
                Check((long)cmd.ExecuteScalar()! == 2,"two personal-only objects");
            }
            foreach(int version in new[]{1,2})
            {
                var sourceInfo=NativeFileStore.DownloadInfo(db,"company",source,version)!.Value;
                var targetInfo=NativeFileStore.DownloadInfo(db,"personal",cross.FileId,version)!.Value;
                Check(sourceInfo.Digest==targetInfo.Digest &&
                      sourceInfo.ObjectId!=targetInfo.ObjectId,"same hash, independent object");
                using var sourceBytes=new MemoryStream();
                using var targetBytes=new MemoryStream();
                NativeFileStore.CopyAsync(db,"company",sourceInfo.ObjectId,sourceBytes,
                    CancellationToken.None).GetAwaiter().GetResult();
                NativeFileStore.CopyAsync(db,"personal",targetInfo.ObjectId,targetBytes,
                    CancellationToken.None).GetAwaiter().GetResult();
                Check(sourceBytes.ToArray().SequenceEqual(targetBytes.ToArray()) &&
                      Convert.ToHexString(SHA256.HashData(targetBytes.ToArray()))==
                         targetInfo.Digest,"encrypted DB original byte roundtrip");
            }
            Check(NativeFileStore.Get(db,"personal",cross.FileId)!.Versions.Count==2,
                "independent copy preserves initial history");
            NativeFileStore.UploadAsync(db,"personal",null,cross.FileId,
                new NativeFileMetadataInput("个人v3.pdf"),null,1,
                new MemoryStream(new byte[]{42}),CancellationToken.None)
                .GetAwaiter().GetResult();
            Check(NativeFileStore.Get(db,"company",source)!.Versions.Count==2,
                "cross workspace versions diverge");
            long nFiles=Count(db,"files"),nObjects=Count(db,"file_objects");
            using var canceled=new CancellationTokenSource();
            canceled.Cancel();
            try
            {
                NativeFileCopyStore.CopyAsync(db,"company",source,
                    new NativeFileCopyInput("company",companyFolder,"independent-content"),
                    canceled.Token).GetAwaiter().GetResult();
                throw new IOException("canceled copy succeeded");
            }
            catch(OperationCanceledException){}
            Check(Count(db,"files")==nFiles && Count(db,"file_objects")==nObjects,
                "canceled operation leaves no orphan objects");
            Console.WriteLine("N3-03 FILE COPY SQLCIPHER SMOKE PASS");
        }
        finally{try{File.Delete(path);}catch(IOException){}}
    }
}
