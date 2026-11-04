# IPSys 重构后一致性审查与统一清理实施任务书

审查日期：2026-11-04（UTC+8）。源码基线：`dab08a74f18f87a63a484d9dee63680b56b953fe`；最近产品提交：`de7222e313cb0c9b95285f25fd758d435f09040f`。本轮为审查和清理建议，没有修改产品代码。下列建议尚未视为用户确认的实施决定。

**执行版补充日期：2026-11-04。** 用户本轮明确要求将方案写到其他 Agent 可以据此修改，并推送仓库。本次交付仍为任务书，不代表已经实施代码清理。第 1—6 节保留审查证据；第 7—18 节给出执行契约、顺序、逐文件清单和验收方法。后续收到“按本任务书执行”的指令后，执行 Agent 应从第 7 节开始，依次完成各批次。原第 5 节为粗分组，实际施工顺序以第 9 节为准。

## 1. 结论

仓库已形成单一正式前端和统一文件资源模型；本轮未发现 Git 冲突标记，也未在扫描到的 92 条字面量 HTTP 路由中发现完全相同的方法与路径重复注册。这不等于已排除所有运行期冲突。

主要问题是最近重构没有在所有入口同时收敛：界面采用项目下普通文件夹，MCP、HTTP、数据库和部分测试仍保留合同业务对象；文件夹移动、独立复制及排序也存在新旧规则并存。应先修正这些业务冲突，再删除失去生产调用的实现，最后统一文档。

## 2. 项目定位和文件分工

IPSys 是在 Windows 本机运行的单用户资料管理系统。WinForms EXE 管理进程、资料库和托盘；ASP.NET Core 只在本机提供 API 与内嵌 Explorer 界面；SQLCipher 保存元数据、文件原件与版本；MCP 让本机 Agent 操作相同业务。个人与公司工作区隔离。

当前目标模型为：项目和知识产权保留专用属性；其他资料及项目内部目录采用 `archive_folder + section`；文件夹没有版本，文件具有版本；同工作区可以共享 FileId，跨工作区复制保持物理内容隔离。

基线共 768 个 Git 跟踪文件、817 条 main 可达提交。11 月 1 日以来有 132 条提交，其中 68 条触及 `src/IPSys.Web`。统计是文件目录清点和提交摘要检查，不代表逐行审阅全部历史证据。

| 位置 | 文件数 | 职责及清理判断 |
| --- | ---: | --- |
| `src/` | 160 | 唯一主程序、前端、内嵌资源和自动测试；102 个 C# 文件中 39 个名称含 Smoke，不能按类名相似认定重复 |
| `tests/` | 547 | 实机证据、测试数据、脚本、报告；部分旧日期目录仍被当前 CI 调用 |
| `docs/` | 41 | Wiki、实施计划、归档；需要区分现行规范与历史依据 |
| `memory/` | 6 | 会话档案；保留历史，不以陈旧表述直接覆盖当前决策 |
| 根目录 | 11 | README、设计、需求、手册、数据字典、Memory 及 gitignore |
| `.github/` | 3 | Windows 构建验收、手动 Release、Wiki 发布 |

`wwwroot/js` 是正式界面源码，`wwwroot/tools/bundle.cjs` 将其打包为 `dist`。`ip-v2.js`、`export.js`、`upload-progress.js`、`pdf-preview.js` 是被嵌入和调用的能力模块，并非第二套废弃 UI。`tests/retest-v2-2026-10-22/scripts/` 仍由 Windows workflow 调用，不能整目录删除。

## 3. 重构脉络

| 阶段或提交 | 已完成的方向 | 对本轮清理的意义 |
| --- | --- | --- |
| 10 月 13 日起 | WinForms、本机网页、内嵌前端、SQLCipher 业务操作 | 现行应用骨架已经统一 |
| 10 月中下旬 | 文件/版本/关联、MCP、Explorer 和自动验收 | FileId、LinkId、FileObject 是不同职责，不是重复对象 |
| `baefcfd`、`4578045` | 普通资料与文件夹合一，允许嵌套和直挂附件 | “资料记录 + 目录”旧分类开始退出 |
| `be8853c` | 统一 archive_folder/section，删除 archive/general 旧契约 | 已实际移除部分旧端点，不应再次当作未清理 |
| `86af5a8`、`0f741a9` | 文件夹共享、批量移动、跨模块移动和统一交互 | 新 transfer-batch 与旧独立复制/转移接口并存 |
| `7af79a5` | 项目内部改为任意层普通文件夹 | 只完成了部分调用链的替换，合同契约没有同步退出 |
| `3d79abf`、`4fe6422`、`de7222e` | 修复旧测试断言、项目复制文案、项目文件夹选择器入口 | 最近修复有效，但不能据此认定全链路已经收敛 |

## 4. 确认的问题与清理建议

### C01 高优先级：合同仍可创建，但界面不展示

证据：`McpLocal.cs:131,185,197,211,221` 与 `McpLocalExtras.cs:28,40` 仍注册查询、创建、删除、更新、复制合同及合同文件操作。`McpLocalV2.cs:66-73` 将 create_contract 直接发送到实际写入端点。`NativeFolderStore.cs`、`FolderModel.cs:6`、`ResourceSchemaV2.cs:22-66` 仍接受 contract。`Program.cs:114,122` 继续注册合同界面与转移端点。

而 `store.js:345` 的 buildTree 已不构造合同节点；`store.js:323` 明确过滤合同回收站项。`nodeOfHit` 仍映射到不存在的 `c:<id>`，所以合同搜索命中也不能正常解析为界面节点。

影响：Agent 可通过公开工具创建有效 contract 记录及附件，但用户在当前 Explorer 中看不到相应目录；删除后的合同也被界面回收站过滤。这是已确认的静态调用链冲突，本轮没有操作用户真实数据库或实机复现。

建议：按“合同资料是普通文件夹”的目标，统一收敛 MCP 注册/调度、HTTP、DTO、数据库类型、搜索、回收站、导出、转移和测试。不能仅删除合同前端表单，也不能只隐藏 MCP 工具但保留直调写入入口。既有测试库按用户已明确的无需迁移原则处理，旧库应明确拒绝，不能静默隐藏旧记录。

### C02 高优先级：跨模块顶层移动被错误判为原位置

证据：`NativeFolderBatchTransferEndpoints.cs:94-97` 的重复位置判断为 `all[id].Folder.Parent?.Id == parent`，没有同时比较 section。

触发示例：公司“企业资质”顶层文件夹移动到“综合资料”顶层。来源 Parent 为 null，目标模块根也转换为 null，表达式成立，返回 409“已经位于目标目录”。两个模块的根目录不应视为同一位置。

建议：位置身份同时包含工作区、section 和父目录 ID；增加顶层→另一模块顶层、嵌套→顶层、同模块原位置拒绝、批量回滚测试。现有跨模块测试主要使用真实目标文件夹，未覆盖这一组合。本项依据生产条件推导，未在本轮 Windows HTTP 环境执行。

### C03 高优先级：项目子目录独立复制/跨区转移菜单没有目标

证据：`interactions.js:1770-1774` 对 archive_folder 显示“复制文件夹（独立副本）”和“跨工作区或类别转移”。`bridge.js:425-450` 的 recordTransferOptions 分类表没有 project；`transferBusinessRecord` 因目标为空直接提示不支持。

本轮用 Node VM 执行当前生产 recordTransferOptions 函数：company + archive_folder + section=project 的复制目标实际返回 `[]`；general 和 achievement 则返回有效目标。这是生产函数级复现，尚不是 Windows 真实鼠标验证。

建议：为项目内文件夹完善独立复制/转移的目标策略和真实项目父级选择。该操作与“共享文件夹”具有不同 FileId 语义，不能直接删掉独立复制或用共享替代。旧两级长下拉可复用当前目录选择器的浏览交互，但保留各自业务策略。

### C04 中高优先级：GUI 与 MCP 的跨模块移动能力不一致

证据：GUI `transferFolderBatch` 使用 `/transfer-batch`，允许同工作区合法 section 间移动且保留 FolderId/LinkId。MCP 的 `move_folder` 仅传 section 和 parent_id，仍只能同模块移动；`transfer_folder` 调用旧 `/transfer`。后者在 `NativeArchiveActionsEndpoints.cs:46-49` 要求来源/目标的 `ArchiveRules.Module` 相等，project_directory、general、research_output 等彼此不等。

因此界面支持的“项目子目录移到综合资料”，通过现有 MCP 两条文件夹移动路径无法获得相同能力。旧 transfer 采用复制后软删除语义，与 GUI 原位移动的身份保持也不同；这两种动作不能仅因名称都含 move 而盲目合并。

建议：明确同工作区原位移动、共享、独立复制和跨工作区转移的公共契约；让 GUI/MCP 复用对应服务语义，统一 target_section/target_folder_id。跨工作区物理隔离继续保留。

### C05 中优先级：排序仍保留旧模块分裂

证据：`McpLocalExtras.cs:100-120,348-385` 的 list_folder_entries/reorder_entries 硬编码 company/achievement；reorder_folders 没有 parent_id，通过旧模块整表排序端点。`NativeArchiveUiOrderEndpoints.cs:28` 用 `NativeArchiveStore.List(..., section)` 默认 parent=null，仅取得模块顶层；general 又因 ArchiveRules.Module 返回 null 被拒绝。

底层 `NativeArchiveOrder` 已支持工作区、section、具体父级/项目的同层排序，前端也使用这一能力。当前 MCP 无法完整表达所有普通文件夹的嵌套排序。此外 ReorderItems 已只接受 kind=folder，工具 schema 描述及错误文字仍写 folder/record。

建议：统一为 workspace + section + parent_id + 同层完整 ID 列表的排序契约，覆盖公司/个人、项目内目录及 general。取消旧模块特殊分流之后再移除旧排序端点，不能先删仍被 MCP 使用的接口。

### C06 中高优先级：旧库结构识别与新模型不一致

证据：`ResourceSchemaV2.Version` 仍为 2；Validate 主要检查版本号、表是否存在，以及 archive/general 旧行，未识别 project 普通目录所需的新 CHECK/parent trigger，也未拒绝合同旧行。`Vault.ValidateSchema` 继续调用多种 Ensure 方法；EnsurePartyArchiveSection 对含 general 的旧建表语句直接返回，EnsureArchiveFolderSectionRelocation 只更新身份触发器。

