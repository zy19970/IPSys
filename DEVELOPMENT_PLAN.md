# IPSys 开发计划与当前执行状态

> **现行代码基线（2026-11-04）**：SQLCipher **schema 4**（`ResourceSchemaV2.cs` 文件名沿用；旧 schema 2/3 资料库拒绝打开，不迁移）。同工作区跨模块原位移动将已删除目录和隐藏的物理后代连同有效目录按父先子后在单一事务中更新 section，保留 FolderId/FileId/LinkId、文件版本与 deleted 状态；恢复后目录仍在目标模块，永久清理不会因旧 section 受阻。现行 MCP **43** 工具，普通资料 Excel **6** 列。产品实现见 [`8a2780e`](https://github.com/zy19970/IPSys/commit/8a2780e7a8c18a5017e27e0e22c03aac1f078fae)，对应 [Windows CI #541](https://github.com/zy19970/IPSys/actions/runs/41862168722) 的最终验收状态须以运行结果为准；上一基线 [#539](https://github.com/zy19970/IPSys/actions/runs/41856540366) 曾完成成功但仅验证了 R1 临时拒绝防护。用户本机人工验收与正式 Release 仍未执行。详见 [R1 修复核查](tests/REFACTOR_CLEANUP_REVIEW_20261104.md)，下方先前 S5 和较早 CI 叙述作为历史记录。

> **历史 S5 自动化基线（2026-11-04，#538）**：SQLCipher 新库 schema **3**，Folder 仅 `project`、`ip`、`archive_folder`；项目可包含多层普通目录，合同资料不再是独立对象。普通资料模块（含综合资料）Excel **6 列**，项目 11 列，知识产权 19 列；MCP **43** 工具。最终代码/测试提交 `cc7c1262eac0c2aaa36a0cd3107823320627e774` 的 [Windows CI #538](https://github.com/zy19970/IPSys/actions/runs/41839841405) `completed/success`（26 success、0 failure、2 optional ZIP64 skipped），Edge **14 PASS**、HTTP **12 PASS + T-P1-07 1 BLOCKED**（小库 VACUUM 进度抓拍）。第16.4节同批 MCP↔GUI 跨入口闭环 S5-E2E PASS；两类单 EXE 启动通过。**用户本机 GUI 人工复验及正式 Release 未进行**。详见 [S5 结案报告](tests/S5_FINAL_ACCEPTANCE_20261104.md)；下文较早日期的 CI 与历史决策原文仅用于追溯。

> **2026-11-02 状态**：已核验产品/测试提交 `4567ae96b7` 的 Windows [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 为 completed/success（26 步成功、0 失败，两项可选 ZIP64 步骤跳过）。目前正式 Release 仍为 `v0.9.1-rc1`；自动 CI 不等于全部本地 GUI/第三方 Agent 验收。 项目现阶段以真实使用反馈驱动操作细节和一致性精修，不重复已经完成的 Explorer 合并与 N1～N4 重构。

## 1. 当前范围与数据边界

IPSys 是 WinForms 启动器、仅本机访问的 Web Explorer、单 SQLCipher schema 4 加密库和 MCP 的一体化程序。一个数据库包含个人/公司隔离工作区。普通文件夹、项目和知识产权使用 Folder 身份，**Folder 无版本，附件 File 才有版本**。同工作区可显式共享 FileId 或复用物理 FileObject，跨工作区不共享物理原件。

资料类模块统一“新建文件夹”，文件夹既可直接上传附件又可无限级嵌套；名称必填，类别、年度、标签和备注选填。项目和知识产权保留专用业务表单与关系约束；项目子项是普通目录。

## 2. 已实现与自动验收证据

| 阶段 | 状态/证据 |
| --- | --- |
| M0、N1～N4、Explorer F2-01～F2-06 | 已合并 `main`；[历史合并 CI](https://github.com/zy19970/IPSys/actions/runs/39947975625) 成功 |
| MCP 和分层 Agent 规范 | 当前 43 工具、Prompts、缺项筛选及设置规范覆盖已实现并纳入 Windows 自动回归；第三方真实 Agent 智能任务另验 |
| Excel 与知识产权 | 项目 11 列、知识产权 19 列、资料档案/党团/资质 6 列、综合资料 6 列；合同无独立 Excel；十类型三编号及空 Excel 单元格保留已有值规则生效 |
| 普通文件夹统一与回收站 | [统一文件夹 CI](https://github.com/zy19970/IPSys/actions/runs/41406914227) 成功，支持目录与附件共存、可选属性、整树回收及共享引用安全清理 |
| S1 根目录移动 | [CI #521](https://github.com/zy19970/IPSys/actions/runs/41793618031) 同 SHA success |
| S2 合同退出及 schema 3 | [CI #526](https://github.com/zy19970/IPSys/actions/runs/41802424444) 同 SHA success |
| S3 目录共享/复制/移动 | [CI #529](https://github.com/zy19970/IPSys/actions/runs/41816669123) 同 SHA success |
| S4 同层目录排序 | [CI #532](https://github.com/zy19970/IPSys/actions/runs/41822426599) 同 SHA success；43 工具 |
| S5 最终清理与自动验收 | [CI #538](https://github.com/zy19970/IPSys/actions/runs/41839841405) 对应 `cc7c1262` completed/success；C07/C08、真实 MCP↔GUI S5-E2E、PDF 双页与拖拽均已自动验证；本机 GUI 和 GA 另验 |
| 操作细节 | 右键批量下载、侧栏默认展开、表头全选、真实更新时间、菜单图标、成功删除面板 4 秒隐藏、单一“新建”直达；最新 [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 成功 |
| 大文件与 ZIP64 | [大库及 VACUUM](https://github.com/zy19970/IPSys/actions/runs/39943364663) 通过；[4 GiB+ ZIP64 生成](https://github.com/zy19970/IPSys/actions/runs/39944440866) 通过，但只是生成验证 |

## 3. 下一阶段工作方法

1. 以真实使用截图、操作复现为入口，优先修改共用组件而非单个页面补丁；新建/上传/下载/移动/删除应检查顶部、侧栏、右键和详情之间的一致性。
2. 按统一 `archive_folder + section` 契约复核普通文件夹的 Excel、MCP、搜索、ZIP、回收站与共享文件；旧 `archive/general` 对象和重复接口已经退出当前调用路径，回归证据与真实业务验收分别核对。
3. 按风险范围运行 Node、Edge/HTTP、SQLCipher 和必要的实际 Windows GUI 用例，区别测试 mock 与真正产品缺陷，使用隔离数据库。
4. 按当前源码同步 README、设计、需求、用户指南、Wiki 和证据索引，保留历史测试失败的原始时间与结论。

## 4. 最终交付条件

正式 Release 需手动触发 [发布工作流](https://github.com/zy19970/IPSys/actions/workflows/publish-release.yml)。进入 GA 之前对备份恢复、外置盘/断电、空间不足、任务并发及 T01～T09 进行适用的安全复核；不能将日常 CI 等同完整故障注入或用户人工验收。详见 [TESTING.md](./TESTING.md)。
