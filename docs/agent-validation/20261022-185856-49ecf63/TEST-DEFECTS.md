# TEST-DEFECTS — 测试器自身的问题与修正

**原则**：脚本或 fixture 出错，先记这里；修好重跑，**绝不**因为脚本报错就登记产品 BUG，也绝不调松判据让测试变绿。

本轮共 **15 条**测试器缺陷，全部已修正并重跑；下面每条都写清"错在哪、怎么发现的、怎么改的"，因为其中有 3 条差点造成误报。
第 14、15 条性质不同：TD-14 不让断言变红，而是让**全部结论的前提**整体偏移（开工没 fetch，把落后 9 个提交的本地当成了最新 HEAD）；
TD-15 让**统计口径**与明细表对不上（CSV 列错位）。两条都不产生失败用例，但都会让报告"看起来正常"。

---

## 一、会直接造成误判的 5 条（最重要）

### TD-01 上轮 T-P2-09 判据过弱 → 误报 PASS

- **错在哪**：判据是"`<canvas>` 元素个数 ≥ 1"。而 `pdf-preview.js` 的 `create()` 会**无条件**插入一个空 canvas。
- **后果**：上轮把"零页渲染"记成了 PASS（证据文件里明明写着 `pages:0`）。
- **修正**：本轮改为读三个可证伪的量——页码文本是否 `N / M`、状态文案是否为空、`canvas.width/height` 是否不是默认 300×150，并额外比对两页的 `toDataURL` 指纹。
- **影响**：直接产生了 BUG-018，并撤销了上轮 PASS。

### TD-02 上轮 BUG-017 建立在误读 fixture 之上 → 误报缺陷

- **错在哪**：`ui-tree-smoke.cjs:62-63` 断言 `['f:2:1','f:3:2']`，我上轮判定"这把一个版本一行固化成预期"。
- **实际**：该测试自己的 fixture（`ui-tree-smoke.cjs:40-45`）是
  `{linkId:2,fileId:201}` 与 `{linkId:3,fileId:202}` —— **两个不同 linkId、两个不同 fileId**，
  节点 id 是 `f:<linkId>:<version>`，所以"两条附件"本来就是正确预期。
- **修正**：撤销 BUG-017，`R-08` 改判 PASS。
- **附带**：上轮 `evidence/R-08.txt` 引用的断言原文是 `...must appear as its own node`，
  而源码第 63 行实际是 `...hangs off the contract` —— 引文不准，一并记录。

### TD-03 `L.put` 未定义 → T-P1-04 变 TEST_ERROR

- **错在哪**：`lib.cjs` 只导出了 `get/post/del`，我在 T-P1-04 里写了 `L.put(...)`。
- **表象**：`TypeError: L.put is not a function`，用例整条变 TEST_ERROR，但前面的"删系统目录 409 / 删非空 409"已经跑过。
- **修正**：给 `lib.cjs` 补 `put` 并加入 `module.exports`。
- **次生事故**：同一次失败里 `tmpId` 是 `undefined`，导致 `move` 的 body 变成 `{ParentId: undefined}` → 序列化成 `null`，
  把 **二级-A 移到了顶层**。这是**测试污染数据**，不是产品行为。已用一次显式 move 修回，并补记在下文 TD-06。

### TD-04 `entries/reorder` 的 Kind 词表用错

- **错在哪**：我按 `entries` 返回的 `ref.kind`（`archive_folder` / `archive`）提交排序项。
- **实际**：`NativeArchiveOrder.Reorder` 只接受 `"folder"` / `"record"`：
  ```csharp
  if (request.Items is null || request.ParentId < 0 ||
      request.Items.Any(x => x.Id <= 0 || x.Kind is not ("folder" or "record")))
      throw new ArgumentException("排序项目格式不正确。");
  ```
- **后果**：T-P1-05 一度被判成"服务端排序坏了"，实际是请求体不合法。
- **修正**：加 `KIND = refKind === "archive_folder" ? "folder" : "record"` 映射，重跑后服务端排序完全正常（PASS）。

### TD-05 系统目录数量用总数判定

