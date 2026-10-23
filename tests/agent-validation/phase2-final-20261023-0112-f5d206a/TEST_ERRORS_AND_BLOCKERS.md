# 执行错误、阻塞与未执行项 — Phase 2 本地实测

本文件专收三类东西：**产品做不到/环境不给**（BLOCKED）、**任务书前提不成立**（GAP）、**我们自己的探针写错了**（TEST_ERROR）。
最后一项尤其重要：本轮有 **9 条用例一度被探针缺陷误判为 CONFIRMED_BUG**，复核后全部纠正为 PASS；记录在此，证明报告里的 BUG 数量不是脚本噪声。

---

## 一、BLOCKED（3 条，均未冒充 PASS）

### B-1 · A-05 WinForms 启动器不存在

- **用例**：A-05（P1）「使用 WinForms 启动器与真实本地 Edge，确认进程退出及重启」。
- **阻塞点**：仓库 `src/` 下只有 `IPSys.Web`（ASP.NET Core）**一个** `.csproj`，没有 `UseWindowsForms` 工程，也没有成品启动器 exe（脚本遍历了 `.csproj` 与 `UseWindowsForms` 关键字）。
- **已做的等价验证**：`build-retest/IPSys.Web.exe` 直启 + 独立 `--user-data-dir` 的 Edge；进程退出/重启的会话行为由 B-07（浏览器两程）与 L-03（关库→重开）覆盖。
- **为什么仍记 BLOCKED**：等价验证不等同于「启动器拉起 Edge 并随进程退出」，不能替代。
- **下一步**：提供启动器成品后，按其真实拉起路径重跑；需要观测「关启动器 → Edge 是否退出」「重开启动器 → 是否复用同一 Edge profile」。

### B-2 · K-09 两个 MCP 客户端并发

- **用例**：K-09（P0）「两个 MCP 客户端并发读写」。
- **阻塞点**：`GET/POST /api/mcp` 只返回并切换 `enabled`，**不承载业务调用**；真正的 MCP 调用走命名管道，本环境无法构造两个独立 MCP 会话。
- **已做的替代证据**：同一把文件任务锁在 HTTP 侧的互斥由 **K-03** 完整覆盖（`/api/lock`、`/api/vault/compact`、`purge-task`、`purge` 四路全 409 且文案明确，库保持解锁）。
- **下一步**：起两个独立 MCP 客户端进程对同一库并发读写，断言第二个客户端拿到明确 409/拒绝而不是挂死。

### B-3 · K-11 >2 GiB 与 ZIP64 边界

- **用例**：K-11（P1）「准确记录耗时、文件 SHA 与大于 2 GiB 边界」。
- **阻塞点**：需 ≥2 GiB 额外磁盘 + 数十分钟上传，且会显著改变库体积；任务书本身允许「资源不足记 BLOCKED」。
- **已覆盖的相邻证据**：`STREAM_MIN_BYTES=32 MiB` 的流式分支由 K-01（浏览器 33 MiB 拖放）与 K-12（33 MiB 上传→彻底删除→压缩）覆盖；`ZIP32_SAFE_LIMIT`/ZIP64 分支在 `export.js` 中存在但**本轮未触发**。
- **下一步**：挂到 CI 的 `large_file_smoke` 输入上专项跑；或本机留出 ≥4 GiB 空闲后单独一批。

---

## 二、GAP（2 条：任务书前提或外部凭据缺失）

### G-1 · A-02 远端 CI 无法核验

- **已有证据**：`.github/workflows/web-windows.yml` 同时声明 Debug 与 Release 构建、随 push 触发；本地等价构建 Debug/Release 各 0 错误；17 个 Node 回归全 exit=0；`dotnet 10.0.401` / `node v22.22.2` / `SQLCipher 4.5.2 community`。
- **缺口**：本机 `PATH` 里没有 `gh`，也没有 CI 访问凭据 —— **CI run 与被测 SHA 的绑定关系无法核验**。
- **为什么记 GAP 而不是 PASS**：期望是「CI 证据与所测代码 SHA 匹配」，这一条没做到。
- **下一步**：在能访问 Actions 的环境跑一次 `gh run list --commit f5d206a`，把 run id 与本报告绑定。

### G-2 · I-06 导出范围语义不存在

- **事实**：导出请求体恒为 `{"mode":"all","ids":null}`（`js/excel.js:51`），UI 没有「选中 / 筛选 / 全部」三种范围；同文件 `:11` 注释承认是沿袭旧壳的取舍。
- **为什么记 GAP**：任务书 I-06 的判定标准（「输出范围与 UI 所选语义一致」）在现有壳里**没有可执行的观测点**。
- **关联缺陷**：功能层面的问题单列为 **DEFECTS D-03**。
- **下一步**：先由产品确认要不要补范围语义，再按新语义重写用例。

