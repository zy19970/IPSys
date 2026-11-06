# IPSys：启用 INCREMENTAL 空间回收的落地方案

| 项 | 值 |
| --- | --- |
| 状态 | **已审核通过（2026-11-06 21:56），待实施** |
| 基线 | `497f91dbca3460b0a6ba46e60b7fb36ce20bcf7b` |
| 实测证据 | `_ops/tmp/full-2g.json`、`_ops/tmp/smoke.json`、`_ops/logs/full-2g.log` |
| 实验代码 | `IncrementalVacuumLabSmoke.cs`（工作树版本，blob `2adf71e5`，未提交） |
| 前置结论 | 全库切 INCREMENTAL 不带来可感知的性能或空间损失（见第 2 节） |

---

## 0 一句话

**新库在建表前启用 `auto_vacuum=INCREMENTAL`，把设置页的「压缩数据库」改成「原地分批回收」，从此不再需要预留一倍磁盘空间。**

---

## 1 解决什么，不解决什么

| | 内容 |
| --- | --- |
| **解决** | 库涨到磁盘容量的一半以上后，完整 `VACUUM` 因需要 `2×DB` 峰值空间而永久无法执行的问题 |
| **解决** | 删除大量内容后，空间能真正还给操作系统，而不是只能等下次写入被复用 |
| **解决** | 回收期间不再需要一份等大的临时副本，磁盘只剩 2 GB 时也能把 200 GB 的库收下来 |
| **不解决** | 库不会自动变小。不点回收，它稳定在历史峰值（这是设计，不是缺陷） |
| **不解决** | 碎片导致的页内空隙（`incremental_vacuum` 只回收整页，不消除页内碎片） |

---

## 2 实测依据（2 GiB 库，三组各 3 次重复，零失败）

| 指标 | NONE | INCREMENTAL | 判读 |
| --- | --- | --- | --- |
| 库文件大小 | 2928.8 MiB | 2932.4 MiB | **+0.125%**，即 ptrmap 开销 |
| 写入耗时（约 2.5 GiB 内容） | 37.9 / 38.7 / 37.0 s | 38.8 / 37.8 / 39.1 s | 差值落在组内波动内，**无可测差异** |
| 回收 3.07 GiB 空闲页 | 不可能 | 13.7 / 15.6 / 15.9 s，约 200 MiB/s | 仅在你点回收时发生 |
| 回收后 `freelist_count` | 803,343（不变） | **0** | 彻底回收，无残留 |
| 复用验证（2.0 + 0.8 → 删 0.8 → 写 1.2 GiB） | 3347.6 MiB | 3351.8 MiB | 两组都远低于不复用的 4096 MiB |
| 完整性 / 加密 / 重开 | — | SHA-256 全对、`integrity_check=ok`、外键零违规、错误口令被拒、重开后模式仍为 2 | — |

批次大小是反直觉的一项：**4096 页/批比 256 页/批慢 3.3 倍**（60.7 vs 200.9 MiB/s），所以方案固定用 256 页。

---

## 3 明确不做的事

1. **不做旧库迁移。** 软件未上线，没有存量库；旧开发库保持原样可用，只是没有回收入口。
2. **不做自动回收。** 只在用户点击时执行，避免后台静默吃 I/O。
3. **不改连接参数。** `journal_mode=DELETE`、`synchronous=FULL`、`foreign_keys=ON` 全部维持。
4. **不动 schema。** `resource_schema_version` 仍为 4，不新增表、不新增列。
5. **不改 HTTP 路径。** `/api/vault/compact`、`/api/vault/compact/info`、`/api/vault/compact/task` 三个路径不变。
6. **不引入新依赖。**
7. **不通过 MCP 暴露完整 VACUUM**，MCP 只能触发原地回收。

---

## 4 设计决策

### D1 建库时设定，并立刻回读断言

`auto_vacuum` 只有两个生效时机：建表之前，或执行一次 `VACUUM`。第二种要 `2×` 空间，正是要避免的事。所以**必须在 `CreateSchema` 里、建表之前设定**，然后回读，读不回 `2` 就直接抛异常。

> 静默失效的后果是：这个库永远无法原地回收，而且用户不会知道。

### D2 失败即拒绝建库（fail closed）

回读不匹配时抛 `IOException`，让建立会话这一步失败。此时库文件是空的，用户重试或删掉重建即可，没有数据损失。**绝不"降级继续"**。

### D3 回收 = 分批 `incremental_vacuum(256)`

