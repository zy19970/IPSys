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

## 2026-11-01：目录整树回收最终 CI 成功、Windows EXE 可下载

用户继续要求“怎么又卡死了，继续推进”。承接已实现的普通目录软删除 + 回收站恢复 + 递归永久删除 LinkId 解绑，本轮从第五轮失败 run `41286511599` 接续。失败原因是 MCP SQLCipher 测试恢复后查询顶层，而被恢复的目录原本属于 “申报与认定” 下级；修复 `NativeMcpArchiveSmoke.cs` 的 list_archive_folders 增加 `parent_id=root`，提交 `dcc2b72d453acd94d92bf8fc7dcc50bc9635f5aa`。第六轮 run `41295668115` 已过 Debug/MCP/Node，但旧版 Explorer V2 HTTP/Edge 复测 `t-http.cjs` T-P1-04 按“非空目录不能删”的旧语义先删除系统目录、不还原就访问其子级，导致 T-P1-05 null.map；修复后按空目录、系统初始目录、非空目录逐一软删→核查回收站→原父子层级恢复→继续排序，提交 `9bffd882562b73657a3f9dc7c90186da13911abc`。最终 Windows CI `41296113671` 对该产品 SHA **completed/success，26 项 success，0 failure**；通过 Debug、UI/Node、MCP、SQLCipher HTTP、Explorer Edge 回归、双模式单 EXE 实际启动、发布和 artifact 上传。已核实 artifacts：`IPSys-Web-win-x64-self-contained` id 13078729777（推荐）、`IPSys-Web-win-x64` id 13080095094、`IPSys-Explorer-V2-Retest-41296113671-1` id 13080135052，均 expired=false。下载入口：https://github.com/zy19970/IPSys/actions/runs/41296113671 。**未手动发布 Release、未操作用户本机资料库。** 本次修复通知：第5轮失败 issue #1964、第6轮重新开始 #1965、第6轮失败 #1966、第7轮重新开始 #1967。最近会话归档第十五轮。

## 2026-11-01：回收站彻底删除成功进度面板自动消失（待 CI）

用户截图回收站空了、左下角已彻底删除1条记录，右下角“彻底删除进度”面板显示共1条、完成和关闭按钮，但长时间不消失；要求超过一定时间自行隐藏。已定向核查 `src/IPSys.Web/wwwroot/js/bridge.js`：原逻辑 `renderPurge` 仅在终态显示关闭按钮，`purgeTrash` finally 继续展示，未调用定时关闭；底部普通 toast 本就自动消失，问题仅在独立进度面板。决定设置 **全批次服务端确认 succeeded 后 4 秒**自动隐藏（仍可立即手动关闭）；失败、取消、未确认和处理中不自动关闭；任何新任务启动时取消旧定时器；已提交任务恢复时如果终态 succeeded 也定时关闭；重复进入完成状态不能无限延长倒计时。修改作用域仅桥接层 UI、专用 Node smoke、Windows workflow 测试映射和用户指南，不触及 RecycleStore、数据库、共享文件物理回收。新增的专用 Node 虚拟 DOM/时钟回归覆盖成功、失败、取消、两批受控删除、手动关闭、新任务旧计时器竞态、恢复已有成功快照。开始通知：https://github.com/office-renderer/wechat-webhook/issues/1969。此段为集成前实施记录，**未取得 Windows CI 结论前不能宣称已生成新 EXE 或测试通过**。

## 2026-11-01：彻底删除完成进度窗自动隐藏，CI 最终成功

在用户截图要求下，已将回收站永久删除成功面板设置为**全部批次实际成功后 4 秒自动隐藏**，失败、取消、未确认保留显示；新批次取消旧倒计时、恢复已完成任务快照也可自动隐藏。首次产品提交 `4ad03e70be62932675a8048a252df45bb679f0d4` 修改 `bridge.js`、`purge-progress-smoke.cjs`、Windows smoke 映射、USER_GUIDE及记忆；首次 CI `41298161678` 在旧 Explorer P2 VM 局部抽取桥接函数时因未提供新增 `cancelPurgeAutoHide` 测试桩而失败，生产代码本身未因此报错；补充旧测试环境并增加 403 条三批全成功只隐藏一次、部分失败不隐藏的断言，产品及测试最终提交 `9af263d8745b90056acf1588fbd996c6117f54a3`。第二轮 Windows CI `41298466274` 对该 SHA **completed/success，26 success、0 failure**，包括 Debug、Node、Explorer Edge/HTTP、SQLCipher、双 EXE 实际启动与上传。已经真实核实三个 artifacts 均未过期：`IPSys-Web-win-x64-self-contained` id 13080980260（推荐）、`IPSys-Web-win-x64` id 13080711763、`IPSys-Explorer-V2-Retest-41298466274-1` id 13080547252。下载入口：https://github.com/zy19970/IPSys/actions/runs/41298466274 。未触发 GitHub Release，也未触及任何本地数据库；通知开始 #1969、失败 #1970、重新开始 #1971，完成通知按实际发送。最后会话档案更新为第十六轮。


## 2026-11-01：开发收尾审查（新会话第一轮）

