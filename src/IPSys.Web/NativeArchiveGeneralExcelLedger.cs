using Microsoft.Data.Sqlite;

// Native N2-04 fixed-format Excel ledgers for archive/general Folder resources.
// No duplicate writes to legacy business_archives or records.
static partial class ExcelLedger
{
    private static IReadOnlyList<FolderSnapshot> NativeArchives(SqliteConnection db,
        string workspace,string section)=>
        NativeArchiveStore.List(db,workspace,FolderKinds.Archive,section);

    internal static byte[] NativeArchiveGeneralExport(SqliteConnection db,
        string workspace,string kind,string section,string mode,long[]? ids)
    {
        if(!Vault.WorkspaceValid(workspace) ||
           kind is not ("archive" or "general") ||
           mode is not ("all" or "filtered") ||
           mode=="filtered" && (ids?.Length??0)>10000)
            throw new InvalidDataException("Excel 工作区、类型或筛选无效。");
        if(kind=="archive"&&ArchiveRules.Module(workspace,section)==null ||
           kind=="general"&&section.Length!=0)
            throw new InvalidDataException("资料分类与工作区不匹配。");
        HashSet<long>? chosen=mode=="filtered"?new(ids??[]):null;
        var cols=kind=="archive"?ArchiveColumns:GeneralColumns;
        var snapshots=kind=="archive"
            ?NativeArchives(db,workspace,section)
            :NativeArchiveStore.List(db,workspace,FolderKinds.General,null);
        var data=new List<string[]>();
        foreach(var item in snapshots)
        {
            if(chosen is not null && !chosen.Contains(item.Folder.Ref.Id))continue;
            var value=JsonOf(item.BusinessData);
            var cells=cols.Select(c=>Text(value,c.Property)).ToArray();
            if(kind=="archive" && workspace=="company" && section=="achievement")
                cells[^1]=DirectoryPath(db,item.Folder.Parent?.Id);
            data.Add(cells);
            if(data.Count>20000)
                throw new InvalidDataException("单次最多导出 20000 条记录。");
        }
        return Build(cols,data);
    }


