# IPSys 本机 Codex MCP

IPSys 支持本机 Codex 通过 MCP stdio 控制同一 Windows 用户已经运行且已解锁的资料库。Agent 复用原有业务 API 和 SQLCipher 会话，不另外打开数据库。

## 使用步骤

1. 从 Actions 的最新成功构建解压 IPSys-Web-win-x64 到固定文件夹。
2. 正常启动 IPSys.Web.exe，解锁数据库，在「系统设置」点击「开启 MCP」。每次打开数据库均默认关闭。
3. 在本机 PowerShell 运行以下命令，将 EXE 路径换成实际绝对路径：

   `codex mcp add ipsys -- "C:\IPSys\IPSys.Web.exe" --mcp`

   也可使用本机 `~/.codex/config.toml` 配置：

   ```toml
   [mcp_servers.ipsys]
   command = 'C:\IPSys\IPSys.Web.exe'
   args = ["--mcp"]
   ```

4. 重新进入 Codex 会话，确认 MCP 工具列表，然后让 Agent 操作项目、合同和原件。任务结束后，回 IPSys 关闭 MCP。

## 工具

| 工具 | 作用 |
| --- | --- |
| `list_projects` | 查询所选工作区的有效项目及 ID |
| `list_contracts` | 查询有效合同及所属项目 |
| `list_files` | 查询附件及文件链接 ID |
| `create_project` | 创建科研、横向或其他项目 |
| `update_project` | 按 ID 更新指定字段 |
| `delete_project` | 将项目及其合同移入回收站 |
| `create_contract` | 在有效项目下创建合同 |
| `delete_contract` | 将合同移入回收站 |
| `upload_files` | 按本机绝对路径将多份原件加密入库 |
| `delete_file` | 将业务附件的指定关联移入回收站 |

所有工具均需显式指定 `workspace`：`company` 是公司，`personal` 是个人。上传支持 `kind` = `project` 或 `contract`、`owner_id`、`paths`（1–20 条本机绝对路径），可选 `on_conflict`（`new` / `update`）、`group_id` 和 `duplicate_mode`（`independent` / `reuse`）。默认独立归档而不覆盖已归档原件。单文件限 64 MiB。项目、合同、附件的所有删除均使用现有软删除 API，可在回收站恢复，不开放永久清理。

## Codex 提示词示例

“在个人资料创建科研项目‘矿山机器人控制’，项目编号 M2026-01，把 C:\Users\Me\Desktop\申请书.docx 和 预算.xlsx 归档到该项目。”

“在公司资料找到‘智能矿山工程’项目，新建‘技术合同’，把 C:\Contracts\合同.pdf 作为合同附件归档。”

“先查明项目 ID，再将这个测试项目移到回收站，不永久删除。”

## 安全边界

Codex 通过 stdio 使用同一个 EXE 的 `--mcp` 模式，子进程仅通过当前 Windows 用户的本机命名管道向已运行的 IPSys 宿主提交操作；没有新 TCP 端口、不会向 Agent 暴露数据库密码或网页 Token。必须由用户在已解锁程序中手动授权开关，关库/退出即失效。Agent 操作属于用户明确委托，正式库建议预先手动备份，尤其删除前核对 ID。打开 MCP 后，当前 Windows 用户的本机 Agent 可以通过上述工具写入和软删除资料。不要同时运行两个 IPSys 宿主实例。

更多步骤见 `WEB_TESTING.md`。
