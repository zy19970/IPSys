# IPSys Explorer 全量复测任务书 V2 —— 勘误

- 核对时间：2026-10-22
- 仓库：`E:/Github/管理系统`，分支 `work/onedrive-file-manager`，HEAD `02289ea`
- 方法：只读源码 + 实际命令；每条勘误都给出可复核的文件/行号
- 原则：任务书的**结论性判据**（不得把一键清空当 BUG、不得混用合同两种回收站、不得把 dist 不入库当缺陷等）经核对**成立**，全部保留；下面只改事实错误、引用错误、范围错误与不可执行的方法

---

## 0. 结论摘要

共 10 处需要修正，其中 4 处会直接让本轮测试**做不成或做错**：

| 编号 | 位置 | 类型 | 一句话 |
|---|---|---|---|
| E-01 | §1.2 vs 用户本轮指令 | 任务书自相矛盾 | 不许推送 vs 要求推送；且 §8 建议的目录全在 `.gitignore` 里，按原文执行永远推不上去 |
| E-02 | §3.3 / §1.4 / §5.2 T-P1-01 | 事实错误 | 端口在 `127.0.0.1`，不是 `localhost`；用 `localhost` 会 403，不是环境坏 |
| E-03 | §5.3 T-P2-07 | 原勘误误报（已复核） | `SearchHit` 实际包含 `OwnerKind/OwnerId`，前端使用 `ownerKind/ownerId` |
| E-04 | §5.2 T-P1-05 | 范围超出实现 | 后端只有档案一个 reorder 端点；IP/项目台账没有 |
| E-05 | §7.1.3 | 方法无效 | 压缩是本机 SQLCipher VACUUM，CDP 网络节流对它没有任何作用 |
| E-06 | §5.3 T-P2-10 | 方法不可执行 | `showSaveFilePicker` 是原生对话框，CDP 点不到 |
| E-07 | §5.2 T-P1-01 | 判据偏软 | "只有打开入口"不是"可以没有"，`UI_BASELINE.md` 明确要求"创建新库另设入口" |
| E-08 | §2 / §9 | 计量口径 | 15 个 FAIL ≠ 15 个缺陷，上轮去重 13 个；不先声明会虚增缺陷数 |
| E-09 | §1.4 | 事实补充 | 单实例守卫真实存在，但 `--mcp` 在守卫之前 return；"不得强杀"的理由要写准 |
| E-10 | §5.3 T-P2-02 | 判据方向对、证据要补 | 内部拖拽确实只弹提示；但提示词"需要后端支持 link 迁移"是**假的**，后端已有 |

---

## E-01 §1.2 与本轮用户指令直接冲突，且交付目录被 Git 忽略

**原文**

> §1.2 **只读审查产品源码；不修代码、不提交、不推送、不合并…** 测试脚本、截图、合成测试库写入 `build-retest/agent-explorer-full-v2/`（仓库忽略目录）
> §8 建议目录结构 `build-retest/agent-explorer-full-v2/…`

**本轮用户指令**

> 然后你把测试任务的结果直接推送到仓库中。

**核查**

```
$ cat .gitignore
...
**/.vs/
build-retest/
```

`build-retest/` 整目录被忽略，`*.db` 也被忽略。按 §1.2 + §8 执行，产出全部落在忽略目录，`git status` 永远干净，**"推送到仓库"在物理上不可能完成**。

**修正**

1. 产品源码零改动、零提交——这条保留，是本轮的硬边界。
2. 交付物改写到被跟踪的 `docs/retest-v2-2026-10-22/`：报告、CSV、缺陷清单、缺口清单、`evidence/`、可复跑 `scripts/`。
3. `build-retest/agent-explorer-full-v2/` 只放**不入库的中间物**：测试库 `.db`、上传素材、临时日志。
4. 只提交 `docs/retest-v2-2026-10-22/` 一个新增目录，单独一个提交，不夹带任何源码改动。

---

## E-02 地址是 `127.0.0.1`，不是 `localhost`

**原文**

> §3.3 使用真实 WinForms 宿主对外提供的随机 localhost 地址

**核查**（`src/IPSys.Web/Program.cs:52-65`）

```csharp
app.Urls.Add("http://127.0.0.1:0");
app.Use(async (ctx, next) => {
    if (ctx.Request.Host.Host != "127.0.0.1") { ctx.Response.StatusCode = 403; return; }
    string? origin = ctx.Request.Headers.Origin;
    if (!string.IsNullOrEmpty(origin) &&
        origin != $"http://127.0.0.1:{ctx.Request.Host.Port}") { ctx.Response.StatusCode = 403; return; }
```

