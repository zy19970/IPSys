# IPSys Explorer 第三批 Windows 实机验收任务书（SUP-04／SUP-05／SUP-07＋物理隔离）

> **历史第三批任务书（2026-10-25 状态说明）**：本任务书不再作为“尚未执行的本轮计划”。后续已有 [Agent 原始报告](./agent-validation/phase3-real-save-20261023-a18b47b/PHASE3_REPORT.md)、2 GiB/VACUUM 专项和 4 GiB ZIP64 `PASS_GENERATION_ONLY` CI，以及用户独立反馈的人工验证；自动证据与人工反馈不可混同。当前 `main` 和验证状态见 [证据索引](./TEST_EVIDENCE_INDEX.md)。

> 状态：**自动化物理隔离证据已编制，Windows 原生保存与真实 ZIP64 实机证据仍待本地 Agent 运行。** 本文是执行任务书，不预设大文件或原生对话框 PASS。沿用现行开发分支 `work/onedrive-file-manager`；实测前记录精确 HEAD 与 Windows CI SHA。禁止合并 `main`。
>
> 测试对象：先确认仓库 `zy19970/AIGT-templates/AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md`；再以本分支当前源码、前次 `SUPPLEMENT_TEST_REPORT.md` 为依据。旧 132+16 项报告保持原样，不能覆盖它们改变历史计数。

## 测试边界

全部写操作只使用 **Agent 自行创建的独立 SQLCipher QA 库**、专用 Edge profile 及 `IPSys-QA` 文件夹。绝不打开或修改正式资料库。大文件测试前分别记录源盘、资料库所在盘、导出盘剩余容量；测试文件不得用“稀疏文件长度”冒充真实文件字节。记录主程序 PID、Edge 版本、测试时刻、Windows 用户会话是否交互式、被测 EXE SHA256，以及 Edge/Node/.NET 版本。关闭对话框、拒绝权限、取消保存与传输失败均应如实计入结果。

每项状态只能是 `PASS`、`CONFIRMED_BUG`、`BLOCKED`、`TEST_ERROR`、`NOT_RUN`。源文件、ZIP、数据库和密码不要上传 Git；只提交小型 JSON、摘要、适当截图、被测 HEAD 和文件 SHA。每个用例要能由另一个 Agent 独立重放。

## ST3-01 对应 SUP-04：浏览器原生保存 >2 GiB

1. 在单独 QA 库建公司测试项目，用 Edge **非 headless 真实窗口**点击 Explorer「上传」，选择完整写入磁盘的 2.2 GiB 左右源文件，记录源路径、`Length > 2147483648`、`Get-FileHash -Algorithm SHA256`；记录任务开始、100% 上传不等于已入库、服务端确认、FileId/LinkId/Version 和进程内存峰值。
2. 在 Explorer 通过文件下载按钮触发 Windows/Edge 原生保存流程，**不得替换 `showSaveFilePicker`、不得用 CDP mock 或直接 HTTP GET 代替 UI 保存**；选择其他路径，确认生成真实文件，流式计算下载文件 SHA，与源 SHA、字节数比较。取消另一次原生保存后，必须确认不会生成误报“成功”的文件。刷新并重启程序，再检查原件和 `/api/check`。
3. 对照：服务端 `NativeLargeFileHttpSmoke` 的 >2 GiB API 流式往返只是辅助佐证；不能替代这一步。
4. 证据：源/目标 FileLength+SHA、原生另存为截图、进度序列、网络响应与真实落盘、最大内存与源/目标磁盘余量；结果保留 `PASS` 或有证据的 `BLOCKED`。

## ST3-02 对应 SUP-05：实际 >4 GiB ZIP64

1. 准备**至少两个不同且各自超过 2 GiB**的已入库 QA 原件，实际总 ZIP 目标长度超过 4294967295 字节；通过 Explorer 复选业务附件、点击真实 ZIP 导出按钮，再从 Windows 原生保存窗口选择 QA 输出路径。不得用虚构远端响应、只有 ZIP64 header 的 VM 单元测试、ZIP shim 或内存虚拟文件代替真实 ZIP。
2. 用 `tools/qa/Verify-ExplorerExports.ps1` 检验落盘 ZIP64 EOCD 与 locator、条目数量、业务目录层级、每个条目的长度和 SHA。检查 7-Zip 独立解包器读取结果；如果未安装 7z，`-RequireIndependentExtractor` 会给出失败而不是宣告互操作 PASS。
3. 在 QA 文件目录写 `zip-manifest.json`，内容例子如下（路径按实际替换，`zipEntry` 必须是解包后真实的业务层级，不能猜测）：

