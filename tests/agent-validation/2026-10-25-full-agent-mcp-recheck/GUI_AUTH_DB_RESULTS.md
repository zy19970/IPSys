# A11 / A12-rev / A12-db / A14-gui：GUI 相关项执行情况

> 结论先说：**四项全部未执行（A11 = NOT_RUN，A12-rev = BLOCKED，A12-db = BLOCKED，A14-gui = NOT_RUN）**。
> 被测 Agent 无法操作 GUI（本机是 DESKTOP 桌面程序 + 内嵌 Web 视图，没有可脚本化的窗口句柄），
> 按任务书要求，未获得真实人工结果前**不代填、不判 PASS**。

## 一、本轮实际做过的替代性检查（仅能证明鉴权有效，不能替代 GUI 验收）

| 检查 | 方法 | 结果 |
|---|---|---|
| 未登录直接访问规范接口 | `curl http://127.0.0.1:16297/api/agent-guidance` | **401**（空 body） |
| 同上，单篇 | `/api/agent-guidance/search` | **401** |
| 同上，导出 | `/api/agent-guidance/export` | **401** |
| 用户级覆盖层现状 | `Test-Path %LOCALAPPDATA%\IPSys\agent-guidance.json` | 目录不存在 → **没有任何自定义覆盖**，因此"恢复测试前状态"的前置条件是天然满足的（无文件可恢复） |
| 规范读取本身 | `get_agent_guidance` 三篇 + `prompts/get` 三篇 | 逐字相等（见 `recheck-data/a02_a05.json`），但这是**读**，不是编辑 |

**以上都不能说明"GUI 编辑已验收"**，任务书明确禁止用 401 或读接口冒充 A11。

## 二、需要你做的操作（最小集，一次性做完约 6 分钟）

### 步骤 0：前置确认

1. IPSys 已启动，**打开的是 `E:\IPSys数据管理平台\IPSys-test.db`**（本轮测试库，不是正式库）。
2. GUI 里 MCP 授权处于**开启**状态。

### A11：规范管理（设置 → Agent 工作规范）

3. 打开“设置 → Agent 工作规范”，截一张**目录页**：应显示 `index / search / upload / metadata`，且 index 只有目录、没有正文编辑框。
4. 点 `search` → 在正文**末尾**追加一行唯一测试文字：`R2-TEST-20261025-A11`
5. 保存 → **记下界面显示的 source / version / revision 三个值**。
6. 点 `upload` → 同样追加 `R2-TEST-20261025-A11-UPLOAD` → 保存。
7. 点 `search` 的“恢复默认” → 保存。
8. 点“导出” → 把导出的 JSON 文件另存到 `E:\Github\Transfer2DB\work\acceptance_r2\gui\export.json`。
9. 点“导入” → 选刚才导出的那个文件 → 确认。
10. 在**两个不同的浏览器/窗口**同时打开同一篇的编辑框，先在 A 保存，再在 B 保存 → 记录 B 是否被拒（应提示 revision 冲突）。
11. 把 `search` 篇恢复默认，确认**其他两篇内容未变**。

**需要回给我的**：第 3 步截图、第 5 步三个值、第 8 步导出的 JSON 路径、第 10 步的报错原文、第 11 步前后 `upload`/`metadata` 是否一致。

### A12-rev：MCP 撤权

12. 在 GUI 里**关闭 MCP 授权**（不是关闭软件、不是杀进程），保持软件开着、库解锁。
13. 回我一句“已关闭授权”。

**需要回给我的**：只这一句。之后我会立刻用 MCP 客户端请求 `get_agent_guidance(search)` 与 `prompts/get(search)`，记录错误码；再请你**重新打开授权**，我再复测恢复读取。

### A12-db：跨库隔离

14. 在 GUI 里**新建**一个空库：`E:\IPSys数据管理平台\Acceptance-B.db`（SQLCipher，密码自定，不用告诉我）。
15. **不要**立刻切过去，先回我一句“B 已建好”。

**需要回给我的**：这一句。之后请你切到 B，我查 files/projects 应为空、A 的 FileId 不可见；再切回 A，我核对 SHA/版本不变。
（company/personal 切换**不算**跨库实验，不要用这个代替。）

### A14-gui：界面适配

16. 把窗口拖到两种宽度（约 1280 与 1920），分别截图“规范编辑区”：看能否滚动、长文本预览是否正常、保存/恢复/导入导出按钮是否错位。
17. 把 Windows 缩放从 100% 调到 150%，再截一张。

**需要回给我的**：3 张截图（或一段录屏）。

## 三、我会怎么用这些结果

| 你返回什么 | 我更新什么 |
|---|---|
| 步骤 3/5/8 + 导出 JSON | 用 `get_agent_guidance(search)` 与 `prompts/get(search)` 逐字比对，验证"GUI 保存 → MCP 生效"，判 A11 的编辑/版本/导出导入子项 |
| 步骤 12 的一句话 | 立刻做 A12-rev 真撤权测试（两个接口都不得返回正文），记录 JSON 错误码；再复测恢复 |
| 步骤 15 的一句话 | 做 A12-db 两库对比：B 中 FileId/LinkId 必须全空，A 原件 SHA/版本不变 |
| 步骤 17 的截图 | 判 A14-gui 的滚动/预览/布局 |

在上述结果到位前，**A11 / A12-rev / A12-db / A14-gui 一律保持在未执行状态**，不写 PASS。
