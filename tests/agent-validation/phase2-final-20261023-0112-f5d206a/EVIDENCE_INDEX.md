# 证据索引 — Phase 2 本地实测

被测代码：`work/onedrive-file-manager` @ `f5d206aec329340ad9d5f6e80fe3451b75d9bd93`
证据根目录：`build-retest/phase2/`（本轮所有落盘都在这里，正式资料库未参与）

---

## 一、目录结构

```
build-retest/phase2/
├── vault-p2-p2b.db                 # 隔离 SQLCipher 库（收尾 283,209,728 字节）
├── vault-p2-p2b.cred.json          # 库路径 + 口令（仅本地，勿外传）
├── vault-p2-p2b.pre-j-snapshot.db   # J 组破坏性操作前的库快照
├── fixtures/                        # A-07 生成的原件（4 个，见 §五）
├── profiles/                        # 每次用例独立的 Edge --user-data-dir
├── tools/dbcheck/                   # 只读 SQLCipher 核验工具（自建，不参与产品构建）
├── scripts/                         # 全部执行脚本 run-*.cjs + lib/cdp/rec
└── evidence/
    ├── cases/<CASE_ID>.json         # 132 份，一条用例一份，字段与 CSV 一致
    ├── results.json                 # 132 条的聚合快照（与 cases/ 同源）
    ├── dbcheck-final.json           # 收尾完整性快照
    ├── dbcheck-before-restart.json  # L-03 关库前快照
    ├── dbcheck-before-j.json        # J 组破坏性操作前
    ├── dbcheck-after-j1.json / dbcheck-after-j-all.json
    ├── a07-fixture-index.json       # fixture 的 SHA/大小/目标目录索引
    ├── b07-env.json                 # B-07 实测 devicePixelRatio / 分辨率
    ├── fixture.json                 # 早期 fixture 记录
    ├── logs/build-debug.log / build-release.log / regression.log
    └── shots/*.png                  # 25 张截图
```

---

## 二、全局证据文件

| 文件 | 内容 | 支撑用例 |
|---|---|---|
| `evidence/results.json` | 132 条用例的 `case_id/priority/status/actual/expected/workspace/record_ids/notes/timestamp/method/tested_commit` | 全部 |
| `evidence/dbcheck-final.json` | `cipherVersion / integrity / foreign_key_check / 各表计数 / 孤儿对象 / writing / 未引用 ready 对象` | 全轮数据完整性 |
| `evidence/a07-fixture-index.json` | 4 个 fixture + 双版本 v1/v2 的 `name/size/sha256/fileId/dest/downloadSha256` | A-07、E 组 |
| `evidence/b07-env.json` | `dpr=1`、`screen/inner` 尺寸 | B-07、A-08 |
| `evidence/logs/build-debug.log` / `build-release.log` | `dotnet build -c Debug/Release` 全文，末行 `*_EXIT=0` | A-02、A-06 |
| `evidence/logs/regression.log` | `文件名｜exit｜末行输出` × 17 | A-02、A-06 |

---

## 三、关键 HTTP 返回（挑最值得复核的）

