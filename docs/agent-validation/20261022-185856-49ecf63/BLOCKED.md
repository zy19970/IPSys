# BLOCKED — 仍未闭环的 4 项

本轮 16 项历史 BLOCKED 里**关闭 12 项**，剩 4 项。每项都写清：最初动作、实际障碍、已试过的替代、复跑路径、为什么还得不出产品结论。

---

## T-P1-08 ZIP 导出进行中切工作区

**最初动作**
在 `k:project` 里选中全部记录 → 右键「打包下载」→ 400 ms 后调用 `switchWorkspace('personal')`。

**实际观察**
- 右键菜单里有「打包下载」，点击成功；
- 导出请求已发出；
- 立刻切到个人工作区，**切换成功，没有任何阻断提示**；
- 但整个打包在秒级完成，无法确定切换发生时导出是否仍在进行。

**已经试过的替代**
1. 加大选择集（把项目下全部 7 个条目都选上）——总量仍不到 10 MB，打包依旧瞬完；
2. 想用 CDP `Network.emulateNetworkConditions` 限速——导出走的是 blob 生成，限速不影响本地打包耗时；
3. 想抓 `export.js` 的任务状态标志——该脚本没有暴露可观测的"进行中"状态。

**为什么得出不了结论**
"未阻断"只有在**导出确实还在进行**时才有意义。当前证据只能证明"点得下去、切得成功"，不能证明"导出期间切"。

**复跑路径（最小条件）**
1. 在隔离库造一个 ≥ 200 MB 的记录（或 33MiB × 8）；
2. 用 CDP `Fetch` 域把导出响应 `requestPaused` 住，人为延长到 15 秒；
3. 在暂停期间切工作区，记录是否出现确认框 / 是否排队 / 是否输出错工作区的包。

**关联证据**：`evidence/cases/T-P1-08.browser2.json`

---

## T-P2-08 Excel 导入端到端

**最初动作**
准备三份 XLSX（合法行、字段错误行、重复数据行），在浏览器里通过真实文件选择器导入，然后回查落库与导出。

**实际障碍**
- 本轮把时间优先投给了 P0 与 PDF/导出/清空三条线上，没有构造三份真实 XLSX；
- 驱动原生文件选择器需要 CDP `DOM.setFileInputFiles`，需要先拿到文件输入的 nodeId，本轮未接线。

**已经试过的替代**
用 `export` 的产出反推导入格式（`R-02` 产出了两个合法 xlsx），只能证明导出侧闭环，不能代替导入。

**为什么得出不了结论**
"Excel 导入"的核心判据是**错误行逐项反馈**与**重复数据策略**，这两条必须真的喂进文件才能看。

**复跑路径（最小条件）**
1. 用 `R-02` 已产出的 `export-all-projects.xlsx` 作为"合法样本"直接回灌；
2. 手工改两行：一行把编号列留空、一行复制同一编号，得到"错误样本"与"重复样本"；
3. `Page.setInterceptFileChooserDialog` + `DOM.setFileInputFiles` 注入；
4. 记录：落库行数、错误行提示文案、重复行的处理（跳过/覆盖/报错）。

**关联证据**：`evidence/BLOCKED.md`（本条）、`evidence/export-all-projects.xlsx`（可直接复用为合法样本）

---

## T-P2-14 上传 / purge 的进度与刷新后恢复

**最初动作**
上传一个大文件，观察进度条阶段文案、取消、失败，以及刷新后任务是否恢复。

**实际障碍**
- 上传入口是原生 `<input type=file>`，headless 下文件选择器不会真弹出；
- 需要在 `pickFiles()` 创建 input 之后立刻拿到该元素并 `DOM.setFileInputFiles`，本轮脚本只做了桩拦截，没有回填文件。

