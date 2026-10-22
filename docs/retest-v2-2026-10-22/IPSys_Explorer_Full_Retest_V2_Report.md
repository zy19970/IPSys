# IPSys Explorer 全量复测报告 V2

- 执行日期：2026-10-22
- 测试时被测产品源码基线：`02289ea7020861360baa0a4c49ca045f3c783aea`｜交付分支 `work/onedrive-file-manager`
- 测试库：`build-retest/agent-explorer-full-v2/vault-v2c.db`（本轮新建，随机密码仅存于同目录 `.cred.json`，不入库）
- 浏览器：本机 Microsoft Edge（headless=new，CDP 驱动；未接管用户已开窗口）
- 结论先行：**产品源码零改动**。38 项中 20 项形成有效结论，18 项 BLOCKED/待复测；旧版搜索与 PDF 测试存在判据不足，复核已撤销一项误报并修正统计。**不建议现在合并回 main。**

---

## 1. 本轮先纠正了任务书什么

完整勘误见 `IPSys_Explorer_Full_Retest_V2_Errata.md`，10 处。最影响执行的四条：

1. **任务书 §1.2「不提交、不推送」与用户本轮指令冲突，且 §8 的交付目录被 `.gitignore` 忽略** —— 按原文执行，「把结果推到仓库」永远做不到。改为：产品源码零改动，交付物写 `docs/retest-v2-2026-10-22/` 并单独提交。
2. **地址必须是 `127.0.0.1`，不是 `localhost`** —— `Program.cs:52-65` 对 Host 做严格字符串比较，`localhost` 直接 403。实测已证实。
3. **T-P2-07 的 `ownerKind` 勘误存在错误** —— 后端 `SearchHit` 包含 `OwnerKind/OwnerId`，前端使用 `ownerKind/ownerId` 定位所属记录；应核对文件命中到 link 的真实映射。
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

**Node smoke 全绿不代表版本折叠已覆盖**：`ui-tree-smoke.cjs:62-64` 中 `f:2:1` 与 `f:3:2` 是两个不同 linkId 的独立附件，原 R-08 缺陷判定为误报。该 smoke 没有覆盖同一 linkId 多版本折叠；BUG-002 由 T-P0-02 的独立动态证据确认。

---

## 3. 结果汇总

| 状态 | 数量 | 说明 |
|---|---:|---|
| PASS | 6 | T-P2-06 / 11 / 12、R-03、R-05、R-08 |
| CONFIRMED_BUG | 7 | BUG-001/002/003/013/014/015/016 |
| IMPLEMENTATION_GAP | 6 | BUG-005/006/008/009/010、R-02 |
| DOC_GAP | 1 | R-07（Q122 旧口径） |
| BLOCKED | 18 | 16 项原未完成，另 T-P2-07 / T-P2-09 需按修订判据复测 |
| **合计** | **38** | **30 旧 + 8 新，ID 全保留** |

- 测试项：38｜形成有效结论：20｜BLOCKED/待复测：18
- 问题目录：13 个已识别产品 BUG 编号（BUG-004 本轮未复跑）、1 项实现缺口（R-02）、1 项文档缺口（R-07）；T-P1-02 的单独删合同子项尚未确认为缺陷，BUG-017 已撤销
- 方法分布（按 CSV Method 列）：`DYNAMIC-BROWSER` 10、`DYNAMIC-HTTP` 4、`STATIC` 3、`MIXED` 8、未指定具体方法 13
- 逐项状态见 `IPSys_Explorer_Full_Retest_V2_Cases.csv`（12 列，含 Observed/Expected/Evidence/SourcePath）；原始结果与复核判定的差异见 `evidence/RESULT-ADJUDICATION.md`

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

拖项目 A 附件到 IP-B 记录，toast：「附件移动需要后端支持 link 迁移；当前请用「上传」挂到目标记录」。
但后端 `POST /api/v2/files/{ws}/{fileId}/associate {linkId,targetFolderId,move}` 已可用（T-P1-03 实测 move 200）。**不是后端缺能力，是前端没调用**。

### BUG-015（P2，T-P2-03）「添加快捷访问」是假按钮

`interactions.js:700` 硬编码 `toast("「快捷访问」已按资料分类自动生成")`，没有任何自定义快捷方式能力。

### BUG-016（P2，T-P2-04）首页「导入资料」直接弹文件选择器

