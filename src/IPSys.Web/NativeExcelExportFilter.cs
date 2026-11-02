using Microsoft.Data.Sqlite;

// A filtered Excel export searches the complete V2 workspace, independently of
// the browser search endpoint's 60-hit-per-group display limit.
static partial class ExcelLedger
{
    internal static long[]? ExportIds(SqliteConnection db,string workspace,
        string kind,string section,ExcelExportInput input)
    {
        // Keep existing explicit-ID export semantics; also accept a type-only filter.
        if(input.Mode!="filtered" || (input.Query is null &&
            string.IsNullOrWhiteSpace(input.Status) && string.IsNullOrWhiteSpace(input.IpType)))
            return input.Ids;
        string query=(input.Query??"").Trim();
        HashSet<long>? matches=null;
        // A02/N2: storage kind is archive_folder, while the Excel module name is
        // still "archive"/"general". Derive the module from the section so the
        // filtered-export contract does not change for callers.
        string ModuleOf(string storageKind,string hitSection)=>
            storageKind=="archive_folder"
                ?(hitSection=="general"?"general":"archive"):storageKind;
        if(query.Length>0)
        {
            var results=SearchStore.Find(db,workspace,query,int.MaxValue).Results;
            matches=new HashSet<long>();
            foreach(var hit in results)
            {
                if(ModuleOf(hit.Kind,hit.Section)!=kind ||
                   kind=="archive"&&hit.Section!=section)
                    continue;
                if(hit.Kind=="file")matches.Add(hit.OwnerId);
                else matches.Add(hit.Id);
            }
        }
        var rows=kind switch
        {
            "project"=>NativeFolderStore.List(db,workspace,FolderKinds.Project),
            "ip"=>NativeFolderStore.List(db,workspace,FolderKinds.Ip),
            "archive"=>NativeArchiveStore.ListAll(db,workspace,section),
            "general"=>NativeArchiveStore.ListAll(db,workspace,"general"),
            _=>throw new InvalidDataException("Excel 导出模块无效。")
        };
        string status=(input.Status??"").Trim();
        string ipType=kind=="ip"?(input.IpType??"").Trim():"";
        var ids=new List<long>();
        foreach(var item in rows)
        {
            long id=item.Folder.Ref.Id;
            if(matches is not null&&!matches.Contains(id))continue;
            if(ipType.Length>0 && !string.Equals(((IpInput)item.BusinessData).IpType,
                ipType,StringComparison.Ordinal))continue;
            if(status.Length>0)
            {
                string? value=kind switch
                {
                    "project"=>((ProjectInput)item.BusinessData).ProjectStatus,
                    "ip"=>((IpInput)item.BusinessData).Status,
                    _=>null
                };
                if(!string.Equals(value,status,StringComparison.Ordinal))continue;
            }
            ids.Add(id);
            if(ids.Count>10000)
                throw new InvalidDataException("当前筛选结果超过 10000 条，请缩小筛选范围。");
        }
        return ids.ToArray();
    }
}
