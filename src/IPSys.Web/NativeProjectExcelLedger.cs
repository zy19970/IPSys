using Microsoft.Data.Sqlite;

// V2 project fixed ledger identities. Existing XLSX columns
// remain stable; only FolderId and native attributes_json are authoritative.
static partial class ExcelLedger
{
    internal static byte[] NativeProjectExport(SqliteConnection db,string w,string kind,
        string mode,long[]? ids)
    {
        if(!Vault.WorkspaceValid(w)||kind!="project" ||
           mode is not ("all" or "filtered") || mode=="filtered" && (ids?.Length??0)>10000)
            throw new InvalidDataException("工作区、模块或筛选方式无效。");
        HashSet<long>? set=mode=="filtered"?new(ids??[]):null;
        var cols=Projects;
        var result=new List<string[]>();
        foreach(var snapshot in NativeFolderStore.List(db,w,FolderKinds.Project))
        {
            long id=snapshot.Folder.Ref.Id;
            if(set!=null&&!set.Contains(id))continue;
            var json=JsonOf(snapshot.BusinessData);
            string[] fields=cols.Select(c=>Text(json,c.Property)).ToArray();
            result.Add(fields);
            if(result.Count>20000)throw new InvalidDataException("单次最多导出 20000 行。");
        }
        return Build(cols,result);
    }

    internal static object NativeProjectImport(SqliteConnection db,string w,
        string policy,byte[] bytes)
    {
        if(!Vault.WorkspaceValid(w)||policy is not ("skip" or "update" or "create"))
            throw new InvalidDataException("工作区或重复记录策略无效。");
        var rows=ReadSheet(bytes,Projects);
        int created=0,updated=0,skipped=0,failed=0;
        var errors=new List<object>();
        foreach(var (line,fields) in rows)
        {
            try
            {
                var input=Project(fields);
                if(ProjectRules.Check(input) is string err)
                    throw new InvalidDataException(err);
                var current=NativeFolderStore.List(db,w,FolderKinds.Project);
                var existing=current.FirstOrDefault(x=>{
                    var p=(ProjectInput)x.BusinessData;
                    return !string.IsNullOrWhiteSpace(input.ProjectNo)
                        ?Same(p.ProjectNo??"",input.ProjectNo!)
                        :Same(p.Name??"",input.Name??"")&&
                         Same(p.ProjectType??"",input.ProjectType??"");
                });
                if(existing!=null&&policy=="skip"){skipped++;continue;}
                var payload=new FolderMutationInput(Project:input);
                if(existing!=null&&policy=="update")
                {
                    if(!NativeFolderStore.Update(db,
                        ResourceRef.Create(w,FolderKinds.Project,existing.Folder.Ref.Id),
                        payload))throw new IOException("项目状态已变化。");
                    updated++;
                }
                else
                {
                    NativeFolderStore.Create(db,w,FolderKinds.Project,payload);
                    created++;
                }
            }
            catch(Exception ex)
            {
                failed++;
                if(errors.Count<300)errors.Add(new{row=line,error=ex.Message});
            }
        }
        return new {created,updated,skipped,failed,
            errors,omittedErrors=failed-errors.Count,total=rows.Count};
    }
}
