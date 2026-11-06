# IPSys SQLCipher 增量空间回收专项实施方案

> **后续状态（2026-11-06 晚）**：本方案已被 [`INCREMENTAL_VACUUM_ROLLOUT_PLAN_20261106.md`](./INCREMENTAL_VACUUM_ROLLOUT_PLAN_20261106.md) 取代。阶段 B–E 的合成实验不再执行：2 GiB 实测已覆盖机制可用性、freelist 复用、批次差异与完整性，剩余缺口是真实大库性能，合成样本无法回答。请勿按本文继续执行。

> 日期：2026-11-06（UTC+8）  
> 当前状态：**阶段一：方案与隔离实验准备**；尚未改变正式数据库默认模式、正式压缩入口与现有库数据。  
> 范围：`zy19970/IPSys`，现行 SQLCipher schema 4，Windows x64 单 EXE。

## 一、目标与非目标

### 目标

1. 保留 SQLCipher 整库加密、单一 DB、个人/企业工作区隔离、FileId/LinkId/FileObject/FileVersion 与多层文件夹规则。
2. 在“真正物理永久删除、原件无任何文件版本引用”后，按需将空闲数据库页面逐批归还操作系统；避免日常空间回收依赖全库 `VACUUM` 的最坏额外 `2×DB+128MiB`。
3. 建立可复现的 Windows 加密实验：对比 `auto_vacuum=NONE` 与 `INCREMENTAL`，记录 SQLCipher 参数、文件体积、page_count、freelist_count、有效文件数据 SHA-256、完整性、耗时。
4. 基于证据决定新建库是否默认启用增量、批次大小和 UI 操作规则，随后另行评估已有 NONE 库转换。

### 不改变的边界

当前阶段不修改 `Vault.Connect`、`Vault.CreateSchema`、`VaultCompactStore`、正式 Schema、现有 DB 加密密钥与压缩额外空间门槛；不在正式用户数据库执行 `PRAGMA auto_vacuum` 或 `incremental_vacuum`，不提供会意外作用到生产库的调试接口。

## 二、已有代码基线与机制

`Vault.Connect` 强制 SQLCipher（拒绝明文降级），使用 `journal_mode=DELETE`、`synchronous=FULL`。数据存储在 `file_chunks.bytes` BLOB，存在 FileObject/历史版本/关联共享引用，只有引用彻底清理后才能回收页面。`VaultCompactStore.Inspect()` 当前手动完整 VACUUM 额外空间判据为 `fileBytes*2+128MiB`，按数据库磁盘与系统 TEMP 磁盘检查；该判据不约束普通写入总容量。

