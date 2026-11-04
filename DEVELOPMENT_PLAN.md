# IPSys 开发计划与当前执行状态

> **现行基线（2026-11-04，S5）**：SQLCipher 新库结构版本 **3**，Folder 类型仅 `project`、`ip`、`archive_folder`；项目内可任意层创建普通文件夹，合同资料不再是独立业务对象。所有普通资料模块（含综合资料）Excel **6 列**，项目 11 列、知识产权 19 列；MCP stdio **43 项工具**。S1/S2/S3/S4 CI #521/#526/#529/#532 通过，S5-1 [CI #533](https://github.com/zy19970/IPSys/actions/runs/41831428604) 通过。S5-2 Edge 脚本 CI #534 与第16.4节跨入口闭环仍需单独核实。旧 `v0.9.1-rc1` Release 不包含最新 main。历史正文与 CI 记录仅供追溯，以本段和当前源码为准。

> **2026-11-02 状态**：已核验产品/测试提交 `4567ae96b7` 的 Windows [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 为 completed/success（26 步成功、0 失败，两项可选 ZIP64 步骤跳过）。目前正式 Release 仍为 `v0.9.1-rc1`；自动 CI 不等于全部本地 GUI/第三方 Agent 验收。 项目现阶段以真实使用反馈驱动操作细节和一致性精修，不重复已经完成的 Explorer 合并与 N1～N4 重构。

## 1. 当前范围与数据边界

IPSys 是 WinForms 启动器、仅本机访问的 Web Explorer、单 SQLCipher schema 3 加密库和 MCP 的一体化程序。一个数据库包含个人/公司隔离工作区。普通文件夹、项目和知识产权使用 Folder 身份，**Folder 无版本，附件 File 才有版本**。同工作区可显式共享 FileId 或复用物理 FileObject，跨工作区不共享物理原件。

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
| S5 收尾 | [CI #533](https://github.com/zy19970/IPSys/actions/runs/41831428604) 已验证第一批清理，后续完整闭环与真实本机人工验收未结束 |
| 操作细节 | 右键批量下载、侧栏默认展开、表头全选、真实更新时间、菜单图标、成功删除面板 4 秒隐藏、单一“新建”直达；最新 [CI #473](https://github.com/zy19970/IPSys/actions/runs/41413434499) 成功 |
| 大文件与 ZIP64 | [大库及 VACUUM](https://github.com/zy19970/IPSys/actions/runs/39943364663) 通过；[4 GiB+ ZIP64 生成](https://github.com/zy19970/IPSys/actions/runs/39944440866) 通过，但只是生成验证 |

## 3. 下一阶段工作方法

1. 以真实使用截图、操作复现为入口，优先修改共用组件而非单个页面补丁；新建/上传/下载/移动/删除应检查顶部、侧栏、右键和详情之间的一致性。
2. 按统一 `archive_folder + section` 契约复核普通文件夹的 Excel、MCP、搜索、ZIP、回收站与共享文件；旧 `archive/general` 对象和重复接口已经退出当前调用路径，回归证据与真实业务验收分别核对。
3. 按风险范围运行 Node、Edge/HTTP、SQLCipher 和必要的实际 Windows GUI 用例，区别测试 mock 与真正产品缺陷，使用隔离数据库。
4. 按当前源码同步 README、设计、需求、用户指南、Wiki 和证据索引，保留历史测试失败的原始时间与结论。

## 4. 最终交付条件

正式 Release 需手动触发 [发布工作流](https://github.com/zy19970/IPSys/actions/workflows/publish-release.yml)。进入 GA 之前对备份恢复、外置盘/断电、空间不足、任务并发及 T01～T09 进行适用的安全复核；不能将日常 CI 等同完整故障注入或用户人工验收。详见 [TESTING.md](./TESTING.md)。