结果：部分旧 V2 库可通过打开检查，但新建项目普通文件夹时才因旧约束失败。该静态证据与项目最近已归档的旧库报错分析一致；本轮未读取用户库。

建议：既然仍属测试阶段且不要求迁移，应建立明确的新结构版本/能力检查，在打开时提示新建资料库。确认新库已包含全部必要列与触发器后，才能逐项移除旧迁移；不能直接删光 Ensure 而遗漏运行必需约束。

### C07 低风险清理候选：失去生产调用的旧移动界面

`interactions.js:1382` 的 moveArchiveEntry 仍生成遍历所有目录的旧长下拉。全仓引用检查仅发现函数本身及 `explorer-archive-operations-smoke.cjs` 中四处直接测试调用，没有发现生产调用方。现行菜单已转向 moveSelectedItems/transferFolderBatch。

建议删除该旧函数，并把其仍有价值的防循环、目标范围等测试迁到当前真实入口。RecordForms.contract 以及 bridge/export 中的合同分支要随 C01 一起处理；Unify 等只返回原引用的旧转换包装可作为后续小清理，优先级低于行为冲突。

### C08 文档及测试口径尚未同步

README 同时出现 MCP 64 和 51；本轮统计实际 Tool 字面量注册为 51 个，名称无重复。DESIGN 仍将综合资料 Excel 写成 3 列，现行开发计划和普通资料实现已采用六列。README、USER_GUIDE、DEVELOPMENT_PLAN 仍保留独立合同对象描述，Wiki 的项目内部说明已改为普通文件夹。多个现行文档基线停在 CI #473。

测试的关键冲突：`NativeMcpSmoke.cs:389` 实际创建合同并断言成功；`tests/ui-tree-smoke.cjs:65` 则断言旧合同不在项目子节点中。两项分别通过，仍无法保证 GUI/MCP 一致。应增加“通过 MCP 创建项目内文件夹 → UI 同 FolderId 可见 → 移动/搜索/回收站可用”的跨入口契约验证。

建议将现行文档统一到一个模型和工具清单；旧设计留在明确标注的历史材料中。MEMORY.md 当前约 183 KB，已不再精简，后续可整理当前状态索引并保留详细会话档案，避免重新恢复已被覆盖的旧结论。

## 5. 建议的实施批次

1. 行为与模型收敛：处理 C01、C02、C03，并建立 GUI/MCP 可见性与根目录移动回归。C01 同时处理新库契约和旧库明确拒绝的边界。
2. 共享操作契约：处理 C04、C05，让文件夹位置、目标策略、排序范围在界面和 MCP 一致，保留共享与独立复制的区别。
3. 遗留实现与资料整理：完成 C06 的迁移裁剪、C07 的死代码/旧测试清理、C08 的现行文档同步。现行 CI 引用的历史路径先迁引用再整理；原始实机证据保持可追溯。

不建议按名称包含 V2、Archive、General、Contract 或日期较旧就批量删除。尤其 NativeProjectContractUiEndpoints 还含项目正常接口，不能整文件直接删；旧 transfer 接口也仍服务 MCP 和独立复制。

## 6. 验证范围

本轮已完成：目录清点、main 提交摘要及关键重构 diff、生产调用链和引用搜索、冲突标记检查、字面量路由重复检查、51 个 MCP 注册名检查、全部 29 项 `*smoke.cjs` 测试（全通过），以及生产 recordTransferOptions 函数的 Node VM 复现。

远端已核验：Windows CI #520，run `41786161181`，head_sha=`de7222e313cb0c9b95285f25fd758d435f09040f`，completed/success。

本轮没有 .NET/Windows 本地运行环境，没有重新执行 C#、SQLCipher/HTTP 或真实 Edge 测试，没有操作用户数据库，没有发布 EXE。静态问题不冒充实机复现。此次现有测试全通过并不能否定上文发现的覆盖缺口。

GitHub rulesets 返回空列表；分支保护读取返回 integration 403，不能据此宣称不存在保护。提交仅包含本审查记录与项目记忆，按普通非强制流程核验。

## 7. 执行入口、授权边界和禁止误解

### 7.1 本任务书要完成什么

最终交付一个业务规则一致的 IPSys：同一个普通文件夹，无论从界面还是 MCP 创建、移动、查询，都采用相同的身份和父级规则；系统不再产生界面看不到的合同对象；普通文件夹复制、排序和数据库兼容检查覆盖近期新增的项目目录。

本任务书所列新增参数、接口收敛方式及数据库版本方案，是为落实审查结果给出的具体实施设计，不应在代码尚未修改时写成“现有功能”。本轮用户授权撰写和推送文档；产品代码由后续执行任务完成。

### 7.2 接手后的第一组动作

1. 读取 AIGT 的 `AGENTS.md`、`AI_RULES/GIT_OPERATIONS.md`、`AI_RULES/MEMORY_PROTOCOL.md`，再读本仓 `MEMORY.md` 顶部及最近会话。
2. 确认工作目录为 `zy19970/IPSys`，记录当前分支、HEAD、工作区修改和远端 main。保护已有未提交文件；不要 reset/clean/强推。
3. 对比当前 HEAD 与本文审查基线。如果代码已前进，用函数名和路由重新定位；行号仅用于基线导航。某项若已被其他提交修复，记录修复 SHA 和证据，不要再次覆盖。
4. 建立第 18 节进度表。每次开始一批，先将该批改为“进行中”；结束时填写提交、测试和剩余问题。不能只靠聊天记住做到哪里。
5. 先执行现有 Node 回归；在 Windows 上执行现有 Debug/Smoke。区分已有失败与本批引入失败。没有 Windows 时可以实施和做可运行的检查，但提交后的 Windows CI 必须核验，不能声称本地执行了 SQLCipher/Edge。
6. 按第 9 节顺序施工。每一批产品、调用方和相应测试一起完成，不能提交“先删后端，等下一批再修前端”的断裂状态。

### 7.3 本次清理的范围

1. 公司和个人工作区、项目与知识产权、Folder/File/Link/Version/Object 分工保留。
2. “合同”仍可以是用户自定义文件夹名称、文件名称或正文内容；退出的是 `kind=contract`、合同专用 DTO/接口/MCP 工具。禁止全仓替换中文“合同”或英语一般含义的 contract。
3. 用户已明确测试数据库无需迁移。新程序应拒绝不兼容旧库并提示新建，不自动删除、覆盖或转换用户数据库。
4. 不顺手更换 UI 框架、数据库引擎、项目运行方式、依赖版本或发布流程。不把本次清理扩大为全仓改名。
5. 不发布 Release、不执行大文件实库压缩、不操作用户资料，除非另有明确指令。回归用临时测试库。
6. 不删除测试证据、历史会话和原始报告。旧断言需要更新，但有效测试场景必须迁移到新的入口。
7. 本任务没有新增公开 MCP“共享文件夹”工具的要求；已有 GUI 共享行为应保持。此处 GUI/MCP 一致性指两者已经提供的同名或同义创建、查询、移动、复制、转移、排序操作，不借此新增整套 Agent 功能。

## 8. 最终目标模型与操作契约

### 8.1 术语和身份

| 名称 | 本文中的精确定义 | 修改时必须保持的规则 |
| --- | --- | --- |
| 工作区 workspace | company 或 personal | 普通移动/共享不能改变工作区 |
| 模块 section | 普通目录所属分类 | 必须来自当前工作区允许列表 |
| FolderId | `folders.id`，可以标识项目、知识产权、普通目录 | 单个数据库内真实身份；不是前端字符串 ID |
| 前端节点 ID | `p:123`、`i:123`、`af:123` 等 | 调 API 前使用 biz.id，不能把前缀字符串直接当数据库 ID |
| 模块根 | 虚拟 `k:general` 等，不是 folders 行 | API 的 0/省略仅作为根标记，落库为 null |
| 项目根 | kind=project 的真实 FolderId | 项目目录的父级必须是它或项目内普通目录 |
| FileId | 一个逻辑文件的身份 | 同 FileId 共享完整版本链 |
| LinkId | 一个文件在一个目录中的关联 | 同 FileId 可以有多个 LinkId |
| FileVersion | 某 FileId 的历史版本 | 移动/共享不丢失历史；复制须复制全部有效版本 |
| FileObject | 版本引用的物理内容对象 | 同工作区可按原规则复用；跨工作区必须独立 |

合法普通目录 section：公司为 `certificate/achievement/party/general/project`；个人为 `certificate/achievement/academic/general/project`。`ip` 不是普通目录 section；知识产权自身仍是专用业务对象。

### 8.2 父级规则

| 对象 | 父级 | section |
| --- | --- | --- |
| project | null | 空字符串 |
| ip | null | 空字符串 |
| archive_folder，非 project 模块 | 本模块根 null，或同工作区同 section 的普通目录 | 合法普通目录模块 |
| archive_folder，project 模块 | 同工作区真实 project，或同工作区 section=project 的普通目录 | project |
| contract/archive/general 旧 kind | 不允许创建或继续作为新库业务对象 | 不适用 |

项目模块的虚拟根 `k:project` 不是可存放普通文件夹的位置。`section=project,parent_id=0/null` 必须拒绝，不能偷偷新建项目或自动选第一个项目。

### 8.3 四种操作必须明确区分

| 操作 | 目标范围 | FolderId | FileId / LinkId | 来源结果 |
| --- | --- | --- | --- | --- |
| 同工作区移动 | 当前工作区所有合法普通目录模块；project 必须选真实父级 | 原目录及子目录 ID 保留 | 原文件、关联、版本保留 | 原目录改位置，根及后代 section 按目标更新，不入回收站 |
| 同工作区共享文件夹 | 与当前 GUI 允许范围一致 | 复制目录结构，生成新 FolderId | 共享原 FileId 和版本，生成目标 LinkId | 保留；之后新增目录不自动同步 |
| 独立复制文件夹 | 同工作区合法普通目录目标；跨工作区按 8.4 | 新 FolderId | 新 FileId、新 LinkId，复制版本；同区可复用原件对象 | 保留；目标追加版本不改变源 FileId 的版本链 |
| 跨工作区转移 | 按 8.4 | 目标新 ID | FileId/LinkId/FileObject 均按目标独立创建 | 目标完整成功后，来源根软删除；失败全部回滚 |

