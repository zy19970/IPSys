# IPSys — 资料管理系统

## 普通用户先看：这个软件究竟怎么运行？

**资料管理系统是一款在自己 Windows 电脑上运行的软件，不需要购买服务器，也不需要把资料上传到网站。** 它看起来像 OneDrive，因为操作界面使用浏览器打开；但资料实际保存在你指定的本机加密数据库文件中，不是保存在 OneDrive 或某个网页里。

### 认识三个组成部分

| 你看到的东西 | 它负责什么 | 需要知道什么 |
| --- | --- | --- |
| **EXE 程序**（如 `IPSys.Web.exe`） | 启动资料管理服务，处理打开、保存、搜索、上传和下载等操作，并提供桌面控制窗口 | 它是**程序本身**，不是你的资料；使用时需要保持运行 |
| **DB 文件**（如 `IPSys.db`） | 保存个人和公司两套工作区的资料记录、目录结构、附件原件及文件版本 | 它是**真正的资料库**，使用 SQLCipher 加密，打开时需要密码；文件名和保存位置可以自己选 |
| **浏览器网页**（Edge 或 Chrome） | 显示文件夹、表格、按钮等，让你管理 DB 里的资料 | 它是**操作界面**，不是数据存放位置；关闭网页不等于退出程序 |

实际过程可以理解为：

```text
双击 EXE → 在本机启动资料管理服务
              ↓
点击“打开管理界面” → Edge/Chrome 显示网页
              ↓
选择 DB 文件并输入密码 → EXE 打开本地加密资料库
              ↓
在网页中新增、查找、上传、下载 → EXE 读写 DB 文件
```

浏览器访问的是本机地址 `http://127.0.0.1:某个端口`。这个地址由程序启动时自动生成，只在本机服务运行期间可用；它不是互联网网站。网页界面已经包含在 EXE 中，无须另外部署网站。

### 第一次使用：从没有数据库开始

1. 在 Windows 电脑上准备一个**自己有写入权限**的文件夹，例如 `D:\资料管理系统\`，把 EXE 放进去并双击运行。第一次使用可以选择创建新的资料库。
2. 点击启动器里的**“打开管理界面”**，浏览器会打开登录页面。选择**“创建新资料库”**，在路径栏填写保存位置，或点击旁边的**文件夹图标**，使用 Windows 窗口选择新数据库的保存路径；输入并确认密码，再点击创建。
3. 创建成功后进入资料工作台。按需要使用个人或公司工作区，建立资料、项目、合同、知识产权记录，再向对应位置上传附件。**记录和上传后的附件会写入加密 DB 文件**；原先电脑上的上传源文件不会因为上传操作自动被删除。

如果 EXE 和 DB 放在同一个目录，一般会看到这样的结构：

```text
D:\资料管理系统\
    IPSys.Web.exe     ← 软件程序
    IPSys.db          ← 加密资料库（包含记录和已存入的附件）
