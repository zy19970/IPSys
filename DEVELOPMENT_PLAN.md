# IPSys 开发推进与交付准则

> 现行状态见 [docs/CURRENT_BASELINE.md](docs/CURRENT_BASELINE.md)：版本、schema、Excel 列数、空间策略与验收口径全部以该文件为准（MCP 工具数不写死，以 `tools/list` 为准）。本文只写不随版本变化的规则；文内若出现具体数字、提交号或 CI 编号，均为当时记录，不构成现行约定。

## 1 范围与数据边界

IPSys 是 WinForms 启动器、仅本机访问的 Web Explorer、单 SQLCipher schema 4 加密库和 MCP 的一体化程序。一个数据库包含个人/公司隔离工作区。普通文件夹、项目和知识产权使用 Folder 身份，**Folder 无版本，附件 File 才有版本**。同工作区可显式共享 FileId 或复用物理 FileObject，跨工作区不共享物理原件。

资料类模块统一“新建文件夹”，文件夹既可直接上传附件又可无限级嵌套；名称必填，类别、年度、标签和备注选填。项目和知识产权保留专用业务表单与关系约束；项目子项是普通目录。

## 2 已完成的能力范围

具体版本、列数和当前验证状态见 [CURRENT_BASELINE](docs/CURRENT_BASELINE.md)，运行方式见 [tests/README](tests/README.md)，测试范围与证据分层见 [TESTING.md](TESTING.md)。不要将历史测试通过记录当作最新代码的验收结果。

- 资源模型：`project` / `ip` / `archive_folder`，附件多版本、同区共享、回收站与永久清理。
- 跨模块整树移动：包含已软删除后代，保持 FolderId / LinkId / FileId 与版本。
- Excel 台账：项目、知识产权、普通资料三套固定模板；合同不再是独立业务对象。
- 本机 MCP 与分层 Agent 规范：管道隔离、只读/写入工具、幂等 `request_id`。
- 资料库维护：密码修改、完整性检查、空闲空间原地分批回收（不需要两倍库大小）。

## 3 下一阶段工作方法

当前进入实际使用细节精修：优先核对单选/多选、右键/F2/拖拽操作范围，进度与状态提示、共用表格与 DPI、移动目标选择器及 Markdown 大文本预览的本机体验；只有查明并复现的缺陷才进入代码修改。

1. 以真实使用截图、操作复现为入口，优先修改共用组件而非单个页面补丁；新建/上传/下载/移动/删除应检查顶部、侧栏、右键和详情之间的一致性。
2. 按统一 `archive_folder + section` 契约复核普通文件夹的 Excel、MCP、搜索、ZIP、回收站与共享文件；旧 `archive/general` 对象和重复接口已经退出当前调用路径。
3. 按风险范围运行 Node、Edge/HTTP、SQLCipher 和必要的实际 Windows GUI 用例，区别测试 mock 与真正产品缺陷，使用隔离数据库。
4. 改动后同步本文与 [CURRENT_BASELINE](docs/CURRENT_BASELINE.md)；历史结论不再抄进各文档正文，需要时用 `git log` 取回。

## 4 最终交付条件

新的正式 Release 仍需手动触发 [发布工作流](https://github.com/zy19970/IPSys/actions/workflows/publish-release.yml)。进入 GA 之前对备份恢复、外置盘/断电、空间不足、任务并发及 T01～T09 进行适用的安全复核；不能将日常 CI 等同完整故障注入或用户人工验收。详见 [TESTING.md](./TESTING.md)。