文件夹移动保持 LinkId，不等于单文件移动保持 LinkId：单文件现有“关联到目标再解除来源”的机制有自己的语义，不为统一名称而改写它。

### 8.4 本任务采用的目标允许矩阵

同工作区：普通文件夹的移动、共享及独立复制统一按 `ArchiveDirectoryScopes.Allowed` 判定，允许合法普通模块间操作，目标 project 另加真实父级约束。权限、同名、防循环和文件任务占用继续校验。

跨工作区：本次只保留已有模块映射并补齐 project 对 project，不擅自开放任意跨区分类转换。

| 来源 | 允许的另一工作区目标 |
| --- | --- |
| company/achievement | personal/achievement、personal/academic |
| personal/achievement 或 personal/academic | company/achievement |
| company/general | personal/general |
| personal/general | company/general |
| company/project 内普通目录 | personal/project 内指定真实项目或子目录 |
| personal/project 内普通目录 | company/project 内指定真实项目或子目录 |
| company/certificate、personal/certificate、company/party | 本任务不增加跨工作区目标 |

前端只能显示后端会接受的目标。后端必须再次校验，不能因为前端隐藏选项就省略验证。

### 8.5 统一失败和事务规则

1. 未授权、工作区不符、父级不存在/已删除、自身或后代目标、project 虚拟根、同名冲突、批量父子重叠，在写入前拒绝。
2. 移动发生同名冲突时整批失败，不静默重命名；共享和独立复制继续采用现有 UniqueName 规则，不自行更改命名后缀。
3. 批量仍使用现有限额：最多 100 个选中根、最多 10000 个目录。不能靠逐根提交实现批量。
4. HTTP 业务错误保持现有 400/404/409 风格；MCP 参数在发出 HTTP 前即可判定的错误应记录为确定失败，不能变为 uncertain。
5. 服务端返回成功后若刷新失败，应说明“操作已完成，刷新失败”，不能自动再次执行写操作。
6. 工作区切换、Session 失效、文件任务占用、取消和幂等 request_id 仍按现有安全机制执行。

## 9. 施工顺序和每批交付

| 批次 | 对应问题 | 具体交付 | 进入下一批的条件 |
| --- | --- | --- | --- |
| S0 | 全部 | 当前基线、调用清单、可运行测试结果 | 能明确区分现有行为和目标行为 |
| S1 | C02 | 修正根目录跨模块移动判断及专项回归 | 原位置拒绝和跨模块根移动均通过 |
| S2 | C01+C06 | 合同业务类型退出、新库结构版本、只读旧库拒绝、替代测试 | 新库第一次打开与重新打开都具备完整能力；旧合同工具不可调用 |
| S3 | C03+C04 | 目录目标策略、项目独立复制、GUI/MCP 移动/转移对齐 | 第 13 节用例和真实入口验证通过 |
| S4 | C05 | 普通目录同层排序统一 | 第 14 节完整性/隔离测试通过 |
| S5 | C07+C08 | 死代码清理、测试入口和现行文档同步 | 引用检查、完整 Windows CI 与最终交叉验收完成 |

S2 内不能先发布 schema 变更再等待合同调用方清理；二者在同一可构建批次完成。S3 依赖 S1、S2。S4 依赖 S2 的模型。S5 最后做，以免先删掉仍被调用的代码。

每批建议一个主要提交；若 CI 发现真实问题，后续修复提交如实记录。提交说明遵守 AIGT 六项格式。产品提交不加 skip ci；只有纯文档记录可按现有约定处理。失败后先定位，不通过删除有效断言来掩盖产品缺陷。

## 10. S0：开始前的定位清单

以下命令在仓库根执行。输出作为工作记录，不必全部写入产品文档。

```bash
git status --short
git branch --show-current
git log -8 --oneline
rg -n 'contract|Contract' src/IPSys.Web --glob '!pdf*.js'
rg -n 'moveArchiveEntry|recordTransferOptions|transferBusinessRecord|transferFolderBatch|moveSelectedItems' src/IPSys.Web
rg -n 'list_folder_entries|reorder_entries|reorder_folders|reorder_records' src/IPSys.Web
rg -n 'EnsurePartyArchiveSection|EnsureEditableArchiveSeeds|EnsureArchiveFolderSectionRelocation|EnsureFolderModifiedTimes|EnsureOrphanPurgeTrigger|ValidateSchema|CreateSchema' src/IPSys.Web
```

将 contract 命中分类为：生产业务标识、模型/SQL、前端逻辑、有效测试、普通英语/用户文件名、历史证据。只处理前四类中与旧对象有关的部分。不能使用全局字符串替换。

需要先理解的调用链：

| 功能 | 当前入口 → 后端 |
| --- | --- |
| 普通目录新建 | RecordForms.archiveFolder → NativeFolderEndpoints → NativeArchiveStore |
| GUI 移动/共享 | interactions → moveSelectedItems/transferFolderBatch → transfer-batch |
| GUI 独立复制/跨区转移 | transferBusinessRecord → recordTransferOptions → NativeArchiveActionsEndpoints → NativeFolderTreeTransfer |
| MCP 普通目录 | McpLocal.Tools/ExecuteAsync → ExecuteArchiveAsync → 相应 HTTP |
| GUI 建树 | VaultStore.reload → 项目/目录/IP/文件快照 → buildTree |
| 普通目录排序 | reorderArchiveEntry → entries/reorder → NativeArchiveOrder.Reorder |
| 数据库打开 | SessionEndpoints → Vault.ValidateSchema |
| 数据库新建 | SessionEndpoints → Vault.CreateSchema；不自动走打开分支 |

## 11. S1：修复跨模块根目录移动误判

### 11.1 修改文件与准确修改点

主文件：`src/IPSys.Web/NativeFolderBatchTransferEndpoints.cs`。定位 `if(input.Move)` 下“Moving to the existing parent”注释后的判断。

现逻辑只判断 Parent.Id。改为：**只有 source section 等于 target section，且父级 ID 也相同，才认定已经在目标位置。** 工作区由此端点单一 workspace 约束，不能另外接收跨区目标。

可采用以下局部形态，实施时核对变量和可空值类型：

```csharp
if (input.Move && targetSection == section &&
    ids.Any(id => all[id].Folder.Parent?.Id == parent))
    return fail("所选文件夹中有文件夹已经位于目标目录，请选择其它位置。", 409);
```

若放在既有 `if(input.Move)` 内，可省去重复条件。不要删除整个原位置保护；不要将 null 改为随意的真实 ID；同名检查、子树检查和事务逻辑保留。

### 11.2 必测用例

扩展 `NativeFolderTreeTransferSmoke.cs` 的现有批量/跨模块 HTTP 用例，通过真实 `/transfer-batch` 执行。每个测试使用独立名称/目标，避免上一个共享副本造成后续同名冲突。

| 编号 | 操作 | 必须断言 |
| --- | --- | --- |
| M01 | certificate 根文件夹 → general 根 | 成功；父级仍 null；section 改变；FolderId、FileId、LinkId、版本数保持 |
| M02 | general 根 → general 根 | 409；名称、位置、section、内容不变 |
| M03 | achievement 嵌套目录 → general 根 | 成功；所有有效后代 section 一致；下载旧版本字节相同 |
| M04 | 两个源根 → 另一模块根 | 一次成功，两棵树全部到位，无部分提交 |
| M05 | 目标根有同名文件夹 | 409；两边均未发生变化 |
| M06 | 第二棵树更新被测试触发器强制失败 | 两棵树均回滚，不能只检查响应码 |
| M07 | 目标为 project 的 0 根 | 400；不创建无项目归属目录 |
| M08 | 来源本身/来源后代作目标 | 拒绝；原层级不变 |

完成标志：测试能在旧判断上复现 M01 失败，修复后 M01 成功且 M02 仍失败；不能仅做表达式单测。

## 12. S2：退出合同对象，同时收敛新库结构

### 12.1 合同退出的逐文件修改清单

| 文件或范围 | 必须做什么 | 必须保留什么 |
| --- | --- | --- |
| `FolderModel.cs` | 去掉 Contract 常量、ResourceRef 分支和专属父级规则 | project、ip、archive_folder 及项目父级规则 |
| `BusinessRules.cs` | 去掉 ContractInput、合同校验、FolderMutationInput 中合同专属字段 | 项目/IP/普通目录字段与各自校验 |
| `NativeFolderStore.cs` | 删除 contract 专属解析、创建、父级解析、查询/删除分支 | project/ip 正常增删改及授权判断 |
| `NativeProjectContractUiEndpoints.cs` | 移除合同列表、合同复制和 contract 排序；project-files 不再遍历 contract | 项目列表、项目文件列表、项目排序。可将文件/类/DTO明确改名为 Project，不改变有效项目路由 |
| `NativeContractTransferEndpoints.cs` | 调用清零后删除文件和 Program.Map 注册 | 项目整树转移、IP 转移 |
| `NativeProjectTransferStore.cs` | 删除 Contracts 查询/复制；结果计数改为真实普通子目录含义并更新使用者 | 项目直属附件、递归项目目录、所有版本、跨区物理隔离 |
| `McpLocal.cs`、`McpLocalExtras.cs`、`McpLocalV2.cs` | 移除 7 个合同工具及调度/字段白名单；所有 kind 枚举移除 contract；reorder_records 仅支持 project | request_id、授权、确定失败/uncertain 机制及项目/IP工具 |
| `McpLocalIpFiles.cs` | 将 ProjectContractLinks 等仅保留项目用途，删除合同分支和参数 | 项目附件 FileId/LinkId 权属验证 |
| `SearchStore.cs`、`NativeMcpFileQuery.cs`、`RecycleStore.cs` | 清除旧合同查询、恢复、清理种类；按普通目录保留项目附件路径 | 共享引用保护、递归删除/恢复/清理、文件历史 |
| `Program.cs`、`WebSmoke.cs` | 更新端点/测试注册名称，移除合同专属注册 | 仍有效的项目接口及整个 Smoke 调用链 |
| `wwwroot/js/store.js` | 去掉合同必需加载请求、未使用 contracts 参数、c:命中解析及合同过滤掩盖；树只消费现行资源 | 加载失败不当空库、工作区 epoch 防串区、普通目录搜索/回收站 |
| `forms.js`、`bridge.js`、`folder-picker.js`、`app.js`、`interactions.js`、`export.js` | 清除合同专用表单/分支/白名单，替换为项目内普通目录的现行操作 | 合同资料可以作为普通目录/文件命名；导出项目递归包含目录和直属文件 |
| `AgentGuidance/*.md`、MCP 手册 | 例子使用 create_folder + section=project + parent_id | 本机文件读取/上传授权边界 |

