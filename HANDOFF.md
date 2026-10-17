# IPSys 跨会话交接（2026-10-17，N4 实机验收与后续功能完善）

> **下个会话的首要入口。** 仓库：[zy19970/IPSys](https://github.com/zy19970/IPSys)，分支 `main`；本次文档整理所依据的**最后一次源码提交**为 [`2620c109`](https://github.com/zy19970/IPSys/commit/2620c109043f779eeb57f411210f99bb2f21e554)，对应 [Windows CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428) **completed/success**。本交接文档后续会有独立 docs 提交，新会话应首先重新读取最新 `main`，不要把此处写死的源码 SHA 当作未来 HEAD。  
> **开发阶段：N2-04 统一资源主链路完成、N4 旧物理模型与旧业务接口清理完成、MCP 黑盒三轮修复及接口去重完成。仍在开发与实机验收阶段；没有宣布正式产品发布。**

## 1. 下个会话如何接续

1. 先读取 [AIGT-templates/AGENTS.md](https://github.com/zy19970/AIGT-templates/blob/main/AGENTS.md) 和 [AI_RULES/GIT_OPERATIONS.md](https://github.com/zy19970/AIGT-templates/blob/main/AI_RULES/GIT_OPERATIONS.md)，再检查 IPSys 的 `main` HEAD、完整提交历史、相关 CI 和未合并 PR/变更。
2. 以 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) 判定当前阶段，以 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 为资源模型及重构冻结依据；任何具体业务修改都应优先核对 [REQUIREMENTS.md](./REQUIREMENTS.md)、[UI_BASELINE.md](./UI_BASELINE.md) 和 [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md)。
3. MCP 开发读取 [MCP_CODEX.md](./MCP_CODEX.md)；**当前对外工具清单 59 项，不再有 `v2_*` MCP 工具名**。新版本复测按 [MCP_INTERFACE_CLEANUP_TEST.md](./MCP_INTERFACE_CLEANUP_TEST.md)；[MCP_AGENT_FINAL_RETEST.md](./MCP_AGENT_FINAL_RETEST.md) 与 `MCP_TEST_RESULTS/2026-10-17/` 是旧 70 工具版本的历史资料，保留原始证据，不直接沿用旧断言。
4. 用户已确认当前数据库均为开发测试数据，不安排 V1→V2 迁移、回填或旧格式兼容。默认直接推送 `main`，提交后验证 Windows CI 与 Git ref；不要仅为代码审核自行建 PR。新功能按实际问题决定是否需要再补 UI、真实数据库或本机 Agent 验收。

## 2. 产品与已冻结的业务模型

用户可见名称是「资料管理系统」。Windows WinForms 启动器启动/退出本机服务；ASP.NET Core 仅监听 `127.0.0.1`；使用 Edge/Chrome 本地网页。网页版关闭数据库只执行关库、撤销会话，程序不退出。项目与 Web 静态资源在 `src/IPSys.Web/`，Visual Studio 可直接编译；依赖框架的 win-x64 Release 便携包为单 EXE，目标机需安装 .NET Desktop Runtime 8 x64 和 ASP.NET Core Runtime 8 x64。

一份 SQLCipher 加密数据库含 **公司/个人两个隔离的工作区**。现行物理模型是 `folders`（所有分类与业务记录、无版本）、`files`（稳定 FileId、选填元数据）、`file_versions`（文件独立历史版本）、`file_objects/file_chunks`（加密实际字节）、`folder_file_links`（Folder→File 多对多链接）、`mcp_operations`（请求幂等及不确定结果日志）。同一工作区不同 Folder 可共享一个 FileId 或以不同 FileId 仅复用内容；跨工作区禁止共享 FileObject，只能独立复制。SHA-256 命中相同内容时由用户显式选择共享、复用、独立保存或取消，不自动合并。所有文件必须归属有效业务 Folder；无待整理池。

项目可以独立存在，合同必须隶属于项目且可一对多。公司业务档案根层为分类卡片导航，内层目录和资料混排表格；公司企业资质直接表格；个人同类资料分类卡片→表格→详情；项目、合同、知识产权统一采用适合其业务的台账和详情，不为满足物理 Folder 统一而改变已冻结 UI。入口、下载、排序、复制/转移和删除保护的具体规则以 UI 基线为准。

## 3. 当前实现与验证结果（不要混淆证据级别）

| 模块 | 当前代码状态 | 已验证与仍需核验 |
| --- | --- | --- |
| 统一资源核心 | **已实现** V2-only Schema、Folder/File 业务、文件版本/关联/跨区隔离 | N1/N2/N3/N4 早期专项及当前 Windows 全量自动回归已通过；未来升级/备份等实机边界仍待验证 |
| 项目、合同、知识产权 | **已实现** V2 CRUD、Excel、排序、复制/转移、文件及搜索/回收站 | 正式主链路 [CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) 通过，当前业务自动回归继续覆盖 |
| 公司业务档案、企业资质、个人分类、综合资料 | **已实现** 分类导航/列表、原生归属、附件历史、固定 XLSX、搜索/导出及回收站 | V2 自动回归已通过；实际浏览器布局、选填文件属性和复杂导出仍需人工验收 |
| 文件去重、共享、版本与导出 | **已实现** SHA-256/显式选择、FileId/LinkId/Version、PDF Canvas 预览、文件夹/ZIP 下载 | 单文件代码上限 **8 GiB**，ZIP64 代码已接入；超过 2 GiB 的真实 SQLCipher/HTTP 往返、磁盘异常与复杂导出仍需专项验收，见 LARGE_FILE_TESTING.md |
| MCP 客户端 | **已实现** 同用户命名管道、手动授权、幂等日志、异步上传/取消、文件操作、业务转移、搜索与回收站，共 **59 个工具** | 原 70 项清单去重与前端旧上传分支清理 [CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428) **success**；真实跨权限、第二用户及部分 GUI 组合仍待补测 |
| 客户端与发布 | WinForms、内嵌页面、单 EXE Release；Debug/Release/stdio/SQLCipher/HTTP/Node UI/导出冒烟 | 最近源码 CI **success**；不能将自动测试等同于完整 Windows 实机安全/故障注入验收 |

注意历史 Agent 黑盒报告的被测构建是 `d3bc77f`（**70 工具**），其 37 项结果为 **PASS 28 / FAIL 0 / BLOCKED 9**，ISS-001～015 **15/15 PASS**。报告随后发现 ISS-016～018；源代码 [`e3f6292`](https://github.com/zy19970/IPSys/commit/e3f62921aad6e7cef16a7fa8bf498ff0c7392636) 针对三项修复、[CI #39014009578](https://github.com/zy19970/IPSys/actions/runs/39014009578) **success**，但**未收到这三项补丁之后的独立 Agent 黑盒复测报告**。再后来的 `2620c109` 移除了 11 个 `v2_*` 重复对外工具并通过 [CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428)；旧历史报告不可被改写为当前 59 工具实测结果。

## 4. MCP 当前唯一口径与核心代码

现行公开工具名为 `list_projects`、`create_project`、`list_contracts`、`create_ip`、`upload_files`、`list_files_page`、`start_upload_task`、`get_task_status`、`cancel_task`、`get_operation_result`、`purge_trash` 等 **59 个无 `v2_*` 前缀**的名称。原名工具均操作 V2 实体；原名 `list_projects/list_contracts/list_ips` 返回原来的网页友好数组，**不是** `FolderSnapshot(folder.ref.id/businessData)`；若需要原生数据结构，内部可用授权 HTTP `/api/v2/folders/{workspace}/{kind}`。HTTP 的 `/api/v2` 是当前有效接口版本，不是待删除的 V1 遗留层。客户端必须刷新 `tools/list` 和脚本的 59/13 列表断言。

`McpLocal.cs` 为工具登记、stdio/命名管道入口和 V2 HTTP 分发；`McpLocalSafety.cs` 为参数、加密 `request_id`/日志、`done/uncertain` 判定；`McpLocalTasks.cs` 为异步任务/查询/取消；`McpLocalV2.cs` 是**现行原生 Folder HTTP 的内部实现文件**，尽管文件名有 V2，也不能删除；`McpLocalIpFiles.cs`、`McpLocalArchive.cs`、`McpLocalExtras.cs` 承担附件、档案和其它业务操作。对异常返回，`done` 表示日志已结束，必须查看 `businessOk`；断线或上传在途的 `uncertain` 不得盲目重做。旧宿主崩溃遗留 `pending` 会在查询时收敛为 `uncertain`，禁止自动重传。

`Program.cs` 挂载原生路由；`ResourceSchemaV2.cs/Vault.cs` 为新库 Schema、加密和会话；`NativeFolder* / NativeFile* / NativeArchive* / RecycleStore / SearchStore` 为正式业务后端。前端 `wwwroot/app.js`、`ip-v2.js`、`export.js`、`pdf-preview.js` 保持有效：`app.js` 不可达的旧 `groupId` 上传回退已经清除，正式上传经 V2 SHA-256 prepare/resolve。尚存在供界面预览/Node UI 测试调用的 `mock` 页面，它们是**仍在使用的设计样例**，不是 V1 数据库读写入口，不应未经单独审查就删除。

## 5. 建议下个会话的具体顺序

**建议先验收、后继续增加业务功能**；目前没有必要再次执行全库重构或回退到旧 V1 迁移问题。

1. **先做接口去重后的本机定点复测**：取最新 `main` 重新编译并刷新 Codex/WorkBuddy 工具发现，核实 **59 工具、没有 `v2_*`、13 个数组型列表**，原名项目/合同/IP CRUD 与 HTTP V2 FolderId 一致；按 [MCP_INTERFACE_CLEANUP_TEST.md](./MCP_INTERFACE_CLEANUP_TEST.md) 验证文件共享/历史、前端上传与错误结果。优先连带复测 ISS-016～018 的新修复，确认没有新缺陷。
2. **补齐用户实机中尚为 BLOCKED 的 9 项**：Windows 普通/管理员权限、第二个真实用户/会话、Codex 与 WorkBuddy 组合、授权/撤权及 GUI 手工流程。首先核对每项阻塞条件是否具备，不应为了使其 PASS 而放宽管道 ACL、MIC 或 UAC。
3. **N4 真实业务边界**：选填文件属性的完整 UI、共享版本更新后的各位置、目录祖先搜索跳转、父子目录重叠/同名 ZIP/文件夹导出、下载与取消恢复，真实 Edge/Chrome 和桌面 XLSX 导入导出。现有前端 `mock` 仅属于设计展示，不得误判为已接入真实资料库的新模块。
4. **T01–T09 数据安全/发布门禁**：磁盘空间不足、移动盘/SSD 中断、文件任务退出/取消、数据库完整性、备份副本一致性、未来受控版本升级；2 GiB+ 单文件与 ZIP64 已进入功能实现阶段，仍须按 [LARGE_FILE_TESTING.md](./LARGE_FILE_TESTING.md) 取得真实大文件 SHA 往返和目标 Windows 电脑证据，不以代码实现替代验收。
5. 仅在上述结果明确后，依据用户的新优先级安排后续产品功能、性能优化或正式发布准备。黑盒 24 并发 p95 曾升至约 1,956 ms（旧轮约 475 ms），**没有隔离变量的证据证明是数据库膨胀引起**，需等环境一致的性能对比再立缺陷。

## 6. 最小验证与文档管理约定

修改 C#/JS 或工具契约时，以 `.github/workflows/web-windows.yml` 实际 Windows CI、`--smoke` SQLCipher/HTTP/MCP 和 Node UI/导出测试为最低匹配回归，状态明确区分代码已实现、Windows CI 已通过、用户实机已通过、未测/失败。修改 Markdown 后核对链接、引用版本与实际 Git diff；不要仅因文档提交重新声称完成了一次业务回归。

[RESOURCE_REFACTOR_TEST_MATRIX.md](./RESOURCE_REFACTOR_TEST_MATRIX.md) 是 Folder/File 场景测试矩阵，[WEB_TESTING.md](./WEB_TESTING.md) 保存长期验收记录，历史黑盒材料归档于 [MCP_TEST_RESULTS/2026-10-17/](./MCP_TEST_RESULTS/2026-10-17/MCP_TEST_REPORT.md)。[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) 负责阶段与下一步，[MCP_CODEX.md](./MCP_CODEX.md) 负责工具使用，本文只负责**最新状态与可执行的跨会话交接**。避免在多个文件重复积累“最新 CI”历史段落；历史过程通过 Git 提交和既有报告追溯。
