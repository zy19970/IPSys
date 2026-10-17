# IPSys 大文件（超 2 GiB）功能与验收

> 2026-10-17 实施方案。现行 V2 文件大小上限为 **8 GiB（8 × 1024³ bytes）/单文件**。该限制是本次引入的安全容量保护，不代表磁盘空间或数据库大小可以无限增长。是否实机验收通过，以 Windows CI 和用户目标电脑上的真实测试结果为准。

## 一、链路与设计

1. **网页上传与追加版本**：浏览器直接以 File/Blob 作为 request body，不用 FileReader/arrayBuffer 读取全部原件。ASP.NET Core Kestrel 保持其它 API 原有 66 MiB 默认请求上限；仅在两个原件上传入口（/api/v2/files/{workspace}/upload、/versions 及 /prepare）通过 IHttpMaxRequestBodySizeFeature 提升为 8 GiB。上传请求必须提供 Content-Length，超限拒绝。
2. **SQLCipher 实际原件**：NativeFileStore.UploadAsync 和 NativeFileChoiceStore.PrepareAsync 均以 1 MiB 缓冲区循环读入 SQLite file_chunks。长度使用 long，增量 SHA-256，检查实际与声明字节数一致；未完成事务回滚，不创建有效版本/关联。查重确认、追加版本、共享引用规则不改变。
3. **MCP**：本机绝对路径 FileStream 流式发送。同步 upload_files 增加长任务超时保护，但建议超过 2 GiB 的文件统一用 start_upload_task + get_task_status + get_operation_result。中断/未知结果不可自动重传。
4. **直接下载**：超过 32 MiB 的附件使用 Edge/Chrome File System Access API，由用户选择实际保存路径后，网络流直接写入 FileSystemWritableFileStream；校验下载总字节数，失败 abort。小文件继续使用 Blob 下载。超过 128 MiB 不启动浏览器 PDF/图片整文件预览（避免内存爆炸），改为下载打开。
5. **文件夹与 ZIP 导出**：文件夹已采用流式导出；ZIP 对累计大小接近 4 GiB、单条超 4 GiB 或文件数超过 65535 时启用 ZIP64，采用 64 位大小和偏移的头、描述符与中央目录，普通小文件仍使用经典 ZIP32。写入失败时中止 ZIP 并避免保留不完整文件。
6. **空间要求**：上传和跨工作区复制前仍执行可用空间预检，事务写入失败可回滚。大文件入库会显著占用加密数据库空间、SQLite 回滚日志与磁盘 I/O；需额外保留可用空间。写入过程中不要强行拔出唯一数据盘。

## 二、自动测试

常规 main push 的 Windows workflow：Debug、Release 单 EXE、SQLCipher/HTTP、MCP、Node UI、目录 ZIP 及新增 ZIP64 头/64 位字段检查。常规 CI 不每次制造 2 GiB 数据。

**真实超 2 GiB 往返专项**：GitHub Actions → `IPSys Windows build and smoke` → `Run workflow` → `large_file_smoke=true`；或在本次功能提交的说明中包含 `[large-file-test]` 时自动执行一次。专项通过 `IPSYS_LARGE_FILE_SMOKE=1` 激活，在临时 SQLCipher V2 测试库和真实 loopback HTTP 上用虚拟重复数据流生成 **2 GiB + 12,345 字节**，验证文件上传后保存的 long 字节数和 SHA-256，再将完整原件流式下载并再次核对总字节数与 SHA-256；不生成 2 GiB 源夹具、不调用 ReadAsByteArrayAsync。验收记录应保留 Actions run URL、HEAD、SUCCESS/FAIL、耗时、磁盘空间和失败日志。此测试可能长时间占用 Windows Runner，建议使用独立触发。

`src/IPSys.Web/tests/zip64-smoke.cjs` 独立验证 ZIP64 头、8 字节尺寸/偏移、64 位 EOCD 及兼容的普通 ZIP32 格式，无需一次性申请超过 4 GiB 内存。真实 ZIP64 文件与第三方解压软件互操作仍需人工测试。

## 三、Windows 用户实机测试（仅可丢弃资料库）

1. **生成测试文件**：在空间充足的 NTFS 数据盘上用 PowerShell 创建测试文件（填充逻辑零字节；不要在唯一重要资料目录操作）：

   ```powershell
   $p = "D:\\IPSys-test-over-2GiB.bin"
   $f = [System.IO.File]::Open($p, [System.IO.FileMode]::CreateNew)
   try { $f.SetLength(2147495993L) } finally { $f.Dispose() }
   Get-Item $p | Select-Object Name,Length
   Get-FileHash $p -Algorithm SHA256
   ```

2. **上传/历史版本**：在新建 SQLCipher V2 测试库中，创建一个项目或综合资料记录。用新版 Edge/Chrome 上传上述文件，选择“独立保存”，应有完成提示、实际字节数为 2,147,495,993 且 SHA 与源文件一致。再尝试追加新文件版本，核对 FileId 不变、Version 递增、旧版下载不改变。
3. **下载与检索**：使用“下载”选择新的目标文件；比较来源与下载文件的 Length、SHA-256。再次登录数据库、查找资料并重新下载验证。不要通过浏览器页面对超大 PDF 直接预览。
4. **ZIP64**：在空间许可时准备两份各大于 2 GiB 的附件，选择 ZIP 导出；ZIP 大于 4 GiB，应能被 Windows/7-Zip 解压，解压后每个文件 SHA-256 与来源一致。另导出普通小文件，确认兼容 ZIP32。
5. **MCP**：实际 Codex/WorkBuddy 使用 `start_upload_task` 而非同步大文件调用，轮询进度，完成后检查 `get_operation_result` 的 `state=done`、`businessOk=true` 以及 Web UI 与下载校验。
6. **中断场景**：在另一个可丢弃测试库执行上传中取消/停止宿主/模拟磁盘空间不足。核对没有“成功但缺字节”的 FileVersion、没有孤立 writing 对象，再打开数据库执行完整性检查；不在正式资料库上进行拔盘或崩溃注入。

## 四、尚需关注的风险

真实大文件验证应区分代码门禁、自动化 SHA 往返和目标电脑/浏览器/移动磁盘实机故障测试。大文件增加了数据库单事务时长以及回滚与备份成本，不能仅凭单次成功就宣布 T02/T03/T04 全部完成。正式保存唯一原件前须完成一致性与有效备份验证。