需要移除的 7 个工具名称：`list_contracts`、`create_contract`、`update_contract`、`delete_contract`、`copy_contract`、`list_contract_files`、`delete_contract_file`。通过 tools/list 不可发现还不够，直接 tools/call 也必须按当前协议返回未知工具/不支持工具，不得落入旧调度。

通用 `/api/v2/folders/{workspace}/{kind}` 路由会继续存在，所以必须明确拒绝 kind=contract；独立合同路由移除后返回 404。不要只从枚举展示里删除值而仍允许请求创建。

清理前先用 rg 检查表中未列出的合同引用。表是主要改动范围，不是允许遗漏的穷举保证。尤其检查辅助上传参数、MCP 操作分类、长任务判断、项目转移结果 JSON 字段和测试固件。

### 12.2 数据库版本方案

本任务采用一个确定方案：**将新结构版本从 2 提升为 3，旧版本明确拒绝，不做迁移。** 若接手时版本已被其他提交提升，应先协调真实最新结构，不能重复占用版本号。

保留 `ResourceSchemaV2.cs` 类/文件名和 `/api/v2` 公共路径，避免无必要全仓改名。数据库结构版本与 HTTP API 名称是不同维度；不因为 schema=3 就把所有 URL 替换为 v3。

必须同步修改三处：`Version` 常量、`resource_schema_version` 的 CHECK、新建时 INSERT 值。只改其中一处会导致新库无法创建或创建后无法再打开。

新库 DDL 的 `kind` 只允许 project、ip、archive_folder，去掉 contract 专属 CHECK 和 parent trigger 条件；保留普通目录作用域、project 必须有父级、防循环、唯一同名、工作区/身份不可变和跨区隔离规则。

### 12.3 将必要能力放入新库创建路径

`SessionEndpoints.cs` 当前以 `if(input.Create) CreateSchema; else ValidateSchema` 分开处理。因此删除 ValidateSchema 中的 Ensure 调用前，必须保证 CreateSchema 本身已创建所有必要对象。

| 现有 Ensure 方法 | 新版处理方式 |
| --- | --- |
| EnsurePartyArchiveSection | 新建 DDL 一次包含全部合法 section；删除旧表重建迁移路径 |
| EnsureEditableArchiveSeeds | 新库七个种子目录直接是普通可编辑目录；删旧保护迁移；重新打开不得补回用户删除的目录 |
| EnsureArchiveFolderSectionRelocation | 新建时直接生成允许普通目录 section 变化的身份触发器；删打开时修补 |
| EnsureFolderModifiedTimes | 将必要列与全部时间戳触发器纳入创建事务；删除 ALTER TABLE 兼容逻辑 |
| EnsureOrphanPurgeTrigger | 新建 chunk_delete_ready 直接使用“仍有 file_versions 引用才阻止删除”的正确版本；删打开时替换旧触发器 |

时间戳触发器至少逐一核对现有的 `folder_created_insert`、`folder_modified_insert`、`folder_modified_business`、`folder_modified_link_insert`、`folder_modified_link_update`、`folder_modified_version_insert`。以源码实际定义为准，不能只复制本表名字而漏掉触发条件。跨模块根移动只有 section 改变、parent_id 仍 null 的情况，修改时间也应正确变化，不能只监听 parent_id。

新建 DDL 和校验清单尽量共用明确的定义/对象名称，避免新建一份、校验一份各自漂移。Validate 应检查版本、必要表、列、关键索引和触发器以及关键结构能力；不要仅查“表存在”。校验阶段不得通过写入业务表来偷偷修补结构。

### 12.4 旧库与异常库行为

版本为 2、缺版本表、旧 archive/general/contract 对象、缺关键结构的新版本库，都应给出明确错误。旧版本说明“此资料库结构不受当前版本支持，请保留原库并新建资料库”；同版本缺结构说明结构不完整。不要把错误密码、文件损坏和版本不兼容统一改成同一句。

拒绝后不删除文件、不写版本号、不替换触发器、不启动迁移。通过关闭连接、checkpoint 后的测试副本比较版本、sqlite_master 和业务快照，证明没有结构/业务写入；不要将连接过程临时 WAL/SHM 出现本身认定为迁移。

### 12.5 测试迁移与验收

主要测试入口：`ResourceSchemaV2Smoke.cs`、`FolderModelSmoke.cs`、`NativeFolderHttpSmoke.cs`、`NativeMcpSmoke.cs`、`NativeMcpArchiveSmoke.cs`、`NativeProjectContractUiHttpSmoke.cs`、`NativeContractTransferHttpSmoke.cs`、`NativeProjectMilestoneSmoke.cs`、`NativeFolderTreeTransferSmoke.cs`、`tests/ui-tree-smoke.cjs`、`tests/export-smoke.cjs`。

含合同名称的两个 Smoke 文件不能直接全删：将其中仍有价值的项目查询/排序、跨项目目录、文件历史、跨区隔离场景迁到项目/普通目录测试。仅合同专属行为的成功断言改为退休接口拒绝；不减少文件完整性断言。

本批还必须同步更新 `names.Length>=50` 等依赖旧工具数量的断言、固定 schema=2 的测试预期，以及当前 workflow 正在调用的 fixture 中旧合同创建逻辑。它们属于 S2 完整交付的一部分，不能拖到 S5 才处理。S5 只做后续残留复查和整理。

| 编号 | 用例 | 通过条件 |
| --- | --- | --- |
| K01 | tools/list 及直接调用 7 个旧工具 | 均不再是可用操作；拒绝时无任何资料写入 |
| K02 | HTTP 直调 kind=contract 创建，及旧合同专属 URL | 明确拒绝，合同对象数始终为 0 |
| K03 | MCP 建项目、建 project 普通目录及第二层目录 | UI 能按相同 FolderId 看见，搜索可定位，表单正常 |
| K04 | 项目直接上传文件，子目录文件有两个版本 | 列表、预览、项目 ZIP 和历史版本下载均正确 |
| K05 | 删除项目目录→回收站→恢复 | 整树重新可见，原 ID/Link/版本保持 |
| K06 | 共享文件在其他目录仍有效，永久清理其中一个目录 | 其他位置和版本保留；最后全部关联清理后才回收内容 |
| K07 | 新库创建后不重启，立即创建/编辑/上传/移动/永久清理 | 时间戳和文件保护正确，不能靠重新打开后 Ensure 补齐 |
| K08 | 新库关闭再打开，重复 K07 核心动作 | 行为一致；版本为 3；没有额外迁移 |
| K09 | 新库删一个初始目录，再关闭打开 | 不自动重建目录 |
| K10 | 至少两种旧 v2 schema 测试副本：无 project 约束、含旧 contract | 在打开阶段拒绝，结构/数据未被转换 |
| K11 | 版本=3 但缺必要触发器的临时测试库 | 明确拒绝，不伪装成完整新库 |
| K12 | project 目录无父级、跨工作区父级、IP 父级、自身/后代父级 | 全部拒绝且无部分写入 |

## 13. S3：目录复制、移动和 MCP 契约统一

### 13.1 先定义统一目标校验，再接界面

后端以第 8 节为准，在 `ArchiveDirectoryScopes` 或紧邻目录操作的共享 helper 中集中判断“工作区/section/目标种类/操作模式”是否合法。前端可以保留用于显示的镜像表，但测试必须验证它与服务端允许范围一致。不要让多个控制器各自保留一张不一样的 modules 表。

修改重点：`NativeFolderBatchTransferEndpoints.cs`、`NativeArchiveActionsEndpoints.cs`、`NativeFolderTreeTransfer.cs`、`NativeArchiveOrder.cs`、`McpLocalArchive.cs`、`wwwroot/js/bridge.js`、`folder-picker.js`、`interactions.js`。

### 13.2 服务层复用方式

1. 保留批量移动/共享的一次事务、限额、子树快照、冲突和取消机制。
2. 如果需要让两个 HTTP 入口执行同区原位移动，应提取可复用服务方法，不能在控制器持有 Gate 时再用 HttpClient 调自己；否则容易锁等待。Gate 和文件任务状态应由边界入口统一获取/释放，内部服务不重复获取同一锁。
3. `/transfer-batch` 继续服务 GUI 同区移动/共享；MCP move_folder 以单元素 items 调用相同语义。不要另写一份只改 parent_id 的实现。
4. `/transfer` 的 move=false 继续调用整树独立复制；同区 move=true 应使用原位移动；跨区 move=true 继续使用独立复制后来源软删除。不能让两个入口对同区“移动”返回不同身份结果。
5. 独立复制生成新 FileId，但树内原本共享同一个 FileId 的多处关联应仍共享同一个新 FileId，不要每个 Link 都复制一套历史。
6. 对同区复制到自身/后代也给出一致的拒绝，避免把一棵树复制到自己内部。单看目标 id != source id 不足够。
7. 本批不要顺手取消旧 limit、权限、事务和原件校验；旧端点若仍作为公开入口，应变成同一服务的薄适配，而非保留另一套行为。

### 13.3 明确 MCP 参数和行为

| 工具 | 参数方案 | 执行语义 |
| --- | --- | --- |
| move_folder | 保留 workspace、section、folder_id、parent_id；新增可选 target_section，省略等于 section | 同区原位移动；parent_id 是目标父级；非 project 的 0/null/省略统一为模块根，project 必须正整数 |
| transfer_folder | 保留 workspace、section、folder_id、target_workspace、target_section、target_folder_id、move | move=false 独立复制；move=true 且同区使用原位移动；move=true 且跨区独立复制后软删除来源 |
| create_folder/list_folders/update_folder/delete_folder | 现行名称保留 | 确保 project 参数描述正确；update 不允许借字段更新改变父级或 section |

