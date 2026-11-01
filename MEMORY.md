# IPSys 项目持续记忆

## 项目定位与当前阶段

IPSys 是 Windows WinForms 启动器 + 本地 Web Explorer 界面 + SQLCipher/SQLite 文件与业务档案管理系统，带本机 MCP 和按需加载的 Agent 工作规范。核心模块包括企业资质、业务档案、公司项目、知识产权、综合资料、个人资料及党团建设等。文件用 FileId/LinkId/版本区分，可共享关联并经 MCP 操作。

截至 2026-10-31，用户已将现阶段功能视为可投入日常使用的阶段性稳定版本，后续主要按真实使用反馈开展精修，核心逻辑尽量保持冻结；重要改动必须定向回归并核对 Windows CI。此前 Agent×MCP 改造的 Windows CI #433（提交 ecb043c4）成功，但不等于所有 GUI 项目均人工验收。

## 已确认的需求与执行约束

1. 仓库：https://github.com/zy19970/IPSys 。实质性工作先遵守 `zy19970/AIGT-templates/AGENTS.md`、`AI_RULES/GIT_OPERATIONS.md` 和 `AI_RULES/MEMORY_PROTOCOL.md`，按项目内自身文件归档每轮对话。
2. 优先统一复用组件，避免不同入口和不同模块存在不必要的字段规则、显示/编辑、导入导出、MCP 行为不一致。
3. 不得把静态代码疑点称为已实机复现；尤其写入覆盖、数据迁移及文件历史安全需先保留证据。
4. 知识产权年份依既定需求仅取申请日年份；文件有版本，文件夹无版本。
5. 2026-10-31 用户明确要求：针对截图中“知识产权状态列表为已登记，编辑下拉为请选择”，举一反三全面梳理所有类似情况，**先审核列清单，不修改业务代码**。

## 2026-10-31 静态审核结果及待处理

源码基线 ecb043c4157339cb731f74ef0cbfe96b20ac5cd5。已确认：`src/IPSys.Web/wwwroot/js/forms.js` 中 IP 状态 select 初始 options 为空，随后 sync 从 DOM 取空值，覆盖有效 r.status，若不重选直接保存可能把状态置空（P0）。`src/IPSys.Web/wwwroot/js/app.js` 知产详情将 rightHolders 以“负责人”显示而非“当前权利人”。`general` 表格含备注列但对应数据与编辑仅有 title。固定 Excel 中项目、知产、档案 update 都会整行重写指定可编辑元数据，空单元格有覆盖非空的风险；公司业务档案的类别用于 Excel 建目录/判重，但表单修改类别不移动资料所属目录；档案 Excel 不含 year，跨库重新导入无法还原年度。其他口径差异或候选风险：知产 UI 14 字段与 Excel 19 字段的覆盖范围不同（隐藏字段由表单 ...r 保留）；statusTone 对已登记/已注册/已发布等状态采用中性灰；项目空状态在服务器默认“筹备中”；项目年份优先起始日期而通用日期标签优先结束日期；附件共享显示名可能不同于文件全局名称；整行保存并发缺少字段级条件更新。参考本轮记录以区分确认与待实测。

**第一批实施（2026-10-31）**：用户明确要求处理知识产权状态回填及 Excel 更新空格覆盖；代码提交中对 IP 动态选项使用原已存状态、切换类型兼容校验；Excel 的项目/IP/档案更新已有记录采用“空白保留原值、非空覆盖”，Excel 弹窗和用户手册明确语义，新增 JavaScript 动态回填测试、HTTP IP Excel 稀疏更新测试、项目/档案纯合并回归。本次产品代码提交 c2ec3de782d01d6fbef7044f09bedcd19d5ad1de，Windows Actions #434（run 41203049759）已完成且全部必测 SUCCESS，验证 SHA 与该代码提交一致；仅可选 4GiB ZIP64 生成跳过。未操作正式数据库。第二批字段语义与第三批 UI 口径暂不改动。

