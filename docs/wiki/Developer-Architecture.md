# 开发者指南：结构与数据模型

IPSys 主源码位于 [zy19970/IPSys](https://github.com/zy19970/IPSys)。项目采用 Windows WinForms 启动器、ASP.NET Core/Kestrel、本机 Web Explorer、SQLCipher **schema 4**（源码中 `ResourceSchemaV2.cs` 保留历史文件名）、MCP 工具（清单以 `tools/list` 为准）与内嵌前端资源。

## 应用组成

~~~text
IPSys.Web.exe
  WinForms 启动器与托盘
  ASP.NET Core 本机 HTTP（127.0.0.1）
  Explorer 前端静态资源（编译嵌入 EXE）
  V2 业务与文件服务
  SQLCipher 加密数据库
  本机 MCP 宿主/客户端管道
~~~

浏览器只负责前端展示与交互。文件源数据、版本历史、索引等由 EXE 的后台服务存放在加密数据库中。

## 关键源码位置

| 路径 | 职责 |
| --- | --- |
| `src/IPSys.Web/Program.cs` | 启动与服务端入口 |
| `src/IPSys.Web/LauncherForm.cs` | WinForms 宿主窗口 |
| `src/IPSys.Web/ResourceSchemaV2.cs` | 数据库模型与约束 |
| `src/IPSys.Web/NativeArchiveStore.cs` | 资料与目录的业务操作 |
| `src/IPSys.Web/RecycleStore.cs` | 回收站及永久清理 |
| `src/IPSys.Web/McpLocal*.cs` | MCP 接口与宿主连接 |
| `src/IPSys.Web/wwwroot/js/store.js` | 工作区、目录树与数据 |
| `src/IPSys.Web/wwwroot/js/interactions.js` | 鼠标、菜单、选择及操作 |
| `src/IPSys.Web/wwwroot/js/forms.js` | 业务表单与属性 |
| `src/IPSys.Web/wwwroot/js/bridge.js` | 上传/下载/进度适配 |
| `src/IPSys.Web/wwwroot/css/app.css` | 共用样式 |
| `src/IPSys.Web/wwwroot/export.js` | ZIP/ZIP64 导出 |
| `.github/workflows/web-windows.yml` | Windows 构建与回归 |

前端的 `dist/` 是打包生成结果，不应作为唯一修改源。Web SDK 通过 `EnableDefaultContentItems=false` 禁用默认 Content 外拷，正式资源由显式 `EmbeddedResource` 嵌入 EXE。构建产物是否满足单 EXE 要求，须以对应提交的 Windows CI 和实际发布检查结果判断。

## 核心数据身份

Folder 表达目录与业务记录；FileId 表达逻辑文件；LinkId 表达文件在一个归属位置的关联；FileVersion 是版本；FileObject/Chunk 表达加密物理内容。只有 File 有版本，Folder 无版本。

普通目录统一使用 `kind=archive_folder` 并通过 `workspace + section` 划分资料范围。**项目本身仍为 `kind=project` 的业务记录，项目内任何层级的普通子目录均为 `archive_folder, section=project`，其最上级 `parent_id` 指向真实项目**，深层子目录指向上级普通文件夹。项目根业务属性与内部目录结构分别管理。知识产权仍是专门业务对象。整树移动、跨工作区复制、MCP、ZIP 导出与回收站永久删除均须递归处理项目子目录、附件关联及 FileVersion；数据库校验目录归属和父级关系，阻止游离项目文件夹、循环与跨工作区错误关联。

## 一致性原则

同一工作区原位移动目录会将已删除后代和隐藏子目录的物理归属在单个事务内一并处理；跨工作区独立复制不得共用 FileObject。合同材料作为 `section=project` 下的普通文件夹保存。MCP 工具以连接后的 `tools/list` 为准；每次构建与 GUI 验收均应与实际提交和 EXE 对应，不能通过历史 Release 推断当前源码已验收。


1. 前端列表、详情表单、Excel、MCP 与搜索应使用一致的业务字段语义。
2. FileId 与 LinkId 不可混用；同区共享与跨区物理复制是不同规则。
3. 删除需要保护未清理的共享引用，回收站的恢复语义优先于回收时释放空间。
4. UI 修复应优先定位共享组件，而非在多个页面复制修补。
5. 产品正确性应以实际源码和对应 SHA 的构建/测试记录为依据，不能仅以旧设计文档的“当前”字样判断。

进一步阅读 [DESIGN.md](https://github.com/zy19970/IPSys/blob/main/DESIGN.md)、[M0_DATA_DICTIONARY.md](https://github.com/zy19970/IPSys/blob/main/M0_DATA_DICTIONARY.md)、[TESTING.md](https://github.com/zy19970/IPSys/blob/main/TESTING.md)。