Host 校验是**严格等于** `127.0.0.1` 的字符串比较。`http://localhost:PORT` 会命中 403，而 403 的原因跟被测功能毫无关系。

**修正**

所有 URL 一律写 `http://127.0.0.1:<port>`。测试脚本从 `netstat` 取端口后显式拼 `127.0.0.1`。报告里把"localhost 403"作为**安全边界的正向证据**（T-P2-12），不作为环境故障。

---

## E-03 T-P2-07 的字段核对（复核更正）

**原勘误误判**

原勘误声称 `ownerKind` 在全仓不存在，但实际上 `src/IPSys.Web/SearchStore.cs` 的 `SearchHit` 包含 `OwnerKind` 与 `OwnerId`；前端 `frontend/explorer/js/store.js` 的 `ownerIdOfHit()` 使用响应中的 `ownerKind/ownerId` 定位记录，再通过 `fileMeta` 将搜索的 fileId 映射到真实附件节点。原来的“grep 零命中”结论不成立。

**修正判据**

首先验证响应中的文件归属元数据，再验证搜索结果映射到正确的所有者及 link 节点；不能仅要求搜索列表非空或任意跳转成功。注意 C# 属性名与 JSON camelCase 名称的区别。本项新浏览器脚本尚未复测。

---

## E-04 T-P1-05 要求 IP、项目台账也做持久排序，但后端没有这些端点

**原文**

> T-P1-05 **手工持久排序**：公司档案文件夹/记录混排、IP、适用台账

**核查**

排序/移动确实有端点，但**全部硬限公司业务档案**：

```csharp
// NativeArchiveOrder.cs:25-26
if(workspace!="company"||section!="achievement")
    throw new ArgumentException("混排操作仅限公司业务档案。");

// NativeArchiveOrder.cs:77-79（Move）
if(!r.IsValid || r.Workspace!="company" || r.Section!="achievement" || ...)
    throw new ArgumentException("移动只适用于公司业务档案目录与资料。");
```

三个入口：

| 端点 | 用途 | 限制 |
|---|---|---|
| `POST /api/v2/folders/{ws}/entries/reorder?section=` | 目录行与资料行**混排** | `company/achievement` |
| `POST /api/v2/ui/archive/{ws}/{section}/order` | 档案记录 ids 全量重排 | `company/achievement` |
| `POST /api/v2/folders/{ws}/{kind}/{id}/move?section=` | 目录/资料改父级 | `company/achievement` |

`Reorder` 的 UPDATE 语句里直接把 `workspace='company' AND section='achievement'` 写死（`NativeArchiveOrder.cs:55`）。知识产权、项目台账既没有端点，也没有 `position` 写入路径。

**修正**

- 主判据限定在**公司业务档案**：三级目录内目录行与资料行混排、`entries/reorder` 返回 `{ok:true}`、重开宿主后 `position` 保持。
- 另验 `archive/{section}/order` 的 ids 全量校验（少一条/多一条应 409），这是它的安全边界。
- IP / 项目台账记为"产品未提供持久排序"，**不出 BUG 编号**，只在缺口清单记一行——把它记成缺陷等于要求一个从未设计的功能。

---

## E-05 §7.1.3 的 CDP 网络节流对压缩无效

**原文**

> 如果本机压缩仍过快：使用隔离的测试进程，利用 browser CDP/network throttling … 将界面"处理中"维持足以观察的窗口

**核查**

压缩是 `VACUUM`（`VaultCompactJob` + `VaultCompactEndpoints`），在本机 SQLCipher 文件上执行，**不产生任何 HTTP 往返**。CDP 的 `Network.emulateNetworkConditions` 只影响浏览器发出的请求，对进程内的 SQLite 无影响。照此执行只会得到一个"看起来没生效"的假象。

**修正**

唯一有效手段是把测试库做**足够大**：

1. 在独立测试库里循环写入再删除数十 MB 原件，制造可回收页；
2. `GET /api/vault/compact/info` 确认 `reusableBytes` 达到可观察量级；
3. 再点压缩，用 CDP 抓 `处理中` 的时间窗与切工作区请求的耗时。

若 `reusableBytes` 仍不够大、压缩在毫秒级结束，按 `BLOCKED` 记录实测数值，**不得**因为"理论上有 Gate"写 PASS。

---

## E-06 T-P2-10 的"取消文件选择器"在 CDP 下无法点击

**原文**

> 小文件、31 MiB、33 MiB、取消文件选择器、模拟中途断流

**核查**

`downloadFile()` 在 ≥32 MiB 时先调 `showSaveFilePicker()`（`interactions.js:1502`）。这是 Chromium 的**原生文件对话框**，不在 DOM 里，CDP 的 `Input.*` 点不到；`Page.handleFileChooser` 只覆盖 `<input type=file>`。

