# IPSys 历史文档归档索引

本目录保存已完成阶段的技术决策、测试过程与旧界面/接口方案。文档内容是对应日期的原始历史，不作为当前施工指令。现行权威入口：仓库根目录 [README](../../README.md)、[REQUIREMENTS](../../REQUIREMENTS.md)、[DESIGN](../../DESIGN.md)、[DEVELOPMENT_PLAN](../../DEVELOPMENT_PLAN.md)、[TESTING](../../TESTING.md)。

| 归档文件 | 历史作用 / 当前替代 |
| --- | --- |
| `HANDOFF.md` | 已完成跨会话交接，现行进度见 DEVELOPMENT_PLAN |
| `FREEZE_AUDIT.md` | 需求冻结审查及 T01～T09，现行需求见 REQUIREMENTS |
| `RESOURCE_REFACTOR_PLAN.md` | SQLCipher V2 重构的 R/N 阶段施工记录，现行架构见 DESIGN |
| [资源内核回归矩阵](../../tests/archive/RESOURCE_REFACTOR_TEST_MATRIX.md) | 历史测试文件已集中 tests/archive，现行方法见 TESTING |
| `UI_COMPONENT_MATRIX.md` | 已退役 `wwwroot/app.js` 共用组件，正式前端见 [`src/IPSys.Web/wwwroot/`](../../src/IPSys.Web/wwwroot/README.md) |
| [Windows 测试历史](../../tests/archive/WEB_TESTING.md)、[大文件测试历史](../../tests/archive/LARGE_FILE_TESTING.md) | 已集中 tests/archive，现行门禁见 TESTING |
| `EXCEL_LEDGER.md`、`SEARCH.md` | 早期功能文档，现行说明见 USER_GUIDE |
| [MCP 黑盒任务书](../../tests/archive/MCP_AGENT_FINAL_RETEST.md)、[接口清理测试](../../tests/archive/MCP_INTERFACE_CLEANUP_TEST.md) | 已集中 tests/archive，现行接入见 MCP_CODEX |
| `ONEDRIVE_REFACTOR_PLAN.md`、`P0_COMPONENT_EVALUATION.md` | React/Vite 选型试验已被零依赖原生 Explorer 取代 |

迁入前位于根目录的历史文件保留原始 Git blob 内容和提交可追溯性，其中相对链接按迁入前原路径理解。需要完全复现当时的文件链接时，可通过对应历史 Git 提交查看原始目录。

Agent、Explorer V2 与 MCP 原始测试已统一移至 [tests/](../../tests/README.md)；旧测试文档也归集在 tests/archive。集中查看 [验收索引](../../tests/TEST_EVIDENCE_INDEX.md)，不得删除历史原始结果。
