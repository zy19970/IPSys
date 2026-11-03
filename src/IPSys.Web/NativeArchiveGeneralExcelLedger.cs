using Microsoft.Data.Sqlite;

// Unified six-column ledger for all ordinary folders. section defines the business scope.
static partial class ExcelLedger
{
    internal static byte[] NativeArchiveGeneralExport(SqliteConnection db,
        string workspace,string kind,string section,string mode,long[]? ids)
    {
        if(!Vault.WorkspaceValid(workspace) ||
           kind!="archive_folder" ||
           mode is not ("all" or "filtered") ||
           mode=="filtered" && (ids?.Length??0)>10000)
            throw new InvalidDataException("Excel 工作区、类型或筛选无效。");
        if(!ArchiveDirectoryScopes.Allowed(workspace,section))
            throw new InvalidDataException("资料分类与工作区不匹配。");
        string scope=section;
        HashSet<long>? chosen=mode=="filtered"?new(ids??[]):null;
        var cols=FolderColumns;
        var data=new List<string[]>();
        foreach(var item in NativeArchiveStore.ListAll(db,workspace,scope))
        {
            if(chosen is not null && !chosen.Contains(item.Folder.Ref.Id))continue;
            var value=JsonOf(item.BusinessData);
            var cells=cols.Select(c=>Text(value,c.Property)).ToArray();
            cells[^1]=DirectoryPath(db,workspace,scope,item.Folder.Parent?.Id);
            data.Add(cells);
            if(data.Count>20000)
                throw new InvalidDataException("单次最多导出 20000 条记录。");
        }
        return Build(cols,data);
    }


    // Business category is editable metadata; the actual hierarchy is the
    // folder's parent identity. Export/import directory paths independently.
    private static Dictionary<long,(long? Parent,string Name)> FolderMap(
        SqliteConnection db,string workspace,string section)
    {
        var map=new Dictionary<long,(long?,string)>();
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,parent_id,name FROM folders
            WHERE workspace=$w AND kind='archive_folder'
              AND section=$section AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$section",section);
        using var rd=cmd.ExecuteReader();
        while(rd.Read())map[rd.GetInt64(0)]=(
            rd.IsDBNull(1)?null:rd.GetInt64(1),rd.GetString(2));
        return map;
    }
    private static string DirectoryPath(SqliteConnection db,
        string workspace,string section,long? id)
    {
        if(id is null)return "";
        var map=FolderMap(db,workspace,section);
        var path=new List<string>();
        var seen=new HashSet<long>();
        while(id is long n)
        {
            if(!seen.Add(n)||!map.TryGetValue(n,out var folder))
                throw new InvalidDataException("业务档案所属目录已失效或形成循环。");
            if(folder.Name.Contains(" / ",StringComparison.Ordinal))
                throw new InvalidDataException("目录名称包含路径分隔符，请先调整目录名称。");
            path.Add(folder.Name);
            id=folder.Parent;
        }
        path.Reverse();
        return string.Join(" / ",path);
    }
    private static long? ArchiveParent(SqliteConnection db,string workspace,
        string section,string? directory)
    {
        if(!ArchiveDirectoryScopes.Allowed(workspace,section))
        {
            if(!string.IsNullOrWhiteSpace(directory))
                throw new InvalidDataException("当前类别不支持所属目录。");
            return null;
        }
        var map=FolderMap(db,workspace,section);
        if(string.IsNullOrWhiteSpace(directory))
            {
                // An empty path denotes a legitimate top-level folder, even
                // in company/achievement. ParentId is not mandatory.
                return null;
            }
            long? parent=null;
            foreach(var segment in directory.Split(" / ",StringSplitOptions.TrimEntries))
            {
                if(segment.Length==0)
                    throw new InvalidDataException("所属目录路径包含空级。");
                var candidates=map.Where(x=>x.Value.Parent==parent &&
                    Same(x.Value.Name,segment)).ToArray();
                if(candidates.Length!=1)
                    throw new InvalidDataException("所属目录不存在或名称重复："+directory);
                parent=candidates[0].Key;
            }
            return parent;
    }

