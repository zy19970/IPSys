using System.Net;
using System.Net.Http.Json;
using System.Text;

// Search scenarios use only the disposable SQLCipher --smoke database.
static class SearchSmoke
{
    private static async Task<SearchResponse> Find(HttpClient client,string workspace,string term)
    {
        return await client.GetFromJsonAsync<SearchResponse>(
            "/api/search/"+workspace+"?q="+Uri.EscapeDataString(term))
            ??throw new IOException("搜索返回内容为空。");
    }
    public static async Task VerifyAsync(HttpClient client)
    {
        string marker="SEARCH-"+Guid.NewGuid().ToString("N")[..9];
        using var companyProject=await client.PostAsJsonAsync("/api/v2/folders/company/project",new {project=new {
            name=marker+"-公司项目",projectType="科研项目",projectNo=marker+"-P"
        }});
        companyProject.EnsureSuccessStatusCode();
        long projectId=(await companyProject.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("id").GetInt64();
        using var personalProject=await client.PostAsJsonAsync("/api/v2/folders/personal/project",new {project=new {
            name=marker+"-个人项目",projectType="科研项目",projectNo=marker+"-Q"
        }});
        personalProject.EnsureSuccessStatusCode();
        long personalId=(await personalProject.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("id").GetInt64();
        using var ip=await client.PostAsJsonAsync("/api/v2/folders/company/ip",new {
            ip=new{name=marker+"-专利",ipType="发明专利",
                status="实质审查中",applicationNo=marker+"-CN"}
        });
        ip.EnsureSuccessStatusCode();
        long ipId=(await ip.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("id").GetInt64();
        using var contract=await client.PostAsJsonAsync(
            "/api/v2/folders/company/contract",new {
                parentId=projectId,contract=new{
                  name=marker+"-合同",contractNo=marker+"-HT",
                  signDate="2026-10-14",amount="125.50"}
            });
        contract.EnsureSuccessStatusCode();
        long contractId=(await contract.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("id").GetInt64();
        using var archive=await client.PostAsJsonAsync("/api/archives/company/certificate",new {
            name=marker+"-企业资质",category="企业资质",remarks="统一检索"
        });
        archive.EnsureSuccessStatusCode();
        long archiveId=(await archive.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("id").GetInt64();
        using var companyBusiness=await client.PostAsJsonAsync("/api/archives/company/achievement",new {
            name=marker+"-首台套申报",category="申报与认定",remarks="业务归档"
        });
        companyBusiness.EnsureSuccessStatusCode();
        long businessId=(await companyBusiness.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("id").GetInt64();
        using var academic=await client.PostAsJsonAsync("/api/archives/personal/academic",new {
            name=marker+"-学术兼职",category="学术兼职"
        });
        academic.EnsureSuccessStatusCode();
        long academicId=(await academic.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("id").GetInt64();
        using var general=await client.PostAsJsonAsync("/api/records/company",new {title=marker+"-综合资料"});
        general.EnsureSuccessStatusCode();
        long generalId=(await general.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("id").GetInt64();

        var company=await Find(client,"company",marker);
        foreach(var type in new[]{"project","ip","contract","archive","general"})
            if(!company.Results.Any(h=>h.Kind==type))
                throw new IOException("搜索缺失真实业务模块："+type);
        if(company.Results.Any(h=>h.Title.Contains("个人项目")||h.Title.Contains("学术兼职")))
            throw new IOException("公司搜索不应泄漏个人工作区记录。");
        if(!company.Results.Any(h=>h.Kind=="archive"&&h.Section=="achievement"&&
            h.Id==businessId&&h.Description.Contains("业务档案")))
            throw new IOException("公司业务档案搜索命中应标记为业务档案。");
        var personal=await Find(client,"personal",marker);
        if(!personal.Results.Any(h=>h.Kind=="project"&&h.Id==personalId)||
           !personal.Results.Any(h=>h.Kind=="archive"&&h.Id==academicId&&h.Section=="academic"))
            throw new IOException("个人项目和学术兼职搜索缺失。");
        if(personal.Results.Any(h=>h.Id==ipId&&h.Kind=="ip")||
           personal.Results.Any(h=>h.Title.Contains("公司项目")))
            throw new IOException("个人搜索不应泄漏公司记录。");
        var number=await Find(client,"company",marker+"-CN");
        if(!number.Results.Any(h=>h.Kind=="ip"&&h.Id==ipId))
            throw new IOException("知识产权申请号搜索未命中。");
        byte[] ipBytes=Encoding.UTF8.GetBytes("IP-V2-original-"+marker);
        string ipFilename=marker+"-专利证书.pdf";
        using(var upload=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/ip/company/{ipId}/files") {Content=new ByteArrayContent(ipBytes)})
        {
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString(ipFilename));
            upload.Headers.Add("X-Material-Category",Uri.EscapeDataString("证书文件"));
            using var response=await client.SendAsync(upload);
            response.EnsureSuccessStatusCode();
        }
        var ipOriginal=await Find(client,"company",ipFilename);
        if(!ipOriginal.Results.Any(x=>x.Kind=="file"&&x.OwnerKind=="ip"
             &&x.OwnerId==ipId&&x.Title==ipFilename))
            throw new IOException("V2 知识产权原件应按真实 FolderId 进入统一搜索。");
        if((await Find(client,"personal",ipFilename)).Results.Count!=0)
            throw new IOException("V2 知识产权原件不允许跨工作区搜索。");
        var byProject=await Find(client,"company",marker+"-P");
        if(!byProject.Results.Any(h=>h.Kind=="project"&&h.Id==projectId))
            throw new IOException("项目编号搜索未命中。");
        var byContract=await Find(client,"company",marker+"-HT");
        if(!byContract.Results.Any(h=>h.Kind=="contract"&&h.Id==contractId))
            throw new IOException("合同编号搜索未命中。");

        string filename=marker+"-项目原件.pdf";
        using(var body=new ByteArrayContent(Encoding.UTF8.GetBytes("PDF-file-search-test")))
        {
            body.Headers.Add("X-File-Name",Uri.EscapeDataString(filename));
            using var result=await client.PostAsync(
                $"/api/v2/files/company/upload?folderId={projectId}",body);
            result.EnsureSuccessStatusCode();
        }
        var attached=await Find(client,"company",filename);
        if(!attached.Results.Any(h=>h.Kind=="file"&&h.OwnerKind=="project"&&h.OwnerId==projectId))
            throw new IOException("附件名称必须定位到真实所属项目。");
        if((await Find(client,"personal",filename)).Results.Count!=0)
            throw new IOException("个人工作区不允许检索公司附件。");

        var empty=await Find(client,"company"," ");
        if(empty.Results.Count!=0)throw new IOException("空关键词不应返回全部资料。");
        using(var bad=await client.GetAsync("/api/search/company?q="+new string('x',101)))
            if(bad.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("超长关键词未被拒绝。");
        using(var badScope=await client.GetAsync("/api/search/unknown?q="+marker))
            if(badScope.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("无效工作区应被拒绝。");
        using(var guest=new HttpClient{BaseAddress=client.BaseAddress})
        using(var denied=await guest.GetAsync("/api/search/company?q="+marker))
            if(denied.StatusCode!=HttpStatusCode.Unauthorized)
                throw new IOException("未解锁会话不得检索台账。");

        using(var deleted=await client.DeleteAsync($"/api/v2/folders/company/project/{projectId}"))
            deleted.EnsureSuccessStatusCode();
        if((await Find(client,"company",filename)).Results.Count!=0)
            throw new IOException("已移入回收站的项目附件不得出现搜索结果。");
        using(var deleted=await client.DeleteAsync($"/api/archives/company/certificate/{archiveId}"))
            deleted.EnsureSuccessStatusCode();
        if((await Find(client,"company",marker+"-企业资质")).Results.Count!=0)
            throw new IOException("删除的资质资料不得仍被检索。");
        Console.WriteLine("SEARCH SMOKE PASS: modules, fields, filenames, isolation, auth, soft delete");
    }
}
