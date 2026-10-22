# ADJUDICATION — 与上轮的差异、撤销的误报、维持的结论

- 本轮：`20261022-185856-49ecf63`，被测 SHA `49ecf63`
- 上轮：`docs/retest-v2-2026-10-22/`，被测基线 `02289ea`
- **两条基线之间产品源码无差异**：`49ecf63` 相对 `02289ea` 只增加了上轮的测试资产提交。因此任何状态变化都来自**判据变化或新证据**，不是代码变化。

---

## 一、逐条对比

| ID | 上轮状态 | 本轮状态 | 是否变更 | 原因 | 证据 | 是否需修复 |
|---|---|---|---|---|---|---|
| T-P0-01 | CONFIRMED_BUG (BUG-001) | CONFIRMED_BUG (BUG-001) | 维持 | 本轮把根因从"疑似后端"锁定到**前端 buildTree 只取 parentId==null**；后端层级经证明完全正确 | `T-P0-01.json`、`tree-built.json` | 是（store.js） |
| T-P0-02 | CONFIRMED_BUG (BUG-002) | CONFIRMED_BUG (BUG-002) | 维持 | HTTP 与 UI 双侧复现；接口对 fileId=3 返回 4 行 | `T-P0-02-http.txt`、`T-P0-02-ui.browser.json` | 是 |
| T-P0-03 | CONFIRMED_BUG (BUG-003) | CONFIRMED_BUG (BUG-003) | 维持 | 本轮抓到硬证据：**2 条 DELETE、服务端 0 条、界面仍 2 行** | `T-P0-03.browser2.json` | 是（deleteNodes） |
| T-P0-04 | BLOCKED | **PASS** | **关闭** | 用真实 compact 任务造出活动窗口，lock 返回 409 且 `/api/status` 仍 unlocked | `T-P0-04-http.txt` | 否 |
| T-P0-05 | IMPLEMENTATION_GAP | **PASS** | **改判** | 上轮只做了 HTTP；本轮验证 IP UI payload 带 linkId，且两个 linkId 各自下载 200、sha 一致 | `T-P0-05-http.txt` | 否 |
| T-P1-01 | IMPLEMENTATION_GAP | IMPLEMENTATION_GAP (GAP-001) | 维持 | 复核 `interactions.js:276` 仍写死 `false`，登录层只有「打开」；后端 create:true 本轮实测 200 | `T-P1-01.http5.json` | 是（加入口） |
| T-P1-02 | BLOCKED | **PASS** | **关闭** | 单删合同 → 回收站 kind=contract parent=项目A → 恢复后 projectId=15 | `T-P1-02-http.txt` | 否 |
| T-P1-03 | IMPLEMENTATION_GAP | IMPLEMENTATION_GAP (GAP-006) | 维持 | 右键菜单与工具栏均无复制/移动项 | `T-P1-03.browser2.json` | 是 |
| T-P1-04 | IMPLEMENTATION_GAP | **PASS** | **改判** | 后端 4 条保护规则全部生效（系统目录 409、非空 409、成环 409、删后 404），前端也有右键入口 | `T-P1-04-http.txt` | 否 |
| T-P1-05 | IMPLEMENTATION_GAP | CONFIRMED_BUG (BUG-010) | **加重** | 服务端 reorder **完全正常**（逆序提交后完全逆序、非全量 409），但界面看不到任何效果 | `T-P1-05-http.txt` + `X-02-tree.json` | 是（前端） |
| T-P1-06 | BLOCKED | **CONFIRMED_BUG (BUG-019)** | **关闭为缺陷** | CDP 注入 archive 500 成功、页面继续渲染，但**没有任何失败提示**——本用例判据就是"失败模块要显式提示"，不成立 | `X-01.browser.json` | 是 |
| T-P1-07 | BLOCKED | **PASS** | **关闭** | 先 purge 6MiB 造出 reusable=8192，再压缩到 0；任务期 lock 409 | `T-P1-07.http2b.json` | 否 |
| T-P1-08 | BLOCKED | BLOCKED | 维持 | 打包秒级完成，抓不到"进行中"窗口 | `T-P1-08.browser2.json` | 待复跑 |
| T-P1-09 | BLOCKED | **PASS** | **关闭** | 受限 PATH 下 bundle 仍 exit=0；dist 不入库、构建时重生成 | `http2-run.log` | 否 |
| T-P1-10 | BLOCKED | **PASS** | **关闭** | A：该 linkId 最高版本=2 且 UI 可见；B：associate 后出现 2 个 linkId | `T-P1-10-http.txt` | 否 |
| T-P2-01 | CONFIRMED_BUG (BUG-013) | CONFIRMED_BUG (BUG-013) | 维持 | 三条入口分测：F2 与右键只 toast、详情「修改」能开表单 | `T-P2-01.browser.json` | 是（改文案或接线） |
| T-P2-02 | CONFIRMED_BUG (BUG-014) | **IMPLEMENTATION_GAP (GAP-014)** | **降级** | 后端 associate 本轮再次实测可用，前端无接线且提示称"需要后端支持"属误导 | `T-P2-02.browser2.json` | 是 |
| T-P2-03 | CONFIRMED_BUG (BUG-015) | CONFIRMED_BUG (BUG-015) | 维持 | 入口是 `#btnPinFolder`（不是右键菜单），点击只 toast、零持久化 | `T-P2-03.browser.json` | 是（建议删按钮） |
| T-P2-04 | CONFIRMED_BUG (BUG-016) | CONFIRMED_BUG (BUG-016) | 维持 | 桩拿到 `{folderId:"root", view:"home"}`，确认对虚拟根开选择器 | `T-P2-04.browser.json` | 是 |
| T-P2-05 | BLOCKED | **PASS** | **关闭** | 3 个不同 linkId，第 2 条 409、第 1/3 条 200、最终 0 条 | `T-P2-05.http3.json` | 否（后端） |
| T-P2-06 | PASS | PASS | 维持 | Ctrl+A 选中数=行数、Esc 清空、Alt+Left 返回 | `T-P2-06.browser.json` | 否 |
| T-P2-07 | PASS | PASS | 维持 | 服务端搜索有命中、搜索框存在并渲染 | `T-P2-07.browser.json` | 否 |
| T-P2-08 | BLOCKED | BLOCKED | 维持 | 未构造三份 XLSX 并注入文件选择器 | `BLOCKED.md` | 待复跑 |
| T-P2-09 | **PASS** | **CONFIRMED_BUG (BUG-018)** | **维持 V2 改判** | 见下文第二节 | `T-P2-09.browser.json` | 是 |
| T-P2-10 | BLOCKED | **PASS** | **关闭** | 0B/15B/31MiB/33MiB 全 200，lenMatch+shaMatch | `T-P2-10.http4.json` | 否 |
| T-P2-11 | PASS | PASS | 维持 | 三种分辨率 hOverflow 全 false | `T-P2-11.browser.json` | 否 |
| T-P2-12 | PASS | PASS | 维持 | evil Host/localhost/evil Origin 全 403，无 token 401 | `T-P2-12-http.txt` | 否 |
| T-P2-13 | BLOCKED | **PASS** | **关闭** | 单文件 5.18MB，10 个内嵌资源全 200，`/app.js` 与 dist 同字节 195284，无外部 URL | `T-P2-13.txt` | 否 |
| T-P2-14 | BLOCKED | BLOCKED | 维持 | 无法在 headless 下真实喂文件 | `BLOCKED.md` | 待复跑 |
| T-P2-15 | BLOCKED | **PASS** | **关闭** | 空库 projects/contracts/trash 全 0，系统目录仍 7 个 | `T-P2-15.http2b.json` | 否 |
| R-01 | BLOCKED | **CONFIRMED_BUG (BUG-020)** | **关闭为缺陷** | 混合批次整批回滚，错误不指明条目 | `R-01.http2b.json` | 是 |
| R-02 | IMPLEMENTATION_GAP | **PASS** | **改判** | Mode=all/filtered 都能导出合法 xlsx 且内容不同 | `R-02.http4.json` | 否 |
| R-03 | PASS | PASS | 维持 | 公司 38B / 个人 52B，sha 不同；跨空间走 personal 接口 404 | `R-03.http5.json` | 否 |
| R-04 | BLOCKED | **CONFIRMED_BUG (BUG-010)** | **关闭为缺陷** | 后端 order 是"记录,记录,记录,目录,目录"，树内只剩记录且按拼音 | `X-02-tree.json` | 是 |
| R-05 | PASS | PASS | 维持 | 四种口径可分别测量；指出了"接口行数当附件数会翻倍"这一下游风险 | `R-05.http3.json` | 否 |
| R-06 | BLOCKED | BLOCKED | 维持 | 4 种任务只关了 compact/purge 两格 | `BLOCKED.md` | 待复跑 |
| R-07 | DOC_GAP | DOC_GAP (DOC_GAP-001) | 维持 | `REQUIREMENTS.md` 仍有 2 处旧口径 | `R-07.http3.json` | 是（改文档） |
| R-08 | PASS（V2 裁决后；手工轮曾记 BUG-017） | PASS | 维持 | 见下文第三节 | `T-P0-01.json` | 否 |