    // Blank cells preserve existing
    // metadata; only nonblank supplied values update the corresponding field.
    private static string? KeepColumn(string? next,string? existing)=>
        KeepExcel(next,existing);

    internal static object NativeArchiveGeneralImport(SqliteConnection db,
        string workspace,string kind,string section,string policy,byte[] bytes)
    {
        if(!Vault.WorkspaceValid(workspace) ||
           kind!="archive_folder" ||
           !ArchiveDirectoryScopes.Allowed(workspace,section))
            throw new InvalidDataException("Excel 工作区或资料分类无效。");
        if(policy is not ("skip" or "update" or "create"))
            throw new InvalidDataException("重复记录策略应为 skip、update 或 create。");
        string scope=section;
        // Import by explicit ancestry, not by retired record-type or category guesses.
        var rows=ReadSheet(bytes,FolderColumns)
            .OrderBy(r=>r.Values[^1].Split(" / ",StringSplitOptions.None)
                .Count(part=>!string.IsNullOrWhiteSpace(part)))
            .ThenBy(r=>r.Number).ToList();
        int created=0,updated=0,skipped=0,failed=0;
        var errors=new List<object>();
        foreach(var (line,fields) in rows)
        {
            try
            {
                var input=new ArchiveFolderInput(fields[0],null,fields[1],fields[4],fields[3],fields[2]);
                if(ArchiveRules.Validate(input) is string error)
                    throw new InvalidDataException(error);
                string name=input.Name!.Trim();
                string? category=input.Category,remarks=input.Remarks,
                    tags=TagRules.Normalize(input.Tags),year=input.Year;
                long? parent=ArchiveParent(db,workspace,section,fields[5]);

                var matches=NativeArchiveStore.ListAll(db,workspace,scope).Where(x=>
                    Same(x.Folder.Name,name) && x.Folder.Parent?.Id==parent).ToArray();
                var existing=matches.FirstOrDefault();
                // Ambiguous matches block updates; skip can safely ignore
                // duplicates, while create reports a same-level name conflict.
                if(matches.Length>1&&policy=="update")
                    throw new InvalidDataException("同名同目录资料有 "+matches.Length+
                        " 条（ID "+string.Join("、",matches.Take(5).Select(x=>x.Folder.Ref.Id))+
                        "），无法确定更新目标，请先消除重复。");
                if(existing is not null && policy=="skip"){skipped++;continue;}
                if(existing is not null && policy=="create")
                    throw new InvalidDataException("当前所属目录下已存在同名文件夹：“"+
                        name+"”。请选择跳过或更新已有记录，或先修改名称。");
                if(existing is not null && policy=="update")
                {
                    // Preserve the owning folder, FileId and all FileVersions.
                    var old=(ArchiveFolderInput)existing.BusinessData;
                    var merged=old with {
                        // Name is mandatory in both workbooks, so it never falls
                        // back; the other columns follow the "blank keeps old" rule.
                        Name=name,
                        Category=KeepColumn(category,old.Category),
                        Year=KeepColumn(year,old.Year),
                        Tags=KeepColumn(tags,old.Tags),
                        Remarks=KeepExcel(remarks,old.Remarks),
                        ParentId=existing.Folder.Parent?.Id
                    };
                    if(!NativeArchiveStore.Update(db,existing.Folder.Ref,
                        new FolderMutationInput(ArchiveFolder:merged,Section:scope)))
                        throw new IOException("资料记录已发生变化。");
                    updated++;
                }
                else
                {
                    NativeArchiveStore.Create(db,workspace,FolderKinds.ArchiveFolder,
                        new FolderMutationInput(
                            ArchiveFolder:new ArchiveFolderInput(
                                name,parent,category,year,tags,remarks),
                            Section:scope));
                    created++;
                }
            }
            catch(Exception ex)
            {
                failed++;
                if(errors.Count<300)errors.Add(new{row=line,error=ex.Message});
            }
        }
        return new {created,updated,skipped,failed,errors,
            omittedErrors=failed-errors.Count,total=rows.Count};
    }
}
