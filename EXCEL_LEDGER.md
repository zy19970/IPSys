# IPSys P1 Excel 台账：当前实现与验收（2026-10-15）

> **2026-10-16 当前状态**：知识产权、项目与合同的 V2 固定 XLSX 已接入当前网页；合同仅只读导出，项目导入/筛选用 FolderId，主链路已通过 CI #38848010379。N2-04 已新增档案固定四列（资料名称/类别/备注/标签）、综合资料单列（资料名称）原生 Excel 导入/导出，按 V2 archive/general FolderId 去重并保持关联文件及其版本。公司业务档案 Excel 新建时类别需匹配存在的一级系统根；既有深层档案更新保留原目录。代码 [48bdd4a](https://github.com/zy19970/IPSys/commit/48bdd4a62cb8232619fa381007103ee1b065da80)、[1133653](https://github.com/zy19970/IPSys/commit/11336537185dde127b4efe2221d98d784565cbd4)，自动验收 [CI #38852697271](https://github.com/zy19970/IPSys/actions/runs/38852697271) **success**。**当前档案与综合资料网页仍调用旧 Excel，待 N2-04 页面对接后才能用于用户日常操作；桌面 Excel 人工验收未完成。**

## 1. 固定列与现有网页接入范围

| 模块 | 固定列 | 导入 | 导出 |
| --- | --- | --- | --- |
| 项目 | 11列（名称、类别、编号、负责人、单位、起止日期、状态、辅助分类、备注、标签） | **V2 已接入**，按项目编号或名称+类型去重，skip/update/create | **V2 已接入**，按 FolderId 筛选导出 |
| 知识产权 | 20列（类型、状态、申请/公开/公告/登记及辅助分类等） | 支持 | 支持当前筛选/选中和全部 |
| 公司企业资质、公司业务档案、个人身份与资质、个人成果与学术资料 | 4列（资料名称、类别、备注、标签） | 支持 | 支持，严格按所属工作区与 `section` |
| 公司综合资料、个人其他资料 | 1列（资料名称） | 支持 | 支持 |
| 合同 | 9列（合同名、所属项目、合同编号、签订日期、金额等） | **不支持**（必须从所属项目内创建） | **V2 只读导出已接入**，仅包含有效父项目的合同 |

**重要**：企业资质网页表单为了操作简洁仅显示「名称、附件、备注」，但现行固定 XLSX 档案模板仍有类别/标签列以兼容历史资料。这不是要求网页显示这两个字段，也不允许导入时破坏旧元数据。固定 Excel 列与 UI 隐藏列相互独立，具体以 [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) 为准。

## 2. 操作及边界

已接入 Excel 的模块可从对应「新建」弹窗下载固定模板或导入 XLSX；项目/合同现有 V2 网页在新版 Excel 接入前暂不使用旧台账入口。台账「导出」菜单提供结构化 Excel，与附件文件夹/ZIP 是不同功能。项目/IP/企业资质等具有勾选能力的页面，导出优先使用**当前可见的勾选记录**；未选则使用当前筛选结果；其它模块按筛选及所属栏目输出，不跨工作区。合同不能通过 Excel 新建或导入附件。

实际文件是离线 OpenXML XLSX（不要求本机安装 Excel），编号和带前导零文本保持原样，日期采用 `yyyy-MM-dd`。每次导入最多 **8 MiB、5000行**，表头或结构错误拒绝整个文件；支持「跳过重复」「更新已有」「重复另建」与取消。合法行继续保存、错误行报告原始行号、最多展示300条详细错误。

重复判定：项目优先项目编号，否则名称与类别；知识产权优先申请号，否则登记号，否则名称与类型；其它模块按 `ExcelLedger.cs` 当前逻辑执行，不能臆造等价规则。导入时仍执行现有服务端工作区、类型、状态、日期和字段验证。

## 3. 本机人工验收要求

