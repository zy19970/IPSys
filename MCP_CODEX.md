# IPSys 本机 Codex MCP

> **2026-10-16 最新 N2-04 MCP 验收**：原名项目、合同、知识产权以及业务档案、目录、综合资料 MCP 均使用当前网页的 SQLCipher V2 FolderId/FileId/LinkId；`upload_files(kind=project/contract/ip/archive/general)`、通用 `list_files/delete_file` 覆盖全部五种业务记录。新增档案/综合资料 12 项工具、子目录 parent_id 枚举和跨区/归属/原件历史保护：[功能提交 db79b82](https://github.com/zy19970/IPSys/commit/db79b825a3b7fb1ab384a70da69575d55e653b80)，[测试修正 f49bc49](https://github.com/zy19970/IPSys/commit/f49bc49a30c86ba89589e34083d0a0c2cff1f860)，[Windows CI #38880280977](https://github.com/zy19970/IPSys/actions/runs/38880280977) **success**。本轮 [6a7b1ff](https://github.com/zy19970/IPSys/commit/6a7b1ffe882aaa114c9d90af7011068cad7fd330) 又将正式页面旧附件/Excel/业务 HTTP 暴露面限制为 `--smoke` 历史测试，全部 ZIP/文件夹导出只使用 V2 FileId+FileVersion；[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) **success**。仍需在已解锁的本机软件中手动开启 MCP，不开放 TCP 端口；本机 Codex 人工验收另行进行。


IPSys 支持本机 Codex 通过 MCP stdio 操作同一 Windows 用户已解锁资料库，复用软件现有 SQLCipher 会话而不另开库。全部原名工具和已有 `v2_*` 项目/合同/IP 工具均使用 V2 FolderId；旧业务表与新版资料 ID 不混用。

## MCP P0 连接与参数修正规则（2026-10-16）

本机 MCP 采用“多个 Agent stdio 子进程 → 当前用户命名管道 → 唯一 IPSys GUI 宿主 → 既有已解锁 SQLCipher V2 HTTP”的固定链路。Windows 每个用户交互会话只允许一个 GUI 宿主实例（启动时由系统命名事件保护）；额外 Agent 使用同一 EXE 的 `--mcp` 模式启动，不受单实例限制。不得同时通过不同宿主操作其它已打开数据库。

**并发与故障提示**：宿主允许最多 8 个独立 MCP 客户端连接同时执行请求，SQLCipher 写入仍经 `Vault.Gate` 和文件任务锁保护。连接等待上限为 15 秒；未检测到 GUI 宿主时提示启动/开库/授权，宿主已存在但连接超时时明确提示繁忙或暂不可用，不再把双客户端竞争误报为未启动。极端负载时仍需让 Agent 稍后重试。

**参数约束**：`group_id` 属旧 V1 参数，已从 `upload_files` Schema 删除；即使旧客户端仍发送，也会收到明确报错，追加历史版本只用 `on_conflict=update` 和目标 `file_id=FileId`。MCP `amount`、`year` 可传 JSON 数字或字符串，写入业务属性时规范化为文本并继续经过已有金额/年份校验；全部资源 ID 仍须是正整数。可选文本字段在更新时，省略或传 JSON `null` 表示“不修改已有值”，传 `""` 表示“明确清空”（仍须满足必填校验）；创建时可选字段 `null` 视为未提供，必填字段不可缺失或为 `null`。

**回归重点**：确认单实例重复占用检测、一个闲置管道连接期间第二客户端仍可查询、MCP 工具 Schema 不再声明 `group_id`、数字金额及数字年份正常写入、`null` 保留与空串清空、旧 `group_id` 明确报错、既有原件/工作区隔离测试不回退。Windows CI 及本机 Codex/WorkBuddy 实机需分别留证。

## MCP P1 第一批：安全写入与恢复语义（2026-10-16）

> **自动验收**：[`a6d5bf4`](https://github.com/zy19970/IPSys/commit/a6d5bf43274368f421fd578c5a69f9cfc27e5337) 对应 [Windows CI #38923795350](https://github.com/zy19970/IPSys/actions/runs/38923795350) **completed/success**。Windows Debug/Release、stdio 握手、原生 SQLCipher/HTTP 和 Node 回归通过；实际 Codex/WorkBuddy 长任务及进程崩溃故障注入仍待实测。


MCP 写操作（新增、修改、删除、上传，以及已有 `v2_*` 写操作）可传入 `request_id`（8–128 字符，推荐 UUID，每一项业务写操作唯一）；重试同一业务动作必须使用相同编号和相同参数。V2 SQLCipher 数据库内的 `mcp_operations` 记录状态：`done` 表示结果已保存、相同请求返回同一结果，`pending`/`uncertain` 表示执行结果尚未得到确认，系统**拒绝盲目重做**。新增 `get_operation_result(workspace,request_id)` 只读工具，查询 `not_found/pending/done/uncertain` 和已记录结果。请求参数不一致或重复编号挪作其他操作会报错。本机原始 V2 测试库可重新创建；不进行旧数据库迁移。

**安全边界**：正常执行和已保存结果可防止多数断线重试重复写入；服务进程在 HTTP 实际写入成功而结果尚未写入操作日志时崩溃，仍可能留下 `pending`，因此不能声称跨崩溃严格 exactly-once。发生 `pending/uncertain` 时应检查对应 Folder/File/版本后人工决定后续动作，不能换新编号立即重做同一业务动作。省略 `request_id` 仍兼容旧客户端，但不提供写入重试记录的保护。

**文件解绑**：通用 `delete_file` 现在必须提供 `workspace`、`owner_id=FolderId`、`file_id=真实 FileId`、`link_id=LinkId`，三个身份须来自同一条 `list_files` 结果。旧版只传 `file_id=LinkId` 的调用已不再允许。专用项目/合同/IP 文件删除工具原先已核对 FileId+LinkId 与所属资料。

**批量上传**：`upload_files` 返回 `requested/succeeded/failed/status/files[]`；状态有 `success`、`partial_success`、`failed`、`interrupted`。每个文件包含独立的成功/错误明细。只要存在失败，MCP `tools/call` 设置 `isError=true`，同时保留完整 JSON 结果供 Agent 逐项核对。已成功文件不会自动回滚；不要因为一次返回失败就把所有文件重新上传。撤销 MCP 授权可在文件任务执行期间立即阻止新的 MCP 请求，并触发正在进行的 MCP HTTP 操作取消；已提交的文件可能保留，需核对后续操作。

**入参与等待**：工具 Schema 中未声明的参数、参数类型不符、缺少必填项、错误枚举或无效数组长度均直接返回错误，不再静默忽略。业务字段 `year/amount` 支持数字或字符串，可选字段 `null` 保留、空串明确清空。MCP 管道连接等待 15 秒，已连接后的响应等待上限 12 分钟；若等待超时，写操作结果可能不确定，应查询原 `request_id` 而不是直接重试。

## MCP P1 第二批：全局文件查询、分页与兼容接口（2026-10-16）

> **自动验收已通过**：代码 [`bfab1a8`](https://github.com/zy19970/IPSys/commit/bfab1a8aead2a65cf375b2fe5429776befe26970)（含第一次提交 `f0454e4` 的单次测试变量修复），[Windows CI #38927263017](https://github.com/zy19970/IPSys/actions/runs/38927263017) **completed/success**。Debug/Release、单 EXE、真实 SQLCipher/HTTP/Node，以及正式 stdio `tools/call` 入参拒绝均通过；大数据库性能定量基准和 Codex/WorkBuddy 实机仍待人工验收。


`list_files` 现直接调用同一 SQLCipher V2 数据库中的本机只读批量查询，仅执行一次 SQL 查询，不再先列出全部项目/合同/知识产权/档案/综合资料，再对每个 Folder 各发一个 HTTP 请求。保留该旧名工具的原返回格式（数组），`id` 是 LinkId、`fileId` 是 FileId、`ownerId` 是所属 FolderId，避免破坏现有 Codex/WorkBuddy 配置。服务端通过递归有效目录校验隐藏已删除的业务条目及其上级目录，确保不泄露不可见文件关联。

**日常大量文件查询建议使用 `list_files_page`**：必填 `workspace`，可选 `kind`（project/contract/ip/archive/general）、`owner_id`、`name`（位置显示名或原件名的部分匹配）、`offset`（起始 0）和 `limit`（1–200，默认 100）。返回 `items` 数组以及 `offset/limit/hasMore/nextOffset`；仅当 `hasMore=true` 时使用 `nextOffset` 取下一页。可按 `owner_id` 准确定位。底层只读 URL `/api/v2/mcp/files/{workspace}` 继续执行本机会话 Token 鉴权，不暴露对外端口。分页使用 LinkId 顺序；在多个 Agent 同时插入或删除链接时，基于 offset 的页间数据可能变化，跨页汇总应再次核验。

**兼容范围**：现有 11 项 `v2_*` 项目/合同/IP 工具与原名工具均实际访问相同 V2 Folder 业务数据，仍保留老名称，防止旧客户端因工具移除而失败。原名 `list_projects/list_contracts/list_ips` 返回网页友好的列表投影，`v2_*` 列表返回原生 FolderSnapshot，两者响应形态不同；建议 Agent 一次任务固定选择一个系列，不混合解析。未来如统一响应契约，应设计新版本并经过客户端兼容验收，而不直接改变既有返回格式。

**本批专项回归**：检查 V2 文件查询中跨工作区隔离、同一 FileId 多位置、合同父级删除后的可见性、档案目录层级、分页前后 LinkId 不重复、名称与 Folder 筛选、非法页大小拒绝；验证发布版 stdio 的真实 `tools/call` 能严格拒绝未知字段。Windows CI 和真实 Codex/WorkBuddy 大型资料库负载分别留证。

> MCP 第三批源码 `080a599` 已通过 [Windows CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) **completed/success**：Windows Debug、Release 单 EXE、stdio 握手、SQLCipher/HTTP 业务往返、Node 回归。实际 Codex/WorkBuddy 长耗时跨工作区复制、不同 Windows 目录权限及用户操作仍需本机人工验收。

## MCP 第三批业务操作

现有 V2 HTTP 能力补齐至 MCP：`update_contract` 编辑合同；`get_file_details`、`update_file_metadata`、`download_file_version` 管理文件属性、版本和指定版本本机下载；`associate_file`、`restore_file_link`、`copy_file` 管理原件共享、关联恢复及完整历史复制；`transfer_project`、`transfer_ip`、`transfer_archive`、`transfer_general` 处理整份资料复制/移动；`search_records` 提供跨业务搜索；`list_trash` 与 `restore_trash` 查询及精确恢复回收站条目。

写操作使用可选 `request_id` 幂等日志；回收站恢复必须提供 `list_trash` 原样返回的 kind/id/section。下载路径是 **运行 IPSys 的本机 Windows 电脑**上的绝对路径，仅新建文件、不覆盖已有文件。跨工作区复制文件必须使用 `independent-content`，共享关联只允许同工作区。单个文件上限仍为 64 MiB；所有操作需要当前数据库解锁和手动 MCP 授权。

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
| `list_files_page` | 同一 V2 FileId/LinkId 模型的高效分页查询；支持 kind、owner_id、name 筛选及 hasMore/nextOffset 分页标志 |
| `create_project` | 创建科研、横向或其他项目 |
| `update_project` | 按 ID 更新指定字段 |
| `delete_project` | 将项目及其合同移入回收站 |
| `create_contract` | 在有效项目下创建合同 |
| `delete_contract` | 将合同移入回收站 |
| `upload_files` | 按本机绝对路径上传项目、合同、知识产权、档案或综合资料原件，支持 SHA-256 显式选择和历史版本追加 |
| `delete_file` | 必须同时指定 owner_id（FolderId）、file_id（真实 FileId）及 link_id（LinkId），只解除经过三重校验的一处关联 |

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

Codex 通过 stdio 使用同一个 EXE 的 `--mcp` 模式，子进程仅通过当前 Windows 用户的本机命名管道向已运行的 IPSys 宿主提交操作；没有新 TCP 端口、不会向 Agent 暴露数据库密码或网页 Token。必须由用户在已解锁程序中手动授权开关，关库/退出即失效。Agent 操作属于用户明确委托，正式库建议预先手动备份，尤其删除前核对 ID。打开 MCP 后，当前 Windows 用户的本机 Agent 可以通过上述工具写入和软删除资料。同一用户交互会话中第二个 GUI 宿主会被程序拒绝启动。

更多步骤见 `WEB_TESTING.md`。

> **2026-10-16 当前 V2 MCP（N2-03-05/06 已验收）**：`list_ips/create_ip/update_ip/delete_ip` 与 `v2_*_ip*` 使用当前知识产权网页相同的 V2 FolderId，不再写旧 IpStore。原 `upload_files` 指定 `kind=ip` 时从本机绝对路径写入 V2 原件；`owner_id` 必须是知识产权 FolderId；新增 `list_ip_files` 按 `ip_id` 返回有效 LinkId/FileId/材料类别/最新版，`delete_ip_file` 需同时提供 `ip_id`、`file_id`、`link_id`，只删除单处关联。

## V2 原生业务 MCP 工具（N2-03-01）

新增 `v2_list_projects`、`v2_create_project`、`v2_update_project`、`v2_delete_project`；`v2_list_contracts`、`v2_create_contract`、`v2_delete_contract`；`v2_list_ips`、`v2_create_ip`、`v2_update_ip`、`v2_delete_ip`。参数名继续沿用原 `workspace`、`project_id`、`ip_id` 等结构，实际结果包含原生 `FolderSnapshot`（`folder.ref.id`、`businessData`）；合同必须指定当前工作区真实有效项目的 `project_id`。

`v2_*` 项目/合同/IP 及原名项目合同/IP CRUD 使用相同 V2 FolderId。所有 `upload_files` 的项目、合同、IP 类型现统一写入 V2 FileId/版本，发现 SHA-256 同内容必须由调用者决定 `duplicate_mode=independent/reuse/share` 或取消；`reuse/share` 必须用匹配的 `source_file_id`，`on_conflict=update` 则用已归属于所选 `owner_id` 的 `file_id`。旧 `group_id` 不能代替新版 FileId。软件内手动开启及本机授权始终适用。


## V2 知识产权 MCP 原件操作（N2-03-06）

调用 `upload_files` 指定 `workspace=company/personal`、`kind=ip`、`owner_id=V2 FolderId`、`paths=[绝对路径]`、可选 `material_category`（申请材料/通知文件/证书文件/其他材料）。无重复内容时生成新 FileId；有 SHA-256 重复内容时，若未明确给出 `duplicate_mode`，返回已有文件的名称/位置/FileId 并撤销暂存，不自动合并。确认后可设置 `duplicate_mode=independent` 独立保存、`duplicate_mode=reuse` 且 `source_file_id=已有 FileId` 仅复用物理内容，或 `duplicate_mode=share` 加上 `source_file_id` 共享同一 FileId。服务端复核匹配哈希与工作区归属。为原 FileId 追加版本时使用 `on_conflict=update` 和 `file_id=目标 FileId`，不得同时提供内容复用选项。查询用 `list_ip_files(ip_id=...)`；解除用 `delete_ip_file(ip_id=...,file_id=...,link_id=...)`。这些操作均使用原有手动启用的 MCP 授权、仅本机用户管道和 SQLCipher，不开放外部网络访问。

[Windows CI #38833862535](https://github.com/zy19970/IPSys/actions/runs/38833862535) 已验证原知识产权 V2 原件。项目合同专用与通用链接命令见 N2-03-07-02 首批提交；`list_files` 的 `id` 是 **LinkId**，不是 FileId，`delete_file(owner_id=...,file_id=FileId,link_id=LinkId)` 只解除核验过的一条链接，不删除其它 Folder 中共用的原件，也不删除 FileVersion。开发测试数据库不迁移、兼容或回填。

## 项目/合同 N2-03-07-02 首批 MCP（2026-10-16）

现有项目/合同网页已通过 [CI #38836041449](https://github.com/zy19970/IPSys/actions/runs/38836041449) 接入 V2。原名项目合同 `list_projects/create_project/update_project/delete_project`、`list_contracts/create_contract/delete_contract` 现在均使用相同 V2 FolderId；`upload_files(kind=project/contract)` 复用 V2 暂存查重/用户选择协议（不直接写旧 business-files 表），历史版通过 `on_conflict=update + file_id` 追加。`list_project_files(project_id)` / `list_contract_files(contract_id)` 返回目标 Folder 有效文件 LinkId/FileId；`delete_project_file` / `delete_contract_file` 必须提供 FolderId、FileId、LinkId，单处软解绑。通用 `list_files` 汇总 V2 的项目/合同/IP 有效链接，`delete_file(owner_id=FolderId,file_id=FileId,link_id=LinkId)` 只解除一处共享位置。下一项为项目合同 V2 固定列 Excel，随后统一搜索/回收站、跨工作区携所属合同及全部文件版本原子复制，最后再对用户本机 Codex 与 Edge/Chrome 实机验收。