用户要求先梳理当前提交与仓库文件，为最后的小功能调整和结束开发做准备，未要求本轮改产品代码。实际检查 main 起始 64b92cd999d154dce5f4c910e42a56bec1cc0f56、787 项完整文件树和最近 45 条提交；直接核查关键 UI、目录软删、共享文件永久解绑、MCP 和进度提示源码。最新 Windows CI 41298466274 对产品 9af263d8745b90056acf1588fbd996c6117f54a3 completed/success，双单 EXE 和 Explorer retest 产物均未过期；本次未运行额外 CI/本机 GUI，也未发布新版 Release（最新 Release 仍为 2026-10-23 v0.9.1-rc1）。十月三批字段一致性、表头全选、知产类型筛选、详情侧栏默认展开、多选右键下载、七模块递归目录、整树回收/共享解绑、4 秒自动隐藏等已进入现行源码，不得重复判作未完成。最后建议按用户实机反馈对共享交互做最小修改，在独立新 SQLCipher 测试库对目录/共享文件/回收站做破坏性测试，再统一更新明显滞后的 DEVELOPMENT_PLAN/TESTING/DESIGN/UI_BASELINE/测试索引及多级目录计划，最终按通过的 SHA 手动发布新版 Release。跨界面并发覆盖是架构风险，非已复现问题。最近会话：`memory/sessions/2026-11-01-开发收尾审查.md`；已归档轮次：第一轮；本轮仅 Memory 记录，无产品源码改动。


## 2026-11-01：IPSys Wiki 全站内容完善（本会话后续轮次）

用户明确表示已创建 `https://github.com/zy19970/IPSys/wiki` 首页，要求依据现行仓库文件与此前已确认的业务方案完整完善 Wiki。已核实 AIGT 基础三规则，并取当前代码、README/USER_GUIDE/DESIGN/MCP/REQUIREMENTS 与 2026-11-01 最近成功 CI 为实际依据。GitHub 连接器不直接提供 Wiki Git 仓库写接口，容器无法解析 GitHub 域名，故改由主仓库 `docs/wiki` 持久化 **21 个 Markdown 页面**（包括 Home、_Sidebar、_Footer 和 18 个主题页面），增加非强制推送至同仓库 Wiki 的 GitHub Actions `.github/workflows/publish-wiki.yml`，以及 `docs/WIKI_PUBLISHING.md`。发布工作流保留原 Home 备份，不删除 Wiki 的非同步页面，使用工作流临时令牌；实际 Wiki 发布状态需要核对对应 Actions 与 Wiki，不能以文件进入 main 直接宣布站点更新。已通过创建的 Git Blob 核对 21 个页面均非空、内部 Wiki 双链目标均存在。此轮未改动 SQLCipher、MCP 或其他业务源码，未生成新 EXE，未触发 Release。最近会话仍使用 `memory/sessions/2026-11-01-开发收尾审查.md`，本次归档轮次延续本会话的 Wiki 讨论。


**Wiki 实际发布核验补记（2026-11-01）**：主仓库提交 `707fa10da4ba18020f34fe6b52f003c838b0a62b` 触发 `Publish IPSys Wiki` Actions run `41306575033`；已核实其 head SHA 精确匹配、completed/success、页面链接校验和 Git Push 步骤全部 success。实际日志有 `Verified 21 wiki markdown pages and internal links`、Wiki commit `7c01d91`、`To https://github.com/zy19970/IPSys.wiki.git` 和 `76b51ee..7c01d91 HEAD -> master`；原 Home 创建了 `Home-original-before-IPSys-sync.md` 备份。故本轮已真实将 Wiki 页面发布到该独立 Git 仓库，不只是把 docs/wiki 文件放进主仓库。当前结论不涉及用户本机浏览器渲染截图，也未发布新版软件 EXE 或 Release。Wiki 后续维护沿用 `docs/wiki` → 自动 GitHub Actions 非强制同步；用户直接在 Wiki 在线编辑与主仓库自动发布并行时应注意非强制 Git 同步的差异。


## 2026-11-01：Wiki 首页表格链接渲染问题

用户截图指出 Wiki 首页“从这里开始”的阅读指南列出现 `[[快速开始` 等原样文字，未显示为链接。核查 `docs/wiki` 全部 21 页发现仅首页 9 行表格里的 10 个 `[[标签|页面]]` 链接发生竖线与 Markdown 表格列分隔冲突。此次更正 `docs/wiki/Home.md` 九行十处为 `[标签](https://github.com/zy19970/IPSys/wiki/页面名)`，并增强 `.github/workflows/publish-wiki.yml` 的静态校验：拒绝表格行内 `[[...|...]]`，核实标准 Markdown 指向本 Wiki 的页面目标存在。其他 20 页未改，业务源码、数据库和 Release 不受影响。编辑会话继续记录于 `memory/sessions/2026-11-01-开发收尾审查.md`（第五轮）。第一次提交编排工具调用被环境拦截，远端 main 未变化，已通知失败和重新开始；最终推送状态和 Wiki 发布成功必须按之后的实际 Git SHA、Actions 结果补记。


**Wiki 首页表格链接修复实际发布成功补记（2026-11-01）**：修复代码与归档提交 `8afac9562acc525a004d94fdc773e3be37846b6e`（仅 `docs/wiki/Home.md`、`.github/workflows/publish-wiki.yml`、`MEMORY.md`、本会话档案）触发 GitHub Actions `41307232737`，`completed/success`。日志核实 `Verified 21 wiki markdown pages and internal links`，GitHub Wiki 独立仓库 commit `5e72597`，普通非强制推送 `7c01d91..5e72597 HEAD -> master` 到 `https://github.com/zy19970/IPSys.wiki.git`。因此网站源内容已更新，仍未进行用户浏览器逐页视觉截图复验。提交失败通知 #1980、重新开始 #1981，最终成功后按通知协议发送完成通知。本次不涉及程序构建、数据库或正式 Release。


## 2026-11-01：知识产权类型标签字体统一与十色区分（UI 收尾）

