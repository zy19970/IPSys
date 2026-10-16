using Microsoft.Data.Sqlite;
using System.Globalization;

// V2 project / contract fixed ledger identities. Existing XLSX columns
// remain stable; only FolderId and native attributes_json are authoritative.
static partial class ExcelLedger
{
    internal static byte[] NativeProjectExport(SqliteConnection db,string w,string kind,
        string mode,long[]? ids)
    {
        if(!Vault.WorkspaceValid(w)||kind is not ("project" or "contract") ||
           mode is not ("all" or "filtered") || mode=="filtered" && (ids?.Length??0)>10000)
            throw new InvalidDataException("工作区、模块或筛选方式无效。");
        HashSet<long>? set=mode=="filtered"?new(ids??[]):null;
        var cols=kind=="project"?Projects:Contracts;
        var result=new List<string[]>();
        var projects=NativeFolderStore.List(db,w,FolderKinds.Project);
        var names=projects.ToDictionary(x=>x.Folder.Ref.Id,x=>x.Folder.Name);
        var rows=kind=="project"?projects:NativeFolderStore.List(db,w,FolderKinds.Contract);
        foreach(var snapshot in rows)
        {
            long id=snapshot.Folder.Ref.Id;
            if(set!=null&&!set.Contains(id))continue;
            if(kind=="contract" &&
               (snapshot.Folder.Parent is not ResourceRef parent ||
                !names.ContainsKey(parent.Id)))continue;
            var json=JsonOf(snapshot.BusinessData);
            string[] fields=cols.Select(c=>c.Property=="projectName"
                ?names[snapshot.Folder.Parent!.Value.Id]
                :Text(json,c.Property)).ToArray();
            if(kind=="contract" && decimal.TryParse(fields[4],
                NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture,out var amount))
                fields[4]=amount.ToString("0.00",CultureInfo.InvariantCulture);
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
                if(ProjectStore.Check(input) is string err)
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
