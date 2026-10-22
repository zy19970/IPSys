# 任务书 V3 勘误 —— 逐条核对结果（修订版 v2）

- **被核对文件**：`IPSys_Explorer_9CE5B0AgentAEE6BA85E98FB5E895BBE5A1B9%A6_V3_2026-10-22.md`（365 行）
- **v1 写成**：2026-10-22 18:58（开工后 2 分钟）
- **v2 修订**：2026-10-22 20:10（推送被拒后 fetch，发现本地落后 9 个提交，v1 的 E-01..E-06 全部撤回）
- **本地开工 HEAD**：`49ecf63e78691ba72ed4a27badbb4224e6a435c1`
- **远程真实 tip**：`446f9a67c8e6f0fef04b15b48d96e11079ea8812`（同一分支 `work/onedrive-file-manager`）

> **前提校正**：开工时本地比 `origin` 落后 9 个提交，而我没有先 `fetch`。这 9 个提交是 V2 轮自己推送的补充（CI 接入 + 裁决更正），
> 全部落在 `.github/workflows/web-windows.yml` 与 `docs/retest-v2-2026-10-22/` 内，**`src/ frontend/ tools/ dist/` 零差异**
> （`git diff --stat 49ecf63 446f9a6 -- src frontend tools dist` 输出为空）。所以：
> **任务书是对着 446f9a6 写的，它没错；错的是我拿 49ecf63 当成了最新。**

---

## 零、撤回声明：v1 的六条"事实错误"不成立

v1 开头写"有 6 处事实错误"。这 6 条**全部撤回**。逐条对照：

| 原编号 | v1 的判定 | 实际情况 | 核实方式 |
|---|---|---|---|
| E-01 | §2.1.4 引用的 `evidence/RESULT-ADJUDICATION.md` 不存在 | **存在**。`97b0a87` 新增该文件 35 行，正是 V2 的裁决汇总 | `git show 446f9a6:docs/retest-v2-2026-10-22/evidence/RESULT-ADJUDICATION.md` |
| E-02 | "上轮 BUG-018"这个编号不存在，上轮只到 BUG-017 | **存在**。`446f9a6` 的 Defects 编号已连续到 BUG-018 | `git show 446f9a6:...V2_Defects.md \| grep -oE "BUG-0[0-9]{2}"` → 含 BUG-018 |
| E-03 | 上轮 T-P2-09 判了 PASS，是误报 | V2 **已经自己纠正过**：裁决写明"旧 PASS 无效；本轮确认 BUG-018" | 同上 RESULT-ADJUDICATION.md「T-P2-09」节 |
| E-04 | §6 R-08 的"PASS，防误报"写错了，实际是 CONFIRMED_BUG | **任务书正确**。V2 已撤销 BUG-017，R-08 改判 PASS | RESULT-ADJUDICATION.md「R-08」节 |
| E-05 | "844B 两页 PDF"在仓库里不存在 | **存在**。V2 CI 轮证据里有 `PDF 两页示例.pdf — 844 B`，失败特征与我这轮完全一致 | `git show 446f9a6:.../runs/v2ci-39726553781-1/T-P2-09.txt` |
| E-06 | 编制基线 `446f9a6` 不是合法对象 | **是合法提交**，就在远程分支顶端；`git cat-file` 失败只因本地没有该对象 | `git fetch` 后 `git log --oneline -1 446f9a6` |

### 为什么会错

开工时我做的是 `git rev-parse HEAD` → `49ecf63`，看到 `git status` 干净、`git log` 顶端就是自己上一轮提交的 V2 交付，就默认"已在最新"。
**没有做 `git fetch` + `rev-list --count HEAD...origin/<branch>` 这一步**。本地仓库的"干净"与远程的"最新"是两件事，我把它们混为一谈。

### 代价

1. 六条勘误作废，本文件的有效产出从 13 条降到 **7 条**（E-07..E-13，均为前提补充，不含"任务书写错了"）。
2. 任务书本身**没有硬事实错误**——它的每一处引用在 446f9a6 上都对得上。
3. **不影响 38 项动态结论**：被测产品源码在两个端点间零差异，且本轮已在 446f9a6 上复跑 13 项（HTTP 10 + 树 2 + PDF 1），结果逐项一致（见 `RUN-MANIFEST.md` §复验）。
4. 已记入 `TEST-DEFECTS.md` **TD-14**，并把"开工先 fetch 并对齐 origin"写进复跑前置步骤。

---

## 一、任务书真实存在的表述风险（不是事实错误）

这是撤回六条之后，任务书**唯一**仍值得指出的一点：

**"上轮"一词在文中指两个不同的基线，容易误读。**

