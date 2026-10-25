using Microsoft.Data.Sqlite;

// A filtered Excel export searches the complete V2 workspace, independently of
// the browser search endpoint's 60-hit-per-group display limit.
static partial class ExcelLedger
{
    internal static long[]? ExportIds(SqliteConnection db,string workspace,
        string kind,string section,ExcelExportInput input)
    {
        if(input.Mode!="filtered" || input.Query is null)return input.Ids;
        string query=input.Query.Trim();
        HashSet<long>? matches=null;
        if(query.Length>0)
        {
            var results=SearchStore.Find(db,workspace,query,int.MaxValue).Results;
            matches=new HashSet<long>();
            foreach(var hit in results)
            {
                if(hit.Kind==kind && (kind!="archive"||hit.Section==section))
                    matches.Add(hit.Id);
                else if(hit.Kind=="file" && hit.OwnerKind==kind &&
                        (kind!="archive"||hit.Section==section))
                    matches.Add(hit.OwnerId);
            }
        }
        var rows=kind switch
        {
            "project"=>NativeFolderStore.List(db,workspace,FolderKinds.Project),
            "ip"=>NativeFolderStore.List(db,workspace,FolderKinds.Ip),
            "archive"=>NativeArchiveStore.List(db,workspace,FolderKinds.Archive,section),
            "general"=>NativeArchiveStore.List(db,workspace,FolderKinds.General,null),
            _=>throw new InvalidDataException("Excel 导出模块无效。")
        };
        string status=(input.Status??"").Trim();
        var ids=new List<long>();
        foreach(var item in rows)
        {
            long id=item.Folder.Ref.Id;
            if(matches is not null&&!matches.Contains(id))continue;
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
