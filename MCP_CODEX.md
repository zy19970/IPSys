# IPSys 本机 Codex MCP

> **2026-10-15 状态同步**：当前 `main` 已有 **14 项** MCP 工具（含专利/知识产权 CRUD 与知识产权材料分类上传），现行 Windows CI 已通过 stdio 握手、工具清单及真实 SQLCipher/本机命名管道回归；**本机 Codex 或其他平台 MCP 客户端的完整人工连接与日常操作验收仍需执行**。发布程序是单 EXE，但目标电脑需预装 .NET Desktop Runtime 8 x64 与 ASP.NET Core Runtime 8 x64。MCP 是**本机 stdio** 接口，无需对外暴露网络端口；其他本机客户端可以在支持 stdio MCP 且可启动本机 EXE 时按其配置接入，未验证的平台不承诺即插即用。


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
| `list_ips` | 查询专利和其他知识产权记录（含 ID、类型、状态、完整字段） |
| `create_ip` | 新增专利和其他知识产权 |
| `update_ip` | 修改已有知识产权，仅更新传入字段 |
| `delete_ip` | 将知识产权移入回收站，可恢复 |
| `list_files` | 查询附件及文件链接 ID |
| `create_project` | 创建科研、横向或其他项目 |
| `update_project` | 按 ID 更新指定字段 |
| `delete_project` | 将项目及其合同移入回收站 |
| `create_contract` | 在有效项目下创建合同 |
| `delete_contract` | 将合同移入回收站 |
| `upload_files` | 按本机绝对路径将多份原件加密入库 |
| `delete_file` | 将业务附件的指定关联移入回收站 |

所有工具均需显式指定 `workspace`：`company` 是公司，`personal` 是个人。上传支持 `kind` = `project`、`contract` 或 `ip`、`owner_id`、`paths`（1–20 条本机绝对路径），可选 `on_conflict`（`new` / `update`）、`group_id` 和 `duplicate_mode`（`independent` / `reuse`）。知识产权附件还可填写 `material_category`，可选「申请材料」「通知文件」「证书文件」「其他材料」，不填则归为「其他材料」；项目和合同附件不用填写该字段。

`create_ip` 的必填参数为 `workspace`、`name`、`ip_type`，`update_ip` 使用 `ip_id` 查找记录。可填写 `status`、`applicants`、`right_holders`、`creators`、`application_no`、`application_date`、`publication_no`、`publication_date`、`grant_notice_no`、`grant_notice_date`、`publication_info`、`grant_date`、`registration_no`、`first_published_date`、`registration_date`、`category`、`remarks`、`tags`。支持发明、实用新型、外观设计专利等既有七种知识产权类型，状态和日期自动走原有业务校验；更新时不改变未传入的字段。

默认独立归档而不覆盖已归档原件。单文件限 64 MiB。项目、合同、附件的所有删除均使用现有软删除 API，可在回收站恢复，不开放永久清理。

## Codex 提示词示例

“在个人资料创建科研项目‘矿山机器人控制’，项目编号 M2026-01，把 C:\Users\Me\Desktop\申请书.docx 和 预算.xlsx 归档到该项目。”

“在公司资料找到‘智能矿山工程’项目，新建‘技术合同’，把 C:\Contracts\合同.pdf 作为合同附件归档。”

“先查明项目 ID，再将这个测试项目移到回收站，不永久删除。”

“在公司资料中新建一项发明专利《矿山机器人自适应控制方法》，状态设为实质审查中，申请号 CN202610000001.0；把本机 D:\\专利材料\\申请文件.pdf 归档为申请材料。随后更新专利备注，但保留原申请号。”

## 安全边界

Codex 通过 stdio 使用同一个 EXE 的 `--mcp` 模式，子进程仅通过当前 Windows 用户的本机命名管道向已运行的 IPSys 宿主提交操作；没有新 TCP 端口、不会向 Agent 暴露数据库密码或网页 Token。必须由用户在已解锁程序中手动授权开关，关库/退出即失效。Agent 操作属于用户明确委托，正式库建议预先手动备份，尤其删除前核对 ID。打开 MCP 后，当前 Windows 用户的本机 Agent 可以通过上述工具写入和软删除资料。不要同时运行两个 IPSys 宿主实例。

更多步骤见 `WEB_TESTING.md`。