**第二批实施（2026-10-31）**：用户“进行第二批”，产品代码提交 8515e15fb963fc8b24cd63b169b3395174e33831，知识产权详情“当前权利人”标签统一；综合资料备注贯通表单/数据库/UI/搜索/Excel/MCP，旧数据缺备注默认空；档案 Excel 新增年度与独立所属目录路径支持多级目录，类别仍是单独业务属性，更新按名称及文件夹匹配且不移动目录；旧四列档案和旧单列综合资料 Excel 可兼容导入。定向 HTTP/Node 回归已提交，Windows CI #435（41204971917）已完成且结论 SUCCESS，CI 测试源码 SHA=8515e15fb963fc8b24cd63b169b3395174e33831；Debug 冒烟、HTTP/SQLCipher、Node/UI、Explorer/Edge、Release、MCP stdio、两种单 EXE 启动及图标均通过；可选 4GiB ZIP64 生成跳过。本轮不改变原有文件版本或历史，第三批界面统一待后续。

**第三批实施（2026-10-31）**：用户要求“进行第三批”；将知识产权状态已登记/已注册/已发布/已公开的正向色、登记中/制定中/准备中的进行色统一到共享 statusTone，负向优先级保留；项目新增表单默认“筹备中”、项目年份与通用日期展示以开始日期优先（排序时间仍按结束日期），详情年份与台账年份相同；知识产权属性表单补齐 Excel 19 字段中的五个隐含字段；同 FileId 多 LinkId 的位置显示名、共享文件本体名、版本原件名分别解释，archive/general V2 UI 返回 per-LinkId displayName；原数据库、FileId/LinkId/FileVersion 保持不变。增加前端字段契约、状态色、年份、附件别名与档案 SQLCipher/HTTP 冒烟，产品提交 0f5e5e341a10c1e40b197a5faad9d98daea96304，Windows Actions #436（41207670538）已 completed/success，运行 SHA 与代码提交一致。Debug、Release、Node/UI、MCP、Explorer/Edge、SQLCipher/HTTP、双单 EXE 和图标检查通过；可选 4GiB ZIP64 实体生成跳过。第三批之外的全局并发覆盖保护属于独立架构风险，未擅自重构。

**Windows CI 警告收敛（2026-10-31）**：用户截图显示 Actions #436 注解 23 条 warning（C# 多配置重复 + Node20 Action 平台告警），要求尽可能消除，任何影响稳定功能或编译的变更宁可不做。静态定位 C# 6 处：`NativeMcpSmoke.cs` 1003/1017 可空 JsonNode 数组元素读取，`McpLocal.cs` 392 反射值显式非空转换，`McpPipeSecurity.cs` 60/62 管道 owner 可空及 ACL 判断，`NativeFolderEndpoints.cs` 238 未使用 ex；修为可空安全读取、owner null 必须拒绝、去未用捕获变量。主 Windows workflow 的 checkout/setup-dotnet/setup-node/setup-python/upload-artifact 更新为 Node24 支持的官方 Action 大版本，同时保持 setup-node node-version=22 且关闭新增缓存；手动 Release workflow 不变以避免未验证发布链路的风险。目标是减少可用版本中的告警而不是禁用分析，产品代码提交 50d603d7ef1261d2882a3fd15c91fd4f0a8c7c34，Windows Actions #437（run 41209119948）完成且 success，SHA 与代码一致，零 GitHub warning annotations，C# Debug 为 0 Warning(s)，MCP、Explorer/Edge、SQLCipher/HTTP、双单 EXE 与 artifacts 均成功；日志仍有 setup-node Node22 的两行 punycode DeprecationWarning（非 CI 注解），保留以免为消除外部警告影响稳定性。手动 Release workflow 未改。

