# IPSys — 资料管理系统

> **当前开发状态（2026-10-16，N2-04 大里程碑开发中）**：知识产权、项目/合同现有网页及原件、MCP、固定 Excel、搜索回收站与完整历史跨区复制均已按 SQLCipher V2 运行，[CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379) success。N2-04 又完成归档/资质/个人分类/综合资料的**V2 固定 Excel 后端、全模块原生搜索（含祖先目录和可选 File 属性）、V2 回收站与文件历史保护**，旧 UI 搜索 ID 与新 FolderId 隔离，[CI #38852697271](https://github.com/zy19970/IPSys/actions/runs/38852697271) **success**。但这些模块现有网页、附件与导出仍读写旧接口，**N2-04 整体尚未完成**；下一步直接在本里程碑内统一完成页面/附件/Excel/搜索回收站调用切换。所有旧库都是测试数据，不需要迁移、回填、兼容；Edge/Chrome 实机仍待验收。

IPSys 定位为**业务化文件夹式本地资料管理器**，个人资料长期归档优先、公司资料独立工作区。程序采用 WinForms + 127.0.0.1 本机网页，一个 SQLCipher 加密库保存真实原件字节。2026-10-15 用户已确认 **Folder/File 统一资源物理模型**：所有业务条目及分类为带业务属性的 Folder（无版本），只有附件为 File（独立 FileId、选填属性和历史版本）。同区多个 Folder 可引用同一个 FileId，两个独立文件也可仅复用物理原件内容；查重时显示已有文件名与路径，由用户决定；公司/个人不共享物理原件。

**唯一架构和开发进度依据**：[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)。N2-03 项目合同及 IP 新库主链路已通过对应 Windows CI，当前直接进入 N2-04（档案、资质、个人分类与综合资料 V2 全入口接入）。只有代码、HTTP/SQLCipher、MCP/Excel/搜索/回收站、文件分享导出和 UI 测试一致通过，才标记 N2-04 完成；之后 N4 旧表清理和正式实机验收。

## 产品模型与页面规则（当前统一口径）

从使用者角度，资料按 **资料库 → 个人/公司工作区 → 分类容器或业务模块 → 业务记录 → 附件原件** 组织。V2 将分类及业务记录统一映射到 `folders`，附件则由 `files/file_versions/file_objects/file_chunks/folder_file_links` 管理；IP 与项目/合同的现有网页已切换，档案/综合资料和若干外围接口仍处于过渡阶段。

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

> 本节区分实际 V2 已接入的功能与旧模块过渡能力，所列 Windows CI 为自动验收，不代表完整用户实机验收。

| 范围 | 已接入的真实能力 | 证据/限制 |
| --- | --- | --- |
| 项目 | 科研/横向/其他项目，V2 网页 CRUD、MCP、Excel、排序、原件版本和全项目事务转移 | [CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379) 通过；项目带子合同历史原件跨区复制独立 FileObject |
| 合同 | 随项目从属，V2 网页、MCP、共享原件，Excel 只读导出和项目整组转移 | [CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379) 覆盖项目合同父级、共享与两个文件版本字节往返 |
| 知识产权 | 七类知识产权 CRUD、原件版本、Excel、原名 MCP、搜索回收站和跨区完整复制已接 V2 | 对应 N2-03-04～06 Windows CI 成功；完整 Edge/Chrome 实机仍待验收 |
| 分类档案 | 公司企业资质/业务档案；个人身份与资质/成果与奖励/学术与社会活动；业务档案可变层级、目录与资料混排 | 企业资质直达表格；公司业务档案根层入口不多选、不下载，内层可勾选并递归导出 |
| 综合/其他资料 | 独立记录、原件上传下载、版本、回收站 | 公司与个人分别显示对应资料 |
| 原件 | SQLCipher 分块存储、SHA-256、历史版本、同名独立文件、受控共享/复制、软删除恢复、PDF/图片预览 | B05 与 PDF.js 预览已有用户通过反馈 |
| 导出 | 文件夹、ZIP、最新/选定历史原件、项目与全部所属合同、固定列 XLSX | IP、项目合同附件及 Excel 已走 V2；归档/分类及综合资料 Excel/附件接入待 N2-04 |
| 搜索 | 已按 V2 FolderId 查 IP、项目、合同及其 FileId 原件，仍保留旧归档/综合过渡查询 | N2-04 需接入分类与综合资料的 V2 属性/祖先字段并统一真实详情跳转 |
| MCP | 现有 IP、项目/合同原名 CRUD、附件版本/链接与通用文件操作均已切 V2；新增 11 项 `v2_*` 仍保留 | 本机手动授权、同用户管道；正式 Codex 客户端实机待验收，LinkId 与 FileId 不可混用 |
| UI | 个人优先入口、公司五个业务栏目、工作台 3×2、紧凑台账、多选与持久排序 | 最新公司业务档案根层卡片、内层混合表格均有相应自动回归；仍待本机视觉验收 |

## 3. 当前已知边界

现行 `BusinessFileStore.MaxFileLength` 为 **64 MiB/单文件**；用户此前的大文件本机场景反馈通过，但未记录确切字节数，**不可视为超过 2 GiB 的验证通过**。文件夹/ZIP 导出使用 Edge/Chrome 的 File System Access API；ZIP 不支持 ZIP64，需小于 4 GiB。Excel 固定模板单文件输入限制 8 MiB、最多 5000 行；合同仅能导出，不能通过 Excel 导入。无论是否复用重复字节，跨公司/个人工作区不得共享同一个物理附件对象。

**数据安全验收尚未全部完成**：磁盘不足、SSD 异常拔出、退出过程、手工备份副本一致性、V2 版本识别/未来受控升级和超大文件的完整往返。密码修改等设置页项目尚有未接入入口。不要将这些项目写成「已支持/已验收」，不要在未取得新有效备份前删除来源文件。

## 4. 下一步与验收状态

1. **N2-04（当前大里程碑）**：集中完成企业资质/业务档案/个人分类/综合资料的实际网页及附件读写、排序复制、Excel、搜索回收站和共享版本导出 V2 归一；统一回归验收后整体交付，不再为每个接口单独定义小交付阶段。
2. **N2-04 验收门槛**：同一 SQLCipher V2 身份、Folder/File 多对多与工作区隔离、全部模块的网页/HTTP/Excel/检索/回收站/下载及 Node/Windows 自动回归一致；本机 Edge/Chrome 再单独实测。
3. **N4 清理与整体验收**：完成 File 选填属性和祖先 Folder 检索、最新版本与递归导出边界，引用清零后删除旧表/过渡 Store，进行 Windows、Edge/Chrome 及 T01–T09 安全验收再决定发布。

旧库迁移/回填已经取消，勿沿旧 R4 或直接发布路线推进。实际子任务状态和证据见 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)。

