# IPSys 跨会话详细交接（2026-10-13）

## 2026-10-14 验收状态收尾与下一阶段实施安排（以最新 main 为准）

当前以用户实际操作反馈和 Windows CI 双重区分：
1. **B01–B05 业务与原件**：项目、知识产权、合同及各类归档资料的新增、修改、软删除/回收站、复制/转移、原件版本与批量上传已落库；B05 用户明确验收通过。
2. **PDF 预览**：已弃用存在仅渲染顶部约 150px 问题的浏览器 PDF iframe，改为嵌入 EXE 的 PDF.js Canvas 阅读器；最终 CI #38509873218 通过，且用户于本轮明确反馈“没问题了”，**PDF 实机验收完成**。
3. **B06 原件导出**：模块级附件选择、项目及其全部合同一键文件夹/ZIP 导出已编码并通过 CI；个人/公司隔离与文件字节完整性经自动回归。保留尚未明确获得用户对全部导出边界场景实机确认的状态。
4. **MCP**：本机 Codex/通用 stdio MCP 已有 14 项工具（含专利 CRUD 及分类附件），Windows 握手/SQLCipher 回归通过；其他客户端实际配置/长期使用情况继续按需核实。
5. **大文件**：用户明确表示“已经验证好了，没什么问题”，记为**用户本机所测大文件场景通过**，不重复作为下阶段主要任务；但未提供具体单文件字节数，且当前 HTTP 上传上限仍可见 64 MiB，**不能推导已验证超过 2 GiB 或取消现行限制**。磁盘耗尽、移动 SSD 异常拔出、备份一致性属于独立安全验收，仍保留。
6. **下一批 P1 Excel**：先按 M0 冻结字段实施固定 XLSX 模板、项目/知识产权台账导出（当前筛选与模块全部）和批量导入（错误行跳过、重复记录明确选择），再扩展证书/成果/综合资料；合同只导出、不通过 Excel 批量新建；附件绝不通过 Excel 导入。之后为 P2 当前工作区跨模块统一搜索、P3 剩余数据安全专项与 V1.0 收尾验收。

以上段落是当前进度基线，下文 B05/B06“本轮”“等待”等旧描述属于历史阶段说明，以此处与当前 GitHub Actions/测试结果为准。


## 2026-10-14：本机 Codex MCP 已入 main，首版 Windows CI 全部通过

用户明确要求为本机 Codex 添加 MCP，并追加允许删除项目、合同、原件。实现 `src/IPSys.Web/McpLocal.cs`：同一 `IPSys.Web.exe --mcp` 子进程使用 MCP stdio JSON-RPC，经当前 Windows 用户专用命名管道连接现有 WinForms 主进程；所有业务调用仍使用已认证 localhost API 操作同一 SQLCipher Vault。新增 `/api/mcp` 授权开关，数据库打开后默认关闭，关库/退出失效；前端「系统设置」提供开启/关闭。共十个工具：`list_projects`、`list_contracts`、`list_files`、`create_project`、`update_project`、`delete_project`、`create_contract`、`delete_contract`、`upload_files`、`delete_file`。删除均进入已有回收站，未开放永久清理。可通过 `MCP_CODEX.md` 注册本机 Codex 服务。

Windows Actions run #38499596519 已通过 Debug/Release、MCP stdio 握手和工具列表、UI 静态校验、通过真实本机命名管道执行 SQLCipher 项目/合同/附件创建、上传 SHA-256 验证、回收站软删除与关闭后拒绝授权；已生成 `IPSys-Web-win-x64` 发布附件。用户本机 Codex 交互验收仍需执行，详见 `WEB_TESTING.md` 顶部。本批默认支持项目及合同附件，每文件限 64 MiB；跨工作区指定参数，默认不自动合并同名原件或物理字节。


## 2026-10-14：用户实测后的 B05/B06 附件交互修订

根据综合资料详情截图，B05 原件组只剩一个有效版本时隐藏版本号（不重编号、不修改旧字节）。综合资料及业务附件的同名上传使用按钮弹窗，分「更新已有原件为新版本」「作为独立原件」「跳过」；两个入口均支持一次选择多文件，逐件归档并汇总失败。B06 结果面板在成功后约 9 秒、有失败时约 18 秒自动收起，仍支持手动关闭；导出全选只勾选有效最新版，历史版本手动选择。真实项目与知识产权台账增加多条记录勾选，点击「选择记录附件」后在模块选件面板预勾选所选记录的最新版，合同仍需手动补选，然后用原有文件夹或 ZIP 导出。相关 UI 与导出 smoke、人工验证步骤见 `src/IPSys.Web/tests/` 与 `WEB_TESTING.md` 顶部。待 Windows 最新 CI 与用户实机确认后，方可将该反馈修订标为正式验收通过。


## 2026-10-14：B05 用户已验收，B06-1 附件选择导出进行中