**表头全选修复（2026-10-31）**：用户截图指出公司项目台账的“年份”左侧全选框点击后不全选。已核查共用表头的 click 委托与 toggleSelectAll 本身存在且可计算当前展示行，但父级 #content mousedown 处理将 #listHead 当成可框选空白区域，mouseup 无拖动时执行 Drive.clearSelection 并重绘表头 SVG，可能在浏览器派发 click 前改变目标节点，致使点击未生效；首列 grid/排序元素也有层级遮挡风险。拟在 interactions.js 排除表头及交互控件开始框选，head-check CSS 明确堆叠到排序单元上并给 button 语义，新增真实 Edge CDP 物理鼠标回归：公司项目、知识产权、项目附件、全选/取消/半选补全。仅影响 UI 选择，业务删除等仍须用户明确执行；产品修复提交 375ed0e651e8dc3281620ac8da26511bd102c554，Windows Actions #438（run 41210815261）已 completed/success，运行 SHA 一致。真实 Edge CDP 鼠标测试 T-UI-SELECT-ALL PASS：项目 2 条、知识产权 2 条、项目附件 6 条均全选/取消通过，知识产权半选补全通过；Debug 0 Warning(s)、Check Run 注解 0；MCP、SQLCipher/HTTP、Explorer Edge、双单 EXE 与图标均通过。

## 最近会话

- 本轮：2026-10-31 用户截图指出公司项目表头全选按钮点击无效；处理共用鼠标事件冲突并增加 Edge 真实点击回归，详见当前会话记录。

- 2026-10-31 用户查看 #436 注解 23 条警告，要求低风险优先清理，保留高风险项；本轮延续同会话归档。
- 第三批同一会话续记：2026-10-31 用户“进行第三批”；本轮调整 UI 显示及属性填写一致性并核对 Windows CI。

- 同一会话的第二轮：2026-10-31 用户要求“先解决第一批问题”；与截图静态审查记录归并归档，源代码修复正在提交，CI 状态待确认。

- `memory/sessions/2026-10-31-表单列表字段一致性审查.md`（2026-10-31，用户截图与跨模块静态审查，第一轮初始化归档）。

## 2026-11-01：进入操作逻辑精修阶段

用户明确当前只需梳理全仓库和提交记录，后续着重解决日常使用中的小型操作逻辑问题，不开展新一轮整体架构改造。本轮审查实际核对 main 的 666 条提交（2026-10-13—10-31）、784 个文件树条目、2026-10-31 产品代码 375ed0e 和 Windows CI #438 成功。历史第一、第二、第三批字段一致性和表头全选修复均已进入代码并通过各自 CI；不应重新列为未完成的确定缺陷。优先复用 app.js、interactions.js、forms.js、store.js、app.css 的共享逻辑，真实交互反馈驱动最小修复，按影响范围补 Node/Edge/HTTP 测试并核对 Windows CI。当前未修改业务源码也未做新编译。README/DEVELOPMENT_PLAN/UI_BASELINE/TESTING 部分开头仍引用 10-25 旧产品 SHA，属于文档基线滞后，未来有明确文档任务时定向同步；不可当成新产品缺陷。

最近会话：`memory/sessions/2026-11-01-操作逻辑精修阶段仓库梳理.md`；已归档轮次：第一轮。

## 2026-11-01：知识产权按类型筛选（已提交代码，CI 待确认）

用户截图显示知识产权台账“筛选”按“已登记、已发布、已授权”等状态列项，明确要求改为专利、软件著作权、企业/行业/国家标准等**知识产权业务类型**。根因在 `interactions.js` 对台账通用使用 biz.status，而 IP 业务类型已存在 `store.js` 的 biz.typeName 且 `forms.js` IP_TYPES 定义十种类型。本轮针对 k:ip 采用十种类型和“全部类型”筛选，独立 ipTypeFilter 只作用 IP 页面，其他台账状态筛选继续保留。Excel filtered 导出增加可选 IpType 字段，由后端对完整工作区 IP 记录按 IpInput.IpType 精确匹配，mode=all 与旧显式 ID 导出维持原状；补 Node 交互测试、SQLCipher/HTTP 导出类型测试及用户指南。并未更改资料库结构、文件或版本。CI 结果须单独按实际 Actions 核验。

最新会话文件：`memory/sessions/2026-11-01-操作逻辑精修阶段仓库梳理.md`，本轮第二轮已归档。