**统计变化**：上轮 PASS 7 / BUG 8 / GAP 6 / DOC 1 / BLOCKED 16
→ 本轮 PASS 19 / CONFIRMED_BUG 11 / GAP 3 / DOC 1 / BLOCKED 4（按主用例 ID 去重，合计 38）。

---

## 二、维持 V2 对 T-P2-09 的改判：PASS → CONFIRMED_BUG / BUG-018

> **定位说明**：V2 的 CI 轮已在 `446f9a6` 把这条改判（"旧 PASS 无效；本轮确认 BUG-018"）。本节是**独立复现**，
> 不是本轮首次发现。初稿写成"撤销上轮误报"，源于未 fetch、只看到改判前的文档（见 `TEST-DEFECTS.md` TD-14）。

**改判前的原始证据**（`docs/retest-v2-2026-10-22/evidence/T-P2-09.txt`）：
```
预览状态：{"overlay":true,"canvases":1,"pages":0,
          "text":"上一页\n加载中\n下一页\n−\n＋\n适应宽度\n正在解析 PDF…"}
```

`pages: 0`、状态「正在解析 PDF…」、页码「加载中」——**一页都没渲染**。
但上轮的判据只写了"预览画布数=1，容器=true"，于是判成 PASS。

**本轮怎么证伪**
在真实页面打开 `f:14:1`（后端 793B 合法两页 PDF），持续观测 8 秒：
```json
{"status":"正在解析 PDF…","count":"加载中","canvasW":300,"canvasH":150}
```
`300×150` 是 `<canvas>` 未设置宽高时的 HTML 默认值，说明 `render()` 从未执行。

