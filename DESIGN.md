# IPSys 现行技术设计（SQLCipher V2 + Explorer）

> **现行技术基线（2026-10-25）**：Explorer/SQLCipher V2 已并入 `main`，最新产品代码基线 `8c1ca9a` 的 [Windows CI #40162144248](https://github.com/zy19970/IPSys/actions/runs/40162144248) 全部成功；历史 N1～N4、R0～R4 与 OneDrive 选型仅供追溯。文档修改不改变产品源码；由于正式前端目录在 Windows CI 路径过滤内，同目录的 README 更新也可能触发自动构建，应以实际 Actions 结果为准。

## 1. 进程与界面架构

`src/IPSys.Web/IPSys.Web.csproj` 以 `net8.0-windows`、`UseWindowsForms=true`、`OutputType=WinExe` 构建。WinForms 启动器控制 ASP.NET Core/Kestrel 的生命周期，HTTP 只绑定 `127.0.0.1` 临时端口，Edge/Chrome 是客户端。关闭浏览器页面不终止程序；网页关库注销当前会话；仅 WinForms 退出结束程序，文件任务须按安全退出机制处理。

正式前端全部位于 `src/IPSys.Web/wwwroot/`：页面源码 `index.html`、`css/app.css`、`js/*.js` 与上传、下载、ZIP64、PDF.js 等能力模块共享这一目录；`tools/bundle.cjs` 在构建时生成 `wwwroot/dist/index.html`、`style.css`、`app.js`，由 MSBuild 按固定逻辑资源名嵌入 EXE。运行时由 `EmbeddedWebAssets` 读取内嵌资源，不向外输出物理 `wwwroot` 文件夹。只修改前端源码，不在 Git 中维护生成的 `dist/`。

本地默认 Windows Release 以 `win-x64` / `PublishSingleFile=true` / `SelfContained=false` 构建为依赖环境的单一 EXE，目标机需 .NET 8 Windows Desktop 与 ASP.NET Core 两种运行时；手动 GitHub Release 同时生成自包含版与依赖环境版。MCP 由同一个 EXE 的 `--mcp` stdio 模式、受授权的同用户命名管道和宿主会话运行，现行源码清单为 **64 项无 `v2_*` 别名的工具**；详情见 [MCP_CODEX.md](./MCP_CODEX.md)。

## 2. SQLCipher V2 数据身份

一个加密库划分 `company` / `personal` 工作区，后端验证 SQLCipher 加密、工作区、认证 Token、loopback Host/Origin，前端不能代替服务端授权。使用 `ResourceSchemaV2.cs` 定义的 `folders`、`files`、`file_versions`、`file_objects`、`file_chunks`、`folder_file_links` 等真实结构：

| 资源 | 实际约束 |
| --- | --- |
| Folder | 统一分类/业务记录，支持层级、排序、属性、软删除；**Folder 无版本** |
| File | 独立逻辑文件身份、可选元数据、稳定 FileId |
| FileVersion | 附件历史版本，保留原始名称、内容与版本；**只有 File 有版本** |
| FolderFileLink | 记录/分类与 File 的具体归属，可同工作区多位置关联 |
| FileObject / FileChunk | SQLCipher 加密字节与分块；同区可按显式选择复用物理对象 |

合同的父级必须是项目，项目可以无合同；业务整记录复制/跨区转移必须保持合同归属、版本顺序和所有原件；公司/个人**不能共享相同物理 FileObjectId**。同区共享 FileId 意味着共享版本链；独立 FileId 复用物理字节不共享逻辑版本。查重依据 SHA-256，但是否关联、复用字节或独立保存由用户操作决定，不能静默合并。业务字段见 [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md)。

用户当前仍在开发阶段，不安排旧 V1 测试数据库迁移；这一决定**不允许**自动删除、重置或覆盖用户已创建的实际资料库。

## 3. 服务、接口与任务安全

正式业务网页、MCP、固定 Excel、统一搜索、回收站、PDF 预览与导出统一 V2 Folder/File/Link/Version 身份。已有历史 `--smoke` 兼容断言不表示正式程序继续开放旧 V1 业务接口。MCP 的 64 个工具、同用户授权和会话撤销规则独立于 Explorer 外观。

Agent 工作规范配置位于当前 Windows 用户的 LocalApplicationData/IPSys/agent-guidance.json，独立于数据库与前端 localStorage；内置资源 + 用户覆盖由 AgentGuidance/AgentGuidanceStore 为同一权威来源。GET/PUT/POST 管理接口必须通过现有浏览器会话授权，MCP 工具读取还需本机授权；配置版本与正文哈希供客户端识别旧内容。第三阶段代码已提交，动态 CI/本机验收独立跟进。

上传/下载为流式，单原件代码容量保护为 **8 GiB**；包含同内容暂存、确认、取消、版本追加和跨区任务绑定。可恢复性、并发文件任务锁、真正的任务成功终态、失败可见以及删除事务回滚为硬约束。回收站永久删除按最后引用关系回收物理对象，删除后 SQLCipher 文件体积不保证立即缩小；设置中的压缩以 VACUUM 实际完成且 `integrity_check` 通过为判据，不能展示伪造的实时百分比。

ZIP 与文件夹式导出支持 ZIP64；正式 ZIP 生成代码在 `src/IPSys.Web/wwwroot/export.js`。产品 Node 生成器已写出真实超过 4 GiB 的 ZIP64 并验证物理结构；专项 CI 使用可重复流/写入适配层，**不等同于第三方解包器或系统保存窗口的自动端到端验证**。用户另行确认本机人工验收通过，详见 [TESTING.md](./TESTING.md)。

## 4. 当前业务接口与导出一致性

Excel 模板由 `ExcelLedger.cs` 统一维护：项目 11 列、知识产权 **19 列**（`number`、`publicationNo`、`grantNoticeNo` 三个编号相关列）、档案/资质/党团 4 列、综合资料 1 列。导出通过 `ExcelExportInput` 的 `mode=all|filtered` 与可选 `query/status` 调用 `ExcelLedger.ExportIds`；完整服务端搜索用于筛选导出，交互式搜索接口的每组 60 条限制不应用于 Excel 范围计算。**不存在合同独立 Excel 导入/导出能力**，合同通过项目附属记录及原件导出链路管理。

知识产权现行为十种固定类型：全部类型使用统一编号 `number`，公开号与授权公告号仅专利按实际选填。公司党团建设有独立分类和 4 个 MCP 专用工具；公司业务档案预置七个目录创建后是普通可管理目录。PDF 使用多页连续滚动与按需渲染；WinForms 关闭按钮隐藏到系统托盘，显式“退出程序”才结束宿主，资源监控含本程序和整机 CPU。

## 5. UI、构建及验收权威

业务导航、组件和交互依据 [UI_BASELINE.md](./UI_BASELINE.md)；**实际 Explorer 前端组件契约以 [正式前端说明](./src/IPSys.Web/wwwroot/README.md) 与源代码为准**。历史 `UI_COMPONENT_MATRIX.md` 所记的早期组件契约仅供追溯，以当前正式前端源码与回归为准。

现行 Windows 工作流 `.github/workflows/web-windows.yml` 对产品代码与脚本改动执行 Debug 嵌入资源检查、Release 单 EXE、MCP stdio、Node/UI、Edge/HTTP、SQLCipher/HTTP。超过 2 GiB 数据与真实 4 GiB ZIP64 为 opt-in 专项，不随每次文档提交强制复跑。

最近代码 [Windows CI #40162144248](https://github.com/zy19970/IPSys/actions/runs/40162144248) 成功；历史合并 CI [#39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) 成功；大库 VACUUM 专项 [#39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663) 成功；4 GiB ZIP64 实际生成 [#39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) 成功。当前仍属于**已合并开发版本**，不等于安装包正式发布，其他 T01～T09 的未覆盖故障注入和新变更应按影响范围继续验证。

历史技术路线与原因在 Git 提交历史及 `docs/archive/`，现行任务以 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) 为准。
