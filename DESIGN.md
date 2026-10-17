# IPSys 技术设计：SQLCipher V2 当前实现与安全验收（2026-10-17）

> **现行技术基线（2026-10-17）**：SQLCipher V2-only 业务及 N4 旧表、31 份旧源码清理已完成；MCP P0/P1、业务操作、ISS-001～018 修复进入主线。[`2620c109`](https://github.com/zy19970/IPSys/commit/2620c109043f779eeb57f411210f99bb2f21e554) 去掉 11 个 `v2_*` MCP 重复别名和旧前端上传死分支，公开 **59** 个工具；[Windows CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428) success。底层 V2 HTTP、文件身份、共享、版本及 SHA-256 显式选择不变。70 工具版历史实机 PASS28/FAIL0/BLOCKED9，最新 59 工具尚需独立本机 Agent 复测。最新交接见 [HANDOFF.md](./HANDOFF.md)。

## 1. 运行与安全边界

IPSys 用户可见名称为「资料管理系统」，支持 Windows 10/11 x64、离线、单用户。WinForms `LauncherForm.cs` 管理 ASP.NET Core/Kestrel 生命周期，本机 HTTP 仅监听 `127.0.0.1` 临时端口；网页只是客户端，浏览器标签关闭不结束宿主。网页 `POST /api/lock` 关库并撤销授权，只有 WinForms 窗口或「退出程序」结束进程。上传任务期间关库拒绝；宿主退出按安全三选项协调。

`Vault.cs` 利用 SQLCipher 加密单个数据库文件，以 `PRAGMA cipher_version` 验证，启用外键及 `X-IPSys-Token` 会话鉴权、loopback Host/Origin 校验和 CSP。个人/公司两个工作区逻辑及原件对象物理隔离，数据在加密库内，不维护硬盘明文镜像目录。

网页 `index.html/app.js/style.css/export.js/ip-v2.js/pdf-preview.js`、离线 PDF.js 编译进 EXE，`demo/ui-preview.html` 仅是历史预览。Release 为 `net8.0-windows` + `win-x64`、`PublishSingleFile=true`、`SelfContained=false`，只有一个 EXE，目标机另需 Windows Desktop Runtime 8 x64 与 ASP.NET Core Runtime 8 x64。

## 2. V2 新数据库（N1 已通过）

用户 2026-10-15 决定**不用迁移、回填或兼容旧测试库**，V2 全新建库，不覆盖已有文件。由 `ResourceSchemaV2.cs` 建立并验证 `resource_schema_version=2` 与下列新物理表：

| 资源表 | 约束与用途 |
| --- | --- |
| `folders` | 项目、合同、知识产权、分类目录、归档资料、综合资料统一 Folder 身份，工作区、kind、section、parent_id、业务 `attributes_json`、位置和删除标志；**Folder 无版本** |
| `files` | 稳定 FileId、工作区与文件名，说明、标签、文件编号、文件日期等选填属性 |
| `file_versions` | 版本号、历史文件原名、对象引用、可选版本说明和时间；FileVersion 不属于 Folder |
| `file_objects` / `file_chunks` | SHA-256、大小、writing/ready 生命周期与 SQLCipher 字节分块；ready 后触发器禁止改写数据 |
| `folder_file_links` | Folder 与 File 多对多归属，位置专属别名/用途、知识产权材料类别等链接属性 |
| `mcp_operations` | MCP 可选 `request_id` 操作状态、参数摘要与成功结果留存在加密库中；`pending/uncertain` 不自动重放，不保证异常崩溃时严格 exactly-once |

V2 强制工作区组合约束、合同有效父项目、合法 Folder 父级/目录防环、七个公司业务档案系统根不可改以及 FileVersion/完成对象不可变。真实 Schema/关系测试 [Windows CI #38740628571](https://github.com/zy19970/IPSys/actions/runs/38740628571) 已通过。N1 的 CI 仅证明表及约束，后续 N3 与实际模块接入另有对应自动验收。

共享同一 FileId 时，多 Folder 同步看到文件属性与版本链；仅复用 FileObject 时，两个独立 FileId 保留独立属性及版本；独立保存连物理字节也不共用。SHA-256 相同不得静默合并，需显示已有名称、位置并由用户确认三种决策或取消。公司/个人不能共享同一物理对象。

## 3. N2 原生 Folder API（已通过专项 CI）

`NativeFolderStore.cs`、`NativeFolderEndpoints.cs` 直接读写 V2 `folders/attributes_json`，项目/合同/IP 原生 CRUD、软删与恢复；合同仅能属于唯一有效项目，遵循 M0 业务验证。[Windows CI #38743939004](https://github.com/zy19970/IPSys/actions/runs/38743939004) 通过。

`NativeArchiveStore.cs` 与 `NativeArchiveOrder.cs` 实现业务档案分类/资料和综合资料的原生 CRUD、七个系统根保护、目录/资料混排排序、移动防环、资料归属及恢复。[Windows CI #38747066932](https://github.com/zy19970/IPSys/actions/runs/38747066932) 通过。

当前正式项目、合同、知识产权、档案、资质、个人分类及综合资料均由 V2 Folder CRUD 维护。旧 SQL Store、Folder Provider 和过期 HTTP/测试适配已从源码移除，所需 DTO 与业务字段校验由 `BusinessRules.cs` 提供；正式 MCP、Excel、统一搜索及历史文件导出均复用 V2 身份。

### N3-01 原生 File 基础服务（2026-10-15 已通过 CI）

`NativeFileStore.cs` / `NativeFileEndpoints.cs` 通过独立 `/api/v2/files` 接口实现 FileId 创建（必须绑定有效 FolderId）、原件加密分块上传与 SHA-256/长度校验、同事务版本和首条 FolderFileLink 写入；文件名必填、说明/标签/编号/日期/版本说明选填，可编辑属性且不修改历史版本。历史版本保留原始文件名并按版本下载。上传不完整、取消时事务回滚，无残留有效文件。独立 `NativeFileStoreSmoke` 和 `NativeFileHttpSmoke` 在真实 SQLCipher 与 HTTP 中通过身份/跨区隔离、原件往返、版本、事务回滚及数据库重开，[Windows CI #38754995418](https://github.com/zy19970/IPSys/actions/runs/38754995418) 成功。**N3-02 关联、N3-03 独立 FileId 内容复用、N3-04 原生查重与用户确认 API 均已通过 CI；全部正式业务类型均经 V2 SHA-256 prepare/resolve 上传；Edge/Chrome 实际交互及复杂文件边界仍待实机验收。** 旧单文件 64 MiB 上限在此基础链路继续适用。

### N3-02 同一 FileId 的多位置关联（已通过 CI）

`NativeFileLinkStore` 与 `NativeFileLinkEndpoints` 在现有 `folder_file_links` 上新增同工作区多 Folder 关联、有效关联列表、单位置软解绑与显式恢复。所有有效位置共用文件属性和 FileVersion；链接只保留当前 Folder 的别名、材料类别与位置。解绑 A 不会删除版本或原件字节，B 中新增版本也不会自动使 A 的链接复活；当全部链接解绑后，文件不可从直接接口访问，但可在原 Folder 通过 `includeDeleted=true` 检索已解除关联并显式恢复。新代码已通过 [Windows CI #38759311477](https://github.com/zy19970/IPSys/actions/runs/38759311477) 的真实 SQLCipher/HTTP 回归。N3-03 已实现独立文件仅复用同区字节的另一种模式，不能与共享 FileId 混淆。

### N3-03 独立 FileId 和物理原件复用（已通过 Windows CI）

`NativeFileCopyStore` 和 `NativeFileCopyEndpoints` 以显式 `reuse-content`（同工作区）或 `independent-content` 模式复制一个 File 的有效历史版本到新的 FileId 和目标 Folder。前者为独立文件/版本记录引用原来已完成的不可变 FileObject；后者在 SQLCipher 中创建新的 FileObject/加密分块，跨公司与个人工作区必须采用后者。副本属性、显示名称及后续版本独立；文件、版本、物理对象及目标目录首条关联同事务提交，取消时全部回滚。真实 SQLCipher 和 HTTP 通过 [CI #38762437581](https://github.com/zy19970/IPSys/actions/runs/38762437581)。N3-04 已提供上述内容哈希匹配、原名/路径提示及用户复用/独立保存/取消选择。

### N3-04 SHA-256 查重、待确认原件与选择接口（已通过 Windows CI）

`NativeFileChoiceStore`、`NativeFileChoiceResolve`、`NativeFileChoiceEndpoints` 实现 SQLCipher `writing` 暂存、SHA-256 同内容查重、展示文件名和 Folder 路径、明确选择共享 FileId/仅复用物理字节/独立保存或取消。票据授权、回滚、关库清理等在 [CI #38820367132](https://github.com/zy19970/IPSys/actions/runs/38820367132) 通过；现有全部正式业务上传入口已在后续 N2-04 接入，Edge/Chrome 弹窗仍待实测。

## 4. N4 旧 Schema、Store 与测试适配清理

`Vault.CreateSchema/ValidateSchema` 仅负责 V2，新建资料库不会生成 `records/attachments/chunks` 旧表；开库不调用旧 Store Ensure。正式及 `--smoke` 只映射 V2 业务路由，`RecycleStore` 与综合回归均使用 `folders/folder_file_links`。旧源码裁剪 `7b51669` 后在 `b3c8f3b` 恢复 V2 必要共用 DTO，[CI #38911635273](https://github.com/zy19970/IPSys/actions/runs/38911635273) 通过。

已完成 N4 旧物理层和源码裁剪，不再将停用 Store/Provider 作为下一步开发任务。当前尚需文件属性/历史共享/复杂导出、用户浏览器及数据库异常场景的实际验收；N4 尚未宣告整体发布完成。

## 5. UI 与外围系统约束

[UI_BASELINE.md](./UI_BASELINE.md) 是交互权威：个人工作区优先，公司五栏目及 3×2 工作台，企业资质直接表格；业务档案根七分类卡片纯导航、内层目录/资料混排表格；个人分类卡片→台账；项目/IP 台账→详情。V2 的统一物理 Folder 不能作为统一改变这些界面的理由。

`export.js` 的全部模块 ZIP/文件夹附件下载都使用 V2 FileId+FileVersion；默认最新版，历史版需明确选择。`SearchStore` 已覆盖各模块、附件选填属性和 Folder 祖先名；正式搜索是 `/api/v2/search/{workspace}`。全部固定列 XLSX 和现行 59 个无版本前缀的 MCP 工具都接 V2（合同 Excel 只读）；额外 11 个 `v2_*` 别名已在接口去重阶段删除。MCP 手动授权规则不变。ZIP 不支持 ZIP64（小于 4 GiB），同名、父子目录重叠、取消和真实浏览器跳转待实机验证。

## 6. 验收、风险与发布

N1/N2/N3 正式业务、N4 两批旧表/源码清理、MCP 三批专项及后续黑盒缺陷修复均已通过对应 Windows 自动回归；**当前最新源码 `2620c109`，[Windows CI #39019604428](https://github.com/zy19970/IPSys/actions/runs/39019604428) success**。MCP 实现为手动授权的多个 stdio 子进程→同用户命名管道（最多 8 连接）→唯一 WinForms 宿主→带会话 Token 的 V2 HTTP；`list_files` 单次查询、`list_files_page` 限 1–200；历史阶段曾按批次新增 14 项业务工具；当前对外工具总数 59 项。当前不实现超过 64 MiB 的单文件支持，2 GiB+ 目标、ZIP64、SSD 异常、磁盘不足、安全退出、备份一致性及 Edge/Chrome/Agent 实机仍待验收。

具体接续见 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)、[RESOURCE_REFACTOR_PLAN.md](./RESOURCE_REFACTOR_PLAN.md)；测试记录见 [WEB_TESTING.md](./WEB_TESTING.md)。
