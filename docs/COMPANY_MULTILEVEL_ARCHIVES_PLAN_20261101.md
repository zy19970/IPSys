# IPSys 公司资料模块多级目录统一实施方案（2026-11-01）

## 一、需求与边界

用户要求公司“业务档案、综合资料、党团建设”采用一致的文件夹管理逻辑：在任意普通目录下面仍可创建下级目录，不因进入第二层而只剩下“新建资料/上传资料”；层数不设业务硬上限。以当前公司业务档案的“普通目录（可无限嵌套）→资料记录→附件原件/文件版本”模型为基线。普通目录不是业务资料记录，没有文件版本；在普通目录中继续新建下级目录，或新建资料记录；进入具体资料记录后上传原件。目录和记录的区别须保持清晰。

本轮仅明确公司这三个模块；不修改公司项目、知识产权、企业资质、个人工作区的类别结构。已有企业工作区记录和原件必须完整保留，不以开发阶段为由清空当前资料库。

## 二、当前实际代码与差异（以 main 的 5e633737 为准）

1. 公司业务档案在 `NativeArchiveStore` 和 `store.js` 中使用 `archive_folder/achievement` 实体目录，支持父级目录指向另一实体目录；界面 `archiveScope/createArchiveFolder/buildArchiveDirs` 支持递归。目录内可继续建目录，资料在末端的 Archive 记录内上传附件。
2. 党团建设实际是 `archive` 记录的 `section=party`，目前没有目录树；`ResourceSchemaV2` 只允许 `archive` 在 `company/achievement` 拥有父级，`NativeArchiveStore.Prepare` 对 party 的 FolderId 明确拒绝。
3. 综合资料是 `general` 业务记录，`folders` 表明确不允许它有父级，`NativeArchiveStore.Prepare` 创建时总写 `parent_id=NULL`；`store.js` 当前直接平铺这些记录。
4. `archive_folder` 的 CHECK 只接受 `company/achievement`；`folder_parent_insert/update` 触发器校验亦写死 achievement；`ResourceRef.IsValid`、Folder API 的引用生成、目录重命名/移动/混排排序、MCP 和 Excel 都存在对应限定。因此单纯放开“新建”按钮会在数据库层失败。

## 三、统一数据语义

使用已有 `folders` 表和 `archive_folder` 实体目录，扩展 `archive_folder.section` 的合法业务域到 `company/achievement`、`company/party`、`company/general`。注意这里 `company/general` 是目录作用域，原 `general` 资料记录仍保持 `section=''`，其业务 kind 和 API 不变。

目录只可挂同工作区、同模块作用域的目录；资料记录只可挂与其业务模块匹配的目录。普通目录本身没有附件版本、业务记录字段；任何层级目录均可新增目录和资料记录。原有未归入任何目录的 party/general 记录继续可见、可查、可导出，不因新规则自动移动或丢失。新建的记录由所在实体目录传入 FolderId，编辑已有记录时留空不应清空原父级。

## 四、实施顺序

### 1. 数据库与接口

同步修正新库 `ResourceSchemaV2` CHECK、父级触发器、目录唯一性约束与循环检测。针对已有 V2 资料库采用可幂等、事务内的结构升级，保留 FolderId/FileId/LinkId/FileVersion、附件对象与密文字节；禁止无保护地重建或清空数据库。升级执行前后做外键、记录数和原件摘要一致性验证，故障回滚。扩展 `FolderModel` 的目录引用作用域、`NativeArchiveStore` 的目录和资料父级校验、`NativeFolderEndpoints` 的 section 传递。general 资料新增可选目录引用，需保证旧 API/旧记录兼容。

### 2. UI 树与操作

扩展 `NativeArchiveUiEndpoints` 统一返回目录的 section、parentId 与记录的 folderId。将 `store.js` 的公司业务档案目录构树函数按 section 复用到 party/general，目录递归创建、同级目录与资料混排、按子孙附件汇总数量与大小。扩展 `interactions.js` 的新建、重命名、空目录删除、移动与排序入口，`forms.js` 的新建资料传递当前父目录。公司三模块根目录“新建文件夹”；任意目录内“新建下级目录”和“新建资料”；具体业务记录内“上传文件”。不得把虚拟分类根当真实 FolderId，避免新建记录无法关联到树。

### 3. 导出、搜索、Excel 与 MCP

递归下载保持完整多级路径，检查 `bridge.js/export.js` 的目录链和重名处理、ZIP64/多选。Excel 台账导出/导入需要与目录归属对齐，旧表格导入仍可用；不应在更新资料属性时改掉目录位置。检查跨模块搜索、MCP 创建/查询目录、单条与批量移动、工作区隔离、删除/回收站、工作区切换刷新等入口使用同一作用域校验。

## 五、验收范围

1. 公司三个模块中，三级及以上目录可连续新建，目录内仍保留“新建下级目录”；可在不同层级新建资料记录并上传多个附件版本。
2. 同名目录在不同父级允许，当前同级重名拒绝；禁止将目录移入自身或后代，禁止跨模块/工作区非法父级；非空目录删除必须拒绝。
3. 下载第一级目录包含所有后代记录及原件；多选、右键、详情与导出文件路径一致；空目录、同名附件、ZIP64 不产生破坏性副作用。
4. SQLCipher HTTP、Node 菜单、真实 Edge 交互、MCP、Excel import/export、旧数据库升级/回滚均有可复核测试。CI 编译通过后再进行用户本机真实数据人工验证。
5. 不改动企业资质、公司项目、知识产权、个人工作区原有业务规则。

## 六、本轮决定与状态

用户提出目录能力统一的方向，本轮已确认现有数据库存在硬约束，属于跨 DB/后端/UI/导出的结构性扩展，而非单点 UI 细修。本文件是经实际代码审查形成的实施方案，**不是已完成源码修改或测试的声明**；尚未执行结构升级、业务源码改动或 CI。执行阶段必须先确认数据库备份与完整性验证，再以原子提交及 Windows CI 确认结果。
