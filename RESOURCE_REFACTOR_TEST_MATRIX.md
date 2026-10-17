# IPSys 统一资源内核重构：R0-02 回归与差异矩阵

> **MCP 第二批业务接口自动验收（2026-10-17）**：`6f8aede` / [Windows CI #38989490476](https://github.com/zy19970/IPSys/actions/runs/38989490476) **completed/success**，新增合同复制、文件反向链接、移动业务目录、混排及项目/合同/档案排序回归（真实 SQLCipher/命名管道）。不同 Windows 用户、跨提权 WorkBuddy、并发长文件与故障注入仍为实机待测。
>
> **新增 MCP 专项验收（2026-10-17）**：`30ce4a1` / [Windows CI #38988662134](https://github.com/zy19970/IPSys/actions/runs/38988662134) **completed/success**，新增管道首报文超时/八路饱和恢复、登录会话隔离和 404 失败日志重放自动回归；MIC 跨权限、真实多登录用户、长任务故障注入仍需实机。
>
> **现行用法（2026-10-17）**：N2-04 V2 全业务与 N4 旧 Schema/源码清理已通过 Windows CI；MCP P0 及三批安全、分页和 14 项业务工具补齐亦已自动验收，最新业务代码 `080a599` 对应 [CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) **completed/success**。F01–F17 继续保留核心 Folder/File 行为检查，MCP 新能力实测按 [WEB_TESTING.md](./WEB_TESTING.md) 专项矩阵推进；Edge/Chrome、Codex/WorkBuddy、2 GiB+ 与 T01–T09 仍待用户实机。
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
| N4 两批旧实现收敛 + MCP 最新业务 CI | [N4 CI #38911635273](https://github.com/zy19970/IPSys/actions/runs/38911635273)、[CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) | N4 删除 31 份旧源码、恢复 V2 共用 DTO；MCP 近期合同编辑、文件历史/下载、共享及关联、转移/搜索/回收站、stdio/SQLCipher 回归通过；未覆盖大数据库定量压测与 Windows 用户实机故障注入 |

当前最新通过自动回归的**业务源码**为 `080a599`（[CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) completed/success），之后 `7b7c714` 为验收文档同步提交。N4 首批/二批裁剪对应的早期源码与失败记录已保留于提交历史；测试矩阵不再把已经删除的 Store 当作待开发项。新改代码须单独留证；自动回归不能替代真实 Edge/Chrome、Codex/WorkBuddy 和 T01–T09。

**MCP 最新专项自动证据**：并发/单实例 [CI #38917944549](https://github.com/zy19970/IPSys/actions/runs/38917944549)，写入可靠性 [CI #38923795350](https://github.com/zy19970/IPSys/actions/runs/38923795350)，单 SQL 文件查询和分页 [CI #38927263017](https://github.com/zy19970/IPSys/actions/runs/38927263017)，第三批业务工具扩充 [CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431)；不代表同机器 Codex + WorkBuddy 实机、MCP 任务结果丢失或数据库崩溃实验已通过。

## 二、关键行为逐项对照

状态用词：**现有覆盖**＝已找到对应现有测试路径（本轮未实际重跑）；**部分覆盖**＝真实能力存在但新需求或边界未完整测试；**待实现**＝目标尚未具备；**待实机**＝需 Windows/真实库手工验收。

| 编号 | 场景与期望 | 当前情况 | 下一步需要的回归证据 |
| --- | --- | --- | --- |
| F01 | Folder 身份及工作区/类型/ID 不串号 | 全部正式业务、MCP/Excel/搜索和 `--smoke` 已统一 V2 FolderId/FileId/LinkId，新库不建旧业务表，[Windows CI #38905217041](https://github.com/zy19970/IPSys/actions/runs/38905217041) success | 旧源码已经裁剪，继续人工核对跨模块 ID、权限及工作区隔离 |
| F02 | 项目可无合同；合同必须归属有效唯一项目，复制/移动不失关系 | 项目合同父子约束及全项目携多个合同/历史原件复制已通过 [CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379) | N4 实机检查跨工作区复制/移动、软删与恢复完整关系 |
| F03 | 公司业务档案根层分类卡片，内层目录/资料混排及保护 | 公司业务档案根卡片、深层混排、V2 网页/附件及导出已通过 [CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) | N4 实机验证排序、递归下载和目录删除保护 |
| F04 | 同一 FileId 多 Folder 共享版本，解除一处后不让新版复活链接 | 原生 FileLink 关联/解绑和全业务 V2 原子共享移动已通过对应 Windows CI | N4 实机验证各位置版本同步、解绑不复活和恢复 |
| F05 | 不同 FileId 可复用同一 FileObject 字节但属性/版本独立 | 独立 FileId 复用 FileObject/跨区物理独立已通过原生 CI，正式全业务上传接 V2 | N4 人工检验复用选项、独立历史及取消回滚 |
| F06 | 异名同内容匹配、已有名称/路径提示，三选一或取消 | 原生异名同内容查重、用户明确选择和全模块网页 V2 自动回归通过 | N4 实机检验提示名称/路径、取消清理及票据失效 |
| F07 | 版本只属于 File；Folder 改名/金额编辑不产生版本；历史 FileVersion 原件不丢 | **V2 N3-01 部分覆盖**：原生 File v1/v2、文件元数据编辑不产生新版本、历史原名/真实字节与 SHA-256 往返 [CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 通过；共享版本同步已通过 N3-02 CI | N4 验证 UI/导出历史版本 |
| F08 | 文件说明/标签/编号/日期及版本说明选填，上传后可补 | N3-01 原生 File 元数据已通过 [CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418)；现有 IP、项目合同网页原件/历史版本已接入，MCP `update_file_metadata` 已经通过业务自动回归；选填属性完整 UI 编辑交互仍待验收 | N4 专项验证文件选填属性的 UI 和共享属性同步 |
| F09 | 附件按自己名称、选填属性、直属/祖先 Folder 的业务属性能被搜索 | `SearchStore` V2 已检索可选 File 属性、相关 Folder 业务属性及公司档案祖先路径，[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) success | N4 Edge/Chrome 搜索跳转、权限、无效结果验收 |
| F10 | 仅解除一个 FolderFileLink，不能删掉别处文件及需要保留的版本字节 | **V2 后端 CI 已通过**：[Windows #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) 已验证单条软解绑、最后链接移除后历史字节完整且可显式恢复 | N4 仍需测试完整回收站 UI 和永久清理引用安全 |
| F11 | 公司/个人不可共享同一 FileObject，跨区复制应保留独立物理内容对象 | **V2 原生后端已验证**：[CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581) 验证跨区复用请求被拒绝、跨区复制分配新 FileObject、所有有效版本原件 SHA-256/字节一致 | MCP 项目/IP/档案/综合资料跨区完整历史复制已通过最新业务自动回归，真实 UI/Excel 与故障注入仍待实机 |
| F12 | 默认仅导出最新有效文件版本；显式选历史才带旧版本 | 全模块 `export.js` 已固定 FileId+FileVersion、最新/历史版本选择，[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) success | N4 测 v1/v2/v3、目录重叠、同名、取消及损坏/缺失 |
| F13 | 勾选父目录和子项按目标目录导出，不错误重复；共享文件在不同目录分别出现 | 原生档案目录与资料混排导出/Node ZIP 通过 [CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886)，复杂重叠未完全实机 | N4 加测父子重叠/多位置共享/同名/取消 |
| F14 | Excel 固定列、MCP 原名与 11 个 `v2_*`、PDF.js Canvas、单 EXE 不回归 | 最新 MCP 14 项业务工具扩充在 `080a599` / [CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) 验证，Windows Debug/Release、正式 stdio、SQLCipher/HTTP、Node 全通过 | 真实 Codex/WorkBuddy 工具加载、双 Agent/长任务/故障注入和桌面 Excel 仍需人工验收 |
| F15 | 公司业务档案删除空目录时，软删除资料/回收站关系判定正确 | V2 `NativeArchiveStore` 目录删除保护、原生 `RecycleStore` 和 V2 综合 SQLCipher 回归在 [Windows CI #38905217041](https://github.com/zy19970/IPSys/actions/runs/38905217041) success | N4 已移除旧 ArchiveFolderStore；深层目录与回收站误操作、真实恢复体验仍需实机 |
| F16 | 综合资料在 V2 中直接通过 FolderFileLink 关联 File/版本，删除/恢复和文件对象引用安全 | 新建资料库已不创建 records/attachments/chunks，V2 FolderFileLink 及回收站/原件版本综合回归经过 [Windows CI #38905217041](https://github.com/zy19970/IPSys/actions/runs/38905217041) | 旧 Store 已清除，MCP 文件关联恢复/跨区完整复制自动通过；用户实机需复测原件历史 |
| F17 | SQLCipher 错密、权限、异常退出、磁盘不足及手工备份完整性 | 部分专项 CI 已通过，故障注入与全量实机尚未完成 | N4 按 `FREEZE_AUDIT.md` T01–T09 执行，不做旧库迁移专项 |

## 三、R0-03 历史执行前提（已经完成，并非当前入口）

以下是当时制定 R0-02 后的历史推进建议。R0/R1 已有相应独立 CI，后续不得按这里的旧步骤再次开始重构 Program；未完成的新 File 与前端行为按 N3/N2-03/N4 分批实施。

R0-03 的首个小任务推荐**只从 `Program.cs` 抽出 `WebSmoke` 为独立的 `WebSmoke.cs`**，保持类名、路由、SQL、HTTP 报文和方法体不变；仅补齐相同 using。再在对应 Windows CI 的新提交中核对 Debug、Release、HTTP/SQLCipher、MCP 和单 EXE；CI 未完成前不能在主计划中声称 R0-03 已通过。

R0-03 第二步才考虑提取 `ProjectStore`/`Vault` 与端点注册。涉及 `wwwroot/app.js` 的拆分要先识别依赖字符串的 UI smoke 断言，逐步用行为验证取代静态源码包含检查。

## 四、测试执行模板（每次填写，不预先编造结果）

`提交：<sha>；测试：<命令或 Windows Actions URL>；测试环境：<Windows 版本/运行时>；结果：通过 / 失败 / 未运行；覆盖编号：Fxx；已知差异：<内容>；回退：<可用 git commit>`。

每个重构子任务在主方案进度表登记 commit 和 CI；本矩阵作为逐项验证的固定编号。目标功能落地后再将对应条目标记为有自动化覆盖/实机通过。

**本轮结果仅为 R0-02 用例矩阵编制和源码静态核对，没有新 CI、没有用户真实库升级，也没有把待实现能力写成已通过。**

## 2026-10-15 新库方向更新

用户确认旧库只有测试数据，无需迁移或兼容。F01–F17 测试目标继续保留，但旧表迁移与断点恢复检查不再作为新库交付门槛。新增 N1：新 SQLCipher v2 Folders/Files/FileVersions/FileObjects/FolderFileLinks 外键、工作区隔离、父级防环及系统根保护；N2/N3 按新物理库直接读写，全量 API/MCP/Excel/前端验证后再淘汰旧 Store。


N1 验收：[Windows CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) success。已通过的只是新库真实 SQLCipher 资源关系约束与封存原件不可变保护；F01–F17 原业务切换、新共享文件工作流和搜索/导出仍按 N2～N4 继续验收。

## N2-01 原生 Folder 验收（2026-10-15）

[Windows CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) success，原生 `/api/v2/folders` 项目/合同/IP HTTP 在临时真实 SQLCipher v2 库上通过：公司/个人隔离、必须有效项目才能创建合同、项目删除时隐藏其合同、项目恢复后合同可再读取，以及新版存储不向旧 `business_projects` 表双写。本项仅验证新原生入口；旧业务 API、MCP、Excel、业务文件归属和原页面切换仍按 N2-02/N2-03/N3 继续实施。


## N2-02 原生业务档案与综合资料验收（2026-10-15）

> **N2-02 阶段当时的后续安排（历史）**：N3-01/N3-02 已通过 CI，N3-04 查重选项及取消清理已通过 CI；随后实施 N2-03 旧业务 API/MCP/Excel 改为唯一 V2 存储，再做 N4 UI/搜索/导出/回收站。F04–F13、F16 等涉及新文件层的测试仍是未完成目标，不能因 N1 的 Schema 约束测试或旧业务功能通过而提前记为全项通过。

[Windows CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) success；[功能提交 340102b3](https://github.com/zy19970/IPSys/commit/340102b3cb6e28a1f8882236115bc7e82beb874c)，[边界收尾 265123fb](https://github.com/zy19970/IPSys/commit/265123fb15124ee04d73f338997d3d423088a91f)。真实临时 SQLCipher v2 HTTP 回归覆盖七个公司业务档案系统根、目录/资料混排持久排序及陈旧列表重排拒绝、任意层级目录与成环移动拒绝、目录非空拒删与空目录删除不可恢复、档案/综合资料软删恢复、公司/个人及 section 隔离、业务档案资料禁止移至无分类虚拟根，以及原生接口不向旧表双写。此项只证明原生 Folder 业务层；旧 UI、附件、MCP、Excel 及搜索仍需 N2-03/N3/N4 统一接入。

## N3-01 原生 File 基础层验收（2026-10-15）

[提交 78e33d55](https://github.com/zy19970/IPSys/commit/78e33d5544d8435cc216820bd1fbe471e9439c14)、[Windows CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) **success**。原生 `/api/v2/files` 支持已授权工作区中的有效 Folder 初始归属、File 选填属性/更新、单个逻辑 File 多版本、原始文件名/版本说明及历史下载；新原件按 SQLCipher 块存储，校验实际大小和 SHA-256 后与版本、初始链接原子提交。HTTP 及独立临时加密库测试覆盖未认证、无有效 Folder、跨工作区访问拒绝，多块真实字节往返、v1/v2 保留、编辑属性不产生版本、短输入/取消回滚和重新打开。尚未支持 N3-02 的多位置动态关联、N3-03 的自动/人工内容对象复用、N3-04 的查重提示三选一；64 MiB 现有限制仍在，用户本机新库实测未单独完成。

## N3-02 原生 FolderFileLink 验收（2026-10-15）

[源码 c0b15a18](https://github.com/zy19970/IPSys/commit/c0b15a180e595883b511448d95cb77e6a90fd4af) 与 [Windows CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) **success**。新原生关联接口实现同区多 Folder 共享 FileId、单独解除与恢复、有效关联列表及原 Folder 包含已解除关联列表。真实 SQLCipher 测试验证文件身份、历史版本、加密对象/字节不随关联操作销毁；HTTP 测试验证 Token、工作区和目录隔离、重复关联拒绝、两处新版同步、解除后新版本不自动重现、完整解除后主动恢复。N3-03 内容字节复用和 N3-04 查重用户选择尚待开发。

## N3-03 独立 FileId 仅内容复用与跨区物理隔离验收（2026-10-15）

[功能提交 944312d0](https://github.com/zy19970/IPSys/commit/944312d08f80d6baac7ab7fc614942441bfa880f)、[Windows CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581) **success**。新原生复制接口按明确模式创建独立 FileId、独立 FileVersion/属性：同一工作区 `reuse-content` 保留原 FileObject ID、只增加文件身份与版本；`independent-content` 为所有有效历史版本独立写入新加密原件块，跨公司/个人只允许此模式。真实 SQLCipher/HTTP 自动测试比较工作区、FileId、FileObject 数量与 ID、版本/元数据独立性、SHA-256 和实际原件字节，并检查权限、目标归属、跨区复用拒绝、取消事务无残留。该批没有内容哈希查重列表/异名提醒及用户三选一，仍由 N3-04 实现。

## N3-04 内容查重与用户决策原生验收（2026-10-16）

[功能提交 93be896f](https://github.com/zy19970/IPSys/commit/93be896f4c0d26b0bfedb64c8c766069924a77f4) 与 [Windows CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) **success**。新原生 `/api/v2/files/{workspace}/prepare` 在 SQLCipher 暂存 writing 原件并按大小与 SHA-256 查询同区有效文件最新版；显示已有 FileId、文件名和 Folder 完整父级路径，支持不同名称命中，同名不同内容不可误命中。`/prepared/{ticket}/resolve` 必须明确选择引用同一 FileId、创建独立 FileId 只复用原件或完全独立保存；取消端点删除 writing 分块。SQLCipher/HTTP 测试覆盖令牌一次性消费、鉴权、工作区隔离、冲突、回滚、关闭/重开清理及原件字节。30 分钟过期、每数据库会话仅一项已确认 CI 成功。**此项仅为原生 HTTP/Store；现有网页的选择弹窗、MCP/Excel 和所有旧业务附件入口仍待 N2-03/N4 切换。**

## N2-03-01 原生 V2 本机 MCP 第一批（2026-10-16）

[源码提交 3e7ba60a](https://github.com/zy19970/IPSys/commit/3e7ba60aad3fa1043f098178c3312e423873f745)、[Windows CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366) **success**。新增 V2 命名 `v2_*` 11 项业务 CRUD，通过同一用户本机命名管道与原授权令牌访问 `/api/v2/folders`，真实 SQLCipher/HTTP 回归检查项目与合同合法父级、知识产权属性更新、跨区修改拒绝、删除/恢复、旧表不双写；保留旧 14 项工具与 UI 过渡期兼容，不将它们标记为已迁移。**下一批 N2-03-02 需要让旧项目/合同/IP HTTP/附件、旧 MCP 命名及 Excel 逐模块接入同一 V2 数据源，避免业务与附件两套身份混用。**

## N2-03-02 知识产权 FolderId 与附件 FileId 垂直闭环（2026-10-16）

[功能提交 e88b1b82](https://github.com/zy19970/IPSys/commit/e88b1b8256731a1f95dfeda6f6e00cd61b7aff76)、[测试构造修复 02c45ece](https://github.com/zy19970/IPSys/commit/02c45ece23863935098e80567e2e055922fd0e7b)，最终 [Windows CI #38824119576](https://github.com/zy19970/IPSys/actions/runs/38824119576) **success**。`NativeIpFileStore` 和 `NativeIpFileEndpoints` 在原生 V2 `folders.kind=ip` 的实际业务 FolderId 上接入 `files/file_versions/file_objects/file_chunks/folder_file_links`，提供上传/分类、列表、原件详情、追加与下载历史版本、复用同 FileId、单条解绑与恢复。SQLCipher HTTP 回归验证有效 IP 父级、材料类别、共享 IP 最新版本同步、解绑后不复活、业务属性修改不生成文件版本、删除恢复、跨 IP 与跨区拒绝访问、首版字节往返及旧附件不双写。首轮 CI #38823818064 编译失败仅因新 Smoke 创建 IpInput 未传 Tags；补齐后最终 CI 成功。**原有旧业务 HTTP、网页 UI、Excel、14 项旧 MCP 还未切换；本批不能代替 V2 全应用验收。下一批 N2-03-03 继续模块级旧业务入口、附件及 Excel/MCP 身份收敛。**

## N2-03-03 知识产权固定 Excel 同源 V2 FolderId 回归（2026-10-16）

[功能提交 7a7d98a5](https://github.com/zy19970/IPSys/commit/7a7d98a54283174f94f3e7fb67bef2483cc0faf3)、[Windows CI #38825202078](https://github.com/zy19970/IPSys/actions/runs/38825202078) **success**。新 `/api/v2/excel/{workspace}/ip` 三接口沿用固定 20 列 OpenXML、行号错误报告、8 MiB/5000 行、申请号优先的重复记录策略，仅读写 `NativeFolderStore` 与 V2 FolderId/attributes_json。真实 SQLCipher HTTP 测试以旧固定模板导出产生可导入工作簿，验证 V2 创建、skip、update、以 FolderId 筛选导出、修改知识产权属性后原文件 FileId 与版本和真实下载字节保留、跨工作区只导入台账属性不串联物理原件、损坏工作簿拒绝，旧专利表没有自动双写。**旧网页 `/api/excel`、旧 MCP/HTTP/附件和其他 Excel 模块未统一；下一批 N2-03-04 应整合现有 IP 业务及附件入口，避免旧新业务身份交叉，最终 N4 再做桌面 Excel 实机。**

## N2-03-04 现有知识产权网页与 V2 原件/Excel 同源（2026-10-16）

[功能 d214d20a](https://github.com/zy19970/IPSys/commit/d214d20a658ec11dffde258bad7f5f1ef7e64f22)；[单 EXE 脚本补齐 f480fca6](https://github.com/zy19970/IPSys/commit/f480fca61cc2ef7d9e286ef7427209a6859d467c)；[Node UI 旧断言调整 d8ded0b9](https://github.com/zy19970/IPSys/commit/d8ded0b9cd25de90c59197c9e442623050d5800f)；[运行时拼接修复 c56ce21f](https://github.com/zy19970/IPSys/commit/c56ce21f5a197e4f359263c9b1ff39209862428e)。最终 [CI #38828523508](https://github.com/zy19970/IPSys/actions/runs/38828523508) 已通过自动验收。新版 IP 真实网页页面已接 `/api/v2/ui/ip` 汇聚 FolderId/FileId/LinkId/版本；IP CRUD/排序/批量删除、附件上传暂存内容去重与用户明确选择、类别、下载/预览/同区共享/解绑/新版本、IP Excel 及文件夹/ZIP 导出均指向 V2；JavaScript 适配文件单 EXE 内嵌且有 HTTP Smoke。重点核验跨工作区隔离、SHA-256、原件字节、材料类别、真实 Node UI 渲染、旧业务附件不会与 V2 FileId 混合。**旧统一搜索结果/回收站、原 14 项 MCP 的 IP 旧命令、跨区历史原件事务化复制移动和 Edge/Chrome 用户实机仍待 N2-03-05/N4。**

最终 Windows CI [#38828523508](https://github.com/zy19970/IPSys/actions/runs/38828523508) **completed/success**，真实浏览器脚本执行和本地 SQLCipher/HTTP 回归全部通过。历史失败三次为脚本嵌入、旧 IP 数据模型测试断言和前端提示拼接；另一次为旧排序断言，均通过独立提交修复。需后续用户 Windows/Edge/Chrome 实机验证及 N2-03-05 搜索/回收站/MCP/跨区复制收尾。

## N2-03-05～06：V2 知识产权统一搜索、回收站、跨区原件与 MCP（2026-10-16）

[N2-03-05 最终 CI #38831972597](https://github.com/zy19970/IPSys/actions/runs/38831972597) **success**：原名 IP MCP CRUD、统一搜索命中的 IP FolderId/原件 FileId、共享回收站 V2 删除/恢复，以及整条知识产权带多个文件和完整历史版本跨公司/个人单事务复制移动；验证源原件字节不变、目标 FileObject 物理隔离、失败无部分复制记录、软删除来源可恢复及权限拒绝。旧临时测试表的 legacy_ip 类型在开发期与 V2 ip 明确区分，不构成旧数据迁移要求。

[N2-03-06 源码提交 3f1e5608](https://github.com/zy19970/IPSys/commit/3f1e56088cb6c4f974d74221a6bca583a57d3939)、[最终 CI #38833862535](https://github.com/zy19970/IPSys/actions/runs/38833862535) **success**：在 SQLCipher + 真实本机 MCP 管道/HTTP 中验证 upload_files(kind=ip) 使用 V2 FolderId 上传原始字节并保留材料类别；list_ip_files 返回实际 FileId/LinkId；同内容 SHA-256 重复不选择时拒绝并清理 writing 暂存；选 reuse 仅复用物理内容并产生独立 FileId；update 追加 Version 2；个人工作区不能引用公司 IP ID；delete_ip_file 只解除指定关联，不损坏原 FileId 与历史版本。

**历史阶段注记**：本段描述 N2-03-06 结束时原计划先做项目合同、再做档案；这些已在后续 N2-03/N2-04 完成。**现行下一阶段 N4** 旧 Schema/Store/测试适配清理和 Edge/Chrome/T01–T09 验收。无旧正式数据库迁移任务。

## N2-03-07-01 项目合同 V2 网页/文件与合同父级回归（2026-10-16）

[功能提交 f13d185c](https://github.com/zy19970/IPSys/commit/f13d185cbedb40f5bf842a1c674453bdfddbe229)、[Windows CI #38836041449](https://github.com/zy19970/IPSys/actions/runs/38836041449) **success**。项目与合同的实际冻结网页读写 `folders.kind=project/contract` 的同一 FolderId；合同从项目详情创建、严格依附有效同工作区父项目。原件按 FolderFileLink→FileId→FileVersion 读取，支持内容 SHA-256 异名提示与明确保存方式、独立 FileId 与历史版本、同区共享、单处解除、文件夹/ZIP 导出。合同复制创建独立 FolderId 但在同一 SQLCipher 事务中共享原 FileId/全部现有版本。真实 HTTP smoke 测试工作区隔离、目录父级、文件初始/历史真实字节、顺序、旧业务表不双写、项目软删除隐藏合同与恢复后历史未损；Node UI 检查新版数据来源和操作路径。**剩余 N2-03-07-02**：统一旧名 MCP/搜索/回收站、项目合同 Excel、跨公司个人含所有子合同与历史文件的事务复制；之后归档/综合资料，最后用户 Windows/Edge/Chrome 实机，不进行旧测试库迁移。

## N2-03-07-02 首批项目合同原名 MCP 与原件（2026-10-16）

[功能 00e9c87](https://github.com/zy19970/IPSys/commit/00e9c87ab4dfec9cd702c3dd2f08f60f5becb935) 将项目合同原名 MCP CRUD 与 `upload_files(kind=project/contract)`、专用文件查询/解绑接至现有 V2 Folder/File；首轮 [CI #38844491828](https://github.com/zy19970/IPSys/actions/runs/38844491828) Debug 编译通过，但 WebSmoke 仍查旧 business-files 导致失败；[修复 60c3692](https://github.com/zy19970/IPSys/commit/60c36926945c9bb4d660b25212dbf5f23f23f95a) 改为按 V2 FileId/LinkId 下载并检验项目删除，[CI #38844746654](https://github.com/zy19970/IPSys/actions/runs/38844746654) 已成功。后续 [6fe6474](https://github.com/zy19970/IPSys/commit/6fe647437128635f0751b5edfe8795d13c74e0fc) 将通用 `list_files/delete_file` 也收敛 V2，有效列表返回 LinkId 和 FileId、解除不删除共享版本；其对应 [CI #38845050570](https://github.com/zy19970/IPSys/actions/runs/38845050570) **success**。项目合同固定 Excel、搜索回收站及跨区项目与全部合同附件历史事务复制仍未开发完毕。

## N2-03 主链路收尾与 N2-04 综合验收起点（2026-10-16）

[59f7614](https://github.com/zy19970/IPSys/commit/59f7614ed2fb90d3bf3d6f56533240555874b6f1) 完成项目合同 V2 Excel、搜索/回收站和携全部合同/原件历史的跨区事务复制，修复测试后 [CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379) success。**本段是当时 N2-04 起点记录**；随后 N2-04 全业务最终通过 [CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886)，现在进入 N4。
