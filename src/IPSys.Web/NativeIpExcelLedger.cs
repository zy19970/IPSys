using Microsoft.Data.Sqlite;

// N2-03-03: V2 intellectual-property Excel is a *different* persistence
// adapter over the same fixed-format XLSX columns, never a second IP table.
// The legacy Excel routes remain stable until the old UI is retired.
static partial class ExcelLedger
{
    private static IReadOnlyList<FolderSnapshot> NativeIps(SqliteConnection db,string workspace)=>
        NativeFolderStore.List(db,workspace,FolderKinds.Ip);

    private static (long Id,IpInput Data)? NativeMatch(IpInput input,
        IReadOnlyList<FolderSnapshot> items)
    {
        foreach(var item in items)
        {
            var existing=(IpInput)item.BusinessData;
            if(!string.IsNullOrWhiteSpace(input.ApplicationNo)
                ? Same(existing.ApplicationNo??"",input.ApplicationNo!)
                : !string.IsNullOrWhiteSpace(input.RegistrationNo)
                    ? Same(existing.RegistrationNo??"",input.RegistrationNo!)
                    : Same(existing.Name??"",input.Name??"") &&
                      Same(existing.IpType??"",input.IpType??""))
                return (item.Folder.Ref.Id,existing);
        }
        return null;
    }

    internal static byte[] NativeIpExport(SqliteConnection db,string workspace,
        string mode,long[]? selected)
    {
        if(!Vault.WorkspaceValid(workspace))
            throw new InvalidDataException("无效工作区。");
        if(mode is not ("all" or "filtered"))
            throw new InvalidDataException("必须选择当前筛选或全部记录。");
        if(mode=="filtered" && (selected?.Length??0)>10000)
            throw new InvalidDataException("筛选结果超过 10000 条，请缩小范围。");
        var allow=mode=="filtered"?new HashSet<long>(selected??[]):null;
        var data=new List<string[]>();
        foreach(var row in NativeIps(db,workspace))
        {
            if(allow is not null && !allow.Contains(row.Folder.Ref.Id))continue;
            var value=JsonOf((IpInput)row.BusinessData);
            data.Add(IntellectualProperty.Select(col=>Text(value,col.Property)).ToArray());
            if(data.Count>20000)
                throw new InvalidDataException("单次 XLSX 导出最多 20000 条记录。");
        }
        return Build(IntellectualProperty,data);
    }

    internal static object NativeIpImport(SqliteConnection db,string workspace,
        string policy,byte[] bytes)
    {
        if(!Vault.WorkspaceValid(workspace))
            throw new InvalidDataException("无效工作区。");
        if(policy is not ("skip" or "update" or "create"))
            throw new InvalidDataException("重复记录处理方式必须选择跳过、更新已有或另建。");
        if(bytes.Length>MaxWorkbookBytes)
            throw new InvalidDataException("Excel 文件不能超过 8 MiB。");

        var rows=ReadSheet(bytes,IntellectualProperty);
        var ips=NativeIps(db,workspace);
        int created=0,updated=0,skipped=0,failed=0;
        var errors=new List<object>();
        foreach(var (line,fields) in rows)
        {
            try
            {
                var input=Ip(fields);
                if(IpStore.Validate(input) is string validation)
                    throw new InvalidDataException(validation);
                var existing=NativeMatch(input,ips);
                if(existing is not null && policy=="skip")
                {
                    skipped++;
                    continue;
                }
                var payload=new FolderMutationInput(Ip:input);
                if(existing is not null && policy=="update")
                {
                    if(!NativeFolderStore.Update(db,
                        ResourceRef.Create(workspace,FolderKinds.Ip,existing.Value.Id),payload))
                        throw new IOException("已有知识产权已发生变化。");
                    updated++;
                }
                else
                {
                    NativeFolderStore.Create(db,workspace,FolderKinds.Ip,payload);
                    created++;
                }
                // Refresh V2 folder identities for later rows; no legacy IpStore writes.
                ips=NativeIps(db,workspace);
            }
            catch(Exception ex)
            {
                failed++;
                if(errors.Count<300)errors.Add(new {row=line,error=ex.Message});
            }
        }
        return new {created,updated,skipped,failed,errors,
            omittedErrors=failed-errors.Count,total=rows.Count};
    }
}
