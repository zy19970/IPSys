using Microsoft.Data.Sqlite;

// Temporary view adapter: the still-legacy archive/general browser must not
// navigate a native FolderId into an unrelated old numeric record id.
// /api/v2/search is authoritative native search; /api/search keeps only those
// legacy archive/general hit identities that the current UI can actually open.
static partial class SearchStore
{
    public static SearchResponse FindForCurrentUi(SqliteConnection db,
        string workspace,string? queryText)
    {
        var native=Find(db,workspace,queryText);
        if(native.Query.Length==0)return native;
        string query=native.Query;
        var results=native.Results.Where(hit=>
            hit.Kind is not ("archive" or "general") &&
            !(hit.Kind=="file" && hit.OwnerKind is "archive" or "general"))
            .ToList();
        bool truncated=native.Truncated;
        var counts=results.GroupBy(x=>x.Kind).ToDictionary(g=>g.Key,g=>g.Count());
        void Add(SearchHit hit)
        {
            counts.TryGetValue(hit.Kind,out int count);
            if(count>=MaxPerGroup){truncated=true;return;}
            counts[hit.Kind]=count+1;
            results.Add(hit);
        }
        var sections=workspace=="company"
            ?new[]{"certificate","achievement"}
            :new[]{"certificate","achievement","academic"};
        var archives=sections.SelectMany(section=>
            ArchiveStore.List(db,workspace,section)).ToArray();
        var archiveNames=archives.ToDictionary(x=>(x.Section,x.Id),x=>x.Name);
        foreach(var a in archives)
        {
            if(!Any(query,a.Name,a.Category,a.Remarks,a.Tags,a.Year))continue;
            Add(new SearchHit("archive",a.Id,a.Section,a.Name,
                Summary(a.Category,a.Section=="academic"?"学术与社会活动":
                    a.Section=="achievement"?(workspace=="company"?"业务档案":"成果与奖励"):
                    "资质与证件")));
        }
        var generalNames=new Dictionary<long,string>();
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                SELECT id,title FROM records WHERE workspace=$w AND deleted=0;
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            using var rd=cmd.ExecuteReader();
            while(rd.Read())
                generalNames.Add(rd.GetInt64(0),rd.GetString(1));
        }
        foreach(var (id,name) in generalNames)
            if(Has(name,query))
                Add(new SearchHit("general",id,"",name,
                    workspace=="company"?"综合资料":"其他资料"));
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var f in BusinessFileStore.List(db,workspace))
        {
            if(f.Kind!="archive" ||
               !archiveNames.TryGetValue((f.Section,f.OwnerId),out string? parent) ||
               !Any(query,f.Name,f.Category))continue;
            string key=f.OwnerId+":"+f.Section+":"+
                (string.IsNullOrEmpty(f.GroupId)?f.Id.ToString():f.GroupId);
            if(!seen.Add(key))continue;
            Add(new SearchHit("file",f.Id,f.Section,f.Name,
                Summary(parent,f.Category),"archive",f.OwnerId));
        }
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                SELECT a.id,a.record_id,a.filename,a.group_id
                FROM attachments a JOIN records r ON r.id=a.record_id
                WHERE r.workspace=$w AND r.deleted=0
                  AND a.deleted=0 AND a.state='ready'
                ORDER BY a.id DESC;
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            using var rd=cmd.ExecuteReader();
            while(rd.Read())
            {
                long id=rd.GetInt64(0),owner=rd.GetInt64(1);
                if(!generalNames.TryGetValue(owner,out string? parent))continue;
                string name=rd.GetString(2),group=rd.GetString(3);
                if(!Has(name,query))continue;
                string key=owner+":"+(group.Length==0?id.ToString():group);
                if(!seen.Add("general:"+key))continue;
                Add(new SearchHit("file",id,"",name,parent,"general",owner));
            }
        }
        return new SearchResponse(query,results,truncated);
    }
}
