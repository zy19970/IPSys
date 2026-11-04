# IPSys 重构清理实施后复核

复核日期：2026-11-04（UTC+8）。被审查 main：`a734494c596db4e0119da61e7b59bee2a23c5c62`；产品/测试基线：`cc7c1262eac0c2aaa36a0cd3107823320627e774`。本轮仅审查与归档，未修复产品代码。

## 1. 结论

原整改方案的主体已经实现，不能再把原来的八组问题全部当作未处理。合同业务退出、schema 3、跨模块原位移动、项目目录独立复制、统一排序和主要死代码删除均有实际代码与测试证据。

但尚不宜认定“全部清理完成、只剩人工验收”。本轮确认一个高优先级业务边界缺陷、一个验收门禁缺口和一处现行文档遗漏。建议补齐下列 R1—R3 后再更新 S5 结案状态。

## 2. R1：跨模块移动遗漏已删除子目录及其后代（高）

### 2.1 位置与根因

1. `src/IPSys.Web/NativeFolderBatchTransferEndpoints.cs:38`：源树来自 `NativeArchiveStore.ListAll`，仅包含有效可见目录。
2. `src/IPSys.Web/NativeArchiveStore.cs:301–313`：SQL 排除 `deleted=1`，并通过 `FolderActive` 排除已删除祖先下的全部目录。
3. `src/IPSys.Web/NativeFolderBatchTransferEndpoints.cs:145–160`：只更新上述有效树的后代 section，SQL 还限定 `deleted=0`。回收站子目录及被它隐藏的有效后代均未跟随父级变更模块。
4. `src/IPSys.Web/RecycleStore.cs:149`：恢复仅将 deleted 改为 0，不重建 section/parent 一致性。`ResourceSchemaV2.cs` 的父级触发器针对 parent_id/section 更新，恢复时不会触发。
5. `src/IPSys.Web/RecycleStore.cs:369–374`：永久清理检查所有后代 section 与所选根一致，遇到遗留旧 section 会拒绝。

GUI 批量移动、MCP `move_folder`、同区 `transfer_folder(move=true)` 及旧单目录 move 适配器共用这条事务路径，因而不是一个菜单的孤立问题。

### 2.2 可复核操作

1. 新库中新建项目 P，建立 P/D1/D2/D3；D1、D2、D3 均为 `section=project`。
2. 仅删除 D2。现行软删除只给 D2 打标，D3 保持 deleted=0，但因祖先已删而不可见。
3. 将 D1 原位移动至 company/general 根。
4. 此时 D1.section=general，而 D2.section、D3.section 仍为 project；parent_id 仍分别指向 D1、D2。
5. 在回收站恢复 D2，恢复 SQL 可成功，但前端按模块建树时找不到它在 project 模块中的有效所属项目，D2/D3 不出现在项目树或 general 树中。
6. 另一分支：步骤 3 后不恢复 D2，先删除 D1，再永久清理 D1；完整子树枚举遇到 D2.section=project，与根 general 不符，触发“待删除目录包含不属于本目录的子项”。

普通模块之间也受影响。例如 general→achievement 后恢复旧 general 子目录，前端可能把它提升到旧模块根，真实 parent_id 却仍指向新模块中的父目录。

### 2.3 本轮复现证据及边界

从当前 `ResourceSchemaV2.Create` 原样提取建表 SQL，在 Python SQLite 内存库启用外键；执行当前移动根目录 SQL、当前恢复 SQL，并调用真实 `wwwroot/js/data.js` / `store.js` 的 `VaultStore.buildTree`。不是仅按函数名猜测，也没有操作用户数据库。

实际输出：

```text
active source rows (matching ListAll/FolderActive): [9]
after move: [(9, 'general', None, 0), (10, 'project', 9, 1), (11, 'project', 10, 0)]
ExpandFolderPurge section test: False
restore SQL succeeded; foreign_key_check: []
production buildTree visible 9: true
production buildTree visible 10: false
production buildTree visible 11: false
```

这是 SQL 与生产前端函数层的确定性复现；本轮未重新运行 Windows EXE、SQLCipher HTTP 全链路。永久清理的拒绝由生产条件及实际行值核对，未声称本轮点击了 Windows 回收站按钮。普通 SQLite 外键检查不报错，因为外键并不校验 section；不能用 foreign_key_check 通过推导业务层级正确。

### 2.4 修复要求

1. 同工作区原位移动应枚举来源的完整物理后代关系，包括已删除目录和被已删除祖先隐藏的有效后代；只有原位移动需要跟随历史归属，不要顺手改变复制/共享“仅复制有效内容”的既定语义。
2. 对完整后代同步目标 section，保留全部 FolderId、parent_id（根除外）、deleted、FileId、LinkId 和历史版本。不得通过恢复全部目录来绕过父级触发器。
3. 注意 `folder_parent_update` 目前要求直接父级 deleted=0：简单移除查询中的 deleted 过滤仍不足以处理 D3，因为其父 D2 仍处回收站。需整体设计“已删除子树随活动祖先变更模块”的受控约束，并保持工作区、模块一致性与防循环校验。禁止直接关掉所有父级保护。
4. 所有变更仍应在一个事务中完成；中途失败、取消、同名冲突必须回滚。完整后代计数应受现有限额约束。
5. 在正式实现完整安全移动前，可先明确拒绝包含回收站后代的跨模块移动作为临时防护；这只能阻止继续制造坏状态，不能作为完整功能验收通过。
6. 增加至少四组真实 SQLCipher/HTTP 回归：project→general 后恢复；general→achievement 后恢复；包含墓碑后代的父目录永久清理；第二次 section 更新故障注入回滚。再覆盖 MCP 调用共同核心后的结果及 GUI 可见性。
7. 测试要包含三层以上、D2.deleted=1 且 D3.deleted=0 的情形；只测“全树有效时移动”和“移完后才删除恢复”会再次漏掉本问题。

