using Microsoft.Data.Sqlite;

// N2-04: one logical FileId shared across active folders in the same
// workspace. Copy or move the association atomically, preserving every version.
record NativeFileAssociateInput(long LinkId,long TargetFolderId,bool Move=false);
static class NativeFileAssociateEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/files/{workspace}/{fileId:long}/associate",async(
            HttpContext ctx,Vault v,string workspace,long fileId,
            NativeFileAssociateInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace)||fileId<=0||
               input.LinkId<=0||input.TargetFolderId<=0)
                return fail("工作区或文件关联身份无效。",400);
            if(v.FileTaskActive||v.ExitRequested)
                return fail("文件任务进行中，不可修改关联。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)
                    return fail("文件任务进行中，不可修改关联。",409);
                if(!NativeFileStore.Accessible(v.Db,workspace,fileId) ||
                   !NativeFileStore.FolderActive(v.Db,workspace,input.TargetFolderId))
                    return Results.NotFound();
                using var tx=v.Db.BeginTransaction();
                using var source=v.Db.CreateCommand();
                source.Transaction=tx;
                source.CommandText="""
                    SELECT l.folder_id,l.display_name,l.material_category
                    FROM folder_file_links l JOIN folders f ON f.id=l.folder_id
                      AND f.workspace=l.workspace AND f.deleted=0
                    WHERE l.id=$link AND l.file_id=$file
                      AND l.workspace=$w AND l.deleted=0;
                    """;
                source.Parameters.AddWithValue("$link",input.LinkId);
                source.Parameters.AddWithValue("$file",fileId);
                source.Parameters.AddWithValue("$w",workspace);
                long origin;string? display;string? category;
                using(var rd=source.ExecuteReader())
                {
                    if(!rd.Read())return Results.NotFound();
                    origin=rd.GetInt64(0);
                    display=rd.IsDBNull(1)?null:rd.GetString(1);
                    category=rd.IsDBNull(2)?null:rd.GetString(2);
                }
                if(origin==input.TargetFolderId)
                    return fail("已处于所选文件夹，无需重复关联。",409);
                using var insert=v.Db.CreateCommand();
                insert.Transaction=tx;
                insert.CommandText="""
                    INSERT INTO folder_file_links(workspace,folder_id,file_id,
                        display_name,material_category,position)
                    SELECT $w,$target,$file,$display,$category,
                        COALESCE(MAX(position),-1)+1 FROM folder_file_links
                    WHERE workspace=$w AND folder_id=$target AND deleted=0
                    HAVING NOT EXISTS(
                        SELECT 1 FROM folder_file_links
                        WHERE workspace=$w AND folder_id=$target AND file_id=$file
                          AND deleted=0);
                    SELECT changes();
                    """;
                insert.Parameters.AddWithValue("$w",workspace);
                insert.Parameters.AddWithValue("$target",input.TargetFolderId);
                insert.Parameters.AddWithValue("$file",fileId);
                insert.Parameters.AddWithValue("$display",(object?)display??DBNull.Value);
                insert.Parameters.AddWithValue("$category",(object?)category??DBNull.Value);
                try
                {
                    if(Convert.ToInt64(insert.ExecuteScalar())!=1)
                        return fail("此原件已关联目标文件夹。",409);
                    if(input.Move)
                    {
                        using var detach=v.Db.CreateCommand();
                        detach.Transaction=tx;
                        detach.CommandText="""
                            UPDATE folder_file_links SET deleted=1 WHERE id=$link
                              AND workspace=$w AND file_id=$file AND deleted=0;
                            """;
                        detach.Parameters.AddWithValue("$link",input.LinkId);
                        detach.Parameters.AddWithValue("$w",workspace);
                        detach.Parameters.AddWithValue("$file",fileId);
                        if(detach.ExecuteNonQuery()!=1)
                            return fail("来源位置已改变，整个移动已回滚。",409);
                    }
                    tx.Commit();
                    return Results.Json(new{ok=true,fileId,sourceLinkId=input.LinkId,
                        targetFolderId=input.TargetFolderId,moved=input.Move});
                }
                catch(SqliteException ex)
                {
                    return fail("关联约束失败："+ex.SqliteErrorCode,409);
                }
            }
            finally{v.Gate.Release();}
        });
    }
}