用户提供公司工作区知识产权台账截图，红框同时标出“类型”和“状态”列；明确要求“标签这种字和正文一样大，和文件夹那个字一样大；不同类型标签用不同颜色”。上轮助手已明确提议**仅针对知识产权“类型标签”实施**、不改状态标签，用户此轮回复“行，你按照这个思路，直接修改仓库就可以”，故以此确认的范围推进。现行 Explorer `app.js` 的 IP 台账原为 `typeName`、`f=tag`、列宽 92px，共用 `.pill.tag` 和 `.pill` 11.5px；文件夹名称为 `.row-title` 13.5px。实施：IP 类型列独立改成 `f=ip-type`、148px；在 `app.js` 定义十种类型到固定 CSS token 的白名单映射，未知类型回退 neutral，名称 HTML 转义不变；在 `app.css` 定义 `.pill.ip-type` 13.5px、24px 高、十套柔和背景/深文字，项目类型继续中性、状态继续按语义色。增加 `ip-type-badge-smoke.cjs` 验证十类齐全、颜色互异、字号一致、HTML 安全、项目类型与状态不变，接入 Windows CI `web-windows.yml`；同步 `USER_GUIDE.md`。本轮仅 UI/CSS、前端测试、工作流 Node 测试入口和文档，不触及数据库或本机真实资料。正式 Git SHA、CI 运行结论和 EXE 产物须在提交后核验，禁止将未完成验收提前记为成功。最近会话档案延续 `memory/sessions/2026-11-01-开发收尾审查.md`（第六轮，连同截图说明与本次用户授权）。


**知识产权类型标签修复验收成功补记（2026-11-01）**：主仓库最终产品提交 `d94d05463250e885151b21bc84662fd8b8a85632`，变更仅 app.js、app.css、独立 Node 测试、web-windows CI 测试映射、USER_GUIDE 与 Memory 两文件。自动触发 GitHub Windows Actions run `41308547599`，精确 head_sha 对应本提交，`completed/success`，26 个 success 步骤、0 failure，两个可选 >4GiB ZIP64 实体生成及证据上传步骤 skipped；通过 Debug/Release、包含新增 `ip-type-badge-smoke.cjs` 的 Node/UI、Edge/HTTP、SQLCipher、MCP、两类单 EXE 实际启动和 artifact 上传。三个 artifact 均 `expired=false`：自包含版 `IPSys-Web-win-x64-self-contained` ID `13083509821`、依赖运行时版 `IPSys-Web-win-x64` ID `13084591521`、Explorer retest 证据 ID `13084447005`。下载入口 https://github.com/zy19970/IPSys/actions/runs/41308547599 。未发新版 Release，未改用户本机数据库；网页侧最终视觉效果仍由用户实际运行此次 EXE 核对。本段为独立记忆补记，不需要重新触发产品 Windows CI。

## 2026-11-01：纠正知识产权“状态”标签字号遗漏（会话第七轮）

用户问“为什么状态那个你没有变？”，指出此前知识产权截图中红框标出的状态列也在字号统一需求范围内。助手承认先前错误将任务缩小为仅调整“类型”，没有改状态。现行 app.css 基础 .pill 仍为 11.5px、20px 高，而 .pill.ip-type 为 13.5px、24px；app.js 的 cellHtml case pill 未额外标记状态，因此状态标签偏小。

按用户纠正定向实施：给使用 case pill 的语义状态标签增加 status 类，新增 .pill.status 13.5px、24px 高、12px 圆角及8px左右间距；保留原有 statusTone 红绿蓝灰业务语义，项目类型 .pill.tag 不变。增强 ip-type-badge-smoke.cjs 回归，验证十类原有色系及状态字号与 .row-title 同样为 13.5px，绿色已登记、蓝色准备中、红色已失效、灰色未知，以及 HTML 转义；同步 USER_GUIDE.md。开始通知 office-renderer/wechat-webhook#1985。

本轮修正先前“状态标签维持原样”的错误理解，无数据库、MCP、正式 Release 变动。产品 SHA、CI、新版 EXE 必须按随后真实运行结果核对，不能提前宣称通过。最近会话仍为 memory/sessions/2026-11-01-开发收尾审查.md（第七轮）。

**状态标签首次 Windows CI 失败及定向修复（2026-11-01）**：第一次修复提交 818186e727c6054442a194ab597af6fbe85fef96 触发 Windows CI run 41312767460，结果 completed/failure；精确失败步骤为 Verify UI and capability smoke tests，job 124866433373 日志断言 ip-type-badge-smoke.cjs:75 “Status badges need dedicated readable typography”，并非生产 CSS 不含 .pill.status。诊断发现先前新增测试的状态/高度/项目标签三处 JS 正则表达式被双重转义成 /\\.pill.../，不能匹配 CSS 的实际选择器；按正确 JS regex 单斜杠形式纠正。Debug/Release 编译及此前已执行步骤通过，但首轮没有完整可用 Windows EXE 构建结论。通知失败 office-renderer/wechat-webhook#1986、重新开始 #1987。业务 CSS/JS 原改动无需撤回；新的测试修复提交后应重新执行并核验全部 CI/产物，不能引用首轮失败作为软件成功证据。

