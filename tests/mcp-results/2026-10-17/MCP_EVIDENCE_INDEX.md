# MCP 证据索引（2026-10-17 15:02–15:22）

> 所有证据位于 `C:\IPSys-MCP-Test\`。时间为本机时间（GMT+8）。
> `MCP_ACTION_LOG.jsonl` 为 JSONL：`ts / seq / client / test / event / method / tool / params / response / ms`，共 7,384 行（含本日 09:54 起全部轮次）。
> 日志不含资料库主密码、网页会话 Token 或密钥；`request_id` 为随机生成；文件路径为本地测试路径。

## 1. 环境与版本证据

| 证据 | 文件 / 命令 | 说明 |
| --- | --- | --- |
| 仓库 HEAD | `git rev-parse HEAD` | `d3bc77ff2b18b10f67e822b758411eb4fdf44270` |
| 基线包含关系 | `git merge-base --is-ancestor 24822d7 HEAD` | 返回 0（基线为祖先） |
| 工作区改动 | `git status --short` | 仅 `src/IPSys.Web/.vs/` 未跟踪 |
| EXE 哈希 | `sha256sum` | `7f6c682c…f6b3`，151,552 B |
| 运行版本一致性 | `sha256(bin/Debug/IPSys.Web.dll)` vs `build-retest/IPSys.Web.dll` | 均为 `7f2fe700…a6b2f` |
| 工具清单 | `logs/tools_list_final.json` | 70 个工具及完整 inputSchema |
| 进程与会话 | `Get-Process IPSys.Web` | 18764（15:01:47）→ 29872（15:18:25），SessionId=2 |
| 测试库 | `C:\Users\Joey\Documents\IPSys-web-test.db` | 注入前 1,050,243,072 B；当前 1,180,237,824 B |

## 2. 用例 → 证据映射

### 2.1 ISS 缺陷门禁

| 编号 | 结果文件 | 脚本 / 关键 request_id |
| --- | --- | --- |
| 工具发现（70） | `logs/results_final_probe.json`、`logs/tools_list_final.json` | `t10_final.py probe` |
| ISS-001 | `logs/results_lists.json`、`logs/results_final_all.json` | `t02_lists.py`、`t10_final.py iss001` |
| ISS-002 | `logs/results_final_iss002.json` | `t10_final.py iss002`；`FINAL-*‑s2a…s2f` |
| ISS-003 | `logs/results_final_all.json` | `t10_final.py iss003` |
| ISS-004 | 同上 | `t10_final.py iss004`；复验 `ISS4-share-0001` / `ISS4-reuse-0001` |
| ISS-005 | 同上 | `t10_final.py iss005` |
| ISS-006 | 同上 | `t10_final.py iss006` |
| ISS-007 | 同上 | `t10_final.py iss007` |
| ISS-008 | 同上 | `t10_final.py iss008` |
| ISS-009 | 同上 | `t10_final.py iss009` |
| ISS-010 | 同上 | `t10_final.py iss010` |
| ISS-011 | 同上 | `t10_final.py iss011` |
| ISS-012 | 同上 | `t10_final.py iss012` |
| ISS-013 | 同上 | `t10_final.py iss013` |
| ISS-014 | 同上 | `t10_final.py iss014` |
| ISS-015 | `logs/results_inject.json`、`results_after_restart.json`、`results_t09_restart.json` | `inject.py`、`check_after_restart.py`、`t09_restart.py` |
| ISS-016 | `logs/results_final_all.json` | `t10_final.py iss016`；`DIAG-rst-0001`、`DIAG-caf-0001` |
| ISS-017 | `logs/MCP_ACTION_LOG.jsonl` | 检索 `DUP-name-0001` / `DUP-name-0002` |
| ISS-018 | `logs/results_final_all.json`、`logs/MCP_ACTION_LOG.jsonl` | 检索 `issued` 失败的 `upload_files` |

### 2.2 37 项原用例

| 用例 | 结果文件 | 脚本 |
| --- | --- | --- |
| MCP-004/005/006 + 扩展 | `logs/results_protocol.json` | `t01_protocol.py` |
| MCP-011~014 + 008/009/010 | `logs/results_concurrency.json` | `t03_concurrency.py` |
| MCP-015~022、026、027 | `logs/results_async_all.json` | `t04_async.py all` |
| MCP-028~037 | `logs/results_business_all.json` | `t06_business.py all` |
| EXT-* | `logs/results_extras.json` | `t07_extras.py` |
| EXT2-* | `logs/results_more.json` | `t08_more.py` |
| 37 项汇总 | `logs/results_37_summary.json` | 由上述文件归并 |
| 上一轮基线 | `reports/prev-20261017-1020/` | 旧报告与旧日志 |

## 3. 关键逐字证据

### 3.1 ISS-001 已修复

```
list_projects        -> [{"id":8,"workspace":"company","name":"【MCP黑盒测试】勿动-已改名","projectType":"科研…"}]
list_archive_folders -> [{"folder":{"ref":{"workspace":"company","kind":"archive_folder","id":1,…}}}, …]
list_trash           -> [{"kind":"project","id":272,"name":"【MCPTEST】幂等成功重放",…}, …]
list_folder_entries(1) -> 14 条，含 position 0/1/2 …
list_project_files   -> []
```

### 3.2 ISS-002 六类拒绝

| 场景 | state | businessOk | httpStatus |
| --- | --- | --- | --- |
| 错 LinkId | done | false | 400 |
| 排序不完整 | done | false | 409 |
| 目录移入自身 | done | false | 409 |
| 资料移到根 | done | false | 400 |
| archive 缺 section | done | false | 400 |
| 版本 FileId 不属于 Folder | done | false | 400 |

### 3.3 ISS-003 / ISS-004

```
同 Folder share ->
IPSys 409：该文件已关联当前文件夹，无需重复共享。可选择 independent 创建独立文件，或取消本次上传。

