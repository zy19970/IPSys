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
        var archive=archiveSections.SelectMany(section=>
            NativeArchiveStore.List(db,workspace,FolderKinds.Archive,section)).ToArray();
        var general=NativeArchiveStore.List(db,workspace,FolderKinds.General,null);
        // Read only valid V2 ancestor folders; a child record inherits their
        // names for search without copying duplicate metadata into its attributes.
        var archiveParents=new Dictionary<long,(long? Parent,string Name)>();
        if(workspace=="company")
        {
            using var ancestors=db.CreateCommand();
            ancestors.CommandText="""
                SELECT id,parent_id,name FROM folders
                WHERE workspace='company' AND kind='archive_folder'
                  AND section='achievement' AND deleted=0;
                """;
            using var rd=ancestors.ExecuteReader();
            while(rd.Read())
                archiveParents[rd.GetInt64(0)]=(
                    rd.IsDBNull(1)?null:rd.GetInt64(1),rd.GetString(2));
        }
        string Ancestors(long? id)
        {
            var names=new List<string>();
            var seen=new HashSet<long>();
            while(id is long parent && seen.Add(parent) &&
                archiveParents.TryGetValue(parent,out var entry))
            {
                names.Add(entry.Name);
                id=entry.Parent;
            }
            return string.Join(" / ",names.AsEnumerable().Reverse());
        }

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
        foreach(var row in archive)
        {
            var a=(ArchiveInput)row.BusinessData;
            string section=row.Folder.Ref.Section;
            string ancestry=Ancestors(row.Folder.Parent?.Id);
            if(!Any(query,a.Name,a.Category,a.Remarks,a.Tags,a.Year,ancestry))
                continue;
            Add(new SearchHit("archive",row.Folder.Ref.Id,section,
                row.Folder.Name,Summary(ancestry,a.Category,
                    section=="academic"?"学术与社会活动":
                    section=="achievement"?(workspace=="company"?"业务档案":"成果与奖励")
                    :"资质与证件")));
        }
        foreach(var r in general)
        {
            if(Has(r.Folder.Name,query))
                Add(new SearchHit("general",r.Folder.Ref.Id,"",
                    r.Folder.Name,workspace=="company"?"综合资料":"其他资料"));
        }

        // Search only active V2 FolderFileLinks; legacy business_file_links
        // and attachments cannot masquerade as a matching native FolderId.
        var projectNames=projects.ToDictionary(x=>x.Folder.Ref.Id,x=>x.Folder.Name);
        var activeContracts=contracts.Where(x=>x.Folder.Parent is ResourceRef p &&
            projectNames.ContainsKey(p.Id)).ToArray();
        // All business records, including archives and general folders, use
        // the same FileId and FileVersion search contract.
        foreach(var item in projects.Concat(activeContracts).Concat(ips)
            .Concat(archive).Concat(general))
        {
            long owner=item.Folder.Ref.Id;
            string kind=item.Folder.Ref.Kind;
            if(kind==FolderKinds.Contract &&
                item.Folder.Parent is not ResourceRef parent)continue;
            foreach(var link in NativeFileLinkStore.ListFolder(db,workspace,owner,false)??[])
            {
                var details=NativeFileStore.Get(db,workspace,link.FileId);
                if(details is null || details.Versions.Count==0)continue;
                var latest=details.Versions[0];
                string location=link.DisplayName??link.FileName;
                string parentTitle=item.Folder.Name;
                string ancestry=kind==FolderKinds.Archive?
                    Ancestors(item.Folder.Parent?.Id):"";
                if(!Any(query,location,link.FileName,latest.OriginalName,
                    link.MaterialCategory,details.Description,details.Tags,
                    details.FileNumber,details.FileDate,parentTitle,ancestry))continue;
                Add(new SearchHit("file",link.FileId,
                    kind==FolderKinds.Archive?item.Folder.Ref.Section:"",location,
                    Summary(ancestry,parentTitle,link.MaterialCategory,
                        latest.OriginalName),kind,owner));
            }
        }
        return new SearchResponse(query,results,truncated);
    }
}
