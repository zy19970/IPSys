# IPSys Explorer 全量复测报告 V2

- 执行日期：2026-10-22
- 仓库：`E:/Github/管理系统`｜分支 `work/onedrive-file-manager`｜HEAD `02289ea`
- 测试库：`build-retest/agent-explorer-full-v2/vault-v2c.db`（本轮新建，随机密码仅存于同目录 `.cred.json`，不入库）
- 浏览器：本机 Microsoft Edge（headless=new，CDP 驱动；未接管用户已开窗口）
- 结论先行：**产品源码零改动**。38 项中 22 项完成实测/静态确证，16 项 BLOCKED 且逐条给出原因（`evidence/BLOCKED-LIST.md`）。**不建议现在合并回 main。**

---

## 1. 本轮先纠正了任务书什么

完整勘误见 `IPSys_Explorer_Full_Retest_V2_Errata.md`，10 处。最影响执行的四条：

1. **任务书 §1.2「不提交、不推送」与用户本轮指令冲突，且 §8 的交付目录被 `.gitignore` 忽略** —— 按原文执行，「把结果推到仓库」永远做不到。改为：产品源码零改动，交付物写 `docs/retest-v2-2026-10-22/` 并单独提交。
2. **地址必须是 `127.0.0.1`，不是 `localhost`** —— `Program.cs:52-65` 对 Host 做严格字符串比较，`localhost` 直接 403。实测已证实。
3. **T-P2-07 的 `ownerKind` 字段不存在** —— 全仓 grep 零命中；搜索命中只有 `kind/section/id`。
4. **§7.1.3 的 CDP 网络节流对压缩无效** —— VACUUM 是本机 SQLite 操作，不产生 HTTP 往返。

另有 6 处：T-P1-05 的排序范围（后端硬限 `company/achievement`）、T-P2-10 的原生拾取器无法用 CDP 点、T-P1-01 的判据应升级为违反 `UI_BASELINE.md` §2.1、15 个 FAIL ≠ 15 个缺陷、单实例守卫的真实理由、T-P2-02 的提示语本身在说谎。

---

## 2. 环境与基线

| 项 | 值 |
|---|---|
| `git status --short --branch` | 干净，`work/onedrive-file-manager...origin/work/onedrive-file-manager` |
| HEAD | `02289ea7020861360baa0a4c49ca045f3c783aea` |
| `node frontend/explorer/tools/bundle.cjs` | 成功（index 12.0 KB / css 58.6 KB / app.js 190.7 KB） |
| `dotnet build ... -c Debug` | **0 错误**，6 警告（全部为既有可空/未用变量警告） |
| 8 个 Node smoke | 全部 exit 0（`ui-assets` / `ui-tree` / `explorer-capabilities` / `upload-progress` / `upload-unique-autosave` / `export` / `zip64` / `pdf-canvas`） |
| 宿主 | 单实例 `EventWaitHandle`；本轮 `127.0.0.1:62293`，仅一个实例 |

**基线全绿但产品有 P0**：`ui-tree-smoke:62-63` 把「一个版本一行」断言成预期（R-08），这条断言本身就是 BUG-002 的护栏。

---

## 3. 结果汇总

| 状态 | 数量 | 说明 |
|---|---|---|
| PASS | 7 | T-P2-06 / 07 / 09 / 11 / 12、R-03、R-05 |
| CONFIRMED_BUG | 8 | BUG-001/002/003/013/014/015/016/017 |
| IMPLEMENTATION_GAP | 6 | BUG-005/006/008/009/010、R-02 |
| DOC_GAP | 1 | R-07（Q122 旧口径） |
| BLOCKED | 16 | 逐条原因见 `evidence/BLOCKED-LIST.md` |
| **合计** | **38** | 30 旧 + 8 新，ID 全保留 |

- 测试项：38｜已执行并留证：22｜去重缺陷：**13 个 BUG + 1 条 DOC_GAP**
- 方法分布：`DYNAMIC-BROWSER` 10、`DYNAMIC-HTTP` 8、`STATIC` 4、`MIXED` 6、未执行 16
- 逐项状态见 `IPSys_Explorer_Full_Retest_V2_Cases.csv`（12 列，含 Observed/Expected/Evidence/SourcePath）

---

## 4. 本轮确认的缺陷（按严重度）

### BUG-001（P0，T-P0-01）多级业务档案目录整棵消失

