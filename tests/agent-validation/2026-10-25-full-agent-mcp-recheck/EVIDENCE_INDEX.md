# 证据索引（第二轮）

所有路径均相对本目录 `tests/agent-validation/2026-10-25-full-agent-mcp-recheck/`，已在提交前用脚本逐条校验存在性（见文末）。

## 一、本目录文件

| 文件 | 内容 | 大小 |
|---|---|---|
| `RECHECK_REPORT.md` | 总报告：环境、E0–E7、旧结论复核、最终评分 | — |
| `CROSSWALK.csv` | 43 行（20 主项 + 23 子项）第一轮→第二轮状态映射 | 43 行 |
| `EVIDENCE_AUDIT.csv` | 同上 43 行的**证据链**分类（VALID/BROKEN_PATH/MISSING/SUMMARY_ONLY） | 43 行 |
| `MCP_RAW_RECHECK.jsonl` | 432 条结构化调用：`seq / ts / actor / tool / request / response_text` | 586 KB |
| `AGENT_TRACE.md` | 两个真实 Agent 会话的时间线、原句、规范加载位置、工具序列 | — |
| `S06B_RECONCILIATION.md` | S06b 矛盾溯源 | — |
| `GUI_AUTH_DB_RESULTS.md` | A11/A12-rev/A12-db/A14-gui 的未执行原因 + 人工步骤 | — |
| `GROUND_TRUTH_COMPARISON.md` | E3 私有真值与实测逐字段比对 | — |
| `ISSUES_RECHECK.md` | 14 条问题，分产品/Agent/解析/环境/证据 | — |
| `EVIDENCE_INDEX.md` | 本文件 | — |
| `recovered/*.json` | 第一轮 6 个 `reports/*.json` 的**脱敏副本**（找回件） | 6 个 |
| `recheck-data/*.json` | 第二轮原始数据：环境、S06b、规范比对、E2/E3 核验、两份 trace | 9 个 |
| `evidence/S05_p1.png` | 第一轮扫描件渲染图（与第一轮一致，SHA 相同） | — |

## 二、逐条结论 → 证据定位

### E0 环境与库身份

| 结论 | 证据 |
|---|---|
| 协议 2025-06-18、64 工具、capabilities 含 prompts | `recheck-data/e0_env.json` → `protocol` |
| 测试库前后变化、正式库未变 | `recheck-data/e0_env.json` → `db_before/db_after/binding_proof` |
| 宿主实际绑定 IPSys-test.db | 同上：`test_mtime_changed=true, test_sha_changed=true, prod_mtime_changed=false, prod_sha_changed=false` |
| R2 测试项目建立 | `MCP_RAW_RECHECK.jsonl` **#6**（`create_project` → id 11） |

### E1 证据审计与 S06b

| 结论 | 证据 |
|---|---|
| 6 个 `reports/*.json` 本地存在并已找回 | `recheck-data/e1_recovered.json`（含每个文件源 SHA 与副本 SHA） |
| 43 行分类：31 VALID / 7 SUMMARY_ONLY / 4 MISSING / 1 BROKEN_PATH | `EVIDENCE_AUDIT.csv` 第 4 列 |
| 第一轮日志 95 条、`search_records` 出现 0 次 | `recheck-data/e1_recovered.json` + 第一轮 `MCP_ACTION_LOG.jsonl` |
| 失败路径 `…\sources\S06b 同名异内容\…` | `MCP_RAW_RECHECK.jsonl` **#19**（`get_operation_result` request_id=`acc-20261025-up-s06b`） |
| 成功调用 → fileId=7 | 同上 **#18**（`…-s06b2`） |
| FileId 1/7 下载 SHA 对照 | `recheck-data/e1_s06b_dl.json`；`MCP_RAW_RECHECK.jsonl` **#16/#17**（`download_file_version`） |

### E2 真实 Agent 检索

| 结论 | 证据 |
|---|---|
| 规范加载在检索之前 | `MCP_RAW_RECHECK.jsonl` **#355（index）、#356（search）→ #357（第一次检索）**；`recheck-data/trace_e2.json` |
| `查运机` = 0 | **#357** |
| `铲运机` = 110，翻页 2 次 | **#358**（offset 0/limit 100）、**#359**（offset 100/limit 100，hasMore=false） |
| 自主扩词 19 次（含自认错字“撑毛”） | **#360–#377** |
| FileId 1 两处归属 | **#379**（`list_file_links file_id=1` → LinkId 1/32）；`recheck-data/trace_e2.json` |
| 检索性质判断（关键词包含匹配） | `AGENT_TRACE.md` 会话 A 第 A.4 节；规范原文见 `recheck-data/a02_a05.json` |
| 个人工作区隔离 | `recovered/p6_concurrency.json`（personal 恒 0） |

