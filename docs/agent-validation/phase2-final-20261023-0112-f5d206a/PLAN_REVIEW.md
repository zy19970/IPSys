# Phase 2 最终验收任务书 —— 方案审查

> 审查对象：`docs/IPSys_Explorer_Phase2_Agent_Complete_Retest.md`（250 行）与 `docs/IPSys_Explorer_Phase2_Agent_Test_Cases.csv`（132 行）。
> 审查目的：先判断方案是否**合理、正确、可执行**，再按修正后的口径做实际测试。
> 本文件是审查结论，不是测试结果；所有 PASS/BUG 结论在 `AGENT_TEST_REPORT.md` 中另行给出。

## 0. 审查基线与方法

| 项目 | 值 |
|---|---|
| 分支 | `work/onedrive-file-manager` |
| 本地 / 远程 HEAD | `f5d206a`（与 `origin` 同步，`rev-list --left-right --count` = 0/0） |
| CI 基线 | `ff34a8b`，Windows CI [#39818858991](https://github.com/zy19970/IPSys/actions/runs/39818858991) completed/success（GitHub API 实测） |
| 代码一致性 | `git diff ff34a8b..HEAD -- src frontend tools dist` 为空 → HEAD 只多出文档提交，产品代码与 CI 被测算例完全一致 |
| 工作树 | 有上一轮测试文档未提交（`REPORT.md` 改动、`RECHECK-LATEST.md`、`evidence/recheck-latest/`），**产品源码零改动** |
| 审查方法 | 逐条读任务书/CSV；用 `git`、源码 grep、GitHub API、CSV 解析核对事实前提；未在审查阶段执行产品用例 |

审查发现的问题分四级：

- **E（Error）**：事实错误或不可达前提，会让结论失真。
- **M（Method）**：方法学缺陷，会让统计或门禁不可比。
- **C（Contract）**：与当前产品契约不符，会让用例无法按原文执行。
- **G（Gap）**：覆盖缺口，建议补，不阻断执行。

## 1. 总体结论

**方向合理，事实基础基本准确，但按原文直接执行会得到不可关闭、部分不可比的结果。**

- **合理之处**：A–L 12 组覆盖环境、建库、CRUD、目录排序、附件版本、跨区复制转移、拖放、公共 UI、PDF/Excel/搜索、回收站、大文件并发、安全视觉；132 项 ID 连续、无重复；每条都有操作与判定标准；缺陷裁决、证据要求、"不把脚本异常算产品 BUG"、"不以旧报告推断 PASS" 都写得很专业。
- **不正确之处**：1 处硬事实错误（I-06）、1 处不可达前置（AIGT 仓库 404）、4 处方法学缺陷（P0 膨胀且无 P2、fixture 无重置、33 MiB 无法制造并发窗口、整库文件哈希不是有效不变量）、2 处契约缺口（J-12 的 FK/孤儿检查无入口、无列版本路由）。
- **可执行性**：中等偏低。132 项 + 100 个 P0 + "同类业务覆盖两个工作区" + 所有动作走真实 UI，单轮工作量很大；其中至少 3 项 P0 在本机大概率只能 BLOCKED。
- **门禁可关闭性**：低。按 §六"全部 P0 无未解决 CONFIRMED_BUG"判定，只要 K-09（两个 MCP 客户端并发）、J-12（外键/孤儿直查）、F-12（空间不足）中任一项 BLOCKED，整轮就只能"有条件通过"，与产品实际质量无关。

**判定：修正后可执行；不建议按原文直接开跑。**

## 2. 站得住的前提（逐条核实为真）

| 任务书声明 | 核实方式 | 结论 |
|---|---|---|
| 真实 WinForms 宿主 | `IPSys.Web.csproj`：`OutputType=WinExe`、`UseWindowsForms=true`；`LauncherForm.cs` 存在 | 真 |
| 本机 HTTP + Edge | `Program.cs` 绑定 `127.0.0.1:0`；`LauncherForm` 打开默认浏览器 | 真 |
| SQLCipher V2 | `SQLitePCLRaw.bundle_e_sqlcipher 2.1.11`；`ResourceSchemaV2.cs` 写入 `resource_schema_version VALUES(1,2)` | 真 |
| 132 项用例 | MD 表格 132 条、CSV 132 条，ID 集合完全一致，无重复 | 真 |
| P0 优先 | P0 100 / P1 32 / P2 0（见 M-01） | 数值真，分级不合理 |
| 最新 Windows CI 成功 | GitHub API 查 `39818858991`：success，`head_sha=ff34a8b`，branch 正确 | 真 |
| 33 MiB 跨流式阈值 | `STREAM_MIN_BYTES = 32 * 1024 * 1024` | 真（但见 M-02） |
| 201/403 条分批 | 前端 `bridge.js` 按 200 条/批循环；后端 `RecycleStore.cs:457` 限制 1–200 | 真，F2-06 已实现分批 |
| 搜索覆盖备注/附件属性 | `SearchStore.cs` 匹配 `Remarks/Tags/ApplicationNo/...`、附件名/原件名/材料类别/文号/日期 | 真 |
| F2 与右键重命名 | `interactions.js:1294 renameNode`，系统目录明确拒绝 | 真 |
| 令牌丢失后"重新连接" | `interactions.js:171-174`，已解锁时隐藏"创建新资料库" | 真 |
| 目录/记录混排排序 | `NativeArchiveOrder.cs`、`/entries/reorder` 要求完整同级清单 | 真 |

这些前提成立，说明任务书不是凭空写的；问题集中在**少数被旧壳经验带偏的假设**和**统计/门禁设计**上。

## 3. 必须修正的问题

### E-01【硬事实错误】I-06 假设 Excel 有"筛选/选中/全部"三种导出范围，当前 Explorer 壳只有"全部"

证据：

- `frontend/explorer/js/excel.js:11` 注释原文：
  `mode 只有 all / filtered 两种,新壳没有台账行概念,统一用 all。`
- `excel.js:51` 固定发送 `json: { mode: "all", ids: null }`。
- 全前端搜索 `filtered`：除注释外**没有任何调用**；后端 `ExcelExportInput` 只接受 `all` / `filtered`（`Program.cs:183`）。

影响：按 I-06 判据"输出范围与 UI 所选语义一致"执行，UI 根本没有"筛选/选中"入口，只能判 `IMPLEMENTATION_GAP`；若判 PASS，证据与代码直接矛盾。

建议：I-06 改为"验证 UI 实际提供的导出范围；仅提供全部时记录 GAP，并把后端 filtered 能力单列为 API 能力证据，不算 UI 通过"。

### E-02【不可达前置】任务书要求先读的 AIGT-templates 仓库返回 404

证据：

- `GET https://api.github.com/repos/zy19970/AIGT-templates` → **404 Not Found**（IPSys 仓库同法可访问，排除网络问题）。
- 任务书写的 `https://github.com/zy19970/AIGT-templates/AGENTS.md` 即使仓库存在也不是合法文件地址（需要 `/blob/<branch>/`）。

影响：§开头"先读取 AGENTS.md 和 AI_RULES/GIT_OPERATIONS.md"是强制前置，实际无法满足；报告不能声称"已按 AIGT 规则执行"。

建议：改以本仓库 `HANDOFF.md §6` + 任务书 §六 为执行约定，并在报告中声明 AIGT 规则不可达，不伪造已读。

### M-01【方法学】100 个 P0、32 个 P1、0 个 P2，门禁不可关闭

证据：MD 与 CSV 统计一致——P0 100（76%）、P1 32、P2 **0**，而 §五 明确写了"UI 纯排版且功能可用通常标 P2"。

具体问题：

1. **7 个 P0 不是产品行为**：A-01/A-02/A-03/A-04/A-07 是基线、建目录、种数据、造 fixture；L-07/L-08 是"全程对比"和"汇总封存"，属于审计方法而非可独立执行的用例。它们计入 PASS 会稀释产品通过率。
2. **若干可用性项被判成 P0**：H-05/H-06/H-07（刷新后停留）、H-01（假按钮）、D-04（改名持久化）。这些重要，但按 §五"数据正确性/安全/高风险阻断"的定义，更像 P1。
3. **门禁不可达**：§六要求"全部 P0 有可核验证据且无未解决 CONFIRMED_BUG"。K-09（两个 MCP 客户端并发，需要命名管道授权）、J-12（外键/孤儿直查，见 C-01）、F-12（空间不足，无配额手段）三项 P0 在本机大概率 BLOCKED，于是整轮必然"不通过/有条件通过"——结论由环境决定，不是产品质量决定。

建议：**不静默改优先级**。保留 132 项的原始 P0/P1，另加一套"门禁口径"分类：`产品行为 / 基线准备 / 环境受限`。报告同时给两套统计，门禁只对"产品行为 P0"生效；`环境受限`单列并说明不可达原因。

### M-02【方法学】33 MiB 无法稳定制造"上传中"的并发窗口

K-02（上传中切工作区）、K-03（上传中关库/压缩/永久删除）、K-04（上传中刷新）、K-05（上传成功后立即取消/删除）、K-06（导出中切工作区）、K-10（终止上传请求）都要求在一个持续数秒的窗口内插入另一个动作。

本机是 loopback + NVMe，33 MiB 的传输 + SHA-256 + 加密写库通常在**数百毫秒**内结束，窗口不可控；一旦没插进去，用例会"看起来 PASS"但实际没测到竞态。

建议（择一，并在报告中记录实际手段）：

- 用 CDP `Network.emulateNetworkConditions` 限制上传吞吐（可精确制造 10–30 秒窗口）；
- 或改用 512 MiB–2 GiB 文件（磁盘 69 GB 可用，K-11 本来也要测 >2 GiB）；
- 两者都不可用时判 `BLOCKED`，**不许**在没有窗口的情况下判 PASS。

### M-03【方法学】L-03 用"整库文件哈希"判断"没有数据变化"是错误不变量

SQLCipher/SQLite 在正常关闭时会 checkpoint WAL、复用 freelist 页、更新 change counter；即使业务数据一字未变，`.db` 文件字节也会变化。按 L-03 的"关闭和重启前后对比数据库文件哈希"执行，几乎必然报"数据被修改"，然后被误判为产品缺陷。

建议：改为**逻辑摘要**——每张业务表行数 + 关键字段排序后 SHA-256 + 附件 `FileId/Version/SHA-256` 清单 + `/api/check` 的 `integrity_check`。文件哈希只作辅助；不一致时先排除 checkpoint/WAL，再下结论。

### M-04【可执行性】fixture 没有重置策略，破坏性用例会互相消耗

任务书 §二.3 只要求"测试操作会改变测试数据时先记录快照"，没有定义**何时、如何还原**。132 项共用一个库时，至少这些用例会消耗后续用例的前置数据：

- C-08 删除一个合同；F-03 移动合同；F-04 复制合同；
- E-06 移动附件关联；E-08 删除一条共享关联；
- J-01～J-06 永久删除项目/合同/附件/档案；J-10 一键清空；J-07/J-08 批量彻底删除 201/403 条。

上一轮 V3 实测已经踩过：前面的用例删掉了 `linkId=3`，后面的下载用例拿到 404，被误判成产品缺陷，重跑干净库后才恢复 PASS。

建议：**按组做快照/还原**——锁库 → 复制 `.db` 到 `snapshots/<group>.db` → 测试 → 锁库 → 覆盖还原 → 重开。执行顺序固定为"只读/创建类 → 修改类 → 删除/清空类"，J 组放最后。每次还原记录快照 SHA。

### C-01【契约缺口】J-12 的"外键检查、孤儿文件对象引用检查"没有现成入口

证据：

- `/api/check`（`SessionEndpoints.cs:113-127`）只执行 `PRAGMA integrity_check`，再查 `file_objects WHERE state='writing'` 计数；**没有** `foreign_key_check`，也没有孤儿引用查询。
- 本机 `which sqlcipher sqlite3` 为空，没有可直接开加密库的 CLI。

影响：J-12 的判据无法按原文执行；若拿 `/api/check` 的 `ok` 冒充"外键/孤儿检查通过"，就是证据造假。

建议：写一个**测试专用**小工具（不改进产品），引用同一 `SQLitePCLRaw.bundle_e_sqlcipher` + `Microsoft.Data.Sqlite`，用测试库口令打开，执行 `PRAGMA integrity_check; PRAGMA foreign_key_check;` 和孤儿查询（`folder_file_links` 指向不存在 Folder/File、`file_versions` 指向不存在 File、`file_chunks` 指向不存在 Object 等），输出 JSON。J-12 拆成"API 可达部分"与"直查部分"两条证据。

### C-02【契约缺口】没有"列版本"路由，E-02/E-05/J-05 的"历史版本可访问"需要另取版本号

证据：路由只有 `/api/v2/files/{workspace}/{id}/versions/{version}/download`，没有 `GET .../versions` 列表。

影响：不知道版本号就无法逐个下载校验。UI 详情面板可能展示版本，但脚本需要稳定取值。

建议：版本号从 UI 详情面板读取；读不到时，允许对测试库做只读查询（任务书 §二.2 允许 SQLCipher 只读查询），并在证据中记录取值来源。

### C-03【交付格式冲突】输出 CSV 要求 10 列，输入是 9 列；"每个用例仅一行"与双工作区/子场景冲突

- 输入 CSV 列：`case_id, priority, group, steps, expected, status, actual, evidence_paths, notes`（9 列）。
- §六.2 要求输出列：`case_id, priority, status, actual, expected, workspace, record_ids, evidence_paths, notes, timestamp`（10 列，新增 workspace/record_ids/timestamp，去掉 group/steps）。
- §三 又要求"同类业务覆盖公司与个人工作区"，而 `workspace` 是单值列。

建议：严格按 10 列输出、固定 132 行；`actual` 用 `company: …｜personal: …` 聚合，`record_ids` 分号分隔，子场景写进 `notes`；另在 `AGENT_TEST_REPORT.md` 附"子场景明细"表，避免一行丢信息。

### C-04【自动化边界】启动器打开的浏览器无法被 CDP 接管

证据：`LauncherForm.cs:175-190` 通过注册表判断默认浏览器，然后 `Process.Start(browser, target)`，**没有** `--remote-debugging-port` / `--user-data-dir` 参数。

影响：A-05 要求"WinForms 启动器 + 真实 Edge"，但全量 UI 用例需要 CDP 驱动；启动器起的 Edge 无法接管。

建议：A-05 用启动器实测"启动 → 自动打开浏览器 → 退出 → 重启"；其余 UI 用例由 Agent 用独立 `--user-data-dir` 启动真实 Edge，指向同一 URL。报告中明确声明："UI 是真实 Edge 渲染，但不是启动器自动打开的那个实例"；不得声称完全等同。

## 4. 覆盖缺口（建议补，不阻断）

| 编号 | 缺口 | 为什么重要 | 建议 |
|---|---|---|---|
| G-01 | 没有校验"跑的是不是最新前端产物" | 上一轮真实发生过：`build-retest/IPSys.Web.exe` 是 10-17 的旧包，打开的是旧 UI；`dist/` 不入库，缺 Node 时会静默用旧产物（csproj 只 Warning） | A-06 增加：`dist/app.js` 与 HTTP `/app.js` 逐字节一致、`dist` 不早于最新源码；报告记录 SHA-256 |
| G-02 | 没有 Host/Origin 固定校验用例 | 产品只允许 `127.0.0.1`，`localhost` 和伪造 Host/Origin 必须 403；这是安全边界，L-01 未覆盖 | 并入 L-01 子场景：`Host: evil`、`Host: localhost`、`Origin: http://evil` 各一次，记录状态码 |
| G-03 | 没有单实例守卫用例 | 重复启动会弹"已在当前会话运行"，且 `--mcp` 在守卫之前返回；多开是数据安全风险 | 并入 A-05 子场景：第二次启动宿主，记录提示与首个实例不受影响 |
| G-04 | Excel 输入上限（8 MiB / 5000 行）未列入 I-05 | `DEVELOPMENT_PLAN.md §4` 写明限额；超限行为应有明确拒绝 | I-05 子场景补一条超限导入 |
| G-05 | 没有"压缩后会话状态"的明确判据 | K-08 只说"会话处理正确"，不可判定 | 明确：压缩后能否继续读写、是否要求重开、失败是否回滚 |

## 5. 本轮执行口径（对应修正）

不改任务书原文，只在报告中声明偏差；所有偏差均可复核。

| 项目 | 原方案 | 本轮执行 | 记录方式 |
|---|---|---|---|
| 基线 | 最新 HEAD + CI | HEAD `f5d206a`，代码 `ff34a8b`，`git diff` 证明零差异 | `AGENT_TEST_REPORT.md §基线` |
| 用例数 | 132 | 132，不改 ID、不改优先级 | `TEST_CASE_RESULTS.csv` 132 行 |
| 门禁 | 全部 P0 无 BUG | 另加"产品行为 / 基线准备 / 环境受限"分类，门禁只对产品行为 P0 | 报告双统计 |
| 破坏性用例 | 快照 | 组间快照/还原，J 组最后 | `TEST_FIXTURE_NOTES.md` |
| 并发窗口 | 33 MiB | CDP 节流或大文件；无窗口判 BLOCKED | 证据记录实际手段与窗口 |
| L-03 | 文件哈希 | 逻辑摘要 + `/api/check` | 报告方法说明 |
| J-12 | integrity + FK + 孤儿 | API 部分 + 测试专用 SQL 工具 | 两份证据 |
| I-06 | 三种导出范围 | 按 UI 实际能力判 GAP | 证据含 `excel.js:11/51` |
| A-05 | 启动器 + Edge | 启动器实测 + CDP Edge 分离 | 报告声明 |
| CSV | 10 列 | 10 列 × 132 行 | `TEST_CASE_RESULTS.csv` |
| 推送 | 报告 + 必要证据索引 | 6 份文档 + `scripts/` + 轻量 JSON + 索引；截图/大文件留本地 | 索引注明 |

## 6. 结论

1. **方案是合理的**：覆盖面、分组、P0 优先、证据要求、缺陷独立复现、退出条件都达到可审计验收任务书的水准；132 项与 CSV 完全对齐，没有编号错误。
2. **方案不完全正确**：I-06 是硬事实错误；AIGT 前置不可达；P0 膨胀且无 P2 会让门禁失去区分度；fixture 无重置、33 MiB 无窗口、整库哈希三处方法学问题会让结论不可信；J-12/E-02 两处与当前契约不符。
3. **修正后可执行**：上述修正都不需要改产品代码，属于测试设计与取证方法。
4. **预期结论形态**：即使产品无重大缺陷，本轮也很可能只能给出"有条件通过"，因为 K-09/J-12/F-12 等 P0 受环境限制。报告会把"产品缺陷"与"环境不可达"分开列，不用环境限制掩盖产品问题，也不用产品缺陷解释环境限制。

---

审查人：本地 Agent
审查时间：2026-10-23 01:12 (+08:00)
审查对象 SHA：`f5d206a`（代码基线 `ff34a8b`）
