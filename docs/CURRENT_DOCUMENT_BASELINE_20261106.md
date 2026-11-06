# IPSys 现行文档基线与版本一致性说明

> 适用基线：2026-11-06。产品参考提交 `47b8fa3e1e6d1c92b0291cb3160c9dbd7a4b78bc`；已发布预发布版 `v0.9.3-rc.1` 对应构建提交 `1c2642b6e8ffe7d450682123aecea23b872fe486`。本文件用于识别**当前有效文档**与按当时事实保留的**历史报告**；实际行为以现行源码和指定版本 EXE 为准。

## 1. 产品及资料模型

IPSys 是 Windows x64 本地资料管理系统，由 WinForms 启动器、本机 ASP.NET Core Web Explorer、SQLCipher 加密数据库和同用户受授权的 MCP 组成。浏览器界面不代表云盘，用户数据不因关闭浏览器而删除。

新建数据库使用 SQLCipher **schema 4**，源码文件 `ResourceSchemaV2.cs` 的名称不意味着运行时仍是 schema 2。旧 schema 2/3 测试库不自动迁移；测试或破坏性操作须使用独立可丢弃的 schema 4 库，不覆盖用户已有 DB。

业务模型以 `project`、`ip` 和 `archive_folder` 为当前 Folder kind。项目子级及各普通资料模块的资料均为可直接挂载附件、支持多层嵌套的普通文件夹。合同资料存放于项目下普通目录，无独立合同业务对象、专用表单和 Excel 台账。公司业务档案七个初始目录创建后是普通文件夹。

`FolderId` 表示记录/目录，`FileId` 表示逻辑附件，`LinkId` 表示关联，`FileVersion` 表示文件历史，`FileObject` 表示物理保存内容。文件有版本，文件夹无版本。同工作区可明确共享逻辑附件或复用内容；跨个人/公司工作区必须保持物理原件隔离。移动、恢复和永久清理需保留应有的身份、引用和版本；跨模块原位移动普通目录时包括已软删除后代和被隐藏的完整物理子树。

## 2. 当前功能与接口

1. Excel 固定模板：项目 **11 列**、知识产权 **19 列**、普通资料（含资质、业务档案、党团建设、综合资料）**6 列**。导出区分 `filtered`（服务端全量匹配）与 `all`；Excel 仅管理业务元数据，不包含附件正文及版本。旧 4 列档案和 1/2/3 列综合资料格式不再作为现行导入模板。
2. 当前 MCP 对外 **43 项工具**，具体名称和参数以连接时的 `tools/list` 及 [MCP_CODEX](../MCP_CODEX.md) 为准。原 `contract` 工具和 `v2_*` 历史别名不属于现行接口。MCP 不负责替 Agent 读取 PDF/Office 正文。
3. 前端单选、多选、右键、F2 和拖放按真实选择集执行；多选同类附件/目录可一并拖动，不支持混合选择在一次拖动中静默处理部分项。单个附件支持右键和 F2 重命名；`update_file_metadata(name)` 更新 FileId 的全局名称，不覆盖已有 LinkId 独立显示别名或文件历史。
4. PDF 支持连续滚动；Markdown `.md/.markdown` 与 UTF-8 `.txt` 支持离线只读预览，Markdown 支持排版/源码切换和安全净化；文本预览上限为 **10 MiB**，不限制正常上传或下载。
5. 资料库设置可以修改 SQLCipher 加密密码（旧密码校验，新密码 8—256 字符，重新加密完成后旧会话撤销）；必须先备份并按真实任务终态操作。回收站永久删除的完成提示约 4 秒消失，不在重新进入回收站时重复展示历史已完成进度。

## 2.1 个人排序与 MCP 模块语义（2026-11-06 后续修改）

个人工作区的文件列表默认名称升序（数字前缀使用自然排序），公司工作区既有默认排序不变；只作用于 Explorer 视图，不重排数据库 `position`。MCP 的 `workspace+section` 是组合标识：`personal/certificate` 是人力资源，`company/certificate` 是企业资质，完整映射和操作安全约定见 [MCP_CODEX](../MCP_CODEX.md)。同名英文 `section` 在不同工作区的业务含义不可互换。此次仅增强 tools/list 描述和 Agent 指引，不更名旧 ID、不变更数据库结构与 MCP 工具清单。

## 2.2 设置中的完整性检查与 MCP（2026-11-06）

