using Microsoft.Data.Sqlite;
using System.Text.Json.Serialization;

// One SQL read per V2 workspace file list instead of N+1 local HTTP requests.
// The recursive active-folders CTE also hides links beneath deleted ancestors.
// Missing-filter calls select in SQL before LIMIT/OFFSET and de-duplicate FileId.
record McpFileRow(long Id,long FileId,long OwnerId,string Kind,string Section,
    string Name,int? LatestVersion,long? Size,string? Sha256,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? MissingFields=null);
record McpFilePage(IReadOnlyList<McpFileRow> Items,int Offset,int Limit,
    bool HasMore,int? NextOffset);

static class NativeMcpFileQuery
{
    private static readonly string[] FileFields=
        ["description","tags","file_number","file_date"];
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
               COALESCE(l.display_name,file.name) AS name,
               version.version,obj.size,obj.sha256,
               file.description,file.tags,file.file_number,file.file_date
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

    private static string[] ParseMissingFields(string? raw)
    {
        if(string.IsNullOrWhiteSpace(raw))return [];
        if(raw.Trim().Equals("all",StringComparison.OrdinalIgnoreCase))
            return FileFields;
        if(raw.Length>140)throw new ArgumentException("missing_fields 过长。");
        string[] parts=raw.Split([',',';','；'],
            StringSplitOptions.TrimEntries|StringSplitOptions.RemoveEmptyEntries);
        if(parts.Length==0||parts.Any(x=>!FileFields.Contains(x,StringComparer.Ordinal)))
            throw new ArgumentException(
                "missing_fields 只接受 all 或 description、tags、file_number、file_date 的字段列表。");
        return parts.Distinct(StringComparer.Ordinal).ToArray();
    }

    private static string EmptySql(string field)=>
        "trim(COALESCE(file."+field+
        ",''), ' '||char(9)||char(10)||char(13)||char(11)||char(12)"+
        "||char(160)||char(12288)||char(8239)) = ''";

    public static object Read(SqliteConnection db,string workspace,
        string? kind,string? name,long ownerId,int offset,int limit,bool paged,
        string? missingFields=null,string? missingMode=null)
    {
        if(!Vault.WorkspaceValid(workspace))
            throw new ArgumentException("工作区无效。");
        if(kind is not (null or "" or "project" or "contract" or "ip" or "archive" or "general"))
            throw new ArgumentException("文件类别无效。");
        if(ownerId<0 || offset<0 || limit is <1 or >200)
            throw new ArgumentException("文件列表 offset/ownerId/limit 不合法；limit 限制为 1–200。");
        if(name is {Length:>240})
            throw new ArgumentException("搜索名称不能超过 240 字符。");
        string[] selected=ParseMissingFields(missingFields);
        string mode=string.IsNullOrEmpty(missingMode)?"any":missingMode;
        if(mode is not ("any" or "all"))
            throw new ArgumentException("missing_mode 只能是 any 或 all。");
        if(selected.Length==0 && mode!="any")
            throw new ArgumentException("missing_mode 需要与 missing_fields 一起使用。");

        string sql=BaseQuery;
        if(selected.Length>0)
        {
            // Names are validated against the static FileFields whitelist.
            // Evaluate missingness in SQL *before* OFFSET, then keep the first
            // qualifying LinkId for each FileId within the requested scope.
            string clause=string.Join(mode=="all"?" AND ":" OR ",
                selected.Select(EmptySql));
            int order=sql.LastIndexOf("ORDER BY l.id",StringComparison.Ordinal);
            if(order<0)throw new InvalidOperationException("文件查询 SQL 顺序异常。");
            string filteredBase=sql[..order]+"AND ("+clause+")\n";
            sql="""
                SELECT id,file_id,folder_id,kind,section,name,
                       version,size,sha256,description,tags,file_number,file_date
                FROM (
                    SELECT candidate.*,ROW_NUMBER() OVER (
                        PARTITION BY file_id ORDER BY id) AS file_rank
                    FROM (
                """+filteredBase+"""
                    ) candidate
                ) ranked
                WHERE file_rank=1
                ORDER BY id
                """;
        }
        using var cmd=db.CreateCommand();
        cmd.CommandText=sql+(paged?" LIMIT $take OFFSET $skip":";");
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
            {
                IReadOnlyList<string>? gaps=null;
                if(selected.Length>0)
                {
                    var missing=new List<string>(4);
                    for(int i=0;i<FileFields.Length;i++)
                        if(rd.IsDBNull(i+9)||
                           string.IsNullOrWhiteSpace(rd.GetString(i+9)))
                            missing.Add(FileFields[i]);
                    gaps=missing;
                }
                rows.Add(new McpFileRow(rd.GetInt64(0),rd.GetInt64(1),rd.GetInt64(2),
                    rd.GetString(3),rd.GetString(4),rd.GetString(5),
                    rd.IsDBNull(6)?null:rd.GetInt32(6),
                    rd.IsDBNull(7)?null:rd.GetInt64(7),
                    rd.IsDBNull(8)?null:rd.GetString(8),gaps));
            }
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
            string? name,long? ownerId,int? offset,int? limit,
            string? missingFields,string? missingMode,bool paged=false)=>
        {
            if(!vault.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(!await vault.Gate.WaitAsync(TimeSpan.FromSeconds(5),ctx.RequestAborted))
                return fail("文件列表查询等待数据库超过 5 秒；请稍后重试只读查询。",409);
            try
            {
                if(!vault.Allowed(ctx))return Results.Unauthorized();
                try
                {
                    var value=Read(vault.Db,workspace,kind,name,ownerId??0,
                        offset??0,limit??100,paged,missingFields,missingMode);
                    return Results.Json(value);
                }
                catch(ArgumentException ex){return fail(ex.Message,400);}
                catch(SqliteException ex){return fail("文件查询失败："+ex.SqliteErrorCode,409);}
            }
            finally{vault.Gate.Release();}
        });
    }
}