**修正**

分两层测，报告里分开写：

- **原生层（只验时序）**：headed Edge 里真实点击，确认点击后立即弹原生框、且此时**尚无网络请求**（用 CDP Network 事件确认 picker 之前零请求）。取消后确认无残留文件。
- **写盘层（桩替换）**：在页面上下文把 `window.showSaveFilePicker` 换成受控桩——成功桩返回由内存缓冲支撑的 `FileSystemFileHandle` 形状对象，取消桩抛 `DOMException("", "AbortError")`。`createWritable()` / `getReader()` 分块写 / 逐块校验 / `writer.abort()` 全部走产品代码。
- 报告中必须标注："选择器为桩，流式写盘链路为真实代码"。

---

## E-07 T-P1-01 的判据比冻结基线松

**原文**

> 若只有打开已有库入口，静态+页面证实 `IMPLEMENTATION_GAP`

**核查**（`UI_BASELINE.md` §2.1）

> 默认显示「打开已有资料库」，**创建新库另设入口**。

新建库入口不是"可以有"，是基线要求。上一轮已实测 `interactions.js:270-280` 把 `create` 硬编码为 `false`，`index.html` 登录层只有"打开"一个按钮。

**修正**

判据升级为：**UI 缺"创建新库"入口 = 违反 `UI_BASELINE.md` §2.1 的冻结基线**，不是"探索后未发现"。同时用 HTTP `POST /api/open {create:true}` 证明后端具备能力，避免被误判为后端缺失。

---

## E-08 15 个 FAIL 不等于 15 个缺陷

**原文**

> 上轮 FAIL 的 15 项至少重新核对关键路径

**核查**（上轮 CSV）

- `T-P0-03` 与 `T-P2-05` 同指 BUG-003；
- `T-P1-06` 与 `T-P2-15` 同指 BUG-011；
- 15 个 FAIL 行去重后是 **13 个缺陷**（BUG-001…BUG-013）。

**修正**

报告里三个数字必须分开写：`测试项数 38`、`已执行项数`、`去重缺陷数`。禁止用"15 项失败"当缺陷数。

---

## E-09 单实例守卫真实存在，但 `--mcp` 提前返回

**原文**

> 宿主单实例：发现已有实例先判断其归属，**不得强杀不明来源的用户实例**

**核查**（`src/IPSys.Web/Program.cs:8-22`）

```csharp
if(args.Contains("--mcp")) { await McpLocal.RunStdioAsync(); return; }
...
using var hostInstance = new EventWaitHandle(false, EventResetMode.ManualReset,
    McpLocal.HostInstanceName, out bool firstHost);
if(!firstHost) { /* MessageBox 提示已在运行 */ return; }
```

单实例是真的。但 `--mcp` 在守卫**之前** return，所以 MCP 子进程可以无限多——这是设计，不是漏洞。

**修正**

"不得强杀"的理由要写准：**误杀会让真实用户的 WinForms 会话与已解锁的资料库一起消失**，不是"可能有另一个测试进程"。本轮启动前先 `tasklist | grep IPSys`，发现实例先确认归属；若无法确认，改期而不是杀进程。

---

## E-10 T-P2-02 的提示词本身在说谎

**原文**

> 内部附件拖到其他记录…内部移动不得只弹空提示

**核查**（`interactions.js:985-1004`）

```js
const srcId = e.dataTransfer.getData("text/plain");
const src = findById(srcId);
if (!src || src === target) return;
toast("附件移动需要后端支持 link 迁移；当前请用「上传」挂到目标记录");
```

后端其实**已经支持**：`POST /api/v2/files/{workspace}/{fileId}/associate`，body `{linkId, targetFolderId, move}`（`NativeFileAssociateEndpoints.cs:5`），`move=true` 就是移动 link。

**修正**

判据保持"不得只弹空提示"，但缺陷描述要写准：**前端既没调 `/associate`，提示语又把责任推给不存在的后端缺口**。这是双重问题：能力缺失 + 误导性文案。

---

## 保留不动的部分（核对后成立）

