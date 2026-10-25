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
        if(filterKind is not (null or "" or "project" or "contract" or "ip" or
            "archive" or "archive_folder" or "general" or "file"))
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
        var contracts=NativeFolderStore.List(db,workspace,FolderKinds.Contract);
        var projectTitles=projects.ToDictionary(x=>x.Folder.Ref.Id,x=>x.Folder.Name);
        var ips=NativeFolderStore.List(db,workspace,FolderKinds.Ip);
        var archiveSections=workspace=="company"?new[]{"certificate","achievement","party"}:
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
        foreach(var row in contracts)
        {
            var c=(ContractInput)row.BusinessData;
            if(row.Folder.Parent is not ResourceRef parent ||
               !projectTitles.TryGetValue(parent.Id,out string? parentName))continue;
            var m=Matched(query,("name",c.Name),("number",c.ContractNo),
                ("parent",parentName),("signingParties",c.SigningParties),
                ("category",c.Category),("remarks",c.Remarks),("tags",c.Tags));
            if(m.Length==0)continue;
            Add(new SearchHit("contract",row.Folder.Ref.Id,"",Label(c.Name),
                Summary(parentName,c.ContractNo)){
                Path=root+" / 项目 / "+parentName+" / "+row.Folder.Name,
                MatchedFields=m,FolderId=row.Folder.Ref.Id,Tags=c.Tags
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
        foreach(var row in archive)
        {
            var a=(ArchiveInput)row.BusinessData;
            string section=row.Folder.Ref.Section;
            string ancestry=Ancestors(row.Folder.Parent?.Id);
            var m=Matched(query,("name",a.Name),("category",a.Category),
                ("remarks",a.Remarks),("tags",a.Tags),("year",a.Year),
                ("parent",ancestry));
            if(m.Length==0)continue;
            string sectionName=section=="academic"?"学术与社会活动":
                section=="achievement"?(workspace=="company"?"业务档案":"成果与奖励"):
                section=="party"?"党团建设":"资质与证件";
            Add(new SearchHit("archive",row.Folder.Ref.Id,section,
                row.Folder.Name,Summary(ancestry,a.Category,sectionName)){
                Path=root+" / "+sectionName+" / "+
                    (ancestry.Length>0?ancestry+" / ":"")+row.Folder.Name,
                MatchedFields=m,FolderId=row.Folder.Ref.Id,Tags=a.Tags
            });
        }
        // Business-archive folders are real editable folders, not business records.
        // Return their own IDs so an Agent can enter a matched directory.
        if(workspace=="company")
        foreach(var folder in archiveParents)
        {
            var m=Matched(query,("name",folder.Value.Name),
                ("parent",Ancestors(folder.Value.Parent)));
            if(m.Length==0)continue;
            string ancestry=Ancestors(folder.Value.Parent);
            Add(new SearchHit("archive_folder",folder.Key,"achievement",
                folder.Value.Name,"业务档案目录"){
                Path=root+" / 业务档案 / "+(ancestry.Length>0?ancestry+" / ":"")+
                    folder.Value.Name,MatchedFields=m,FolderId=folder.Key
            });
        }
        foreach(var r in general)
        {
            var m=Matched(query,("name",r.Folder.Name));
            if(m.Length>0)
                Add(new SearchHit("general",r.Folder.Ref.Id,"",
                    r.Folder.Name,workspace=="company"?"综合资料":"其他资料"){
                    Path=root+" / "+(workspace=="company"?"综合资料":"其他资料")+
                         " / "+r.Folder.Name,
                    MatchedFields=m,FolderId=r.Folder.Ref.Id
                });
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
                string? status=kind switch {
                    FolderKinds.Project=>((ProjectInput)item.BusinessData).ProjectStatus,
                    FolderKinds.Ip=>((IpInput)item.BusinessData).Status,
                    _=>null
                };
                string parentPath=kind switch {
                    FolderKinds.Project=>root+" / 项目 / "+parentTitle,
                    FolderKinds.Contract=>root+" / 项目 / "+
                        (item.Folder.Parent is ResourceRef cp &&
                         projectTitles.TryGetValue(cp.Id,out string? pn)?pn:"")+
                        " / "+parentTitle,
                    FolderKinds.Ip=>root+" / 知识产权 / "+parentTitle,
                    FolderKinds.Archive=>root+" / "+
                        (item.Folder.Ref.Section=="achievement"?
                            (workspace=="company"?"业务档案":"成果与奖励"):
                         item.Folder.Ref.Section=="academic"?"学术与社会活动":
                         item.Folder.Ref.Section=="party"?"党团建设":"资质与证件")+
                        " / "+(ancestry.Length>0?ancestry+" / ":"")+parentTitle,
                    _=>root+" / "+(workspace=="company"?"综合资料":"其他资料")+
                       " / "+parentTitle
                };
                var m=Matched(query,("name",location),("fileName",link.FileName),
                    ("originalName",latest.OriginalName),
                    ("materialCategory",link.MaterialCategory),
                    ("description",details.Description),("tags",details.Tags),
                    ("fileNumber",details.FileNumber),("fileDate",details.FileDate),
                    ("parent",parentTitle),("ancestry",ancestry));
                if(m.Length==0)continue;
                Add(new SearchHit("file",link.FileId,
                    kind==FolderKinds.Archive?item.Folder.Ref.Section:"",location,
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
