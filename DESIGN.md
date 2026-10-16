# IPSys 技术设计：SQLCipher V2 当前实现与 N4 收敛（2026-10-16）

> 截至 `main@e06f8a7`，各正式业务页面、MCP、Excel、搜索/回收站、文件版本、ZIP/文件夹导出均已使用 V2 FolderId/FileId/LinkId；[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) success（对应源码 `6a7b1ff`）。现在进入 N4 旧结构/测试清理与 Edge/Chrome 实机验收，不把自动 CI 等同全面正式发布。

## 1. 运行与安全边界

IPSys 用户可见名称为「资料管理系统」，支持 Windows 10/11 x64、离线、单用户。WinForms `LauncherForm.cs` 管理 ASP.NET Core/Kestrel 生命周期，本机 HTTP 仅监听 `127.0.0.1` 临时端口；网页只是客户端，浏览器标签关闭不结束宿主。网页 `POST /api/lock` 关库并撤销授权，只有 WinForms 窗口或「退出程序」结束进程。上传任务期间关库拒绝；宿主退出按安全三选项协调。

`Vault.cs` 利用 SQLCipher 加密单个数据库文件，以 `PRAGMA cipher_version` 验证，启用外键及 `X-IPSys-Token` 会话鉴权、loopback Host/Origin 校验和 CSP。个人/公司两个工作区逻辑及原件对象物理隔离，数据在加密库内，不维护硬盘明文镜像目录。

网页 `index.html/app.js/style.css/export.js/ip-v2.js/pdf-preview.js`、离线 PDF.js 编译进 EXE，`demo/ui-preview.html` 仅是历史预览。Release 为 `net8.0-windows` + `win-x64`、`PublishSingleFile=true`、`SelfContained=false`，只有一个 EXE，目标机另需 Windows Desktop Runtime 8 x64 与 ASP.NET Core Runtime 8 x64。

## 2. V2 新数据库（N1 已通过）

用户 2026-10-15 决定**不用迁移、回填或兼容旧测试库**，V2 全新建库，不覆盖已有文件。由 `ResourceSchemaV2.cs` 建立并验证 `resource_schema_version=2` 与下列新物理表：

| 资源表 | 约束与用途 |
| --- | --- |
| `folders` | 项目、合同、知识产权、分类目录、归档资料、综合资料统一 Folder 身份，工作区、kind、section、parent_id、业务 `attributes_json`、位置和删除标志；**Folder 无版本** |
| `files` | 稳定 FileId、工作区与文件名，说明、标签、文件编号、文件日期等选填属性 |
| `file_versions` | 版本号、历史文件原名、对象引用、可选版本说明和时间；FileVersion 不属于 Folder |
| `file_objects` / `file_chunks` | SHA-256、大小、writing/ready 生命周期与 SQLCipher 字节分块；ready 后触发器禁止改写数据 |
| `folder_file_links` | Folder 与 File 多对多归属，位置专属别名/用途、知识产权材料类别等链接属性 |

V2 强制工作区组合约束、合同有效父项目、合法 Folder 父级/目录防环、七个公司业务档案系统根不可改以及 FileVersion/完成对象不可变。真实 Schema/关系测试 [Windows CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) 已通过。N1 的 CI 仅证明表及约束，后续 N3 与实际模块接入另有对应自动验收。

共享同一 FileId 时，多 Folder 同步看到文件属性与版本链；仅复用 FileObject 时，两个独立 FileId 保留独立属性及版本；独立保存连物理字节也不共用。SHA-256 相同不得静默合并，需显示已有名称、位置并由用户确认三种决策或取消。公司/个人不能共享同一物理对象。

## 3. N2 原生 Folder API（已通过专项 CI）

`NativeFolderStore.cs`、`NativeFolderEndpoints.cs` 直接读写 V2 `folders/attributes_json`，项目/合同/IP 原生 CRUD、软删与恢复；合同仅能属于唯一有效项目，遵循 M0 业务验证。[Windows CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) 通过。

`NativeArchiveStore.cs` 与 `NativeArchiveOrder.cs` 实现业务档案分类/资料和综合资料的原生 CRUD、七个系统根保护、目录/资料混排排序、移动防环、资料归属及恢复。[Windows CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) 通过。

当前正式项目、合同、知识产权、业务档案、资质、个人分类与综合资料都由 V2 Folder CRUD 及原件接口维护，原名 MCP、Excel、搜索/回收站和跨区历史原件复制均已切换。剩余旧 Store 是 N4 的测试/过渡代码，不再用于正式业务网页。

### N3-01 原生 File 基础服务（2026-10-15 已通过 CI）

