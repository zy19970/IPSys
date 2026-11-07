# MCP 与本地 Agent 接入

IPSys 可通过本机 MCP 让 Codex 或其他支持 MCP 的 Agent 查询与管理用户已授权的资料库。它不是开放的云端数据库 API。

## 运行方式

1. 在 Windows 上启动 IPSys EXE，并打开现有资料库。
2. 解锁资料库后本机 MCP 默认开启。先在软件设置中核实 MCP 开关状态；如已手动关闭，可重新开启。
3. 将 Agent 的 MCP stdio 服务指向同一 EXE 的 `--mcp` 模式，按 Agent 客户端要求配置 executable 和参数。
4. 在 Agent 中重新连接或刷新工具清单，再执行查询。

Agent MCP 子进程需要与图形宿主运行在同一个 Windows 用户登录会话。IPSys 使用同用户命名管道与当前已解锁会话访问数据库；宿主未运行、未解锁或用户已在设置中关闭授权时，应先检查前置条件。

具体客户端的配置文件路径和字段因 Codex、其他 MCP 客户端而异；不要把某个客户端的示例配置当作统一标准。

## 工作区与模块名称不可混淆

MCP 参数 `section` 必须结合 `workspace` 使用，同一个英文值在个人与公司工作区可能代表不同业务。下表是可直接用于工具调用的映射：

| workspace | section | 中文业务 |
| --- | --- | --- |
| company | certificate | 企业资质 |
| company | achievement | 业务档案 |
| company | party | 党团建设 |
| company | general | 综合资料 |
| company | project | 公司项目的普通子目录 |
| personal | certificate | 人力资源 |
| personal | achievement | 成果与奖励 |
| personal | academic | 学术与社会活动 |
| personal | general | 其他资料 |
| personal | project | 科研与合作项目的普通子目录 |

例如查询个人“人力资源”应使用 `list_folders(workspace="personal", section="certificate")`；企业资质则使用 `workspace="company"` 与相同的 `section="certificate"`。项目、知识产权业务记录使用 `kind=project/ip`，不把 `ip` 当作目录 `section`。文件夹是 `archive_folder`，文件 `FileId` 和关联 `LinkId` 不可混用；详情和永久删除前先通过只读接口确认真实归属。要变更页面显示顺序，使用前端“排序”；MCP `reorder_entries` 改写的是持久 `position`，不等于浏览器临时名称排序。

## 支持的业务方向

| 任务 | 常见工具或能力 |
| --- | --- |
| 查项目、知识产权、档案 | `list_projects`、`list_ips`、`list_folders(workspace,section)` 等工具 |
| 跨模块查询 | `search_records`，支持查询范围及分页 |
| 文件逐页列出、筛缺项 | `list_files_page` |
| 查看文件与版本 | `get_file_details` 与文件版本相关工具 |
| 上传与属性补录 | `upload_files`、`start_upload_task`、`update_file_metadata` |
| 多层目录管理 | `list_folders`、`create_folder`、`update_folder`、`move_folder`、`transfer_folder`、`delete_folder` |
| 回收站 | `list_trash`、`restore_trash`、`purge_trash` |
| 读取 Agent 规范 | `get_agent_guidance` |

普通文件夹统一为 `archive_folder`，必须明确工作区与 `section`（公司支持 certificate/achievement/party/general/project，个人支持 certificate/achievement/academic/general/project）。其中 `section=project` 时，`parent_id` **必须是具体项目 FolderId 或项目内另一文件夹 FolderId**，不能直接创建在虚拟“公司项目”分类根目录；跨模块共享/移动到项目也必须选择真实的项目或其子目录；MCP 的工具数量与名称以客户端刷新后的 `tools/list` 为准；除了业务工具，还有四个资料库级工具（`get_vault_storage`、`reclaim_vault_space`、`get_vault_reclaim_status`、`cancel_vault_reclaim`），它们不接收 `workspace`。附件的全局名称可使用 `update_file_metadata(workspace,file_id,name)` 修改；这会更新同一 FileId 的全局名称而保留各 LinkId 的独立显示别名、文件原件与版本。实际工具名称、参数和授权条件应通过连接后的 `tools/list` 与仓库 [MCP_CODEX.md](https://github.com/zy19970/IPSys/blob/main/MCP_CODEX.md) 核对，不建议使用早期已下线的 `v2_*` 历史别名。

## 示例任务

> 查询公司工作区所有已登记的软件著作权，并列出对应编号与附件数量。先只读取，不修改数据库。

> 检查哪些文件缺少说明、标签、日期或编号，先列出缺项清单，待我审核后再补录。

> 将指定目录中的材料上传到明确的公司业务档案记录，按原件内容生成客观说明；遇到重复原件先报告处理选择。

## Agent 不会自动替你做的事

软件自带的 MCP 工具不能直接替代 PDF/Word/Excel 内容阅读与语义理解。真正的扩词、内容分析、必要的 OCR 和可信度判断由 Agent 自身可用能力完成；如果原件无法阅读，不应根据文件名编造编号、日期或摘要。

写操作应使用 `request_id` 幂等控制，遇到执行结果不确定时先查原请求状态，不盲目重传；永久删除需要明确确认和回收站身份。

[[Agent 工作规范|Agent-Guidance]] · [[开发者指南|Developer-Architecture]]