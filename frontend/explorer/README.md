# IPSys Explorer — 新前端壳

零依赖原生 JS。无构建框架，无 npm 依赖，`tools/bundle.cjs` 用 Node 内置模块把 8 个源文件拼成单个 `dist/app.js`。

## 为什么是三个文件

`Program.cs` 只暴露固定路由，页面资源通过 `EmbeddedResource` 编入 `IPSys.Web.dll`，启动时由 `EmbeddedWebAssets.Read()` 读入内存。所以前端必须收敛成：

```
dist/index.html   dist/style.css   dist/app.js
```

## 目录

**源码（唯一真源，只维护这里）**

```
index.html              源页面
css/app.css             源样式
js/icons.js             图标与分类色（Drive.nodeMark 是唯一取图标入口）
js/data.js              树模型与格式化工具
js/store.js             VaultStore：接口调用、目录树、工作区
js/app.js               渲染管线 + 状态机
js/forms.js             记录表单
js/bridge.js            能力层适配：请求对象形状 + 上传/导出编排
js/excel.js             Excel 台账导入导出
js/interactions.js      事件委托、右键、拖拽、对话框、设置面板
tools/bundle.cjs        打包脚本（Node 内置模块，零依赖）
```

**产物（构建时生成，不入库）**

```
dist/index.html   dist/style.css   dist/app.js
```

## 命令

```bash
# 打包：改完 js/ 或 css/ 或 index.html 必须执行
node tools/bundle.cjs
```

`dotnet build` 会自动跑这一步（`IPSys.Web.csproj` 的 `BundleExplorerShell` 目标，在 `BeforeBuild` 前），所以正常开发只要编译就行。

- 装好 Node：每次编译自动重新打包，产物永远跟源码一致。
- 没装 Node 但已有 `dist/`：构建继续，输出警告——**改过源码的话这是旧产物**。
- 没装 Node 且没有 `dist/`：构建直接报错，提示安装 Node。

看效果直接启动 `IPSys.Web.exe`（真实后端 + 真实 CSP）。没有独立的 mock 预览服务——壳与后端在同一个仓库里，多一套 mock 只会让"本地正常、上线坏掉"的差异藏起来。

## 改代码的硬约束

1. **改了源码必须重新编译**。dll 里嵌的是 `dist/`，不是源码。`dotnet build` 会先自动 bundle 再嵌入，但直接双击已有的 exe 看不到任何变化——这是最容易白忙半天的坑。
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

## 本机 MCP 与本壳无关

本机 Agent 走 `IPSys.Web.exe --mcp`：stdio 上的 JSON-RPC → 命名管道 → 宿主自己的本机 HTTP API。整条链没有任何一环经过 `wwwroot/` 或 `frontend/explorer/`，所以**换壳不影响 MCP**。

三条不变量（`ui-assets-smoke.cjs` 的 E 段守着）：

1. `--mcp` 分支必须在任何 `EmbeddedWebAssets.Read(...)` **之前**返回。否则 dist 一旦旧了或坏了，Agent 连不上——把 MCP 的可用性绑在浏览器资源上是不该出现的耦合。
2. 宿主侧 `McpLocal.RunHostAsync(...)` 必须仍被启动，管道才存在。
3. MCP 不许长出浏览器侧脚本。

MCP 自己的回归在 `--smoke` 里（`NativeMcpSmoke` + `NativeMcpArchiveSmoke`：管道 ACL、会话隔离、并发、幂等日志、上传），与本壳的测试互不重叠。

## 换壳时丢掉、现已接回的三项能力

三项都在换壳初期确实缺失过，现在都已按旧壳语义接回。留着这一节是为了说明它们的**契约**，改动前先看这里。

### 大文件流式下载（`interactions.js`）

- 超过 32 MiB 走 File System Access API：`showSaveFilePicker` → `createWritable()` → 按 `ReadableStream` 分块写盘，不再把整个文件塞进内存。
- **拾取器必须排在所有网络请求之前**。它需要点击带来的用户激活，先 `await` 一次网络再调就会被浏览器拒绝，只剩全量进内存一条路。测试里钉死了这条。
- 写入前逐块比对 `node.size`：超了立刻中止，少了判为失败并 `writer.abort()` —— 磁盘上不留半个原件。
- 不足 32 MiB 或浏览器不支持时退回 `res.blob()` + `<a download>`，同样校验 `blob.size`。

### 服务端搜索（`store.js` + `app.js`）

- `VaultStore.search(ws, q)` 打 `GET /api/v2/search/{ws}?q=`，后端按名称、编号、备注、标签、签约方、原件名在整库检索。
- 命中项只带 `kind/id/section`，`VaultStore.resolveHits()` 把它们映射回**已加载的树节点**（`p:` / `c:` / `i:` / `a:section:` / `g:` / `f:linkId:version`）。映射不上的直接丢弃并计数，不拿近似节点顶替。
- 打字停顿 180ms 后发请求；服务端结果到达前用 `Drive.localSearch()` 兜底，列表不会空一下再跳出来。
- `runSearch` 带 serial：关键词一变，在飞的旧请求回来会自动作废。`openFolder` / `navigate` / `enterWorkspace` / `refreshCurrent` 都要 `resetSearch()` —— 树一重建，旧命中就是孤儿节点。
- 结果有截断、有失效命中、或服务端失败退回本地时，列表上方出一行 `search-note` 说明，不静默降级。