```

网页登录页面默认建议使用**EXE 所在目录**的 `IPSys.db`；如果同目录只有一个其他名称的 `.db`、`.sqlite` 或 `.sqlite3` 文件，会优先显示它的路径。**默认路径只是建议，不会强制创建、搬动或覆盖文件。** 如果数据库放在其他目录，直接通过文件夹图标选择即可。

### 以后每天怎么用？

1. **启动**：双击 EXE，再按“打开管理界面”进入浏览器。如果已有 DB，选择对应数据库，输入密码并打开；不需要每天新建。
2. **工作**：在网页里维护个人、公司资料，上传、预览、搜索和导出。网页中的“下载/导出”会将选定文件保存到你选择的位置；它不代表数据库从原位置移动。
3. **暂时收起**：关闭浏览器标签页，资料管理服务仍运行；点击 WinForms 窗口右上角 **×**，窗口会隐藏到 Windows 右下角**系统托盘**，而不是退出。双击托盘图标可恢复窗口，右键图标也有“打开主窗口”。
4. **真正退出**：点击启动器中的“退出程序”，或右键托盘图标选择“退出程序”，程序才会执行安全退出并停止本地服务。上传或删除等文件任务进行中时，请按弹窗选择处理方式。网页里的“关闭数据库”只会关闭当前资料库会话，**不会退出 EXE**。

### 资料会不会丢？怎么备份或换电脑？

**最需要保管的是 DB 文件和数据库密码。** EXE 是可以重新获取或更新的程序；只有 EXE 而没有原 DB，并不能恢复你保存过的资料。反过来，保留完好的 DB 和正确密码，才有机会在兼容版本的程序中重新打开原资料库。系统没有提供“忘记数据库密码后直接找回原密码”的功能。

日常备份时，先通过**“退出程序”安全结束软件**，确认没有正在执行的文件任务，再将 DB 文件复制到另一块磁盘或其他安全位置，并用副本验证可以正常打开。不要在数据库正在写入时，仅靠直接复制正在使用的 DB 文件当作可靠备份。

换电脑时，可以在新电脑准备可运行的 EXE，将安全退出后备份的 DB 文件放在自己选定的位置，再在网页登录页通过文件夹按钮选中它，输入原数据库密码。**更换 EXE 或关闭浏览器不会自动删除 DB；但删除、覆盖或遗失 DB 文件会导致资料受损或丢失。**

本软件目前是**本机离线资料库**：采用 OneDrive 风格的操作界面，不代表已接入 OneDrive 云端，也不具备自动云同步。EXE 分为自包含版和依赖环境版：自包含版不需要另装 .NET 8；依赖环境版需要安装对应的 .NET 8 Windows Desktop Runtime 和 ASP.NET Core Runtime（x64）。普通用户优先使用与需求匹配、经过验证的自包含版，具体以[发布说明](#手动发布-github-release)为准。

---

> **当前执行基线（2026-10-25）**：Explorer 已并入 `main`，当前仓库仅保留 `main` 分支。最近一次产品功能提交为 [`8c1ca9a`](https://github.com/zy19970/IPSys/commit/8c1ca9adc2bc92903926c44c46e200363bfa2e94)，对应 [Windows CI #40162144248](https://github.com/zy19970/IPSys/actions/runs/40162144248) 全部通过。当前阶段为**基于真实使用反馈的功能细节优化**；历史计划中的“待合并/待开展 Agent 测试”等描述只反映原日期状态。文档提交不改变产品功能；是否触发 CI 以实际工作流路径规则及本次运行状态为准。

**新增开发进度（2026-10-25）**：Agent 分层规范服务第一阶段源码已实现：内嵌规则与只读 get_agent_guidance，现行源码 MCP 工具数为 64；Windows CI 与真实 Agent 实测尚须逐一核验。下文 8c1ca9a 的 63 工具成功 CI 属此前代码基线，不是本次新工具的成功证明。标准 MCP Prompts 和文件缺项筛选已进入第二阶段源码；Windows CI 及真实 Codex 的智能入库/批量补录实测仍待完成，规范设置界面属于第三阶段。

## 产品及技术现状

IPSys 是离线、单用户的 Windows 资料管理系统。一个 SQLCipher V2 加密库内区分**个人资料与公司资料**工作区。使用 WinForms 窗口控制进程生命周期，ASP.NET Core 服务只监听 `127.0.0.1`，用户在 Edge/Chrome 访问 Explorer 界面。网页“关闭数据库”锁库并返回登录页；WinForms 标题栏“×”会隐藏窗口到 Windows 系统托盘（通知区域），不占用任务栏窗口按钮；双击托盘图标恢复窗口，右键可打开主窗口或选择“退出程序”进行安全关闭。点击桌面窗口的“退出程序”同样终止宿主。资料库登录页默认使用 EXE 所在目录的数据库路径，并可通过文件夹按钮调用 Windows 原生文件选择器（已存在数据库使用“打开”，新建数据库使用“保存”）；选择成功后启动器自动隐藏到系统托盘，网页登录页保持可见。

程序的**唯一正式前端**集中于 [`src/IPSys.Web/wwwroot/`](./src/IPSys.Web/wwwroot/README.md)。页面源码是 `index.html`、`css/app.css` 和 `js/*.js`，文件管理、ZIP64、PDF、上传等能力模块也位于同一目录。Node 在编译期间生成 `wwwroot/dist/`，全部作为内嵌资源打包进 `IPSys.Web.exe`；不存在独立运行的第二套 UI。

所有业务分类、项目、合同、知识产权及档案以 **Folder** 表示（Folder 无版本），真实附件以 **File / FileVersion** 表示，`folder_file_links` 保存归属，同工作区可按明确操作共享 FileId 或复用 FileObject 内容；跨公司/个人工作区**不得共享物理 FileObject**，须独立复制。合同必须属于有效项目，项目可以单独存在。原件和文件版本存储于加密 SQLCipher 库；不维护磁盘明文镜像。

**当前业务细节**：知识产权分十种类型，以三个可选编号字段（统一编号、公开号、授权公告号）表示；固定 XLSX 模板为 19 列。适用业务模块的 Excel 导出可选择**当前筛选结果**或**本模块全部记录**，筛选在服务端覆盖完整匹配记录，不受搜索页每组 60 条展示上限限制；**合同不提供独立的 Excel 导入或导出**，仅在所属项目中管理。公司业务档案七个预置目录创建后就是普通目录；公司还具有独立党团建设分类。MCP 在现行源码对外为 **64 个无 `v2_*` 别名的工具**。PDF 预览支持多页连续滚动和按需渲染，启动器显示本程序/整机 CPU 占用。

## 使用与开发

在 Windows 上通过 Visual Studio 构建 `src/IPSys.Web/IPSys.Web.csproj`，或运行：

```powershell
dotnet build src/IPSys.Web/IPSys.Web.csproj -c Debug
dotnet publish src/IPSys.Web/IPSys.Web.csproj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

上述本机默认 Release 命令构建的是单 EXE **依赖环境版**，目标机器需要 .NET 8 Windows Desktop Runtime 与 ASP.NET Core Runtime（x64）。GitHub 手动 Release 则同时构建自包含版和依赖环境版，见下文发布说明。前端打包需要 Node 22；`dist/` 是构建产物，不以手工编辑构建结果代替修改源码。CI 在 Windows 执行 Debug/Release、单 EXE、Explorer Node、Edge/HTTP、SQLCipher/HTTP 和 MCP 检查。

Windows EXE 应用图标为 [`src/IPSys.Web/assets/IPSys.ico`](./src/IPSys.Web/assets/IPSys.ico)，在 Visual Studio Debug、依赖环境版以及自包含版中均由同一个图标资源生成。WinForms 标题栏与任务栏也使用此图标。

## 手动发布 GitHub Release

IPSys 的正式发布由 [Publish IPSys Release](https://github.com/zy19970/IPSys/actions/workflows/publish-release.yml) 手动触发，不随普通代码提交自动发布。进入 Actions → Publish IPSys Release → Run workflow，分支选择 `main`，输入新的版本号（如 `v0.1.0-rc.1` 或 `v0.1.0`）。开发阶段建议保留默认勾选的「预发布版本」，准备正式交付时取消勾选。版本标签一旦使用，不允许重复发布覆盖。

发布工作流**直接复用**当前完整的 Windows 构建与验收（`.github/workflows/web-windows.yml`）：全部成功后，从本次 CI 下载两份经过单独构建和启动验证的 Windows x64 EXE，并用该次被测的精确提交 SHA 创建 GitHub Release。每个 Release 同时包含 `IPSys-win-x64-SelfContained.exe`（自包含 .NET 8 运行时，电脑无需额外安装 .NET 8，体积较大）与 `IPSys-win-x64-FrameworkDependent.exe`（不打包 .NET 运行时，体积较小，需安装 .NET 8 Windows Desktop Runtime 和 ASP.NET Core Runtime），另有 `SHA256SUMS.txt` 对两份文件提供 SHA-256 校验。失败、标签重复或测试期间 `main` 更新都会阻止发布，不会以旧构建或未测构建充数。自包含版需 Windows x64，但无需单独安装 .NET 8；该版随 EXE 固定携带发布时的运行时，日后更新 .NET 安全补丁需重新发布 EXE。依赖环境版则使用电脑上安装的 .NET 8 运行时。完整验收方法见 [TESTING.md](./TESTING.md)。

## 当前验收状态

| 验证范围 | 当前结论与证据 |
| --- | --- |
| Explorer F2-01～F2-06 核心业务、三批缺陷修复 | 功能与对应自动回归已完成，历史合并 CI [#39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) 成功 |
| 最新 Excel、知识产权、PDF、启动器与 MCP 调整 | 最近代码基线 `8c1ca9a`：[Windows CI #40162144248](https://github.com/zy19970/IPSys/actions/runs/40162144248) 成功；包括 19 列知识产权模板、按完整记录筛选导出、取消合同独立 Excel 接口、63 个 MCP 工具 |
| 运行期 401 重新登录、拖放与待确认上传、跨工作区关联/物理隔离 | 已修复；专项 Node/HTTP 与 Agent 取证见 [验收证据索引](./tests/TEST_EVIDENCE_INDEX.md) |
| 超过 2 GiB SQLCipher/HTTP 原件及大库 VACUUM | 专项 [#39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663) 通过（未跳过压缩或完整性检查） |
| 超过 4 GiB ZIP64 真实物理生成 | 专项 [#39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) 通过 `PASS_GENERATION_ONLY`，并不代表 CI 做了第三方解包 |
| 真实 Windows 原生保存/大文件交互 | 用户已反馈在本人电脑上完成手工验收；无公开上传的逐字节手工操作日志 |
| 软件发布 | 已有 [`v0.9.0-rc`](https://github.com/zy19970/IPSys/releases/tag/v0.9.0-rc) 和 [`v0.9.1-rc1`](https://github.com/zy19970/IPSys/releases/tag/v0.9.1-rc1) **预发布版**；尚未发布 GA 稳定版。预发布产物并非自动包含最新 `main` 代码 |

## 文档入口（统一口径）

| 文档 | 唯一职责 |
| --- | --- |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 当前有效业务需求及历史覆盖决策 |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | 已确认的业务字段、字典及 Excel 字段逻辑 |
| [DESIGN.md](./DESIGN.md) | 现行系统架构、SQLCipher V2 资源与安全边界 |
| [UI_BASELINE.md](./UI_BASELINE.md) | 当前业务导航和交互原则；实际 Explorer 入口以源码为准 |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | 当前完成状态、可继续开发的事项和验收门槛 |
| [MCP_CODEX.md](./MCP_CODEX.md) | 本机 MCP 接入、64 个工具（含党团建设专用接口）与安全规则 |
| [USER_GUIDE.md](./USER_GUIDE.md) | Excel、搜索、附件/ZIP 与用户操作 |
| [TESTING.md](./TESTING.md) 与 [测试证据索引](./tests/TEST_EVIDENCE_INDEX.md) | 现行验证方法与各次独立原始证据 |
| [正式前端源码说明](./src/IPSys.Web/wwwroot/README.md) | Explorer 前端源码、打包和代码契约 |

历史计划、旧测试任务书与报告保留在 `docs/archive/`、`tests/agent-validation/`、`tests/retest-v2-2026-10-22/`、`tests/mcp-results/`，其日期状态不覆盖本页。开发前遵循 [AIGT-templates](https://github.com/zy19970/AIGT-templates) 的 `AGENTS.md` 和 `AI_RULES/GIT_OPERATIONS.md`。
