# 缺陷清单 — Phase 2 本地实测

> 判定口径：只有「产品行为与期望不符，且已用可重复步骤复现」才进本表。
> 脚本自身的断言错误、环境不可达、用例前提不成立，一律记入 `TEST_ERRORS_AND_BLOCKERS.md`，**不计入产品缺陷**。
> 本轮 132 条用例中 **1 条 CONFIRMED_BUG**，另有 4 条在用例之外现场发现、不影响该用例判定但必须记录的独立问题。

---

## D-01 401 后会话静默失效：清空 token 却不弹锁屏、不提示

| 项 | 内容 |
|---|---|
| 关联用例 | **I-08（P0，CONFIRMED_BUG）** |
| 严重程度 | **高**（P0）。表现是「数据全没了」而不是「请重新登录」，用户会误以为资料库被清空 |
| 影响范围 | 任何服务端返回 401 的路径：解锁态失效、token 过期、宿主被外部关闭/重启、另一进程重开库 |
| 证据 | `build-retest/phase2/evidence/cases/I-08.json`；截图无（该状态本身没有可视提示，正是问题所在） |

**复现步骤**

1. 正常解锁进入工作台（企业或个人均可）。
2. 用 CDP `Fetch.enable` 拦截 `GET /api/v2/search/{ws}?q=*`，`fulfillRequest` 返回 `401 {"error":"I-08 注入 401"}`。
3. 在搜索框输入任一关键词并回车。
4. 观察：完全没有 toast、`#lockScreen` 没有 `show`；结果区显示「检索失败 / 本地已加载的内容里也没有匹配项」。
5. 再触发任意一次刷新（`VaultStore.loadAll`）：得到 `请求失败：401`，界面停留在空列表。

**实测数据**

```json
{ "search401": { "toasts": [], "lockShown": false, "tokenEmpty": true, "locked": true, "rows": 0,
                 "text": "检索失败\n\nI-08 注入 401\n\n本地已加载的内容里也没有匹配项。" },
  "after401": { "reload": "fail", "msg": "请求失败：401" },
  "sessionDeadAfter401": true }
```

对照：同一注入点改成 500 时，界面明确给出「检索失败」—— 说明 500 分支有处理，401 分支没有。

**根因假设**

`frontend/explorer/js/store.js:87-90` 的 401 分支只做了状态清理就抛错：

```js
this.token = ""; this.locked = true;   // 之后直接 throw
```

没有任何一处把这些状态接到 UI 上。而锁屏只在 `showLogin()` 里被 `classList.add("show")`，`showLogin` 的调用点只有启动流程与显式「关闭数据库」，**运行期的 401 不在其中**。于是 `locked=true` 变成了一个只有内部知道的标志位，界面照旧渲染，只是永远拿不到数据。

**修复建议**

1. 在 `VaultStore.api()` 的 401 分支里集中触发一次 `showLogin("登录已失效，请重新输入密码")`，并清空 `Drive.state`、收起详情面板与右键菜单。
2. 加一个**只触发一次**的护栏（`this._reloginShown`），避免并发请求同时 401 时弹多次 / 刷屏。
3. 不要把 401 呈现为「检索失败 / 本地没有匹配项」—— 检索失败的文案要区分「服务端报错」与「会话失效」两种。
4. 建议补一条自动回归：注入 401 → 断言 `#lockScreen.show === true` 且存在 toast，再解锁可恢复。

---

## D-02 外部文件拖到非记录行区域被静默丢弃（无任何提示）

| 项 | 内容 |
|---|---|
| 关联用例 | G-07（该用例判定 **PASS**：期望是「不得悄悄写入」，实测确实没有写入；本条是同一现象背后的**独立体验缺陷**） |
| 严重程度 | 中（P1）。用户会以为「拖上去了」，实际什么都没发生 |
| 影响范围 | 分类页、首页、列表空白处、回收站等一切「拖放落点不是 `.row` / `.tile`」的位置 |
| 证据 | `build-retest/phase2/evidence/cases/G-07.json`（`silent: true`、`projectLinksBefore=After=0`、全工作区 link 112→112） |

**复现步骤**

1. 进入任一分类型页面（如「公司项目」）或首页。
2. 从资源管理器拖一个文件到**列表空白处**（不是某条记录行）。
3. 观察：没有任何 toast、没有上传进度、没有「请先进入具体业务记录」的提示，文件被完全丢弃。

**根因假设**

`frontend/explorer/js/interactions.js:1277-1289` 有两个叠加的守卫：

```js
["dragover","drop"].forEach(t => document.addEventListener(t, e => {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();                                  // ← 先把 defaultPrevented 置真
}));
document.addEventListener("drop", e => {
  if (!e.dataTransfer?.files?.length || e.defaultPrevented) return;   // ← 因此永远在这里 return
  ...
  else toast("请先进入具体业务记录，再上传附件");       // ← 这段永远到不了
});
```

第一个监听器为了「阻止浏览器直接打开文件」调用了 `preventDefault()`，第二个监听器又把 `e.defaultPrevented` 当成「已被别人处理」的信号跳过 —— 提示分支被自己的防默认行为短路。叠加上 `interactions.js:1230-1237` 里 `e.target.closest(".row,.tile")` 为空就直接 `return`，非记录行区域的落点就彻底静默了。

**修复建议**

1. 用显式的「已处理」标记代替 `defaultPrevented` 判定（例如第一个监听器只 `preventDefault()`，第二个监听器不看 `defaultPrevented`，改为看自己的 `e.__ipsysHandled`）。
2. 落点不是记录行时，明确给出提示：`toast("请拖到具体业务记录上，或先进入记录再上传")`；首页/分类页可提示「先双击进入一条记录」。
3. 补一条自动回归：向空白处 drop 一个 File，断言出现提示且未产生 link。

