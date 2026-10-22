# IPSys Explorer Phase 2 — Agent 本地实测报告

- **RUN_ID**：`20261023-0112`
- **被测代码**：分支 `work/onedrive-file-manager`，HEAD `f5d206aec329340ad9d5f6e80fe3451b75d9bd93`（SHA8 `f5d206a`）
- **执行窗口**：2026-10-23 01:25 → 03:27（本地，UTC+8）；用例时间戳取自 `TEST_CASE_RESULTS.csv`
- **执行方式**：Agent 在本机 `build-retest/IPSys.Web.exe` 上真跑，配 **独立 `--user-data-dir` 的 Edge 实例**（CDP 驱动）与 **隔离 SQLCipher 库** `build-retest/phase2/vault-p2-p2b.db`
- **任务书**：`docs/IPSys_Explorer_Phase2_Agent_Complete_Retest.md` + `docs/IPSys_Explorer_Phase2_Agent_Test_Cases.csv`（132 条）

---

## 一、结论

**门禁判定：不通过（P0 门禁未满足）。**

- 132 条用例全部有落盘证据，**PASS 126 / CONFIRMED_BUG 1 / BLOCKED 3 / GAP 2**，没有一条未执行项被记成 PASS。
- 唯一的 CONFIRMED_BUG 是 **I-08（P0）**：服务端返回 401 后前端清空 token 并置 `locked=true`，但**既不弹锁屏也不提示重新登录**，界面呈现为「检索失败 / 本地已加载的内容里也没有匹配项」，此后所有请求持续 401 —— 会话静默失效。
- 其余 P0 场景（B/C/D/E/F/G/H/I/J/K/L 组的 P0 项）证据可核验、结论成立。
- 另有 4 条**不改变用例判定但必须记录**的独立问题（含 1 条纯前端静默丢弃），见 `DEFECTS.md`。

按任务书 §六「验收关闭条件」第一条「全部 P0 场景有可核验证据且**无未解决 CONFIRMED_BUG**」，本报告**不能**宣布通过；修复 I-08 后即可满足该条（其余门禁条款当前均成立）。

---

## 二、环境与基线

| 项 | 值 |
|---|---|
| 操作系统 | Windows 10.0.26100（win32 x64） |
| 浏览器 | Edge `155.0.4283.60`，headless=new，每次独立 `--user-data-dir` |
| .NET / Node | `dotnet 10.0.401` / `node v22.22.2` |
| 加密库 | SQLCipher `4.5.2 community`（`PRAGMA cipher_version`） |
| 被测构建 | `build-retest/IPSys.Web.dll`，`IPSys.Web.exe` 直启，无 WinForms 启动器（见 A-05） |
| 隔离开关 | 库、原件、导出、日志全部在 `build-retest/phase2/`；**真实库 `C:\Users\Joey\Documents\IPSys-web-test.db` 大小与 mtime 全程逐字节不变**（A-03） |
| 磁盘 | E: 剩余约 65 GB（A-08 实测），隔离库收尾 283 MB |
| 端口 | 宿主每次随机（本轮 `127.0.0.1:35890`），脚本一律从 `/api/status` 与 `netstat` 现取，不写死 |

**收尾时库状态**（`evidence/dbcheck-final.json`，只读打开）：

```
cipherVersion=4.5.2 community   integrity=ok   foreign_key_violations=0
folders 471 / files 215 / objects 231 / versions 237 / chunks 509 / links 228(已删 5)
writingObjects=0  readyObjectsUnreferenced=0  orphanChunks=0
versionsMissingFile=0  versionsMissingObject=0  linksMissingFolder=0  linksMissingFile=0
```

---

## 三、用例统计

### 3.1 总表

| 状态 | 数量 | 说明 |
|---|---|---|
| PASS | **126** | 有可核验证据且行为符合期望 |
| CONFIRMED_BUG | **1** | I-08，已独立复现 |
| BLOCKED | **3** | A-05、K-09、K-11，环境/资源不可达，原因见 §六 |
| GAP | **2** | A-02（无 CI 凭据）、I-06（任务书前提在现有壳里不成立） |
| 合计 | **132** | 与任务书 CSV 一一对应，缺 0 / 多 0 |

