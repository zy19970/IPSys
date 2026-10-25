using System.Text.Json;

// Authenticated local-browser settings API. Never exposes the per-user storage
// file path and never grants MCP access by itself.
record AgentGuidanceUpdateInput(string Content,string ExpectedRevision);
record AgentGuidanceRestoreInput(string ExpectedRevision);
record AgentGuidanceImportInput(JsonElement Config,string ExpectedRevision);

static class AgentGuidanceEndpoints
{
    private static IResult Handle(Func<IResult> action)
    {
        try{return action();}
        catch(ArgumentException ex){return Results.BadRequest(new{error=ex.Message});}
        catch(InvalidOperationException ex){return Results.Conflict(new{error=ex.Message});}
        catch(IOException ex){return Results.Json(new{error="Agent 规范配置读取或写入失败："+ex.Message},
            statusCode:500);}
    }

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/agent-guidance",(HttpContext ctx,Vault vault)=>
            !vault.Allowed(ctx)?Results.Unauthorized():Handle(()=>
                Results.Json(AgentGuidance.Read("index"))));

        app.MapGet("/api/agent-guidance/export",(HttpContext ctx,Vault vault)=>
            !vault.Allowed(ctx)?Results.Unauthorized():Handle(()=>
                Results.Json(AgentGuidanceStore.Current.Export())));

        app.MapGet("/api/agent-guidance/{topic}",(HttpContext ctx,Vault vault,string topic)=>
            !vault.Allowed(ctx)?Results.Unauthorized():Handle(()=>
                Results.Json(AgentGuidance.Editable(topic))));

        app.MapPut("/api/agent-guidance/{topic}",(
            HttpContext ctx,Vault vault,string topic,AgentGuidanceUpdateInput input)=>
        {
            if(!vault.Allowed(ctx))return Results.Unauthorized();
            return Handle(()=>
            {
                AgentGuidanceStore.Current.Save(topic,input.Content,
                    input.ExpectedRevision);
                return Results.Json(AgentGuidance.Editable(topic));
            });
        });

        app.MapPost("/api/agent-guidance/{topic}/restore",(
            HttpContext ctx,Vault vault,string topic,AgentGuidanceRestoreInput input)=>
        {
            if(!vault.Allowed(ctx))return Results.Unauthorized();
            return Handle(()=>
            {
                AgentGuidanceStore.Current.Restore(topic,input.ExpectedRevision);
                return Results.Json(AgentGuidance.Editable(topic));
            });
        });

        app.MapPost("/api/agent-guidance/import",(
            HttpContext ctx,Vault vault,AgentGuidanceImportInput input)=>
        {
            if(!vault.Allowed(ctx))return Results.Unauthorized();
            return Handle(()=>
            {
                AgentGuidanceStore.Current.Import(input.Config,
                    input.ExpectedRevision);
                return Results.Json(AgentGuidance.Read("index"));
            });
        });
    }
}
