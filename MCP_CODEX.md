# IPSys 本机 Codex MCP

> **当前版本（2026-10-17）**：N4 与 MCP 三批功能均已完成；新增针对 WorkBuddy 黑盒任务书 ISS-1～ISS-10 的安全/并发/协议/语义修复，源码 `6cb1e6b` 对应 [Windows CI #38939165516](https://github.com/zy19970/IPSys/actions/runs/38939165516) **completed/success**。Windows Debug/Release、正式 stdio、SQLCipher/HTTP、Node 回归通过；管理员与普通用户混合、WorkBuddy Bash 沙箱和不同用户隔离仍待用户电脑逐项实测。下方历史阶段保留追溯，以现行操作章节为准。


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

## MCP 黑盒问题整改说明（2026-10-17）

**自动验收证据**：代码 [`6cb1e6b`](https://github.com/zy19970/IPSys/commit/6cb1e6b0d30031d2c1e55f5e34de720ad0fa0e62)，[CI #38939165516](https://github.com/zy19970/IPSys/actions/runs/38939165516) completed/success；对纯读有界等待、缺失资源 404、ISO UTC、日志业务成败和虚构版本/空白 stdio 回归已加入自动测试。跨权限连接矩阵需要同机测试，不能凭 CI 宣称已通过。


依照本机多客户端实测后的独立审查处理 ISS-1～ISS-10：Windows 管道通过实际 TokenUser SID 显式 ACL 限定同用户，客户端核对服务端管道 Owner SID，消除 TokenOwner 比较本身造成的误拒绝；但 Windows 强制完整性级别（MIC）可能仍禁止普通权限客户端写入提升宿主创建的管道，**不能仅凭 CI 宣称“管理员宿主＋普通权限 Agent”已实机通过，更不能通过降低强制完整性级别绕过 UAC**。如遇 ACCESS_DENIED，建议退出 IPSys 后以普通用户权限重新启动并解锁；同时检查程序 EXE/目录 NTFS 访问权限。**不能把管理员进程授予的宿主文件权限误认为普通 Agent 本身具备的权限**，建议 IPSys 尽量以普通用户身份运行。Windows 可执行文件目录本身的 NTFS 权限与管道 ACL 属不同检查项。不同 Windows 用户不能跨用户连接；管理员/非管理员、沙箱和跨用户拒绝仍需用户电脑实测。

`list_files_page` 纯读使用最多 5 秒的有界数据库等待，不再因短暂锁竞争直接 409。对服务端明确证实“尚未执行”的 409 前置拒绝，仅在本次调用中做最多 3 次短等待；耗尽时允许复用原 `request_id`，不产生 uncertain 操作记录；请求已发出后断线或结果不明绝不自动重试写入。若长任务持续占库仍可能返回明确繁忙信息，不能承诺长时写任务与读请求完全无等待。

stdio 初始化只声明真正支持的 `2025-06-18` 协议版本；空行静默跳过，stderr 使用 UTF-8；无响应正文的 HTTP 404 补充操作资源和 ID；文件历史版本 UTC `createdAt` 输出 `yyyy-MM-ddTHH:mm:ssZ`。跨工作区 `transfer_*(move=true)` 会生成目标新 ID、源资料软删除进入原工作区回收站，恢复旧记录可能形成两份并存资料。日志 `state=done` 只代表“请求处理结束并已记录”，必须再看 `businessOk` 与 `result.status` 判断业务成功。搜索结果 `kind=file` 不等于回收站 `kind=v2_file/v2_ip_file`，恢复前先查询 `list_trash` 并原样使用返回 ID/kind/section。初始化文案不再仅提 Codex。

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

4. 重启或刷新 Codex 会话中的 MCP 工具清单，核实可见 `list_files_page`、`update_contract`、`get_file_details`、`search_records`、`restore_trash`。其他支持 stdio MCP 的客户端使用同一 `IPSys.Web.exe --mcp`，需要与宿主为同一 Windows 用户；工作结束回 IPSys 关闭 MCP。

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
| `get_operation_result` | 按 request_id 查询 done/pending/uncertain/not_found，结果不明时不盲目重试 |
| `update_contract` | 只修改合同指定字段，保留所属项目及未提供的属性 |
| `get_file_details` / `update_file_metadata` | 查询 FileId 元数据及全部有效版本、修改名称/说明/标签/编号/日期 |
| `download_file_version` | 指定 FileId、版本号、Windows 宿主绝对 output_path，禁止覆盖已有文件 |
| `associate_file` / `restore_file_link` | 同区共享/移动现有关联及按 FolderId/FileId/LinkId 恢复已解绑关系 |
| `copy_file` | 复制全部有效历史版本至新 FileId；跨工作区只能 independent-content |
| `transfer_project` / `transfer_ip` | 携业务记录、原件及有效版本复制/转移 |
| `transfer_archive` / `transfer_general` | 携档案或综合资料及有效版本复制/转移 |
| `search_records` | 单工作区结构化统一检索，不读取文件正文 |
| `list_trash` / `restore_trash` | 返回回收站原 kind/id/section，并按精确身份恢复一条记录 |

所有工具均需显式指定 `workspace`（`company` 公司、`personal` 个人）。`upload_files` 支持 `kind=project/contract/ip/archive/general`、归属 `owner_id=FolderId` 和本机绝对路径数组 `paths`（1–20 条）；`kind=archive` 必须填写所属分类 `section`（公司 certificate/achievement；个人 certificate/achievement/academic），且所选 FolderId 及 section 必须一致。`on_conflict=new/update`；更新需指定目标 `file_id=FileId` 且同 Folder 有效关联；同内容已有候选必须明确 `duplicate_mode=independent/reuse/share`，复用/共享还须正确 `source_file_id`。IP 的 `material_category` 可设为申请材料/通知文件/证书文件/其他材料，其他类型不可传此专用类别。

`create_ip` 的必填参数为 `workspace`、`name`、`ip_type`，`update_ip` 使用 `ip_id` 查找记录。可填写 `status`、`applicants`、`right_holders`、`creators`、`application_no`、`application_date`、`publication_no`、`publication_date`、`grant_notice_no`、`grant_notice_date`、`publication_info`、`grant_date`、`registration_no`、`first_published_date`、`registration_date`、`category`、`remarks`、`tags`。支持发明、实用新型、外观设计专利等既有七种知识产权类型，状态和日期自动走原有业务校验；更新时不改变未传入的字段。

上传不会无提示合并已有原件；单文件上限 64 MiB。业务记录软删除可在回收站恢复；删除原件只解除指定 LinkId，原件版本和其它共享位置保留，物理清理仍受历史引用保护。

## N2-04 档案、目录及综合资料 MCP 工具

新增 `list_archives/create_archive/update_archive/delete_archive`：通过指定 `section` 与 `archive_id` 操作 V2 资料，创建公司业务档案 achievement 时还需指定有效 `folder_id`（所属业务目录），修改属性不移动目录；`list_archive_folders` 默认列出公司七个系统根，可传 `parent_id` 逐级查询子目录，`create_archive_folder/update_archive_folder/delete_archive_folder` 创建、修改和删除允许删除的目录，系统根及含历史子资料目录受保护。综合资料使用 `list_general/create_general/update_general/delete_general`，仅需名称 `title` 和修改/删除时的 `general_id`。文件统一通过 `upload_files`、`list_files` 和 `delete_file`，不要求手动生成内部文件 ID。所有写操作以当前解锁工作区的真实 V2 身份校验；禁止越区、错分类或无关联 FileId 追加历史版本。

## 现行 MCP 安全操作示例

所有命令必须在 IPSys 宿主已解锁、手动开启 MCP 且客户端刷新工具列表后执行。工作区 `workspace` 必须明确选择 `company` 或 `personal`。每项写操作建议使用独立 UUID 作为 `request_id`，重试相同请求时必须保留原请求编号与参数，绝不可更换编号盲目重做。只有 `get_operation_result` 返回 `done` 才能直接确认日志里记录的最终结果；`pending/uncertain` 必须人工核对。

合同修改：先 `list_contracts` 查找真实 `contract_id`，再使用 `update_contract` 提交明确字段；省略或传 `null` 表示不变，允许清空的字段传空字符串。

文件归档：`list_files_page` 按 `kind`、`owner_id`、`name` 筛选；上传后检查 `upload_files` 返回的 `status`、`succeeded`、`failed` 和逐文件信息。需要取消某处关联时，必须从同一条结果取得 FolderId (`owner_id`)、FileId (`file_id`) 和 LinkId (`link_id`)，然后调用 `delete_file`，不可将 LinkId 当 FileId。

历史版本下载：调用 `get_file_details` 核对 FileId 和版本，再用 `download_file_version` 指定 `version` 与 `output_path`。路径指向 **IPSys 宿主所在 Windows 电脑**，目标目录须存在、具备写权限，目标文件必须不存在。新文件的完整历史复制用 `copy_file`；跨工作区只能选择 `independent-content`。

回收站恢复：`list_trash` 后从目标条目原样获取 `kind`、`id`、`section`，交给 `restore_trash`。跨工作区转移用 `transfer_project/ip/archive/general` 和 `target_workspace`；`move` 默认不启用，移动前确认来源和归属关系。原件容量上限仍是 64 MiB。

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

## 项目/合同 N2-03-07-02 首批 MCP（历史记录，2026-10-16）

**历史阶段说明**：此处所述项目/合同 MCP 原名与 V2 的切换，以及当时尚需开发的 Excel、搜索、回收站和跨区复制均已在后续 N2-04 与第三批 MCP 完成。现行 `list_files` 已改为一次 SQL 查询；`delete_file` 须同时核对 owner_id=FolderId、file_id=FileId、link_id=LinkId。当前操作规则和最新验收以本手册前文为准。
