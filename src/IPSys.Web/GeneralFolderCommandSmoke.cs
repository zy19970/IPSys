using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

static class GeneralFolderCommandSmoke
{
    public static async Task VerifyAsync(HttpClient client)
    {
        static void Check(bool ok,string message)
        {
            if (!ok) throw new IOException("General folder command HTTP smoke failed: "+message);
        }
        static async Task<long> Created(HttpResponseMessage response)
        {
            using (response)
            {
                response.EnsureSuccessStatusCode();
                return (await response.Content.ReadFromJsonAsync<JsonElement>())
                    .GetProperty("id").GetInt64();
            }
        }

        string unique=Guid.NewGuid().ToString("N")[..8];
        const string common="/api/folders/company/general";
        long one=await Created(await client.PostAsJsonAsync(common,
            new FolderMutationInput(General:new TitleInput("公共综合资料-"+unique))));
        using(var oldRead=await client.GetAsync("/api/records/company"))
        {
            oldRead.EnsureSuccessStatusCode();
            var rows=await oldRead.Content.ReadFromJsonAsync<List<RecordView>>();
            Check(rows!.Any(x=>x.Id==one && x.Title=="公共综合资料-"+unique),
                "common create visible through legacy records");
        }
        using(var edited=await client.PutAsJsonAsync($"/api/records/company/{one}",
            new TitleInput("旧接口修改-"+unique)))
            edited.EnsureSuccessStatusCode();
        using(var detail=await client.GetAsync(
            $"/api/folders/company/detail/general/{one}"))
        {
            detail.EnsureSuccessStatusCode();
            var folder=await detail.Content.ReadFromJsonAsync<JsonElement>();
            Check(folder.GetProperty("folder").GetProperty("name").GetString()=="旧接口修改-"+unique,
                "old edit visible through common folder detail");
        }
        using(var blank=await client.PostAsJsonAsync(common,
            new FolderMutationInput(General:new TitleInput("   "))))
            Check(blank.StatusCode==HttpStatusCode.BadRequest,"blank title rejected");
        using(var longTitle=await client.PostAsJsonAsync(common,
            new FolderMutationInput(General:new TitleInput(new string('A',301)))))
            Check(longTitle.StatusCode==HttpStatusCode.BadRequest,"long title rejected");
        using(var unexpectedParent=await client.PostAsJsonAsync(common,
            new FolderMutationInput(General:new TitleInput("错误父级"), ParentId:1)))
            Check(unexpectedParent.StatusCode==HttpStatusCode.BadRequest,
                "general cannot get arbitrary parent");
        using(var crossWorkspace=await client.PutAsJsonAsync(
            $"/api/folders/personal/general/{one}",
            new FolderMutationInput(General:new TitleInput("越权编辑"))))
            Check(crossWorkspace.StatusCode==HttpStatusCode.NotFound,
                "cross-workspace edit forbidden");
        using(var mixed=await client.PostAsJsonAsync(common,
            new FolderMutationInput(General:new TitleInput("混合属性"),
                Project:new ProjectInput("项目","科研项目",null,null,null,null,null,null,null,null,null))))
            Check(mixed.StatusCode==HttpStatusCode.BadRequest,
                "mixed business payload rejected");

        using(var edited=await client.PutAsJsonAsync($"{common}/{one}",
            new FolderMutationInput(General:new TitleInput("公共接口修改-"+unique))))
            edited.EnsureSuccessStatusCode();
        using(var deleted=await client.DeleteAsync($"/api/records/company/{one}"))
            deleted.EnsureSuccessStatusCode();
        using(var gone=await client.GetAsync($"/api/folders/company/detail/general/{one}"))
            Check(gone.StatusCode==HttpStatusCode.NotFound,
                "old delete hides common folder");
        using(var restored=await client.PostAsync($"{common}/{one}/restore",null))
            restored.EnsureSuccessStatusCode();

        long legacy=await Created(await client.PostAsJsonAsync(
            "/api/records/company",new TitleInput("旧入口新增-"+unique)));
        using(var detail=await client.GetAsync(
            $"/api/folders/company/detail/general/{legacy}"))
            detail.EnsureSuccessStatusCode();
        using(var deleted=await client.DeleteAsync($"{common}/{legacy}"))
            deleted.EnsureSuccessStatusCode();
        using(var restored=await client.PostAsync($"{common}/{legacy}/restore",null))
            restored.EnsureSuccessStatusCode();
        using(var oldRead=await client.GetAsync("/api/records/company"))
        {
            oldRead.EnsureSuccessStatusCode();
            var rows=await oldRead.Content.ReadFromJsonAsync<List<RecordView>>();
            Check(rows!.Any(x=>x.Id==legacy && x.Title=="旧入口新增-"+unique) &&
                  rows.Any(x=>x.Id==one && x.Title=="公共接口修改-"+unique),
                "old and common CRUD plus recycle restore share identical rows");
        }
        using(var denied=await new HttpClient{BaseAddress=client.BaseAddress}
            .PostAsJsonAsync(common,new FolderMutationInput(General:new TitleInput("未授权"))))
            Check(denied.StatusCode==HttpStatusCode.Unauthorized,"anonymous create denied");
        Console.WriteLine("GENERAL FOLDER COMMAND HTTP SMOKE PASS: common/legacy CRUD and recycle");
    }
}