在**可丢弃加密测试库**分别验证公司/个人各模块：下载模板，填入中文、长名称、带前导零编号、空金额/0.00 金额、合法和错误日期；在桌面 Excel 打开、保存、导入，确认新增/更新/跳过/失败数与数据库一致。核对错误行继续处理、跨工作区隔离、筛选/勾选导出完整覆盖匹配记录。校验公司资质旧资料 `category/tags` 在简化编辑表单下不丢失，合同只读导出而不能经 API 导入。实际结果记入 [WEB_TESTING.md](./WEB_TESTING.md)，未验证前仍为「自动通过/人工未测」。
## N2-03-04 知识产权现有网页 Excel 入口（已通过 Windows CI 验收）

现有 `app.js` 的知识产权 `exportExcel`、`importExcel` 及弹窗模板下载已经改用 `/api/v2/excel/{workspace}/ip/*`。勾选和筛选使用 V2 FolderId，同一页面的附件列表及上传/下载使用 V2 FileId/LinkId/版本；不将旧 `/api/ip`、旧 `/api/excel/ip` 身份混入当前台账。最终 CI [#38828523508](https://github.com/zy19970/IPSys/actions/runs/38828523508) 已确认 CI 成功。桌面 Excel 人工打开保存及其它业务模块 Excel 的迁移另行验收。

## N2-03-03 知识产权 V2 原生 Excel 接口（2026-10-16）

[功能提交 7a7d98a5](https://github.com/zy19970/IPSys/commit/7a7d98a54283174f94f3e7fb67bef2483cc0faf3)、[Windows CI #38825202078](https://github.com/zy19970/IPSys/actions/runs/38825202078) **success**。`/api/v2/excel/{workspace}/ip/template`、`export`、`import?policy=skip|update|create` 与旧 Excel 固定20列工作簿兼容，直接访问 V2 `folders.kind=ip/attributes_json`，导出 `all` 或以 V2 FolderId 作为 `filtered` 的 `ids`；8 MiB/5000 行上限与原申请号/登记号/名称+类型去重策略保持。HTTP/SQLCipher 验证来源固定 Excel 文件导入、V2 原地更新不改变 IP FolderId 或已关联 FileId/版本/原件字节、个人工作区独立导入属性不复制公司附件、无旧表双写、异常工作簿拒绝。**此为 N2-03-03 当时的原生接口验收记录。现有知识产权网页随后已于 N2-03-04 接入 V2 Excel；旧 `/api/excel/{workspace}/ip/*` 属过渡期路由，不可混用新 FolderId，桌面 Excel 实机仍待 N4。**

## 项目和合同 V2 Excel 最新验收（2026-10-16）

`/api/v2/excel/{workspace}/project/template|import|export` 与 `/api/v2/excel/{workspace}/contract/export` 已通过 [Windows CI #38848010379](https://github.com/zy19970/IPSys/actions/runs/38848010379)。新版项目导入更新只改变当前 FolderId 的业务属性，不丢失附件版本；合同仅只读导出，不能通过 Excel 创建或导入；现有网页不会把新项目合同 ID 交给旧 Excel 路由。下面 N2-03-07-01 文字是当时的历史边界，不代表当前禁用状态。

## 项目和合同 Excel 与 V2 文件夹的边界（N2-03-07-01，历史记录）

项目、合同现有网页已切换 V2 FolderId，并通过 [Windows CI #38836041449](https://github.com/zy19970/IPSys/actions/runs/38836041449) 自动验收。**旧 /api/excel/{workspace}/project 与 contract 仍访问旧项目台账的独立 ID**，不可用于新版网页；项目的旧 Excel 导入模板与导出在当前 UI 中明确暂停，合同旧 Excel 导出同样阻止调用。下一批 N2-03-07-02 接入以 V2 FolderId 为选中 ID、合同必须归属 V2 项目的固定列 Excel 服务，原件文件版本不能因为台账更新而丢失。旧测试资料库无需迁移、回填或兼容。
