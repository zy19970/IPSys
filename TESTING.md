# IPSys 现行测试与验收规则

> 现行状态见 [docs/CURRENT_BASELINE.md](docs/CURRENT_BASELINE.md)：版本、schema、Excel 列数、空间策略与验收口径全部以该文件为准（MCP 工具数不写死，以 `tools/list` 为准）。本文只写不随版本变化的规则；文内若出现具体数字、提交号或 CI 编号，均为当时记录，不构成现行约定。

## 测试结果必须分层

将“源码已实现”“自动 Windows CI 通过”“本地 Agent 实际执行”“用户人工反馈通过”“未执行/阻塞/失败”分别标记，并给出对应 SHA。任何一次旧报告中的 FAIL/BLOCKED 都是当时的真实记录，后续修复不得改写其原文；旧版本失败也不等于当前产品未修复。人工验证无截图、SHA 或独立解包日志的，不虚构证据。

## Agent 分层规范第三阶段自动回归（CI 已通过，真实 Agent 另验）

宿主 --smoke 对 AgentGuidanceStore 使用独立临时配置文件，不修改当前用户正式 LocalAppData 配置；执行 AgentGuidanceStoreSmoke 覆盖默认、覆盖持久化、导入导出、版本冲突、根规则不可编辑、共享文件阅读规则保持等。WebSmoke 中的 AgentGuidanceHttpSmoke 验证浏览器会话鉴权、HTTP 编辑/恢复/导入与 MCP/Prompts 实时同源、并行读取一致性；Node agent-guidance-ui-smoke 检查设置控件和真实 JS 交互。NativeMcpFileQuerySmoke 追加 350 条缺项元数据并报告按 FileId 去重和分页查询耗时。