**根因（静态可确认）**
- `src/IPSys.Web/wwwroot/pdf-preview.js:95` → `return {open,destroy};`
  `create()` 只搭 DOM 外壳并把状态写成「正在解析 PDF…」，`getDocument` 在 `open()` 里。
- `frontend/explorer/js/interactions.js:1633` → `pdfViewer = viewer.create(body, buffer);`
  之后**再无任何 `.open()` 调用**。

**新判据**
页码必须变成 `1 / 2` 与 `2 / 2`、状态文案必须为空、两页 `toDataURL` 指纹必须不同。
三项缺一不可。

**结论**：维持 `CONFIRMED_BUG / BUG-018`。
**真 HEAD 复验**：在 `446f9a6` 重跑同一判据（`evidence/recheck-446f9a6/pdf-recheck.json`），
canvas 仍为 `300×150`、状态仍为「正在解析 PDF…」、`rendered1=false`，像素样本与首轮逐字节一致。

---

## 三、BUG-017（R-08）：维持 V2 的撤销结论

> **定位说明**：V2 已在 `446f9a6` 撤销 BUG-017（其裁决定稿 `evidence/RESULT-ADJUDICATION.md`）。本节不是"本轮首次撤销"，
> 而是**独立复核该论据，确认应当维持撤销**。初稿把它写成"撤销上轮误报"，是因为本地未 fetch、只看到 `446f9a6` 之前的文档（见 `TEST-DEFECTS.md` TD-14）。

**原指控**：`ui-tree-smoke.cjs:62-63` 的 `assert.deepEqual(ids, ['f:2:1','f:3:2'])` 把"一个版本一行"固化成预期。

**本轮核对该测试自己的 fixture**（`src/IPSys.Web/tests/ui-tree-smoke.cjs:40-45`）：
```js
{linkId:2, fileId:201, version:1, folderId:11, kind:'contract', name:'合同正文.pdf', size:200},
{linkId:3, fileId:202, version:2, folderId:11, kind:'contract', name:'扫描件.pdf', size:50},
```

- **linkId 2 ≠ linkId 3**
- **fileId 201 ≠ fileId 202**
- 是两份**不同文件**，其中一份还有第二版

而节点 id 形如 `f:<linkId>:<version>`，所以 `['f:2:1','f:3:2']` 断言"合同下挂两条附件"**本身就是正确预期**。

**结论**：维持 BUG-017 撤销，`R-08` 维持 PASS。
**同源副作用**：V2 手工轮的 `evidence/R-08.txt` 引用断言原文写成 `...must appear as its own node`，
源码第 63 行实际是 `...hangs off the contract` —— 引文不准，已记入 `TEST-DEFECTS.md` TD-02。

**与 BUG-002 的关系**：`ui-tree-smoke` 覆盖的是**树结构**，不是**同 linkId 多版本折叠**。
所以它通过不能证明 BUG-002 已修；这一点 V2 裁决与本轮一致。

---

## 四、本轮新增的编号（不要写成"上轮已确认"）

| 编号 | 说明 |
|---|---|
| BUG-018 | **编号沿用 V2**（其裁决已登记 BUG-018）。本轮独立复现并补了像素级证据，不重开新号 |
| BUG-019 | 本轮新登记（X-01 探索转正） |
| BUG-020 | 本轮由 R-01 关闭为缺陷 |
| BUG-023 | 本轮新登记（X-03 探索转正） |
| GAP-014 | 由上轮 BUG-014 降级 —— 后端能力齐全，前端未接线 |

## 五、维持不变的关键口径

1. **localhost 返回 403 不是缺陷** —— Host 钉死是设计。本机必须用 `127.0.0.1`。
2. **一键清空按钮存在不是缺陷** —— 用户 2026-10-22 已授权。缺陷在执行语义（BUG-020/BUG-023）。
3. **冒烟全绿不代表界面可用** —— 本轮 PDF 就是活反例：8 个 Node 冒烟全绿，PDF 一页都渲染不出来。
4. **合同必须归属有效项目** —— 本轮实测：无 projectId 建合同返回 `400 创建合同必须指定所属项目`。