- **错在哪**：`T-P0-01` 里断言 `dirs.length === 7`。
- **实际**：`/api/v2/ui/archive/company` 的 `folders` 包含**用户自建的档案目录**，建了目录就超过 7。
- **后果**：第一次跑出 `系统目录 9 个`，把"层级正常"误判成 BUG-001。
- **修正**：改为"这 7 个固定名字都在"（`SYS_NAMES.every(...)`），不再依赖总数。

---

## 二、会导致用例空跑的 4 条

### TD-06 破坏性用例污染主 fixture

- **现象**：`T-P1-04` 的失败调用把 二级-A 移出系统目录，导致后续 `T-P0-01` 误判 `lvl2InSys1=false`。
- **修正**：
  1. 破坏性用例一律**新建临时对象**（`mkScratchIp()`），不碰主 fixture；
  2. 用例名带时间戳（`T104-<base36>`）避免重名 409；
  3. 发现污染后先修数据再重跑，并把两次结果都留在磁盘上。

### TD-07 上下文菜单的调用签名猜错

- **错在哪**：我写 `showCtx(nodeId, {clientX, clientY})`。
- **实际**：`showCtx(x, y, html, handlers)`。
- **后果**：`#ctxMenu` 一直是空的，`ctxItems: []`，于是"没找到快捷访问项"被当成了"没有假按钮"（假 PASS）。
- **修正**：改成在真实行元素上派发 `contextmenu` 事件，走产品自己的处理器。改完才看到菜单项是
  `打开 / 新建合同 / 属性 / 打包下载 / 重命名 F2 / 删除 Del`，并顺带发现快捷访问的真实入口是 `#btnPinFolder`。

### TD-08 按钮文案匹配过宽

- **错在哪**：首页"导入"用 `/导入/.test(textContent)` 找按钮，命中的是 **「导入 Excel」**。
- **后果**：测的根本不是 `导入资料`，`filePickerOpenedAt` 为 `null`，却被判 PASS。
- **修正**：改用 `[data-page-act="upload"]` 精确定位，重跑才拿到 `{folderId:"root", view:"home"}` 这条硬证据（BUG-016）。

### TD-09 选择 API 用错

- **错在哪**：`Drive.setSelection([...])` 不存在。
- **实际**：`Drive.select(id, mode)`（mode: single/toggle）、`Drive.clearSelection()`、`Drive.toggleSelectAll()`。
- **后果**：T-P2-01 直接 TEST_ERROR。
- **修正**：改为 `Drive.select(id, 'single')`。

---

## 三、环境/契约类 4 条

### TD-10 导出请求体字段名错

- 我写 `{ids: []}`，后端是 `ExcelExportInput(string Mode, long[]? Ids)`，Mode 只接受 `"all"` / `"filtered"`。
- 后端返回 `400 {"error":"工作区、模块或筛选方式无效。"}`，我一度把它当成"导出坏了"（差点登记 BUG-024）。
- **修正**：改成 `{Mode:"all"}` 与 `{Mode:"filtered", Ids:[id]}`，两条都 200 且 xlsx 合法，R-02 改判 PASS。

### TD-11 下载用例对象已被删进回收站

- `T-P2-10` 一开始全部 404：S08 的 0B/31MiB/33MiB 都挂在 项目B 下，而 S12 已把项目B 删进回收站。
- **修正**：先从回收站还原项目B，再重测；结果 4 个大小全部 lenMatch + shaMatch，改判 PASS。

### TD-12 版本列表接口不存在

- `GET /api/v2/files/{ws}/{id}/versions` 返回 **405**：后端只有 `.../versions/{version}/download`，没有"列版本"路由。
- **修正**：T-P1-10 的 A 子项改为从 `/api/v2/ui/ip` 的 payload 回读版本号；同时在 REPORT 里把"缺版本列表 API"记为已知边界，而不是缺陷。

### TD-13 空库建库被 409 挡住

- `POST /api/open {create:true}` 在"已有库打开"时返回 `409 请先关闭当前数据库。`
- **修正**：先 `POST /api/lock` 再建库；需要切回时用"空库口令 resume → lock → open 主库"三步。
  `t-http3.cjs` 的 `backToMain()` 现在会依次尝试主库口令与空库口令，避免再次卡死。