| 文中位置 | "上轮"实际指 | 该基线状态 |
|---|---|---|
| §2.1.4 引用 `RESULT-ADJUDICATION.md` | V2 **CI 轮**（`446f9a6`） | PASS 7 / BUG 8 / GAP 6 / DOC 1 / BLOCKED 16，BUG-017 已撤销，BUG-018 已登记 |
| §6 表"上轮主要状态"列 | V2 **手工轮**（`02289ea`，即 `49ecf63` 的前一个提交） | R-08 当时确为 CONFIRMED_BUG / BUG-017 |

两者相隔 9 个提交、状态不同。任务书自身没有写错，但读者若不先对齐到 `446f9a6`，就会像 v1 那样把"已更正的状态"当成"任务书写错"。
**建议**（下一版任务书）：在 §6 表头注明"上轮 = 446f9a6 的裁决后状态"，并给出 `git rev-parse` 校验步骤。

---

## 二、仍然成立的补充（E-07..E-13）

这 7 条不是"任务书写错"，而是**任务书没写、但会改变判决对错的前提**。三条已在 446f9a6 上复核。

### E-07 BUG-018 的静态根因成立，调用链补全

§7 说根因是 `viewer.create(body, buffer)` 后未启动 `open()`。核对成立，且与 V2 裁决表述一致：

- `src/IPSys.Web/wwwroot/pdf-preview.js:95` → `return {open,destroy};` —— `create()` **只搭壳**，把状态写成「正在解析 PDF…」（第 31 行），真正的 `getDocument` 在 `open()` 里（第 74-85 行）；
- `frontend/explorer/js/interactions.js:1633` → `pdfViewer = viewer.create(body, buffer);` —— 赋值后**再无任何 `.open()` 调用**；
- 旁证：`src/IPSys.Web/tests/pdf-canvas-smoke.cjs` 全程是对**源码字符串做正则断言**，没有任何真实 PDF 渲染。它通过完全不能证明预览可用 —— 任务书 §4.1 的警告方向正确，这里补上"为什么"。

### E-08 BUG-017 应撤销，论据比任务书更硬

**注意：V2 已于 `446f9a6` 撤销 BUG-017，本轮不是首次撤销，而是独立复核其论据。** 核对 `src/IPSys.Web/tests/ui-tree-smoke.cjs:40-45` 的 fixture：

```js
{linkId:2, fileId:201, version:1, folderId:11, kind:'contract', name:'合同正文.pdf', size:200},
{linkId:3, fileId:202, version:2, folderId:11, kind:'contract', name:'扫描件.pdf', size:50},
```

`c:11` 下挂的是 **linkId 2 / fileId 201 / v1** 与 **linkId 3 / fileId 202 / v2** —— 两个不同 linkId、两个不同 fileId、两份不同文件。
节点 id 形如 `f:<linkId>:<version>`，所以 `['f:2:1','f:3:2']` 断言"两条附件"**本身就是正确预期**。
→ 撤销理由成立。同源副作用：V2 手工轮的 `evidence/R-08.txt` 引文写作 `'Every version of every contract original must appear as its own node'`，源码第 63 行实际是 `'Every version of every contract original hangs off the contract'` —— 引文不准。

### E-09 §8 的"16 项 BLOCKED"名单核对通过

`446f9a6` 的 CSV 与 §8 表体 16 行**完全一致**：

`T-P0-04 / T-P1-02 / T-P1-06 / T-P1-07 / T-P1-08 / T-P1-09 / T-P1-10 / T-P2-05 / T-P2-08 / T-P2-10 / T-P2-13 / T-P2-14 / T-P2-15 / R-01 / R-04 / R-06`

统计复核：38 行 = PASS 7 + CONFIRMED_BUG 8 + IMPLEMENTATION_GAP 6 + DOC_GAP 1 + BLOCKED 16。
（注：`T-P2-07` 在 `446f9a6` 已由 BLOCKED 改为 PASS，v1 若照抄 49ecf63 的名单会错——这是落后一步就会踩到的具体例子。）

### E-10 T-P2-13 的单文件是**框架依赖**，不是自包含

`src/IPSys.Web/IPSys.Web.csproj:13-15`：

```xml
<RuntimeIdentifier>win-x64</RuntimeIdentifier>
<SelfContained>false</SelfContained>
<PublishSingleFile>true</PublishSingleFile>
```

`SelfContained=false` 意味着产物**仍需要目标机安装 .NET 8 运行时**。所以"离线条件启动"只能理解为"不依赖 CDN / 外部 wwwroot / 网络"，不能理解为"裸机可跑"。

**判据补充**：断网后启动成功且内嵌 HTML/CSS/JS/PDF 资源可加载 = PASS；若因缺 .NET 运行时启动失败，这是**部署前提**而非产品缺陷，不得记 BUG。

### E-11 §6「合同必须归属一个有效项目」需要实测确认

`NativeFolderStore.cs:214` 的写法是 `if(kind != FolderKinds.Contract && projectId is not null)` —— 只约束"非合同不得带 projectId"，**并未直接证明"合同必须带 projectId"**。
归属项目有三个等价写法（顶层 `parentId`、顶层 `projectId`、`contract.projectId`），见 `NativeProjectContractUiHttpSmoke.cs:56` 注释。