### 3.2 分组

| 组 | 主题 | 用例 | PASS | BUG | BLOCKED | GAP |
|---|---|---|---|---|---|---|
| A | 环境与基线 | 8 | 6 | 0 | 1 | 1 |
| B | 建库与会话 | 10 | 10 | 0 | 0 | 0 |
| C | 首次打开与目录骨架 | 12 | 12 | 0 | 0 | 0 |
| D | 业务记录 CRUD | 10 | 10 | 0 | 0 | 0 |
| E | 附件与版本 | 12 | 12 | 0 | 0 | 0 |
| F | 台账字段与校验 | 12 | 12 | 0 | 0 | 0 |
| G | 上传/拖放/查重 | 12 | 12 | 0 | 0 | 0 |
| H | 导出与预览 | 12 | 12 | 0 | 0 | 0 |
| I | 检索/预览/导出细节 | 12 | 10 | 1 | 0 | 1 |
| J | 回收站与批量删除 | 12 | 12 | 0 | 0 | 0 |
| K | 大文件、并发与故障恢复 | 12 | 10 | 0 | 2 | 0 |
| L | 安全、视觉与收口 | 8 | 8 | 0 | 0 | 0 |

### 3.3 证据强度分层（任务书 §六.1 要求区分）

| 类别 | 数量 | 说明 |
|---|---|---|
| **真实 Edge 交互 PASS** | **71** | CDP 驱动 headless Edge，实际点击/双击/拖放/框选/上传/预览/切区：B-01～B-06、B-08～B-10、C-01～C-12、G-01～G-12、H-01～H-12、I-01～I-12、J-07～J-12、K-01/02/04/06/07、L-04/05/06 |
| **接口级 PASS（HTTP + 只读 SQLCipher 核验）** | **47** | 无界面动作，断言全在返回体与库内行：D、E、F、J-01～J-06、K-03/05/08/10/12 |
| **混合** | **14** | 同一条用例既有界面动作又有接口/DB 断言：A-01～A-08、B-07、L-01/02/03/07/08 |

> 需要特别说明：**A-01/A-02/A-06/A-08 的证据是 git 输出、构建日志、系统信息，不含 Edge 交互**；脚本标签写作 `DYNAMIC-MIXED`，但实际证据来源是命令行。A-03/A-04/A-07 含 HTTP 写入与回读。

---

## 四、分组要点与关键证据

### A 环境与基线
- **A-01 PASS**：分支 `work/onedrive-file-manager`，HEAD `f5d206ae`；工作树 6 项改动**全部**在 `docs/agent-validation/` 的本轮报告与证据目录，`src/`、`frontend/` 零改动 —— 未覆盖产品代码，未触碰 main。
- **A-03 PASS**：真实库动笔前后指纹一致（`352256` 字节、mtime `2026-10-20T05:00:39.044Z`）；`fixtures/` 为 A-07 按需创建。
- **A-04 PASS**：企业 项目 147 / 知产 10 / 档案 19，个人 17 / 8 / 13；每类都取到带附件记录，按名称片段检索能命中同一条记录，下载字节数与 link 声明一致。
- **A-06 PASS**：Debug、Release 各自独立输出目录构建，均 **0 错误**（各 6 条既有 CS0168/CS8602 警告）；仓库声明的 **17 个 Node 自动回归全部 exit=0**，末行均为各自 PASS 断言，无静默跳过。
- **A-07 PASS**：2 页 PDF / 1 KB TXT / JPEG / 33 MiB 随机二进制 + 同一文件 v1·v2 两版，索引见 `evidence/a07-fixture-index.json`；五个对象上传后按版本号下载回算 SHA-256，与索引逐条一致。
- **A-08 PASS**：环境表见 §二。

### B 建库与会话
- **B-07 PASS**（关键）：宿主仍解锁时，新开浏览器的页面**不进库**，而是停在「重新连接资料库」，路径框只读且预填，须输密码；连接成功才拿到 token 渲染工作台。**用同一 profile 关掉再开，第二程同样回到锁屏**。全程 folders/files/objects/chunks/links 计数零变化、`writing=0` —— 没有未授权自动写入。