---

## D-03 台账导出范围恒为「全部」，UI 没有「选中 / 筛选」语义

| 项 | 内容 |
|---|---|
| 关联用例 | **I-06（P1，GAP）** —— 任务书前提在现有壳里不成立，按 GAP 记录而不是 BUG |
| 严重程度 | 中（P1）。对有上千条台账的分类，导出的永远是全量 |
| 影响范围 | 所有支持台账的分类导出（`#btnExcelExport`） |
| 证据 | `build-retest/phase2/evidence/cases/I-06.json`（`captured: [{mode:"all", ids:null}]`、`uiHadSelection: true`） |

**复现步骤**

1. 进入「公司项目」台账页。
2. 勾选任意 1–2 行（`uiHadSelection: true`）。
3. 点「导出台账」，抓请求体：恒为 `{ "mode": "all", "ids": null }`。

**根因**

`frontend/explorer/js/excel.js:51` 固定写死 `{ mode: "all", ids: null }`；同文件 `:11` 的注释说明这是**沿袭旧壳的取舍**：「新壳没有台账行概念，统一用 all」。也就是说后端支持范围导出，前端没有接。

**修复建议**

1. 明确产品口径：导出跟随「当前筛选结果」还是「勾选项」。
2. 前端把 `Drive.state.selection` / 当前筛选条件映射成 `ids` 或 `mode:"filtered"` 传给后端。
3. 修好后重写 I-06 用例（现在的判定标准在旧壳上无法执行）。

---

## D-04 构建在缺 Node 时静默回退到已有 `dist/`，可能「改了前端却在测旧前端」

| 项 | 内容 |
|---|---|
| 关联用例 | 无（I-12 执行过程中现场发现） |
| 严重程度 | 中（P1）。不会让功能出错，但会让**测试结论失真** |
| 影响范围 | 所有未把 `frontend/explorer/dist/` 提交进仓库的环境（本仓库 `dist/` 未入库，见 PLAN_REVIEW G-01） |
| 证据 | I-12 实测：把 PATH 里的 node 全部剔除后 `dotnet build` 仍 `exit=0`，输出 `warning : 未找到 Node.js，跳过前端打包，直接使用已有的 dist/` |

**复现步骤**

1. 临时把 PATH 中的 `node.exe` 全部移除（或用独立 shell 只保留 dotnet）。
2. `dotnet build src/IPSys.Web/IPSys.Web.csproj -c Release`。
3. 观察：构建**成功**，只给一条 `warning`，前端资源用的是磁盘上残留的 `dist/`。

**根因假设**

csproj 里拉起 Node 打前端包的那个 MSBuild target 把「找不到 Node」当成了可跳过的软失败，只 `Warning` 不 `Error`。叠加 `dist/` 未入库，在干净 clone 上会直接构建失败或嵌入空资源，在「有旧 dist 残留」的机器上则会静默嵌入**旧前端**。

**修复建议**

1. 把该 target 的「找不到 Node」从 `Warning` 升级为 `Error`（或提供 `SkipFrontendBundle=true` 显式开关，默认必须打包）。
2. 在构建产物里写入前端 bundle 的 SHA/时间戳，测试脚本启动时校验「运行的前端 == 源码构建的前端」。
3. `dist/` 要么入库，要么在 `.gitignore` 之外显式声明「必须现场构建」，并在 CI 里断言产物存在。

---

## D-05 待确认上传票据悬挂会让「压缩数据库」永久失败，UI 无可见入口取消

| 项 | 内容 |
|---|---|
| 关联用例 | 无（K-03 首轮执行时现场发现，并导致 K-08/K-12 首轮假失败） |
| 严重程度 | 低-中（P2）。可恢复（取消票据或重启），但报错文案指向性弱，用户无从下手 |
| 影响范围 | 上传被打断（关标签页、断网、进程被杀）后仍留有待确认票据的场景 |
| 证据 | `build-retest/phase2/evidence/cases/K-03.json`；同轮 `K-08`/`K-12` 首轮记录（`error:"仍有尚未完成的原件写入，禁止压缩。"`） |

**复现步骤**

1. 用 `prepare` 上传一个 12 MiB 文件，拿到返回体里的 `ticket`（此时对象 `state='writing'`）。
2. **不做** `resolve` 也不做 `DELETE /api/v2/files/{ws}/prepared/{ticket}`。
3. 请求 `POST /api/vault/compact {"Confirm":true}` → 任务 `state=failed`，`error="仍有尚未完成的原件写入，禁止压缩。"`。
4. 一直重试都失败；`DELETE .../prepared/{ticket}` 之后立刻恢复（实测 `writing 1→0`、chunks `496→380`、`integrity=ok`）。

**根因假设**

`PendingFile` 是**进程内**状态，而半成品对象写在库里（`file_objects.state='writing'`）。票据过期只在「下一次 prepare」时被动清理（`NativeFileChoiceEndpoints.cs` 的 `previous.ExpiresAt` 分支），压缩入口只检查「有没有 writing 对象」，于是形成「没有 UI 能看见、也没有 UI 能清掉」的死角。重启宿主可清（本轮实测：重启后 `check=ok`、prepare 恢复正常）。

**修复建议**

1. 压缩入口遇到 `writing` 对象时，除了拒绝，还要**指出是哪个对象/哪次上传**，并给出「取消该次上传」的入口。
2. 把「清理过期票据」做成主动任务：启动时 + 定时扫描 `state='writing'` 且票据已过期的对象并回收。
3. 关闭上传对话框（Esc / 点 X / 关标签页）时应显式调用 `DELETE .../prepared/{ticket}`。