### 彻底删除进度（`bridge.js`）

- `POST /api/trash/{ws}/purge-task` 只负责受理并返回 `taskId`，清理在服务端独立执行；浏览器轮询 `GET /api/trash/purge-task`（**Vault 级，不带 workspace**）。
- 面板复用 `.upload-progress` 系列类名，显示「已清理加密原件数据 X / Y」与阶段文案。
- `bytesDone / bytesTotal` 到 100% 也不宣告成功：只有 `state === "succeeded"`（事务已提交）才算删除成功，`failed` / `canceled` 一律按回滚处理。
- 轮询会校验 `taskId` 与 `workspace`，防止把服务端新开的任务当成自己的。
- 单次上限 200 条（后端限制），超了明确提示分批，不让它无声失败。
- `purgeTaskActive` 计入 `fileTaskBusy()`：删除进行中禁止切换工作区。刷新页面或重进回收站时 `resumePurge()` 把任务接回来。

## 合同跟着项目走

合同（`kind="contract"`）**跟着项目走**：合同是所属项目下的一个子节点，合同的原件再挂在合同下，树里就是真实的 `项目 / 合同 / 原件` 三层。

- 数据来源：`GET /api/v2/ui/contracts/{ws}` 返回合同的 `projectId`，`store.js` 的 `buildTree` 据此把合同挂到项目下；合同原件的 `folderId` 本身就是合同 folder id，所以附件照样按 ownerId 挂载，不需要额外映射。
- 新建：站在项目里时，「新建」菜单只剩「新建合同」（顶层分类在项目内都建不了，列出来只会误导）；项目节点右键也有「新建合同」。两者都带当前项目的 id 走 `parentId`，拿不到归属就拒绝建。
- 编辑：详情面板「修改」/ 右键「属性」走 `RecordForms.contract`，字段是合同编号、签订日期、金额、签约方、类别、标签、备注。
- 导出：`EXPORTABLE_KINDS` 含 `contract`，`exportEntryOf` 为合同补 `projectId`/`projectName`，`export.js` 的 `owner()` 用它们还原 `项目/合同/文件` 目录。
- 合同不计入「N 条记录」（`summary()` 与 `recordCount()` 的 `RECORD_KINDS` 都不含它），但它的原件计入附件数与占用。
- 回收站不接合同（`loadRecycle` 过滤 `kind==="contract"`）：合同没有独立入口，恢复出来无处安放。

对应测试 `ui-tree-smoke.cjs`（三层结构、汇总、孤儿防护）与 `export-smoke.cjs` 的合同段落。

旧壳遗留的 7 个测试（`large-download-smoke` / `search-smoke` / `trash-purge-progress-smoke` / `ui-main-smoke` / `ui-component-contract-smoke` / `upload-cross-workspace-smoke` / `preview-smoke`）已随旧壳删除，其中前三项的能力由 `explorer-capabilities-smoke.cjs` 接手续守。

## 测试

```bash
node src/IPSys.Web/tests/upload-progress-smoke.cjs        # 上传进度/取消/阶段
node src/IPSys.Web/tests/upload-unique-autosave-smoke.cjs # 去重与自动保存
node src/IPSys.Web/tests/export-smoke.cjs                 # 目录/ZIP 导出与桥接投影
node src/IPSys.Web/tests/zip64-smoke.cjs                  # ZIP64 大偏移头
node src/IPSys.Web/tests/pdf-canvas-smoke.cjs             # PDF 画布渲染/翻页/缩放
node src/IPSys.Web/tests/ui-tree-smoke.cjs                # 项目/合同/附件三层与汇总
node src/IPSys.Web/tests/ui-assets-smoke.cjs              # 壳资产契约（见下）
node src/IPSys.Web/tests/explorer-capabilities-smoke.cjs  # 流式下载 / 服务端搜索 / 删除进度
```

`ui-assets-smoke.cjs` 是换壳后新增的门，守五件事：页面加载顺序与 csproj 嵌入路径、`bridge.js` 是否补齐了能力层依赖的自由变量（`notice` / `api` / `uploadFile` / `uploadProgress`，这两处都真实炸过）、`dist/` 是否等于一次全新打包、若干与壳无关的产品不变量（无内联 `onclick`、无外部请求、无 `/api/exit`、名称转义、工作区切换拦文件任务）、以及 MCP 独立性（`--mcp` 必须早于任何内嵌资源读取返回）。

`explorer-capabilities-smoke.cjs` 守三项接回的能力：搜索命中映射（6 种 kind 全走真节点，失效命中丢弃、重复折叠）、拾取器必须排在任何网络请求之前、流式写入要有中止与字节校验、`purgeTaskActive` 必须计入 `fileTaskBusy()`、同步 purge 路由不许再被调用。
