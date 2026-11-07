# IPSys 本机 Codex MCP

> 本手册负责 MCP 接入、对象身份、参数语义、Agent 规范与安全操作。项目版本、当前验收与发布状态只在 [CURRENT_BASELINE](docs/CURRENT_BASELINE.md) 维护；工具的实际名称、数量及参数以运行中的 `tools/list` 为准。

## 工作区、模块与资源身份

MCP 的 `workspace` 和 `section` 是**组合业务标识**；`certificate` 不能脱离工作区直接翻译为“证书/资质”。下表同时对应现行 Explorer `WS_CATS`、数据库的 `archive_folder.section` 和 MCP 英文参数：

| 工作区 `workspace` | 普通目录模块 `section` | 用户可见业务名称 |
| --- | --- | --- |
| `company` | `certificate` | 企业资质 |
| `company` | `achievement` | 业务档案 |
| `company` | `party` | 党团建设 |
| `company` | `general` | 综合资料 |
| `company` | `project` | 公司项目下普通目录（合同材料也属于此类） |
| `personal` | `certificate` | 人力资源 |
| `personal` | `achievement` | 成果与奖励 |
| `personal` | `academic` | 学术与社会活动 |
| `personal` | `general` | 其他资料 |
| `personal` | `project` | 科研与合作项目下普通目录 |

`project` 和 `ip` 记录本体采用各自的 `kind`、FolderId；`ip` **不是**普通目录 `section`。项目下目录使用 `kind="archive_folder", section="project"`，必须指定实际项目或子目录 FolderId；其它普通资料模块也是 `kind="archive_folder"`，不能把显示名称作为 `section` 参数值。工作区和模块必须由用户归属及查询到的记录共同确定，未知时先只读查询或向用户确认目标，不得因为“证书”“成果”等字面相近就跨工作区上传或改名。

**MCP 对象与操作约定：** `FolderId` 是项目/知识产权/目录对象；`FileId` 是含版本的逻辑文件；`LinkId` 是它在某位置的一条关联。`kind` 表示资源或回收站种类，与 `section` 不同；搜索结果 `file` 不等于回收站 `v2_file/v2_ip_file`，恢复/永久删除前先用 `list_trash` 获取原始参数。写操作应提供 `request_id` 并在重试时复用原编号；状态 `done` 仍需核对实际业务成功字段。目录排序的 `list_folder_entries/reorder_entries` 操作的是**持久 position**，并非 Explorer 的临时“名称升序”；不要为改变界面显示调用重排接口。

业务身份的解释须与程序的 `tools/list` 参数描述、内嵌 Agent 指南一致。示例：个人“人力资源”使用 `list_folders(workspace="personal",section="certificate")`；公司“企业资质”使用 `list_folders(workspace="company",section="certificate")`。不得将中文栏目名直接代入 `section`。

## 文件重命名与共享名称

**现有 MCP 已支持修改附件名称，不需要增加新工具。** 使用 `update_file_metadata`，传入 `workspace`（`company` 或 `personal`）、实际 **FileId** 的 `file_id` 和新文件名称 `name`。例如：

```text
update_file_metadata(workspace="company",file_id=实际FileId,name="新的附件名称.pdf")
```

它使用经过授权的 `PUT /api/v2/files/{workspace}/{fileId}/metadata`，修改的是**共享逻辑文件本体（FileId）名称**，不是某一 LinkId 的位置显示别名。其余说明、标签、编号和日期若不传则先从 `get_file_details` 对应后端记录读取并原样保留。通过 `list_file_links(workspace,file_id)` 可在操作前确认此 FileId 被共享到哪些业务记录。其它未设置独立 LinkId 显示名的位置将显示新名称；已有显示别名继续保留。**文件内容、SHA、FileId/LinkId、历史文件版本和历史版本原始文件名不变**。改名不会创建新 FileVersion；无权访问的文件或文件任务繁忙时服务器仍按原安全规则拒绝。

Explorer 的单附件右键“重命名”和 F2 与此 `update_file_metadata` 操作使用同一文件本体命名语义。批量选择不提供单独的统一改名操作。

## 项目与普通目录的操作契约