用户明确宣布 B05 验收通过。当前从 `main` 直接推进 B06-1 原件按勾选导出，不调整冻结的 U0 业务表格/卡片结构。新增 `wwwroot/export.js`（经 csproj 内嵌且由 `app.js` 加载），使用浏览器原生目录/保存位置授权，选件按项目、合同、知识产权、资质成果、综合资料记录命名文件夹，合同嵌套在所属项目文件夹内；支持选择最新或指定旧版、同名冲突编号、ZIP 单次生成、失败跳过与可取消写入。普通文件夹保留已完整写出的结果，ZIP 取消则中止提交。 `tests/export-smoke.cjs` 已纳入 Windows Actions（目录重名、同名合同、ZIP 中央目录、部分失败测试）；`WEB_TESTING.md` 顶部有人工验收步骤。

导出只在本机 Edge/Chrome 的 File System Access API 中保存到用户**本次显式选择**的位置，不创建随程序运行产生的明文临时文件。当前 ZIP 无压缩，仅兼容小于 4 GiB 的标准 ZIP，不支持 ZIP64；SQLCipher B05 单附件导入仍限 64 MiB。后续依次实现 Excel 和统一搜索，大文件/移动 SSD 专项仍按原 M1 计划。B06-1 的源代码与相关 CI 自动测试已提交，但用户本人还未对新导出进行本机验收，不得标记 B06 正式完成。


## 2026-10-14 最新进展：B05/B05b-2 源码已提交，完整验收未确认

本段优先于下方历史交接快照。用户明确要求先完成 B05，不扩展 Excel/统一搜索/大文件专项。本次在 main 实施：`BusinessFiles.cs` 增加不破坏旧业务原件的 group_id 身份升级、同名独立原件、指定版本链更新、同工作区多个业务记录共享新版本同步、显式 SHA-256 重复物理字节复用、跨工作区独立对象；`GeneralStore.cs`、`Program.cs` 对既有综合资料 attachments/records 非破坏性增列，实现历史版本、新版选择、软删除、授权下载；`RecycleStore.cs` 将综合资料父记录与附件接入统一回收站及永久清理；`app.js`、HTML/CSS 将新功能纳入已冻结的详情与系统设置，增加 PDF/常见图片只读预览；Windows HTTP smoke 与 Node UI smoke 增加同名独立/共享/去重/恢复测试。

正式状态：**代码已推送；本轮完整 Windows CI 是否通过尚未核实，也尚未获得用户 Windows 本机验收**。不得宣称 B05 正式通过。测试顺序见 `WEB_TESTING.md` 顶部 B05b-2 小节，测试必须采用可丢弃非敏感 SQLCipher 库；尤其先核对旧库重复打开时 group_id/version 稳定、物理对象不跨工作区复用、数据库软删除恢复正常。若 CI 失败，优先对照最新运行中的 Debug、Node UI、SQLCipher HTTP 测试并直接修复 main。大文件 64 MiB 上限未提高；M1 的超大文件、移动 SSD、手工备份，M6 导出/Excel/检索不属于本轮完成内容。


> **B05b-1 最新交接（2026-10-14）**：新增 RecycleStore.cs 的 GET /api/trash/{workspace}、POST /api/trash/{workspace}/restore|purge（支持 1–200 条），含删除项目/所属合同/原件的恢复、单条和勾选批量永久删除、共享对象垃圾回收保护。业务文件新设 /api/business-files/{workspace}/{linkId}/associate，实现同一工作区有效业务记录间按同名同类别已有版本组复制/移动引用，源链接安全软删除，保留其它记录共享数据。业务详情文件列表按最新版/可展开历史版本分组，同名再次上传先要求明确确认；系统设置入口打开真实回收站。后续独立同名原件分组、多记录共同引用的未来新版同步、综合资料旧附件统一恢复仍待完成。前次 B05 逻辑跨工作区复用对象已改为未来操作采用独立对象，不自动迁移历史库。自动 CI 和用户实际验证状态以对应 Actions 为准。