返回结果保留现有必要字段，并明确 `id` 为目标 FolderId。原位移动返回原 ID；复制/跨区转移返回新 ID。不要为了复用内部代码把原有返回 JSON 不加说明地换成另一层嵌套；MCP 适配器可将单项批量结果映射回单项结果。

所有新增参数写入 Tool schema、required 列表/可选说明、dispatch、写操作分类和相应文档。未知 target_section、非整数 ID、跨区目标冒充同区，要在可判定阶段明确拒绝。保留 request_id 重试结果，不二次执行。

参数示例（仅说明目标契约）：假设测试中已从真实返回值取得公司项目 P1=101、其目录 D1=201。以下数字必须在测试中替换为本次创建返回值，不能直接对用户库使用。

```json
{"tool":"create_folder","arguments":{"workspace":"company","section":"project","name":"合同资料","parent_id":101,"request_id":"cleanup-create-folder-001"}}
```

将已创建的 D1 从项目移到公司综合资料根：

```json
{"tool":"move_folder","arguments":{"workspace":"company","section":"project","folder_id":201,"target_section":"general","parent_id":0,"request_id":"cleanup-move-folder-001"}}
```

上次成功后 D1 的当前 section 已是 general。后续请求必须使用新的 source section，不能继续以 project 引用它。独立复制 D1 到原项目时：

```json
{"tool":"transfer_folder","arguments":{"workspace":"company","section":"general","folder_id":201,"target_workspace":"company","target_section":"project","target_folder_id":101,"move":false,"request_id":"cleanup-copy-folder-001"}}
```

这些是工具名和参数示意，不是完整 JSON-RPC 信封；测试应使用现有 Run/Call helper。每个不同动作使用新 request_id，同一动作的网络重试复用原 request_id。create 返回的 FolderId 应由实际响应解析，不能假定等于示例中的 201。

### 13.4 前端接线，不能只补一张选项表

1. `recordTransferOptions` 按第 8.4 节产生合法目标；至少让 project 普通目录独立复制具有同区 project 目标及合法其他目录目标，跨区 project 有明确对侧项目入口。
2. `transferBusinessRecord` 的目录目标选择复用现有 AttachmentFolderPicker 的逐级浏览/搜索/面包屑。读取目标工作区快照时建立独立目标树，不覆盖当前 VaultStore.ws/ROOT，也不能通过切换当前工作区来加载目标。
3. 项目目标必须包含真实项目节点及项目内目录；不能只把 project 塞进 section 下拉而仍把 0 根作为最终目标。
4. 对同区源目录禁选自身/后代；跨区存在同数字 ID 的情况不能误当成同一对象，禁选依据包含 workspace。
5. `copy-record`、`transfer-record`、单项/批量移动、右侧详情和底部栏如调用同一动作，都应经过同一前端编排，不再留下一个入口走旧长下拉。
6. picker 的同步异常、目标加载失败和写入失败都显示可见提示。取消选择不能发写请求。
7. 选择器仍支持分页、大量目录、同名不同路径和深层目录；不回退为一次展开上千项下拉。

### 13.5 必测用例

优先扩展 `folder-picker-smoke.cjs`、`explorer-record-transfer-smoke.cjs`、`NativeFolderTreeTransferSmoke.cs`、`NativeMcpArchiveSmoke.cs`。新增函数测试之外，必须从真实菜单 handler/调用入口开始覆盖到提交 payload。

| 编号 | 操作 | 断言 |
| --- | --- | --- |
| X01 | 项目子目录“独立复制”到另一真实项目 | 菜单打开 picker；合法 parent；目标新 FolderId/FileId/LinkId；全部历史版本可读 |
| X02 | 项目子目录移动到 general 根，再移回另一项目 | GUI 和 MCP 都成功；所有原 ID 与版本保持；每步 UI/搜索可见 |
| X03 | 独立复制项目子目录到另一工作区真实项目 | 所有层级正确，FileObject 与源工作区独立，目标追加版本不影响源 |
| X04 | 同区共享与独立复制分别追加版本 | 共享两处看到同 FileId 新版本；独立复制源文件不增加版本 |
| X05 | transfer_folder 同区 move=true | 与 move_folder/GUI 同义，原 ID 不变，不产生来源回收站副本 |
| X06 | transfer_folder 跨区 move=true | 目标新 ID、源软删除；恢复来源按现有规则形成独立并存副本 |
| X07 | 同 request_id 重试成功写入 | 不重复创建目录、FileId 或版本 |
| X08 | 目标是自身/后代/已删除目录/project虚拟根 | GUI 禁选，绕过 GUI 直调 HTTP/MCP 也拒绝 |
| X09 | 选择过程中切工作区、关闭会话、文件任务占用、取消 | 没有把旧选择写到新工作区；错误可见；取消不提交 |
| X10 | 目录多于一页，深层目录和同名目录 | 可定位正确 FolderId；选择器不退化成长下拉 |
| X11 | 后端提交成功但前端刷新抛错 | 显示已完成/刷新失败，不重复请求 |
| X12 | 跨区不在 8.4 矩阵的目标 | 前端不展示，HTTP/MCP 拒绝，来源和目标不变 |

## 14. S4：统一普通文件夹同层排序

### 14.1 统一参数

采用现有 `list_folder_entries` 和 `reorder_entries` 作为普通目录统一入口，均要求 workspace、section、parent_id。parent_id=0 表示非 project 模块根；project 必须真实项目或其普通目录 ID。

`reorder_entries.items` 只接受 `{kind:"folder",id:FolderId}`，必须精确包含目标父级下全部有效普通子文件夹，不包含附件、不包含后代、不包含其他项目或模块的文件夹。数量、重复、缺项、多项均验证。

`reorder_folders` 的旧模块级行为退出注册/调度，调用方迁到 reorder_entries。`reorder_records` 保留项目台账排序，只允许 kind=project，继续保持它原有“所选项目占用原槽位”的语义；不要把项目台账部分排序和普通目录全量兄弟排序混为一谈。知识产权已有排序不在本任务中改语义。

### 14.2 逐步修改

1. `McpLocalExtras.cs`：删除 company/achievement 硬编码；schema 明确 section；统一 root 0 的处理；修正 folder/record 旧文案。
2. `NativeArchiveOrder.cs` 和 `NativeFolderEndpoints.cs`：保留 entries 与 entries/reorder 的完整兄弟集合校验，补齐 project 根不允许 0 的统一校验。
3. `NativeArchiveUiOrderEndpoints.cs`：确认 GUI/MCP/测试已不调用旧 `/api/v2/ui/folders/{workspace}/{section}/order` 后删除端点及 Program 注册；如仍有有效调用，先迁移，不留两套排序规则。
4. `NativeArchiveUiEndpoints.cs`：orders 的父级集合必须包含真实项目 ID，使项目直属普通目录也能获得正确排序快照；不能只收集普通目录自身 ID。非 project 模块仍可包含 0 根；project 的集合必须去掉初始化的 0，再加入真实项目与普通子目录 ID，避免新的“project 根不允许 0”校验导致整个目录快照加载失败。
5. `store.js`、`interactions.js`：提交上移/下移时使用当前持久同层顺序，不使用与界面不同的名称排序数组。检查项目直属层、深层目录、general 根，不只检查 achievement。
6. `NativeArchiveOrder` SQL 只更新当前同层目录 position。不能修改 File/Link/Version，不能改变名称、父级或 section。

### 14.3 用例

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| O01 | 两工作区所有合法普通模块的根/嵌套排序；project 使用真实项目父级 | MCP 返回顺序、UI 自定义顺序、刷新/重开后一致 |
| O02 | 文件夹与附件混在同层 | items 只有目录，附件和文件版本不变 |
| O03 | 少一个、多一个、重复、后代、跨模块、另一项目的 ID | 整次拒绝，原全部 position 不变 |
| O04 | items 使用 kind=record 或非法 parent | 明确拒绝；schema/提示统一为 folder |
| O05 | 已删除目录或排序前刚新增目录造成快照过时 | 全量集合校验失败，提示刷新后重试 |
| O06 | 项目直属目录名称顺序与 position 相反，再执行上移/下移 | 操作作用于用户看到的当前自定义顺序，不串项 |
| O07 | 排序事务中途失败 | 所有目录 position 回滚 |

## 15. S5：删除遗留实现并同步文档

### 15.1 可删除候选与前置条件

| 候选 | 删除前必须证明 |
| --- | --- |
| moveArchiveEntry | 生产入口无引用；原防循环/目标测试已经迁到真实新入口 |
| 合同专属端点、DTO、表单和助手方法 | S2 完成；项目共用代码已提取；编译和完整测试通过 |
| 旧模块级目录排序端点 | S4 调用迁移完成，生产/MCP/测试/文档均不再引用 |
| 旧 schema 升级函数 | 所有必要 DDL/触发器已进入新建事务，旧库明确拒绝，新建即用和重开均通过 |
| Unify 等旧适配包装 | 没有转换语义且能在调用处保持同等验证；属于可选低优先级清理，不以此阻塞主要缺陷修复 |

不能删除整个 NativeProjectContractUiEndpoints 文件而遗漏其中项目功能；不能删除 NativeFolderTreeTransfer，因为独立复制与跨区转移仍需要它；不能把 V2 命名当成废弃标记。

### 15.2 测试整理

移除旧函数的直接测试时，把场景迁到当前真实入口。测试不得继续肯定 contract 可创建，不得使用 `names.Length>=50` 等旧数量约束阻止正确工具退休；改成明确必须存在/必须不存在的工具集合、无重名、可调用性和业务行为断言。工具数量由实际注册计算。

`tests/retest-v2-2026-10-22/scripts/` 是当前 CI 输入。若其中存在创建合同的运行期 fixture，应改为普通项目目录；旁边的历史结果 JSON/日志仍保留原样。确要搬目录时，先迁 workflow/脚本引用并运行，再移动，不按日期整包删除。

新增 C# Smoke 必须接到 WebSmoke 或现有综合 Smoke；新增 Node 文件必须进入 workflow 的显式测试列表。仅在文件夹里新增一个没人运行的测试，不算完成回归。

### 15.3 文档同步清单

