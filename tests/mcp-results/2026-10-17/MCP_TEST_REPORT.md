# IPSys MCP 一次性黑盒复测报告

> 执行日期：2026-10-17 15:02–15:22（GMT+8）
> 任务书：`MCP_AGENT_FINAL_RETEST.md`（基线 `main@24822d7`，工具总数 70）
> 测试对象：本机 IPSys GUI 宿主 + 真实 `IPSys.Web.exe --mcp` stdio 子进程
> 测试性质：纯黑盒；未修改 IPSys 源码、管道 DACL、MIC 或 UAC

## 1. 总体结论

### 1.1 37 项原用例

| 指标 | 上一轮（09:36 构建） | 本轮（15:00 构建） |
| --- | --- | --- |
| PASS | 24 | **28** |
| FAIL | 4 | **0** |
| BLOCKED | 9 | **9** |
| NOT_RUN | 0 | 0 |
| 合计 | 37 | 37 |

### 1.2 ISS-001～ISS-015 缺陷门禁

| 指标 | 结果 |
| --- | --- |
| 完全修复并实测通过 | **15 / 15** |
| 仍失败 | 0 |
| 新发现的残余问题 | **ISS-016（P2）、ISS-017（P2）、ISS-018（P3）** |

### 1.3 结论

**建议放行进入下一批开发。** 上一轮阻断级缺陷（16 个列表工具全部不可用、崩溃任务永久 pending）均已修复并有实测证据；剩余 3 项为文案/语义一致性级别，无数据错误、无越权、无死锁。

风险提示：`ISS-016` 仍把两类**确定性拒绝**包装成"执行结果可能不确定；禁止盲目重试"，Agent 若照做会放弃本可修正参数重试的请求，建议与下一批一起收口。

## 2. 环境与构建核验