### E3 真实 Agent 智能入库

| 结论 | 证据 |
|---|---|
| 先读 index→upload→metadata | `MCP_RAW_RECHECK.jsonl` **#382/#383/#384** |
| 上传两批 | **#409 / #410** |
| 属性回写 6 次 | **#411–#416** |
| 复核 6 份版本/SHA | **#418–#423** |
| 落库属性与真值比对 | `recheck-data/e3_verify.json`；`GROUND_TRUTH_COMPARISON.md` |
| 扫描件视觉阅读 | `recheck-data/trace_e3.json`（23:16:33 `Read(scan.png)`） |
| 越权调用 0 次 | `MCP_RAW_RECHECK.jsonl` 中 `actor=agent-e3-ingest` 的 20 条，无 `delete_*`/`transfer_*`/`purge_trash` |

### 规范与 Prompts（A02–A05）

| 结论 | 证据 |
|---|---|
| index 无正文（8 个键，无 content/body） | `recheck-data/a02_a05.json` → `index` |
| 三篇 758/1438/1568 字 | 同上 → `topics` |
| prompts 与工具逐字相等 | 同上 → `prompt_vs_tool`（`equal: true` ×3，`len_delta: 0` ×3） |
| upload∩metadata 共用 474 字 | 同上 → `shared_upload_metadata.exact_lcs_len=474` |
| 读规范无副作用 | 同上 → `counts_before == counts_after` |
| 负例拒绝 | 同上 → `negatives`（-32602 / TOOL_CALL_REJECTED） |

### A12 / A14 现有部分

| 结论 | 证据 |
|---|---|
| 并发隔离 | `recovered/p6_concurrency.json` |
| CI 最新成功运行 #429 | https://github.com/zy19970/IPSys/actions/runs/40198175759 （head `3926caa`，`success`）；#424–#428 均 failure |
| GUI 四项未执行 | `GUI_AUTH_DB_RESULTS.md` |

## 三、未上传的本地证据（说明理由）

| 本地位置 | 内容 | 不提交原因 |
|---|---|---|
| `E:\Github\Transfer2DB\work\acceptance_r2\sources\`（109 个 PDF） | E2 检索样本 | 可由 `gen_r2_searchdata.py` 逐字节复现，体积无必要 |
| `…\sources_e3\`（6 个文件） | E3 盲测样本 | 同上，且真值公开会破坏后续复测的盲性；生成脚本 `gen_r2_e3.py` 已在本地 |
| `…\GROUND_TRUTH_E2_PRIVATE.json`、`…\GROUND_TRUTH_E3_PRIVATE.json` | 私有真值 | 任务书要求只留本地；脱敏结论见 `GROUND_TRUTH_COMPARISON.md` |
| `…\downloads_r2\s06b\file1_v1.pdf`、`file7_v1.pdf` | 下载副本 | SHA 已在 `e1_s06b_dl.json` 记录，原件属测试库内容 |
| `…\MCP_RAW_RECHECK.jsonl`（原始，未脱敏） | 含 `<HOME>` 真实路径 | 仓库内为脱敏版，字段结构一致 |
| `IPSys-test.db`、`Acceptance-B.db` | 测试库本体 | 含 SQLCipher 加密库，按任务书不上传 |

## 四、路径校验

提交前运行 `verify_paths.py` 扫描本目录所有 `.md/.csv` 中的相对路径：

```
必需文件缺失: 无
引用路径 22 个，存在 16 个，第一轮历史引用 6 个
缺失：0
```

其中 6 处 `reports/*.json` 是**第一轮证据字段的原文引用**（出现在 `EVIDENCE_AUDIT.csv` 的第 3 列与 `S06B_RECONCILIATION.md` 的引用里），
其真实副本已置于 `recovered/`，**不指向任何未推送文件**；`EVIDENCE_INDEX.md` 与 `RECHECK_REPORT.md` 的正文结论一律引用本目录内实际存在的路径。