> 用途：供用户切换 ChatGPT 会话后直接接续 IPSys 开发，不再重复需求访谈或重新摸索已解决的技术问题。
>
> **最新交接更新（2026-10-13）**：用户明确将实施优先级改为「先基本业务可操作、辅助能力后置」，U0 界面继续冻结。F01 综合资料/其他资料的 SQLCipher 名称修改已获用户实机确认。本轮 B01 新增 `business_projects` 结构化项目表及 GET/POST/PUT/DELETE/transfer API；公司科研/横向、个人科研合作真实台账按 M0 三项目类型实现新增、修改、软删除、复制和跨工作区转移。**B01 的项目附件和项目合同真实关系尚未实现**。B02 知识产权引入 `business_ips` 台账，七种固定类型、各类型状态和全部 M0 可选字段以 JSON 正文存储在 SQLCipher 数据库，保留固定类型与状态单独列用于查询；支持增改删、同/跨工作区复制和转移。两类业务复制/转移目前都仅限结构化字段，不包含未接入的项目/IP 附件原件。B03 项目关联合同新增 `business_contracts`，只允许在现有项目详情中创建；公司“全部合同”作为真实汇总，支持查看、编辑和软删除，合同可在所属项目内复制；项目复制/跨工作区转移时会在同一事务中复制有效子合同并重新关联项目，删除源项目后原合同隐藏。合同金额按人民币 `0.00` 显示。B01/B02/B03 结构化业务已接入，B04 已引入 `business_archives`，公司企业资质、个人身份资质、个人成果奖励及学术活动沿用冻结三级界面接入真实数据库，并通过工作台快捷入口访问公司科研成果；按 M0 仅名称必填，类别/备注/标签可选。支持真实 CRUD、复制，以及同一 `research_output` 范围的分类/工作区转移；公司企业资质与个人证件彼此不可转型。B05 已加入 BusinessFiles.cs：`business_file_objects/chunks/links` 同库加密分块存储；项目、合同、IP、企业/个人资质、成果/学术资料的详细页支持上传、下载、软删除附件关联。知识产权固定四材料类别，同名同类别历史版本，SHA-256 验证；项目复制/转移（含每个子合同）、合同同项目复制、知识产权/归档复制转移时在事务内复制链接但共享同一加密二进制。原有综合资料 records/attachments/chunks 不改。B05b 恢复及关联管理、完整导出与大文件专项还未实现。上轮 F02 深度附件校验与备份复制 CI 失败的实验代码已在 main 回滚，后续安排专项重新验证。实际可用以最新 CI 和用户实机反馈为准。
>
> **旧版维护说明**：本交接主体记录最初交接时的技术快照，后续已将唯一运行工程统一为 `src/IPSys.Web`，并删除不被其引用的历史控制台 `src/IPSys.M1`、专用 CI 和测试说明；历史实验与其 CI 成功证据仍可从既有提交及 Actions 运行历史追溯。当前功能及验收状态以最新 `main`、`DEVELOPMENT_PLAN.md`、`WEB_TESTING.md` 为准。
>
> 仓库：https://github.com/zy19970/IPSys ，工作分支：main。
>
> 本交接依据的最新代码提交：97088de53b81c783a0c16a40e0dc38ac2fbc8942。交接文件提交后 main 将产生更新的 SHA，属于正常情况。
>
> 总体状态：**V1.0 需求范围已冻结；M0 字段字典已定稿；M1 WinForms + 本地网页技术原型正在验证；尚不是完整业务系统。**
>
> 新会话首要事项：请用户复测最新会话恢复修复，然后继续 M1 的大文件、退出安全、移动 SSD 和浏览器文件目录选择验证。

## 一、最重要的项目结论

1. **用户最终认可的形态**是 Windows 10/11 x64 下的 C# WinForms 小启动器。双击 EXE 显示主窗口，只有点击「打开浏览器管理界面」才打开 Edge/Chrome 网页。浏览器关闭不会退出程序；关闭 WinForms 右上角 X 或点击「退出程序」，才会停止本机服务并关闭数据库。
2. 浏览器本身不是远程业务网站，而是访问由同一 EXE 托管的 **ASP.NET Core localhost 服务**，仅监听 127.0.0.1 的临时端口。网页资源 HTML/CSS/JavaScript 已编译为程序程序集资源，**运行时不需要 EXE 旁放置 wwwroot 文件夹**。
3. 本机数据库采用真正 SQLCipher 加密，用户指定保存位置。原件以二进制分块形式实际存在加密 SQLite 文件中；不是仅保存外部文件路径。
4. 用户已经明确反馈：**在本机成功看到网页、上传文件和下载文件**。这是实际手工测试结论。不能由此推导 2 GiB 以上附件、SSD 突然断开、自动/手工备份恢复等已通过。
5. 最新改动是 **关闭浏览器再打开的会话恢复**。GitHub Windows 自动测试已成功，但用户尚未明确反馈该最新修复在本机实际操作通过。
6. 需求 Q1–Q162 已冻结。M0 的 R1–R3 使用默认建议并获确认；R4 的合同金额默认为人民币（CNY），**显示格式 0.00**，未填写金额保持空值。不要再从 Q163 开始继续无穷尽提问。
7. 仓库目前的业务数据库还是 M1 临时三张表，只有「综合资料」最小演示功能。正式知识产权、项目合同、证书等业务和完整附件生命周期尚未实现。
8. **维护开发计划要收敛**。README 负责入口，REQUIREMENTS 负责冻结业务，M0 字典负责字段，DEVELOPMENT_PLAN 负责阶段，FREEZE_AUDIT 负责技术风险；DESIGN.md 是旧稿，M2 前必须重构。本交接文件只用于更换会话时恢复上下文。
9. 新会话首先应获取 GitHub 最新 main 和完整提交历史，遵循 https://github.com/zy19970/AIGT-templates/ 的 AGENTS.md、AI_RULES/GIT_OPERATIONS.md，再开展新修改。
10. 用户更希望 AI **直接修改 GitHub 代码、自动编译、推送 main，自己在 VS 拉取测试并反馈截图**，不希望停留在方案讨论。
11. **GitHub 写入能力与跨会话检查约定（用户 2026-10-13 再次明确）**：用户已配置 ChatGPT ↔ GitHub 连接，默认希望 AI 根据 AIGT-templates 规则直接在 `zy19970/IPSys` 的 `main` 提交和推送可逆修改。新会话执行前必须先发现并实际检查已连接的 GitHub 工具、仓库读写能力与当前 main，而不是凭印象声称“无法访问/无法推送”。若连接状态或权限在未来发生变化，应报告本次实际的检查结果，不虚构成功或失败。

## 二、文档导航与优先级