- **实测**：后端 `GET /api/v2/ui/archive/company` 返回 `folders` 的 parentId 链 `1 → 8(二级-A) → 9(三级-A1)`，最深记录 `folderId=9`。
- **前端**：进入「业务档案」后遍历整棵树，`af:8=false`、`af:9=false`，但最深记录 `a:achievement:10` **出现在分类根**，分类根直接列出 9 行（7 个系统目录 + 2 条被提升的记录）。
- **归因**：`store.js buildTree` 只做平面映射，没按 `folders[].parentId` 建子树。
- **证据**：`evidence/T-P0-01.txt`、`evidence/shots/T-P0-01-archive-root.png`

### BUG-002（P0，T-P0-02）附件版本没有折叠

- **实测**：进入 IP-A 记录，同一 `linkId=3` 的 v1(22B)/v2(37B) 显示为 **2 行**；接口确实返回 4 行/2 个 linkId（T-P0-02#api）。
- **影响**：附件计数按 2 计、占用把 59B 一起算；双击打开的是哪一版取决于行顺序。
- **归因**：`store.js:281/296` 用 `f:${linkId}:${version}` 建节点，每个版本一个节点。
- **证据**：`evidence/T-P0-02.txt`、`evidence/shots/T-P0-02-ip-attachments.png`

### BUG-003（P0，T-P0-03）同 linkId 的两行一起删 → 半成功且界面不刷新

- **实测**：选中 2 行点删除，弹确认，确认后 toast 为「关联已解除。」（后端第二次 DELETE 的 409）；服务端该 fileId 剩余 **0** 行，界面仍显示 **2 行**。
- **归因**：`deleteNodes` 的 for 循环整体在一个 try 内，第二条抛错即中断，既不刷新也不报成功/失败数。
- **补充证据**：HTTP 层直接打两次 → `200` / `409 {"error":"关联已解除。"}`。

### BUG-013（P2，T-P2-01）「重命名」与 F2 都只弹提示

菜单里写着「重命名 F2」，`interactions.js:1060` 与 `1280` 都只 `toast("重命名请点「修改」或右键「属性」")`，名称不变。能力本身存在（属性表单），但菜单把不可用动作画成可用项。

### BUG-014（P2，T-P2-02）内部拖拽只弹提示，且提示语是假的

拖 IP 附件到 IP-B 记录，toast：「附件移动需要后端支持 link 迁移；当前请用「上传」挂到目标记录」。
但后端 `POST /api/v2/files/{ws}/{fileId}/associate {linkId,targetFolderId,move}` 已可用（T-P1-03 实测 move 200）。**不是后端缺能力，是前端没调用**。

### BUG-015（P2，T-P2-03）「添加快捷访问」是假按钮

`interactions.js:700` 硬编码 `toast("「快捷访问」已按资料分类自动生成")`，没有任何自定义快捷方式能力。

### BUG-016（P2，T-P2-04）首页「导入资料」直接弹文件选择器

`pickFiles()` 只判断当前 folderId 是不是 folder；首页 `folderId=root` 恰好通过，于是**打开了 1 次文件选择器，没有任何“先选记录”的引导**。`REQUIREMENTS.md:30/153` 要求先有业务记录再上传。

### BUG-017（P1，R-08）测试把缺陷断言成预期

`ui-tree-smoke.cjs:62-63` 断言 `['f:2:1','f:3:2']`（每版一行）。修 BUG-002 必须先改这条断言。

### IMPLEMENTATION_GAP（6 项）

| ID | 能力 | 后端 | 前端 |
|---|---|---|---|
| BUG-005 | 跨记录引用 | `/associate` 实测 200，同一 FileId 在 IP-A/IP-B 各有独立 link（3 / 4） | 只有「共享到其它知识产权」特例，项目/合同/档案/综合资料无入口 |
| BUG-006 | 首次建库 | `/api/open {create:true}` 可用 | 登录层只有「打开」，违反 `UI_BASELINE.md` §2.1 |
| BUG-008 | 复制/转移 | `move` 200、`transfer` 200 | `grep transfer` 零命中 |
| BUG-009 | 目录 CRUD | 改名 200、删空目录 200、删系统目录 409、删非空目录 409 | 无「新建下级分类」，右键对 `archive_folder` 无改名/删除 |
| BUG-010 | 持久排序 | `entries/reorder` 200 且顺序生效（缺项/非法 id 均 409） | 无拖拽、无上移下移 |
| R-02 | Excel 导出范围 | 支持 `mode=filtered` | `excel.js:51` 固定 `{mode:"all",ids:null}`，无选择控件 |

### DOC_GAP（1 项，R-07）

`REQUIREMENTS.md:85/195` 仍写「不提供一键清空回收站」，与 2026-10-22 用户决定冲突。产品有 `#btnEmptyTrash`（符合新决定），**按钮存在本身不记 BUG**，只记文档待同步。

---

## 5. 与上轮结论的差异