跨区 share/reuse ->
IPSys 409：未找到匹配文件：所选 source_file_id 在当前工作区没有相同内容；
           share/reuse 仅允许同一工作区，跨工作区复制请使用 independent-content。
```

### 3.4 ISS-005

```
company/achievement -> personal/academic  : ok
company/certificate -> personal/achievement:
IPSys 400：目标资料类别不兼容：科研成果可在 company/achievement 与 personal/achievement、
           personal/academic 之间转移；certificate 不支持跨工作区转移。
```

### 3.5 ISS-006

```
非法 status ->
IPSys 400：所选状态不适用于该知识产权类型。该类型可用状态：准备中、已申请、已公开、
           实质审查中、已授权、已失效。
```

### 3.6 ISS-007

```
local     -> ok（fileId 85 / linkId 93）
unc       -> paths 仅支持本机磁盘的绝对路径，不接受 UNC 共享地址。
relative  -> 同上
```

### 3.7 ISS-008

```
unknown_param  ok=false code=TOOL_CALL_REJECTED  retryable=false
invalid_id     ok=false code=BUSINESS_REJECTED   retryable=false
not_found_404  ok=false code=BUSINESS_REJECTED   retryable=false
business_400   ok=false code=BUSINESS_REJECTED   retryable=false
conflict_409   ok=false code=BUSINESS_REJECTED   retryable=false
download_path  ok=false code=BUSINESS_REJECTED   retryable=false
```

### 3.8 ISS-011

```
取消前 : {"state":"running","completed":0,"currentFile":"big_exact64.bin",
          "bytesSent":15466496,"totalBytes":134217728,"cancelRequested":false}
取消后 : {"state":"uncertain","businessOk":null,
          "result":{"status":"interrupted","cancelReason":"user_cancel",
                    "files":[{"ok":false,"error":"用户请求取消；已发出的请求可能已经写入，请核对文件关联。",
                              "cancelReason":"user_cancel"}]}}