### C/D/E/F 基础业务
- 全 46 条 PASS。C 组用手工点击走完建库→目录骨架→分类页；D/E/F 以 HTTP 建改删 + 只读库核验为主，覆盖字段校验、版本、台账列与空值处理。

### G 上传/拖放/查重
- 12 条 PASS。G-07「不得悄悄写入任意业务记录」成立：分类页与首页拖入外部文件，全工作区 link 总数不变。
- **但同一现象背后有一个独立前端缺陷**（记录于 DEFECTS D-02）：两次拖放**完全静默**，用户得不到任何提示。

### H 导出与预览
- 12 条 PASS。**H-04 本轮由 BLOCKED 转 PASS**：用 `showSaveFilePicker` shim 真正拿到 ZIP（553 字节），两个来自不同合同的附件分别落在「项目/合同甲」「项目/合同乙」两条路径下，条目数 2、字节数与 SHA-256 与原件一致。

### I 检索 / 预览 / 导出细节
- **I-08 CONFIRMED_BUG**（唯一 BUG，P0）：注入 401 后 `tokenEmpty=true, locked=true`，但 `toasts=[]`、`lockShown=false`，界面文本为「检索失败…本地已加载的内容里也没有匹配项」；随后 `reload` 得到「请求失败：401」。对照的 500 分支表现正常（明确显示「检索失败」）。
- **I-06 GAP**：导出请求体恒为 `{mode:"all", ids:null}`（`js/excel.js:51`），UI 没有「选中/筛选/全部」三种范围；任务书 I-06 的前提在现有壳里不成立（PLAN_REVIEW E-01 已列）。
- I-03 真实 ZIP：3132 字节 / 7 条目 / `method=0`，层级含「项目/合同」，两版文件只留最新版且 SHA 与 v2 一致。

### J 回收站与批量删除
- 12 条 PASS。分批彻底删除实测批次：`[200,1]`、`[200,200,3]`、`[200,200]`（第 3 批未发，被 409 拒），第 3 条伴随 toast「已确认删除 200 / 403 条」—— 未确认的批次没有被说成成功。
- J-11：删除任务进行中切工作区**被明确拒绝**并提示「文件任务进行中,完成后再切换工作区」。

### K 大文件、并发与故障恢复
- **K-01 PASS**：33 MiB 拖放上传，进度面板依次「正在发送原件…」→「已发送 100%，正在等待服务器完成 SHA-256 校验和加密入库…」，采样到 `14.4/18.4/25.4/28.4/33.0 MiB / 33.0 MiB · 31.3 MiB/s`，服务端 SHA 与浏览器一致。
- **K-03 PASS**：12 MiB 慢速上传占住任务时，`/api/lock`、`/api/vault/compact`、`purge-task`、`purge` 四路全 409 且文案明确，库仍保持解锁。
- **K-06 PASS**（本轮由 BLOCKED 转 PASS）：33 MiB 导出进行中切到个人工作区，切换成功、导出未中断，ZIP 内只有公司侧 1 个条目、大小与 SHA 一致，个人区同名文件 0 个混入。
- **K-07 PASS**：彻底删除 33 MiB 原件，进度「准备中 → 0% → 3% → 54% → 100% → 完成」，字节 `0 B → 1.3 → 18.0 → 33.0 MB / 33.0 MB`，回收站清空。
- K-05/K-08/K-10/K-12 PASS：上传后立即删除无竞态；压缩任务 succeeded 且前后六项计数一致、`integrity=ok`、外键 0 违规；强制中断上传后 `writing=0`（服务端完整回滚），随后正常上传并下载 SHA 一致。