当前没有独立的 `contract` 业务类型。原 `list_contracts`、`create_contract`、`update_contract`、`delete_contract`、`copy_contract`、`list_contract_files`、`delete_contract_file` 均不可调用；旧 `tools/call` 直接调用也会返回未知工具。项目下的合同资料只是一层或多层普通文件夹，不再单独维护合同对象或专有属性。

业务记录类型为 `project`、`ip`，普通目录类型为 `archive_folder`。业务模块由 `section` 标识；公司支持 `certificate/achievement/party/general/project`，个人支持 `certificate/achievement/academic/general/project`。创建项目子目录须设置 `section="project"` 且提供 `parent_id`，该 ID 必须指向工作区内真实存在的项目或项目子目录。例如先调用 `create_project(workspace="company",name="项目A",project_type="科研项目")` 获得项目 FolderId=123（示例），再调用 `create_folder(workspace="company",section="project",parent_id=123,name="合同资料")`，实际调用以返回 ID 为准。目录可继续嵌套，不能将虚拟模块根视为项目父级。

普通目录使用 `list_folders/create_folder/update_folder/delete_folder/move_folder/transfer_folder` 及 `list_files_page/upload_files/list_file_links/associate_file` 等共享能力。上传项目目录附件时使用 `upload_files(workspace="company",kind="archive_folder",section="project",owner_id=实际目录FolderId,paths=[...])`。项目直属附件仍使用 `kind="project"`。统一搜索仅接受 `project/ip/archive_folder/file`；回收站记录类型使用 `list_trash` 实际返回的 `project/ip/v2_archive_folder/v2_file/v2_ip_file`。文件共享保持 FileId，不同位置拥有 LinkId；追加版本属于 FileId；跨工作区的项目整树复制含全部版本且物理 FileObject 隔离。

新建加密资料库使用 SQLCipher schema 4；旧 schema 2/3 和结构不完整的库不能由现行版本自动迁移或修补。HTTP `/api/v2` 是路由命名，不代表数据库 schema 版本。数据库试验须使用独立可丢弃的新库；更换 EXE 后重新连接 MCP 客户端并刷新 `tools/list`。

## 普通目录同层排序

**普通目录列表与排序统一为两个工具**：

1. `list_folder_entries(workspace,section,parent_id)`：返回**指定父级的全部有效普通子文件夹**，按数据库 `position` 顺序排列。workspace 为 `company` 或 `personal`；section 为当前工作区支持的普通目录模块。非 project 模块的 `parent_id=0` 是该模块根目录；`section=project` 时 `parent_id` 必须是实际项目或其普通子目录的正整数 FolderId。目录拥有附件不改变目录同层列表的粒度。
2. `reorder_entries(workspace,section,parent_id,items,request_id?)`：items **必须精确包含指定父级下的全部有效普通子文件夹**，每项且仅有 `{kind:"folder",id:正整数FolderId}`。不得包含附件、其他项目或模块、后代、重复项、旧 `record` 种类，也不能少一个或多一个。缺项、错项、过期列表返回确定的拒绝，不写入部分顺序；若刚有目录新增/删除，应重新执行 `list_folder_entries` 构造新列表，不能盲目重试旧 items。

两工作区的合法 section：`company: certificate, achievement, party, general, project`；`personal: certificate, achievement, academic, general, project`。实际提交只更新同父级 `folders.position`，不修改 FolderId、FileId、LinkId、历史版本、目录名或层级。

示意：将公司项目 FolderId 为 101 的三个直属普通目录调整为 `303,301,302` 的顺序（ID 均为示例，必须先查询真实值）：

```json
{"workspace":"company","section":"project","parent_id":101,"items":[{"kind":"folder","id":303},{"kind":"folder","id":301},{"kind":"folder","id":302}],"request_id":"s4-project-siblings-001"}
```

**接口区分**：旧 `reorder_folders` 和 `/api/v2/ui/folders/{workspace}/{section}/order` 已退出，不能再发送旧参数 `ids` 代替 `items`。`reorder_records(workspace,kind=project,ids)` 是项目台账排序，不是普通目录同层全量排序；名称升序是 Explorer 显示排序，不应通过 `reorder_entries` 改写持久 position。

`reorder_folders` 和 `kind=record` 均为旧接口示例，不得用于当前请求。

## 目录移动、独立复制与共享

