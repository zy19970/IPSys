# 测试数据与夹具说明 — Phase 2 本地实测

目的：任何人拿到这份报告，都能重建同一套数据、知道哪些操作是破坏性的、破坏前后的快照在哪里。

---

## 一、库与凭据

| 项 | 值 |
|---|---|
| 隔离库 | `build-retest/phase2/vault-p2-p2b.db`（收尾 283,209,728 字节） |
| 口令 | 存于 `build-retest/phase2/vault-p2-p2b.cred.json`（仅本地会话使用，**未写入报告**） |
| 加密 | SQLCipher `4.5.2 community`；连接串 `DataSource + Mode + Password + Pooling=false` |
| **正式库** | `C:\Users\Joey\Documents\IPSys-web-test.db`（352,256 字节）—— **全程未被打开、未被写入**，A-03 用大小 + mtime 双指纹证明（`mtime=2026-10-20T05:00:39.044Z` 前后完全一致） |
| 隔离边界 | 库、原件、导出、日志、Edge profile 全部在 `build-retest/phase2/` 内 |

## 二、工作区与分类骨架

服务端按 `ws` 分命名空间，两套数据完全独立（前端以 `js/store.js` 的 `WS_CATS` 为唯一权威）：

- **企业（company）**：企业资质 / 业务档案 / 公司项目 / 知识产权 / 综合资料
- **个人（personal）**：身份与资质 / 知识产权与著作 / 科研与合作项目 / 成果与奖励 / 学术与社会活动 / 其他资料

收尾规模：`folders 471 / files 215 / objects 231 / versions 237 / chunks 509 / links 228`。A-04 记录的基准数据：企业 项目 147 / 知产 10 / 档案 19，个人 17 / 8 / 13。

## 三、命名规范（便于回溯与清理）

每个用例脚本启动时生成 `TAG = <组前缀><base36 时间戳>`（如 `A` + `mvjxa5s6`），所有自建记录都带这个后缀：

| 组 | 前缀 | 例 |
|---|---|---|
| A | `A` | `A07夹具-Amvjxaz7b`、`A07合同-Amvjxaz7b` |
| J | `J1`/`J2`/`J3` | `J02档案-…` |
| K | `K1`/`K2` | `K01大文件-K1mvjwlhem.bin` |
| L | `L` | `L04特殊-Lmvjx0bln-<>&"'` |
| 收口 | `M`/`N` | `N04合同甲-Nmvjxmmkd` |

**因此「库里哪些是测试数据」是可以按名字判定的**：所有 `*测试*`、`P2*`、各组前缀 + TAG 的记录都是本轮构造的，没有一条来自真实资料。

## 四、A-07 夹具的构造式（可复现）

索引：`evidence/a07-fixture-index.json`；字节文件：`fixtures/`。

| 夹具 | 构造方式 |
|---|---|
| 2 页 PDF | 脚本内 `buildPdf(["IPSys Fixture Page 1","IPSys Fixture Page 2"])` 手写：catalog + pages + font + 每页 page/content 对象，**xref 偏移按 latin1 字节长度现算**，`startxref` 指回真实位置 —— 保证 pdf.js 能打开而不是「看起来像 PDF」 |
| 1 KB 文本 | `("IPSys 1KB 文本夹具 " + TAG + "\n") × 40`，实际 1320 字节 |
| JPEG | 1×1 合法 JPEG（base64 常量），校验 `FFD8FF…FFD9` 魔数，160 字节 |
| 33 MiB 随机二进制 | `crypto.randomBytes(33*1024*1024)`，34,603,008 字节 —— 跨过 `STREAM_MIN_BYTES=32 MiB` 流式阈值 |
| 双版本 v1 | `Buffer.from("A07 双版本 v1 <TAG> ")` → 27 字节 |
| 双版本 v2 | `Buffer.from("A07 双版本 v2 <TAG> " + "X".repeat(64))` → 91 字节，`addVersion` 追加为版本 2 |

> 注：`fixtures/` 目录里留了 4 个实体文件；v1/v2 只留了 SHA 与大小（内容由上面两行构造式完全确定，可原地重建）。两轮 A-07（`Amvjxa5s6` / `Amvjxaz7b`）各生成一套，索引取后者。

## 五、大文件与查重

- 浏览器侧用 `__makeBig(mb, seed)` 生成 xorshift 伪随机字节，**种子取 `Date.now() % 2147483647`**。
  > 教训：首轮用固定种子，第二轮内容与第一轮逐字节相同 → 命中「检测到相同内容，请选择共享、复用或独立保存。」→ 留下待确认票据 → 之后所有 `prepare` 被 409「已有待确认文件」挡住。**测大文件必须每次换内容。**
- HTTP 侧 `slowPrepare` 每 90 ms 写 256 KB，用来**稳定占住 `FileTaskActive`**，让 409 是确定性的而不是碰运气。
- 3 个 33 MiB 级对象分别落在 K-01（浏览器拖放）、K-12（回收+压缩）、A-07（索引）、N（H-04/K-06 导出）—— 内容互不相同，不会互相查重。

## 六、破坏性操作与快照

| 操作 | 位置 | 影响 | 快照/证据 |
|---|---|---|---|
| J 组批量软删 + 分批彻底删除（200/200/3 条） | J-07/J-08/J-09 | 永久删除测试记录与原件 | **操作前快照** `vault-p2-p2b.pre-j-snapshot.db`（77,352,960 字节，SHA-256 前 40 位 `4e81fe79a954f705e6eff37db549256201190466`）；前后计数见 `dbcheck-before-j.json` / `dbcheck-after-j1.json` / `dbcheck-after-j-all.json` |
| K-07 清空回收站（33 MiB） | `#btnEmptyTrash` | 永久删除 1 个 33 MiB 原件 | 进度链 `准备中→0%→3%→54%→100%→完成`；`dbcheck` 由用例内采样 |
| K-12 33 MiB 删除→彻底删除→压缩 | HTTP | objects 209→208、chunks 414→381 | `cases/K-12.json` |
| L-03 关库→重开 | API | 无数据变化（断言六项计数逐项相同） | `dbcheck-before-restart.json` |
| L-01/L-02 越权探测 | API | 全部被拒（401/404），**无任何写入** | `cases/L-01.json`、`L-02.json` |

**破坏性操作全部发生在 J 组快照之后**，且每一步都有前后 `dbcheck` 对照；正式库全程不参与。

## 七、已知残留（不影响结论，但要知道）

1. **库体积从 177 MB 涨到 283 MB**：J 组之后又跑了 A-04/A-07/K-12/N 等上传（含 4 个 33 MiB 级对象），压缩后不会立刻缩小（服务端文案也明说「数据库文件大小不一定立即缩小」）。
2. **`linksDeleted=5`**：软删的附件行保留着（按设计，用于回收站还原）。
3. **测试记录未清理**：所有 `*TAG*` 命名的记录都还在库里，这是刻意的 —— 便于复核者按名字抽查。库本身是隔离的，不清理不影响任何结论。
4. **I-08 注入 401 后前端会话死亡**：该轮之后必须刷新页面重新解锁才能继续（脚本已把 401 注入排到最后）。
5. **K-03 的慢速探针会留下待确认票据**：脚本已在收尾显式 `DELETE /api/v2/files/{ws}/prepared/{ticket}`，实测 `writing 1→0`、chunks `496→380`、`integrity=ok`。若探针被中途杀掉，需要手动取消票据或重启宿主（见 DEFECTS D-05）。
