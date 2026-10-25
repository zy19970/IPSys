# IPSys Agent 工作规范第三阶段实机验收任务书

状态：**待本地 Agent 执行**，此文件不是通过报告。执行前遵守 AIGT-templates/AGENTS.md、AI_RULES/GIT_OPERATIONS.md，并阅读《IPSys 本地 Agent 分层提示词服务实施方案》、第二阶段实测任务书及 IPSys main 最新 SHA。

## 一、测试边界

1. 只使用全新、独立、可删除的 SQLCipher 测试资料库和虚拟资料。准备两个测试库，用于切换资料库验证；禁止在真实工作资料库中修改、删除或批量上传。准备一个独立 Windows 测试账户（如可用），不得泄漏真实账户隐私。
2. 测试前导出当前账户 Agent 覆盖配置备份；正式用户配置位于当前 Windows 用户的应用目录 %LOCALAPPDATA%/IPSys/agent-guidance.json。不要在本机测试时覆盖真实账号的自定义规范。建议使用测试 Windows 用户与测试环境运行。
3. 记录 OS、Agent/Codex 版本、EXE SHA、浏览器版本、测试库 SHA/路径（脱敏）、MCP 开关状态、运行时间及 Windows CI 运行链接。未经验证的项标 BLOCKED/NOT_RUN，不可虚报 PASS。

## 二、功能验收

### A11：用户覆盖、有效版本与迁移

1. 首次打开设置 → Agent 工作规范，index 应只列三篇专项目录且不可编辑；search/upload/metadata 编辑器应出现对应原始内置正文、来源为“内置默认”。
2. 修改 search 的少量业务性内容并保存，界面显示“用户覆盖”，有效内容和版本 SHA 变化；只刷新列表和切换公司/个人工作区应保留新内容，另两篇保持内置默认。
3. 立即调用 get_agent_guidance(topic=search)、prompts/get(name=search)，内容、来源、版本应与 UI 完全一致；原来的短 initialize.instructions 不应突然带入全文。验证两个独立 MCP 客户端或独立会话主动重新获取能读新版本，旧会话缓存不自动重广播。
4. 编辑 upload 后预览当前生效内容，末尾必须保留内嵌的“文件内容读取共用规范”。确认不能在 UI 中修改 index 根规则，也不能通过 import 覆盖它。
5. 同时打开两个浏览器窗口，分别读取相同 revision；先在窗口 A 保存，再从旧窗口 B 提交，应返回 HTTP 409 且 A 的内容不被覆盖。B 重新读取后才可另行保存。
6. 选择单篇“恢复内置默认”，仅该篇恢复 builtin 和默认正文/版本，其它专项用户覆盖不改变。
7. 点击“导出配置”，检查生成的 JSON schemaVersion=1、overrides 只包含自定义专项文本、不含密码或数据库密钥。再导入当前配置，确认全部覆盖按原样生效；导入 overrides={} 应整体恢复默认。非法 JSON、未知 topic、过大正文/配置、过期 revision 必须拒绝，不覆盖既有配置。

### A12：认证、跨资料库与用户隔离

1. 关闭浏览器会话或关闭数据库之后，所有 /api/agent-guidance 的查看、保存、恢复、导入导出均应返回 401。验证浏览器 token 不进入导出的配置。
2. 未开启本机 MCP 授权时，已登录浏览器可管理本机规范，但外部 get_agent_guidance/prompts/get 无权读取正文；开启 MCP 后可读取，手动撤销或关闭库后不能继续获取。
3. 同一 Windows 用户先打开测试库 A 设置覆盖，再关闭打开库 B 和切换 company/personal，应保留同一组用户级规范，同时两个数据库的文件数、SHA、版本均无变化。
4. 如果具备第二 Windows 测试账户，在该账户运行 IPSys 应出现该账户独立默认配置。测试不同账户时遵守 Windows 用户/命名管道访问隔离，不拷贝任何真实密钥。
5. 对设置导入/编辑后的业务写保护做回归，不得因定制提示词允许越权、跨区写入或绕过版本/重复文件确认。

### A13：Agent 客户端差异与刷新

对主用 Codex 和实际接入的其它 Agent 分别检查 initialize.instructions、tools/list、标准 Prompts 菜单和 get_agent_guidance。记录哪些客户端支持用户手动选择 Prompt、自动任务按需选择、目录选择以及主动刷新；不支持原生 Prompt 的客户端应能通过只读工具读取。测试“只读取规则，不执行上传/修改”确实无业务副作用。

### A14：Windows 构建、UI 与数据回归

1. 从 GitHub Actions 查看与**最终相同 SHA** 的 Windows 构建、Debug/Release、MCP stdio、SQLCipher/HTTP、Explorer Node/浏览器全部结果；若缺失或失败，应先修复并重验。
2. 实测设置页面在常用分辨率下可滚动，按钮可见，长规则可编辑、预览区域不会让窗口溢出；退出设置或会话后不得显示其它账号的缓存内容。验证浏览器刷新、崩溃重启后覆盖仍持久。
3. 在隔离库中通过 list_files_page 大批量缺项筛选验证分页无漏重、NULL 与 Unicode 纯空白语义正确、无每文件一次详情请求；记录数据量、各页时间与总时长。不得新建持久化缺项索引。
4. 回归原有 64 个 MCP 工具、搜索、文件上传/元数据更新、FileId/LinkId/Version、幂等/uncertain 行为。第二阶段 PDF/Word/Excel 默认智能入库及历史文件按需补录仍按第二阶段任务书另行实测，不得拿本次 UI 配置测试代替。

## 三、提交证据和停止条件

在 tests/agent-validation/ 下新增第三阶段真实报告目录，保存报告、PASS/FAIL/BLOCKED/NOT_RUN 明细、脱敏操作日志、同 SHA CI 截图或链接、不同 Windows 用户测试说明。敏感配置内容仅保存必要的虚构样本，勿上传本地账号配置全文。

发现权限失效、覆盖正式配置、真实数据误操作、共享/版本数据变化、历史错误或 SQLCipher 完整性异常时，立即停止相关写操作并保存可复现证据；不得不经过验证直接宣布第三阶段最终通过。
