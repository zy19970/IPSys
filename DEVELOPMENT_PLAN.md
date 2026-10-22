# IPSys 开发计划与验收进度（2026-10-17，N4 实机验收接续版）

> **第二阶段最新验收基线（2026-10-23）**：F2-01～F2-06 功能代码与专项自动回归已收敛，F2-06 的产品提交及测试修复截至 `ff34a8be`，Windows CI [#39818858991](https://github.com/zy19970/IPSys/actions/runs/39818858991) **completed/success**（Debug、Release、前端 Node、HTTP/Edge、SQLCipher）；随后仅增加文档提交。完整的 **[本地 Agent 验收任务书](./docs/IPSys_Explorer_Phase2_Agent_Complete_Retest.md)** 和 **[132 项 CSV 清单](./docs/IPSys_Explorer_Phase2_Agent_Test_Cases.csv)** 已推送至 `work/onedrive-file-manager`，但本地 Agent **尚未实测**，最终稳定性/数据完整性与是否合并 main 必须以本地实际报告裁决。


> **当前优先级（2026-10-22，用户最新确认）**：先在 `work/onedrive-file-manager` 开发分支完成 **Explorer 第二阶段功能完整性收敛**（资料库创建、业务档案目录与混排排序、附件关联复制移动、业务记录转移、拖放与公共入口统一），各功能包执行匹配回归和 Windows CI；**全部功能完成后再统一由用户本地 Agent 对最新构建做全面稳定性/安全性验收**。以 [Explorer 第二阶段实施计划](./docs/EXPLORER_PHASE2_FUNCTIONAL_COMPLETENESS_2026-10-22.md) 为当前施工顺序，早期“先做完整实机验收再开发功能”只作为历史记录，不再是现阶段优先级。开发分支不自动合并 main。

> **T02 超 2 GiB 功能进展（2026-10-17）**：V2 单文件上限已调整为 **8 GiB**，正式直接上传和 prepare/resolve 查重确认均已通过 **2,147,495,993 字节**的 Windows SQLCipher/HTTP 流式 SHA-256 上传下载往返；[Windows CI #39023923481](https://github.com/zy19970/IPSys/actions/runs/39023923481) 与 [#39024449728](https://github.com/zy19970/IPSys/actions/runs/39024449728) success。ZIP64 Node 结构回归成功。下一步是用户 Edge/Chrome 实机、ZIP64 解压互操作与 T03/T04 中断/备份安全验证，见 [LARGE_FILE_TESTING.md](./LARGE_FILE_TESTING.md)。


> **当前执行依据**：[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 的冻结模型 + [HANDOFF.md](./HANDOFF.md) 的最新交接。N2-04 全业务 V2、N4 两批旧物理模型/代码清理、MCP 三批功能及后续黑盒 ISS-001～018 修复均已提交；2026-10-17 接口收敛 [`2620c109`](https://github.com/zy19970/IPSys/commit/2620c109043f779eeb57f411210f99bb2f21e554) 将公开 MCP 工具从 70 减为 **59**，删除 11 个重复 `v2_*` 名称并清理前端无效旧式上传分支， [Windows CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428) **completed/success**。旧 V1 数据迁移/回填已取消。**下一阶段主要为当前 59 工具的真实 Agent/Windows 权限复测、N4 复杂业务及 T01–T09 故障安全验证；尚未正式发布。**


## 1. 产品和已确认架构

IPSys 用户可见名称为「资料管理系统」，采用 Windows WinForms 启动器、本机 `127.0.0.1` ASP.NET Core 网页、Edge/Chrome；网页和 PDF.js 内嵌到依赖外置 .NET 8 两类运行时的单 EXE。SQLCipher 单份加密库分离个人/公司工作区，原件字节加密入库。

**Folder 是所有分类及业务对象，有父级、类型、业务属性、排序和软删状态，没有版本；File 才有独立 FileId、选填属性及文件版本。** Folder 与 File 多对多。同工作区不同 Folder 可共享 FileId（版本同步），也可将独立 FileId 的相同字节复用一个 FileObject（版本互不影响）；用户在发现同内容文件时决定引用已有文件、仅复用内容、独立保存或取消。跨工作区禁止共享物理文件对象。项目可独立存在，合同必须依附有效项目；具体业务字段和 UI 按 [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md)、[UI_BASELINE.md](./UI_BASELINE.md) 执行。

## 2. 当前实现状态与证据

| 阶段 | 状态 | 范围与限制 |
| --- | --- | --- |
| M0/M1、U0、B01–B06、P1/P2/MCP | 历史功能及验收基线 | 当时独立业务 Store 已由 V2 正式主链路接管；旧代码和历史测试适配已在 N4 第二批清理，不能用旧 CI 代替最新全项实机验证 |
| R0/R1 | 已完成相应历史 CI | Program 职责拆分、旧表上的 Folder Provider/浏览/CRUD/复制转移适配；属过渡层 |
| **N1 新 Schema** | **Windows CI 通过** | V2 六张核心资源表、版本识别、工作区/父子约束、历史对象写后保护；[CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) |
| **N2-01** | **Windows CI 通过** | 项目、合同、知识产权在新 `folders` 上的原生 CRUD、软删恢复；[CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) |
| **N2-02** | **Windows CI 通过** | 档案目录/资料、综合资料原生 CRUD，目录/资料混排排序与移动；[CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) |
| **N3-01** | **原生 CI 通过（历史阶段）** | V2 File 分块上传/属性/版本/初始归属和回滚 [CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418)；随后已接入全部正式业务页面，文件属性交互仍需 N4 实机核对 |
| **N3-02** | **Windows CI 通过** | 同 FileId 多 Folder 关联/解绑/恢复、历史版本和字节保护 [CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) |
| **N3-03** | **Windows CI 通过** | 不同 FileId 同区复用物理内容、跨区重新写入原件，通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581) |
| **N3-04** | **Windows CI 通过** | SQLCipher writing 暂存、同内容含异名查重、原件名/目录路径提示、明确选择与取消清理；[CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) |
| **N2-03-01（历史）** | **当时 CI 通过，现行工具名已收敛** | 当时新增的 11 个 `v2_*` MCP 别名曾用于验证同一 V2 `folders`；在 [`2620c109`](https://github.com/zy19970/IPSys/commit/2620c109043f779eeb57f411210f99bb2f21e554) 中已删除对外别名，当前只保留 59 个无前缀工具。旧 [CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366) 为历史证据 |
| **N2-03-02** | **原生 CI 通过（历史阶段）** | IP V2 FolderId/FileId/LinkId/版本后台闭环 [CI #38824119576](https://github.com/zy19970/IPSys/actions/runs/38824119576)；当时尚未切换的网页/Excel/MCP 后续已完成 |
| **N2-03-04** | **CI 通过（历史阶段）** | IP 网页、原件和 Excel 接入 V2，[CI #38828523508](https://github.com/zy19970/IPSys/actions/runs/38828523508)；当时待开发的搜索、回收站、MCP、跨区复制后续已完成 |
| **N2-03-05** | **Windows CI #38831972597 已通过** | IP 原名 MCP CRUD、统一搜索及 V2 回收站使用唯一 FolderId；跨区整 IP 文件夹含多份文件历史在同一个 SQLCipher 事务中复制/移动，源工作区和目标工作区的 FileObject 物理独立；拒绝不安全的物理永久删除。 |
| **N2-03-06** | **Windows CI #38833862535 已通过** | 原 MCP `upload_files(kind=ip)`、新增 `list_ip_files/delete_ip_file` 接入 V2 FileId/LinkId，支持本机原件、更新版本、SHA-256 同内容确认/引用/物理复用/独立保存和工作区隔离，不再触达旧 IP 附件表。 |
| **N2-03-03** | **Windows CI 通过** | V2 知识产权 XLSX 沿用固定20列与重复记录策略，仅读写新版 FolderId/attributes_json，Excel 更新不改变原 IP/附件身份；真实 SQLCipher/HTTP [CI #38825202078](https://github.com/zy19970/IPSys/actions/runs/38825202078) 通过 |
| **N2-03-07-01** | **CI 通过（历史阶段）** | 项目合同网页/文件/导出 V2 化，[CI #38836041449](https://github.com/zy19970/IPSys/actions/runs/38836041449)；当时剩余原名 MCP/Excel/搜索/跨区复制已在后续 N2-03 结束 |
| **N2-03-07-02-01 原名 MCP/原件** | **完整 Windows CI #38845050570 已通过** | 原名项目合同 CRUD、`upload_files`、专用文件查删、通用 `list_files/delete_file` 均已使用 V2 FolderId/FileId/LinkId；[#38844746654](https://github.com/zy19970/IPSys/actions/runs/38844746654) 已通过，[#38845050570](https://github.com/zy19970/IPSys/actions/runs/38845050570) **success** 核验通用命令 |
| **N2-03 项目合同完整业务链路** | **Windows CI 已通过** | Excel 项目导入/导出、合同只读导出，搜索结果采用真实 V2 FolderId/FileId；V2 项目/合同回收站与共享 LinkId 的保护；完整项目携全部合同和多版原件的单 SQLCipher 事务复制移动，跨区独立 FileObject；[CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379) success。 |
| **N2-04 分类档案与综合资料统一接入** | **正式网页及外围 V2 全链路自动回归通过** | 现有业务档案、资质、个人分类与综合资料页面、固定 Excel、统一搜索、回收站、文件版本/共享及整记录跨区原件复制已接入 SQLCipher V2；db79b82 补齐目录/档案/综合资料 MCP CRUD、原件上传与查询；6a7b1ff 修复全模块 ZIP/文件夹历史版本导出旧 business ID，并将所有已停用旧业务 HTTP 仅注册于 --smoke。最终 [Windows CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) **success**，自动化主链路达到 N2-04 交付门槛；下一阶段 N4 清理旧表/Store 与历史测试适配，Edge/Chrome 人工验收仍未完成。 |
| **MCP P0 与 P1 第一批** | **自动验收通过** | 并发管道/单实例与数值/`null` 参数；加密 `request_id` 操作日志、批量结果明细、三重 FileId/LinkId/FolderId 核验、撤权和超时；[CI #38917944549](https://github.com/zy19970/IPSys/actions/runs/38917944549)、[CI #38923795350](https://github.com/zy19970/IPSys/actions/runs/38923795350) |
| **MCP 第二批（历史）** | **自动验收通过** | `list_files` 单 SQL、`list_files_page` 1–200 分页及筛选；当时同时支持原名/`v2_*`，重复别名现已删除。[CI #38927263017](https://github.com/zy19970/IPSys/actions/runs/38927263017) |
| **MCP 第三批 14 项业务补齐** | **自动验收通过** | 合同局部编辑、文件属性/版本及指定版本下载、关联/恢复/复制、四类资料转移、统一搜索、回收站查询/恢复；[Windows CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431)（`080a599`），用户实机和长任务待测 |

正式网页、MCP、Excel、搜索/回收站和原件导出只读写 V2。N4 两批旧物理层及 31 份停用源码裁剪已在 [CI #38911635273](https://github.com/zy19970/IPSys/actions/runs/38911635273) 验证。之后的 MCP 并发、请求幂等、异步长文件、安全隔离、业务工具补齐及 ISS-001～018 修复均已进入 `main`。在历史 70 工具版本上，用户独立实机黑盒报告 `MCP_TEST_RESULTS/2026-10-17/` 为 **37 项 PASS28 / FAIL0 / BLOCKED9**、ISS-001～015 **15/15 PASS**；ISS-016～018 的后续修复通过 [CI #39014009578](https://github.com/zy19970/IPSys/actions/runs/39014009578)，而最新 MCP 59 工具与前端旧上传死分支清理通过 [CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428)。这些新提交尚无同一条件下的新一轮独立用户实机黑盒报告，不应混作已经全部实测。


## 3. 历史施工建议（已被当前第二阶段顺序覆盖）

1. **当前版本 MCP 一次性定点验收**：客户端刷新工具清单，按 [MCP_INTERFACE_CLEANUP_TEST.md](./MCP_INTERFACE_CLEANUP_TEST.md) 核验 **59** 个唯一工具、无 `v2_*`、**13** 个数组型列表、项目/合同/IP 原名工具与 V2 HTTP FolderId 对应；并复测 ISS-016～018 及文件共享/查重/版本和异步任务。
2. **补齐 9 项历史 BLOCKED 真实权限/GUI 场景**：管理员/普通完整性级别、另一个 Windows 用户/会话、Codex/WorkBuddy 组合、授权及撤销流程；拒绝以模拟 ACL 或降低 MIC 冒充安全通过。
3. **N4 复杂边界**：File 选填属性 UI、版本回收站引用、祖先目录搜索、父子目录同时勾选、同名 ZIP/文件夹、导出取消，Edge/Chrome、桌面 Excel、PDF/图片预览。
4. **T01–T09 与发布门禁**：数据盘故障/拔出、磁盘不足、长任务中退出/取消、手工备份副本一致性、未来受控升级、大文件上限/ZIP64 需求与实际范围。大文件现已实现 8 GiB 上传门禁与 ZIP64 代码；超 2 GiB 端到端与异常边界仍以专项验收结论为准。
5. **确认新的实际需求后再继续开发**：优先解决实机复测能复现的缺陷，不再重复 N2-04 或 N4 已完成的旧表清理。24 并发 p95 较旧轮升高但缺可比环境对照，单列性能观察项而非已确诊缺陷。

## 4. 安全、兼容和发布边界

[FREEZE_AUDIT.md](./FREEZE_AUDIT.md) 的 T01–T09 继续生效。T08 验证 V2 版本识别、拒绝且不覆盖旧测试库及未来安全升级，不做旧库迁移。现行正式 V2 单文件代码限制 **8 GiB**，ZIP64 已接入；超过 2 GiB 的真实数据往返、移动 SSD 中断、磁盘满、手工备份尚未全面实测，专项指南见 [LARGE_FILE_TESTING.md](./LARGE_FILE_TESTING.md)。Excel 输入上限 8 MiB/5000 行。无包含新数据的有效外部备份时不得自动删除来源文件。

开发进度分别标记「代码已实现」「Windows CI 通过」「用户实机通过」「未测/失败」。不以旧模块 CI 代替新库全链路验证，不以文档状态宣布正式发布完成。

## 5. 协作方式

每次依 AIGT-templates 的 `AGENTS.md`、`AI_RULES/GIT_OPERATIONS.md` 及 IPSys 完整提交历史核对当前状态；按依赖完成一个明确子任务、进行匹配测试。当前 Explorer 功能阶段直接提交 `work/onedrive-file-manager`，全部完成及本地 Agent 总体验收后再决定是否合并 `main`，并核对 CI 与真实 ref。每个新功能/测试结果持续更新 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 和 [RESOURCE_REFACTOR_TEST_MATRIX.md](./RESOURCE_REFACTOR_TEST_MATRIX.md)。历史业务需求仍保留，最新明确覆盖决定优先。