```json
{
  "zipPath": "D:\\IPSys-QA\\exports\\actual.zip",
  "requireZip64": true,
  "files": [
    {"sourcePath": "D:\\IPSys-QA\\inputs\\a.bin", "zipEntry": "公司项目A/a.bin"},
    {"sourcePath": "D:\\IPSys-QA\\inputs\\b.bin", "zipEntry": "公司项目B/b.bin"}
  ]
}
```

4. 在 Windows PowerShell 7 执行：`pwsh -NoProfile -File tools/qa/Verify-ExplorerExports.ps1 -Manifest "D:\\IPSys-QA\\zip-manifest.json" -EvidenceDirectory "D:\\IPSys-QA\\evidence" -RequireIndependentExtractor`。该脚本直接读取**已保存到磁盘的 ZIP 与源文件**，使用 .NET ZipArchive 流式哈希条目，不生成假 ZIP。
5. 按真实运行结果记录 `PASS/CONFIRMED_BUG/BLOCKED`，必须提供 `explorer-export-audit.json` 与截图。特别区分“仅 2.2 GiB 原件”和“超过 4 GiB ZIP”。

## ST3-03 对应 SUP-07：真实保存、取消与合同层级

1. 新建一个公司项目含两个合同，给项目及两个合同分别添加不同 QA 原件；在非 headless Edge 中从菜单真实选择混合下载/ZIP 导出。
2. 先取消一次文件保存，核实没有伪成功文件；再选择真实目录保存，ZIP 内层级应呈现「项目/合同/附件」，并保留名称冲突处理与每个原件的字节 SHA。
3. 在导出过程中切换工作区，核对本次任务绑定原始来源工作区，不串到个人资料；如果禁止切换需截屏记录用户提示。上传/保存期间取消、磁盘不足等异常必须按真实结果区分。
4. 同样通过 `Verify-ExplorerExports.ps1` 使用 `requireZip64:false` 审计普通 ZIP；真实系统原生保存窗口必须留下截图。

## ST3-04：SQLCipher 物理隔离与版本链

1. 先核对最新 Windows CI 上的 `--smoke` 是否通过 `NativeTransferIsolationProof.Verify`。该验证器在**单独创建的 SQLCipher 库**中，测试项目、合同、知识产权跨工作区复制：对比原件 FileId、每个 FileVersion 对应的 FileObjectId、状态、工作区、大小、SHA、FileChunk 数量与总字节；相同内容对应**不同物理对象 ID**，历史版本完全一致。
2. 本地 Agent 再以真实 UI 操作跨工作区复制项目、合同、知识产权各一组（至少一组含 v1/v2），在只读模式核对源/目标 `file_versions` JOIN `file_objects` JOIN `file_chunks`，保存脱敏表格。不同工作区的 FileObjectId 不得相等；同工作区显式复用物理对象则不应误判为缺陷。
3. 任何阶段如出现数据库对象身份/哈希/块容量不一致，保留样本、请求、SHA 和 SQL 只读快照，不要边测边改生产源码。

## 交付格式及停止门槛

最终建立以日期和 HEAD 命名的独立目录 `docs/agent-validation/phase3-real-save-<yyyymmdd>-<sha8>/`。包含 `PHASE3_REPORT.md`、`PHASE3_RESULTS.csv`、`EVIDENCE_INDEX.md`、`explorer-export-audit.json` 和必要的小型截图/日志，CSV 至少含 case_id, status, head, exe_sha256, os_version, browser_version, source_bytes, target_bytes, source_sha256, target_sha256, evidence_path, reason。保留本地大文件、ZIP、QA SQLCipher 数据库位置与哈希供审计，不上传文件本体。

**绝对不能**把 Windows CI 的接口测试、虚拟文件测试、ZIP64 头部测试直接记作 SUP-04、SUP-05、SUP-07 真正完成。任何 `BLOCKED` 都必须给出可复验的客观限制（例如可用空间、非交互会话、OS 权限）。ST3-01、02、03 及 ST3-04 均 PASS 后，第三批才算正式闭环；如有缺陷先修复再对原用例复验。