```

### 3.9 ISS-012

```
初始化前 tools/list -> {"error":{"code":-32002,"message":"请先发送 initialize 初始化 MCP 连接。"}}
批处理               -> {"error":{"code":-32600,"message":"不支持 JSON-RPC 批量请求，请逐条发送。"}}
通知 + 空行          -> 无输出，后续 ping 正常
```

### 3.10 ISS-014

```
软删后删目录     -> 409 系统目录或含下级资料、附件的目录不能删除。
confirm=false   -> 永久清理必须明确传入 confirm=true。
confirm=true    -> {"ok":true,"count":1}
带附件记录 purge -> 409 记录仍有关联目录或文件历史，禁止永久删除。
purge 后删目录   -> {"ok":true}
```

### 3.11 ISS-015 崩溃注入

```
注入前 : state=running requested=2 completed=0 currentFile=inject_a.bin
         bytesSent=9,830,400 / 134,217,728
TerminateProcess(PID=18764) ok=true at 2026-10-17 15:17:51
DB     : 1,050,243,072 B 未变；无 -wal/-shm；-journal 34,312 B

重启后（PID 29872, 15:18:25）
-journal/-wal/-shm : 不存在
get_task_status    : state=uncertain,
                     result={"status":"interrupted","reason":"host_restarted",
                             "interruptedAt":"2026-10-17T07:18:57.8202962+00:00",
                             "resumeSupported":false,
                             "note":"任务执行者已不存在，可能存在已提交的部分结果；请核对后再决定是否新建请求。"}
连续两次查询        : 完全一致
ghost rid          : state=not_found
项目 274 附件      : 0 条
同 rid 重入        : request_id 已被其它操作或不同上传参数使用。
新 rid 重发        : accepted=true -> done
                     inject_a 67,108,864 B sha=AE8C4A02714C851A2AAA5259DF51653CFAA3E889D9ECC4C6CC9270995249422F
                     inject_b 67,108,864 B sha=63978AC7914D1EE5F3FFB81E0FE1D573975064CF9570A2941AAE2E2FDA1C12E2
```

### 3.12 ISS-016 / ISS-017

```
restore_trash(id=999999) ->
{"code":"EXECUTION_UNCERTAIN",
 "message":"写操作返回异常，执行结果可能不确定；禁止盲目重试。…原始错误：回收站不存在匹配的 kind/id/section 记录，拒绝恢复."}
state=uncertain

create_archive_folder(parent_id=0) ->
{"code":"EXECUTION_UNCERTAIN","message":"…parent_id 必须是有效正整数"}
state=uncertain

