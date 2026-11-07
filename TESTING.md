# IPSys 现行测试与验收规则

> 现行状态见 [docs/CURRENT_BASELINE.md](docs/CURRENT_BASELINE.md)：版本、schema、Excel 列数、空间策略与验收口径全部以该文件为准（MCP 工具数不写死，以 `tools/list` 为准）。本文只写不随版本变化的规则；文内若出现具体数字、提交号或 CI 编号，均为当时记录，不构成现行约定。

## 测试结果必须分层

将“源码已实现”“自动 Windows CI 通过”“本地 Agent 实际执行”“用户人工反馈通过”“未执行/阻塞/失败”分别标记，并给出对应 SHA。任何一次旧报告中的 FAIL/BLOCKED 都是当时的真实记录，后续修复不得改写其原文；旧版本失败也不等于当前产品未修复。人工验证无截图、SHA 或独立解包日志的，不虚构证据。

## Agent 工作规范自动回归与真实 Agent 验收

宿主 --smoke 对 AgentGuidanceStore 使用独立临时配置文件，不修改当前用户正式 LocalAppData 配置；执行 AgentGuidanceStoreSmoke 覆盖默认、覆盖持久化、导入导出、版本冲突、根规则不可编辑、共享文件阅读规则保持等。WebSmoke 中的 AgentGuidanceHttpSmoke 验证浏览器会话鉴权、HTTP 编辑/恢复/导入与 MCP/Prompts 实时同源、并行读取一致性；Node agent-guidance-ui-smoke 检查设置控件和真实 JS 交互。NativeMcpFileQuerySmoke 追加 350 条缺项元数据并报告按 FileId 去重和分页查询耗时。

这些用例属于 Windows 工作流可执行的自动检查项目；某次实际是否通过需读取与代码 SHA 对应的 GitHub Actions 运行结果。第三方真实 Codex 的智能上传和元数据补录另需本机报告，不操作用户唯一资料库。

## 更新提示回归（离线）

`WebSmoke.cs` 使用伪造的 GitHub Release JSON 测试版本优先级、旧版 `rc0` 与 `rc.1`、正式版优先、草稿/缺少 Windows EXE 的过滤及未授权 API 拒绝，**不访问真实 GitHub 网络**。`src/IPSys.Web/tests/update-check-ui-smoke.cjs` 在模拟浏览器中验证自动检查无新版静默、设置中手动检查、非模态跳转白名单、开发构建、网络异常及按钮状态。现行 Windows CI 已将该 Node 用例纳入 UI 测试列表。真实 GitHub 可达性和系统浏览器打开行为仍应在用户本机按需要验证。

## 设置：完整性检查进度与 MCP 默认状态

新增后台完整性检查 API `POST /api/vault/integrity` 和只读状态 `GET /api/vault/integrity/task`，与历史 `GET /api/check` 同时保留，后者维持原同步诊断契约。用户可见进度采用服务器的真实两阶段（扫描加密页、统计未完成原件）和不确定进度条，不展示伪造百分比。后台检查使用 Gate 与文件任务锁，状态查询不经 Gate，允许耗时检查期间读取进度和重新进入设置时恢复。新 `VaultIntegrityHttpSmoke` 验证身份授权、任务互斥、阶段、终态与锁释放，新增 `integrity-progress-ui-smoke.cjs` 验证动画、提示、失败与恢复。

资料库首次打开与每次重新打开后本机 MCP 默认为开启；用户可以手动关闭并再次开启，关库/改密撤销授权。原 `NativeMcpSmoke` 的手动禁用/重新开启能力保留，`WebSmoke` 新增默认状态及重新打开断言。MCP 仍限当前 Windows 用户的本机受限管道，不修改底层 ID、工具表或数据库结构。

## 主分支 Windows CI 与测试依赖

