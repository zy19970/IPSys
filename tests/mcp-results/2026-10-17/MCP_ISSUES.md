# IPSys MCP 未解决问题清单

> 版本：`main@d3bc77f` / EXE SHA-256 `7f6c682c1ffc071d6bade28d3b4e671d37b377e083064714bc574fb7c781f6b3`
> 执行：2026-10-17 15:02–15:22，Windows 11 26100，管理员宿主 PID 18764 → 29872
> 说明：本清单**只列本轮仍然复现的未解决问题**。已修复项见文末对照表。

**汇总：3 项**（P2×2、P3×1），均无数据错误或安全影响。

| 编号 | 级别 | 摘要 | 影响 |
| --- | --- | --- | --- |
| ISS-016 | P2 | 两类确定性拒绝仍返回 `EXECUTION_UNCERTAIN` + "禁止盲目重试" | Agent 会误判为不可重试 |
| ISS-017 | P2 | 同名目录创建返回 `资料结构约束不允许此操作：19` | 用户看不出是"名称冲突" |
| ISS-018 | P3 | 批量工具顶层 `message` 恒为"操作未成功。" | 真实原因被藏在下层 |

---

## ISS-016（P2）确定性拒绝仍被包装为 `EXECUTION_UNCERTAIN`

**状态**：稳定复现（2/2）

**复现**

```json
{"method":"tools/call","params":{"name":"restore_trash","arguments":{
  "workspace":"company","kind":"project","id":999999,"request_id":"FINAL-…-s16a"}}}

{"method":"tools/call","params":{"name":"create_archive_folder","arguments":{
  "workspace":"company","parent_id":0,"name":"x","request_id":"FINAL-…-s16b"}}}
```

**实际**

```json
{"ok":false,"status":"failed","code":"EXECUTION_UNCERTAIN",
 "message":"写操作返回异常，执行结果可能不确定；禁止盲目重试。请用 get_operation_result 查询
            request_id=… 并检查对应业务记录。原始错误：回收站不存在匹配的 kind/id/section 记录，拒绝恢复。",
 "retryable":false}

get_operation_result -> {"state":"uncertain","businessOk":null,"result":null}
```

`create_archive_folder(parent_id=0)` 同样返回该包装，原始错误为 `parent_id 必须是有效正整数`。

**预期**：与 ISS-002 已修复的 6 类一致 —— `state=done`、`businessOk=false`、`result` 保留原始错误与状态码。

**为什么是缺陷**：这两类错误都发生在**写事务之前**，请求根本没被提交，"结果可能不确定"不成立；`uncertain` 会让 Agent 记录为待人工核对，`禁止盲目重试` 会让 Agent 放弃本可改正参数后重试的请求。

**建议**：把 `restore_trash` 的资源不存在、`create_archive_folder` 的父目录非法等前置校验，与 ISS-002 已修的 6 条走同一分类器（HTTP 400/404/409 且未进入事务 → `done + businessOk=false`）。

**证据**：`logs/results_final_all.json`（ISS-016）、`logs/MCP_ACTION_LOG.jsonl`（`FINAL-…-s16a/s16b`、`DIAG-rst-0001`、`DIAG-caf-0001`）。

**验收**：`python t10_final.py iss016` → 2/2 应为 `code=BUSINESS_REJECTED` 或 `done`，且 `state != uncertain`。

---

## ISS-017（P2）同名目录创建返回内部码 `19`

**状态**：稳定复现

**复现**

```json
{"name":"create_archive_folder","arguments":{
  "workspace":"company","parent_id":1,"name":"【MCPTEST】同名目录-1517","request_id":"DUP-name-0001"}}
→ {"id":273,...}   // 第一次成功

{"name":"create_archive_folder","arguments":{
  "workspace":"company","parent_id":1,"name":"【MCPTEST】同名目录-1517","request_id":"DUP-name-0002"}}
```

**实际**

```json
{"ok":false,"status":"failed","httpStatus":409,
 "error":"IPSys 409：资料结构约束不允许此操作：19",
 "code":"BUSINESS_REJECTED","retryable":false}
```

**预期**：明确说明"同一目录下已存在同名目录"，不出现内部约束码。

**影响**：用户/Agent 无法判断是名称冲突、层级非法还是其它结构约束；只能盲试。这与 ISS-003/ISS-010 已修复的"内部码泄漏"属同一类问题，只是走了另一条 `ArchiveRules` 分支。

