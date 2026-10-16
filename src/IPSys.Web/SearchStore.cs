using Microsoft.Data.Sqlite;

// Read-only search against the unlocked SQLCipher connection. One workspace
// per request. No OCR, no attachment byte reads and no persistent plaintext index.
record SearchHit(string Kind,long Id,string Section,string Title,string Description,
    string OwnerKind="",long OwnerId=0);
record SearchResponse(string Query,List<SearchHit> Results,bool Truncated);

static class SearchStore
{
    private const int MaxPerGroup=60;
    private static bool Has(string? text,string query)=>
        !string.IsNullOrEmpty(text)&&text.Contains(query,StringComparison.OrdinalIgnoreCase);
    private static bool Any(string query,params string?[] fields)=>fields.Any(s=>Has(s,query));
    private static string Label(string? name)=>string.IsNullOrWhiteSpace(name)?"未命名":name;
    private static string Summary(params string?[] fields)=>string.Join(" · ",
        fields.Where(x=>!string.IsNullOrWhiteSpace(x)).Select(x=>x!.Trim()));
    private sealed record GeneralRow(long Id,string Title);
    private sealed record GeneralFile(long Id,long OwnerId,string Parent,string Name,string GroupId);
    private static (List<GeneralRow>,List<GeneralFile>) ReadGeneral(SqliteConnection db,string workspace)
    {
        var rows=new List<GeneralRow>();
        var files=new List<GeneralFile>();
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="SELECT id,title FROM records WHERE workspace=$workspace AND deleted=0 ORDER BY id DESC;";
            cmd.Parameters.AddWithValue("$workspace",workspace);
            using var reader=cmd.ExecuteReader();
            while(reader.Read())rows.Add(new GeneralRow(reader.GetInt64(0),reader.GetString(1)));
        }
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                SELECT a.id,r.id,r.title,a.filename,a.group_id
                FROM attachments a JOIN records r ON r.id=a.record_id
                WHERE r.workspace=$workspace AND r.deleted=0
                  AND a.deleted=0 AND a.state='ready'
                ORDER BY a.id DESC;
                """;
            cmd.Parameters.AddWithValue("$workspace",workspace);
            using var reader=cmd.ExecuteReader();
            while(reader.Read())files.Add(new GeneralFile(reader.GetInt64(0),reader.GetInt64(1),
                reader.GetString(2),reader.GetString(3),reader.GetString(4)));
        }
        return (rows,files);
    }
    public static SearchResponse Find(SqliteConnection db,string workspace,string? text)
    {
        if(!Vault.WorkspaceValid(workspace))throw new InvalidDataException("搜索工作区无效。");
        string query=(text??"").Trim();
        if(query.Length>100||query.Any(char.IsControl))
            throw new InvalidDataException("搜索关键词最多 100 字，不能含换行或控制字符。");
        var results=new List<SearchHit>();
        if(query.Length==0)return new SearchResponse(query,results,false);
        bool truncated=false;
        var counts=new Dictionary<string,int>(StringComparer.Ordinal);
        void Add(SearchHit hit)
        {
            counts.TryGetValue(hit.Kind,out var current);
            if(current>=MaxPerGroup){truncated=true;return;}
            counts[hit.Kind]=current+1;
            results.Add(hit);
        }
        var projects=NativeFolderStore.List(db,workspace,FolderKinds.Project);
        var contracts=NativeFolderStore.List(db,workspace,FolderKinds.Contract);
        var projectTitles=projects.ToDictionary(x=>x.Folder.Ref.Id,x=>x.Folder.Name);
        var ips=NativeFolderStore.List(db,workspace,FolderKinds.Ip);
        var archiveSections=workspace=="company"?new[]{"certificate","achievement"}:
            new[]{"certificate","achievement","academic"};
        var archive=new List<ArchiveView>();
        foreach(string section in archiveSections)
            archive.AddRange(ArchiveStore.List(db,workspace,section));
        var (general,generalFiles)=ReadGeneral(db,workspace);

        foreach(var row in projects)
        {
            var p=(ProjectInput)row.BusinessData;
            if(!Any(query,p.Name,p.ProjectNo,p.ProjectType,p.ProjectStatus,
                p.Leader,p.UndertakingOrg,p.Category,p.Remarks,p.Tags))continue;
            Add(new SearchHit("project",row.Folder.Ref.Id,"",Label(p.Name),
                Summary(p.ProjectType,p.ProjectNo,p.ProjectStatus)));
        }
        foreach(var row in contracts)
        {
            var c=(ContractInput)row.BusinessData;
            if(row.Folder.Parent is not ResourceRef parent ||
               !projectTitles.TryGetValue(parent.Id,out string? parentName))continue;
            if(!Any(query,c.Name,c.ContractNo,parentName,c.SigningParties,
                c.Category,c.Remarks,c.Tags))continue;
            Add(new SearchHit("contract",row.Folder.Ref.Id,"",Label(c.Name),
                Summary(parentName,c.ContractNo)));
        }
        foreach(var ip in ips)
        {
            var d=(IpInput)ip.BusinessData;
            if(!Any(query,d.Name,d.IpType,d.Status,d.ApplicationNo,d.RegistrationNo,
                d.Applicants,d.RightHolders,d.Creators,d.PublicationNo,d.GrantNoticeNo,
                d.PublicationInfo,d.Category,d.Remarks,d.Tags))continue;
            Add(new SearchHit("ip",ip.Folder.Ref.Id,"",Label(d.Name),
                Summary(d.IpType,d.ApplicationNo,d.RegistrationNo)));
        }
        foreach(var a in archive)
        {
            if(!Any(query,a.Name,a.Category,a.Remarks,a.Tags))continue;
            Add(new SearchHit("archive",a.Id,a.Section,a.Name,
                Summary(a.Category,a.Section=="academic"?"学术与社会活动":
                    a.Section=="achievement"?(workspace=="company"?"业务档案":"成果与奖励"):"资质与证件")));
        }
        foreach(var r in general)
        {
            if(Has(r.Title,query))
                Add(new SearchHit("general",r.Id,"",r.Title,
                    workspace=="company"?"综合资料":"其他资料"));
        }

        // Only a currently active record owner may be a result. BusinessFileStore.List
        // already excludes deleted links, unfinished objects and deleted owners.
        var projectNames=projects.ToDictionary(x=>x.Folder.Ref.Id,x=>x.Folder.Name);
        var contractNames=contracts.Where(x=>x.Folder.Parent is ResourceRef parent &&
            projectNames.ContainsKey(parent.Id)).ToDictionary(
                x=>x.Folder.Ref.Id,x=>x.Folder.Name);
        var ipNames=ips.ToDictionary(x=>x.Folder.Ref.Id,x=>Label(((IpInput)x.BusinessData).Name));
        var archiveNames=archive.ToDictionary(x=>(x.Section,x.Id),x=>x.Name);
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var f in BusinessFileStore.List(db,workspace))
        {
            if(!Any(query,f.Name,f.Category))continue;
            string parent=f.Kind switch
            {
                // No project/contract old attachment links may be returned
                // with the same owner kind as an active V2 FolderId.
                "project" or "contract"=>"",
                // Legacy business-file IDs are unrelated to native IP FolderId.
                // Never accidentally attach an old file hit to a new IP folder.
                "ip"=> "",
                "archive" when archiveNames.TryGetValue((f.Section,f.OwnerId),out var a)=>a,
                _=>""
            };
            if(parent.Length==0)continue;
            string key=f.Kind+":"+f.OwnerId+":"+f.Section+":"+
                (string.IsNullOrEmpty(f.GroupId)?f.Id.ToString():f.GroupId);
            if(!seen.Add(key))continue;
            Add(new SearchHit("file",f.Id,f.Section,f.Name,Summary(parent,f.Category),
                f.Kind,f.OwnerId));
        }
        // Native project/contract/IP attachments use V2 identity and metadata.
        foreach(var item in projects.Concat(contracts).Concat(ips))
        {
            long owner=item.Folder.Ref.Id;
            string kind=item.Folder.Ref.Kind;
            if(kind==FolderKinds.Contract &&
               (item.Folder.Parent is not ResourceRef parent ||
                !projectNames.ContainsKey(parent.Id)))continue;
            foreach(var link in NativeFileLinkStore.ListFolder(db,workspace,owner,false)??[])
            {
                var details=NativeFileStore.Get(db,workspace,link.FileId);
                if(details is null || details.Versions.Count==0)continue;
                var latest=details.Versions[0];
                string location=link.DisplayName??link.FileName;
                string parentTitle=item.Folder.Name;
                if(!Any(query,location,link.FileName,latest.OriginalName,
                    link.MaterialCategory,details.Description,details.Tags,
                    details.FileNumber,details.FileDate,parentTitle))continue;
                Add(new SearchHit("file",link.FileId,"",location,
                    Summary(parentTitle,link.MaterialCategory,latest.OriginalName),
                    kind,owner));
            }
        }
        foreach(var f in generalFiles)
        {
            if(!Has(f.Name,query))continue;
            string key="general:"+f.OwnerId+":"+
                (string.IsNullOrEmpty(f.GroupId)?f.Id.ToString():f.GroupId);
            if(!seen.Add(key))continue;
            Add(new SearchHit("file",f.Id,"",f.Name,f.Parent,"general",f.OwnerId));
        }
        return new SearchResponse(query,results,truncated);
    }
}
