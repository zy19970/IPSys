# IPSys — 资料管理系统

> **当前开发状态（2026-10-15，main@944312d0）**：N1、N2-01/02、N3-01/02/03 已通过 Windows CI。N3-03 同区不同 FileId 显式复用加密内容和跨区独立保存已通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581)。下一项 N3-04 查重用户选择，随后 N2-03 旧业务 API/MCP/Excel 与 N4 UI/搜索/导出。

IPSys 定位为**业务化文件夹式本地资料管理器**，个人资料长期归档优先、公司资料独立工作区。程序采用 WinForms + 127.0.0.1 本机网页，一个 SQLCipher 加密库保存真实原件字节。2026-10-15 用户已确认 **Folder/File 统一资源物理模型**：所有业务条目及分类为带业务属性的 Folder（无版本），只有附件为 File（独立 FileId、选填属性和历史版本）。同区多个 Folder 可引用同一个 FileId，两个独立文件也可仅复用物理原件内容；查重时显示已有文件名与路径，由用户决定；公司/个人不共享物理原件。

**唯一架构和开发进度依据**：[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)。旧资料库全是测试数据，不迁移、不回填、不支持旧库兼容打开，不自动覆盖旧文件。当前新 `folders/files` Schema 与 N2 原生 Folder API 已建立，但旧页面/API/附件/MCP/Excel/搜索尚未转入 V2，后续按 N3 → N2-03 → N4 实施。

## 产品模型与页面规则（当前统一口径）

从使用者角度，资料按 **资料库 → 个人/公司工作区 → 分类容器或业务模块 → 业务记录 → 附件原件** 组织。V2 将分类及业务记录统一映射到 `folders`，附件则由 `files/file_versions/file_objects/file_chunks/folder_file_links` 管理；当前旧 UI 和业务 API 尚未完成新库切换。

| 概念 | 用途 | 现行表现 |
| --- | --- | --- |
| 资料库 | 单个 SQLCipher 加密文件，提供密码解锁与备份单位 | WinForms 启动本机网页 |
| 工作区 | 个人与公司相互隔离，记录及原件不跨区共享 | 工作台与侧栏入口 |
| 分类容器 | 用于定位资料，可含下级分类与本级记录 | 公司业务档案首层卡片，深入后为混合表格；其他模块沿既有入口 |
| 业务记录 | 带属性的资料承载单元：项目、合同、专利、证书、普通资料等 | 表格或现有记录卡片；点击名称进入详情 |
| 附件原件 | 记录所包含的真实文件，可有历史版本 | 详情预览/下载；按记录或目录层级导出 |

**卡片用于入口导航，表格用于多条资料管理。** 公司业务档案根层卡片只允许进入、创建一级分类、删除自建空分类，不显示选择或下载；进入后各级子目录与资料混排、持久排序，目录行名称/「打开」进入下级，资料行名称进入详情/「下载」导出原件，目录通过勾选后工具栏递归导出。公司企业资质直接进入表格；个人分类资料仍为卡片→表格→详情；项目/知识产权为业务台账→详情；综合资料维持现有记录卡片。详见 [UI_BASELINE.md](./UI_BASELINE.md)。

项目可独立存在，合同只能在项目内创建；文件必须归属有效 Folder；公司/个人不跨区共享原件对象。统一物理 Folder 不取消各业务类型专属字段，也不意味着所有 UI 统一为一种表格或创建硬盘明文目录。

## 1. 运行与发布

程序架构为 **WinForms 启动器 → 127.0.0.1 本地 ASP.NET Core 服务 → Edge/Chrome 网页**。网页 HTML、CSS、JavaScript 和离线 PDF.js 均编译进 EXE；网页「关闭数据库」只关闭加密库并返回登录页，WinForms 窗口和本地服务继续运行；关闭浏览器标签页也不结束程序。仅 WinForms 的「退出程序」或窗口 X 才能停止服务。上传任务期间网页关闭数据库会被拒绝，WinForms 退出仍采用安全三选项。登录默认显示「打开已有资料库」，首次创建入口单独提供；解锁后先选择个人或公司工作区。

Visual Studio 可直接打开 `src/IPSys.Web/IPSys.Web.csproj` 调试。Release 发布为 **仅一个 `IPSys.Web.exe` 的依赖框架单文件包**，不会捆绑 .NET 运行时；目标电脑须预装 **.NET Desktop Runtime 8 x64** 和 **ASP.NET Core Runtime 8 x64**。编译生成的 Debug 目录与便携 Release 发布目录不是同一种交付形式。

```powershell
dotnet publish src/IPSys.Web/IPSys.Web.csproj -c Release -r win-x64 --self-contained false -o .\out\IPSys-SingleExe
```

