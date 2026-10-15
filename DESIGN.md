# IPSys 技术设计：现行实现与待验收边界（2026-10-15）

> 本文描述已落地的技术结构，以 2026-10-15 main@ba4fc6b0 的源码为审查基线；项目逻辑定位是**业务化文件夹式本地资料管理器**，但物理实现仍以各业务表和原件关联表为主，不要求统一表重构。业务约束见 [REQUIREMENTS.md](./REQUIREMENTS.md)，界面规范见 [UI_BASELINE.md](./UI_BASELINE.md)，字段见 [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md)。尚未完成 M2 全项设计评审与 T01–T09 技术验收。

> **2026-10-15 用户界面与退出职责修订**：用户可见名称为「资料管理系统」（IPSys 继续作为技术标识）。网页 `POST /api/lock` 仅关库和撤销会话，WinForms 及 HTTP 服务继续运行；程序退出只有原生 WinForms 窗口能够调用 `Vault.TryScheduleExit`，不向浏览器开放 `POST /api/exit`。上传进行时网页关库返回冲突，WinForms 程序退出继续支持原生三选项。

## 1. 产品与部署边界

IPSys 是 Windows 10/11 x64、离线、单用户的本地资料管理器。逻辑上由「资料库—工作区—分类容器/业务模块—业务记录—附件」组成；分类和业务记录向用户呈现类似文件夹的打开、管理与导出体验。**现有物理 Schema 不统一为一种文件夹实体**：个人工作区优先，公司工作区独立，二者在单个 SQLCipher 主库中按 workspace 隔离，文件必须依附记录。项目可独立存在，合同必须属于有效项目。

程序的 WinForms `LauncherForm` 负责本机 HTTP 服务生命周期，浏览器是客户端；点击按钮打开 Edge/Chrome，关闭标签页不终止 WinForms。本机 `Program.cs` 创建 ASP.NET Core/Kestrel，仅使用 `http://127.0.0.1:0` 临时端口，不暴露外网 API。嵌入式网页资源通过 `MapGet` 从 EXE 程序集提供，`demo/ui-preview.html` 仅供历史对照。

Release：`net8.0-windows` + `win-x64` + `SelfContained=false` + `PublishSingleFile=true`，发布包只有一个 `IPSys.Web.exe`；运行依赖目标机器预装 Windows Desktop Runtime 8 x64 与 ASP.NET Core Runtime 8 x64（不是完全免运行时）。

## 2. 数据库、鉴权与 Schema

数据库通过 `Microsoft.Data.Sqlite.Core` 与 `SQLitePCLRaw.bundle_e_sqlcipher` 打开，`Vault.Connect` 检查 `PRAGMA cipher_version`，错误密码不能解密。开启 `foreign_keys=ON`，当前设置 `journal_mode=DELETE`、`synchronous=FULL`。由 `Vault` 保存当前已解锁连接和随机会话 Token；HTTP 请求以 `X-IPSys-Token` 授权。新建/关闭库时 Token 失效。服务器同时校验 loopback Host、同源 Origin，并限定 CSP。

| 物理表/结构 | 用途和关键关系 |
| --- | --- |
| `records`、`attachments`、`chunks` | 综合/其他资料的原始记录和加密分块附件；在旧库上非破坏性补充版本、分组及软删除列 |
| `business_projects` | 业务项目：工作区、类型、名称、编号、负责人、单位、日期、状态、分类、备注、标签、软删除 |
| `business_contracts` | 合同：`project_id` 关联 `business_projects.id`；工作区、金额、日期、签约方、软删除 |
| `business_ips` | 知识产权：工作区、`ip_type`、`status`、`payload` JSON 承载 M0 可选字段 |
| `business_archives` | 公司证书、个人资质、科研成果/学术活动；`module`、`section`、`category` 表示业务范围 |
| `archive_folders` | 仅公司业务档案使用的可变层级目录；parent_id 表示父目录，根层保留系统预设及兼容历史类别；business_archives.folder_id 将资料归属目录 |
| `archive_entry_order` | 仅公司业务档案目录内的混合排序映射；kind=folder/record、item_id 与 parent_id 共同区分目录/资料及所在层级 |
| `company_certificate_order` | 公司企业资质全量持久顺序映射，保留旧业务数据 |
| `business_file_objects` | 业务原件物理对象：预期/实际大小、SHA-256、`writing/ready` 状态 |
| `business_file_chunks` | 业务原件字节分块，`object_id` 对应物理对象 |
| `business_file_links` | 工作区、业务种类、归属 ID、对象 ID、文件名、材料类别、版本、分组、软删除 |
| `ledger_record_order` 通用排序映射 | 通用台账持久显示顺序，以 `LedgerBatch.Ensure` 当前 SQL 定义为准 |

