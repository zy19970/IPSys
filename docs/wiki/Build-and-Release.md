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

**2026-11-01 的已核验节点**：源码提交 [9af263d](https://github.com/zy19970/IPSys/commit/9af263d8745b90056acf1588fbd996c6117f54a3) 对应 [Actions 41298466274](https://github.com/zy19970/IPSys/actions/runs/41298466274)，状态为 completed/success，相关 EXE 工件已上传。该次可选的 4 GiB ZIP64 实体生成步骤被跳过；历史专项曾单独验证过超过 4 GiB 的生成，不应混为这一次运行结果。

## 发布 GitHub Release

正式发布由 [Publish IPSys Release](https://github.com/zy19970/IPSys/actions/workflows/publish-release.yml) 手动触发。选择 `main` 和新的版本号，依据发布目的选择预发布或正式版本。工作流会复用构建验收并从被测的提交生成发布产物。

[Releases](https://github.com/zy19970/IPSys/releases) 展示已发布版本；[Actions](https://github.com/zy19970/IPSys/actions) 展示 CI 测试和临时工件。**一次 CI 成功不自动等于创建了新的 Release**。

截至 2026-11-01 核对，已存在 `v0.9.0-rc` 和 `v0.9.1-rc1` 两个预发布；新的源码更改如果还没发布 Release，用户应下载对应成功 CI 工件或等待下一次正式发布。

## 验收层次

1. 代码和静态检查。
2. Windows CI 的业务与集成回归。
3. 实际 Windows 浏览器和原生文件保存操作。
4. 使用独立测试 DB 验证上传、跨工作区隔离、共享与恢复、永久删除、异常取消。
5. 版本发布和下载后核查实际构建提交及启动表现。

历史测试材料、单文件大体积与 ZIP64 的验证边界见仓库 [测试证据索引](https://github.com/zy19970/IPSys/blob/main/tests/TEST_EVIDENCE_INDEX.md)。