`move_folder(workspace,section,folder_id,parent_id?,target_section?,request_id?)` 仅在**同一工作区**移动普通目录，`target_section` 未传等于来源 `section`；非 project 模块可省略 `parent_id`，也可使用 `null/0` 表示目标模块根。目标为 project 时 `parent_id` **必须**是同工作区真实项目或普通子目录的正整数 FolderId，不能用虚拟根。移动后返回 `id` 就是原 FolderId，关联 LinkId、FileId 和历史版本不变；如果跨模块成功，之后查询必须使用**新的来源 section**。

`transfer_folder(workspace,section,folder_id,target_workspace,target_section,target_folder_id?,move?,request_id?)` 保留既有参数。目标为 project 必须提供真实 `target_folder_id`；非 project 的 `null/0/省略` 表示根目录。该工具的三种语义分别为：

1. `move=false`：整树**独立复制**，返回新 FolderId，并为原件创建独立 FileId（全部历史版本保留）；来源不删除。与“共享目录树”不同，后续新增版本互不传播。
2. `move=true` 且 `target_workspace=workspace`：同一工作区**原位移动**，返回原 FolderId，子目录/LinkId/FileId/版本保持不变；不在回收站产生被复制删除的来源副本。
3. `move=true` 且跨工作区：整树独立复制后，来源移入回收站，返回目标的新 FolderId；目标文件历史完整但使用新的 FileId 和物理隔离 FileObject。跨区不支持的模块映射或同名目标移动会明确拒绝，事务不提交。

同工作区普通文件夹“共享”由 Explorer `/api/v2/ui/folders/{workspace}/{section}/transfer-batch` 的 `move=false` 执行：为目标创建新 FolderId、LinkId，但仍引用**相同 FileId**，追加版本对两处均可见。它**不是** MCP `transfer_folder(move=false)` 的独立复制语义，Agent 不应混淆。MCP 如要共享单个原件，可调用现有 `associate_file`；不要假设 MCP 的目录独立复制自动构成共享关联。

目标矩阵：同一工作区可转移到该工作区允许的普通模块；跨工作区仅允许 `company/achievement → personal/achievement|academic`、`company/general → personal/general`、`company/project → personal/project` 及对应反向 `personal/achievement|academic → company/achievement`、`personal/general → company/general`、`personal/project → company/project`。跨工作区的 certificate/party 转移不在支持范围。项目/子目录选择器可以逐级查找和搜索，不需要将所有目标加载为一条巨大下拉列表。

实际调用示例（ID 应取本次工具返回值，以下仅示意）：

```json
{"workspace":"company","section":"project","folder_id":201,"target_section":"general","parent_id":0,"request_id":"s3-move-project-general-001"}
```

成功后使用 `section=general` 引用同一个 FolderId。独立复制回真实项目时：

```json
{"workspace":"company","section":"general","folder_id":201,"target_workspace":"company","target_section":"project","target_folder_id":101,"move":false,"request_id":"s3-copy-into-project-001"}
```

以上 101/201 都是示意数字，不得未经查询对用户库执行。每个不同写操作使用不同 `request_id`；**同一操作断线重试必须重用原编号及完全相同参数**。若状态为 `pending/uncertain`，先查询 `get_operation_result` 并核对资料，不能自动换号重做。用户现有数据库不需要也不允许因为新接口被自动迁移。

## Agent 工作规范管理

在 IPSys 的「设置 → Agent 工作规范」中可按 index、search、upload、metadata 浏览。index 是不可编辑的轻量目录；其余三篇允许编辑内容、预览当前有效文本、单篇恢复内置默认、导出或导入用户覆盖配置。默认规范与 upload/metadata 共用的文件读取和权限安全规则仍随 EXE 内嵌且不能被覆盖。

专项覆盖保存在当前 Windows 用户的 LocalApplicationData/IPSys/agent-guidance.json，**不是任何业务资料库文件**。浏览器必须解锁资料库并携带现有会话 token 才能使用管理 API；MCP 在资料库解锁后默认启用、可手动关闭；访问仍必须通过当前 Windows 用户的受限管道及宿主授权。POST/PUT 写配置不产生 FileId、LinkId 或 FileVersion，也不修改 SQLCipher 业务数据。配置按同用户范围生效，切换公司/个人工作区或资料库时不变；不同 Windows 用户彼此独立。配置属于用户本机文本文件，建议不要存密码、密钥、令牌或隐私全文。