| 文档 | 必须更新的口径 |
| --- | --- |
| README.md | 项目内部普通目录、当前工具清单/数量、schema版本、最新已验证产品 SHA/CI |
| DESIGN.md | 三类 Folder kind、文件操作身份语义、创建/打开结构检查、六列普通资料 Excel |
| DEVELOPMENT_PLAN.md | 本任务各批次真实状态、待验证事项和剩余边界 |
| REQUIREMENTS.md、M0_DATA_DICTIONARY.md | 现行合同对象约定退出；历史约定标记已被新模型覆盖，不篡改历史含义 |
| MCP_CODEX.md | 移除退休工具；move/transfer/sort 参数、根语义、请求/返回示例、确定失败与幂等 |
| USER_GUIDE.md、UI_BASELINE.md | 项目目录、复制/共享区别、排序和旧库提示；不再引导新建合同业务记录 |
| docs/wiki 相关页面 | 与正式手册一致；Glossary 不再将合同列为独立 Folder 类型 |
| AgentGuidance 相关页面 | 当前公开工具及 project 目录 parent 参数；不诱导旧合同写入 |
| TESTING.md、测试证据索引 | 新的实测证据，明确旧 CI 为历史基线 |
| MEMORY.md | 顶部当前结论简明；旧会话保留，旧问题已修复时记录实际提交和证据 |

不要为了“关键字清零”重写历史日志和会话。生产模型中的 Contract 退出，与历史档案提到合同不是同一要求。公开工具总数必须从最终 Tools() 得出，不把目前 51 或预计删减数量硬写为最终结果。

## 16. 测试执行方法和证据要求

### 16.1 本地 Node 检查

在仓库根运行。以下脚本在遇到失败时立即失败，避免最后一项成功掩盖前面失败。

```powershell
Get-ChildItem src/IPSys.Web/tests/*smoke.cjs | Sort-Object Name | ForEach-Object {
    node $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Node smoke failed: $($_.Name)" }
}
node src/IPSys.Web/wwwroot/tools/bundle.cjs
if ($LASTEXITCODE -ne 0) { throw 'Frontend bundle failed' }
git diff --check
```

这不会运行 `zip64-real-generate.cjs`。新建测试文件要额外确认当前 CI 显式列表包含它。运行 smoke 造成的 dist 是生成物，不提交手改打包结果。

### 16.2 Windows 编译与综合 Smoke

```powershell
dotnet build src/IPSys.Web/IPSys.Web.csproj -c Debug
if ($LASTEXITCODE -ne 0) { throw 'Debug build failed' }
$env:IPSYS_SMOKE_REPORT = Join-Path $env:TEMP 'ipsys-cleanup-smoke.txt'
$testExe = Join-Path $PWD 'src/IPSys.Web/bin/Debug/net8.0-windows/IPSys.Web.exe'
$testProcess = Start-Process -FilePath $testExe -ArgumentList '--smoke' -PassThru -Wait
if ($testProcess.ExitCode -ne 0) { throw 'IPSys smoke failed' }
if (!(Test-Path $env:IPSYS_SMOKE_REPORT)) { throw 'Smoke report missing' }
Get-Content $env:IPSYS_SMOKE_REPORT
```

以当前 workflow 为准核对路径。检查报告包含 `WEB SMOKE PASS` 及新增用例证据，不以进程返回 0 单独判定成功。测试必须使用专用临时数据库。

### 16.3 提交后 Windows CI

每批业务提交完成后，核查 `.github/workflows/web-windows.yml` 对应 run 的 head_sha 与本批提交一致，状态 completed/success；阅读失败步骤原始日志，不能拿上一个 SHA 的绿色结果替代。

最终验收包含 Debug、Release、Node/UI、SQLCipher/HTTP、MCP stdio、真实 Edge/HTTP、两种单 EXE 启动及产物。大于 2GiB/4GiB 项目按现有可选配置记录 skipped，不为一次结构清理擅自启动高成本专项，也不能写成已测通过。

文档编写或仅同步 Memory 不需要重新跑整套产品 CI。本任务书本身未执行上述未来产品验收。

### 16.4 必须有一条跨入口闭环

建立临时公司/个人库测试数据，顺序执行：

1. 通过 MCP 创建项目 P1、P2，在 P1 下建 D1，再建 D2。
2. 在 D2 上传 F 的两个版本，记录 FolderId、FileId、LinkId、版本编号和 SHA-256。
3. 从真实 Explorer 项目入口打开 P1/D1/D2，确认所有对象可见，搜索 F 可跳回该节点。
4. 用 GUI 移动 D1 到 general 根，用 MCP 将其移回 P2；两个方向记录 ID 和字节不变。
5. GUI 独立复制 D1 到另一项目，验证新 FileId；共享 D1 到另一个合法位置，验证相同 FileId。不能只比较文件名。
6. MCP 调整同层普通目录顺序，GUI 刷新/重开后顺序一致。
7. 删除 D1、查看回收站、恢复，证明 GUI/MCP 可见性和版本不丢失。
8. 对单独测试分支执行永久清理，证明其他共享位置仍可下载；不得拿用户数据库做这一步。

至少记录每一步请求入口、关键 ID、预期/实际、通过/失败。禁止只分别证明“后端能创建”和“前端能画树”，而未使用同一批对象串起来。

## 17. 易错点、停止条件和最终交付格式

### 17.1 明确禁止的错误修复

1. 用隐藏合同节点代替阻止旧合同创建。
2. 用恢复合同 UI 解决 C01；目标已经明确为普通目录。
3. 把中文合同文件夹或用户文件名批量改掉。
4. 为让根目录跨模块移动成功，删除所有原位置/冲突保护。
5. 把共享改成独立复制，或把独立复制改成共享以复用代码。
6. 用复制后删除实现同区移动，造成 FolderId/LinkId 改变。
7. 仅在前端选项表加 project，后端仍不接受真实项目父级。
8. 仅提高 schema 常量，漏掉新建 SQL CHECK/INSERT，或删 Ensure 后漏建保护触发器。
9. 只把测试中的旧名称替换掉而不验证新业务关系；为通过 CI 降低断言强度。
10. 因旧目录日期早而删掉正在运行的 fixture、脚本、PDF/ZIP 能力模块。
11. 把 tools/list 删除视为退休完成，却允许 tools/call 或通用 HTTP 继续写入。
12. 把旧 CI 成功、纯 VM 测试或静态推导描述为最新 Windows 真机验收。

### 17.2 遇到以下情况先解决阻塞，不继续删代码

当前目标分支被他人推进且有重叠改动；必需调用方仍依赖拟删除接口；新库完整性、文件字节或版本断言失败；同区移动产生新身份；跨区出现共享物理对象；测试发生部分提交；平台权限拒绝远端操作。

先记录具体阻塞文件/提交/测试和已完成部分，处理能独立完成的工作。不得强推覆盖或更换通道绕过拒绝。仅仅没有本地 Windows，不应伪造测试，也不应忘记继续核验可用的 Windows CI。

### 17.3 最终报告必须回答

1. 哪些 C01—C08 已完成，哪些仍待处理，分别由什么提交解决。
2. 退休了哪些公开工具/HTTP 入口；新增或调整了哪些参数；最终 MCP 工具数量来自什么检查。
3. 新库版本是什么；旧库如何提示；是否发生迁移或用户数据操作。
4. M/K/X/O 测试各自结果；跨入口闭环是否真正完成。
5. 最新同 SHA Windows CI、产物链接；跳过项、失败及人工待验证范围。
6. 删除文件清单与保留文件理由；当前工作区和远端提交状态。

只有文档提交、只有编译成功、只有 Node 测试成功，都不能把整项标为完成。

## 18. 执行进度表与完成检查表

下表初始状态是“待实施”，本轮只完成任务书。后续执行 Agent 按批更新，不用另造一份冲突的计划。