自动测试已纳入 [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 并随完整工作流成功；第三方真实 Codex 的智能上传和元数据补录仍需独立本机报告，不操作用户唯一资料库。

## 更新提示回归（离线）

`WebSmoke.cs` 使用伪造的 GitHub Release JSON 测试版本优先级、旧版 `rc0` 与 `rc.1`、正式版优先、草稿/缺少 Windows EXE 的过滤及未授权 API 拒绝，**不访问真实 GitHub 网络**。`src/IPSys.Web/tests/update-check-ui-smoke.cjs` 在模拟浏览器中验证自动检查无新版静默、设置中手动检查、非模态跳转白名单、开发构建、网络异常及按钮状态。现行 Windows CI 已将该 Node 用例纳入 UI 测试列表。真实 GitHub 可达性和系统浏览器打开行为仍应在用户本机按需要验证。

## 设置：完整性检查进度与 MCP 默认状态

新增后台完整性检查 API `POST /api/vault/integrity` 和只读状态 `GET /api/vault/integrity/task`，与历史 `GET /api/check` 同时保留，后者维持原同步诊断契约。用户可见进度采用服务器的真实两阶段（扫描加密页、统计未完成原件）和不确定进度条，不展示伪造百分比。后台检查使用 Gate 与文件任务锁，状态查询不经 Gate，允许耗时检查期间读取进度和重新进入设置时恢复。新 `VaultIntegrityHttpSmoke` 验证身份授权、任务互斥、阶段、终态与锁释放，新增 `integrity-progress-ui-smoke.cjs` 验证动画、提示、失败与恢复。

资料库首次打开与每次重新打开后本机 MCP 默认为开启；用户可以手动关闭并再次开启，关库/改密撤销授权。原 `NativeMcpSmoke` 的手动禁用/重新开启能力保留，`WebSmoke` 新增默认状态及重新打开断言。MCP 仍限当前 Windows 用户的本机受限管道，不修改底层 ID、工具表或数据库结构。

## 主分支 Windows CI

当前最近完整验证为 [Windows CI #558](https://github.com/zy19970/IPSys/actions/runs/42048982231)，对产品提交 `47b8fa3` completed/success（26 个成功步骤、0 失败、2 个可选 ZIP64 跳过），包含干净 checkout 直接 Release 的双单 EXE 包结构与版本资源验证、原有 Debug/Node/Edge/HTTP/SQLCipher/MCP 测试。新发布 [v0.9.3-rc.1](https://github.com/zy19970/IPSys/releases/tag/v0.9.3-rc.1) 的 [Publish #6](https://github.com/zy19970/IPSys/actions/runs/42053785425) validate、build 和 publish 三项均成功，但 Publish 不重跑 smoke。人工验收仍须在独立 schema 4 测试库执行并单独记录结果；CI 通过不代表用户本机可用。


主工作流 `.github/workflows/web-windows.yml` 由 Windows runner 执行 Debug/Release、内嵌 Web、现行 MCP 工具清单（数量以 `tools/list` 为准）、Node/Explorer、真实 Edge/HTTP、SQLCipher/HTTP 与两种单文件 EXE 启动。[CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 为 26 success、0 failure、2 项可选 ZIP64 skipped；旧合并 CI 只作历史记录。

`tests/retest-v2-2026-10-22/scripts/` 和相应 fixture **仍被 CI 调用**，即使路径包含历史日期，也不是可随意删除的废弃文件。测试实际入口以工作流和 `src/IPSys.Web/tests/` 中的现行引用为准。

## Excel 和知识产权现行回归

当前固定 XLSX：项目 **11 列**、知识产权 **19 列**、资料档案/资质/党团 **6 列**、综合资料 **6 列**（同名称/类别/备注/标签/年度/所属目录六列）；旧 4 列档案与旧 1/2/3 列综合资料不再作为兼容输入。合同资料作为普通项目目录，无独立合同 Excel。`excel-scope-smoke.cjs` 与 `NativeIpExcelHttpSmoke.cs` 检查完整服务端筛选、三编号和工作区，不能沿用交互搜索 60 条上限。最新 [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 已通过相关自动回归。

## 普通文件夹和操作细节专项

普通 `archive_folder` 必须同时支持子目录和直接附件、可选属性、F2、版本、共享、移动和整树回收。单一“新建”动作直接打开表单，右键打包遵循选中范围；成功的永久删除进度面板约 4 秒自动隐藏。普通列表显示数据库实际更新时间，不以申请/签约日期代替。[统一文件夹 CI](https://github.com/zy19970/IPSys/actions/runs/41406914227) 与 [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 已通过，用户本机视觉和完整 GUI 操作另验。

## 默认排序回归

分别检查知识产权申请年与授权年的冲突、项目起止年度、缺失年份沉底、同年份稳定次序，以及普通资料目录的真实创建时间与随后修改时间分离。旧 V2 文件夹缺失创建时间时不能凭空写入历史日期；可按 FolderId 次序近似排序。必须验证进入不同分类后的默认排序和手动切换“自定义顺序”后仍可查看持久化位置。有关 Node 回归见 `src/IPSys.Web/tests/explorer-p1-regression-smoke.cjs`，创建时间建库/升级验证见 `ResourceSchemaV2Smoke.cs`。

## 空间回收（SQLCipher INCREMENTAL）

新建资料库在建表前写入 `auto_vacuum=INCREMENTAL` 并回读断言；读不回 2 就拒绝建库，因为这个库将永远无法原地回收，而用户不会察觉。旧库（`auto_vacuum=0`）不迁移，设置页的回收入口直接置灰说明原因。

回收由 `POST /api/vault/compact` 触发，默认走 `VaultCompactStore.Reclaim()`：每批 256 页 `incremental_vacuum`，每批重新读取 `freelist_count`，一批下来没有进展就立即报错，不把“循环结束”当成“回收完成”；前后各做一次 `integrity_check` 与 `writing` 状态检查。取消在批次之间生效，已回收部分保留。`full:true` 保留完整 `VACUUM` 作为应急通道，设置页不提供入口。

批次 256 页来自实测：2 GiB 库回收 3.07 GiB 时，4096 页/批比 256 页/批慢 3.3 倍且耗时波动大三倍。原地回收的额外空间约为单批回滚日志（1 MiB），不再要求两倍库大小。

`VaultCompactSmoke`（回收与完整 VACUUM 两条路径、模式字段、旧库拒绝）与 `VaultCompactHttpSmoke` 已接入 `--smoke`。`IncrementalVacuumLabSmoke` 保留为隔离实验：`IPSys.Web.exe --vacuum-lab` 用独立临时库比较 NONE 与 INCREMENTAL，记录 `page_count/freelist_count`、物理字节、SHA-256、外键与完整性、重开与错误口令拒绝。CI 只跑 4 MiB 小样本守住回归；更大样本用 `IPSYS_VACUUM_LAB_MIB`（1～4096）显式触发，报告路径由 `IPSYS_VACUUM_LAB_REPORT` 指定。

**未测范围**：真实 20–50 GB 规模的回收速率、真实断电、磁盘满、长期碎片化。2 GiB 样本全程在页缓存内，测出的 200 MiB/s 是内存速度，不能外推到真实磁盘。

## 大文件与 ZIP64 专项

单 File 最大 8 GiB，传输/下载须流式进行，核查大小、SHA-256、数据库完整性和实际任务终态。工作流 `workflow_dispatch` 的 `large_file_smoke=true` 会运行超过 2 GiB 的 SQLCipher/HTTP 上传下载及大库 VACUUM；[专项 #39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663) 已通过 22/22 步，包括成功压缩与 `integrity_check`。不能通过延迟失败检查或跳过压缩制造成功。

`zip64_file_smoke=true` 使用产品 `src/IPSys.Web/wwwroot/export.js` 流式写真实超过 4 GiB 的 ZIP64，校验 EOCD、locator、中央目录、长度及完整文件 SHA；[专项 #39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) 已通过 24/24 步。其结论为 **PASS_GENERATION_ONLY**：数据源为可重复模拟流、保存句柄为程序化适配，不等同于真实 Edge 文件选择器或第三方解包器。用户后续确认本机人工检验已完成；不能把未上传的手动日志算作自动化证明。可在空闲空间足够的测试机设置 `IPSYS_ZIP64_OUTPUT_DIR` 并运行 `node src/IPSys.Web/tests/zip64-real-generate.cjs` 保留本地 ZIP，不要把大 ZIP 提交仓库。

## 必须核对的业务与安全边界

一项目多合同，合同必须附属于项目；业务 Folder 无版本，附件 FileVersion 永久保留；同区可共享 FileId 或独立 FileId 复用 FileObject，但跨区不能共用物理 FileObject。应同时验证前端反馈和真实 SQLCipher 表约束、事务回滚、SHA 与关联关系。

401 会话过期应清旧状态并引导重新登录；403/409/500 不是同一种错误。后台上传、跨工作区切换、悬挂原件取消、外部文件拖放与内部附件拖动、回收站大文件删除、数据库压缩、关闭程序都须保持原始工作区、任务锁与可观察的成功/失败状态。

历史冻结报告中的 T01～T09 涉及加密、数据一致性、断电/存储中断、磁盘不足、安全退出、备份/恢复与兼容边界。**此次合并与常规 CI 成功不表示全部发布级风险已验证。**若进入正式发布，须按对应风险做独立验证，绝不在用户唯一的正式资料库上进行破坏性测试。

## Agent 本地测试

本机实机用隔离 SQLCipher QA 数据库、专用 Edge profile、独立输入/导出目录；记录版本、运行时间、源码与 EXE SHA、环境、用例状态、可复验的结果与证据路径。旧 132 项/16 项补测/第三批实机报告分别保留。若旧脚本直接派发 `drop` 而没有产生真实 `dragstart`，不能把脚本前置缺失当作已证实的用户拖放缺陷。测试误报、环境阻塞、需求差异、真实 BUG 必须分类报告。

测试怎么跑见 [tests/README](./tests/README.md)；最新业务范围见 [REQUIREMENTS](./REQUIREMENTS.md)，技术约束见 [DESIGN](./DESIGN.md)。