**状态标签补齐最终 Windows CI 成功（2026-11-01）**：首次状态 UI 提交 818186e727c6054442a194ab597af6fbe85fef96 保持业务代码正确，后续精准修复测试多重转义提交 327d6de16e6f96d9e1112f81088c46a29b9ab684；最终 Windows CI run 41313206008 head_sha 精确对应 327d6de，completed/success，26 success、0 failure，含新增状态与类型字号/色彩 Node smoke、Edge HTTP、SQLCipher、MCP、两种单 EXE 真实启动；可选物理 >4GiB ZIP64 测试及其证据上传 skipped。本次自包含版 artifact IPSys-Web-win-x64-self-contained ID 13086132689（未过期），依赖运行时版 IPSys-Web-win-x64 ID 13086002717（未过期），Explorer V2 retest ID 13085548739（未过期），下载 https://github.com/zy19970/IPSys/actions/runs/41313206008 。未操作用户真实 DB、未发布正式 Release、未做用户本机新版 EXE 视觉截图确认。任务通知开始 #1985、失败 #1986、重新开始 #1987，完成后通知另外发送。现已根据用户纠正完成两列 13.5px 统一；该轮核验结果作为当前最新产品基线，而不再引用此前仅修改类型的 41308547599 作为最新版本。


## 2026-11-02：综合资料附件“修改日期”显示“—”的源码逻辑审查（本会话第八轮）

用户提供公司工作区“综合资料 / 企业标准模板”附件列表截图，红框圈出修改日期列，两份 PDF、DOCX 附件均显示“—”，问“这个显示是以什么样的逻辑？”。本轮仅要求分析解释，**未授权修改功能**。查阅 2026-11-02 当前 main `4e44ef62c4592146245070062f5a8bff83742e56` 的实际源码：`src/IPSys.Web/wwwroot/js/app.js` `renderList` 非台账列始终“名称/修改日期/大小”，时间计算 `isFolder && it.dateLabel ? dateLabel : fmtDate(it.mtime)`；`data.js` `D(name,size,opts)` 默认 `mtime: opts.mtime ?? null`，`fmtDate(!ts)` 显示“—”；`store.js` `attachmentNode` 未向 `D` 传 `mtime`，所以全模块常规附件列表的该列没有日期，绝非 PDF/DOCX 本身无法读取，也非这两份附件异常。普通业务 Folder 日期不是实际修改时间，依模块采用业务日期如资质年度、专利申请日、项目结束或开始日期；综合资料记录本身也未设置 mtime。后端 `ResourceSchemaV2.cs` `file_versions.created_at` 已默认存储 `CURRENT_TIMESTAMP`，`NativeFileStore.Get` 的 `NativeFileVersion.CreatedAt` 可以取出版本创建时间，但 `NativeArchiveUiEndpoints`（含 general）、`NativeIpUiEndpoints`、`NativeProjectContractUiEndpoints` 列表响应均未输出 `version.CreatedAt`，前端无法据此显示。存储的可选 `files.file_date` 是业务日期而非电脑原始文件最后修改时间，也未见上传时保存 `File.lastModified` 的专用字段。建议未来若要补齐该列，优先将已有最新文件版本 `CreatedAt` 在 API 与前端贯通，并把“修改日期”明确为“更新时间/版本更新时间”，无需为这一路径迁移数据库；如要真实原文件修改时间，则需新增上传采集与储存，该值不能事后从已存在版本创建时间反推。当前仅分析、不提交产品源码、不运行 CI/正式 Release。本会话归档路径不变：`memory/sessions/2026-11-01-开发收尾审查.md`，已记录第八轮。开始通知 `office-renderer/wechat-webhook#1989`。


## 2026-11-02：统一普通文件列表真实更新时间（第九轮）

用户认可上一轮对“修改日期”全为“—”的诊断与建议，明确指示“你这个思路是正确的，按照你这个思路修改一下仓库”。目标：普通列表中的附件显示**最新文件版本的入库时间**；目录和业务记录采用真实更新时间；专利申请日期、项目起止日期、资料年份、文件业务日期保留原有业务语义。用户当前有实际 V2 加密库和资料，改造必须避免要求重新建库，不伪造历史修改时间。

本轮基于最新 main `4f90c95d0c0bf2aad265e20b6f5f4f942ebfe08a`、现行代码和 AIGT 三规范推进。拟提交的实现：`ResourceSchemaV2.cs` 在新库 folders 中加入 `modified_at` 默认创建时间，并在现有 V2 库通过幂等 `ALTER TABLE ... ADD COLUMN modified_at TEXT` 增量加列，历史未知值保持 NULL；增加文件夹创建、业务名称/属性/父级修改、文件关联增删恢复、新增文件版本等修改时间触发器。`Vault.ValidateSchema` 在现有结构和党团目录的兼容处理完成后安装相关增量字段与触发器。`FolderDescriptor`、`NativeFolderStore`、`NativeArchiveStore` 和三种业务列表接口（项目/合同、知识产权、档案/综合资料/目录）贯通 modifiedAt；所有附件列表接口都把版本 `CreatedAt` 返回为 modifiedAt。`store.js` 使用真实记录 modifiedAt 与最新子附件版本时间的最大值作为普通目录/记录 mtime，递归目录考虑后代；不再把项目起止日期、专利申请日、档案年度放进 mtime，业务专用字段不变；`app.js` 将“修改日期”列更名为“更新时间”并统一从 mtime 渲染。时间解析显式把 SQLite 未标时区的 UTC 文本解释为 UTC。

验证计划：`ResourceSchemaV2Smoke` 模拟旧 V2 无 modified_at 列的就地增量升级，检查历史旧时间不被伪造，新创建/改名可产生真实时间；三类 HTTP smoke 检查返回的记录/附件 modifiedAt；新增 Node `modification-time-smoke.cjs` 校验字段映射与时间显示、业务日期隔离，并接入 Windows CI；更新 USER_GUIDE.md。开始通知 office-renderer/wechat-webhook#1991。**注意本段为提交前的事实与实施计划，不能在 CI/commit 实际核验前标记完成；并未更改旧库的 FileId、LinkId、FileVersion 或加密原件。** 当前会话延续 `memory/sessions/2026-11-01-开发收尾审查.md`，第九轮。


