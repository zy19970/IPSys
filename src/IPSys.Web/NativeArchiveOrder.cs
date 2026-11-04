using System.Text.Json;
using Microsoft.Data.Sqlite;

// Company business-archive folders and records share ONE persisted position column.
static class NativeArchiveOrder
{
    // A02/N2: records and directories are the same archive_folder row, so one
    // level of the folder table already IS the mixed sibling list.
    public static IReadOnlyList<FolderSnapshot> Entries(SqliteConnection db,
        string workspace,string section,long? parentId)
    {
        CheckScope(db,workspace,section,parentId);
        return NativeArchiveStore.List(db,workspace,FolderKinds.ArchiveFolder,
            section,parentId);
    }

    private static void CheckScope(SqliteConnection db,string workspace,
        string section,long? parent)
    {
        if(!ArchiveDirectoryScopes.Allowed(workspace,section))
            throw new ArgumentException("当前模块不支持目录混排。");
        if(parent is <=0)throw new ArgumentException("无效的目录。");
        if(section=="project" && parent is null)
            throw new ArgumentException("项目目录排序必须指定真实项目或其子目录 FolderId。");
        if(parent is long id)
        {
            var folder=NativeArchiveStore.Get(db,
                ResourceRef.Create(workspace,FolderKinds.ArchiveFolder,id,section));
            var project=section=="project"?
                NativeFolderStore.Get(db,ResourceRef.Create(workspace,FolderKinds.Project,id)):null;
            if(folder is null && project is null)
                throw new KeyNotFoundException("目标目录或项目不存在。");
        }
    }

    public static bool Reorder(SqliteConnection db,string workspace,
        string section,ArchiveEntryReorder request)
    {
        if(request.Items is null || request.ParentId<0 ||
            request.Items.Any(x=>x.Id<=0 || x.Kind!="folder"))
            throw new ArgumentException("排序项目格式不正确。");
        long? parent=request.ParentId==0?null:request.ParentId;
        CheckScope(db,workspace,section,parent);
        var existing=Entries(db,workspace,section,parent)
            .Select(x=>(Kind:"folder",Id:x.Folder.Ref.Id)).ToHashSet();
        var proposed=request.Items.Select(x=>(x.Kind,x.Id)).ToArray();
        if(proposed.Length!=existing.Count || proposed.Distinct().Count()!=proposed.Length ||
           proposed.Any(x=>!existing.Contains(x)))return false;
        using var tx=db.BeginTransaction();
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="""
            UPDATE folders SET position=$position
            WHERE id=$id AND workspace=$w AND section=$section
              AND kind='archive_folder' AND COALESCE(parent_id,0)=$parent AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$parent",request.ParentId);
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$section",section);
        var idParam=cmd.Parameters.Add("$id",SqliteType.Integer);
        var posParam=cmd.Parameters.Add("$position",SqliteType.Integer);
        for(int i=0;i<proposed.Length;i++)
        {
            idParam.Value=proposed[i].Id;
            posParam.Value=i;
            if(cmd.ExecuteNonQuery()!=1)
                throw new InvalidOperationException("目录内容发生变化，请刷新后排序。");
        }
        tx.Commit();
        return true;
    }

    public static bool Move(SqliteConnection db,ResourceRef r,long? targetParent)
    {
        if(!r.IsValid || !NativeArchiveStore.Handles(r.Kind))
            throw new ArgumentException("该资料类型不支持目录移动。");
        r=NativeArchiveStore.Unify(r);
        if(!ArchiveDirectoryScopes.Allowed(r.Workspace,r.Section))
            throw new ArgumentException("该资料类型不支持目录移动。");
        if(targetParent is <=0 || (r.Section=="project" && targetParent is null))
            throw new ArgumentException("项目内部文件夹必须属于一个项目。");
        using var tx=db.BeginTransaction();
        using var select=db.CreateCommand();
        select.Transaction=tx;
        select.CommandText="""
            SELECT name,attributes_json,parent_id FROM folders
            WHERE id=$id AND workspace=$w AND kind='archive_folder'
              AND section=$section AND deleted=0;
            """;
        select.Parameters.AddWithValue("$id",r.Id);
        select.Parameters.AddWithValue("$w",r.Workspace);
        select.Parameters.AddWithValue("$section",r.Section);
        string name,json;long? oldParent;
        using(var rd=select.ExecuteReader())
        {
            if(!rd.Read())return false;
            name=rd.GetString(0);json=rd.GetString(1);
            oldParent=rd.IsDBNull(2)?null:rd.GetInt64(2);
        }
        if(oldParent==targetParent)return true;
        if(targetParent is long p && NativeArchiveStore.Get(db,
            ResourceRef.Create(r.Workspace,FolderKinds.ArchiveFolder,p,r.Section)) is null &&
            (r.Section!="project" || NativeFolderStore.Get(db,
              ResourceRef.Create(r.Workspace,FolderKinds.Project,p)) is null))
            throw new KeyNotFoundException("目标目录或项目不存在。");

        var data=JsonSerializer.Deserialize<ArchiveFolderInput>(json)
            ?? new ArchiveFolderInput(name,oldParent);
        string updatedJson=JsonSerializer.Serialize(
            data with {Name=name,ParentId=targetParent});
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="""
            UPDATE folders SET parent_id=$parent,attributes_json=$json,
              position=(SELECT COALESCE(MAX(position),-1)+1 FROM folders
                WHERE workspace=$w AND kind='archive_folder' AND section=$section
                  AND COALESCE(parent_id,0)=COALESCE($parent,0) AND deleted=0)
            WHERE id=$id AND workspace=$w AND kind='archive_folder'
              AND section=$section AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$parent",(object?)targetParent??DBNull.Value);
        cmd.Parameters.AddWithValue("$w",r.Workspace);
        cmd.Parameters.AddWithValue("$section",r.Section);
        cmd.Parameters.AddWithValue("$json",updatedJson);
        cmd.Parameters.AddWithValue("$id",r.Id);
        if(cmd.ExecuteNonQuery()!=1)return false;
        tx.Commit();
        return true;
    }
}
