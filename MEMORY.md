# IPSys 项目持续记忆（现行摘要）

> **2026-11-07 第四批文档交叉一致性复核（本会话第五轮）**：用户指令“继续推进”，按 AIGT 三项基础规范、main `c6223303dc2d9678eed3713536dde40f554c2417` 及现行源码，对照 `USER_GUIDE.md`、`UI_BASELINE.md`、`DESIGN.md`、`DEVELOPMENT_PLAN.md`、`TESTING.md`、`tests/README.md`、`REQUIREMENTS.md`、`M0_DATA_DICTIONARY.md`、`MCP_CODEX.md` 和 Wiki/当前基线，核对真实 SQLCipher INCREMENTAL 预检（`256 × page_size + 64 MiB`，约 65 MiB）、个人名称自然升序/公司年份或创建时间降序、Markdown 渲染与源码双视图、项目下 `archive_folder/section=project` 以及无独立合同对象。已定向修订六份文档：`USER_GUIDE.md`、`UI_BASELINE.md`、`DESIGN.md`、`DEVELOPMENT_PLAN.md`、`TESTING.md`、`docs/CURRENT_BASELINE.md`，移除个人年份降序与全库 VACUUM 默认运行的错误、固定旧 CI 作为最新状态、单批 1 MiB 与 65 MiB 预检的混淆及旧合同测试对象。六份新文档相对 Markdown 链接与围栏全部静态验证通过，排序、空间、合同、测试 CI 口径对照通过；`tests/README.md` 中 34 个 .cjs 和保留 fixture 路径已核对实际仓库，不需修改。本轮未变更源码、测试用例、Wiki 页面、Actions 或用户资料库；近期 CI/Wiki 发布仍受前轮 Runner 启动阻断，未声称新自动测试通过。会话归档见 [本会话第五轮](memory/sessions/2026-11-07-IPSys文档资料清理审计.md)，详细旧记忆保留在 `memory/archive/MEMORY_BEFORE_INDEX_2026-11-07.md`。
>
> 最后维护：2026-11-07。本文件用于新会话快速恢复项目当前决策和未完成事项。**详细会话、修改过程与旧阶段结论不在这里复制**，参见 [记忆索引](memory/INDEX.md)。
>
> 2026-11-07 整理前的完整 `MEMORY.md` 已按**相同 Git Blob** 无损归档至 [原始历史快照](memory/archive/MEMORY_BEFORE_INDEX_2026-11-07.md)，其内容哈希为 `8b7cbcb353edfd43ecadeed13773686bf4114a5d`。未重写 Git 历史、未删除任何 `memory/sessions/` 会话。
>
> 上一轮会话：[2026-11-07 文档清理审计](memory/sessions/2026-11-07-IPSys文档资料清理审计.md)；最新归档轮次为**第五轮：文档交叉一致性核验**。如果本摘要与实际源码或现行基线冲突，先核查源码，不以旧 Memory 条目覆盖已确认的新规则。

## 一、项目目的和运行架构

IPSys（Windows x64 资料管理系统）让用户在本机集中保存、整理、搜索、预览、共享和导出个人与公司资料。界面参考 OneDrive，但数据实际保存在用户选定的**单个 SQLCipher 加密数据库文件**，无需云端服务器或自动同步服务。

WinForms 启动器及托盘负责 EXE 生命周期；ASP.NET Core 只在本机提供 Web Explorer；文件原件、版本、工作区数据都在加密库中。本机 Agent 通过已解锁宿主的受限 MCP 命名管道操作，MCP 默认开启但用户可关闭。新建资料库采用 **schema 4**，旧 schema 2/3 不自动迁移。

[唯一产品现行状态](docs/CURRENT_BASELINE.md) · [用户指南](USER_GUIDE.md) · [技术设计](DESIGN.md) · [测试说明](TESTING.md)

## 二、已确认的数据与模块决策

1. **资源身份**：FolderId 表示业务记录/文件夹，FileId 为逻辑原件，LinkId 为某个 Folder 的关联，FileVersion 是文件历史，FileObject 是加密原件内容。文件夹无版本，附件有版本；同工作区共享/复用时不得误删仍被引用的对象，跨个人与公司工作区必须物理隔离。
2. **Folder kind** 只有 `project`、`ip`、`archive_folder`。公司与个人项目子级均为 `archive_folder/section=project`，必须属于真实项目或有效项目子目录；**合同仅为普通项目文件夹与附件**，无独立合同表单、实体或 Excel。普通目录允许多级嵌套、移动、共享、重命名、完整子树回收与恢复。
3. **公司栏目**：企业资质、业务档案（七个新库预置且可修改的普通文件夹）、公司项目、知识产权、综合资料、党团建设。**个人栏目**：人力资源、知识产权与著作、科研与合作项目、成果与奖励、学术与社会活动、其他资料。底层 `certificate` 必须结合工作区解释：公司为企业资质，个人为人力资源。
4. **业务台账与模板**：项目 11 列、知识产权 19 列、普通目录 6 列，Excel 仅含元数据。知识产权十类、统一 `number`，三种专利可选 `publication_no` 与 `grant_notice_no`；知识产权年份从申请日期派生。相关业务属性详见 [字段字典](M0_DATA_DICTIONARY.md)。
5. **交互**：个人工作区 Explorer 默认名称自然升序，不改变企业工作区排序；多选、全选、右键/详情操作、拖动应共享统一语义；按钮文案统一采用“打包下载、共享、移动、删除”等不附加已选数量。附件同名更新需明确区分新附件与新版本；只修改 FileId 名称不另建版本。Markdown/TXT 预览上限 10 MiB。
6. **删除与维护**：普通删除进入回收站，永久删除处理共享引用；上传、删除、空间回收有任务互斥与状态提示。新库使用 `auto_vacuum=INCREMENTAL`，设置页可手动分批回收与取消；旧 `NONE` 库不自动升级。完整 `VACUUM` 仅保留后端维护通道。修改数据库密码需安全操作并撤销旧会话。

