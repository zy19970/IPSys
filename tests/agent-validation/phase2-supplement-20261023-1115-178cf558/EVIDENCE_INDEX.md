# 证据索引（SUP-01～SUP-16）

- RUN_ID：`20261023-1115`　SHA8：`178cf558`　HEAD：`178cf558e4a878aadf4734b8b3725fb029c4b692`　分支：`work/onedrive-file-manager`
- 补测工作目录：`build-retest/supplement-20261023-1115/`
- 每项证据三类分列：UI 操作 / API 核验 / 数据库核验。后两者不能弥补缺失的 UI。

| 用例 | 状态 | UI 操作证据 | API 核验证据 | 数据库核验证据 | 记录文件 |
|---|---|---|---|---|---|
SUP-01 | PASS | 无（构建与 CI 证据） | `evidence/logs/sup01-runs.json`<br>`evidence/logs/sup01-jobs.json`<br>`evidence/logs/sup01-commit.json` | 只读 SQLCipher 检查（见记录） | `evidence/cases/SUP-01.json`
SUP-02 | PASS | `evidence/shots/SUP-02-qa-edge-real-window.png`<br>`evidence/shots/SUP-02-qa-unlocked.png`<br>`evidence/shots/SUP-02-launcher-after-tabclose.png` | /api/status | — | `evidence/cases/SUP-02.json`
SUP-03 | PASS | `evidence/shots/SUP-03-01-mcp-enabled.png`<br>`evidence/shots/SUP-03-02-mcp-concurrency.png` | `evidence\logs\sup03-mcp-stdio.json` | — | `evidence/cases/SUP-03.json`
SUP-04 | BLOCKED | 工具栏上传 + 原生文件选择器 | prepare/resolve + 版本下载端点 | 只读 SQLCipher 检查（见记录） | `evidence/cases/SUP-04.json`
SUP-05 | BLOCKED | 导出入口（被 OS 另存为阻塞） | 无（未落盘） | — | `evidence/cases/SUP-05.json`
SUP-06 | REQUIREMENT_GAP | `evidence/shots/SUP-06-excel-range.png` | /api/v2/excel/{ws}/{kind}/export | — | `evidence/cases/SUP-06.json`
SUP-07 | BLOCKED | `evidence/shots/SUP-07-01-saved.png`<br>`evidence/shots/SUP-07-02-after-switch.png` | 无（未落盘） | — | `evidence/cases/SUP-07.json`
SUP-08 | PASS | `evidence/shots/SUP-08-01-archive-root.png`<br>`evidence/shots/SUP-08-02-mixed-list.png`<br>`evidence/shots/SUP-08-03-after-rename.png` | 仅最终数据校验 | — | `evidence/cases/SUP-08.json`
SUP-09 | PASS | `evidence/shots/SUP-09-01-project-created.png`<br>`evidence/shots/SUP-09-02-attachments.png`<br>`evidence/shots/SUP-09-03-detail-v2.png` | SHA 对照 | — | `evidence/cases/SUP-09.json`
SUP-10 | PASS | `evidence/shots/SUP-10-01-project-A.png`<br>`evidence/shots/SUP-10-02-project-A-full.png`<br>`evidence/shots/SUP-10-03-personal-B.png` | SHA 与 FileId 对照 | — | `evidence/cases/SUP-10.json`
SUP-11 | PASS | `evidence/shots/SUP-11-01-ip-copy.png`<br>`evidence/shots/SUP-11-02-general-transfer.png`<br>`evidence/shots/SUP-11-03-archive-transfer.png` | SHA 对照 | — | `evidence/cases/SUP-11.json`
SUP-12 | CONFIRMED_BUG | `evidence/shots/SUP-12-01-home-blank.png`<br>`evidence/shots/SUP-12-02-category-blank.png`<br>`evidence/shots/SUP-12-03-project-blank.png` | 只读 SQLCipher 链接计数 | — | `evidence/cases/SUP-12.json`
SUP-13 | CONFIRMED_BUG | `evidence/shots/SUP-13a-01-baseline.png`<br>`evidence/shots/SUP-13a-02-after-401.png`<br>`evidence/shots/SUP-13a-03-after-refresh.png` | CDP Fetch.fulfillRequest 注入一次 401 | — | `evidence/cases/SUP-13.json`
SUP-14 | CONFIRMED_BUG | `evidence/shots/SUP-14-01-cancel.png`<br>`evidence/shots/SUP-14-02-after-interrupt.png`<br>`evidence/shots/SUP-14-03-offline.png` | 只读 SQLCipher（writing / integrity） | 只读 SQLCipher 检查（见记录） | `evidence/cases/SUP-14.json`
SUP-15 | PASS | 无（构建与 HTTP 产物） | dotnet build ×3 场景 + EXE HTTP /app.js SHA | — | `evidence/cases/SUP-15.json`
SUP-16 | PASS | 无 | 无 | — | `evidence/cases/SUP-16.json`

## 关键原始日志

- `evidence/logs/host-sup15-restore.log`（390986 B）
- `evidence/logs/sup01-commit.json`（2223 B）
- `evidence/logs/sup01-jobs.json`（5864 B）
- `evidence/logs/sup01-runs.json`（143472 B）
- `evidence/logs/sup03-error.json`（8138 B）
- `evidence/logs/sup03-finalize.json`（1984 B）
- `evidence/logs/sup03-followup.json`（6742 B）
- `evidence/logs/sup03-mcp-stdio.json`（211745 B）
- `evidence/logs/sup13a.json`（6688 B）
- `evidence/logs/sup13b-host.log`（12075 B）
- `evidence/logs/sup13b.json`（4679 B）
- `evidence/logs/sup13c-host.log`（988280 B）
- `evidence/logs/sup14-error.json`（11274 B）
- `evidence/logs/sup15-build-1-node-yes.log`（2591 B）
- `evidence/logs/sup15-build-2-node-no.log`（3144 B）
- `evidence/logs/sup15-build-3-no-dist.log`（858 B）
- `evidence/logs/sup15-host-restore.log`（425 B）
- `evidence/logs/sup15-run-case1.log`（992 B）
- `evidence/logs/sup15-run-case2.log`（992 B）

## 截图

- `evidence/shots/probe-drag.png`
- `evidence/shots/probe-lock-after-close.png`
- `evidence/shots/probe-lock.png`
- `evidence/shots/sup07-page-state.png`
- `evidence/shots/sup07-probe-final.png`