| 文件 | 内容和权威性 |
| --- | --- |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 唯一正式业务需求基线。Q1–Q162 冻结，末尾第 37 节是后续 WinForms 启动与退出方式的明确修订；新设计须以较新覆盖条款为准 |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | M0 已确认：业务字段、类型、状态、Excel 导入导出列、逻辑实体关系和 17 项验证用例；R1–R3、R4 已确认 |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | 唯一开发主计划，M0–M7 的目标、进入条件、交付物；尚未定具体工期 |
| [UI_BASELINE.md](./UI_BASELINE.md) | **U0 已确认的界面冻结基线**：导航、卡片、表格、独立详情及前端映射；界面扩展需用户提出 |
| [FREEZE_AUDIT.md](./FREEZE_AUDIT.md) | 需求覆盖冲突 C01–C11、关键技术验证门槛 T01–T09，含安全和异常验收原则 |
| [WEB_TESTING.md](./WEB_TESTING.md) | 当前 WinForms + 网页最小原型的 VS、EXE、数据库、附件及会话恢复实机测试指南 |
| [README.md](./README.md) | 根目录统一入口；部分描述为历史阶段快照，以最新 CI 与此交接确认的代码状态为准 |
| [DESIGN.md](./DESIGN.md) | 历史探索草案，存在已撤销的业务设想，不能直接据此实现；M2 时整体重构 |
| **HANDOFF.md** | 本文件，供新的会话快速承接，不是新的正式需求或计划文件 |

注意：FREEZE_AUDIT.md 曾写「字段字典待定」，这是当时的审查状态；此后 M0 已正式定稿。遇到类似历史状态表述时，以最新代码、M0 字典、开发计划和相关 commit 为准。

## 三、V1.0 已冻结的核心业务要求

### 3.1 运行、存储、安全与工作区

1. Windows 10/11 x64，单用户、纯离线、便携绿色运行。用户可指定数据库文件位置，一次只打开一个加密主库，每次解锁手动输入密码；不自动记住密码，不提供找回。
2. 公司工作区与个人工作区都在**同一加密主库**中，但记录、附件及二进制载荷须按工作区隔离，不能在两个工作区之间共用同一物理原件对象。
3. 原件字节必须存入加密 SQLite，支持大文件分块。用户目标包括超过 2 GiB 附件、较大的总库容量（例如 5–20 GiB），但当前网页版尚不具备这种完整能力。
4. 数据库只允许用户**安全退出后用 Windows 资源管理器手工复制备份**；没有自动备份、后台备份向导、密码找回或自动锁定。
5. 若设计「导入后自动删除源文件」，必须能先验证**包含本次新文件的有效新备份**；否则不允许自动删除源文件。当前原型从不删除源文件。
6. 支持手动压缩数据库、手动确认字段升级及版本兼容。移动 SSD 断连、断电、日志文件与复制一致性仍须专项验证。

### 3.2 模块及最小必填

| 模块 | 工作区 | 冻结规则 |
| --- | --- | --- |
| 知识产权 | 公司、个人 | 发明专利、实用新型、外观设计、软件著作权、其他著作权、商标、集成电路布图设计七种固定类型；**只强制名称和 IP 类型**，状态和专有字段由 M0 字典规定 |
| 项目 | 公司、个人 | 科研项目、横向项目、其他项目；**项目名称和项目类型必填**；状态 筹备中/进行中/已完成/已终止，默认筹备中 |
| 合同 | 公司、个人 | 每份合同恰有一个所属项目，**只能从项目详情创建**；合同名称必填；允许独立的合同汇总台账用于查看、搜索、导出，不允许从汇总页新增 |
| 企业资质/证书 | 公司 | 名称唯一必填，可选分类、备注、标签及附件 |
| 个人证件 | 个人 | 名称唯一必填，可选分类、备注、标签及附件 |
| 科研成果 | 公司、个人 | 名称唯一必填，极简其它字段；不强制 DOI/作者/发表日期 |
| 综合资料 | 公司、个人 | 名称唯一必填，类别默认「综合资料」，允许附件 |

辅助分类/子类别可调整，但不得覆盖七种固定 IP 类型、三种项目类型。知识产权附件独有四类：**申请材料、通知文件、证书文件、其他材料**；其它模块附件不分类。业务记录可以手工建立同工作区内双向关联。

合同金额已确认默认为人民币 CNY，按 **0.00** 数值格式显示，空金额不显示为 0.00。正式字段清单不要在交接文件里重新编造，直接按 M0_DATA_DICTIONARY.md。

### 3.3 附件、搜索、Excel 和导出

