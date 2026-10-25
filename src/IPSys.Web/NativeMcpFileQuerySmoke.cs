using Microsoft.Data.Sqlite;
using System.Text.Json;

// Disposable SQLCipher fixture: original link paging is unchanged; missing
// attributes are selected server-side before paging and distinct by FileId.
static class NativeMcpFileQuerySmoke
{
    public static void Run()
    {
        static void Check(bool valid,string reason)
        {
            if(!valid)throw new IOException("MCP missing-attribute smoke: "+reason);
        }
        string path=Path.Combine(Path.GetTempPath(),
            "ipsys-missing-attribute-"+Guid.NewGuid().ToString("N")+".db");
        try
        {
            using var db=Vault.Connect(path,"disposable-metadata-smoke",create:true);
            Vault.CreateSchema(db);
            long Folder(string workspace,string name)
            {
                using var cmd=db.CreateCommand();
                cmd.CommandText="""
                    INSERT INTO folders(workspace,kind,name)
                    VALUES($w,'project',$n);
                    SELECT last_insert_rowid();
                    """;
                cmd.Parameters.AddWithValue("$w",workspace);
                cmd.Parameters.AddWithValue("$n",name);
                return (long)cmd.ExecuteScalar()!;
            }
            long File(string w,string name,string? description,
                string? tags,string? number,string? date)
            {
                using var cmd=db.CreateCommand();
                cmd.CommandText="""
                    INSERT INTO files(workspace,name,description,tags,file_number,file_date)
                    VALUES($w,$n,$d,$t,$no,$dt);
                    SELECT last_insert_rowid();
                    """;
                cmd.Parameters.AddWithValue("$w",w);
                cmd.Parameters.AddWithValue("$n",name);
                cmd.Parameters.AddWithValue("$d",(object?)description??DBNull.Value);
                cmd.Parameters.AddWithValue("$t",(object?)tags??DBNull.Value);
                cmd.Parameters.AddWithValue("$no",(object?)number??DBNull.Value);
                cmd.Parameters.AddWithValue("$dt",(object?)date??DBNull.Value);
                return (long)cmd.ExecuteScalar()!;
            }
            long Link(string w,long folder,long file,string? display=null)
            {
                using var cmd=db.CreateCommand();
                cmd.CommandText="""
                    INSERT INTO folder_file_links(workspace,folder_id,file_id,display_name)
                    VALUES($w,$f,$id,$display);
                    SELECT last_insert_rowid();
                    """;
                cmd.Parameters.AddWithValue("$w",w);
                cmd.Parameters.AddWithValue("$f",folder);
                cmd.Parameters.AddWithValue("$id",file);
                cmd.Parameters.AddWithValue("$display",(object?)display??DBNull.Value);
                return (long)cmd.ExecuteScalar()!;
            }
            long p1=Folder("company","主项目");
            long p2=Folder("company","关联项目");
            long personal=Folder("personal","个人项目");
            long f1=File("company","材料一.pdf",null,null,"X01","2026-10-01");
            long f2=File("company","材料二.pdf","\t　 ","  "," ",null);
            long f3=File("company","材料三.docx","说明","标签","", "2026-10-03");
            long f4=File("company","材料四.xlsx","说明","标签","X04","2026-10-04");
            long f5=File("personal","个人文档.pdf",null,null,null,null);
            long f6=File("company","材料六.pdf","说明"," ","X06","2026-10-06");
            long firstLink=Link("company",p1,f1);
            Link("company",p2,f1,"共享材料一.pdf");
            Link("company",p1,f2);
            Link("company",p1,f3);
            Link("company",p1,f4);
            Link("personal",personal,f5);
            Link("company",p1,f6);

            McpFilePage Page(string? missing=null,string? mode=null,int offset=0,
                int limit=100,string w="company",long owner=0,string? kind=null)=>
                (McpFilePage)NativeMcpFileQuery.Read(db,w,kind,null,owner,offset,
                    limit,true,missing,mode);
            var original=Page();
            Check(original.Items.Count==6 &&
                original.Items.Count(x=>x.FileId==f1)==2 &&
                original.Items.All(x=>x.MissingFields==null),
                "original paging keeps every LinkId and omits missingFields");
            var originalJson=JsonSerializer.Serialize(original);
            Check(!originalJson.Contains("MissingFields") &&
                  !originalJson.Contains("missingFields"),
                "legacy JSON does not add unrequested missingFields");
            var any=Page("all");
            Check(any.Items.Count==4 &&
                  any.Items.Select(x=>x.FileId).SequenceEqual(new[]{f1,f2,f3,f6}) &&
                  any.Items.First().Id==firstLink &&
                  any.Items.All(x=>x.MissingFields is {Count:>0}),
                "all/any filters records and de-duplicates shared FileId");
            var all=Page("all","all");
            Check(all.Items.Count==1 && all.Items[0].FileId==f2 &&
                  all.Items[0].MissingFields is {Count:4},
                "NULL, spaces, tab, fullwidth and NBSP all count as empty");
            var only=Page("description,file_number");
            Check(only.Items.Count==3 &&
                  only.Items.Select(x=>x.FileId).SequenceEqual(new[]{f1,f2,f3}),
                "selected missing fields any");
            var both=Page("description,file_number","all");
            Check(both.Items.Count==1&&both.Items[0].FileId==f2,
                "selected missing fields all");
            var tags=Page("tags");
            Check(tags.Items.Select(x=>x.FileId).SequenceEqual(new[]{f1,f2,f6}),
                "single field filter");
            var first=Page("all",offset:0,limit:2);
            var second=Page("all",offset:2,limit:2);
            Check(first.HasMore && first.NextOffset==2 &&
                  !second.HasMore && second.NextOffset==null &&
                  first.Items.Concat(second.Items).Select(x=>x.FileId)
                    .SequenceEqual(any.Items.Select(x=>x.FileId)),
                "pagination filters before LIMIT/OFFSET without gaps or repeats");
            var inOtherFolder=Page("all",owner:p2);
            Check(inOtherFolder.Items.Count==1 &&
                  inOtherFolder.Items[0].FileId==f1 &&
                  inOtherFolder.Items[0].OwnerId==p2,
                "folder filter runs before FileId de-duplication");
            Check(Page("all",w:"personal").Items.Count==1 &&
                  Page("all",w:"personal").Items[0].FileId==f5 &&
                  Page("all",w:"personal").Items[0].MissingFields is {Count:4},
                "company and personal workspaces stay isolated");
            Check(Page("all",kind:"contract").Items.Count==0,
                "type filter respects business kind");
            foreach(var (field,mode) in new[]{
                ("bad-field",(string?)null),("all","bad-mode"),
                ((string?)null,"all"),(",","any")})
            {
                bool rejected=false;
                try {Page(field,mode);}
                catch(ArgumentException){rejected=true;}
                Check(rejected,"invalid missing filter is rejected");
            }
            Check(Page("description,tags").Items.All(x=>x.MissingFields!=null),
                "response contains the complete missing-fields list");
            // A few hundred metadata-only links measure bounded DB-side
            // filtration, avoiding one detail request per FileId.
            for(int i=0;i<350;i++)
            {
                long file=File("company","批次材料-"+i.ToString("D4")+".pdf",
                    null,null,null,null);
                Link("company",p1,file);
            }
            var watch=System.Diagnostics.Stopwatch.StartNew();
            var observed=new HashSet<long>();
            int next=0,pages=0;
            while(true)
            {
                var batch=Page("all",offset:next,limit:80);
                pages++;
                foreach(var item in batch.Items)
                    Check(observed.Add(item.FileId),"large-page duplicate FileId");
                if(!batch.HasMore)break;
                next=batch.NextOffset!.Value;
                Check(pages<30,"large-file query never terminates");
            }
            watch.Stop();
            Check(observed.Count==354 && pages>=5,
                "large SQLCipher missing-filter walk covers all qualifying FileIds");
            Console.WriteLine("MCP missing-field SQL filter: "+observed.Count+
                " distinct FileIds / "+pages+" pages in "+
                watch.ElapsedMilliseconds+" ms (disposable fixture)");
            using var check=db.CreateCommand();
            check.CommandText="""
                SELECT
                  (SELECT count(*) FROM file_versions) +
                  (SELECT count(*) FROM mcp_operations);
                """;
            Check((long)check.ExecuteScalar()! ==0,
                "metadata-only queries do not upload or write operation journal");
        }
        finally
        {
            try{System.IO.File.Delete(path);}catch(IOException){}
        }
    }
}
