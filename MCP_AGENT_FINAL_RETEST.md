# IPSys MCP 一次性黑盒复测任务书（第一轮与剩余缺陷全量验收）

> 测试基线：`main@24822d739a7221fff43de834e82542f97f94443f`，Windows CI [#39010080604](https://github.com/zy19970/IPSys/actions/runs/39010080604) completed/success。  
> 适用：在 Windows 本机运行的 IPSys GUI 宿主，以及实际 `IPSys.Web.exe --mcp` stdio 客户端。  
> **工具总数现在为 70**，其中新增 `purge_trash`；历史任务书“69 工具”断言必须替换。  
> 本文是交给 Agent 执行的**单轮完整复测指令**，不要把 CI 通过视为本机复测通过。

## 0. 工作要求与禁止事项

1. 从仓库最新 `main` 重新构建 Debug 或采用对应 Windows Actions Release；记录 `git rev-parse HEAD`、EXE 路径、SHA-256、Windows 用户、会话 ID、宿主/Agent 完整性级别、工具数、数据库路径和测试起止时间。不得继续使用以前的 EXE 直接复测并把失败归于新代码。
2. 只操作用户指定的可丢弃测试库；无需保留旧数据。测试期间可添加、软删除、精确永久清理测试条目及强制中止宿主，但不能改变管道 DACL、MIC 或关闭 UAC 伪造跨权限通过。强杀之前保留日志并记录 request_id。
3. **先执行一套完整回归、再一次性汇总报告**。每项至少记录：调用参数（脱敏）、真实返回、`isError`、`request_id`、日志状态（若是写入）、预期/实际、PASS/FAIL/BLOCKED；不要把源码推断当实测结果。
4. 含 `request_id` 的 `done` 只表示已归档日志，必须继续检查 `businessOk` 和 `result.status`。对 `uncertain`／崩溃遗留日志不能自动重试整批上传；须核对 FileId、LinkId 和实际附件后处理明确未完成的部分。
5. 不直接修改 IPSys 代码或推送仓库。若测试脚本本身断言已经过时，只修改测试脚本，明确记录修改前后断言，不将其误报为产品缺陷。

## 1. 启动与工具发现

启动最新 GUI EXE，打开并解锁可丢弃 SQLCipher V2 数据库，在系统设置启用 MCP；以当前 Windows 用户的普通终端创建独立 `--mcp` stdio 子进程。若需测提权，请单独记录权限矩阵。

首先执行以下协议检查：`initialize` 返回受支持版本 `2025-06-18`、`tools/list` 有 **70** 个唯一名称（包括 `purge_trash` 与此前所有 69 个工具）、所有工具 `required` 和 `additionalProperties:false`；`tools/call` 的未知参数严格拒绝；错误结果必须为结构化 JSON 文本。

请先核对本机测试目录 `C:\IPSys-MCP-Test\scripts` 是否存在，旧脚本仅作为可修改的本机回归入口，不假设其中的断言是权威规格。若脚本不存在，直接用实际 MCP stdio 请求执行同等验证。推荐依次执行：

```powershell
cd C:\IPSys-MCP-Test\scripts
python t01_protocol.py
python t02_lists.py
python t03_concurrency.py
python t04_async.py all
python t06_business.py all
python t07_extras.py
python t08_more.py
```

`inject.py`、`check_after_restart.py`、`t09_restart.py` 放在最后：先存好日志再强杀宿主，并由用户或 Agent 用正确的解锁方式重新开启数据库；无法登录时标 BLOCKED，不得虚报 PASS。

## 2. ISS-001～ISS-015 全量门禁

| 问题 | 复测动作 | 通过标准 |
|---|---|---|
| ISS-001 P0 | `t02_lists.py` 遍历 16 个数组型列表工具（`list_projects`、`v2_list_projects`、`list_contracts`、`v2_list_contracts`、`list_ips`、`v2_list_ips`、`list_general`、`list_archives`、`list_archive_folders`、`list_trash`、`list_files`、`list_project_files`、`list_contract_files`、`list_ip_files`、`list_file_links`、`list_folder_entries`），根与具体父目录共 17 次调用 | `isError=false`，文本可解析为 **JSON 数组**，没有 `The node must be of type 'JsonObject'.`；空数组也正常 |
| ISS-002 P1 | 错 LinkId、排序列表不完整、目录移到自身、资料移到根、archive 缺/错 section、上传版本 FileId 不属于 Folder；随后 `get_operation_result` | 明确的拒绝归 `done/businessOk=false`，结果含失败状态与错误信息；修正业务参数使用新编号。与网络断开导致的真正 `uncertain` 分开 |
| ISS-015 P1 | 在上传 2 个大文件中途强杀 GUI 宿主，重新启动后轮询旧 request_id；同时执行 `cancel_task` 与同号重入 | 原遗留 `pending` 首次查询持久收敛为 `uncertain`，含 `reason=host_restarted`、`interruptedAt`、`resumeSupported=false`；同号不会二次执行。先核查实际部分成功的文件，不假定整批原子回滚 |
| ISS-003 P2 | 同一个 Folder 已有关联 FileId，再以 `duplicate_mode=share`、该 `source_file_id` 上传相同内容 | 明确说明已关联当前目录，无 SQLite 内部码；不会无提示生成第二份同一关联 |
| ISS-004 P2 | 尝试从 company FileId 在 personal 工作区 share/reuse；再对比合法跨区独立复制 | 明确提示跨工作区不允许 share/reuse，使用 `independent-content`；不存在越区共享 |
| ISS-005 P2 | `transfer_archive` 执行允许与不允许的 section/workspace 组合；核实 schema 描述 | 兼容组合成功，不兼容组合 400 且提示类别不兼容；映射与当前 `ArchiveRules` 一致，不按旧脚本假设硬编码 |
| ISS-006 P2 | `create_ip`／`update_ip` 对不同 ip_type 填合法及非法 status；核查工具描述 | 合法写入成功，非法返回当前类型可用状态；不出现无解释的“状态不适用” |
| ISS-007 P2 | `upload_files` 试本地盘符绝对路径、UNC（包括 `\\127.0.0.1\C$\...`）、相对路径；只使用测试文件 | 本机固定盘符可用；UNC/网络路径依当前安全策略被明确拒绝，不能被宿主读取后按重复文件处理；不得通过修改 ACL 绕开 |
| ISS-008 P2 | 对未知参数、非法 ID、业务 400/404/409、下载路径失败、缺授权等取至少 6 个 `tools/call` 错误 | `isError=true`，内容可解析为 JSON，明确 `ok=false`、`code`、`message`、`retryable=false`；必要时包含 HTTP 状态；不能只返回任意纯文本 |
| ISS-009 P3 | 下载到已经存在的输出文件、禁止写入的位置；上传无读取权限的测试路径 | 用户可见中文诊断，区分目标文件存在、无法写入和输入读取错误；不保证 Windows OS 对共享冲突与权限拒绝的底层报错完全相同 |
| ISS-010 P3 | 同 Folder share 冲突、目录循环移动、错误资源 ID | 不出现 `资源写入约束拒绝：19`、`FileId=folders` 等内部对象码或路由段作为文件 ID |
| ISS-011 P3 | `cancel_task`、GUI 关闭 MCP 授权、宿主正常结束分别处理上传中的任务 | 实时信息或中断结果的 `cancelReason` 能区分 `user_cancel`、`authorization_revoked`、`host_stopping`；在途副作用未知仍保留 `uncertain`，不得要求所有取消都直接变 `cancelled` |
| ISS-012 P3 | 初始化前发 `tools/list`；发 JSON-RPC 批处理数组；正常空行、notification、initialize | 初始化前请求被明确拒绝；不支持批处理返回 `-32600`，正常通知/空行不扰乱后续握手 |
| ISS-013 P3 | `restore_trash` 使用非法 kind、合法但不存在的 ID、真实 `list_trash` 返回的 kind/id/section | 非法枚举与资源不存在能够区分，真实恢复成功，不能把搜索结果 `kind=file` 当作回收站 kind |
| ISS-014 P3 | 在业务目录下新建无附件档案→软删→尝试删目录→显式 `purge_trash(confirm=true)`→删空目录；另测 `confirm=false` 和带文件关联的记录 | 新增工具 **`purge_trash`** 必须要求显式确认，且只清理允许的已删除、无附件归属记录；不递归删除、不会清理共享文件和历史；原有非空目录删除保护不得放宽 |

## 3. 基线业务完整性回归（不得因修复倒退）

1. 并发 2/4/8/12/24 个客户端做 `list_files_page`；8 个静默命名管道不得永久阻塞第 9 个客户端；不得出现死锁或宿主被误报未启动。
2. 20 路径批量上传、同号并发只产生一次提交；16、64 MiB 边界、64 MiB+1 字节拒绝；文件 SHA-256 下载后相同；`bytesSent` 不误称已落库字节。
3. 文件 `FileId` 可跨多个 Folder 同区共享，`LinkId` 相互独立，版本更新保持身份；解绑一个位置不影响另一个，恢复须用 FolderId/FileId/LinkId 校验。
4. 合同复制、排序持久化、档案混排、项目/IP/档案/综合资料转移、跨区独立复制及源区回收站一致性。
5. 对 `pending/uncertain` 的防重、对已知 404/409 拒绝的日志、客户端 stdio 中止但宿主继续执行、真正强杀宿主后数据库再次打开的持久性。
6. WorkBuddy、Codex 如当前机器可用，则各自实际加载工具并运行读写；没有安装、权限不足、缺第二 Windows 用户/会话时明确 BLOCKED，不以模拟权限或命名管道 DACL 静态检查充当实测。

## 4. 结果交付与放行要求

完成后交付：`MCP_TEST_REPORT.md`（环境、37 项原用例+15 项缺陷复测+新增 70 工具检查、PASS/FAIL/BLOCKED）、`MCP_ISSUES.md`（只列复现的未解决问题）、`MCP_ACTION_LOG.jsonl`（实际请求/响应、脱敏）、`MCP_EVIDENCE_INDEX.md`（证据与脚本映射）和`MCP_RETEST_PLAN.md`（仅未通过项的新复测步骤）。

按**旧版失败基线**与**新版真实结果**分别列示；旧报告的“69 工具”“所有取消必须是 cancelled”“同号参数完全一样却判不同”等不正确预期不能直接复制。脚本原样失败时，先比较新规范与脚本断言，并保存原始响应。报告必须包含：工具数、16 列表修复、错误结构、异步取消/中断、清理后目录可删、真实权限场景覆盖表及全部未测条件。

**交付结论的必要前提**：真实当前 EXE + 实际 MCP 调用全部核心门禁通过，无未经解释的业务副作用；高风险权限场景若缺测试条件，清楚标记为 BLOCKED，不能声称已经完成安全实机验收。