**建议**：把该分支的错误码 19 映射为具体文案（同目录同名 / 层级非法 / 父目录不可用分别给不同消息），并补一条 `t07_extras.py` 断言。

**证据**：`logs/MCP_ACTION_LOG.jsonl`（`DUP-name-0001`、`DUP-name-0002`）；`logs/results_final_all.json` 之外的独立复现记录。

---

## ISS-018（P3）批量上传失败时顶层文案泛化

**状态**：稳定复现

**复现**：任意使 `upload_files` 逐文件失败的请求（重复共享、跨区 share、路径非法）。

**实际**

```json
{"files":[{"path":"…","ok":false,
           "error":"IPSys 409：该文件已关联当前文件夹，无需重复共享。…"}],
 "succeeded":0,"failed":1,"requested":1,"status":"failed",
 "ok":false,
 "message":"操作未成功。",
 "error":"操作未成功。",
 "code":"BUSINESS_REJECTED","retryable":false}
```

**问题**：结构化字段齐全（满足 ISS-008），但顶层 `message`/`error` 恒为"操作未成功。"，真实原因只在 `result.files[].error`。Agent 若只读顶层会拿不到可行动信息；这与 ISS-003/ISS-004 已经写好的精细文案形成反差。

**建议**：单文件批次直接把 `files[0].error` 提升为顶层 `message`；多文件批次给摘要（如"3 个文件中 2 个失败：…"）并保留逐文件明细。

**验收**：单文件失败时，顶层 `message` 含具体原因（如"已关联当前文件夹"）。

---

## 已修复对照表（本轮实测确认）

| 编号 | 原问题 | 本轮实测 | 证据 |
| --- | --- | --- | --- |
| ISS-001 | 16 个列表工具数组序列化失败 | 17/17 返回 JSON 数组 | `results_lists.json`、`results_final_all.json` |
| ISS-002 | 确定性拒绝记 uncertain | 6/6 `done + businessOk=false`（400/409） | `results_final_iss002.json` |
| ISS-003 | 同 Folder share 泄漏内部码 | 明确"已关联当前文件夹" | `results_final_all.json` |
| ISS-004 | 跨区 share/reuse 文案含糊 | 明确"仅允许同一工作区…使用 independent-content" | 同上 |
| ISS-005 | transfer_archive 类别映射未文档化 | 允许/不允许组合与文案均正确，描述含三种 section | 同上 |
| ISS-006 | update_ip.status 枚举缺失 | 非法状态返回可用状态列表 | 同上 |
| ISS-007 | UNC 被读取并参与查重 | UNC/相对路径明确拒绝 | 同上 |
| ISS-008 | 错误信封三种形态 | 6/6 结构化 JSON | 同上 |
| ISS-009 | 英文 .NET 异常直出 | 三类路径失败均有中文诊断 | 同上 |
| ISS-010 | 内部码泄漏 | 三个探针均无泄漏（同名目录见 ISS-017） | 同上 |
| ISS-011 | 取消文案混淆 | `cancelReason=user_cancel` + `status=interrupted` | 同上 |
| ISS-012 | 协议宽松点 | 初始化前 `-32002`、批处理 `-32600` | 同上 |
| ISS-013 | restore_trash 文案不区分 | 非法 kind 与不存在 ID 文案可区分，真实恢复成功 | 同上 |
| ISS-014 | 含软删子项目录不可删 | `purge_trash(confirm=true)` 后空目录可删 | 同上 |
| ISS-015 | 崩溃后任务永久 pending | `uncertain + host_restarted + interruptedAt + resumeSupported=false` | `results_after_restart.json`、`results_t09_restart.json` |

## 非缺陷观察

- 24 并发 `list_files_page` p95 1,956 ms（上一轮 475 ms），与库体积 1.18 GB、回收站 60+ 条相关；0 失败，建议真实数据量下再测一次。
- 崩溃任务收敛后，同号重入仍返回"request_id 已被其它操作或不同上传参数使用。"，参数完全相同——语义正确（不二次执行），措辞可再精确，归入 ISS-016 同类。
- `download_file_version` 只校验"目标不存在"，不限制目标目录；管理员宿主下可写入 `C:\Windows\System32`。属工具设计（"宿主本机绝对路径"）范围内的能力，但建议在描述中提示"请使用专用下载目录"。
