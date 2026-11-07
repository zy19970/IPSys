# IPSys 现行基线（唯一现状声明）

> **本文件是仓库里唯一声明“现在是什么状态”的地方。** 其他文档不再叠加日期基线，只写不随版本变化的规则；需要历史状态时用 `git log -- <路径>` 取回。
>
> 最后更新：2026-11-07。实际行为以现行源码和对应版本 EXE 为准。

## 1 产品与资料模型

IPSys 是 Windows x64 本地资料管理系统：WinForms 启动器 + 仅本机访问的 ASP.NET Core Web Explorer + 单个 SQLCipher 加密数据库 + 同用户受授权的 MCP。浏览器界面不代表云盘，关闭浏览器不会删除数据。

新建数据库固定为 SQLCipher **schema 4**（源码文件 `ResourceSchemaV2.cs` 沿用历史名称）。旧 schema 2/3 的库在打开阶段直接拒绝，**不做自动迁移**；测试或破坏性操作必须使用独立可丢弃的 schema 4 库。

身份模型：`FolderId` 记录/目录、`FileId` 逻辑附件、`LinkId` 关联、`FileVersion` 文件历史、`FileObject` 物理内容。**文件夹无版本，附件才有版本。** 同一工作区可共享 FileId 或复用物理 FileObject；跨个人/公司工作区必须物理隔离。

业务 Folder kind 只有 `project`、`ip`、`archive_folder`。项目子级与各资料模块的资料都是可嵌套普通文件夹；合同资料存放在项目下普通目录，**没有独立合同对象、表单和 Excel 台账**。

## 2 业务范围

- 公司工作区：企业资质、业务档案（7 个预置目录）、公司项目、知识产权、综合资料、党团建设。
- 个人工作区：人力资源、知识产权与著作、科研与合作项目、成果与奖励、学术与社会活动、其他资料。

固定 XLSX 模板：项目 **11 列**、知识产权 **19 列**、普通资料（含资质、业务档案、党团、综合资料）**6 列**。导出区分 `filtered`（服务端全量匹配）与 `all`；Excel 只承载业务元数据，不含附件正文与版本。

知识产权十种类型，统一编号 / 公开号 / 授权公告号三个可选编号字段。

## 3 当前功能

- **选择与操作**：单选、Ctrl 累加、Shift 连选、表头三态全选；多选同类附件/目录可一并拖动；单选状态下点行内其他位置回到单选。
- **重命名**：附件支持 F2 与右键；`update_file_metadata(name)` 改 FileId 全局名，不覆盖已有 LinkId 别名。
- **预览**：PDF 连续滚动；Markdown `.md/.markdown` 与 UTF-8 `.txt` 离线只读预览，上限 **10 MiB**，不影响上传下载。
- **个人工作区默认排序**：名称升序、数字前缀自然排序；只作用于 Explorer 视图，不重排数据库 `position`。
- **设置 → 数据库**：修改密码（8–256 字符，旧密码校验，完成后旧会话撤销）、完整性检查（异步、真实阶段、不确定进度条）、空闲空间回收、MCP 开关。
- **MCP**：解锁后默认开启，关库/改密/退出即撤销。工具数量与参数一律以连接时的 `tools/list` 为准，本文不写死。

## 4 空间策略（INCREMENTAL）

新建资料库在建表前写入 `auto_vacuum=INCREMENTAL` 并**回读断言**；读不回 2 则抛异常拒绝建库。此时库是空的，重来没有数据损失；静默失效则意味着这个库永远无法原地回收，而用户不会察觉。

回收由 `POST /api/vault/compact` 触发，默认走原地分批回收：

- 每批 256 页 `incremental_vacuum`，每批重新读取 `freelist_count`；一批下来没有进展就报错，不把“循环结束”当成“回收完成”。
- 前后各做一次 `integrity_check` 与 `writing` 状态检查。
- 取消在批次之间生效，**已回收的部分保留**，不回滚。
- 额外空间约为单批回滚日志（1 MiB），**不再要求两倍库大小**。这是该能力唯一不可替代的价值：磁盘将满时仍然能回收。
- `full:true` 保留完整 `VACUUM` 作为应急通道，设置页不提供入口。