## 三、MCP 与版本发布边界

Agent 用同一个 EXE 的 `--mcp` 模式连接，业务操作必须按 `workspace/section/kind` 与 FolderId/FileId/LinkId 定位。同一写操作重试复用支持的 `request_id`，`pending/uncertain` 先查询结果；资料库级回收返回 taskId，用状态查询轮询；`get_vault_storage` 返回 `reclaimableBytes`。**工具总数量和参数以每次连接后 `tools/list` 为准**，不把某次历史工具数视为永久基线。

[完整 MCP 操作契约](MCP_CODEX.md) · [内嵌 Agent 规范](src/IPSys.Web/AgentGuidance) · [源码与发布工作流](README.md)

正式 Release 由 `publish-release` 手动发布两种单 EXE 与 SHA256SUMS，Publish 不重新运行业务 smoke；源码已实现、Windows CI 通过、本机 Agent 验收、用户 GUI 验收必须分别陈述。2026-11-06 起部分 Actions 运行曾被 GitHub 账户 billing lock 阻断，**不能将没有执行的步骤视为通过或失败的产品测试**。其最新状态须实时核查实际 Actions 运行。

## 四、当前治理与未完成验证

1. **2026-11-07 文档清理第一批**：已修订 `REQUIREMENTS.md`、`M0_DATA_DICTIONARY.md`、`docs/INCREMENTAL_VACUUM_ROLLOUT_PLAN_20261106.md`，清除旧独立合同实体、旧库双向兼容、空间回收“待实施”误标。
2. **第二批**：已修订 `README.md`、`MCP_CODEX.md` 与 `docs/WIKI_PUBLISHING.md`，不再重复历史 CI/Release 静态结论；保留有效 MCP 参数契约并修正空间回收字段名。
3. **第三批**：审查并修订 Wiki 用户页面的固定版本/CI、合同语义、磁盘回收与 MCP 相关文字；将根目录 Memory 调整为摘要，将历史原文无损归档，建立 [逐会话索引](memory/INDEX.md)。Wiki 源码提交、独立 Wiki 发布 workflow、线上页面要分别核验；**只有实际核验成功时才称线上同步完成**。
4. **Wiki 发布阻断（第三批后续核验）**：第三批源码提交 `7479013a4e364907e1f1186a9379c1348d7560ea` 已推送 main、11 篇修订 Wiki 源文档链接静态检查通过，但自动触发 [Publish IPSys Wiki #42332456228](https://github.com/zy19970/IPSys/actions/runs/42332456228) `completed/failure`，运行约 4 秒且发布 Job `steps=[]`；**未执行 Wiki 内容检查或独立 Wiki Git 推送，不能称线上已更新**。与先前账户 billing lock 症状相符，但本轮未取得新的明确 annotation，根因需以 GitHub Support/后续日志为准。账户恢复后须重试 Wiki 发布并核对站点；不得先前宣称已发布。
5. **未验边界**：真实 20–50 GB 库长期性能、断电/磁盘紧张、移动 SSD 等极端情况；近期推送需在 Actions 真正运行后复核 CI；用户机 GUI 与真实 Agent 工作流须各自验收。所有故障注入使用独立测试库，不接触正式 DB。
6. **第四批交叉一致性核验**：已核对根目录现行需求、字段字典、用户手册、技术设计、UI、MCP、测试规则及现行源码，修订六份存在矛盾的说明；个人/公司默认排序、原地回收的预检空间与完整 VACUUM、Markdown 预览及合同普通目录模型相互一致。文档链接、围栏静态检查通过，但未运行 Windows CI 或用户 GUI 验收。
7. **后续**：GitHub Actions 账户恢复后，按对应 SHA 重新运行 Windows CI 与独立 Wiki 发布并核对线上 Wiki；用户本机 GUI、Agent 和大库/断电验证需单独记录。日常使用继续根据真实复现反馈进行最小范围改动。

## 五、从新会话恢复工作

1. 先读 [AIGT-templates 协作入口](https://github.com/zy19970/AIGT-templates/blob/main/AGENTS.md)、`AI_RULES/GIT_OPERATIONS.md` 和 `AI_RULES/MEMORY_PROTOCOL.md`。
2. 读本文件和 [现行基线](docs/CURRENT_BASELINE.md)，再读 [最近会话](memory/sessions/2026-11-07-IPSys文档资料清理审计.md)。
3. 需要查特定历史修改时，从 [记忆索引](memory/INDEX.md) 进入对应 `memory/sessions/`；更早的记忆参照 [原始历史快照](memory/archive/MEMORY_BEFORE_INDEX_2026-11-07.md) 与 `git log`，不把当时结论认作当前源码。
