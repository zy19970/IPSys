# IPSys 技术设计（SQLCipher schema 4 + Explorer）

> 现行状态见 [docs/CURRENT_BASELINE.md](docs/CURRENT_BASELINE.md)：版本、schema、Excel 列数、空间策略与验收口径全部以该文件为准（MCP 工具数不写死，以 `tools/list` 为准）。本文只写不随版本变化的规则；文内若出现具体数字、提交号或 CI 编号，均为当时记录，不构成现行约定。

## 1. 进程与界面架构

`src/IPSys.Web/IPSys.Web.csproj` 以 `net8.0-windows`、`UseWindowsForms=true`、`OutputType=WinExe` 构建。WinForms 启动器控制 ASP.NET Core/Kestrel 的生命周期，HTTP 只绑定 `127.0.0.1` 临时端口，Edge/Chrome 是客户端。关闭浏览器页面不终止程序；网页关库注销当前会话；仅 WinForms 退出结束程序，文件任务须按安全退出机制处理。

正式前端全部位于 `src/IPSys.Web/wwwroot/`：页面源码 `index.html`、`css/app.css`、`js/*.js` 与上传、下载、ZIP64、PDF.js 等能力模块共享这一目录；`tools/bundle.cjs` 在构建时生成 `wwwroot/dist/index.html`、`style.css`、`app.js`，由 MSBuild 按固定逻辑资源名嵌入 EXE。运行时由 `EmbeddedWebAssets` 读取内嵌资源，不向外输出物理 `wwwroot` 文件夹。只修改前端源码，不在 Git 中维护生成的 `dist/`。

本地默认 Windows Release 以 `win-x64` / `PublishSingleFile=true` / `SelfContained=false` 构建为依赖环境的单一 EXE，目标机需 .NET 8 Windows Desktop 与 ASP.NET Core 两种运行时；手动 GitHub Release 同时生成自包含版与依赖环境版。MCP 由同一个 EXE 的 `--mcp` stdio 模式、受授权的同用户命名管道和宿主会话运行，现行 stdio 清单不带 `v2_*` 别名，数量以 `tools/list` 为准；详情见 [MCP_CODEX.md](./MCP_CODEX.md)。

## 2. SQLCipher schema 4 数据身份

一个加密库划分 `company` / `personal` 工作区，后端验证 SQLCipher 加密、工作区、认证 Token、loopback Host/Origin，前端不能代替服务端授权。使用 `ResourceSchemaV2.cs` 定义的 `folders`、`files`、`file_versions`、`file_objects`、`file_chunks`、`folder_file_links` 等真实结构：

| 资源 | 实际约束 |
| --- | --- |
| Folder | 统一分类/业务记录，支持层级、排序、属性、软删除；**Folder 无版本** |
| File | 独立逻辑文件身份、可选元数据、稳定 FileId |
| FileVersion | 附件历史版本，保留原始名称、内容与版本；**只有 File 有版本** |
| FolderFileLink | 记录/分类与 File 的具体归属，可同工作区多位置关联 |
| FileObject / FileChunk | SQLCipher 加密字节与分块；同区可按显式选择复用物理对象 |

项目可以直接存放附件、在内部建立任意层普通目录；业务整记录复制/跨区转移必须保持真实目录层级、版本顺序和全部原件；公司/个人**不能共享相同物理 FileObjectId**。同区共享 FileId 意味着共享版本链；独立 FileId 复用物理字节不共享逻辑版本。查重依据 SHA-256，但是否关联、复用字节或独立保存由用户操作决定，不能静默合并。业务字段见 [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md)。

普通资料目录统一为 `archive_folder`，可直接关联附件、继续嵌套子文件夹，类别、年度、标签、备注选填。项目/知识产权保留各自业务属性；合同资料只有普通目录属性。普通删除目录整树入回收站，永久删除按共享 LinkId 引用清理。普通列表的“更新时间”来自数据库有效更改、附件版本和子目录变更，而非申请日或签约日。

用户当前仍在开发阶段，不安排旧 V1 测试数据库迁移；这一决定**不允许**自动删除、重置或覆盖用户已创建的实际资料库。

## 3. 服务、接口与任务安全

正式业务网页、MCP、固定 Excel、统一搜索、回收站、PDF 预览与导出统一 V2 Folder/File/Link/Version 身份。已有历史 `--smoke` 兼容断言不表示正式程序继续开放旧 V1 业务接口。MCP 的工具清单、同用户授权和会话撤销规则独立于 Explorer 外观。

