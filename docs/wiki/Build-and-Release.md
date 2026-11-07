# 构建、验收与版本发布

## 从源码构建

源码：[IPSys](https://github.com/zy19970/IPSys)。当前 Windows 工程为 `src/IPSys.Web/IPSys.Web.csproj`，使用 .NET 8 与 WinForms；前端资源打包依赖 Node 22。

在具备对应 SDK 的 Windows 开发环境运行：

~~~powershell
dotnet build src/IPSys.Web/IPSys.Web.csproj -c Debug
dotnet publish src/IPSys.Web/IPSys.Web.csproj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
~~~

以上 publish 命令生成依赖目标机 .NET 运行时的单 EXE；如果需要自包含版，请使用项目发布工作流或相应的 self-contained 参数，并验证实际启动。

## 构建和自动化检查

最近产品代码 [Windows CI #558](https://github.com/zy19970/IPSys/actions/runs/42048982231) 已完成成功：26 个成功步骤、0 个失败、2 个可选 ZIP64 测试跳过；其中干净 checkout 直接 Release 的双单 EXE 校验不运行 smoke，随后日常完整 CI 继续执行既有自动测试。该 CI 与手动 Publish 是两个不同工作流。


Windows CI 工作流是 [IPSys Windows build and smoke](https://github.com/zy19970/IPSys/actions/workflows/web-windows.yml)。其范围包括 Debug/Release、内嵌前端、Node 交互、浏览器/HTTP、SQLCipher/HTTP、MCP stdio 和单文件 EXE 启动等。

**2026-11-02 历史核验节点**：产品/测试提交 [`4567ae96b7`](https://github.com/zy19970/IPSys/commit/4567ae96b7f5b55bfa486f51352baae311f17b1c) 对应 [Windows CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499)，`completed/success`（26 项成功、0 项失败，两项可选 ZIP64 步骤跳过）。自包含 EXE、依赖型 EXE、Explorer 复测证据已上传；此前 4 GiB ZIP64 物理生成属于独立专项。

## 发布 GitHub Release

正式发布由 [Publish IPSys Release](https://github.com/zy19970/IPSys/actions/workflows/publish-release.yml) 手动触发。选择 `main` 和新的版本号，依据发布目的选择预发布或正式版本。工作流只运行版本/分支检查、两种 Windows x64 单 EXE 的 Release 构建与严格产物检查（目录只含 EXE、Windows VERSIONINFO、SHA256），然后从同一提交创建 GitHub Release；**不重新运行 smoke/Edge/HTTP/SQLCipher**。发布前由发布者核对独立 Windows CI 和本机验收，发布成功不代表本次重新测试全部功能。

[Releases](https://github.com/zy19970/IPSys/releases) 展示已发布版本；[Actions](https://github.com/zy19970/IPSys/actions) 展示 CI 测试和临时工件。**一次 CI 成功不自动等于创建了新的 Release**。

截至 2026-11-06，最新已核验预发布为 [v0.9.3-rc.1](https://github.com/zy19970/IPSys/releases/tag/v0.9.3-rc.1)，对应提交 `1c2642b6e8`，[Publish #6](https://github.com/zy19970/IPSys/actions/runs/42053785425) 三个 job 均成功。包含 `IPSys-win-x64-SelfContained.exe`、`IPSys-win-x64-FrameworkDependent.exe`、`SHA256SUMS.txt`，下载后可校验 SHA-256。尚未发布 GA 稳定版；旧版 `v0.9.0-rc`、`v0.9.1-rc1` 属历史版本。

## 验收层次

1. 代码和静态检查。
2. Windows CI 的业务与集成回归。
3. 实际 Windows 浏览器和原生文件保存操作。
4. 使用独立测试 DB 验证上传、跨工作区隔离、共享与恢复、永久删除、异常取消。
5. 版本发布和下载后核查实际构建提交及启动表现。

测试怎么跑见仓库 [tests/README](https://github.com/zy19970/IPSys/blob/main/tests/README.md)；历史证据已移出仓库，可用 Git 历史取回。