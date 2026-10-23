# IPSys 正式前端

IPSys 的唯一正式浏览器界面源代码位于 `src/IPSys.Web/wwwroot/`，与 WinForms 启动器、ASP.NET Core 服务和 SQLCipher V2 数据模型一起编入 `IPSys.Web.exe`。没有独立运行的前端项目，也不维护另外一套页面。浏览器访问的仍是本机 `http://127.0.0.1:<port>/`，文件从 EXE 内嵌资源提供。

## 源码位置

```text
src/IPSys.Web/wwwroot/
├── index.html            页面源文件
├── css/app.css           正式界面样式
├── js/
│   ├── icons.js          图标与类别外观
│   ├── data.js           文件夹数据及格式化
│   ├── store.js          VaultStore、请求与工作区
│   ├── app.js            渲染与页面状态
│   ├── forms.js          业务记录表单
│   ├── bridge.js         前端和原件能力模块的适配
│   ├── excel.js          Excel 台账操作
│   └── interactions.js   事件、拖放和对话框
├── ip-v2.js              原件上传与重复文件决策
├── upload-progress.js    文件任务进度与取消
├── export.js             文件夹与 ZIP / ZIP64 导出
├── pdf-preview.js        PDF 预览
├── pdfjs/                离线 PDF.js 运行文件及许可证
├── tools/bundle.cjs      前端打包工具（使用 Node 内置模块）
└── dist/                 构建生成，Git 不跟踪
```

## 构建与部署

打包命令（在仓库根目录执行）：

```powershell
node src/IPSys.Web/wwwroot/tools/bundle.cjs
```

正常在 Visual Studio 中构建 `src/IPSys.Web/IPSys.Web.csproj` 即可。MSBuild 的 `BundleExplorerShell` 目标调用 Node，将 `js/*.js` 依照既定顺序拼成 `dist/app.js`，并复制 `index.html`、`css/app.css` 到 `dist/` 中的对应产物。三个构建产物通过明确的 `EmbeddedResource` 逻辑名称嵌入 EXE；其他 `wwwroot` 能力模块也分别嵌入。运行期不读取磁盘上的 `wwwroot`，因此不会出现两套可切换 UI。

`dist/` 不提交仓库，不直接编辑。修改源码后要重新构建 EXE；缺少 Node 且没有现成构建产物时 MSBuild 会给出错误。Release 仍为需要 .NET 8 Windows Desktop / ASP.NET Core Runtime 的单 EXE。

## 维护约束

1. 修改页面时只维护 `index.html`、`css/app.css` 和 `js/*.js`；不要在 `dist/app.js` 中直接修补。
2. 源文件打包顺序定义在 `tools/bundle.cjs`，必须先创建 `VaultStore` 和适配接口再绑定事件。新增 `js` 模块时同时更新打包清单；`src/IPSys.Web/tests/ui-assets-smoke.cjs` 检查顺序和新鲜度。
3. 页面和能力模块依靠 `Drive`、`VaultStore`、`RecordForms`、`IPSysNativeIp`、`IPSysUploadProgress`、`IPSysExport`、`IPSysPdfViewer` 等全局契约协同。修改接口、DOM 类名、上传状态或导出结构时需同步检查使用方。
4. 服务端固定 CSP（禁止内联脚本，样式依照当前策略），HTML 必须转义不可信名称；跨工作区文件任务必须保持原所属工作区和授权边界。
5. MCP `--mcp` 由同一个 EXE 提供，但不依赖浏览器 UI；不能为了修改前端打破它在读取 EmbeddedWebAssets 之前启动的协议入口。

## 测试

正式回归通过 `.github/workflows/web-windows.yml`：前端资源一致性、Node 业务回归、Debug/Release、单 EXE、MCP、Edge/HTTP、SQLCipher/HTTP。测试方案和原始证据集中在仓库 [tests/](../../../tests/README.md)；具体代码入口位于 `src/IPSys.Web/tests/`。正式需求、业务与技术基线请见仓库根目录 `README.md`、`DESIGN.md` 和 `UI_BASELINE.md`。