- 每批 256 页 = 1 MiB，实测速率最高且最稳定
- 每批一个独立事务，批之间检查取消令牌，因此可取消、可让出写锁
- 进度按真实 `freelist_count` 算，不用假百分比
- 某批回收页数为 0 而 freelist 仍大于 0 → 判定异常并停止，**不把"循环结束"当成"回收完成"**

### D4 空间预检必须按模式分流（本方案最关键的一处）

现有 `Inspect()` 无条件要求 `fileBytes × 2 + 128 MiB`。如果沿用，**在磁盘只剩 2 GB 时，一个 200 GB 的 INCREMENTAL 库会被自己的预检挡住**，恰好堵死这个功能唯一的用武之地。

| 模式 | `requiredFreeBytes` | 理由 |
| --- | --- | --- |
| `2`（incremental） | `batchPages × pageSize + 64 MiB` ≈ **65 MiB** | 只需一批的回滚日志 + 余量，与库大小无关 |
| `0`（none） | `fileBytes × 2 + 128 MiB` | 完整 VACUUM 的旧口径，保持不变 |

`canCompact` 随之按模式计算；incremental 模式**不再检查系统临时目录**（不产生临时文件）。

### D5 NONE 库明确拒绝，不静默回落完整 VACUUM

旧库点回收时，返回 `409` + 明确文案：

> 此资料库创建于旧版本，不支持原地回收。请重建资料库，或使用完整压缩。

理由：静默回落会在用户不知情时要求 2 倍空间，而且可能因空间不足直接失败——**用一条清晰的错误，换掉一次不可预期的长时间失败**。

### D6 完整 VACUUM 降级为 API 参数，UI 不暴露

`POST /api/vault/compact` 请求体保留 `full: true` 走完整 VACUUM，供排查与将来复用；**设置页不再提供这个按钮**。理由：INCREMENTAL 下它没有任何必要用途，留着只会让用户误以为"压缩"仍然需要两倍空间。

### D7 支持取消（已确认）

回收 50 GB 可能需要几分钟。既然分了批，取消就是顺手的：批之间检查令牌，取消后**已经回收的部分保留**（不是回滚），这是正常语义，文案要说清。

### D8 MCP 侧采用「启动 + 轮询」的异步形态，不做阻塞调用

一个 50 GB 库的回收可能十几分钟，而 MCP 客户端普遍有调用超时。阻塞式工具一旦被客户端掐断，**Agent 无法区分"还在跑"和"已经失败"**，只能盲目重试或放弃。

因此 MCP 侧与 HTTP 侧保持同构：一个工具启动任务并立即返回 `taskId`，另一个工具查询进度，第三个工具取消。这与仓库已有的 `start_upload_task` / `get_task_status` / `cancel_task` 完全一致，Agent 不需要学两套模式。

**不给回收加 `request_id`**：`mcp_operations` 是幂等日志，防止重复业务写入；回收天然幂等（再跑一次只会发现没有空闲页），加编号反而会让"已启动但未完成"被记成 `done`，制造假状态。

---

## 5 改动清单

| 编号 | 文件 | 内容 | 估计 |
| --- | --- | --- | --- |
| M1 | `src/IPSys.Web/Vault.cs` | `CreateSchema` 拆出带模式的私有重载并断言；新增 `CancelFileTask()` | +25 |
| M2 | `src/IPSys.Web/VaultCompactJob.cs` | 快照增加 `PagesDone/PagesTotal/Mode`；新增 `Progress()`、`Cancel(done)`；修正取消文案 | +30 |
| M3 | `src/IPSys.Web/VaultCompactEndpoints.cs` | `Inspect` 按模式分流；新增 `Reclaim()`；`/compact` 分流；新增 `/compact/cancel` | +95 |
| M4 | `wwwroot/index.html` + `wwwroot/js/interactions.js` | 行标题、按钮、确认框、进度、取消按钮全部改写 | +80 |
| M5 | `src/IPSys.Web/IncrementalVacuumLabSmoke.cs` | 保留（作为回归守门人）；修清理缺陷；改为显式指定模式 | +20 |
| M6 | `VaultCompactSmoke.cs`、`VaultCompactHttpSmoke.cs` | 覆盖两条路径（回收 / 完整 VACUUM）、模式字段、拒绝旧库 | +70 |
| M7 | `src/IPSys.Web/McpLocalVault.cs`（新增） | 4 个库级工具的定义与 HTTP 转发 | +150 |
| M8 | `src/IPSys.Web/McpLocal.cs` | `Tools()` 组装 + 在解析 workspace 之前拦截库级工具 | +10 |
| M9 | `src/IPSys.Web/NativeMcpSmoke.cs` | MCP 回收链路的冒烟断言 | +60 |

