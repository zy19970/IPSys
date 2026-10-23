# 第三批实机验收报告（ST3-01～ST3-04）

- 被测提交：`a18b47b02dc86260fc328a3ac7ed33f7d017c4bc`（分支 `work/onedrive-file-manager`，未合并 `main`）
- 被测 EXE：`publish/IPSys.Web.exe`，5,269,734 字节，
  SHA256 `DC8BED6C84525D6A156A57E81E84D5C2A3153AFCB962DAFE31E6D4E199A53043`
- 执行时刻：2026-10-23 18:09–18:47（GMT+8）
- 环境：Windows 11 企业版 LTSC 10.0.26100，会话 8、`UserInteractive=True`；Edge 155.0.4283.60；
  Node v22.22.2；.NET 10.0.401；屏幕 3840×2160（200% 缩放）
- 隔离：本批新建独立 SQLCipher QA 库 `qa/vault-p3.db`（159,744 字节）、专用 Edge profile、
  `E:\IPSys-QA\inputs` 与 `D:\IPSys-QA\exports`；**未打开、未读取、未写入正式资料库**
- 结论：**第三批未闭环**。物理隔离已获本地实证；原生保存拿到首个真实落盘的 ZIP 与逐条 SHA，
  但"保存到指定路径""导出中切换工作区"以及 2 GiB / 4 GiB 两个大文件项未完成。
  另发现一处**新的 CI 红灯**（C-01），需修复后再判断是否属产品缺陷。

## 结果总览

| 用例 | 状态 | 一句话 |
|---|---|---|
| ST3-01（SUP-04）>2 GiB 原生保存 | `NOT_RUN` | 按用户指示中止原生保存链路；本批禁止以 API 下载替代 UI 保存 |
| ST3-02（SUP-05）>4 GiB ZIP64 | `NOT_RUN` | 同上；另本机无 7-Zip，`-RequireIndependentExtractor` 必判 BLOCKED |
| ST3-03（SUP-07）保存/取消/层级 | `BLOCKED` | **真实 ZIP 已落盘、层级与逐条 SHA 全对**；差"指定路径"与"导出中切工作区" |
| ST3-04 物理隔离与版本链 | `BLOCKED` | 本地只读 SQL 全通过（0 违规）；CI 门槛未达成（C-01） |

## ST3-03：原生保存第一次真正落地

上一轮 SUP-07 的结论是 BLOCKED（只有 shim ZIP，没有真实落盘）。本轮的实质变化：

1. **取消一次不产生伪成功文件**。真实右键「打包下载」→ 系统级保存对话框 → 真实 Esc：
   对话框关闭，目标路径无文件，页面导出条保持隐藏、`IPSysExport.isActive()===false`、无 toast 宣称成功。
2. **真实保存落盘成功**。同一条 UI 路径再次触发，保存后页面报"导出完成。成功 3，失败 0，取消/未完成 0"，
   磁盘上得到 `IPSys-原件导出.zip`（12,908 字节，
   SHA256 `5D16C579D8CC429D57A24FAF467891A95CC22233B9B2FD2BE9BC528E9AEDC8D8`）。
3. **业务层级与字节完全对上**。用任务书指定的 `tools/qa/Verify-ExplorerExports.ps1` 审计得
   `result: PASS`（见 `explorer-export-audit.json`）：

| ZIP 条目 | 源文件 | 字节 | 条目 SHA256 与源 |
|---|---|---|---|
| `P3项目甲/p3-project-attach.txt` | p3-project-attach.txt | 4,132 | 一致（`A5F0FC8B…`） |
| `P3项目甲/P3合同一/p3-contract-a.txt` | p3-contract-a.txt | 4,124 | 一致（`1C181E44…`） |
| `P3项目甲/P3合同二/p3-contract-b.txt` | p3-contract-b.txt | 4,124 | 一致（`AB9620FA…`） |

   即"项目/合同/附件"三级层级由真实导出代码生成，逐条目字节可信，不是 shim、不是内存虚拟文件。

**未达成的两点（因此不记 PASS）**：

- **保存到指定路径**。三次尝试中只有一次成功提交（且落在对话框默认目录"文档"）；
  另两次系统对话框虽然出现，但其子控件（`ComboBox+Edit`）在枚举时未暴露，
  无法定位文件名输入框，Esc/回车均无效 —— 属无人值守会话下的 OS 级交互限制，不是产品行为异常。
  人工操作时该对话框可正常选择任意路径（截图 `probe-commit.png` 显示路径已成功填入
  `D:\IPSys-QA\exports\st303-project.zip` 且目录已跳转到 `exports`）。
- **导出中切换工作区**。本用例附件总量仅 12 KB，导出耗时 <1 秒，不存在可插入切换的时间窗；
  该子项未执行，不能按"已通过"计。

> 证据口径说明：本轮成功那一次的控制台明细 JSON 被后续失败重试覆盖，
> 保留的硬证据是 **ZIP 本体 + `explorer-export-audit.json` + 原生窗口截图**。
> 报告不对丢失的字段做补写。

## ST3-04：本地物理隔离通过，CI 门槛未达成

### 本地实测（这是本批最硬的一块）

真实 UI 完成：公司工作区建项目"P3隔离项目甲"（含合同"P3隔离合同甲"）与知识产权"P3隔离专利"；
项目附件上传 v1 后再"上传新版本"得到 v2；随后用右键「复制整条记录」把项目（含合同与两个版本）
与知识产权**跨工作区复制到个人工作区**（`move=false`，即复制语义）。

以只读模式打开同一 QA 库，`file_versions → file_objects → file_chunks` 三表 JOIN 后逐版本比对：