**知识产权类型筛选最终验证补记（2026-11-01）**：产品提交 `68997736664a1e42346f1d0f31d52d1c12d5aa91`，Windows Actions #439（run `41273470858`）已 completed/success，run HEAD 与代码提交一致。26 个成功步骤，包括 Node 真实菜单/列表及 Excel 参数动态回归、Debug/Release、Edge、SQLCipher/HTTP Excel 按类型筛选、新旧单 EXE 启动及上传 artifacts；0 个失败步骤（另有可选 ZIP64 路径按工作流配置跳过）。本轮仅自动回归通过，用户本地旧 EXE 需更新后才能看到新筛选。

## 2026-11-01：详细信息侧栏默认展开（本轮修改）

用户截图要求右侧“详细信息”默认打开。原代码 `app.js` 根据 `window.innerWidth > 1200` 决定初始开关，而且 `enterContext()` 进入任意台账时强制折叠。本轮将无保存偏好时的默认值改为展开，并去掉导航到业务台账时自动关闭；用户已在设置中明确保存 `ipsys.detail=0` 的关闭偏好继续优先，手动开关仍有效，首页独立概况区不重复显示侧栏。新增 Node 动态测试验证窄/宽屏默认值、显式关闭偏好、导航保持用户选择并照常清除旧筛选，不涉及数据库和文件版本。CI 及产品 SHA 以后续实际 Actions 核对。

最近会话：`memory/sessions/2026-11-01-操作逻辑精修阶段仓库梳理.md`，第三轮。

**详细信息默认展开 CI 首次回归及测试修复（2026-11-01）**：产品提交 `f67fc8181afc5857e04fb322f952f8c2e2b69e79` 触发 Windows CI `41274179983`，Debug 编译和前序回归成功，但 `Verify UI and capability smoke tests` 步骤失败。日志显示新加测试在 `part(app,"const Prefs = {", ...)` 中使用包含 LF 的固定结束标记，Windows checkout 的 CRLF 导致找不到区域，属于**测试代码的换行符兼容缺陷**，不是已证明的产品 UI 失败。改用无换行依赖的分隔符匹配，提交后按后续 CI 结果单独验证。不得将失败 run 记为 PASS。

**详细信息默认展开最终 CI 验收（2026-11-01）**：产品源码修改提交 `f67fc8181afc5857e04fb322f952f8c2e2b69e79`，修复测试 Windows CRLF 匹配后提交 `1192d11b5e95a3fc8ce33fb500fc4d4990ff728f`。最终 Windows Actions `41274418407` 已核对 `head_sha=1192d11...`、completed/success，26 成功、0 失败（默认未启用可选 ZIP64 大文件实体生成），包含新增侧栏默认值与跨目录回归、Explorer Edge、SQLCipher/HTTP、Debug/Release、两种单 EXE 启动与构建产物上传。用户本机旧 EXE 必须重新编译或更新才能看到改动。已归档首次失败 CI `41274179983` 的真实测试行尾错误，不将其错误记为成功；未操作用户正式资料库。

## 2026-11-01：右键菜单下载范围与多选不一致（待用户确认修改）

用户截图中知识产权页选中两项，右侧“详细信息”下载可以打包两项，但右键“打包下载”只导出右键所在的一项。已在当前 main 静态代码确认：`src/IPSys.Web/wwwroot/js/interactions.js` 的 `bindDetail` 和底部多选工具栏使用 `downloadNodes(Drive.selectedItems)`，而 `showItemMenu` 已建立 `actionItems = Drive.selectedItems.filter(n => isTrashNode(n.id) === trash)` 并用于批量删除，却将右键下载单独写成 `downloadNodes([item])`；导致已多选时只打包本项。服务层 `downloadNodes` 已支持单附件直接下、目录与多条记录 ZIP，`bridge.js` 的 `exportNodes` 也接收多节点，此问题为参数范围不一致，暂无证据表明 ZIP 引擎故障。

