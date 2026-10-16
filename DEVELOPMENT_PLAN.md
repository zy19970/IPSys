# IPSys 开发计划与验收进度（2026-10-16，N4 当前执行版）

> **当前唯一执行依据**：[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)。N2-03 项目/合同/IP 和 N2-04 档案、资质、个人分类与综合资料的正式网页/原件/Excel/MCP/搜索回收站/导出已经统一 V2；[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) **completed/success**，对应源码提交 `6a7b1ff`。下一阶段 N4 清理旧 Schema/Store/历史测试适配与实机验收；没有旧正式数据库需要迁移。

## 1. 产品和已确认架构

IPSys 用户可见名称为「资料管理系统」，采用 Windows WinForms 启动器、本机 `127.0.0.1` ASP.NET Core 网页、Edge/Chrome；网页和 PDF.js 内嵌到依赖外置 .NET 8 两类运行时的单 EXE。SQLCipher 单份加密库分离个人/公司工作区，原件字节加密入库。

**Folder 是所有分类及业务对象，有父级、类型、业务属性、排序和软删状态，没有版本；File 才有独立 FileId、选填属性及文件版本。** Folder 与 File 多对多。同工作区不同 Folder 可共享 FileId（版本同步），也可将独立 FileId 的相同字节复用一个 FileObject（版本互不影响）；用户在发现同内容文件时决定引用已有文件、仅复用内容、独立保存或取消。跨工作区禁止共享物理文件对象。项目可独立存在，合同必须依附有效项目；具体业务字段和 UI 按 [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md)、[UI_BASELINE.md](./UI_BASELINE.md) 执行。

## 2. 当前实现状态与证据

