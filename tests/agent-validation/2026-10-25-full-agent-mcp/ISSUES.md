# 问题清单（ISSUES）

本次验收**未发现**权限绕过、跨库数据混入、文件 SHA/版本异常、重复上传、关键智能入库错误或错误缺项筛选。
以下 4 条为体验/流程问题，其中 3 条有完整复现，1 条为人工补验缺口。

---

## ISSUE-01【中】宿主不在时调用固定空等约 15 秒才失败

- **现象**：IPSys GUI 未运行时，任意 MCP 工具调用（含 `get_agent_guidance`、`prompts/get`）都会阻塞约 15.0 秒，然后返回
  `TOOL_CALL_REJECTED：未找到运行中的 IPSys 宿主，请先启动软件、打开数据库并手动启用 MCP。`
- **复现**：
  1. 关闭 IPSys 所有进程；
  2. 用真实 stdio 客户端连接 `IPSys-win-x64-FrameworkDependent.exe --mcp`；
  3. 连续调用 4 次 `get_agent_guidance`。
- **实测**：`MCP_ACTION_LOG.jsonl` 中三次调用时间戳为 `22:20:04 → 22:20:19 → 22:20:34`，**间隔恒为 15 秒**；4 次调用即耗尽 120 秒客户端预算，脚本被 SIGTERM。
- **影响**：Agent 侧把“未授权/未启动”误判为“超时”，容易触发重试风暴；批量场景下一个坏前提就能拖垮整轮。
- **建议**：先以 ≤500 ms 超时探测命名管道/宿主存活，失败立即返回；错误码建议用 `HOST_NOT_RUNNING` 而非 `TOOL_CALL_REJECTED`。

---

## ISSUE-02【低】取消上传任务的终态是 `uncertain`，没有 `cancelled`

- **现象**：`start_upload_task` 后立即 `cancel_task`，状态链为 `pending → cancelling`，随后长期停留在 `uncertain`（轮询 8 秒 + 12 秒无变化）。
  真实结果藏在 `result.status=interrupted`、`result.cancelReason=user_cancel`、`result.succeeded/failed/requested`。
- **复现**：12 个小文件 `start_upload_task`（`request_id=acc-20261025-task-02`）后立刻 `cancel_task`，再轮询 `get_task_status`。
- **实测**：
  ```
  state=uncertain  businessOk=null
  result.status=interrupted  succeeded=1  failed=1  requested=12  cancelReason=user_cancel
  retryAdvice=仅按返回的失败路径进行人工核对；已成功文件不应盲目重传。
  note=任务已经不在当前活动列表；done/uncertain 结果以 SQLCipher 操作日志为准。
  ```
  实际落地仅 1 个（T09/fileId 16）；提示“可能已经写入”的 T10 经 `list_project_files` 核对**并未落库**。
- **影响**：客户端若只按 `state` 分支，无法区分“用户主动取消”与“结果不确定需人工核对”，也无法自动收敛。
- **建议**：增加 `cancelled` 终态（或在 `state` 中返回 `interrupted`），同时保留逐文件结果与 `retryAdvice`；`done/uncertain` 的语义建议写进工具说明。

---

## ISSUE-03【低】同名文件可并存，列表无区分标识

- **现象**：S01 与“同名异内容”的第二版文件在库中同名（`S01 地下矿山铲运机LHD液压系统说明.pdf`），分别是 FileId 1 与 7；
  `list_project_files` / `list_files_page` 仅以 `fileId` 区分，`displayName` 均为 `null`。
- **影响**：人工核对与 Agent 选文件时容易选错版本；与“同名不覆盖”的正确行为叠加后，反而增加辨识成本。
- **建议**：发生同名新建时自动生成 `displayName`（如 `…(2)`），或在返回中附带 `originalName` + `version` + `大小/SHA 前 8 位`。

---

## ISSUE-04【流程】A11 与 GUI 回归需人工补验（非缺陷）

- **缺口**：设置 → Agent 工作规范 的编辑/预览/恢复默认/导入导出，需要 GUI 登录态；本机 `GET /api/agent-guidance` 与 `/api/agent-guidance/export` 未登录均返回 **401**，Agent 无法代操作。
- **已可验证**：`index` 三篇版本与各篇正文版本逐一相等；当前用户无自定义覆盖（`%LOCALAPPDATA%\IPSys\agent-guidance.json` 不存在），本轮未改动任何用户级规范。
- **人工补验步骤**：
  1. 打开 设置 → Agent 工作规范，确认 index 只读且仅显示目录；
  2. 编辑 search 为测试文字并保存，核对 UI 预览、`get_agent_guidance(search)`、`prompts/get(search)` 三者内容与版本一致；
  3. 编辑 upload 后预览，确认“文件内容读取共用规范”段落仍在；
  4. 单篇“恢复默认”，确认其余两篇覆盖不受影响；
  5. 导出配置 JSON（校验 `schemaVersion=1`、无密码/token），再导入核对一致；导入空覆盖应恢复内置默认；
  6. 导入非法 JSON / 非法 topic 应被拒绝；
  7. 关闭 MCP 授权后，`get_agent_guidance` 与 `prompts/get` 不得返回正文；重新授权后恢复（A12-rev）；
  8. 常用分辨率下检查设置面板滚动、按钮、长文本预览（A14-gui）。
- **恢复**：本轮无用户级覆盖文件，测试后如产生该文件，删除即回到测试前状态。
