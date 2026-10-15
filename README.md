# IPSys — 个人与公司资料管理系统

> 当前基线：2026-10-15，`main` 提交 `6c9ae23057`。**V1.0 核心业务功能已接入并通过相应自动回归，当前处于综合实机验收、数据安全专项和发布准备阶段；未宣布 V1.0 正式验收完成。** 本页为现行状态入口，历史修改请查看 Git 提交记录和 [HANDOFF.md](./HANDOFF.md)。

IPSys 面向 Windows 10/11 x64 单用户离线使用，以个人资料、知识产权、项目与原件管理为主，公司资料独立管理。公司和个人工作区在**同一个 SQLCipher 加密 SQLite 文件**内按业务归属隔离；项目、合同、知识产权、证件、成果和其他资料都在加密库中保留结构化记录及原件字节，而非仅保存外部原文件路径。默认先创建业务记录，再归档原件。

## 1. 运行与发布

程序架构为 **WinForms 启动器 → 127.0.0.1 本地 ASP.NET Core 服务 → Edge/Chrome 网页**。网页 HTML、CSS、JavaScript 和离线 PDF.js 均编译进 EXE；关闭浏览器标签页不等于退出宿主，退出 WinForms 或在网页执行安全退出才结束服务。登录默认显示「打开已有资料库」，首次创建入口单独提供；解锁后先选择个人或公司工作区。

Visual Studio 可直接打开 `src/IPSys.Web/IPSys.Web.csproj` 调试。Release 发布为 **仅一个 `IPSys.Web.exe` 的依赖框架单文件包**，不会捆绑 .NET 运行时；目标电脑须预装 **.NET Desktop Runtime 8 x64** 和 **ASP.NET Core Runtime 8 x64**。编译生成的 Debug 目录与便携 Release 发布目录不是同一种交付形式。

```powershell
dotnet publish src/IPSys.Web/IPSys.Web.csproj -c Release -r win-x64 --self-contained false -o .\out\IPSys-SingleExe
```

从 [Windows Actions](https://github.com/zy19970/IPSys/actions/workflows/web-windows.yml) 下载最新成功的 `IPSys-Web-win-x64` Artifact，或自行发布。2026-10-15 的基线 [CI #38673474396](https://github.com/zy19970/IPSys/actions/runs/38673474396) 显示通过。CI 结果不等于用户本机完整验收。

## 2. 当前实现的业务

| 范围 | 已接入的真实能力 | 证据/限制 |
| --- | --- | --- |
| 项目 | 科研、横向、其他项目；增改、软删、复制、跨区转移；合同从属关系 | 公司「公司项目」为统一台账，合同只在项目内新建 |
| 合同 | 关联项目的合同编辑、复制、软删、台账和附件；金额 CNY，显示 `0.00` | 「查看全部合同」是汇总入口，不能独立创建合同 |
| 知识产权 | 七类知识产权、类型状态、基础和扩展字段、增改删复制转移 | 固定字段以 [M0 字典](./M0_DATA_DICTIONARY.md) 为准 |
| 分类档案 | 公司企业资质/业务档案；个人身份与资质/成果与奖励/学术与社会活动；多记录分类台账 | 公司企业资质仅在编辑界面显示名称、附件、备注，附件大小可见于列表 |
| 综合/其他资料 | 独立记录、原件上传下载、版本、回收站 | 公司与个人分别显示对应资料 |
| 原件 | SQLCipher 分块存储、SHA-256、历史版本、同名独立文件、受控共享/复制、软删除恢复、PDF/图片预览 | B05 与 PDF.js 预览已有用户通过反馈 |
| 导出 | 记录/模块附件文件夹、ZIP、项目及全部所属合同一键导出、Excel 固定台账 | 文件夹/ZIP 边界及 Excel 桌面人工验证仍待补 |
| 搜索 | 当前工作区跨模块结构化字段与附件**文件名/元数据**检索、真实详情跳转 | 不检索 PDF/Office 正文、无 OCR |
| MCP | 本机 stdio + 当前用户命名管道，项目/合同/知识产权/附件 14 项工具 | 系统设置中人工授权，默认关闭；需本机 Agent 实测 |
| UI | 个人优先入口、公司五栏目、工作台 3×2、紧凑台账、序号/多选/排序、回收站选中永久删除变红 | 2026-10-15 最后 UI 基线已由 CI 覆盖，仍可做本机视觉验收 |

## 3. 当前已知边界

现行 `BusinessFileStore.MaxFileLength` 为 **64 MiB/单文件**；用户此前的大文件本机场景反馈通过，但未记录确切字节数，**不可视为超过 2 GiB 的验证通过**。文件夹/ZIP 导出使用 Edge/Chrome 的 File System Access API；ZIP 不支持 ZIP64，需小于 4 GiB。Excel 固定模板单文件输入限制 8 MiB、最多 5000 行；合同仅能导出，不能通过 Excel 导入。无论是否复用重复字节，跨公司/个人工作区不得共享同一个物理附件对象。

**数据安全验收尚未全部完成**：磁盘不足、SSD 异常拔出、退出过程、手工备份副本一致性、旧库兼容升级和超大文件的完整往返。密码修改等设置页项目尚有未接入入口。不要将这些项目写成「已支持/已验收」，不要在未取得新有效备份前删除来源文件。

## 4. 下一步与验收状态

1. **综合验收**：在可丢弃 SQLCipher 测试库中逐模块检查 CRUD、复制转移、排序与选中导出，并实机核验 Excel、搜索、MCP、文件夹/ZIP、Edge/Chrome。
2. **数据安全专项**：按 [FREEZE_AUDIT.md](./FREEZE_AUDIT.md) 的 T01–T09 逐项验证，尤其是 64 MiB 限制与目标 2 GiB+ 的差距、SSD 故障、备份与升级。
3. **设计/发布收尾**：将通过/失败/未测记录到 [WEB_TESTING.md](./WEB_TESTING.md)，据实完善 [DESIGN.md](./DESIGN.md)，再决定 V1.0 发布。参见 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)。

## 5. 文档索引（按职责维护）

| 文件 | 唯一职责 |
| --- | --- |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | Q1–Q162 及用户后续明确修订的需求基线 |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | 已确认字段、类型、状态与固定 Excel 列 |
| [UI_BASELINE.md](./UI_BASELINE.md) | 已确认的最新导航、页面与表格交互 |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | 开发进度、剩余阶段与门槛 |
| [DESIGN.md](./DESIGN.md) | 按当前代码归纳的技术设计及未验证边界 |
| [HANDOFF.md](./HANDOFF.md) | 新会话衔接的当前快照、运行与风险 |
| [WEB_TESTING.md](./WEB_TESTING.md) | 人工/自动验收依据及测试记录 |
| [EXCEL_LEDGER.md](./EXCEL_LEDGER.md)、[SEARCH.md](./SEARCH.md)、[MCP_CODEX.md](./MCP_CODEX.md) | 三个专项功能使用及验收说明 |
| [FREEZE_AUDIT.md](./FREEZE_AUDIT.md) | 历史需求冲突与 T01–T09 技术门槛 |

**项目真实代码和最新用户确认优先于历史说明。** 开发以 `main` 为目标分支，遵守 [AIGT-templates](https://github.com/zy19970/AIGT-templates) 的 `AGENTS.md` 与 `AI_RULES/GIT_OPERATIONS.md`。