资料库解锁后本机 MCP 默认开启，仍受当前 Windows 用户命名管道、资料库会话和工具业务授权约束；可手动关闭、重新开启，关库、改密和退出程序会撤销授权。完整性检查为独立异步后台任务，显示真实服务器阶段与不确定进度条，不提供虚假百分比；等待期间不允许并发数据库文件任务，可在设置中重新查看运行状态。SQLite `VACUUM` 的额外空间预留为原 DB 大小的两倍加 128 MiB，并分别检查数据库磁盘和临时目录磁盘，属于保守的执行前检查；临时文件在操作结束后释放。

## 3. 构建、发布与验收

正式前端源代码位于 `src/IPSys.Web/wwwroot`；构建时生成的 `dist/` 仅用于嵌入 EXE。Web SDK 的默认 Content 外拷由 `EnableDefaultContentItems=false` 关闭，仍保留显式 `EmbeddedResource` 与严格双模式单 EXE 检查。

[Windows CI #558](https://github.com/zy19970/IPSys/actions/runs/42048982231)（对应产品提交 `47b8fa3`）已完成成功：26 success / 0 failure / 2 项可选 ZIP64 skipped，覆盖干净 checkout 冷 Release、Debug、Node/UI、Edge、HTTP、SQLCipher、MCP、PDF/Markdown 与两种 EXE 启动。该 CI 仍保留旧有 T-P1-07 短时压缩进度观察的合规 BLOCKED，不应宣称所有人工视效测试均已通过。

手动 [Publish IPSys Release #6](https://github.com/zy19970/IPSys/actions/runs/42053785425) 已 `completed/success`，创建 [v0.9.3-rc.1](https://github.com/zy19970/IPSys/releases/tag/v0.9.3-rc.1)（2026-11-05，UTC+8）。包括 `IPSys-win-x64-FrameworkDependent.exe`、`IPSys-win-x64-SelfContained.exe` 和 `SHA256SUMS.txt`。**手动 Publish 不重跑 smoke**，仅做版本检查、双单 EXE 构建/资源校验和发布。用户本机人工验收另按 [MANUAL_ACCEPTANCE_20261105](../tests/MANUAL_ACCEPTANCE_20261105.md) 填报，未填项保持“未测”。

## 4. 正式文档入口及职责

| 文档 | 现行职责 |
| --- | --- |
| [README](../README.md) | 面向用户的产品总览、安装与发布入口 |
| [REQUIREMENTS](../REQUIREMENTS.md) | 业务规则与范围 |
| [DESIGN](../DESIGN.md) | 架构与数据一致性约束 |
| [M0_DATA_DICTIONARY](../M0_DATA_DICTIONARY.md) | 字段和 Excel 数据契约 |
| [UI_BASELINE](../UI_BASELINE.md) | 页面、选择、菜单及通用组件规则 |
| [DEVELOPMENT_PLAN](../DEVELOPMENT_PLAN.md) | 已完成阶段与下一步细节优化方法 |
| [MCP_CODEX](../MCP_CODEX.md) | 当前 MCP 接口与安全要求 |
| [USER_GUIDE](../USER_GUIDE.md) | 实际用户操作 |
| [TESTING](../TESTING.md) 与 [证据索引](../tests/TEST_EVIDENCE_INDEX.md) | 现行测试分层、CI 证据与人工验收边界 |
| [前端说明](../src/IPSys.Web/wwwroot/README.md) | 唯一正式前端与构建规范 |
| [Wiki 维护](./WIKI_PUBLISHING.md) 与 [Wiki 源](./wiki/Home.md) | 用户 Wiki 内容及自动发布机制 |

## 5. 历史资料与变更原则

`docs/archive/`、带日期的早期实施方案、`tests/agent-validation/`、`tests/mcp-results/`、`tests/retest-v2-2026-10-22/` 及旧 S5/重构验收报告保存各次测试时的真实状态和失败证据。不得为了让历史文档看起来“已完成”而改写当时结果；其中“现行/最新/未实现”的含义必须结合当时日期、提交与后续修复辨认。仍由 CI 调用的历史路径脚本不属于可随意删除的死代码。

下一轮针对真实使用细节按“复现现象 → 定位公共组件与所有同类入口 → 最小必要修改 → 对应自动回归及本机验收”推进。每次改动同步更新当前使用文档及必要的证据索引，同时保留历史记录。
