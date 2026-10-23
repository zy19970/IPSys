# DEFECTS — 本轮确认的产品缺陷与实现缺口

- 运行：`20261022-185856-49ecf63`
- 被测 SHA：`49ecf63`（`work/onedrive-file-manager`）
- 每条都带可复跑的动态证据；纯代码归因只作为**补充**，不作为唯一依据。

---

## 缺陷总表

| 编号 | 级别 | 标题 | 关联用例 | 组件 | 复现率 |
|---|---|---|---|---|---|
| BUG-001 | P0 | 多级档案目录不进树，其记录被提升到分类根 | T-P0-01 | `frontend/explorer/js/store.js` buildArchiveDirs | 3/3 |
| BUG-002 | P0 | 同一 linkId 的多版本各占一行 | T-P0-02 | `/api/v2/ui/ip` 返回 + `store.js` 节点 id | 3/3 |
| BUG-003 | P0 | 同 linkId 两行一起删：重复请求 + 界面不刷新 | T-P0-03 / T-P2-05 | `interactions.js` deleteNodes | 2/2 |
| BUG-010 | P1 | 持久 position 在界面上完全不生效 | T-P1-05 / R-04 | `store.js:514` + `app.js:415` | 2/2 |
| BUG-013 | P2 | F2 / 右键「重命名」只弹提示，不改名 | T-P2-01 | `interactions.js:1060,1280` | 3/3 |
| BUG-015 | P2 | 「添加快捷访问」是对不存在动作的假成功按钮 | T-P2-03 | `interactions.js:700` | 3/3 |
| BUG-016 | P2 | 首页「导入资料」直接对着虚拟根开文件选择器 | T-P2-04 | `interactions.js` pickFiles | 2/2 |
| BUG-018 | P1 | PDF 预览永不渲染，卡在「正在解析 PDF…」 | T-P2-09 | `interactions.js:1633` | 3/3 |
| BUG-019 | P1 | 单个业务接口 500 被静默渲染成「没有资料」 | X-01 / T-P1-06 | `store.js:140-144` | 2/2 |
| BUG-020 | P2 | 一键清空整批失败，只回一句「数据库已回滚」 | R-01 | 服务端 purge-task + 前端 toast | 2/2 |
| BUG-023 | P2 | 回收站 >200 条时「一键清空」整批拒绝 | X-03 | `bridge.js:436` | 2/2 |
| DOC_GAP-001 | — | 需求文档仍写「一键清空不可用」 | R-07 | `REQUIREMENTS.md` | 1/1 |

---

## BUG-001（P0）多级档案目录不进树

**现象**
后端层级完整，前端树里二三级目录整棵不存在，且它们的记录被提升到分类根。

**动态证据**
1. 后端 `GET /api/v2/ui/archive/company` 返回的 `folders` 里同时有
   `{id:8, parentId:1, name:"二级-A"}` 与 `{id:9, parentId:8, name:"三级-A1"}`。
2. `GET .../entries?section=achievement&parentId=1` → 5 条（含 8）；`parentId=8` → 1 条（含 9）；`parentId=9` → 1 条（含 10）。
3. 用这份真实 payload 跑 `VaultStore.buildTree()`：`af:8` **不在树**，`af:9` **不在树**；
   `档案-01` 的路径是 `["我的文件","业务档案","档案-01"]` —— 直接跳过了 二级-A 与 三级-A1。
4. 浏览器逐层点击：系统目录内看不到「二级-A」，三级不可达。

**归因**
```js
// frontend/explorer/js/store.js:492-493
const dirs = (archive?.folders || [])
  .filter((f) => f.parentId === null || f.parentId === undefined)   // ← 只取顶层
```
子级目录被过滤掉；随后 `store.js:507-511` 找不到目录的记录落进 `loose`，被 `return [...dirs, ...loose]` 抬到分类根。

**影响**
多级归档无法使用；导出路径、移动目标、递归统计都建立在这棵树上，一起失真。

**证据**
`evidence/cases/T-P0-01.json`、`evidence/tree-built.json`、`evidence/shots/T-P0-01-*`

---

## BUG-002（P0）同一 linkId 多版本各占一行

