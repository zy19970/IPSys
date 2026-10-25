# 证据索引（EVIDENCE INDEX）

测试库：`E:\IPSys数据管理平台\IPSys-test.db`（新建，6,995,968 B）
本地批次目录：`C:\Users\Joey\AppData\Local\Temp\IPSys-Acceptance-20261025-01`
正式库 `IPSys.db` SHA-256 验收前后一致：`F1B0B6E00BFE4FCBAD53002679E5A934BFE0D3115CA11A5DB45597E0EDEFDD0E`

| ID | 证据形式 | 关键实测值 | 存放 |
| --- | --- | --- | --- |
| A01 | 协议响应 JSON | `protocolVersion=2025-06-18`；tools=64；v2_*=0；capabilities 含 prompts；instructions=281 字 | `reports/protocol_probe.json`、`MCP_ACTION_LOG.jsonl` |
| A02 | 目录 JSON | entries=`[search,upload,metadata]`；无 content/body；guidanceOnly=true；1208 B | `MCP_ACTION_LOG.jsonl` |
| A03 | 三篇正文比对 | 长度 758/1438/1568；三篇哈希互异；upload∩metadata 共用 106 字 | `reports/cases.json` |
| A04 | 前后状态快照 | 项目 0→0；IP 0→0；文件关联 0→0 | `reports/cases.json` |
| A05 | prompts/get vs tools/call | 三篇哈希逐一相等；index 长度 1208=1208 | `reports/cases.json` |
| A06 | 检索返回 | 查运机 0；铲运机 2（含 S01）；LHD 2；液压泵 1；通风未误命中 | `MCP_ACTION_LOG.jsonl` |
| A07 | 分页序列 | `[offset0 n2 hasMore=true next2]`、`[offset2 n2 hasMore=false]`；4 条唯一；personal 0 | `reports/ctx.json` |
| A07-dl | 下载文件 SHA | 下载 `S01_from_ipsys_v1.pdf` SHA=`B837551D…`＝源 SHA | `downloads/` |
| A07-link | 关联列表 | FileId=1 → LinkId `[1,32]`，FolderId `[8,10]` | `reports/ctx.json` |
| A08-a/b/c | upload 响应 + get_file_details | FileId 1/2/3/4；SHA 全一致；folderId=8；version=1；S01 编号日期、S02 空、S03 编号日期 | `reports/ctx.json` |
| A09-a | upload 响应 | S06a fileId=6、`choice=independent`、SHA 与 S01 相同；S01 仍 1 版 | `MCP_ACTION_LOG.jsonl` |
| A09-b | upload 响应 | S06b fileId=7；与 FileId 1 同名共存；S01 SHA 未变 | `reports/p3b.json` |
| A09-c | 错误逐文件返回 | `ok=false`、`isError=true`、“指定本机文件不存在。” | `MCP_ACTION_LOG.jsonl` |
| A09-d | 任务状态链 + 落地核对 | `uncertain` / `interrupted` / succeeded=1 failed=1 requested=12 / `cancelReason=user_cancel`；实际仅 T09 落地 | `reports/async2.json` |
| A10 | 补录前后详情 | FileId/LinkId/SHA/版本数不变；T03 补说明、T07 补说明+标签、T05 补 `BULK-05` | `reports/ctx.json`（backfill） |
| A11-version | 版本比对 | search/upload/metadata 目录版本＝正文版本 | `reports/cases.json` |
| A12-neg | 五个拒绝响应 | 跨工作区 404、错配 LinkId 拒绝、不存在 ID 404 | `MCP_ACTION_LOG.jsonl` |
| A12-noeffect | 详情回读 | FileId=5 版本数=1、说明=NULL（未被越界写改） | `reports/cases.json` |
| A12-conc | 并发结果 | 8+8 次并发 0.87 s；company 命中 3 条、personal 恒 0；最大 151 ms | `reports/p6_concurrency.json` |
| A15 | 属性回读 | S08（fileId 5）四项均 NULL | `reports/cases.json` |
| A16 | 渲染图 + 文字层 | 文字层 0 字；视觉识别 2026-10-19 / SCL-100 / 六项正常；回写日期、编号留空 | `evidence/S05_p1.png` |
| A17 | 缺项矩阵 | 13/13、10/10、2/2、8/8、5/5、4/4、4/4、2/2 全一致；7 页 0.35 s | `reports/ctx.json`（p4） |
| A17-dedupe | 共享后缺项查询 | FileId=5 两处关联，缺项结果只 1 次；13 条唯一 | `reports/dedupe.json` |
| A18-a | associate 响应 | `sourceLinkId=1 → targetFolderId=10`，`moved=false` | `MCP_ACTION_LOG.jsonl` |
| A18-b | 批量部分失败 | `status=partial_success`，succeeded=2 failed=1 requested=3 | `MCP_ACTION_LOG.jsonl` |
| A19 | 空白变体 | `" "`/`"\t"`/`"\u3000"`/`""`/`"; ;"` 归一为 NULL 并命中缺项 | `reports/ctx.json` |
| A19-neg | 非法参数 | `missing_fields=bogus` → 400 中文拒绝 | `MCP_ACTION_LOG.jsonl` |
| A20 | 无依据字段 | S02 编号/日期仍 NULL；T06 日期仍 NULL | `reports/ctx.json` |

## 测试库内生成的业务对象（可逐条复核）

| 对象 | ID | 说明 |
| --- | --- | --- |
| company 项目 | FolderId 8 | 验收测试项目-公司A（S01–S08、S06a/6b、S05、T01–T09） |
| personal 项目 | FolderId 9 | 验收测试项目-个人B（空，用于隔离） |
| company 项目 | FolderId 10 | 验收测试项目-字段矩阵（T01–T14 + T15/T16 + 共享的 FileId 1/5） |
| 文件 | FileId 1–33 | 含两个同名 FileId（1 与 7）用于冲突验证 |
| 关联 | LinkId 1–35 | FileId 1 → 1/32；FileId 5 → 5/35 |

## 未纳入的证据

- 未保存 SQLCipher 数据库本体、密码、令牌、真实用户规范或任何真实业务文件。
- `reports/cases.json` 与 `MCP_ACTION_LOG.jsonl` 已剔除本机绝对路径中的用户名以外信息（路径仅保留批次目录内的相对文件名）。