接口为 GET /api/agent-guidance（目录）、GET /api/agent-guidance/{topic}（含当前有效正文、原始编辑正文和版本）、PUT /api/agent-guidance/{topic}（content 和 expectedRevision）、POST /api/agent-guidance/{topic}/restore（expectedRevision）、GET /api/agent-guidance/export（默认完整有效规范）、GET /api/agent-guidance/export?mode=overrides（仅用户覆盖）、POST /api/agent-guidance/import（config 和 expectedRevision）。仅可覆盖 search/upload/metadata。保存、恢复、导入都检查配置版本，另一个标签页先更新会得到 409，应刷新后检查再操作。单篇规范不超过 48 KiB，配置文件不超过 256 KiB。

默认完整导出格式为 schemaVersion=1、exportMode="effective"、index（只读目录）及 topics 映射：每篇包含 source、content（可恢复的可编辑正文）、effectiveContent（实际运行正文，含不可修改的安全附录）和 version。即使 Windows 用户从未保存覆盖，也有三篇正文。导入全量格式时，只恢复 topics 中允许编辑的 content，不把 effectiveContent 的内置共用规则重复写入；相同 EXE 内置内容保留 source=builtin，换版本后内置正文不同则使用用户覆盖保留备份的内容快照。旧格式仍为 schemaVersion=1 和 overrides（仅用户自定义正文），由 ?mode=overrides 导出，导入时整体替换用户覆盖。index 与内置共享安全附录无法导入覆盖。正在运行的 MCP tools/call、prompts/get 每次读取当前有效内容并返回内容派生版本；initialize.instructions 保持短内置总入口，已有 Agent 若持有旧正文，需要重新调用或重连。

## Agent Prompts 与缺项筛选

**标准 MCP Prompts：** 在协议 `2025-06-18` 的 initialize.capabilities 声明 `prompts: { listChanged: false }`；`prompts/list` 列出内置 `index/search/upload/metadata` 四个名称和简短摘要，不含全文。客户端 `prompts/get(name="search")` 等按需获得一条 role=user / type=text 的规范消息；正文与 `get_agent_guidance` 共用内置资源。目录 metadata 可在未授权时列出，但 prompts/get 的正文必须通过同用户命名管道、已解锁数据库和手动启用的 MCP 授权。Prompts 是可选择的模板，不能保证每款 Agent 自动加载。

**通用文件缺项筛选：** `list_files_page(workspace="company", missing_fields="all", missing_mode="any", offset=0, limit=100)` 在 SQLCipher 分页前找出四个可选文件属性至少缺少一个的原件，按 FileId 去重；还支持 `missing_fields=["description","file_date"]`（或字符串 `"description,file_date"`）与 `missing_mode="all"` 组合。字段白名单为 `description/tags/file_number/file_date`。有筛选时每条 `items[]` 附加 `missingFields` 数组（JSON 驼峰风格），用来指示具体缺项。无筛选时保持 LinkId 关联分页，兼容旧响应。只查缺项本身不下载、修改或创建版本。HTTP 内部同源查询使用 `missingFields`、`missingMode` 参数；无持久化空白索引。

**真实 Agent 任务的界限：** 智能扩词、PDF/Word/Excel 内容提取及补录由 Agent 在真实本地路径和用户授权下执行。工具可供 Agent 调用，不代表服务器已自动为每次上传提取属性。无法阅读或缺少可靠证据时必须允许属性继续为空；出现 uncertain 先查询操作结果，不能盲目重传。正式 Windows CI 和实机验证结果必须独立记录。


调用 `get_agent_guidance()` 或 `get_agent_guidance(topic="index")` 只返回 search/upload/metadata 专项的标识、标题、摘要和版本；调用对应 topic 才返回正文。读取规范不会触发任何文件上传、下载、修改或删除。

