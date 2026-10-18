# IPSys UI 共用组件与调用方矩阵

> 适用基线：SQLCipher V2、WinForms 启动器 + 本地浏览器的现行 UI。本文记录真实 `src/IPSys.Web/wwwroot/app.js`、`style.css` 的共用契约，不以 `demo/ui-preview.html`（旧 V0.1）作为实现依据。UI 改动必须遵循仓库规则文件和 `UI_BASELINE.md`。

## 目标与边界

同一种外观、操作及状态反馈只在一个公共实现中维护；业务模块保留自己的字段、动作权限和导出范围。不得为“合同”“项目”各复制一份相同的 HTML/CSS，也不得为了视觉统一改变 FolderId/FileId/LinkId、版本、SQLCipher、MCP 或权限约束。

## 共用组件矩阵

| 共用组件 | 统一代码／样式入口 | 必须覆盖的使用方 | 业务差异与禁改边界 | 回归验证 |
| --- | --- | --- | --- | --- |
| 列表工具栏（ListToolbar） | `compactBusinessListToolbar()` + `normalizeUiComponents()`；所有 `.compact-ledger-toolbar` 与 `.certificate-toolbar` 都注册 `ui-list-toolbar`，子节点统一为 `ui-toolbar-title`／`ui-toolbar-filters`／`ui-toolbar-actions`，在 `style.css` 由一套三栏网格和 1440px／860px 响应式规则控制 | 公司项目、合同、知识产权、各个人台账、公司业务档案、企业资质、综合资料列表 | 企业资质筛选字段、档案层级、项目类型/状态和导出功能可以不同；宽屏标题/搜索/操作同行，窄屏统一按槽位依次换行，不能让一个业务页面用独立 `flex-basis` 挤出额外空白行 | `ui-main-smoke.cjs` 与 `ui-component-contract-smoke.cjs` 检查三个共用槽位及响应式规则；Edge/Chrome 实际视觉比较 |
| 数据表格（DataTable） | `decorateLedgerControls()`、`ledgerScope()`、`syncLedgerSelection()`、`ui-data-table`、`ui-table-viewport` | 公司项目、合同总表及项目内合同、知识产权、公司业务档案混排、个人多记录台账、企业资质、回收站 | 企业资质专用多选与审批字段、回收站永久删除、档案目录／记录混排不应强行改成普通记录 | UI DOM 控件测试、数据库持久排序检查、列宽与横向滚动检查 |
| 详情标题与基本信息（DetailHeader / InfoGrid） | `heading()`、`section()`、`infoRow()`、`ui-section-header`、`ui-info-grid` | 项目、合同、知识产权、业务档案、综合资料、个人记录 | 字段及区块数量按业务字典；合同须有所属项目；项目可显示状态和负责人 | 基本信息 HTML、返回入口、字段展示与响应式检查 |
| 附件（AttachmentPanel / FileRow） | `attachmentSectionTitle()`、`attachmentHeaderActions()`、`attachmentFileRow()`、`attachmentFileGroup()`、`businessAttachmentList()`、`decorateAttachmentRows()`、`syncAttachmentSelection()` | **项目、合同、知识产权、归档资料、综合资料五类均必须覆盖** | IP 才有材料类别；归档资料保留字节复用选项；综合资料用独立上传入口；文件版本、共享／移除权限与业务归属不能改变 | 五种记录都渲染真实文件行、历史版本、多选、右键、预览；不能重复出现内外两套工具栏 |
| 分类／导航卡片（NavigationCard） | `archiveCard()`、`realArchiveCategoryCard()`、`dashboard()` 及 `ui-navigation-card` | 工作台、个人资料分类、公司业务档案根分类、综合资料记录卡片 | 根分类只用于进入目录，不出现下载／多选；记录卡片仍可进入详情 | 导航与焦点测试、窄屏卡片布局 |
| 多选／排序（Selection / Ordering） | `syncLedgerSelection()`、`syncCompanyCertificateSelectionUi()`、`syncAttachmentSelection()`、公共 `ui-selection-count` | 项目、合同、知识产权、企业资质、归档资料、附件及回收站 | 选中范围依业务语义；附件全选默认只含最新版、历史版本可单选；档案目录混排和回收站永久删除单独处理 | 选中／取消／全选／半选、禁用和持久排序，跨页相互不干扰 |
| 导出（ExportMenu） | `quickExportButtons()`、`certificateExportMenu()`、`compactBusinessListToolbar()` 与 `ui-export-menu` | 项目、合同、知识产权、企业资质、档案、综合资料及附件栏 | 项目顶部导出包含合同附件；附件区仅导出已选；Excel 不带原件；空附件不得误报完成 | `export-smoke.cjs`，导出动作路由／原件数量及 ZIP 结构 |
| 弹窗与确认（Dialog） | `index.html` 的 `dialog.input-dialog`、`ui-dialog`、已有原生确认处理 | 项目／合同／IP／归档新增编辑、目录/关联转移、预览、去重确认 | 删除和永久删除使用原有权限、二次确认；专用字段由业务对话框自行提供 | 对话框启停、键盘及危险操作、预览释放 URL |
| 设计标记及响应式（DesignSystem） | `style.css :root --ui-*`，`normalizeUiComponents()`、`uiComponentRoots` | 所有业务列表、详情、附件、导出、卡片、弹窗 | 表格短字段可配置语义宽度；页面过窄在自身表格区域横向滚动，不强制改变卡片与表格的业务展示模式 | Chrome/Edge 1366×768、1920×1080，125%／150% 缩放人工视觉验收 |

