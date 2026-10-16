# IPSys 本机 Codex MCP

> **2026-10-16 状态（N2-03-07-02 首批）**：知识产权与项目合同原名 MCP CRUD、`upload_files(kind=project/contract/ip)` 均已对齐 V2 FolderId/FileId/LinkId，项目合同通过 `list_project_files/list_contract_files` 与 `delete_project_file/delete_contract_file` 操作单 Folder 内的有效原件；通用 `list_files/delete_file` 也已改为 V2 多模块链接汇总和仅解除指定 LinkId。项目合同相关功能提交 [00e9c87](https://github.com/zy19970/IPSys/commit/00e9c87ab4dfec9cd702c3dd2f08f60f5becb935)、[60c3692](https://github.com/zy19970/IPSys/commit/60c36926945c9bb4d660b25212dbf5f23f23f95a)、[6fe6474](https://github.com/zy19970/IPSys/commit/6fe647437128635f0751b5edfe8795d13c74e0fc)。N2-03-07-02 剩余项目/合同 V2 Excel、搜索/回收站和跨区整项目含合同与原件版本事务复制。第三轮 [Windows CI #38845050570](https://github.com/zy19970/IPSys/actions/runs/38845050570) **success**。本机 MCP 仍需在已解锁的软件手动开启，通过当前用户 stdio/命名管道访问；无需开放 TCP 端口；本机 Codex 人工验收未完成。


IPSys 支持本机 Codex 通过 MCP stdio 操作相同 Windows 用户已解锁资料库，复用软件现有 SQLCipher 会话而不另开库。知识产权原名工具及 `v2_*` 使用 V2；项目合同原名工具仍走旧业务接口，用户和 Agent 必须区分 ID。

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
| `list_files` | 当前工作区有效 V2 项目、合同、知识产权原件归属；返回 `id=LinkId`、`fileId=FileId`、`ownerId=FolderId`、`kind` 等 |
| `create_project` | 创建科研、横向或其他项目 |
| `update_project` | 按 ID 更新指定字段 |
| `delete_project` | 将项目及其合同移入回收站 |
| `create_contract` | 在有效项目下创建合同 |
| `delete_contract` | 将合同移入回收站 |
| `upload_files` | 按本机绝对路径将多份原件加密入库 |
| `delete_file` | 按 `list_files` 返回的 `id` 解除单个 V2 LinkId（参数仍为 `file_id`），不删其它关联及历史原件 |

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

> **2026-10-16 当前 V2 MCP（N2-03-05/06 已验收）**：`list_ips/create_ip/update_ip/delete_ip` 与 `v2_*_ip*` 使用当前知识产权网页相同的 V2 FolderId，不再写旧 IpStore。原 `upload_files` 指定 `kind=ip` 时从本机绝对路径写入 V2 原件；`owner_id` 必须是知识产权 FolderId；新增 `list_ip_files` 按 `ip_id` 返回有效 LinkId/FileId/材料类别/最新版，`delete_ip_file` 需同时提供 `ip_id`、`file_id`、`link_id`，只删除单处关联。

## V2 原生业务 MCP 工具（N2-03-01）

新增 `v2_list_projects`、`v2_create_project`、`v2_update_project`、`v2_delete_project`；`v2_list_contracts`、`v2_create_contract`、`v2_delete_contract`；`v2_list_ips`、`v2_create_ip`、`v2_update_ip`、`v2_delete_ip`。参数名继续沿用原 `workspace`、`project_id`、`ip_id` 等结构，实际结果包含原生 `FolderSnapshot`（`folder.ref.id`、`businessData`）；合同必须指定当前工作区真实有效项目的 `project_id`。

`v2_*` 项目/合同/IP 及原名项目合同/IP CRUD 使用相同 V2 FolderId。所有 `upload_files` 的项目、合同、IP 类型现统一写入 V2 FileId/版本，发现 SHA-256 同内容必须由调用者决定 `duplicate_mode=independent/reuse/share` 或取消；`reuse/share` 必须用匹配的 `source_file_id`，`on_conflict=update` 则用已归属于所选 `owner_id` 的 `file_id`。旧 `group_id` 不能代替新版 FileId。软件内手动开启及本机授权始终适用。


## V2 知识产权 MCP 原件操作（N2-03-06）

调用 `upload_files` 指定 `workspace=company/personal`、`kind=ip`、`owner_id=V2 FolderId`、`paths=[绝对路径]`、可选 `material_category`（申请材料/通知文件/证书文件/其他材料）。无重复内容时生成新 FileId；有 SHA-256 重复内容时，若未明确给出 `duplicate_mode`，返回已有文件的名称/位置/FileId 并撤销暂存，不自动合并。确认后可设置 `duplicate_mode=independent` 独立保存、`duplicate_mode=reuse` 且 `source_file_id=已有 FileId` 仅复用物理内容，或 `duplicate_mode=share` 加上 `source_file_id` 共享同一 FileId。服务端复核匹配哈希与工作区归属。为原 FileId 追加版本时使用 `on_conflict=update` 和 `file_id=目标 FileId`，不得同时提供内容复用选项。查询用 `list_ip_files(ip_id=...)`；解除用 `delete_ip_file(ip_id=...,file_id=...,link_id=...)`。这些操作均使用原有手动启用的 MCP 授权、仅本机用户管道和 SQLCipher，不开放外部网络访问。

[Windows CI #38833862535](https://github.com/zy19970/IPSys/actions/runs/38833862535) 已验证原知识产权 V2 原件。项目合同专用与通用链接命令见 N2-03-07-02 首批提交；`list_files` 的 `id` 是 **LinkId**，不是 FileId，`delete_file(file_id=...)` 只解除这一条链接，不删除其它 Folder 中共用的原件，也不删除 FileVersion。开发测试数据库不迁移、兼容或回填。

## 项目/合同 N2-03-07-02 首批 MCP（2026-10-16）

现有项目/合同网页已通过 [CI #38836041449](https://github.com/zy19970/IPSys/actions/runs/38836041449) 接入 V2。原名项目合同 `list_projects/create_project/update_project/delete_project`、`list_contracts/create_contract/delete_contract` 现在均使用相同 V2 FolderId；`upload_files(kind=project/contract)` 复用 V2 暂存查重/用户选择协议（不直接写旧 business-files 表），历史版通过 `on_conflict=update + file_id` 追加。`list_project_files(project_id)` / `list_contract_files(contract_id)` 返回目标 Folder 有效文件 LinkId/FileId；`delete_project_file` / `delete_contract_file` 必须提供 FolderId、FileId、LinkId，单处软解绑。通用 `list_files` 汇总 V2 的项目/合同/IP 有效链接，`delete_file(file_id=LinkId)` 不影响共享历史。下一项为项目合同 V2 固定列 Excel，随后统一搜索/回收站、跨工作区携所属合同及全部文件版本原子复制，最后再对用户本机 Codex 与 Edge/Chrome 实机验收。