### TD-14 开工没 fetch，把落后 9 个提交的本地当成了最新 HEAD

- **表现**：开工第一步只跑 `git rev-parse HEAD` → `49ecf63`，看到工作区干净、本地 log 顶端就是自己上一轮的提交，就判定"已在最新"。
- **后果**：`TASKBOOK-ERRATA.md` 初稿据此写了 6 条"任务书事实错误"（引用的文件不存在 / 编号不存在 / 基线不是合法对象 / 844B PDF 不存在 …）。
  直到 `git push` 被拒、`git fetch` 之后才发现 `origin` 已在 `446f9a6`，这 9 个提交正是 V2 轮自己推送的更正——**六条全部撤回**。
- **判据缺失**：`git status` 干净只证明"没有未提交改动"，不证明"与远程同步"。二者是两件事。
- **修正**：
  1. 开工前置固定三步：`git fetch --all` → `git rev-parse HEAD` 与 `git rev-parse @{u}` 对比 → `git rev-list --left-right --count HEAD...@{u}` 必须为 `0 0`，否则先 rebase；
  2. 基线一律写成"采集点 + 真实 tip"两个值，并附 `git diff --stat` 证明两者对被测对象零差异；
  3. 在真 tip 上复跑关键用例（本轮复跑 13 项，`evidence/recheck-446f9a6/`）。
- **教训**：这类错误不会让任何断言变红，只会让**结论的前提**整体偏移。它比一个失败的用例更危险，因为报告看起来一切正常。

### TD-15 CASES.csv 列数不一致 + 报告统计与 CSV 对不上

- **表现**：收尾核对时发现 `CASES.csv` 表头 14 列，但 31 行只有 13 个字段（缺 `Subcase`），另有个别单元格含**未加引号的逗号**
  （`请求体须 {Mode:'all'|'filtered',Ids}`），把一行撑成 15 个字段。用 CSV 解析器读出来，`Result` 列会错位。
- **连带**：按 CSV 统计得 PASS 21 / BUG 8，与 `REPORT.md` 写的 18 / 12 都不一致——三个数字互不相同。
- **根因**：CSV 是手工拼行而不是从判定对象序列化，加列时只改了表头。
- **修正**：
  1. 固定 14 列顺序，所有字段按 RFC 4180 加引号，由脚本从结构化数据生成，不再手写；
  2. 逐条以**用例自己的 Expected/Observed** 复判，纠正两处口径：
     `T-P1-06` 判据是"失败模块要显式提示"，注入 500 后零提示 → **PASS 改判 CONFIRMED_BUG / BUG-019**；
     `T-P2-05` 判据只覆盖服务端，后端逐条明细齐全 → **维持 PASS**，前端中断归 T-P0-03 / BUG-003，不重复计缺陷；
  3. 最终口径 **PASS 19 / CONFIRMED_BUG 11 / GAP 3 / DOC_GAP 1 / BLOCKED 4 = 38**，报告、裁决、CSV 三处一致。
- **教训**："报告里的数字"和"明细表的数字"必须由同一次计算产生。手工维护两套，迟早对不上。

---

## 四、还留着的测试限制（不是缺陷，但要写清）

| 限制 | 影响 | 已采取的办法 |
|---|---|---|
| headless 下原生文件选择器不弹 | 上传类用例（T-P2-08/T-P2-14）无法驱动 | 记 BLOCKED 并写明用 `DOM.setFileInputFiles` 的复跑路径 |
| CDP 节流对本地 blob 打包无效 | 导出的"进行中"窗口抓不住 | 记 BLOCKED，写明用 `Fetch.requestPaused` 挂住响应 |
| `ui-tree-smoke` 等 8 个冒烟全是源码字符串断言 | 全绿不代表界面可用（本轮 PDF 就是反例） | 每轮都要用真实页面复核，不拿冒烟当验收 |
| 单实例守卫 | 不能同时跑调试宿主与发布版 | 收尾阶段先停调试宿主再起发布版（T-P2-13 就是这么做的） |