Windows 工作流 [IPSys Windows build and smoke](https://github.com/zy19970/IPSys/actions/workflows/web-windows.yml) 定义 Debug/Release 编译、内嵌 Web 资源、双单 EXE 结构、MCP stdio、Node/Explorer、Edge/HTTP、SQLCipher/HTTP 等检查。工作流声明检查项目不代表每一次运行都实际执行完毕；需记录对应提交 SHA、运行 ID、Job steps、终态、日志和产物。账户限制导致 Job `steps=[]` 的运行应记为基础设施阻断，不能当作代码测试失败或成功。

`tests/retest-v2-2026-10-22/scripts/` 与其 `evidence/fixture.json` 仍被工作流使用；`src/IPSys.Web/tests/` 的 Node 冒烟脚本以及 `tests/tools/Verify-ExplorerExports.ps1` 同样是测试依赖，不能因目录名带历史日期就删除。执行方式见 [tests/README](./tests/README.md)。历次 CI 与已发布版本的验证边界集中见 [现行基线](./docs/CURRENT_BASELINE.md)，需要复现某次旧结果时查对应历史提交和 Actions。

## Excel 和知识产权现行回归

当前固定 XLSX：项目 **11 列**、知识产权 **19 列**、资料档案/资质/党团 **6 列**、综合资料 **6 列**（同名称/类别/备注/标签/年度/所属目录六列）；旧 4 列档案与旧 1/2/3 列综合资料不再作为兼容输入。合同资料作为普通项目目录，无独立合同 Excel。`excel-scope-smoke.cjs` 与 `NativeIpExcelHttpSmoke.cs` 检查完整服务端筛选、三编号和工作区，不能沿用交互搜索 60 条上限；每次核验需要记录与源码提交对应的测试实际执行结果。

## 普通文件夹和操作细节专项

普通 `archive_folder` 必须支持子目录、直接附件、可选属性、F2、版本、共享、移动和整树回收。单一“新建”动作直接打开表单，右键打包遵循选中范围；成功的永久删除进度面板约四秒自动隐藏。普通列表更新时间来自数据库有效变更，不以申请/签约日期代替。Node/HTTP 自动断言与用户本机视觉、拖拽和完整 GUI 操作应分别留证；不能拿历史 CI 成功替代当前 EXE 验收。

## 默认排序回归

必须按工作区分开验证：**个人工作区**的项目、知识产权、普通目录和附件默认按名称自然升序（例如 2 在 10 前），重进目录/切换工作区/清空搜索后恢复个人默认显示顺序，不改写 `position`；**公司工作区**项目和知识产权按业务年份降序（知识产权年份取申请日，缺失年份排最后），其它普通目录及附件按创建时间降序。验证修改时间与创建时间分离，并验证选择“自定义顺序”后仍读取持久 `position`；若早期测试记录缺少创建时刻，只能按明确回退规则处理，不能伪造历史日期。Node 入口 `src/IPSys.Web/tests/explorer-p1-regression-smoke.cjs`，建库字段和触发器断言见 `ResourceSchemaV2Smoke.cs`。

## 空间回收（SQLCipher INCREMENTAL）

新建资料库在建表前写入 `auto_vacuum=INCREMENTAL` 并回读断言；读不回 2 就拒绝建库，因为这个库将永远无法原地回收，而用户不会察觉。旧库（`auto_vacuum=0`）不迁移，设置页的回收入口直接置灰说明原因。

回收由 `POST /api/vault/compact` 触发，默认走 `VaultCompactStore.Reclaim()`：每批 256 页 `incremental_vacuum`，每批重新读取 `freelist_count`，一批下来没有进展就立即报错，不把“循环结束”当成“回收完成”；前后各做一次 `integrity_check` 与 `writing` 状态检查。取消在批次之间生效，已回收部分保留。`full:true` 保留完整 `VACUUM` 作为应急通道，设置页不提供入口。

批次选择依据既有合成样本：4096 页/批在该实验中较 256 页/批更慢、波动更大。**启动预检**按 `256 × page_size + 64 MiB` 评估数据库所在磁盘空间（常见 4 KiB 页约 65 MiB），不能将约 1 MiB 的单批回滚日志规模误当作全部预留门槛；完整 `VACUUM` 应急路径才适用 `库文件大小 × 2 + 128 MiB` 的空间预算。回收后需要核查空闲页数、最终文件大小、状态和完整性。

`VaultCompactSmoke`（回收与完整 VACUUM 两条路径、模式字段、旧库拒绝）与 `VaultCompactHttpSmoke` 已接入 `--smoke`。`IncrementalVacuumLabSmoke` 保留为隔离实验：`IPSys.Web.exe --vacuum-lab` 用独立临时库比较 NONE 与 INCREMENTAL，记录 `page_count/freelist_count`、物理字节、SHA-256、外键与完整性、重开与错误口令拒绝。CI 只跑 4 MiB 小样本守住回归；更大样本用 `IPSYS_VACUUM_LAB_MIB`（1～4096）显式触发，报告路径由 `IPSYS_VACUUM_LAB_REPORT` 指定。

**未测范围**：真实 20–50 GB 规模的回收速率、真实断电、磁盘满、长期碎片化。2 GiB 样本全程在页缓存内，测出的 200 MiB/s 是内存速度，不能外推到真实磁盘。

## 大文件与 ZIP64 专项

单 File 最大 8 GiB，传输/下载须流式进行，核查大小、SHA-256、数据库完整性和实际任务终态。工作流 `workflow_dispatch` 的 `large_file_smoke=true` 用于超过 2 GiB 的 SQLCipher/HTTP 上传下载及大库维护路径专项。是否真正运行与通过，以该次 Actions 日志和输出为准；旧版的完整 VACUUM 专项结果不能替代新建 INCREMENTAL 库的原地回收验证，不得通过跳过失败项制造成功。

`zip64_file_smoke=true` 使用产品 `src/IPSys.Web/wwwroot/export.js` 流式生成超过 4 GiB 的 ZIP64，校验 EOCD、locator、中央目录、长度和 SHA。专项默认验证**真实文件生成及结构**，数据源与保存句柄可由程序化适配层模拟，因此不能声称已验证真实 Edge 文件选择器或第三方解包器；人工解包验收单独记录。可在空间足够的隔离测试机设置 `IPSYS_ZIP64_OUTPUT_DIR` 并运行 `node src/IPSys.Web/tests/zip64-real-generate.cjs` 保留本地 ZIP，不能将大文件提交仓库。

## 必须核对的业务与安全边界

项目有独立业务属性，合同材料在该项目下的普通 `archive_folder/section=project` 目录中管理，可以继续嵌套；**不存在独立合同对象、合同状态和合同 Excel 台账**。Folder 无版本，FileVersion 保留附件历史；同工作区可共享 FileId 或由独立 FileId 复用 FileObject，跨工作区不能共享物理 FileObject。应同时验证前端反馈、真实 SQLCipher 表约束、事务回滚、SHA 和关联关系。

401 会话过期应清旧状态并引导重新登录；403/409/500 不是同一种错误。后台上传、跨工作区切换、悬挂原件取消、外部文件拖放与内部附件拖动、回收站大文件删除、数据库压缩、关闭程序都须保持原始工作区、任务锁与可观察的成功/失败状态。

历史冻结报告中的 T01～T09 涉及加密、数据一致性、断电/存储中断、磁盘不足、安全退出、备份/恢复与兼容边界。**此次合并与常规 CI 成功不表示全部发布级风险已验证。**若进入正式发布，须按对应风险做独立验证，绝不在用户唯一的正式资料库上进行破坏性测试。

## Agent 本地测试

本机实机用隔离 SQLCipher QA 数据库、专用 Edge profile、独立输入/导出目录；记录版本、运行时间、源码与 EXE SHA、环境、用例状态、可复验的结果与证据路径。旧测试报告应从 Git 历史取回并按原 SHA 追溯；不得以旧测试脚本直接派发 `drop` 却未实际产生 `dragstart` 的情况推断用户拖拽操作有缺陷。测试误报、环境阻塞、需求差异和真实 BUG 必须分别记录。

测试怎么跑见 [tests/README](./tests/README.md)；最新业务范围见 [REQUIREMENTS](./REQUIREMENTS.md)，技术约束见 [DESIGN](./DESIGN.md)。
