# IPSys Agent × MCP 一体化实机综合验收报告

- **执行批次**：`20261025-01`
- **执行时间**：2026-10-25 22:22 – 22:34（本地时间 UTC+8）
- **任务书**：`E:\IPSys数据管理平台\IPSys_Agent_MCP_一体化实机综合验收任务书_20261025.md`
- **结论**：**19/20 主项 PASS，1 项 BLOCKED（A11 需人工在设置界面复核）**。未发现权限绕过、跨库混入、SHA/版本异常、重复上传、关键入库错误或错误筛选。补齐 A11 与 A12 的撤权/跨库子项后可收敛。

---

## 一、环境与身份

| 项 | 实际值 |
| --- | --- |
| Windows | Windows 11 企业版 LTSC，10.0.26100 |
| IPSys 进程 | `IPSys-win-x64-FrameworkDependent.exe`（GUI 宿主，PID 24388，22:22:32 启动） |
| 程序 SHA-256 | `9A59C91B67E97A1FAE9C6D57CBBC4429D482D9850A24BB70D7C21BC8C6BAA694`（文件时间 2026-10-25 13:35） |
| MCP 配置 | `mcp.json` → 上述 exe `--mcp`（stdio，无密钥） |
| 协议 | `protocolVersion=2025-06-18`，`serverInfo=ipsys-local 1.0.0` |
| 工具 | **64 个**，`v2_*` 兼容工具 0 个；capabilities = tools + prompts |
| instructions | 281 字符短入口 |
| Prompts | `index / search / upload / metadata` 四篇 |
| 源码仓库 | `E:\Github\管理系统` → `github.com/zy19970/IPSys`，`main` = `b88c413`（工作区干净） |
| CI | run **#429**（id 40198175759）`conclusion=success`，`head_sha=3926caa`，为当前 HEAD 的祖先（仅差任务书提交） |
| 测试库 | `E:\IPSys数据管理平台\IPSys-test.db`，6,995,968 B（本次新建） |
| 正式库 | `E:\IPSys数据管理平台\IPSys.db`，250,970,112 B，SHA-256 `F1B0B6E0…0EDEFDD0E` —— **验收前后一致，未被写入** |

### 测试库隔离说明

- 验收开始时通过 MCP 回读确认测试库为空：`list_projects`（company/personal）均为 `[]`、`list_ips` 为 `[]`、`list_files_page` 为 `{"items":[],"hasMore":false}`。
- 全部写入仅发生在该测试库；正式库 SHA-256 在验收前后完全相同。
- 未创建第二个测试库（Acceptance-B），因此跨库隔离子项（A12-db）标 BLOCKED。

### 测试台

- 自建真实 stdio MCP 客户端（`work/acceptance/mcp.py`），完整走 `initialize → notifications/initialized → tools/call`，并输出脱敏动作日志。
- 合成样本 9 份 + 批量小样 20 份，全部虚构，SHA-256 见 `TEST_DATA_MANIFEST.md`。

---

## 二、结果统计

| 口径 | PASS | FAIL | BLOCKED | NOT_RUN | N/A |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20 项验收矩阵 | 19 | 0 | 1 | 0 | 0 |
| 全部用例行（含子用例） | 39 | 0 | 3 | 1 | 0 |

BLOCKED：`A11`（设置界面编辑/导入导出）、`A12-rev`（GUI 撤销授权）、`A12-db`（跨库隔离）。
NOT_RUN：`A14-gui`（GUI 交互回归，需人工实机确认）。

---

## 三、关键实测结论

### P1 协议与规范（A01–A05 全 PASS）

