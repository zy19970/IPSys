# IPSys 最小网页版 — Windows 测试指南

本版本用于验证浏览器与 C# 本地服务、SQLCipher 加密数据库之间的完整通信，**不是 V1.0 正式版**。目前仅开放“综合资料”演示模块；创建数据库、添加记录、上传/下载附件为实际写入，不是模拟数据。

## 1. 获取绿色程序

从 [GitHub Actions · IPSys minimal web Windows test](https://github.com/zy19970/IPSys/actions/workflows/web-windows.yml) 打开最新**成功**的一次运行，在页面底部 Artifacts 下载 `IPSys-Web-win-x64`，解压后双击 `IPSys.Web.exe`。程序会在电脑本机 `127.0.0.1` 的临时端口启动服务，并尝试通过 Windows 默认浏览器打开界面；如果自动打开失败，可将控制台打印的地址复制到 Edge/Chrome。

下载的是源码仓库之外的 Windows 自动构建产物，不需安装 .NET 运行时。**请保留解压目录内的 `wwwroot` 文件夹及相关 DLL，不要只复制 EXE。**

## 2. 第一次测试

1. 在本机创建一个测试文件夹，例如 `D:\IPSys-test`，准备几份无敏感内容的小文件。
2. 双击 `IPSys.Web.exe`，看到 IPSys 网页后选择“新建测试库”，输入完整路径 `D:\IPSys-test\my-test.db`，设置数据库密码并再次确认。
3. 进入公司工作区，点击“新建资料”，输入“第一份测试资料”。随后点“上传文件”，选一个 PDF、图片或 TXT 文件（当前单文件上限 64 MiB）。
4. 下载刚才的文件，检查内容是否与原件完全一致。切换到个人工作区，确认看不到公司的资料。也可在个人工作区独立新建记录和上传附件。
5. 点击“检查数据库完整性”，检查是否出现 `ok`。点击“关闭数据库”后，再选择“打开已有库”，输入原路径与密码重新解锁，检查记录及附件是否仍在。
6. 点击“安全退出”，等控制台结束；然后手动用 Windows 资源管理器复制加密数据库到其它位置，再运行程序从副本打开，检查是否能解锁并查看原有资料。

**数据库路径目前通过文本框输入**，这是浏览器文件路径权限模型下的原型简化方案；正式 Windows 原生路径选择功能待 M1 继续验证。Chrome/Edge 的普通下载目录由浏览器自身决定，正式版“每次选择导出目标目录”的功能尚未实现。

## 3. 开发模式

安装 .NET 8 SDK 后在仓库根目录执行：

```powershell
dotnet run --project .\src\IPSys.Web\IPSys.Web.csproj
```

发布便携测试包：

```powershell
dotnet publish .\src\IPSys.Web\IPSys.Web.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o .\out\IPSys-Web
.\out\IPSys-Web\IPSys.Web.exe --smoke
```

`--smoke` 自动在临时目录创建加密库，HTTP 创建公司记录、上传约 1 MiB 随机字节、下载比对、检查工作区隔离、拒绝错误密码，再打开正确密码。自动测试输出 `WEB SMOKE PASS` 才视为通过。Actions 还进行 Windows publish 和 JS 语法检查；**未见成功 workflow 前不得称程序已经测试通过。**

## 4. 当前工程限制

1. 单文件 64 MiB，采用 HTTP 原始流和 SQLCipher 内 1 MiB 分块存储；尚未在网页版验证大于 2 GiB 文件，也没有上传取消按钮、进度条、版本管理、去重、回收站、Excel、全部知识产权模块。
2. 后台目前仅绑定 `127.0.0.1`、随机端口，通过会话令牌保护解锁数据库；不暴露到局域网。密码不记忆、不保存在浏览器存储中，但会话令牌在当前标签页的 sessionStorage 保留直到退出/关闭库。
3. 不实现自动备份和删除来源文件；务必在安全退出后手工复制原始数据库。测试期间断电或拔 SSD 可能损坏数据库，必须只用可丢弃的测试资料。
4. 当前数据库 Schema 与 M1 CLI 三张基础表兼容，但尚无正式数据库迁移保障；**不要打开正式资料数据库，避免误操作**。
5. 先验证最短链路，再决定正式本地文件对话框、Edge 默认浏览器兼容、浏览器最后标签关闭时自动停止后端等细节。

报错时请反馈 Windows 版本、浏览器类型、执行步骤、控制台报错、Actions 链接或截图，以便定位并直接修复仓库。