## 3. R2：分项 FAIL 仍可能让 Windows CI 绿色（中）

### 3.1 位置

`tests/retest-v2-2026-10-22/scripts/t-http.cjs:396–399` 写结果并输出汇总；只有抛异常时进程失败，记录 `rec(...,"FAIL",...)` 本身不失败。

`tests/retest-v2-2026-10-22/scripts/t-browser.cjs:815–817` 只检查 `T-P2-02/T-P2-09/S5-E2E` 三项 PASS。其余用例若仅记录 FAIL 而未抛异常，可被遗漏。

`.github/workflows/web-windows.yml` 的结果 JSON 汇总循环只 Group-Object/Write-Host，没有统一结果断言。

### 3.2 本轮验证

在 Node VM 中直接运行生产脚本末尾的结果汇总/门禁代码，使用合成结果，不修改仓库测试文件：

```text
HTTP result FAIL: summary returns normally; no failed exit
Browser T-P2-07 FAIL with three required cases PASS: gate returns normally
```

因此 #538 的实际全 PASS 记录有效，但“CI success”本身仍不足以保证今后的所有分项都通过。这不是声称 #538 有被隐藏的失败。

### 3.3 修复要求

1. 对两份 JSON 中所有现行必测项统一检查 FAIL/ERROR/缺项/重复 ID，不得仅检查三个新用例。
2. 对暂允许的 `T-P1-07 BLOCKED` 建明确白名单与原因；不要笼统放过任意 BLOCKED，更不能把 FAIL 当作允许的跳过。
3. 引入小型门禁测试：分别注入 HTTP FAIL、普通浏览器 FAIL、缺少预期用例，均必须让验证退出非零；只有明确允许的压缩视觉 BLOCKED 可通过并保留报告。
4. 保留历史报告原文；修复活跃脚本/工作流，不回写旧运行结果。

## 4. R3：现行 Wiki MCP 数量仍为 51（低）

`docs/wiki/MCP-and-Agent.md:29` 仍写“当前 MCP 注册 51 项工具”，该段不是标注的历史记录。实际主工作流和 `MCP_CODEX.md` 当前契约为 43 项，旧合同七工具及 reorder_folders 已退休。

将当前说明改为 43 或引用唯一现行契约入口。对根手册中已明确标注的历史 51/59 工具记录，不应机械批量替换；历史与现行应区分处理。`MCP_CODEX.md` 的阶段段落还保留“S4/S5 待执行”，虽有顶部覆盖说明，建议把阶段进度移到历史区，避免全文检索误取旧说明。

## 5. 原问题逐项复核

| 原项 | 当前实现 | 本轮结论 |
| --- | --- | --- |
| C01 合同模型冲突 | 模型/工具/专用写路由退出；项目普通目录替代 | 已落实；剩余 Contract 文件名承载项目排序/负面回归，不应仅凭名删除 |
| C02 顶层跨模块移动 | 原位置判断同时比较 section 和 parent | 原问题已修；R1 是删除历史与跨模块移动的组合缺陷 |
| C03 项目目录独立复制 | 真实项目/子目录目标树与选择器；GUI E2E 验证 | 已落实 |
| C04 GUI/MCP 契约 | move/transfer 同区共用原位事务；跨区矩阵一致 | 主体已落实；共同核心仍有 R1 |
| C05 同层排序 | 完整同层集合校验、事务、project 真父级 | 已落实，已有 O 系列测试 |
| C06 新旧库区分 | schema=3、新库触发器完整创建、旧库拒绝 | 已落实；本轮未做任意损坏库穷举或真实故障注入 |
| C07 遗留实现 | moveArchiveEntry、未注册旧排序端点已删除 | 已落实；有效 PDF/ZIP/上传和历史证据仍保留 |
| C08 文档/测试统一 | 大部分主文档已改，新增同批对象 E2E | 主体完成；R2/R3 尚待补齐 |

## 6. 已核验的测试证据

1. 本轮在独立 detached worktree 重建前端，按当前 workflow 清单运行 29 项 Node Smoke，29/29 通过。
2. 实际读取 Windows CI #538 的 job `126608189136`：26 success、0 failure、2 skipped。日志中的 checkout SHA 为 `cc7c1262eac0c2aaa36a0cd3107823320627e774`，与所审产品基线一致；其后 main 仅有 Markdown 归档变更。
3. 原始日志确认 browser 14 PASS；HTTP 12 PASS / 1 BLOCKED；S5-E2E、拖放 T-P2-02、PDF T-P2-09 均 PASS。两个单 EXE 启动检查通过。
4. 本轮额外运行 R1 的原始 SQL/生产前端函数复现，以及 R2 的生产结果门禁片段验证。二者覆盖的是既有成功用例之外的组合与失败输入。
5. 本环境没有 dotnet，未本轮重跑 C# 编译、Windows UI 或 SQLCipher EXE。未修改用户真实库，未迁移旧库，未发布 Release。

CI 原始运行：[Windows #538](https://github.com/zy19970/IPSys/actions/runs/41839841405)。原结案报告：[S5_FINAL_ACCEPTANCE_20261104.md](S5_FINAL_ACCEPTANCE_20261104.md)。本报告补充其覆盖范围，不否定已核验的成功运行。

## 7. 建议后续顺序

先修 R1 并补真实数据库组合回归，再补 R2 门禁，最后修 R3 文档及更新结案状态。完成后按新产品 SHA 运行 Windows CI，再继续本机体验验收。本轮的最终判断是“主体整改完成，尚有一处业务边界和两处验收/文档收尾”，不是要求重做 S1—S5。