## 2026-11-02：更新时间改造回归收敛、执行恢复（第十至十二轮）

用户在授权“按这一思路改仓库”后先后询问“为什么卡死了？”、“继续推进”、“为什么没反应？”。前两次继续执行的交接没有及时产生可见回复，但远端实际上已生成时间改造提交 `ba928cb3bf5e7c18b75c5c7cbb669bc7e087bca7`（19 个文件），此提交的 Windows CI run `41378250696` 结论 `completed/failure`，不是可用新版本。真实日志指出 `Verify UI and capability smoke tests` 中 `ui-tree-smoke.cjs` 的旧断言仍要求合同签订日期成为普通列表的 dateLabel。按新版定义，应把合同签订日期保留在 `biz.start`、专利申请日期保留在 `biz.start` 与年份属性，不能替代 `mtime`。修复 `src/IPSys.Web/tests/ui-tree-smoke.cjs` 中合同和知识产权的三处陈旧 `dateLabel` 断言，新增历史未知真实更新时间保持 null 的检查，并保留原业务字段断言。此轮恢复执行重新读取 AIGT 三规则、当前 Memory、历史提交与失败 CI 日志，按流程已发失败通知 `office-renderer/wechat-webhook#1992` 和重新开始 `#1993`；后续修复的产品代码和数据库安全性仍需以新的 Windows CI 实际验收结论为准。文件时间策略为附件 `file_versions.created_at`，记录与目录 `folders.modified_at` 的创建或实际变更时间；旧 V2 DB 原有文件夹时间未知保持 NULL；前端统一“更新时间”，业务申请、签约、项目日期继续由专用属性表达。


**更新时间统一第二轮 CI 失败及收敛（2026-11-02，追加第十二轮）**：修正 ui-tree-smoke.cjs 的旧日期断言并提交 90483d6a8b4a81ff3de039a4d020d60da5ac2ad2 后，Windows Actions run 41379537798 仍 completed/failure，日志定位 excel-scope-smoke.cjs:101 旧项目日期断言 node.dateLabel = p.startDate || p.endDate，与已确认的普通列表修改时间只能来自真实 modifiedAt 规则冲突。全仓库通过 GitHub 搜索 dateLabel，剩余 Node 旧断言已集中在 excel-scope-smoke.cjs（ui-tree 本次已修正但搜索索引仍可能返回旧片段）。修正该处断言为 node.mtime = toTs(p.modifiedAt)，保留项目年份字段仍由 p.startDate/p.endDate 计算，增加禁止 dateLabel 误用项目开始日的负向断言。已发送失败通知 office-renderer/wechat-webhook#1994、重新开始通知 #1995。后续结果须以完整 Windows CI 重新核实。


**更新时间统一改造最终验收成功（2026-11-02，第十二轮）**：首次功能改造提交 ba928cb3bf5e7c18b75c5c7cbb669bc7e087bca7，包括 ResourceSchemaV2 folders.modified_at、现有 V2 库非破坏性加列（历史未知不填）、触发器记录业务更改/附件链接/文件版本操作、各项目/合同/IP/业务档案/综合资料列表 API 的 modifiedAt、前端普通视图“更新时间”使用真实 mtime，不再用申请/签约/项目起止等业务日期代替；新增 C# 与 Node 回归。首次 Windows run 41378250696 因 ui-tree-smoke.cjs 旧日期断言失败，修补提交 90483d6a8b4a81ff3de039a4d020d60da5ac2ad2；第二次 run 41379537798 因 excel-scope-smoke.cjs 同类旧断言失败，修补提交 f03df086e598b76e477a7a931b3917e1e897f829。经全仓搜索同类 dateLabel 测试后，最终 GitHub Actions run 41380005969 精确对应 f03df086，completed/success，26 success、0 failure，2 个大于 4GiB 的 ZIP64 可选步骤 skipped。三份 artifacts 均未过期：IPSys-Web-win-x64-self-contained ID 13112663652（推荐）、IPSys-Web-win-x64 ID 13113531165、IPSys-Explorer-V2-Retest-41380005969-1 ID 13112818280。下载 https://github.com/zy19970/IPSys/actions/runs/41380005969 。无正式 Release，本次并未打开用户本机实际 DB；用户真实界面视觉效果需使用此 SHA 对应的新 EXE 实测。通知执行起点 #1991、首轮失败 #1992、重新开始 #1993、二轮失败 #1994、重新开始 #1995；最终完成通知将单独发送。本次 Memory 补记不会触发新的产品 CI。

## 2026-11-02：新建资料菜单图标缺失修复（第十三至十六轮）

用户截图显示资料目录内“新建”菜单：“新建下级目录”左侧有文件夹小图标，但“新建资料”没有图标。用户要求“新建资料你也加一个小图标，太突兀”；之后两次催促“怎么又没反应？”、“卡住了？”，前述交接流程没有返回真正执行结果；本轮明确要求“继续推进”，使用 GitHub 连接器直接定位修改提交。当前基线 main 77e2dc3e216c8bdbf2ad5f4caa5071f0dcecd52d，重新读取 AIGT 三规范与 IPSys Memory / 最近会话。