1. **先建业务记录再上传附件**，无独立「待整理文件池」。支持文件/文件夹选取、拖放；来源文件夹层级不需要在数据库中按原样保留。
2. 原始文件名必须保留；可以单独编辑显示名称。需要 SHA-256 内容去重检测与提示、同工作区多记录共享文件、多个历史版本、不同工作区物理字节独立。
3. 正常导出默认最新版；旧版从历史页单独选择。原件导出需用户勾选每个文件，按业务记录建子目录，项目合同附件以「项目名称/合同名称/原文件名」嵌套；按原有命名冲突和取消规则生成目录或 ZIP。
4. 每次导出由用户明确选择保存位置；在同一数据库中的共享二进制被多个业务记录选中时，各导出记录文件夹都应出现完整文件副本。
5. Excel 结构化台账导入使用**各模块固定模板**；合同不支持 Excel 批量导入。Excel 台账与附件原件导出是**两个独立动作**；导出范围可以选「当前筛选结果」或「当前模块全部记录」，表头固定，隐藏网页表格列不影响 Excel 字段。
6. 检索当前工作区结构化字段和附件文件名；不进行 PDF/Word 文件正文的全文搜索或 OCR。
7. 有回收站和手动永久删除，不自动清空；共享文件仍被其它记录引用时不能误删字节。

明确取消的功能包括：跨平台发行、多用户、云同步、多公司主体、提醒/审批/年费、材料申报清单、自动备份、SQL/SQLite 数据库导出、全公司台账及原件一键打包、虚拟文件夹和待整理文件池。旧 DESIGN.md 含有这些已废弃提案，切勿照旧开发。

## 四、当前最小可运行程序：架构和代码

### 4.1 WinForms 生命周期

**实际执行约定**：双击 IPSys.Web.exe 出现「IPSys · 本地管理系统」窗口；进程中的 localhost HTTP 服务已启动，但**不会自动打开浏览器**。点击「打开浏览器管理界面」后才启动默认 Edge/Chrome，若默认是其它浏览器则尝试 Edge；不会修改 Windows 默认浏览器设置。关闭浏览器页面不会结束服务；关 WinForms 主窗口或点击「退出程序」才退出。网页内「安全退出」也可请求退出 WinForms 后台。

WinForms 窗口代码在 src/IPSys.Web/LauncherForm.cs。当前应用将 WinForms UI 跑在独立 STA 线程，ASP.NET Core host 在同一进程中独立运行。localhost 每次启动可以有不同端口，不要把截图里的 127.0.0.1:17343 当成固定端口。

### 4.2 前端完全内嵌 EXE

主工程 src/IPSys.Web/IPSys.Web.csproj 使用 **net8.0-windows、WinExe、UseWindowsForms=true**；目前依赖：

| 依赖 | 版本 |
| --- | --- |
| Microsoft.Data.Sqlite.Core | 8.0.10 |
| SQLitePCLRaw.bundle_e_sqlcipher | 2.1.11 |

HTML、CSS、JS 源码保留在 src/IPSys.Web/wwwroot/ 下，但 .csproj 把三个文件以 **EmbeddedResource** 编入程序集；src/IPSys.Web/Program.cs 里的 EmbeddedWebAssets.Read 从程序集资源读取，localhost 路由直接返回。Debug/Release 运行时无须外置 wwwroot。曾有 Visual Studio Debug 浏览器打开后 HTTP 404 的问题，起因是静态文件路径/复制；先通过资源复制修复，后已彻底改为 EXE 内嵌资源（commit e81ea05d）。

注意区分：**网页资源单独文件已经不需要**，但自包含 .NET 与 SQLCipher 仍可能产生其他发布依赖文件，不能未经实测承诺只复制一个 EXE 必定运行。

### 4.3 最小业务原型与数据库模型

现在只实现「综合资料」最小录入与附件的试运行链路，数据库逻辑仅有：

| 表 | 原型列/用途 |
| --- | --- |
| records | id、workspace（company/personal）、title |
| attachments | id、record_id、filename、expected_size、size、sha256、state（writing/ready） |
| chunks | attachment_id、idx、bytes；单块约 1 MiB |

上传原件在 HTTP 请求体以二进制原始流进入，后端分块存进 SQLCipher BLOB 并记录 SHA-256，成功后才标记 ready。写入中断可能留下 writing 记录，正常列表/下载不应展示未完成附件。

**当前网页版单文件限制 64 MiB**（程序请求体最大值约 66 MiB），仅供验证。下载前端使用 response.blob()，对 2 GiB+ 文件不适合；正式超大文件必须先完成流式出口设计与内存/SSD 测试。正式版还没有附件多版本、物理内容复用、跨区复制、回收站、完整业务字段/项目合同关系。

后端服务只绑定 127.0.0.1，包含 Host/Origin 检查、CSP、会话 token 认证、单一数据库串行访问闸门。**这是原型安全基础，不等于生产安全审计完成**。数据库在打开时检查 SQLCipher cipher_version，不允许回退明文 SQLite。使用 DELETE journal 和 synchronous=FULL；手工备份一致性仍需硬件实测。

### 4.4 当前 HTTP 路由

| 方法与路由 | 实际用途 |
| --- | --- |
| GET /、/index.html、/style.css、/app.js | 读取 EXE 内嵌网页资源 |
| GET /api/status | 返回数据库是否已解锁和建议路径 |
| POST /api/open | 新建或解锁数据库；**已在运行时不能重复打开同一主库** |
| POST /api/resume | **最新修复**，通过已打开数据库的正确密码恢复浏览器会话 |
| POST /api/lock | 关闭当前数据库并使令牌失效 |
| GET /api/records/{workspace} | 当前工作区综合资料与已完成附件 |
| POST /api/records/{workspace} | 创建综合资料记录 |
| POST /api/records/{workspace}/{id}/files | 原件上传，当前最多 64 MiB |
| GET /api/files/{workspace}/{id} | 工作区隔离的附件下载 |
| GET /api/check | 数据库完整性检查及 writing 条目统计 |
| POST /api/exit | 请求关闭数据库、本地服务与 WinForms |

