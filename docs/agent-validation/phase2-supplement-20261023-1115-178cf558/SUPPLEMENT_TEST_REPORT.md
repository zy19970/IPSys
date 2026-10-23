# IPSys Explorer 第二阶段补测报告

> RUN `20261023-1115`　基线 SHA8 `178cf558`　HEAD `178cf558e4a878aadf4734b8b3725fb029c4b692`　分支 `work/onedrive-file-manager`
> 全部用例在隔离 QA 库 `qa/vault-sup.db` 上执行；正式资料库未被打开、未读取口令、未写入、未压缩。

## 一、总体结论

**整体判定：未通过 / 待修复。**

16 项补测中 **PASS 9**、**BLOCKED 3**、**REQUIREMENT_GAP 1**、**CONFIRMED_BUG 3**。
存在未关闭的 **P0 产品缺陷 D-01**（运行期 401 不把用户引向重新连接），按方案要求整体不得记为验收通过。

| 用例 | 优先级 | 状态 | 一句话结论 |
|---|---|---|---|
| SUP-01 | P0 | PASS | CI run 39818858991 成功，head_sha 与产品源码最后改动一致，21 步全 success |
| SUP-02 | P0 | PASS | 真实启动器窗口存在，OS 级点击可打开页面；第二实例被单实例守卫拦截 |
| SUP-03 | P0 | PASS | 两个独立 MCP 进程并发正常，受理≠成功、查重与 409 语义清晰，库内无重复提交 |
| SUP-04 | P0 | BLOCKED | 2.2 GiB 真实上传 53 秒完成、SHA 一致、内存峰值 200 MiB；UI 流式下载被 OS 另存为阻塞 |
| SUP-05 | P1 | BLOCKED | ZIP64 阈值与触发公式已核实，真实 >4 GiB 导出未落盘 |
| SUP-06 | P1 | REQUIREMENT_GAP | 只有全量导出；后端已支持 filtered+ids，前端无入口；三档未冻结为需求 |
| SUP-07 | P0 | BLOCKED | 原生授权弹窗确实出现，但 OS 另存为无法在无人值守环境提交 |
| SUP-08 | P0 | PASS | 三级目录、改名、混排上下移、移动、系统目录保护、非空删除拦截全部真实 UI 通过（12/12） |
| SUP-09 | P0 | PASS | v1/v2 上传、共享换 LinkId、移动换 LinkId、重复共享拒绝、删链后历史 SHA 不变（16/16） |
| SUP-10 | P0 | PASS | 项目整体跨区复制物理隔离、合同同区移动/跨区复制/跨区转移两级目标闭环（26/26） |
| SUP-11 | P1 | PASS | 知产复制、综合资料与档案转移、资质明确拒绝、取消无写入（17/17） |
| SUP-12 | P1 | CONFIRMED_BUG | 首页与列表空白处外部文件拖放静默丢弃，D-02 仍存在 |
| SUP-13 | P0 | CONFIRMED_BUG | 运行期 401 清 token 但不弹锁屏、不给重连入口，D-01 仍存在（P0） |
| SUP-14 | P1 | CONFIRMED_BUG | 关页/断网留悬挂票据、UI 无取消入口、压缩被拒且无恢复指引，D-05 仍存在 |
| SUP-15 | P1 | PASS | 三种构建场景分别成立：Node 可用则刷新产物；无 Node 只告警并嵌入旧 dist；无 dist 阻断 |
| SUP-16 | P0 | PASS | 132 个 ID 与 132 个 cases 完全对齐，旧 results.json 标为中间快照，生成 final-index.json |

## 二、必须单独说明的四件事

### 1. D-01 是 P0，整体结论因此固定为「未通过/待修复」
注入一次 401 后，前端内存 token 被清空、`locked=true`，但**锁屏不出现、没有任何重连提示**；随后刷新 5 个接口全 401，只给原始错误；连「关闭资料库」也 401。用户被卡在既非登录也非注销的状态。对照路径（有有效 token 时关闭资料库→输密码重开）本身是好的。详见 `DEFECT_REPRO.md`。

