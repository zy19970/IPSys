# IPSys SQLCipher 增量空间回收：现行实现与验证边界

> 本文记录已经接入 `main` 的空间回收设计及其证据边界，不是待执行任务书。当前产品能力、最近 CI 状态与已发布 EXE 的差异，以 [CURRENT_BASELINE.md](CURRENT_BASELINE.md) 为准。

## 1. 实现状态

2026-11-06 的源码提交 [`2c3b7610d`](https://github.com/zy19970/IPSys/commit/2c3b7610d) 已将新建 SQLCipher 资料库默认模式设为 `auto_vacuum=INCREMENTAL`，并接入原地回收的 HTTP、界面与 MCP 操作。相关代码：[Vault.cs](../src/IPSys.Web/Vault.cs)、[VaultCompactEndpoints.cs](../src/IPSys.Web/VaultCompactEndpoints.cs)、[VaultCompactJob.cs](../src/IPSys.Web/VaultCompactJob.cs)、[McpLocalVault.cs](../src/IPSys.Web/McpLocalVault.cs)。

以上是**源码已实现**的状态，不等同于该提交之后 Windows 自动 CI 全部通过、用户现有旧数据库已迁移，也不等同于真实 20–50 GB 资料库已完成断电和低剩余空间测试。因 GitHub Actions 计费锁导致近期工作流无法执行的边界见 [现行基线](CURRENT_BASELINE.md)。

## 2. 适用数据库与安全边界

1. 新资料库在建表前调用 `PRAGMA auto_vacuum=2`，立即回读实际模式；如果不是 2 则拒绝继续创建，避免静默变成无法原地回收的库。资料库 schema 版本仍为 4，SQLCipher 加密和原有工作区/附件身份保持不变。
2. 新建数据库的 `journal_mode=DELETE`、`synchronous=FULL`、`foreign_keys=ON` 规则继续沿用现行连接设置。原地空间回收不改变加密策略、附件版本或共享关系。
3. 旧版 `auto_vacuum=NONE(0)` 数据库不自动迁移；设置页不开放原地回收入口，后端回收会明确失败。不能通过只修改一个 PRAGMA 参数就把已存在的数据页转换为 INCREMENTAL。
4. 整个加密库同时存储公司和个人工作区，空间统计与回收均作用于**整个数据库文件**，不是某个业务模块或工作区；普通删除与永久删除均不会自动执行回收。
5. 手工维护前建议安全备份数据库，运行期间不能强行退出或拔除外置存储设备。原地回收不是自动备份，也不是断电安全性的实机证明。

## 3. 当前回收机制

用户在设置页选择「空闲空间回收」，通过授权 `POST /api/vault/compact` 发起异步任务，默认执行 `Reclaim()`。服务端首先校验无其它排他文件任务、空间余量、`file_objects` 中无 `writing` 状态和 `PRAGMA integrity_check`，之后按 256 页一批执行 `PRAGMA incremental_vacuum(256)`。

每批完成后重新读取真实 `freelist_count` 和数据库文件长度；如果空闲页数量没有减少且还有空闲页，报告失败而不是假报完成。回收后再次检查完整性和未完成文件写入状态。进度使用已回收页数与初始空闲页数，不对未测耗时提供假百分比。

可以通过 `POST /api/vault/compact/cancel` 请求取消，取消在批次之间生效，已经成功回收的部分保留而不回滚。状态从 `GET /api/vault/compact/task` 查询，能够返回 `taskId`、`state`、`stage` 和实际页数；运行中不允许同一时间再发起第二项排他任务。后端可能先返回 202，随后任务状态报告失败；不能将接收启动请求等同于成功回收。

### 空间预检

| 路径 | 预检规则 | 用户入口 |
| --- | --- | --- |
| INCREMENTAL 原地回收 | `256 × pageSize + 64 MiB`，常见 4 KiB 页面时约 65 MiB | 设置页手动入口与 MCP |
| 完整 `VACUUM` | `数据库文件大小 × 2 + 128 MiB`，数据库磁盘和系统临时目录均需满足 | 仅保留后端 `full:true` 应急通道 |

原地回收不创建整库临时副本；仍需要单批 rollback journal 和实现余量，不能宣传为「零额外空间」。该预检是当前代码的保守门槛，不保证任何容量和 I/O 条件下都能回收成功。完整 `VACUUM` 可能重整更多碎片，但不是设置页或 MCP 的普通操作；其空间预算不能混同于增量回收。

## 4. MCP 接口

| 工具 | 用途 | 交互 |
| --- | --- | --- |
| `get_vault_storage` | 读取模式、库大小、空闲页、可回收量和预检状态 | 只读，不带 `workspace` |
| `reclaim_vault_space` | 用户明确要求时启动原地回收 | 立即返回任务身份，不能当作完成 |
| `get_vault_reclaim_status` | 轮询任务状态、阶段与页数 | 首次未运行可返回 `idle` |
| `cancel_vault_reclaim` | 请求批间取消 | `requested=false` 表示当时无可取消任务 |

四个库级工具不传 `workspace`，仍受本机已解锁资料库、MCP 授权与会话限制。此处只说明职能，**实际工具总数和参数以连接时 `tools/list` 为准**；不额外开放完整 `VACUUM` 的 MCP 工具。

## 5. 试验依据与能得出的结论

2026-11-06 的 NONE / INCREMENTAL SQLCipher 隔离实验，在约 2 GiB 规模的合成数据集上比较写入、空闲页回收、复用及完整性，并记录了不同批次大小。原始 2 GiB 统计位于仓库外当时的 `_ops/tmp/full-2g.json`、`_ops/tmp/smoke.json`、`_ops/logs/full-2g.log`，这些文件**没有随当前仓库提交，不能把路径当作可直接访问的仓库证据**。已独立保留的阶段 A 4 MiB 测试结论见 [阶段 A 实验记录](INCREMENTAL_VACUUM_STAGE_A_RESULTS_20261106.md)，相关 Windows CI Artifact 也记录在该文件内。

| 2 GiB 样本的观测 | NONE | INCREMENTAL | 解释 |
| --- | --- | --- | --- |
| 回收前库文件大小 | 2928.8 MiB | 2932.4 MiB | 在该样本中 INCREMENTAL 大约多 0.125%，不保证其它数据集相同 |
| 约 2.5 GiB 写入耗时（三次） | 37.9 / 38.7 / 37.0 s | 38.8 / 37.8 / 39.1 s | 差异在该样本测试波动内，不能据此证明长期写入零开销 |
| 回收约 3.07 GiB 空闲页 | NONE 不释放文件尾 | 13.7 / 15.6 / 15.9 s | 测得约 200 MiB/s 受页缓存影响，不能外推真实磁盘 |
| 回收后 `freelist_count` | 803,343 | 0 | 该次实验空闲整页已回收；不代表页内碎片也被整理 |

256 页/批在这一样本中较 4096 页/批快约 3.3 倍，因此当前源码采用 256 页。隔离样本还验证了保留原件的 SHA-256、`integrity_check`、外键、加密关闭重开和错误密码拒绝。以上是**特定测试条件的机制验证**，不是用户实际 20–50 GB 数据库的稳定性承诺。

## 6. 仍需实机确认的边界

1. 真实 20–50 GB 资料库上的 I/O 耗时、页缓存影响及长时间占用表现。
2. 磁盘剩余空间接近预检门槛、外接存储异常断开及真正的断电中断后的完整性和恢复。
3. 长期上传、共享、多个历史版本、永久删除后反复回收的碎片化和性能变化。
4. 新提交的最新 Windows CI 在账户计费锁解除之后需要重新执行，并分别记录代码验证、独立 Agent 操作和用户人工验收结果。

现行回归入口在 [TESTING.md](../TESTING.md) 与 [tests/README.md](../tests/README.md)：`IPSys.Web.exe --smoke`、`--vacuum-lab` 以及 `VaultCompactHttpSmoke`、`NativeMcpSmoke`。进行实测必须使用独立可丢弃的资料库，不能拿用户正式库做故障注入。

历史的分阶段实施步骤、未提交工作树快照和旧阶段任务书请通过 Git 历史查阅；本文不再要求按已经完成的 M1–M9 提交计划重复开发。