**现象**
一个附件上传了两版，列表里出现两行同名文件。

**动态证据**
- HTTP：`GET /api/v2/ui/ip/company` 对 `fileId=3` 返回 **4 行**
  （`link3 v2 37B`、`link3 v1 22B`、`link4 v2 37B`、`link4 v1 22B`），
  逻辑上只有 2 个附件。
- 浏览器：IP-A 记录内实际渲染 `f:3:2` 与 `f:3:1` 两行。

**归因**
`/api/v2/ui/ip` 按版本出行；前端 `store.js:281` 用 `f:${linkId}:${version}` 作节点 id，一版本一节点。
两层叠加使"一个 link 一行"无法成立。

**影响**
删除、计数、占用统计都会翻倍（见 BUG-003、R-05）。

**证据**
`evidence/T-P0-02-http.txt`、`evidence/cases/T-P0-02-ui.browser.json`、`evidence/shots/T-P0-02-ip-affix.png`

---

## BUG-003（P0）同 linkId 两行一起删：重复请求 + 界面不刷新

**动态证据（浏览器，抓 Network 域）**
- IP-A 内选中 `f:3:2` 与 `f:3:1`（同一 linkId 的两个版本），共 2 行。
- 右键「删除」→ 二次确认 → **发出 2 条 `DELETE .../links/3`**。
- 服务端：该 fileId 存活 link = **0**。
- 界面：删除后仍渲染 **2 行**。

**归因**
`interactions.js` 的 `deleteNodes` 把整批 DELETE 放在同一个 `try` 内，
第二条 409「关联已解除。」即抛错，循环中断，且 `catch` 里没有 `refreshCurrent()`。

**影响**
用户看到"删了没反应"，服务端其实已经删掉；再点一次会得到 409，形成死循环式误判。

**证据**
`evidence/cases/T-P0-03.browser2.json`、`evidence/shots/T-P0-03-after-delete.png`

---

## BUG-010（P1）持久 position 在界面上完全不生效

**动态证据（纯函数 + 真实 payload）**
后端 `entries` 的 position 顺序是
`["folder:二级-A","record:档案-02","record:档案-03","record:档案-04","folder:临时目录-01"]`（目录与记录混排）。
树里同一层只剩 `["folder:档案-02","folder:档案-03","folder:档案-04"]`，且顺序按拼音。

**归因（两处叠加）**
1. `store.js:514` `d.children.sort((a, b) => cmpName(a, b));` —— 只按拼音，丢掉 position。
2. `app.js:415` `if (a.type !== b.type) return a.type === "folder" ? -1 : 1;` —— 无条件把 folder 排到 file 之前，
   即使 position 是"资料→目录→资料"也永远显示成"目录→资料→资料"。

**影响**
服务端排序接口（`entries/reorder`）实测完全正常，但用户在界面上看不到任何效果。

**证据**
`evidence/cases/X-02-tree.json`、`evidence/T-P1-05-http.txt`（服务端侧 PASS）

---

## BUG-013（P2）F2 / 右键「重命名」只弹提示

**动态证据**
| 入口 | 结果 |
|---|---|
| F2 | toast「重命名请点「修改」或右键「属性」」，无表单 |
| 右键「重命名 \n F2」 | 同一个 toast，无表单 |
| 详情面板「修改」 | **打开表单**（`hasForm=true`） |

**归因**
```js
// interactions.js:1047  菜单项带 F2 快捷键提示
isFolder && b.kind !== "archive_folder" ? MI("rename", "rename", "重命名", "F2") : "",
// interactions.js:1060  行为只有一句 toast
rename: () => toast("重命名请点「修改」或右键「属性」"),
// interactions.js:1280  F2 分支同样只 toast
```

**说明**
项目 2026-10-21 曾把"F2 与右键重命名提示指向修改"当作口径，但入口名仍是「重命名」并挂着 `F2` 快捷键，
属于**入口文案与实际行为不符**。修法二选一：菜单项改名「修改属性」/ 真正打开表单。

**证据**
`evidence/cases/T-P2-01.browser.json`、`evidence/shots/T-P2-01-ctx.png`

---

## BUG-015（P2）「添加快捷访问」是假成功按钮