## 5. 文档索引（按职责维护）

| 文件 | 唯一职责 |
| --- | --- |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 产品定位、业务边界、Q1–Q162 及后续明确覆盖决定 |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | 已确认字段、类型、状态与固定 Excel 列 |
| [UI_BASELINE.md](./UI_BASELINE.md) | 当前生效的卡片/表格、目录、导航与操作规则（历史版式见 Git 历史） |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | 开发进度、剩余阶段与门槛 |
| [DESIGN.md](./DESIGN.md) | V2 新 Schema、N2 原生服务、旧业务过渡态及风险边界 |
| [HANDOFF.md](./HANDOFF.md) | N2-04 接续点、最近成功 CI、剩余模块入口及数据安全边界 |
| [WEB_TESTING.md](./WEB_TESTING.md) | 人工/自动验收依据及测试记录 |
| [EXCEL_LEDGER.md](./EXCEL_LEDGER.md)、[SEARCH.md](./SEARCH.md)、[MCP_CODEX.md](./MCP_CODEX.md) | 三个专项功能使用及验收说明 |
| [FREEZE_AUDIT.md](./FREEZE_AUDIT.md) | 历史需求冲突与持续有效的 T01–T09 安全门槛 |

**项目真实代码和最新用户确认优先于历史说明。** 开发以 `main` 为目标分支，遵守 [AIGT-templates](https://github.com/zy19970/AIGT-templates) 的 `AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md`。