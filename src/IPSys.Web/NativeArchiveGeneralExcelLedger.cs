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
        if(kind=="archive"&&ArchiveStore.Module(workspace,section)==null ||
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
            data.Add(cols.Select(c=>Text(value,c.Property)).ToArray());
            if(data.Count>20000)
                throw new InvalidDataException("单次最多导出 20000 条记录。");
        }
        return Build(cols,data);
    }

    private static long? ArchiveParent(SqliteConnection db,string workspace,
        string section,string? category)
    {
        if(workspace!="company" || section!="achievement")return null;
        string name=string.IsNullOrWhiteSpace(category)?"其他业务资料":category.Trim();
        var roots=NativeArchiveStore.List(db,workspace,FolderKinds.ArchiveFolder,
            "achievement");
        var folder=roots.FirstOrDefault(x=>x.Folder.Parent is null &&
            Same(x.Folder.Name,name));
        if(folder is null)
            throw new InvalidDataException("公司业务档案的 Excel 类别必须是已存在的一级目录："+name);
        return folder.Folder.Ref.Id;
    }

    internal static object NativeArchiveGeneralImport(SqliteConnection db,
        string workspace,string kind,string section,string policy,byte[] bytes)
    {
        if(!Vault.WorkspaceValid(workspace) ||
           kind is not ("archive" or "general") ||
           kind=="archive"&&ArchiveStore.Module(workspace,section)==null ||
           kind=="general"&&section.Length!=0)
            throw new InvalidDataException("Excel 工作区或资料分类无效。");
        if(policy is not ("skip" or "update" or "create"))
            throw new InvalidDataException("重复记录策略应为 skip、update 或 create。");
        var rows=ReadSheet(bytes,kind=="archive"?ArchiveColumns:GeneralColumns);
        int created=0,updated=0,skipped=0,failed=0;
        var errors=new List<object>();
        foreach(var (line,fields) in rows)
        {
            try
            {
                if(kind=="archive")
                {
                    var input=Archive(fields);
                    if(ArchiveStore.Validate(input) is string error)
                        throw new InvalidDataException(error);
                    var existing=NativeArchives(db,workspace,section).FirstOrDefault(x=>{
                        var a=(ArchiveInput)x.BusinessData;
                        return Same(a.Name??"",input.Name??"") &&
                            Same(a.Category??"",input.Category??"");
                    });
                    if(existing is not null && policy=="skip"){skipped++;continue;}
                    if(existing is not null && policy=="update")
                    {
                        // Preserve the owning folder, FileId and all FileVersions.
                        var old=(ArchiveInput)existing.BusinessData;
                        var update=new FolderMutationInput(Archive:input with {
                            FolderId=old.FolderId,Year=old.Year},Section:section);
                        if(!NativeArchiveStore.Update(db,existing.Folder.Ref,update))
                            throw new IOException("资料记录已发生变化。");
                        updated++;
                    }
                    else
                    {
                        // Only new company-business rows need a selected root;
                        // updating an existing nested archive never moves its parent.
                        var parent=ArchiveParent(db,workspace,section,input.Category);
                        NativeArchiveStore.Create(db,workspace,FolderKinds.Archive,
                            new FolderMutationInput(Archive:input with {FolderId=parent},
                                Section:section));
                        created++;
                    }
                }
                else
                {
                    var title=new TitleInput(fields[0]);
                    if(GeneralFolderCommands.Validate(title) is string error)
                        throw new InvalidDataException(error);
                    var existing=NativeArchiveStore.List(db,workspace,
                        FolderKinds.General,null).FirstOrDefault(x=>
                            Same(x.Folder.Name,title.Title??""));
                    if(existing is not null && policy=="skip"){skipped++;continue;}
                    if(existing is not null && policy=="update")
                    {
                        if(!NativeArchiveStore.Update(db,existing.Folder.Ref,
                            new FolderMutationInput(General:title)))
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