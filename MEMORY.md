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