**动态证据**
- `#btnPinFolder` 存在且可见，`title="添加快捷访问"`。
- 点击 → 只产生 toast「「快捷访问」已按资料分类自动生成」。
- `localStorage` 点击前后都是 `[]`；没有任何服务端请求。

**归因**
```js
// interactions.js:700
$("#btnPinFolder").addEventListener("click", () => toast("「快捷访问」已按资料分类自动生成"));
```

**说明**
产品实际口径是"快捷访问由 6 个固定分类自动生成、不支持用户添加"（`app.js:570` 注释）。
那么就不该出现一个写着"添加"的按钮。**最小修法是删掉这个按钮**。

**证据**
`evidence/cases/T-P2-03.browser.json`、`evidence/shots/T-P2-03-pin.png`

---

## BUG-016（P2）首页「导入资料」直接对着虚拟根开选择器

**动态证据**
在首页（`view=home`、`folderId=root`）点 `[data-page-act="upload"]`：
桩记录到 `{folderId:"root", view:"home", type:"file"}` —— **文件选择器在虚拟根上直接打开了**。

**归因**
`interactions.js` 的 `pickFiles()` 只挡两种节点：
```js
if (!node || node.type !== "folder") return toast("请先进入一条记录,再上传附件");
if (nodeTag(node.id) === "k" || node.biz?.kind === "archive_folder") return toast(...);
```
`root` 的 `type` 是 `folder`、`nodeTag` 是 `root`，两道检查都放过。

**影响**
用户能从首页把文件传到没有业务归属的位置，之后这些文件在任何台账里都看不到。

**证据**
`evidence/cases/T-P2-04.browser.json`、`evidence/shots/T-P2-04-home-import.png`

---

## BUG-018（P1）PDF 预览永不渲染

**动态证据**
打开 `项目A/两页示例.pdf`（`f:14:1`，后端 793B 合法两页 PDF）后持续观测 8 秒：
```json
{ "status": "正在解析 PDF…", "count": "加载中", "canvasW": 300, "canvasH": 150 }
```
`300×150` 是 `<canvas>` 的 HTML 默认尺寸，说明 `render()` 一次都没跑；页码永远到不了 `1 / 2`，第二页更无从翻。

**归因**
```js
// src/IPSys.Web/wwwroot/pdf-preview.js:95
return {open,destroy};        // create() 只搭壳，把状态写成「正在解析 PDF…」，getDocument 在 open() 里
```
```js
// frontend/explorer/js/interactions.js:1633
pdfViewer = viewer.create(body, buffer);   // ← 之后没有任何 .open()
```

**旁证（为什么冒烟测试没抓到）**
`src/IPSys.Web/tests/pdf-canvas-smoke.cjs` 全程是对源码做字符串/正则断言
（`assert.ok(app.includes('pdfViewer?.destroy?.()'))` 之类），不做任何真实渲染。

**与 V2 的关系**
V2 手工轮把 `T-P2-09` 判过 **PASS**，属**误报**：当时证据里已经写着 `pages:0`、状态是「正在解析 PDF…」，判据却只数了 `<canvas>` 元素个数。
V2 的 CI 轮（`446f9a6`）已撤销该 PASS 并登记 BUG-018；**本轮沿用该编号独立复现**，未改号、未重开新号。

**真 HEAD 复验**
`evidence/recheck-446f9a6/pdf-recheck.json`：在 `446f9a6` 上重跑同一判据，canvas 仍 `300×150`、状态仍「正在解析 PDF…」、`rendered1=false`，
`toDataURL` 像素样本与首轮逐字节一致。

**证据**
`evidence/cases/T-P2-09.browser.json`、`evidence/shots/T-P2-09-pdf-page1.png`、`evidence/fixture-two-page.pdf`

---

## BUG-019（P1）单接口 500 被静默渲染成「没有资料」

**动态证据**
用 CDP `Fetch` 域把 `/api/v2/ui/archive/company` 全覆盖成 500，然后整页重载：
- 首页仍正常渲染 6 张分类卡片；
- 页面里**没有**任何"加载失败/错误/无法加载"字样（`bodyHasError=false`）；
- `VaultStore.error` 为 `null`。