---

## 三、TEST_ERROR（探针自身缺陷，共 9 条用例一度被误判）

> 全部为「测试脚本写错 → 判定失败 → 定位到脚本 → 修正后重跑 → PASS」。
> 这些**没有**被计入产品缺陷，也没有留在 `TEST_CASE_RESULTS.csv` 的 CONFIRMED_BUG 里。

| # | 现象 | 根因 | 受影响用例 | 纠正方式 |
|---|---|---|---|---|
| 1 | 「预览打不开」判 BUG | 预览入口绑在 `dblclick`（`interactions.js:1163-1171`），探针用了 `click`；同时依赖的 fixture 合同已被前序用例消耗 | I-01、I-02 | 改 `dblclick` + 自建夹具 |
| 2 | 后续用例集体 401 | I-08 注入的 401 命中 `store.js:87-90`，把前端会话打死 | I-03、I-09、I-10 | 401 注入挪到最后执行 |
| 3 | 检索结果恒为 0 | `/api/v2/search` 返回 `{query,results,truncated}`（camelCase），探针按 `items`/`hits`/`Results` 取 | I-07 | 改 `data.results` |
| 4 | ZIP 条目数不符 | 断言写死 6，实际 7（pdf/png/bin/两版/长名/重名×2） | I-03 | 断言改 7 并从落盘证据重算 |
| 5 | `dotnet build` 报 MSB3027/MSB3021 | 宿主进程占用 `IPSys.Web.exe`；另 PATH 剔除漏了 pnpm 目录下的 node.exe | I-12 | `-o` 独立输出 + 「目录内是否有 node.exe」精确剔除 |
| 6 | 500 分支被判「伪装成功」 | 文案后半句「本地已加载的内容里也没有匹配项」被我的否定词表误伤 | I-08（500 分支） | 只要求出现「检索失败」且不以「找不到/暂无」开头 |
| 7 | 档案接口一律 400 | `Section` 在 **body 顶层**（POST），GET/DELETE 走**查询参数** `?section=`；`Archive` 内放 section 无效 | J-02 | 两处分别修正 |
| 8 | IP 创建 400 / General 创建 400 | `IpType` 必须用全称（「实用新型专利」不是「实用新型」）；General 字段是 `General:{Title:...}` 不是 `Name` | J-06、J-02 | 按真实契约修正 |
| 9 | 回收站里找不到刚删的附件 | 先删了父合同，`RecycleStore.cs:53-73` 要求父 `deleted=0`，link 因此不作为 `v2_file` 出现 | J-04、J-05 | 改直接 `DELETE /api/v2/files/{ws}/{fileId}/links/{linkId}` |
| 10 | 分批彻底删除判 BUG | 断言要求「只有 1 批」，实际第 2 批发出并被 409 拒；关键是**没有第 3 批** | J-09 | 改判 `secondRejected + noThird` |
| 11 | 并发切区判 BUG（两轮） | ① 期望抓到 `running` 采样不到；② 期望切换成功，而产品**明确拒绝**并提示「文件任务进行中,完成后再切换工作区」 | J-11 | 改判 `blockedSwitch && toldBusy` |
| 12 | 加密未生效判 BUG | `PRAGMA cipher_version` 返回 `"4.5.2 community"`，**不含 "SQLCipher" 字样** | J-12 | 改「非空即生效」 |
| 13 | 上传三阶段全空、`active=false` | 拖到 `#viewRoot` 容器上，被 `closest(".row,.tile")` 静默丢弃（即 D-02 那条路径） | K-01、K-02、K-04 | 落点改 `#viewRoot [data-id='c:<id>']` |
| 14 | 上传后服务端查不到 | `links` 响应**没有 `name` 字段**（只有常为 null 的 `displayName`） | K-01、K-10 | 按 `size` / `fileId` 定位，再回查真名 |
| 15 | 上传撞「检测到相同内容」 | `__makeBig` 固定种子，内容与上一轮逐字节相同，命中查重并留下待确认票据 | K-01 | 每轮取 `Date.now()` 做种子 |
| 16 | 清空回收站 `sel=0` | 按 `t:v2_file:<linkId>` 拼 id 匹配不到 `RECYCLE`；且点击 `#btnEmptyTrash` 后**又手动调了一次** `recycleAction` | K-07 | 只走按钮 + `settleConfirm(true)`，去掉重复触发 |
| 17 | K-08/K-12 压缩全 failed、K-05 判 BUG | **根因是 #16 之外的独立问题**：K-03 的慢速 prepare 返回的是「待确认票据」，探针没取消 → 12 MiB `state='writing'` 对象悬挂 → 压缩报「仍有尚未完成的原件写入」；K-05 又把别人的 `writing=1` 当成自己的 | K-05、K-08、K-12 | K-03 收尾显式 `DELETE .../prepared/{ticket}`；K-05 改判「增量」而非绝对值 |
| 18 | 窄屏详情面板越界 | 断言写 `s.winW`，实际字段在 `s.detail.winW` → `1366 <= undefined+2` 恒假 | L-05 | 改 `s.detail.winW` |
| 19 | 两个主入口判「死按钮」 | ① 在首页探测「详情开关 / 台账导出」，而首页按设计没有详情面板、`#excelActions` 隐藏；② 反应面只统计 toast/`.mask.show`，漏了 `#ctxMenu.show` | L-06 | 改到项目台账页探测；反应面加入 `#ctxMenu.show` 与 `#detail.open` |
| 20 | A-03 判「隔离目录不完整」 | 把 `fixtures/` 当成前置条件，而它由 A-07 按需创建 | A-03 | 前置只查 4 个目录 |
| 21 | A-04 判「核验链路不完整」 | ① 知产行没有顶层 `name`（在 `data.name`）；② 下载写死 `versions/1`，而 link 是第 3 版，字节数自然对不上 | A-04 | 名称取 `data.name`；版本取 `latestVersion` |
| 22 | A-07 判「SHA 不一致」 | `addVersion()` 返回的是 `data` 而非 `{status,ok,data}`，`vres.ok` 恒 undefined | A-07 | 改 `!!vres` |
| 23 | L-07 判「三方对照不一致」（三轮） | ① `L.upload` 直接返回 data；② `PUT` 必须带 `ProjectType`；③ `folder_file_links` 统计**全表含已删**，软删只让 `linksDeleted+1`；④ 跨区步骤漏了 `integrity/fk/writing/unref` 字段 | L-07 | 逐条按真实契约修正 |
| 24 | L-08 报「缺 1 条」 | 它先读目录再写自己，盘上先缺 L-08 | L-08 | 排除自身 |
| 25 | 3 个回归脚本 ENOENT | `upload-progress` / `upload-unique-autosave` / `zip64` 按 **CWD** 拼 `src/IPSys.Web/wwwroot/...`，在 `tests/` 目录下跑必失败 | A-06 | 统一改在仓库根执行，17/17 通过 |
| 26 | Bash 里调 PowerShell 被安全拦截 | 「Invoking PowerShell from Bash bypasses PowerShell security checks」 | —（工具链） | 改用 PowerShell 工具 |
| 27 | bash 内联 node 的模板字符串被吞 | shell 展开吃掉了反引号与 `${}` | —（工具链） | 改为写文件后 `node <file>` 执行 |

