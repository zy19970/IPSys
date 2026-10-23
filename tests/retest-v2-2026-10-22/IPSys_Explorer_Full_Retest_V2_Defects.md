# 缺陷清单 V2（14 个已识别 BUG 编号 + 1 条实现缺口 + 1 条文档缺口）

被测源码基线：`02289ea7020861360baa0a4c49ca045f3c783aea`｜浏览器：Edge（CDP）｜上一轮测试库：`vault-v2c.db`；本轮为独立临时库 `v2ci-39726553781-1`｜复现率分母为各项实际尝试次数

复核说明：BUG-004 为此前已证实、本轮未复跑；T-P1-02 的单独删合同子项尚未完成 UI 复测，不确认 BUG-007；R-08 原 BUG-017 判定为误报，已撤销。

---

## BUG-001（P0）多级业务档案目录整棵消失

- **复现步骤**：进入 业务档案 → 观察分类根 → 遍历整棵树
- **预期**：系统目录 → 二级-A → 三级-A1 → 记录，每层可见（`UI_BASELINE.md` §3 允许无限层）
- **实际**：树中 `af:8=false`、`af:9=false`；最深记录被提升到分类根，根层直接列 9 行
- **复现概率**：2/2
- **归因**：前端 `store.js buildTree` 平面映射，未递归 `folders[].parentId`
- **关联**：`frontend/explorer/js/store.js`（buildTree，约 480–540 行）
- **同类影响**：导出路径层级、面包屑、搜索跳转、移动目标选择

## BUG-002（P0）附件版本没有折叠

- **复现步骤**：进入 IP-A 记录
- **预期**：同一 `linkId` 只有一条可见附件，默认最新版 37B
- **实际**：v1(22B)、v2(37B) 两行；附件数 2、占用 59B
- **复现概率**：2/2
- **归因**：`store.js:281,296` 用 `f:${linkId}:${version}` 每版一个节点
- **关联**：现有 `ui-tree-smoke.cjs` 未覆盖同一 linkId 多版本折叠；该缺口需要独立回归测试，不能据此把其现有断言判错

## BUG-003（P0）同 linkId 两行一起删 → 半成功且界面不刷新

- **复现步骤**：选中 2 行 → 删除 → 确认
- **预期**：不得对同一 linkId 发两次 DELETE；失败要给成功/失败数并刷新真实结果
- **实际**：第一次 200、第二次 409「关联已解除。」；服务端剩 0 行，界面仍 2 行
- **复现概率**：2/2
- **归因**：`deleteNodes` 的 for 循环整体在一个 try 内，抛错即中断且不刷新
- **关联**：`interactions.js deleteNodes`

## BUG-004（P0，上轮已证实，本轮未复跑）关库被拒仍假关闭

- 上轮用 `--limit-rate 100k` 制造真实 409，页面照样 reload、token 清空，但 `/api/status` 仍 `unlocked:true`，用户看不到原因。
- 本轮未复跑（`evidence/BLOCKED-LIST.md`），代码未变。

## BUG-005（P1）跨记录引用只有 IP 特例

- 后端 `/api/v2/files/{ws}/{fileId}/associate` 实测 200，FileId 复用、LinkId 按目标独立（3 / 4）
- 前端只有 `associateOriginal()` 一个 IP 特例；项目/合同/档案/综合资料无入口

## BUG-006（P1）登录页没有创建资料库入口

- `interactions.js:270-280` 把 `create` 硬编码为 false；登录层只有「打开」
- 违反 `UI_BASELINE.md` §2.1「创建新库另设入口」；后端 `{create:true}` 可用

## BUG-008（P1）复制/转移无入口
## BUG-009（P1）档案目录 CRUD 无入口（后端全部可用）
## BUG-010（P1）手工持久排序无入口（后端 `entries/reorder` 可用）

## BUG-013（P2）「重命名 F2」只弹提示

- 菜单项写 F2，右键与键盘都只 toast「重命名请点「修改」或右键「属性」」

## BUG-014（P2）内部拖拽只弹提示，且归因错误

- toast 说「需要后端支持 link 迁移」，但 `/associate?move=true` 已可用

## BUG-015（P2）「添加快捷访问」是假按钮

- 只 toast「已按资料分类自动生成」，无自定义能力

## BUG-016（P2）首页「导入资料」直接弹文件选择器

- `folderId=root` 通过 `pickFiles()` 的 folder 判断，无「先选记录」引导
- 违反 `REQUIREMENTS.md:30/153`

## BUG-018（P2，本轮 T-P2-09）PDF 预览创建后没有启动解析

- **复现步骤**：在项目 A 打开附件 `PDF 两页示例.pdf`。
- **预期**：显示 `1 / 2` 并完成第一页 Canvas 渲染；点击“下一页”后显示 `2 / 2` 并完成第二页渲染。
- **实际**：页码为“加载中”，状态保持“正在解析 PDF…”，Canvas 仍为初始 `300×150`；两页均未渲染。
- **复现概率**：1/1（Windows Runner、Edge CDP、有效 844B 两页 PDF）。
- **归因**：`frontend/explorer/js/interactions.js` 的 `previewFile()` 在 `viewer.create(body, buffer)` 后未调用 `pdfViewer.open()`。`pdf-preview.js` 中实际加载 PDF.js 文档并渲染页面的逻辑只在 `open()` 内执行。
- **证据**：`docs/retest-v2-2026-10-22/evidence/runs/v2ci-39726553781-1/T-P2-09.txt`、同目录 `browser-results.json`；完整截图和宿主日志见 [Actions artifact](https://github.com/zy19970/IPSys/actions/runs/39726553781/artifacts/12403621382)。
- **状态**：已确认；本轮只确认缺陷，未修改产品代码。

## DOC_GAP-001（R-07）Q122 旧口径

- `REQUIREMENTS.md:85/195` 仍写「不提供一键清空回收站」
- 2026-10-22 用户已允许；产品按钮符合新决定，只记文档待同步