`NativeFileStore.cs` / `NativeFileEndpoints.cs` 通过独立 `/api/v2/files` 接口实现 FileId 创建（必须绑定有效 FolderId）、原件加密分块上传与 SHA-256/长度校验、同事务版本和首条 FolderFileLink 写入；文件名必填、说明/标签/编号/日期/版本说明选填，可编辑属性且不修改历史版本。历史版本保留原始文件名并按版本下载。上传不完整、取消时事务回滚，无残留有效文件。独立 `NativeFileStoreSmoke` 和 `NativeFileHttpSmoke` 在真实 SQLCipher 与 HTTP 中通过身份/跨区隔离、原件往返、版本、事务回滚及数据库重开，[Windows CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 成功。**N3-02 关联、N3-03 独立 FileId 内容复用、N3-04 原生查重与用户确认 API 均已通过 CI；现有 IP、项目/合同网页已接入查重确认弹窗；归档/综合资料与完整 Edge/Chrome 实机验收仍待完成。** 旧单文件 64 MiB 上限在此基础链路继续适用。

### N3-02 同一 FileId 的多位置关联（已通过 CI）

`NativeFileLinkStore` 与 `NativeFileLinkEndpoints` 在现有 `folder_file_links` 上新增同工作区多 Folder 关联、有效关联列表、单位置软解绑与显式恢复。所有有效位置共用文件属性和 FileVersion；链接只保留当前 Folder 的别名、材料类别与位置。解绑 A 不会删除版本或原件字节，B 中新增版本也不会自动使 A 的链接复活；当全部链接解绑后，文件不可从直接接口访问，但可在原 Folder 通过 `includeDeleted=true` 检索已解除关联并显式恢复。新代码已通过 [Windows CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) 的真实 SQLCipher/HTTP 回归。N3-03 已实现独立文件仅复用同区字节的另一种模式，不能与共享 FileId 混淆。

### N3-03 独立 FileId 和物理原件复用（已通过 Windows CI）

`NativeFileCopyStore` 和 `NativeFileCopyEndpoints` 以显式 `reuse-content`（同工作区）或 `independent-content` 模式复制一个 File 的有效历史版本到新的 FileId 和目标 Folder。前者为独立文件/版本记录引用原来已完成的不可变 FileObject；后者在 SQLCipher 中创建新的 FileObject/加密分块，跨公司与个人工作区必须采用后者。副本属性、显示名称及后续版本独立；文件、版本、物理对象及目标目录首条关联同事务提交，取消时全部回滚。真实 SQLCipher 和 HTTP 通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581)。N3-04 已提供上述内容哈希匹配、原名/路径提示及用户复用/独立保存/取消选择。

### N3-04 SHA-256 查重、待确认原件与选择接口（已通过 Windows CI）

`NativeFileChoiceStore`、`NativeFileChoiceResolve`、`NativeFileChoiceEndpoints` 实现 SQLCipher `writing` 暂存、SHA-256 同内容查重、展示文件名和 Folder 路径、明确选择共享 FileId/仅复用物理字节/独立保存或取消。票据授权、回滚、关库清理等在 [CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) 通过；现有全部正式业务上传入口已在后续 N2-04 接入，Edge/Chrome 弹窗仍待实测。

## 4. N4 旧 Schema、Store 与测试适配清理

`Vault.CreateSchema` 仍创建旧 `records/attachments/chunks`，`ValidateSchema` 仍检查它们；这是 N4 的物理清理目标。正式 `Program.cs` 已只在 `--smoke` 下注册旧业务/Excel/附件/搜索 API；正式网页、MCP 及导出全走 V2。旧 `ProjectStore/ContractStore/ArchiveStore/BusinessFiles.cs` 与 Provider 仍有历史测试依赖，须在改完测试后清理。

原系统的 CRUD、文件版本、PDF.js、ZIP/文件夹、XLSX、统一搜索和本机 MCP 已完整接入 V2 正式主链路；[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) success。旧兼容代码仅作为历史测试依赖保留；N4 当前清理旧 Schema/Store/测试用 HTTP，严禁旧 ID 回退与双写。

## 5. UI 与外围系统约束

[UI_BASELINE.md](./UI_BASELINE.md) 是交互权威：个人工作区优先，公司五栏目及 3×2 工作台，企业资质直接表格；业务档案根七分类卡片纯导航、内层目录/资料混排表格；个人分类卡片→台账；项目/IP 台账→详情。V2 的统一物理 Folder 不能作为统一改变这些界面的理由。

`export.js` 的全部模块 ZIP/文件夹附件下载都使用 V2 FileId+FileVersion；默认最新版，历史版需明确选择。`SearchStore` 已覆盖各模块、附件选填属性和 Folder 祖先名；正式搜索是 `/api/v2/search`。全部固定列 XLSX 和原名 MCP 均接 V2（合同 Excel 只读），MCP 本机手动授权不变。ZIP 不支持 ZIP64（小于 4 GiB），同名、父子目录重叠、取消和真实浏览器跳转待实机验证。

## 6. 验收、风险与发布

N1/N2/N3 和全模块 N2-04 主链路自动回归已通过 [CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886)；**N4 旧物理表清理与 Edge/Chrome 端到端实机尚未完成**。T01–T09 需验证错密、越权、2 GiB+ 目标往返（当前 V2 单文件仍限 64 MiB）、移动 SSD 故障、磁盘满、退出、备份与未来升级；不做旧库迁移。

具体接续见 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)、[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)；测试记录见 [WEB_TESTING.md](./WEB_TESTING.md)。
