# IPSys — 资料管理系统

> **当前项目入口（2026-10-23）**。Explorer 重构分支 `work/onedrive-file-manager` 已以非强制 fast-forward 并入 `main`，合并提交基线 `8227d2c`；[main Windows CI #39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) 已通过。历史文档中“仍待合并”“旧网页入口”“未开展本地 Agent 测试”等陈述只代表当时的提交，不再是当前待办。

## 产品及技术现状

IPSys 是离线、单用户的 Windows 资料管理系统。一个 SQLCipher V2 加密库内区分**个人资料与公司资料**工作区。使用 WinForms 窗口控制进程生命周期，ASP.NET Core 服务只监听 `127.0.0.1`，用户在 Edge/Chrome 访问 Explorer 界面。网页“关闭数据库”锁库并返回登录页；退出 WinForms 才终止宿主。

程序的**唯一正式前端**集中于 [`src/IPSys.Web/wwwroot/`](./src/IPSys.Web/wwwroot/README.md)。页面源码是 `index.html`、`css/app.css` 和 `js/*.js`，文件管理、ZIP64、PDF、上传等能力模块也位于同一目录。Node 在编译期间生成 `wwwroot/dist/`，全部作为内嵌资源打包进 `IPSys.Web.exe`；不存在独立运行的第二套 UI。

所有业务分类、项目、合同、知识产权及档案以 **Folder** 表示（Folder 无版本），真实附件以 **File / FileVersion** 表示，`folder_file_links` 保存归属，同工作区可按明确操作共享 FileId 或复用 FileObject 内容；跨公司/个人工作区**不得共享物理 FileObject**，须独立复制。合同必须属于有效项目，项目可以单独存在。原件和文件版本存储于加密 SQLCipher 库；不维护磁盘明文镜像。

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
| Explorer F2-01～F2-06 核心业务、三批缺陷修复 | 功能与对应自动回归已完成；`main` 常规 Windows CI [#39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) 成功 |
| 运行期 401 重新登录、拖放与待确认上传、跨工作区关联/物理隔离 | 已修复；专项 Node/HTTP 与 Agent 取证见 [验收证据索引](./tests/TEST_EVIDENCE_INDEX.md) |
| 超过 2 GiB SQLCipher/HTTP 原件及大库 VACUUM | 专项 [#39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663) 通过（未跳过压缩或完整性检查） |
| 超过 4 GiB ZIP64 真实物理生成 | 专项 [#39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) 通过 `PASS_GENERATION_ONLY`，并不代表 CI 做了第三方解包 |
| 真实 Windows 原生保存/大文件交互 | 用户已反馈在本人电脑上完成手工验收；无公开上传的逐字节手工操作日志 |
| 正式软件发布 | **尚未发布**；合并及 CI 通过不等于产品所有环境/故障注入条件均已验收 |

## 文档入口（统一口径）

| 文档 | 唯一职责 |
| --- | --- |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 当前有效业务需求及历史覆盖决策 |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | 已确认的业务字段、字典及 Excel 字段逻辑 |
| [DESIGN.md](./DESIGN.md) | 现行系统架构、SQLCipher V2 资源与安全边界 |
| [UI_BASELINE.md](./UI_BASELINE.md) | 当前业务导航和交互原则；实际 Explorer 入口以源码为准 |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | 当前完成状态、可继续开发的事项和验收门槛 |
| [MCP_CODEX.md](./MCP_CODEX.md) | 本机 MCP 接入、63 个工具（含党团建设专用接口）与安全规则 |
| [USER_GUIDE.md](./USER_GUIDE.md) | Excel、搜索、附件/ZIP 与用户操作 |
| [TESTING.md](./TESTING.md) 与 [测试证据索引](./tests/TEST_EVIDENCE_INDEX.md) | 现行验证方法与各次独立原始证据 |
| [正式前端源码说明](./src/IPSys.Web/wwwroot/README.md) | Explorer 前端源码、打包和代码契约 |

历史计划、旧测试任务书与报告保留在 `docs/archive/`、`tests/agent-validation/`、`tests/retest-v2-2026-10-22/`、`tests/mcp-results/`，其日期状态不覆盖本页。开发前遵循 [AIGT-templates](https://github.com/zy19970/AIGT-templates) 的 `AGENTS.md` 和 `AI_RULES/GIT_OPERATIONS.md`。