根因：src/IPSys.Web/wwwroot/js/interactions.js 的“新建资料”菜单写成 MI("new-record","file","新建资料")，而 src/IPSys.Web/wwwroot/js/icons.js ICON_PATHS 仅有 folder 和 doc，没有 file；icon(name) 找不到键时返回空字符串。仅更正该处图标键 file 为已有 doc，不改 SVG 库、CSS、菜单尺寸、点击行为和业务数据库。扩展 src/IPSys.Web/tests/explorer-archive-operations-smoke.cjs，借助实际 icons.js 和 MI helper 验证两项菜单都呈现 18px SVG，菜单样式与 data-act 正确；旧业务点击测试保持。目标为现有 Windows CI 回归，不创建 Release。通知开始 office-renderer/wechat-webhook#1997；最终 SHA、CI、工件状态需提交后实证核验。本会话路径仍为 memory/sessions/2026-11-01-开发收尾审查.md。

**新建资料菜单图标修复最终验收（2026-11-02）**：产品提交 e48adea7e1313ffbbff63cb125002439fe7bcc23，精确变更仅 src/IPSys.Web/wwwroot/js/interactions.js（将 new-record 的无效 file 图标键改 doc）、src/IPSys.Web/tests/explorer-archive-operations-smoke.cjs（真实 MI/icon 生成 18px SVG 和动作/布局测试）、MEMORY.md 和本会话档案；不存在 CSS、数据库、MCP 或 Release 修改。对应 GitHub Windows Actions run 41387525811，head_sha 精确匹配该产品提交，completed/success，26 个成功步骤、0 个失败；包含新增 UI smoke、Edge/HTTP、SQLCipher、两种单文件 EXE 启动验证及产物上传；可选大于 4GiB ZIP64 物理生成和证据上传两个步骤 skipped，不冒称成功执行。未过期 artifacts：IPSys-Web-win-x64-self-contained ID 13115614771（推荐）、IPSys-Web-win-x64 ID 13116237383、IPSys-Explorer-V2-Retest-41387525811-1 ID 13116745075。下载 https://github.com/zy19970/IPSys/actions/runs/41387525811 。未在用户本机 GUI 人工截图复验。开始通知 office-renderer/wechat-webhook#1997，最终完成通知单独发送。本补记为纯记忆文件，不触发新产品 CI。


## 2026-11-02：讨论统一新建资料与目录（第十七轮）

用户截图反馈：“我觉得新建资料和新建目录的逻辑是错误的，我新建的都是文件夹，这两个没任何区别，相比于知识产权和项目，这个没有任何不一样”。本轮核实代码：archive_folder 支持递归但不能上传附件；archive/general 记录也呈现文件夹，支持附件和业务属性，但不能继续创建子文件夹。项目及知识产权亦在 folders 表中，附有业务属性。建议从使用者视角统一“新建文件夹”，允许每个普通文件夹既嵌套子文件夹又直接存附件，属性选填；保留项目/IP 专用属性与共享版本。真正实施需要审查数据库约束、附件接口、迁移、排序、回收站、MCP/Excel/ZIP 与回归测试，不能只改菜单。用户本轮是提出产品模型讨论，尚未明确授权结构重构；未改产品代码或数据库，未运行 CI。已重读 AIGT 基本规则及目标仓库现行文件；开始通知 #1999。当前会话记录在 memory/sessions/2026-11-01-开发收尾审查.md。


## 2026-11-02：资料型模块统一文件夹改造（会话第十八轮，用户已授权）

用户明确指令：“你现在的思路是对的，就按照这个思路推进修改，不需要考虑旧数据库，现在还没有上线”。该决定取代上一轮仅提出方案的待确认状态。确认约束：资料型模块只显示“新建文件夹”，文件夹可同时直接放附件和子文件夹，文件夹名称必填，其它类别、年度、标签、备注属性选填；共享原件版本与项目、知识产权专用业务属性保留。当前处于开发阶段，无需为新数据结构额外设计旧库迁移。基线 main 941b829f2a9dc5deb4f3daea0bb2e7c5bfa27bad，已重读 AIGT 三基础规则及本仓库 MEMORY/会话；任务开始通知 office-renderer/wechat-webhook#2001。

本轮改造目标及待发布实现：后端 archive_folder 统一为普通资料目录的附件容器和子目录容器；公司企业资质与公司业务档案、党团建设、综合资料以及个人相应资料模块都采用此能力。扩展 ArchiveFolderInput 为名称、父级和可选类别/年度/标签/备注；NativeArchiveStore 记录并读取属性，NativeArchiveOrder 移动时保留属性；公司 certificate 纳入 ArchiveDirectoryScopes 与新 V2 CHECK；NativeArchiveUiEndpoints 为资料目录返回属性并收集其直连附件版本；store.js 用同一目录节点显示直连附件和递归子目录；RecordForms.archiveFolder 提供统一创建/属性编辑/F2 重命名，interactions.js 菜单只保留“新建文件夹”，文件夹上传和移动、排序、属性及回收站沿用现有行为；bridge.js 接受 archive_folder 上传、共享和导出，export.js ZIP 目录路径不再增加虚构记录层；app.js 资料目录内部使用普通文件管理器列，企业资质根部仍保留原有台账表头。新增/更新 Node 和 NativeArchiveUiHttpSmoke 校验菜单、属性、目录+附件、共享 FileId、多版本、企业资质模块，更新 USER_GUIDE 和 Wiki。未移除旧 archive/general API，以保留项目/知识产权以外现有 Excel/MCP 接口的专用模型。正式产品 Git SHA、完整 CI 与 EXE 构建需提交后按实际结果验证；未修改用户本地数据库、未要求 Release。本会话归档路径仍为 memory/sessions/2026-11-01-开发收尾审查.md。


