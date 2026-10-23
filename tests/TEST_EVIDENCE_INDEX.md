# IPSys 测试证据索引（2026-10-23）

> 本索引说明当时的测试结果、后续修复证据和当前主分支状态，不覆盖任何 Agent 原始测试报告。Explorer `work/onedrive-file-manager` 已安全合并 `main`，合并点 `8227d2c`；主分支 [Windows CI #39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) 成功。后续以 GitHub 实时提交为准。

## 合并时的最终门禁

| 项目 | 证据和边界 |
| --- | --- |
| Debug/Release、单 EXE、MCP、Node、Edge/HTTP、SQLCipher | [main CI #39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) 成功，产物包含 Windows EXE 与 V2 回归证据 |
| 2 GiB+ SQLCipher/HTTP、VACUUM | [专项 CI #39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663) 成功，真实执行大库压缩并检查完整性 |
| 4 GiB+ ZIP64 物理生成 | [专项 CI #39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) 成功，产物长 4,462,739,982 字节，SHA-256 `8DED57C97E10F169CDA7E459A3648422B15337EDA9B5C7F61BF263C747E3AB32`，**PASS_GENERATION_ONLY** |
| Windows 用户本机大文件及保存 | 用户明确反馈已经真机验证通过；无上传的独立解包哈希/全套手动截图，须与 CI 证据区分 |
| 分支历史 | 从 `c22ea1f` 非强制快进到 `8227d2c`，新增 74 个提交，保留工作分支且 compare identical |

## 阶段原始报告与裁决

| 轮次 | 证据入口 | 原始结论及解释 |
| --- | --- | --- |
| 初版 Explorer V2 | [38 项报告](./retest-v2-2026-10-22/IPSys_Explorer_Full_Retest_V2_Report.md)、[勘误](./retest-v2-2026-10-22/IPSys_Explorer_Full_Retest_V2_Errata.md) | 当时的缺陷和环境限制；`scripts/` 正在被 CI 引用，不能删除 |
| 2026-10-22 Agent 复验 | [报告](./agent-validation/20261022-185856-49ecf63/REPORT.md)、[误报裁决](./agent-validation/20261022-185856-49ecf63/ADJUDICATION.md)、[缺陷](./agent-validation/20261022-185856-49ecf63/DEFECTS.md) | 当时 38 项完整回归，后续修复不反向改写 |
| Phase2 132 项 | [任务书](./IPSys_Explorer_Phase2_Agent_Complete_Retest.md)、[CSV](./IPSys_Explorer_Phase2_Agent_Test_Cases.csv)、[报告](./agent-validation/phase2-final-20261023-0112-f5d206a/AGENT_TEST_REPORT.md) | 126 PASS / 1 BUG / 3 BLOCKED / 2 GAP（当时 401 P0 后续修复） |
| Phase2 16 项补测 | [任务书](./IPSys_Explorer_Phase2_Supplement_Agent_Test_Plan.md)、[CSV](./IPSys_Explorer_Phase2_Supplement_Test_Cases.csv)、[报告](./agent-validation/phase2-supplement-20261023-1115-178cf558/SUPPLEMENT_TEST_REPORT.md) | 9 PASS / 3 BLOCKED / 1 GAP / 3 BUG（当时状态）；后续 D-01、D-02、D-05 已修复并复验 |
| 第三批原生保存与跨区物理隔离 | [任务书](./IPSys_Explorer_Phase3_Real_Windows_Agent_2026-10-23.md)、[报告](./agent-validation/phase3-real-save-20261023-a18b47b/PHASE3_REPORT.md)、[证据](./agent-validation/phase3-real-save-20261023-a18b47b/EVIDENCE_INDEX.md) | 小 ZIP 真实落盘 SHA 核验、物理隔离 SQL 违规 0；Agent 无法完全操作 Windows 保存框，后由专项 CI 与用户人工反馈分别补充 |
| MCP 旧 70 工具黑盒 | [旧报告](./mcp-results/2026-10-17/MCP_TEST_REPORT.md)、[索引](./mcp-results/2026-10-17/MCP_EVIDENCE_INDEX.md) | 37 项中 28 PASS / 0 FAIL / 9 BLOCKED；不等于当前 59 工具的独立 Windows 权限实测 |

旧 V2 的 `T-P2-02` 程序化 drop 未经过真实 dragstart，不能单独证明用户鼠标拖放失败。大库 VACUUM 的旧超时已经通过修改测试等待预算并实际完成压缩收敛；ZIP64 初稿 TextEncoder 导入失败已修复。所有历史原始状态仍保留。

验收需使用当前源码和相应 CI 与 Agent 数据，不凭旧文件标题中的“当前/尚未合并/待修复”覆盖最新事实。合并前历史材料见 [审查](./IPSys_Explorer_PreMerge_Readiness_2026-10-23.md) 和 [交接](../docs/IPSys_Explorer_主分支合并_新会话交接_20261023.md)。
