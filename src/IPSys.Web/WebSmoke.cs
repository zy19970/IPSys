using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

// All HTTP regression scenarios run against a disposable V2-only SQLCipher vault.
// No V1 table, endpoint, or historical record ID is created in --smoke.
static class WebSmoke
{
    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using(response)
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
    }

    public static async Task Run(string address,Vault vault)
    {
        using var client=new HttpClient{BaseAddress=new Uri(address)};
        bool large=Environment.GetEnvironmentVariable("IPSYS_LARGE_FILE_SMOKE")=="1";
        if(large)client.Timeout=TimeSpan.FromHours(2);
        string dir=Path.Combine(Path.GetTempPath(),"IPSys-V2-"+
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        string dbPath=Path.Combine(dir,"smoke.db");
        string password="test-"+Guid.NewGuid().ToString("N");
        try
        {
            string landing=await client.GetStringAsync("/");
            string css=await client.GetStringAsync("/style.css");
            string app=await client.GetStringAsync("/app.js");
            string ip=await client.GetStringAsync("/ip-v2.js");
            string uploadProgressJs=await client.GetStringAsync("/upload-progress.js");
            string export=await client.GetStringAsync("/export.js");
            string pdf=await client.GetStringAsync("/pdf-preview.js");
            if(!landing.Contains("id=\"chooseWorkspace\"")||
                !landing.Contains("id=\"sidebar\"")||
                !landing.Contains("src=\"/ip-v2.js\"")||
                !css.Contains(":root")||!app.Contains("IPSysNativeIp.load")||
                !ip.Contains("IPSysNativeIp")||!uploadProgressJs.Contains("IPSysUploadProgress")||
                !export.Contains("IPSys")||
                pdf.Length<100)
                throw new IOException("内嵌网页和 V2 原件脚本不完整。");
            using(var preview=await client.GetAsync("/ui-preview"))
            {
                preview.EnsureSuccessStatusCode();
                string policy=preview.Headers.GetValues("Content-Security-Policy").Single();
                if(!policy.Contains("sandbox allow-scripts")||
                   !policy.Contains("connect-src 'none'"))
                    throw new IOException("UI 预览安全沙箱失效。");
            }

            using(var legacy=await client.GetAsync("/api/projects/company"))
                if(legacy.StatusCode!=HttpStatusCode.NotFound)
                    throw new IOException("旧业务 HTTP 不应在测试或正式运行注册。");
            var first=await Json(await client.PostAsJsonAsync("/api/open",
                new OpenInput(dbPath,password,true)));
            string token=first.GetProperty("token").GetString()!;
            client.DefaultRequestHeaders.Add("X-IPSys-Token",token);
            using(var duplicate=await client.PostAsJsonAsync("/api/open",
                new OpenInput(dbPath,password,true)))
                if(duplicate.IsSuccessStatusCode)
                    throw new IOException("打开中的资料库不能被覆盖。");

            string id=Guid.NewGuid().ToString("N")[..8];
            long project=(await Json(await client.PostAsJsonAsync(
                "/api/v2/folders/company/project",
                new{project=new{name="N4校验项目"+id,projectType="科研项目"}})))
                .GetProperty("id").GetInt64();

            // This suite is intentionally all-native. Historical V1 HTTP/Excel
            // and FolderProvider fixtures are not run or needed to create the vault.
            await NativeFolderHttpSmoke.VerifyAsync(client);
            await NativeArchiveHttpSmoke.VerifyAsync(client);
            await NativeFileHttpSmoke.VerifyAsync(client);
            if(large)await NativeLargeFileHttpSmoke.VerifyAsync(client,project);
            await NativeFileLinkHttpSmoke.VerifyAsync(client);
            await NativeFileAssociateSmoke.VerifyAsync(client);
            await NativeFileCopyHttpSmoke.VerifyAsync(client);
            await NativeFileChoiceHttpSmoke.VerifyAsync(client);
            await NativeIpFileHttpSmoke.VerifyAsync(client);
            await NativeIpExcelHttpSmoke.VerifyAsync(client);
            await NativeIpUiHttpSmoke.VerifyAsync(client);
            await NativeProjectContractUiHttpSmoke.VerifyAsync(client);
            await NativeProjectMilestoneSmoke.VerifyAsync(client);
            await NativeArchiveGeneralMilestoneSmoke.VerifyAsync(client);
            await NativeArchiveUiHttpSmoke.VerifyAsync(client);
            await NativeIpSearchRecycleHttpSmoke.VerifyAsync(client);
            await RecyclePurgeTaskHttpSmoke.VerifyAsync(client);
            await NativeIpTransferHttpSmoke.VerifyAsync(client);
            await SearchSmoke.VerifyAsync(client);

            using(var noAuth=new HttpClient{BaseAddress=client.BaseAddress})
            using(var unauth=await noAuth.GetAsync("/api/v2/search/company?q=N4"))
                if(unauth.StatusCode!=HttpStatusCode.Unauthorized)
                    throw new IOException("V2 搜索未执行会话认证。");
            using(var newTab=new HttpClient{BaseAddress=client.BaseAddress})
            {
                using(var wrong=await newTab.PostAsJsonAsync("/api/resume",
                    new ResumeInput("incorrect")))
                    if(wrong.IsSuccessStatusCode)
                        throw new IOException("错误密码不得恢复会话。");
                var resumed=await Json(await newTab.PostAsJsonAsync(
                    "/api/resume",new ResumeInput(password)));
                if(resumed.GetProperty("token").GetString()!=token)
                    throw new IOException("恢复会话错误地更换令牌。");
            }

            var mcp=await Json(await client.PostAsJsonAsync("/api/mcp",
                new McpAccessInput(true)));
            if(!mcp.GetProperty("enabled").GetBoolean())
                throw new IOException("本机 MCP 授权开关失败。");
            await NativeMcpSmoke.VerifyAsync(client,vault);
            await NativeMcpArchiveSmoke.VerifyAsync(client);
            (await client.PostAsJsonAsync("/api/mcp",
                new McpAccessInput(false))).EnsureSuccessStatusCode();

            var check=await Json(await client.GetAsync("/api/check"));
            if(check.GetProperty("result").GetString()!="ok"||
               check.GetProperty("incomplete").GetInt64()!=0)
                throw new IOException("V2 加密库完整性或未完成文件清理失败。");
            (await client.PostAsync("/api/lock",null)).EnsureSuccessStatusCode();
            client.DefaultRequestHeaders.Remove("X-IPSys-Token");
            using(var stale=new HttpClient{BaseAddress=client.BaseAddress})
            {
                stale.DefaultRequestHeaders.Add("X-IPSys-Token",token);
                using var blocked=await stale.GetAsync("/api/v2/search/company?q=N4");
                if(blocked.StatusCode!=HttpStatusCode.Unauthorized)
                    throw new IOException("关库后仍可使用旧令牌访问。");
            }
            using(var wrongOpen=await client.PostAsJsonAsync("/api/open",
                new OpenInput(dbPath,"wrong",false)))
                if(wrongOpen.IsSuccessStatusCode)
                    throw new IOException("错误 SQLCipher 密钥竟可打开数据库。");
            var reopened=await Json(await client.PostAsJsonAsync("/api/open",
                new OpenInput(dbPath,password,false)));
            string newToken=reopened.GetProperty("token").GetString()!;
            if(token==newToken)throw new IOException("重开资料库应重新生成会话令牌。");
            client.DefaultRequestHeaders.Add("X-IPSys-Token",newToken);
            var stored=await Json(await client.GetAsync(
                "/api/v2/folders/company/project/"+project));
            if(stored.GetProperty("folder").GetProperty("ref").GetProperty("id")
                .GetInt64()!=project)
                throw new IOException("V2 新库重开后项目身份未持久化。");
            var checkAgain=await Json(await client.GetAsync("/api/check"));
            if(checkAgain.GetProperty("result").GetString()!="ok")
                throw new IOException("重开后 SQLCipher integrity_check 失败。");

            // Hold an actual V2 file upload open to check browser close-db safety.
            using var paused=new PausedUploadContent();
            using var upload=new HttpRequestMessage(HttpMethod.Post,
                "/api/v2/files/company/upload?folderId="+project){Content=paused};
            upload.Headers.Add("X-File-Name",Uri.EscapeDataString("n4-paused.bin"));
            Task<HttpResponseMessage> task=client.SendAsync(upload);
            await paused.FirstChunkSent.WaitAsync(TimeSpan.FromSeconds(10));
            bool active=false;
            for(int i=0;i<80;i++)
            {
                var state=await client.GetFromJsonAsync<JsonElement>("/api/task");
                if(state.GetProperty("active").GetBoolean()){active=true;break;}
                await Task.Delay(50);
            }
            if(!active)throw new IOException("V2 慢速上传未进入文件任务状态。");
            using(var denied=await client.PostAsync("/api/lock",null))
                if(denied.StatusCode!=HttpStatusCode.Conflict)
                    throw new IOException("正在导入 V2 文件时禁止关库。");
            using(var noExit=await client.PostAsync("/api/exit",null))
                if(noExit.StatusCode!=HttpStatusCode.NotFound)
                    throw new IOException("网页不能退出 WinForms。");
            paused.Release();
            using(var done=await task.WaitAsync(TimeSpan.FromSeconds(15)))
                done.EnsureSuccessStatusCode();
            (await client.PostAsync("/api/lock",null)).EnsureSuccessStatusCode();
            var status=await client.GetFromJsonAsync<JsonElement>("/api/status");
            if(status.GetProperty("unlocked").GetBoolean())
                throw new IOException("关闭数据库后宿主仍认为已解锁。");
        }
        finally {try {Directory.Delete(dir,true);} catch {}}
        Console.WriteLine("V2-ONLY WEB SQLCIPHER SMOKE PASS");
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