**归因**
```js
// frontend/explorer/js/store.js:139-145
const [projects, contracts, archive, ip, projectFiles] = await Promise.all([
  this.getJson(`/api/v2/ui/projects/${w}`).catch(() => []),
  this.getJson(`/api/v2/ui/contracts/${w}`).catch(() => []),
  this.getJson(`/api/v2/ui/archive/${w}`).catch(() => ({})),   // ← 失败变成空对象
  ...
]);
```
`loadAll()` 永远不抛错，`VaultStore.error` 永远是 `null`，`enterWorkspace` 里的 `loadError` 分支是死代码。

**影响**
"业务档案空了"和"业务档案接口挂了"在界面上完全一样。这是数据可信度问题，不只是文案问题。

**证据**
`evidence/cases/X-01.browser.json`、`evidence/shots/X-01-archive-500.png`

---

## BUG-020（P2）一键清空整批失败，只回一句「数据库已回滚」

**动态证据**
回收站 8 条（混合 `project` / `v2_archive` / `contract` / `v2_ip_file` / `v2_file`），
`POST /api/trash/company/purge-task` 提交全部 8 条 → `202` 受理 →
终态：
```json
{ "state": "failed", "stage": "永久删除失败，数据库已回滚",
  "error": "记录仍有关联目录或文件历史，禁止永久删除。" }
```
回收站仍是 8 条，一条没删。

**对照**
同一个接口单独提交一条 `v2_ip_file`（6MiB）→ `succeeded`，`bytesDone=6291456`。
说明不是接口坏了，是**混合批次里只要有一条带文件历史，整批回滚**。

**影响**
"一键清空"在最常见的场景下（回收站里有被删过的记录）完全不可用，且错误信息不指明是哪一条。

**证据**
`evidence/cases/R-01.http2b.json`、`evidence/fixture-fix.log`

---

## BUG-023（P2）回收站 >200 条时「一键清空」整批拒绝

**动态证据**
造 201 条综合资料并全部删除 → 回收站 209 条 → 一次性提交：
`400 {"error":"请选择 1 至 200 条不重复的回收站记录。"}`

**归因**
```js
// frontend/explorer/js/bridge.js:436-441
if (items.length > 200) {
  return toast(`一次最多彻底删除 200 条,当前选中 ${items.length} 条,请分批操作`, {...});
}
// interactions.js:1409  emptyRecycle() 把整个 RECYCLE 传下来 → 必然触发上面这条
```
前端在发请求前就整批拒绝，服务端也是硬上限。

**说明**
任务书 X-03 要求"Agent 只报告差异，不擅自重设计"：
是自动分批还是显式提示，由用户决定。这里只记录"一键清空在 >200 时不可用"这个事实。

**证据**
`evidence/cases/X-03.http2b.json`

---

## DOC_GAP-001 需求文档仍写「一键清空不可用」

`REQUIREMENTS.md` 仍有 2 处旧口径。用户 2026-10-22 已明确允许该按钮，
所以这是**文档缺口**，按钮存在不判缺陷。

**证据**
`evidence/cases/R-07.http3.json`

---

## 实现缺口（IMPLEMENTATION_GAP，非崩溃）

| 编号 | 标题 | 后端能力证据 | 前端缺口 | 关联用例 |
|---|---|---|---|---|
| GAP-001 | 登录页没有创建资料库入口 | `POST /api/open {create:true}` → 200 + token（本轮实测） | 登录层只有 1 个「打开」按钮；`interactions.js:276` 把 create 写死 `false` | T-P1-01 |
| GAP-006 | 没有复制 / 移动 / 跨工作区转移入口 | `POST /files/{ws}/{fileId}/associate{move:true}` 与 `/folders/{ws}/{kind}/{id}/move` 均可用 | 右键菜单与工具栏都搜不到复制/移动项 | T-P1-03 |
| GAP-014 | 拖放不接线，且提示信息与事实相反 | 同上，associate 实测 200 | `dragstart` 负载正常，drop 后无任何 associate 请求；toast 反而说"需要后端支持 link 迁移" | T-P2-02 |

## 测试器缺陷

见 `TEST-DEFECTS.md`（10 条，均已修正并重跑；它们不是产品问题）。
