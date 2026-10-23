# IPSys 现行测试与验收规则

> 适用于 2026-10-23 Explorer 合并后的 `main`。本文件汇总历史 `WEB_TESTING.md`、`LARGE_FILE_TESTING.md`、`RESOURCE_REFACTOR_TEST_MATRIX.md` 的仍有效测试原则，原报告和过程证据仍需按 [证据索引](./tests/TEST_EVIDENCE_INDEX.md) 追溯。

## 测试结果必须分层

将“源码已实现”“自动 Windows CI 通过”“本地 Agent 实际执行”“用户人工反馈通过”“未执行/阻塞/失败”分别标记，并给出对应 SHA。任何一次旧报告中的 FAIL/BLOCKED 都是当时的真实记录，后续修复不得改写其原文；旧版本失败也不等于当前产品未修复。人工验证无截图、SHA 或独立解包日志的，不虚构证据。

## 主分支 Windows CI

主工作流 `.github/workflows/web-windows.yml`，产品源码、Explorer 前端及关联脚本改动触发 Windows 托管 runner。包括 Debug 编译和嵌入前端检查、Release 单 EXE、.NET 8 运行时前提、MCP stdio（59 工具）、Node/Explorer 交互回归、Edge/HTTP 真实浏览器回归、SQLCipher/HTTP 及业务事务检查。合并版本 `8227d2c` 的主分支 [#39947975625](https://github.com/zy19970/IPSys/actions/runs/39947975625) 全部必运行步骤通过。

`tests/retest-v2-2026-10-22/scripts/` 和相应 fixture **仍被 CI 调用**，即使路径包含历史日期，也不是可随意删除的废弃文件。测试实际入口以工作流和 `src/IPSys.Web/tests/` 中的现行引用为准。

## 大文件与 ZIP64 专项

单 File 最大 8 GiB，传输/下载须流式进行，核查大小、SHA-256、数据库完整性和实际任务终态。工作流 `workflow_dispatch` 的 `large_file_smoke=true` 会运行超过 2 GiB 的 SQLCipher/HTTP 上传下载及大库 VACUUM；[专项 #39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663) 已通过 22/22 步，包括成功压缩与 `integrity_check`。不能通过延迟失败检查或跳过压缩制造成功。

`zip64_file_smoke=true` 使用产品 `src/IPSys.Web/wwwroot/export.js` 流式写真实超过 4 GiB 的 ZIP64，校验 EOCD、locator、中央目录、长度及完整文件 SHA；[专项 #39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866) 已通过 24/24 步。其结论为 **PASS_GENERATION_ONLY**：数据源为可重复模拟流、保存句柄为程序化适配，不等同于真实 Edge 文件选择器或第三方解包器。用户后续确认本机人工检验已完成；不能把未上传的手动日志算作自动化证明。可在空闲空间足够的测试机设置 `IPSYS_ZIP64_OUTPUT_DIR` 并运行 `node src/IPSys.Web/tests/zip64-real-generate.cjs` 保留本地 ZIP，不要把大 ZIP 提交仓库。

## 必须核对的业务与安全边界

一项目多合同，合同必须附属于项目；业务 Folder 无版本，附件 FileVersion 永久保留；同区可共享 FileId 或独立 FileId 复用 FileObject，但跨区不能共用物理 FileObject。应同时验证前端反馈和真实 SQLCipher 表约束、事务回滚、SHA 与关联关系。

401 会话过期应清旧状态并引导重新登录；403/409/500 不是同一种错误。后台上传、跨工作区切换、悬挂原件取消、外部文件拖放与内部附件拖动、回收站大文件删除、数据库压缩、关闭程序都须保持原始工作区、任务锁与可观察的成功/失败状态。

历史冻结报告中的 T01～T09 涉及加密、数据一致性、断电/存储中断、磁盘不足、安全退出、备份/恢复与兼容边界。**此次合并与常规 CI 成功不表示全部发布级风险已验证。**若进入正式发布，须按对应风险做独立验证，绝不在用户唯一的正式资料库上进行破坏性测试。

## Agent 本地测试

本机实机用隔离 SQLCipher QA 数据库、专用 Edge profile、独立输入/导出目录；记录版本、运行时间、源码与 EXE SHA、环境、用例状态、可复验的结果与证据路径。旧 132 项/16 项补测/第三批实机报告分别保留。若旧脚本直接派发 `drop` 而没有产生真实 `dragstart`，不能把脚本前置缺失当作已证实的用户拖放缺陷。测试误报、环境阻塞、需求差异、真实 BUG 必须分类报告。

原始阶段与完整证据见 [TEST_EVIDENCE_INDEX](./tests/TEST_EVIDENCE_INDEX.md)；最新业务范围见 [REQUIREMENTS](./REQUIREMENTS.md)，技术约束见 [DESIGN](./DESIGN.md)。