### L 安全、视觉与收口
- **L-01 PASS**：空 token 与 64 个 A 的伪造 token，对「读记录 / 建项目 / 删链接 / 下载原件 / 跨区转移 / 彻底删除」六类操作**全部 401**；恢复合法 token 立即 200。
- **L-02 PASS**：同一批 FolderId/FileId/LinkId 换工作区访问一律 404，反向亦然；合法跨区转移返回全新 ID。
- **L-04 PASS**：记录名写入 `<img onerror>` 与 `<script>` 后，列表以纯文本原样显示，DOM 中 0 个注入节点、`__xssHit` 未触发。
- **L-05 PASS**：1366×768 与 1920×1080 两档，分类卡 3 / 5 列，表头随视口自适应，无横向溢出，详情面板 320px 不越界（截图 `evidence/shots/l05-*.png`）。
- **L-06 PASS**：项目台账列表抽查 6 个主入口全部有可观测反应；`#btnEmptyTrash` 在非回收站视图按设计隐藏。
- **L-07 PASS**：六步三方对照全部对齐 —— 建项目 folders+1 且读回同名；上传 files/objects/versions/chunks/links 各 +1；重命名 folders 零变化但名字真变；**空名称被 400 拒绝且库内零行变化（无假成功）**；个人区建项目只让个人区 +1、用公司参数读该 ID 404；软删附件 `linksDeleted+1` 而 objects 不变（仍被版本引用）。
- **L-08 PASS**：132 条全部有落盘记录，1 条 BUG 有非空实际值与登记过的复现脚本，BLOCKED/GAP 无一被算作 PASS。

---

## 五、缺陷清单（摘要，详见 DEFECTS.md）

| 编号 | 关联用例 | 级别 | 一句话 |
|---|---|---|---|
| **D-01** | I-08（CONFIRMED_BUG） | **P0** | 401 后清 token 却不弹锁屏、不提示，界面呈现为空结果，会话静默失效 |
| D-02 | G-07（附记，用例本身 PASS） | P1 | 外部文件拖到非记录行区域被**静默丢弃**，无任何提示 |
| D-03 | I-06（GAP） | P1 | Excel 导出恒 `mode=all`，无「选中/筛选」范围 |
| D-04 | I-12 现场发现 | P1 | 构建在缺 Node 时**静默回退**到已有 `dist/`，可能出现「改了源码但测的是旧前端」 |
| D-05 | K-03 首轮现场发现 | P2 | 待确认上传票据（PendingFile）悬挂会让压缩**永久失败到重启**，UI 无可见入口取消 |

---

## 六、BLOCKED 与 GAP（不冒充通过）

| 用例 | 状态 | 原因 | 下一步取证方式 |
|---|---|---|---|
| A-05 | BLOCKED | 任务书要求「WinForms 启动器 + 真实本地 Edge」，但仓库 `src/` 下只有 `IPSys.Web`（ASP.NET Core）一个项目，**没有 WinForms 工程或成品 exe**（脚本已扫 csproj 与 `UseWindowsForms`） | 若能提供启动器成品，按其真实拉起路径重跑；当前以「宿主 exe + 独立 Edge 实例」作等价验证，但不等同，故不记 PASS |
| K-09 | BLOCKED | 需要**两个真实 MCP 客户端**经命名管道并发调用；本环境只能 `POST /api/mcp` 切开关，`GET/POST /api/mcp` 不承载业务调用 | 用两个独立 MCP 客户端进程对同一库并发读写；同一把文件任务锁的 HTTP 侧互斥已由 K-03 覆盖 |
| K-11 | BLOCKED | >2 GiB 单文件需 ≥2 GiB 额外磁盘与数十分钟，且显著改变库体积；任务书允许「资源不足记 BLOCKED」 | 专项跑批（可挂在 CI 的 `large_file_smoke` 输入上）；33 MiB 流式阈值已由 K-01/K-12 覆盖，ZIP64 分支未触发 |
| A-02 | GAP | 本机**没有 `gh`，也没有 CI 访问凭据**，远端 CI 运行记录无法核验；工作流定义、本地等价 Debug/Release 构建与 17 个回归均已核 | 在能访问 Actions 的环境补一次「CI run ↔ SHA」绑定 |
| I-06 | GAP | 导出恒 `mode=all`，UI 无范围选择，**任务书 I-06 的前提在现有壳里不成立** | 先由产品确认是否要补「选中/筛选/全部」语义，再按新语义重写用例 |

