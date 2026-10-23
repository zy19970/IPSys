# 证据索引（第三批）

所有路径相对于 `docs/agent-validation/phase3-real-save-20261023-a18b47b/`。
本地大文件与 QA 库本体不上传仓库，位置与摘要见文末。

## 1. 环境与被测物

| 证据 | 路径 | 说明 |
|---|---|---|
| 环境快照 | `evidence/json/env.json` | HEAD、EXE SHA256/字节数、OS/Edge/Node/.NET、会话属性、宿主端口、QA 库路径、磁盘余量 |
| 解锁与真实窗口 | `evidence/shots/env-unlock.png` | 非 headless Edge 解锁后的首页；本批已无「保存密码？」气泡 |
| CI 失败日志 | `evidence/logs/ci-a18b47b.log` | run `39923781118` 的 `--smoke` 失败栈（VaultCompactHttpSmoke） |
| CI 对照日志 | `evidence/logs/ci-14fd8a8.log` | run `39923548693`（引入隔离证明的提交）通过 |

## 2. ST3-03 原生保存

| 证据 | 路径 | 说明 |
|---|---|---|
| ZIP 审计报告 | `explorer-export-audit.json` | `result: PASS`；3 个条目、长度与 SHA 全对；`independentExtractor: NOT_RUN:7z missing` |
| 审计清单 | `zip-manifest.json` | 源文件 ↔ ZIP 条目映射（项目/合同/附件 三级） |
| 原生保存对话框 | `evidence/shots/ST3-03-saveas-dialog.png` | Chromium/Windows 系统保存对话框（标题为站点编辑警告）；取消尝试命中的是同一窗口，截图与之一致，故不重复入库 |
| 路径已填入 | `evidence/shots/probe-commit.png` | 真实键盘输入后：目录跳到 `D:\IPSys-QA\exports`、文件名 `st303-project.zip` |
| 导出诊断现场 | `evidence/shots/diag-export.png` | 逐秒诊断时的页面（该张无导出条，仅作现场，不承担结论） |
| 导出诊断 | `evidence/json/diag-export.json` | 逐秒记录：`showSaveFilePicker` 存在、系统对话框在 1 秒内出现、页面保持 visible |
| 数据准备 | `evidence/json/st303-setup.json`、`st303-setup2.json` | 项目 p:8、合同 c:9/c:10、三份附件的上传结果 |

ZIP 本体（不入库）：`build-retest/phase3-20261023-1809/evidence/artifacts/st303-first-attempt-defaultdir.zip`
12,908 字节，SHA256 `5D16C579D8CC429D57A24FAF467891A95CC22233B9B2FD2BE9BC528E9AEDC8D8`。

## 3. ST3-04 物理隔离

| 证据 | 路径 | 说明 |
|---|---|---|
| UI 操作记录 | `evidence/json/st304-ui.json` | 建项目 p:11 / 合同 c:12 / 知识产权 i:13；附件 v1→v2；两次跨工作区复制表单提交 |
| 只读 SQL 结果 | `evidence/json/st304-objects.json` | 8 行 `file_versions→file_objects→file_chunks` JOIN 结果 |
| 只读 SQL 语句 | `evidence/json/st304.sql` | 可原样复跑的查询 |
| 工作区现场 | `evidence/shots/ST3-04-company.png` | 复制后的公司工作区列表 |

比对结论：同一内容在两工作区 `object_id` 全不同（4/8、5/9、6/10、7/11），
`size`＝`SUM(length(file_chunks.bytes))`，版本号一一对应，违规 0 项。

## 4. 本地保留、未入库的物件

| 物件 | 位置 | 摘要 |
|---|---|---|
| 独立 QA 库 | `build-retest/phase3-20261023-1809/qa/vault-p3.db` | 159,744 字节；口令在 `qa/cred.json`（不入库） |
| 被测发布物 | `build-retest/phase3-20261023-1809/publish/IPSys.Web.exe` | 5,269,734 字节，SHA256 `DC8BED6C…` |
| 输入原件 | `E:\IPSys-QA\inputs\` | p3-project-attach/p3-contract-a/p3-contract-b/p3-iso-v1/v2/contract/ip |
| 真实 ZIP | `build-retest/phase3-20261023-1809/evidence/artifacts/st303-first-attempt-defaultdir.zip` | 12,908 字节，见上 |

## 5. 证据口径

- 二进制与多 GB 文件不入库；只提交小型 JSON、截图与摘要。
- 本轮成功那一次的明细控制台 JSON 被后续失败重试覆盖；
  结论只依赖 ZIP 本体、`explorer-export-audit.json`、截图与 CI 日志，不做补写。
- 任何 `BLOCKED` 的理由都在 `PHASE3_REPORT.md` 里给出可复验的客观限制。
