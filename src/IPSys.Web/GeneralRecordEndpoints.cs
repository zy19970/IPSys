using System.Security.Cryptography;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;

// R0-03: original general-record and legacy attachment endpoints, keeping registration order.
static class GeneralRecordEndpoints
{
    public static void MapList(WebApplication app,Func<string,int,IResult> fail)
    {
        IResult Fail(string message,int status=400)=>fail(message,status);
        app.MapGet("/api/records/{workspace}", async (HttpContext ctx, Vault v, string workspace) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            await v.Gate.WaitAsync();
            try
            {
                // The token may have expired while this request waited for the database gate.
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                var rows = new List<RecordView>();
                using var cmd = v.Db.CreateCommand();
                cmd.CommandText = """
                    SELECT r.id,r.title,a.id,a.filename,a.size,a.sha256,a.version,a.group_id
                    FROM records r LEFT JOIN attachments a
                    ON r.id=a.record_id AND a.state='ready' AND a.deleted=0
                    WHERE r.workspace=$w AND r.deleted=0 ORDER BY r.id DESC,a.id;
                    """;
                cmd.Parameters.AddWithValue("$w", workspace);
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    long id = reader.GetInt64(0);
                    if (rows.Count == 0 || rows[^1].Id != id)
                        rows.Add(new RecordView(id, reader.GetString(1), new()));
                    if (!reader.IsDBNull(2))
                        rows[^1].Files.Add(new FileView(reader.GetInt64(2), reader.GetString(3),
                            reader.GetInt64(4), reader.GetString(5),reader.GetInt32(6),reader.GetString(7)));
                }
                return Results.Json(rows);
            }
            catch (Exception e) { return Fail(e.Message, 500); }
            finally { v.Gate.Release(); }
        });
    }

    public static void MapChanges(WebApplication app,Func<string,int,IResult> fail)
    {
        IResult Fail(string message,int status=400)=>fail(message,status);
        app.MapPost("/api/records/{workspace}", async (HttpContext ctx, Vault v, string workspace, TitleInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if (string.IsNullOrWhiteSpace(input.Title)) return Fail("名称不能为空。");
            if (input.Title.Length > 300) return Fail("名称不能超过 300 字。");
            if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务执行中，暂不能修改资料。", 409);
            await v.Gate.WaitAsync();
            try
            {
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested) return Fail("文件任务执行中，暂不能修改资料。", 409);
                using var cmd = v.Db.CreateCommand();
                cmd.CommandText = "INSERT INTO records(workspace,title) VALUES($w,$n); SELECT last_insert_rowid();";
                cmd.Parameters.AddWithValue("$w", workspace);
                cmd.Parameters.AddWithValue("$n", input.Title.Trim());
                long id = (long)cmd.ExecuteScalar()!;
                return Results.Json(new { id });
            }
            catch (Exception e) { return Fail(e.Message, 500); }
            finally { v.Gate.Release(); }
        });
        
        // Update only a record name in the existing encrypted prototype schema.
        // Business modules will get their own validated API after M2 schema design.
        app.MapPut("/api/records/{workspace}/{id:long}", async (
            HttpContext ctx, Vault v, string workspace, long id, TitleInput input) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            if (string.IsNullOrWhiteSpace(input.Title)) return Fail("名称不能为空。");
            if (input.Title.Length > 300) return Fail("名称不能超过 300 字。");
            if (v.FileTaskActive || v.ExitRequested)
                return Fail("文件任务执行中或程序正在退出，暂不能修改资料。", 409);
            await v.Gate.WaitAsync();
            try
            {
                // Reauthorize after waiting, and scope the SQL UPDATE to the workspace.
                if (!v.Allowed(ctx)) return Results.Unauthorized();
                if (v.FileTaskActive || v.ExitRequested)
                    return Fail("文件任务执行中或程序正在退出，暂不能修改资料。", 409);
                using var cmd = v.Db.CreateCommand();
                cmd.CommandText = "UPDATE records SET title=$title WHERE id=$id AND workspace=$workspace AND deleted=0;";
                cmd.Parameters.AddWithValue("$title", input.Title.Trim());
                cmd.Parameters.AddWithValue("$id", id);
                cmd.Parameters.AddWithValue("$workspace", workspace);
                if (cmd.ExecuteNonQuery() != 1) return Results.NotFound();
                return Results.Ok(new { ok = true });
            }
            catch (Exception e) { return Fail(e.Message, 500); }
            finally { v.Gate.Release(); }
        });
        
        // Legacy general records share the same authenticated soft-delete and trash policy.
        app.MapDelete("/api/records/{workspace}/{id:long}",async(
            HttpContext ctx,Vault v,string workspace,long id)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务执行中，不可删除。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务执行中，不可删除。",409);
                using var cmd=v.Db.CreateCommand();
                cmd.CommandText="UPDATE records SET deleted=1 WHERE id=$id AND workspace=$w AND deleted=0;";
                cmd.Parameters.AddWithValue("$id",id);
                cmd.Parameters.AddWithValue("$w",workspace);
                return cmd.ExecuteNonQuery()==1?Results.Ok(new{ok=true}):Results.NotFound();
            }
            finally{v.Gate.Release();}
        });
        
        app.MapPost("/api/records/{workspace}/{id:long}/files", async (HttpContext ctx, Vault v, string workspace, long id) =>
        {
            if (!v.Allowed(ctx)) return Results.Unauthorized();
            if (!Vault.WorkspaceValid(workspace)) return Fail("无效工作区。");
            long? length = ctx.Request.ContentLength;
            const long limit = 64L * 1024 * 1024; // Intentionally small for first web prototype.
            if (length is null or < 0 or > limit) return Fail("测试版仅支持已知大小、最多 64 MiB 的单文件。", 413);
            string name = Uri.UnescapeDataString(ctx.Request.Headers["X-File-Name"].ToString());
            if(BusinessFileStore.CheckName(name) is string badName)return Fail(badName);
            string mode=ctx.Request.Headers["X-Upload-Mode"].ToString();
            if(mode=="")mode="update";
            string requestedGroup=ctx.Request.Headers["X-File-Group"].ToString();
            if (!v.TryBeginFileTask(ctx, out var taskCancellation))
                return Fail("当前有文件任务正在执行，或程序正在安全退出。", 409);
            try
            {
                using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted, taskCancellation);
                if (!await v.Gate.WaitAsync(0))
                    return Fail("另一项数据库操作正在执行，请稍后重试。", 409);
                try
                {
                    if (!v.Allowed(ctx)) return Results.Unauthorized();
                using (var exists = v.Db.CreateCommand())
                {
                    exists.CommandText = "SELECT count(*) FROM records WHERE id=$id AND workspace=$w AND deleted=0;";
                    exists.Parameters.AddWithValue("$id", id);
                    exists.Parameters.AddWithValue("$w", workspace);
                    if ((long)exists.ExecuteScalar()! != 1L) return Results.NotFound();
                }
                long reserve = Math.Max(128L * 1024 * 1024, length.Value / 3);
                long free = new DriveInfo(Path.GetPathRoot(v.Path)!).AvailableFreeSpace;
                if (free < length + reserve) return Fail("数据库所在磁盘剩余空间不足。", 507);
                var choice=GeneralStore.ChooseVersion(v.Db,workspace,id,name,mode,requestedGroup);
                long fileId;
                using (var insert = v.Db.CreateCommand())
                {
                    insert.CommandText = """
                        INSERT INTO attachments(record_id,filename,expected_size,state,version,group_id)
                        VALUES($r,$n,$size,'writing',$version,$group); SELECT last_insert_rowid();
                        """;
                    insert.Parameters.AddWithValue("$r", id);
                    insert.Parameters.AddWithValue("$n", name);
                    insert.Parameters.AddWithValue("$size", length.Value);
                    insert.Parameters.AddWithValue("$version",choice.Version);
                    insert.Parameters.AddWithValue("$group",choice.Group);
                    fileId = (long)insert.ExecuteScalar()!;
                }
                try
                {
                    byte[] buffer = new byte[1024 * 1024];
                    long size = 0;
                    int part = 0;
                    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                    SqliteTransaction tx = v.Db.BeginTransaction();
                    try
                    {
                        int read;
                        while ((read = await ctx.Request.Body.ReadAsync(buffer, linkedCancellation.Token)) > 0)
                        {
                            using var cmd = v.Db.CreateCommand();
                            cmd.Transaction = tx;
                            cmd.CommandText = "INSERT INTO chunks(attachment_id,idx,bytes) VALUES($id,$i,$b);";
                            cmd.Parameters.AddWithValue("$id", fileId);
                            cmd.Parameters.AddWithValue("$i", part);
                            cmd.Parameters.Add("$b", SqliteType.Blob).Value = buffer.AsSpan(0, read).ToArray();
                            cmd.ExecuteNonQuery();
                            hash.AppendData(buffer, 0, read);
                            size += read;
                            if (size > limit || size > length.Value) throw new IOException("文件长度不符合声明。");
                            if (++part % 8 == 0)
                            {
                                tx.Commit(); tx.Dispose();
                                tx = v.Db.BeginTransaction();
                            }
                        }
                        tx.Commit();
                    }
                    finally { tx.Dispose(); }
                    linkedCancellation.Token.ThrowIfCancellationRequested();
                    if (size != length.Value) throw new IOException("上传不完整。");
                    string digest = Convert.ToHexString(hash.GetHashAndReset());
                    using var update = v.Db.CreateCommand();
                    update.CommandText = "UPDATE attachments SET state='ready',size=$s,sha256=$h WHERE id=$id;";
                    update.Parameters.AddWithValue("$s", size);
                    update.Parameters.AddWithValue("$h", digest);
                    update.Parameters.AddWithValue("$id", fileId);
                    update.ExecuteNonQuery();
                    return Results.Json(new { id = fileId, size, sha256 = digest,version=choice.Version,groupId=choice.Group });
                }
                catch
                {
                    // Best effort cleanup, with 'writing' non-exportable even on abrupt interruption.
                    try
                    {
                        using var tx = v.Db.BeginTransaction();
                        using var cmd = v.Db.CreateCommand();
                        cmd.Transaction = tx;
                        cmd.CommandText = """
                            DELETE FROM chunks WHERE attachment_id=$id;
                            DELETE FROM attachments WHERE id=$id AND state='writing';
                            """;
                        cmd.Parameters.AddWithValue("$id", fileId);
                        cmd.ExecuteNonQuery();
                        tx.Commit();
                    }
                    catch { /* interrupted storage: retain writing state for later inspection */ }
                    throw;
                }
            }
                catch (Exception e) { return Fail("上传失败：" + e.Message); }
                finally { v.Gate.Release(); }
            }
            finally { v.CompleteFileTask(); }
        });
        
        // Keep authentication, file lookup and the complete download under one gate.
        // Returning Results.Stream before acquiring the stream's gate allowed a concurrent
        // /api/lock + /api/open to swap databases between authorization and the first byte.
        app.MapGet("/api/files/{workspace}/{id:long}", async (HttpContext ctx, Vault v, string workspace, long id) =>
        {
            if (!v.Allowed(ctx)) { ctx.Response.StatusCode = 401; return; }
            if (!Vault.WorkspaceValid(workspace))
            {
                ctx.Response.StatusCode = 400;
                await ctx.Response.WriteAsJsonAsync(new { error = "无效工作区。" });
                return;
            }
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if (!v.Allowed(ctx)) { ctx.Response.StatusCode = 401; return; }
                string name;
                using (var lookup = v.Db.CreateCommand())
                {
                    lookup.CommandText = """
                        SELECT a.filename FROM attachments a JOIN records r ON a.record_id=r.id
                        WHERE a.id=$id AND a.state='ready' AND a.deleted=0 AND r.deleted=0 AND r.workspace=$w;
                        """;
                    lookup.Parameters.AddWithValue("$id", id);
                    lookup.Parameters.AddWithValue("$w", workspace);
                    name = lookup.ExecuteScalar() as string ?? "";
                }
                if (name.Length == 0) { ctx.Response.StatusCode = 404; return; }
        
                ctx.Response.ContentType = "application/octet-stream";
                ctx.Response.Headers.ContentDisposition =
                    "attachment; filename*=UTF-8''" + Uri.EscapeDataString(name);
                using var cmd = v.Db.CreateCommand();
                cmd.CommandText = """
                    SELECT c.bytes FROM chunks c
                    JOIN attachments a ON a.id=c.attachment_id
                    JOIN records r ON a.record_id=r.id
                    WHERE a.id=$id AND a.state='ready' AND a.deleted=0 AND r.deleted=0 AND r.workspace=$w ORDER BY c.idx;
                    """;
                cmd.Parameters.AddWithValue("$id", id);
                cmd.Parameters.AddWithValue("$w", workspace);
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    byte[] bytes = (byte[])reader.GetValue(0);
                    await ctx.Response.Body.WriteAsync(bytes, ctx.RequestAborted);
                }
            }
            finally { v.Gate.Release(); }
        });
        
        app.MapDelete("/api/files/{workspace}/{id:long}",async(
            HttpContext ctx,Vault v,string workspace,long id)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务执行中，不可删除原件。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务执行中，不可删除原件。",409);
                using var cmd=v.Db.CreateCommand();
                cmd.CommandText="""
                    UPDATE attachments SET deleted=1 WHERE id=$id AND deleted=0
                    AND state='ready' AND EXISTS(SELECT 1 FROM records r
                      WHERE r.id=record_id AND r.workspace=$w AND r.deleted=0);
                    """;
                cmd.Parameters.AddWithValue("$id",id);
                cmd.Parameters.AddWithValue("$w",workspace);
                return cmd.ExecuteNonQuery()==1?Results.Ok(new{ok=true}):Results.NotFound();
            }
            finally{v.Gate.Release();}
        });
    }
}