| 用例 | 请求 | 状态 | 关键返回 |
|---|---|---|---|
| L-01 | 6 类操作 × {空 token, 64×A} | **12/12 = 401** | 恢复合法 token 后同一请求 200 |
| L-02 | 公司 FolderId/FileId/LinkId 换 `personal` 访问 | 404 | 反向 404；`transfer` 返回全新 id ≠ 原 id |
| K-03 | `/api/lock`、`/api/vault/compact`、`purge-task`、`purge`（12 MiB 上传中） | **4/4 = 409** | 文案分别为「文件任务执行中…」「已有上传、删除或其他文件任务正在执行。」「已有文件任务正在执行或程序准备退出。」「文件任务或退出期间不可修改数据。」；`/api/status.unlocked` 仍 true |
| J-08 | `purge-task` 分批 | 200/200/**409** | toast「已确认删除 200 / 403 条」；**没有第 3 批** |
| J-11 | 删除任务中切工作区 | — | 顶栏仍是「企业」，toast「文件任务进行中,完成后再切换工作区」 |
| I-08 | 注入 `search` 401 | 401 | `toasts=[] lockShown=false tokenEmpty=true locked=true` → **D-01** |
| I-08 | 注入 `search` 500（对照） | 500 | 界面显示「检索失败 + 注入文案」，无伪装 |
| I-06 | `POST /api/v2/excel/*/export` | 200 | body 恒 `{mode:"all", ids:null}` → **G-2 / D-03** |
| K-05 | 上传后立即 `DELETE …/links/{id}` | 200 | `{ok:true}`，link 立即消失，`writing` 增量 0 |
| K-10 | 中断 4 MiB 上传后重新上传 | 200 | 下载 SHA 一致，`writing=0`（服务端完整回滚） |
| K-12 | 33 MiB 删除→彻底删除→压缩 | 200/200/succeeded | objects 209→208、chunks 414→381，`integrity=ok` |
| L-07 | 空名称建项目 | **400** | 「项目名称必须填写，最多 300 字。」**库内零行变化**（无假成功） |
| A-04 | `GET /api/v2/search/company?q=P2项目` | 200 | 44 条命中且含目标 id，下载字节 == link.size |
| K-01 | 33 MiB 拖放上传 | 200 | `server.sha == clientSha == 51A46BCF…2C294` |

---

## 四、SQLCipher 完整性 / 外键检查（只读，`Mode=ReadOnly`）

| 时间点 | 文件 | cipher | integrity | FK 违规 | writing | 未引用 ready | 孤儿 chunk |
|---|---|---|---|---|---|---|---|
| J 组破坏性操作前 | `dbcheck-before-j.json` | 4.5.2 community | ok | 0 | 0 | 0 | 0 |
| J-01 后 | `dbcheck-after-j1.json` | 4.5.2 community | ok | 0 | 0 | 0 | 0 |
| J 组全部完成后 | `dbcheck-after-j-all.json` | 4.5.2 community | ok | 0 | 0 | 0 | 0 |
| L-03 关库前 | `dbcheck-before-restart.json` | 4.5.2 community | ok | 0 | 0 | 0 | 0 |
| **收尾** | `dbcheck-final.json` | 4.5.2 community | **ok** | **0** | **0** | **0** | **0** |

收尾计数：`folders 471 / files 215 / objects 231 / versions 237 / chunks 509 / links 228(已删 5)`；`versionsMissingFile=0`、`versionsMissingObject=0`、`linksMissingFolder=0`、`linksMissingFile=0`。

L-03 另有：关库→重开往返后**六项计数逐项相同**（`countsBefore == countsAfter`）。

---

## 五、SHA-256 对照

| 来源 | 对象 | 大小 | SHA-256（前 32 位） | 往返核对 |
|---|---|---|---|---|
| A-07 | `A07两页-Amvjxaz7b.pdf`（2 页） | 868 | `107253A25788F1C1DA0EF955C0C4EF68` | 下载后重算一致 |
| A-07 | `A07文本-Amvjxaz7b.txt`（1 KB） | 1320 | `02718A94C4BB35AD521E9518A2E6166F` | 一致 |
| A-07 | `A07图片-Amvjxaz7b.jpg` | 160 | `CB0501D6C1250017AF030077E00E88B9` | 一致 |
| A-07 | `A07大文件-Amvjxaz7b.bin`（33 MiB） | 34,603,008 | `D7BBE5AB9024FA0BB6E5932A23A75078` | 一致 |
| A-07 v1 | 双版本第 1 版 | 27 | `1A6120527BA2F66278BFD82E0CB31C65` | `versions/1` 一致 |
| A-07 v2 | 双版本第 2 版 | 91 | `56593DC73FF342FB420C1DFDF6AC2744` | `versions/2` 一致 |
| K-01 | 浏览器 33 MiB 大文件 | 34,603,008 | `51A46BCFE2A49C850934744151B996630099BE9988710A58E1830E236DE2C294` | **客户端 == 服务端** |
| I-03 | ZIP 内「两版」条目（只留最新版） | 47 | `65190978C815FF6E4AB4A0734A4908CFEB4D026316EDF6179F7482347E80659F` | ZIP 解包重算 == v2 |
| K-12 | 33 MiB 大文件 | 34,603,008 | `A00A86317F7E7459BC3AB872…` | 回收后压缩仍可读 |
| L-07 | 上传小文件 | 26 | `1024F0F089E70FCA306AD96C…` | link.size == 26 |

ZIP 结构证据（I-03）：`zipLen=3132`、`zipCount=7`、`methodsStored=true`（全部 `method=0`）、7 条路径全部以「I2复核项目-I2mvjvo4rn/I2复核合同-I2mvjvo4rn/」开头，v1 未泄漏。

---

## 六、截图索引（`evidence/shots/`，共 25 张）

| 文件 | 内容 |
|---|---|
| `l05-1366x768-Lmvjx30h2.png` | L-05 1366×768 首页 + 台账 + 详情面板 |
| `l05-1920x1080-Lmvjx30h2.png` | L-05 1920×1080 同上 |
| `l05-1366x768-Lmvjx0bln.png` / `l05-1920x1080-Lmvjx0bln.png` | L-05 首轮（断言写错，留存作对照，结论以 `Lmvjx30h2` 两张为准） |
| `i-final-Imvjve5mi.png` / `i2-final-I2mvjvo4rn.png` | I 组收尾状态（含 ZIP shim 后的界面） |
| `j2-final-J2mvjw06j8.png` / `j2-final-J2mvjw2qkx.png` | J 组分批彻底删除后的回收站 |
| `k1-final-K1mvjwbygc.png` … `k1-final-K1mvjwr3ac.png`（4 张） | K-01/K-02/K-04/K-07 收尾状态，含上传进度面板与删除进度面板 |
| `n-final-Nmvjxmmkd.png` | H-04 / K-06 复核收尾（切到个人工作区后） |
| `h-final-*.png`（4 张）、`g-final-*.png`（7 张） | H/G 组各组用例收尾 |
| `probe-g.png` | G 组探针截图 |

---

## 七、日志

| 文件 | 支撑 |
|---|---|
| `logs/build-debug.log` | A-02 / A-06：`0 个错误`、6 个警告、`DEBUG_EXIT=0` |
| `logs/build-release.log` | A-02 / A-06：`0 个错误`、`RELEASE_EXIT=0` |
| `logs/regression.log` | A-06：17 行 `文件名｜exit｜末行输出`，17/17 `exit=0`，无 skip |

---

## 八、独立复核方式

**1) 校验库完整性（不写库）**

```bash
cd build-retest/phase2/tools/dbcheck && dotnet build -c Release
./bin/Release/net8.0/dbcheck.exe <db路径> <口令>
# 输出 JSON：cipherVersion / integrity / foreignKeyViolations / 各表 counts / writingRows ...
```

**2) 单跑任一条用例**

```bash
# 先起宿主，再取 127.0.0.1:<port>（localhost 会被 Host 校验 403）
IPSYS_BASE=http://127.0.0.1:<port> IPSYS_ONLY=I-08 node scripts/run-i3.cjs
```

**3) 复核某条用例的全部断言**

打开 `evidence/cases/<ID>.json`，`actual` 是脚本当时写下的原始观测值（未加工），`notes` 是判定理由。
CSV 里的 `actual` 与之一致 —— 报告中的每个数字都能在这里找到出处。

**4) 复核「BUG 不是脚本噪声」**

见 `TEST_ERRORS_AND_BLOCKERS.md` §三：27 条探针缺陷、9 条用例一度误判、逐条纠正记录。唯一保留的 CONFIRMED_BUG（I-08）有独立复现步骤（`DEFECTS.md` D-01）。
