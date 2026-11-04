using Microsoft.Data.Sqlite;

// Read-only search against the unlocked SQLCipher connection. One workspace
// per request. No OCR, no attachment byte reads and no persistent plaintext index.
record SearchHit(string Kind,long Id,string Section,string Title,string Description,
    string OwnerKind="",long OwnerId=0)
{
    public string Path {get;init;}="";
    // Display context is independent from the actual file description.
    public string? OwnerLabel {get;init;}
    public string[] MatchedFields {get;init;}=[];
    public long? FolderId {get;init;}
    public long? FileId {get;init;}
    public long? LinkId {get;init;}
    public string? Tags {get;init;}
    public string? FileNumber {get;init;}
    public string? FileDate {get;init;}
    public int? LatestVersion {get;init;}
    public long? Size {get;init;}
    public string? Status {get;init;}
}
record SearchResponse(string Query,List<SearchHit> Results,bool Truncated,
    int? Total=null,int? Offset=null,int? Limit=null,bool? HasMore=null,int? NextOffset=null);

static class SearchStore
{
    private const int MaxPerGroup=60;
    private static bool Has(string? text,string query)=>
        !string.IsNullOrEmpty(text)&&text.Contains(query,StringComparison.OrdinalIgnoreCase);
    // Labels tell Agents why a record matched; tag strings are treated as
    // individual semicolon-separated tokens (both common punctuation forms).
    private static string[] Matched(string query,params (string Key,string? Text)[] fields)=>
        fields.Where(f=>f.Key=="tags"
                ? (f.Text??"").Split([';','；']).Any(part=>Has(part.Trim(),query))
                : Has(f.Text,query))
            .Select(f=>f.Key).Distinct(StringComparer.Ordinal).ToArray();
    private static string Label(string? name)=>string.IsNullOrWhiteSpace(name)?"未命名":name;
    // Module label for a material section. Matches the navigation and page
    // titles so a search path reads the same way as the browser.
    private static string SectionLabel(string workspace,string section)=>
        section switch
        {
            "academic"=>"学术与社会活动",
            "achievement"=>workspace=="company"?"业务档案":"成果与奖励",
            "party"=>"党团建设",
            "general"=>workspace=="company"?"综合资料":"其他资料",
            "certificate"=>workspace=="personal"?"人力资源":"企业资质",
            "project"=>"项目",
            _=>section
        };
    private static string Summary(params string?[] fields)=>string.Join(" · ",
        fields.Where(x=>!string.IsNullOrWhiteSpace(x)).Select(x=>x!.Trim()));
    public static SearchResponse Find(SqliteConnection db,string workspace,string? text,
        int maxPerGroup=MaxPerGroup,int? offset=null,int? limit=null,string? filterKind=null)
    {
        if(!Vault.WorkspaceValid(workspace))throw new InvalidDataException("搜索工作区无效。");
        string query=(text??"").Trim();
        if(query.Length>100||query.Any(char.IsControl))
            throw new InvalidDataException("搜索关键词最多 100 字，不能含换行或控制字符。");
        bool paged=offset.HasValue||limit.HasValue;
        if(offset is <0 || limit is <1 or >200)
            throw new InvalidDataException("搜索分页参数不合法：offset 非负，limit 为 1–200。");
        if(filterKind is not (null or "" or "project" or "ip" or
            "archive_folder" or "file"))
            throw new InvalidDataException("搜索类别无效。");
        var results=new List<SearchHit>();
        if(query.Length==0)return new SearchResponse(query,results,false,
            paged?0:null,paged?offset??0:null,paged?limit??100:null,paged?false:null,null);
        bool truncated=false;
        var counts=new Dictionary<string,int>(StringComparer.Ordinal);
        void Add(SearchHit hit)
        {
            if(!string.IsNullOrEmpty(filterKind) && hit.Kind!=filterKind)return;
            counts.TryGetValue(hit.Kind,out var current);
            if(!paged && current>=maxPerGroup){truncated=true;return;}
            counts[hit.Kind]=current+1;
            results.Add(hit);
        }
        string root=workspace=="company"?"公司":"个人";
        var projects=NativeFolderStore.List(db,workspace,FolderKinds.Project);
        var projectTitles=projects.ToDictionary(x=>x.Folder.Ref.Id,x=>x.Folder.Name);
        var ips=NativeFolderStore.List(db,workspace,FolderKinds.Ip);
        // A02/N2: ordinary materials are archive_folder inside a module scope.
        // This is the only readable shape; the retired archive/general kinds are
        // no longer created and intentionally not searched.
        var materialScopes=workspace=="company"
            ?new[]{"certificate","achievement","party","general","project"}
            :new[]{"certificate","achievement","academic","general","project"};
        var materials=materialScopes.SelectMany(section=>
            NativeArchiveStore.ListAll(db,workspace,section)).ToArray();
        // A material inherits its ancestor folder names for search without
        // copying duplicate metadata into its own attributes.
        var materialParents=materials.ToDictionary(
            x=>x.Folder.Ref.Id,
            x=>(Parent:x.Folder.Parent?.Id,Name:x.Folder.Name));
        string Ancestors(long? id)
        {
            var names=new List<string>();
            var seen=new HashSet<long>();
            while(id is long parent && seen.Add(parent))
            {
                if(materialParents.TryGetValue(parent,out var entry))
                {
                    names.Add(entry.Name);
                    id=entry.Parent;
                }
                else if(projectTitles.TryGetValue(parent,out var projectName))
                {
                    names.Add(projectName);
                    break;
                }
                else break;
            }
            return string.Join(" / ",names.AsEnumerable().Reverse());
        }

        foreach(var row in projects)
        {
            var p=(ProjectInput)row.BusinessData;
            var m=Matched(query,("name",p.Name),("number",p.ProjectNo),
                ("type",p.ProjectType),("status",p.ProjectStatus),
                ("leader",p.Leader),("organization",p.UndertakingOrg),
                ("category",p.Category),("remarks",p.Remarks),("tags",p.Tags));
            if(m.Length==0)continue;
            Add(new SearchHit("project",row.Folder.Ref.Id,"",Label(p.Name),
                Summary(p.ProjectType,p.ProjectNo,p.ProjectStatus)){
                Path=root+" / 项目 / "+row.Folder.Name,MatchedFields=m,
                FolderId=row.Folder.Ref.Id,Tags=p.Tags,Status=p.ProjectStatus
            });
        }
        foreach(var ip in ips)
        {
            var d=(IpInput)ip.BusinessData;
            var m=Matched(query,("name",d.Name),("type",d.IpType),
                ("status",d.Status),("number",d.Number),("applicants",d.Applicants),
                ("rightHolders",d.RightHolders),("creators",d.Creators),
                ("publicationNo",d.PublicationNo),("grantNoticeNo",d.GrantNoticeNo),
                ("publicationInfo",d.PublicationInfo),("category",d.Category),
                ("remarks",d.Remarks),("tags",d.Tags));
            if(m.Length==0)continue;
            Add(new SearchHit("ip",ip.Folder.Ref.Id,"",Label(d.Name),
                Summary(d.IpType,d.Number,d.PublicationNo,d.GrantNoticeNo)){
                Path=root+" / 知识产权 / "+ip.Folder.Name,
                MatchedFields=m,FolderId=ip.Folder.Ref.Id,Tags=d.Tags,Status=d.Status
            });
        }
        foreach(var row in materials)
        {
            var f=(ArchiveFolderInput)row.BusinessData;
            string section=row.Folder.Ref.Section;
            string ancestry=Ancestors(row.Folder.Parent?.Id);
            var m=Matched(query,("name",row.Folder.Name),("category",f.Category),
                ("remarks",f.Remarks),("tags",f.Tags),("year",f.Year),
                ("parent",ancestry));
            if(m.Length==0)continue;
            string sectionName=SectionLabel(workspace,section);
            Add(new SearchHit("archive_folder",row.Folder.Ref.Id,section,
                row.Folder.Name,Summary(ancestry,f.Category,sectionName)){
                Path=root+" / "+sectionName+" / "+
                    (ancestry.Length>0?ancestry+" / ":"")+row.Folder.Name,
                MatchedFields=m,FolderId=row.Folder.Ref.Id,Tags=f.Tags
            });
        }

        // Search only active V2 FolderFileLinks; legacy business_file_links
        // and attachments cannot masquerade as a matching native FolderId.
        var projectNames=projects.ToDictionary(x=>x.Folder.Ref.Id,x=>x.Folder.Name);
        // All business records, including archives and general folders, use
        // the same FileId and FileVersion search contract.
        foreach(var item in projects.Concat(ips)
            .Concat(materials))
        {
            long owner=item.Folder.Ref.Id;
            string kind=item.Folder.Ref.Kind;
            foreach(var link in NativeFileLinkStore.ListFolder(db,workspace,owner,false)??[])
            {
                var details=NativeFileStore.Get(db,workspace,link.FileId);
                if(details is null || details.Versions.Count==0)continue;
                var latest=details.Versions[0];
                string location=link.DisplayName??link.FileName;
                string parentTitle=item.Folder.Name;
                string ancestry=item.Folder.Parent is ResourceRef ancestor?
                    Ancestors(ancestor.Id):"";
                string? status=kind switch {
                    FolderKinds.Project=>((ProjectInput)item.BusinessData).ProjectStatus,
                    FolderKinds.Ip=>((IpInput)item.BusinessData).Status,
                    _=>null
                };
                string parentPath=kind switch {
                    FolderKinds.Project=>root+" / 项目 / "+parentTitle,
                    FolderKinds.Ip=>root+" / 知识产权 / "+parentTitle,
                    _=>root+" / "+SectionLabel(workspace,
                        item.Folder.Ref.Section)+" / "+
                        (ancestry.Length>0?ancestry+" / ":"")+parentTitle
                };
                var m=Matched(query,("name",location),("fileName",link.FileName),
                    ("originalName",latest.OriginalName),
                    ("materialCategory",link.MaterialCategory),
                    ("description",details.Description),("tags",details.Tags),
                    ("fileNumber",details.FileNumber),("fileDate",details.FileDate),
                    ("parent",parentTitle),("ancestry",ancestry));
                if(m.Length==0)continue;
                Add(new SearchHit("file",link.FileId,
                    item.Folder.Ref.Section,location,
                    details.Description??"",kind,owner){
                    OwnerLabel=Summary(ancestry,parentTitle,link.MaterialCategory,
                        latest.OriginalName),
                    Path=parentPath+" / "+location,MatchedFields=m,
                    FolderId=owner,FileId=link.FileId,LinkId=link.Id,
                    Tags=details.Tags,FileNumber=details.FileNumber,
                    FileDate=details.FileDate,LatestVersion=latest.Version,
                    Size=latest.Size,Status=status
                });
            }
        }
        if(paged)
        {
            int start=offset??0,take=limit??100;
            int total=results.Count;
            bool hasMore=start<(long)total-take;
            return new SearchResponse(query,results.Skip(start).Take(take).ToList(),
                false,total,start,take,hasMore,hasMore?start+take:null);
        }
        return new SearchResponse(query,results,truncated);
    }
}