| 附件 | 公司工作区 | 个人工作区 | 判定 |
|---|---|---|---|
| p3-iso-v1.txt | v1 object#4 `66F25004…` / v2 object#5 `7A20FD95…` | v1 object#8 `66F25004…` / v2 object#9 `7A20FD95…` | 对象 id 全不同、内容与版本对齐 |
| p3-iso-contract.txt | v1 object#6 `CD7D64D4…` | v1 object#10 `CD7D64D4…` | 同上 |
| p3-iso-ip.txt | v1 object#7 `5056ED6B…` | v1 object#11 `5056ED6B…` | 同上 |

- 两个工作区的同一内容 **FileObjectId 全部不相等**；`object.workspace` 与记录工作区一致；
  `state` 均为 `ready`；`size` 与 `SUM(length(file_chunks.bytes))` 完全相等（每个文件 1 个分块）；
  版本序列 v1/v2 在复制后保持一一对应。
- 违规项：**0**。原始查询结果见 `evidence/json/st304-objects.json`，SQL 见 `evidence/json/st304.sql`。

### CI 门槛（未达成）

最新一次 Windows CI（run `39923781118`，head `a18b47b`）**失败**：

```
WEB SMOKE FAIL
System.IO.IOException: VAULT COMPACT HTTP: SQLCipher VACUUM must finish or report an explicit failure
   at VaultCompactHttpSmoke.Check(...) line 10
   at VaultCompactHttpSmoke.VerifyAsync(...) line 59
   at WebSmoke.Run(...) line 89
```

关键点是**位置**：`WebSmoke.Run` 里 `VaultCompactHttpSmoke.VerifyAsync` 在第 89 行，
而调用 `NativeTransferIsolationProof.Verify` 的 `NativeIpTransferHttpSmoke`/`NativeContractTransferHttpSmoke`
排在其后。所以这一轮 CI **根本没跑到物理隔离证明**，不能用它证明或证伪隔离。

同一分支上的前一次运行（run `39923548693`，head `14fd8a8`，即引入隔离证明的提交）是**通过**的，
说明这条 smoke 链路在常规数据量下可完成；本轮差异是 `IPSYS_LARGE_FILE_SMOKE=1`
（先灌入 2 GiB 内容再做压缩）。因此 C-01 要么是轮询预算不足（该断言最多轮询 360×100 ms ≈ 36 秒），
要么是 2 GiB 库的 VACUUM 真卡住 —— 需要在该数据量下复测，不能据此直接判产品缺陷。

## 新发现与阻塞

| 编号 | 类型 | 内容 |
|---|---|---|
| C-01 | CI 红灯（待定性） | HEAD `a18b47b` 的 `--smoke` 在 `VaultCompactHttpSmoke` 失败，未执行到隔离证明；同链路在 `14fd8a8` 通过。需在 2 GiB 数据量下复测以区分"断言预算不足"与"VACUUM 真卡住" |
| C-02 | 环境阻塞 | 无人值守会话下，Chromium 的 `showSaveFilePicker` 对话框在部分实例中子控件不可枚举（无 `Edit`），导致路径输入与提交不稳定；三次尝试仅一次成功 |
| C-03 | 环境缺口 | 本机未安装 7-Zip，`Verify-ExplorerExports.ps1 -RequireIndependentExtractor` 按设计返回 `NOT_RUN:7z missing`，独立解包器互操作未验 |

## 与上一批的口径差异（不要混算）

- 上批 SUP-07 记 BLOCKED 的原因是"导出根本没启动（点击被密码气泡吞掉）"；
  本轮该阻塞已消除（解锁后不再出现保存密码气泡），导出真实启动并落盘。
- 本轮仍记 BLOCKED，但原因不同：只剩"指定路径"与"导出中切换工作区"两个子项，
  且卡点是 OS 对话框的自动化提交，不是产品逻辑。
- **SUP-04/SUP-05 在本批不计 PASS**：任务书明确禁止用 Windows CI 接口测试、虚拟文件、
  ZIP64 头部单元测试替真实保存；本轮未做 2 GiB 上传+原生保存与 4 GiB 真实 ZIP。

## 复验建议（按优先级）

1. **先修 C-01**：把 `VaultCompactHttpSmoke` 的轮询预算与"明确失败"语义分开，
   或让大文件 smoke 与 compact smoke 不在同一轮数据库上叠加；这条红着，第三批无法闭环。
2. **在有真人的桌面会话里跑 ST3-01/02**：2.2 GiB 上传 → 下载按钮 → 原生保存到另一块盘 →
   算 SHA；两个 >2 GiB 原件复选导出 → 真实 ZIP64 落盘 → 装 7-Zip 后用
   `-RequireIndependentExtractor` 复跑审计。
3. ST3-03 补两项：保存到指定路径（人工或补 UI 自动化）、导出过程中切换工作区并截屏记录提示。

## 可复现步骤

```text
1) dotnet publish src/IPSys.Web/IPSys.Web.csproj -c Release -r win-x64 --self-contained false \
     -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o <run>/publish
2) <run>/publish/IPSys.Web.exe                       # 记录监听端口，POST /api/open 建独立 QA 库
3) Edge 非 headless + CDP：解锁 → 建项目/合同/知识产权 → 上传附件 → 右键「打包下载」
4) OS 级保存对话框用 Win32 真实输入（见 scripts/osui.py、native.cjs）
5) pwsh -NoProfile -File tools/qa/Verify-ExplorerExports.ps1 -Manifest <manifest> -EvidenceDirectory <dir>
6) 只读 SQL：tools/qsql（Microsoft.Data.Sqlite + SQLCipher，Mode=ReadOnly）执行 evidence/json/st304.sql
```