---

## 七、数据完整性结论

- 全轮 **6 次**只读 `PRAGMA integrity_check` 均为 `ok`，`PRAGMA foreign_key_check` 恒为空。
- `writing=0`、`readyObjectsUnreferenced=0`、`orphanChunks=0`、`versionsMissingFile/Object=0`、`linksMissingFolder/File=0` —— 收尾快照见 `evidence/dbcheck-final.json`。
- 原件 SHA 对照全部一致：A-07 五个 fixture、I-03 ZIP 条目与 v2 内容、K-01 33 MiB 上传、K-10 中断后重传、K-12 大文件回收后压缩、L-07 上传字节。
- 历史版本策略一致：两版文件只导出最新版（I-03），v1 未泄漏；`link.size/latestVersion` 与下载内容一致（A-04 曾因写死 `versions/1` 取到旧版，已按 `latestVersion` 修正）。
- 跨工作区隔离：读/写/下载/删除四类越界均 404（L-02），转移后 ID 全新（L-02），导出中切区不串味（K-06）。

---

## 八、已知风险与方案边界

1. **任务书本身的问题**已单独记录在 `PLAN_REVIEW.md`（10 条发现 + 5 条缺口）。其中影响执行的三条：I-06 前提不成立、AIGT 模板 404、`dist/` 未入库导致「测的可能不是最新前端」。
2. **未覆盖的边界**（与本轮判定无关，但报告需声明）：虚拟滚动、真实缩略图、在线预览/编辑、移动端适配、完整无障碍、>2 GiB 与 ZIP64 实际分支、两个 MCP 客户端并发。
3. **headless 与真机差异**：headless=new 下无「另存为」对话框，本轮用 File System Access API shim 接管（H-04/K-06/I-03），ZIP 字节级校验等价；但**原生保存对话框的交互体验本身未被验证**。
4. **采样密度**：进度类断言（K-01/K-07）以 200–250 ms 轮询，可能漏掉更细的中间帧；报告只声明「观测到的序列」，不声称覆盖全部帧。

## 九、复现方式

```bash
# 0) 起宿主 build-retest/IPSys.Web.exe（端口每次随机）：
#    netstat -ano | grep LISTENING | grep " <PID>$"   → 取 127.0.0.1:<port>
#    宿主的 Host 校验只允许 127.0.0.1，用 localhost 会 403
node build-retest/phase2/scripts/run-a.cjs   # A 环境基线 + 真实库指纹
node build-retest/phase2/scripts/run-b.cjs   # B 建库与会话（run-b2.cjs 为补跑）
node build-retest/phase2/scripts/run-c.cjs   # C 首次打开与目录骨架
node build-retest/phase2/scripts/run-d.cjs   # D 业务记录 CRUD
node build-retest/phase2/scripts/run-e.cjs   # E 附件与版本
node build-retest/phase2/scripts/run-f.cjs   # F 台账字段与校验
node build-retest/phase2/scripts/run-g.cjs   # G 上传/拖放/查重
node build-retest/phase2/scripts/run-h.cjs   # H 导出与预览
node build-retest/phase2/scripts/run-i3.cjs  # I 检索/预览/导出（i2 为 ZIP shim 版）
node build-retest/phase2/scripts/run-j1.cjs  # J 回收站（j2/j3 为分批删除与任务锁）
node build-retest/phase2/scripts/run-k1.cjs  # K 大文件（浏览器侧）
node build-retest/phase2/scripts/run-k2.cjs  # K 大文件（HTTP 侧）
node build-retest/phase2/scripts/run-l.cjs   # L 安全/视觉/收口
node build-retest/phase2/scripts/run-m.cjs   # B-07 / L-07 / L-08
node build-retest/phase2/scripts/run-n.cjs   # H-04 / K-06（ZIP shim 复核）
# 所有脚本支持 IPSYS_ONLY=<case,case> 单跑，IPSYS_BASE=http://127.0.0.1:<port>
```

只读库核验工具：`build-retest/phase2/tools/dbcheck/`（`dotnet build -c Release`，只读打开，输出 JSON）。