已提出最小修改方案但**未执行产品代码修改**：将右键下载参数改为 `actionItems`，并根据选中数量与节点类型调整显示“下载/打包下载”；右键点击已选中项保留多选，右键点击未选中项使用现有单选规则；单文件下载、单文件夹 ZIP、多选文件夹 ZIP、混合选择，以及底部与详情按钮一致性增加 Node/Edge 回归。经用户确认或明确要求实施后再修改，本轮仅分析与 Memory 归档。最近会话：`memory/sessions/2026-11-01-操作逻辑精修阶段仓库梳理.md`；已归档至第四轮。

## 2026-11-01：公司综合资料与党团建设扩展多级目录（方案待实施）

用户要求“业务档案、综合资料，党团建设这些呀，应该都和这个业务档案一样。它能文件夹下套文件夹，文件夹下套文件夹，而不是文件夹下套一个文件夹。接着就是只能上传资料”。核对实际 main `5e633737`：业务档案实体目录 `archive_folder/achievement` 已可递归；公司党团建设目前是 `archive/party` 顶级记录、综合资料是 `general` 平铺记录，SQLite V2 CHECK 和 parent triggers 也禁止这些记录挂到多级目录。因此不是仅放开 UI 按钮即可修复，不能擅自触碰用户已存数据库。形成完整实施方案 `docs/COMPANY_MULTILEVEL_ARCHIVES_PLAN_20261101.md`：同一实体目录机制扩展 company/party、company/general，任意目录可新建下级目录/资料，资料记录内上传附件，保留既有记录和文件历史；协调 SQLCipher 安全结构更新、文件夹 API、前端树/表单/菜单/重排、导出/Excel/MCP与多层级测试。本轮**没有修改业务源码、没有运行 CI**，属于结构性变更，需要按整套方案施工与验证。最近会话第六轮。

## 2026-11-01：多级目录范围扩展至个人工作区（方案更新，待实施）

用户新提出：个人工作区除“知识产权与著作”“科研与合作项目”等专用模块外，其余资料类模块也采用公司业务档案式的无限级文件夹。已核对当前 `store.js` 个人六大模块：`certificate` 身份与资质、`ip` 知识产权与著作、`project` 科研与合作项目、`achievement` 成果与奖励、`academic` 学术与社会活动、`general` 其他资料。建议纳入四个资料模块，保留 IP 和项目专用逻辑。旧 `archive_folder` 限 company/achievement，不能仅改前端，需要统一按 workspace+scope 扩展 SQLCipher 目录检查与触发器、NativeArchiveStore、UI 树、导出与 Excel/MCP，保留两工作区现有平铺记录、原件及 ID。既有 `docs/COMPANY_MULTILEVEL_ARCHIVES_PLAN_20261101.md` 已扩展为公司+个人统一实施方案并保留文件路径；没有修改业务源码或运行 CI。此轮具体范围为建议，待执行前与用户最终确认，不自动将“等等”推断为更多模块。最近会话本轮追加第七轮。

## 2026-11-01：七模块目录一次性开发获确认，但本轮执行受阻

用户明确认可公司三模块与个人四模块一次性实现共享的无限级目录，并指出仍处测试阶段，不要求旧数据库兼容迁移。已按 AIGT 规则复核 `main=54651bd0` 和当前实施方案；新库需要同步调整 SQLCipher V2 父级 CHECK/触发器、FolderModel、NativeArchiveStore、NativeArchiveOrder、Folder HTTP API、Explorer 树、表单与菜单、ZIP/Excel/MCP 以及回归。准备了六个后端文件的临时 Git Blob 草案，但**没有创建 Git Tree、Commit 或更新 main**。构造四个前端文件修改时，开发工具安全检查阻止写入，停止后续写操作，不规避限制，不提交无法集成验证的后端半成品。已核实 main 仍是 `54651bd0b53c76e9b1dfdd7fcce83c66e5ca26c7`，没有源码变更、没有新 CI，也没有处理用户测试数据库。后续要完整实现需在可授权执行与本地编译/测试的开发环境开展整套集成，不应把此轮描述为已经实现。最近会话已记录本轮为第八轮。

