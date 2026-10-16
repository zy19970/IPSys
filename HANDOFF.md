# IPSys 跨会话交接（2026-10-16，当前直接进入 N4）

> **最新交接基线（2026-10-16，N4 第一批已通过）**：N2-04 全业务 V2 主链路完成；N4 已在 `0b0dfec` 移除新库旧表建表、开库旧 Store Ensure、回收站旧表操作和全部旧业务 HTTP 注册，重构纯 V2-only HTTP/MCP/Excel/搜索冒烟；Node 断言修正后 `013fa1e` 对应 [Windows CI #38905217041](https://github.com/zy19970/IPSys/actions/runs/38905217041) **completed/success**。下一步安全删除残余未使用的旧 Store/Provider 和历史测试代码，随后 Edge/Chrome、Codex、桌面 Excel 与 T01–T09 实机。没有旧正式数据库需要迁移。

## 1. 用户最终意图和冻结规则

IPSys 用户界面名称是「资料管理系统」，以**个人资料长期归档**为优先，公司资料独立工作区；单用户本地 WinForms + 127.0.0.1 Web/Edge/Chrome，单个加密 SQLCipher 资料库保存真实文件字节。Release 为依赖系统安装 .NET Desktop Runtime 8 x64 和 ASP.NET Core Runtime 8 x64 的单 EXE。

所有分类、项目、合同、知识产权、证书、个人经历/成果和综合资料统一为 **Folder**，业务字段按类型区分；只有附件是 **File**。Folder 有业务属性与排序、没有版本；File 有稳定身份、可选属性、独立版本历史。一个 FileId 可关联同区多个 Folder，升级版本时各处同步；两个独立 FileId 可只共用加密字节而各持版本；哈希/内容相同须展示已有文件名和文件夹路径，由用户选择共享文件身份、仅复用字节、独立保存或取消。公司与个人不共享实际 FileObject，文件不可长期无归属。取消旧测试数据库迁移/兼容/回填，不覆盖旧文件。

项目三类型；合同必须属于有效项目且只能从项目详情新增；知识产权七类型等结构化字段、金额显示 `0.00` 按 [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md)。不恢复自动备份、无归属文件池、正文 OCR、材料清单或自动提醒。

## 2. 已冻结 UI

个人优先；公司侧栏为企业资质、业务档案、公司项目、知识产权、综合资料；个人侧栏按身份与资质、知识产权与著作、科研与合作项目、成果与奖励、学术与社会活动、其他资料划分。工作台 **3×2** 入口卡片、紧凑表格、长名称优先、勾选/序号/持久排序。公司资质直接表格；公司业务档案**根层七系统分类纯导航卡片**（无下载/勾选，自建空分类可删），内层分类与资料任意混排表格、目录仅「打开」、资料「下载」、选目录后工具栏递归导出；个人分类卡片→台账→详情；项目/IP 台账→详情；综合资料保留原卡片视图。详情与名称点击和项目合同关系遵守 [UI_BASELINE.md](./UI_BASELINE.md)。

网页「关闭数据库」只关库并返回登录，不结束 WinForms 和本地 HTTP 服务；仅原生窗口 X/退出按钮关闭程序，上传过程中按安全三选项处理。

## 3. 已实现的代码与尚存过渡态

| 部分 | 实际状态 |
| --- | --- |
| 历史旧业务能力 | 旧独立 Store 曾实现项目/合同/IP/分类资料、附件/版本、Excel、PDF.js、ZIP、搜索和 MCP；正式业务现均走 V2；旧 Schema/Store/测试适配进入 N4 清理，不再当作生产数据入口 |
| R0/R1 | `Program.cs` 职责拆分及旧表 Folder 抽象/读写/复制转移已通过相应历史 CI，属临时兼容层 |
| **N1** | `ResourceSchemaV2.cs` 创建 Folder/File/版本/物理字节/关联新库及约束， [CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) 通过 |
| **N2-01** | `NativeFolderStore.cs`、`NativeFolderEndpoints.cs` 实现新表项目/合同/IP CRUD， [CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) 通过 |
| **N2-02** | `NativeArchiveStore.cs`、`NativeArchiveOrder.cs` 实现新表档案/综合资料 CRUD、混排排序/移动， [CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) 通过 |
| **N3-01** | 独立原生 File 上传/属性/历史版本/下载/初始归属已完成，[CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 成功；现有 IP 与项目合同网页已在后续 N2-03 接入，其他模块待切换 |
| **N3-02** | 同 FileId 多 Folder 关联/解绑/恢复已通过 [CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477)；现有 IP 与项目合同网页已在后续 N2-03 接入，其他模块待切换 |
| **N3-03** | 独立 FileId 同区复用加密原件内容/跨区独立物理复制已通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581)；现有 IP 与项目合同网页已在后续 N2-03 接入，其他模块待切换 |
| **N3-04** | 原生 SQLCipher 文件准备/异名查重/三选一或取消、writing 清理与一次性票据通过 [CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132)；现有 IP 与项目合同网页已在后续 N2-03 接入，其他模块待切换 |
| **N2-03-01** | 原生 V2 项目/合同/IP MCP 11 项 `v2_*` 命令已通过真实本机管道→HTTP→SQLCipher [CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366)，仅写 V2 `folders`；旧 14 项工具暂保留 |
| **N2-03-02** | 知识产权 FolderId→V2 File/Link/Version 原生端到端业务 API 与文件分类、共享/解绑/恢复已通过 Windows CI #38824119576；旧原生 UI 入口暂不变 |
| **N2-03-03** | 知识产权固定 XLSX 导入/导出已接入 V2 `folders.kind=ip` 身份，原申请号重复判断、筛选 FolderId、8 MiB/5000 行校验、更新保留附件字节，经真实 SQLCipher/HTTP [CI #38825202078](https://github.com/zy19970/IPSys/actions/runs/38825202078) 验收；旧 Excel 路由仍属过渡期 |
| **N2-03-04** | 现有知识产权网页已接入 V2 FolderId/FileId/LinkId/版本：列表、详情、CRUD、排序、Excel/原件上传查重、下载/预览与 ZIP/文件夹导出。功能提交 d214d20a，单 EXE 脚本修复 f480fca6，UI 断言 d8ded0b9，渲染修复 c56ce21f；最终 CI #38828523508 已通过验收。其余 IP 搜索/回收站、原名 MCP 与跨区复制已在 N2-03-05/06 完成 |
| **N2-03-05** | 旧名 IP MCP CRUD 与 V2 FolderId、统一搜索与 V2 回收站、完整原件版本跨区单事务复制移动已通过 [CI #38831972597](https://github.com/zy19970/IPSys/actions/runs/38831972597)。跨区 FileObject 独立；不可安全回收的共享物理历史禁止冒险永久清理 | 
| **N2-03-06** | MCP `upload_files(kind=ip)` 写 V2、`list_ip_files/delete_ip_file` 查询/解除关联、查重显式选择、追加版本已通过 [CI #38833862535](https://github.com/zy19970/IPSys/actions/runs/38833862535) | 
| **N2-03-07-01** | 项目/合同现有网页、真实父项目合同、原件 FileId/LinkId/版本、用户决定内容复用、排序、合同及链接同事务复制、下载与文件夹 ZIP 已对齐 V2，Windows CI #38836041449 成功 |
| **N2-03-07-02-01 MCP** | 当时的项目合同原名 MCP、附件与通用 list_files/delete_file 已切 V2，[CI #38845050570](https://github.com/zy19970/IPSys/actions/runs/38845050570) success；当时后续 Excel/搜索/回收站及完整复制也已在后续 N2-03 完成，实机仍待 N4 |
| **N2-03 项目合同全链路** | 项目固定 XLSX V2 导入导出、合同只读导出、搜索结果与回收站身份统一、完整项目及所属合同全部原件历史跨区事务复制/移动已通过 [Windows CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379)；失败测试后旧适配类型隔离已修复 |
| **N2-04（正式 V2 主链路自动验收完成）** | 企业资质、个人分类、公司业务档案与综合资料现有网页、原件历史、共享、归档 Excel、搜索、回收站、整记录转移都已用 V2；db79b82 增加 12 项档案/目录/综合资料 MCP 工具并使 upload_files/list_files 支持全部五类；6a7b1ff 将 ZIP/文件夹全版本导出也固定使用 FileId+Version，不再访问旧文件 ID，正式环境旧业务路由关闭、只有 --smoke 测试注册；[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) success。下一阶段 N4 清理旧表/Store 及只为历史测试留存的 API，再做 Edge/Chrome 真实用户操作验收。 |

**源码切换边界（N4 已验证）**：新建 SQLCipher 资料库只创建 V2 物理 Schema，打开/校验不再创建旧 records/attachments/chunks 或旧业务表；正式与 `--smoke` 都只注册 V2 Folder/File/Search，`RecycleStore` 只处理原生 FolderId/LinkId。代码库中仍存在一些旧 `ProjectStore/ArchiveStore/BusinessFiles.cs`、过渡 Provider 及历史测试文件，下一步先识别是否被 V2 业务校验或共用类型引用，再清除真正未引用部分。[Windows CI #38905217041](https://github.com/zy19970/IPSys/actions/runs/38905217041) success；不代表 Edge/Chrome 人工完成。

## 4. 接续开发的唯一顺序

1. **N3-01 已完成**：独立 `/api/v2/files` 支持 FileId、选填属性、加密字节分块与 SHA-256、原生 FileVersion/历史下载，上传与初次 Folder 归属同事务；[CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 已通过。
2. **N3-02 已完成**：同区多个有效 Folder 共用 FileId，文件属性和版本在所有有效位置同步；解除某一位置只软删除该链接，新版本不会自动让旧链接复活。全部链接解除后原件历史仍保留，可从原 Folder 查询已解除链接并显式恢复。详见 [CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477)。
3. **N3-03 已完成**：`NativeFileCopyStore`/`NativeFileCopyEndpoints` 支持明确的 `reuse-content`（仅同工作区，不同 FileId 与 FileVersion 共用完成的 FileObject）和 `independent-content`（重新复制全部有效版本字节并生成独立 FileObject，跨区强制使用）；属性及后续版本独立、目标 Folder 链接同事务，SQLCipher/HTTP 通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581)。
4. **N3-04 已通过原生 Store/HTTP CI**：`NativeFileChoiceStore/Resolve/Endpoints` 在 `prepare` 暂存 SQLCipher writing 块并计算 SHA-256，返回同区最新版已有文件名与 Folder 路径。用户明确选择 `share-file`、`reuse-content`、`independent` 或取消；已完成原件不自动合并，取消、关库/重开清理未确认块，30 分钟票据有效期、当前一个待确认上传。[CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) 已通过。
5. **N2-03-01 已完成**：`McpLocalV2.cs` 借助既有手动 MCP 开关、当前 Windows 用户的命名管道与会话令牌调用原生 `/api/v2/folders`，将项目、合同、知识产权查询、创建、修改和删除注册为 11 项独立 `v2_*` 工具。合同父项目、工作区、属性更新及软删恢复经真实 SQLCipher 通过 [CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366)，保证不写旧业务表。
6. **N2-03-02 已完成**：`NativeIpFileStore` 和 `NativeIpFileEndpoints` 将知识产权 `folders.kind=ip` 的真实 FolderId 绑定 V2 附件列表、分类原件上传、文件详情、追加版本、历史字节下载、共享关联与单条解绑/恢复。原生 IP CRUD 使用 `/api/v2/folders`；经过 SQLCipher/HTTP 真实回归验证有效归属、同区共享最新版本、目录属性变更不产生文件版本、跨 IP/跨区隔离、删除/恢复及旧表不双写。[CI #38824119576](https://github.com/zy19970/IPSys/actions/runs/38824119576) 成功（首轮编译因测试遗漏 Tags，占位修复后通过）。
7. **N2-03-03 已完成**：`ExcelLedger` 的 V2 IP 分层适配和 `NativeIpExcelEndpoints` 提供 `/api/v2/excel/{workspace}/ip/template`、`export`、`import`；固定 20 列、跳过/更新/另建策略继续有效，但实际使用 V2 FolderId 和 `attributes_json`，导入不碰旧专利表，不复制跨工作区附件。CI #38825202078 测试真实 Excel 旧格式兼容导入、V2 筛选导出/更新、附件链接及历史原件保持不变。
8. **N2-03-04 当时实施记录（后续已完成）**：新增 NativeIpUiEndpoints，按 V2 IP FolderId 聚合列表/原件 FileId/LinkId/历史版本，ip-v2.js 负责内容查重和明确选择；现有 app.js 知识产权列表、CRUD、Excel、文件历史与下载、跨 IP 共享、单位置解绑、文件夹/ZIP 导出使用 V2。新增材料类别在上传 resolve 同事务落库，并嵌入单 EXE。Node+HTTP 测试经历了旧 UI 断言及提示字符串修复，最新 CI #38828523508 已通过；该部分未做用户 Edge/Chrome 实机。
9. **N2-03-05 完成**：原有 MCP 的 `list_ips/create_ip/update_ip/delete_ip`、知识产权全局搜索/原件 FileId 与回收站、整记录含所有原件版本的跨公司/个人复制移动已通过 Windows [CI #38831972597](https://github.com/zy19970/IPSys/actions/runs/38831972597)。跨区物理 FileObject 必须独立，复制失败整体回滚。
10. **N2-03-06 完成**：新增 `McpLocalIpFiles.cs`；`upload_files(kind=ip)`、`list_ip_files`、`delete_ip_file` 均通过已授权本机 V2 HTTP，不再混用旧链接；同内容时必须由调用方显式确认复用选项，原件更新仍保留所有版本。[CI #38833862535](https://github.com/zy19970/IPSys/actions/runs/38833862535) 已成功。
11. **N2-03-07-01 已完成**：`NativeProjectContractUiEndpoints.cs` 将现有项目与合同台账、项目所属合同、文件列表/历史版本映射到新库 FolderId/FileId，并提供原生排序及合同复制时同事务关联现有原件；`app.js` 项目合同 CRUD、附件内容查重与用户选择、版本上传、共享/解绑、预览下载及 ZIP/文件夹导出已切 V2。`ip-v2.js` 共用文件确认流程，`export.js` 提供原生 FileId 下载。[CI #38836041449](https://github.com/zy19970/IPSys/actions/runs/38836041449) 真实 SQLCipher HTTP、Node UI、Windows Debug/Release 通过。**项目 Excel 和项目跨工作区复制当前禁止调用旧表**。
12. **N4 第一批已完成**：新库建表、打开验证、会话完整性诊断、回收站、正式/测试 HTTP 及完整 V2 冒烟在 [Windows CI #38905217041](https://github.com/zy19970/IPSys/actions/runs/38905217041) success，已经不需要 N2-04 旧业务接口回退。
13. **N2-03（历史阶段已完成）**：全部正式业务 API/MCP/Excel 已切换 V2，不再按旧计划重做 N2-03；本轮继续下方 N4 清理与验收。
14. **N4 接续（当前下一项）**：按实际依赖安全删除旧 Store/Provider/历史测试源文件，保护 V2 仍调用的校验器与数据 DTO；每次改动后跑 Windows CI，再对 Edge/Chrome、MCP/Excel 和 T01–T09 做实机验收。

旧测试数据全可丢弃，旧库不做迁移，拒绝打开旧库且不能覆盖源文件。**T08 是新版库版本识别和未来升级安全，而不是旧测试数据升级。**

## 5. 验收与执行规则

N1/N2 通过 Windows CI 不等于整个 V2 应用已验证。旧单文件上传上限仍 64 MiB；2 GiB+ 目标、SSD 故障、磁盘耗尽、手工备份一致性、密码修改与压缩尚未完整验收，不能声称正式发布完成。不在没有包含新数据的有效外部备份时删除来源文件。

按 AIGT-templates 的 `AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md` 工作，先核对主分支完整提交历史和当前源码，明确子任务后最小改动、针对性测试、直接提交 `main`、检查 CI 和 ref，并更新 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 的进度证据与 [RESOURCE_REFACTOR_TEST_MATRIX.md](./RESOURCE_REFACTOR_TEST_MATRIX.md) 的状态。需求与 UI 分别见 [REQUIREMENTS.md](./REQUIREMENTS.md)、[UI_BASELINE.md](./UI_BASELINE.md)，实机记录见 [WEB_TESTING.md](./WEB_TESTING.md)。

## N2-04 自动验收完成与 N4 交接（2026-10-16）

正式业务档案、企业资质、个人分类及综合资料正式网页在 N2-04 完成 V2 接入（`02619b2`、`db79b82`、`6a7b1ff`）。本次 N4 又由 `0b0dfec` 取消旧表建库和开库旧 Ensure、旧 HTTP 注册及旧综合回归，`013fa1e` 后 [Windows CI #38905217041](https://github.com/zy19970/IPSys/actions/runs/38905217041) completed/success。**当前仅剩残余源码裁剪、复杂边界及正式实机安全验收**，不要误将旧历史段落的 N2-03/N2-04 列为待开发。