合计约 **540 行**，集中在压缩链路与 MCP 工具层，不触碰上传、删除、回收站、导出、schema。

---

## 6 关键实现

### 6.1 建库（M1）

```csharp
public enum VaultFreeSpaceMode { None = 0, Incremental = 2 }

public static void CreateSchema(SqliteConnection db)
    => CreateSchema(db, VaultFreeSpaceMode.Incremental);

public static void CreateSchema(SqliteConnection db, VaultFreeSpaceMode mode)
{
    // auto_vacuum 只在建表前有效；静默失效会让这个库永远无法原地回收。
    using (var cmd = db.CreateCommand())
    {
        cmd.CommandText = $"PRAGMA auto_vacuum={(int)mode};";
        cmd.ExecuteNonQuery();
        cmd.CommandText = "PRAGMA auto_vacuum;";
        int actual = Convert.ToInt32(cmd.ExecuteScalar());
        if (actual != (int)mode)
            throw new IOException(
                $"无法为新资料库设定空间回收模式（期望 {(int)mode}，实际 {actual}）。");
    }
    ResourceSchemaV2.Create(db);   // 事务在此之前不能开启
}
```

**为什么保留带模式的公开重载**：实验类的 `NONE` 对照组必须显式要 `NONE`。如果 `CreateSchema` 内部无条件写死 `INCREMENTAL`，对照组会被悄悄改掉，实验就变成"两种模式都开了增量"，对照失效。显式参数让这个依赖在编译期暴露。

### 6.2 预检分流（M3）

```csharp
int autoVacuum = (int)Scalar(db, "PRAGMA auto_vacuum;");
bool incremental = autoVacuum == 2;
long required = incremental
    ? ReclaimBatchPages * pageSize + ReclaimMargin   // 1 MiB + 64 MiB
    : checked(fileBytes * 2 + Margin);               // 旧口径
```

### 6.3 回收主循环（M3）

```csharp
public static void Reclaim(SqliteConnection db, string path,
    VaultCompactJob job, CancellationToken ct)
{
    var info = Inspect(db, path);
    if (info.Mode != "incremental")
        throw new IOException("此资料库创建于旧版本，不支持原地回收。");
    job.Begin(info.FileBytes, info.ReusableBytes, info.FreePages);
    if (!info.CanCompact)
        throw new IOException("磁盘可用空间不足，原地回收至少需要 " +
            info.RequiredFreeBytes + " 字节。");
    if (Scalar(db, "SELECT COUNT(*) FROM file_objects WHERE state='writing';") != 0)
        throw new IOException("仍有尚未完成的原件写入，禁止回收。");

    RequireIntegrity(db, "回收前");

    long total = info.FreePages, remaining = total, done = 0;
    using var cmd = db.CreateCommand();
    cmd.CommandTimeout = 0;                 // 大库上不要用默认 30 秒
    while (remaining > 0)
    {
        ct.ThrowIfCancellationRequested();
        cmd.CommandText = $"PRAGMA incremental_vacuum({ReclaimBatchPages});";
        cmd.ExecuteNonQuery();
        long now = Scalar(db, "PRAGMA freelist_count;");
        if (now >= remaining)               // 一批下来一页没少
            throw new IOException($"原地回收无进展（已回收 {done} 页，剩余 {now} 页）。");
        done += remaining - now;
        remaining = now;
        job.Progress(done, total, new FileInfo(path).Length);
    }

    RequireIntegrity(db, "回收后");
    job.Finish(new FileInfo(path).Length);
}
```

要点：

- `remaining` 每批从数据库重新读，**不靠算术推算**
- 无进展立即抛错，不把"跑完循环"冒充"回收完成"
- 前后各一次 `integrity_check`，与现有完整 VACUUM 路径保持同等要求
- `writing` 状态检查与现有 `Compact()` 完全一致

### 6.4 前端（M4）

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| 行标题 | 压缩数据库 | 空闲空间回收 |
| 状态文字 | `当前 12.4 GB · 空闲页约 3.1 GB` | `当前 12.4 GB · 可回收 3.1 GB（占 25%）` |
| 按钮 | 压缩 | 回收 |
| 确认框 | 「VACUUM 会创建临时副本…预留约 2×」 | 「在原文件内搬移数据页并截断，不创建临时副本，不需要额外空间。期间请勿退出程序。」 |
| 运行中 | `正在压缩，请保持程序运行…` | `已回收 1.2 GB / 3.1 GB（38%）` |
| 完成 | `数据库压缩完成：A → B` | `回收完成：A → B，释放 C` |
| 旧库 | 不区分 | `此资料库创建于旧版本，不支持原地回收` + 按钮置灰 |

