# 术语表

| 术语 | 解释 |
| --- | --- |
| IPSys | Windows 本地资料管理系统 |
| WinForms 启动器 | 启动本机服务、打开界面及安全退出的 Windows 窗口 |
| Explorer | 浏览器中的文件管理式操作界面 |
| SQLCipher | 用于本机加密数据存储的 SQLite 扩展 |
| 资料库（DB） | 保存工作区、业务对象与文件原件的加密文件 |
| 工作区 | 同一个 DB 中的个人或公司逻辑空间 |
| 资料库结构版本 | 当前为 SQLCipher schema 3，源码旧 V2 命名不表示支持旧库迁移 |
| FolderId | 普通文件夹、项目或知识产权的稳定 FolderId，项目合同资料仅是普通目录 |
| FileId | 逻辑文件身份，附有属性与文件版本链 |
| LinkId | 某一具体业务记录对 FileId 的关联 |
| FileVersion | 单个逻辑文件的一次原件版本 |
| FileObject | 加密保存的物理内容对象，可按规则复用 |
| SHA-256 | 用来判断内容相同与校验完整性的摘要算法 |
| 软删除 | 将记录放入回收站、保留恢复能力 |
| 永久删除 | 从回收站彻底清理，并按引用关系释放物理内容 |
| ZIP64 | 用于支持大于传统 ZIP 限制的打包格式 |
| MCP | Model Context Protocol，供受授权的本机 Agent 调用工具 |
| Agent 工作规范 | 为 Agent 的搜索、上传、元数据补录提供的分层操作指引 |
| GitHub Actions | 远程构建、测试、文档发布和 Release 的自动化机制 |

返回 [[首页|Home]]。