| 任务书结论 | 核查依据 |
|---|---|
| 一键清空回收站是允许功能，旧 Q122 只记 `DOC_GAP` | `REQUIREMENTS.md:195` 确实写"不提供一键清空"；`index.html:119` + `app.js:633` 确有按钮 |
| 项目整体删除时回收站不单列合同是**正确**的 | `RecycleStore.cs` 查询带 `p.deleted=0`；上轮实测删项目 A 后只有 project 行，恢复后合同 C2 回来 |
| `dist/` 不入库是既定决策 | `.gitignore:13`；`ui-assets-smoke` 负责 dist 新鲜度 |
| `interactions.js` 有 drop 处理器 | 962–1015 行，外部文件拖入走 `uploadFiles` |
| `excel.js` 固定 `mode:'all'` | `excel.js:51`，`exportLedger` 无范围选择 |
| 批量彻底删除单次上限 200 | `RecycleStore.cs:318/393/453`；`bridge.js:436` 有超限提示，**不是静默失败** |
| 业务档案混排是基线要求 | `UI_BASELINE.md` §3"下级分类行和本级资料行任意混排，不强制文件夹靠前" |
| 8 个 Node smoke 清单 | `src/IPSys.Web/tests/` 逐个存在；`frontend/explorer/tools/bundle.cjs` 存在 |
| 上轮 30 项按 ID 全保留 | 上轮 CSV 30 行，P0 5 / P1 10 / P2 15 |


---

## 复核补充（2026-10-22）：原始测试证据的判定更正

### E-11 R-08 不是测试缺陷

`ui-tree-smoke.cjs` 的 `f:2:1` 和 `f:3:2` 分别对应 `linkId=2` 与 `linkId=3`，属于两个独立附件。原断言没有把同一 linkId 的多个版本要求为多行。因此撤销 BUG-017；不修改这条断言。现有 smoke 未覆盖同一 linkId 多版本折叠，但该覆盖缺失不能反向证明此断言错误。

### E-12 T-P2-07 的原始 PASS 只覆盖了档案跳转

旧脚本实际查询“档案-01”，但写出的证据文字误写为“专利说明书”；其判定条件仅要求结果列表非空且最终 folderId 非空。它没有验证任务书中提到的附件命中 `fileId → linkId` 映射。已将该项总表改为 BLOCKED，并在脚本中加入精确档案 ID 跳转与独立附件归属映射断言；须重新运行后才能给出最终结论。

### E-13 T-P2-09 的旧 PASS 不成立

原始观察是 Canvas 数量为 1、状态仍为“正在解析 PDF…”，页码为 0。Canvas 是创建预览容器时即添加的，不能证明 PDF 页面已经渲染。旧 fixture 也缺少可靠的 xref 与字体资源，不能据此确认是产品问题。已修复 fixture，并将判据收紧为两页分别完成渲染、页码正确、Canvas 尺寸非零、渲染状态清空；复测完成前总表为 BLOCKED。

### E-14 复合用例 T-P1-02 不应提前登记 BUG-007

整体删除项目的级联恢复已有 PASS 证据；单独删除合同的回收站 UI 行为尚未独立复测。暂撤销 BUG-007 的确认，保留为待验证子项，避免将一个部分执行的复合用例直接当作已确认缺陷。

### E-15 统计必须分开计算

38 项总数不变。复核后状态分布为 PASS 6、CONFIRMED_BUG 7、IMPLEMENTATION_GAP 6、DOC_GAP 1、BLOCKED 18。按 CSV 的 Method 列计数为 DYNAMIC-BROWSER 10、DYNAMIC-HTTP 4、STATIC 3、MIXED 8、方法未指定 13；方法分布不等于状态分布。当前识别 13 个产品 BUG 编号（其中 BUG-004 本轮未复跑），另有 R-02 实现缺口与 R-07 文档缺口。


---

## E-16 Windows V2 实测更新（Actions run 39726553781）

本轮执行了 Debug 构建、Release 单文件发布、MCP 握手、8 项 Node 冒烟、SQLCipher/HTTP smoke，以及隔离测试库上的 HTTP 与 Edge 浏览器复测。工作流结论为 success，测试本身发现的产品缺陷仍按用例状态单独统计。

- **T-P2-07：PASS。** HTTP 搜索返回正确的 `ownerKind=ip`、`ownerId=19`；Edge 档案跳转和附件 `fileId→linkId` 映射均正确。
- **T-P2-09：CONFIRMED_BUG，新增 BUG-018。** 有效 PDF 下载 200、844 字节，但预览仍显示“正在解析 PDF…”，页码为“加载中”。`interactions.js` 创建 viewer 后未调用 `pdfViewer.open()`，导致 PDF.js 文档加载和页面渲染未启动。
- **当前统计**：PASS 7、CONFIRMED_BUG 8、IMPLEMENTATION_GAP 6、DOC_GAP 1、BLOCKED 16（共 38 项）。
- 新结果保存于 `evidence/runs/v2ci-39726553781-1/`；截图和完整宿主日志见 [Actions artifact](https://github.com/zy19970/IPSys/actions/runs/39726553781/artifacts/12403621382)。