`auto_vacuum != 2` 时按钮置灰并显示原因，而不是点了才报错。

### 6.5 MCP 工具（M7 / M8）

新增 4 个工具，全部是**资料库级**（不分工作区，因为一个库同时装着公司和个人两个工作区）。

| 工具 | 类型 | 参数 | 返回 |
| --- | --- | --- | --- |
| `get_vault_storage` | 只读 | 无 | `mode`（incremental/none）、`fileBytes`、`pageCount`、`freePages`、`reclaimableBytes`、`diskFreeBytes`、`canReclaim` |
| `reclaim_vault_space` | 维护 | 无 | `taskId`、`state`（立即返回） |
| `get_vault_reclaim_status` | 只读 | 无 | `state`、`stage`、`pagesDone`、`pagesTotal`、`bytesBefore`、`bytesAfter`、`error` |
| `cancel_vault_reclaim` | 维护 | 无 | `requested`（取消是异步生效的，不代表立即停止） |

**三个必须处理的实现约束：**

1. **必须绕过 `Workspace(args)` 拦截。** `ExecuteAsync` 第一行就是 `string workspace=Workspace(args)`，而 `Workspace()` 在缺少合法 `workspace` 时会抛异常。库级工具没有这个参数，因此要在 `ExecuteProtectedAsync` 里像 `get_agent_guidance` 那样**提前分流**，不能进通用路径。

2. **不登记 `mcp_operations`。** 回收不是业务写入（见 D8），`IsWriteTool()` 不收录这几个名字，因此不会要求 `request_id`，也不会在幂等表里留下 pending 行。

3. **工具描述里必须写明"不需要 workspace"和"仅在用户明确要求时调用"。** 现有 45 个工具全部带 `workspace`，Agent 会形成惯性；描述不写清就会连续收到"缺少必填参数"的错误。同时这是会长时间占用写锁的操作，不能被 Agent 当成顺手清理。

映射关系（直接复用 HTTP，不复制逻辑）：

```
get_vault_storage      → GET  /api/vault/compact/info  +  GET /api/vault/storage
reclaim_vault_space    → POST /api/vault/compact        {confirm:true}
get_vault_reclaim_status → GET /api/vault/compact/task
cancel_vault_reclaim   → POST /api/vault/compact/cancel
```

`get_vault_reclaim_status` 在从未回收过时，服务端返回 404；MCP 层把它翻译成 `{state:"idle"}`，**不把"还没跑过"当错误**。

另外：`get_vault_storage` 的 `canReclaim` 直接取服务端算好的值，不要由 Agent 自己用 `diskFreeBytes` 和 `fileBytes` 推算——那会重新踩上 D4 那个"用 2 倍口径卡住自己"的坑。

---

## 7 失败与边界处理

| 情形 | 行为 |
| --- | --- |
| 建库回读不是 2 | 抛异常，建库失败，不留半成品库 |
| 磁盘空间不足（incremental） | 启动前拒绝，提示需要约 65 MiB |
| 存在 `writing` 状态原件 | 拒绝，提示检查待确认上传（沿用现有文案） |
| 回收前 `integrity_check` 失败 | 拒绝执行 |
| 回收后 `integrity_check` 失败 | 任务标失败，文案要求停止写入并核查备份 |
| 某批无进展 | 立即失败，报告已回收页数，不停在"假成功" |
| 用户取消 | 已回收部分保留，任务标 `canceled`，可再次发起并继续 |
| 程序退出 | 沿用现有 `TryScheduleExit`：取消任务或等任务完成 |
| 任务并发 | 沿用 `TryBeginFileTask`，第二个请求 409 |
| 旧库（`auto_vacuum=0`） | 409 + 明确文案，按钮在 UI 层就已置灰 |
| MCP 调用时库为旧模式 | 返回明确错误，**不自动回落到完整 VACUUM** |
| MCP 在无可回收页时发起回收 | 立即返回 `pagesTotal=0`，不启动任务 |
| MCP 重复发起回收 | 第二次被 `TryBeginFileTask` 拒绝，返回"已有任务在执行" |
| MCP 查询状态但从未回收过 | 返回 `state:"idle"`，不报错 |

---

## 8 验证方案

### 8.1 自动化（提交前必须全绿）

