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

Windows CI 工作流是 [IPSys Windows build and smoke](https://github.com/zy19970/IPSys/actions/workflows/web-windows.yml)。其范围包括 Debug/Release、内嵌前端、Node 交互、浏览器/HTTP、SQLCipher/HTTP、MCP stdio 和单文件 EXE 启动等。

## 发布 GitHub Release

正式发布由 [Publish IPSys Release](https://github.com/zy19970/IPSys/actions/workflows/publish-release.yml) 手动触发。选择 `main` 和新的版本号，依据发布目的选择预发布或正式版本。工作流只运行版本/分支检查、两种 Windows x64 单 EXE 的 Release 构建与严格产物检查（目录只含 EXE、Windows VERSIONINFO、SHA256），然后从同一提交创建 GitHub Release；**不重新运行 smoke/Edge/HTTP/SQLCipher**。发布前由发布者核对独立 Windows CI 和本机验收，发布成功不代表本次重新测试全部功能。

[Releases](https://github.com/zy19970/IPSys/releases) 展示已发布版本；[Actions](https://github.com/zy19970/IPSys/actions) 展示 CI 测试和临时工件。**一次 CI 成功不自动等于创建了新的 Release**。

每个版本的实际发布产物、标签、构建提交和预发布状态以 [Releases](https://github.com/zy19970/IPSys/releases) 对应条目为准；现行发布流程通常产出 `IPSys-win-x64-SelfContained.exe`、`IPSys-win-x64-FrameworkDependent.exe` 和 `SHA256SUMS.txt`。下载后请核对文件哈希与实际使用版本。

## 验收层次

1. 代码和静态检查。
2. Windows CI 的业务与集成回归。
3. 实际 Windows 浏览器和原生文件保存操作。
4. 使用独立测试 DB 验证上传、跨工作区隔离、共享与恢复、永久删除、异常取消。
5. 版本发布和下载后核查实际构建提交及启动表现。

测试方法见仓库 [TESTING.md](https://github.com/zy19970/IPSys/blob/main/TESTING.md) 与 [tests/README](https://github.com/zy19970/IPSys/blob/main/tests/README.md)；当前源码、CI 与人工验收状态以 [现行基线](https://github.com/zy19970/IPSys/blob/main/docs/CURRENT_BASELINE.md) 及对应执行记录为准。历史证据可用 Git 历史取回。