**处理**：T-P1-02② 构造"单删合同"前先实测 `POST` 不带 projectId 建合同返回什么，再决定测试对象怎么建；不把这条当既定事实。
（本轮实测：单删合同可独立进回收站，parent=项目A，恢复后 projectId=15 → 记 PASS。）

### E-12 §11 的"38 项"与 CSV 列数口径需明确

§11 的 CSV 列比 V2 的 12 列多（`Subcase`/`TestedCommit`/`Environment`），且要求"38 项逐条状态"。若复合用例（T-P1-02、T-P1-10、T-P0-03 等）按 `Subcase` 拆行，行数会超过 38。

**本轮口径**：**"38 项"按主用例 ID 计**（一行一个主 ID，子场景写在 `Subcase` 列内以 `①/②` 分隔）。报告里的计数**按 ID 去重后**统计，保证合计 = 38。`CASES.csv` 实际 43 行 = 38 主 ID + 5 个子场景行。

### E-13 §4.1 的构建前提已满足，SDK 选择要留意

目标框架 `net8.0-windows`。本机 `dotnet --version` 默认给 10.0.401，但同时装有 SDK 8.0.426 与 ASP.NET Core Runtime 8.0.32 —— `dotnet build` 会按 TFM 选 8.0 targeting pack，可直接构建。
若出现 NETSDK1045 类错误，用 `dotnet build -f net8.0-windows` 或临时 `global.json` 固定 SDK（**不修改仓库文件**）。

---

## 三、核对后确认无误的关键断言

| 任务书断言 | 核对结果 | 依据 |
|---|---|---|
| `src/IPSys.Web/tests/` 下 8 个 Node 测试脚本存在且名字一致 | ✅ 一致 | `ls src/IPSys.Web/tests/` |
| `frontend/explorer/dist/` 生成且不入库 | ✅ 一致 | `.gitignore:13` |
| `frontend/explorer/tools/bundle.cjs` 路径 | ✅ 存在 | `frontend/explorer/tools/bundle.cjs`（1821 B） |
| `DELETE /api/v2/files/{ws}/{fileId}/links/{linkId}` 存在 | ✅ 存在 | `NativeFileLinkEndpoints.cs:51` |
| `GET /api/v2/ui/archive/{workspace}` 存在 | ✅ 存在 | `NativeArchiveUiEndpoints.cs:14` |
| `store.js loadAll()` 用 `.catch(() => [])` / `.catch(() => ({}))` 吞异常 | ✅ 一致 | `store.js:140-144` |
| `bridge.js purgeTrash()` 在 `items.length > 200` 时直接拒绝 | ✅ 一致 | `bridge.js:436-441` |
| `emptyRecycle()` 把整个回收站传给该函数（不自动分批） | ✅ 一致 | `interactions.js:1409-1412` → `recycleAction` → `purgeTrash` |
| `app.js` 有 `sortedItems` 类型优先排序分支 | ✅ 存在 | `app.js:408` |
| `ui-tree-smoke` 的"两个不同 LinkId"断言本身正确 | ✅ 正确 | `ui-tree-smoke.cjs:40-45` |
| `pdf-canvas-smoke` 通过 ≠ Explorer 真实两页预览 | ✅ 正确 | 该脚本全为源码字符串断言 |
| 一键清空按钮存在不属缺陷（已获授权） | ✅ 接受 | 用户 2026-10-22 决定 |
| `docs/archive/` React 路线作废、现行是 `frontend/explorer/` | ✅ 一致 | 目录与源码 |

---

## 四、纠正后的执行口径（本轮实际怎么判）

1. **基线**：远程真 tip = `446f9a6`；动态证据在 `49ecf63` 采集，因产品源码零差异，并在 `446f9a6` 复跑 13 项确认一致。每项证据带 `TestedCommit`。
2. **T-P2-09 按撤销旧 PASS 处理**，判据是"第 1 页与第 2 页都完成 Canvas 渲染且页码到 2 / 2"，不是"canvas 元素存在"。实测：页码停在「加载中」、canvas 停在 300×150（HTML 默认尺寸）、状态停在「正在解析 PDF…」。
3. **R-08 维持 PASS、BUG-017 维持撤销**，依据是 fixture 里是两个不同 linkId；本轮独立复核，不重复登记。
4. **BUG-018 沿用 V2 的编号**，本轮独立复现（不改号、不重开新号）。
5. **T-P2-13 的"离线"限定为断网**，不把缺运行时记成缺陷。
6. **38 项按主用例 ID 计数**，子场景不改变总数。
7. 任务书未覆盖但必须做：本轮补写 `evidence/RESULT-ADJUDICATION.md`（与 V2 那份同名但内容独立），使 §2.1.4 的引用链在两轮之间连续。
