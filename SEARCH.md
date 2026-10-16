# IPSys 工作区统一搜索：网页与 MCP（2026-10-17）

> **现行接口**：正式与 `--smoke` 统一使用 `/api/v2/search/{workspace}?q=...`，旧 `/api/search` 兼容身份投影已随 N4 旧源码和路由清理。MCP 第三批新增 `search_records(workspace,query)`，直接调用相同已授权 V2 HTTP 路由；源码 `080a599` 经 [Windows CI #38930903431](https://github.com/zy19970/IPSys/actions/runs/38930903431) **completed/success**，真实 Codex/WorkBuddy 与浏览器用户实机仍待验收。

在顶部「搜索当前工作区资料」输入关键词并按 Enter，网页向 `GET /api/v2/search/{workspace}?q=...` 发请求；同一工作区内的 MCP 客户端调用 `search_records` 并提供 `workspace`、`query`，返回相同 V2 类型/身份。当前资料库必须已解锁，MCP 还必须手动授权；页面或工作区切换后丢弃过期结果，服务不暴露外部端口。

检索涵盖项目、合同、知识产权、资质/业务档案/个人分类、综合资料的结构化字段，以及附件名称、可选 File 属性和业务目录祖先信息。结果按真实 V2 FolderId/FileId 跳转，无旧 Store ID 归一的待开发任务；[CI #38897477886](https://github.com/zy19970/IPSys/actions/runs/38897477886) 自动验收已通过，实际 Edge/Chrome 导航、刷新与空结果仍待人工验收。

**边界**：仅查询结构化字段及附件元数据，不读取 PDF、Word、图片正文，不提供 OCR/正文全文检索或自然语言问答；每组最多60条，关键词最多100字，过多时提示缩小关键词。回收站记录及已删除附件不返回；公司/个人数据不得混合，服务仍仅监听 localhost。没有认证、无效工作区、非法关键词均应拒绝。

自动测试覆盖 SQLCipher HTTP 的真实模块命中、编号/文件名、授权和工作区隔离、回收站过滤、前端 HTML 转义、跳转和旧结果失效。人工验收还需使用同关键词不同工作区记录、项目/合同/IP 编号和附件文件名，验证页面实际导航、浏览器刷新及空结果显示。