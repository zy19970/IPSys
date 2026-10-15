# IPSys 统一资源内核重构：R0-02 回归与差异矩阵

> **现行用法（2026-10-15）**：矩阵起初基于重构前 `main@0b70bbe4` 编制，R0/R1 属历史方案；当前唯一路线是全新 SQLCipher V2，N1/N2-01/N2-02 已通过各自 Windows CI，N3-01 已通过 Windows CI，N3-01～N3-04 原生 V2 流程已通过 Windows CI，下一项 N2-03 旧 API/MCP/Excel 接入，后续 N4 冻结 UI 与完整实机验收。旧测试库迁移、兼容、回填用例被取消，不得拿旧 API 通过作为 V2 全链路通过。历史用例内容保留供追溯，但以本文末尾 N1/N2 验收与 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 最新进度为准。
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
| F04 | 同工作区共享**同一逻辑文件**，上传 v2 两处见新版，一处解绑后 v3 不复活 | **V2 后端 CI 已通过**：[Windows #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) 已验证不同 Folder 共享 FileId、同步版本和属性、解绑后 v3 不复活 | N4 需验证旧 UI 全量切换及用户实机操作 |
| F05 | 两个独立 FileId 内容相同时可只共享加密字节，属性和版本各自独立 | **V2 原生后端已验证**：[CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581) 验证不同 FileId/独立版本及属性、同区复用 FileObject ID 而不增加加密块 | N3-04 实现用户对同内容/异名内容的复用选择，N4 验证冻结 UI 流程 |
| F06 | 内容相同但名称不同，也显示已有文件名和所在文件夹，让用户三选一或取消 | **V2 原生后端已验证**：[CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) 验证 SQLCipher 暂存、同大小/SHA-256 异名匹配、返回原文件名和 Folder 路径、三种选择/取消清理，另核对同名不同字节不误匹配 | N2-03/N4 将此 API 接至旧业务流程与冻结 UI；CI 不等于前端弹窗已实现 |
| F07 | 版本只属于 File；Folder 改名/金额编辑不产生版本；历史 FileVersion 原件不丢 | **V2 N3-01 部分覆盖**：原生 File v1/v2、文件元数据编辑不产生新版本、历史原名/真实字节与 SHA-256 往返 [CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 通过；共享版本同步已通过 N3-02 CI | N4 验证 UI/导出历史版本 |
| F08 | 只选文件可上传；说明/标签/编号/日期与版本说明全选填、以后可补 | **V2 原生后端部分覆盖（N3-01 CI 已通过）**：文件可无额外属性上传，后续更新 File 元数据且不生成新版本；UI 尚未切换 | N3-02 验证多 Folder 同一 FileId 的属性同步；N4 验证 UI 可选项/上传流程，现有用户工作流不能提前标记完成 |
| F09 | 附件按自己名称、选填属性、直属/祖先 Folder 的业务属性能被搜索 | **部分覆盖**：`SearchStore` 已检索当前记录/附件名 | R2/R3 增加祖先字段、可选属性、权限、跳转测试 |
| F10 | 仅解除一个 FolderFileLink，不能删掉别处文件及需要保留的版本字节 | **V2 后端 CI 已通过**：[Windows #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) 已验证单条软解绑、最后链接移除后历史字节完整且可显式恢复 | N4 仍需测试完整回收站 UI 和永久清理引用安全 |
| F11 | 公司/个人不可共享同一 FileObject，跨区复制应保留独立物理内容对象 | **V2 原生后端已验证**：[CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581) 验证跨区复用请求被拒绝、跨区复制分配新 FileObject、所有有效版本原件 SHA-256/字节一致 | N4 UI/MCP/Excel 完整链路仍需验证 |
| F12 | 默认文件导出仅最新有效版本，选历史才导出旧版本 | **存在需修正风险**：`BusinessFileStore.List` 返回全部有效版本，前端部分调用可能直接全量导出 | R0 登记对比场景，R3 测试同组 v1/v2/v3 的项目/IP/档案及 ZIP |
| F13 | 勾选父目录和子项按目标目录导出，不错误重复；共享文件在不同目录分别出现 | **部分覆盖**：`export-smoke.cjs`、业务档案 UI smoke | R3 加重叠文件夹/相同 FileId 不同路径、同名与取消用例 |
| F14 | Excel 固定列、MCP 原接口、PDF Canvas、单 EXE 嵌入网页不回归 | **N2-03-01 Windows CI 已验证 MCP 增量**：[CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366) 通过真实本机 MCP 管道、11 项 `v2_*` 与原 14 项工具回归、旧资源不双写；旧 Excel/PDF/单 EXE 相关 CI 同样成功 | N2-03 继续迁移旧接口与 Excel，N4 再确认冻结前端及用户实机 |
| F15 | 公司业务档案删除空目录时，软删除资料/回收站关系判定正确 | **部分覆盖**：`ArchiveFolderStore.DeleteEmpty` 仍需复核 | R1 构造含回收站资料的真实库测试，再决定是否改动 |
| F16 | 综合资料在 V2 中直接通过 FolderFileLink 关联 File/版本，删除/恢复和文件对象引用安全 | **待实现**：旧综合资料迁移/断点回填已从交付范围取消 | N3/N2-03 在新建 SQLCipher V2 库核验版本、字节、SHA-256、软删恢复和附件归属，不进行旧库迁移 |
| F17 | SQLCipher 错密、防越权、突然退出、磁盘空间不足、手工备份不破坏数据 | **部分覆盖/待实机**：安全 CI 不等于故障注入 | R4 遵循 `FREEZE_AUDIT.md` T01–T09 的可恢复性门槛 |

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

> **当前下一项**：N3-01/N3-02 已通过 CI，N3-04 查重选项及取消清理已通过 CI；随后实施 N2-03 旧业务 API/MCP/Excel 改为唯一 V2 存储，再做 N4 UI/搜索/导出/回收站。F04–F13、F16 等涉及新文件层的测试仍是未完成目标，不能因 N1 的 Schema 约束测试或旧业务功能通过而提前记为全项通过。

[Windows CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) success；[功能提交 340102b3](https://github.com/zy19970/IPSys/commit/340102b3cb6e28a1f8882236115bc7e82beb874c)，[边界收尾 265123fb](https://github.com/zy19970/IPSys/commit/265123fb15124ee04d73f338997d3d423088a91f)。真实临时 SQLCipher v2 HTTP 回归覆盖七个公司业务档案系统根、目录/资料混排持久排序及陈旧列表重排拒绝、任意层级目录与成环移动拒绝、目录非空拒删与空目录删除不可恢复、档案/综合资料软删恢复、公司/个人及 section 隔离、业务档案资料禁止移至无分类虚拟根，以及原生接口不向旧表双写。此项只证明原生 Folder 业务层；旧 UI、附件、MCP、Excel 及搜索仍需 N2-03/N3/N4 统一接入。

## N3-01 原生 File 基础层验收（2026-10-15）

[提交 78e33d55](https://github.com/zy19970/IPSys/commit/78e33d5544d8435cc216820bd1fbe471e9439c14)、[Windows CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) **success**。原生 `/api/v2/files` 支持已授权工作区中的有效 Folder 初始归属、File 选填属性/更新、单个逻辑 File 多版本、原始文件名/版本说明及历史下载；新原件按 SQLCipher 块存储，校验实际大小和 SHA-256 后与版本、初始链接原子提交。HTTP 及独立临时加密库测试覆盖未认证、无有效 Folder、跨工作区访问拒绝，多块真实字节往返、v1/v2 保留、编辑属性不产生版本、短输入/取消回滚和重新打开。尚未支持 N3-02 的多位置动态关联、N3-03 的自动/人工内容对象复用、N3-04 的查重提示三选一；64 MiB 现有限制仍在，用户本机新库实测未单独完成。

## N3-02 原生 FolderFileLink 验收（2026-10-15）

[源码 c0b15a18](https://github.com/zy19970/IPSys/commit/c0b15a180e595883b511448d95cb77e6a90fd4af) 与 [Windows CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) **success**。新原生关联接口实现同区多 Folder 共享 FileId、单独解除与恢复、有效关联列表及原 Folder 包含已解除关联列表。真实 SQLCipher 测试验证文件身份、历史版本、加密对象/字节不随关联操作销毁；HTTP 测试验证 Token、工作区和目录隔离、重复关联拒绝、两处新版同步、解除后新版本不自动重现、完整解除后主动恢复。N3-03 内容字节复用和 N3-04 查重用户选择尚待开发。

## N3-03 独立 FileId 仅内容复用与跨区物理隔离验收（2026-10-15）

[功能提交 944312d0](https://github.com/zy19970/IPSys/commit/944312d08f80d6baac7ab7fc614942441bfa880f)、[Windows CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581) **success**。新原生复制接口按明确模式创建独立 FileId、独立 FileVersion/属性：同一工作区 `reuse-content` 保留原 FileObject ID、只增加文件身份与版本；`independent-content` 为所有有效历史版本独立写入新加密原件块，跨公司/个人只允许此模式。真实 SQLCipher/HTTP 自动测试比较工作区、FileId、FileObject 数量与 ID、版本/元数据独立性、SHA-256 和实际原件字节，并检查权限、目标归属、跨区复用拒绝、取消事务无残留。该批没有内容哈希查重列表/异名提醒及用户三选一，仍由 N3-04 实现。

## N3-04 内容查重与用户决策原生验收（2026-10-16）

[功能提交 93be896f](https://github.com/zy19970/IPSys/commit/93be896f4c0d26b0bfedb64c8c766069924a77f4) 与 [Windows CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) **success**。新原生 `/api/v2/files/{workspace}/prepare` 在 SQLCipher 暂存 writing 原件并按大小与 SHA-256 查询同区有效文件最新版；显示已有 FileId、文件名和 Folder 完整父级路径，支持不同名称命中，同名不同内容不可误命中。`/prepared/{ticket}/resolve` 必须明确选择引用同一 FileId、创建独立 FileId 只复用原件或完全独立保存；取消端点删除 writing 分块。SQLCipher/HTTP 测试覆盖令牌一次性消费、鉴权、工作区隔离、冲突、回滚、关闭/重开清理及原件字节。30 分钟过期、每数据库会话仅一项待确认。**此项仅为原生 HTTP/Store；现有网页的选择弹窗、MCP/Excel 和所有旧业务附件入口仍待 N2-03/N4 切换。**

## N2-03-01 原生 V2 本机 MCP 第一批（2026-10-16）

[源码提交 3e7ba60a](https://github.com/zy19970/IPSys/commit/3e7ba60aad3fa1043f098178c3312e423873f745)、[Windows CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366) **success**。新增 V2 命名 `v2_*` 11 项业务 CRUD，通过同一用户本机命名管道与原授权令牌访问 `/api/v2/folders`，真实 SQLCipher/HTTP 回归检查项目与合同合法父级、知识产权属性更新、跨区修改拒绝、删除/恢复、旧表不双写；保留旧 14 项工具与 UI 过渡期兼容，不将它们标记为已迁移。**下一批 N2-03-02 需要让旧项目/合同/IP HTTP/附件、旧 MCP 命名及 Excel 逐模块接入同一 V2 数据源，避免业务与附件两套身份混用。**

## N2-03-02 知识产权 FolderId 与附件 FileId 垂直闭环（2026-10-16）

[功能提交 e88b1b82](https://github.com/zy19970/IPSys/commit/e88b1b8256731a1f95dfeda6f6e00cd61b7aff76)、[测试构造修复 02c45ece](https://github.com/zy19970/IPSys/commit/02c45ece23863935098e80567e2e055922fd0e7b)，最终 [Windows CI #38824119576](https://github.com/zy19970/IPSys/actions/runs/38824119576) **success**。`NativeIpFileStore` 和 `NativeIpFileEndpoints` 在原生 V2 `folders.kind=ip` 的实际业务 FolderId 上接入 `files/file_versions/file_objects/file_chunks/folder_file_links`，提供上传/分类、列表、原件详情、追加与下载历史版本、复用同 FileId、单条解绑与恢复。SQLCipher HTTP 回归验证有效 IP 父级、材料类别、共享 IP 最新版本同步、解绑后不复活、业务属性修改不生成文件版本、删除恢复、跨 IP 与跨区拒绝访问、首版字节往返及旧附件不双写。首轮 CI #38823818064 编译失败仅因新 Smoke 创建 IpInput 未传 Tags；补齐后最终 CI 成功。**原有旧业务 HTTP、网页 UI、Excel、14 项旧 MCP 还未切换；本批不能代替 V2 全应用验收。下一批 N2-03-03 继续模块级旧业务入口、附件及 Excel/MCP 身份收敛。**
