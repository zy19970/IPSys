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

Release 发布包为单独的 `IPSys.Web.exe`，但**不是完全免运行时**：目标机器需要 .NET 8 Windows Desktop Runtime 与 ASP.NET Core Runtime（x64）。前端打包需要 Node 22；`dist/` 是构建产物，不以手工编辑构建结果代替修改源码。CI 在 Windows 执行 Debug/Release、单 EXE、Explorer Node、Edge/HTTP、SQLCipher/HTTP 和 MCP 检查。

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
| [MCP_CODEX.md](./MCP_CODEX.md) | 本机 MCP 接入、59 工具和安全规则 |
| [USER_GUIDE.md](./USER_GUIDE.md) | Excel、搜索、附件/ZIP 与用户操作 |
| [TESTING.md](./TESTING.md) 与 [测试证据索引](./tests/TEST_EVIDENCE_INDEX.md) | 现行验证方法与各次独立原始证据 |
| [正式前端源码说明](./src/IPSys.Web/wwwroot/README.md) | Explorer 前端源码、打包和代码契约 |

历史计划、旧测试任务书与报告保留在 `docs/archive/`、`tests/agent-validation/`、`tests/retest-v2-2026-10-22/`、`tests/mcp-results/`，其日期状态不覆盖本页。开发前遵循 [AIGT-templates](https://github.com/zy19970/AIGT-templates) 的 `AGENTS.md` 和 `AI_RULES/GIT_OPERATIONS.md`。
