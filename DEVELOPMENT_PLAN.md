# IPSys 开发计划与当前执行状态

> **更新至 2026-10-23 Explorer 合并完成**。`work/onedrive-file-manager` 已快进合并入 `main`，基线 `8227d2c`；GitHub [Windows CI #39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) 已完成并成功。后续默认在 `main` 上继续工作，不再执行旧阶段的“准备合并”步骤。每次继续前仍以实时 HEAD 和 CI 为准。

## 1. 目标与已确认边界

IPSys 为 Windows 本地资料管理器：WinForms 启动器、浏览器 Explorer 前端、SQLCipher V2 单加密库和个人/公司隔离工作区。所有业务记录均为 Folder、附件为 File；文件版本归属 File，合同依附项目，同工作区支持显式共享/复用，跨工作区物理对象独立复制。项目、合同、知识产权、资质、业务档案、个人分类、综合资料、Excel、搜索、导出、回收站和本机 MCP 都围绕统一数据模型实现。实际产品范围见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 2. 完成的里程碑

| 阶段 | 当前状态 | 证据 |
| --- | --- | --- |
| M0 需求、字段字典与 WinForms 初始验证 | 已完成，字段逻辑持续有效 | [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) |
| N1～N4 SQLCipher V2 资源内核、原生业务接口和旧物理模型清理 | 已进入现行代码，历史专项 CI 已通过 | [DESIGN.md](./DESIGN.md)；Git 历史 |
| MCP 安全、业务工具与 59 工具接口收敛 | 代码及标准 CI 已通过；旧 70 工具 Agent 报告属历史 | [MCP_CODEX.md](./MCP_CODEX.md)、[MCP_TEST_RESULTS](./tests/mcp-results/README.md) |
| Explorer 重构 F2-01～F2-06 | 功能完成：建库/会话、档案目录混排、文件关联、整记录复制转移、拖放和统一动作入口 | [阶段计划历史](./docs/EXPLORER_PHASE2_FUNCTIONAL_COMPLETENESS_2026-10-22.md) |
| 三批实机反馈与缺陷收敛 | 运行期 401、外部拖放、待确认原件；跨区物理隔离专项证据完成 | [TEST_EVIDENCE_INDEX](./tests/TEST_EVIDENCE_INDEX.md) |
| 大文件与 ZIP64 | >2 GiB SQLCipher/HTTP 与 VACUUM CI 通过；实际 >4 GiB ZIP64 生成通过；用户确认本机人工环节已验证 | [#39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663)、[#39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) |
| 安全合并 `main` | **完成**：fast-forward、非强制、开发分支保留，合并后两分支对比 `identical` | [main CI #39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) |

早期 132 项 Agent 报告的 126 PASS / 1 BUG / 3 BLOCKED / 2 GAP 是当时实测快照；后续补测、修复及专项 CI 不能倒写成原始报告 PASS。用户对真实 Windows 大文件保存和 ZIP64 使用环节确认人工通过，但没有向仓库上传对应逐文件哈希/第三方解包日志，不能以自动化结论替代。

## 3. 下一阶段工作方式

当前主要工作是**在稳定合并基线上按真实使用反馈继续完善**，而不是重做旧 N2/N4、重新实施 React 试验线或重复执行旧 132 项全量 Agent 用例。新需求先对照现行源码、业务需求和 UI 规则；需要功能修改时按影响范围新增最小动态回归并通过 Windows CI。

如进入正式产品发布，应单独检查目标 Windows 运行时依赖、可恢复性、备份与异常退出、外置磁盘及磁盘不足、安全恢复和 T01～T09 尚未被本次合并涵盖的完整边界。不得把“完成主分支合并”写成“所有发布条件完成”。

## 4. 开发与协作

代码和现行文档使用 `main`，开发分支 `work/onedrive-file-manager` 作为历史参照保留。用户提供的真实资料库不得作为破坏性测试对象；测试创建独立 SQLCipher QA 库。按 AIGT-templates 的 `AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md` 执行 Git、构建与验收，文档与测试证据分开管理。

技术架构查 [DESIGN.md](./DESIGN.md)，操作说明查 [USER_GUIDE.md](./USER_GUIDE.md)，测试门禁查 [TESTING.md](./TESTING.md)，历史 Agent 报告查 [docs/TEST_EVIDENCE_INDEX.md](./tests/TEST_EVIDENCE_INDEX.md)。
