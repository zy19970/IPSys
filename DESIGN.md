# IPSys 技术设计：SQLCipher V2 与过渡态（2026-10-15）

> 本文区分 V2 **已实现的新 Schema、原生 Folder API 及 N3-01 File 基础层**、**仍使用旧业务表的现有 UI/接口**和 N2-03/N4 **尚未实现的集成目标**。审查基线 `main@93be896f`；最新架构/进度和执行依据以 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 为准。

## 1. 运行与安全边界

IPSys 用户可见名称为「资料管理系统」，支持 Windows 10/11 x64、离线、单用户。WinForms `LauncherForm.cs` 管理 ASP.NET Core/Kestrel 生命周期，本机 HTTP 仅监听 `127.0.0.1` 临时端口；网页只是客户端，浏览器标签关闭不结束宿主。网页 `POST /api/lock` 关库并撤销授权，只有 WinForms 窗口或「退出程序」结束进程。上传任务期间关库拒绝；宿主退出按安全三选项协调。

`Vault.cs` 利用 SQLCipher 加密单个数据库文件，以 `PRAGMA cipher_version` 验证，启用外键及 `X-IPSys-Token` 会话鉴权、loopback Host/Origin 校验和 CSP。个人/公司两个工作区逻辑及原件对象物理隔离，数据在加密库内，不维护硬盘明文镜像目录。

网页 `index.html/app.js/style.css/export.js/pdf-preview.js`、离线 PDF.js 编译进 EXE，`demo/ui-preview.html` 仅是历史预览。Release 为 `net8.0-windows` + `win-x64`、`PublishSingleFile=true`、`SelfContained=false`，只有一个 EXE，目标机另需 Windows Desktop Runtime 8 x64 与 ASP.NET Core Runtime 8 x64。

## 2. V2 新数据库（N1 已通过）

用户 2026-10-15 决定**不用迁移、回填或兼容旧测试库**，V2 全新建库，不覆盖已有文件。由 `ResourceSchemaV2.cs` 建立并验证 `resource_schema_version=2` 与下列新物理表：

| 资源表 | 约束与用途 |
| --- | --- |
| `folders` | 项目、合同、知识产权、分类目录、归档资料、综合资料统一 Folder 身份，工作区、kind、section、parent_id、业务 `attributes_json`、位置和删除标志；**Folder 无版本** |
| `files` | 稳定 FileId、工作区与文件名，说明、标签、文件编号、文件日期等选填属性 |
| `file_versions` | 版本号、历史文件原名、对象引用、可选版本说明和时间；FileVersion 不属于 Folder |
| `file_objects` / `file_chunks` | SHA-256、大小、writing/ready 生命周期与 SQLCipher 字节分块；ready 后触发器禁止改写数据 |
| `folder_file_links` | Folder 与 File 多对多归属，位置专属别名/用途、知识产权材料类别等链接属性 |

V2 强制工作区组合约束、合同有效父项目、合法 Folder 父级/目录防环、七个公司业务档案系统根不可改以及 FileVersion/完成对象不可变。真实 Schema/关系测试 [Windows CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) 已通过。**表存在不表示新 File 上传下载业务已接通。**

共享同一 FileId 时，多 Folder 同步看到文件属性与版本链；仅复用 FileObject 时，两个独立 FileId 保留独立属性及版本；独立保存连物理字节也不共用。SHA-256 相同不得静默合并，需显示已有名称、位置并由用户确认三种决策或取消。公司/个人不能共享同一物理对象。

## 3. N2 原生 Folder API（已通过专项 CI）

`NativeFolderStore.cs`、`NativeFolderEndpoints.cs` 直接读写 V2 `folders/attributes_json`，项目/合同/IP 原生 CRUD、软删与恢复；合同仅能属于唯一有效项目，遵循 M0 业务验证。[Windows CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) 通过。

