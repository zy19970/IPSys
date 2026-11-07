# IPSys — 资料管理系统

> IPSys 的产品定位、安装、使用及构建发布入口。版本、源码实现范围、数据模型和验收状态统一查阅 [现行基线](docs/CURRENT_BASELINE.md)；MCP 的实时接口以已连接程序的 `tools/list` 为准。

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
3. 创建成功后进入资料工作台。按需要使用个人或公司工作区，建立资料文件夹、项目与知识产权记录，再向对应位置上传附件。**记录和上传后的附件会写入加密 DB 文件**；原先电脑上的上传源文件不会因为上传操作自动被删除。

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


## 产品架构与资料组织

IPSys 是离线、单用户的 Windows 资料管理系统。一个 SQLCipher schema 4 加密库内区分**个人资料与公司资料**工作区。使用 WinForms 窗口控制进程生命周期，ASP.NET Core 服务只监听 `127.0.0.1`，用户在 Edge/Chrome 访问 Explorer 界面。网页“关闭数据库”锁库并返回登录页；WinForms 标题栏“×”会隐藏窗口到 Windows 系统托盘（通知区域），不占用任务栏窗口按钮；双击托盘图标恢复窗口，右键可打开主窗口或选择“退出程序”进行安全关闭。点击桌面窗口的“退出程序”同样终止宿主。资料库登录页默认使用 EXE 所在目录的数据库路径，并可通过文件夹按钮调用 Windows 原生文件选择器（已存在数据库使用“打开”，新建数据库使用“保存”）；选择成功后启动器自动隐藏到系统托盘，网页登录页保持可见。

程序的**唯一正式前端**集中于 [`src/IPSys.Web/wwwroot/`](./src/IPSys.Web/wwwroot/README.md)。页面源码是 `index.html`、`css/app.css` 和 `js/*.js`，文件管理、ZIP64、PDF、上传等能力模块也位于同一目录。Node 在编译期间生成 `wwwroot/dist/`，全部作为内嵌资源打包进 `IPSys.Web.exe`；不存在独立运行的第二套 UI。

项目、知识产权与普通资料文件夹以 **Folder** 表示（Folder 无版本），真实附件以 **File / FileVersion** 表示，`folder_file_links` 保存归属，同工作区可按明确操作共享 FileId 或复用 FileObject 内容；跨公司/个人工作区**不得共享物理 FileObject**，须独立复制。项目可以单独存在；合同资料只是项目下的普通文件夹，不再是独立业务对象。原件和文件版本存储于加密 SQLCipher 库；不维护磁盘明文镜像。

知识产权、项目及普通资料共用资料管理与附件版本体系；普通文件夹可直接存放附件并继续嵌套。公司业务档案的初始目录建立后按普通文件夹管理，合同材料也是项目内普通子目录。业务字段、固定 Excel 模板和数据身份约束见 [字段字典](./M0_DATA_DICTIONARY.md)；目录、选择、搜索及交互见 [UI 基线](./UI_BASELINE.md) 和 [用户指南](./USER_GUIDE.md)；Agent 工具的英文标识与参数见 [MCP 手册](./MCP_CODEX.md)。

> **软件版本提醒**：已解锁资料库时可通过「设置 → 软件更新」手动检查，启动后也会静默检查 GitHub 官方 Windows Release。检测到新版仅提醒并打开官方页面供用户自行下载；不自动安装，离线功能不受影响。开发版与正式发布版按 EXE 编译版本识别。

## 使用与开发

在 Windows 上通过 Visual Studio 构建 `src/IPSys.Web/IPSys.Web.csproj`，或运行：