workspace 当前使用 company/personal。浏览器操作 token 保存在该标签的 sessionStorage 中；**密码本身不应保存进浏览器存储**。

## 五、最新待用户实机验证的会话恢复修复

### 5.1 故障与原因

用户此前看到「请先关闭当前数据库」。用户先打开测试库，关闭浏览器标签后 WinForms 还在后台持有库；新标签的 sessionStorage 不一定保留旧 token，却又尝试 POST /api/open，导致后端认为重复打开并返回 HTTP 409。

WinForms 生命周期与浏览器页面生命周期不同，这是设计要求，不能把「关闭浏览器」改回自动退出程序来掩盖问题，也不能为了打开新标签强制关闭别人仍在使用的主数据库连接。

### 5.2 已实施修复（commit 97088de5）

1. Program.cs 增加 **POST /api/resume**，只在 Vault 已解锁时接受输入的数据库密码；用**独立短时只读 SQLCipher 连接**尝试查询 sqlite_master，确认密码正确。
2. 验证通过返回当前操作令牌和库名，不关闭、不重开、不替换 WinForms 持有的主读写数据库连接。错误密码拒绝访问。
3. app.js 页面初始化先读取 /api/status；已有合法 token 则直接进入；后台库已开但当前页 token 丢失时显示「验证密码并恢复会话」界面，不必再次输入数据库路径；后台库未开才显示普通新建库/打开已有库。
4. 关闭数据库后原 token 失效，后台不允许再直接恢复。
5. 自动 HTTP 冒烟新增「第二个没有 token 的浏览器客户端」：验证未认证不能看记录、错误密码拒绝、正确密码恢复可读原数据、恢复操作不会让原标签失效、关库后旧 token 与恢复通道不可用。

**实际状态：GitHub Windows CI 全部通过；用户还没有在本机明确确认最新恢复功能。** 新会话首选拿用户复测反馈，若有问题，继续直接修复 main。

### 5.3 建议用户执行的最小复测

1. 退出旧 WinForms，拉取最新 main，Visual Studio 重新生成主项目并按 F5；或下载最新成功 CI 构建产物。
2. 在网页正常打开已有测试库，创建一条综合资料记录。
3. **只关闭浏览器标签**，不关闭 WinForms；再点 WinForms 的「打开浏览器管理界面」。
4. 页面应在需要时提示输入当前数据库密码**恢复会话**。先试错误密码被拒绝，再输正确密码，确认能看到原有记录。
5. 同一个标签页刷新后，如果 token 仍有效，应直接保持登录；其它已登录标签不应被恢复操作踢下线。
6. 网页主动「关闭数据库」后，所有先前 token 应失效，重新打开数据库应走正常密码解锁。

**未实现的安全细节**：原型的 /api/resume 恢复成功后会复用全局同一 token，不是每标签独立的令牌；没有完善的密码猜测速率限制、过期与注销管理，正式设计需要评审，不应认为整个认证系统已完成安全审计。

## 六、仓库当前结构与文件职责

~~~text
IPSys/
├── README.md
├── REQUIREMENTS.md
├── M0_DATA_DICTIONARY.md
├── DEVELOPMENT_PLAN.md
├── FREEZE_AUDIT.md
├── DESIGN.md                      # 历史草案，实施前需重构
├── WEB_TESTING.md
├── HANDOFF.md                     # 本交接文件
├── .github/workflows/
│   └── web-windows.yml           # WinForms+网页 Debug/Release 构建/HTTP 测试
└── src/
    └── IPSys.Web/
        ├── IPSys.Web.csproj      # 当前主工程，WinForms+ASP.NET Core+SQLCipher
        ├── Program.cs            # 本地 HTTP API、Vault、Smoke、内嵌资源
        ├── LauncherForm.cs       # GUI 启动器按钮、进程生命周期
        └── wwwroot/
            ├── index.html        # HTML 源码，编译进 EXE
            ├── style.css         # CSS 源码，编译进 EXE
            └── app.js            # JS 源码，编译进 EXE
~~~

目前没有 .sln 文件。**Visual Studio 2022 直接打开 `src/IPSys.Web/IPSys.Web.csproj`**；它是唯一保留的运行工程。用户主要在 Windows VS 中自己编译与拉取测试。

## 七、真实测试证据与版本脉络

