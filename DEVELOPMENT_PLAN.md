# IPSys 开发计划与验收进度（2026-10-15，V2 新库执行版）

> **当前唯一执行依据**：[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 的新 SQLCipher V2 路线（N1、N2、N3、N4）。2026-10-15 用户明确旧资料库全为测试数据，取消迁移、回填和旧库兼容；已核验最新 N2-03-06 Windows CI #38833862535。本计划取代此前“先做 V1.0 综合验收”和旧 R4 迁移的施工顺序，但不取消正式发布前的安全验收门槛。

## 1. 产品和已确认架构

IPSys 用户可见名称为「资料管理系统」，采用 Windows WinForms 启动器、本机 `127.0.0.1` ASP.NET Core 网页、Edge/Chrome；网页和 PDF.js 内嵌到依赖外置 .NET 8 两类运行时的单 EXE。SQLCipher 单份加密库分离个人/公司工作区，原件字节加密入库。

**Folder 是所有分类及业务对象，有父级、类型、业务属性、排序和软删状态，没有版本；File 才有独立 FileId、选填属性及文件版本。** Folder 与 File 多对多。同工作区不同 Folder 可共享 FileId（版本同步），也可将独立 FileId 的相同字节复用一个 FileObject（版本互不影响）；用户在发现同内容文件时决定引用已有文件、仅复用内容、独立保存或取消。跨工作区禁止共享物理文件对象。项目可独立存在，合同必须依附有效项目；具体业务字段和 UI 按 [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md)、[UI_BASELINE.md](./UI_BASELINE.md) 执行。

## 2. 当前实现状态与证据

| 阶段 | 状态 | 范围与限制 |
| --- | --- | --- |
| M0/M1、U0、B01–B06、P1/P2/MCP | 旧系统已有代码、部分 CI 和限定范围用户实机结果 | 项目/合同/IP、归档、原件、版本、导出、Excel、搜索、14 项本机 MCP、冻结 UI；当前仍主要读取旧业务表 |
| R0/R1 | 已完成相应历史 CI | Program 职责拆分、旧表上的 Folder Provider/浏览/CRUD/复制转移适配；属过渡层 |
| **N1 新 Schema** | **Windows CI 通过** | V2 六张核心资源表、版本识别、工作区/父子约束、历史对象写后保护；[CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) |
| **N2-01** | **Windows CI 通过** | 项目、合同、知识产权在新 `folders` 上的原生 CRUD、软删恢复；[CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) |
| **N2-02** | **Windows CI 通过** | 档案目录/资料、综合资料原生 CRUD，目录/资料混排排序与移动；[CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) |
| **N3-01** | **Windows CI 通过** | 新 File 原生分块/属性/版本/初始归属/下载及事务回滚， [CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418)；旧 UI 未接入 |
| **N3-02** | **Windows CI 通过** | 同 FileId 多 Folder 关联/解绑/恢复、历史版本和字节保护 [CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) |
| **N3-03** | **Windows CI 通过** | 不同 FileId 同区复用物理内容、跨区重新写入原件，通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581) |
| **N3-04** | **Windows CI 通过** | SQLCipher writing 暂存、同内容含异名查重、原件名/目录路径提示、明确选择与取消清理；[CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) |
| **N2-03-01** | **Windows CI 通过** | 新增 11 项 `v2_*` MCP 项目/合同/IP 操作，经手动授权、本机管道和 HTTP 仅访问 V2 `folders`；[CI #38822708366](https://github.com/zy19970/IPSys/actions/runs/38822708366)。旧 14 工具暂保留，未双写 |
| **N2-03-02** | **Windows CI 通过** | 知识产权 FolderId 绑定 V2 FileId/Link/Version 的附件完整后端链路，工作区隔离、材料类别、版本、共享/解除/恢复及 HTTP/SQLCipher 回归；[CI #38824119576](https://github.com/zy19970/IPSys/actions/runs/38824119576)。旧网页/Excel/MCP 未切换 |
| **N2-03-04** | **Windows CI #38828523508 已通过** | 将现有 IP 网页的 V2 FolderId/文件归属/文件版本/上传查重用户选择、Excel/ZIP/文件夹导出统一；旧搜索、IP 回收站、旧 MCP 和跨区事务化复制尚待 N2-03-05 |
| **N2-03-05** | **Windows CI #38831972597 已通过** | IP 原名 MCP CRUD、统一搜索及 V2 回收站使用唯一 FolderId；跨区整 IP 文件夹含多份文件历史在同一个 SQLCipher 事务中复制/移动，源工作区和目标工作区的 FileObject 物理独立；拒绝不安全的物理永久删除。 |
| **N2-03-06** | **Windows CI #38833862535 已通过** | 原 MCP `upload_files(kind=ip)`、新增 `list_ip_files/delete_ip_file` 接入 V2 FileId/LinkId，支持本机原件、更新版本、SHA-256 同内容确认/引用/物理复用/独立保存和工作区隔离，不再触达旧 IP 附件表。 |
| **N2-03-03** | **Windows CI 通过** | V2 知识产权 XLSX 沿用固定20列与重复记录策略，仅读写新版 FolderId/attributes_json，Excel 更新不改变原 IP/附件身份；真实 SQLCipher/HTTP [CI #38825202078](https://github.com/zy19970/IPSys/actions/runs/38825202078) 通过 |
| **N2-03-07-01** | **Windows CI 通过** | 项目/合同现有网页 CRUD、合同从属项目、排序、原生附件/版本/共享/解除、文件夹/ZIP 导出已接入 V2 FolderId/FileId；[CI #38836041449](https://github.com/zy19970/IPSys/actions/runs/38836041449)。原名 MCP/Excel/搜索及跨区整项目复制尚待收敛 |
| **N2-03-07-02～N4** | **待继续** | 下一批统一项目/合同 MCP 原名、搜索/回收站、Excel/跨区含合同原件事务复制；其后归档与综合资料使用 V2，清理开发期临时旧表和旧 API。最后 Node/SQLCipher/Windows/Edge/Chrome 完整实机验收，不迁移旧库 |

N2 原生 API 与旧 UI/API 目前并存，不能据此声称新库整套业务完成。当前 `Vault` 仍初始化旧综合资料表，`app.js`、`BusinessFiles.cs` 和原有业务接口仍访问旧表；在切换前不得删除旧 Store 或对两套物理表同时写入。

## 3. 下一步实际施工顺序

1. **N3-01（已完成）**：新 `files/file_versions/file_objects/file_chunks` 创建、选填属性、加密分块、SHA-256、文件版本与原件校验；独立新上传时第一条 Folder 关联同事务写入，Windows CI 已通过。
2. **N3-02（已完成）**：同区多 Folder 关联 FileId、软解绑及显式恢复；共享版本在各位置同步，解除一处不删除原件，Windows CI 已通过；完整回收站 UI 后续 N4 验收。
3. **N3-03（已完成）**：独立 FileId 可显式复用同区 FileObject，属性和版本历史独立；跨公司/个人复制产生独立物理字节，CI 已通过。
4. **N3-04（原生 V2 API 已完成）**：按大小、SHA-256 匹配同区最新原件（含异名），返回原件名与 Folder 路径，用户决定共享 FileId、只复用内容、独立保存或取消，writing 分块安全清理并按会话约束票据；CI 已通过。可视化弹窗仍归 N4。
5. **N2-03（分批进行中）**：N2-03-01～06 与 N2-03-07-01 已分别通过 Windows CI。知识产权全链路、项目/合同现有网页基础业务与附件版本均已直接读写 V2；N2-03-07-02 优先将项目合同的旧 MCP、统一搜索/回收站、Excel 和跨区完整历史原件事务复制接入，然后按顺序转换归档、综合资料。用户开发测试数据库可直接丢弃，**不执行旧数据库迁移、回填或兼容**，但不可自动覆盖任意现存文件。
6. **N4**：保持冻结 UI，接通新库的前端、File 选填属性和 Folder 祖先字段搜索、递归导出、默认最新版本、回收站；确认无调用后清除旧业务/附件表及兼容代码。
7. **N4 整体验收和发布判断**：Windows Debug/Release/单 EXE、SQLCipher HTTP、Node UI/PDF/ZIP、MCP、Excel，以及 Edge/Chrome 实机和 T01–T09 数据安全专项。

因 N2-03 依赖 N3，**当前实际下一项为 N2-03**，不能机械按 N2-03 在进度表中的位置执行。

## 4. 安全、兼容和发布边界

[FREEZE_AUDIT.md](./FREEZE_AUDIT.md) 的 T01–T09 安全目标继续生效，但 T08 不再检查旧测试库迁移、断点回填或新旧库双向兼容，而检查 V2 版本识别、旧库拒绝打开且不覆盖，以及未来受控升级/备份的安全性。现有旧附件上传上限 **64 MiB**，目标超过 2 GiB 的完整往返、移动 SSD 故障、磁盘不足、手工备份一致性均未全面验证；ZIP 不支持 ZIP64（小于 4 GiB），Excel 导入上限 8 MiB/5000 行。无经验证的含新原件外部备份，不自动删除来源文件。

开发进度分别标记「代码已实现」「Windows CI 通过」「用户实机通过」「未测/失败」。不以旧模块 CI 代替新库全链路验证，不以文档状态宣布正式发布完成。

## 5. 协作方式

每次依 AIGT-templates 的 `AGENTS.md`、`AI_RULES/GIT_OPERATIONS.md` 及 IPSys 完整提交历史核对当前状态；按依赖完成一个明确子任务、进行匹配测试、默认直接提交 `main`，然后核对 CI 与真实 ref。每个新功能/测试结果持续更新 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 和 [RESOURCE_REFACTOR_TEST_MATRIX.md](./RESOURCE_REFACTOR_TEST_MATRIX.md)。历史业务需求仍保留，最新明确覆盖决定优先。