## 2026-11-01：七模块目录统一开发重新启动（待 CI 验证）

用户“继续吧”，明确继续上轮获确认的一次性实现。遵照 AIGT-templates 基础规则及项目旧 Memory；本轮重新开始通知：office-renderer/wechat-webhook#1939。新库不做旧测试数据库迁移。已编制 SQLCipher schema、NativeFolder/Archive/Order/Ui、Explorer（store/app/interactions/forms）、Excel 目录导入导出、MCP 创建/移动操作、Node 树和右键、C# HTTP 新作用域回归的完整修改候选文件；**尚未取得 CI 结果**，不能声称已完成产品发布或本机测试。之前中断原因是前端长脚本调用被平台检查阻断，本轮改为按可审核文件分段准备修改，未覆盖历史记录。

## 2026-11-01：修复七模块目录 CI 阻断，EXE 下载恢复

用户本轮明确“那你把这个错误取消掉，有个错误没办法下载生成的exe”，目标是完整 Windows CI 成功并有可下载 EXE。分析失败 run `41280193769`，发现 `explorer-p2-interactions-smoke.cjs` 的 VM 测试桩缺失 `VaultStore.ws`，实际断言 URL 变成 `/api/v2/folders/undefined/archive_folder/8?section=undefined`。修复提交 `1faac4d022e013821ec62dc4f08b56e687718eda`：给 VM 指定公司工作区，新增个人 academic 模块的目录重命名测试。第一次复测 run `41281011339` 前端已通过 Explorer P2，但 Excel 静态断言仍匹配目录改造前的 `DirectoryPath(db,parentId)`；第二次修复 `040a2c272a91fc1e1422b808741d1c099ff6cb79`，改为验证 `DirectoryPath(db,workspace,kind==general?general:section,parentId)`，同时确认 FolderMap 的工作区与模块作用域校验不被弱化。最终 Windows Actions `41281238523` 与产品 SHA 对应，`completed/success`，26 个成功步骤、0 失败。已通过 Explorer P2、全部 Node/UI、Edge/HTTP、SQLCipher、Windows Debug/Release、双单 EXE 启动及图标，并实际上传 3 个产物：`IPSys-Web-win-x64`（framework-dependent）、`IPSys-Web-win-x64-self-contained`（推荐）、`IPSys-Explorer-V2-Retest-41281238523-1`（验收证据），均已核实 `expired=false`。下载入口：`https://github.com/zy19970/IPSys/actions/runs/41281238523` 的 Artifacts。未手动发布 GitHub Release；资料库未更改，源码本轮仅修复测试一致性。最近会话记录新增第十轮。


## 2026-11-01：综合资料新建下级目录报资料结构约束（疑为旧测试数据库）

用户本轮附截图（企业工作区“综合资料”，输入目录名称 `123456`）并问“这是为什么？”，报错是“资料结构约束不允许此操作，请检查名称、父级目录和文件关联”，左下角显示总/已用约 184.6 MB，说明正在使用已有内容的资料库。实际对比 GitHub 当前 `src/IPSys.Web/ResourceSchemaV2.cs` 与七模块修改前提交 `742abf35`：旧 schema 的 `folders` 表 `CHECK(kind!='archive_folder' OR (workspace='company' AND section='achievement'))`，新 schema 已允许 company/general、party 和 personal 四 scope；`NativeArchiveStore.Create` 根据新版 `section` 将新目录写入 `folders`，旧数据库的建表 CHECK 不会因更换 EXE 自动改变。API `NativeFolderEndpoints.FolderConstraintMessage` 确实将非同名唯一约束的 SQLite 约束错误映射为截图所示中文。当前 `Vault.ValidateSchema` 只要求 V2 版本与关键表（并运行此前 party 兼容逻辑），未全面升级此次七模块旧 CHECK；此次用户先前明确“测试阶段，不需要考虑旧数据库兼容迁移”。CI `41281238523` 在**新建临时 SQLCipher 数据库**通过公司 general 三层创建和 26 项全流程，不代表老测试库的结构已兼容。诊断结论：**旧数据库约束是最可能原因，尚未取得用户本机数据库文件或 sqlite_master 原始 SQL 来做绝对确认**。建议：先关闭应用并备份原加密库；另建新测试库执行相同操作验证；如果必须保留当前 184.6 MB、111 条 IP 等资料，则需明确选择独立的原库结构升级或完整无损迁移，不可直接删除或覆盖已有库。用户本轮仅询问原因，未授权调整源码、迁移或删除数据库，故未更改产品代码或新建构建。最近会话更新至第十一轮。

