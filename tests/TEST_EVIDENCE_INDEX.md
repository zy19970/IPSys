# IPSys 测试证据索引（更新至 2026-11-02）

> 本索引区分最新产品自动化、历史运行、原始 Agent 报告与人工反馈，不改写旧报告原始失败或阻塞。最近产品代码 `4567ae96b7` 对应 [Windows CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) completed/success，文档更新后的主分支 SHA 不应冒充产品已重新验证。

## 最新操作细节收敛证据（2026-11-02）

| 内容 | 核验状态与证据 |
| --- | --- |
| Windows 最新完整构建 | `4567ae96b7` 对应 [Windows CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499)，26 success、0 failure、2 个可选超 4 GiB ZIP64 步骤 skipped；自包含 EXE artifact 13127470070、依赖版 13126672442、Explorer 复测 13126004336 核验时未过期 |
| 统一普通资料文件夹 | [CI #470](https://github.com/zy19970/IPSys/actions/runs/41406914227) 成功：普通文件夹可以同时有附件与下级，属性选填 |
| 单一新建、菜单与日期 | [Windows CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 验证单动作直达；[移动图标 CI](https://github.com/zy19970/IPSys/actions/runs/41409289266) 和 [更新时间 CI](https://github.com/zy19970/IPSys/actions/runs/41380005969) 成功 |
| 目录回收和共享 | [整树回收 CI](https://github.com/zy19970/IPSys/actions/runs/41296113671) 与 [成功进度面板 CI](https://github.com/zy19970/IPSys/actions/runs/41298466274) 成功 |
| Excel/知识产权 | 模板 11/19/6/3；十种知识产权类型、三编号，合同无独立 Excel；旧档案 4 列、综合资料 1/2 列为历史导入兼容 |
| MCP/Agent | 当前 64 项工具和相关标准 Windows 回归已验证；第三方真实 Agent 的自主任务仍需独立实机报告 |
| Release | 最新正式预发布 v0.9.1-rc1（2026-10-23）；新的 Actions artifacts 不自动进入 Release |

## 合并时的历史门禁

| 项目 | 证据和边界 |
| --- | --- |
| Debug/Release、单 EXE、MCP、Node、Edge/HTTP、SQLCipher | [main CI #39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) 成功，产物包含 Windows EXE 与 V2 回归证据 |
| 2 GiB+ SQLCipher/HTTP、VACUUM | [专项 CI #39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663) 成功，真实执行大库压缩并检查完整性 |
| 4 GiB+ ZIP64 物理生成 | [专项 CI #39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) 成功，产物长 4,462,739,982 字节，SHA-256 `8DED57C97E10F169CDA7E459A3648422B15337EDA9B5C7F61BF263C747E3AB32`，**PASS_GENERATION_ONLY** |
| Windows 用户本机大文件及保存 | 用户明确反馈已经真机验证通过；无上传的独立解包哈希/全套手动截图，须与 CI 证据区分 |
| 分支历史 | 2026-10-23 合并时从 `c22ea1f` 非强制快进到 `8227d2c`，当时新增 74 个提交、分支 compare identical；后来工作分支已清理，当前仅 `main` |

## 阶段原始报告与裁决

| 轮次 | 证据入口 | 原始结论及解释 |
| --- | --- | --- |
| 初版 Explorer V2 | [38 项报告](./retest-v2-2026-10-22/IPSys_Explorer_Full_Retest_V2_Report.md)、[勘误](./retest-v2-2026-10-22/IPSys_Explorer_Full_Retest_V2_Errata.md) | 当时的缺陷和环境限制；`scripts/` 正在被 CI 引用，不能删除 |
| 2026-10-22 Agent 复验 | [报告](./agent-validation/20261022-185856-49ecf63/REPORT.md)、[误报裁决](./agent-validation/20261022-185856-49ecf63/ADJUDICATION.md)、[缺陷](./agent-validation/20261022-185856-49ecf63/DEFECTS.md) | 当时 38 项完整回归，后续修复不反向改写 |
| Phase2 132 项 | [任务书](./IPSys_Explorer_Phase2_Agent_Complete_Retest.md)、[CSV](./IPSys_Explorer_Phase2_Agent_Test_Cases.csv)、[报告](./agent-validation/phase2-final-20261023-0112-f5d206a/AGENT_TEST_REPORT.md) | 126 PASS / 1 BUG / 3 BLOCKED / 2 GAP（当时 401 P0 后续修复） |
| Phase2 16 项补测 | [任务书](./IPSys_Explorer_Phase2_Supplement_Agent_Test_Plan.md)、[CSV](./IPSys_Explorer_Phase2_Supplement_Test_Cases.csv)、[报告](./agent-validation/phase2-supplement-20261023-1115-178cf558/SUPPLEMENT_TEST_REPORT.md) | 9 PASS / 3 BLOCKED / 1 GAP / 3 BUG（当时状态）；后续 D-01、D-02、D-05 已修复并复验 |
| 第三批原生保存与跨区物理隔离 | [任务书](./IPSys_Explorer_Phase3_Real_Windows_Agent_2026-10-23.md)、[报告](./agent-validation/phase3-real-save-20261023-a18b47b/PHASE3_REPORT.md)、[证据](./agent-validation/phase3-real-save-20261023-a18b47b/EVIDENCE_INDEX.md) | 小 ZIP 真实落盘 SHA 核验、物理隔离 SQL 违规 0；Agent 无法完全操作 Windows 保存框，后由专项 CI 与用户人工反馈分别补充 |
| MCP 旧 70 工具黑盒 | [旧报告](./mcp-results/2026-10-17/MCP_TEST_REPORT.md)、[索引](./mcp-results/2026-10-17/MCP_EVIDENCE_INDEX.md) | 37 项中 28 PASS / 0 FAIL / 9 BLOCKED；不等于当前 64 工具在独立 Windows 环境下的实机验收 |

旧 V2 的 `T-P2-02` 程序化 drop 未经过真实 dragstart，不能单独证明用户鼠标拖放失败。大库 VACUUM 的旧超时已经通过修改测试等待预算并实际完成压缩收敛；ZIP64 初稿 TextEncoder 导入失败已修复。所有历史原始状态仍保留。

验收需使用当前源码和相应 CI 与 Agent 数据，不凭旧文件标题中的“当前/尚未合并/待修复”覆盖最新事实。合并前历史材料见 [审查](./IPSys_Explorer_PreMerge_Readiness_2026-10-23.md) 和 [交接](../docs/IPSys_Explorer_主分支合并_新会话交接_20261023.md)。
