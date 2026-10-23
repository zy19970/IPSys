# IPSys 测试资料与执行入口

> **统一测试资料目录**。本目录集中存放历次 Explorer/Agent/MCP 测试方案、结果、截图、JSON、CSV、脚本及复核说明。当前业务进度以 [开发计划](../DEVELOPMENT_PLAN.md) 为准，具体的测试通过状态以 [测试证据索引](./TEST_EVIDENCE_INDEX.md) 为准。历史文件原样迁移，内部记录的旧 SHA、路径和失败状态属于当时证据，不因搬迁而改写。

## 测试资料怎么找

| 目录/文件 | 内容 |
| --- | --- |
| [TEST_EVIDENCE_INDEX.md](./TEST_EVIDENCE_INDEX.md) | 综合索引，区分真实 CI、Agent 实测、用户人工反馈 |
| [agent-validation/](./agent-validation/) | 四轮 Agent 原始资料，共 413 个文件；报告、结果、截图、运行日志均完整保留 |
| [retest-v2-2026-10-22/](./retest-v2-2026-10-22/) | Explorer V2 复测：原始报告、证据及 **Windows CI 仍使用的脚本** |
| [mcp-results/](./mcp-results/README.md) | MCP 2026-10-17 旧 70 工具版本黑盒报告和原始操作日志 |
| [第二阶段 Agent 任务书](./IPSys_Explorer_Phase2_Agent_Complete_Retest.md) | 132 项实机验收任务书及同目录 CSV |
| [第二阶段补测任务书](./IPSys_Explorer_Phase2_Supplement_Agent_Test_Plan.md) | 16 项补测方案及同目录 CSV |
| [第三批实机任务书](./IPSys_Explorer_Phase3_Real_Windows_Agent_2026-10-23.md) | 大文件保存与跨区物理隔离 |
| [ZIP64 物理生成验收](./IPSys_Explorer_ZIP64_Generation_Only_2026-10-23.md) | 已使用的 ZIP64 生成测试操作说明 |

历史执行过的测试方案还有 [归档测试说明](./archive/)，实际保存核验工具位于 [tools/](./tools/)。

正式前端源码现已统一放在 [src/IPSys.Web/wwwroot/](../src/IPSys.Web/wwwroot/README.md)，与上传、导出和 PDF 模块同目录，不存在第二套前端。

## 自动化源码为什么保留原位置

`src/IPSys.Web/tests/` 包含直接读取 Explorer 源码、项目文件和内嵌资源的 Node 冒烟测试，和 `src/IPSys.Web/*Smoke.cs` 内建 C# smoke 属于源码构建验证，暂时**仍随产品代码存放**。统一测试入口在此，但不为了移动目录而改变业务测试的路径计算和项目自动编译规则。

`.github/workflows/web-windows.yml` 调用 `tests/retest-v2-2026-10-22/scripts/` 的 Edge/HTTP 复测脚本。移动后已经同步路径；原来 `src/IPSys.Web/tests/` 的相对读取逻辑不变。[tests/tools/Verify-ExplorerExports.ps1](./tools/Verify-ExplorerExports.ps1) 是真实保存核验工具，已集中并同步 Windows CI。

## 使用约定

对新的测试运行，在本目录按用例和日期另建独立证据目录，不覆盖以往 PASS、BUG、BLOCKED、NOT_RUN 记录；不提交大型数据库或真实原件，不在用户正式资料库开展不可逆测试。测试来源 SHA、构建哈希、环境、方法和完整结果应与证据一同记录。现行规则见 [TESTING.md](../TESTING.md)；旧需求审查和设计草案仍在 [docs/archive](../docs/archive/README.md)。
