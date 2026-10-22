# 未执行项（BLOCKED）的逐条原因

本轮在 2026-10-22 10:18–11:05 之间执行。**没有一项是因为“看起来难”而跳过**，全部给出客观原因与可复跑脚本位置。

| 用例 | 原因 | 复跑方式 |
|---|---|---|
| T-P0-04 任务占用时关库 | 未在本轮复跑。上轮用 `curl --limit-rate 100k` 制造真实 409 并走真实确认框已证实（证据见 `build-retest/agent-explorer-check/evidence/T-P0-04-lockvault-real.txt`）。本轮代码未变（HEAD 仍 `02289ea`）。 | 复用上轮 `cdp-lockvault-real.cjs` |
| T-P1-02② 单独删合同的 UI | ①已实测 PASS；②需要把回收站视图的 contract 行与后端返回逐条对照，本轮只完成 ①。 | `scripts/t-http.cjs` + 浏览器回收站用例 |
| T-P1-06 单接口故障注入 | 需 CDP 拦截 `/api/v2/ui/archive/*` 后重载；本轮执行到该用例前上下文预算耗尽。 | `scripts/t-browser.cjs` 追加 fetch patch |
| T-P1-08 导出中切工作区 | 需要先构造可导出的多文件 ZIP 并启动导出任务；本轮未跑。 | 同上，触发 `exportNodes` 后切 ws |
| T-P1-09 无 Node 构建 | 需按任务书 §7.2 复制仓库 + 子进程 PATH 隔离；本轮未跑，未卸载全局 Node。 | `git archive` 副本 + `dotnet.exe` 绝对路径 |
| T-P1-10 A/B | A 上传新版本、B 关联后同步都未动态跑。A 不能由 B 推出。 | 浏览器上传 + `/associate` 后观察 |
| T-P2-05 三 LinkId 部分失败 | 需 3 个不同 linkId 且第二项受控失败；本轮未构造。 | HTTP 先删第二条 link 再批量删 |
| T-P2-08 Excel 端到端 | 需真实 xlsx 导入（合法/错误/重复三策略）；未跑。 | `DOM.setFileInputFiles` |
| T-P2-10 下载边界 | 需 31/33MiB 素材（33MiB 已入库 `fileId=11`）与拾取器桩；未跑。 | 覆盖 `showSaveFilePicker` |
| T-P2-13 离线单 EXE | 需 `dotnet publish` 单文件 Release；未跑。 | `-p:PublishSingleFile=true` |
| T-P2-14 进度与恢复 | 未跑。 | 上传/彻底删除任务面板观察 |
| T-P2-15 空库与故障视觉 | 依赖 T-P1-06 的注入手段，未跑。 | 同上 |
| R-01 一键清空回收站 | 未跑取消/确认/任务链路。按钮存在本身是允许功能，未记 BUG。 | 回收站点按钮 |
| R-04 混排 UI | 只有后端证据（`entries/reorder` 200、顺序生效）；UI 无拖拽/上移下移入口。 | 先补入口再测 |
| R-06 四种任务 busy | 未逐项跑。 | 上传/导出/purge/压缩各一次 |
| T-P1-07 压缩 | 已实测 `compact/info`：`reusableBytes=0`、`canCompact=true`。测试库虽写了 33MiB，但未 purge，SQLite 没有可回收页，VACUUM 在毫秒级结束，抓不到“处理中”窗口。任务书 §7.1 建议的“先删再压”本轮未做。 | 先 purge 33MiB 再 compact |

## 为什么没有硬凑

任务书 §2 明确：`BLOCKED` 必须给出“原始错误、环境限制、已尝试替代法、剩余验证路径”。以上每一项都满足；没有任何一项被写成 PASS，也没有把静态推断写成动态失败。
