# IPSys MCP 接口收敛后一次性回归检查

> **当前接口去重验收基线（2026-10-17）**：源码 [`2620c109`](https://github.com/zy19970/IPSys/commit/2620c109043f779eeb57f411210f99bb2f21e554) 已在 [Windows CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428) **completed/success**，验证正式 stdio 59 唯一工具、无 `v2_*`、真实 SQLCipher/HTTP 原名业务和 Node UI 上传回归。本文件仍是下一次**真实 Windows Codex/WorkBuddy 本机复测**的操作依据；自动 CI 不能覆盖第二用户、跨权限和 GUI 故障注入。历史归档 `MCP_TEST_RESULTS/2026-10-17/` 属于之前 70 工具版本，不改写。

## 1. 工具清单与兼容迁移

正式 `IPSys.Web.exe --mcp` 握手后，`tools/list` 断言 **59 个唯一工具名称**，无任何 `v2_*`，保留 `purge_trash`、`start_upload_task`、`cancel_task`、`get_operation_result` 及其它原名业务功能。

从旧工具名转换：

| 原 `v2_*` 名称 | 当前公开名称 | 差异 |
| --- | --- | --- |
| `v2_list_projects` | `list_projects` | 当前返回扁平化网页列表；不再返回 FolderSnapshot 根 |
| `v2_list_contracts` | `list_contracts` | 当前返回网页表格投影；保留 `projectId` |
| `v2_list_ips` | `list_ips` | 当前返回网页表格投影 |
| `v2_create_project`、`v2_update_project`、`v2_delete_project` | `create_project`、`update_project`、`delete_project` | 参数及 V2 写入一致 |
| `v2_create_contract`、`v2_delete_contract` | `create_contract`、`delete_contract` | 参数及 V2 写入一致 |
| `v2_create_ip`、`v2_update_ip`、`v2_delete_ip` | `create_ip`、`update_ip`、`delete_ip` | 参数及 V2 写入一致 |

`tools/call(name="v2_list_projects")` 应返回 JSON-RPC `-32602` 不支持工具；现存原名 `list_projects` 等可返回 JSON 数组、`isError=false`。不使用旧插件缓存判断工具数量，先重启/刷新 MCP 客户端的工具发现。

## 2. 真实 SQLCipher/MCP 回归

1. 在可丢弃测试库中创建项目、编辑项目、创建合同、创建 IP、查询三类列表，核对 FolderId、父子关系、日期和状态字段；同名原生 HTTP `/api/v2/folders/company/{project|contract|ip}` 与 MCP 表格投影对应同一条 FolderId。
2. 用 `request_id` 重放修改，确保只执行一次；非法 LinkId、排序不完整、无效目录父 ID 和回收站非法 ID 仍记为 `done/businessOk=false`；取消、断线、强杀宿主的未知写结果保留 `uncertain`。
3. 枚举目前 **13 个**返回数组的列表工具：`list_projects`、`list_contracts`、`list_ips`、`list_general`、`list_archives`、`list_archive_folders`、`list_trash`、`list_files`、`list_project_files`、`list_contract_files`、`list_ip_files`、`list_file_links`、`list_folder_entries`。其中 `list_folder_entries` 至少测两个父目录场景；不允许出现数组作为对象索引的异常。
4. 64 MiB 边界、文件 SHA-256、共享 FileId/独立 LinkId、追加 FileVersion、同名/同内容查重显式选择、导出及回收站操作不得倒退。
5. 抽查 MCP 的 2、8、24 路并发和空闲连接释放；保留报告中的 9 项 BLOCKED 真实权限/GUI 场景，不伪报其通过。

## 3. 前端旧上传路径去除门禁

现行项目、合同、知识产权、档案、综合资料的上传统一经 `IPSysNativeIp.upload` → `/api/v2/files/{workspace}/prepare` → `/prepared/{ticket}/resolve`；同内容必须明确选择独立、共享、复用或取消。前端不再有 `chooseVersionAction`、`data-upload-choice` 和旧 `legacy-<id>` 上传分支。上传多文件、单文件重复、版本更新、错误提示与取消都必须保留。

界面中仍用于预览/布局的 `mock` 示例不属于旧 V1 数据库接口；此次不删除仍被预览测试引用的模拟页面。历史测试的 `v1/v2` 字样也不能被当作真实 V1 数据源。

## 4. 实机执行说明

```powershell
git pull --ff-only
dotnet build src/IPSys.Web/IPSys.Web.csproj -c Debug
# 启动本次构建的 IPSys GUI、解锁可丢弃测试库、手动开启 MCP
# 使用 MCP Inspector 或实际 Agent 初始化后拉取最新 tools/list，并执行上述门禁
```

旧 `C:\IPSys-MCP-Test\scripts` 脚本如果把 `70` 写死、调用 `v2_*` 或按 `folder.ref.id` 解析原名列表，则需**先更新测试脚本断言**（并记录更新情况），不是新的产品功能失败。旧 2026-10-17 实机报告仍是旧构建的真实历史结果，不重写它以制造新版本通过。最终交付包含当前 EXE/DLL SHA、59 工具清单、测试参数和结果、PASS/FAIL/BLOCKED、准确的 request_id 与前后端关联证据。