`pickFiles()` 只判断当前 folderId 是不是 folder；首页 `folderId=root` 恰好通过，于是**打开了 1 次文件选择器，没有任何“先选记录”的引导**。`REQUIREMENTS.md:30/153` 要求先有业务记录再上传。

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
| T-P1-02 | FAIL | **①PASS / ②BLOCKED（不确认 BUG-007）** | ①整体删项目：回收站只有 project，恢复后合同回来 |
| T-P1-05 | FAIL | **IMPLEMENTATION_GAP** | 后端 `entries/reorder` 实测可用；前端无入口 |
| T-P1-10 | PASS（静态） | **BLOCKED** | A/B 未动态复跑，不能沿用 PASS |
| T-P2-07 | PASS | **BLOCKED** | 旧脚本只证明档案跳转；未测试附件命中映射，且证据文字与实际查询词不一致 |
| T-P2-09 | PASS | **BLOCKED** | 旧判据仅检查 Canvas 存在；状态仍在解析且页码为 0，未证明渲染成功 |
| T-P2-12 | PASS | **PASS** | Host 403 / Origin 403 / 无 token 401 / localhost 403 |
| R-08 | BUG-017 | **PASS（误报撤销）** | `f:2:1` 与 `f:3:2` 是不同 linkId；原断言没有把同一附件版本拆成两行 |
| R-03/R-05 | 新 | **PASS** | 删一处不影响另一处；四项计量分开 |

---

## 6. 方法学与限制

1. **只读产品源码**：`git status` 全轮保持干净，唯一新增是 `docs/retest-v2-2026-10-22/`。
2. **测试库隔离**：每轮新 `runid`，密码随机写入 `build-retest/.../*.cred.json`，不进 docs、不进日志。
3. **浏览器**：CDP 驱动自带 Edge 进程（独立 `--user-data-dir`），结束时只关自己那一个进程，**不按映像名杀 msedge**。
4. **宿主单实例**：中途重复启动触发过系统提示框，已清理；之后全轮只保留一个宿主。
5. **未形成结论的事项**：18 项 BLOCKED 中，16 项本轮未完成；T-P2-07 与 T-P2-09 已尝试，但原判据/证据不足，需按修订脚本重测。原始 JSON 保留旧结果，不回写成“新实测”。`T-P2-10` 的原生拾取器、`T-P1-09` 的 PATH 隔离仍未执行。

---

## 7. 风险与合并建议

**不建议合并回 main。** 两个 P0 都是同一形状：**凡是要在树里“再走一层”的能力都掉了**——目录深一层、附件多一版、记录间多一条引用、跨工作区多一个目标、列表多一个手工顺序。老壳在表格模型里靠 `groupId`/`parentId`/`folderId` 分别处理，换成树模型后这三条语义没跟过来。

修复顺序建议：

1. BUG-001（层级）+ BUG-002（版本归并）—— 同一处 `buildTree`，一起改；
2. BUG-003（批量删除的结果与刷新）—— 与 BUG-002 同源，版本归并后不会再对同一 linkId 发两次；
3. BUG-006 / 009 / 010（登录建库 + 目录 CRUD + 排序）—— 入口契约；
4. BUG-013 / 014 / 015 / 016（误导性入口）—— 文案与可见性；
5. 在修复 BUG-002 前，新增“同一 linkId 多版本只显示最新版”的回归用例；现有 `ui-tree-smoke` 断言本身无需修改。

**合并门槛**：两个 P0 有动态回归用例（目录递归、版本归并）；增加同一 linkId 多版本折叠的自动化覆盖（现有 `ui-tree-smoke` 断言本身不需修改）；关库与压缩任务互斥测试完成；T-P2-07 附件搜索映射和 T-P2-09 两页 PDF 渲染通过有效判据；18 项 BLOCKED 均需逐项关闭或保留明确理由。

---

## 8. 证据索引

| 路径 | 内容 |
|---|---|
| `IPSys_Explorer_Full_Retest_V2_Cases.csv` | 38 项逐条状态（12 列） |
| `evidence/fixture.json` | 本轮所有测试对象的 id（项目/合同/IP/目录/附件/回收站） |
| `evidence/fixture-build.log` | 建库与每个 fixture 的 HTTP 往返 |
| `evidence/T-P0-0x.txt` / `T-P1-0x.txt` / `T-P2-0x.txt` / `R-0x.txt` | 每项的请求、返回、判定 |
| `evidence/shots/` | 登录页、档案根、IP 附件两行、删除后、重命名、快捷访问、首页导入、键盘、搜索、PDF、三档视口 |
| `evidence/http-results.json` / `browser-results.json` | 旧版脚本原始结果，保留原样 |
| `evidence/RESULT-ADJUDICATION.md` | 原始结果的判定复核、误报撤销与待复测原因 |
| `evidence/BLOCKED-LIST.md` | 18 项未形成有效结论的原因与复跑方式 |
| `scripts/` | `lib.cjs` / `fixture.cjs` / `t-http.cjs` / `t-browser.cjs` / `gen-cases.py` |

**声明**：本轮没有修复任何产品代码，没有提交或推送过产品源码；唯一的提交是 `docs/retest-v2-2026-10-22/` 下的测试交付物。
