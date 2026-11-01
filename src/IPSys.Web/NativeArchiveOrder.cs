using System.Text.Json;
using Microsoft.Data.Sqlite;

// Company business-archive folders and records share ONE persisted position column.
static class NativeArchiveOrder
{
    public static IReadOnlyList<FolderSnapshot> Entries(SqliteConnection db,
        string workspace,string section,long? parentId)
    {
        CheckScope(db,workspace,section,parentId);
        var folders=NativeArchiveStore.List(db,workspace,FolderKinds.ArchiveFolder,
            section,parentId);
        string kind=ArchiveDirectoryScopes.RecordKind(section);
        // Only direct records belong in each folder's mixed children table.
        var records=NativeArchiveStore.List(db,workspace,kind,
            kind==FolderKinds.General?null:section,parentId)
            .Where(x=>x.Folder.Parent?.Id==parentId);
        return folders.Concat(records)
            .OrderBy(x=>x.Folder.Position).ThenBy(x=>x.Folder.Ref.Id)
            .ToArray();
    }

    private static void CheckScope(SqliteConnection db,string workspace,
        string section,long? parent)
    {
        if(!ArchiveDirectoryScopes.Allowed(workspace,section))
            throw new ArgumentException("当前模块不支持目录混排。");
        if(parent is <=0)throw new ArgumentException("无效的目录。");
        if(parent is long id)
        {
            var r=ResourceRef.Create(workspace,FolderKinds.ArchiveFolder,id,section);
            if(NativeArchiveStore.Get(db,r) is null)
                throw new KeyNotFoundException("目录不存在。");
        }
    }

    public static bool Reorder(SqliteConnection db,string workspace,
        string section,ArchiveEntryReorder request)
    {
        if(request.Items is null || request.ParentId<0 ||
            request.Items.Any(x=>x.Id<=0 || x.Kind is not ("folder" or "record")))
            throw new ArgumentException("排序项目格式不正确。");
        long? parent=request.ParentId==0?null:request.ParentId;
        CheckScope(db,workspace,section,parent);
        var existing=Entries(db,workspace,section,parent)
            .Select(x=>(Kind:x.Folder.Ref.Kind==FolderKinds.ArchiveFolder?"folder":"record",
                Id:x.Folder.Ref.Id)).ToHashSet();
        var proposed=request.Items.Select(x=>(x.Kind,x.Id)).ToArray();
        if(proposed.Length!=existing.Count || proposed.Distinct().Count()!=proposed.Length ||
           proposed.Any(x=>!existing.Contains(x)))return false;
        using var tx=db.BeginTransaction();
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="""
            UPDATE folders SET position=$position
            WHERE id=$id AND workspace=$w AND section=$section
              AND kind=$kind AND COALESCE(parent_id,0)=$parent AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$parent",request.ParentId);
        cmd.Parameters.AddWithValue("$w",workspace);
        var idParam=cmd.Parameters.Add("$id",SqliteType.Integer);
        var kindParam=cmd.Parameters.Add("$kind",SqliteType.Text);
        var sectionParam=cmd.Parameters.Add("$section",SqliteType.Text);
        var posParam=cmd.Parameters.Add("$position",SqliteType.Integer);
        for(int i=0;i<proposed.Length;i++)
        {
            idParam.Value=proposed[i].Id;
            kindParam.Value=proposed[i].Kind=="folder"?
                FolderKinds.ArchiveFolder:ArchiveDirectoryScopes.RecordKind(section);
            sectionParam.Value=proposed[i].Kind=="folder"?section:
                section=="general"?"":section;
            posParam.Value=i;
            if(cmd.ExecuteNonQuery()!=1)
                throw new InvalidOperationException("目录内容发生变化，请刷新后排序。");
        }
        tx.Commit();
        return true;
    }

    public static bool Move(SqliteConnection db,ResourceRef r,long? targetParent)
    {
        string scope=ArchiveDirectoryScopes.ForRecord(r.Kind,r.Section);
        if(!r.IsValid || !ArchiveDirectoryScopes.Allowed(r.Workspace,scope) ||
            r.Kind is not (FolderKinds.ArchiveFolder or FolderKinds.Archive or FolderKinds.General))
            throw new ArgumentException("该资料类型不支持目录移动。");
        if(r.Kind==FolderKinds.Archive && r.Workspace=="company" &&
            r.Section=="achievement" && targetParent is null)
            throw new ArgumentException("公司业务档案资料必须归属具体目录。");
        if(targetParent is <=0)throw new ArgumentException("无效的目标目录。");
        if(targetParent is long p && NativeArchiveStore.Get(db,
            ResourceRef.Create(r.Workspace,FolderKinds.ArchiveFolder,p,scope)) is null)
            throw new KeyNotFoundException("目标目录不存在。");
        using var tx=db.BeginTransaction();
        using var select=db.CreateCommand();
        select.Transaction=tx;
        select.CommandText="""
            SELECT name,attributes_json,parent_id FROM folders
            WHERE id=$id AND workspace=$w AND kind=$kind
              AND section=$section AND deleted=0;
            """;
        select.Parameters.AddWithValue("$id",r.Id);
        select.Parameters.AddWithValue("$w",r.Workspace);
        select.Parameters.AddWithValue("$section",r.Section);
        select.Parameters.AddWithValue("$kind",r.Kind);
        string name,json;long? oldParent;
        using(var rd=select.ExecuteReader())
        {
            if(!rd.Read())return false;
            name=rd.GetString(0);json=rd.GetString(1);
            oldParent=rd.IsDBNull(2)?null:rd.GetInt64(2);
        }
        if(oldParent==targetParent)return true;

        string updatedJson;
        if(r.Kind==FolderKinds.ArchiveFolder)
            updatedJson=JsonSerializer.Serialize(new ArchiveFolderInput(name,targetParent));
        else if(r.Kind==FolderKinds.Archive)
        {
            var data=JsonSerializer.Deserialize<ArchiveInput>(json)
                ?? throw new InvalidDataException("资料属性无效。");
            updatedJson=JsonSerializer.Serialize(data with {FolderId=targetParent});
        }
        else updatedJson=json;
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="""
            UPDATE folders SET parent_id=$parent,attributes_json=$json,
              position=(SELECT COALESCE(MAX(position),-1)+1 FROM folders
                WHERE workspace=$w AND COALESCE(parent_id,0)=COALESCE($parent,0)
                  AND deleted=0 AND
                 ((kind='archive_folder' AND section=$scope)
                  OR (kind='archive' AND section=$scope)
                  OR (kind='general' AND $scope='general')))
            WHERE id=$id AND workspace=$w AND kind=$kind
              AND section=$section AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$parent",(object?)targetParent??DBNull.Value);
        cmd.Parameters.AddWithValue("$w",r.Workspace);
        cmd.Parameters.AddWithValue("$scope",scope);
        cmd.Parameters.AddWithValue("$section",r.Section);
        cmd.Parameters.AddWithValue("$json",updatedJson);
        cmd.Parameters.AddWithValue("$id",r.Id);
        cmd.Parameters.AddWithValue("$kind",r.Kind);
        if(cmd.ExecuteNonQuery()!=1)return false;
        tx.Commit();
        return true;
    }
}
