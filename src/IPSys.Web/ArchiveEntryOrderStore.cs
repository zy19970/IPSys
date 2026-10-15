using Microsoft.Data.Sqlite;

// Persist one ordering for company business-archive child folders and records.
// Keys are typed, so a folder and record with the same numeric ID never collide.
// Existing archive_folders.position and ledger_record_order remain untouched.
record ArchiveEntryOrderItem(string Kind,long Id);
record ArchiveEntryReorder(long ParentId,List<ArchiveEntryOrderItem>? Items);
static class ArchiveEntryOrderStore
{
    public static void Ensure(SqliteConnection db)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            CREATE TABLE IF NOT EXISTS archive_entry_order(
                parent_id INTEGER NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('folder','record')),
                item_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY(parent_id,kind,item_id));
            CREATE INDEX IF NOT EXISTS idx_archive_entry_order_position
              ON archive_entry_order(parent_id,position);
            """;
        cmd.ExecuteNonQuery();
    }

    public static Dictionary<string,List<ArchiveEntryOrderItem>> Orders(SqliteConnection db)
    {
        var result=new Dictionary<string,List<ArchiveEntryOrderItem>>();
        using var cmd=db.CreateCommand();
        cmd.CommandText="SELECT parent_id,kind,item_id FROM archive_entry_order ORDER BY parent_id,position;";
        using var reader=cmd.ExecuteReader();
        while(reader.Read())
        {
            string parent=reader.GetInt64(0).ToString(System.Globalization.CultureInfo.InvariantCulture);
            if(!result.TryGetValue(parent,out var rows))
            {
                rows=new List<ArchiveEntryOrderItem>();
                result[parent]=rows;
            }
            rows.Add(new ArchiveEntryOrderItem(reader.GetString(1),reader.GetInt64(2)));
        }
        return result;
    }

    public static bool Reorder(SqliteConnection db,ArchiveEntryReorder request)
    {
        if(request.ParentId<0 || request.Items is null ||
           request.Items.Any(x=>x.Id<=0||x.Kind is not ("folder" or "record")))return false;

        using var tx=db.BeginTransaction();
        if(request.ParentId!=0)
        {
            using var parent=db.CreateCommand();
            parent.Transaction=tx;
            parent.CommandText="SELECT count(*) FROM archive_folders WHERE id=$id;";
            parent.Parameters.AddWithValue("$id",request.ParentId);
            if((long)parent.ExecuteScalar()! !=1)return false;
        }

        var existing=new HashSet<(string Kind,long Id)>();
        using(var query=db.CreateCommand())
        {
            query.Transaction=tx;
            query.CommandText="SELECT id FROM archive_folders WHERE COALESCE(parent_id,0)=$parent;";
            query.Parameters.AddWithValue("$parent",request.ParentId);
            using var reader=query.ExecuteReader();
            while(reader.Read())existing.Add(("folder",reader.GetInt64(0)));
        }
        using(var query=db.CreateCommand())
        {
            query.Transaction=tx;
            query.CommandText="""
                SELECT id FROM business_archives
                WHERE workspace='company' AND section='achievement'
                  AND deleted=0 AND COALESCE(folder_id,0)=$parent;
                """;
            query.Parameters.AddWithValue("$parent",request.ParentId);
            using var reader=query.ExecuteReader();
            while(reader.Read())existing.Add(("record",reader.GetInt64(0)));
        }
        // Exact permutation; stale or cross-parent requests cannot change ordering.
        var proposed=request.Items.Select(x=>(x.Kind,x.Id)).ToList();
        if(proposed.Count!=existing.Count||proposed.Distinct().Count()!=proposed.Count||
           proposed.Any(x=>!existing.Contains(x)))return false;

        using(var clear=db.CreateCommand())
        {
            clear.Transaction=tx;
            clear.CommandText="DELETE FROM archive_entry_order WHERE parent_id=$parent;";
            clear.Parameters.AddWithValue("$parent",request.ParentId);
            clear.ExecuteNonQuery();
        }
        using(var insert=db.CreateCommand())
        {
            insert.Transaction=tx;
            insert.CommandText="""
                INSERT INTO archive_entry_order(parent_id,kind,item_id,position)
                VALUES($parent,$kind,$item,$position);
                """;
            insert.Parameters.AddWithValue("$parent",request.ParentId);
            var kind=insert.Parameters.Add("$kind",SqliteType.Text);
            var item=insert.Parameters.Add("$item",SqliteType.Integer);
            var position=insert.Parameters.Add("$position",SqliteType.Integer);
            for(int i=0;i<request.Items.Count;i++)
            {
                kind.Value=request.Items[i].Kind;
                item.Value=request.Items[i].Id;
                position.Value=i;
                insert.ExecuteNonQuery();
            }
        }
        tx.Commit();
        return true;
    }
}
