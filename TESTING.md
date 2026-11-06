# IPSys 现行测试与验收规则

> **当前适用版本（2026-11-06）**：以 SQLCipher **schema 4**、项目/知识产权/普通资料 Excel **11/19/6 列**、MCP **43 项工具**、统一普通目录模型为准。11 月 5 日已实现文件重命名、多选拖拽、Markdown/TXT 10 MiB 预览、修改数据库密码和回收站进度去重；[Windows CI #558](https://github.com/zy19970/IPSys/actions/runs/42048982231) 自动化成功，[v0.9.3-rc.1](https://github.com/zy19970/IPSys/releases/tag/v0.9.3-rc.1) 经 [手动 Publish #6](https://github.com/zy19970/IPSys/actions/runs/42053785425) 成功发布（发布不重跑 smoke）。人工整体验收另行记录。后文注明旧日期的方案、提交和 CI 属历史证据，不代表最新现状。


> **2026-11-05 当前 R1 跨模块墓碑目录专项验收**：产品/测试 SHA [`8a2780e`](https://github.com/zy19970/IPSys/commit/8a2780e7a8c18a5017e27e0e22c03aac1f078fae)，[Windows #541](https://github.com/zy19970/IPSys/actions/runs/41862168722) 日志确认 26 success、0 fail、2 optional ZIP64 skipped；`R1-HTTP PASS`（移动、恢复、两版文件原始字节一致）和 `R1-PURGE PASS`（移动后永久清理），C# SQLCipher/WebSmoke、Edge S5-E2E、全部 HTTP 15 项与 Edge 14 项门禁均通过，其中 T-P1-07 是经批准的短时进度观察 BLOCKED。随后 Actions 顶层已更新为 `completed/success`，本次自动化验收通过。R1 的故障注入回滚通过加密库 `ResourceSchemaV2Smoke.Run` 在 `--smoke` 运行链中覆盖。新库 schema 4，旧 schema 2/3 不迁移；本机用户人工 GUI 验收另行进行。

> **现行代码基线（2026-11-04）**：SQLCipher **schema 4**（`ResourceSchemaV2.cs` 文件名沿用；旧 schema 2/3 资料库拒绝打开，不迁移）。同工作区跨模块原位移动将已删除目录和隐藏的物理后代连同有效目录按父先子后在单一事务中更新 section，保留 FolderId/FileId/LinkId、文件版本与 deleted 状态；恢复后目录仍在目标模块，永久清理不会因旧 section 受阻。现行 MCP **43** 工具，普通资料 Excel **6** 列。产品实现见 [`8a2780e`](https://github.com/zy19970/IPSys/commit/8a2780e7a8c18a5017e27e0e22c03aac1f078fae)，对应 [Windows CI #541](https://github.com/zy19970/IPSys/actions/runs/41862168722) 的最终验收状态须以运行结果为准；上一基线 [#539](https://github.com/zy19970/IPSys/actions/runs/41856540366) 曾完成成功但仅验证了 R1 临时拒绝防护。用户本机人工验收与正式 Release 仍未执行。详见 [R1 修复核查](tests/REFACTOR_CLEANUP_REVIEW_20261104.md)，下方先前 S5 和较早 CI 叙述作为历史记录。

> **历史 S5 自动化基线（2026-11-04，#538）**：SQLCipher 新库 schema **3**，Folder 仅 `project`、`ip`、`archive_folder`；项目可包含多层普通目录，合同资料不再是独立对象。普通资料模块（含综合资料）Excel **6 列**，项目 11 列，知识产权 19 列；MCP **43** 工具。最终代码/测试提交 `cc7c1262eac0c2aaa36a0cd3107823320627e774` 的 [Windows CI #538](https://github.com/zy19970/IPSys/actions/runs/41839841405) `completed/success`（26 success、0 failure、2 optional ZIP64 skipped），Edge **14 PASS**、HTTP **12 PASS + T-P1-07 1 BLOCKED**（小库 VACUUM 进度抓拍）。第16.4节同批 MCP↔GUI 跨入口闭环 S5-E2E PASS；两类单 EXE 启动通过。**用户本机 GUI 人工复验及正式 Release 未进行**。详见 [S5 结案报告](tests/S5_FINAL_ACCEPTANCE_20261104.md)；下文较早日期的 CI 与历史决策原文仅用于追溯。

> **历史更新（2026-11-02）**：已核验产品/测试提交 `4567ae96b7` 的 Windows [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 为 completed/success（26 步成功、0 失败，两项可选 ZIP64 步骤跳过）。目前正式 Release 仍为 `v0.9.1-rc1`；自动 CI 不等于全部本地 GUI/第三方 Agent 验收。 原始测试报告与此前 FAIL/BLOCKED 事实保留原文，后续修复另列证据。

## 测试结果必须分层

将“源码已实现”“自动 Windows CI 通过”“本地 Agent 实际执行”“用户人工反馈通过”“未执行/阻塞/失败”分别标记，并给出对应 SHA。任何一次旧报告中的 FAIL/BLOCKED 都是当时的真实记录，后续修复不得改写其原文；旧版本失败也不等于当前产品未修复。人工验证无截图、SHA 或独立解包日志的，不虚构证据。

## Agent 分层规范第三阶段自动回归（CI 已通过，真实 Agent 另验）

宿主 --smoke 对 AgentGuidanceStore 使用独立临时配置文件，不修改当前用户正式 LocalAppData 配置；执行 AgentGuidanceStoreSmoke 覆盖默认、覆盖持久化、导入导出、版本冲突、根规则不可编辑、共享文件阅读规则保持等。WebSmoke 中的 AgentGuidanceHttpSmoke 验证浏览器会话鉴权、HTTP 编辑/恢复/导入与 MCP/Prompts 实时同源、并行读取一致性；Node agent-guidance-ui-smoke 检查设置控件和真实 JS 交互。NativeMcpFileQuerySmoke 追加 350 条缺项元数据并报告按 FileId 去重和分页查询耗时。

自动测试已纳入 [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 并随完整工作流成功；第三方真实 Codex 的智能上传和元数据补录仍需独立本机报告，不操作用户唯一资料库。

## 主分支 Windows CI

当前最近完整验证为 [Windows CI #558](https://github.com/zy19970/IPSys/actions/runs/42048982231)，对产品提交 `47b8fa3` completed/success（26 个成功步骤、0 失败、2 个可选 ZIP64 跳过），包含干净 checkout 直接 Release 的双单 EXE 包结构与版本资源验证、原有 Debug/Node/Edge/HTTP/SQLCipher/MCP 测试。新发布 [v0.9.3-rc.1](https://github.com/zy19970/IPSys/releases/tag/v0.9.3-rc.1) 的 [Publish #6](https://github.com/zy19970/IPSys/actions/runs/42053785425) validate、build 和 publish 三项均成功，但 Publish 不重跑 smoke。人工验收仍须在独立 schema 4 测试库执行并填写 [清单](./tests/MANUAL_ACCEPTANCE_20261105.md)。


主工作流 `.github/workflows/web-windows.yml` 由 Windows runner 执行 Debug/Release、内嵌 Web、现行 **43 项 MCP**、Node/Explorer、真实 Edge/HTTP、SQLCipher/HTTP 与两种单文件 EXE 启动。[CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 为 26 success、0 failure、2 项可选 ZIP64 skipped；旧合并 CI 只作历史记录。

`tests/retest-v2-2026-10-22/scripts/` 和相应 fixture **仍被 CI 调用**，即使路径包含历史日期，也不是可随意删除的废弃文件。测试实际入口以工作流和 `src/IPSys.Web/tests/` 中的现行引用为准。

## Excel 和知识产权现行回归

当前固定 XLSX：项目 **11 列**、知识产权 **19 列**、资料档案/资质/党团 **6 列**、综合资料 **6 列**（同名称/类别/备注/标签/年度/所属目录六列）；旧 4 列档案与旧 1/2/3 列综合资料不再作为兼容输入。合同资料作为普通项目目录，无独立合同 Excel。`excel-scope-smoke.cjs` 与 `NativeIpExcelHttpSmoke.cs` 检查完整服务端筛选、三编号和工作区，不能沿用交互搜索 60 条上限。最新 [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 已通过相关自动回归。

## 普通文件夹和操作细节专项

普通 `archive_folder` 必须同时支持子目录和直接附件、可选属性、F2、版本、共享、移动和整树回收。单一“新建”动作直接打开表单，右键打包遵循选中范围；成功的永久删除进度面板约 4 秒自动隐藏。普通列表显示数据库实际更新时间，不以申请/签约日期代替。[统一文件夹 CI](https://github.com/zy19970/IPSys/actions/runs/41406914227) 与 [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 已通过，用户本机视觉和完整 GUI 操作另验。

## 默认排序回归

分别检查知识产权申请年与授权年的冲突、项目起止年度、缺失年份沉底、同年份稳定次序，以及普通资料目录的真实创建时间与随后修改时间分离。旧 V2 文件夹缺失创建时间时不能凭空写入历史日期；可按 FolderId 次序近似排序。必须验证进入不同分类后的默认排序和手动切换“自定义顺序”后仍可查看持久化位置。有关 Node 回归见 `src/IPSys.Web/tests/explorer-p1-regression-smoke.cjs`，创建时间建库/升级验证见 `ResourceSchemaV2Smoke.cs`。

## 大文件与 ZIP64 专项

单 File 最大 8 GiB，传输/下载须流式进行，核查大小、SHA-256、数据库完整性和实际任务终态。工作流 `workflow_dispatch` 的 `large_file_smoke=true` 会运行超过 2 GiB 的 SQLCipher/HTTP 上传下载及大库 VACUUM；[专项 #39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663) 已通过 22/22 步，包括成功压缩与 `integrity_check`。不能通过延迟失败检查或跳过压缩制造成功。

`zip64_file_smoke=true` 使用产品 `src/IPSys.Web/wwwroot/export.js` 流式写真实超过 4 GiB 的 ZIP64，校验 EOCD、locator、中央目录、长度及完整文件 SHA；[专项 #39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) 已通过 24/24 步。其结论为 **PASS_GENERATION_ONLY**：数据源为可重复模拟流、保存句柄为程序化适配，不等同于真实 Edge 文件选择器或第三方解包器。用户后续确认本机人工检验已完成；不能把未上传的手动日志算作自动化证明。可在空闲空间足够的测试机设置 `IPSYS_ZIP64_OUTPUT_DIR` 并运行 `node src/IPSys.Web/tests/zip64-real-generate.cjs` 保留本地 ZIP，不要把大 ZIP 提交仓库。

## 必须核对的业务与安全边界

一项目多合同，合同必须附属于项目；业务 Folder 无版本，附件 FileVersion 永久保留；同区可共享 FileId 或独立 FileId 复用 FileObject，但跨区不能共用物理 FileObject。应同时验证前端反馈和真实 SQLCipher 表约束、事务回滚、SHA 与关联关系。

401 会话过期应清旧状态并引导重新登录；403/409/500 不是同一种错误。后台上传、跨工作区切换、悬挂原件取消、外部文件拖放与内部附件拖动、回收站大文件删除、数据库压缩、关闭程序都须保持原始工作区、任务锁与可观察的成功/失败状态。

历史冻结报告中的 T01～T09 涉及加密、数据一致性、断电/存储中断、磁盘不足、安全退出、备份/恢复与兼容边界。**此次合并与常规 CI 成功不表示全部发布级风险已验证。**若进入正式发布，须按对应风险做独立验证，绝不在用户唯一的正式资料库上进行破坏性测试。

## Agent 本地测试

本机实机用隔离 SQLCipher QA 数据库、专用 Edge profile、独立输入/导出目录；记录版本、运行时间、源码与 EXE SHA、环境、用例状态、可复验的结果与证据路径。旧 132 项/16 项补测/第三批实机报告分别保留。若旧脚本直接派发 `drop` 而没有产生真实 `dragstart`，不能把脚本前置缺失当作已证实的用户拖放缺陷。测试误报、环境阻塞、需求差异、真实 BUG 必须分类报告。

原始阶段与完整证据见 [TEST_EVIDENCE_INDEX](./tests/TEST_EVIDENCE_INDEX.md)；最新业务范围见 [REQUIREMENTS](./REQUIREMENTS.md)，技术约束见 [DESIGN](./DESIGN.md)。
