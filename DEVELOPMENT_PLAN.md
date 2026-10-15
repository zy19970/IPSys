# IPSys 开发计划与验收进度（2026-10-15，V2 新库执行版）

> **当前唯一执行依据**：[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 的新 SQLCipher V2 路线（N1、N2、N3、N4）。2026-10-15 用户明确旧资料库全为测试数据，取消迁移、回填和旧库兼容；当前进度 `main@3ef17bd5`。本计划取代此前“先做 V1.0 综合验收”和旧 R4 迁移的施工顺序，但不取消正式发布前的安全验收门槛。

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
| **N3、N2-03、N4** | **未开始** | V2 File 业务、新旧接口与外围统一、旧表清理、最终验收 |

N2 原生 API 与旧 UI/API 目前并存，不能据此声称新库整套业务完成。当前 `Vault` 仍初始化旧综合资料表，`app.js`、`BusinessFiles.cs` 和原有业务接口仍访问旧表；在切换前不得删除旧 Store 或对两套物理表同时写入。

## 3. 下一步实际施工顺序

1. **N3-01**：新 `files/file_versions/file_objects/file_chunks` 的创建、选填属性、加密分块上传下载、SHA-256、文件版本与原件校验。
2. **N3-02**：`folder_file_links` 多对多归属、共享同一 FileId、解除单一关联、回收站和历史引用保护。
3. **N3-03**：独立 FileId 只复用同工作区 FileObject、版本保持独立；跨公司/个人复制必须是独立物理对象。
4. **N3-04**：按大小与 SHA-256 检测同内容（包括异名），展示已有文件名及所在目录供用户三选一或取消，安全清理暂存对象。
5. **N2-03**：**等 N3 提供完整附件归属接口后**，分模块将旧业务 API、MCP、Excel 转到唯一 V2 Folder/File 数据源，不做旧新表双写。
6. **N4**：保持冻结 UI，接通新库的前端、File 选填属性和 Folder 祖先字段搜索、递归导出、默认最新版本、回收站；确认无调用后清除旧业务/附件表及兼容代码。
7. **N4 整体验收和发布判断**：Windows Debug/Release/单 EXE、SQLCipher HTTP、Node UI/PDF/ZIP、MCP、Excel，以及 Edge/Chrome 实机和 T01–T09 数据安全专项。

因 N2-03 依赖 N3，**当前实际下一项为 N3-01**，不能机械按 N2-03 在进度表中的位置执行。

## 4. 安全、兼容和发布边界

[FREEZE_AUDIT.md](./FREEZE_AUDIT.md) 的 T01–T09 安全目标继续生效，但 T08 不再检查旧测试库迁移、断点回填或新旧库双向兼容，而检查 V2 版本识别、旧库拒绝打开且不覆盖，以及未来受控升级/备份的安全性。现有旧附件上传上限 **64 MiB**，目标超过 2 GiB 的完整往返、移动 SSD 故障、磁盘不足、手工备份一致性均未全面验证；ZIP 不支持 ZIP64（小于 4 GiB），Excel 导入上限 8 MiB/5000 行。无经验证的含新原件外部备份，不自动删除来源文件。

开发进度分别标记「代码已实现」「Windows CI 通过」「用户实机通过」「未测/失败」。不以旧模块 CI 代替新库全链路验证，不以文档状态宣布正式发布完成。

## 5. 协作方式

每次依 AIGT-templates 的 `AGENTS.md`、`AI_RULES/GIT_OPERATIONS.md` 及 IPSys 完整提交历史核对当前状态；按依赖完成一个明确子任务、进行匹配测试、默认直接提交 `main`，然后核对 CI 与真实 ref。每个新功能/测试结果持续更新 [RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md) 和 [RESOURCE_REFACTOR_TEST_MATRIX.md](./RESOURCE_REFACTOR_TEST_MATRIX.md)。历史业务需求仍保留，最新明确覆盖决定优先。
