# IPSys Explorer — 新前端壳

零依赖原生 JS。无构建框架，无 npm 依赖，`tools/bundle.cjs` 用 Node 内置模块把 6 个源文件拼成单个 `dist/app.js`。

## 为什么是三个文件

`Program.cs` 只暴露固定路由，页面资源通过 `EmbeddedResource` 编入 `IPSys.Web.dll`，启动时由 `EmbeddedWebAssets.Read()` 读入内存。所以前端必须收敛成：

```
dist/index.html   dist/style.css   dist/app.js
```

## 目录

```
index.html              源页面
css/app.css             源样式
js/icons.js             图标与分类色（Drive.nodeMark 是唯一取图标入口）
js/data.js              数据层（mock，换后端只改这里）
js/store.js             VaultStore：接口调用、目录树、工作区
js/app.js               渲染管线 + 状态机
js/forms.js             表单
js/interactions.js      事件委托、右键、拖拽、对话框、设置面板
tools/bundle.cjs        打包脚本（Node 内置模块，零依赖）
preview/server.cjs      本地预览服务（mock 后端，端口 8776）
preview/capture.cjs     截图脚本（CDP，端口 9223）
dist/                   产物，必须提交
```

## 命令

```bash
# 打包（改完 js/css/index.html 必须执行）
node tools/bundle.cjs

# 本地预览（mock 后端，不发 CSP）
PORT=8776 node preview/server.cjs
```

## 改代码的硬约束

1. **改完必须 bundle**。dll 里嵌的是 `dist/`，不是源码。改了 `js/*.js` 不 bundle，页面毫无变化——这是最容易白忙半天的坑。
2. **类名不许改**。`wwwroot/` 下的能力层脚本（`ip-v2.js` / `upload-progress.js` / `export.js` / `pdf-preview.js`）会自建 DOM 并按类名找节点。改 `.pdf-*`、`.export-status`、`.upload-progress*` 会让它们找不到自己。
3. **顶层对象带前缀**。`Drive` / `VaultStore` / `RecordForms`，不要用 `App` / `Store` 这类通用名——浏览器扩展会注入同名全局，踩过一次，表现为永远加载不完。
4. **新增内联样式要先确认 CSP**。`Program.cs` 的 `style-src` 若不含 `'unsafe-inline'`，`style="..."` 会被静默丢弃；预览服务不发 CSP，本地看不出来。
5. **SVG 的 `id` 当全局唯一处理**。渐变/裁剪定义在同名 id 冲突时会静默不绘制（品牌标志踩过）。

## 与 `wwwroot/` 的分工

| 位置 | 角色 |
|---|---|
| `frontend/explorer/` | 壳：页面结构、样式、渲染、交互 |
| `src/IPSys.Web/wwwroot/` | 能力层：PDF 预览、ZIP 导出、上传去重与多阶段进度 |

能力层不是"旧代码遗留"，它们承载新壳没有的能力，且自建 DOM、不依赖壳的元素 id。新壳通过全局对象调用它们。