批次大小取自实测：2 GiB 库回收 3.07 GiB，256 页/批约 15 s，4096 页/批慢 3.3 倍且波动大 3 倍。

旧库（`auto_vacuum=0`）不迁移，设置页入口置灰并说明原因。**未测范围**：真实 20–50 GB 规模的回收速率、真实断电、磁盘满、长期碎片化。2 GiB 样本全程在页缓存内，测得的速率是内存速度，不能外推到真实磁盘。

## 5 构建、发布与验收

正式前端源码在 `src/IPSys.Web/wwwroot`；构建时 `tools/bundle.cjs` 生成的 `dist/app.js` 仅用于嵌入 EXE。Web SDK 默认 Content 外拷由 `EnableDefaultContentItems=false` 关闭，保留显式 `EmbeddedResource` 与双模式单 EXE 校验。

发布产物为 `IPSys-win-x64-FrameworkDependent.exe` 与 `IPSys-win-x64-SelfContained.exe` 加 `SHA256SUMS.txt`，由手动触发的 `publish-release` 工作流产出；**手动 Publish 不重跑 smoke**。

验收必须分层：源码已实现 / 自动 CI 通过 / 本机 Agent 实际执行 / 用户人工反馈通过 / 未执行或阻塞。**不能拿 CI 绿色冒充“已在本机验证”。**

当前 CI 状态：2026-11-06 起的推送未能执行，GitHub 侧原因为账户计费锁定（job 3 秒内失败、steps 为空），不是代码或测试失败。恢复后需要重新触发，重点复核 `VaultCompactHttpSmoke` 的回收/完整 VACUUM 双路径与 `NativeMcpSmoke` 的工具断言。

## 6 文档入口

| 文档 | 职责 |
| --- | --- |
| [README](../README.md) | 产品总览、安装、发布入口 |
| [REQUIREMENTS](../REQUIREMENTS.md) | 业务规则与范围 |
| [DESIGN](../DESIGN.md) | 架构与数据一致性约束 |
| [M0_DATA_DICTIONARY](../M0_DATA_DICTIONARY.md) | 字段与 Excel 数据契约 |
| [UI_BASELINE](../UI_BASELINE.md) | 页面、选择、菜单与通用组件规则 |
| [DEVELOPMENT_PLAN](../DEVELOPMENT_PLAN.md) | 当前阶段、下一步与交付条件 |
| [MCP_CODEX](../MCP_CODEX.md) | MCP 接入、参数口径与安全规则 |
| [USER_GUIDE](../USER_GUIDE.md) | 用户操作手册 |
| [TESTING](../TESTING.md) 与 [tests/README](../tests/README.md) | 测试分层与怎么跑 |
| [前端说明](../src/IPSys.Web/wwwroot/README.md) | 前端与打包契约 |
| [Wiki 维护](./WIKI_PUBLISHING.md) 与 [Wiki 源](./wiki/Home.md) | 用户 Wiki 与自动发布 |

## 7 历史资料

历史证据（一次性任务书、阶段性方案、各轮 Agent 验证、黑盒报告、旧复测证据）已于 2026-11-07 移出仓库，需要时用 Git 历史取回：

```bash
git log --oneline -- <路径>          # 找到最后存在的提交
git show <sha>:<路径> > /tmp/x.md    # 取出当时内容
```

**不能删的路径**：`src/IPSys.Web/tests/*.cjs`（CI 逐条调用）、`tests/retest-v2-2026-10-22/scripts/` 与 `evidence/fixture.json`（CI 复测入口）、`tests/tools/Verify-ExplorerExports.ps1`、`docs/wiki/**`（发布工作流校验页间链接）、`src/IPSys.Web/AgentGuidance/*.md`（嵌入 EXE，运行时按 topic 读取）。

历史结论不再抄进各文档正文。要判断“某句话当时是否成立”，看它所在提交的日期，不要用现在的代码去读当时的结论。