- `initialize` 返回 `2025-06-18`，工具 64 个且无 `v2_*` 兼容残留，capabilities 含 `prompts`。
- `get_agent_guidance()` 只返回目录：三条 `entries`（search/upload/metadata），带 `version`、`summary`、`source=builtin`、`guidanceOnly=true`，**不含 content/body**（总长 1208 B）。
- 三篇正文各自独立：search 758 字、upload 1438 字、metadata 1568 字；upload 与 metadata 共享 106 字公共段落（“文件内容读取共用规范”），upload 与 search 无公共段 → 共用约束只在应共享处出现。
- `prompts/get` 四篇与工具返回**逐字节同源**（search/upload/metadata 哈希一致，index 长度一致）。
- 只读规范前后：项目 0→0、IP 0→0、文件关联 0→0，**零业务写入**。
- 未知 topic（`bogus`、`SEARCH`）被拒，省略 topic 返回目录。

### P2 检索（A06/A07 PASS）

| 查询 | 命中 | 说明 |
| --- | --- | --- |
| `查运机`（错别字原样） | 0 | 关键词包含匹配，无拼写纠错 |
| → 扩展 `铲运机` | S01、S03 | S01 命中 |
| → 扩展 `LHD` | S01、S03 | 同上 |
| `液压泵`（仅正文出现） | S01 | 说明/标签生效 |
| `矿山机器人` | 仅 S03 | 撬毛=2 条、凿岩=1 条，需按相关主题区分 |
| `通风` | 仅 S04 | 铲运机查询未误命中 S04 |

- `limit=2` 分页：offset 0→2，`hasMore` 正确翻转，4 条无跨页重复；`matchedFields/path/folderId/fileId/linkId` 齐全。
- personal 检索 `S0` 命中 0 条 → 工作区隔离成立。
- `download_file_version` 取回原件落盘 SHA 与源一致（`B837551D…`）。

### P3 智能入库（A08/A09/A15/A16 PASS）

| 样本 | 类型 | 实测 |
| --- | --- | --- |
| S01 | PDF 文字层 410 字 | 编号 `TEST-LHD-2026-01`、日期 `2026-10-20`，说明 135 字、6 个标签 |
| S02 | DOCX 5 段 + 1 表 | 说明 111 字、5 个标签；**编号/日期保持 NULL** |
| S03 | XLSX 两张表 | 编号 `TEST-RIG-2026-03`、日期 `2026-10-21`，说明点名两张工作表 |
| S08 | 只上传不分析 | 四项属性全部为 NULL |
| S05 | 纯图像 PDF（文字层 0 字） | 视觉读取成功（2026-10-19 / SCL-100 / 六项正常），填说明+标签+日期，**无文件编号不编造** |

- 四份入库后 SHA-256 与源文件逐一致，`folderId=8`，`versions=1`。
- 同内容异名（S06a，SHA 与 S01 相同）：`choice=independent`，新 FileId=6，S01 版本仍为 1。
- 同名异内容（S06b，同名不同 SHA）：新 FileId=7，两份同名共存，**未覆盖 S01**。
- 不存在的绝对路径：逐文件 `ok=false`，`isError=true`，中文原因“指定本机文件不存在。”
- 异步取消：`pending → cancelling → uncertain`，`result.status=interrupted`，`succeeded=1 / failed=1 / requested=12`，`cancelReason=user_cancel`；实际落地仅 T09（fileId 16），提示“可能已写入”的 T10 经核对**未落库**。

### P4 缺项筛选与补录（A10/A17/A19/A20 PASS）

预置矩阵（同一项目 14 个文件，逐个构造缺项组合），服务端筛选结果与真值**完全一致**：

| 查询 | 期望 | 实得 |
| --- | ---: | ---: |
| `all` + `any` | 13 | 13 |
| `[description,file_date]` + `any` | 10 | 10 |
| `[description,file_date]` + `all` | 2 | 2 |
| `description` | 8 | 8 |
| `tags` | 5 | 5 |
| `file_number` | 4 | 4 |
| `file_date` | 4 | 4 |
| `all` + `all` | 2 | 2 |

