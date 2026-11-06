# IPSys SQLCipher 增量回收：阶段 A 小样本实测记录

> 实验日期：2026-11-06（UTC+8）  
> 源码：[`c4decd9698`](https://github.com/zy19970/IPSys/commit/c4decd9698772f162ca8482c6b57078d96e4607e)  
> 运行：[Windows CI #42181743548](https://github.com/zy19970/IPSys/actions/runs/42181743548)（Debug `--smoke` 中实验与 JSON 工件生成成功，整套 CI 状态另以 Actions 为准）  
> 原始证据：Actions Artifact `IPSys-Vacuum-Small-Lab-42181743548`，仅含 JSON 指标，不含 DB、附件或测试口令。  
> 实施范围：[专项方案](./INCREMENTAL_VACUUM_IMPLEMENTATION_PLAN_20261106.md) 阶段 A；不是最终用户库的模式变更验收。

## 实验设置

1. Windows GitHub 托管 Runner，目标项目现行 `Microsoft.Data.Sqlite.Core 8.0.10` + `SQLitePCLRaw.bundle_e_sqlcipher 2.1.11`，均使用 `Vault.Connect` 强制加密和同一 schema4，`journal_mode=DELETE`、`synchronous=FULL`。
2. 两个随机命名、相互独立的 SQLCipher 临时数据库，分别在**创建业务表之前**设置 `auto_vacuum=NONE(0)` 和 `auto_vacuum=INCREMENTAL(2)`；建表后及关闭再打开均检查模式实际生效。
3. 两组使用相同确定性伪随机内容：保留独立原件、上传待永久清理原件、追加第二版本、在两项目间共享同 FileId；先清理一个 LinkId 确认版本保护，再清理最后 LinkId 后测量空闲页。
4. 对两组执行相同 `PRAGMA incremental_vacuum(256)`，最多 512 批，记录回收前后实际磁盘文件大小、page_count、freelist_count、耗时；同时逐字节与 SHA-256 验证保留原件，并验证完整性、外键、加密重新打开和错误密码拒绝。

## 实测数据

| 指标 | NONE 对照 | INCREMENTAL |
| --- | ---: | ---: |
| `auto_vacuum` 运行模式 | 0 | 2 |
| 永久删除后文件长度（B） | 7,618,560 | 7,630,848 |
| 执行回收后文件长度（B） | 7,618,560 | 1,191,936 |
| 实际回收磁盘空间（B） | 0 | **6,438,912** |
| 回收前 `page_count` | 1,860 | 1,863 |
| 回收后 `page_count` | 1,860 | 291 |
| 回收前 `freelist_count` | 1,570 | 1,570 |
| 回收后 `freelist_count` | 1,570 | 0 |
| `incremental_vacuum(256)` 调用次数 | 1（无效果） | 7 |
| 测试上传阶段计时（ms） | 271 | 311 |
| 回收阶段计时（ms） | 0 | 150 |

INCREMENTAL 模式中回收了 **6.14 MiB** 左右的实际文件大小，NONE 模式在执行同样命令后文件长度不变。由于增量模式需要 pointer-map 页，两个初始文件大小本身略有差异，应**比较同一库回收前后**，不能将两库初始体积差直接当作空间浪费或优化幅度。

### 安全与正确性检查

实验返回 `status=PASS`。已验证共享 LinkId 的残留引用能保护原件和第二版本、最后关联清理后不可再查到被删除的文件版本、另一独立 FileId 的字节内容与 SHA-256 保持一致、`PRAGMA integrity_check` 为 `ok`、`PRAGMA foreign_key_check` 没有违规、关闭后加密重开模式与内容不变，错误密码不能访问加密库。

## 结论及仍未覆盖的风险

此次实测验证 **当前项目 SQLCipher 构建中 INCREMENTAL 机制可用且能够真实缩减文件大小**；这是阶段 A 的小样本基础证据，不是数百 GB 生产级性能或断电安全认证。

数据样本为合成原件，待验证项包括 64/128 MiB 多轮、不同 BLOB/碎片模式、跨工作区原件物理隔离、重复版本/共享引用的大样本，以及真实进程异常终止、独立备份恢复和低剩余磁盘空间模拟。271/311ms 的单次写入计时差异不具统计意义，不能用于宣称稳定的性能影响比例。

**实施决策**：暂不改变 `Vault.Connect/CreateSchema` 新库默认 `auto_vacuum`，不转换任何已有数据库，不替换现有完整 VACUUM。进入专项方案阶段 B/C 的测试后，再评估正式接入的批次、任务锁与 GUI 规则。
