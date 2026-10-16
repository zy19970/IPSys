using System.Data;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Data.Sqlite;
using IPSys.Web;
// R0-03: isolate existing SQLCipher / local HTTP smoke checks without changing behavior.
static class WebSmoke
{
    private static async Task<(long Id,int Version,bool Reused)> UploadBusinessFile(HttpClient client,
        string workspace,string kind,long ownerId,byte[] data,string name,
        string section="",string category="",string mode="update",string group="",string duplicate="independent")
    {
        var path=$"/api/business-files/{workspace}/{kind}/{ownerId}"+
            (section.Length>0?"?section="+Uri.EscapeDataString(section):"");
        using var body=new ByteArrayContent(data);
        body.Headers.ContentType=new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
        using var request=new HttpRequestMessage(HttpMethod.Post,path){Content=body};
        request.Headers.Add("X-File-Name",Uri.EscapeDataString(name));
        if(category.Length>0)request.Headers.Add("X-Material-Category",Uri.EscapeDataString(category));
        request.Headers.Add("X-Upload-Mode",mode);
        request.Headers.Add("X-Duplicate-Mode",duplicate);
        if(group.Length>0)request.Headers.Add("X-File-Group",group);
        using var response=await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var json=(await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>());
        if(json.GetProperty("sha256").GetString()!=Convert.ToHexString(SHA256.HashData(data)))
            throw new IOException("入库原件 SHA-256 与源文件不一致。");
        return (json.GetProperty("id").GetInt64(),json.GetProperty("version").GetInt32(),
            json.GetProperty("reused").GetBoolean());
    }
    private static async Task VerifySecondExcelBatchAsync(HttpClient client)
    {
        var unique=Guid.NewGuid().ToString("N")[..8];
        string SheetText(byte[] workbook)
        {
            using var source=new MemoryStream(workbook);
            using var zip=new System.IO.Compression.ZipArchive(source,System.IO.Compression.ZipArchiveMode.Read);
            var sheet=zip.GetEntry("xl/worksheets/sheet1.xml")
                ??throw new IOException("第二批 Excel 工作表缺失。");
            using var reader=new StreamReader(sheet.Open());
            return reader.ReadToEnd();
        }
        var modules=new[]{
            (Workspace:"company",Kind:"archive",Section:"certificate",Category:"企业资质"),
            (Workspace:"company",Kind:"archive",Section:"achievement",Category:"科研成果"),
            (Workspace:"personal",Kind:"archive",Section:"certificate",Category:"学历学位"),
            (Workspace:"personal",Kind:"archive",Section:"achievement",Category:"成果奖励"),
            (Workspace:"personal",Kind:"archive",Section:"academic",Category:"学术兼职"),
            (Workspace:"company",Kind:"general",Section:"",Category:""),
            (Workspace:"personal",Kind:"general",Section:"",Category:"")
        };
        foreach(var m in modules)
        {
            string name="XLSX2-"+m.Kind+"-"+m.Workspace+"-"+m.Section+"-"+unique;
            string url=m.Kind=="archive"
                ?$"/api/archives/{m.Workspace}/{m.Section}"
                :$"/api/records/{m.Workspace}";
            using var creation=m.Kind=="archive"
                ?await client.PostAsJsonAsync(url,new {name,category=m.Category,remarks="Excel备注",tags="批量"})
                :await client.PostAsJsonAsync(url,new {title=name});
            creation.EnsureSuccessStatusCode();
            var id=(await creation.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            string query=m.Kind=="archive"?"?section="+m.Section:"";
            string excel=$"/api/excel/{m.Workspace}/{m.Kind}";
            using var templ=await client.GetAsync(excel+"/template"+query);
            templ.EnsureSuccessStatusCode();
            byte[] template=await templ.Content.ReadAsByteArrayAsync();
            if(!SheetText(template).Contains("资料名称",StringComparison.Ordinal))
                throw new IOException("第二批资料 XLSX 模板缺少名称列。");
            if(m.Kind=="archive"&&!SheetText(template).Contains("类别",StringComparison.Ordinal))
                throw new IOException("资料四字段模板缺少类别。");
            using var filtered=await client.PostAsJsonAsync(excel+"/export"+query,new ExcelExportInput("filtered",new[]{id}));
            filtered.EnsureSuccessStatusCode();
            byte[] bytes=await filtered.Content.ReadAsByteArrayAsync();
            if(!SheetText(bytes).Contains(name,StringComparison.Ordinal))
                throw new IOException("资料 Excel 筛选结果未包含当前记录。");
            if(m.Kind=="archive"&&!SheetText(bytes).Contains("Excel备注",StringComparison.Ordinal))
                throw new IOException("资料 Excel 导出未保留业务备注。");
            foreach(var (policy,key,expected) in new[]{
                ("skip","skipped",1),("update","updated",1),("create","created",1)})
            {
                using var body=new ByteArrayContent(bytes);
                body.Headers.ContentType=new System.Net.Http.Headers.MediaTypeHeaderValue(ExcelLedger.ContentType);
                using var response=await client.PostAsync(excel+"/import?policy="+policy+
                    (m.Kind=="archive"?"&section="+m.Section:""),body);
                response.EnsureSuccessStatusCode();
                var stats=await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
                if(stats.GetProperty(key).GetInt32()!=expected)
                    throw new IOException($"第二批 Excel {m.Kind}/{m.Section}/{policy} 重复策略失败。");
            }
            string other=m.Workspace=="company"?"personal":"company";
            if(m.Kind!="archive"||ArchiveStore.Module(other,m.Section)!=null)
            {
                using var isolation=await client.PostAsJsonAsync(
                    $"/api/excel/{other}/{m.Kind}/export"+query,
                    new ExcelExportInput("filtered",new[]{id}));
                isolation.EnsureSuccessStatusCode();
                if(SheetText(await isolation.Content.ReadAsByteArrayAsync()).Contains(name,StringComparison.Ordinal))
                    throw new IOException("Excel 第二批跨工作区泄漏记录。");
            }
        }
        using(var bad=await client.GetAsync("/api/excel/personal/archive/template?section=invalid"))
            if(bad.IsSuccessStatusCode)throw new IOException("Excel 不得接受非法资料模块。");
        var projects=await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/projects/company");
        long projectId=projects.EnumerateArray().First().GetProperty("id").GetInt64();
        using var contract=await client.PostAsJsonAsync($"/api/projects/company/{projectId}/contracts",
            new {name="Excel 合同 "+unique,contractNo="CN-"+unique,signDate="2026-10-14",
                amount="125.5",signingParties="甲方和乙方",remarks="合同只读导出"});
        contract.EnsureSuccessStatusCode();
        long contractId=(await contract.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
        using var contractExport=await client.PostAsJsonAsync("/api/excel/company/contract/export",
            new ExcelExportInput("filtered",new[]{contractId}));
        contractExport.EnsureSuccessStatusCode();
        string contractXml=SheetText(await contractExport.Content.ReadAsByteArrayAsync());
        if(!contractXml.Contains("Excel 合同 "+unique,StringComparison.Ordinal)||
           !contractXml.Contains("所属项目",StringComparison.Ordinal)||
           !contractXml.Contains("125.50",StringComparison.Ordinal))
            throw new IOException("合同 XLSX 必须包括当前合同、所属项目列和 0.00 金额。");
        using var contractTemplate=await client.GetAsync("/api/excel/company/contract/template");
        if(contractTemplate.IsSuccessStatusCode)throw new IOException("合同 Excel 不提供可写入模板。");
        using var denied=await client.PostAsync("/api/excel/company/contract/import?policy=create",
            new ByteArrayContent(await client.GetByteArrayAsync("/api/excel/company/project/template")));
        if(denied.IsSuccessStatusCode)throw new IOException("合同不得通过 Excel 导入创建。");
    }

    private static byte[] MixedExcelRows(byte[] original)
    {
        // Duplicate a valid project row, then make the third row invalid;
        // the second, newly numbered row must still import successfully.
        using var stream=new MemoryStream();
        stream.Write(original);
        stream.Position=0;
        using(var zip=new System.IO.Compression.ZipArchive(stream,
            System.IO.Compression.ZipArchiveMode.Update,true))
        {
            var entry=zip.GetEntry("xl/worksheets/sheet1.xml")
                ??throw new IOException("XLSX 工作表缺失。");
            System.Xml.Linq.XDocument xml;
            using(var body=entry.Open())xml=System.Xml.Linq.XDocument.Load(body);
            System.Xml.Linq.XNamespace n="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            var data=xml.Descendants(n+"sheetData").First();
            var sample=data.Elements(n+"row").Skip(1).First();
            var invalid=new System.Xml.Linq.XElement(sample);
            invalid.SetAttributeValue("r","3");
            foreach(var cell in invalid.Elements(n+"c"))
            {
                string reference=(string?)cell.Attribute("r")??"";
                cell.SetAttributeValue("r",System.Text.RegularExpressions.Regex.Replace(
                    reference,@"\d+$","3"));
            }
            var validNumber=sample.Elements(n+"c").First(c=>(string?)c.Attribute("r")=="C2");
            validNumber.Descendants(n+"t").First().Value="XLSX-NEW-"+Guid.NewGuid().ToString("N");
            var invalidType=invalid.Elements(n+"c").First(c=>(string?)c.Attribute("r")=="B3");
            invalidType.Descendants(n+"t").First().Value="非法项目类别";
            sample.AddAfterSelf(invalid);
            entry.Delete();
            var replacement=zip.CreateEntry("xl/worksheets/sheet1.xml");
            using(var output=replacement.Open())xml.Save(output);
        }
        return stream.ToArray();
    }

    private static async Task VerifyExcelAsync(HttpClient client)
    {
        var unique=Guid.NewGuid().ToString("N")[..8];
        var projectResult=await client.PostAsJsonAsync("/api/projects/company",new {
            name="Excel 自动测试项目",projectType="科研项目",projectNo="XLSX-"+unique,
            projectStatus="进行中",remarks="备注应原样保留"
        });
        projectResult.EnsureSuccessStatusCode();
        var projectJson=await projectResult.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        long projectId=projectJson.GetProperty("id").GetInt64();
        var ipResult=await client.PostAsJsonAsync("/api/ip/company",new {
            name="Excel 自动测试知识产权",ipType="发明专利",status="实质审查中",
            applicationNo="CN-XLSX-"+unique,rightHolders="测试单位"
        });
        ipResult.EnsureSuccessStatusCode();
        var ipJson=await ipResult.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        long ipId=ipJson.GetProperty("id").GetInt64();
        foreach(string kind in new[]{"project","ip"})
        {
            var template=await client.GetByteArrayAsync("/api/excel/company/"+kind+"/template");
            if(template.Length<400||template[0]!=0x50||template[1]!=0x4b)
                throw new IOException("Excel 固定模板不是有效 XLSX ZIP 结构。");
            var path="/api/excel/company/"+kind;
            var filtered=await client.PostAsJsonAsync(path+"/export",
                new ExcelExportInput("filtered",Array.Empty<long>()));
            filtered.EnsureSuccessStatusCode();
            byte[] empty=await filtered.Content.ReadAsByteArrayAsync();
            using(var body=new ByteArrayContent(empty))
            {
                body.Headers.ContentType=new System.Net.Http.Headers.MediaTypeHeaderValue(ExcelLedger.ContentType);
                var imported=await client.PostAsync(path+"/import?policy=skip",body);
                imported.EnsureSuccessStatusCode();
                var zero=await imported.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
                if(zero.GetProperty("total").GetInt32()!=0)
                    throw new IOException("筛选范围为空却导出了业务行。");
            }
            var response=await client.PostAsJsonAsync(path+"/export",
                new ExcelExportInput("filtered",new[]{kind=="project"?projectId:ipId}));
            response.EnsureSuccessStatusCode();
            byte[] workbook=await response.Content.ReadAsByteArrayAsync();
            using(var body=new ByteArrayContent(workbook))
            {
                body.Headers.ContentType=new System.Net.Http.Headers.MediaTypeHeaderValue(ExcelLedger.ContentType);
                var imported=await client.PostAsync(path+"/import?policy=skip",body);
                imported.EnsureSuccessStatusCode();
                var result=await imported.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
                if(result.GetProperty("skipped").GetInt32()!=1||result.GetProperty("created").GetInt32()!=0)
                    throw new IOException("Excel 重复记录跳过策略无效。");
            }
            using(var body=new ByteArrayContent(workbook))
            {
                body.Headers.ContentType=new System.Net.Http.Headers.MediaTypeHeaderValue(ExcelLedger.ContentType);
                var imported=await client.PostAsync(path+"/import?policy=update",body);
                imported.EnsureSuccessStatusCode();
                var result=await imported.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
                if(result.GetProperty("updated").GetInt32()!=1)
                    throw new IOException("Excel 重复记录更新策略无效。");
            }
            using(var body=new ByteArrayContent(workbook))
            {
                body.Headers.ContentType=new System.Net.Http.Headers.MediaTypeHeaderValue(ExcelLedger.ContentType);
                var imported=await client.PostAsync(path+"/import?policy=create",body);
                imported.EnsureSuccessStatusCode();
                var result=await imported.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
                if(result.GetProperty("created").GetInt32()!=1)
                    throw new IOException("Excel 重复记录独立新建策略无效。");
            }
            if(kind=="project")
            {
                byte[] mixed=MixedExcelRows(workbook);
                using var body=new ByteArrayContent(mixed);
                body.Headers.ContentType=new System.Net.Http.Headers.MediaTypeHeaderValue(ExcelLedger.ContentType);
                var imported=await client.PostAsync(path+"/import?policy=skip",body);
                imported.EnsureSuccessStatusCode();
                var result=await imported.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
                if(result.GetProperty("created").GetInt32()!=1||
                   result.GetProperty("failed").GetInt32()!=1||
                   result.GetProperty("errors")[0].GetProperty("row").GetInt32()!=3)
                    throw new IOException("Excel 错误行隔离与行号报告未生效。");
            }
            using(var invalidBody=new ByteArrayContent(new byte[]{1,2,3}))
            {
                var invalid=await client.PostAsync(path+"/import?policy=skip",invalidBody);
                if(invalid.IsSuccessStatusCode)
                    throw new IOException("Excel 非 XLSX 数据不应被接受。");
            }
        }
        var personal=await client.PostAsJsonAsync("/api/excel/personal/project/export",
            new ExcelExportInput("filtered",new[]{projectId}));
        personal.EnsureSuccessStatusCode();
        // Filtered export must not leak company records into the personal workspace.
        using var check=new ByteArrayContent(await personal.Content.ReadAsByteArrayAsync());
        var importPersonal=await client.PostAsync("/api/excel/personal/project/import?policy=skip",check);
        importPersonal.EnsureSuccessStatusCode();
        var resultPersonal=await importPersonal.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        if(resultPersonal.GetProperty("total").GetInt32()!=0)
            throw new IOException("Excel 导出跨工作区泄漏了记录。");
    }

    private static async Task VerifyMcpAsync(HttpClient client,string dir)
    {
        var disabled=await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/mcp");
        if(disabled.GetProperty("enabled").GetBoolean())
            throw new IOException("重新打开加密库后 MCP 必须默认关闭。");
        bool rejected=false;
        try
        {
            await McpLocal.RunSmokeToolAsync("list_projects",
                System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company"}));
        }
        catch(IOException ex)when(ex.Message.Contains("MCP 未授权")){rejected=true;}
        if(!rejected)throw new IOException("关闭的 MCP 不得读取项目。");
        (await client.PostAsJsonAsync("/api/mcp",new McpAccessInput(true)))
            .EnsureSuccessStatusCode();
        var result=await McpLocal.RunSmokeToolAsync("create_project",
            System.Text.Json.JsonSerializer.SerializeToElement(new {
                workspace="company",name="MCP 测试项目",project_type="科研项目"
            }));
        long project=result["id"]?.GetValue<long>()??throw new IOException("MCP 没有返回项目 ID");
        var projects=await McpLocal.RunSmokeToolAsync("list_projects",
            System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company"}));
        if(!projects.AsArray().Any(x=>x?["id"]?.GetValue<long>()==project))
            throw new IOException("MCP 创建项目未在真实台账出现。");
        await McpLocal.RunSmokeToolAsync("update_project",
            System.Text.Json.JsonSerializer.SerializeToElement(new {
                workspace="company",project_id=project,name="MCP 修改项目"
            }));
        var contractResult=await McpLocal.RunSmokeToolAsync("create_contract",
            System.Text.Json.JsonSerializer.SerializeToElement(new {
                workspace="company",project_id=project,name="MCP 合同"
            }));
        long contract=contractResult["id"]?.GetValue<long>()??0;
        if(contract<=0)throw new IOException("MCP 创建合同失败。");
        var contracts=await McpLocal.RunSmokeToolAsync("list_contracts",
            System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company"}));
        if(!contracts.AsArray().Any(x=>x?["id"]?.GetValue<long>()==contract))
            throw new IOException("MCP 合同未进入已有业务台账。");
        var bytes=RandomNumberGenerator.GetBytes(8192);
        string filename=System.IO.Path.Combine(dir,"mcp-test-file.bin");
        await File.WriteAllBytesAsync(filename,bytes);
        var upload=await McpLocal.RunSmokeToolAsync("upload_files",
            System.Text.Json.JsonSerializer.SerializeToElement(new {
                workspace="company",kind="contract",owner_id=contract,
                paths=new[] {filename},on_conflict="new"
            }));
        if(upload["succeeded"]?.GetValue<int>()!=1)
            throw new IOException("MCP 附件上传失败："+upload.ToJsonString());
        var list=await McpLocal.RunSmokeToolAsync("list_files",
            System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company"}));
        long fileId=list.AsArray().FirstOrDefault(x=>x?["ownerId"]?.GetValue<long>()==contract&&
                    x?["kind"]?.GetValue<string>()=="contract")?["id"]?.GetValue<long>()??0;
        if(fileId<=0)throw new IOException("MCP 业务原件查询缺失。");
        byte[] recovered=await client.GetByteArrayAsync(
            $"/api/business-files/company/download/{fileId}");
        if(!recovered.AsSpan().SequenceEqual(bytes))
            throw new IOException("MCP 上传后解密原件字节与本地不符。");
        // IP tools: field preservation, legal states, workspace isolation and originals.
        var newIp=await McpLocal.RunSmokeToolAsync("create_ip",
            System.Text.Json.JsonSerializer.SerializeToElement(new {
                workspace="company",name="MCP 专利",ip_type="发明专利",
                status="实质审查中",application_no="CN202610000001.0",
                application_date="2026-10-14",applicants="测试申请单位"
            }));
        long ipId=newIp["id"]?.GetValue<long>()??0;
        if(ipId<=0)throw new IOException("MCP 专利创建未返回有效 ID。");
        var ips=await McpLocal.RunSmokeToolAsync("list_ips",
            System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company"}));
        if(!ips.AsArray().Any(x=>x?["id"]?.GetValue<long>()==ipId
           &&x?["data"]?["ipType"]?.GetValue<string>()=="发明专利"))
            throw new IOException("MCP 专利未进入现有知识产权台账。");
        await McpLocal.RunSmokeToolAsync("update_ip",
            System.Text.Json.JsonSerializer.SerializeToElement(new {
                workspace="company",ip_id=ipId,name="MCP 专利名称已修改",remarks="仅修改部分字段"
            }));
        var afterIpUpdate=await McpLocal.RunSmokeToolAsync("list_ips",
            System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company"}));
        var updatedIp=afterIpUpdate.AsArray().FirstOrDefault(x=>x?["id"]?.GetValue<long>()==ipId);
        if(updatedIp?["data"]?["name"]?.GetValue<string>()!="MCP 专利名称已修改"||
           updatedIp?["data"]?["applicationNo"]?.GetValue<string>()!="CN202610000001.0"||
           updatedIp?["data"]?["status"]?.GetValue<string>()!="实质审查中")
            throw new IOException("MCP 修改专利未保留原有申请号或审查状态。");
        bool crossIpDenied=false;
        try
        {
            await McpLocal.RunSmokeToolAsync("update_ip",
                System.Text.Json.JsonSerializer.SerializeToElement(new {
                    workspace="personal",ip_id=ipId,name="跨区错误修改"
                }));
        }
        catch(IOException ex)when(ex.Message.Contains("404")||
            ex.Message.Contains("不属于当前工作区"))
        {crossIpDenied=true;}
        if(!crossIpDenied)throw new IOException("MCP 未拦截跨工作区专利更新。");
        bool invalidIpDenied=false;
        try
        {
            await McpLocal.RunSmokeToolAsync("create_ip",
                System.Text.Json.JsonSerializer.SerializeToElement(new {
                    workspace="company",name="非法状态",ip_type="发明专利",status="已登记"
                }));
        }
        catch(IOException ex)when(ex.Message.Contains("所选状态不适用于"))
        {invalidIpDenied=true;}
        if(!invalidIpDenied)throw new IOException("MCP 未使用知识产权原状态校验。");
        // IP aliases now return V2 FolderIds; the legacy upload_files API
        // has unrelated legacy owner IDs and cannot accept a native IP.
        using(var ipRequest=new HttpRequestMessage(HttpMethod.Post,
            $"/api/v2/ip/company/{ipId}/files"){Content=new ByteArrayContent(bytes)})
        {
            ipRequest.Headers.Add("X-File-Name",Uri.EscapeDataString("mcp-native-ip.bin"));
            ipRequest.Headers.Add("X-Material-Category",Uri.EscapeDataString("申请材料"));
            using var response=await client.SendAsync(ipRequest);
            response.EnsureSuccessStatusCode();
        }
        var nativeFiles=await client.GetFromJsonAsync<System.Text.Json.JsonElement>(
            $"/api/v2/ip/company/{ipId}/files");
        var nativeFile=nativeFiles.EnumerateArray().Single(x=>
            x.GetProperty("materialCategory").GetString()=="申请材料");
        long ipFileId=nativeFile.GetProperty("fileId").GetInt64();
        byte[] recoveredIp=await client.GetByteArrayAsync(
            $"/api/v2/ip/company/{ipId}/files/{ipFileId}/versions/1/download");
        if(!recoveredIp.AsSpan().SequenceEqual(bytes))
            throw new IOException("MCP 创建的 V2 专利与原件不在同一身份空间。");
        var legacyIp=await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/ip/company");
        if(legacyIp.EnumerateArray().Any(x=>
            x.GetProperty("data").GetProperty("name").GetString()=="MCP 专利名称已修改"))
            throw new IOException("MCP 原名不应再次写入旧知识产权表。");
        await McpLocal.RunSmokeToolAsync("delete_ip",
            System.Text.Json.JsonSerializer.SerializeToElement(new {
                workspace="company",ip_id=ipId
            }));
        var ipTrash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        if(ipTrash==null||!ipTrash.Any(x=>x.Kind=="ip"&&x.Id==ipId))
            throw new IOException("MCP 专利删除没有进入回收站。");
        await McpLocal.RunSmokeToolAsync("delete_file",
            System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company",file_id=fileId}));
        await McpLocal.RunSmokeToolAsync("delete_contract",
            System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company",contract_id=contract}));
        await McpLocal.RunSmokeToolAsync("delete_project",
            System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company",project_id=project}));
        var trash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
        if(trash==null||!trash.Any(x=>x.Kind=="project"&&x.Id==project))
            throw new IOException("MCP 删除未进入回收站。");
        // V2 MCP tools are separate from legacy names: no dual-write on mutation.
        await NativeMcpSmoke.VerifyAsync(client);
        (await client.PostAsJsonAsync("/api/mcp",new McpAccessInput(false)))
            .EnsureSuccessStatusCode();
        rejected=false;
        try
        {
            await McpLocal.RunSmokeToolAsync("list_files",
                System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company"}));
        }
        catch(IOException ex)when(ex.Message.Contains("MCP 未授权")){rejected=true;}
        if(!rejected)throw new IOException("关闭 MCP 后 Agent 仍然能查询资料。");
        rejected=false;
        try
        {
            await McpLocal.RunSmokeToolAsync("v2_list_projects",
                System.Text.Json.JsonSerializer.SerializeToElement(new {workspace="company"}));
        }
        catch(IOException ex)when(ex.Message.Contains("MCP 未授权")){rejected=true;}
        if(!rejected)throw new IOException("MCP 关闭后不得读取 V2 资料。");
    }

    public static async Task Run(string address)
    {
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "IPSys-Web-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            string dbPath = System.IO.Path.Combine(dir, "smoke.db");
            string password = "test-" + Guid.NewGuid().ToString("N");
            string landing = await client.GetStringAsync("/");
            if (!landing.Contains("IPSys") || !landing.Contains("app.js") ||
                !landing.Contains("id=\"chooseWorkspace\"") ||
                !landing.Contains("id=\"sidebar\"") ||
                !landing.Contains("id=\"content\""))
                throw new IOException("新版主界面或工作区选择未成功加载。");
            string css = await client.GetStringAsync("/style.css");
            string javascript = await client.GetStringAsync("/app.js");
            // The actual IP page depends on a second embedded script. A missing
            // route can pass dotnet build while leaving the frozen UI unusable.
            string nativeIpJs = await client.GetStringAsync("/ip-v2.js");
            if (!landing.Contains("src=\"/ip-v2.js\"") ||
                !nativeIpJs.Contains("IPSysNativeIp") ||
                !javascript.Contains("IPSysNativeIp.load"))
                throw new IOException("V2 知识产权脚本未嵌入单 EXE 或页面未正确引用。");
            if (!css.Contains(":root") || !javascript.Contains("openForm") ||
                !javascript.Contains("function realDetail") ||
                !javascript.Contains("function mockDetail"))
                throw new IOException("新版主界面 CSS/JS 未完整加载。");
            using var previewResponse = await client.GetAsync("/ui-preview");
            previewResponse.EnsureSuccessStatusCode();
            string preview = await previewResponse.Content.ReadAsStringAsync();
            string previewPolicy = previewResponse.Headers.GetValues("Content-Security-Policy").Single();
            if (!preview.Contains("科研项目") || !preview.Contains("横向项目") ||
                !preview.Contains("个人资料") || !preview.Contains("公司资料") ||
                !preview.Contains("<script>") ||
                !previewPolicy.Contains("sandbox allow-scripts") ||
                !previewPolicy.Contains("connect-src 'none'"))
                throw new IOException("UI 预览缺失或未与真实业务数据隔离。");
            var open = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, password, true));
            open.EnsureSuccessStatusCode();
            string token = (await open.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("token").GetString()!;
            client.DefaultRequestHeaders.Add("X-IPSys-Token", token);

            var record = await client.PostAsJsonAsync("/api/records/company", new TitleInput("测试资料"));
            record.EnsureSuccessStatusCode();
            long id = (await record.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();

            // Real project CRUD, soft deletion, copy and cross-workspace transfer.
            var projectInput = new ProjectInput("采矿研发项目", "科研项目", "XM-001",
                "负责人甲", "研发中心", "2026-01-01", "", "", "", "测试记录", "");
            var projectCreate = await client.PostAsJsonAsync("/api/projects/company", projectInput);
            projectCreate.EnsureSuccessStatusCode();
            long projectId = (await projectCreate.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var projectEdited = projectInput with { Name = "项目已修改", ProjectStatus = "进行中" };
            (await client.PutAsJsonAsync($"/api/projects/company/{projectId}", projectEdited)).EnsureSuccessStatusCode();
            var projectRecords = await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/company");
            if (projectRecords is null || projectRecords.Count != 1 ||
                projectRecords[0].Name != "项目已修改" ||
                projectRecords[0].ProjectStatus != "进行中")
                throw new IOException("真实项目新增、修改或状态默认值不正确。");
            var deniedProject = await client.PutAsJsonAsync($"/api/projects/personal/{projectId}", projectEdited);
            if (deniedProject.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("跨工作区不允许直接修改项目。");
            var invalidProject = await client.PostAsJsonAsync("/api/projects/company",
                projectEdited with { ProjectType = "无效类别" });
            if (invalidProject.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("项目固定类别未严格校验。");
            var noTokenProject = await new HttpClient { BaseAddress = new Uri(address) }
                .GetAsync("/api/projects/company");
            if (noTokenProject.StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("未登录不能查询项目。");
            // B03: a contract must belong to one active project. Only a project
            // detail may create a contract; the workspace aggregate is read-only.
            var contractInput = new ContractInput("科研技术服务合同", "HT-2026-001",
                "2026-10-12", "12.3", "甲方和乙方", "", "合同测试", "");
            var noParentContract = await client.PostAsJsonAsync(
                "/api/contracts/company", contractInput);
            if (noParentContract.IsSuccessStatusCode)
                throw new IOException("全部合同汇总接口不能独立新建合同。");
            var orphanContract = await client.PostAsJsonAsync(
                "/api/projects/company/987654321/contracts", contractInput);
            if (orphanContract.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("不得为不存在的项目新增合同。");
            var wrongScopeContract = await client.PostAsJsonAsync(
                $"/api/projects/personal/{projectId}/contracts", contractInput);
            if (wrongScopeContract.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("合同项目归属不能跨工作区。");
            var invalidContract = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/contracts",
                contractInput with { SignDate = "2026-99-99" });
            if (invalidContract.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("合同签订日期必须经过校验。");
            var negativeAmount = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/contracts",
                contractInput with { Amount = "-1" });
            if (negativeAmount.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("合同金额不能为负数。");
            var contractCreate = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/contracts", contractInput);
            contractCreate.EnsureSuccessStatusCode();
            long contractId = (await contractCreate.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var contractEdited = contractInput with { Name = "合同已修改", Amount = "0" };
            (await client.PutAsJsonAsync(
                $"/api/contracts/company/{contractId}", contractEdited)).EnsureSuccessStatusCode();
            var sourceContracts = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company");
            if (sourceContracts is null || sourceContracts.Count != 1 ||
                sourceContracts[0].ProjectId != projectId ||
                sourceContracts[0].ProjectName != "项目已修改" ||
                sourceContracts[0].Name != "合同已修改" || sourceContracts[0].Amount != "0")
                throw new IOException("合同必须关联所属项目且保留零金额。");
            var cannotEditOtherWorkspace = await client.PutAsJsonAsync(
                $"/api/contracts/personal/{contractId}", contractEdited);
            if (cannotEditOtherWorkspace.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("跨工作区直接修改合同应被拒绝。");
            using (var unauthenticated = new HttpClient { BaseAddress = new Uri(address) })
            {
                if ((await unauthenticated.GetAsync("/api/contracts/company"))
                        .StatusCode != HttpStatusCode.Unauthorized)
                    throw new IOException("无会话不得读取合同台账。");
            }
            var secondaryContract = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/contracts",
                contractInput with { Name = "待删除合同", Amount = "" });
            secondaryContract.EnsureSuccessStatusCode();
            long temporaryContract = (await secondaryContract.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            (await client.DeleteAsync($"/api/contracts/company/{temporaryContract}"))
                .EnsureSuccessStatusCode();
            if ((await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company"))?.Count != 1)
                throw new IOException("删除合同后不得在汇总台账继续显示。");
            // B05: business originals are scoped by their exact owning records.
            byte[] businessData=RandomNumberGenerator.GetBytes(1024*1024+23);
            var projectOriginal=await UploadBusinessFile(client,"company","project",
                projectId,businessData,"方案.pdf");
            var contractOriginal=await UploadBusinessFile(client,"company","contract",
                contractId,businessData,"合同原件.pdf");
            if(projectOriginal.Version!=1||contractOriginal.Version!=1)
                throw new IOException("业务附件首版本必须为 v1。");
            if(! (await client.GetByteArrayAsync(
                $"/api/business-files/company/download/{projectOriginal.Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("项目附件下载内容与原始数据不一致。");
            using(var otherWorkspace=new HttpClient{BaseAddress=new Uri(address)})
            {
                if((await otherWorkspace.GetAsync("/api/business-files/company"))
                    .StatusCode!=HttpStatusCode.Unauthorized)
                    throw new IOException("未登录不得读取业务附件列表。");
            }
            if((await client.GetAsync(
                $"/api/business-files/personal/download/{projectOriginal.Id}"))
                .StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("跨工作区不得下载原件。");
            using(var invalidUpload=new ByteArrayContent(businessData))
            using(var request=new HttpRequestMessage(HttpMethod.Post,
                "/api/business-files/company/project/999999999"){Content=invalidUpload})
            {
                request.Headers.Add("X-File-Name","not-owned.txt");
                if((await client.SendAsync(request)).StatusCode!=HttpStatusCode.NotFound)
                    throw new IOException("无主业务附件应拒绝写入。");
            }
            var clonedContract=await client.PostAsync(
                $"/api/contracts/company/{contractId}/copy",null);
            clonedContract.EnsureSuccessStatusCode();
            long clonedContractId=(await clonedContract.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var copiedFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(copiedFiles is null||!copiedFiles.Any(f=>f.Kind=="contract"&&
                f.OwnerId==clonedContractId&&f.Name=="合同原件.pdf"))
                throw new IOException("合同同项目复制必须携带关联原件。");
            (await client.DeleteAsync($"/api/contracts/company/{clonedContractId}"))
                .EnsureSuccessStatusCode();
            var copyProject = await client.PostAsJsonAsync(
                $"/api/projects/company/{projectId}/transfer",new ProjectTransfer("company", false));
            copyProject.EnsureSuccessStatusCode();
            long copiedProjectId = (await copyProject.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var projectsWithFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(projectsWithFiles is null||
                !projectsWithFiles.Any(f=>f.Kind=="project"&&f.OwnerId==copiedProjectId)||
                !projectsWithFiles.Any(f=>f.Kind=="contract"&&f.OwnerId!=contractId&&
                    f.OwnerId!=clonedContractId))
                throw new IOException("复制项目必须携带自身及子合同的原件。");
            var afterProjectCopy = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company");
            if (afterProjectCopy is null || afterProjectCopy.Count != 2 ||
                afterProjectCopy.Count(c => c.ProjectId == copiedProjectId) != 1 ||
                afterProjectCopy.Count(c => c.ProjectId == projectId) != 1)
                throw new IOException("复制项目未连同有效合同生成新的独立关联记录。");
            var moveProject = await client.PostAsJsonAsync(
                $"/api/projects/company/{copiedProjectId}/transfer",new ProjectTransfer("personal", true));
            moveProject.EnsureSuccessStatusCode();
            long movedProjectId = (await moveProject.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var movedFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/personal");
            if(movedFiles is null ||
                !movedFiles.Any(f=>f.Kind=="project"&&f.OwnerId==movedProjectId)||
                !movedFiles.Any(f=>f.Kind=="contract"))
                throw new IOException("项目转移时文件与子合同附件必须保留。");
            var movedContracts = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/personal");
            if (movedContracts is null || movedContracts.Count != 1 ||
                movedContracts[0].ProjectId != movedProjectId ||
                movedContracts[0].Workspace != "personal" ||
                movedContracts[0].Name != "合同已修改")
                throw new IOException("跨工作区转移项目时必须保留新项目下的合同关系。");
            var hiddenOldCopy = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company");
            if (hiddenOldCopy is null || hiddenOldCopy.Count != 1 ||
                hiddenOldCopy[0].ProjectId != projectId)
                throw new IOException("转移后源项目所属合同应从原工作区隐藏。");
            var inPersonal = await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/personal");
            if (inPersonal is null || inPersonal.Count != 1 ||
                inPersonal[0].Name != "项目已修改")
                throw new IOException("项目跨工作区转移失败。");
            (await client.DeleteAsync($"/api/projects/company/{projectId}")).EnsureSuccessStatusCode();
            var deletedProjects = await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/company");
            if (deletedProjects is null || deletedProjects.Count != 0)
                throw new IOException("项目软删除后不应继续在台账显示。");
            if ((await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/company"))?.Count != 0)
                throw new IOException("原项目软删除后所属合同不得单独出现在汇总视图。");
            // IP register: seven fixed types, type-scoped statuses and persistence.
            var ipCreate = await client.PostAsJsonAsync("/api/ip/company",
                new {name="测试发明",ipType="发明专利",status="已申请",applicationNo="CN-2026-01"});
            ipCreate.EnsureSuccessStatusCode();
            long ipId=(await ipCreate.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var ipEdit = await client.PutAsJsonAsync($"/api/ip/company/{ipId}",
                new {name="已修改发明",ipType="发明专利",status="实质审查中",applicants="申请人甲"});
            ipEdit.EnsureSuccessStatusCode();
            var ipRows = await client.GetFromJsonAsync<List<IpView>>("/api/ip/company");
            if(ipRows is null || ipRows.Count!=1 || ipRows[0].Data.Name!="已修改发明" ||
                ipRows[0].Data.Applicants!="申请人甲")
                throw new IOException("知识产权创建或修改后未持久化。");
            var ipIllegal = await client.PostAsJsonAsync("/api/ip/company",
                new {name="无效状态",ipType="软件著作权",status="已授权"});
            if(ipIllegal.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("不同知识产权类型的状态必须分别校验。");
            var ipWrongWorkspace=await client.DeleteAsync($"/api/ip/personal/{ipId}");
            if(ipWrongWorkspace.StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("跨工作区删除知识产权必须拒绝。");
            var ipOriginal=await UploadBusinessFile(client,"company","ip",ipId,
                businessData,"专利申请书.pdf",category:"申请材料");
            var ipNextVersion=await UploadBusinessFile(client,"company","ip",ipId,
                businessData,"专利申请书.pdf",category:"申请材料");
            if(ipOriginal.Version!=1||ipNextVersion.Version!=2)
                throw new IOException("知识产权同名同类别附件应生成历史版本。");
            if((await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company"))?.Count(f=>f.Kind=="ip"&&f.OwnerId==ipId)!=2)
                throw new IOException("同名版本必须保留两份真实元数据。");
            var ipCopy=await client.PostAsJsonAsync(
                $"/api/ip/company/{ipId}/transfer",new IpTransfer("company",false));
            ipCopy.EnsureSuccessStatusCode();
            long copiedIp=(await ipCopy.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var ipMove=await client.PostAsJsonAsync(
                $"/api/ip/company/{copiedIp}/transfer",new IpTransfer("personal",true));
            ipMove.EnsureSuccessStatusCode();
            var personalIpFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/personal");
            if(personalIpFiles is null||personalIpFiles.Count(f=>f.Kind=="ip")!=2)
                throw new IOException("知识产权跨工作区转移必须携带全部附件版本。");
            if(! (await client.GetByteArrayAsync(
                $"/api/business-files/personal/download/{personalIpFiles.First(f=>f.Kind=="ip").Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("转移知识产权后的原件下载校验失败。");

            (await client.DeleteAsync($"/api/ip/company/{ipId}")).EnsureSuccessStatusCode();
            if((await client.GetFromJsonAsync<List<IpView>>("/api/ip/company"))?.Count!=0 ||
               (await client.GetFromJsonAsync<List<IpView>>("/api/ip/personal"))?.Count!=1)
                throw new IOException("知识产权删除、复制、转移结果不符合预期。");
            // B04 minimal archives: independent certificate scopes and the two
            // personal research-output views keep all records out of sample data.
            var companyCertificate = new ArchiveInput(
                "ISO体系证书", "企业资质", "公司测试证件", "测试");
            var certCreated = await client.PostAsJsonAsync(
                "/api/archives/company/certificate", companyCertificate);
            certCreated.EnsureSuccessStatusCode();
            long companyCertificateId = (await certCreated.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var certChange = companyCertificate with {Name="更新后的体系证书", Remarks="已修改"};
            (await client.PutAsJsonAsync(
                $"/api/archives/company/certificate/{companyCertificateId}",certChange))
                .EnsureSuccessStatusCode();
            var personalCertificate = await client.PostAsJsonAsync(
                "/api/archives/personal/certificate",
                new ArchiveInput("职称资格证书","职称资格","",""));
            personalCertificate.EnsureSuccessStatusCode();
            var allCompanyCerts=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate");
            var allPersonalCerts=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/certificate");
            if (allCompanyCerts?.Count!=1 ||
                allCompanyCerts[0].Name!="更新后的体系证书" ||
                allCompanyCerts[0].Remarks!="已修改" ||
                allPersonalCerts?.Count!=1 ||
                allPersonalCerts[0].Name!="职称资格证书")
                throw new IOException("公司和个人资质证件的独立 CRUD 失败。");
            var crossCertEdit=await client.PutAsJsonAsync(
                $"/api/archives/personal/certificate/{companyCertificateId}",certChange);
            if(crossCertEdit.StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("跨工作区或模块修改证件必须拒绝。");
            var badArchive=await client.PostAsJsonAsync("/api/archives/personal/academic",
                new ArchiveInput("  ","论文论著","",""));
            if(badArchive.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("极简资料名称必填限制未生效。");
            var invalidModule=await client.GetAsync("/api/archives/company/academic");
            if(invalidModule.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("公司工作区不得读取个人学术模块。");
            using(var noArchiveToken=new HttpClient{BaseAddress=new Uri(address)})
            {
                if((await noArchiveToken.GetAsync("/api/archives/personal/certificate"))
                    .StatusCode!=HttpStatusCode.Unauthorized)
                    throw new IOException("未授权不能读取归档资料。");
            }
            var certFile=await UploadBusinessFile(client,"company","archive",
                companyCertificateId,businessData,"企业证书.pdf",section:"certificate");
            var invalidMaterial=await client.GetAsync("/api/business-files/company");
            invalidMaterial.EnsureSuccessStatusCode();
            var certCopy=await client.PostAsJsonAsync(
                $"/api/archives/company/certificate/{companyCertificateId}/transfer",
                new ArchiveTransfer("company","certificate",false));
            certCopy.EnsureSuccessStatusCode();
            long duplicateCertId=(await certCopy.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var copiedCertFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(copiedCertFiles is null || !copiedCertFiles.Any(f=>f.Kind=="archive"&&
                f.OwnerId==duplicateCertId&&f.Section=="certificate"))
                throw new IOException("归档证件复制应携带附件关联。");
            var crossCertificate=await client.PostAsJsonAsync(
                $"/api/archives/company/certificate/{companyCertificateId}/transfer",
                new ArchiveTransfer("personal","certificate",true));
            if(crossCertificate.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("公司资质证件不得直接转型为个人证件。");
            // Company certificate ordering must persist and reject incomplete/stale lists.
            var certOrderUrl="/api/archives/company/certificate/order";
            (await client.PostAsJsonAsync(certOrderUrl,new CompanyCertificateOrderInput(
                new[]{companyCertificateId,duplicateCertId}))).EnsureSuccessStatusCode();
            var reorderedCerts=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate");
            if(reorderedCerts is null || reorderedCerts.Select(x=>x.Id)
                    .SequenceEqual(new[]{companyCertificateId,duplicateCertId})==false)
                throw new IOException("公司资质自定义顺序没有从加密数据库读出。");
            if((await client.PostAsJsonAsync(certOrderUrl,new CompanyCertificateOrderInput(
                new[]{companyCertificateId,companyCertificateId}))).StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("排序接口必须拒绝重复记录编号。");
            if((await client.PostAsJsonAsync(certOrderUrl,new CompanyCertificateOrderInput(
                new[]{companyCertificateId}))).StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("排序接口必须拒绝遗漏记录的过期列表。");
            if((await client.PostAsJsonAsync(certOrderUrl,new CompanyCertificateOrderInput(
                new[]{companyCertificateId,allPersonalCerts![0].Id})))
                    .StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("排序接口必须拒绝个人资料的记录编号。");
            if((await client.PostAsJsonAsync(certOrderUrl,new CompanyCertificateOrderInput(
                new[]{companyCertificateId,companyCertificateId+9999})))
                    .StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("排序接口必须拒绝未知的企业资质记录编号。");
            var stillOrdered=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate");
            if(stillOrdered is null || stillOrdered.Select(x=>x.Id)
                    .SequenceEqual(new[]{companyCertificateId,duplicateCertId})==false)
                throw new IOException("无效排序请求不得改变此前保存的顺序。");
            using(var unauthorizedOrder=new HttpClient{BaseAddress=new Uri(address)})
            {
                if((await unauthorizedOrder.PostAsJsonAsync(certOrderUrl,
                    new CompanyCertificateOrderInput(new[]{companyCertificateId,duplicateCertId})))
                    .StatusCode!=HttpStatusCode.Unauthorized)
                    throw new IOException("未授权客户端不得调整企业资质顺序。");
            }
            (await client.DeleteAsync(
                $"/api/archives/company/certificate/{duplicateCertId}")).EnsureSuccessStatusCode();
            if((await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate"))?.Count!=1)
                throw new IOException("同工作区复制和软删除证书未按预期处理。");

            // The batch must be atomic and visible in the recycle bin.
            var batchUrl="/api/archives/company/certificate/batch-delete";
            var batchAdded=new List<long>();
            foreach(var name in new[]{"批量删除测试资质甲","批量删除测试资质乙"})
            {
                var add=await client.PostAsJsonAsync("/api/archives/company/certificate",
                    new ArchiveInput(name,"","",""));
                add.EnsureSuccessStatusCode();
                batchAdded.Add((await add.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                    .GetProperty("id").GetInt64());
            }
            if((await client.PostAsJsonAsync(batchUrl,
                new CompanyCertificateBatchDeleteInput(new[]{batchAdded[0],batchAdded[0]})))
                .StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("重复编号的企业资质批量删除必须拒绝。");
            if((await client.PostAsJsonAsync(batchUrl,
                new CompanyCertificateBatchDeleteInput(new[]{batchAdded[0],companyCertificateId+999999})))
                .StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("含不存在记录的批量删除必须整体拒绝。");
            if((await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate"))?.Count!=3)
                throw new IOException("非法批量删除不得部分软删除企业资质。");
            using(var unauthorizedBatch=new HttpClient{BaseAddress=new Uri(address)})
            {
                if((await unauthorizedBatch.PostAsJsonAsync(batchUrl,
                    new CompanyCertificateBatchDeleteInput(batchAdded.ToArray())))
                    .StatusCode!=HttpStatusCode.Unauthorized)
                    throw new IOException("未授权客户端不得批量删除企业资质。");
            }
            (await client.PostAsJsonAsync(batchUrl,
                new CompanyCertificateBatchDeleteInput(batchAdded.ToArray())))
                .EnsureSuccessStatusCode();
            if((await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate"))?.Count!=1)
                throw new IOException("企业资质批量删除未同步刷新活跃台账。");
            var batchTrash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
            if(batchTrash is null || batchAdded.Any(id=>
                !batchTrash.Any(item=>item.Kind=="archive"&&item.Id==id)))
                throw new IOException("批量软删除的企业资质必须全部进入回收站。");

            // Shared record-ledger order and batch soft-delete, isolated by type/workspace.
            var testIpIds=new List<long>();
            foreach(var testName in new[]{"统一列表测试甲","统一列表测试乙"})
            {
                var added=await client.PostAsJsonAsync("/api/ip/company",new {
                    name=testName,ipType="发明专利",status="准备中"
                });
                added.EnsureSuccessStatusCode();
                testIpIds.Add((await added.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                    .GetProperty("id").GetInt64());
            }
            var allIp=await client.GetFromJsonAsync<List<IpView>>("/api/ip/company")
                ??throw new IOException("统一知识产权台账读取失败。");
            var orderedIpIds=allIp.Select(x=>x.Id).Reverse().ToArray();
            var ipOrderPath="/api/ledger/company/ip/order";
            (await client.PostAsJsonAsync(ipOrderPath,new LedgerIdsInput(orderedIpIds))).EnsureSuccessStatusCode();
            var savedOrder=await client.GetFromJsonAsync<Dictionary<string,List<long>>>("/api/ledger/company/order");
            if(savedOrder is null||!savedOrder.TryGetValue("ip:",out var savedIp)||
                !savedIp.SequenceEqual(orderedIpIds))
                throw new IOException("跨刷新读取的知识产权自定义顺序不一致。");
            if((await client.PostAsJsonAsync(ipOrderPath,
                new LedgerIdsInput(new[]{testIpIds[0],testIpIds[0]})))
                .StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("排序必须拒绝重复或不完整的 ID 列表。");
            if((await client.PostAsJsonAsync("/api/ledger/personal/ip/order",
                new LedgerIdsInput(orderedIpIds)))
                .StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("不能把公司知识产权顺序写入个人工作区。");
            var ipBatchPath="/api/ledger/company/ip/batch-delete";
            if((await client.PostAsJsonAsync(ipBatchPath,
                new LedgerIdsInput(new[]{testIpIds[0],long.MaxValue})))
                .StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("带失效 ID 的批量删除必须整体回滚。");
            if((await client.GetFromJsonAsync<List<IpView>>("/api/ip/company"))?.Count!=allIp.Count)
                throw new IOException("失败的批量删除错误地移除了部分记录。");
            (await client.PostAsJsonAsync(ipBatchPath,
                new LedgerIdsInput(testIpIds.ToArray()))).EnsureSuccessStatusCode();
            var ipTrashAfterBatch=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
            if(ipTrashAfterBatch is null||testIpIds.Any(id=>
                !ipTrashAfterBatch.Any(x=>x.Kind=="legacy_ip"&&x.Id==id)))
                throw new IOException("批量删除知识产权必须进入公司回收站。");
            var projectIds=(await client.GetFromJsonAsync<List<ProjectView>>(
                "/api/projects/company"))!.Select(x=>x.Id).ToArray();
            (await client.PostAsJsonAsync("/api/ledger/company/project/order",
                new LedgerIdsInput(projectIds.Reverse().ToArray()))).EnsureSuccessStatusCode();
            var contractIds=(await client.GetFromJsonAsync<List<ContractView>>(
                "/api/contracts/company"))!.Select(x=>x.Id).ToArray();
            (await client.PostAsJsonAsync("/api/ledger/company/contract/order",
                new LedgerIdsInput(contractIds))).EnsureSuccessStatusCode();
            var personalArchiveIds=(await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/certificate"))!.Select(x=>x.Id).ToArray();
            (await client.PostAsJsonAsync("/api/ledger/personal/archive/order",
                new LedgerIdsInput(personalArchiveIds,"certificate"))).EnsureSuccessStatusCode();
            if((await client.PostAsJsonAsync("/api/ledger/company/archive/order",
                new LedgerIdsInput(new[]{companyCertificateId},"certificate")))
                .StatusCode!=HttpStatusCode.Conflict)
                throw new IOException("公司企业资质不得被新排序接口覆盖。");

            var personalAward=await client.PostAsJsonAsync(
                "/api/archives/personal/achievement",
                new ArchiveInput("矿山技术创新奖","个人奖励","获奖说明","奖项"));
            personalAward.EnsureSuccessStatusCode();
            var personalAcademic=await client.PostAsJsonAsync(
                "/api/archives/personal/academic",
                new ArchiveInput("学术任职证明","学术兼职","委员",""));
            personalAcademic.EnsureSuccessStatusCode();
            var companyOutput=await client.PostAsJsonAsync(
                "/api/archives/company/achievement",
                new ArchiveInput("企业科研成果","技术成果","研发表现","","2025"));
            companyOutput.EnsureSuccessStatusCode();
            long companyOutputId=(await companyOutput.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var firstCompanyOutput=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/achievement");
            if(firstCompanyOutput?.SingleOrDefault(a=>a.Id==companyOutputId)?.Year!="2025")
                throw new IOException("公司业务档案年份未正确写入或读取。");
            using(var badYear=await client.PutAsJsonAsync(
                $"/api/archives/company/achievement/{companyOutputId}",
                new ArchiveInput("企业科研成果","技术成果","研发表现","","20XX")))
                if(badYear.StatusCode!=HttpStatusCode.BadRequest)
                    throw new IOException("业务档案必须拒绝非法年份。");
            (await client.PutAsJsonAsync(
                $"/api/archives/company/achievement/{companyOutputId}",
                new ArchiveInput("企业科研成果","技术成果","研发表现","","2026")))
                .EnsureSuccessStatusCode();
            if((await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/achievement"))?.SingleOrDefault(a=>a.Id==companyOutputId)?.Year!="2026")
                throw new IOException("公司业务档案修改年份后未持久化。");
            // An existing company archive record may live under any folder depth.
            var roots=await client.GetFromJsonAsync<List<ArchiveFolderView>>("/api/archive-folders");
            if(roots is null || !roots.Any(f=>f.Name=="申报与认定"&&f.ParentId is null) ||
               !roots.Any(f=>f.Name=="技术成果"&&f.ParentId is null))
                throw new IOException("历史分类目录没有安全迁移或默认分类缺失。");
            // A user-created empty first-level archive category may be deleted from
            // the landing card, while the seven default root categories stay protected.
            using(var temporary=await client.PostAsJsonAsync("/api/archive-folders",
                new ArchiveFolderInput("临时自建分类",null)))
            {
                temporary.EnsureSuccessStatusCode();
                long temporaryId=(await temporary.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                    .GetProperty("id").GetInt64();
                using(var deleted=await client.DeleteAsync($"/api/archive-folders/{temporaryId}"))
                    deleted.EnsureSuccessStatusCode();
                var afterDelete=await client.GetFromJsonAsync<List<ArchiveFolderView>>("/api/archive-folders");
                if(afterDelete is null || afterDelete.Any(f=>f.Id==temporaryId))
                    throw new IOException("业务档案首页删除自建空分类后没有真正移除目录。");
            }
            var protectedDefault=roots.Single(f=>f.Name=="申报与认定"&&f.ParentId is null);
            using(var rejectDefaultDelete=await client.DeleteAsync(
                $"/api/archive-folders/{protectedDefault.Id}"))
                if(rejectDefaultDelete.StatusCode!=HttpStatusCode.Conflict)
                    throw new IOException("预设根分类不得从首页删除。");
            var technology=roots.Single(f=>f.Name=="技术成果"&&f.ParentId is null);
            long parent=technology.Id;
            foreach(string part in new[]{"企业行标","评审材料","2026年度"})
            {
                using var createFolder=await client.PostAsJsonAsync("/api/archive-folders",
                    new ArchiveFolderInput(part,parent));
                createFolder.EnsureSuccessStatusCode();
                parent=(await createFolder.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                    .GetProperty("id").GetInt64();
            }
            long deepest=parent;
            var deepFolders=await client.GetFromJsonAsync<List<ArchiveFolderView>>("/api/archive-folders");
            if(deepFolders is null || deepFolders.Count!=roots.Count+3 ||
               deepFolders.Single(f=>f.Id==deepest).Name!="2026年度")
                throw new IOException("第四、五级目录树没有持久化。");
            using(var rejectCycle=await client.PutAsJsonAsync(
                $"/api/archive-folders/{technology.Id}",
                new ArchiveFolderInput(technology.Name,deepest)))
                if(rejectCycle.StatusCode!=HttpStatusCode.Conflict)
                    throw new IOException("目录树不能允许移动到自身子目录形成循环。");
            using(var rejectNonempty=await client.DeleteAsync(
                $"/api/archive-folders/{technology.Id}"))
                if(rejectNonempty.StatusCode!=HttpStatusCode.Conflict)
                    throw new IOException("非空目录不应被直接删除。");
            using(var moveIntoFolder=await client.PutAsJsonAsync(
                $"/api/archives/company/achievement/{companyOutputId}",
                new ArchiveInput("企业科研成果","技术成果","研发表现","","2026",deepest)))
                moveIntoFolder.EnsureSuccessStatusCode();
            var movedArchive=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/achievement");
            if(movedArchive?.Single(a=>a.Id==companyOutputId).FolderId!=deepest)
                throw new IOException("旧资料归入深层目录后没有保留原 ID。");
            // A child folder and a record in the same parent can swap positions.
            using var addedPeer=await client.PostAsJsonAsync("/api/archive-folders",
                new ArchiveFolderInput("混排验收分类",deepest));
            addedPeer.EnsureSuccessStatusCode();
            long peerFolder=(await addedPeer.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var recordFirst=new ArchiveEntryReorder(deepest,new List<ArchiveEntryOrderItem>{
                new("record",companyOutputId),new("folder",peerFolder)});
            using(var order=await client.PostAsJsonAsync("/api/archive-entry-order",recordFirst))
                order.EnsureSuccessStatusCode();
            var orderStates=await client.GetFromJsonAsync<Dictionary<string,List<ArchiveEntryOrderItem>>>(
                "/api/archive-entry-order");
            if(orderStates is null || !orderStates.TryGetValue(deepest.ToString(),out var entries) ||
                entries.Count!=2 || entries[0].Kind!="record" || entries[0].Id!=companyOutputId ||
                entries[1].Kind!="folder" || entries[1].Id!=peerFolder)
                throw new IOException("公司业务档案目录与资料混排没有持久化。");
            using(var wrongScope=await client.PostAsJsonAsync("/api/archive-entry-order",
                new ArchiveEntryReorder(deepest,new List<ArchiveEntryOrderItem>{
                    new("record",companyOutputId)})))
                if(wrongScope.StatusCode!=HttpStatusCode.Conflict)
                    throw new IOException("混排接口未阻止漏项覆盖。");
            using(var wrongType=await client.PostAsJsonAsync("/api/archive-entry-order",
                new ArchiveEntryReorder(deepest,new List<ArchiveEntryOrderItem>{
                    new("record",companyOutputId),new("record",peerFolder)})))
                if(wrongType.StatusCode!=HttpStatusCode.Conflict)
                    throw new IOException("混排接口未区分目录与资料记录的 ID。");
            using(var folderFirst=await client.PostAsJsonAsync("/api/archive-entry-order",
                new ArchiveEntryReorder(deepest,new List<ArchiveEntryOrderItem>{
                    new("folder",peerFolder),new("record",companyOutputId)})))
                folderFirst.EnsureSuccessStatusCode();
            orderStates=await client.GetFromJsonAsync<Dictionary<string,List<ArchiveEntryOrderItem>>>(
                "/api/archive-entry-order");
            if(orderStates is null || orderStates[deepest.ToString()][0].Id!=peerFolder)
                throw new IOException("上移分类后混合排序没有保存。");
            using var promoted=await client.PostAsync(
                $"/api/archive-folders/from-record/{companyOutputId}",null);
            promoted.EnsureSuccessStatusCode();
            var promotionId=(await promoted.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            var retainedRecord=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/achievement");
            if(retainedRecord?.Single(a=>a.Id==companyOutputId).FolderId!=promotionId)
                throw new IOException("从已有资料建立下级分类时未保留资料记录。");
            var copyToPersonalAcademic=await client.PostAsJsonAsync(
                $"/api/archives/company/achievement/{companyOutputId}/transfer",
                new ArchiveTransfer("personal","academic",false));
            copyToPersonalAcademic.EnsureSuccessStatusCode();
            var sameCategoryMove=await client.PostAsJsonAsync(
                $"/api/archives/company/achievement/{companyOutputId}/transfer",
                new ArchiveTransfer("company","achievement",true));
            if(sameCategoryMove.StatusCode!=HttpStatusCode.BadRequest)
                throw new IOException("同类别原地转移应该拒绝。");
            var moveToPersonalAward=await client.PostAsJsonAsync(
                $"/api/archives/company/achievement/{companyOutputId}/transfer",
                new ArchiveTransfer("personal","achievement",true));
            moveToPersonalAward.EnsureSuccessStatusCode();
            var companyAfterMove=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/achievement");
            var personalAwards=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/achievement");
            var personalAcademics=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/academic");
            if(companyAfterMove?.Count!=0 || personalAwards?.Count!=2 ||
                personalAcademics?.Count!=2 ||
                !personalAcademics.Any(a=>a.Name=="学术任职证明"&&a.Category=="学术兼职") ||
                !personalAcademics.Any(a=>a.Name=="企业科研成果"&&a.Category=="技术成果"&&a.Year=="2026") ||
                !personalAwards.Any(a=>a.Name=="企业科研成果"&&a.Year=="2026"))
                throw new IOException("科研成果跨工作区复制/转移或多条学术记录不正确。");
            // B05b: recover a removed attachment link without removing another
            // active reference to the same immutable bytes.
            var associateTarget=await client.PostAsJsonAsync("/api/archives/company/certificate",
                new ArchiveInput("原件引用目标证书","职称","",""));
            associateTarget.EnsureSuccessStatusCode();
            long associateTargetId=(await associateTarget.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var associateCopy=await client.PostAsJsonAsync(
                $"/api/business-files/company/{certFile.Id}/associate",
                new BusinessAssociateInput("archive",associateTargetId,"certificate",false));
            associateCopy.EnsureSuccessStatusCode();
            var linkedCopies=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            var associatedFile=linkedCopies?.SingleOrDefault(f=>f.Kind=="archive"&&
                f.OwnerId==associateTargetId);
            if(associatedFile is null||
               !(await client.GetByteArrayAsync($"/api/business-files/company/download/{associatedFile.Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("同工作区附件引用复制未能复用可下载原件。");
            // B05b-2: the same shared logical original gets one new version
            // visible in all current references, but a same-name independent
            // original must not become part of that version chain.
            byte[] revisedBusinessData=RandomNumberGenerator.GetBytes(2037);
            var sharedUpdate=await UploadBusinessFile(client,"company","archive",
                associateTargetId,revisedBusinessData,"企业证书.pdf",section:"certificate",
                mode:"update",group:associatedFile.GroupId);
            var sharedRows=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(sharedRows is null||sharedUpdate.Version<=associatedFile.Version||
                !sharedRows.Any(x=>x.OwnerId==companyCertificateId&&x.GroupId==associatedFile.GroupId
                    &&x.Version==sharedUpdate.Version)||
                !(await client.GetByteArrayAsync(
                    $"/api/business-files/company/download/{sharedUpdate.Id}"))
                    .AsSpan().SequenceEqual(revisedBusinessData))
                throw new IOException("同工作区共享版本更新未同步至所有引用者。");
            var isolatedSameName=await UploadBusinessFile(client,"company","archive",
                associateTargetId,businessData,"企业证书.pdf",section:"certificate",
                mode:"new",duplicate:"reuse");
            if(!isolatedSameName.Reused)
                throw new IOException("显式复用相同内容时应命中当前工作区已存在的字节对象。");
            var sameNameGroups=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(sameNameGroups is null||
                sameNameGroups.Where(x=>x.OwnerId==associateTargetId&&x.Name=="企业证书.pdf")
                    .Select(x=>x.GroupId).Distinct().Count()!=2 ||
                isolatedSameName.Version!=1)
                throw new IOException("独立同名原件不能自动并入已有历史版本组。");
            // Two independently named logical groups may safely share one
            // physical object, and both can be associated into the same owner.
            (await client.PostAsJsonAsync(
                $"/api/business-files/company/{isolatedSameName.Id}/associate",
                new BusinessAssociateInput("archive",companyCertificateId,"certificate",false)))
                .EnsureSuccessStatusCode();
            var groupCopies=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(groupCopies is null||!groupCopies.Any(x=>x.OwnerId==companyCertificateId
                &&x.GroupId==sameNameGroups.Single(x=>x.Id==isolatedSameName.Id).GroupId) ||
                groupCopies.Where(x=>x.OwnerId==companyCertificateId
                    &&x.Name=="企业证书.pdf").Select(x=>x.GroupId).Distinct().Count()!=2)
                throw new IOException("同内容不同附件组应可在同一记录独立引用。");
            (await client.DeleteAsync(
                $"/api/business-files/company/{isolatedSameName.Id}")).EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync("/api/trash/company/purge",
                new RecycleRequest([new RecycleKey("file",isolatedSameName.Id,"")])))
                .EnsureSuccessStatusCode();

            (await client.DeleteAsync($"/api/business-files/company/{certFile.Id}")).EnsureSuccessStatusCode();
            var trashCompany=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
            if(trashCompany is null||!trashCompany.Any(r=>r.Kind=="file"&&r.Id==certFile.Id))
                throw new IOException("解除附件关联后回收站必须可找到原链接。");
            var restoredFile=await client.PostAsJsonAsync("/api/trash/company/restore",
                new RecycleRequest([new RecycleKey("file",certFile.Id,"")]));
            restoredFile.EnsureSuccessStatusCode();
            if(!(await client.GetByteArrayAsync($"/api/business-files/company/download/{certFile.Id}"))
                 .AsSpan().SequenceEqual(businessData))
                throw new IOException("回收站恢复后的附件 SHA-256 往返失败。");
            var moveTarget=await client.PostAsJsonAsync("/api/archives/company/certificate",
                new ArchiveInput("附件移动目标","证书","",""));
            moveTarget.EnsureSuccessStatusCode();
            long moveTargetId=(await moveTarget.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            (await client.PostAsJsonAsync($"/api/business-files/company/{certFile.Id}/associate",
                new BusinessAssociateInput("archive",moveTargetId,"certificate",true)))
                .EnsureSuccessStatusCode();
            var afterAssociateMove=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/company");
            if(afterAssociateMove is null||
                afterAssociateMove.Any(f=>f.Id==certFile.Id)||
                !afterAssociateMove.Any(f=>f.OwnerId==moveTargetId&&f.Name=="企业证书.pdf")||
                !afterAssociateMove.Any(f=>f.OwnerId==associateTargetId&&f.Name=="企业证书.pdf"))
                throw new IOException("移动附件时原关联必须隐藏，已共享的目标仍有效。");

            // Recovering a project restores its project-owned contracts and files.
            var recoveryProject=await client.PostAsJsonAsync("/api/projects/company",
                new ProjectInput("回收站项目","科研项目","","","","","","","","",""));
            recoveryProject.EnsureSuccessStatusCode();
            long recoveryProjectId=(await recoveryProject.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var recoveryContract=await client.PostAsJsonAsync(
                $"/api/projects/company/{recoveryProjectId}/contracts",
                new ContractInput("回收站合同","","","","","","",""));
            recoveryContract.EnsureSuccessStatusCode();
            long recoveryContractId=(await recoveryContract.Content
                .ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt64();
            var recoveryAttachment=await UploadBusinessFile(client,"company","contract",
                recoveryContractId,businessData,"合同附件.pdf");
            (await client.DeleteAsync($"/api/projects/company/{recoveryProjectId}"))
                .EnsureSuccessStatusCode();
            var recycleBefore=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
            if(recycleBefore is null||!recycleBefore.Any(r=>r.Kind=="project"&&r.Id==recoveryProjectId)||
                recycleBefore.Any(r=>r.Kind=="contract"&&r.Id==recoveryContractId))
                throw new IOException("已删除项目应连同子合同归属进入回收站。");
            (await client.PostAsJsonAsync("/api/trash/company/restore",
                new RecycleRequest([new RecycleKey("project",recoveryProjectId,"")])))
                .EnsureSuccessStatusCode();
            if(!(await client.GetByteArrayAsync(
                $"/api/business-files/company/download/{recoveryAttachment.Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("恢复项目必须使所属合同原件重新可下载。");
            (await client.DeleteAsync($"/api/projects/company/{recoveryProjectId}"))
                .EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync("/api/trash/company/purge",
                new RecycleRequest([new RecycleKey("project",recoveryProjectId,"")])))
                .EnsureSuccessStatusCode();
            if((await client.GetAsync(
                $"/api/business-files/company/download/{recoveryAttachment.Id}"))
                .StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("永久删除项目及其合同后原附件不能继续访问。");
            // Purging another reference must not remove data shared by a valid owner.
            (await client.DeleteAsync($"/api/archives/company/certificate/{moveTargetId}"))
                .EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync("/api/trash/company/purge",
                new RecycleRequest([new RecycleKey("archive",moveTargetId,"certificate")])))
                .EnsureSuccessStatusCode();
            if(!(await client.GetByteArrayAsync(
                $"/api/business-files/company/download/{associatedFile.Id}"))
                .AsSpan().SequenceEqual(businessData))
                throw new IOException("永久删除一处引用不能删除仍被其它记录引用的原件。");
            (await client.DeleteAsync($"/api/archives/company/certificate/{associateTargetId}"))
                .EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync("/api/trash/company/purge",
                new RecycleRequest([new RecycleKey("archive",associateTargetId,"certificate")])))
                .EnsureSuccessStatusCode();
            var data = RandomNumberGenerator.GetBytes(1024 * 1024 + 31);
            using var body = new ByteArrayContent(data);
            body.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            // X-File-Name is a request header, not a content header.
            using var req = new HttpRequestMessage(HttpMethod.Post, $"/api/records/company/{id}/files")
                { Content = body };
            req.Headers.Add("X-File-Name", Uri.EscapeDataString("test.bin"));
            var uploaded = await client.SendAsync(req);
            uploaded.EnsureSuccessStatusCode();
            long fileId = (await uploaded.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("id").GetInt64();
            byte[] exported = await client.GetByteArrayAsync($"/api/files/company/{fileId}");
            if (!exported.AsSpan().SequenceEqual(data)) throw new IOException("文件往返不一致。");
            var isolated = await client.GetAsync($"/api/files/personal/{fileId}");
            if (isolated.StatusCode != HttpStatusCode.NotFound) throw new IOException("工作区数据越权。");
            // Legacy general files: same-name independent group, version update,
            // soft-delete, restore, and permanent purge must preserve the original.
            async Task<long> SendGeneral(byte[] content,string mode,string group="")
            {
                using var uploadContent=new ByteArrayContent(content);
                using var request=new HttpRequestMessage(HttpMethod.Post,
                    $"/api/records/company/{id}/files"){Content=uploadContent};
                request.Headers.Add("X-File-Name",Uri.EscapeDataString("test.bin"));
                request.Headers.Add("X-Upload-Mode",mode);
                if(group.Length>0)request.Headers.Add("X-File-Group",group);
                using var response=await client.SendAsync(request);
                response.EnsureSuccessStatusCode();
                var result=await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
                return result.GetProperty("id").GetInt64();
            }
            var generalBefore=await client.GetFromJsonAsync<List<RecordView>>("/api/records/company");
            var generalGroup=generalBefore!.Single(r=>r.Id==id).Files.Single(f=>f.Id==fileId).GroupId;
            long independentGeneralId=await SendGeneral(data,"new");
            long generalNewVersionId=await SendGeneral(data,"update",generalGroup);
            var generalVersions=await client.GetFromJsonAsync<List<RecordView>>("/api/records/company");
            var updatedGeneral=generalVersions!.Single(r=>r.Id==id).Files;
            if(updatedGeneral.Count!=3||updatedGeneral.Select(x=>x.GroupId).Distinct().Count()!=2||
                updatedGeneral.Single(x=>x.Id==generalNewVersionId).Version!=2)
                throw new IOException("旧综合资料的独立同名原件与新版分组错误。");
            (await client.DeleteAsync($"/api/files/company/{independentGeneralId}"))
                .EnsureSuccessStatusCode();
            if((await client.GetAsync($"/api/files/company/{independentGeneralId}"))
                 .StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("被移除的综合资料附件仍可下载。");
            var generalTrash=await client.GetFromJsonAsync<List<RecycleItem>>("/api/trash/company");
            if(generalTrash is null||!generalTrash.Any(x=>x.Kind=="general_file"&&x.Id==independentGeneralId))
                throw new IOException("通用附件软删除未进入回收站。");
            (await client.PostAsJsonAsync("/api/trash/company/restore",
                new RecycleRequest([new RecycleKey("general_file",independentGeneralId,"")])))
                .EnsureSuccessStatusCode();
            if(!(await client.GetByteArrayAsync($"/api/files/company/{independentGeneralId}"))
                .AsSpan().SequenceEqual(data))
                throw new IOException("综合资料附件恢复后字节不一致。");
            (await client.DeleteAsync($"/api/files/company/{independentGeneralId}"))
                .EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync("/api/trash/company/purge",
                new RecycleRequest([new RecycleKey("general_file",independentGeneralId,"")])))
                .EnsureSuccessStatusCode();
            (await client.DeleteAsync($"/api/files/company/{generalNewVersionId}"))
                .EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync("/api/trash/company/purge",
                new RecycleRequest([new RecycleKey("general_file",generalNewVersionId,"")])))
                .EnsureSuccessStatusCode();
            (await client.DeleteAsync($"/api/records/company/{id}"))
                .EnsureSuccessStatusCode();
            if((await client.GetAsync($"/api/files/company/{fileId}"))
                .StatusCode!=HttpStatusCode.NotFound)
                throw new IOException("删除综合资料后原件应不可访问。");
            (await client.PostAsJsonAsync("/api/trash/company/restore",
                new RecycleRequest([new RecycleKey("general",id,"")])))
                .EnsureSuccessStatusCode();
            if(!(await client.GetByteArrayAsync($"/api/files/company/{fileId}"))
                .AsSpan().SequenceEqual(data))
                throw new IOException("恢复综合资料记录后旧附件丢失。");
            // First persisted business edit: update a general-record title, preserving
            // its attachment and refusing unauthorized/cross-workspace updates.
            using var anonymous = new HttpClient { BaseAddress = new Uri(address) };
            var noTokenEdit = await anonymous.PutAsJsonAsync(
                $"/api/records/company/{id}", new TitleInput("匿名修改"));
            if (noTokenEdit.StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("未登录请求不得修改资料名称。");
            var wrongWorkspaceEdit = await client.PutAsJsonAsync(
                $"/api/records/personal/{id}", new TitleInput("越权修改"));
            if (wrongWorkspaceEdit.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("不得通过其它工作区修改资料。");
            var emptyEdit = await client.PutAsJsonAsync(
                $"/api/records/company/{id}", new TitleInput("   "));
            if (emptyEdit.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("资料名称不允许为空。");
            var oversizedEdit = await client.PutAsJsonAsync(
                $"/api/records/company/{id}", new TitleInput(new string('字', 301)));
            if (oversizedEdit.StatusCode != HttpStatusCode.BadRequest)
                throw new IOException("资料名称不得超过 300 字。");
            var unknownEdit = await client.PutAsJsonAsync(
                "/api/records/company/987654321", new TitleInput("不存在的记录"));
            if (unknownEdit.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("不存在的资料不能修改。");
            using var updated = await client.PutAsJsonAsync(
                $"/api/records/company/{id}", new TitleInput("  测试资料（已修改）  "));
            updated.EnsureSuccessStatusCode();
            var afterEdit = await client.GetFromJsonAsync<List<RecordView>>("/api/records/company");
            if (afterEdit is null || afterEdit.Count != 1 ||
                afterEdit[0].Title != "测试资料（已修改）" ||
                afterEdit[0].Files.Count != 1 || afterEdit[0].Files[0].Id != fileId)
                throw new IOException("修改名称后记录、工作区或原有附件发生异常。");
            var otherWorkspaceRows = await client.GetFromJsonAsync<List<RecordView>>("/api/records/personal");
            if (otherWorkspaceRows is null || otherWorkspaceRows.Count != 0)
                throw new IOException("修改记录后个人工作区发生数据泄漏。");
            var stillExported = await client.GetByteArrayAsync($"/api/files/company/{fileId}");
            if (!stillExported.AsSpan().SequenceEqual(data))
                throw new IOException("修改资料名称后附件原件内容发生变化。");
            var check = await client.GetAsync("/api/check");
            check.EnsureSuccessStatusCode();
            // Simulate closing the browser tab: a second browser has NO session token.
            using var newTab = new HttpClient { BaseAddress = new Uri(address) };
            var badResume = await newTab.PostAsJsonAsync("/api/resume", new ResumeInput("wrong"));
            if (badResume.IsSuccessStatusCode)
                throw new IOException("错误密码不应恢复会话。");
            if ((await newTab.GetAsync("/api/records/company")).StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("未认证的新标签页不得读取业务记录。");

            var restored = await newTab.PostAsJsonAsync("/api/resume", new ResumeInput(password));
            restored.EnsureSuccessStatusCode();
            string restoredToken = (await restored.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("token").GetString()!;
            newTab.DefaultRequestHeaders.Add("X-IPSys-Token", restoredToken);
            var restoredRecords = await newTab.GetAsync("/api/records/company");
            restoredRecords.EnsureSuccessStatusCode();
            string bodyText = await restoredRecords.Content.ReadAsStringAsync();
            if (!bodyText.Contains("测试资料（已修改）"))
                throw new IOException("恢复会话后没有读到已修改的记录。");
            // Reauthorization must not invalidate the original live tab.
            (await client.GetAsync("/api/check")).EnsureSuccessStatusCode();

            using var locked = await client.PostAsync("/api/lock", null);
            locked.EnsureSuccessStatusCode();
            // Locking must invalidate the recovered tab as well.
            if ((await newTab.GetAsync("/api/records/company")).StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("关闭数据库后旧会话未失效。");
            var resumeAfterLock = await newTab.PostAsJsonAsync("/api/resume", new ResumeInput(password));
            if (resumeAfterLock.IsSuccessStatusCode)
                throw new IOException("关闭数据库后不得恢复会话。");
            client.DefaultRequestHeaders.Remove("X-IPSys-Token");
            var bad = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, "wrong", false));
            if (bad.IsSuccessStatusCode) throw new IOException("错误密码竟能打开。");
            var again = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, password, false));
            again.EnsureSuccessStatusCode();
            string newToken = (await again.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("token").GetString()!;
            client.DefaultRequestHeaders.Add("X-IPSys-Token", newToken);
            var afterReopenFiles=await client.GetFromJsonAsync<List<BusinessFileView>>(
                "/api/business-files/personal");
            if(afterReopenFiles is null||
                !afterReopenFiles.Any(f=>f.Kind=="project"&&f.OwnerId==movedProjectId)||
                afterReopenFiles.Count(f=>f.Kind=="ip")!=2)
                throw new IOException("重开资料库后业务原件元数据丢失。");
            var persistedIp = await client.GetFromJsonAsync<List<IpView>>("/api/ip/personal");
            if(persistedIp is null || persistedIp.Count!=1 ||
                persistedIp[0].Data.Name!="已修改发明" || persistedIp[0].Data.Status!="实质审查中")
                throw new IOException("重新打开加密库后知识产权转移数据丢失。");
            var persistedCompanyCertificates=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/company/certificate");
            var persistedPersonalCertificates=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/certificate");
            var persistedAwards=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/achievement");
            var persistedAcademic=await client.GetFromJsonAsync<List<ArchiveView>>(
                "/api/archives/personal/academic");
            if(persistedCompanyCertificates?.Count!=1 ||
                persistedPersonalCertificates?.Count!=1 ||
                persistedAwards?.Count!=2 || persistedAcademic?.Count!=2)
                throw new IOException("重新打开加密库后 B04 资料缺少或工作区不一致。");
            var restoredContracts = await client.GetFromJsonAsync<List<ContractView>>("/api/contracts/personal");
            if (restoredContracts is null || restoredContracts.Count != 1 ||
                restoredContracts[0].ProjectId != movedProjectId ||
                restoredContracts[0].Name != "合同已修改")
                throw new IOException("关闭重开数据库后合同项目关系未能持久化。");
            var recoveredProject = await client.GetFromJsonAsync<List<ProjectView>>("/api/projects/personal");
            if (recoveredProject is null || recoveredProject.Count != 1 ||
                recoveredProject[0].ProjectStatus != "进行中")
                throw new IOException("关闭重开后项目转移结果未持久化。");
            var persisted = await client.GetFromJsonAsync<List<RecordView>>("/api/records/company");
            if (persisted is null || persisted.Count != 1 ||
                persisted[0].Title != "测试资料（已修改）" ||
                persisted[0].Files.Count != 1 || persisted[0].Files[0].Id != fileId)
                throw new IOException("数据库重新打开后修改的名称或附件未能持久化。");
            // A prior browser tab must not touch the newly opened database.
            using var staleTab = new HttpClient { BaseAddress = new Uri(address) };
            staleTab.DefaultRequestHeaders.Add("X-IPSys-Token", token);
            if ((await staleTab.GetAsync("/api/records/company")).StatusCode != HttpStatusCode.Unauthorized ||
                (await staleTab.GetAsync($"/api/files/company/{fileId}")).StatusCode != HttpStatusCode.Unauthorized ||
                (await staleTab.GetAsync("/api/check")).StatusCode != HttpStatusCode.Unauthorized ||
                (await staleTab.PostAsync("/api/lock", null)).StatusCode != HttpStatusCode.Unauthorized)
                throw new IOException("旧标签令牌不得访问或关闭新会话的数据库。");
            (await client.GetAsync("/api/check")).EnsureSuccessStatusCode();
            // Real MCP pipe, authorization gate, CRUD and source-byte roundtrip.
            // All writes occur in a disposable SQLCipher smoke database.
            await VerifyMcpAsync(client,dir);
            await VerifyExcelAsync(client);
            await VerifySecondExcelBatchAsync(client);
            await SearchSmoke.VerifyAsync(client);
            await NativeIpSearchRecycleHttpSmoke.VerifyAsync(client);
            await NativeIpTransferHttpSmoke.VerifyAsync(client);
            await FolderBrowserSmoke.VerifyAsync(client);
            await FolderCommandSmoke.VerifyAsync(client);
            await FolderArchiveCommandSmoke.VerifyAsync(client);
            await GeneralFolderCommandSmoke.VerifyAsync(client);
            await FolderTransferHttpSmoke.VerifyAsync(client);
            await NativeFolderHttpSmoke.VerifyAsync(client);
            await NativeArchiveHttpSmoke.VerifyAsync(client);
            await NativeFileHttpSmoke.VerifyAsync(client);
            await NativeFileLinkHttpSmoke.VerifyAsync(client);
            await NativeFileCopyHttpSmoke.VerifyAsync(client);
            await NativeFileChoiceHttpSmoke.VerifyAsync(client);
            await NativeIpFileHttpSmoke.VerifyAsync(client);
            await NativeIpExcelHttpSmoke.VerifyAsync(client);
            await NativeIpUiHttpSmoke.VerifyAsync(client);
            using var finalLock = await client.PostAsync("/api/lock", null);
            finalLock.EnsureSuccessStatusCode();

            // A paused HTTP upload verifies browser close-db safety without GUI timing.
            var lastOpen = await client.PostAsJsonAsync("/api/open", new OpenInput(dbPath, password, false));
            lastOpen.EnsureSuccessStatusCode();
            string lastToken = (await lastOpen.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
                .GetProperty("token").GetString()!;
            client.DefaultRequestHeaders.Remove("X-IPSys-Token");
            client.DefaultRequestHeaders.Add("X-IPSys-Token", lastToken);
            using var paused = new PausedUploadContent();
            using var slowRequest = new HttpRequestMessage(HttpMethod.Post,
                $"/api/records/company/{id}/files") { Content = paused };
            slowRequest.Headers.Add("X-File-Name", Uri.EscapeDataString("paused.bin"));
            Task<HttpResponseMessage> runningUpload = client.SendAsync(slowRequest);
            await paused.FirstChunkSent.WaitAsync(TimeSpan.FromSeconds(10));
            bool active = false;
            for (int i = 0; i < 80; ++i)
            {
                var taskState = await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/task");
                active = taskState.GetProperty("active").GetBoolean();
                if (active) break;
                await Task.Delay(50);
            }
            if (!active) throw new IOException("慢速上传未被标识为进行中的文件任务。");
            // The browser must not have any program-exit endpoint, even during upload.
            using var deniedWebExit = await client.PostAsync("/api/exit", null);
            if (deniedWebExit.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("网页不得调用退出 WinForms 程序的 HTTP 接口。");
            using var prematureLock = await client.PostAsync("/api/lock", null);
            if (prematureLock.StatusCode != HttpStatusCode.Conflict)
                throw new IOException("上传期间不得直接关闭数据库。");
            var stillOpen = await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/task");
            if (!stillOpen.GetProperty("active").GetBoolean() ||
                stillOpen.GetProperty("exiting").GetBoolean())
                throw new IOException("网页尝试关库不得中止任务或触发程序退出。");
            paused.Release();
            using var uploadResult = await runningUpload.WaitAsync(TimeSpan.FromSeconds(10));
            uploadResult.EnsureSuccessStatusCode();
            using var closed = await client.PostAsync("/api/lock", null);
            closed.EnsureSuccessStatusCode();
            var hostStatus = await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/status");
            if (hostStatus.GetProperty("unlocked").GetBoolean())
                throw new IOException("关闭数据库后仍处于解锁状态。");
            using var noExit = await client.PostAsync("/api/exit", null);
            if (noExit.StatusCode != HttpStatusCode.NotFound)
                throw new IOException("关库后网页仍不应拥有程序退出接口。");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }
}

// HTTP body sends a first chunk then pauses, permitting reproducible exit tests.
sealed class PausedUploadContent : HttpContent
{
    private readonly TaskCompletionSource<bool> _first = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource<bool> _release = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task FirstChunkSent => _first.Task;
    public void Release() => _release.TrySetResult(true);
    public PausedUploadContent()
    {
        Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
    }
    protected override bool TryComputeLength(out long length) { length = 8192; return true; }
    protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
        SendBodyAsync(stream, CancellationToken.None);
    protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context,
        CancellationToken cancellationToken) => SendBodyAsync(stream, cancellationToken);
    private async Task SendBodyAsync(Stream stream, CancellationToken cancellation)
    {
        await stream.WriteAsync(new byte[4096], cancellation);
        await stream.FlushAsync(cancellation);
        _first.TrySetResult(true);
        await _release.Task.WaitAsync(cancellation);
        await stream.WriteAsync(new byte[4096], cancellation);
    }
}
