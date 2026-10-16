using Microsoft.Data.Sqlite;

// One SQL read per V2 workspace file list instead of N+1 local HTTP requests.
// The recursive active-folders CTE also hides links beneath deleted ancestors.
record McpFileRow(long Id,long FileId,long OwnerId,string Kind,string Section,
    string Name,int? LatestVersion,long? Size,string? Sha256);
record McpFilePage(IReadOnlyList<McpFileRow> Items,int Offset,int Limit,
    bool HasMore,int? NextOffset);

static class NativeMcpFileQuery
{
    private const string BaseQuery="""
        WITH RECURSIVE active_folders(id,workspace) AS (
          SELECT id,workspace FROM folders
          WHERE workspace=$w AND deleted=0 AND parent_id IS NULL
          UNION ALL
          SELECT child.id,child.workspace FROM folders child
          JOIN active_folders p ON child.parent_id=p.id AND child.workspace=p.workspace
          WHERE child.deleted=0
        )
        SELECT l.id,l.file_id,l.folder_id,folder.kind,folder.section,
               COALESCE(l.display_name,file.name),
               version.version,obj.size,obj.sha256
        FROM folder_file_links l
        JOIN active_folders active ON active.id=l.folder_id AND active.workspace=l.workspace
        JOIN folders folder ON folder.id=l.folder_id AND folder.workspace=l.workspace
        JOIN files file ON file.id=l.file_id AND file.workspace=l.workspace
             AND file.deleted=0
        LEFT JOIN file_versions version ON version.file_id=l.file_id
          AND version.workspace=l.workspace AND version.deleted=0
          AND version.version=(SELECT MAX(v.version) FROM file_versions v
              WHERE v.file_id=l.file_id AND v.workspace=l.workspace AND v.deleted=0)
        LEFT JOIN file_objects obj ON obj.id=version.object_id
          AND obj.workspace=version.workspace AND obj.state='ready'
        WHERE l.workspace=$w AND l.deleted=0
          AND folder.kind IN ('project','contract','ip','archive','general')
          AND ($kind='' OR folder.kind=$kind)
          AND ($owner=0 OR l.folder_id=$owner)
          AND ($name='' OR instr(lower(COALESCE(l.display_name,file.name)),lower($name))>0)
        ORDER BY l.id
        """;

    public static object Read(SqliteConnection db,string workspace,
        string? kind,string? name,long ownerId,int offset,int limit,bool paged)
    {
        if(!Vault.WorkspaceValid(workspace))
            throw new ArgumentException("工作区无效。");
        if(kind is not (null or "" or "project" or "contract" or "ip" or "archive" or "general"))
            throw new ArgumentException("文件类别无效。");
        if(ownerId<0 || offset<0 || limit is <1 or >200)
            throw new ArgumentException("文件列表 offset/ownerId/limit 不合法；limit 限制为 1–200。");
        if(name is {Length:>240})
            throw new ArgumentException("搜索名称不能超过 240 字符。");
        using var cmd=db.CreateCommand();
        cmd.CommandText=BaseQuery+(paged?" LIMIT $take OFFSET $skip":";");
        cmd.Parameters.AddWithValue("$w",workspace);
        cmd.Parameters.AddWithValue("$kind",kind??"");
        cmd.Parameters.AddWithValue("$owner",ownerId);
        cmd.Parameters.AddWithValue("$name",name??"");
        if(paged)
        {
            cmd.Parameters.AddWithValue("$take",limit+1);
            cmd.Parameters.AddWithValue("$skip",offset);
        }
        var rows=new List<McpFileRow>();
        using(var rd=cmd.ExecuteReader())
        {
            while(rd.Read())
                rows.Add(new McpFileRow(rd.GetInt64(0),rd.GetInt64(1),rd.GetInt64(2),
                    rd.GetString(3),rd.GetString(4),rd.GetString(5),
                    rd.IsDBNull(6)?null:rd.GetInt32(6),
                    rd.IsDBNull(7)?null:rd.GetInt64(7),
                    rd.IsDBNull(8)?null:rd.GetString(8)));
        }
        if(!paged)return rows;
        bool more=rows.Count>limit;
        if(more)rows.RemoveAt(rows.Count-1);
        return new McpFilePage(rows,offset,limit,more,more?offset+limit:null);
    }

    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapGet("/api/v2/mcp/files/{workspace}",async (
            HttpContext ctx,Vault vault,string workspace,string? kind,
            string? name,long? ownerId,int? offset,int? limit,bool paged=false)=>
        {
            if(!vault.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!await vault.Gate.WaitAsync(0,ctx.RequestAborted))
                return fail("资料库正在执行其他操作，请稍后重试。",409);
            try
            {
                if(!vault.Allowed(ctx))return Results.Unauthorized();
                try
                {
                    var value=Read(vault.Db,workspace,kind,name,ownerId??0,
                        offset??0,limit??100,paged);
                    return Results.Json(value);
                }
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(SqliteException ex){return fail("文件查询失败："+ex.SqliteErrorCode,409);}
            }
            finally{vault.Gate.Release();}
        });
    }
}