`initialize.instructions` 只包含来自内嵌 `index.md` 的简短入口，规范正文统一由 `src/IPSys.Web/AgentGuidance/` 和 `AgentGuidance.cs` 管理，其中 upload/metadata 共享 `file-reading.md` 安全规则。读取正文需要当前同用户受限命名管道、解锁资料库及 MCP 授权；换 Agent 或更新 EXE 后应刷新客户端工具与 Prompts。**真实智能入库和内容提取必须由本地 Agent 在用户授权下执行，并独立核验。**

## Agent 检索与分页

IPSys 只提供工作区内结构化关键词检索及原件版本下载，不解析 PDF/Word 正文、不做 OCR 或模型推理。Agent 自主选择同义词进行多轮检索，再使用 `get_file_details`、`list_file_links` 和 `download_file_version` 获取原件并分析。

现行 `search_records(workspace,query,kind?,offset?,limit?)` 支持可选结果类别 `project/ip/archive_folder/file`，指定 offset 或 limit 任意一个即可进入无分组截断的分页模式。默认 offset=0、limit=100，最大单页 200；响应有 `total/offset/limit/hasMore/nextOffset`。Agent 应继续分页直到 hasMore=false。实际逐条核查时建议 limit=10–20，避免客户端只显示大页预览；预览不等于完整阅读。完全不传分页参数保留旧页面所依赖的每类别最多 60 条结果与 truncated 提示。文件搜索项 description 现为真实原件说明（无说明时为空），ownerLabel 另存“目录/项目 · 原件名”展示摘要，matchedFields=description 根据真实原件说明计算。检索结果 total 按命中的业务项/文件关联计数，不保证等于唯一 FileId 数量。

命中项包含 `matchedFields`（命中依据）、`path`（业务目录路径）、`folderId`；文件命中另包含 `fileId/linkId/ownerId/ownerKind/latestVersion/size/tags/fileNumber/fileDate`。历史 `id` 对文件仍表示 FileId，并非 LinkId；相同 FileId 出现在多个位置时应保留各位置但避免重复下载。分页期间发生文件变更时应重新校验。

项目、普通目录、知识产权及文件属性中的 `tags` 均支持中英文分号（`；`、`;`）分隔，服务端规范化为英文分号、去前后空格、空项与重复项。标签、说明、编号均参与统一检索；MCP 的 `create_*`、`update_*`、`update_file_metadata` 自动执行同一规则，所有属性选填，文件内容及版本不受元数据编辑影响。


## 知识产权编号与类型

知识产权的编号与类型以当前运行 EXE 的 `create_ip`、`update_ip` 参数契约为准：`workspace`、`name`、`ip_type` 为主要标识，编号使用可选 `number`、`publication_no`、`grant_notice_no`。其它日期、人员、权利人、状态与标签字段按 `tools/list` 声明填写。名称及类型必填，旧 `application_no` / `registration_no` 参数不再使用。

固定类型：发明专利、实用新型专利、外观设计专利、软件著作权、其他著作权、商标、集成电路布图设计、国家标准、行业标准、企业标准。发明/实用新型/外观设计专利的 `number` 填申请号，确有公开号或授权公告号时使用后两个编号字段；软件/其他著作权的 `number` 填登记号；商标填申请号或注册号；三种标准填标准号。非专利只需填 `number`，不要伪造或补齐另两个编号。

示例：`create_ip(workspace="company",name="示例国家标准",ip_type="国家标准",number="GB/T XXXXX—2026",status="已发布")`；`create_ip(workspace="company",name="示例专利",ip_type="发明专利",number="202610000001.1",publication_no="CNXXXXXXXXXA",grant_notice_no="CNXXXXXXXXXB")`。以上仅为格式示例。


## 使用步骤

1. 从 Actions 的最新成功构建，或 `publish-release` 产出的单 EXE，放到固定文件夹。
2. 正常启动 IPSys.Web.exe，解锁资料库，在「设置 → 数据库」核对 MCP 是否开启（新开资料库默认开启）。每次打开资料库 MCP 默认开启，可在设置中手动关闭当前会话。
3. 在本机注册（EXE 路径换成实际绝对路径）：

   `codex mcp add ipsys -- "C:\IPSys\IPSys.Web.exe" --mcp`

   也可写入 `~/.codex/config.toml`：

   ```toml
   [mcp_servers.ipsys]
   command = 'C:\IPSys\IPSys.Web.exe'
   args = ["--mcp"]
   ```