**统一文件夹首轮 CI 失败与隔离修复（2026-11-02）**：功能提交 baefcfdb90a600dff6612311ba4abce3351ba86b 已进入 main，并触发 Wiki 发布 run 41403965981 completed/success。Windows run 41403965921 则 completed/failure，精确失败步骤 Verify UI and capability smoke tests。日志定位 ui-tree-smoke.cjs 新增“普通文件夹直接存附件/嵌套”测试后将全局 ROOT 指向另一个 fixture，没有恢复旧 multilevel fixture，使随后旧 BUG-002 断言 findById('a:achievement:91') 为空；此为测试隔离失误，尚不足以证明生产代码正确或错误。已在新增测试后恢复原 ROOT，等待重新执行 CI 核验。失败通知 office-renderer/wechat-webhook#2002、重新开始 #2003。不能将首轮 Windows 失败误报成新 EXE 可用。

## 2026-11-02：用户催促统一文件夹验收、第二轮 CI 旧重命名测试失败（第十九轮）

用户原话：“为什么卡住不动了”。已重新读取 AIGT 三规范及项目 MEMORY/本会话。核实上轮 e3f3eb12 的 Windows CI run 41404619393 completed/failure，UI 资源、目录树、Explorer P0/P1 已通过；实际失败是 explorer-p2-interactions-smoke.cjs:88 测试模拟没有新的 RecordForms.archiveFolder 方法，虽然生产 forms.js 已提供该方法；因此要更新旧测试与新接口，而非宣称生产代码已完成验收。失败通知 office-renderer/wechat-webhook#2004，重新开始通知 #2005。

本轮修复：Explorer P2 smoke 改为加载真实 forms.js，检查公司 achievement/个人 academic 目录 F2 重命名的 section-aware PUT、可选属性与数据；同步修复首页无效上传位置、内部拖拽无效目标提示测试，生产 interactions.js 的提示语统一为“请将文件拖入可上传的文件夹”。相关 Blob：explorer-p2-interactions-smoke.cjs e1a7d7022c4475766f9defe0e0ff066e983d3500；interactions.js 7805ee7206cfab6ce91c299195021266dccd7629；explorer-internal-dragdrop-smoke.cjs 5a2daeaa87a7f614d50ff2569f26e3546962dc28。最终提交和新 CI 尚待实际核验。本会话仍存 memory/sessions/2026-11-01-开发收尾审查.md。用户明确无需旧数据库迁移，不创建 Release。


**第十九轮第三次 CI/测试误判（2026-11-02）**：第二轮测试与用户反馈归档提交 5a35c48453ee1363b908eb0430584e73226784de，Windows CI run 41405843895 completed/failure；P2、建库、会话恢复均已通过，失败位置 explorer-archive-operations-smoke.cjs:99，新建企业资质文件夹处理函数在 Node vm 另一上下文被主上下文的 `instanceof Function` 判定 false；这不是生产 handler 不存在。改用 `typeof handler === "function"`，修复 Blob c8f11760e85dd86c96e7b1fe30f1c09e21de5079；失败通知 office-renderer/wechat-webhook#2008，重新开始 #2009。应继续以新 CI 结果为准。用户可见阶段性说明已如实披露上轮 CI 仍失败及本次断言错误。


**第十九轮补充：测试目录 fixture 缺 section 字段（2026-11-02）**：在 main 135e7514 的 Windows CI run 41406572739 尚在执行时进一步核查 explorer-archive-operations-smoke.cjs，发现 helper folder() 构造的 archive_folder biz 没有 section，而生产 store.js 实际每个普通目录均有 section。随后 F2 重命名断言预期调用 archiveFolder("achievement",parent,null,true)，没有 section 会传 undefined 导致后续断言错误。已预先将测试 helper 的 section 设置为 achievement（该脚本测试节点属于 achievement 分段），Blob c007b0ed76016142795d7fd5a5dc471ebf4b7897；不改产品业务代码。注意前一个 CI 在此提交前触发，需区别两个 SHA 的结果并以最新提交的 Windows CI 为最终验收证据。


**统一文件夹改造最终 Windows 验收（2026-11-02，第十九轮结论）**：本轮历经测试模拟契约与隔离修正，最终 main 产品与测试提交 c1a99d839d9fb90dd177d88051702d035dc2fcb9。Windows Actions run 41406914227 completed/success，head_sha 精确匹配，26 个成功步骤、0 失败；用户授权的资料型模块统一“新建文件夹”，资料文件夹可嵌套和直接拥有附件、可选业务属性、共用 FileId/LinkId、版本和 ZIP 归档的 Node/HTTP/SQLCipher/Edge 回归以及两种单文件 EXE 验证通过。产物未过期：IPSys-Web-win-x64-self-contained ID 13123868805（约81MB，首选）、IPSys-Web-win-x64 ID 13124146910、IPSys-Explorer-V2-Retest-41406914227-1 ID 13124311354。链接 https://github.com/zy19970/IPSys/actions/runs/41406914227。此前 run 41406572739 确实失败于 Explorer F2-02 的测试目录模拟缺 section，已由 c1a99d8 修复；失败与重新开始通知分别为 #2015/#2016。Wiki 同步 run 41403965981 对业务提交 baefcfdb 成功。可选超 4GiB ZIP64 任务（如跳过）不列作本次新验证结论，亦未在用户本机运行 GUI 目视复查。尚未创建正式 Release 或进行任何旧数据库迁移。最终完成通知待发。本轮最终答复已向用户阶段性说明全部 26 项成功与新 EXE 已生成。

