using Microsoft.Data.Sqlite;

static class GeneralStore
{
    // Metadata-only upgrade. Original records/attachments/chunks and bytes are kept.
    public static void Ensure(SqliteConnection db)
    {
        AddColumn(db,"records","deleted","INTEGER NOT NULL DEFAULT 0");
        AddColumn(db,"attachments","deleted","INTEGER NOT NULL DEFAULT 0");
        AddColumn(db,"attachments","version","INTEGER NOT NULL DEFAULT 1");
        AddColumn(db,"attachments","group_id","TEXT NOT NULL DEFAULT ''");
        using var tx=db.BeginTransaction();
        using var groups=db.CreateCommand();groups.Transaction=tx;
        groups.CommandText="""
            UPDATE attachments SET group_id='general-legacy-'||(
                SELECT MIN(x.id) FROM attachments x
                WHERE x.record_id=attachments.record_id
                AND x.filename=attachments.filename)
            WHERE group_id='';
            """;
        groups.ExecuteNonQuery();
        using var versions=db.CreateCommand();versions.Transaction=tx;
        versions.CommandText="""
            UPDATE attachments SET version=(
                SELECT COUNT(*) FROM attachments x
                WHERE x.record_id=attachments.record_id AND x.group_id=attachments.group_id
                AND x.id<=attachments.id)
            WHERE group_id LIKE 'general-legacy-%';
            """;
        versions.ExecuteNonQuery();
        tx.Commit();
    }

    private static void AddColumn(SqliteConnection db,string table,string name,string type)
    {
        bool found=false;
        using(var check=db.CreateCommand())
        {
            check.CommandText="PRAGMA table_info("+table+");";
            using var reader=check.ExecuteReader();
            while(reader.Read())if(reader.GetString(1)==name)found=true;
        }
        if(found)return;
        using var cmd=db.CreateCommand();
        cmd.CommandText="ALTER TABLE "+table+" ADD COLUMN "+name+" "+type+";";
        cmd.ExecuteNonQuery();
    }

    public static bool OwnerExists(SqliteConnection db,string workspace,long id)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="SELECT count(*) FROM records WHERE id=$id AND workspace=$w AND deleted=0;";
        cmd.Parameters.AddWithValue("$id",id);
        cmd.Parameters.AddWithValue("$w",workspace);
        return (long)cmd.ExecuteScalar()! == 1;
    }

    public static (string Group,int Version) ChooseVersion(SqliteConnection db,
        string workspace,long recordId,string filename,string mode,string requested)
    {
        if(mode is not ("update" or "new")||requested.Length>80||requested.Any(char.IsControl))
            throw new IOException("文件版本选择无效。");
        if(mode=="new")return (Guid.NewGuid().ToString("N"),1);
        var groups=new HashSet<string>();
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                SELECT DISTINCT a.group_id FROM attachments a JOIN records r ON r.id=a.record_id
                WHERE r.workspace=$w AND r.id=$id AND r.deleted=0
                AND a.filename=$name AND a.deleted=0 AND a.state='ready';
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$id",recordId);
            cmd.Parameters.AddWithValue("$name",filename);
            using var reader=cmd.ExecuteReader();
            while(reader.Read())groups.Add(reader.GetString(0));
        }
        if(groups.Count==0)
        {
            if(requested.Length>0)throw new IOException("指定的历史附件已不存在。");
            return (Guid.NewGuid().ToString("N"),1);
        }
        var group=requested.Length>0?requested:
            groups.Count==1?groups.Single():throw new IOException("存在多组同名原件，请选择版本链。");
        if(!groups.Contains(group))throw new IOException("指定的文件不属于当前记录。");
        using var next=db.CreateCommand();
        next.CommandText="SELECT COALESCE(MAX(version),0)+1 FROM attachments WHERE record_id=$id AND group_id=$group;";
        next.Parameters.AddWithValue("$id",recordId);
        next.Parameters.AddWithValue("$group",group);
        return (group,Convert.ToInt32(next.ExecuteScalar()));
    }
}