| 条目 | 实测值 |
| --- | --- |
| 仓库 HEAD | `d3bc77ff2b18b10f67e822b758411eb4fdf44270`（2026-10-17 14:56:50，"收尾剩余黑盒修复并提供一次性完整实机复测任务书"） |
| 任务书基线 | `24822d7`，经 `git merge-base --is-ancestor` 校验为 HEAD 的祖先（即 HEAD 包含基线全部修复 + 1 个 docs 提交） |
| 源码改动 | 仅 `src/IPSys.Web/.vs/` 未跟踪；无源码改动 |
| EXE | `E:\Github\管理系统\src\IPSys.Web\bin\Debug\net8.0-windows\IPSys.Web.exe`，151,552 B，14:59 构建 |
| EXE SHA-256 | `7f6c682c1ffc071d6bade28d3b4e671d37b377e083064714bc574fb7c781f6b3` |
| DLL SHA-256 | `7f2fe7004fd3b77860b3bb29741ab4cd1de5cdfe6530542022e157b86ada6b2f`（2,839,552 B） |
| 构建方式 | `dotnet build -c Debug`，0 错误 6 警告（均为可空性/NETSDK 提示） |
| 运行版本一致性 | 运行中进程的 `IPSys.Web.dll` 与构建产物 SHA-256 完全相同（`7f2fe700…`），确认测的是新代码 |
| 宿主 PID | 18764（15:01:47 启动，15:17:51 被注入强杀）→ 29872（15:18:25 重启） |
| Windows / 会话 | Windows 11 企业版 LTSC 10.0.26100，x64，登录会话 ID = 2 |
| 权限 | 宿主与管理端均为同一用户 `JOEY-THINKPAD\Joey`，elevated=1，完整性 High |
| 工具数 | **70**（含新增 `purge_trash`） |
| 测试库 | `C:\Users\Joey\Documents\IPSys-web-test.db`，注入前 1,050,243,072 B，当前 1,180,237,824 B |
| 测试目录 | `C:\IPSys-MCP-Test\`（scripts / fixtures / logs / reports） |

> 说明：14:58 的 `bin\Debug` 构建与 14:59 的独立输出目录构建 SHA-256 完全一致，说明两点构建同源；测试期间一直使用 `bin\Debug` 这一份（用户 15:01 手动启动的那份）。

## 3. 旧版失败基线 vs 新版真实结果

| 旧问题 | 旧版实测（09:36 构建） | 新版实测（15:00 构建） | 判定 |
| --- | --- | --- | --- |
| 工具数 69 | 69 | **70**，唯一名 70，含 `purge_trash` | ✅ |
| 16 个列表工具 `The node must be of type 'JsonObject'.` | 17/17 失败 | **17/17 返回 JSON 数组**，空数组正常 | ✅ |
| 确定性拒绝记 `uncertain` + 禁止重试 | 6 类全中 | **6/6 均为 `done + businessOk=false`** | ✅ |
| 崩溃后任务永久 `pending` | `pending` 恒定、cancel 无效、rid 死锁 | **`uncertain` + `reason=host_restarted` + `interruptedAt` + `resumeSupported=false`** | ✅ |
| 同 Folder share 泄漏内部码 | `资源写入约束拒绝：19` | 文案改为"该文件已关联当前文件夹，无需重复共享…" | ✅ |
| 跨区 share/reuse 文案含糊 | 未提示 independent-content | 明确"share/reuse 仅允许同一工作区，跨工作区复制请使用 independent-content" | ✅ |
| 取消文案混淆"取消"与"撤权" | 只有 `uncertain` | `cancelReason=user_cancel`，`status=interrupted` | ✅ |
| 错误信封三种形态 | 纯文本/JSON 混用 | 6/6 错误均为结构化 JSON（`ok/code/message/retryable`） | ✅ |
| UNC 被读取并参与查重 | `\\127.0.0.1\C$\...` 可上传 | 明确拒绝："paths 仅支持本机磁盘的绝对路径，不接受 UNC 共享地址。" | ✅ |
| 含软删子项目录永久不可删 | 无清理路径 | `purge_trash(confirm=true)` → 空目录可删 | ✅ |
| 旧断言"所有取消必须变 cancelled" | — | 新规范不要求；在途副作用未知保留 `uncertain` 是正确行为 | 断言已更正 |
| 旧断言"同号参数完全一样却判不同" | — | 新实现改为"任务已中断，需核对后新建 request_id"，同号不再二次执行 | 断言已更正 |

## 4. 工具发现

- `tools/list` 返回 **70** 个唯一工具名，无重复。
- `purge_trash` 存在，签名为 `{workspace, kind, id, confirm}`，`kind` 枚举排除 `v2_file`/`v2_ip_file`，`confirm` 为布尔必填。
- 70 个工具的 `inputSchema` 全部带 `required` 与 `additionalProperties: false`，无例外。
- 错误结果正文均为可解析 JSON（非纯文本），含 `ok/code/message/retryable`。
- 证据：`logs/tools_list_final.json`、`logs/results_final_probe.json`。

## 5. ISS-001～ISS-015 全量门禁

图例：PASS=真实执行且符合任务书通过标准。

| 编号 | 门禁动作 | 实测结果 | 判定 |
| --- | --- | --- | --- |
| ISS-001 | `t02_lists.py` 17 次调用 | 17/17 返回 JSON 数组，`isError=false`，无 `JsonObject` 文案；空数组正常 | **PASS** |
| ISS-002 | 6 类前置拒绝 + `get_operation_result` | 错 LinkId→`done/false/400`；排序不完整→`done/false/409`；目录移入自身→`done/false/409`；资料移到根→`done/false/400`；archive 缺 section→`done/false/400`；版本 FileId 不属于 Folder→`done/false/400` | **PASS** |
| ISS-003 | 同 Folder 再 `duplicate_mode=share` | `IPSys 409：该文件已关联当前文件夹，无需重复共享。可选择 independent 创建独立文件，或取消本次上传。` 无内部码，未生成第二份关联 | **PASS** |
| ISS-004 | company FileId → personal share/reuse；再独立复制 | 两者均被拒：`…share/reuse 仅允许同一工作区，跨工作区复制请使用 independent-content。`；`copy_file(independent-content)` 成功 | **PASS** |
| ISS-005 | transfer_archive 允许/不允许组合 + 描述 | `company/achievement → personal/academic` 成功；`company/certificate → personal/achievement` 返回 400"目标资料类别不兼容…certificate 不支持跨工作区转移"；描述含三种 section | **PASS** |
| ISS-006 | create_ip/update_ip 合法与非法 status | 非法状态 400 且列出该类型可用状态（准备中、已申请、已公开、实质审查中、已授权、已失效）；无 status 可正常创建；update 同样拒绝 | **PASS** |
| ISS-007 | 本地盘符 / UNC / 相对路径 | 本地成功；UNC 与相对路径均拒绝："paths 仅支持本机磁盘的绝对路径，不接受 UNC 共享地址"，未进入查重流程 | **PASS** |
| ISS-008 | 6 类错误信封 | 未知参数、非法 ID、404、400、409、下载路径失败：6/6 `isError=true` + JSON + `ok=false` + `code` + `message` + `retryable=false` | **PASS** |
| ISS-009 | 目标已存在 / 不可写 / 输入不可读 | "下载目标文件已存在，禁止覆盖：…"；"output_path 不支持网络映射盘；请先将文件复制到本机磁盘。"；目录当文件上传报"指定本机文件不存在。" | **PASS** |
| ISS-010 | 内部码泄漏探针 | 同 Folder share、目录循环移动、错误资源 ID 均无 `资源写入约束拒绝：19` 类内部码 | **PASS**（另见 ISS-017） |
| ISS-011 | `cancel_task` 的 cancelReason | 运行中取消：终态 `uncertain`，`result.cancelReason=user_cancel`、`status=interrupted`、失败原因"用户请求取消；已发出的请求可能已经写入，请核对文件关联。" | **PASS**（撤权/宿主退出见 §7） |
| ISS-012 | 初始化前请求 / 批处理 / 通知空行 | 初始化前 `tools/list` → `-32002 请先发送 initialize 初始化 MCP 连接。`；批处理 → `-32600 不支持 JSON-RPC 批量请求`；通知与空行不影响后续 `ping` | **PASS** |
| ISS-013 | restore_trash 三类输入 | 非法 kind → "回收站 kind 非法；请通过 list_trash 获取合法 kind。"；不存在 ID → "回收站不存在匹配的 kind/id/section 记录，拒绝恢复。"；真实条目恢复成功（`{"ok":true,"count":1}`） | **PASS**（另见 ISS-016） |
| ISS-014 | 新建空档案→软删→删目录→purge→删目录 | 软删后目录仍 409；`confirm=false` → "永久清理必须明确传入 confirm=true。"；`confirm=true` → `{"ok":true,"count":1}`；带文件关联记录 → 409"记录仍有关联目录或文件历史，禁止永久删除。"；purge 后空目录删除成功 | **PASS** |
| ISS-015 | 2×64 MiB 上传中强杀宿主→重启→轮询/取消/同号重入 | 见 §6 | **PASS** |

## 6. ISS-015 崩溃注入实测记录

### 6.1 注入

| 项 | 实测值 |
| --- | --- |
| 目标进程 | GUI 宿主 PID 18764（非 `--mcp` 子进程） |
| 注入时刻 | 2026-10-17 15:17:51 |
| 注入前任务 | `state=running`，`requested=2`，`completed=0`，`currentFile=inject_a.bin`，`bytesSent=9,830,400 / 134,217,728` |
| 结束方式 | `TerminateProcess`（无清理机会），返回 `ok=true` |
| 立即结果 | 进程消失；客户端查询返回"未找到运行中的 IPSys 宿主…" |
| 崩溃瞬间数据库 | 1,050,243,072 B 未变；无 `-wal`/`-shm`；残留 `-journal` 34,312 B |

### 6.2 重启后核对（15:18:25 重启，PID 29872）

| 检查项 | 实测 | 判定 |
| --- | --- | --- |
| 数据库恢复 | `-journal`/`-wal`/`-shm` 均已不存在 | ✅ |
| 遗留任务状态 | `state=uncertain`，`result.status=interrupted`，`reason=host_restarted`，`interruptedAt=2026-10-17T07:18:57.8202962+00:00`，`resumeSupported=false` | ✅ |
| 状态稳定性 | 连续两次查询完全一致，不再是 `pending` | ✅ |
| 未知 request_id 对照 | `state=not_found`（与"已中断"可区分） | ✅ |
| 部分成功核对 | 项目 274 附件数 **0**（9.8 MB 已发送字节未落库，事务边界可靠） | ✅ |
| 同 request_id 重入 | 被拒，未二次执行 | ✅ |
| 新 request_id 重发 | `accepted=true` → `done`，两文件各 64 MiB，SHA 与源一致（`AE8C4A02…422F`、`63978AC7…C12E2`） | ✅ |

## 7. 37 项原用例回归

PASS 28 / BLOCKED 9 / FAIL 0。

| 用例 | 状态 | 关键实测 |
| --- | --- | --- |
| MCP-001 | BLOCKED | 关闭宿主/锁定数据库需人工且无法无密码重启 |
| MCP-002 | BLOCKED | `tools/list` 70 项已实测；授权开关需 GUI 人工切换 |
| MCP-003 | BLOCKED | 无 Codex 客户端；以多独立 stdio 子进程替代并发验证 |
| MCP-004 | PASS | `2025-06-18` 握手、70 工具、通知/空行无回复、非法 JSON 不杀进程 |
| MCP-005 | PASS | 虚构版本 `9999-99-99` 回落 `2025-06-18`，后续可用 |
| MCP-006 | PASS | 未知字段/类型/缺必填/非法枚举/空数组均精确拒绝且无副作用 |
| MCP-007 | BLOCKED | 需关闭授权/数据库/退出 GUI，人工操作 |
| MCP-008 | BLOCKED | 无法构造 Medium IL 宿主 |
| MCP-009 | BLOCKED | 仅"管理员宿主+管理员 Agent"可构造 |
| MCP-010 | BLOCKED | 无第二 Windows 用户/会话 |
| MCP-011 | PASS | 2/4/8/12/24 并发 0 失败，p95 74.8/118.8/203.3/287.4/1956.1 ms |
| MCP-012 | PASS | 8 个静默连接 6 s 后仍可用，第 9 个 302 ms 接入 |
| MCP-013 | PASS | 4 路并发改名全成功且最终单一值；同号并发只创建 1 个项目 |
| MCP-014 | PASS | 异步上传期间读 3 次 0 错误、写 3 次成功，任务 `done` |
| MCP-015 | PASS | 87 ms 返回 `accepted=true`，进度字段完整，5 文件 SHA 一致 |
| MCP-016 | PASS | 同号并发/完成后重放均不重复写入 |
| MCP-017 | PASS | 异参重放被拒 |
| MCP-018 | PASS | 立即取消 → `uncertain`，0 附件，同号不可重发 |
| MCP-019 | PASS | 进度后取消 → `uncertain`，未误清已成功文件 |
| MCP-020 | PASS | 取消后再提交 `accepted=false`，不重复执行 |
| MCP-021 | PASS | 20 路径成功；空/21 路径拒绝；不存在/相对/无权限/超 64 MiB 逐文件明确失败 |
| MCP-022 | PASS | 64 MiB−1 与 64 MiB 均成功（1.34 s 级），下载 SHA 一致；+1 字节拒绝 |
| MCP-023 | BLOCKED | 上传中撤销授权需 GUI 人工 |
| MCP-024 | BLOCKED | GUI 退出/重启需人工 |
| MCP-025 | PASS | 见 §6 |
| MCP-026 | PASS | 强杀客户端 stdio 不影响后台任务，无重复写入 |
| MCP-027 | PASS | 3 轮异步全部 done；并发读 0 错误 |
| MCP-028 | PASS | 合同复制：FileId 共享、LinkId 独立 |
| MCP-029 | PASS | FileId 不变、版本 1→2（集合 [1,2]）、两版下载 SHA 一致、已存在路径拒绝覆盖 |
| MCP-030 | PASS | LinkId 解绑只影响目标 Folder，可恢复，错误 LinkId 被拒 |
| MCP-031 | PASS | 目录层级与 `list_folder_entries` 实测顺序一致；移入自身/缺失父/资料到根/部分排序全部拒绝 |
| MCP-032 | PASS | `reorder_entries` 两次正反排序均持久化，重复读取一致 |
| MCP-033 | PASS | 147 条记录 limit=200 与 limit=1 翻页集合一致，无重复无丢失 |
| MCP-034 | PASS | 项目跨区 move 生成新 ID 且源区 ID 消失；综合资料复制源仍存在；档案 academic→achievement 复制成功；跨区 reuse 被拒 |
| MCP-035 | PASS | 搜索覆盖 6 类 kind，已删记录不出现，回收站恢复链路可用 |
| MCP-036 | PASS | 404 → `done + businessOk=false`，同号重试返回同一失败 |
| MCP-037 | PASS | 重启后合同附件（fileId 229）跨 Folder 共享仍有效、项目 274 可检索、历史版本保留 |

## 8. 基线业务完整性（任务书第 3 章）

| 项 | 实测 |
| --- | --- |
| 并发 2/4/8/12/24 | 0 失败；24 路 p50 1.84 s / p95 1.96 s（较上轮 384/475 ms 明显变慢，见 §10 观察） |
| 8 静默管道 | 不阻塞第 9 个客户端 |
| 20 路径批量 | 成功 20/20 |
| 同号并发 | 只产生一次提交 |
| 16/64 MiB 边界 | 通过；64 MiB+1 拒绝 |
| SHA-256 下载一致 | 5 文件 + 2×64 MiB 全部一致 |
| `bytesSent` 语义 | 描述与实现一致：客户端已发送字节，不等于已提交 |
| FileId 跨 Folder 共享 / LinkId 独立 | 通过（fileId 229 同时挂 ownerId 216/217） |
| 版本更新保持身份 | 通过 |
| 解绑不影响其它位置 | 通过 |
| 合同复制 / 排序持久化 / 档案混排 | 通过 |
| 项目/IP/档案/综合资料转移 | 通过；跨区独立复制与源区一致性通过 |
| pending/uncertain 防重 | 通过 |
| 404/409 日志 | 通过（`done + businessOk=false`） |
| 客户端 stdio 中止后宿主继续 | 通过 |
| 强杀宿主后数据库再次打开 | 通过（无脏数据、无残留 journal） |

## 9. 权限与未测条件覆盖表

| 场景 | 是否实测 | 说明 |
| --- | --- | --- |
| 管理员宿主 + 管理员 Agent（Bash/stdio 子进程） | ✅ 实测 | 全链路通过 |
| 管理员宿主 + 普通 Agent | ❌ BLOCKED | 无法在无 GUI 密码下重启为非提升宿主；同用户不同令牌未能构造 |
| 普通宿主 + 管理员 Agent | ❌ BLOCKED | 同上 |
| 不同 Windows 用户/会话 | ❌ BLOCKED | 无第二账号；管道 DACL 仅 `SYSTEM + 当前用户 SID` 可作旁证，但不作为实测结论 |
| MCP 授权关闭 | ✅ 实测 | 返回结构化错误 `MCP 未授权或授权已撤销。`（`TOOL_CALL_REJECTED`/`retryable=false`） |
| 上传中撤销授权（MCP-023） | ❌ BLOCKED | 需 GUI 人工在传输中关闭开关 |
| GUI 正常退出/重启（MCP-024） | ❌ BLOCKED | 需人工点击并输入主密码 |
| Codex 客户端 | ❌ BLOCKED | 未安装 |
| WorkBuddy 会话内 MCP 工具加载 | ❌ BLOCKED | 会话启动时宿主未运行，工具索引未注册；本轮改用等价 stdio 子进程直连，未声称 UI 侧已加载 |

> 未通过修改管道 ACL / MIC / UAC 的方式伪造任何权限通过。

## 10. 观察项（非缺陷）

1. **24 并发延迟上升**：p95 从上一轮 475 ms 升到 1,956 ms。数据库已增至 1.18 GB、回收站 60+ 条，属数据规模效应；仍 0 失败，但建议在真实数据量下复测一次。
2. **批量工具顶层文案泛化**：`upload_files` 失败时顶层 `message`/`error` 恒为"操作未成功。"，真实原因在 `result.files[].error`（见 ISS-018）。
3. **同名目录 409 仍带内部码**：见 ISS-017。
4. **同号重入文案**：崩溃任务已收敛为 `uncertain` 后，同号重入返回"request_id 已被其它操作或不同上传参数使用。"，参数其实完全相同——语义正确但措辞仍不够准确（可归入 ISS-016 的同类问题）。

## 11. 数据清理与残留

- 本轮创建的项目/合同/IP/档案/目录均带 `【FINAL*】`、`【MCPTEST】` 前缀，用例结束时已软删。
- 回收站现存 60+ 条历史软删记录（含前几轮遗留）；`purge_trash` 可逐条永久清理。
- 崩溃注入项目 274 保留（内含重传的 2×64 MiB 文件），可作为后续崩溃测试基准。
- 上一轮遗留的档案目录 38/62 仍存在；本轮验证了"purge 后空目录可删"的路径，可手工清理。
- 测试期间误写入 `C:\Windows\System32\ipsys_deny_150332.bin`、`ipsys_should_fail.bin` 各 1 个（下载路径探针），已即时删除；后续改用不存在盘符 `Z:\` 探测。

## 12. 复测脚本与断言修正记录

| 脚本 | 用途 | 本轮修正 |
| --- | --- | --- |
| `t01_protocol.py` | 协议/参数校验 | 工具数 69→70；错误关键字匹配改为先 JSON 解析（原文是 `\uXXXX` 转义，明文匹配会误判） |
| `t02_lists.py` | 16 个数组工具哨兵 | 硬编码 ID 改为动态解析；新增"必须解析为 JSON 数组"断言 |
| `t03_concurrency.py` | 并发/槽位 | 依赖 `setup_data.py` 重建上下文 |
| `t04_async.py` | 异步/幂等/取消/边界 | MCP-020 断言改为解析 `note/state`；MCP-021 接受"异步任务内逐文件失败"；上传补 `duplicate_mode` |
| `t06_business.py` | 业务一致性 | MCP-029 版本集合改为排序比较；MCP-031/032 由 BLOCKED 改为真实排序验证；MCP-034 改用 ID 集合与正确 target_section |
| `t07_extras.py` | 契约边界 | `copy_file` 返回 `fileId` 而非 `id`，断言改为兼容两者 |
| `t08_more.py` | 补充用例 | 合同无附件时先上传；schema 读取 70 工具清单 |
| `t10_final.py` | **新增** ISS-001~016 全量门禁 | — |
| `gen_fixtures3.py` | **新增** 按轮次重写夹具 | 规避工作区级查重门 |
| `setup_data.py` | 测试上下文 | 去掉已废弃的 `ip_no`/`content`；修正 IP 状态；目录名加轮次后缀；上传补 `duplicate_mode` |

> 以上均为测试脚本调整，**不修改产品代码**；每条修正都在对应章节注明了"修正前断言 → 修正后判据"。