## 2026-11-01：用户确认更换新测试数据库

继“综合资料新建下级目录报数据库结构约束”诊断后，用户回复“明白了，我用的就数据库，我换成新的吧”。结合前文明确为旧数据库，用户决定直接使用新版 EXE 创建独立新测试数据库，不要求继续为旧库编写结构兼容迁移。建议保留并备份约 184.6 MB 的已有测试资料库，不直接覆盖/删除，在全新路径建库验证公司综合资料三级目录、党团建设和个人模块。尚未实际操作用户本机数据库，故未宣称验证通过。本轮仅记录用户决策。

## 2026-11-01：用户补充不同名目录同样无法删除（确认通用非空目录删除限制）

用户追加原话：“不是同名也会出现这种情况”。据此纠正本轮最初把同名目录作为主要异常线索的解释：**与同名无关，源码已明确对所有非空普通目录一律拒绝删除**。`src/IPSys.Web/wwwroot/js/interactions.js` 的 `deleteArchiveFolder(node)` 判断 `(node.children||[]).length` 非零即 toast“目录内仍有下级资料或目录，请先整理内容”并返回，后端 `NativeArchiveStore.SetDeleted` 也通过 NOT EXISTS 子目录及 file links 防止删除非空目录；列表“1 项”和详情“包含1项”都是同一前端目录树的 children。无论不同名二级目录、同名二级目录还是业务资料记录，只要有子项就会提示。现在不是证明数据库自循环的证据，截图所示是旧的“空目录才允许删除”策略在新七模块多级结构里暴露出易用性缺陷。建议后续将七个资料模块改为用户熟悉的整棵目录删除，但正式实施前需明确软删除/回收站恢复语义、子记录与附件及文件共享引用、版本保护、取消/进度与事务一致性；不能只移除前端判断或者对非空目录直接执行物理 DELETE。用户本轮是在澄清原因，尚未明确授权执行递归删除功能改造；无业务源码修改或 CI。已向用户修正解释，最近会话更新到第十三轮的补充。

## 2026-11-01：七模块目录整树回收与共享关联永久解绑（待 CI）

用户明确此功能必须加上，确认普通删除先进入回收站、永久删除才彻底清理，建议共享文件采用“断开共享”的方式。核对现有 V2 FileId/LinkId/FileVersion/FileObject：普通删除只标记 archive_folder 根目录 deleted=1；所有下级目录、资料及附件链接不改变，以保证回收站恢复时保留层级。整树永久删除时先递归找齐后代及所有 LinkId，复用 RecycleStore.PurgeFileLink 按工作区与 LinkId 解绑；只有 FileId 不再拥有任何有效或可恢复的 LinkId 时才清理版本，底层物理内容对象只有无人引用才回收。修改范围为 NativeArchiveStore、NativeArchiveUiEndpoints、RecycleStore、Explorer 删除与回收站、MCP 回收接口、使用手册和 SQLCipher/HTTP/Node 定向测试；所有数据库修改都在用户本机资料库之外的临时测试库验证。已发 [notify] 开始 https://github.com/office-renderer/wechat-webhook/issues/1955。此前“空目录只能直接永久删除”的规则由本次新实现替代；测试阶段不要求旧库迁移。本段在 CI 前起草，不宣称本轮产品已通过 Windows 构建、上传新的 EXE 或执行本机删除；测试结论与提交哈希以 GitHub 后续核验为准。