旧版跨平台、多公司、无归属文件池和自定义字段不是现行 Schema。**2026-10-15 的公司业务档案目录树已经存在，不能再按旧“排除目录树”的注释理解**；但该专用目录树不是项目、合同、知识产权或个人资料的统一通用父子表。具体字段变更以各 Store 的 Ensure / DDL、当前代码和 M0 字典为准。

## 3. 业务规则与操作边界

`ProjectStore` 支持「科研项目／横向项目／其他项目」；合同只能挂到有效项目，在项目详情创建，复制/移动项目时保留有效子合同并重新关联。知识产权固定七类，每类状态和日期由服务端验证。公司企业资质、个人身份与资质、公司业务档案、个人成果与学术通过 `ArchiveStore` 和 `section` 约束对应业务归属。企业资质表单最小字段为名称、可选附件和备注，隐藏的旧 `category/tags` 元数据必须保留；Excel 固定模板的历史字段仍独立于可见表单。综合资料由 `GeneralStore` 维护旧表非破坏性升级。

删除以软删除/回收站为默认；`RecycleStore` 处理恢复、批量永久清理以及共享对象被其他有效记录引用时的保护。持久排序由企业资质专用映射和通用 `LedgerBatch` 接口完成，接口按工作区和完整 ID 集合校验，防止仅对筛选子集重排时破坏全量序列。

### 公司业务档案目录与混合排序

`ArchiveFolderStore` 维护公司业务档案目录，可无限定固定深度分层、创建、更名、移动和安全删除空目录；现有记录通过 `business_archives.folder_id` 关联目录，原件仍关联业务记录，不直接附属于目录。目录改名/转移须保持资料与原件身份不变，并维护历史根分类兼容语义。`ArchiveEntryOrderStore` 按当前上级目录保存 folder/record 类型化组合的完整顺序，接口校验全量排列、拒绝重复、漏项及跨目录项。UI 根层只渲染导航卡片；进入目录后渲染子目录与记录混合表格，目录可勾选批量递归导出但不参与业务记录软删除。导出引擎按目录、记录和附件构造 ZIP/文件夹层级；根层不提供下载入口，内层目录行也只保留「打开」。

## 4. 原件生命周期

`BusinessFileStore` 在 SQLCipher 同库内按块写入物理对象，状态 `writing → ready`；写入完毕校验大小/哈希后成为有效原件。业务原件记录通过 `business_file_links` 关联真实 owner 和 `group_id`，可区分同名独立原件与同组新版。用户显式选择同工作区重复字节是否复用物理对象；复制/转移只在允许的归属关系下进行，跨个人/公司工作区新副本使用独立对象，禁止跨工作区共享物理对象。旧综合资料路径使用 `records/attachments/chunks`，采用额外元数据列兼容已有库，不实施破坏性重建。

实际 `BusinessFileStore.MaxFileLength=64 MiB`；请求体和客户端限制需同步核对。**设计目标中的 >2 GiB 文件支持尚未实现/验收**，不能以分块存在就推定已支持。中断后未完成 `writing` 对象、容量不足和磁盘突然断开需要 T02/T03 专项测试。