| 时间顺序 / Commit | 改动结果 | 自动/人工证据 |
| --- | --- | --- |
| 82ed749d | M0 的 R1–R3 默认字典获确认，R4 已按 CNY 0.00 定义 | 数据字典文档 |
| 03b04cdc / ba7f2c44 | 历史 SQLCipher CLI 文件分块与 Windows 冒烟构建（实验工程已移除，代码在 Git 历史中） | [当时的成功运行记录](https://github.com/zy19970/IPSys/actions/runs/38372112267) |
| 5699bd25 | 最小 ASP.NET Core 网页原型、HTTP SQLCipher 记录/附件 | [CI 38374672235](https://github.com/zy19970/IPSys/actions/runs/38374672235) |
| bcbdb58b / 62791c31 | 从自动打开网页改为 WinForms 启动器；首次编译问题已修复 | [CI 38378877601](https://github.com/zy19970/IPSys/actions/runs/38378877601) |
| 1380abfc | 处理 VS F5 后网页 HTTP 404 缺失资源 | [CI 38380987068](https://github.com/zy19970/IPSys/actions/runs/38380987068) |
| e81ea05d | HTML/CSS/JS 全部编入 EXE，不再复制 wwwroot | [CI 38381885260](https://github.com/zy19970/IPSys/actions/runs/38381885260) |
| **97088de5** | **已打开数据库时，浏览器新标签重新用密码恢复会话** | **[CI 38383820256](https://github.com/zy19970/IPSys/actions/runs/38383820256)** 成功，用户本机待复测 |

**用户手工已确认**：WinForms 能开启本地网页，上传、下载附件成功；用户还曾提供网页正常显示截图。**用户没有确认**：新会话恢复功能最终版、2 GiB+ 文件、异常中断、移动 SSD 故障、完整数据库备份一致性或所有业务模块。

CI 38383820256 在交接时已经是 **completed / success**，包含 Debug/Release 发布、无外部 wwwroot、HTML/CSS/JS、SQLCipher HTTP 记录与文件往返、新标签会话恢复相关自动测试。构建 Artifact 名称为 IPSys-Web-win-x64；GitHub Actions Artifact 并非永久有效下载链接，新的会话以最新成功运行里的包为准。

## 八、在 Windows/Visual Studio 中复现和使用

Visual Studio 2022 需 .NET 8 SDK，建议安装「.NET 桌面开发」和「ASP.NET 和 Web 开发」工作负载。

已有克隆先保护未提交本地修改，再执行：

~~~powershell
git pull origin main
~~~

在 VS 中打开主工程 src/IPSys.Web/IPSys.Web.csproj，选择 Debug，F5 启动 WinForms，点击「打开浏览器管理界面」。新网页源码修改后重新生成主项目即可，无需手工拷贝任何 wwwroot 目录。首次运行从测试文件夹创建加密测试库并上传无敏感文件。

发布自包含 x64 程序：

~~~powershell
dotnet publish .\src\IPSys.Web\IPSys.Web.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o .\out\IPSys-Web
.\out\IPSys-Web\IPSys.Web.exe
~~~

发布结果可能包含其它 Native/.NET 依赖文件，**应保留整个发布包**；现在已消除的是额外复制网页资源的步骤，不是承诺可以删除所有 DLL。程序每次随机选择 localhost 端口，不要写死旧截图的 127.0.0.1:17343。

数据库仅用可丢弃测试库：当前还未完全验证突然拔出 SSD、系统断电、复杂导入任务取消后的库一致性。**不要导入正式敏感文件或在真实库上做破坏性测试**。

## 九、后续开发主线（不要提前宣称已完成）

| 阶段 | 目标 | 当前状态 |
| --- | --- | --- |
| **M0** | 字段/状态字典、Excel 列和实体关系 | **已完成并获确认** |
| **M1** | 真正加密、超 2 GiB 附件、移动 SSD、文件出口、手工备份、退出安全、浏览器交互 | **正在进行**。WinForms+网页最小链路已跑通；关键大文件和故障测试未通过验收 |
| **M2** | 正式系统架构、数据 Schema、索引、事务、API、迁移，重构 DESIGN.md | 未定稿；须根据 M1 实证完成 |
| **M3** | 首条正式稳定业务闭环：记录→附件→搜索→导出→退出 | 原型只覆盖其中部分，不算正式验收 |
| **M4** | 知识产权、项目合同、证书成果等全部业务台账 | 未开始 |
| **M5** | 附件版本、共享与去重、回收站、预览 | 未开始 |
| **M6** | 搜索、Excel 导入导出、目录/ZIP 文件导出 | 未开始 |
| **M7** | 稳定性、安全性、完整发行测试 | 未开始 |

### 下一阶段最合理的优先顺序

1. **P0：最新会话恢复的用户本机复测与必要修复**。若用户反馈通过，再向后推进，不改变 WinForms 生命周期。
2. **P0：WinForms 和网页退出安全**。特别是正在上传/导出时用户点 WinForms X，正式要求有 Q153 三选项「取消任务并退出／完成任务后退出／留在程序」。当前原型未实现这套完整策略。
3. **P0：真正超大文件**。原型网页单文件限制 64 MiB，前端使用 blob 接收下载，不能直接提高大小常量就宣称可支持 >2 GiB。需要端到端流式传输、固定内存验证、Hash 对比、空间不足检测和失败清理。
4. **P0：手工备份、SSD、异常中断**。安全退出后复制数据库，在副本解密并执行完整性校验；测试磁盘写满、强制退出、断连只能用可丢弃测试库。
5. **P0：每次用户选择文件夹的导出机制**。纯浏览器页面有文件系统访问限制，WinForms 可以提供本机选目录能力，需要技术原型验证后形成正式方案。
6. **M2：正式设计**。替换当前临时三张表，落实 M0 字典、工作区隔离、项目合同强制归属、附件版本与共享关系、回收站/数据库迁移；确认 SQLCipher 原生库版本、维护和许可后再开始全面业务开发。

### 已知重要工程风险

1. /api/resume 使用第二个只读 SQLCipher 连接验证密码，返回原有 token。**同一令牌被恢复标签共享，尚无独立多标签会话生命周期**；无充分限流，正式安全设计需进一步加固。
2. 当前 SQLCipher 包 SQLitePCLRaw.bundle_e_sqlcipher 2.1.11 具有历史维护风险。必须评估发行安全、Native 依赖和许可，不能把实验依赖当成最终产品承诺。
3. records/attachments/chunks 是临时 Schema，缺正式版本表与共享引用，不能承诺与未来正式库无损双向兼容。
4. 附件导入中断可能留下 writing 记录，原型过滤未完成附件；回收站、事务统一恢复与半成品清理尚需完善。
5. 复杂大文件任务期间的数据库锁、WinForms 退出及前端浏览器关闭要求明显高于小文件 Smoke 的覆盖能力，不得以 CI 通过作为全场景验收证据。
6. 用户自己承担正式数据安全，任何自动删除源文件前必须满足新有效备份条件。原型默认不删源文件是正确行为。
7. 新开发不要恢复历史已撤销的需求，也不要往仓库里添加多套相互重复的开发计划。

## 十、GitHub 协作和用户偏好

1. GitHub 仓库：https://github.com/zy19970/IPSys，通常目标 main。用户明确表示后续愿意「你做好推送，我在 VS 拉取下来测试」。默认直接提交 main，除非用户要求 PR。
2. 在**每次实质性操作前**重读 https://github.com/zy19970/AIGT-templates/ 的 AGENTS.md 和 AI_RULES/GIT_OPERATIONS.md，核对仓库最新 HEAD、**完整 commit 历史及提交说明**。不要仅凭本交接猜测仓库仍停在旧版本。
3. 优先采用 Git Data API 原子提交：create_blob → create_tree → create_commit → update_ref（force=false，且校验旧 HEAD）。不强推、不覆盖用户未提交的工作。
4. 依 AIGT 通知规范，在 office-renderer/wechat-webhook 仓库以 [notify] Issue 记录开始、失败、重新开始、完成等状态；通知不能替代真实 Git commit 和 CI 结果。
5. 用户希望简单、能直接运行、以 C# / Visual Studio 为主，不要无必要引入新框架。要求准确、不要擅自增加功能，更不希望无休止地问选择题。
6. 文档中应严格区分 **用户实际测试通过**、**Windows CI 自动测试通过**、**尚待测试或未开发**，不把代码写入等同于功能完成。
7. 版本构建产物通过 GitHub Actions Artifact 分发；不要自动把编译产生的 EXE、测试 SQLite 数据库或敏感原件加入 Git 仓库。网页资源已经嵌入程序，无须外置 wwwroot。

## 十一、可直接发送给新会话的启动指令

> 我们继续开发 IPSys，仓库是 https://github.com/zy19970/IPSys。请先读取 main 根目录 HANDOFF.md 和 README.md，然后遵循 https://github.com/zy19970/AIGT-templates/ 的 AGENTS.md 与 AI_RULES/GIT_OPERATIONS.md，检查 main 最新完整提交历史，核对 REQUIREMENTS.md、M0_DATA_DICTIONARY.md、DEVELOPMENT_PLAN.md、WEB_TESTING.md 和当前代码。
>
> 项目已经确定采用 **WinForms 启动器 + 一个按钮打开 Edge/Chrome + ASP.NET Core localhost + SQLCipher 加密 SQLite + HTML/CSS/JS 内嵌 EXE**，不要再改运行形态。M0 已定稿，M1 最小网页和附件上传下载已在我的电脑上实测成功。最新会话管理修复代码基线是 97088de5：关闭浏览器标签后 WinForms 中的库仍保持打开，新网页可输入原密码恢复会话；Windows 自动测试已通过，等待我的本地复测结果。
>
> 请直接根据我的测试反馈推进 M1，并修改、提交 GitHub main、运行 Windows CI；完成 M1 阻断级测试后再定稿 M2 的 DESIGN.md 和正式业务数据库，不要重新逐题访谈或把 M1 原型写成完整的 V1.0 软件。

## 十二、版本证据与最终提醒

**交接时最新代码 SHA**：97088de53b81c783a0c16a40e0dc38ac2fbc8942。

**交接时最新成功 Windows Web CI**：[38383820256](https://github.com/zy19970/IPSys/actions/runs/38383820256)，状态 completed / success，包含 Debug、Release、内嵌网页资源、JS 语法、SQLCipher/HTTP 往返及会话恢复自动测试。

**用户已确认的本机成果**：可以打开网页、上传及下载附件。**尚未获用户确认的最新变更**：会话恢复实机验证。**仍未完成的重点**：2 GiB+、移动 SSD 异常、手工备份一致性、文件夹选择、完整业务模块和正式数据库设计。

新会话请以 GitHub 最新实际 HEAD 为准；这份交接是可追溯的详细快照，不是无需再检查的开发完成证明。
