# IPSys Explorer 合并主分支前验收与准备结论（2026-10-23）

> **历史合并前审查快照（2026-10-25 补充定位）**：正文“尚未执行合并”、旧 `main`/开发分支 SHA 及当时的文件差异均只在 2026-10-23 有效。合并已完成，当前仅 `main`，最新产品代码 `8c1ca9a` 的 [Windows CI #40162144248](https://github.com/zy19970/IPSys/actions/runs/40162144248) 已通过；现行进度请查 [DEVELOPMENT_PLAN](../DEVELOPMENT_PLAN.md)。不得修改正文原始测试结论。

> **状态：已完成 C-01 / ZIP64 生成限定范围的收敛；可以准备合并评审，但尚未执行合并。**
> 对比范围：`main` @ `c22ea1f836b5e3763780a674f1cbb1f56fb68d05` → `work/onedrive-file-manager` @ `d457a8077fd05923e9cbb30af73d545691cdc70f`。当目标分支产生新提交，必须重新核对 HEAD 和 CI 结果。

## 1. 仍待收敛两项及最终证据

| 项目 | 最终范围与判定 | 原始证据 |
|---|---|---|
| C-01：带 >2 GiB 原件的加密库 VACUUM | **PASS**。原测试 360 × 100ms 的固定约 36 秒预算对于大库不足，`VaultCompactHttpSmoke.cs` 现采用 Stopwatch 记录实际阶段和终态，按库规模选择 55 秒 / 12 分钟预算，仍必须成功、释放文件任务锁并通过 SQLCipher integrity_check。没有跳过 VACUUM 或降低完整性判据。 | [Actions 39943364663](https://github.com/zy19970/IPSys/actions/runs/39943364663)：`e18ad605`、`IPSYS_LARGE_FILE_SMOKE=1`、22/22 步骤通过 |
| ST3-02：生成真实 >4 GiB ZIP64 | **PASS_GENERATION_ONLY**。调用产品 `wwwroot/export.js` 的 `IPSysExport.start("zip")` 和真实流式文件写入，两个不同来源各 2 GiB+80 MiB，总归档文件长度 **4,462,739,982 字节**，ZIP64 EOCD/locator、中央目录和条目实际文件起始字节均核验，物理 ZIP 完整 SHA-256：`8DED57C97E10F169CDA7E459A3648422B15337EDA9B5C7F61BF263C747E3AB32`。 | [Actions 39944440866](https://github.com/zy19970/IPSys/actions/runs/39944440866)：`d457a807`、24/24 步骤通过，artifact `IPSys-ZIP64-generation-39944440866` |

**验收边界：** ZIP64 的 4 GiB 文件使用**模拟的可重复流式 HTTP 来源**以及适配 `showSaveFilePicker` 的磁盘写入层，但调用了生产 ZIP 生成器并实际把全部数据写入磁盘；并未执行 Explorer UI、Windows 原生文件保存选择器、真实 SQLCipher 原件链路或第三方解压验证。用户明确将本轮要求调整为“实际生成压缩文件即可，解包由用户自己手动验证”。因此**不能**把 `PASS_GENERATION_ONLY` 写成完整 ZIP64 端到端/互操作 PASS。

CI 运行器生成后已删除其临时多 GiB ZIP，仅上传轻量 JSON 证据；如果需要在本机手动解包，请按 [ZIP64 本机生成说明](./IPSys_Explorer_ZIP64_Generation_Only_2026-10-23.md) 在拥有不少于约 5 GiB 剩余空间的目录运行生成器，保留 ZIP 文件进行人工解压。

## 2. 与之前第三批报告的衔接

本地 Agent 的 [第三批原始报告](./agent-validation/phase3-real-save-20261023-a18b47b/PHASE3_REPORT.md) 是历史快照；其中 ST3-01 `NOT_RUN` 指 Agent 自动化无法操作 Windows 保存窗口。用户随后明确表示**已人工通过 >2 GiB 文件界面测试**，应作为“用户人工反馈已通过”单列，不改写旧 Agent 记录，不虚构缺失的截图/SHA 明细。

ST3-03 的真实小 ZIP 已落盘且三个条目 SHA 相符、取消不产生伪成功；ST3-04 跨工作区复制项目/合同/知识产权的 FileObject、Version、Chunk 本地 SQL 核查 0 违规。两项既有结论延用原报告的证据边界。

## 3. 分支合并前技术审查

审查时 GitHub Compare `main...work/onedrive-file-manager`：工作分支领先 **72** 个提交、落后 **0** 个提交，当前可按提交关系执行 fast-forward，不需要覆盖主分支历史。仓库完整 Git tree 比较（避免 Compare API 只展示前 300 个文件的限制）：新增 515 个文件、修改 25 个、删除 11 个文件。新增项目以 Explorer 前端及原生测试、历史 Agent QA 截图和文本证据为主，没有把 2 GiB/4 GiB 物理文件、QA 数据库、密码上传仓库；最大新增文件为约 257 KiB 的测试截图。

已核对 main 历史与 Explorer 迭代方向，旧 `wwwroot/index.html/app.js/style.css` 及部分旧 smoke 文件被新 `frontend/explorer` 的内嵌打包链路和新版回归替代，属于架构迁移，不建议恢复过时的静态壳。

**已知测试解释风险：** `docs/retest-v2-2026-10-22/scripts/t-browser.cjs` 中旧 `T-P2-02` 直接对目标派发程序化 `drop`，没有执行真正的 `dragstart`，与产品内部拖放协议不一致，却按 `CONFIRMED_BUG` 汇总。因此其单独结果不应被误作真实 OS 内部附件移动失败的证据。专门的前端事件回归已经通过；若后续真实 UI 复现失败，应单独立项修复。此项不在本轮两个问题的修复范围内。

## 4. 合并决策

技术门禁 C-01 与限定 ZIP64 生成均已通过，可以进入第四阶段的发布前差异/稳定性复核，以及用户确认后的合并准备。**本文件不授权自动合并，也不代表已经合并 `main`。** 合并前再次核对分支头、Windows CI 对应精确 SHA、是否有其他人追加改动；不得 force push 或改写 main。若用户决定在人工解压完成前合并，应在版本验收备注里保留 ZIP64 第三方解压互操作“人工待确认”。