Agent 工作规范配置位于当前 Windows 用户的 LocalApplicationData/IPSys/agent-guidance.json，独立于数据库与前端 localStorage；内置资源 + 用户覆盖由 AgentGuidance/AgentGuidanceStore 为同一权威来源。GET/PUT/POST 管理接口必须通过现有浏览器会话授权，MCP 工具读取还需本机授权；配置版本与正文哈希供客户端识别旧内容。这些规则对应的自动回归由当前 Windows 工作流检查；第三方真实 Agent 端到端任务必须独立留存本机验证结果，不以旧版 CI 结果代替。

上传/下载为流式，单原件代码容量保护为 **8 GiB**；包含同内容暂存、确认、取消、版本追加和跨区任务绑定。可恢复性、并发文件任务锁、真正的任务成功终态、失败可见以及删除事务回滚为硬约束。回收站永久删除按最后引用关系回收物理对象，删除后 SQLCipher 文件体积不保证立即缩小；设置页默认执行 SQLCipher INCREMENTAL 原地回收：新库采用 `auto_vacuum=2`，每批 256 页，预检数据库磁盘剩余 `256 × page_size + 64 MiB`，前后执行 `integrity_check`，回收允许批次之间取消且不会回滚已完成批次。旧 NONE 模式库禁止原地回收。完整 `VACUUM` 仅由后端 `full:true` 作为应急路径提供，才要求库文件大小两倍加 128 MiB 的空间预算。回收进度及结果必须取自真实任务状态，不能展示伪造的百分比。

ZIP 与文件夹式导出支持 ZIP64；正式 ZIP 生成代码在 `src/IPSys.Web/wwwroot/export.js`。产品 Node 生成器已写出真实超过 4 GiB 的 ZIP64 并验证物理结构；专项 CI 使用可重复流/写入适配层，**不等同于第三方解包器或系统保存窗口的自动端到端验证**。用户另行确认本机人工验收通过，详见 [TESTING.md](./TESTING.md)。

## 4. 当前业务接口与导出一致性

Excel 模板由 `ExcelLedger.cs` 统一维护：项目 **11 列**、知识产权 **19 列**、档案/资质/党团 **6 列**（名称、类别、备注、标签、年度、所属目录）、综合资料 **6 列**（名称、类别、备注、标签、年度、所属目录）；旧档案 4 列及综合资料 1/2/3 列不再作为现行导入格式。导出按 `all|filtered` 在服务端完整数据集筛选，知识产权支持业务类型筛选，不以页面搜索 60 条显示上限截断。合同没有独立 Excel。

知识产权现行为十种固定类型：全部类型使用统一编号 `number`，公开号与授权公告号仅专利按实际选填。公司党团建设有独立分类和 4 个 MCP 专用工具；公司业务档案预置七个目录创建后是普通可管理目录。PDF 使用多页连续滚动与按需渲染；WinForms 关闭按钮隐藏到系统托盘，显式“退出程序”才结束宿主，资源监控含本程序和整机 CPU。

## 5. UI、构建及验收权威

业务导航、组件和交互依据 [UI_BASELINE.md](./UI_BASELINE.md)；**实际 Explorer 前端组件契约以 [正式前端说明](./src/IPSys.Web/wwwroot/README.md) 与源代码为准**。历史 `UI_COMPONENT_MATRIX.md` 所记的早期组件契约仅供追溯，以当前正式前端源码与回归为准。

现行 Windows 工作流 `.github/workflows/web-windows.yml` 对产品代码与脚本改动执行 Debug 嵌入资源检查、Release 单 EXE、MCP stdio、Node/UI、Edge/HTTP、SQLCipher/HTTP。超过 2 GiB 数据与真实 4 GiB ZIP64 为 opt-in 专项，不随每次文档提交强制复跑。

自动回归、专项大文件与 ZIP64 生成、Windows GUI 人工操作以及 GA 发布分别需要与代码提交 SHA 对应的证据。历史 CI 的通过结论应按对应提交在 [GitHub Actions](https://github.com/zy19970/IPSys/actions) 查阅；最新运行及实际阻断状态统一见 [CURRENT_BASELINE](./docs/CURRENT_BASELINE.md)。GA 前的 T01～T09 风险验证不能由普通构建结果代替。

历史技术路线与原因在 Git 提交历史（`git log -- docs/archive/`），现行任务以 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) 为准。