预览：PDF 通过嵌入 `pdfjs/pdf.min.js`、`pdf.worker.min.js` 和 `pdf-preview.js` 的 Canvas 逐页显示，支持缩放/翻页/销毁；不使用曾失败的浏览器 PDF iframe，图片仍通过只读预览。

导出：前端 `export.js` 使用浏览器授权的 File System Access API 按记录生成目录，项目附件和合同附件嵌套；文件夹支持重复命名后缀，ZIP 流式写入且取消/部分失败分别处理。ZIP **不支持 ZIP64，容量需小于 4 GiB**。附件原件字节不以明文临时文件形式由软件持久缓存。

## 5. Excel、检索与 MCP

`ExcelLedger.cs` 按 M0 固定表头离线读写真正 XLSX：项目11列、知识产权20列、分类资料4列、综合资料1列；合同仅只读导出。单次导入限制 **8 MiB、5000行**，支持跳过重复、更新、另建及逐行合法/错误报告，不通过 Excel 导入附件。详细映射见 [EXCEL_LEDGER.md](./EXCEL_LEDGER.md)。

`SearchStore.cs` 仅在当前已解锁工作区查询项目/合同/IP/档案/综合资料的**结构化字段与附件元数据**，单组最多60条、输入最多100字；跳转真实所属记录，不使用 OCR、Office/PDF 正文提取或跨工作区全库明文索引。见 [SEARCH.md](./SEARCH.md)。

`McpLocal.cs` 在 `IPSys.Web.exe --mcp` 子进程通过 stdio 提供 MCP JSON-RPC，经同一 Windows 用户的命名管道转交已解锁主程序和已有 localhost 业务 API。当前14个项目/合同/IP/原件工具；授权开关默认关闭、关闭库重置，不对其他平台开放网络 TCP 接口。见 [MCP_CODEX.md](./MCP_CODEX.md)。

## 6. UI 和测试证据

公司导航：工作台、企业资质、业务档案、公司项目、知识产权、综合资料；个人导航与各模块的卡片/表格例外见 [UI_BASELINE.md](./UI_BASELINE.md)。公司业务档案根层仅分类导航卡片（不勾选/不下载），进入后目录与资料混排、可持久排序；目录行「打开」、资料行「下载」。企业资质直达表格，个人分类档案仍是卡片→台账→详情，项目/IP 为台账→详情，综合资料保持既有卡片。工作台 3×2、紧凑工具栏、长名称优先、回收站选中永久删除变红。

Windows 工作流 .github/workflows/web-windows.yml 对 Debug/Release、SQLCipher HTTP、MCP、本机 JS、UI/搜索、ZIP/PDF 等执行自动回归并发布单 EXE。当前代码基线对应 [#38707956606](https://github.com/zy19970/IPSys/actions/runs/38707956606) 成功；本次 Markdown 统一不代表重新运行代码测试，实机 Edge/Chrome 与故障注入状态仍由 [WEB_TESTING.md](./WEB_TESTING.md) 单独记录。

## 7. 技术验证缺口与设计定稿门槛

1. T02：目标 >2 GiB / 5–20 GiB 级容量与内存、流式哈希完整往返；64 MiB 上限与目标不一致。
2. T03/T04/T07：磁盘不足/SSD异常/中途取消/安全退出、资源管理器手工备份副本可独立打开且所有原件哈希相等。
3. T05/T06：Edge/Chrome 文件夹/ZIP授权和业务归属、跨工作区真实端到端隔离，尤其旧库升级前后的原件。
4. T08：兼容旧版本数据库、局部升级失败重入和可选字段升级；不能未经验证承诺旧程序可读取新版库。
5. T09：任何来源文件自动删除行为在获得可验证的新有效外部备份前都不执行。
6. 设置页目前还有「修改数据库密码」等未接入功能，数据库压缩/升级工具需要随安全验收安排。

相关门槛的正式定义在 [FREEZE_AUDIT.md](./FREEZE_AUDIT.md)。上述内容记录的是**当前实际实现与待验收事项**，技术正式定稿应以验证证据为依据，不靠文档直接标记「已完成」。