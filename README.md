# IPSys — 资料管理系统

> **当前开发状态（2026-10-17）**：正式新库及业务入口全部使用 SQLCipher V2 Folder/File/版本/关联；N4 已完成旧物理表/路由收敛和 31 个停用 Store/Provider/HTTP/历史测试源码删除，复用的业务校验已移入 `BusinessRules.cs`。MCP 的 P0 并发修复、第一批写操作安全、第二批文件列表分页和第三批 14 项业务操作补齐均已完成代码及 Windows 自动验收；最新业务源码 `080a599` 对应 [Windows CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) **completed/success**。Edge/Chrome、真实 Codex/WorkBuddy 双 Agent、长时间文件任务、大文件、故障注入及 T01–T09 仍待用户实机验证。

IPSys 定位为**业务化文件夹式本地资料管理器**，个人资料长期归档优先、公司资料独立工作区。程序采用 WinForms + 127.0.0.1 本机网页，一个 SQLCipher 加密库保存真实原件字节。2026-10-15 用户已确认 **Folder/File 统一资源物理模型**：所有业务条目及分类为带业务属性的 Folder（无版本），只有附件为 File（独立 FileId、选填属性和历史版本）。同区多个 Folder 可引用同一个 FileId，两个独立文件也可仅复用物理原件内容；查重时显示已有文件名与路径，由用户决定；公司/个人不共享物理原件。

**唯一架构和开发进度依据**：[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)。N2-04、N4 两批旧实现清理及 MCP 三批专项改造均有通过的 Windows CI 证据（最新 [Windows CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431)）。下一步集中完成真实客户端与浏览器/Excel 的实际验收、文件历史/复杂导出边界及 T01–T09 数据安全检查；自动 CI 通过不代表可正式发布。

## 产品模型与页面规则（当前统一口径）

从使用者角度，资料按 **资料库 → 个人/公司工作区 → 分类容器或业务模块 → 业务记录 → 附件原件** 组织。V2 将分类及业务记录统一映射到 `folders`，附件则由 `files/file_versions/file_objects/file_chunks/folder_file_links` 管理；所有正式业务网页、原件导出和 MCP 均使用 V2 数据身份；新建库不创建旧业务表，正式与 `--smoke` 均不注册历史 V1 业务路由；11 个 `v2_*` MCP 工具只是兼容名称，不代表旧业务表。

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

从 [Windows Actions](https://github.com/zy19970/IPSys/actions/workflows/web-windows.yml) 获取最新成功的 `IPSys-Web-win-x64`。MCP 第三批代码 `080a599` 已通过 [Windows CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431)：Debug、Release 单 EXE、正式 stdio 握手及真实 SQLCipher/HTTP/Node 回归。后续文档提交不改变此已验收的源码。

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
| 导出 | 全模块 V2 文件夹/ZIP、最新及手动选择历史版本、项目与全部合同、固定列 XLSX | 所有原件导出按 V2 FileId+FileVersion；[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) 通过，复杂路径和大文件实机待验 |
| 搜索 | 项目、合同、知识产权、档案、个人分类、综合资料统一 V2 FolderId/FileId 搜索，包括目录祖先及附件选填属性 | [CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) 通过；真实浏览器跳转待验 |
| MCP | 本机手动授权、唯一 GUI 宿主/多客户端管道、`request_id` 写入追踪；合同编辑、文件元数据/历史版本/指定版本下载、文件共享关联与恢复/复制、四类业务转移、搜索和回收站恢复；`list_files_page` 分页 | [Windows CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) success。实际 Codex/WorkBuddy 工具刷新、下载到宿主本机路径及多 Agent 长任务仍待实机核验；详情见 [MCP_CODEX.md](./MCP_CODEX.md) |
| UI | 个人优先入口、公司五个业务栏目、工作台 3×2、紧凑台账、多选与持久排序 | 最新公司业务档案根层卡片、内层混合表格均有相应自动回归；仍待本机视觉验收 |

## 3. 当前已知边界

正式 V2 `NativeFileStore.MaxFileLength` 仍限 **64 MiB/单文件**；用户此前大文件的本机通过记录不能证明 V2 已超过 2 GiB 往返。ZIP 尚不支持 ZIP64（小于 4 GiB），Excel 输入限 8 MiB/5000 行，合同仅只读导出；公司/个人不得共享 FileObject。

**数据安全验收尚未全部完成**：磁盘不足、SSD 异常拔出、退出过程、手工备份副本一致性、V2 版本识别/未来受控升级和超大文件的完整往返。密码修改等设置页项目尚有未接入入口。不要将这些项目写成「已支持/已验收」，不要在未取得新有效备份前删除来源文件。

## 4. 当前 N4 任务与验收状态

1. **N2-04 主链路代码和自动回归已通过**：[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) success。项目、合同、知识产权、档案、资质、个人分类及综合资料的正式网页、MCP、Excel、搜索/回收站、文件历史共享与导出均已接入 V2。
2. **N4 第一、二批源码收敛已通过 CI**：新库物理表、开库、正式与 `--smoke`、搜索/回收站均只有 V2；31 个旧 Store/Provider/HTTP/历史测试源码已删除，V2 共用 DTO/业务校验和 XLSX 解析安全留存。`7b51669` 编译缺少 `FolderMutationInput`，`b3c8f3b` 修复后 [Windows CI #38911635273](https://github.com/zy19970/IPSys/actions/runs/38911635273) **success**。下一批是正式功能边界专项、故障注入和用户实机。
3. **N4 验证与发布判定**：文件选填属性 UI、历史版本、目录祖先检索、父子重叠和同名 ZIP/文件夹导出，Windows Debug/Release/单 EXE、SQLCipher/HTTP、MCP、Excel、Node PDF/ZIP、Edge/Chrome 实机及 T01–T09 安全门槛。未验收完成前不宣布正式发布。

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
| [EXCEL_LEDGER.md](./EXCEL_LEDGER.md)、[SEARCH.md](./SEARCH.md)、[MCP_CODEX.md](./MCP_CODEX.md) | Excel、统一搜索及最新 MCP 工具/客户端操作手册（含 P0/P1、分页、14 项新工具和幂等使用方式） |
| [FREEZE_AUDIT.md](./FREEZE_AUDIT.md) | 历史需求冲突与持续有效的 T01–T09 安全门槛 |

**项目真实代码和最新用户确认优先于历史说明。** 开发以 `main` 为目标分支，遵守 [AIGT-templates](https://github.com/zy19970/AIGT-templates) 的 `AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md`。