`NativeArchiveStore.cs` 与 `NativeArchiveOrder.cs` 实现业务档案分类/资料和综合资料的原生 CRUD、七个系统根保护、目录/资料混排排序、移动防环、资料归属及恢复。[Windows CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) 通过。

当前这些原生接口使用 `/api/v2/folders`；它们**尚未替换**现有前端的原业务 API、文件 API、Excel 或 MCP。

### N3-01 原生 File 基础服务（2026-10-15 已通过 CI）

`NativeFileStore.cs` / `NativeFileEndpoints.cs` 通过独立 `/api/v2/files` 接口实现 FileId 创建（必须绑定有效 FolderId）、原件加密分块上传与 SHA-256/长度校验、同事务版本和首条 FolderFileLink 写入；文件名必填、说明/标签/编号/日期/版本说明选填，可编辑属性且不修改历史版本。历史版本保留原始文件名并按版本下载。上传不完整、取消时事务回滚，无残留有效文件。独立 `NativeFileStoreSmoke` 和 `NativeFileHttpSmoke` 在真实 SQLCipher 与 HTTP 中通过身份/跨区隔离、原件往返、版本、事务回滚及数据库重开，[Windows CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 成功。**N3-02 关联、N3-03 独立 FileId 内容复用、N3-04 原生查重与用户确认 API 均已通过 CI；尚需 N2-03 接通旧业务入口和 N4 冻结 UI 的选择弹窗与实机验收。** 旧单文件 64 MiB 上限在此基础链路继续适用。

### N3-02 同一 FileId 的多位置关联（已通过 CI）

`NativeFileLinkStore` 与 `NativeFileLinkEndpoints` 在现有 `folder_file_links` 上新增同工作区多 Folder 关联、有效关联列表、单位置软解绑与显式恢复。所有有效位置共用文件属性和 FileVersion；链接只保留当前 Folder 的别名、材料类别与位置。解绑 A 不会删除版本或原件字节，B 中新增版本也不会自动使 A 的链接复活；当全部链接解绑后，文件不可从直接接口访问，但可在原 Folder 通过 `includeDeleted=true` 检索已解除关联并显式恢复。新代码已通过 [Windows CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) 的真实 SQLCipher/HTTP 回归。N3-03 将实现独立文件仅复用同区字节的另一种模式，不能与共享 FileId 混淆。

### N3-03 独立 FileId 和物理原件复用（已通过 Windows CI）

`NativeFileCopyStore` 和 `NativeFileCopyEndpoints` 以显式 `reuse-content`（同工作区）或 `independent-content` 模式复制一个 File 的有效历史版本到新的 FileId 和目标 Folder。前者为独立文件/版本记录引用原来已完成的不可变 FileObject；后者在 SQLCipher 中创建新的 FileObject/加密分块，跨公司与个人工作区必须采用后者。副本属性、显示名称及后续版本独立；文件、版本、物理对象及目标目录首条关联同事务提交，取消时全部回滚。真实 SQLCipher 和 HTTP 通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581)。N3-04 仍需提供内容哈希匹配、既有文件名和文件夹位置提示，以及明确的用户复用/独立保存/取消选择。

### N3-04 SHA-256 查重、待确认原件与选择接口（已通过 Windows CI）

`NativeFileChoiceStore`、`NativeFileChoiceResolve` 和 `NativeFileChoiceEndpoints` 增加 `POST /api/v2/files/{workspace}/prepare?folderId=...`（原始字节和可选 X-File 属性，返回 ticket、sha256、size、matches：已有 FileId/文件名/版本/完整有效 Folder 路径），以及 `POST /api/v2/files/{workspace}/prepared/{ticket}/resolve`（显式 `share-file`、`reuse-content`、`independent`）、`DELETE /api/v2/files/{workspace}/prepared/{ticket}`（取消）。上传先按块写入 SQLCipher `writing` 对象；只有明确独立保存才转成不可变 `ready`。引用相同 FileId 或独立 FileId 仅内容复用时删除暂存块，不删已有 ready 对象；只查同工作区最新有效版本，异名相同内容仍可匹配，同名不同字节不会匹配。一个数据库会话同时仅有一份待确认原件，票据不可重放，30 分钟过期；关闭数据库和下一次打开清理遗留 writing 对象。权限、工作区、SHA-256/大小、目录有效性、失败回滚由服务端校验。[Windows CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) 真实 SQLCipher/HTTP 通过。可视化对话框和旧业务 API 尚未切到此协议，分别由 N4/N2-03 完成。