SQLite 官方文档：[`auto_vacuum` / `incremental_vacuum`](https://www.sqlite.org/pragma.html)、[VACUUM](https://www.sqlite.org/lang_vacuum.html)。增量模式在新建空库创建业务表**之前**指定，之后读取 `PRAGMA auto_vacuum` 必须返回 `2`。本模式不自动截断：必须显式执行 `PRAGMA incremental_vacuum(N)`。它只能回收完整可释放页，不能把数据库完全整理成全库 VACUUM 的效果；要计量 **DB 文件真实缩减值**，而非仅统计可回收空间。

已有 NONE 库不能简单设置 `auto_vacuum=2` 就迁移；须使用经过验证的完整重建流程并明确备份。大数据库转换风险和临时空间是**独立决策**。

## 三、分阶段推进与验收门槛

| 阶段 | 内容 | 证据与准入条件 |
| --- | --- | --- |
| A：隔离实验准备（本轮） | 新增仅作用于系统临时目录的加密试验类；创建 NONE/INCREMENTAL 两个独立库，使用真实 `Vault.Connect`、Schema、`NativeFileStore`、`RecycleStore` 及共享关联逻辑；支持命令行 `--vacuum-lab` 及小样本内置 smoke | 完全不碰真实 DB；原有 Windows CI 与新测试通过；生成对比指标；断言加密重开/错误密码、hash/完整性、共享引用保留和垃圾回收正确 |
| B：扩展实验 | 64/128 MiB 多轮及分块 `incremental_vacuum(256)`；测试反复插入、追加版本、复制/共享、跨工作区独立原件、部分删除与彻底删除，比较 NONE 与 INCREMENTAL 写入性能和占用 | 真实数据哈希/版本/引用/外键校验均通过；明确每轮文件大小、free pages、耗时、分块次数；零误删 |
| C：故障与长期验证 | 独立可丢弃测试库运行中终止进程、强制退出、重开、错误口令、完整性检查；对不同空闲比例、SSD/机械磁盘及大库做性能测试 | 没有永久性数据丢失/不可恢复损坏；不可模拟真正断电时不得声称已完成断电验证；写入性能回退须记录后决定是否接受 |
| D：正式新库接入（独立后续提交） | 仅在新建空库、建表前 `PRAGMA auto_vacuum=INCREMENTAL` 并回读，保留既有 SQLCipher 与事务/任务锁；新增手动“回收空闲空间”小批次任务、无虚假百分比的进度/取消边界和差错处理；保留全库 VACUUM 选项 | 新库模式/删除后回收/共享文件保护/回滚正确，全部自动回归及人工验收通过 |
| E：已有库兼容评估 | 判断已投产用户库的切换价值，制定独立备份、空间预检、重建与双重完整性校验；不接受无备份自动转换 | 需提供可回退的迁移与恢复验证报告，得到明确授权后实施 |

### A 阶段的最小可重复测试

1. 每种模式创建全新、随机命名的 SQLCipher 测试库；所有路径限定为 `Path.GetTempPath()/ipsys-incremental-lab-<随机ID>/`，使用专用随机测试口令和 `try/finally` 清理。
2. 以实际文件上传接口写入“保留原件”“待删除原件”和其第二版本，分别创建两个项目文件夹。把同一 FileId 共享到第二文件夹；先只清除第一个关联，核验所有版本仍可读取，随后彻底清理最后关联及对应 FileObject/Chunks。
3. 在两种库中分别记录物理清理后、增量操作后的数据库文件长度、`PRAGMA page_count`、`PRAGMA freelist_count`。两组都调用相同增量语句（NONE 预期不缩减，INCREMENTAL 应释放页），不能以单次回收全部自由页为通过前提。
4. 检查仍然保留的文件字节与 SHA-256，`PRAGMA integrity_check='ok'`、`PRAGMA foreign_key_check` 无结果，关库重开后再次核对 `auto_vacuum` 模式和内容；SQLCipher 错口令不能打开。
5. 小样本作为现有 `--smoke` 的固定回归；可通过 `--vacuum-lab` 与 `IPSYS_VACUUM_LAB_MIB` 在独立 Windows 执行更大样本，输出 JSON 证据，不需要外部服务或真实用户文件。

## 四、衡量指标与判定原则

| 指标 | 计算方式 | 判断 |
| --- | --- | --- |
| 真实磁盘回收量 | `beforeFileBytes - afterFileBytes` | 必须为正值且以真实磁盘字节为准 |
| 回收比例 | `reclaimed / beforeFileBytes` | 与待删除 BLOB 容量和页面 freelist 一起解释，不预设固定百分比 |
| 保留数据正确性 | 每个活跃 FileId/版本的原始字节及 SHA-256、完整性和外键 | **100% 一致，零容忍** |
| 共享/版本正确性 | 最后一个 LinkId 彻底永久清理之前，历史版本和内容对象存续 | **100% 满足** |
| 增量回收开销 | 每批用时、总耗时、写入/读取耗时变化 | 记录后再确定生产批次大小 |
| 安全与恢复 | 中断/重开、错误密码及独立备份恢复 | 未实测不得宣称已通过 |

运行时尽量使用与现行生产一致的 SQLCipher nuget、加密/日志和原有业务方法，禁止用纯 sqlite3 或 mock 替代加密回归。特别注意不要将原来 NONE 模式的 DB 用测试代码偷偷改成 INCREMENTAL。

## 五、风险控制与推进方式

1. 阶段 A/B 仅产生临时数据库，不访问用户数据库路径，不把原件或密钥写入 Git。运行报告只包含非敏感统计。
2. 先验证现有加密对象的回收语义，再验证页面截断；不能凭 `freelist_count` 下降判定文件大小一定缩小。
3. 正式功能不能在删除单个文件的业务事务内自动启动长时间增量回收。后续使用独立文件任务锁、SQLCipher Gate、可观察进度和取消策略，避免界面卡死。
4. 开始任何生产迁移前，必须事先有可验证备份及完整的失败回退方式，确认实际磁盘空间和数据库版本条件。
5. 本阶段只实施实验与计划；A 的成功是“验证机制在独立测试库工作”，**不等于已证明 500 GB 数据库性能或断电恢复已经满足**。

## 阶段 A 结果记录

第一组 4 MiB 级合成数据的 NONE/INCREMENTAL Windows SQLCipher 对照已经形成 [阶段 A 实测报告](./INCREMENTAL_VACUUM_STAGE_A_RESULTS_20261106.md)，同时原始 JSON 保存在对应 GitHub Actions 工件。该结果说明当前构建中的增量语句可真实释放页，不代表阶段 B/C 的大库与故障恢复已经验证。

## 六、执行与输出

优先将轻量验证接入现有 `Windows build and smoke` 的 Debug smoke，生成明确的 NONE/INCREMENTAL JSON 指标。后续大样本只在显式 opt-in 下执行，不扩大普通 CI 耗时。完成后根据实际跑出的数据单独补充结果与剩余风险，不直接宣布启用新库默认模式。