    // Business category is editable metadata; the actual hierarchy is the
    // folder's parent identity. Export/import directory paths independently.
    private static Dictionary<long,(long? Parent,string Name)> FolderMap(SqliteConnection db)
    {
        var map=new Dictionary<long,(long?,string)>();
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT id,parent_id,name FROM folders
            WHERE workspace='company' AND kind='archive_folder'
              AND section='achievement' AND deleted=0;
            """;
        using var rd=cmd.ExecuteReader();
        while(rd.Read())map[rd.GetInt64(0)]=(
            rd.IsDBNull(1)?null:rd.GetInt64(1),rd.GetString(2));
        return map;
    }
    private static string DirectoryPath(SqliteConnection db,long? id)
    {
        if(id is null)return "";
        var map=FolderMap(db);
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
        string section,string? category,string? directory,bool legacy)
    {
        if(workspace!="company" || section!="achievement")
        {
            if(!string.IsNullOrWhiteSpace(directory))
                throw new InvalidDataException("该资料分类不支持所属目录。");
            return null;
        }
        var map=FolderMap(db);
        if(!legacy)
        {
            if(string.IsNullOrWhiteSpace(directory))
                throw new InvalidDataException("公司业务档案需要填写“所属目录”，以防误放。");
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
        // Backwards compatibility: the old four-column workbook used
        // category as a root-folder locator. Never silently create folders.
        string name=string.IsNullOrWhiteSpace(category)?"其他业务资料":category.Trim();
        var roots=map.Where(x=>x.Value.Parent is null &&
            Same(x.Value.Name,name)).ToArray();
        if(roots.Length!=1)
            throw new InvalidDataException("旧版四列表格的类别必须对应唯一一级目录："+name);
        return roots[0].Key;
    }

    internal static object NativeArchiveGeneralImport(SqliteConnection db,
        string workspace,string kind,string section,string policy,byte[] bytes)
    {
        if(!Vault.WorkspaceValid(workspace) ||
           kind is not ("archive" or "general") ||
           kind=="archive"&&ArchiveRules.Module(workspace,section)==null ||
           kind=="general"&&section.Length!=0)
            throw new InvalidDataException("Excel 工作区或资料分类无效。");
        if(policy is not ("skip" or "update" or "create"))
            throw new InvalidDataException("重复记录策略应为 skip、update 或 create。");
        var parsed=kind=="archive"
            ?ReadCompatibleArchive(bytes):ReadCompatibleGeneral(bytes);
        var rows=parsed.Rows;
        bool legacy=parsed.Legacy;
        int created=0,updated=0,skipped=0,failed=0;
        var errors=new List<object>();
        foreach(var (line,fields) in rows)
        {
            try
            {
                if(kind=="archive")
                {
                    var input=Archive(fields);
                    if(ArchiveRules.Validate(input) is string error)
                        throw new InvalidDataException(error);
                    long? selectedParent=workspace=="company" && section=="achievement"
                        ?(legacy ? null : ArchiveParent(db,workspace,section,
                            input.Category,fields[5],false)):null;
                    var matches=NativeArchives(db,workspace,section).Where(x=>{
                        var a=(ArchiveInput)x.BusinessData;
                        if(!Same(a.Name??"",input.Name??""))return false;
                        if(workspace=="company" && section=="achievement" && !legacy)
                            return x.Folder.Parent?.Id==selectedParent;
                        return Same(a.Category??"",input.Category??"");
                    }).ToArray();
                    if(matches.Length>1)
                        throw new InvalidDataException("同名同目录资料不唯一，不能自动匹配更新。");
                    var existing=matches.FirstOrDefault();
                    if(existing is not null && policy=="skip"){skipped++;continue;}
                    if(existing is not null && policy=="update")
                    {
                        // Preserve the owning folder, FileId and all FileVersions.
                        var old=(ArchiveInput)existing.BusinessData;
                        var merged=MergeExcelUpdate(input,old);
                        if(ArchiveRules.Validate(merged) is string invalid)
                            throw new InvalidDataException(invalid);
                        var update=new FolderMutationInput(Archive:merged,Section:section);
                        if(!NativeArchiveStore.Update(db,existing.Folder.Ref,update))
                            throw new IOException("资料记录已发生变化。");
                        updated++;
                    }
                    else
                    {
                        // Only new company-business rows need a selected root;
                        // updating an existing nested archive never moves its parent.
                        var parent=ArchiveParent(db,workspace,section,
                            input.Category,fields[5],legacy);
                        NativeArchiveStore.Create(db,workspace,FolderKinds.Archive,
                            new FolderMutationInput(Archive:input with {FolderId=parent},
                                Section:section));
                        created++;
                    }
                }
                else
                {
                    var title=new TitleInput(fields[0],fields[1]);
                    if(GeneralRules.Validate(title) is string error)
                        throw new InvalidDataException(error);
                    var existing=NativeArchiveStore.List(db,workspace,
                        FolderKinds.General,null).FirstOrDefault(x=>
                            Same(x.Folder.Name,title.Title??""));
                    if(existing is not null && policy=="skip"){skipped++;continue;}
                    if(existing is not null && policy=="update")
                    {
                        var old=(TitleInput)existing.BusinessData;
                        var merged=new TitleInput(title.Title,
                            string.IsNullOrWhiteSpace(title.Remarks)?old.Remarks:title.Remarks);
                        if(!NativeArchiveStore.Update(db,existing.Folder.Ref,
                            new FolderMutationInput(General:merged)))
                            throw new IOException("综合资料记录已发生变化。");
                        updated++;
                    }
                    else
                    {
                        NativeArchiveStore.Create(db,workspace,FolderKinds.General,
                            new FolderMutationInput(General:title));
                        created++;
                    }
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