从 [Windows Actions](https://github.com/zy19970/IPSys/actions/workflows/web-windows.yml) 下载最新成功的 `IPSys-Web-win-x64` Artifact，或自行发布。2026-10-15 的基线 [CI #38673474396](https://github.com/zy19970/IPSys/actions/runs/38673474396) 显示通过。CI 结果不等于用户本机完整验收。

## 2. 当前实现的业务

> 本节是**旧 UI/API 已实现的过渡期功能清单**，不表示相关业务已完整迁入 V2。N1/N2 的原生服务仅有各自独立自动测试证据。

| 范围 | 已接入的真实能力 | 证据/限制 |
| --- | --- | --- |
| 项目 | 科研、横向、其他项目；增改、软删、复制、跨区转移；合同从属关系 | 公司「公司项目」为统一台账，合同只在项目内新建 |
| 合同 | 关联项目的合同编辑、复制、软删、台账和附件；金额 CNY，显示 `0.00` | 「查看全部合同」是汇总入口，不能独立创建合同 |
| 知识产权 | 七类知识产权、类型状态、基础和扩展字段、增改删复制转移 | 固定字段以 [M0 字典](./M0_DATA_DICTIONARY.md) 为准 |
| 分类档案 | 公司企业资质/业务档案；个人身份与资质/成果与奖励/学术与社会活动；业务档案可变层级、目录与资料混排 | 企业资质直达表格；公司业务档案根层入口不多选、不下载，内层可勾选并递归导出 |
| 综合/其他资料 | 独立记录、原件上传下载、版本、回收站 | 公司与个人分别显示对应资料 |
| 原件 | SQLCipher 分块存储、SHA-256、历史版本、同名独立文件、受控共享/复制、软删除恢复、PDF/图片预览 | B05 与 PDF.js 预览已有用户通过反馈 |
| 导出 | 记录/模块附件文件夹、ZIP、项目及全部所属合同一键导出、Excel 固定台账 | 文件夹/ZIP 边界及 Excel 桌面人工验证仍待补 |
| 搜索 | 当前工作区跨模块结构化字段与附件**文件名/元数据**检索、真实详情跳转 | 不检索 PDF/Office 正文、无 OCR |
| MCP | 本机 stdio + 当前用户命名管道，项目/合同/知识产权/附件 14 项工具 | 系统设置中人工授权，默认关闭；需本机 Agent 实测 |
| UI | 个人优先入口、公司五个业务栏目、工作台 3×2、紧凑台账、多选与持久排序 | 最新公司业务档案根层卡片、内层混合表格均有相应自动回归；仍待本机视觉验收 |

## 3. 当前已知边界

现行 `BusinessFileStore.MaxFileLength` 为 **64 MiB/单文件**；用户此前的大文件本机场景反馈通过，但未记录确切字节数，**不可视为超过 2 GiB 的验证通过**。文件夹/ZIP 导出使用 Edge/Chrome 的 File System Access API；ZIP 不支持 ZIP64，需小于 4 GiB。Excel 固定模板单文件输入限制 8 MiB、最多 5000 行；合同仅能导出，不能通过 Excel 导入。无论是否复用重复字节，跨公司/个人工作区不得共享同一个物理附件对象。

**数据安全验收尚未全部完成**：磁盘不足、SSD 异常拔出、退出过程、手工备份副本一致性、V2 版本识别/未来受控升级和超大文件的完整往返。密码修改等设置页项目尚有未接入入口。不要将这些项目写成「已支持/已验收」，不要在未取得新有效备份前删除来源文件。

## 4. 下一步与验收状态

1. **N3（当前下一项 N3-04）**：N3-01 File 基础层、N3-02 多 Folder 共享、N3-03 独立 FileId 同区内容复用及跨区物理复制已通过 Windows CI；下一步实现查重提示及用户决定复用模式或取消。
2. **N2-03**：等新 File 归属接口具备后，将旧业务 API、MCP、Excel 转到 V2 唯一数据源，避免旧新表双写和无归属附件。
3. **N4**：保留冻结 UI，接通新搜索（File 属性/祖先 Folder 字段）、递归导出和默认最新版本、回收站；确认无引用后清理旧表及兼容层，完成 Windows CI、Edge/Chrome 和 T01–T09 安全实机验收，再评估发布。

旧库迁移/回填已经取消，勿沿旧 R4 或直接发布路线推进。实际子任务状态和证据见 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)。

## 5. 文档索引（按职责维护）

| 文件 | 唯一职责 |
| --- | --- |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 产品定位、业务边界、Q1–Q162 及后续明确覆盖决定 |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | 已确认字段、类型、状态与固定 Excel 列 |
| [UI_BASELINE.md](./UI_BASELINE.md) | 当前生效的卡片/表格、目录、导航与操作规则（历史版式见 Git 历史） |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | 开发进度、剩余阶段与门槛 |
| [DESIGN.md](./DESIGN.md) | V2 新 Schema、N2 原生服务、旧业务过渡态及风险边界 |
| [HANDOFF.md](./HANDOFF.md) | 当前 N1/N2 状态、N3 下一项与跨会话接续风险 |
| [WEB_TESTING.md](./WEB_TESTING.md) | 人工/自动验收依据及测试记录 |
| [EXCEL_LEDGER.md](./EXCEL_LEDGER.md)、[SEARCH.md](./SEARCH.md)、[MCP_CODEX.md](./MCP_CODEX.md) | 三个专项功能使用及验收说明 |
| [FREEZE_AUDIT.md](./FREEZE_AUDIT.md) | 历史需求冲突与持续有效的 T01–T09 安全门槛 |

**项目真实代码和最新用户确认优先于历史说明。** 开发以 `main` 为目标分支，遵守 [AIGT-templates](https://github.com/zy19970/AIGT-templates) 的 `AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md`。