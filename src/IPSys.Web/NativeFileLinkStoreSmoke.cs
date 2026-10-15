using Microsoft.Data.Sqlite;

// N3-02: verify link tombstones never delete or mutate FileId, versions or
// immutable encrypted content objects in a disposable real SQLCipher vault.
static class NativeFileLinkStoreSmoke
{
    public static void Run()
    {
        static void Check(bool ok,string what)
        {
            if(!ok)throw new IOException("N3-02 link SQLCipher: "+what);
        }
        static long Count(SqliteConnection db,string table)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="SELECT count(*) FROM "+table+";";
            return (long)cmd.ExecuteScalar()!;
        }
        static long Project(SqliteConnection db,string name,string workspace)
        {
            using var cmd=db.CreateCommand();
            cmd.CommandText="""
                INSERT INTO folders(workspace,kind,name) VALUES($w,'project',$name);
                SELECT last_insert_rowid();
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$name",name);
            return (long)cmd.ExecuteScalar()!;
        }
        var path=Path.Combine(Path.GetTempPath(),
            "ipsys-n3-links-"+Guid.NewGuid().ToString("N")+".db");
        try
        {
            using(var db=Vault.Connect(path,"link-temporary-key",create:true))
            {
                Vault.CreateSchema(db);
                long a=Project(db,"A","company");
                long b=Project(db,"B","company");
                long personal=Project(db,"Other","personal");
                long fileId=NativeFileStore.UploadAsync(db,"company",a,null,
                    new NativeFileMetadataInput("唯一原件.pdf"),null,4,
                    new MemoryStream(new byte[]{1,2,3,4}),CancellationToken.None)
                    .GetAwaiter().GetResult().FileId;
                var aLink=NativeFileLinkStore.ListFolder(db,"company",a,false)!.Single();
                long bLinkId=NativeFileLinkStore.Add(db,"company",fileId,
                    new NativeFileLinkInput(b));
                Check(aLink.FileId==fileId && Count(db,"folder_file_links")==2,
                    "single FileId two locations");
                Check(Count(db,"file_objects")==1 && Count(db,"file_chunks")==1 &&
                      Count(db,"file_versions")==1,"shared identity did not duplicate bytes");
                try
                {
                    NativeFileLinkStore.Add(db,"company",fileId,
                        new NativeFileLinkInput(personal));
                    throw new IOException("cross workspace share accepted");
                }
                catch(KeyNotFoundException){}
                Check(NativeFileLinkStore.Unlink(db,"company",fileId,aLink.Id),
                    "unlink first location");
                Check(NativeFileLinkStore.ListFolder(db,"company",a,false)!.Count==0 &&
                      NativeFileLinkStore.ListFolder(db,"company",b,false)!.Count==1,
                    "folder-local unlink");
                NativeFileStore.UploadAsync(db,"company",null,fileId,
                    new NativeFileMetadataInput("版本二.pdf"),"补充版本",2,
                    new MemoryStream(new byte[]{9,8}),CancellationToken.None)
                    .GetAwaiter().GetResult();
                Check(NativeFileLinkStore.ListFolder(db,"company",a,false)!.Count==0 &&
                      NativeFileLinkStore.ListFolder(db,"company",b,false)!
                          .Single().LatestVersion==2,
                    "new version did not reactivate deleted link");
                Check(NativeFileLinkStore.Restore(db,"company",fileId,aLink.Id),
                    "explicitly restore old link");
                Check(NativeFileLinkStore.ListFolder(db,"company",a,false)!
                          .Single().LatestVersion==2,
                    "restored location sees same shared history");
                Check(NativeFileLinkStore.Unlink(db,"company",fileId,bLinkId) &&
                      NativeFileLinkStore.Unlink(db,"company",fileId,aLink.Id),
                    "remove all associations without deleting bytes");
                Check(NativeFileStore.Get(db,"company",fileId)==null,
                    "file with no live link hidden");
                Check(Count(db,"files")==1 && Count(db,"file_versions")==2 &&
                      Count(db,"file_objects")==2 && Count(db,"file_chunks")==2,
                    "soft unlink preserved all encrypted original versions");
                Check(NativeFileLinkStore.ListFolder(db,"company",a,true)!
                          .Single().Deleted,"original folder can find tombstone");
                Check(NativeFileLinkStore.Restore(db,"company",fileId,aLink.Id),
                    "restore only tombstone when all had been unlinked");
                Check(NativeFileStore.Get(db,"company",fileId)!.Versions.Count==2,
                    "last-link restoration retained all versions");
                long bNew=NativeFileLinkStore.Add(db,"company",fileId,
                    new NativeFileLinkInput(b));
                Check(bNew!=bLinkId,"new association does not silently restore old row");
                try
                {
                    NativeFileLinkStore.Restore(db,"company",fileId,bLinkId);
                    throw new IOException("duplicate restore accepted");
                }
                catch(InvalidOperationException ex) when(
                    ex.Message.Contains("已有有效")){}
                Check(Count(db,"files")==1 && Count(db,"file_versions")==2,
                    "relink did not alter file identity/history");
            }
            using(var reopened=Vault.Connect(path,"link-temporary-key",create:false))
            {
                Vault.ValidateSchema(reopened);
                Check(Count(reopened,"files")==1 &&
                      Count(reopened,"file_versions")==2 &&
                      Count(reopened,"folder_file_links")==3,
                    "reopening persisted 2 live and 1 deleted link");
            }
        }
        finally{try{File.Delete(path);}catch(IOException){}}
        Console.WriteLine("N3-02 FILE LINK SQLCIPHER SMOKE PASS");
    }
}
