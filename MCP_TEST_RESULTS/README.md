# MCP 黑盒复测结果归档

本目录存放 IPSys MCP 本机桥接服务（`IPSys.Web.exe --mcp`）的历次黑盒复测交付物。按执行日期分目录，每轮 5 份，命名固定，便于横向比对。

## 归档索引

| 轮次 | 日期 | 被测构建 | 工具数 | 结果 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 第 6 轮 | 2026-10-17 | `d3bc77f` / EXE `7f6c682c…` | 70 | PASS 28 / FAIL 0 / BLOCKED 9 | **建议放行** |
| 第 5 轮 | 2026-10-17 | 09:36 构建 | 69 | PASS 24 / FAIL 4 / BLOCKED 9 | 否（条件性） |

> 第 5 轮为正式黑盒验收首次执行，其原始交付物保留在本地 `C:\IPSys-MCP-Test\reports\prev-20261017-1020\`，未入库。

## 2026-10-17（第 6 轮）

执行依据：仓库根目录 `MCP_AGENT_FINAL_RETEST.md`（基线 `main@24822d7`，要求工具总数 70）。

### 环境快照

| 条目 | 实测值 |
| --- | --- |
| 仓库 HEAD | `d3bc77ff2b18b10f67e822b758411eb4fdf44270` |
| EXE | `src\IPSys.Web\bin\Debug\net8.0-windows\IPSys.Web.exe`，151,552 B |
| EXE SHA-256 | `7f6c682c1ffc071d6bade28d3b4e671d37b377e083064714bc574fb7c781f6b3` |
| DLL SHA-256 | `7f2fe7004fd3b77860b3bb29741ab4cd1de5cdfe6530542022e157b86ada6b2f` |
| 运行版本一致性 | 运行进程 DLL 与构建产物 SHA-256 相同 |
| 宿主 PID | 18764（15:01:47 启动）→ 29872（15:18:25 崩溃注入后重启） |
| 系统 / 会话 | Windows 11 企业版 LTSC 10.0.26100，x64，会话 ID 2 |
| 权限 | 同一用户 elevated=1，完整性 High |
| 测试库 | `C:\Users\Joey\Documents\IPSys-web-test.db`，1.05 GB → 1.18 GB |
| 执行时间 | 2026-10-17 15:02–15:22（GMT+8） |

### 结论

上一轮的三个阻断级缺陷全部修复并有实测证据，**建议放行进入下一批开发**：

1. **ISS-001（P0，数组序列化）**：17/17 个返回裸数组的工具均返回合法 JSON 数组，`The node must be of type 'JsonObject'.` 不再出现。
2. **ISS-002（P1，确定性拒绝语义）**：参数校验 / 404 / 409 共 6 类前置拒绝均为 `state=done` + `businessOk=false`，不再误标 `uncertain` + “禁止盲目重试”。
3. **ISS-015（P1，崩溃恢复）**：宿主强杀后重启，遗留任务收敛为 `uncertain` + `reason=host_restarted` + `interruptedAt` + `resumeSupported=false`；相同 `request_id` 不二次执行，新号重发成功且 SHA 一致；无半成品落库。

ISS-001～ISS-015 门禁 **15/15 通过**。

### 未解决项（不阻断放行）

| 编号 | 级别 | 摘要 |
| --- | --- | --- |
| ISS-016 | P2 | `restore_trash` 不存在 ID、`create_archive_folder(parent_id=0)` 仍返回 `EXECUTION_UNCERTAIN` + 禁止重试 |
| ISS-017 | P2 | 同名目录重复创建返回 `IPSys 409：资料结构约束不允许此操作：19`，内部码外泄 |
| ISS-018 | P3 | `upload_files` 失败时顶层 `message`/`error` 恒为“操作未成功。”，真实原因仅在 `result.files[].error` |

### 文件说明

| 文件 | 内容 |
| --- | --- |
| `MCP_TEST_REPORT.md` | 主报告：总体结论、环境核验、旧版失败基线 vs 新版真实结果、工具发现、ISS 门禁、崩溃注入记录、37 用例、基线业务完整性、未测条件覆盖、脚本修正记录 |
| `MCP_ISSUES.md` | 未解决缺陷清单（ISS-016～018），含最小复现 JSON、逐字返回、预期、影响、建议、验收命令 |
| `MCP_ACTION_LOG.jsonl` | 全量动作日志，7,384 行 / 5.8 MB，一行一次调用（含参数脱敏、返回、isError、耗时） |
| `MCP_EVIDENCE_INDEX.md` | 证据索引：ISS→文件映射、用例→文件映射、逐字证据摘录、脚本清单、断言修正记录 |
| `MCP_RETEST_PLAN.md` | 复测计划：3 项修复后步骤、9 项 BLOCKED 人工补测、自动化门禁建议、放行条件 |

### 复现方式

测试脚本与夹具保留在本地 `C:\IPSys-MCP-Test\`（`scripts/`、`fixtures/`、`logs/`），未入库，原因是夹具含 2×64 MiB 边界文件与 128 MiB 注入文件。复跑步骤：

```bash
# 1. 构建被测版本
dotnet build -c Debug src/IPSys.Web/IPSys.Web.csproj

# 2. 启动 GUI 宿主，解锁数据库，在系统设置中开启 MCP 授权

# 3. 依次执行（脚本目录：C:\IPSys-MCP-Test\scripts）
python gen_fixtures3.py      # 重写夹具（每轮注入 salt，规避工作区级查重门）
python setup_data.py         # 建项目/合同/IP 与专用测试项目
python t01_protocol.py       # 协议门禁
python t02_lists.py          # 数组工具回归哨兵（17 项须全 OK）
python t03_concurrency.py    # 并发 2/4/8/12/24
python t04_async.py          # 异步上传任务
python t06_business.py       # 基线业务完整性
python t07_extras.py         # 扩展能力
python t08_more.py           # 补充场景
python t10_final.py          # ISS-001～016 全量门禁
```

`t09_restart.py` 为崩溃恢复专用，需在 `TerminateProcess` 强杀宿主并重启后执行。

### 注意

- MCP 返回正文是 `ensure_ascii=True` 的 JSON，中文在原文中为 `\uXXXX` 转义。断言前必须 `json.loads` 再匹配，否则中文文案类断言会全部误判。
- `create_archive_folder` 的 `parent_id` 必须是有效正整数；系统根目录 ID 用 `list_archive_folders` 取，传 `0` 会被拒。
- 本轮未修改任何 IPSys 源码；仅调整测试脚本中 13 处过时断言，明细见 `MCP_TEST_REPORT.md` 第 12 章。