## 跨组件稳定接口

1. 页面渲染完成后依次执行 `compactBusinessListToolbar(content)`、`decorateLedgerControls(content)`、`decorateAttachmentRows(content)`、`normalizeUiComponents(content)`、`syncAttachmentSelection()`。公共样式只根据 `ui-*` 标记和公共设计变量维护，不要求每页复制同一段样式。列表的标题、筛选与操作必须分别接入 `ui-toolbar-title`、`ui-toolbar-filters`、`ui-toolbar-actions`；企业资质与分类档案同样使用此契约，不通过私有 flex 宽度控制最终布局。
2. 项目详情「所属合同」表格中的勾选、已选数量及批量删除统一写入带有 `data-ledger-actions` 的分区标题栏插槽，禁止依赖过去已被移除的 `.tabletools`。其它台账仍使用实际列表工具栏插槽。
3. 所有真实记录附件必须调用 `attachmentFileGroup()` → `attachmentFileRow()`，业务范围由 `kind` 决定；综合资料与其它四类使用方共用文件名、图标、版本、勾选、预览、下载、移除的呈现。改变 `AttachmentPanel` 时检查五种记录，不能只修改项目。
4. 附件历史以逻辑原件组为单位，不因上传多个版本而使“附件 n 份”增加；根分类和项目整体导出使用已冻结的业务规则。
5. 公共弹窗只统一外壳和用户反馈；确认与服务端写操作仍必须调用既有接口，不得由样式组件假定成功或越过安全确认。

## 修改与验收流程

1. 在改动前查阅本表“使用方”列，列明此次影响范围及允许差异；功能变更定位到真正的公共函数，而非只追加一个页面专用 CSS 覆盖。
2. 修改共用 HTML 结构、样式或事件后，更新本矩阵，并运行 `node src/IPSys.Web/tests/ui-main-smoke.cjs` 和 `node src/IPSys.Web/tests/ui-component-contract-smoke.cjs`。正式 Windows CI 继续验证 Debug/Release、MCP、SQLCipher/HTTP 与单 EXE。
3. 多个模块应在同一次回归中检查至少：空列表、有文件、有历史版本、多选、右键菜单、上传、不同工作区、窄窗口。在浏览器未真实截图比对时，不把 Node 字符串／DOM 夹具的通过等同于视觉验收。
4. 如一个组件确有业务例外，先修改本表“业务差异”并为例外增加自动检查。不要因为单个页面的临时变化而复制出第二套公共组件。
5. 本文件及 `UI_BASELINE.md` 是现行规范；`demo/ui-preview.html` 仅旧设计参考，不作为线上 UI 验收基准。
