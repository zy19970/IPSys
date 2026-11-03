using Microsoft.Data.Sqlite;

record NativeBatchFileLink(long FileId,long LinkId);
record NativeBatchAssociateInput(long TargetFolderId,bool Move,NativeBatchFileLink[]? Items);

// A batch is one SQLCipher transaction: either every link moves/shares,
// or none does. Each FileId is sent once; versions still follow that FileId.
static class NativeFileAssociateBatchEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/files/{workspace}/associate-batch",async(
            HttpContext ctx,Vault v,string workspace,NativeBatchAssociateInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            var items=input.Items;
            if(!Vault.WorkspaceValid(workspace)||input.TargetFolderId<=0||
               items is null||items.Length==0||items.Length>500||
               items.Any(x=>x.FileId<=0||x.LinkId<=0)||
               items.Select(x=>x.FileId).Distinct().Count()!=items.Length||
               items.Select(x=>x.LinkId).Distinct().Count()!=items.Length)
                return fail("批量附件参数无效，或者存在重复原件。单次最多500个附件。",400);
            if(v.FileTaskActive||v.ExitRequested)
                return fail("有文件任务进行中，不可修改关联。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)
                    return fail("有文件任务进行中，不可修改关联。",409);
                if(!NativeFileStore.FolderActive(v.Db,workspace,input.TargetFolderId))
                    return Results.NotFound();
                // FileStore.Accessible opens its own command, so validate it
                // before starting the explicit transaction on this connection.
                foreach(var item in items)
                    if(!NativeFileStore.Accessible(v.Db,workspace,item.FileId))
                        return Results.NotFound();
                using var tx=v.Db.BeginTransaction();
                var sources=new List<(long FileId,long LinkId,string? Display,string? Category)>();
                foreach(var item in items)
                {
                    using var q=v.Db.CreateCommand();
                    q.Transaction=tx;
                    q.CommandText="""
                        SELECT l.folder_id,l.display_name,l.material_category
                        FROM folder_file_links l JOIN folders f ON f.id=l.folder_id
                          AND f.workspace=l.workspace AND f.deleted=0
                        WHERE l.id=$link AND l.file_id=$file
                          AND l.workspace=$ws AND l.deleted=0;
                        """;
                    q.Parameters.AddWithValue("$link",item.LinkId);
                    q.Parameters.AddWithValue("$file",item.FileId);
                    q.Parameters.AddWithValue("$ws",workspace);
                    long origin;string? display;string? category;
                    using(var rd=q.ExecuteReader())
                    {
                        if(!rd.Read())return Results.NotFound();
                        origin=rd.GetInt64(0);
                        display=rd.IsDBNull(1)?null:rd.GetString(1);
                        category=rd.IsDBNull(2)?null:rd.GetString(2);
                    }
                    if(origin==input.TargetFolderId)
                        return fail("所选附件中有附件已经位于目标目录，本批次未执行。",409);
                    using var duplicate=v.Db.CreateCommand();
                    duplicate.Transaction=tx;
                    duplicate.CommandText="""
                        SELECT 1 FROM folder_file_links WHERE workspace=$ws
                          AND folder_id=$target AND file_id=$file AND deleted=0 LIMIT 1;
                        """;
                    duplicate.Parameters.AddWithValue("$ws",workspace);
                    duplicate.Parameters.AddWithValue("$target",input.TargetFolderId);
                    duplicate.Parameters.AddWithValue("$file",item.FileId);
                    if(duplicate.ExecuteScalar()!=null)
                        return fail("目标目录已关联其中一个原件，本批次未执行。",409);
                    sources.Add((item.FileId,item.LinkId,display,category));
                }
                // The validation above performs no writes; below, all writes
                // remain covered by the same transaction until Commit().
                try
                {
                    foreach(var item in sources)
                    {
                        using var insert=v.Db.CreateCommand();
                        insert.Transaction=tx;
                        insert.CommandText="""
                            INSERT INTO folder_file_links(workspace,folder_id,file_id,
                                display_name,material_category,position)
                            SELECT $ws,$target,$file,$display,$category,
                                COALESCE(MAX(position),-1)+1 FROM folder_file_links
                            WHERE workspace=$ws AND folder_id=$target AND deleted=0
                            HAVING NOT EXISTS(SELECT 1 FROM folder_file_links
                                WHERE workspace=$ws AND folder_id=$target
                                  AND file_id=$file AND deleted=0);
                            SELECT changes();
                            """;
                        insert.Parameters.AddWithValue("$ws",workspace);
                        insert.Parameters.AddWithValue("$target",input.TargetFolderId);
                        insert.Parameters.AddWithValue("$file",item.FileId);
                        insert.Parameters.AddWithValue("$display",(object?)item.Display??DBNull.Value);
                        insert.Parameters.AddWithValue("$category",(object?)item.Category??DBNull.Value);
                        if(Convert.ToInt64(insert.ExecuteScalar())!=1)
                            return fail("目标关联冲突，本批次已回滚。",409);
                        if(!input.Move)continue;
                        using var detach=v.Db.CreateCommand();
                        detach.Transaction=tx;
                        detach.CommandText="""
                            UPDATE folder_file_links SET deleted=1 WHERE id=$link
                              AND workspace=$ws AND file_id=$file AND deleted=0;
                            """;
                        detach.Parameters.AddWithValue("$link",item.LinkId);
                        detach.Parameters.AddWithValue("$ws",workspace);
                        detach.Parameters.AddWithValue("$file",item.FileId);
                        if(detach.ExecuteNonQuery()!=1)
                            return fail("来源关联发生变化，本批次已回滚。",409);
                    }
                    tx.Commit();
                    return Results.Json(new{ok=true,count=sources.Count,
                        targetFolderId=input.TargetFolderId,moved=input.Move});
                }
                catch(SqliteException ex)
                {
                    return fail("批量关联约束失败，本批次已回滚："+ex.SqliteErrorCode,409);
                }
            }
            finally{v.Gate.Release();}
        });
    }
}