4. 更换 EXE 后必须刷新客户端 `tools/list`。工具清单以刷新结果为准，本文不逐一罗列。

## 工具与参数口径

工具的精确名称、参数、必填字段与返回结构由当前运行程序的 `tools/list` 和每次调用结果决定。下列是跨版本仍需注意的业务语义：

- 业务工具必须显式传 `workspace`（`company` / `personal`）。
- 支持幂等编号的业务写工具带 `request_id`（8–128 字符）；同一操作重试必须复用原编号及参数。库级回收工具不使用此编号，按 `taskId` 查询执行进度。
- `upload_files` 的 `owner_id` 是 FolderId，`paths` 为 1–20 条本机绝对路径；`kind=archive_folder` 时必须同时给出正确的 `section`。
- 同一 `FileId` 可有多个 `LinkId`。`delete_file` 必须同时给出 `owner_id`、`file_id`、`link_id` 三重身份，只解除其中一处关联。
- 单个文件上限 8 GiB，分块 1 MiB。
- 资料库级工具（`get_vault_storage`、`reclaim_vault_space`、`get_vault_reclaim_status`、`cancel_vault_reclaim`）**不接受 `workspace`**，作用于整个资料库。回收采用「启动 + 轮询」形态，不阻塞调用。

## 现行 MCP 安全操作示例

调用前必须已解锁 IPSys 宿主、开启 MCP（默认开启，可手动关闭）并刷新工具列表。对支持 `request_id` 的业务写入，使用唯一的 8–128 字符操作编号；同一请求重试须保留编号及全部参数。出现 `pending` / `uncertain` 时先通过 `get_operation_result` 核对状态和实际业务结果；`done` 仍须确认对应操作的成功字段，不得把成功提交请求直接等同于成功落库。

文件归档：`list_files_page` 按 `kind`、`owner_id`、`name` 筛选；上传后检查 `upload_files` 返回的 `status`、`succeeded`、`failed` 和逐文件信息。需要取消某处关联时，从同一条结果取得 FolderId（`owner_id`）、FileId（`file_id`）和 LinkId（`link_id`），再调用 `delete_file`，不可把 LinkId 当 FileId。

历史版本下载：先 `get_file_details` 核对 FileId 和版本，再用 `download_file_version` 指定 `version` 与 `output_path`。该路径指向 **IPSys 宿主所在的 Windows 电脑**，目录须存在且可写，目标文件必须不存在。新文件要带上全部历史版本时用 `copy_file`；跨工作区只能 `independent-content`。

回收站恢复：`list_trash` 后从目标条目原样取 `kind`、`id`、`section`，交给 `restore_trash`。跨工作区转移用 `transfer_*` 加 `target_workspace`。

空间回收：先 `get_vault_storage` 看 `reclaimableBytes` 是否值得做，再 `reclaim_vault_space`，用 `get_vault_reclaim_status` 轮询到终态。回收是原地分批进行的，不需要预留两倍库大小的空间；取消后已回收的部分保留，不回滚。

## Codex 提示词示例

“在个人资料创建科研项目‘矿山机器人控制’，项目编号 M2026-01，把 C:\Users\Me\Desktop\申请书.docx 和 预算.xlsx 归档到该项目。”

“先查明项目 ID，再将这个测试项目移到回收站，不永久删除。”

“在公司资料中新建一项发明专利《矿山机器人自适应控制方法》，状态设为实质审查中，申请号 CN202610000001.0；把本机 D:\专利材料\申请文件.pdf 归档为申请材料。随后更新专利备注，但保留原申请号。”

“先看资料库还能回收多少空间，如果超过 1 GB 就启动回收，然后轮询到结束告诉我释放了多少。”

## 安全边界

Codex 通过 stdio 使用同一个 EXE 的 `--mcp` 模式，子进程只经当前 Windows 用户的本机命名管道向已运行的 IPSys 宿主提交操作；没有新开 TCP 端口，也不会向 Agent 暴露数据库密码或网页 Token。打开资料库后 MCP 默认开启，可手动关闭；关库、退出或改密即失效。Agent 的操作属于用户明确委托，正式库建议提前手动备份，删除前核对 ID。同一用户交互会话中第二个 GUI 宿主会被程序拒绝启动。