| 项 | 上轮 | 本轮 | 依据 |
|---|---|---|---|
| T-P0-01 | FAIL（静态推断为主） | **CONFIRMED_BUG** | 浏览器实测树里没有 `af:8/af:9` |
| T-P0-02 | FAIL | **CONFIRMED_BUG** | 浏览器实测同 linkId 2 行 |
| T-P0-03 | FAIL | **CONFIRMED_BUG** | 浏览器 409 + 服务端 0 行 / 界面 2 行 |
| T-P0-04 | FAIL | **BLOCKED（未复跑）** | 不自动继承；上轮真实 409 证据保留 |
| T-P1-01 | FAIL | **IMPLEMENTATION_GAP** | 判据升级为违反冻结基线 §2.1 |
| T-P1-02 | FAIL | **①PASS / ②BLOCKED** | ①整体删项目：回收站只有 project，恢复后合同回来 |
| T-P1-05 | FAIL | **IMPLEMENTATION_GAP** | 后端 `entries/reorder` 实测可用；前端无入口 |
| T-P1-10 | PASS（静态） | **BLOCKED** | A/B 未动态复跑，不能沿用 PASS |
| T-P2-07 | PASS | **PASS** | 浏览器实测：命中 2 条，双击进入 `a:achievement:10` |
| T-P2-12 | PASS | **PASS** | Host 403 / Origin 403 / 无 token 401 / localhost 403 |
| R-03/R-05 | 新 | **PASS** | 删一处不影响另一处；四项计量分开 |

---

## 6. 方法学与限制

1. **只读产品源码**：`git status` 全轮保持干净，唯一新增是 `docs/retest-v2-2026-10-22/`。
2. **测试库隔离**：每轮新 `runid`，密码随机写入 `build-retest/.../*.cred.json`，不进 docs、不进日志。
3. **浏览器**：CDP 驱动自带 Edge 进程（独立 `--user-data-dir`），结束时只关自己那一个进程，**不按映像名杀 msedge**。
4. **宿主单实例**：中途重复启动触发过系统提示框，已清理；之后全轮只保留一个宿主。
5. **未做的事**：16 项 BLOCKED 均未用静态推断冒充动态结论；`T-P2-10` 的原生拾取器、`T-P1-09` 的 PATH 隔离都未执行。

---

## 7. 风险与合并建议

**不建议合并回 main。** 两个 P0 都是同一形状：**凡是要在树里“再走一层”的能力都掉了**——目录深一层、附件多一版、记录间多一条引用、跨工作区多一个目标、列表多一个手工顺序。老壳在表格模型里靠 `groupId`/`parentId`/`folderId` 分别处理，换成树模型后这三条语义没跟过来。

修复顺序建议：

1. BUG-001（层级）+ BUG-002（版本归并）—— 同一处 `buildTree`，一起改；
2. BUG-003（批量删除的结果与刷新）—— 与 BUG-002 同源，版本归并后不会再对同一 linkId 发两次；
3. BUG-006 / 009 / 010（登录建库 + 目录 CRUD + 排序）—— 入口契约；
4. BUG-013 / 014 / 015 / 016（误导性入口）—— 文案与可见性；
5. R-08（先改测试断言）必须排在 BUG-002 之前。

**合并门槛**：两个 P0 有动态回归用例（目录递归、版本归并）、`ui-tree-smoke` 断言已修正、16 项 BLOCKED 至少补掉压缩与关库两项。

---

## 8. 证据索引

| 路径 | 内容 |
|---|---|
| `IPSys_Explorer_Full_Retest_V2_Cases.csv` | 38 项逐条状态（12 列） |
| `evidence/fixture.json` | 本轮所有测试对象的 id（项目/合同/IP/目录/附件/回收站） |
| `evidence/fixture-build.log` | 建库与每个 fixture 的 HTTP 往返 |
| `evidence/T-P0-0x.txt` / `T-P1-0x.txt` / `T-P2-0x.txt` / `R-0x.txt` | 每项的请求、返回、判定 |
| `evidence/shots/` | 登录页、档案根、IP 附件两行、删除后、重命名、快捷访问、首页导入、键盘、搜索、PDF、三档视口 |
| `evidence/http-results.json` / `browser-results.json` | 脚本原始结果（可复跑比对） |
| `evidence/BLOCKED-LIST.md` | 16 项未执行的逐条原因与复跑方式 |
| `scripts/` | `lib.cjs` / `fixture.cjs` / `t-http.cjs` / `t-browser.cjs` / `gen-cases.py` |

**声明**：本轮没有修复任何产品代码，没有提交或推送过产品源码；唯一的提交是 `docs/retest-v2-2026-10-22/` 下的测试交付物。