| 阶段 | 状态 | 范围与限制 |
| --- | --- | --- |
| M0/M1、U0、B01–B06、P1/P2/MCP | 历史功能及验收基线 | 当时独立业务 Store 已由 V2 正式主链路接管；旧代码和历史测试依赖仍待 N4 清理，不能用旧 CI 代替最新全项实机验证 |
| R0/R1 | 已完成相应历史 CI | Program 职责拆分、旧表上的 Folder Provider/浏览/CRUD/复制转移适配；属过渡层 |
| **N1 新 Schema** | **Windows CI 通过** | V2 六张核心资源表、版本识别、工作区/父子约束、历史对象写后保护；[CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) |
| **N2-01** | **Windows CI 通过** | 项目、合同、知识产权在新 `folders` 上的原生 CRUD、软删恢复；[CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) |
| **N2-02** | **Windows CI 通过** | 档案目录/资料、综合资料原生 CRUD，目录/资料混排排序与移动；[CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) |
| **N3-01** | **原生 CI 通过（历史阶段）** | V2 File 分块上传/属性/版本/初始归属和回滚 [CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418)；随后已接入全部正式业务页面，文件属性交互仍需 N4 实机核对 |
| **N3-02** | **Windows CI 通过** | 同 FileId 多 Folder 关联/解绑/恢复、历史版本和字节保护 [CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) |
| **N3-03** | **Windows CI 通过** | 不同 FileId 同区复用物理内容、跨区重新写入原件，通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581) |
| **N3-04** | **Windows CI 通过** | SQLCipher writing 暂存、同内容含异名查重、原件名/目录路径提示、明确选择与取消清理；[CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) |
| **N2-03-01** | **Windows CI 通过** | 新增 11 项 `v2_*` MCP 项目/合同/IP 操作，经手动授权、本机管道和 HTTP 仅访问 V2 `folders`；[CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366)。旧 14 工具暂保留，未双写 |
| **N2-03-02** | **原生 CI 通过（历史阶段）** | IP V2 FolderId/FileId/LinkId/版本后台闭环 [CI #38824119576](https://github.com/zy19970/IPSys/actions/runs/38824119576)；当时尚未切换的网页/Excel/MCP 后续已完成 |
| **N2-03-04** | **CI 通过（历史阶段）** | IP 网页、原件和 Excel 接入 V2，[CI #38828523508](https://github.com/zy19970/IPSys/actions/runs/38828523508)；当时待开发的搜索、回收站、MCP、跨区复制后续已完成 |
| **N2-03-05** | **Windows CI #38831972597 已通过** | IP 原名 MCP CRUD、统一搜索及 V2 回收站使用唯一 FolderId；跨区整 IP 文件夹含多份文件历史在同一个 SQLCipher 事务中复制/移动，源工作区和目标工作区的 FileObject 物理独立；拒绝不安全的物理永久删除。 |
| **N2-03-06** | **Windows CI #38833862535 已通过** | 原 MCP `upload_files(kind=ip)`、新增 `list_ip_files/delete_ip_file` 接入 V2 FileId/LinkId，支持本机原件、更新版本、SHA-256 同内容确认/引用/物理复用/独立保存和工作区隔离，不再触达旧 IP 附件表。 |
| **N2-03-03** | **Windows CI 通过** | V2 知识产权 XLSX 沿用固定20列与重复记录策略，仅读写新版 FolderId/attributes_json，Excel 更新不改变原 IP/附件身份；真实 SQLCipher/HTTP [CI #38825202078](https://github.com/zy19970/IPSys/actions/runs/38825202078) 通过 |
| **N2-03-07-01** | **CI 通过（历史阶段）** | 项目合同网页/文件/导出 V2 化，[CI #38836041449](https://github.com/zy19970/IPSys/actions/runs/38836041449)；当时剩余原名 MCP/Excel/搜索/跨区复制已在后续 N2-03 结束 |
| **N2-03-07-02-01 原名 MCP/原件** | **完整 Windows CI #38845050570 已通过** | 原名项目合同 CRUD、`upload_files`、专用文件查删、通用 `list_files/delete_file` 均已使用 V2 FolderId/FileId/LinkId；[#38844746654](https://github.com/zy19970/IPSys/actions/runs/38844746654) 已通过，[#38845050570](https://github.com/zy19970/IPSys/actions/runs/38845050570) **success** 核验通用命令 |
| **N2-03 项目合同完整业务链路** | **Windows CI 已通过** | Excel 项目导入/导出、合同只读导出，搜索结果采用真实 V2 FolderId/FileId；V2 项目/合同回收站与共享 LinkId 的保护；完整项目携全部合同和多版原件的单 SQLCipher 事务复制移动，跨区独立 FileObject；[CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379) success。 |
| **N2-04 分类档案与综合资料统一接入** | **正式网页及外围 V2 全链路自动回归通过** | 现有业务档案、资质、个人分类与综合资料页面、固定 Excel、统一搜索、回收站、文件版本/共享及整记录跨区原件复制已接入 SQLCipher V2；db79b82 补齐目录/档案/综合资料 MCP CRUD、原件上传与查询；6a7b1ff 修复全模块 ZIP/文件夹历史版本导出旧 business ID，并将所有已停用旧业务 HTTP 仅注册于 --smoke。最终 [Windows CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) **success**，自动化主链路达到 N2-04 交付门槛；下一阶段 N4 清理旧表/Store 与历史测试适配，Edge/Chrome 人工验收仍未完成。 |

全部正式业务网页、MCP、Excel、搜索/回收站和文件历史导出使用 V2 FolderId/FileId/LinkId；旧物理表、Store、Provider 和测试路由还未清理。`Program.cs` 只在 `--smoke` 历史回归注册旧业务 HTTP，**不能误认为档案/综合资料现有网页还使用旧 Store**。N4 需先更新依赖旧表的测试后安全清除过渡层。

## 3. 下一步实际施工顺序（N4）

1. **N1/N2-01～04/N3-01～04 已完成对应自动验收**：全业务 V2 整合通过 [CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886)，不再把 N2-04 作为下一项重做。
2. **N4 旧结构清理（当前）**：将 `--smoke` 历史测试改为 V2 测试库，去除 `Vault` 中不再需要的 `records/attachments/chunks`、旧 Store/Provider/HTTP、旧搜索身份投影；回归新建、关闭、重开及业务数据完整性。
3. **N4 边界和自动回归**：文件选填属性 UI、版本/回收站引用、祖先目录搜索、重叠与同名导出、ZIP 取消；Windows Debug/Release/单 EXE、SQLCipher HTTP、Node UI/PDF/ZIP、MCP 和 Excel。
4. **N4 实机与安全**：Edge/Chrome、真实 Codex 和桌面 Excel，T01–T09 超大文件/SSD 故障/磁盘满/备份/退出及工作区隔离；依据结果再判断正式交付。

## 4. 安全、兼容和发布边界

[FREEZE_AUDIT.md](./FREEZE_AUDIT.md) 的 T01–T09 继续生效。T08 验证 V2 版本识别、拒绝且不覆盖旧测试库及未来安全升级，不做旧库迁移。现行正式 V2 单文件限制 **64 MiB**；超 2 GiB、移动 SSD 中断、磁盘满、手工备份尚未全面实测；ZIP 不支持 ZIP64（小于 4 GiB），Excel 输入上限 8 MiB/5000 行。无包含新数据的有效外部备份时不得自动删除来源文件。

开发进度分别标记「代码已实现」「Windows CI 通过」「用户实机通过」「未测/失败」。不以旧模块 CI 代替新库全链路验证，不以文档状态宣布正式发布完成。

## 5. 协作方式

每次依 AIGT-templates 的 `AGENTS.md`、`AI_RULES/GIT_OPERATIONS.md` 及 IPSys 完整提交历史核对当前状态；按依赖完成一个明确子任务、进行匹配测试、默认直接提交 `main`，然后核对 CI 与真实 ref。每个新功能/测试结果持续更新 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 和 [RESOURCE_REFACTOR_TEST_MATRIX.md](./RESOURCE_REFACTOR_TEST_MATRIX.md)。历史业务需求仍保留，最新明确覆盖决定优先。