## 2026-11-02：附件“移动到其它记录”右键菜单图标缺失（会话第二十轮）

用户上传文件管理器截图：路径“我的文件 / 综合资料 / 123456 / 123456”，附件右键菜单“移动附件到其它记录”图标位置空白，提问“这个的图标怎么没有？”。按 AIGT-templates 三项必读规范及 IPSys MEMORY/会话恢复；main 基线 d36927feebf6f7c78a00f48753bbd82c04413e50。当前 src/IPSys.Web/wwwroot/js/interactions.js 的 assoc-move、transfer-record、move-archive 三个右键操作都传 `icon('move',18)`；src/IPSys.Web/wwwroot/js/icons.js 的 ICON_PATHS 却没有 move 项，icon() 对未知名称直接返回空字符串。与此前“新建资料”采用不存在的 file icon key 为同类问题。

解决范围仅补全共享 icons.js 中 `move` 的 Fluent 线性文件夹+右移箭头 SVG，与现有 24×24、1.6px 描边一致。无需改动菜单业务逻辑、文字或 CSS，三个移动操作因此都能正确显示图标。于 `src/IPSys.Web/tests/explorer-file-associate-smoke.cjs` 增补基于真实 icons.js 和 interactions.js 的 MI() HTML 渲染回归，逐项检查三个移动菜单生成 18px SVG、保留 data-act 和原中文标签，沿用原关联/移动行为测试。起始通知 issue office-renderer/wechat-webhook#2021。此次新建产品/测试 Blob 分别为 f0fbc1cd6b3a3d7d915a5eede487d02c898cada5（icons.js）与 60af4d5585c28c454a46718e6f1c8e61420d315c（回归）。无数据库或 Release 改动。最终提交和 Windows CI 状态必须在实证核验后补充，不能提前宣称新 EXE 可用；最近会话仍为 memory/sessions/2026-11-01-开发收尾审查.md。

**移动菜单缺图标最终验收（2026-11-02，第二十轮结论）**：实际产品+回归提交 f314495610015afa0abc5959732f89629558c84a，已通过 GitHub main 和变更清单核验，修改 src/IPSys.Web/wwwroot/js/icons.js、src/IPSys.Web/tests/explorer-file-associate-smoke.cjs，及本轮 MEMORY/会话档案；其余业务文件未变。对应 Windows Actions run 41409289266 head_sha 精确匹配，completed/success，26 个成功步骤、0 失败，UI 测试真实渲染 assoc-move、transfer-record、move-archive 的 18px SVG，Edge/HTTP、SQLCipher、两种单文件部署均通过。三份 artifacts 都未过期：自包含 IPSys-Web-win-x64-self-contained ID 13125021988（推荐）、依赖版 IPSys-Web-win-x64 ID 13124987071、Explorer V2 retest ID 13124538504。下载 https://github.com/zy19970/IPSys/actions/runs/41409289266 。没有操作用户本机资料库，未发布正式 Release，用户本机界面尚未截图复验。任务开始通知 issue office-renderer/wechat-webhook#2021；完成通知另行发送。本次最终记忆补记只改文本，使用 [skip ci] 避免新增不必要 Windows 构建。

## 2026-11-02：统一文件夹的“新建”按钮改为直接打开表单（第21轮）

用户先在公司“党团建设/团支部”截图中表示：既然只有“新建文件夹”一种创建动作，工具栏/空白处右键里的“新建”不应再弹一个只有一项的二级菜单。助手上一轮已分析建议：单动作直接执行，多个独立动作保留菜单；用户本轮明确指令“按照你这个思路修改”。

本轮按 AIGT 三项规范重读 IPSys MEMORY/最近会话，当前基线 main e13fce4752a03a3bbc6df8d01391553a2ae34447。已核实 src/IPSys.Web/wwwroot/js/interactions.js 里所有顶部、侧边、首页和右键入口最终调用 openNewMenu；原 archiveScope 分支会 showCtx 一个“新建文件夹”项，点击才调用 createArchiveFolder。改为 openNewMenu 在确认 canCreateHere() 后，若 archiveScope() 为 true 即 return createArchiveFolder()，不访问 anchor 或调用 showCtx；普通首页和其它业务多项创建菜单仍沿旧通路。右键空白处保留第一层“新建/上传/刷新”上下文菜单，但选择“新建”立即打开目录属性表单，不再出现二级菜单；改动不涉及附件模型、表单内容或数据接口。

关联测试：src/IPSys.Web/tests/explorer-archive-operations-smoke.cjs 以真实 openNewMenu 测试公司业务档案根和子目录、综合资料、企业资质、个人学术目录直接调用 RecordForms.archiveFolder，断言不新建 showCtx；新增 showBlankMenu 测试确保右键点“新建”直接进入表单；首页仍保留多项新建菜单。ui-assets-smoke.cjs 的旧“必须具有新建文件夹菜单项”字符串检查改为“单动作直接调用”的断言。产品 Blob d205dffd02b6aa79a18024b91ee527df0e7f368e，archive 测试 Blob 1e263d821deee97b5bef76e0fedfb08bc52a17ff，UI-assets 测试 Blob 72ab017e9d1745bf1197d9455680b4d5bf94228f。GitHub 主分支保护详情权限 403，rulesets 返回 []，不能据此声称无分支规则；只按规范使用非强制 CAS 提交，拒绝时停止。任务开始通知 issue office-renderer/wechat-webhook#2023。未改数据库、正式 Release；实际提交/CI 状态随后核实。本会话仍存 memory/sessions/2026-11-01-开发收尾审查.md。
