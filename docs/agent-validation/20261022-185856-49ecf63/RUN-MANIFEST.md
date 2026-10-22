# RUN-MANIFEST — 运行清单

## 运行标识

| 项 | 值 |
|---|---|
| RUN_ID | `20261022-185856-49ecf63` |
| 开始时间 | 2026-10-22 18:58:56 +08:00 |
| 结束时间 | 2026-10-22 19:30 左右 |
| 被测分支 | `work/onedrive-file-manager` |
| 开工时 `git rev-parse HEAD` | `49ecf63e78691ba72ed4a27badbb4224e6a435c1` |
| 远程真实 tip | `446f9a67c8e6f0fef04b15b48d96e11079ea8812`（**开工时本地落后 9 个提交，未 fetch**） |
| 动态证据采集点 | `49ecf63`（全部 38 项） |
| 真 HEAD 复验点 | `446f9a6`（13 项复跑 + 全量重建，逐项一致，见 §基线与复验） |
| 上轮基线 | `02289ea7020861360baa0a4c49ca045f3c783aea` |
| 相对 main | `main...work/onedrive-file-manager` = 21 commits，94 files，+11658 / −6982 |

## 环境

| 项 | 值 |
|---|---|
| 操作系统 | Microsoft Windows 11 企业版 LTSC，Build 26100，AMD64 |
| 浏览器 | Microsoft Edge `155.0.4283.60`（headless=new，独立 `--user-data-dir`） |
| .NET SDK | 10.0.401（默认）/ 8.0.426（可用） |
| .NET Runtime | Microsoft.AspNetCore.App 8.0.32、Microsoft.NETCore.App 8.0.32 |
| 目标框架 | `net8.0-windows` |
| Node | v22.22.2 |
| 监听地址 | `http://127.0.0.1:<动态端口>`（调试宿主 17213；发布版 59392） |

## 构建与门禁

| 步骤 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 构建 | `dotnet build src/IPSys.Web/IPSys.Web.csproj -c Debug` | 0 | 0 错误 6 警告，13.51 s |
| 打包 | `node frontend/explorer/tools/bundle.cjs` | 0 | `dist/app.js` 195284 B |
| 冒烟 ×8 | `ui-assets / ui-tree / explorer-capabilities / upload-progress / upload-unique-autosave / export / zip64 / pdf-canvas` | 全 0 | 全绿（**但不代表界面可用**，见 REPORT §6） |
| 发布 | `dotnet publish -c Release -r win-x64 --self-contained false` | 0 | publish 目录仅 `IPSys.Web.exe` 5183718 B |

日志：`evidence/build.log`、`evidence/build-and-smoke.log`、`evidence/publish.log`

## 基线与复验（补上"确认最新 HEAD"这一步）

开工时只执行了 `git rev-parse HEAD` → `49ecf63`，**没有 `git fetch`**，于是把它当成了最新。实际 `origin/work/onedrive-file-manager`
已在 `446f9a6`，本地落后 9 个提交（`5c10ce9`…`446f9a6`，V2 轮自己推送的 CI 接入与裁决更正）。

两个端点之间：

- **产品源码零差异**：`git diff --stat 49ecf63 446f9a6 -- src frontend tools dist` 输出为空（含 `IPSys.Web.csproj`，含 `dist/` 产物）。
  该判断同时说明"构建产物会不会变"——不会。
- 差异只在 `.github/workflows/web-windows.yml`（+92）与 `docs/retest-v2-2026-10-22/`（证据、脚本、CSV）。

所以 38 项结论不需要重采，但**必须在真 HEAD 上把这一点证明出来**。已在 `446f9a6` 复跑：

| 复验项 | 方式 | 结果 |
|---|---|---|
| 全量重建 | `dotnet build src/IPSys.Web/IPSys.Web.csproj -c Debug -t:Rebuild` | **0 错误 6 警告**，23.77 s |
| 新隔离库 | `fixture.cjs v3b` → `vault-v3b.db` | 12 组数据重建成功；S10 purge 仍 `failed`（同 BUG-020） |
| HTTP 10 项 | `t-http.cjs v3b` | 与 49ecf63 **逐项 10/10 一致**（PASS 9 / CONFIRMED_BUG 1，唯一缺陷仍是 T-P0-02） |
| 树 2 项 | `t-tree.cjs v3b` | BUG-001 与 X-02 均复现：`af:8/af:9` 不在树内，`档案-01` 路径仍跳过两级 |
| PDF 1 项 | 单点复跑（`t-pdf-recheck.cjs`） | canvas 仍 300×150、状态「正在解析 PDF…」、`rendered1=false`、像素样本与首轮一致 |