## 4. 过渡期旧代码（N3/N2-03/N4 后才可移除）

`Vault.CreateSchema` 现在仍先建旧 `records/attachments/chunks` 再建 V2 新表。旧 `ProjectStore/ContractStore/IpStore/ArchiveStore/ArchiveFolderStore/GeneralStore` 以及 `BusinessFiles.cs` 仍被正式 UI/API 使用，后者读写 `business_file_objects/business_file_chunks/business_file_links`，单文件上限 **64 MiB**。综合资料附件还有旧 `attachments/chunks` 路径。`Program.cs` 同时映射旧业务路由与 `NativeFolderEndpoints`；`wwwroot/app.js` 仍调用 `/api/projects`、`/api/contracts`、`/api/archives`、`/api/records` 等。R0/R1 的 `FolderModel/Provider/Browser/Command/Transfer` 系列是此前旧表统一适配层。

旧实现已有真实 CRUD、回收站、历史版本、去重关联、PDF.js Canvas、文件夹/ZIP 导出、固定 XLSX、跨模块搜索、14 项本机 stdio MCP 工具，并有历史 Windows CI/部分实机结果。这些是**过渡期可用功能**，不得当作 V2 业务链已完成，更不能长期保留新旧表双写。N3 先建 File 与归属服务，N2-03 在依赖满足后切换旧业务入口；N4 再把 UI、搜索、导出、回收站和文件引用全部切到 V2，确认后清理旧表及兼容代码。

## 5. UI 与外围系统约束

[UI_BASELINE.md](./UI_BASELINE.md) 是交互权威：个人工作区优先，公司五栏目及 3×2 工作台，企业资质直接表格；业务档案根七分类卡片纯导航、内层目录/资料混排表格；个人分类卡片→台账；项目/IP 台账→详情。V2 的统一物理 Folder 不能作为统一改变这些界面的理由。

`export.js` 通过浏览器文件夹选择与 ZIP 输出项目及所有所属合同原件；新模型默认导出 File 最新有效版本，历史版须显式选择，同名和父子目录重叠要处理。ZIP 当前不支持 ZIP64（小于 4 GiB）。旧 `SearchStore` 查询结构化业务字段与部分附件元数据；N4 增补 File 选填属性及祖先 Folder 字段，**不做** OCR/正文索引。`ExcelLedger` 固定 XLSX 输入最大 8 MiB、5000 行，合同只读导出。`McpLocal` 仅本机 stdio/当前用户命名管道，默认经程序手动开启；现有 14 项工具尚未切 V2。

## 6. 验收、风险与发布

N1/N2 已有对应真实 SQLCipher/HTTP Windows CI，**没有** V2 全部业务接入与实机端到端结果；不能宣布 V1.0 完整发布。仍需 T01–T09：工作区隔离/密码错误、2 GiB+ 目标原件往返（旧接口目前 64 MiB）、SSD 异常、磁盘满、任务退出、手工备份副本一致性、Edge/Chrome、内容引用删除保护及未来新版升级。**T08 不再要求旧测试库迁移或新旧软件无条件互开**；新 V2 库版本识别、拒绝覆盖旧文件和后续受控升级仍需测试。来源文件自动删除仍必须先满足有效外部备份。

具体接续见 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)、[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)；测试记录见 [WEB_TESTING.md](./WEB_TESTING.md)。
