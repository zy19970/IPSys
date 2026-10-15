# IPSys 统一资源内核重构：R0-02 回归与差异矩阵

> 编制：2026-10-15；审查的源码基线为重构方案之前的 `main@0b70bbe4`，其后仅增加方案 Markdown 与 README。此表是**用例与现状盘点**，不代表本次已经运行 Windows 实机测试，也不代表目标功能已经实现。
> 
> 权威目标与逐步计划见 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)，界面约束见 [UI_BASELINE.md](./UI_BASELINE.md)，历史 Windows 安全/旧库验收见 [WEB_TESTING.md](./WEB_TESTING.md)。

## 一、现有自动化入口和验证证据级别

| 来源 | 现有路径和检查内容 | 对本次重构的作用 |
| --- | --- | --- |
| Windows CI | `.github/workflows/web-windows.yml` | Debug 编译、SQLCipher HTTP 冒烟、Release 单 EXE、MCP stdio、Node 前端/导出/PDF；改动 C#/JS 时自动触发 |
| 真实 SQLCipher HTTP 集成 | `src/IPSys.Web/Program.cs` 中的 `WebSmoke` 与 `SearchSmoke.cs` | 创建、列表、业务 CRUD、附件上传/版本/去重、回收站、工作区搜索、Excel/MCP 与部分权限用例 |
| UI 冒烟 | `src/IPSys.Web/tests/ui-main-smoke.cjs` | 现有目录/资料混合表格、选择、布局、表单和 UI 字符串/模拟交互，部分依赖源码片段 |
| ZIP 与目录导出 | `src/IPSys.Web/tests/export-smoke.cjs` | 模拟 File System Access API、冲突、安全命名、流式 ZIP、取消 |
| 搜索 UI | `src/IPSys.Web/tests/search-smoke.cjs` | 当前工作区 API、真实结果导航、HTML 转义、过期结果 |
| PDF/预览 | `src/IPSys.Web/tests/pdf-canvas-smoke.cjs` 和 `preview-smoke.cjs` | 离线 PDF.js Canvas 预览，不允许重构后回退到浏览器 iframe |
| 现行基线成功 CI | `https://github.com/zy19970/IPSys/actions/runs/38707956606` | 仅为原源码版本的历史 CI 证据；**本轮未重新运行**，不得当作重构测试通过 |

当前 `main` 仅比上述最后源码提交多文档变更。R0-03 拆分源码后必须以**新提交自己的 CI**及差异核查为判定，不复用历史绿灯。

## 二、关键行为逐项对照

状态用词：**现有覆盖**＝已找到对应现有测试路径（本轮未实际重跑）；**部分覆盖**＝真实能力存在但新需求或边界未完整测试；**待实现**＝目标尚未具备；**待实机**＝需 Windows/真实库手工验收。

