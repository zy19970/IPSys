# 缺陷清单 V2（去重 13 个 BUG + 1 条 DOC_GAP）

版本：`02289ea`｜浏览器：Edge（CDP）｜测试库：`vault-v2c.db`｜复现率中的分母是本轮实际尝试次数

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
- **关联**：`ui-tree-smoke.cjs:62-63` 把该行为断言成预期（BUG-017）

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

## BUG-007（P1，本轮只完成 ①）合同两种回收站

- ① 整体删项目：回收站只有 project 行，恢复后合同回来 → **PASS**
- ② 单独删合同（父项目仍在）：后端返回 `kind=contract`，前端是否过滤未在本轮复跑 → 待验证

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

## BUG-017（P1）`ui-tree-smoke` 把缺陷断言成预期

- `assert.deepEqual(ids, ['f:2:1','f:3:2'])`；修 BUG-002 前必须先改

---

## DOC_GAP-001（R-07）Q122 旧口径

- `REQUIREMENTS.md:85/195` 仍写「不提供一键清空回收站」
- 2026-10-22 用户已允许；产品按钮符合新决定，只记文档待同步
