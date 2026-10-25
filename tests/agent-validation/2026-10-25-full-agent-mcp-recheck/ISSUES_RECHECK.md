# 问题复核清单（第二轮）

分类：**产品缺陷** / **Agent 工作流** / **文档解析能力** / **环境权限阻断** / **原始证据缺失**。
每条给出：现象、复现、影响、建议、本轮是否证实。

---

## 一、产品缺陷

### ISSUE-R05【中】`search_records` 返回的 `description` 不是库里的说明，而是"所属记录 · 文件名"

**现象**：搜索结果里 `description` 恒为 `"<所属项目名> · <文件名>"`，与 `get_file_details` 返回的真实 `description` 不一致。

| 查询 | FileId | `search_records.description` | `get_file_details.description` | `matchedFields` |
|---|---|---|---|---|
| 铲运机 | 3 | `验收测试项目-公司A · S03 矿山机器人测试台账.xlsx` | `矿山机器人测试台账：工作表「项目清单」列凿岩机器人…与铲运机远程遥控系统（TEST-LHD-2026-02）…` | `["description"]` |
| 铲运机 | 1 | `验收测试项目-公司A · S01 地下矿山铲运机LHD液压系统说明.pdf` | 长文本（液压系统说明…） | `["name","fileName","originalName","description","tags"]` |
| 排水泵 | 20 | `验收测试项目-字段矩阵 · T03 排水泵运行日志.pdf` | `排水泵运行日志：三台主排水泵轮换运行，电流平稳。` | `[...,"description"]` |
| 排水泵 | 10 | `验收测试项目-公司A · T03 排水泵运行日志.pdf` | **None** | `["name","fileName","originalName"]` |

**影响**：
- 真实 Agent 在 E2 里据此把 FileId 3 判为"描述字段命中但描述文本不含关键词，疑为跨词命中"——**判断被误导**；
- 一个没有说明的文件（FileId 10，description=None）在搜索结果里**看起来有说明**，属展示层虚构；
- `matchedFields` 与返回文本自相矛盾，降低证据可核验性。

**建议**：返回真实 `description`（可为 null），把"所属记录 · 文件名"另设字段（如 `ownerLabel`）；或至少在字段文档里写明该字段是展示标签。

**证实度**：4 组实证，稳定复现（`MCP_RAW_RECHECK.jsonl` 中 `case=ISSUE-search-desc` 与 `ISSUE-matchedFields` 记录）。

---

### ISSUE-R06【中低】`paths` 上限 20，超限错误不说明上限

**现象**：一次传 105 个路径时返回
`{"ok":false,"status":"failed","code":"TOOL_CALL_REJECTED","message":"数组元素数量无效：paths"}`，
但 schema 里 `maxItems: 20`，错误信息完全没提。

**影响**：批量迁移（本用户做过 587 个文件、51 份合同）必然触发；Agent 只能盲试拆分粒度。
**建议**：错误文案附上限值，例如"paths 最多 20 个，请分批"。
**证实度**：本轮实测（`E2-prep` 首次调用失败，改 18/批后 6 批全部成功）。

---

### ISSUE-R07【中，设计边界】检索不做同义/同音/错字扩展，规范已声明但后果明显

**实测**：
| 查询 | total | 说明 |
|---|---|---|
| 查运机 | 0 | 同音错字完全不召回 |
| 铲运机 | 110 | 正确写法 |
| 无人驾驶 | 0 | 库里有"铲运机遥控改造方案"也不召回 |
| 矿山机器人 | 6 | **漏掉**文件名为"撬毛机器人…"的两份（需退化成"机器人"才召回 8 条） |

**影响**：Agent 必须自己扩词才能"查全"，扩词质量直接决定召回率；用户若不自知写错，会得到"查无此物"。
**建议**：0 命中时返回相近词建议，或提供可维护的别名/同义词表（产品侧），不必做语义检索。
**证实度**：规范原文已写明"不提供语义、拼写纠错、OCR 或全文搜索"，属**已知边界**，不算 Bug；但应写进用户可见的产品说明。

---

### ISSUE-R08【低】同名文件在列表/检索结果里无区分标识

**现象**：FileId 1 与 FileId 7 同名同目录，`displayName` 均为 null；检索结果只给 `latestVersion` 与 `size`（本轮恰好有 size）。
**影响**：人工核对易选错；Agent 需额外调 `get_file_details` 拿 SHA 才能区分（E2 的 Agent 正是这么做的）。
**建议**：列表返回 `size` + `sha256` 前 8 位，或标"同名 N 份"。
**证实度**：本轮证实（E2 报告第 4.4 节，Agent 自己指出"同名异内容，不能合并"）。

---