同名目录第二次创建 ->
{"httpStatus":409,"error":"IPSys 409：资料结构约束不允许此操作：19","code":"BUSINESS_REJECTED"}
```

### 3.13 并发延迟（MCP-011）

| N | 成功 | 失败 | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| 2 | 2 | 0 | 73.5 ms | 74.8 ms | 75 ms |
| 4 | 4 | 0 | 116.5 ms | 118.8 ms | 119 ms |
| 8 | 8 | 0 | 189.5 ms | 203.3 ms | 204 ms |
| 12 | 12 | 0 | 255.0 ms | 287.4 ms | 288 ms |
| 24 | 24 | 0 | 1,840.0 ms | 1,956.1 ms | 1,959 ms |

## 4. 测试脚本清单（可复跑）

运行前置：**只启动一个 GUI 宿主**、解锁测试库、开启 MCP 授权。

| 脚本 | 用途 |
| --- | --- |
| `harness.py` | stdio MCP 客户端与 JSONL 动作日志（`IPSYS_EXE` 可覆盖被测 EXE） |
| `gen_fixtures3.py` | 按轮次重写回归夹具（规避工作区级查重门） |
| `setup_data.py` | 建立测试上下文 `logs/ctx.json` |
| `t01_protocol.py` | MCP-004/005/006 + 扩展协议 |
| `t02_lists.py` | 16 个数组工具哨兵（P0 回归入口） |
| `t03_concurrency.py` | MCP-011~014、008~010 |
| `t04_async.py [all\|basic\|idem\|cancel\|bounds\|big\|disc]` | MCP-015~022、026、027 |
| `t06_business.py [all\|…]` | MCP-028~037 |
| `t07_extras.py` | 契约与边界扩展 |
| `t08_more.py` | 关联移动、合同/IP 附件、幂等、schema |
| `t10_final.py [probe\|iss001…iss016\|all]` | **ISS-001~016 全量门禁** |
| `inject.py` | ISS-015 故障注入（会结束宿主） |
| `check_after_restart.py` / `t09_restart.py` | 重启后核对与对照实验 |

推荐顺序：

```powershell
cd C:\IPSys-MCP-Test\scripts
python gen_fixtures3.py
python setup_data.py
python t01_protocol.py
python t02_lists.py
python t03_concurrency.py
python t04_async.py all
python t06_business.py all
python t07_extras.py
python t08_more.py
python t10_final.py all
# 需要测崩溃时（会杀掉宿主，之后需人工重启解锁）
python inject.py
python check_after_restart.py
python t09_restart.py
```

## 5. 断言修正记录（测试脚本，非产品）

| 位置 | 修正前 | 修正后 | 原因 |
| --- | --- | --- | --- |
| `t01_protocol.py` MCP-004.3 | `len(tools) == 69` | `== 70` | 新规范 70 工具 |
| `t01_protocol.py` `bad_call` | 明文 `expect_kw in t` | 先 `json.loads` 再匹配 | 正文是 `\uXXXX` 转义，明文匹配必然失败 |
| `t02_lists.py` | 硬编码 `ctx.json` 的旧 ID | 动态解析真实 ID | 旧 ID 已删，会把 404 误判为数组缺陷 |
| `t04_async.py` MCP-020 | 明文找 "pending/不能/已" | 解析 `accepted/state/note` | 同上转义问题 |
| `t04_async.py` MCP-021 | 逐项必须 `isError` | 允许异步任务内逐文件失败（`businessOk=false`） | 新规范允许异步逐文件失败 |
| `t06_business.py` MCP-029 | `versions == [1,2]` | `sorted(...) == [1,2]` | 服务端返回倒序，集合等价 |
| `t06_business.py` MCP-031/032 | 硬编码 BLOCKED | 真实排序/层级验证 | P0 已修，可实测 |
| `t06_business.py` MCP-034 | `search` 命中数为 0 | `list_projects` ID 集合判断 | 搜索会被历史同名记录干扰 |
| `t07_extras.py` EXT-COPY | `j["id"]` | `j.get("id") or j.get("fileId")` | `copy_file` 返回 `fileId` |
| `t08_more.py` EXT2-CONTRACT-FILE | 依赖合同已有附件 | 无附件时先上传 | 避免空转 |
| `t08_more.py` EXT2-SCHEMA | 读 69 工具清单 | 读 70 工具清单 | 工具数变化 |
| `setup_data.py` | `ip_no` / `content` / `status=申请中` | 移除废弃参数，改 `已申请` | 参数已废弃；状态枚举变更 |
| 上传类脚本 | 未传 `duplicate_mode` | 传 `independent` 或每轮重写夹具 | 查重是工作区级设计行为 |

## 6. 证据文件校验（可选）

```powershell
Get-FileHash C:\IPSys-MCP-Test\reports\MCP_ACTION_LOG.jsonl -Algorithm SHA256
Get-FileHash C:\IPSys-MCP-Test\logs\tools_list_final.json -Algorithm SHA256
Get-FileHash C:\IPSys-MCP-Test\logs\results_final_all.json -Algorithm SHA256
```
