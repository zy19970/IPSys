# IPSys S5 最终清理与自动化验收结案报告

验收日期：2026-11-04（UTC+8）。验收对象：[main 提交 cc7c1262eac0c2aaa36a0cd3107823320627e774](https://github.com/zy19970/IPSys/commit/cc7c1262eac0c2aaa36a0cd3107823320627e774)。

## 一、结论

**S0～S5 重构清理与自动化验收完成，用户本机人工体验验收、真实故障注入和正式 Release 未完成。**

最终产品/测试代码基线 `cc7c1262eac0c2aaa36a0cd3107823320627e774` 对应 [Windows CI #538](https://github.com/zy19970/IPSys/actions/runs/41839841405)（run `41839841405`）：`completed/success`，**26 个成功步骤、0 个失败步骤、2 个可选大于 4 GiB ZIP64 步骤跳过**。Debug 编译 0 warning / 0 error；Node/UI、MCP stdio、临时 SQLCipher+HTTP、真实 Edge+HTTP、框架依赖与自包含两种单文件 EXE 启动/图标均通过。

原始 Edge 浏览器观察结果：**14 PASS / 0 FAIL / 0 BLOCKED**。HTTP：**12 PASS / 0 FAIL / 1 BLOCKED**。唯一 BLOCKED 为 T-P1-07 的短时压缩进度窗口：合成小库 `reusableBytes=0`，`compact/info` 接口正常，但无法稳定抓拍极短的 VACUUM 进度。它不是程序运行失败，不能替代本机人工验证。

## 二、重构问题 C01～C08 的实际处理

| 项目 | 当前结果及依据 |
| --- | --- |
| C01 合同独立业务记录与界面矛盾 | S2 已退出合同业务类型、独立工具和写入接口；项目下合同材料作为 `archive_folder(section=project)` 普通多级目录，旧合同工具直调受拒；CI #526 与 #538 |
| C02 跨模块顶层目录移动误判 | S1 调整目标 section 与真实 parent 联合判断；同区移动保留 FolderId/FileId/LinkId；CI #521 与 #538 |
| C03 项目子目录独立复制与跨区目标 | S3 完成合法目标与项目真实父级选择器；S5-E2E 真实 GUI 独立复制到另一项目，并验证新 FileId 与两版 SHA；CI #529/#538 |
| C04 MCP 和 GUI 移动/共享契约分裂 | S3 统一 `move_folder.target_section` / `transfer_folder` 与 GUI 语义；S5-E2E 跨入口同一批数据验证；CI #529/#538 |
| C05 多模块多级排序不统一 | S4 `list_folder_entries` / `reorder_entries` 以完整同层集合持久化，旧 `reorder_folders` 退休；CI #532/#538 |
| C06 SQLCipher 旧库和新模型不一致 | S2 新库 schema **3**，旧版数据库明确拒绝不迁移、不静默自动补列；创建/重开和约束回归通过；CI #526/#538 |
| C07 遗留旧移动 UI 与退休排序入口 | S5-1 删除无注册的 `NativeArchiveUiOrderEndpoints.cs`、旧 `moveArchiveEntry` 长下拉，迁移有效循环检查到现行选择器 Smoke；保留仍在生产调用的 `NativeArchiveOrder.cs`、历史负面测试；CI #533/#538 |
| C08 现行文档、Agent 指引及测试口径 | S5-3 已统一 schema 3、MCP **43** 工具、项目普通目录及普通资料六列 Excel；#535 发现 MCP 根索引过长后已恢复 281 字短入口，保留详尽规范到 `MCP_CODEX.md`；#538 验证通过。当前结案状态以本文为准 |

## 三、第16.4节同一批对象跨入口闭环

测试在 Windows CI 的**临时 SQLCipher 资料库**执行，通过真正 MCP stdio 子进程、真实 Explorer JS 操作处理器与本机 HTTP 服务共用数据，不是分别独立模拟“能创建”和“能显示”。

1. MCP 创建项目 P1=`29`、P2=`30`，在 P1 中创建 D1=`31`、D2=`32`。HTTP 上传 `F` 两个不同版本，记录 FileId=`13`、LinkId=`15`，两次版本下载 SHA-256 分别为 `d9fd7ed6087bedf19dd9a9ad62fa358f8991ead6ace98189d919d3d10edd9117` 和 `70d0f12fae8d42014267a032652c082c3cf265f44fab9c263839dfe7772c60aa`。
2. Explorer 显示相同 FolderId/FileId，UI 搜索 F 命中 FileId=`13`，回溯归属 D2=`32`。
3. GUI 将 D1 原位移到 general 根，MCP 再移到 P2；FolderId、FileId、LinkId 保持不变。
4. GUI 共享整棵 D1 到 general：目标创建新 FolderId/LinkId，仍引用 FileId=`13`；再从**真实 GUI 独立复制表单**选择 P1，产生新 FolderId=`35`、FileId=`14`，MCP 再读确认，两个版本 SHA 与来源一致。
5. MCP 同级目录排序、Explorer 刷新后次序一致；GUI 删除 D1、MCP 回收站恢复后原 FileId/LinkId 完好。
6. 仅永久清理测试中的共享副本，原始文件两个历史版本仍可下载并与之前 SHA 一致。

以上对应 **`S5-E2E PASS`**。现行 Edge 核心用例 `T-P2-02 PASS`（真实拖拽关联移动）与 `T-P2-09 PASS`（连续滚动 PDF 两页真实 Canvas 渲染）已经纳入必过门禁，FAIL/BLOCKED/缺失均会使工作流失败。

## 四、HTTP 历史观察与未覆盖范围

本次 CI #538 的 `T-P0-05 PASS` 确认同 FileId 跨两条知识产权记录具有独立 LinkId；`T-P1-03 PASS` 确认目录移动、移回与转移接口均正常。此前两项 `IMPLEMENTATION_GAP` 源于旧脚本即使后端成功也硬编码旧标签，且使用“GUI 没有入口”的过时说明；已修复**活跃测试脚本**，保留此前 run 的原始结果。

`T-P1-07 BLOCKED`：压缩信息接口正常，短时进度视觉证据尚未取得；需要在用户真实桌面选择可控测试库人工观察。另外，用户本机 DPI/缩放、鼠标右键与多选、多级目录移动、跨工作区切换、较大文件任务期间的忙碌状态/进度反馈、极端磁盘空间/断电/拔盘等尚未用用户机器进行完整故障注入。GitHub Hosted Windows CI 不等于用户本机最终手感验收，也不覆盖正式资料库的恢复演练。

## 五、构建产物与交付位置

| 产物 | Artifact ID | 取得方式 |
| --- | --- | --- |
| Windows x64 自包含单文件 EXE | `13328532212` | [CI #538 Artifacts](https://github.com/zy19970/IPSys/actions/runs/41839841405) |
| Windows x64 依赖已安装 .NET 的单文件 EXE | `13328592196` | 同上 |
| Explorer/HTTP/Edge 自动化证据包 | `13328352297` | 同上 |

上面是 GitHub Actions Artifacts，不是正式 Release。现有最新 Release 为 **`v0.9.1-rc1` 预发布（2026-10-23）**，并不包含 S5 代码。新版本发布必须由用户明确要求后手动触发。

## 六、用户本机最后验收清单

1. 使用 #538 自包含 EXE 和**单独新建的测试数据库**启动，确认登录、工作区切换和窗口/托盘行为，使用 100%、125% 或自己的实际 DPI 检查布局。
2. 在企业资料与个人资料中创建目录；在真实项目内嵌套多层文件夹，批量上传附件，检查预览、搜索、属性和 Excel 六列模板。
3. 用 GUI 分别执行**移动、共享与独立复制**，检查来源与目标、子层级、文件版本、成功提示自动隐藏及右键/多选；确认同工作区共享与独立复制的区别。
4. 从 Explorer 改排序后刷新或重开，利用本机 MCP 查看顺序；再通过 MCP 修改，回到 Explorer 验证。
5. 用独立测试附件执行删除、回收站恢复、永久清理，特别检查共享副本删除后其他有效引用与历史版本仍可打开。
6. 选一份可安全重做的小型测试库触发“压缩数据库”，观察过程中进度/忙碌提示及完成/取消反馈。必要时以较大但可丢弃的测试库重复，不在唯一正式数据库上试验中断、拔盘或磁盘故障。

本机人工验收完成前，阶段状态准确表述为：**S5 自动化验收完成；发布前本机体验验收待完成。**

## 七、历史与规则边界

S1 [CI #521](https://github.com/zy19970/IPSys/actions/runs/41793618031)、S2 [#526](https://github.com/zy19970/IPSys/actions/runs/41802424444)、S3 [#529](https://github.com/zy19970/IPSys/actions/runs/41816669123)、S4 [#532](https://github.com/zy19970/IPSys/actions/runs/41822426599)、S5-1 [#533](https://github.com/zy19970/IPSys/actions/runs/41831428604) 以及 S5 最终 [#538](https://github.com/zy19970/IPSys/actions/runs/41839841405) 均是按各自提交 SHA 核对的 CI 结果。#535 曾因 MCP 初始化根指引错误实际失败，#536 的 PDF 分项曾 FAIL 却未引发整套 CI 失败；两项均已修正且由后续真实 Edge #537/#538 重新确认。历史日志与旧测试记录不改写。

本次仅使用可丢弃的测试数据，**未读取、修改或迁移用户正式资料库，未触发正式 Release**。S5 所有完成断言以本报告明确列出的运行与代码证据为限。