### ISSUE-R09【UX，本轮未复现】宿主未运行时每次调用空等约 15 秒

第一轮实测 4 次调用严格 15 秒一跳。本轮宿主全程在线，**未复现**，保留为历史观测。
建议仍是：先 ≤500ms 探管道，失败立即返回。

---

### ISSUE-R10【澄清，非缺陷】异步取消终态是 `uncertain` 而非 `cancelled`

复核第一轮 `recovered/async2.json`：`state=uncertain`、`result.status=interrupted`、`cancelReason=user_cancel`、
`succeeded=1 / failed=1 / requested=12`，且逐文件给出"已成功/已取消/可能已写入"。

**结论：这不是取消失败**。按任务书口径应以 `result.status` + `cancelReason` + 实际落地清单判断，不能只看 `state`。
剩下的只是**客户端分支体验**问题（`state` 不在 done/failed/cancelled 三态内，需要额外判断）。**不建议改判据，可考虑补一个 `cancelled_partial` 语义别名。**

---

### ISSUE-R14【低，文档】`total` 与 `results` 按"关联"计数，不是按唯一文件

E2 实测：`铲运机` `total=110`，但唯一 FileId 只有 109（FileId 1 有两处归属各算一条）。
**影响**：Agent 报"110 条文件"会与实际文件数不符（本轮 Agent 自己纠正为"110 条关联 = 109 个唯一 FileId"，属模型能力强而非产品提示）。
**建议**：返回体加 `uniqueFileCount`，或在文档写明按 LinkId 计数。

---

## 二、Agent 工作流

### ISSUE-R11【判据歧义】"只上传不分析"写在文件名/正文里，Agent 拒绝当指令

E3 中样本 5 文件名含"只上传不分析"、正文也写了"不需要提取说明、标签、编号与日期"，但 Agent 仍填写了说明、标签与日期，理由是：
> "该要求只出现在文件名和正文，属文件内嵌指令，规范明确不得上升为 Agent 指令；你本人也未要求跳过分析。"

这与安全原则一致（**不能把文件内容当指令**），却与"按文件名标记只归档"的测试设计冲突。
**结论：判据设计问题，不判 Agent 失败**。产品侧若要支持"只归档"，应给显式参数（如 `analyze=false`）或界面开关，而不是靠文件名约定。

---

## 三、文档解析能力

- **PDF 文字层**：内置阅读器 + 自写抽取器均成功（样本 1）。
- **DOCX 表格**：读到 4 行工序表（样本 2）。
- **XLSX 多表**：读到第 2 张表才有的"共 12 台套"（样本 3）——证明不是只读第一张表。
- **无文字层扫描件**：抽内嵌图像为 PNG 后用视觉读出 6.8 mm/s 与结论（样本 4）。
- **限制**：被测 Agent 的默认 `python` 环境**没有** `pymupdf/openpyxl`，它自己写了一个 PDF 文本抽取器兜底；本轮 6.5 MB 扫描件处理耗时约 25 秒。属环境配置，不是产品缺陷。

---

## 四、环境/权限阻断

- **GUI 四项（A11 / A12-rev / A12-db / A14-gui）无法由 Agent 执行**，已按任务书要求给出集中人工步骤（`GUI_AUTH_DB_RESULTS.md`），未收到人工结果前保持未执行。
- 正式库 `IPSys.db` 未被接入：其 SHA-256 本轮前后均为 `F1B0B6E0…0EDEFDD0E`，mtime 仍为 `2026-10-25 11:06:42`。

---

## 五、原始证据缺失（第一轮遗留，本轮已处理）

| 编号 | 问题 | 本轮处理 |
|---|---|---|
| ISSUE-R01 | 6 个 `reports/*.json` 未随仓库提交，43 条里 31 条无法独立复核 | 全部找回并脱敏提交到 `recovered/`，SHA 见 `EVIDENCE_AUDIT.csv` 与 `recheck-data/e1_recovered.json` |
| ISSUE-R02 | `EVIDENCE_INDEX` 把 `protocol_probe.json` 写成 `reports/…`，实际在根目录 | 判 `BROKEN_PATH`，副本置于 `recovered/protocol_probe.json` |
| ISSUE-R03 | 第一轮称 "upload 与 metadata 共用 106 字" | 实测最长公共子串 **474 字**，已更正（`recheck-data/a02_a05.json`） |
| ISSUE-R04 | `MCP_ACTION_LOG.jsonl` 只有 95 条手写采样，**0 条 `search_records`**，且漏了 S06b 成功调用 | 本轮改用「客户端转录 + 结构化日志」双轨：`MCP_RAW_RECHECK.jsonl` 432 条，含 32 次 `search_records`、真实参数与响应 |