| 项 | 内容 |
| --- | --- |
| 编译 | `dotnet build -c Debug` |
| 冒烟 | `IPSys.Web.exe --smoke`（含改造后的 `VaultCompactSmoke`、`VaultCompactHttpSmoke`） |
| 实验回归 | `--vacuum-lab` 4 MiB（CI 内置）与 64 MiB（本地） |
| 新断言 | 回收后 `freelist_count==0`；NONE 组逐页不变；完整 VACUUM 后 `auto_vacuum` 仍为 2；旧库请求返回 409 |
| MCP 断言 | 4 个工具均出现在 `tools/list`；`get_vault_storage` 的 `mode=="incremental"`；无 workspace 参数也能调用成功；旧库发起回收返回明确错误；重复发起被拒；`state` 未启动时为 `idle` |

### 8.2 本机手动（10 分钟，需要你执行）

1. 新建一个资料库 → 设置页应显示「当前 X · 可回收 0 B」，按钮置灰
2. 上传约 200 MB 附件 → 删除 → 永久删除 → 应显示「可回收约 200 MB」
3. 点回收 → 观察文件真实变小、进度递增、完成提示
4. 再上传同样大小内容 → 库不应超过原大小（复用生效）
5. 回收中途点取消 → 再次回收能继续跑完
6. 退出重开 → 数据完整、可回收仍为 0

### 8.3 生产规模观察（软件实际使用后）

- 库到 10 GB 以上时记录一次回收速率，替换当前的 200 MiB/s 估算
- 优先在**磁盘余量紧张**时执行一次，验证"空间不足时也能回收"这一核心场景

---

## 9 风险与未测

| 项 | 说明 | 应对 |
| --- | --- | --- |
| **规模外推** | 实测最大 2 GiB，且全程在页缓存内，200 MiB/s 偏乐观；50 GB 库可能慢 4 倍 | 可分批、可取消；文案不承诺时间 |
| **长时间独占** | 回收期间持有写锁，单批几十毫秒，批间释放 | 分批本身就是为此设计 |
| **碎片的碎片** | 只回收整页，页内空洞不处理 | 属机制边界，不宣称"彻底整理" |
| **断电** | 未测试 | 每批是独立事务，最坏丢最后一批；上次实验已验证重开与完整性 |
| **旧库误操作** | 用户可能在旧库上反复点 | UI 置灰 + 服务端 409 |

---

## 10 提交计划

**两个提交**（按你的选择；MCP 并入第二个，若日后需要单独回滚再拆）：

1. `test(lab): 重写 2 GiB 回收实验并修复临时库清理缺陷`
   - `IncrementalVacuumLabSmoke.cs`（已完成的改造 + 清理修复）
   - 不涉及生产行为，可独立回滚

2. `feat(vault): 新库启用 INCREMENTAL，压缩改造为原地回收并开放 MCP 工具`
   - M1–M4、M6（HTTP 与界面）
   - M7–M9（MCP 四个库级工具）
   - 本方案文档落地为 `docs/INCREMENTAL_VACUUM_ROLLOUT_PLAN_20261106.md`

**洁净核对**：提交前 `git status --porcelain` 只应出现上述受控文件；只用 `git add <明确路径>`；构建产物已在 `.gitignore` 内（`**/bin/`、`**/obj/`）。

---

## 11 已确认事项（2026-11-06 21:56）

| # | 事项 | 结论 |
| --- | --- | --- |
| 1 | 回收触发方式 | **只手动**，不做自动或定期 |
| 2 | 取消能力 | **加**：界面按钮 + `POST /api/vault/compact/cancel` + MCP 的 `cancel_vault_reclaim` |
| 3 | 完整 VACUUM | **从界面彻底移除**；后端 `full:true` 保留为应急通道，不向用户暴露入口 |
| 4 | 提交粒度 | **两个提交**：实验 / 生产接入（MCP 并入第二个） |
| 5 | MCP 能力 | **新增 4 个库级工具**，采用「启动 + 轮询」异步形态（D8） |

> 第 3 条若你要的是「连代码路径一起删掉」，说一声即可——那意味着 `Compact()` 整体移除，只留 `Reclaim()`。我按「保留应急通道」写，是因为回收逻辑万一在真实大库上出现意外，还需要一条不用改代码就能整库重整的路。

---

## 附：与既有文档的关系

- `docs/INCREMENTAL_VACUUM_IMPLEMENTATION_PLAN_20261106.md`（外部任务书）：其阶段 B–E 的合成实验**不再执行**。理由已由本轮实测覆盖：机制可用性、复用行为、批次差异、完整性均已验证，剩余缺口是"真实大库性能"，合成样本无法回答。
- `docs/INCREMENTAL_VACUUM_STAGE_A_RESULTS_20261106.md`：保留为历史证据，不改写。
- 本方案通过后，两份文档各加一行指向本文件，避免读者按旧任务书继续执行。
