# IPSys 开发计划与当前执行状态

> **更新至 2026-10-25 功能细节优化阶段**。仓库当前仅有 `main` 分支；Explorer 合并属于已完成历史。最新产品代码为 `8c1ca9a`，对应 [Windows CI #40162144248](https://github.com/zy19970/IPSys/actions/runs/40162144248) 成功。继续实施前仍以实时 HEAD、功能源码和最新验证结果为准，文档更新不会改变产品功能，但触及受监控路径的 Markdown 也可能触发 Windows CI；不能预先断言是否运行，以 Actions 的实际 SHA 和结果为准。

## 1. 目标与已确认边界

IPSys 为 Windows 本地资料管理器：WinForms 启动器、浏览器 Explorer 前端、SQLCipher V2 单加密库和个人/公司隔离工作区。所有业务记录均为 Folder、附件为 File；文件版本归属 File，合同依附项目，同工作区支持显式共享/复用，跨工作区物理对象独立复制。项目、合同、知识产权、资质、业务档案、个人分类、综合资料、Excel、搜索、导出、回收站和本机 MCP 都围绕统一数据模型实现。实际产品范围见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 2. 完成的里程碑

| 阶段 | 当前状态 | 证据 |
| --- | --- | --- |
| M0 需求、字段字典与 WinForms 初始验证 | 已完成，字段逻辑持续有效 | [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) |
| N1～N4 SQLCipher V2 资源内核、原生业务接口和旧物理模型清理 | 已进入现行代码，历史专项 CI 已通过 | [DESIGN.md](./DESIGN.md)；Git 历史 |
| MCP 安全、业务工具与原 **63 工具**接口收敛（后续新增第 64 项只读规范工具） | 代码及标准 CI 已通过；旧 70 工具 Agent 报告属历史 | [MCP_CODEX.md](./MCP_CODEX.md)、[MCP_TEST_RESULTS](./tests/mcp-results/README.md) |
| Explorer 重构 F2-01～F2-06 | 功能完成：建库/会话、档案目录混排、文件关联、整记录复制转移、拖放和统一动作入口 | [阶段计划历史](./docs/EXPLORER_PHASE2_FUNCTIONAL_COMPLETENESS_2026-10-22.md) |
| 三批实机反馈与缺陷收敛 | 运行期 401、外部拖放、待确认原件；跨区物理隔离专项证据完成 | [TEST_EVIDENCE_INDEX](./tests/TEST_EVIDENCE_INDEX.md) |
| 大文件与 ZIP64 | >2 GiB SQLCipher/HTTP 与 VACUUM CI 通过；实际 >4 GiB ZIP64 生成通过；用户确认本机人工环节已验证 | [#39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663)、[#39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) |
| 安全合并 `main` | **历史已完成**：非强制快进；当前仓库仅保留 `main`，不再把已结束的分支当持续维护目标 | [合并时 CI #39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) |
| 10 月 25 日功能细节收敛 | **已提交并通过 CI**：知识产权十类型/统一三编号与 19 列 XLSX、Excel 当前筛选/全部、取消合同独立 Excel、PDF 连续滚动、启动器托盘与双 CPU、七个普通预置目录、党团建设及 63 MCP 工具 | [Windows CI #40162144248](https://github.com/zy19970/IPSys/actions/runs/40162144248) |

早期 132 项 Agent 报告的 126 PASS / 1 BUG / 3 BLOCKED / 2 GAP 是当时实测快照；后续补测、修复及专项 CI 不能倒写成原始报告 PASS。用户对真实 Windows 大文件保存和 ZIP64 使用环节确认人工通过，但没有向仓库上传对应逐文件哈希/第三方解包日志，不能以自动化结论替代。

## 3. 下一阶段工作方式

当前主要工作是**在稳定合并基线上按真实使用反馈进行功能细节优化与一致性收敛**，而不是重做旧 N2/N4、重新实施 React 试验线或重复执行旧 132 项全量 Agent 用例。新需求先对照现行源码、业务需求和 UI 规则；需要功能修改时按影响范围新增最小动态回归并通过 Windows CI。

如进入正式产品发布，应单独检查目标 Windows 运行时依赖、可恢复性、备份与异常退出、外置磁盘及磁盘不足、安全恢复和 T01～T09 尚未被本次合并涵盖的完整边界。不得把“完成主分支合并”写成“所有发布条件完成”。

## 3.1 已确认、待实施：分层 Agent 提示词服务

新增需求的唯一实施基线为 [《IPSys 本地 Agent 分层提示词服务实施方案（2026-10-25）》](./docs/IPSys_Agent_分层提示词服务_实施方案_20261025.md)。核心原则：轻量总规范通过 MCP 初始化告知目录和读取办法，search/upload/metadata 专项按需获取；Agent 可自主读取、先看目录选择，也可由用户手动指定只读查看。该功能目前**第一阶段源码已实施、CI 与真机 Agent 实测待核验**：内嵌 index/search/upload/metadata 规范、短 initialize.instructions、只读 get_agent_guidance 及 MCP 动态回归已提交。第二阶段标准 Prompts 和 SQLCipher 通用缺项筛选的源码及自动测试已提交、CI/实机待验；第二阶段真实智能入库/补录端到端 Agent 验收尚未完成，第三阶段设置管理尚未实施；后续跨会话继续前必须先阅读方案并核对实时 main。

## 4. 开发与协作

代码和现行文档统一维护在 `main`；`work/onedrive-file-manager` 的历史可通过原提交与合并记录追溯，但该远程分支现已不存在。用户提供的真实资料库不得作为破坏性测试对象；测试创建独立 SQLCipher QA 库。按 AIGT-templates 的 `AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md` 执行 Git、构建与验收，文档与测试证据分开管理。

技术架构查 [DESIGN.md](./DESIGN.md)，操作说明查 [USER_GUIDE.md](./USER_GUIDE.md)，测试门禁查 [TESTING.md](./TESTING.md)，历史 Agent 报告查 [docs/TEST_EVIDENCE_INDEX.md](./tests/TEST_EVIDENCE_INDEX.md)。