| 批次 | 状态 | 产品提交 | 本地验证 | 同 SHA Windows CI | 剩余问题 |
| --- | --- | --- | --- | --- | --- |
| S0 基线与范围 | 已完成 | 随 S1 提交 `13596b973941` 归档 | 已复核当前接口、SQLCipher 资源关系、旧合同/排序调用链及现有 Smoke | 历史基线 #520 与本轮产品 #521 均 success；后者非 S2—S5 验收 | 当前环境无本地 Windows/.NET，实机交互由现有 Edge/HTTP CI 覆盖，用户本机未验 |
| S1 根目录移动 | 已完成（自动化验收） | `13596b973941` | M01—M08 真实 HTTP+SQLCipher、原有目录移动/共享/版本回归均通过 | [Windows CI #521](https://github.com/zy19970/IPSys/actions/runs/41793618031) completed/success，同 SHA，26 success/0 failure/2 可选 ZIP64 skipped | 用户本机操作未复验；S2—S5 尚未实施 |
| S2 合同/数据库 | 已完成本批自动化验收；跨入口总闭环待 S5 | `d74baf2`；修复至 `5c555d2` | 新建 schema 3／旧库只读拒绝／项目普通目录／版本共享／回收站／44 项 MCP／Node 和 Edge 回归 | [Windows CI #526](https://github.com/zy19970/IPSys/actions/runs/41802424444)：26 success，0 failure，2 可选 ZIP64 skipped；head_sha=`5c555d2` | 真实用户本机尚未复核；K03 跨入口同批对象闭环及 S3—S5 待推进，旧 Edge 观察脚本仍有已存在告警 |
| S3 复制/移动/MCP | 本批自动化验收完成；历史 Edge 观察缺口另列 | `c719810` → `39305f2` → `e040afb` | 同区原位 move、目录共享与独立复制、跨区物理隔离、项目真实父级、MCP 目标/幂等、Node/SQLCipher/HTTP/Edge 复验 | [Windows CI #529](https://github.com/zy19970/IPSys/actions/runs/41816669123) `completed/success`、26 success/0 failed/2 optional ZIP64 skipped；`head_sha=e040afb` | 第16.4节同批对象跨入口闭环、本机 GUI 人工复验和既有拖拽/分页问题待跟踪 |
| S4 统一排序 | 本批自动化验收完成（残留 Edge 观察问题单列） | `eedb9f0` → `899969c` → `a2000e1` | 两工作区全部合法普通模块、project 真父级、多层目录、附件版本不变、全量同层校验、SQLCipher 回滚、MCP 43 项、GUI 显示顺序；O01—O07 | [Windows CI #532](https://github.com/zy19970/IPSys/actions/runs/41822426599) `completed/success`，26 success/0 failed/2 可选 ZIP64 skipped；`head_sha=a2000e1`；Edge T-P1-05 PASS | S5 旧端点源文件与历史文档引用清理、16.4 跨入口同一批对象闭环、用户本机人工复核及历史拖拽/分页观察未完成 |
| S5 清理与收尾 | 待实施 | — | — | — | 文档、引用、跨入口闭环 |

最终完成检查：

1. [x] 所有生产路径只接受目标三类 Folder kind，旧合同工具直调也失败。
2. [x] 新库第一次使用即具备全部保护与更新时间能力；旧库明确拒绝且不迁移。
3. [x] 两个不同模块的虚拟根不会再误判同一位置。
4. [x] 项目内普通文件夹独立复制、共享、移动、合法跨区转移均可从真实菜单进入。
5. [x] GUI/MCP 对同区移动保持同一身份语义。
6. [x] 普通目录排序覆盖所有合法模块和父级，拒绝不完整兄弟集合。
7. [ ] 旧长下拉无生产残留，测试保护迁移到实际入口。
8. [ ] 现行手册、Wiki、Agent 提示和工具 schema 一致；历史证据仍可追溯。
9. [ ] 跨入口闭环通过，文件字节、版本、共享和跨区隔离有证据。
10. [x] 最新产品 SHA 的完整 Windows CI 成功，未验证事项明确列出。

### 2026-11-04 S0+S1 第一阶段自动验收补记

本阶段产品提交为 [`13596b973941`](https://github.com/zy19970/IPSys/commit/13596b9739419ba9bd427b5b52e5c2d36ba31245)。源码修复仅在 `NativeFolderBatchTransferEndpoints.cs` 增加来源与目标 section 同一性判断；`NativeFolderTreeTransferSmoke.cs` 新增 M01—M08，使用真实 `/transfer-batch` 与临时 SQLCipher 数据库，核对跨模块顶层移动、原位拒绝、嵌套后代、批量事务、同名、第二根故障回滚、project 虚拟根和子孙循环，同时断言 FileId/LinkId/两个历史版本的字节内容。

GitHub Actions Windows CI #521（run `41793618031`）的 `head_sha=13596b9739419ba9bd427b5b52e5c2d36ba31245`，状态 `completed/success`，**26 个步骤成功、0 个失败、2 个可选 >4GiB ZIP64 步骤跳过**。包含 Debug 编译及业务 SQLCipher/HTTP 综合 Smoke、Node/UI、真实 Edge/HTTP Explorer、独立 SQLCipher/HTTP、MCP stdio、Release、自包含和框架依赖两种单文件 EXE 及图标验证。生成的构建产物有 `IPSys-Web-win-x64-self-contained`（artifact `13304304812`）、`IPSys-Web-win-x64`（artifact `13304414609`）以及 `IPSys-Explorer-V2-Retest-41793618031-1`（artifact `13305445116`）。可在上述 Actions run 页面下载。

本批没有执行旧数据库迁移、用户本机真实数据库操作或正式 Release 发布。下一批 S2 合同对象退出和 schema 升级仍处于待实施；不能把此次成功写成全套 C01—C08 已清理。


### 2026-11-04 S2 合同业务退出与 schema 3：产品代码候选（验收未完成）

本批以第一阶段已通过的 `main=d97dd3b25175` 为父提交。同步处理旧合同业务对象、HTTP/MCP 调用、前端以及新建 SQLCipher 结构版本；拒绝旧版本、缺表/列/索引/保护触发器的数据库，不从旧库迁移，也不再在打开现有库时运行 Ensure 自动修补。取消合同七个 MCP 工具、合同 UI 读/复制、独立合同转移；通用 `kind=contract` 仍有路由但必须显式返回 400。项目下业务资料使用 `archive_folder + section=project + parentId`，项目转移递归复制目录、共享 FileId 关联及全部版本，跨区独立 FileObject。

Smoke 迁移涉及 Schema、FolderModel、HTTP、MCP tools/list/tools/call、Search、RecyclePurge、ProjectMilestone、文件列表/共享/版本、Node 目录/导出/拖拽与 Windows workflow MCP 44 项检查。原历史合同成功用例改为项目目录正向行为及旧工具/URL 拒绝，未直接删除项目查询、项目 Excel、版本与跨区物理隔离断言。当前环境没有 Windows .NET 编译器，**此处只记录已编写代码，不把静态核对或上一批成功 CI 写成 S2 成功**；接下来必须读取本批产品提交 SHA 的完整 Windows CI 结果，失败时修正并重复验证。

本次未操作真实用户资料库，也未发布 Release。S3—S5 不在本次产品提交范围；S2 的具体 K01—K12 分项结果在 CI 核验后补记。


### 2026-11-04 S2 结案核验补记：代码已提交、Windows CI #526 完成

本阶段产品基线是 [`d74baf2557db8a209646c442b17dce32b72afc1e`](https://github.com/zy19970/IPSys/commit/d74baf2557db8a209646c442b17dce32b72afc1e)，最终产品修复提交为 [`5c555d2e0294c6c28068465d72b2b713ffd772db`](https://github.com/zy19970/IPSys/commit/5c555d2e0294c6c28068465d72b2b713ffd772db)。所有提交均通过非强制 fast-forward 更新 `main`，未替换历史、未触碰本机用户资料库或正式 Release。

整改主体：统一资源 `kind=project/ip/archive_folder`，项目下文件夹使用 `section=project` 和真实项目／普通目录 parentId，可多级；旧合同专属业务记录、字段、表单、搜索／回收分支、独立 HTTP 查询／复制／转移端点以及七个 MCP 工具已退出；直接发起 `kind=contract` HTTP 创建得到明确 400。SQLCipher 新建结构版本=3，首次新建包含父级约束、时间戳和共享原件保护，旧 V2／缺失关键结构在打开时只读拒绝，不执行迁移或 Ensure 自动修复；项目整树复制仍保留所有版本并验证跨工作区独立物理对象。MCP stdio 的真实 `tools/list` 已验证恰有 **44 个无重复工具**，历史七个合同工具既不列出也不能 `tools/call`。

实施中 CI 失败均已明确定位并修正，没有通过跳过测试换取成功：#522（`d74baf2`）测试两个 C# 变量名冲突；#523（`e593d56`）永久清理 Smoke 仍要求旧 V2 开库修补；#524（`0f12825`）修改时间 Node Smoke 仍要求 V2 ALTER TABLE；#525（`c5789f8`）旧 Windows Edge fixture 仍创建 `contract`，已连同 `t-http.cjs` 改为项目内普通目录测试。#526（`5c555d2`）最终 `completed/success`，**26 successful、0 failed、2 skipped（可选大于 4 GiB ZIP64）**，包含 Debug+SQLCipher HTTP、Node/UI、MCP stdio、Edge/HTTP 真浏览器、独立 SQLCipher/HTTP、自包含与框架依赖单 EXE 发布及启动和应用图标。证据：[GitHub Actions #526](https://github.com/zy19970/IPSys/actions/runs/41802424444)，run `41802424444`，head SHA 严格等于 `5c555d2e0294c6c28068465d72b2b713ffd772db`。Artifacts：`IPSys-Web-win-x64-self-contained`（13309141140）、`IPSys-Web-win-x64`（13307999994）、`IPSys-Explorer-V2-Retest-41802424444-1`（13307984991）。

K01—K12 在当前自动 Smoke 可覆盖的断言均执行通过：K01 旧 MCP tools/list/tools/call 拒绝、K02 旧 HTTP 拒绝、K03 新项目及多级普通目录和搜索、K04 项目及目录原件版本/共享/跨区字节验证、K05 项目/目录回收恢复、K06 共享引用清理保护、K07 首次创建完整 DDL 与立即使用、K08 重开验证无迁移、K09 初始目录删除后不重建、K10 两类旧 V2 测试库拒绝且数据不变、K11 缺触发器拒绝、K12 无效父级和循环拒绝。**K03 “同一批 MCP 新建对象→GUI 可见→操作→MCP 再读”的完整跨入口闭环仍属第16.4节后续 S5 验收，不能仅因上述单项 Smoke 成功宣称完成。** 用户本机对新版 EXE 的人工点击未执行。

特别注意：旧 Edge 观察脚本将独立用例状态写入报告，但**其 `FAIL` 并不会自动使整个 CI job 失败**。本次 #526 的 `T-P1-02#cascade` 实测为 PASS（旧合同创建拒绝、项目删除/后代隐藏/原 FolderId 恢复）；历史脚本仍报告 `T-P2-02 CONFIRMED_BUG`（内部拖拽）与 `T-P2-09 FAIL`（分页状态抓取），同样的两项在整改前的 CI #521 中已存在，不能视为本次新引入，亦不能宣称已修复。另外 `T-P0-05/T-P1-03/T-P1-05` 保留旧 `IMPLEMENTATION_GAP` 观察口径，需在 S3/S4 或 S5 结合实际新 GUI 复核其有效性。这些既有缺口与本批 **S2 核心自动化验收完成** 是不同结论。

后续仍按任务书推进 S3（独立复制、原位移动、MCP 合法目标矩阵和统一选择器）、S4（目录同层排序）、S5（去残留／现行文档统一／完整跨入口闭环）。S2 仅完成本阶段自动化验收，不代表所有 C01—C08 或完整 E2E 已收敛。


### 2026-11-04 S3 C03/C04 目录转移统一：自动化验收结论

用户指令为“推进下一阶段”“继续”，后续发生多次会话连接中断；实际完成过程以提交和对应 CI 为准，不能推断平台中断的根因。S3 产品初次提交 [`c719810`](https://github.com/zy19970/IPSys/commit/c719810f5f9a4aad5615fc079cc82bf9c61d7b41)，修复 Node 跨 VM 数组严格比较后为 [`39305f2`](https://github.com/zy19970/IPSys/commit/39305f2611b1a3674ca35ce06f9626f0bff867f8)，纠正跨区目录测试目标并补充跨工作区同名移动整体拒绝后的**最终产品提交**为 [`e040afbf1cc557fac858a4f96ae8f7849332b351`](https://github.com/zy19970/IPSys/commit/e040afbf1cc557fac858a4f96ae8f7849332b351)。三次产品提交累计修改 11 个源码及 Smoke 文件，不包括本次纯文档归档提交。

**已证明的行为：**

1. 同一工作区移动通过统一的 SQLCipher 事务服务：GUI `/transfer-batch`、旧单目录 `/move` 和 `/transfer(move=true)` 与 MCP `move_folder/transfer_folder(move=true)` 使用同一原位身份语义；合法跨模块/跨项目移动保留 FolderId、子目录 ID、原 FileId/LinkId、版本历史。目标为 `project` 时只能选择真实项目或其子目录；`0` 仅适用于其他普通模块的根。
2. 同区共享目录树会创建新的 FolderId/LinkId、继续指向同一 FileId；独立复制目录树产生新 FolderId/LinkId/FileId 并拷贝全部有效历史版本，原树中的多处共享仍指向同一个新 FileId。跨工作区复制必须创建物理隔离的 FileObject；跨区移动是独立复制后软删除来源，恢复后源和目标可独立共存。跨区移动遇到同名目标拒绝且不提交；独立复制仍按自身的冲突命名策略。
3. Explorer 记录复制与转移入口使用现有逐级搜索、分页、面包屑的目标文件夹选择器；跨区目标读取独立工作区快照、不替换当前工作区。支持真实项目及多层子目录、同工作区自身/后代拒绝、切工作区/任务占用/取消不写入、提交成功但刷新失败时不重复发送写请求。MCP `move_folder` 增加可选 `target_section`，`transfer_folder` 保留现有字段，写请求的 `request_id` 继续持久去重。
4. 本批由现有 CI 中实际执行的 `NativeFolderTreeTransferSmoke`、`NativeMcpArchiveSmoke`、`explorer-record-transfer-smoke.cjs`、`folder-picker-smoke.cjs` 及其他原回归覆盖 X01—X12 对应场景，包含项目真父级、深层目录、同名、异常回滚、原件历史字节、FileObject 物理隔离、MCP 移动返回 ID/重试、前端真实菜单 payload 和工作区门禁。单个自动化步骤通过不能替代第16.4节跨入口同一批对象闭环。

**CI 证据：**

| Run | 产品 SHA | 结果与真实原因 |
| --- | --- | --- |
| [#527](https://github.com/zy19970/IPSys/actions/runs/41815567331) | `c719810` | failed：新增 Node smoke 第139行跨 VM Array 原型严格比较错误；Debug/MCP/JS 先前步骤成功，Edge/EXE 后续未执行 |
| [#528](https://github.com/zy19970/IPSys/actions/runs/41815957302) | `39305f2` | failed：Node smoke 第160行错误选择不在合法矩阵内的 `personal/general` 作为 `company/project` 目标，被真实前端正确拒绝；未取消业务白名单 |
| [#529](https://github.com/zy19970/IPSys/actions/runs/41816669123) | `e040afbf1cc557fac858a4f96ae8f7849332b351` | **completed/success**：26 个步骤 success、0 failed、2 个可选大于 4 GiB ZIP64 skipped；含 Windows Debug、MCP stdio（44项）、Node/UI、真实 Edge/HTTP、独立 SQLCipher/HTTP、两种 Windows 单 EXE 构建及启动、图标检查 |

#529 Artifacts：`IPSys-Web-win-x64-self-contained` ID **13315755805**，`IPSys-Web-win-x64` ID **13315661040**，`IPSys-Explorer-V2-Retest-41816669123-1` ID **13315231876**。

**已知限制，不能被绿色 CI 掩盖：**同次真实 Edge 观察脚本仍输出 `T-P2-02 CONFIRMED_BUG`（内部附件拖拽）和 `T-P2-09 FAIL`（分页状态）；两项此前基线已有，S3 不是其修复批次。其他 `T-P0-05/T-P1-03/T-P1-05` 仍为历史观察脚本的 `IMPLEMENTATION_GAP` 记录，不能直接当成当前真实 GUI 最终结论。完整 MCP 创建→同 ID GUI 显示及修改→MCP 核对→版本/共享/跨区/回收站的同一批对象闭环留在第16.4节 S5；用户本机手工 UI 验证也未进行。下一批 **S4 O01—O07 同层排序** 尚未实施，S5 的死代码清理和全套现行文档统一亦未完成。S3 自动验收不意味着 C01—C08 全部清零。本轮未操作用户真实数据库、旧库迁移或正式 Release。


### 2026-11-04 S4 C05 同层排序统一：产品代码与 Windows CI #532 自动验收

用户先提出“继续推进吧”，后提出“为什么中断了，继续推进”。两次对话中的工具曾返回 GitHub `ReadTimeout` 和内部错误，但**实际聊天连接中断的确切原因没有独立错误日志**，不能推断为软件卡死。恢复时发现 `main` 已推进到 `a2000e1749c77b3d55930e55315bac32b5ecce8a`，而先前保留的旧 Git Data 草稿树 `d2b7d867e0d6ed403768a7f05c8262c86945d6af` 属于**未提交旧基线**；没有用其覆盖或重复提交已有产品代码。

产品提交与失败核对：

| 提交 | Windows CI | 核对结果 |
| --- | --- | --- |
| [`eedb9f0`](https://github.com/zy19970/IPSys/commit/eedb9f0bc41cfc26252a61a42232a7c1b5db7a24) | [#530](https://github.com/zy19970/IPSys/actions/runs/41820584855) | failed：新增排序 Smoke 的 DTO 构造传入数组，但实际参数要求 List；产品提交与失败均保留供追溯 |
| [`899969c`](https://github.com/zy19970/IPSys/commit/899969c1a88227385e98d8850e109505faa1e125) | [#531](https://github.com/zy19970/IPSys/actions/runs/41820987832) | completed/success，26 success；Edge 活跃 T-P1-05 仍访问已退休排序 URL，旧测试对合法 404 错误误报 FAIL，不能仅以绿色 CI 认为观察项通过 |
| [`a2000e1`](https://github.com/zy19970/IPSys/commit/a2000e1749c77b3d55930e55315bac32b5ecce8a) | [#532](https://github.com/zy19970/IPSys/actions/runs/41822426599) | **completed/success、26 success、0 failed、2 个可选 >4 GiB ZIP64 skipped**；Edge T-P1-05 使用现行 `entries/reorder` 接口验证，实测 PASS，响应包含排序持久化、缺项 409、非法 ID 409、失败后顺序不变 |

**实施结论与 O01—O07 映射：**

1. `list_folder_entries(workspace,section,parent_id)` / `reorder_entries(workspace,section,parent_id,items,request_id?)` 现支持 company 的 certificate/achievement/party/general/project 和 personal 的 certificate/achievement/academic/general/project；普通模块 `parent_id=0` 表示根，project 必须使用真实项目或子目录的正整数 FolderId。MCP `reorder_folders` 退休，不再出现在 tools/list 或 tools/call；真实 stdio 验证当前工具总数 **43**，无重复。项目台账 `reorder_records(kind=project)` 保持原来的选中记录占槽位排序含义，知识产权原有台账排序未改。
2. `reorder_entries.items` 只接受完整且互不重复的 `[{kind:"folder",id:FolderId}]`，只含目标父级的全部有效普通子目录，不允许附件、后代、跨模块、其他父级、旧 `kind=record`、缺项、多项或重复项。SQL 仅修改同一工作区/模块/父级的 `folders.position`，事务失败整次回滚，不影响 FolderId、FileId、LinkId、版本字节或目录位置；O02/O03/O04/O05/O07 使用临时 SQLCipher/HTTP 专项 Smoke，含人为注入第二次 SQL UPDATE 失败的回滚断言。所有普通模块根/嵌套以及项目真实父级的 O01 也覆盖。
3. GUI `reorderArchiveEntry` 从真实 `Drive.sortedItems` 的可见自定义排序构造完整同层目录队列，不再直接使用名称/初始数组顺序；混排附件不参与该列表；过滤、搜索、非自定义排序或清单不一致时禁止写入。项目直属目录的 `p:真实项目 ID` 已纳入自定义排序和 `archive.orders` 快照；O06 的 Node 真实入口测试验证名称顺序与持久化 position 不一致时仍操作正确节点。项目虚拟 `project:0` 不再发起不合法的快照查询。
4. 旧 `/api/v2/ui/folders/{workspace}/{section}/order` 已不注册，活跃 `NativeArchiveUiHttpSmoke`、MCP/CI/Edge T-P1-05 已迁到 `/api/v2/folders/{workspace}/entries/reorder?section=...`。旧实现源文件 `NativeArchiveUiOrderEndpoints.cs` 仍保留但无生产 Map 注册，按第15节在 S5 进一步做无调用证明后清理，不为减少文件数提前误删。

**真实验收范围：** [#532](https://github.com/zy19970/IPSys/actions/runs/41822426599) 已包含 Windows Debug+临时 SQLCipher/HTTP、MCP stdio 43 项、Node/UI、真实 Edge/HTTP、独立 SQLCipher/HTTP 往返、Windows 两种单 EXE 构建启动与图标。构建产物：自包含 EXE `13318595193`；需 .NET 运行时 EXE `13317089888`；Edge 报告 `13317913804`。Edge 原始日志明确 `T-P1-05 PASS`，而 `T-P2-02 CONFIRMED_BUG`（内部附件拖拽）及 `T-P2-09 FAIL`（分页状态）仍保留，这两项在 S4 前已经存在，不能报成已修复。用户真实数据库、旧库迁移、正式 Release 和本机 GUI 人工验收均未执行；第16.4节完整的**同一批对象** MCP→GUI→MCP 端到端闭环尚未执行，留在 S5。S4 本批自动验收完成**不等于** S5 清理及总验收完成。

### 2026-11-04 S5 第一批清理进行中

用户已授权正式推进 S5。第一批采取最小清理：删除未注册的 `NativeArchiveUiOrderEndpoints.cs`，去掉没有生产调用的 `moveArchiveEntry` 旧长下拉，并把原脚本的目标安全性检查迁入正在运行的真实 `moveSelectedItems→transferFolderBatch→AttachmentFolderPicker` 测试。保留 `NativeArchiveOrder.cs` 与所有项目共用服务、合同退休接口负面回归、历史证据。清理代码提交的 Windows CI 以及第16.4节跨入口完整闭环尚待独立核验；不得仅因删除成功标记整个 S5 结束。
