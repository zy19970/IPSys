# 未通过项复测计划

> 适用范围：本轮仍失败的 3 项（ISS-016 / ISS-017 / ISS-018）+ 9 项 BLOCKED 的人工补测。
> 前置：`dotnet build -c Debug` 出自最新 `main`；只启动一个 GUI 宿主；解锁测试库；开启 MCP 授权。

## 1. 复测顺序

按修复成本从低到高，三项互不依赖，可并行开发。

### 第 1 步：ISS-016 确定性拒绝语义（P2）

```powershell
cd C:\IPSys-MCP-Test\scripts
python t10_final.py iss016
```

**通过标准**
- `restore_trash(kind=project, id=999999)` 与 `create_archive_folder(parent_id=0)` 的响应 `code` 不再是 `EXECUTION_UNCERTAIN`，且 `message` 不含"执行结果可能不确定"。
- `get_operation_result` 对两者的 `state` 为 `done`、`businessOk` 为 `false`、`result` 保留原始错误。
- `t10_final.py iss016` 输出 `2/2`，`FAIL 项: []`。

**回归保护**：不能把真正的"在途中断"也改成 `done`。用 `t04_async.py cancel` 确认取消场景仍为 `state=uncertain`、`cancelReason=user_cancel`。

**建议实现位置**：把 `restore_trash` 的资源不存在、`create_archive_folder` 的父目录非法接入与 ISS-002 相同的"事务前拒绝"分类器。

### 第 2 步：ISS-017 同名目录文案（P2）

```powershell
# 手工两条，request_id 必须不同
python -c "..."   # 见 MCP_ISSUES.md 的最小复现
```

或用 MCP Inspector / 任何客户端依次发送：

```json
{"name":"create_archive_folder","arguments":{"workspace":"company","parent_id":1,"name":"重名测试","request_id":"RT-017-a"}}
{"name":"create_archive_folder","arguments":{"workspace":"company","parent_id":1,"name":"重名测试","request_id":"RT-017-b"}}
```

**通过标准**
- 第二次返回 `httpStatus=409`，`error` 明确为"同一目录下已存在同名目录"（或等价中文）。
- 响应中不出现 `：19`、`约束不允许此操作：<数字>` 之类内部码。
- 父目录不存在、层级非法两种情况仍有各自可区分的文案。

**回归保护**：`t07_extras.py` 全部 16 项仍 PASS（尤其 EXT-DUP、EXT-TRASH）。

### 第 3 步：ISS-018 顶层错误文案（P3）

```powershell
python t10_final.py iss003   # 单文件重复共享场景
```

**通过标准**
- 单文件批次失败时，顶层 `message` 含具体原因（如"该文件已关联当前文件夹"），不再恒为"操作未成功。"。
- 多文件批次失败时，顶层 `message` 至少含失败数量摘要。
- `result.files[].error` 逐文件明细保持不变（不得为了顶层文案丢掉明细）。
- `t10_final.py iss003/iss004` 仍 PASS。

### 第 4 步：三门禁整体回归

```powershell
python gen_fixtures3.py
python setup_data.py
python t02_lists.py          # 必须 0 失败
python t10_final.py all      # ISS-001~016 必须全 PASS
python t04_async.py all      # 取消仍为 uncertain
python t06_business.py all
python t07_extras.py
python t08_more.py
```

## 2. 9 项 BLOCKED 的人工补测

这些不是产品缺陷，但任务书要求"高风险权限场景若缺条件必须明确 BLOCKED"。若后续能提供环境，按下列方法补测。

| 用例 | 需要的条件 | 操作 | 记录要点 |
| --- | --- | --- | --- |
| MCP-001 | 可停止宿主并重新解锁 | 关闭数据库/停止宿主后调用任一工具 | 应返回"未找到运行中的 IPSys 宿主…"结构化错误 |
| MCP-002 | GUI 可切换 MCP 授权 | 设置里关→开→关 | 关闭时 `MCP 未授权或授权已撤销。`；重新开启后立即可用 |
| MCP-003 | 安装 Codex | 用 Codex 实际加载 70 工具并读/写 | 工具发现、调用、错误呈现 |
| MCP-007 | GUI 可关闭授权/数据库/退出 | 三种关闭路径各调用一次 | 均应为结构化拒绝，而非挂起 |
| MCP-008 | 非提升（Medium IL）宿主 | 普通权限启动 IPSys，普通权限客户端连接 | 能否连接、是否只读 |
| MCP-009 | 混合权限组合 | 管理员宿主 + 普通客户端；普通宿主 + 管理员客户端 | 拒绝时的错误码与路径 |
| MCP-010 | 第二 Windows 用户/RDP | 另一账号尝试连接当前解锁库 | **能连上即为安全缺陷** |
| MCP-023 | 传输中可点授权开关 | 上传 64 MiB 时关闭 MCP 授权 | 任务终态与 `cancelReason` 应为 `authorization_revoked` |
| MCP-024 | 可正常退出 GUI | 上传中正常退出/取消退出 | `cancelReason=host_stopping`，重启后状态可解释 |

> 禁止通过改管道 ACL、MIC 或关闭 UAC 来"制造通过"。

## 3. 自动化门禁建议

```text
每次提交（需真实宿主）：
  t02_lists.py          # 硬门禁：17 项必须全部 OK
  t10_final.py probe    # 硬门禁：70 工具 + schema
  t10_final.py iss001   # 硬门禁：17 次调用均为 JSON 数组

Nightly：
  t01_protocol.py
  t03_concurrency.py
  t04_async.py all
  t06_business.py all
  t07_extras.py
  t08_more.py
  t10_final.py all

手工触发（破坏性）：
  inject.py → 重启解锁 → check_after_restart.py → t09_restart.py
```

## 4. 放行条件

- ISS-016/017/018 修复并通过第 1~3 步；
- 第 4 步全部通过，`t02_lists.py` 0 失败、`t10_final.py all` 无 FAIL；
- 崩溃用例可重复通过（含一次新的强杀注入，`reason=host_restarted` 稳定）；
- 权限矩阵至少补测"管理员宿主 + 普通客户端"一项，或明确记录为已知限制。