```powershell
dotnet build src/IPSys.Web/IPSys.Web.csproj -c Debug
dotnet publish src/IPSys.Web/IPSys.Web.csproj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

上述本机默认 Release 命令构建的是单 EXE **依赖环境版**，目标机器需要 .NET 8 Windows Desktop Runtime 与 ASP.NET Core Runtime（x64）。GitHub 手动 Release 则同时构建自包含版和依赖环境版，见下文发布说明。前端打包需要 Node 22；`dist/` 是构建产物，不以手工编辑构建结果代替修改源码。Windows CI 工作流定义了 Debug/Release、单 EXE、Explorer Node、Edge/HTTP、SQLCipher/HTTP 和 MCP 等检查；某次运行是否实际执行并通过，须以该次 Actions 日志和结果为准。

Windows EXE 应用图标为 [`src/IPSys.Web/assets/IPSys.ico`](./src/IPSys.Web/assets/IPSys.ico)，在 Visual Studio Debug、依赖环境版以及自包含版中均由同一个图标资源生成。WinForms 标题栏与任务栏也使用此图标。

## 手动发布 GitHub Release

IPSys 的正式发布由 [Publish IPSys Release](https://github.com/zy19970/IPSys/actions/workflows/publish-release.yml) 手动触发，不随普通代码提交自动发布。进入 Actions → Publish IPSys Release → Run workflow，分支选择 `main`，输入新的版本号（如 `v0.1.0-rc.1` 或 `v0.1.0`）。开发阶段建议保留默认勾选的「预发布版本」，准备正式交付时取消勾选。版本标签一旦使用，不允许重复发布覆盖。

手动发布工作流**不再重复运行** `.github/workflows/web-windows.yml` 的 smoke/Edge/HTTP/SQLCipher 验收。发布者应先在独立的日常 Windows CI 和本机确认选定版本无误，然后手动触发发布。发布工作流只针对选中的 `main` 提交构建两份 Windows x64 单 EXE，检查两份产物的文件数量、体积关系、Windows EXE 文件版本资源及 SHA-256，并使用相同的提交 SHA 创建 GitHub Release；构建或产物校验失败、标签重复、发布前 `main` 更新都会阻止发布。**发布成功只代表构建与上传成功，不代表这次发布重新测试了软件功能。** 构建产物继续严格要求每个目录仅有一份 EXE；若直接 Release 构建产生没有任何资源文件的空 `wwwroot` 目录，会在校验时安全清理；如其中存在文件或符号链接，则立即失败并提示排查打包配置。普通 Windows CI 增加从干净工作区直接 Release 的纯构建回归，以避免日常 CI 先 Debug、手动发布直接 Release 的路径不一致。 Windows「属性 → 详细信息」中，文件说明和产品名称统一为「IPSys 资料管理系统」，公司/权利标识为 `Joey@BGRIMM`，版权日期使用该次编译的北京时间完整日期 `YYYY-MM-DD`；例如输入 `v0.9.2-rc.1`，文件版本自动为 `0.9.2.0`，产品版本为 `0.9.2-rc.1`（不再附加 Git SHA）。两份 EXE 均在发布构建阶段读取 Windows VERSIONINFO 验证一致性，不执行 smoke。内部程序集 `IPSys.Web` 及 PE 原始文件名保持原样。每个 Release 同时包含 `IPSys-win-x64-SelfContained.exe`（自包含 .NET 8 运行时，电脑无需额外安装 .NET 8，体积较大）与 `IPSys-win-x64-FrameworkDependent.exe`（不打包 .NET 运行时，体积较小，需安装 .NET 8 Windows Desktop Runtime 和 ASP.NET Core Runtime），另有 `SHA256SUMS.txt` 对两份文件提供 SHA-256 校验。自包含版需 Windows x64，但无需单独安装 .NET 8；该版随 EXE 固定携带发布时的运行时，日后更新 .NET 安全补丁需重新发布 EXE。依赖环境版则使用电脑上安装的 .NET 8 运行时。完整验收方法见 [TESTING.md](./TESTING.md)。

## 版本、构建及验收记录

获取可下载程序请查看 [GitHub Releases](https://github.com/zy19970/IPSys/releases)；自动构建与发布执行情况请查看 [GitHub Actions](https://github.com/zy19970/IPSys/actions)。**发布成功仅说明对应发布任务按其检查项完成，不能代替本机 GUI、MCP 或真实资料库的操作验收**。

当前代码与最近运行状态集中维护在 [CURRENT_BASELINE.md](./docs/CURRENT_BASELINE.md)，测试入口及独立的源码、CI、本机 Agent、人工验收证据见 [TESTING.md](./TESTING.md) 和 [tests/README.md](./tests/README.md)。旧版本或阶段验证结论通过对应 Git 历史、Actions 运行编号与 Release 页面追溯，README 不复制可能过期的结果表。


## 文档入口（统一口径）

| 文档 | 唯一职责 |
| --- | --- |
| [现行基线](./docs/CURRENT_BASELINE.md) | **唯一现状声明**：模型、功能、空间策略、发布与验收口径 |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 当前有效业务规则与范围 |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | 已确认的业务字段、字典及 Excel 字段逻辑 |
| [DESIGN.md](./DESIGN.md) | 现行系统架构、SQLCipher schema 4 资源与安全边界 |
| [UI_BASELINE.md](./UI_BASELINE.md) | 当前业务导航和交互原则；实际 Explorer 入口以源码为准 |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | 当前完成状态、可继续开发的事项和验收门槛 |
| [MCP_CODEX.md](./MCP_CODEX.md) | 本机 MCP 接入、工具与参数口径、安全规则 |
| [USER_GUIDE.md](./USER_GUIDE.md) | Excel、搜索、附件/ZIP 与用户操作 |
| [TESTING.md](./TESTING.md) 与 [tests/README](./tests/README.md) | 测试分层与怎么跑；历史证据已移出仓库 |
| [正式前端源码说明](./src/IPSys.Web/wwwroot/README.md) | Explorer 前端源码、打包和代码契约 |
| [Wiki 使用说明](./docs/wiki/Home.md) 与 [Wiki 维护说明](./docs/WIKI_PUBLISHING.md) | 正式用户帮助页面及其独立发布流程 |

历史任务书和验证资料可用 `git log -- <路径>`、`git show <sha>:<路径>` 从 Git 历史查阅。开发与仓库操作前遵循 [AIGT-templates](https://github.com/zy19970/AIGT-templates) 的 `AGENTS.md`、`AI_RULES/GIT_OPERATIONS.md` 与 `AI_RULES/MEMORY_PROTOCOL.md`。
