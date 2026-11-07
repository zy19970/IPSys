# IPSys 测试入口与证据约定

> 现行状态见 [docs/CURRENT_BASELINE.md](../docs/CURRENT_BASELINE.md)。本文件只讲**怎么跑**，不记录某次运行的结果——那类内容会过期，历史证据已移出仓库（见文末）。

## 四条执行入口

| 入口 | 命令 | 覆盖 |
| --- | --- | --- |
| 后端 smoke | `IPSys.Web.exe --smoke` | 业务链路 + `VaultCompactSmoke`（回收/完整 VACUUM 双路径）+ `NativeMcpSmoke` + `IncrementalVacuumLabSmoke.Run(4)` |
| 隔离空间实验 | `IPSys.Web.exe --vacuum-lab` | NONE vs INCREMENTAL，独立随机临时库，`IPSYS_VACUUM_LAB_MIB` 控制规模 |
| UI 源码冒烟 | `node src/IPSys.Web/tests/<name>.cjs` | 读真实前端源码做静态/行为断言，多数需在**仓库根目录**运行 |
| Edge/HTTP 复测 | `tests/retest-v2-2026-10-22/scripts/` | 由 CI 调用，需先跑 `fixture.cjs` 生成 `evidence/fixture.json` |

`tests/tools/Verify-ExplorerExports.ps1` 是导出文件核验工具，同样由 CI 调用。

## 这个目录里还剩什么

| 路径 | 保留原因 |
| --- | --- |
| `retest-v2-2026-10-22/scripts/` | `web-windows.yml` 逐条调用，删了整个复测流程断 |
| `retest-v2-2026-10-22/evidence/fixture.json` | CI 的输入夹具 |
| `tools/Verify-ExplorerExports.ps1` | CI 调用的核验工具 |

自动化测试的源码仍在 `src/IPSys.Web/tests/`（34 个 `.cjs`，全部被工作流调用）和 `src/IPSys.Web/*Smoke.cs`。它们属于构建验证，不为了目录整齐而挪动——挪动会改掉相对路径逻辑。

## 写新测试的约定

1. 用**独立可丢弃**的库和随机临时目录；不在任何正式资料库上做破坏性测试。
2. 记录来源 SHA、环境、方法、完整结果与终态；失败就记失败，不改断言让它变绿。
3. 不提交大型数据库、真实原件、成堆截图；原始 JSON/日志放仓库外。
4. 断言要能失败：`afterFree < beforeFree` 这种写法会在批次截断时误判通过，应断言 `freelist == 0` 或显式记录 `truncated`。

## 历史证据在哪

四轮 Agent 验证、黑盒报告、一次性任务书与旧复测截图已于 2026-11-07 移出仓库，Git 历史完整保留：

```bash
git log --oneline -- tests/agent-validation        # 找到最后存在的提交
git show <sha>:<路径> > /tmp/x.md                  # 取出当时内容
```

移出清单与对应提交记录在仓库外：`_ops/tmp/removed-paths-20261107.txt`。
