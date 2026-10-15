# IPSys 跨会话交接（2026-10-15 最新基线）

> 新会话请首先读取 [AIGT-templates/AGENTS.md](https://github.com/zy19970/AIGT-templates/blob/main/AGENTS.md) 与 [GIT_OPERATIONS.md](https://github.com/zy19970/AIGT-templates/blob/main/AI_RULES/GIT_OPERATIONS.md)，然后检查 IPSys 当前 `main` 的真实源码、全部提交历史及最新 Windows CI。本文件以 `6c9ae230579e32c66e2cb04bcb46e4c86a517f97` 为文档同步前基线，不能代替之后的最新 Git 状态。

## 公司业务档案可变层级目录（2026-10-15）

本次确认并开始实施：公司业务档案采用独立 SQLCipher 目录表 archive_folders，business_archives 增加 nullable folder_id。默认七类及历史自定义类别迁移为根目录，不重建已有资料与附件。目录能包含子目录和本级资料，可无限扩展不同深度；旧记录可作为同名下级目录继续细分，原件保留。客户端沿用 realArchiveTable、现有多选/排序/年份/ZIP 下载逻辑，新增目录路径、新建/管理目录和资料所属目录选择器。个人归档及企业资质行为不变。先完成 Windows CI，再由用户本机验证旧库升级和目录操作。

## 最新界面名称与关闭行为（2026-10-15）

面向用户的网页、WinForms 和历史预览界面统一显示「资料管理系统」；IPSys 仅作为仓库和程序集标识。网页右上角「关闭数据库」通过 `POST /api/lock` 释放数据库并返回登录界面，**不会终止 WinForms 或本地服务**；上传任务中拒绝关库。仅 WinForms 的「退出程序」按钮或窗口 X 才能结束应用，文件任务安全退出三选项继续由 WinForms 处理。**旧网页程序退出接口 `POST /api/exit` 已取消**。此前文档及旧会话中“网页安全退出也退出程序”的说明已被覆盖。

## 一、任务与最终产品取向

IPSys 是**以个人资料为核心、公司资料分区管理**的 Windows 单机离线系统。个人和公司使用同一 SQLCipher 加密库的两个隔离工作区。每个附件必须归属于已有业务记录；数据库保存加密的原件内容，不仅是本机磁盘路径。

用户的重点是能长期管理项目、所属合同、七类知识产权、资质/证件、业务档案、个人成果/学术兼职及综合资料，完成实际增删改复制转移、原件管理、搜索、选件导出，同时允许本机 Agent 经 MCP 操作。**不要提出重复需求访谈或擅自恢复被撤销的自动提醒、多公司、材料清单、自动备份、正文 OCR 等功能。**

## 二、当前技术运行基线

| 层次 | 文件/实现 | 现状 |
| --- | --- | --- |
| WinForms 宿主 | `LauncherForm.cs` | 用户点击按钮打开 Edge/Chrome，本地服务仅监听 `127.0.0.1`，关闭浏览器不关闭程序 |
| Web/API | `Program.cs` | ASP.NET Core、本机临时端口、Host/Origin 校验、数据库认证 Token、会话恢复、安全退出、SQLCipher 冒烟 |
| 数据库 | `Program.cs` 的 `Vault`、多个 `*Store.cs` | SQLCipher 真实加密，项目/合同/IP/档案/综合资料真实业务表，原件分块存入库 |
| 主前端 | `wwwroot/index.html`、`app.js`、`style.css` | HTML/CSS/JS 作为程序集资源内嵌；`demo/ui-preview.html` 是旧预览参考 |
| 原件 | `BusinessFiles.cs`、`GeneralStore.cs`、`RecycleStore.cs` | SHA-256、同名/版本、关联共享、回收站恢复与永久清理，B05 用户所测范围已确认 |
| PDF | `pdf-preview.js` + 离线 `pdfjs/` | 完全替换失败的浏览器 iframe，Canvas 翻页缩放，用户反馈修复成功 |
| 导出 | `export.js` | Edge/Chrome 目录或 ZIP，项目连同所有所属合同原件直接导出 |
| Excel/搜索 | `ExcelLedger.cs`、`SearchStore.cs`、前端入口 | P1 两批和 P2 均已接入并经相应自动回归 |
| MCP | `McpLocal.cs`、`MCP_CODEX.md` | 同 EXE `--mcp`、当前用户管道、14 项工具、默认需用户在系统设置手动启用 |
| CI/发行 | `.github/workflows/web-windows.yml` | Debug + Release、SQLCipher HTTP、Node UI/导出/PDF、MCP stdio/管道测试；Release 单个 EXE、依赖外置 .NET 8 两类运行时 |

2026-10-15 最近源码基线 `6c9ae23057` 对应 [Actions #38673474396](https://github.com/zy19970/IPSys/actions/runs/38673474396) 成功。运行库需要 Windows x64 的 `Microsoft.WindowsDesktop.App 8.0.x` 和 `Microsoft.AspNetCore.App 8.0.x`。Visual Studio 可直接生成；不要把 Debug 多文件目录冒充发布包。

## 三、确定的业务及界面规则

1. 公司侧栏：工作台、企业资质、业务档案、公司项目、知识产权、综合资料。公司项目统一显示科研/横向/其他类别，全部合同经公司项目页进入，只能从所属项目详情创建合同。
2. 个人侧栏：个人工作台、身份与资质、知识产权与著作、科研与合作项目、成果与奖励、学术与社会活动、其他资料。个人优先展示；个人分类档案使用「类别卡片 → 多记录台账 → 记录详情」。
3. 公司业务档案默认七类：申报与认定、规划与管理、汇报与宣传、会议与活动、专项工作与合作、政策与行业资料、其他业务资料，旧 company/achievement 记录仍要保留。
4. 公司企业资质直接进入列表，编辑仅呈现名称（必填）、附件（选填）、备注（选填）；表格提供附件数量、最新附件大小和直接下载。既有 `category/tags` 旧字段不应因页面隐藏而丢失。
5. 最新 2026-10-15 UI：工作台 3×2 简洁入口；全部业务页移除额外的顶部面包屑行；台账紧凑工具栏和表头统一；项目类型置于序号与长项目名称之间；长 IP/项目名称优先扩展；分类表头/列宽统一；批量勾选、序号与持久排序；回收站有选中项时批量永久删除变红。
6. 导出：项目列表或详情一键导出项目及其全部合同有效附件，无需二次逐项选择；其它模块按当前勾选/筛选记录或附件导出。文件夹/ZIP 分开于 XLSX 结构化台账。历史版本在详情中显式选择。
7. 知识产权七类型、项目三类型、合同金额 CNY `0.00` 与空值不同等模型约束均以 [M0](./M0_DATA_DICTIONARY.md) 为准。业务删除通常进入回收站，永久清理另需确认。

## 四、哪些真正通过，哪些仍然待验收

**已有用户实机确认**：最初 WinForms 网页可上传/下载；B05 所测附件生命周期；PDF.js 预览修复；用户所测大文件场景无异常（没有提供确切大小）。

**源码和自动回归已通过但未独立完成人工验收**：B06 文件夹/ZIP 边界导出、P1 Excel 两批桌面 Excel、P2 统一搜索真实浏览器、Codex MCP 完整日常交互、最近一轮 UI 细节。

**不能声称已完成**：超过 2 GiB 的原件导入/导出、移动 SSD 异常拔出、磁盘耗尽、手工复制备份恢复闭环、兼容升级矩阵、密码修改入口、V1.0 正式发布验收。目前单文件上限仍为 **64 MiB**；ZIP 不支持 ZIP64（小于 4 GiB），Excel 输入 8 MiB/5000 行；不检索 PDF/Office 正文。

## 五、下一次开发从哪里开始

**最优先是 V1.0 综合验收而非继续拓展功能。** 按 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) 的 A→B→C 顺序，在可丢弃 SQLCipher 库完成全模块数据往返/工作区隔离、UI、导出、Excel、搜索、MCP 的实机矩阵；随后做 T01–T09 数据安全/升级/备份专项；最后据结果决定发布。详细操作顺序见 [WEB_TESTING.md](./WEB_TESTING.md)。

处理缺陷时只修改影响文件并增加回归用例；正常默认直接推送 `main`，不为安全感额外建分支或 PR。每一项完成都要核查 Git 实际 ref 和 Actions 结果。用户明确要求操作时可直接进行代码修改，不再重复询问已经冻结的设计选项。

## 六、文件与历史入口

当前项目入口 [README](./README.md)，需求 [REQUIREMENTS](./REQUIREMENTS.md)，字段 [M0](./M0_DATA_DICTIONARY.md)，最新 UI [UI_BASELINE](./UI_BASELINE.md)，现行结构 [DESIGN](./DESIGN.md)，执行计划 [DEVELOPMENT_PLAN](./DEVELOPMENT_PLAN.md)，验收 [WEB_TESTING](./WEB_TESTING.md)，专项 [Excel](./EXCEL_LEDGER.md) / [Search](./SEARCH.md) / [MCP](./MCP_CODEX.md)。旧版跨平台探索方案、旧阶段进度与界面预览保存在 Git 历史或 `demo/ui-preview.html`，不要当成当下已批准的工作项。