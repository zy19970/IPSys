# IPSys 最小网页 + WinForms 启动器（Windows 测试）

**当前版本是技术验证版，不要导入正式敏感文件。** 已实现 Windows Forms 程序入口，仍使用原有本地 ASP.NET Core 网页及 SQLCipher 加密数据库。当前网页只提供综合资料、公司/个人工作区、单文件上传下载和数据库检查，单文件上限 64 MiB。

## 1. 下载与启动

打开 [WinForms Windows 构建工作流](https://github.com/zy19970/IPSys/actions/workflows/web-windows.yml)，选最新的**成功**运行，在底部 **Artifacts** 下载 `IPSys-Web-win-x64`。解压后双击 `IPSys.Web.exe`。HTML、CSS、JavaScript 已内嵌 EXE，运行时**不需要 `wwwroot` 文件夹**；发布包若带有其它依赖文件，请勿随意删除。

弹出 **“IPSys · 本地管理系统” WinForms 窗口**，本地服务随窗口启动，**此时不会自动打开网页**。点击 **“打开浏览器管理界面”**，才会打开 Edge/Chrome。若浏览器无法自动启动，窗口会显示 localhost 地址，供你手动访问。

关闭浏览器标签页，WinForms 不会退出；再次点击“打开浏览器管理界面”可继续进入。**关闭 WinForms 的 X 或点击“退出程序”，才会关闭本地服务和数据库，结束软件运行。** 网页内“安全退出”也是程序级退出入口。

## 2. 在电脑上测试

1. 建立测试文件夹，例如 `D:\IPSys-test`；只准备没有敏感数据的小文件。
2. 双击 `IPSys.Web.exe`，点击 WinForms「打开浏览器管理界面」。
3. 在网页选择新建测试库，路径输入 `D:\IPSys-test\test.db`，设置并确认密码。
4. 在公司工作区新建综合资料，上传 TXT/PDF/图片，下载原件验证内容。
5. 切换个人工作区，确认看不到公司记录。可另建个人记录。
6. 点击“检查数据库完整性”确认返回 `ok`。关闭浏览器标签后，从 WinForms 再次点击打开按钮，确认页面仍可连接。
7. 点击 WinForms 的“退出程序”或右上角 X，确认窗口关闭。随后在资源管理器中复制数据库文件，重新运行程序从副本打开并验证记录。**只有程序退出并完成数据库关闭后才手动复制文件。**

## 3. Visual Studio 2022 调试

打开 `src/IPSys.Web/IPSys.Web.csproj`，选择 Debug 并按 F5。工程通过 `EmbeddedResource` 将 `wwwroot/index.html`、`app.js`、`style.css` **直接编译进 EXE**，VS Debug 运行不再复制网页资源目录。修改前端文件后重新编译即可更新 EXE 内的页面。

普通 Debug 编译输出通常在 `src/IPSys.Web/bin/Debug/net8.0-windows/`。关闭旧版 WinForms，拉取最新 main，选择“重新生成解决方案”再按 F5。即使 Debug 目录里没有 `wwwroot`，首页也应该正常显示。

Windows CI 同时测试 Debug 普通编译和 Release 发布：确认输出目录**没有外置 `wwwroot`**，并通过 HTTP 请求验证内嵌首页、CSS、JS，以及 SQLCipher 资料往返。

## 4. 本地发布和自动测试

安装 .NET 8 SDK 后在 Windows PowerShell 的仓库根目录运行：

```powershell
dotnet publish .\src\IPSys.Web\IPSys.Web.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o .\out\IPSys-Web
.\out\IPSys-Web\IPSys.Web.exe
```

使用 WinForms GUI 的 `WinExe` 子系统，不再默认弹出黑色控制台。自动测试使用 `--smoke` 参数，后台运行 HTTP/SQLCipher 往返校验但**不显示 WinForms 窗口**。CI 通过 PowerShell `Start-Process -Wait` 等待 GUI 进程结束，并确认程序生成 `WEB SMOKE PASS` 测试报告，避免 GUI 启动后误认为测试成功。

[查看本次成功的 Windows 构建](https://github.com/zy19970/IPSys/actions/runs/38378877601)。

## 5. 测试版限制

1. **WinForms 生命周期和按钮实际点击需要本机实测**。Windows CI 已验证可编译、无界面的 SQLCipher/HTTP 往返和 SHA-256 一致性；不能由此声称 GUI 点击与窗口退出已经做过人工验收。
2. 网页仅有最小综合资料模块，尚无正式文件版本管理、去重、回收站、Excel、专利/项目/合同等其它业务模块。
3. 单文件暂限 64 MiB；SSD 突然断开、超 2 GiB 附件、文件导入过程中点击 X 的完整安全退出交互尚未实现/验证，请不要对真实数据进行破坏性测试。
4. 目前数据库路径仍在网页输入，正式的 Windows 选路径、目录批量导出等尚待开发。主程序只在本机 `127.0.0.1` 启动 HTTP 服务，不开放到局域网。

如果不能启动，把 Windows 版本、出现的窗口、报错界面和构建链接发回来即可。