差异只有自增 id（v3b 的 linkId 比 v3a 后移 1），不影响任何判定。

复跑脚本放在 `build-retest/recheck/scripts/`（临时副本，加 `IPSYS_EVID`/`IPSYS_TMP`/`IPSYS_SHELL` 环境变量覆盖输出路径，
**仓库内 `scripts/` 一字未改**）；复跑产出已收入 `evidence/recheck-446f9a6/`。


## 隔离资料库

| 用途 | 文件 | 说明 |
|---|---|---|
| 主 fixture | `build-retest/agent-validation-v3/vault-v3a.db` | 路径被 `.gitignore` 的 `build-retest/` 覆盖，不入库 |
| 空库 | `build-retest/agent-validation-v3/vault-v3a-empty.db` | T-P2-15 专用 |
| 建库探针 | `build-retest/agent-validation-v3/vault-v3a-createprobe.db` | T-P1-01 后端能力对照 |
| 口令 | `vault-v3a.cred.json` / `-empty.cred.json` | 随机 12 字节 hex，**不入库、不入日志** |

**未触碰任何正式资料库。** 所有写操作只落在 `build-retest/` 下的三个测试库。

## 启动方式（可复现）

```bash
# 1. 调试宿主（动态端口）
cd src/IPSys.Web/bin/Debug/net8.0-windows && ./IPSys.Web.exe
# 端口：netstat -ano | grep LISTENING | grep " <PID>$"
# 注意：单实例守卫，同一 Windows 会话只能起一个宿主

# 2. 建 fixture
IPSYS_BASE=http://127.0.0.1:<port> node docs/agent-validation/20261022-185856-49ecf63/scripts/fixture.cjs v3a

# 3. 各层用例
IPSYS_BASE=... node scripts/t-http.cjs v3a
IPSYS_BASE=... node scripts/t-tree.cjs v3a
IPSYS_BASE=... node scripts/t-browser.cjs v3a
IPSYS_BASE=... node scripts/t-http2b.cjs v3a
IPSYS_BASE=... node scripts/t-http3.cjs v3a
IPSYS_BASE=... node scripts/t-http4.cjs v3a
IPSYS_BASE=... node scripts/t-browser2.cjs v3a
IPSYS_BASE=... node scripts/t-http5.cjs v3a

# 4. 发布版验证（先停调试宿主，避免单实例守卫）
cd src/IPSys.Web/bin/Release/net8.0-windows/win-x64/publish && ./IPSys.Web.exe
IPSYS_BASE=http://127.0.0.1:<port> node scripts/t-release.cjs
```

## 脚本清单

| 脚本 | 覆盖 | 说明 |
|---|---|---|
| `lib.cjs` | — | 最小 HTTP 客户端；强制 `127.0.0.1`；`connect()` 兼容 409→resume；本轮补 `put` |
| `fixture.cjs` | S01..S12 | 建库 + 12 组数据；动态记录真实 ID |
| `fixture-fix.cjs` | S10 | 修正 purge 的 kind 并回读 compact/info |
| `t-http.cjs` | 10 例 | P0 全线 + 目录 CRUD + 排序 + 版本 + Host |
| `t-tree.cjs` | 2 例 | **纯函数**驱动真实 payload，确定性判 BUG-001 / X-02 |
| `t-browser.cjs` | 10 例 | 三级目录 UI、多版本行数、PDF 两页、重命名、键鼠、搜索、分辨率、快捷访问、首页导入、X-01 注入 |
| `t-http2.cjs` / `t-http2b.cjs` | 4 例 | 一键清空、200 条上限、压缩互斥、空库 |
| `t-http3.cjs` / `t-http4.cjs` | 5 例 | 导出范围、四种口径、文档缺口、批量删除、下载边界 |
| `t-browser2.cjs` | 4 例 | 同 linkId 批量删除、拖放、复制/移动入口、导出期切工作区 |
| `t-http5.cjs` | 2 例 | 登录建库入口、跨工作区隔离 |
| `t-release.cjs` | 1 例 | 单文件发布离线资源 + Host 钉死 |

## 产物

- `CASES.csv` —— 38 项主用例（按 ID 去重后合计 38）+ 子场景行
- `DEFECTS.md` / `BLOCKED.md` / `TEST-DEFECTS.md` / `ADJUDICATION.md` / `TASKBOOK-ERRATA.md`
- `evidence/` —— 原始 JSON、逐例 txt、截图 `shots/`、`cases/`、导出样本 xlsx、两页 PDF、构建日志
