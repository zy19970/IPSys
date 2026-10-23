# IPSys Explorer 开发分支合并回 main：新会话交接文件

> **交接日期：2026-10-23**  
> **交接目的：** 在新的 ChatGPT 会话中直接执行 `work/onedrive-file-manager` → `main` 的合并前核对、合并及合并后验收。  
> **本次交接仅新增文档，不代表已合并。**  
> **用户最新验收决定：** 用户明确表示“我已经真机验证过了”，确认此前留给用户本人处理的实际机器验证已经完成。对该结果按**用户人工验收通过**记录；不要求新会话重复让本地 Agent 操作 Windows 保存窗口或解包器，也不伪造未上传的截图、逐字节哈希或第三方解包日志。

## 0. 新会话首先执行什么

仓库：<https://github.com/zy19970/IPSys>  
源分支：`work/onedrive-file-manager`  
目标分支：`main`  
**编制时、提交交接文件前**源分支 HEAD：`d1bb3e99ed098a9c657025f5a9376815e8e041e6`  
**编制时**目标分支 HEAD：`c22ea1f836b5e3763780a674f1cbb1f56fb68d05`  
本交接文件自身提交后，源分支 HEAD **会再次前进一个仅文档提交**；新会话必须获取实时 HEAD，不能把上述 SHA 当成最后待合并 SHA。

1. **先读取** <https://github.com/zy19970/AIGT-templates/blob/main/AGENTS.md> 和 <https://github.com/zy19970/AIGT-templates/blob/main/AI_RULES/GIT_OPERATIONS.md>，遵守 Git 原子提交、通知、禁止强推和不覆盖用户既有工作等规定；按规则读取 `main` 的完整提交历史及提交说明。
2. 读取**本文件**、[合并前审查报告](../tests/IPSys_Explorer_PreMerge_Readiness_2026-10-23.md)，必要时核对 [第三批 Agent 报告](../tests/agent-validation/phase3-real-save-20261023-a18b47b/PHASE3_REPORT.md) 和现行 `.github/workflows/web-windows.yml`。
3. 读取 GitHub **最新**的两个分支 SHA、`compare/main...work/onedrive-file-manager`、保护规则或可能阻挡推送的状态、当前 HEAD 相应 CI。检查是否有新增提交、合并中状态或未完成工作。
4. 若 `main` 仍是开发分支祖先、关键 CI 通过且变更审查无新的 P0 风险，则在用户新会话**明确提出开始合并**时，采用**非强制、受 HEAD 比对保护的快进方式**把 `main` 前进到开发分支 HEAD，保留所有历史提交；不要另建临时分支、做 squash/rebase 或创建 PR，除非直接合并受平台规则限制或用户明确改变流程。
5. 合并后读取 GitHub 最新 refs，验证 `main` 与原目标开发分支处在期望提交、无遗漏分叉，再审查合并后 `main` Windows Actions 的构建与 SQLCipher/Edge/MCP/Node 回归；将是否成功、最终 SHA、运行链接及未解决的真实问题报告给用户。

**特别注意：** 目前用户要求“写交接文件，准备到新会话开展主分支合并”，**不是授权本会话马上合并**。因此编制本文件期间严禁更新 `main`。

## 1. 为什么可以考虑合并：项目阶段、范围与设计边界

这次开发分支是对早期 IPSys 文件管理页面进行 OneDrive / Windows Explorer 风格的成体系重构，目标为界面共用、操作一致、功能完整、跨工作区与 SQLCipher 原件链路安全、可维护的 WinForms + 本机浏览器架构。**不是把所有业务数据搬到 OneDrive，也不是恢复旧静态单页。**

已经冻结且必须继承的约束：

1. Windows **WinForms 启动器 + 127.0.0.1 本地 HTTP 后端 + Edge/Chrome Explorer 前端**，前端源码位于 `frontend/explorer/`，构建产物作为资源嵌入 `IPSys.Web.exe`；不要因为旧 `src/IPSys.Web/wwwroot/index.html/app.js/style.css` 被移除而误判丢失功能。
2. SQLCipher V2 仍是单库分公司/个人工作区。Folder 无版本；File 有版本；`folder_file_links` 连接业务 Folder 和文件；`file_objects/file_chunks` 存储实际加密字节。
3. 同工作区可显式共享 FileId 或物理对象，**跨工作区禁止共享物理 FileObject**，必须独立复制，并保留文件版本、合同隶属项目、知识产权原件及业务记录间的关联。
4. 用户尚处开发阶段，早已说明旧数据库为测试数据，无须为 Explorer 合并新增 V1→V2 的历史数据迁移工程；但**不能以此授权删除或重置用户现有资料库**。
5. 文件上传、下载、跨区转移、删除与压缩均需遵守文件任务锁、用户确认、原始工作区绑定、错误状态可见、可恢复性；不可为了测试全绿放宽安全约束。

