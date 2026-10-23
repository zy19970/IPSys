# IPSys 历史文档归档索引

本目录保存已完成阶段的技术决策、测试过程与旧界面/接口方案。文档内容是对应日期的原始历史，不作为当前施工指令。现行权威入口：仓库根目录 [README](../../README.md)、[REQUIREMENTS](../../REQUIREMENTS.md)、[DESIGN](../../DESIGN.md)、[DEVELOPMENT_PLAN](../../DEVELOPMENT_PLAN.md)、[TESTING](../../TESTING.md)。

| 归档文件 | 历史作用 / 当前替代 |
| --- | --- |
| `FREEZE_AUDIT.md` | 需求冻结审查及 T01～T09，现行需求见 REQUIREMENTS |
| `RESOURCE_REFACTOR_PLAN.md` | SQLCipher V2 重构的 R/N 阶段施工记录，现行架构见 DESIGN |
| `RESOURCE_REFACTOR_TEST_MATRIX.md` | 旧内核回归矩阵，现行方法见 TESTING |
| `UI_COMPONENT_MATRIX.md` | 已退役 `wwwroot/app.js` 共用组件，现行前端见 `frontend/explorer/` |
| `WEB_TESTING.md`、`LARGE_FILE_TESTING.md` | 阶段测试过程，现行门禁及可重用方法见 TESTING |
| `EXCEL_LEDGER.md`、`SEARCH.md` | 早期功能文档，现行说明见 USER_GUIDE |
| `MCP_AGENT_FINAL_RETEST.md`、`MCP_INTERFACE_CLEANUP_TEST.md` | 70→59 工具过渡时任务书，现行接入见 MCP_CODEX |
| `ONEDRIVE_REFACTOR_PLAN.md`、`P0_COMPONENT_EVALUATION.md` | React/Vite 选型试验已被零依赖原生 Explorer 取代 |

迁入前位于根目录的历史文件保留原始 Git blob 内容和提交可追溯性，其中相对链接按迁入前原路径理解。需要完全复现当时的文件链接时，可通过对应历史 Git 提交查看原始目录。

真正的 Agent 原始证据仍留在 `docs/agent-validation/`、`docs/retest-v2-2026-10-22/`、`MCP_TEST_RESULTS/`，不能因为旧测试已修复就删除原始结果。集中查看 [验收索引](../TEST_EVIDENCE_INDEX.md)。
