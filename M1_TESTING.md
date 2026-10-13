# M1 Windows SQLCipher 验证原型 — 运行与测试

> 当前交付是 **M1 技术原型，不是 IPSys 完整业务软件**。请仅使用非敏感测试文件和全新测试数据库。M0 字段字典已定稿，完整 UI、业务模块和数据兼容迁移留待 M2–M7。

## 一、如何取得 Windows 可执行程序

### 推荐：GitHub Actions 自动构建

打开仓库 [Actions](https://github.com/zy19970/IPSys/actions/workflows/m1-windows.yml)，进入最近一次**成功**的 “M1 Windows SQLCipher prototype” 执行，在 Artifacts 下载 \`IPSys-M1-win-x64\`，解压并在 Windows 10/11 x64 上执行 \`IPSys.M1.exe\`。

仓库 Git 文件是源码，Actions 的 Artifacts 是可执行文件包。只有构建成功后才能宣称可执行文件已通过 Windows 冒烟验证。绿色构建使用 \`--self-contained true\`；运行成品不需另装 .NET Runtime，但自行从源码构建时需要 .NET 8 SDK 和首次 NuGet 下载。

### 自己编译

在仓库根目录 PowerShell 执行：

\`\`\`powershell
dotnet publish .\src\IPSys.M1\IPSys.M1.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o .\out\IPSys-M1
.\out\IPSys-M1\IPSys.M1.exe smoke
\`\`\`

## 二、先运行自动冒烟测试

在可执行文件所在目录打开 PowerShell：

\`\`\`powershell
.\IPSys.M1.exe smoke
\`\`\`

正常情况下最后输出 \`SMOKE PASS\`。此命令临时创建测试数据库、导入随机文件、导出并对比 SHA-256、尝试错误密码、检查加密文件头、关闭连接后复制加密数据库、从复制件重新打开；最后删除临时测试目录。

**没有输出 SMOKE PASS 就不视为测试通过。**

## 三、手工测试小文件

先手动创建测试目录（例如 \`D:\IPSys-M1-test\`）和子目录 \`D:\IPSys-M1-test\exports\`，再准备一份 **非敏感** \`sample.pdf\`。在可执行文件目录依次运行：

\`\`\`powershell
.\IPSys.M1.exe init "D:\IPSys-M1-test\test.db"
.\IPSys.M1.exe record "D:\IPSys-M1-test\test.db" company "我的测试资料"
.\IPSys.M1.exe put "D:\IPSys-M1-test\test.db" 1 "D:\IPSys-M1-test\sample.pdf"
.\IPSys.M1.exe list "D:\IPSys-M1-test\test.db"
.\IPSys.M1.exe get "D:\IPSys-M1-test\test.db" 1 "D:\IPSys-M1-test\exports"
.\IPSys.M1.exe check "D:\IPSys-M1-test\test.db"
\`\`\`

每次启动都需要输入数据库密码；输入密码时控制台不回显。实际记录、附件 ID 请以 \`record\`、\`put\` 返回结果为准。导出目录必须先存在，导出不会覆盖同名文件。若源文件在导入中变化，导入必须失败。业务记录先创建，附件才允许导入。

Windows PowerShell 可核对文件哈希：

\`\`\`powershell
Get-FileHash "D:\IPSys-M1-test\sample.pdf" -Algorithm SHA256
Get-FileHash "D:\IPSys-M1-test\exports\sample.pdf" -Algorithm SHA256
\`\`\`

两个结果应该完全一致。测试完**退出程序**，使用资源管理器复制 \`test.db\` 到另一个磁盘/文件夹，再对副本执行 \`check\`。输入错误密码应提示错误，不得打开该库。

## 四、第二轮大文件及移动 SSD 测试

在空间充分的盘上，准备不涉密的 **超过 2 GiB** 文件，通过 \`put\` 导入、\`get\` 导出并对比哈希。在移动 SSD 上重复上述操作，观察内存占用、速度、空间变化、正常退出后复制数据库可否读取。

真实移动 SSD 突然拔出、磁盘耗尽、崩溃恢复属于**破坏性故障试验**：只应使用可丢弃的测试库，切勿在正式数据上验证。本原型对未完成附件标记 \`writing\`，不会把未完成导入当成成功原件，也**没有完善的清理/恢复 UI**。

## 五、已经验证的范围与后续工作

代码包含 SQLCipher 库存在性检查、数据库密码校验、前置磁盘空闲空间预估、1 MiB 分块、分批写事务、附件完整状态、SHA-256 校验、关闭后数据库复制。Windows 构建是否通过，以 GitHub Actions 实际结果为准。

未包含：Edge/Chrome 浏览器 UI、导出文件夹选择器、Windows 外部 SSD 物理故障测试、正式多版本、去重/关联、回收站、Excel/全局搜索与完整模块。用户测试后需报告测试机系统、文件大小、命令及错误输出，供后续 M1/M2 整改。

SQLCipher 的非官方 \`SQLitePCLRaw.bundle_e_sqlcipher\` 存在旧版本维护与发行许可风险；它**只用于验证原型**，正式版依赖和安全性需要在 M2 重新评估。
