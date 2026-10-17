# IPSys 统一资源内核重构方案与执行进度

> **当前总览（2026-10-17）**：V2 资源内核及全部正式业务入口已统一，N4 旧数据库物理表、旧 HTTP 与 31 份停用业务源码清理结束；现行唯一业务数据源是 SQLCipher V2 的 Folder/File/Link/Version。MCP 已完成 P0/P1 可靠性、业务接口扩充和 ISS-001～018 收敛：2026-10-17 [`2620c109`](https://github.com/zy19970/IPSys/commit/2620c109043f779eeb57f411210f99bb2f21e554) 对外清单从 70 去重到 **59**（不再暴露 `v2_*` 11 个兼容别名），前端正式上传统一 SHA-256 prepare/resolve； [Windows CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428) **completed/success**。当前工作重点是 59 工具本机 Agent 实测、9 项历史 BLOCKED 权限/GUI 场景和 N4/T01–T09 数据安全/复杂文件边界。**不可把旧 70 工具黑盒报告直接记作当前 59 工具的实测通过。**
>
> **冻结资源模型不变**：Folder 无版本；File 有 FileId/选填属性/独立版本；FolderFileLink 是归属；FileObject 为内容；同区可共享 FileId 或仅复用内容，跨区仅独立复制。项目可独立，合同必须属于项目。仍处开发阶段，旧数据库全是测试数据，不迁移、不回填、不做旧版兼容。
>
> **文档分工**：本文件负责模型及历史实施基线；当前开发优先级以 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) 为准；跨会话快速接续以 [HANDOFF.md](./HANDOFF.md) 为准；测试入口为 [RESOURCE_REFACTOR_TEST_MATRIX.md](./RESOURCE_REFACTOR_TEST_MATRIX.md)、[MCP_INTERFACE_CLEANUP_TEST.md](./MCP_INTERFACE_CLEANUP_TEST.md) 和 [WEB_TESTING.md](./WEB_TESTING.md)。历史日期、SHA、CI 均保留为其当时节点，不再作为现在 HEAD。
>
## 2026-10-16 再次确认：不迁移旧测试库，直接启用全新统一数据库

**用户于 2026-10-16 再次确认：项目仍处于开发阶段，没有旧数据库需要迁移；所有现有数据库都是测试数据，无需兼容、迁移、回填或保存旧数据。** IPSys 后续采用 SQLCipher v2 新资料库；旧文件不会被软件自动覆盖，也不提供自动迁移。打开旧版测试库时必须提示创建新库。此前各阶段为了旧表兼容而规划的 R1-04-03-02、R1-04-03-03、R4 数据迁移环节停止执行，相关历史记录仅用于追溯。

**物理数据模型一次定型**：folders 统一资源身份、父级、类型、section、业务属性 JSON、排序、系统根保护；files 为独立逻辑 FileId 与选填属性；file_versions 只属于 File、保留原始名称和所有版本；file_objects/file_chunks 存储实际 SQLCipher 加密字节，可在同工作区依据明确用户选择复用；folder_file_links 为 Folder 与 File 多对多。数据库使用组合外键、工作区约束、合同父项目限制、目录防环、不可覆写的历史版本，以及七个公司业务档案系统分类。

