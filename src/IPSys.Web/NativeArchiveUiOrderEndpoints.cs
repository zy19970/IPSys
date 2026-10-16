using Microsoft.Data.Sqlite;

// Native archive certificate/personal ledger ordering, V2 FolderId only.
static class NativeArchiveUiOrderEndpoints
{
    public static void Map(WebApplication app,Func<string,int,IResult> fail)
    {
        app.MapPost("/api/v2/ui/archive/{workspace}/{section}/order",async(
            HttpContext ctx,Vault v,string workspace,string section,
            NativeIpUiOrderInput input)=>
        {
            if(!v.Allowed(ctx))return (IResult)Results.Unauthorized();
            if(ArchiveRules.Module(workspace,section)==null)
                return fail("无效的工作区或资料类别。",400);
            if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
            await v.Gate.WaitAsync(ctx.RequestAborted);
            try
            {
                if(!v.Allowed(ctx))return Results.Unauthorized();
                if(v.FileTaskActive||v.ExitRequested)return fail("文件任务正在执行。",409);
                var original=NativeArchiveStore.List(v.Db,workspace,
                    FolderKinds.Archive,section).Select(x=>x.Folder.Ref.Id).ToArray();
                var proposed=input.Ids??[];
                if(proposed.Length!=original.Length ||
                   proposed.Distinct().Count()!=original.Length ||
                   !proposed.Order().SequenceEqual(original.Order()))
                    return fail("排序应包含本模块当前全部有效资料。",409);
                using var tx=v.Db.BeginTransaction();
                using var cmd=v.Db.CreateCommand();
                cmd.Transaction=tx;
                cmd.CommandText="""
                    UPDATE folders SET position=$position
                    WHERE id=$id AND workspace=$w AND kind='archive'
                      AND section=$section AND deleted=0;
                    """;
                cmd.Parameters.AddWithValue("$w",workspace);
                cmd.Parameters.AddWithValue("$section",section);
                var id=cmd.Parameters.Add("$id",SqliteType.Integer);
                var position=cmd.Parameters.Add("$position",SqliteType.Integer);
                for(int i=0;i<proposed.Length;i++)
                {
                    id.Value=proposed[i];
                    position.Value=i;
                    if(cmd.ExecuteNonQuery()!=1)
                        throw new IOException("排序时目录记录发生变化。");
                }
                tx.Commit();
                return Results.Ok(new{ok=true});
            }
            finally{v.Gate.Release();}
        });
    }
}