**已经试过的替代**
服务端侧的任务生命周期已完整覆盖：
- purge：`T-P0-04` / `R-01` / `X-03` 记录了 `202 → running → succeeded/failed` 与 `bytesDone/bytesTotal/count`；
- compact：`T-P1-07` 记录 `running → succeeded`，`reusableBytes 8192 → 0`。
这两条证明**服务端任务模型是完整的**，缺的是**前端面板的观测**。

**为什么得出不了结论**
任务书要求"100% 字节发送不等于服务端已提交"，这条必须在浏览器里看阶段文案才能判。

**复跑路径（最小条件）**
1. 在 `pickFiles()` 里 `document.querySelector('input[type=file]')` 拿到元素；
2. 用 CDP `DOM.getDocument` + `DOM.querySelector` 取 nodeId，`DOM.setFileInputFiles` 注入 `fixture-two-page.pdf` 与 33MiB 文件；
3. 在上传进行到 50% 时 `Page.reload`，看是否出现"任务恢复"面板；
4. 记录：阶段文案序列、取消按钮、刷新后状态。

**关联证据**：`evidence/cases/T-P0-04.http.json`、`evidence/cases/T-P1-07.http2b.json`

---

## R-06 上传 / 导出 / purge / 压缩四种任务 × 切工作区 / 关库

**最初动作**
四种任务各自进入活动窗口，分别试切工作区与关库。

**已完成的两格（可计入部分结论）**
| 任务 | 关库 | 证据 |
|---|---|---|
| 压缩(compact) | **409「文件任务执行中或程序正在退出，不能关闭数据库。」**，会话保留 | `T-P0-04` |
| 彻底删除(purge) | 20 次并发请求全部通过（见 `R-01` 的提交与轮询） | `R-01` |

**未完成的两格**
| 任务 | 障碍 |
|---|---|
| 上传(upload) | 与 `T-P2-14` 同因：无法在 headless 下真实喂文件，造不出活动窗口 |
| 导出(export) | 与 `T-P1-08` 同因：打包秒级完成，抓不到窗口 |

**为什么整条仍记 BLOCKED**
任务书明确要求"四种任务不能用一种测试泛化"。两格成立不能推出另两格成立。

**复跑路径**
先解掉 `T-P2-14` 的文件注入，再用同一套注入把 33MiB 上传拖到 10 秒以上；
导出用 `Fetch` 域把响应挂住。两者都能完成后，R-06 四格即可齐。

---

## 附：本轮已关闭的 12 项（对照）

| 历史 BLOCKED | 本轮结论 | 关键证据 |
|---|---|---|
| T-P0-04 | PASS | 任务窗口内 lock → 409，`/api/status` 仍 unlocked |
| T-P1-02 | PASS | 合同单删独立进回收站（parent=项目A），恢复后 projectId=15 |
| T-P1-06 | **CONFIRMED_BUG（BUG-019）** | 故障注入可执行，但"失败要显式提示"这一判据不成立：注入 archive 500 后页面照常渲染、零错误提示 |
| T-P1-07 | PASS | 先造可回收页（reusable 8192）再压缩，任务期 lock 409 |
| T-P1-09 | PASS | 受限 PATH 下 bundle 仍 exit=0 并生成 dist |
| T-P1-10 | PASS | A 版本=2 生效；B associate 后出现 2 个 linkId |
| T-P2-05 | PASS（后端） | 3 linkId，第 2 条 409，第 1/3 条 200，最终 0 条 |
| T-P2-10 | PASS | 0B/15B/31MiB/33MiB 全 lenMatch+shaMatch |
| T-P2-13 | PASS | 单文件 5.18MB，10 个内嵌资源全 200，无外部 URL |
| T-P2-15 | PASS | 空库 projects/contracts/trash 全 0，系统目录 7 个 |
| R-01 | CONFIRMED_BUG | 混合批次整批回滚（BUG-020） |
| R-04 | CONFIRMED_BUG | 树内丢 position 且目录节点丢失（BUG-010） |