**受影响用例最终状态**：I-01/02/03/07/09/10/12、J-02/04/05/06/09/11/12、K-01/02/04/05/07/08/10/12、L-05/06、A-03/04/07、L-07、L-08 —— **全部 PASS**。

---

## 四、资源与环境约束（影响取证方式，不影响结论）

| 约束 | 影响 | 绕过方式 |
|---|---|---|
| 无 `gh` / CI 凭据 | A-02 只能记 GAP | 本地等价构建 + 工作流定义核验 |
| 无 WinForms 启动器 | A-05 BLOCKED | 宿主 exe + 独立 Edge 实例 |
| headless 无「另存为」对话框 | H-04/K-06/I-03 原本拿不到 ZIP | `showSaveFilePicker` shim 把 ZIP 收进内存，解包逐条校验 SHA |
| 宿主端口每次随机 | 脚本不能写死端口 | 每次从 `netstat` + `/api/status` 现取（`IPSYS_BASE`） |
| 待确认票据是进程内状态 | 悬挂会阻塞压缩（D-05） | 显式 `DELETE .../prepared/{ticket}`；极端情况重启宿主（本轮实测重启后 `check=ok`、恢复） |
| `dist/` 未入库 | 可能出现「测的是旧前端」（D-04） | 本轮所有界面证据前都用「17 个回归里的 `ui-assets-smoke`（fresh bundle）」校验 |

---

## 五、未执行项

无。132 条任务书用例**全部**已执行或明确归入上面的 BLOCKED/GAP，没有「未执行」条目。
