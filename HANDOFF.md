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
| **N3-04、N2-03、N4** | 尚未完成，不能称作已切到唯一新库 |

**源码切换边界**：`Vault.CreateSchema` 仍为旧综合资料创建 `records/attachments/chunks` 再建 V2；`Program.cs` 同时注册旧路由和 `/api/v2/folders`；`app.js` 仍调用 `/api/projects`、`/api/contracts`、`/api/archives` 等；`BusinessFiles.cs` 仍使用旧 `business_file_*` 表。此时新 Folder API 可单独测试，但原有前端/附件/MCP/Excel 尚未接入；不得提前删旧 Store 或做同一操作双写。

## 4. 接续开发的唯一顺序

1. **N3-01 已完成**：独立 `/api/v2/files` 支持 FileId、选填属性、加密字节分块与 SHA-256、原生 FileVersion/历史下载，上传与初次 Folder 归属同事务；[CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 已通过。
2. **N3-02 已完成**：同区多个有效 Folder 共用 FileId，文件属性和版本在所有有效位置同步；解除某一位置只软删除该链接，新版本不会自动让旧链接复活。全部链接解除后原件历史仍保留，可从原 Folder 查询已解除链接并显式恢复。详见 [CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477)。
3. **N3-03 已完成**：`NativeFileCopyStore`/`NativeFileCopyEndpoints` 支持明确的 `reuse-content`（仅同工作区，不同 FileId 与 FileVersion 共用完成的 FileObject）和 `independent-content`（重新复制全部有效版本字节并生成独立 FileObject，跨区强制使用）；属性及后续版本独立、目标 Folder 链接同事务，SQLCipher/HTTP 通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581)。
4. **当前下一项 N3-04**：同内容（包括异名）查重后展示文件名与位置，用户明确选择引用同一 FileId、仅复用内容、完全独立保存或取消；之后进入 N2-03。
3. **然后 N2-03**，在新文件归属能力完整后，分模块切换旧业务 API、MCP、Excel 到 V2 数据源；旧 API 形状可保留，不能双写。
4. **最后 N4**，接通现有 UI、搜索 File 属性与 Folder 祖先信息、递归导出、默认最新版本、PDF/回收站，删除不再引用的旧表/兼容代码，完成 Windows CI、Edge/Chrome 用户实机和 T01–T09 安全验收。

旧测试数据全可丢弃，旧库不做迁移，拒绝打开旧库且不能覆盖源文件。**T08 是新版库版本识别和未来升级安全，而不是旧测试数据升级。**

## 5. 验收与执行规则

N1/N2 通过 Windows CI 不等于整个 V2 应用已验证。旧单文件上传上限仍 64 MiB；2 GiB+ 目标、SSD 故障、磁盘耗尽、手工备份一致性、密码修改与压缩尚未完整验收，不能声称正式发布完成。不在没有包含新数据的有效外部备份时删除来源文件。

按 AIGT-templates 的 `AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md` 工作，先核对主分支完整提交历史和当前源码，明确子任务后最小改动、针对性测试、直接提交 `main`、检查 CI 和 ref，并更新 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 的进度证据与 [RESOURCE_REFACTOR_TEST_MATRIX.md](./RESOURCE_REFACTOR_TEST_MATRIX.md) 的状态。需求与 UI 分别见 [REQUIREMENTS.md](./REQUIREMENTS.md)、[UI_BASELINE.md](./UI_BASELINE.md)，实机记录见 [WEB_TESTING.md](./WEB_TESTING.md)。