先前确定的第二阶段 `F2-01` 至 `F2-06` 已实现：创建数据库/会话恢复入口、业务档案多级目录与混排排序、附件关联共享与移动、业务记录复制转移、内部拖放、统一右键菜单及入口。详见 [F2 功能计划](./EXPLORER_PHASE2_FUNCTIONAL_COMPLETENESS_2026-10-22.md)。

## 2. 最近三批缺陷与风险收敛记录

| 阶段 | 修复内容 | 相关提交 / 证据 | 现在的判定 |
|---|---|---|---|
| 第一批 D-01（P0） | HTTP 401 时清理旧令牌和页面状态、回登录界面，修复重新连接按钮及异步旧请求干扰新会话；其他 403/409/500 不误判为过期 | `d21aae1`、测试修正 `9445d8f`；[Actions 39918269383](https://github.com/zy19970/IPSys/actions/runs/39918269383) | 已修复，Windows CI 通过 |
| 第二批 D-02 | 外部拖放无效目标时给出明确反馈；防止已处理行事件再落入整个页面处理而重复上传；文件任务忙则拒绝 | `6598ead` 等；[Actions 39919947615](https://github.com/zy19970/IPSys/actions/runs/39919947615) | 已修复，Windows CI 通过 |
| 第二批 D-05 | 重新登录后查询尚未确认的上传原件，设置中安全取消精确 ticket / 工作区对应的暂存；压缩前核查未完成原件 | `6598ead`、`c6a3524`、`011602eb`；同上 | 已修复，原生接口/UI 回归通过 |
| 第三批隔离 | 用真实 SQLCipher 检查跨工作区的不同 FileObjectId、完整 FileVersion 历史、Chunk 字节总量与 SHA | `14fd8a8`；[Actions 39923548693](https://github.com/zy19970/IPSys/actions/runs/39923548693)；Agent SQL 证据 | 数据隔离检查通过，违规 0 |
| C-01 大库压缩 | 原固定约 36 秒轮询导致 >2 GiB 数据库 VACUUM 被过早标为失败；改用 Stopwatch 与按体量计算的等待预算，仍以成功终态和 `integrity_check` 为准 | `e18ad605`；[Actions 39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663)：22/22 步，**>2 GiB SQLCipher/HTTP + VACUUM** 通过 | 已收敛；不是通过跳过压缩获得的假绿灯 |
| ZIP64 大文件 | 调用正式 ZIP 导出函数、流式生成**实际占用磁盘空间**的 ZIP64 文件，检查 ZIP64 EOCD、locator、中央目录、条目及保存的起始字节、完整 ZIP SHA-256 | `7b340b2`、测试依赖修正 `d457a807`；[Actions 39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866)：24/24 步 | **物理生成验证通过；用户另行确认真机人工验证通过** |

> ZIP64 精确信息：实际生成 `4,462,739,982` 字节，包含两条各 `2 GiB + 80 MiB` 的原件流；ZIP SHA-256 为 `8DED57C97E10F169CDA7E459A3648422B15337EDA9B5C7F61BF263C747E3AB32`。Windows CI 保留小型 JSON 证据并清理约 4.46 GB 的临时 ZIP。测试输入为生成的可重复数据流以及程序化保存句柄，但**ZIP 字节确实由产品 `wwwroot/export.js` 生成并写入磁盘**；CI 没有伪称做过 Windows 原生保存窗口/第三方解压器测试。

### 2.1 用户人工验证的最终口径

此前 Agent 因 Windows 文件保存对话框难以自动操控，将 ST3-01/02/03 的部分动作记为 `NOT_RUN` 或 `BLOCKED`，这些是**当时该 Agent 那次执行的记录**。用户随后先明确反馈**超过 2 GB 的 UI 上传/下载已经由本人真机测试，没有问题**；此次又明确表示**已经完成真机验证**，这是新会话应承认的人工验收结论，包含前次约定由本人手动确认的 ZIP64 真实使用环节。**人工验证的具体文件路径、解包日志、SHA 明细未在本交接时上传，不能反向伪造。**

正常 ZIP 的真实落盘、三份项目/合同附件 SHA 与目录层级已由第三批 Agent 的 `explorer-export-audit.json` 留证。跨区复制的只读 SQL 证据见 `st304-objects.json`，共四组独立物理对象及对应版本，没有违规。

**不要为了“保持报告数字一致”去覆盖旧 Agent 报告，也不需仅因自动控制保存窗口的技术限制而阻断已由用户完成的人工验收。**

## 3. CI 与已知历史红灯的解释

最新功能代码所依据的成功工作流：

1. [#39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663)，SHA `e18ad6051f6f3461d2631128a7fbedc2d990e033`，**22/22 PASS**，确实开启 `IPSYS_LARGE_FILE_SMOKE=1` 并执行大库 VACUUM。
2. [#39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866)，SHA `d457a8077fd05923e9cbb30af73d545691cdc70f`，**24/24 PASS**，确实写入 4.46 GB ZIP64 后生成元数据证据并删除 CI 临时大文件。
3. 前端、MCP、Explorer Edge/HTTP、Debug、单 EXE Release、SQLCipher 回归均在对应最新 CI 链路覆盖。位于 `d457a807` 后面的 `d1bb3e99` 以及**本交接文件提交**为**仅 Markdown 文档**，默认路径过滤不触发新构建；不能错误宣称 CI 在本交接最终 SHA 上运行过，也不必无故重复大文件测试。

历史运行 `39923781118` 曾在大库 VACUUM 固定时间预算下失败，已由 `39943364663` 修复复验；ZIP64 初稿 `39944150498` 因 QA 脚本从错误的 Node 模块导入 `TextEncoder` 失败，后由 `d457a807` 修正并由 `39944440866` 全绿。新会话**不要引用这些旧红灯当作当前未修复产品问题**。

`docs/retest-v2-2026-10-22/scripts/t-browser.cjs` 的 `T-P2-02` 旧测试对目标直接派发程序化 `drop`，没有建立产品内部拖放所要求的真实 `dragstart`/关联上下文，因此报告中的 `CONFIRMED_BUG` 不是有效的“真实鼠标拖放失败”证据。专门的前端事件回归已有覆盖；只有新证据能独立复现时才升级为产品缺陷。

## 4. 合并前差异、风险与禁止事项

2026-10-23 编制时的 GitHub 比较：

| 检查 | 结果 |
|---|---|
| `main` | `c22ea1f836b5e3763780a674f1cbb1f56fb68d05` |
| 开发分支（本文件提交前） | `d1bb3e99ed098a9c657025f5a9376815e8e041e6` |
| 提交关系 | `ahead=73`、`behind=0`、GitHub `status=ahead` |
| 完整 Git tree 差异（非仅比较 API 前 300 条） | 新增 **516**、修改 **25**、删除 **11** 个文件 |
| 新增主要构成 | Explorer 前端/业务代码、专项测试与文档；大量 `docs/agent-validation/` 验收证据 |
| 旧文件删除 | `src/IPSys.Web/wwwroot/index.html`、`app.js`、`style.css`、部分旧 Node smoke，被 `frontend/explorer/` 源码、打包内嵌页和现行回归替代 |
| 主分支是否已经合并 | **否**；本交接时 `main` 仍为上述旧 HEAD |

因为开发分支与 main 涉及的累计修改较大，正式合并前应复核：新旧入口不会同时生效；Release 单 EXE 的打包资源不是过期 `dist/`；数据库 Schema/数据保护未放宽；Git 历史没有上传密码、QA 数据库或实际几 GiB 文件；验收文件保留原样。

不得未经用户授权使用 `reset --hard`、`clean -fd`、`push --force`，不得为使旧 CI 脚本全绿而撤销已冻结的业务功能或安全措施；也**不得删除 `work/onedrive-file-manager`**，除非用户后来明确要求清理分支。

## 5. 下一会话的建议操作序列（针对“执行合并”）

### 阶段 A：更新事实而不是重新研究需求

先读取规则和本交接，确认 `main`、开发分支两个远端 HEAD，以及 compare 的 ancestry。若仍为 `ahead > 0, behind = 0`，fast-forward 通道成立；若有人新推 `main` 导致分叉，必须重新审查冲突和差异，禁止强制覆盖。检查最新正常构建对应的源码 SHA，确认后续改动仅文档时不重复跑昂贵 2GiB/4GiB 测试。

### 阶段 B：执行受保护的快进合并

用户在新会话发出明确合并指令后，最短方案是通过已连接 GitHub 工具，在**当前 `main` SHA 作为 expected SHA** 的前提下，将 `main` ref 快进到**当前** `work/onedrive-file-manager` SHA，且 `force=false`。只有服务端确认更新成功后，才能宣告已合并。若主分支保护禁止直接推送，就报告具体阻拦原因，并按平台许可和用户决策选择 PR，不凭空建立 PR、也不强行绕过保护规则。

### 阶段 C：合并后的核验

获取 `main`、开发分支 refs，证实合并目标 HEAD 完全一致或关系符合预期；检查 GitHub Actions 是否触发了 `main` 的 Windows 构建，尤其 Debug/Release、Explorer Node、Edge/HTTP、SQLCipher、MCP 与原生会话回归。已有大库/ZIP64 专项属于提交时 opt-in 验证，合并后常规 CI 不再自动跑 4 GiB，不应以此误判覆盖不足；有产品代码新变化才判断是否必须重测。

合并结果记录最终 SHA、compare、CI 链接、文件/历史完整性、是否仍保留开发分支，并更新正式交接状态。**合并成功不等于产品发布**；如用户另行提出发布安装包，再开展交付工作。

## 6. 重要证据入口（优先读这些，不需重读数百份文件）

1. [合并前审查与两项收敛](../tests/IPSys_Explorer_PreMerge_Readiness_2026-10-23.md)。
2. [第三批 Windows 实机测试原始报告](../tests/agent-validation/phase3-real-save-20261023-a18b47b/PHASE3_REPORT.md) 与 [原始证据索引](../tests/agent-validation/phase3-real-save-20261023-a18b47b/EVIDENCE_INDEX.md)。
3. [第三批 Agent 实机任务书](../tests/IPSys_Explorer_Phase3_Real_Windows_Agent_2026-10-23.md)。
4. [ZIP64 物理归档生成与本机留存指南](../tests/IPSys_Explorer_ZIP64_Generation_Only_2026-10-23.md)。
5. [第二阶段完整性计划](./EXPLORER_PHASE2_FUNCTIONAL_COMPLETENESS_2026-10-22.md)、[132 项原始验收任务书](../tests/IPSys_Explorer_Phase2_Agent_Complete_Retest.md) 与 `docs/agent-validation/phase2-final-20261023-0112-f5d206a/` 原始结果（只作历史，不自动改写状态）。
6. CI: [大库 VACUUM 绿灯](https://github.com/zy19970/IPSys/actions/runs/39943364663)，[ZIP64 物理生成绿灯](https://github.com/zy19970/IPSys/actions/runs/39944440866)。
7. 原有 `HANDOFF.md` 是较早阶段文档，包含 “Agent 尚未验收” 和旧前端路径等**历史表述**，不能优先于此文件和实时 Git 状态。

## 7. 推荐直接发到新会话的指令

> 请先读取 `zy19970/AIGT-templates` 的 `AGENTS.md`、`AI_RULES/GIT_OPERATIONS.md`，再读取 `zy19970/IPSys` 的 `work/onedrive-file-manager` 分支文件 `docs/IPSys_Explorer_主分支合并_新会话交接_20261023.md`。我已经完成之前讨论的本机真机验证。请以仓库当前状态为准，先完成 `work/onedrive-file-manager` 到 `main` 的最终安全核对；确认可快进合并且没有新增阻断后，直接将开发分支合并回 `main`，不得强推或覆盖历史。随后核对 main 最新提交、Windows CI 及交付状态，并保留开发分支。无需重新从头开展 132 项 Agent 测试，也不要仅因 Agent 无法控制系统保存窗口否定我的人工验收。

---

**最终交接状态：** 功能开发、三批风险修复、2 GiB SQLCipher/HTTP 和大库压缩、4 GiB ZIP64 实际生成、跨空间物理隔离与本地 Agent 取证均已完成对应范围内的收敛；此前需要人工验证的项目由用户明确确认已真机验证。**尚未执行的唯一主操作是开发分支合并 `main` 及合并后的新 CI/状态验收。**
