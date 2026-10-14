using Microsoft.Data.Sqlite;

record LedgerIdsInput(long[]? Ids,string? Section="");

static class LedgerBatch
{
    private static bool Scope(string workspace,string kind,string section)
    {
        if(workspace is not ("company" or "personal"))return false;
        return kind switch
        {
            "project" or "ip" or "contract" => section.Length==0,
            "archive" => ArchiveStore.Module(workspace,section)!=null &&
                !(workspace=="company"&&section=="certificate"),
            _ => false
        };
    }

    public static void Ensure(SqliteConnection db)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            CREATE TABLE IF NOT EXISTS ledger_record_order(
                workspace TEXT NOT NULL,kind TEXT NOT NULL,section TEXT NOT NULL DEFAULT '',
                record_id INTEGER NOT NULL,position INTEGER NOT NULL,
                PRIMARY KEY(workspace,kind,section,record_id));
            CREATE INDEX IF NOT EXISTS idx_ledger_record_order_scope
                ON ledger_record_order(workspace,kind,section,position);
            """;
        cmd.ExecuteNonQuery();
    }

    public static Dictionary<string,List<long>> Orders(SqliteConnection db,string workspace)
    {
        var result=new Dictionary<string,List<long>>();
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT kind,section,record_id FROM ledger_record_order
            WHERE workspace=$w ORDER BY kind,section,position;
            """;
        cmd.Parameters.AddWithValue("$w",workspace);
        using var reader=cmd.ExecuteReader();
        while(reader.Read())
        {
            string key=reader.GetString(0)+":"+reader.GetString(1);
            if(!result.TryGetValue(key,out var ids))
            {
                ids=new List<long>();result.Add(key,ids);
            }
            ids.Add(reader.GetInt64(2));
        }
        return result;
    }

    private static string SelectIds(string kind,string section)=>kind switch
    {
        "project"=>"SELECT id FROM business_projects WHERE workspace=$w AND deleted=0",
        "ip"=>"SELECT id FROM business_ips WHERE workspace=$w AND deleted=0",
        "contract"=>"""
            SELECT c.id FROM business_contracts c
            JOIN business_projects p ON p.id=c.project_id AND p.workspace=c.workspace
            WHERE c.workspace=$w AND c.deleted=0 AND p.deleted=0
            """,
        "archive"=>"SELECT id FROM business_archives WHERE workspace=$w AND module=$module AND section=$section AND deleted=0",
        _=>throw new ArgumentOutOfRangeException(nameof(kind))
    };

    public static bool Reorder(SqliteConnection db,string workspace,string kind,string section,long[]? ids)
    {
        if(!Scope(workspace,kind,section)||ids is null||ids.Length!=ids.Distinct().Count()||ids.Any(x=>x<=0))return false;
        using var tx=db.BeginTransaction();
        var actual=new List<long>();
        using(var check=db.CreateCommand())
        {
            check.Transaction=tx;
            check.CommandText=SelectIds(kind,section);
            check.Parameters.AddWithValue("$w",workspace);
            if(kind=="archive")
            {
                check.Parameters.AddWithValue("$section",section);
                check.Parameters.AddWithValue("$module",ArchiveStore.Module(workspace,section)!);
            }
            using var reader=check.ExecuteReader();
            while(reader.Read())actual.Add(reader.GetInt64(0));
        }
        if(ids.Length!=actual.Count || !ids.OrderBy(x=>x).SequenceEqual(actual.OrderBy(x=>x)))return false;
        using(var clean=db.CreateCommand())
        {
            clean.Transaction=tx;
            clean.CommandText="DELETE FROM ledger_record_order WHERE workspace=$w AND kind=$kind AND section=$section;";
            clean.Parameters.AddWithValue("$w",workspace);
            clean.Parameters.AddWithValue("$kind",kind);
            clean.Parameters.AddWithValue("$section",section);
            clean.ExecuteNonQuery();
        }
        using(var insert=db.CreateCommand())
        {
            insert.Transaction=tx;
            insert.CommandText="""
                INSERT INTO ledger_record_order(workspace,kind,section,record_id,position)
                VALUES($w,$kind,$section,$id,$position);
                """;
            insert.Parameters.AddWithValue("$w",workspace);
            insert.Parameters.AddWithValue("$kind",kind);
            insert.Parameters.AddWithValue("$section",section);
            var id=insert.Parameters.Add("$id",SqliteType.Integer);
            var position=insert.Parameters.Add("$position",SqliteType.Integer);
            for(int n=0;n<ids.Length;n++)
            {
                id.Value=ids[n];position.Value=n;insert.ExecuteNonQuery();
            }
        }
        tx.Commit();return true;
    }

    public static bool SoftDelete(SqliteConnection db,string workspace,string kind,string section,long[]? ids)
    {
        if(!Scope(workspace,kind,section)||ids is null||ids.Length==0||
            ids.Any(x=>x<=0)||ids.Distinct().Count()!=ids.Length)return false;
        using var tx=db.BeginTransaction();
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText=kind switch
        {
            "project"=>"UPDATE business_projects SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;",
            "ip"=>"UPDATE business_ips SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;",
            "contract"=>"""
                UPDATE business_contracts SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0
                AND EXISTS(SELECT 1 FROM business_projects p WHERE p.id=business_contracts.project_id
                    AND p.workspace=$w AND p.deleted=0);
                """,
            "archive"=>"""
                UPDATE business_archives SET deleted=1
                WHERE id=$id AND workspace=$w AND section=$section AND module=$module AND deleted=0;
                """,
            _=>throw new ArgumentOutOfRangeException(nameof(kind))
        };
        cmd.Parameters.AddWithValue("$w",workspace);
        if(kind=="archive")
        {
            cmd.Parameters.AddWithValue("$section",section);
            cmd.Parameters.AddWithValue("$module",ArchiveStore.Module(workspace,section)!);
        }
        var id=cmd.Parameters.Add("$id",SqliteType.Integer);
        foreach(var rowId in ids)
        {
            id.Value=rowId;
            if(cmd.ExecuteNonQuery()!=1)return false;
        }
        tx.Commit();return true;
    }
}
