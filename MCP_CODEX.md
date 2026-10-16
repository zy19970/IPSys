# IPSys 本机 Codex MCP

> **2026-10-16 最新 N2-04 MCP 验收**：原名项目、合同、知识产权以及业务档案、目录、综合资料 MCP 均使用当前网页的 SQLCipher V2 FolderId/FileId/LinkId；`upload_files(kind=project/contract/ip/archive/general)`、通用 `list_files/delete_file` 覆盖全部五种业务记录。新增档案/综合资料 12 项工具、子目录 parent_id 枚举和跨区/归属/原件历史保护：[功能提交 db79b82](https://github.com/zy19970/IPSys/commit/db79b825a3b7fb1ab384a70da69575d55e653b80)，[测试修正 f49bc49](https://github.com/zy19970/IPSys/commit/f49bc49a30c86ba89589e34083d0a0c2cff1f860)，[Windows CI #38880280977](https://github.com/zy19970/IPSys/actions/runs/38880280977) **success**。本轮 [6a7b1ff](https://github.com/zy19970/IPSys/commit/6a7b1ffe882aaa114c9d90af7011068cad7fd330) 又将正式页面旧附件/Excel/业务 HTTP 暴露面限制为 `--smoke` 历史测试，全部 ZIP/文件夹导出只使用 V2 FileId+FileVersion；[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) **success**。仍需在已解锁的本机软件中手动开启 MCP，不开放 TCP 端口；本机 Codex 人工验收另行进行。


IPSys 支持本机 Codex 通过 MCP stdio 操作同一 Windows 用户已解锁资料库，复用软件现有 SQLCipher 会话而不另开库。全部原名工具和已有 `v2_*` 项目/合同/IP 工具均使用 V2 FolderId；旧业务表与新版资料 ID 不混用。

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

4. 重新进入 Codex 会话，确认 MCP 工具列表，即可操作项目、合同、专利、档案、目录、综合资料及原件。任务结束后回 IPSys 关闭 MCP。

## 工具

| 工具 | 作用 |
| --- | --- |
| `list_projects` | 查询所选工作区的有效项目及 ID |
| `list_contracts` | 查询有效合同及所属项目 |
| `list_ips` | 查询专利和其他知识产权记录（含 ID、类型、状态、完整字段） |
| `create_ip` | 新增专利和其他知识产权 |
| `update_ip` | 修改已有知识产权，仅更新传入字段 |
| `delete_ip` | 将知识产权移入回收站，可恢复 |
| `list_files` | 列出工作区项目、合同、知识产权、档案、综合资料的 V2 有效附件；`id=LinkId`、`fileId=FileId`、`ownerId=FolderId`、`kind`，档案还包含 `section` |
| `create_project` | 创建科研、横向或其他项目 |
| `update_project` | 按 ID 更新指定字段 |
| `delete_project` | 将项目及其合同移入回收站 |
| `create_contract` | 在有效项目下创建合同 |
| `delete_contract` | 将合同移入回收站 |
| `upload_files` | 按本机绝对路径上传项目、合同、知识产权、档案或综合资料原件，支持 SHA-256 显式选择和历史版本追加 |
| `delete_file` | 按 `list_files` 返回的 `id` 解除单个 V2 LinkId（参数仍为 `file_id`），不删其它关联及历史原件 |

所有工具均需显式指定 `workspace`（`company` 公司、`personal` 个人）。`upload_files` 支持 `kind=project/contract/ip/archive/general`、归属 `owner_id=FolderId` 和本机绝对路径数组 `paths`（1–20 条）；`kind=archive` 必须填写所属分类 `section`（公司 certificate/achievement；个人 certificate/achievement/academic），且所选 FolderId 及 section 必须一致。`on_conflict=new/update`；更新需指定目标 `file_id=FileId` 且同 Folder 有效关联；同内容已有候选必须明确 `duplicate_mode=independent/reuse/share`，复用/共享还须正确 `source_file_id`。IP 的 `material_category` 可设为申请材料/通知文件/证书文件/其他材料，其他类型不可传此专用类别。

`create_ip` 的必填参数为 `workspace`、`name`、`ip_type`，`update_ip` 使用 `ip_id` 查找记录。可填写 `status`、`applicants`、`right_holders`、`creators`、`application_no`、`application_date`、`publication_no`、`publication_date`、`grant_notice_no`、`grant_notice_date`、`publication_info`、`grant_date`、`registration_no`、`first_published_date`、`registration_date`、`category`、`remarks`、`tags`。支持发明、实用新型、外观设计专利等既有七种知识产权类型，状态和日期自动走原有业务校验；更新时不改变未传入的字段。

上传不会无提示合并已有原件；单文件上限 64 MiB。业务记录软删除可在回收站恢复；删除原件只解除指定 LinkId，原件版本和其它共享位置保留，物理清理仍受历史引用保护。

## N2-04 档案、目录及综合资料 MCP 工具

新增 `list_archives/create_archive/update_archive/delete_archive`：通过指定 `section` 与 `archive_id` 操作 V2 资料，创建公司业务档案 achievement 时还需指定有效 `folder_id`（所属业务目录），修改属性不移动目录；`list_archive_folders` 默认列出公司七个系统根，可传 `parent_id` 逐级查询子目录，`create_archive_folder/update_archive_folder/delete_archive_folder` 创建、修改和删除允许删除的目录，系统根及含历史子资料目录受保护。综合资料使用 `list_general/create_general/update_general/delete_general`，仅需名称 `title` 和修改/删除时的 `general_id`。文件统一通过 `upload_files`、`list_files` 和 `delete_file`，不要求手动生成内部文件 ID。所有写操作以当前解锁工作区的真实 V2 身份校验；禁止越区、错分类或无关联 FileId 追加历史版本。

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
