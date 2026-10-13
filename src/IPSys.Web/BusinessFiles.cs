using System.Security.Cryptography;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Data.Sqlite;

record BusinessAssociateInput(string TargetKind,long TargetOwnerId,string TargetSection,bool Move);
record BusinessFileView(long Id,string Kind,long OwnerId,string Section,
    string Name,string Category,int Version,long Size,string Sha256);

static class BusinessFileStore
{
    public const long MaxFileLength=64L*1024*1024;
    private static readonly string[] IpCategories=["申请材料","通知文件","证书文件","其他材料"];
    public static bool ScopeValid(string workspace,string kind,string section)
    {
        if(!Vault.WorkspaceValid(workspace))return false;
        return kind switch
        {
            "project" or "ip" or "contract" => section=="",
            "archive" => ArchiveStore.Module(workspace,section)!=null,
            _ => false
        };
    }
    public static bool OwnerExists(SqliteConnection db,string workspace,string kind,long id,string section)
    {
        if(!ScopeValid(workspace,kind,section)||id<=0)return false;
        using var cmd=db.CreateCommand();
        cmd.Parameters.AddWithValue("$id",id);
        cmd.Parameters.AddWithValue("$w",workspace);
        switch(kind)
        {
            case "project":
                cmd.CommandText="SELECT count(*) FROM business_projects WHERE id=$id AND workspace=$w AND deleted=0;";
                break;
            case "ip":
                cmd.CommandText="SELECT count(*) FROM business_ips WHERE id=$id AND workspace=$w AND deleted=0;";
                break;
            case "contract":
                cmd.CommandText="""
                    SELECT count(*) FROM business_contracts c
                    JOIN business_projects p ON p.id=c.project_id AND p.workspace=c.workspace
                    WHERE c.id=$id AND c.workspace=$w AND c.deleted=0 AND p.deleted=0;
                    """;
                break;
            case "archive":
                cmd.CommandText="""
                    SELECT count(*) FROM business_archives
                    WHERE id=$id AND workspace=$w AND section=$section
                        AND module=$module AND deleted=0;
                    """;
                cmd.Parameters.AddWithValue("$section",section);
                cmd.Parameters.AddWithValue("$module",ArchiveStore.Module(workspace,section)!);
                break;
            default:return false;
        }
        return (long)cmd.ExecuteScalar()! == 1;
    }
    public static string? CheckName(string filename)
    {
        if(string.IsNullOrWhiteSpace(filename)||filename!=Path.GetFileName(filename)||
            filename is "." or ".."||filename.Length>240||
            filename.Contains('/')||filename.Contains('\\')||
            filename.Any(char.IsControl))return "附件文件名无效。";
        return null;
    }
    public static string? CheckCategory(string kind,string category)
    {
        if(kind=="ip")
            return IpCategories.Contains(category)?null:"知识产权附件只允许四种固定材料类别。";
        return category==""?null:"非知识产权模块不允许设置附件材料类别。";
    }
    public static void Ensure(SqliteConnection db)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            CREATE TABLE IF NOT EXISTS business_file_objects(
              id INTEGER PRIMARY KEY,expected_size INTEGER NOT NULL,size INTEGER,sha256 TEXT,
              state TEXT NOT NULL CHECK(state IN ('writing','ready')));
            CREATE TABLE IF NOT EXISTS business_file_chunks(
              object_id INTEGER NOT NULL REFERENCES business_file_objects(id),
              idx INTEGER NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(object_id,idx));
            CREATE TABLE IF NOT EXISTS business_file_links(
              id INTEGER PRIMARY KEY,
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              kind TEXT NOT NULL CHECK(kind IN ('project','ip','contract','archive')),
              owner_id INTEGER NOT NULL,
              section TEXT NOT NULL DEFAULT '',
              object_id INTEGER NOT NULL REFERENCES business_file_objects(id),
              filename TEXT NOT NULL,
              category TEXT NOT NULL DEFAULT '',
              version INTEGER NOT NULL CHECK(version>0),
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)));
            CREATE INDEX IF NOT EXISTS idx_business_file_owner
              ON business_file_links(workspace,kind,owner_id,section,deleted);
            """;
        cmd.ExecuteNonQuery();
    }
    public static List<BusinessFileView> List(SqliteConnection db,string workspace)
    {
        var list=new List<BusinessFileView>();
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                SELECT l.id,l.kind,l.owner_id,l.section,l.filename,l.category,
                    l.version,o.size,o.sha256
                FROM business_file_links l JOIN business_file_objects o ON o.id=l.object_id
                WHERE l.workspace=$w AND l.deleted=0 AND o.state='ready'
                ORDER BY l.id DESC;
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            using var reader=cmd.ExecuteReader();
            while(reader.Read())
                list.Add(new BusinessFileView(reader.GetInt64(0),reader.GetString(1),
                    reader.GetInt64(2),reader.GetString(3),reader.GetString(4),
                    reader.GetString(5),reader.GetInt32(6),reader.GetInt64(7),reader.GetString(8)));
        }
        return list.Where(r=>OwnerExists(db,workspace,r.Kind,r.OwnerId,r.Section)).ToList();
    }
    public static (long ObjectId,long LinkId,int Version) Start(SqliteConnection db,
        string workspace,string kind,long ownerId,string section,string name,string category,long length)
    {
        // New file remains invisible until its object reaches ready state.
        using var insert=db.CreateCommand();
        insert.CommandText="""
            INSERT INTO business_file_objects(expected_size,state) VALUES($size,'writing');
            SELECT last_insert_rowid();
            """;
        insert.Parameters.AddWithValue("$size",length);
        long objectId=(long)insert.ExecuteScalar()!;
        return (objectId,0,0);
    }
    public static (long LinkId,int Version) Finish(SqliteConnection db,long objectId,
        string workspace,string kind,long ownerId,string section,string name,string category,
        long size,string sha256)
    {
        using var tx=db.BeginTransaction();
        using(var update=db.CreateCommand())
        {
            update.Transaction=tx;
            update.CommandText="""
                UPDATE business_file_objects SET state='ready',size=$size,sha256=$hash
                WHERE id=$id AND state='writing';
                """;
            update.Parameters.AddWithValue("$id",objectId);
            update.Parameters.AddWithValue("$size",size);
            update.Parameters.AddWithValue("$hash",sha256);
            if(update.ExecuteNonQuery()!=1)throw new IOException("附件写入状态失效。");
        }
        int version;
        using(var lookup=db.CreateCommand())
        {
            lookup.Transaction=tx;
            lookup.CommandText="""
                SELECT COALESCE(MAX(version),0)+1 FROM business_file_links
                WHERE workspace=$w AND kind=$kind AND owner_id=$owner
                    AND section=$section AND filename=$name AND category=$category;
                """;
            lookup.Parameters.AddWithValue("$w",workspace);
            lookup.Parameters.AddWithValue("$kind",kind);
            lookup.Parameters.AddWithValue("$owner",ownerId);
            lookup.Parameters.AddWithValue("$section",section);
            lookup.Parameters.AddWithValue("$name",name);
            lookup.Parameters.AddWithValue("$category",category);
            version=Convert.ToInt32(lookup.ExecuteScalar());
        }
        long linkId;
        using(var link=db.CreateCommand())
        {
            link.Transaction=tx;
            link.CommandText="""
                INSERT INTO business_file_links(workspace,kind,owner_id,section,
                    object_id,filename,category,version)
                VALUES($w,$kind,$owner,$section,$object,$name,$category,$version);
                SELECT last_insert_rowid();
                """;
            link.Parameters.AddWithValue("$w",workspace);
            link.Parameters.AddWithValue("$kind",kind);
            link.Parameters.AddWithValue("$owner",ownerId);
            link.Parameters.AddWithValue("$section",section);
            link.Parameters.AddWithValue("$object",objectId);
            link.Parameters.AddWithValue("$name",name);
            link.Parameters.AddWithValue("$category",category);
            link.Parameters.AddWithValue("$version",version);
            linkId=(long)link.ExecuteScalar()!;
        }
        tx.Commit();
        return (linkId,version);
    }
    public static void CleanupWriting(SqliteConnection db,long objectId)
    {
        using var tx=db.BeginTransaction();
        using var cmd=db.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="""
            DELETE FROM business_file_chunks WHERE object_id=$id;
            DELETE FROM business_file_objects WHERE id=$id AND state='writing';
            """;
        cmd.Parameters.AddWithValue("$id",objectId);
        cmd.ExecuteNonQuery();
        tx.Commit();
    }
    public static void CloneLinks(SqliteConnection db,SqliteTransaction tx,
        string fromWorkspace,string fromKind,long fromId,string fromSection,
        string targetWorkspace,string targetKind,long targetId,string targetSection)
    {
        if(!ScopeValid(fromWorkspace,fromKind,fromSection)||
           !ScopeValid(targetWorkspace,targetKind,targetSection)||
           fromKind!=targetKind)throw new IOException("不兼容的附件复制范围。");
        if(fromWorkspace==targetWorkspace)
        {
            // Zero-copy intra-workspace sharing.
            using var cmd=db.CreateCommand();cmd.Transaction=tx;
            cmd.CommandText="""
                INSERT INTO business_file_links(workspace,kind,owner_id,section,
                    object_id,filename,category,version,deleted)
                SELECT $toW,$toKind,$toId,$toSection,object_id,filename,category,version,0
                FROM business_file_links
                WHERE workspace=$fromW AND kind=$fromKind AND owner_id=$fromId
                    AND section=$fromSection AND deleted=0;
                """;
            cmd.Parameters.AddWithValue("$toW",targetWorkspace);
            cmd.Parameters.AddWithValue("$toKind",targetKind);
            cmd.Parameters.AddWithValue("$toId",targetId);
            cmd.Parameters.AddWithValue("$toSection",targetSection);
            cmd.Parameters.AddWithValue("$fromW",fromWorkspace);
            cmd.Parameters.AddWithValue("$fromKind",fromKind);
            cmd.Parameters.AddWithValue("$fromId",fromId);
            cmd.Parameters.AddWithValue("$fromSection",fromSection);
            cmd.ExecuteNonQuery();
            return;
        }
        // Q61: cross-workspace links must not reference the same physical object.
        // Duplicate each unique object once per clone transaction; new links refer
        // only to independent copies of its complete encrypted-db byte stream.
        var links=new List<(long ObjectId,string Name,string Category,int Version)>();
        using(var query=db.CreateCommand())
        {
            query.Transaction=tx;
            query.CommandText="""
                SELECT l.object_id,l.filename,l.category,l.version
                FROM business_file_links l JOIN business_file_objects o ON o.id=l.object_id
                WHERE l.workspace=$w AND l.kind=$kind AND l.owner_id=$id
                    AND l.section=$section AND l.deleted=0 AND o.state='ready'
                ORDER BY l.id;
                """;
            query.Parameters.AddWithValue("$w",fromWorkspace);
            query.Parameters.AddWithValue("$kind",fromKind);
            query.Parameters.AddWithValue("$id",fromId);
            query.Parameters.AddWithValue("$section",fromSection);
            using var reader=query.ExecuteReader();
            while(reader.Read())links.Add((reader.GetInt64(0),reader.GetString(1),
                reader.GetString(2),reader.GetInt32(3)));
        }
        var copied=new Dictionary<long,long>();
        foreach(var link in links)
        {
            if(!copied.TryGetValue(link.ObjectId,out long newObject))
            {
                using(var obj=db.CreateCommand())
                {
                    obj.Transaction=tx;
                    obj.CommandText="""
                        INSERT INTO business_file_objects(expected_size,size,sha256,state)
                        SELECT expected_size,size,sha256,'ready' FROM business_file_objects
                        WHERE id=$old AND state='ready';
                        SELECT last_insert_rowid();
                        """;
                    obj.Parameters.AddWithValue("$old",link.ObjectId);
                    newObject=(long)obj.ExecuteScalar()!;
                }
                using(var bytes=db.CreateCommand())
                {
                    bytes.Transaction=tx;
                    bytes.CommandText="""
                        INSERT INTO business_file_chunks(object_id,idx,bytes)
                        SELECT $new,idx,bytes FROM business_file_chunks WHERE object_id=$old;
                        """;
                    bytes.Parameters.AddWithValue("$new",newObject);
                    bytes.Parameters.AddWithValue("$old",link.ObjectId);
                    bytes.ExecuteNonQuery();
                }
                copied.Add(link.ObjectId,newObject);
            }
            using var refCmd=db.CreateCommand();refCmd.Transaction=tx;
            refCmd.CommandText="""
                INSERT INTO business_file_links(workspace,kind,owner_id,section,object_id,
                    filename,category,version)
                VALUES($w,$kind,$owner,$section,$object,$name,$category,$version);
                """;
            refCmd.Parameters.AddWithValue("$w",targetWorkspace);
            refCmd.Parameters.AddWithValue("$kind",targetKind);
            refCmd.Parameters.AddWithValue("$owner",targetId);
            refCmd.Parameters.AddWithValue("$section",targetSection);
            refCmd.Parameters.AddWithValue("$object",newObject);
            refCmd.Parameters.AddWithValue("$name",link.Name);
            refCmd.Parameters.AddWithValue("$category",link.Category);
            refCmd.Parameters.AddWithValue("$version",link.Version);
            refCmd.ExecuteNonQuery();
        }
    }
    public static bool OwnerForDeletedLink(SqliteConnection db,string workspace,long linkId)
    {
        string kind,section;long ownerId;
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                SELECT kind,owner_id,section FROM business_file_links
                WHERE id=$id AND workspace=$w AND deleted=1;
                """;
            cmd.Parameters.AddWithValue("$id",linkId);
            cmd.Parameters.AddWithValue("$w",workspace);
            using var reader=cmd.ExecuteReader();
            if(!reader.Read())return false;
            kind=reader.GetString(0);ownerId=reader.GetInt64(1);section=reader.GetString(2);
        }
        return OwnerExists(db,workspace,kind,ownerId,section);
    }

    // Q112: copy/move a logical set of active versions into another record in
    // the SAME workspace. No data bytes are copied; each target link keeps the
    // version's object ID. Other references stay intact when moving.
    public static bool Associate(SqliteConnection db,string workspace,long sourceLinkId,
        string kind,long targetOwner,string section,bool move)
    {
        if(!ScopeValid(workspace,kind,section)||
            !OwnerExists(db,workspace,kind,targetOwner,section))return false;
        string fromKind,fromSection,name,material;long fromOwner;
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                SELECT kind,owner_id,section,filename,category
                FROM business_file_links WHERE id=$id AND workspace=$w AND deleted=0;
                """;
            cmd.Parameters.AddWithValue("$id",sourceLinkId);
            cmd.Parameters.AddWithValue("$w",workspace);
            using var r=cmd.ExecuteReader();
            if(!r.Read())return false;
            fromKind=r.GetString(0);fromOwner=r.GetInt64(1);fromSection=r.GetString(2);
            name=r.GetString(3);material=r.GetString(4);
        }
        if(!OwnerExists(db,workspace,fromKind,fromOwner,fromSection))return false;
        if(kind==fromKind&&targetOwner==fromOwner&&section==fromSection)return false;
        string destCategory=kind=="ip"?
            (IpMaterialAllowed(material)?material:"其他材料"):"";
        var versions=new List<(long ObjectId,int Version)>();
        using(var cmd=db.CreateCommand())
        {
            cmd.CommandText="""
                SELECT l.object_id,l.version FROM business_file_links l
                JOIN business_file_objects o ON o.id=l.object_id
                WHERE l.workspace=$w AND l.kind=$kind AND l.owner_id=$owner
                  AND l.section=$section AND l.filename=$name AND l.category=$material
                  AND l.deleted=0 AND o.state='ready'
                ORDER BY l.version,l.id;
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$kind",fromKind);
            cmd.Parameters.AddWithValue("$owner",fromOwner);
            cmd.Parameters.AddWithValue("$section",fromSection);
            cmd.Parameters.AddWithValue("$name",name);
            cmd.Parameters.AddWithValue("$material",material);
            using var reader=cmd.ExecuteReader();
            while(reader.Read())versions.Add((reader.GetInt64(0),reader.GetInt32(1)));
        }
        if(versions.Count==0)return false;
        using var tx=db.BeginTransaction();
        // If target already refers to these exact objects, abort rather than
        // silently duplicating references or dropping the source on move.
        int next;
        using(var check=db.CreateCommand())
        {
            check.Transaction=tx;
            check.CommandText="""
                SELECT COALESCE(MAX(version),0) FROM business_file_links
                WHERE workspace=$w AND kind=$kind AND owner_id=$owner AND section=$section
                  AND filename=$name AND category=$material;
                """;
            check.Parameters.AddWithValue("$w",workspace);
            check.Parameters.AddWithValue("$kind",kind);
            check.Parameters.AddWithValue("$owner",targetOwner);
            check.Parameters.AddWithValue("$section",section);
            check.Parameters.AddWithValue("$name",name);
            check.Parameters.AddWithValue("$material",destCategory);
            next=Convert.ToInt32(check.ExecuteScalar());
        }
        foreach(var (objectId,_) in versions)
        {
            using var cmd=db.CreateCommand();
            cmd.Transaction=tx;
            cmd.CommandText="""
                INSERT INTO business_file_links(workspace,kind,owner_id,section,object_id,
                    filename,category,version,deleted)
                SELECT $w,$kind,$owner,$section,$object,$name,$material,$version,0
                WHERE NOT EXISTS(
                    SELECT 1 FROM business_file_links WHERE workspace=$w AND kind=$kind
                    AND owner_id=$owner AND section=$section AND object_id=$object AND deleted=0);
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$kind",kind);
            cmd.Parameters.AddWithValue("$owner",targetOwner);
            cmd.Parameters.AddWithValue("$section",section);
            cmd.Parameters.AddWithValue("$object",objectId);
            cmd.Parameters.AddWithValue("$name",name);
            cmd.Parameters.AddWithValue("$material",destCategory);
            cmd.Parameters.AddWithValue("$version",++next);
            if(cmd.ExecuteNonQuery()!=1)return false;
        }
        if(move)
        {
            using var cmd=db.CreateCommand();
            cmd.Transaction=tx;
            cmd.CommandText="""
                UPDATE business_file_links SET deleted=1
                WHERE workspace=$w AND kind=$kind AND owner_id=$owner AND section=$section
                    AND filename=$name AND category=$material AND deleted=0;
                """;
            cmd.Parameters.AddWithValue("$w",workspace);
            cmd.Parameters.AddWithValue("$kind",fromKind);
            cmd.Parameters.AddWithValue("$owner",fromOwner);
            cmd.Parameters.AddWithValue("$section",fromSection);
            cmd.Parameters.AddWithValue("$name",name);
            cmd.Parameters.AddWithValue("$material",material);
            if(cmd.ExecuteNonQuery()!=versions.Count)throw new IOException("源附件已变化，取消关联转移。");
        }
        tx.Commit();
        return true;
    }
    private static bool IpMaterialAllowed(string category) =>
        category is "申请材料" or "通知文件" or "证书文件" or "其他材料";

    public static bool RemoveLink(SqliteConnection db,string workspace,long linkId)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            UPDATE business_file_links SET deleted=1 WHERE id=$id AND workspace=$w
                AND deleted=0 AND EXISTS
                (SELECT 1 FROM business_file_objects WHERE id=object_id AND state='ready');
            """;
        cmd.Parameters.AddWithValue("$id",linkId);
        cmd.Parameters.AddWithValue("$w",workspace);
        return cmd.ExecuteNonQuery()==1;
    }
    public static (long ObjectId,string Name,string Kind,long OwnerId,string Section)?
        GetLink(SqliteConnection db,string workspace,long linkId)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            SELECT l.object_id,l.filename,l.kind,l.owner_id,l.section
            FROM business_file_links l JOIN business_file_objects o ON o.id=l.object_id
            WHERE l.id=$id AND l.workspace=$w AND l.deleted=0 AND o.state='ready';
            """;
        cmd.Parameters.AddWithValue("$id",linkId);
        cmd.Parameters.AddWithValue("$w",workspace);
        using var r=cmd.ExecuteReader();
        if(!r.Read())return null;
        return (r.GetInt64(0),r.GetString(1),r.GetString(2),r.GetInt64(3),r.GetString(4));
    }
}

static class BusinessFileEndpoints
{
    private static IResult Fail(string error,int status=400) =>
        Results.Json(new {error},statusCode:status);

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/business-files/{workspace}",async(HttpContext ctx,Vault v,string workspace)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                return Results.Json(BusinessFileStore.List(v.Db,workspace));
            }
            finally{v.Gate.Release();}
        });

        app.MapPost("/api/business-files/{workspace}/{kind}/{id:long}",async(
            HttpContext ctx,Vault v,string workspace,string kind,long id)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            string section=ctx.Request.Query["section"].ToString();
            if(!BusinessFileStore.ScopeValid(workspace,kind,section))
                return Fail("无效的附件业务范围。");
            long? length=ctx.Request.ContentLength;
            if(length is null or <0 or >BusinessFileStore.MaxFileLength)
                return Fail("本阶段附件要求已知长度且不能超过 64 MiB。",413);
            // Set the limit before reading the first byte, including Kestrel's default 30 MiB.
            var maxSize=ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if(maxSize is {IsReadOnly:false})maxSize.MaxRequestBodySize=BusinessFileStore.MaxFileLength;
            string filename;
            try{filename=Uri.UnescapeDataString(ctx.Request.Headers["X-File-Name"].ToString());}
            catch{return Fail("无效的附件文件名。");}
            string category;
            try{category=Uri.UnescapeDataString(ctx.Request.Headers["X-Material-Category"].ToString());}
            catch{return Fail("附件材料类别无效。");}
            if(kind=="ip"&&category=="")category="其他材料";
            var bad=BusinessFileStore.CheckName(filename)??BusinessFileStore.CheckCategory(kind,category);
            if(bad!=null)return Fail(bad);
            if(!v.TryBeginFileTask(ctx,out var cancel))
                return Fail("当前已有文件任务或程序正在退出。",409);
            try
            {
                using var linked=CancellationTokenSource.CreateLinkedTokenSource(
                    ctx.RequestAborted,cancel);
                if(!await v.Gate.WaitAsync(0))
                    return Fail("另一项数据库操作正在执行，请稍后重试。",409);
                try
                {
                    if(!v.Allowed(ctx))return Results.Unauthorized();
                    if(!BusinessFileStore.OwnerExists(v.Db,workspace,kind,id,section))
                        return Results.NotFound();
                    long reserve=Math.Max(128L*1024*1024,length.Value/3);
                    var free=new DriveInfo(Path.GetPathRoot(v.Path)!).AvailableFreeSpace;
                    if(free<length.Value+reserve)return Fail("数据库磁盘空间不足。",507);
                    long objectId=BusinessFileStore.Start(v.Db,workspace,kind,id,section,
                        filename,category,length.Value).ObjectId;
                    try
                    {
                        long total=0;
                        int idx=0;
                        var buffer=new byte[1024*1024];
                        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                        SqliteTransaction tx=v.Db.BeginTransaction();
                        try
                        {
                            int count;
                            while((count=await ctx.Request.Body.ReadAsync(buffer,linked.Token))>0)
                            {
                                total+=count;
                                if(total>length.Value||total>BusinessFileStore.MaxFileLength)
                                    throw new IOException("文件实际长度超过声明。");
                                using var cmd=v.Db.CreateCommand();
                                cmd.Transaction=tx;
                                cmd.CommandText="""
                                    INSERT INTO business_file_chunks(object_id,idx,bytes)
                                    VALUES($id,$idx,$bytes);
                                    """;
                                cmd.Parameters.AddWithValue("$id",objectId);
                                cmd.Parameters.AddWithValue("$idx",idx++);
                                cmd.Parameters.Add("$bytes",SqliteType.Blob).Value=buffer.AsSpan(0,count).ToArray();
                                cmd.ExecuteNonQuery();
                                hash.AppendData(buffer,0,count);
                                if(idx%8==0)
                                {
                                    tx.Commit();tx.Dispose();
                                    tx=v.Db.BeginTransaction();
                                }
                            }
                            tx.Commit();
                        }
                        finally{tx.Dispose();}
                        linked.Token.ThrowIfCancellationRequested();
                        if(total!=length.Value)throw new IOException("附件上传不完整。");
                        string digest=Convert.ToHexString(hash.GetHashAndReset());
                        var saved=BusinessFileStore.Finish(v.Db,objectId,workspace,kind,id,
                            section,filename,category,total,digest);
                        return Results.Json(new {
                            id=saved.LinkId,version=saved.Version,size=total,sha256=digest
                        });
                    }
                    catch
                    {
                        try{BusinessFileStore.CleanupWriting(v.Db,objectId);}catch{}
                        throw;
                    }
                }
                catch(Exception ex){return Fail("附件上传失败："+ex.Message);}
                finally{v.Gate.Release();}
            }
            finally{v.CompleteFileTask();}
        });

        app.MapGet("/api/business-files/{workspace}/download/{linkId:long}",async(
            HttpContext ctx,Vault v,string workspace,long linkId)=>
        {
            if(!v.Allowed(ctx)){ctx.Response.StatusCode=401;return;}
            if(!Vault.WorkspaceValid(workspace)){ctx.Response.StatusCode=400;return;}
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx)){ctx.Response.StatusCode=401;return;}
                var row=BusinessFileStore.GetLink(v.Db,workspace,linkId);
                if(row is null || !BusinessFileStore.OwnerExists(
                    v.Db,workspace,row.Value.Kind,row.Value.OwnerId,row.Value.Section))
                {ctx.Response.StatusCode=404;return;}
                ctx.Response.ContentType="application/octet-stream";
                ctx.Response.Headers.ContentDisposition=
                    "attachment; filename*=UTF-8''"+Uri.EscapeDataString(row.Value.Name);
                using var cmd=v.Db.CreateCommand();
                cmd.CommandText="""
                    SELECT bytes FROM business_file_chunks WHERE object_id=$id ORDER BY idx;
                    """;
                cmd.Parameters.AddWithValue("$id",row.Value.ObjectId);
                using var reader=cmd.ExecuteReader();
                while(reader.Read())
                    await ctx.Response.Body.WriteAsync(reader.GetFieldValue<byte[]>(0),ctx.RequestAborted);
            }
            finally{v.Gate.Release();}
        });


        app.MapPost("/api/business-files/{workspace}/{linkId:long}/associate",
            async(HttpContext ctx,Vault v,string workspace,long linkId,BusinessAssociateInput input)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!BusinessFileStore.ScopeValid(workspace,input.TargetKind,input.TargetSection))
                return Fail("目标业务范围无效。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("当前存在文件任务或正在退出。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("当前存在文件任务或正在退出。",409);
                return BusinessFileStore.Associate(v.Db,workspace,linkId,input.TargetKind,
                    input.TargetOwnerId,input.TargetSection,input.Move)
                    ? Results.Ok(new {ok=true}) : Results.NotFound();
            }
            finally{v.Gate.Release();}
        });
        app.MapDelete("/api/business-files/{workspace}/{linkId:long}",async(
            HttpContext ctx,Vault v,string workspace,long linkId)=>
        {
            if(!v.Allowed(ctx))return Results.Unauthorized();
            if(!Vault.WorkspaceValid(workspace))return Fail("无效工作区。");
            if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可修改附件。",409);
            await v.Gate.WaitAsync();
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return Fail("文件任务或退出期间不可修改附件。",409);
                var row=BusinessFileStore.GetLink(v.Db,workspace,linkId);
                if(row is null||!BusinessFileStore.OwnerExists(v.Db,workspace,
                    row.Value.Kind,row.Value.OwnerId,row.Value.Section))return Results.NotFound();
                return BusinessFileStore.RemoveLink(v.Db,workspace,linkId)
                    ? Results.Ok(new{ok=true}):Results.NotFound();
            }
            finally{v.Gate.Release();}
        });
    }
}