**总体阶段为 N1 → N2 → N3 → N4。N2-04 已完成所有业务模块统一 Folder/File 的现有网页、MCP/Excel/搜索/回收站/导出接入；N4 已完成旧物理层与 31 份旧源码清理（[CI #38911635273](https://github.com/zy19970/IPSys/actions/runs/38911635273)），MCP 三批完善和 14 项业务工具由 [CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) 验证。当前仅将复杂边界与真实客户端/数据库安全验收列为待完成，自动 CI 不能代替 T01–T09。**

1. N1 新 SQLCipher v2 Schema 与原生数据关系自动测试；新版数据库创建/打开进行版本校验。
2. N2 让所有项目、合同、知识产权、业务档案目录及资料、综合资料直接读写 folders 及其业务属性；实现复制/移动/排序/删除恢复、合同从属业务规则，并将已有 HTTP/MCP/Excel 逐步切换到唯一数据源。
3. N3 让所有附件走 files、file_versions、file_objects/chunks、folder_file_links；实现文件可选属性、共享逻辑 FileId、独立文件内容复用、跨工作区物理隔离、同内容提示用户三选一和版本历史。
4. N4 接入前端/检索/导出，跑完整业务、MCP、Excel、PDF 预览、回收站、Windows 单 EXE 测试，清理已停用的旧业务及附件表和兼容代码。

**当前 N4 已完成和待验收（2026-10-17）**：V2-only 数据库创建/打开、正式和 `--smoke` V2 路由、31 份旧源码裁剪及全部业务接入已在历史 Windows CI 验证；MCP 的安全、分页、复制/转移、异步状态、恢复、清理与错误语义修复也已进入现行代码。此前 70 工具独立黑盒报告 PASS28/FAIL0/BLOCKED9；ISS-016～018 修复的 [CI #39014009578](https://github.com/zy19970/IPSys/actions/runs/39014009578) 和 59 工具接口去重的 [CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428) 均 success。**仍待**：当前 59 工具 Agent 实测、9 个跨权限/GUI BLOCKED、File 选填属性 UI、复杂历史/共享/导出及 Edge/Chrome、Excel、磁盘异常、退出和备份副本一致性。V2 单原件 64 MiB 为现实上限，不能将未来 2 GiB+ 目标当成已实现。


---
## 1. 冻结的资源模型

**Folder（文件夹）**：所有业务对象从统一资源管理器角度都是文件夹，包括项目、合同、知识产权、企业资质、证书、论文/兼职等个人资料、业务档案分类及资料、综合资料。文件夹拥有身份、父子关系、工作区、业务类型、名称、排序、删除状态、类型专属业务属性和操作约束。部分模块的顶层导航可以是虚拟根。**文件夹没有版本。** 修改业务属性或移动目录不会产生文件夹版本。

**File（逻辑文件）**：只有附件是文件。文件有稳定的 FileId 和自己的版本历史（`FileVersion` v1、v2 等），可被同一工作区多个文件夹关联。历史版本保留当时原始文件名和真实字节，不在更新时覆盖旧版。

**FileObject（内容对象）**：实际加密存储的原件字节；多个独立 FileVersion 可以引用同一份 FileObject，节省数据库空间。逻辑文件身份、版本历史与加密字节对象分开。

**FolderFileLink（归属关系）**：文件夹到逻辑文件多对多的链接。共享相同 FileId 的多个文件夹看到相同文件属性与版本链；删除一个位置的关联，不能影响其它位置，也不能在以后升级版本时让已删除链接重现。链接可持有该位置的显示别名/用途备注及 IP 附件材料类别。

**文件不设待整理池。** 文件必须归属于有效文件夹，或在可恢复的删除/历史引用保护中；不可出现无归属但长期有效的孤立原件。

### 1.1 文件属性：少录入、能检索

文件名必填，上传默认原始文件名；文件说明、标签、文件编号、文件日期以及版本说明**全部选填**。格式、大小、哈希、上传时间、版本号由程序自动记录。允许先只上传文件、日后补属性；不得在上传流程强制填写说明或标签。

搜索应同时检索文件自身属性、所在文件夹和其祖先文件夹的名称/结构化业务信息（项目编号、合同编号等），不要求重复填写项目属性。搜索仅在当前工作区进行，尊重删除状态；本轮不强制实现 PDF/Office 正文全文索引或 OCR。

### 1.2 共享逻辑文件 ≠ 复用相同内容

| 用户选择 | 逻辑 FileId | 版本历史 | 实际加密字节 |
| --- | --- | --- | --- |
| **引用已有文件** | 同一个 | 同步 | 可共用 |
| **仅复用已有内容** | 各自独立 | 各自独立 | 只存一份 |
| **独立保存** | 各自独立 | 各自独立 | 各存一份 |

上传时先计算大小和 SHA-256，在**当前工作区**搜索相同内容。发现同名或**不同文件名但相同内容**，应显示：本次上传文件名、已存在文件名、现有文件所属文件夹/路径和大小，**由用户选择**上表三种模式或取消。不能由同名、SHA-256 或“默认值”擅自合并文件身份，也不能未经确认直接复用字节。多个匹配候选须明确选择目标已有文件。

实现时允许先把字节写为未完成的 `writing` 状态，哈希确认后提示用户，最后以事务完成保存/复用；取消应清理暂存对象。弹窗等待期间不得长期持有数据库事务与全局锁。提交时复验可复用对象仍然有效。

同一逻辑文件在 A/B 文件夹共享时，A 上传 v2，B 也看到 v2；A 移除链接后，B 仍保留完整文件版本。仅内容去重的两个逻辑文件更新时互不影响。

**公司与个人工作区严格隔离**：跨工作区复制生成独立逻辑身份和独立物理 FileObject，即使字节相同也禁止跨区共享；访问控制不能只靠前端隐藏。

### 1.3 业务约束与原有页面不改变

项目可以没有合同；合同必须归属于唯一有效项目且只能在项目详情创建，不能按普通目录随意移入无效父级。知识产权七类型、项目三类型及对应字段、状态/日期、合同金额人民币 `0.00` 继续按既有字典验证。

公司业务档案一级七个系统类别继续作为**纯导航卡片**，不提供勾选/下载；自建空根类别可以安全删除。内部目录与资料为可混排、可勾选与持久排序的表格；目录行仅“打开”，资料行“下载”，两种行的名称都能点击。其它模块保持已有企业资质表格、个人分类卡片→台账、项目/IP 台账→详情等冻结展示形式。卡片或表格只是文件夹的不同视图。

导出默认每个逻辑文件**最新有效版本**，只有明确选择历史版本才导出历史原始文件名和旧字节；递归导出保留分类、项目、合同层级，并处理父子重叠选择、文件夹/文件同名冲突和取消/失败报告。同一共享文件出现在两个导出路径时，最终导出可以分别生成两份目标文件。

删除与回收站须保护尚有活跃链接、历史版本或可恢复引用的实际内容；移除单一文件链接不物理删除所有文件版本；不在缺少有效外部备份时主动删来源文件。

## 2. 目标关系和现有数据映射

目标逻辑关系：

`Workspace → Folder（parent、type、业务属性）`

`Folder ← FolderFileLink → File → FileVersion → FileObject → FileChunks`

| 目标概念 | 主要责任 | 现有映射或兼容来源 |
| --- | --- | --- |
| `Folders` | 统一身份、父子关系、工作区和类型 | `business_projects`、`business_contracts`、`business_ips`、`business_archives`、`records`、`archive_folders` |
| `FolderAttributes` | 项目、合同、IP 和普通目录等特有字段 | 既有 `*Store` 专用列和 IP payload，暂不强行改为万能属性表 |
| `Files` | 稳定文件身份、名称、选填属性 | 现有 `business_file_links.group_id`、综合资料 `attachments.group_id` 经过来源映射 |
| `FolderFileLinks` | 文件夹↔文件的多对多关联、别名、材料类别 | 现有业务附件链接与综合资料旧归属关系 |
| `FileVersions` | 文件所有历史版本及内容引用 | 现有 `version` 与 `group_id` |
| `FileObjects` + `FileChunks` | 实际加密字节、大小、哈希和写入状态 | 现有 `business_file_objects` / `business_file_chunks` 与旧 `attachments/chunks` |

上表记录了原开发阶段的旧表映射，仅用于历史参考。**正式新库实际 DDL 现已由 ResourceSchemaV2.cs 定义，旧表映射不再是施工目标。**优先引入类型化 `ResourceRef(workspace,kind,section,id)`，解决不同旧业务表的整数 ID 碰撞和跨模块导航；之后再研究统一物理 FolderId 映射。不能仅按数值 id 定位附件归属或文件夹父级。

此前 R1/R2 适配器和 R4 迁移策略已被上方新库决策取代，后续 N2/N3 应直接改用正式新表。不得提前删除旧业务表或覆盖历史字节，不得在缺少事务保证时让两套物理表随意双写。新库不提供旧表迁移；须保证新建资料库路径不会覆盖已存在文件。**未经验证不承诺旧版程序可打开新版库。**

## 3. 代码层次和职责

C# 后端划分：

1. `FolderService`：统一文件夹查询、导航、创建、改名、复制、移动、排序、软删除、恢复与父子关系检查；通过 `IFolderProvider` 或等效适配器保留项目/合同/知识产权/档案/综合资料专用数据与约束。
2. `FileService`：文件身份、属性、版本、关联/解除、查重提示决策、上传事务、预览、下载、引用保护；先复用 `BusinessFileStore` 和 `GeneralStore`，逐步淘汰双实现。
3. `ExplorerService` / `ExportPlanService`：文件夹和文件混合列表、选择、树遍历、递归导出与最新版本选择；避免模块各做一遍。
4. `SearchService`：工作区受限地组合文件属性与文件夹祖先业务字段。保留现有项目/合同/IP/Excel/MCP 的外部接口兼容入口，内部渐进委托公共服务。

原生 JavaScript 前端将 `wwwroot/app.js` 中的导航、卡片/表格、混合排序、多选、上传/版本历史、文件属性、搜索和导出分为共用组件；业务模块提供字段与表格列的配置。**不换前端技术栈，不取消内嵌单 EXE 的交付模式**。

## 4. 历史 R0–R4 阶段计划（由 N1–N4 新库顺序取代）

| 阶段 | 子任务（按顺序执行） | 阶段门槛 |
| --- | --- | --- |
| **R0：基线与安全拆分** | R0-01 提交本方案和 README 入口；R0-02 梳理现有/目标功能差异与回归用例；R0-03 小步拆分 `Program.cs` 的冒烟测试、Store、端点职责，保持 API 零行为变化 | 当前 Windows .NET Debug/Release、SQLCipher、Node UI/PDF/导出、MCP、单 EXE 回归通过；目标未实现用例明确标待实现 |
| **R1：统一 Folder 层** | R1-01 类型化 ResourceRef、Folder DTO 和类型策略；R1-02 项目/合同/IP 适配；R1-03 档案/综合资料/普通目录适配；R1-04 公共树导航和文件夹操作接口 | 所有现有业务能以 Folder 身份读取；同 ID 不串号；合同父子规则、排序、工作区隔离不回归 |
| **R2：统一 File 层** | R2-01 文件/版本身份和读取；R2-02 多文件夹共享同一文件和解除关联；R2-03 选填文件属性及检索；R2-04 同内容异名提示、三选一、取消清理；R2-05 综合资料旧附件适配 | 同 FileId 版本共享、仅共用字节的文件版本独立、跨区物理分离，数据删除/恢复安全 |
| **R3：公共前端和导出** | R3-01 共用 Folder 展示/批量/排序；R3-02 共用 File 列表/版本/属性/上传；R3-03 统一搜索、最新有效版本与文件夹递归导出；R3-04 将源码字符串断言逐步升级为行为回归 | 界面原有布局、MCP/Excel、历史版本、ZIP 目录/重复/取消等测试通过 |
| **R4：存储收敛与迁移** | R4-01 物理 Schema/备份门槛设计；R4-02 在可丢弃旧库核对旧数据；R4-03 事务/幂等迁移与中断恢复；R4-04 清理重复存储和代码；R4-05 Windows 真实安全/兼容验收 | 所有原件和历史版本哈希、业务关系、排序、隔离、回收站一致，旧库升级及恢复有证据 |

**R0-02 最少覆盖的行为矩阵**：项目/合同父子与复制转移；业务档案根层卡片/内部目录混排和空目录删除；共享同 FileId 后新版本同步与解除链接；同内容不同文件名的用户确认、仅复用字节与独立保存差异；文件属性空值上传/事后补充/检索；跨工作区隔离；最新版/历史版导出及目录重叠选取；回收站恢复和字节引用保护；旧库升级中断重入；MCP/Excel/单 EXE 兼容。**尚不存在的目标功能先作为待实现测试清单，不能无故让当前 CI 失败，也不能标记其已通过。**

## 5. 现有风险、禁止事项与验证

目前 `BusinessFileStore.List` 会返回有效历史版本，某些前端模块导出可能把同一个逻辑文件的多版一起列入，R0 需固定用例，R3 修复。`ArchiveFolderStore.DeleteEmpty` 的已删除资料计数、`GeneralStore` 与业务文件存储双路径、跨记录 `group_id` 同步、档案目录/记录混合持久排序，是必须检查的回归重点。

`Program.cs` 在 R0 拆分前约 2973 行、目前约 200 行，`app.js` 目前约 2674 行；`ui-main-smoke.cjs` 的部分测试依赖源码字符串，拆代码时可能产生不代表实际行为变化的断言失败，应逐步改成真实调用与 UI 行为测试。

现行单文件约 64 MiB、ZIP 不支持 ZIP64（小于 4 GiB）、Excel 8 MiB/5000 行限制**并不因架构重构而自动改善**。所有阶段继续执行 `FREEZE_AUDIT.md` 的 T01–T09 和 `WEB_TESTING.md` 对应安全/实机验收，特别是数据库备份、磁盘不足、中断、退出、升级和工作区隔离。

不得擅自创建长期 PR/临时分支，不强制迁移用户正式库，不牺牲当前 WinForms/VS 编译、现有 UI、项目合同规则或 MCP 授权隔离。一个可理解的修改目的对应一个 commit，默认直接推送 main；提交说明遵守 AIGT 模板六段要求。

## 6. 唯一执行进度表（后续每个子任务必须更新）

| 子任务 | 当前状态 | 完成依据 / 下一步 |
| --- | --- | --- |
| N1 新 SQLCipher v2 资源 Schema | **完成（代码与 Windows CI）** | [初版 ca924d55](https://github.com/zy19970/IPSys/commit/ca924d559d76d642414c20410f4457fc7faaeb42)、[内容保护 abc2a95d](https://github.com/zy19970/IPSys/commit/abc2a95d406192ad155f6b7412dd3dc7189bc542)、[DDL 顺序修正 e16ad1be](https://github.com/zy19970/IPSys/commit/e16ad1be01f8ede92afc7d4dcb153d057191952b)；[Windows CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) **success**。验证真实新建/重开 SQLCipher v2、文件夹合法父级/循环/工作区隔离、七系统根保护、同 FileId 多目录关联、独立 FileId 复用物理内容但版本独立、文件版本/完成内容不可改写；旧业务 UI/Store 切换属 N2/N3。 |
| N2 新 Folder 唯一业务 Store | **正式主链路完成（Windows CI）** | 项目、合同、IP、资质、业务档案、个人分类和综合资料的正式 UI/外围均使用 V2；N2-04 [CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) success，剩余 N4 旧实现清理与人工实机。 |
| N2-01 项目/合同/IP 原生 CRUD | **完成（代码与 Windows CI）** | [功能提交 daca2561](https://github.com/zy19970/IPSys/commit/daca2561f0cd6c4d76bc5054ae61b8f22e46f48d)、[测试修正 8264e6ce](https://github.com/zy19970/IPSys/commit/8264e6ceb14b39ece60322fb767357ef4251a1bd)；[Windows CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) **success**。NativeFolderStore/NativeFolderEndpoints 直接读写 SQLCipher v2 `folders` 与 `attributes_json`，支持项目/合同/IP CRUD、软删/恢复，验证合同父项目、会话授权、跨工作区、业务属性、父级隐藏及不双写旧表。第一次 CI #38743561769 因测试构造 IpInput 少一个 Tags 参数编译失败，补齐后全通过。**旧 UI、MCP、Excel 及附件 API 尚未切换。** |
| N2-02 业务档案目录/资料及综合资料原生 Folder CRUD | **完成（代码与 Windows CI）** | [功能提交 340102b3](https://github.com/zy19970/IPSys/commit/340102b3cb6e28a1f8882236115bc7e82beb874c)、[分类归属约束 265123fb](https://github.com/zy19970/IPSys/commit/265123fb15124ee04d73f338997d3d423088a91f)，[Windows CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) **success**。`NativeArchiveStore` 在新版 `folders` 上实现 archive_folder/archive/general 原生 CRUD；`NativeArchiveOrder` 提供目录和资料的混排持久排序、显式移动、防循环；`/api/v2/folders` 增加 section、parentId、entries/reorder/move。七个系统根、非空目录、删除恢复、资料必须属于分类、工作区和资料类别隔离及旧表不双写均有真实 SQLCipher HTTP 验收。**尚未切换旧 UI、附件/MCP/Excel；见 N2-03/N3。** |
| N2-03 项目合同/IP 原有业务 API/MCP/Excel 与 V2 统一 | **主链路已完成（Windows CI）** | IP 全链路及项目/合同现有网页/附件、原名 MCP、项目 XLSX 导入导出与合同只读导出、V2 搜索/回收站、全项目携子合同和历史原件跨区单事务复制已通过 [CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379)。[功能提交 59f7614](https://github.com/zy19970/IPSys/commit/59f7614ed2fb90d3bf3d6f56533240555874b6f1)，[旧测试身份修复 e59acc3](https://github.com/zy19970/IPSys/commit/e59acc37d6cfd3c3f27673bda996aa74ef3cb839)。剩余档案、个人分类、综合资料归 N2-04 统一处理。 |
| N2-04 档案、资质、个人分类与综合资料现有入口 V2 总集成 | **正式入口 V2 全链路自动回归通过；人工实机待验** | 02619b2 已切换公司资质/业务档案、个人分类及综合资料网页到 Folder/File；f014a2c 完成综合资料完整历史跨区事务复制；8da8ec4 同工作区 FileId+LinkId 原子关联；db79b82 把本机 MCP 档案/目录/综合资料 CRUD 和五类业务附件上传/查询统一 V2 并移除现有网页旧 business-files 路径；[6a7b1ff](https://github.com/zy19970/IPSys/commit/6a7b1ffe882aaa114c9d90af7011068cad7fd330) 修复文件夹/ZIP 导出所有版本为有效 FileId+FileVersion、非法身份提前拒绝，正式运行不再注册旧业务 HTTP/Excel/附件和旧搜索/排序路由，当时保留 --smoke 历史路由，**已在 N4 后续移除**。[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) completed/success。后续进入 N4 清理旧物理表、Store 和历史用例，再完成 Edge/Chrome 用户实机验收；不迁移开发测试旧库。 |
| N2-03-07-01 项目合同现有网页及原件 V2 | **Windows CI 通过** | [功能提交 f13d185c](https://github.com/zy19970/IPSys/commit/f13d185cbedb40f5bf842a1c674453bdfddbe229)、[Windows CI #38836041449](https://github.com/zy19970/IPSys/actions/runs/38836041449) **success**。新增 NativeProjectContractUiEndpoints 聚合真实项目 FolderId、合同父项目 FolderId 及附件 LinkId/FileId/所有版本，原生排序和同事务复制合同及共享原件链接；现有项目/合同网页列表详情增删改、合同从项目新增、附件 SHA-256 异名查重后明确选择、上传/版本、同区共享/单处解除、预览/下载和文件夹/ZIP 导出已切 V2。真实 SQLCipher/HTTP 验证合同父项目、原件字节及共享版本、工作区隔离、项目软删恢复，Node 页面回归通过。**项目/合同原名 MCP、搜索/回收站、Excel 以及项目跨工作区含合同完整历史转移待 N2-03-07-02，当前页面不会把新版 ID 交给旧 Excel/项目跨区接口。** |
| N2-03-07-02-01 项目合同原名 MCP/原件及通用文件命令 | **Windows CI #38845050570 已通过** | 原名项目/合同 CRUD、`upload_files(kind=project/contract)`、`list_project_files/list_contract_files`、`delete_project_file/delete_contract_file` 与通用 `list_files/delete_file` 已全部采用有效 V2 FolderId/FileId/LinkId；**历史阶段当时**的 `delete_file(file_id=LinkId)` 仅解绑一处；现行接口已改为 `delete_file(owner_id=FolderId,file_id=FileId,link_id=LinkId)`，先做三重核对，不能物理删除共享版本。内容同 SHA-256 仍必须显式复用/独立选择，不自动合并。真实 MCP 测试覆盖归属校验、FileVersion 字节、共享解绑和拒绝跨区误用；[功能 00e9c87](https://github.com/zy19970/IPSys/commit/00e9c87ab4dfec9cd702c3dd2f08f60f5becb935)、[旧断言适配 60c3692](https://github.com/zy19970/IPSys/commit/60c36926945c9bb4d660b25212dbf5f23f23f95a) 对应 [CI #38844746654](https://github.com/zy19970/IPSys/actions/runs/38844746654) **success**；通用文件收敛 [6fe6474](https://github.com/zy19970/IPSys/commit/6fe647437128635f0751b5edfe8795d13c74e0fc) 对应 [Windows CI #38845050570](https://github.com/zy19970/IPSys/actions/runs/38845050570) **success**。下一项 V2 Excel。 |
| N2-03-06 V2 知识产权 MCP 原件直接上传/版本/关联 | **Windows CI 已通过** | [功能提交 3f1e5608](https://github.com/zy19970/IPSys/commit/3f1e56088cb6c4f974d74221a6bca583a57d3939)、[Windows CI #38833862535](https://github.com/zy19970/IPSys/actions/runs/38833862535) **success**。保留 MCP 原命令 `upload_files(kind=ip)` 但真正从本机路径加密写入 V2 FolderId/FileId；新增 `list_ip_files`、`delete_ip_file`，明确区分文件与关联。原件重复时不自动合并，要求明确指定 `duplicate_mode=independent/reuse/share` 及匹配源 FileId；追加版本必须指定 `file_id`，取消临时内容不残留。SQLCipher/MCP/HTTP 验证 SHA 匹配、物理复用与逻辑身份独立、材料类别、版本字节、跨区隔离和单位置解绑。 |
| N2-03-05 IP 搜索/回收站/MCP 命名及跨区事务复制 | **Windows CI 已通过** | [整记录跨区功能 366f1caf](https://github.com/zy19970/IPSys/commit/366f1caf3bb1cdfa36dd8f2ce756417538597cbb)、[安全修正 b42e7f7a](https://github.com/zy19970/IPSys/commit/b42e7f7a15a2bfd196d8ba4f260a7153c6ee1433)、[最终 CI #38831972597](https://github.com/zy19970/IPSys/actions/runs/38831972597) **success**。旧名 MCP 的四个知识产权 CRUD、全局搜索与 V2 回收站均以 FolderId 为唯一身份；整记录及所有原件版本复制/移动由单 SQLCipher 事务处理，跨工作区实际 FileObject 物理独立。回收站对仍有原件历史的不可安全物理删除操作予以拒绝，避免误删共享字节。 |
| N2-03-04 现有知识产权网页接入 V2 Folder/File | **代码已提交，Windows CI 已通过** | [功能提交 d214d20a](https://github.com/zy19970/IPSys/commit/d214d20a658ec11dffde258bad7f5f1ef7e64f22)、[脚本嵌入修复 f480fca6](https://github.com/zy19970/IPSys/commit/f480fca61cc2ef7d9e286ef7427209a6859d467c)、[新版 UI 断言 d8ded0b9](https://github.com/zy19970/IPSys/commit/d8ded0b9cd25de90c59197c9e442623050d5800f)、[渲染修复 c56ce21f](https://github.com/zy19970/IPSys/commit/c56ce21f5a197e4f359263c9b1ff39209862428e)、[排序测试修正 e1348831](https://github.com/zy19970/IPSys/commit/e13488319861249fc10ce3fca1b269ded854d19c)、[最终 CI #38828523508](https://github.com/zy19970/IPSys/actions/runs/38828523508)。旧页面实际 `app.js` 已按 V2 IP FolderId 展示列表/详情、新增/编辑/删除、多选、排序及附件；`ip-v2.js` 将共享 FileId/位置 LinkId/历史版本映射到表格，上传先 writing 暂存、查重异名显示原文件位置并明确选择共享身份/字节复用/独立/取消；材料类别写入同一事务；真实旧 Excel 操作改调 `/api/v2/excel`，附件预览/下载/文件夹与 ZIP 导出改走 V2 原件版本地址。单 EXE 新 JS 已在 csproj+Program 注册并加 HTTP smoke。**旧 IP 全局搜索/回收站、原 14 项 MCP 旧命名、跨区 IP 复制/移动及其它业务模块尚未归一；高风险复制按钮目前明确拒绝错用旧身份。** 下一步 N2-03-05 整合上述入口与回收站，再推进 N4。 |
| N2-03-03 V2 知识产权固定 Excel 导入导出 | **完成（Windows CI）** | [功能提交 7a7d98a5](https://github.com/zy19970/IPSys/commit/7a7d98a54283174f94f3e7fb67bef2483cc0faf3)、[Windows CI #38825202078](https://github.com/zy19970/IPSys/actions/runs/38825202078) **success**。将原 `ExcelLedger` 拆为复用固定 OpenXML 20 列表头及校验的 V2 IP 适配层 `NativeIpExcelLedger`；新增 `/api/v2/excel/{workspace}/ip/template`、`export`、`import`，按 V2 `folders.kind=ip` FolderId 筛选并提供 `skip/update/create` 策略，导入上限 8 MiB/5000 行，工作区隔离，不写旧 IpStore。SQLCipher/HTTP 测试从旧固定台账生成兼容工作簿，验证 V2 新增/更新后 FolderId 不变、已有 FileId/版本/原件字节完整，筛选导出、个人工作区导入仅复制台账属性不带原件，非法 XLSX 拒绝；旧 Excel/网页 API 仍保留过渡，**下一批 N2-03-04 需要逐模块整合旧界面/HTTP/MCP 与 V2 数据源**。 |
| N2-03-02 V2 知识产权业务与附件闭环 | **完成（Windows CI）** | [功能提交 e88b1b82](https://github.com/zy19970/IPSys/commit/e88b1b8256731a1f95dfeda6f6e00cd61b7aff76)、[编译修复 02c45ece](https://github.com/zy19970/IPSys/commit/02c45ece23863935098e80567e2e055922fd0e7b)、[Windows CI #38824119576](https://github.com/zy19970/IPSys/actions/runs/38824119576) **success**。新增 `NativeIpFileStore`/`NativeIpFileEndpoints`，用实际知识产权 FolderId 校验同区有效归属，在 V2 提供按 IP 列表、带材料类别事务上传、详情、版本上传及原件下载、共享关联/单位置解绑恢复。原生 IP CRUD 原有 `/api/v2/folders` 不变；真实 HTTP/SQLCipher 回归检查同 FileId 多 IP 共享、新版同步、业务属性编辑不生成文件版本、跨区和错归属拒绝、IP 删除后隐藏/恢复、历史字节保持及无旧表双写。首次 CI #38823818064 因测试 IpInput 漏传 Tags 编译失败，修复后重测。**尚未将旧 `/api/ip`、旧 `business-files`、冻结网页、Excel/旧 MCP 切换至 V2；下一批 N2-03-03 逐模块统一旧入口身份。** |
| N2-03-01 原生 V2 项目/合同/IP MCP | **完成（Windows CI）** | [功能提交 3e7ba60a](https://github.com/zy19970/IPSys/commit/3e7ba60aad3fa1043f098178c3312e423873f745)、[Windows CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366) **success**。保留旧 14 项工具，并新增明确前缀 `v2_*` 11 项项目/合同/IP 查询、新增、部分字段更新和软删除。新命令通过原本同一用户命名管道、手动 MCP 授权和会话令牌访问 `/api/v2/folders`，只写新 `folders`、`attributes_json`；真实管道/HTTP/SQLCipher 回归验证合同父项目、跨工作区拒绝、编辑保留未指定字段、删除恢复、关闭 MCP 拒绝访问及不双写旧表。**当前 UI、旧业务 API、Excel 与旧 14 个工具仍走旧表，不应将本批等同全面迁移。** 下一批梳理并分模块切换旧业务接口与文件归属，最后归一 MCP 工具名并处理 Excel。 |
| N3 新 File 唯一存储与版本/共享 | **N3-01～04 及 N2-04 正式集成已完成（Windows CI）** | File/版本/链接/同内容复用、跨区独立原件和用户查重选择均已统一 V2；N4 首批新库收敛通过 [Windows CI #38905217041](https://github.com/zy19970/IPSys/actions/runs/38905217041)，剩余旧源码移除及实机验收。 |
| N3-04 查重提示、用户决策及暂存清理 | **完成（原生 API 与 Windows CI）** | [功能提交 93be896f](https://github.com/zy19970/IPSys/commit/93be896f4c0d26b0bfedb64c8c766069924a77f4)、[Windows CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) **success**。新增 `NativeFileChoiceStore`/`Resolve`/`Endpoints`：文件先在 SQLCipher 以 writing 状态分块暂存并计算 SHA-256/大小，仅匹配同区有效 FileId 最新版本，列出旧文件名及有效父级 Folder 路径，即使上传文件改名也查重；明确选择 `share-file`（同一 FileId 新 Folder 关联）、`reuse-content`（独立 FileId 与版本仅复用 ready FileObject）、`independent`（独立 FileId/ready FileObject），也可取消清理暂存。单次令牌与 30 分钟时限、任务锁、会话授权、跨区隔离、失败回滚、关库与重开清理未确认 writing 对象；SQLCipher/HTTP smoke 验证含异名命中、同名异内容不误命中、目录名展示、四种用户行为、重放拒绝、历史字节一致性。**原生 V2 后端通过，冻结 UI、旧业务/MCP/Excel 尚未迁入；下一步 N2-03，再 N4 做 UI/实机。** |
| N3-03 独立 FileId 同区仅复用内容/跨区物理复制 | **完成（代码与 Windows CI）** | [功能提交 944312d0](https://github.com/zy19970/IPSys/commit/944312d08f80d6baac7ab7fc614942441bfa880f)、[Windows CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581) **success**。新增 `NativeFileCopyStore`、`NativeFileCopyEndpoints` 原生复制接口：同工作区显式 `reuse-content` 可生成不同 FileId、独立 FileVersion 记录但共用完成不可变 FileObject；`independent-content` 复制版本与原件字节到新 FileObject，跨 company/personal 必须采用该模式。复制全部有效版本、允许副本独立命名，目标 Folder 关联与文件/版本/新对象在同事务提交，检查空间与任务取消。真实 SQLCipher/HTTP 测试覆盖双 FileId 属性与新版本独立、物理对象复用/隔离、跨区原件 SHA-256/字节一致、越权/无效归属与取消回滚。**未实现 N3-04 异名同内容自动检测/用户三选一，也未切换旧 UI/MCP/Excel；CI 不等于用户实机验收。** |
| N3-02 多 Folder 关联与解绑恢复 | **完成（代码与 Windows CI）** | [功能提交 c0b15a18](https://github.com/zy19970/IPSys/commit/c0b15a180e595883b511448d95cb77e6a90fd4af)、[Windows CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) **success**。通过 NativeFileLinkStore/NativeFileLinkEndpoints 支持同一 FileId 在多个有效 Folder 中关联、查询、单处软解绑和显式恢复。不同位置共享文件属性、版本历史；解绑后新版本不会自动复活旧链接，最后一个位置解绑后原文件字节仍保留并可从旧 Folder 查询关联恢复。真实 SQLCipher 和 HTTP 回归涵盖同区共享、版本同步、跨区拒绝、关联重复拒绝、数据持久化。下一步 N3-03 独立 FileId 物理内容复用及跨区独立复制。 |
| N3-01 新 File 基础存储、属性与版本 | **完成（代码与 Windows CI）** | [功能提交 78e33d55](https://github.com/zy19970/IPSys/commit/78e33d5544d8435cc216820bd1fbe471e9439c14)、[Windows CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) **success**。新增 `NativeFileStore`、`NativeFileEndpoints` 的 `/api/v2/files` 原生上传（须有效 FolderId）、文件选填元数据及事后编辑、SHA-256/分块、FileVersion 原始文件名/版本说明/历史下载；首版本、文件内容和第一条归属关系同事务提交。新 `NativeFileStoreSmoke` / `NativeFileHttpSmoke` 通过真实 SQLCipher、HTTP 认证/跨区拒绝、2 MiB+ 多块往返、历史 v1/v2、属性编辑不产生版本、取消/短写全回滚、重开持久化。**仍限单文件 64 MiB；N3-02 多位置共享与解除、N3-03 内容复用、N3-04 同内容提示及旧业务入口接管尚未实现。** |
| N4 新库完整 UI/搜索/导出及清理 | **旧物理/源码清理完成；综合实机验收进行中** | N4 第一/二批自动回归通过 [CI #38911635273](https://github.com/zy19970/IPSys/actions/runs/38911635273)；MCP 专项 P0+三批于 [CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) 完成；下一步是文件选填属性 UI/历史版本/ZIP 复杂边界、Edge/Chrome/Codex/WorkBuddy、Excel 和 T01–T09；测试库不迁移。 |
| MCP P0 与第一批安全保护 | **Windows CI 完成** | 唯一宿主/多 Agent 并发、`request_id` 加密写入记录与结果查询、批量结果及 `delete_file` 三重身份核验、撤权/参数校验；[CI #38917944549](https://github.com/zy19970/IPSys/actions/runs/38917944549)、[CI #38923795350](https://github.com/zy19970/IPSys/actions/runs/38923795350) success；真正异常崩溃 exactly-once 不保证。 |
| MCP 第二批文件查询和兼容 | **Windows CI 完成** | `list_files` 从 N+1 改为单 SQL，`list_files_page` 筛选与每页 1–200，保留 11 个 `v2_*` 兼容工具；[CI #38927263017](https://github.com/zy19970/IPSys/actions/runs/38927263017) success。 |
| MCP 第三批 14 项业务接口 | **Windows CI 完成** | 合同编辑、文件详情/属性、指定版本下载、共享/复制/关联恢复、项目/IP/档案/综合资料跨区转移、统一搜索、回收站查询/恢复；`080a599` 与 [CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) success，真实客户端长任务仍待验收。 |
| R0-01 方案 MD + README 入口 | **完成：本方案入库** | 以本次 Git commit 为准 |
| R0-02 现有/目标行为回归矩阵 | **完成（用例静态盘点）** | [测试与差异矩阵](./RESOURCE_REFACTOR_TEST_MATRIX.md) F01–F17；新 CI 尚未运行，未来目标行为在 R1–R4 验证 |
| R0-03 不改行为的代码拆分 | **完成（10 批代码提交及 Windows CI 均通过；用户实机未单独验收）** | **首四批** WebSmoke、ProjectStore、Vault、项目合同路由分别通过 [CI #38722481324](https://github.com/zy19970/IPSys/actions/runs/38722481324)、[#38723350666](https://github.com/zy19970/IPSys/actions/runs/38723350666)、[#38723730765](https://github.com/zy19970/IPSys/actions/runs/38723730765)、[#38724245349](https://github.com/zy19970/IPSys/actions/runs/38724245349)；**第五批** [7bfe8dcf](https://github.com/zy19970/IPSys/commit/7bfe8dcf02f09d22d7c132c86c41978103c59540) 归档 14 路由，[CI #38725471725](https://github.com/zy19970/IPSys/actions/runs/38725471725) success；**第六批** [48ccae53](https://github.com/zy19970/IPSys/commit/48ccae53a411248108c379ca1f4f120f0ab9cc1c) IP 5 路由，[CI #38725783469](https://github.com/zy19970/IPSys/actions/runs/38725783469) success；**第七批** [d2ad74f8](https://github.com/zy19970/IPSys/commit/d2ad74f8b5e215870c62d398d72ec3eaf88e7936) Excel 3 路由，[CI #38726119086](https://github.com/zy19970/IPSys/actions/runs/38726119086) success；**第八批** [ee3d6d34](https://github.com/zy19970/IPSys/commit/ee3d6d34f2fb8aa3eab08042bc5f3e969b68827f) 综合资料/文件 7 路由，[CI #38726478629](https://github.com/zy19970/IPSys/actions/runs/38726478629) success；**第九批** [68fe6002](https://github.com/zy19970/IPSys/commit/68fe6002c9ac6e48325173c1f3340d4747a73ac9) 搜索/台账 4 路由，[CI #38726808097](https://github.com/zy19970/IPSys/actions/runs/38726808097) success；**第十批** [71c6e54f](https://github.com/zy19970/IPSys/commit/71c6e54fe1ceab5dae2aaabb66dc2490132d52c8) 会话/诊断 8 路由，[CI #38727268885](https://github.com/zy19970/IPSys/actions/runs/38727268885) success。原 Program 约 2973 行，拆分后约 178 行，接口/业务逻辑/Schema 未主动改动。**接下来 R1-01。** |
| R1-01 ResourceRef / Folder DTO / 全局类型策略 | **完成（代码与 Windows CI）** | [模型提交 65136317](https://github.com/zy19970/IPSys/commit/65136317dd01ff8226f117315ffb248faa5a29fd)、[修正提交 2447df8e](https://github.com/zy19970/IPSys/commit/2447df8e35f5fddeeea317881b715d4a65ad6987)，[Windows CI #38728218664](https://github.com/zy19970/IPSys/actions/runs/38728218664) **success**；`FolderModelSmoke` 覆盖身份隔离、工作区、档案分段、项目/合同强制父级、自父级禁止。未迁移 Schema 或重写 API。 |
| R1-02 项目/合同/IP Folder Provider | **完成（代码与 Windows CI）** | [提交 a3762240](https://github.com/zy19970/IPSys/commit/a3762240f43ac2d7f300105fdbb456ee21f47bd0)，[Windows CI #38729428320](https://github.com/zy19970/IPSys/actions/runs/38729428320) **success**；只读身份、合同父级、业务属性与工作区/软删 SQLCipher 回归通过，旧接口/Schema 未改。 |
| R1-03 档案/综合资料/普通目录 Folder Provider | **完成（代码与 Windows CI）** | [提交 af084739](https://github.com/zy19970/IPSys/commit/af0847392e106cf3bcb4cf028137d359aeda811b)，[Windows CI #38730348327](https://github.com/zy19970/IPSys/actions/runs/38730348327) **success**；公司档案根层/子目录、资料归属及企业/个人资料和综合记录均通过临时 SQLCipher 只读适配回归。 |
| R1-04-01 公共树导航与只读 HTTP | **完成（代码与 Windows CI）** | [提交 535bcfe5](https://github.com/zy19970/IPSys/commit/535bcfe5b9dccdeb8973516568848d8258ab097a)，[Windows CI #38731911752](https://github.com/zy19970/IPSys/actions/runs/38731911752) **success**。`FolderBrowserService` 统一六类业务的虚拟根/真实父级导航，`FolderBrowserEndpoints` 提供 `/api/folders/{workspace}/children` 和 `/detail/{kind}/{id}` 只读 HTTP；公司档案混排继承 `archive_entry_order`。`FolderBrowserSmoke` 已通过会话权限、工作区隔离、非法/删除父级、混排排序、原业务属性与真实 SQLCipher HTTP 检验。未替换旧页面或修改数据表。 |
| R1-04-02-01 项目/合同/IP 公共 CRUD | **完成（代码与 Windows CI）** | [提交 89e965f8](https://github.com/zy19970/IPSys/commit/89e965f84d24491f80807f85bac68db64090d890)、[Windows CI #38733267975](https://github.com/zy19970/IPSys/actions/runs/38733267975) **success**；`FolderCommandService` 统一 create/update/delete/restore，`FolderCommandSmoke` 在真实 SQLCipher HTTP 中验证与旧 API 互通、合同合法父级、权限、删除及恢复。旧接口/物理表未变。 |
| R1-04-02-02 业务档案目录与各类档案资料公共 CRUD | **完成（代码与 Windows CI）** | [提交 c4626d36](https://github.com/zy19970/IPSys/commit/c4626d3613e08fa5ca1ebb52ca6efa6766517ab2)，[Windows CI #38734563500](https://github.com/zy19970/IPSys/actions/runs/38734563500) **success**； 复用 `ArchiveFolderStore` 与 `ArchiveStore`，保留公司七类系统根不可删除、目录非空不可删除、资料软删/回收站以及工作区/section 隔离；目录永久删除与归档资料恢复要区分，补真实 SQLCipher HTTP 回归。 |
| R1-04-02-03 综合资料公共 CRUD 和旧写接口适配 | **完成（代码与 Windows CI）** | [提交 a1d4815e](https://github.com/zy19970/IPSys/commit/a1d4815e4ce191b6d8f2df1263eebec3b09137b0)，[Windows CI #38735174204](https://github.com/zy19970/IPSys/actions/runs/38735174204) **success**；`GeneralFolderCommands` 集中原有 records 名称校验与 insert/update/soft-delete SQL，旧 `/api/records` 与新 Folder API 共用；真实 SQLCipher HTTP 验证双向读写、权限、工作区和回收站，附件存储不变。 |
| R1-04-03-01 统一复制/跨工作区转移业务适配 | **完成（代码与 Windows CI）** | [功能提交 557587c7](https://github.com/zy19970/IPSys/commit/557587c7914e469bbe4a3d3a4b50732d97e344b7)、[测试修正 1fbad247](https://github.com/zy19970/IPSys/commit/1fbad247a8e3c5880c0a074fa5a9bb6df24d8483)、[测试修正 f606f1ea](https://github.com/zy19970/IPSys/commit/f606f1ea5360185f9823f5626bdee70d927ad891)，[Windows CI #38737211398](https://github.com/zy19970/IPSys/actions/runs/38737211398) **success**。`FolderTransferService` 统一项目/IP 跨工作区复制转移及合同合法项目内复制，原有 transfer/copy HTTP 改为复用公共服务；真实 SQLCipher HTTP 已核对项目子合同完整复制、附件每个有效版本、SHA-256/原始字节、源删除可见性、跨区约束及旧接口一致性。跨工作区 FileObject 物理隔离仍由原 `BusinessFileStore.CloneLinks` 执行；未迁移旧库。首两轮 CI 分别因测试误设同编号合同唯一、误复制已移动项目下的失活合同而失败，已修正且最终 CI 全通过。 |
| R1-04-03-02 档案目录/资料移动及跨模块复制适配 | **已由新 N2 取代** | 以现有 ArchiveFolderStore/ArchiveStore 为权威；禁止目录成环、合同脱离项目、任意跨 section 移动；逐一验收归档目录与附件关系。 |
| R1-04-03-03 混排持久排序/旧接口归一与 R1 收尾 | **已由新 N2/N4 取代** | 以 archive_entry_order 与原有业务台账排序为真值，新增公共操作的 SQLCipher HTTP 回归，汇总完整旧库与 Windows CI 门槛后切入 R2。 |
| R2-01～R2-05 File/版本/共享 | **待开始** | R1 后实施 |
| R3-01～R3-04 前端与导出 | **旧路线由 N2-04/N4 接管** | 正式 V2 UI 和导出在 N2-04 自动验收通过；用户实机、复杂导出及旧测试清理由 N4 收尾。 |
| R4-01～R4-05 存储迁移/验收 | **历史路线，迁移取消** | 旧资料库仅有开发测试数据，N4 改为新 V2 物理收敛和数据安全验收。 |

每次继续：重读 AIGT 入口和 Git 操作规范、主分支全部提交说明与最新源码。**不要重复**已通过的 N2-04、N4 旧 Store 删除及 MCP P0/P1 三批工具扩充；最新 MCP 源码验收为 `080a599`、[CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431)。优先围绕实际客户端连接/工具清单刷新、指定版本下载路径、跨区大量原件长任务、文件属性 UI、历史共享/复杂递归导出和 T01–T09 设计真实测试；修改 C#/JS 时重新运行 Windows CI，核对 branch/ref，文档状态与人工实测区分记录。

**最终冻结：Folder 无版本并承载业务；File 有独立版本和全部选填的检索属性；同工作区跨文件夹可共享逻辑文件；同内容必须展示文件名与已有位置并由用户决定是否复用；工作区之间不共享实际原件对象。**

## N2-04 自动验收收尾和 N4 正式接续（2026-10-16）

N2-04 已完成正式 V2 页面、原件版本与导出（`02619b2`/`db79b82`/`6a7b1ff`）；N4 `013fa1e` 首批与 `b3c8f3b` 第二批已取消旧表/旧业务 HTTP/旧源码， [CI #38911635273](https://github.com/zy19970/IPSys/actions/runs/38911635273) success；后续 MCP 并发/安全/分页/业务工具扩充由 `080a599` 经 [CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) 验证。**本节为阶段历程，不再将旧 Store 清理列为下一项**；实际下一步是用户实机、T01–T09 与仍有边界的 UI/版本/导出。