| 编号 | 场景与期望 | 当前情况 | 下一步需要的回归证据 |
| --- | --- | --- | --- |
| F01 | 所有模块读取统一 Folder 身份，`workspace+kind+section+id` 不串号 | **已覆盖只读后端与真实 HTTP**：项目/合同/IP [CI #38729428320](https://github.com/zy19970/IPSys/actions/runs/38729428320)、目录/归档/综合 [CI #38730348327](https://github.com/zy19970/IPSys/actions/runs/38730348327)、统一树导航及 HTTP [CI #38731911752](https://github.com/zy19970/IPSys/actions/runs/38731911752) 均 success；冻结的前端展示仍调用旧接口 | R1-04-02/03 继续逐类接入统一写接口与旧 API 适配；R3 再切换公共前端，不能因只读 API 通过就宣称整体资源管理器已重构完成 |
| F02 | 项目可以无合同；合同仅挂唯一合法项目，复制/移动不失关联 | **公共 CRUD/复制转移已验证**：R1-04-02 [CI #38733267975](https://github.com/zy19970/IPSys/actions/runs/38733267975) 验证合同创建必须合法父级；R1-04-03-01 [CI #38737211398](https://github.com/zy19970/IPSys/actions/runs/38737211398) 验证项目同区复制、跨工作区迁移时两份同编号合同都重新关联目标项目，旧合同单独跨区转移被拒绝且其附件版本保留 | R1-04-03-02 仍需测试归档目录成环、资料目标类别；项目/合同更广泛的任意目录迁移不应擅自开放 |
| F03 | 公司业务档案根分类只导航、自建空类别可删；内层目录/资料混排排序 | **已有统一读写覆盖**：原有 UI smoke 和目录/资料 Store，R1-04-01 [CI #38731911752](https://github.com/zy19970/IPSys/actions/runs/38731911752) 验证统一混排树浏览，R1-04-02-02 [CI #38734563500](https://github.com/zy19970/IPSys/actions/runs/38734563500) 验证系统根保护、空目录删除及资料软删恢复 | R1-04-03 验证真正的统一移动/排序写接口；R3 再接公共前端 |
| F04 | 同工作区共享**同一逻辑文件**，上传 v2 两处见新版，一处解绑后 v3 不复活 | **部分覆盖**：`BusinessFileStore.Associate`、`group_id`/版本逻辑 | R2 增加跨 Folder FileId、解除关联和历史一致性测试 |
| F05 | 两个独立 FileId 内容相同时可只共享加密字节，属性和版本各自独立 | **部分覆盖**：`BusinessFileStore.Finish` 的 hash/size 用户指定复用 | R2 对比 FileId、版本、FileObject 与跨区复制 |
| F06 | 内容相同但名称不同，也显示已有文件名和所在文件夹，让用户三选一或取消 | **待实现**：现有选项不等于先查重再弹窗 | R2 模拟内容检测/提示、三种决定、取消暂存清理 |
| F07 | 版本只属于 File；Folder 改名/金额编辑不产生版本；历史 FileVersion 原件不丢 | **部分覆盖**：现有原件版本及 R1-04-03-01 [CI #38737211398](https://github.com/zy19970/IPSys/actions/runs/38737211398) 已核对项目/合同/IP 复制与跨工作区转移后的版本号、完整原件字节和 SHA-256；没有给 Folder 建版本记录 | R2 新统一 FileId/FileVersion 模型继续验证 Folder 元数据更新不创建 FileVersion，以及共享逻辑文件的版本同步 |
| F08 | 只选文件可上传；说明/标签/编号/日期与版本说明全选填、以后可补 | **待实现**：系统级可选 File 属性尚未统一 | R2 测试空元数据、补充、共享 FileId 同步/内容复用独立 |
| F09 | 附件按自己名称、选填属性、直属/祖先 Folder 的业务属性能被搜索 | **部分覆盖**：`SearchStore` 已检索当前记录/附件名 | R2/R3 增加祖先字段、可选属性、权限、跳转测试 |
| F10 | 仅解除一个 FolderFileLink，不能删掉别处文件及需要保留的版本字节 | **部分覆盖**：已有业务链接及回收站逻辑 | R2 关联计数/恢复/永久清理压力测试 |
| F11 | 公司/个人不可共享同一 FileObject，旧记录跨区复制仍保持独立 | **现有覆盖**：旧附件 clone 与 HTTP 检验 | R2 共享/去重及 R4 迁移后再次确认对象 ID/哈希 |
| F12 | 默认文件导出仅最新有效版本，选历史才导出旧版本 | **存在需修正风险**：`BusinessFileStore.List` 返回全部有效版本，前端部分调用可能直接全量导出 | R0 登记对比场景，R3 测试同组 v1/v2/v3 的项目/IP/档案及 ZIP |
| F13 | 勾选父目录和子项按目标目录导出，不错误重复；共享文件在不同目录分别出现 | **部分覆盖**：`export-smoke.cjs`、业务档案 UI smoke | R3 加重叠文件夹/相同 FileId 不同路径、同名与取消用例 |
| F14 | Excel 固定列、MCP 原接口、PDF Canvas、单 EXE 嵌入网页不回归 | **现有覆盖**：Windows CI 和 Node smoke | 每次源码变更运行适用 CI，R3/R4 做实机补充 |
| F15 | 公司业务档案删除空目录时，软删除资料/回收站关系判定正确 | **部分覆盖**：`ArchiveFolderStore.DeleteEmpty` 仍需复核 | R1 构造含回收站资料的真实库测试，再决定是否改动 |
| F16 | 旧综合资料 `attachments/chunks` 迁移到统一 File/版本，失败可中断恢复 | **待实现**：已有旧表版本补丁，不是统一文件体系 | R2/R4 用可丢弃旧库逐项对照 SHA、版本和恢复 |
| F17 | SQLCipher 错密、防越权、突然退出、磁盘空间不足、手工备份不破坏数据 | **部分覆盖/待实机**：安全 CI 不等于故障注入 | R4 遵循 `FREEZE_AUDIT.md` T01–T09 的可恢复性门槛 |

## 三、R0-03 可以开始的前提

R0-02 的**用例盘点和现有/目标差异登记已完成**。尚未执行新 CI，未来功能对应的新行为测试要在 R1–R4 分批增加，不能一口气启用并造成旧代码 CI 假失败。

R0-03 的首个小任务推荐**只从 `Program.cs` 抽出 `WebSmoke` 为独立的 `WebSmoke.cs`**，保持类名、路由、SQL、HTTP 报文和方法体不变；仅补齐相同 using。再在对应 Windows CI 的新提交中核对 Debug、Release、HTTP/SQLCipher、MCP 和单 EXE；CI 未完成前不能在主计划中声称 R0-03 已通过。

R0-03 第二步才考虑提取 `ProjectStore`/`Vault` 与端点注册。涉及 `wwwroot/app.js` 的拆分要先识别依赖字符串的 UI smoke 断言，逐步用行为验证取代静态源码包含检查。

## 四、测试执行模板（每次填写，不预先编造结果）

`提交：<sha>；测试：<命令或 Windows Actions URL>；测试环境：<Windows 版本/运行时>；结果：通过 / 失败 / 未运行；覆盖编号：Fxx；已知差异：<内容>；回退：<可用 git commit>`。

每个重构子任务在主方案进度表登记 commit 和 CI；本矩阵作为逐项验证的固定编号。目标功能落地后再将对应条目标记为有自动化覆盖/实机通过。

**本轮结果仅为 R0-02 用例矩阵编制和源码静态核对，没有新 CI、没有用户真实库升级，也没有把待实现能力写成已通过。**

## 2026-10-15 新库方向更新

用户确认旧库只有测试数据，无需迁移或兼容。F01–F17 测试目标继续保留，但旧表迁移与断点恢复检查不再作为新库交付门槛。新增 N1：新 SQLCipher v2 Folders/Files/FileVersions/FileObjects/FolderFileLinks 外键、工作区隔离、父级防环及系统根保护；N2/N3 按新物理库直接读写，全量 API/MCP/Excel/前端验证后再淘汰旧 Store。


N1 验收：[Windows CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) success。已通过的只是新库真实 SQLCipher 资源关系约束与封存原件不可变保护；F01–F17 原业务切换、新共享文件工作流和搜索/导出仍按 N2～N4 继续验收。