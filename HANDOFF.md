# IPSys 跨会话交接（2026-10-15，V2 新库主线）

> 检查快照为 `main@3ef17bd5f7fae90c79778c066935948d11dfa18d`。继续工作时应重新检查最新 `main` 与完整提交历史；进度和权威新库架构以 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 为准。本交接不再要求沿旧库迁移或直接进入 V1.0 发布验收。

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
| 旧业务版本 | 真实项目/合同/IP/分类档案、业务文件版本与回收站、PDF.js Canvas、文件夹/ZIP、Excel、搜索、本机 MCP 14 项和现行 UI 均已接入旧业务 API；曾有自动回归及部分用户实机确认 |
| R0/R1 | `Program.cs` 职责拆分及旧表 Folder 抽象/读写/复制转移已通过相应历史 CI，属临时兼容层 |
| **N1** | `ResourceSchemaV2.cs` 创建 Folder/File/版本/物理字节/关联新库及约束， [CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) 通过 |
| **N2-01** | `NativeFolderStore.cs`、`NativeFolderEndpoints.cs` 实现新表项目/合同/IP CRUD， [CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) 通过 |
| **N2-02** | `NativeArchiveStore.cs`、`NativeArchiveOrder.cs` 实现新表档案/综合资料 CRUD、混排排序/移动， [CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) 通过 |
| **N3-01** | 独立原生 File 上传/属性/历史版本/下载/初始归属已完成，[CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 成功；旧 UI 尚未切换 |
| **N3-02** | 同 FileId 多 Folder 关联/解绑/恢复已通过 [CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477)，但旧 UI 尚未切换 |
| **N3-03** | 独立 FileId 同区复用加密原件内容/跨区独立物理复制已通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581)；旧 UI 尚未接入 |
| **N3-04** | 原生 SQLCipher 文件准备/异名查重/三选一或取消、writing 清理与一次性票据通过 [CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132)，旧前端尚未接入 |
| **N2-03-01** | 原生 V2 项目/合同/IP MCP 11 项 `v2_*` 命令已通过真实本机管道→HTTP→SQLCipher [CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366)，仅写 V2 `folders`；旧 14 项工具暂保留 |
| **N2-03-02** | 知识产权 FolderId→V2 File/Link/Version 原生端到端业务 API 与文件分类、共享/解绑/恢复已通过 Windows CI #38824119576；旧原生 UI 入口暂不变 |
| **N2-03-03** | 知识产权固定 XLSX 导入/导出已接入 V2 `folders.kind=ip` 身份，原申请号重复判断、筛选 FolderId、8 MiB/5000 行校验、更新保留附件字节，经真实 SQLCipher/HTTP [CI #38825202078](https://github.com/zy19970/IPSys/actions/runs/38825202078) 验收；旧 Excel 路由仍属过渡期 |
| **N2-03-04** | 现有知识产权网页已接入 V2 FolderId/FileId/LinkId/版本：列表、详情、CRUD、排序、Excel/原件上传查重、下载/预览与 ZIP/文件夹导出。功能提交 d214d20a，单 EXE 脚本修复 f480fca6，UI 断言 d8ded0b9，渲染修复 c56ce21f；最终 CI #38828523508 已通过验收。旧统一搜索/回收站、旧 MCP IP 命名及跨工作区完整复制仍需后续处理 |
| **N2-03 其余接口、N4** | 未完成，旧业务 HTTP/附件/Excel/UI 尚未迁移到 V2 |

**源码切换边界**：`Vault.CreateSchema` 仍为旧综合资料创建 `records/attachments/chunks` 再建 V2；`Program.cs` 同时注册旧路由和 `/api/v2/folders`；`app.js` 仍调用 `/api/projects`、`/api/contracts`、`/api/archives` 等；`BusinessFiles.cs` 仍使用旧 `business_file_*` 表。此时新 Folder API 可单独测试，但原有前端/附件/MCP/Excel 尚未接入；不得提前删旧 Store 或做同一操作双写。

## 4. 接续开发的唯一顺序

1. **N3-01 已完成**：独立 `/api/v2/files` 支持 FileId、选填属性、加密字节分块与 SHA-256、原生 FileVersion/历史下载，上传与初次 Folder 归属同事务；[CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 已通过。
2. **N3-02 已完成**：同区多个有效 Folder 共用 FileId，文件属性和版本在所有有效位置同步；解除某一位置只软删除该链接，新版本不会自动让旧链接复活。全部链接解除后原件历史仍保留，可从原 Folder 查询已解除链接并显式恢复。详见 [CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477)。
3. **N3-03 已完成**：`NativeFileCopyStore`/`NativeFileCopyEndpoints` 支持明确的 `reuse-content`（仅同工作区，不同 FileId 与 FileVersion 共用完成的 FileObject）和 `independent-content`（重新复制全部有效版本字节并生成独立 FileObject，跨区强制使用）；属性及后续版本独立、目标 Folder 链接同事务，SQLCipher/HTTP 通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581)。
4. **N3-04 已通过原生 Store/HTTP CI**：`NativeFileChoiceStore/Resolve/Endpoints` 在 `prepare` 暂存 SQLCipher writing 块并计算 SHA-256，返回同区最新版已有文件名与 Folder 路径。用户明确选择 `share-file`、`reuse-content`、`independent` 或取消；已完成原件不自动合并，取消、关库/重开清理未确认块，30 分钟票据有效期、当前一个待确认上传。[CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) 已通过。
5. **N2-03-01 已完成**：`McpLocalV2.cs` 借助既有手动 MCP 开关、当前 Windows 用户的命名管道与会话令牌调用原生 `/api/v2/folders`，将项目、合同、知识产权查询、创建、修改和删除注册为 11 项独立 `v2_*` 工具。合同父项目、工作区、属性更新及软删恢复经真实 SQLCipher 通过 [CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366)，保证不写旧业务表。
6. **N2-03-02 已完成**：`NativeIpFileStore` 和 `NativeIpFileEndpoints` 将知识产权 `folders.kind=ip` 的真实 FolderId 绑定 V2 附件列表、分类原件上传、文件详情、追加版本、历史字节下载、共享关联与单条解绑/恢复。原生 IP CRUD 使用 `/api/v2/folders`；经过 SQLCipher/HTTP 真实回归验证有效归属、同区共享最新版本、目录属性变更不产生文件版本、跨 IP/跨区隔离、删除/恢复及旧表不双写。[CI #38824119576](https://github.com/zy19970/IPSys/actions/runs/38824119576) 成功（首轮编译因测试遗漏 Tags，占位修复后通过）。
7. **N2-03-03 已完成**：`ExcelLedger` 的 V2 IP 分层适配和 `NativeIpExcelEndpoints` 提供 `/api/v2/excel/{workspace}/ip/template`、`export`、`import`；固定 20 列、跳过/更新/另建策略继续有效，但实际使用 V2 FolderId 和 `attributes_json`，导入不碰旧专利表，不复制跨工作区附件。CI #38825202078 测试真实 Excel 旧格式兼容导入、V2 筛选导出/更新、附件链接及历史原件保持不变。
8. **N2-03-04 当前实施**：新增 NativeIpUiEndpoints，按 V2 IP FolderId 聚合列表/原件 FileId/LinkId/历史版本，ip-v2.js 负责内容查重和明确选择；现有 app.js 知识产权列表、CRUD、Excel、文件历史与下载、跨 IP 共享、单位置解绑、文件夹/ZIP 导出使用 V2。新增材料类别在上传 resolve 同事务落库，并嵌入单 EXE。Node+HTTP 测试经历了旧 UI 断言及提示字符串修复，最新 CI #38828523508 已通过；该部分未做用户 Edge/Chrome 实机。
9. **当前下一项 N2-03-05**：统一旧 MCP 的知识产权工具名、统一搜索/回收站与 V2 IP 身份，补齐跨公司/个人复制及移动全部历史原件的原子事务，之后逐模块推进项目/合同和档案网页的整体切换。
3. **然后 N2-03**，在新文件归属能力完整后，分模块切换旧业务 API、MCP、Excel 到 V2 数据源；旧 API 形状可保留，不能双写。
4. **最后 N4**，接通现有 UI、搜索 File 属性与 Folder 祖先信息、递归导出、默认最新版本、PDF/回收站，删除不再引用的旧表/兼容代码，完成 Windows CI、Edge/Chrome 用户实机和 T01–T09 安全验收。

旧测试数据全可丢弃，旧库不做迁移，拒绝打开旧库且不能覆盖源文件。**T08 是新版库版本识别和未来升级安全，而不是旧测试数据升级。**

## 5. 验收与执行规则

N1/N2 通过 Windows CI 不等于整个 V2 应用已验证。旧单文件上传上限仍 64 MiB；2 GiB+ 目标、SSD 故障、磁盘耗尽、手工备份一致性、密码修改与压缩尚未完整验收，不能声称正式发布完成。不在没有包含新数据的有效外部备份时删除来源文件。

按 AIGT-templates 的 `AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md` 工作，先核对主分支完整提交历史和当前源码，明确子任务后最小改动、针对性测试、直接提交 `main`、检查 CI 和 ref，并更新 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 的进度证据与 [RESOURCE_REFACTOR_TEST_MATRIX.md](./RESOURCE_REFACTOR_TEST_MATRIX.md) 的状态。需求与 UI 分别见 [REQUIREMENTS.md](./REQUIREMENTS.md)、[UI_BASELINE.md](./UI_BASELINE.md)，实机记录见 [WEB_TESTING.md](./WEB_TESTING.md)。
