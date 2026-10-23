# 缺陷复现清单（补测实证）

基于 HEAD `178cf558e4a878aadf4734b8b3725fb029c4b692`（`work/onedrive-file-manager`）在隔离 QA 库上的真实复现。三条均为**原报告已登记缺陷的仍然存在**，不是本轮新发现。

## 汇总

| 缺陷 | 原编号 | 优先级 | 本轮状态 | 复现用例 |
|---|---|---|---|---|
| 运行期 401 不把用户引向重新连接 | D-01 | **P0** | CONFIRMED_BUG（仍存在） | SUP-13 |
| 非记录行区域外部文件拖放被静默丢弃 | D-02 | P1 | CONFIRMED_BUG（仍存在） | SUP-12 |
| 待确认上传票据悬挂后 UI 无入口取消 | D-05 | P1 | CONFIRMED_BUG（仍存在） | SUP-14 |

## D-01　运行期 401 不把用户引向重新连接（P0）

**复现（真实界面）**
1. 独立 Edge QA profile 解锁资料库，进入公司项目分类（列表 2 条记录）。
2. 用 CDP `Fetch.fulfillRequest` 对**仅一次** `/api/v2/search/*` 请求返回 401（可审计的网络层注入，不是改前端变量）。
3. 在搜索框真实键入关键字提交。
4. 结果：`VaultStore.token` 长度 64 → 0、`VaultStore.locked` = true，**但 `#lockScreen` 不显示、没有任何「请重新解锁」提示**；搜索区只显示注入的错误文本。
5. 刷新页面：5 个数据接口同时 401（`/api/v2/ui/projects|contracts|archive|project-files|ip`），界面只提示「刷新失败：项目加载失败：请求失败：401」。
6. 点「关闭资料库」：`POST /api/lock` 同样 401，提示「关闭资料库失败：请求失败：401」——用户被卡在既非登录也非注销的状态。

**对照（证明恢复路径本身是好的）**
- 有有效 token 时走「关闭资料库 → 输入密码 → 打开」一次成功（`pathFill` 覆盖了预填路径，`usableRows=2`）。
- 宿主真实关闭重启后，页面回锁屏「打开资料库」，填库路径+密码后可重新打开并读数据。

**根因定位**
- `frontend/explorer/js/store.js` 的 `api()` 收到 401 只做 `this.token=""; this.locked=true;`，**不调用 `showLogin()`**。
- 只有 `bridge.js` 走 XHR 上传时才会 `showLogin("登录已失效,请重新解锁资料库")`，普通 JSON 请求没有这条兜底。

**修复建议**：在 `api()` 的 401 分支统一调用 `showLogin()`（并保留原有的 token 清理），或让所有请求失败统一经一处处理；`/api/lock` 在 token 已失效时应能被本地放行或给出「会话已失效，请重新解锁」的可点入口。

## D-02　非记录行区域外部文件拖放被静默丢弃（P1）

**复现（真实文件拖放）**
1. 用 CDP `Input.dispatchDragEvent` 派发带 `files` 的 `dragEnter/dragOver/drop`，页面侧收到 `dataTransfer.types=["Files"]`、`files.length=1`（原生文件拖放，不是页面内构造 `DragEvent`）。
2. 首页空白处：`drop` 事件已派发、`defaultPrevented=true`，**无 toast、无上传进度、`.is-drop` 高亮为 0**，链接计数 55 → 55。
3. 项目内列表空白处：同样 `drop` 已派发、`defaultPrevented=true`，仍然无任何提示、零写入。
4. 记录行落点：`dragEnter/dragOver` 到达并触发 `.is-drop` 高亮，但 CDP 在 `draggable` 行上未派发 `drop`（测试工具边界，不作为产品结论）。

**根因（与 D-02 原假设一致，本轮已在源码复核）**
```js
// frontend/explorer/js/interactions.js
["dragover","drop"].forEach(t => document.addEventListener(t, e => {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();                       // ← 先把 defaultPrevented 置真
}));
document.addEventListener("drop", e => {
  if (!e.dataTransfer?.files?.length || e.defaultPrevented) return;   // ← 永远在这里 return
  ...
  else toast("请先进入具体业务记录，再上传附件");   // ← 这段永远到不了
});
```
**修复建议**：不要在后注册的兜底 handler 里用 `e.defaultPrevented` 做门禁；或者在先注册的那条 handler 里直接完成「非法落点 → 提示 + 阻止默认行为」，把提示与阻止合并到同一处。

## D-05　待确认上传票据悬挂后 UI 无入口取消（P1）

**复现（三条真实中断各一段）**
1. **正常取消**：上传 128 MiB 时真实点「取消上传」→ 面板显示「已请求取消…已保存 0，失败 0，跳过/未处理 1」，只读 SQLCipher `file_objects.state='writing'` 计数 **0**（前端 `finally` 的 `DELETE prepared/{ticket}` 生效）。
2. **关闭标签页**：先让同内容文件入库一次，再上传同一文件触发「上传内容检索」对话框（选项 `0:share-file / 0:reuse-content / independent / cancel`），此时用 CDP `Target.closeTarget` 真关标签页 → `writing` **+1**（票据已建立、`resolve` 从未发出）。
3. **中断网络**：128 MiB 上传中 `Network.emulateNetworkConditions offline`，面板如实显示「失败：sup14-interrupt.bin:Failed to fetch」→ `writing` **+1**。
4. 重开页面后再上传同一文件：被 409 挡住，提示「已有待确认文件，请先选择保存方式或取消。」——但**界面上既没有「保存方式」可点，也没有任何「取消待确认」按钮**（全页候选按钮为空数组）。
5. 此时在设置面板点「压缩」→ 二次确认 → 任务被安全拒绝，提示「压缩未完成：仍有尚未完成的原件写入，禁止压缩。」，且不给恢复路径。
6. 关闭资料库 → 重新打开（`Vault.Close()` 里的 `CleanupWriting`）后 `writing=0`，再压缩成功（446,992,384 → 309,858,304 字节），`integrity=ok`。

**判定要点**：压缩的保护性拒绝**不是**缺陷（符合设计）；缺陷是「票据悬挂后用户看不到、也取消不了，只能靠与本问题无关的『关闭资料库再打开』或重启宿主恢复」。

**修复建议**：在设置面板或上传面板给出「待确认上传统计 + 一键取消」入口（后端已有 `DELETE /api/v2/files/{ws}/prepared/{ticket}`）；压缩被拒时的文案应直接指向该入口。

## 未关闭的验收阻塞（不计为产品缺陷）

| 项 | 阻塞点 | 影响 |
|---|---|---|
| SUP-07 原生另存为 | OS 级「另存为」对话框 + Edge「保存密码？」气泡遮蔽页面点击 | 落盘 ZIP 层级与逐项 SHA 未取得 |
| SUP-05 ZIP64 | 同上（同一个 `chooseZip()` → `showSaveFilePicker`） | ZIP64 是否实际触发未验证 |
| SUP-04 UI 流式下载 | 同上（≥32 MiB 走 `streamToDisk`） | UI 下载未取得；已用同一服务的下载端点补齐 SHA 一致证据 |