### 2. 大文件不是「用资源不足当借口」
2.2 GiB 真实随机文件（2,362,232,012 字节）在 53 秒内完成上传，进度从 2.9% 到 100%（约 46 MiB/s，面板如实标注「已发送 100% 不代表已入库」），入库 `fileId=54 / version=1 / linkId=58`，SHA 与源一致；**宿主进程工作集峰值 200 MiB**，说明前端与服务端都是流式处理；用同一服务的版本下载端点流式落盘后重算 SHA，与源**完全相同**（`7A8F2FD3…`）。未取得的是「UI 点下载 → OS 另存为 → 落盘」这一段，因为 ≥32 MiB 走 `showSaveFilePicker`。

### 3. 审计口径：受理 ≠ 成功
SUP-03 里 `start_upload_task` 对 33 MiB 返回 `accepted:true`，但 `get_operation_result` 显示 `businessOk=false`——因为库内已有同 SHA 原件被查重拦下；第二个上传同样先受理、执行时被 409「已有待确认文件」拒绝。这正是产品自己的提示所说的「state=done 仅表示请求已完成并存档」。任何把 `accepted` 当成功的判据都是错的。

### 4. 测试工具的两处边界（不作为产品结论）
- CDP `Input.dispatchDragEvent` 在 `draggable` 的行元素上只派发 `dragEnter/dragOver`、不派发 `drop`，所以「拖到记录行」这个落点未取得行为证据；空白落点不受影响。
- OS 级「另存为」对话框与 Chromium 自绘授权气泡无法在无人值守环境稳定提交，影响 SUP-07 / SUP-05 / SUP-04 的 UI 下载段。

## 三、按优先级分类的结果

| 分类 | 用例 |
|---|---|
| 已关闭的原缺口 | SUP-01、SUP-02、SUP-03、SUP-08、SUP-09、SUP-10、SUP-11、SUP-15、SUP-16 |
| 仍存在的产品缺陷 | SUP-12、SUP-13、SUP-14 |
| 环境阻塞（需真实桌面会话复测） | SUP-04、SUP-05、SUP-07 |
| 需求未冻结 | SUP-06 |

## 四、给产品的修复优先级

1. **D-01（P0）**：`store.js` 的 `api()` 401 分支统一调用 `showLogin()`；`/api/lock` 在 token 失效时应给出可点的重连入口。
2. **D-02（P1）**：把「非法落点提示」与「阻止默认行为」合并到同一处，别再用 `e.defaultPrevented` 做门禁。
3. **D-05（P1）**：给待确认票据一个可见入口（后端 `DELETE /api/v2/files/{ws}/prepared/{ticket}` 已有），压缩被拒文案直接指向它。
4. **I-06（需求）**：三档导出（仅选中/筛选/全部）需要产品先冻结范围；后端 `filtered+ids` 已就绪。

## 五、资源边界与清理

- 磁盘：E 盘执行前 65 GB 可用；2.2 GiB 源文件与下载副本在定稿后已删除。
- 数据库：每项收尾都用只读 SQLCipher（`dbcheck`）核对 `integrity` 与 `file_state='writing'`，最终 `integrity=ok`、`writing=0`。
- 正式资料库全程未打开、未读取口令、未写入、未压缩。

## 六、交付物清单

| 文件 | 内容 |
|---|---|
| `SUPPLEMENT_TEST_REPORT.md` | 本报告 |
| `SUPPLEMENT_RESULTS.csv` | 固定 16 行，逐项状态与证据路径 |
| `DEFECT_REPRO.md` | D-01 / D-02 / D-05 复现步骤、根因、修复建议 |
| `EVIDENCE_INDEX.md` | 16 项 UI/API/数据库三类证据 + 原始日志与截图清单 |
| `ORIGINAL_132_RECONCILIATION.md` | 原 132 项与补测的对账、纠偏附录、缺口清单 |
| `final-index.json` | 132 个 ID 的最终索引（原状态 + 补测关联） |