- **空白语义**：`" "`、`"\t"`、`"\u3000"`、`""`、`"; ;"` 写入后均被归一化为 NULL，并按“缺项”命中。
- 分页：`limit=2` 共 7 页，两轮顺序完全一致、页内无重复。
- 去重：FileId=5 共享到两个 Folder（LinkId 5/35），缺项查询中只出现 1 次，13 条候选 FileId 唯一。
- 效率：一次 any 查询 13 条 / 7 页 / 0.35 s，未逐文件调用 `get_file_details`。
- 补录：T03 补说明、T07 补说明+标签、T05 由正文“记录编号：BULK-05”补编号；T06 与 S02 无依据，**保持空白**。补录后 FileId、LinkId、SHA、版本数、已有非空字段全部未变。

### P5/P6 规范管理、隔离与并发

- `index` 三篇版本与各篇正文版本逐一相等（`1.0.0+955481576c9a` / `+320211aa29b3` / `+ab41eb79c3db`）。
- 规范编辑、恢复默认、导入导出需 GUI 登录态；本机 `/api/agent-guidance` 与 `/export` 未登录均返回 **401**，Agent 无法代验 → A11 BLOCKED。当前用户**无自定义覆盖文件**（`%LOCALAPPDATA%\IPSys\agent-guidance.json` 不存在），测试未改动任何用户级规范。
- 跨工作区与错配 ID 全部拒绝且无副作用：

| 用例 | 返回 |
| --- | --- |
| company 文件用 personal 读 | 404 “文件不存在或当前工作区无权访问” |
| 不存在的 FileId 999999 | 同上 |
| 错配 LinkId 删除 | “FolderId、FileId、LinkId 不一致或文件已解除；拒绝删除。” |
| 不存在的目标 Folder | 404 |

- 双客户端并发（两个独立 stdio 连接，各 8 次）：company 始终命中、personal 始终 0，总耗时 0.87 s，单次最大 151 ms，无超时、无串库。
- 共享：FileId=1 `associate_file(move=false)` → LinkId `[1, 32]`，归属 `[8, 10]`，版本仍 1（不复制内容）。

---

## 四、未解决问题

见 `ISSUES.md`。共 4 条，均为体验/流程级，无安全或数据完整性缺陷：

1. 无宿主时每次调用固定空等约 15 秒才失败（建议快速失败）。
2. 取消任务终态为 `uncertain` 而非 `cancelled`（需靠 `result.status/cancelReason` 区分）。
3. 同名文件可并存且列表无区分标记。
4. A11 与 GUI 回归需人工补验。

---

## 五、是否可收敛

**可收敛（待人工补验 1 项核心 + 2 个子项）**

- 已 PASS 的核心链路：协议/规范/Prompts 同源、语义扩词与分页、PDF/DOCX/XLSX 智能入库、只上传不分析、扫描件视觉阅读、重复与部分失败、服务端缺项筛选与保守补录、共享去重、工作区隔离、并发读。
- 需人工补齐：
  1. **A11**：设置 → Agent 工作规范，编辑 search 保存 → 预览 → 单篇恢复默认 → 导出 JSON → 导入 → 非法 JSON 被拒。
  2. **A14-gui**：常用分辨率下设置面板滚动/按钮/长文本预览可用。
  3. **A12-rev**：设置里关闭 MCP 授权后，`get_agent_guidance` 与 `prompts/get` 不得返回正文；重新授权后恢复。
- 其余非核心限制：未做 2 GiB 上传、4 GiB ZIP64 解包与生产规模压测（任务书已声明不强制）。

---

## 六、产物

| 文件 | 说明 |
| --- | --- |
| `CASES.csv` | 43 行：A01–A20 + 子用例，含状态、预期、实际、证据 |
| `MCP_ACTION_LOG.jsonl` | 脱敏动作日志（工具、参数摘要、ok、结果片段） |
| `EVIDENCE_INDEX.md` | 证据索引与前后状态 |
| `ISSUES.md` | 问题与复现建议 |
| `TEST_DATA_MANIFEST.md` | 合成样本格式/大小/SHA-256/预期 |
| `evidence/S05_p1.png` | 无文字层扫描件渲染图（视觉阅读证据） |
