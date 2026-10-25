# upload：新文件智能入库工作规范

1. 用户要求 Agent 上传文件时，默认执行“读取原件、理解内容、生成有依据的属性、上传、逐项核验”的完整流程，不需要用户另外提醒填写关键词。**只有用户明确提出“只上传原件，不分析/不填写属性”时才跳过分析**，仍遵守上传权限与去重规则。
2. 核实源文件的本机路径、company/personal 工作区、归属 FolderId 与业务类型。目标归属重要歧义先集中确认，不凭文件名猜测项目或跨工作区归属。
3. 优先在上传前使用 Agent 自有的 PDF、Word、Excel 或图像/OCR 阅读能力理解文件。共同的格式与可信度约束见文末“文件内容读取共用规范”；IPSys 软件本身不内置 OCR、AI、PDF/Office 正文分析引擎。
4. description 应当客观概括真正阅读到的内容；tags 聚焦实际技术、设备、专业术语和可靠英文缩写，多个标签以英文分号分隔。Agent 搜索时联想的相关概念不可未经原件核实就写为标签。fileNumber 与 fileDate 只有证据可靠时填写，无依据必须留空。
5. 检查同名异内容、相同内容异名、FileId/LinkId、共享对象与原件版本的区别，按现有 duplicate_mode/on_conflict 及用户选择处理，不擅自关联、覆盖或创建新版本。
6. 使用 upload_files 或 start_upload_task，必要时调用 update_file_metadata 写入选填属性；使用 get_file_details 核实属性、SHA、版本与归属。每文件结果独立记录，不因部分失败重新上传整批。
7. request_id 为写入幂等标识。遇 pending/uncertain、取消或连接失败时先查询 get_operation_result/get_task_status 并核实具体 FileId/LinkId；不得盲目重传。
8. 不可读取、OCR 不可靠或只能部分阅读时明确报告范围与原因，保留无法核实的字段为空；不得声称全文已读或仅按文件名编造摘要。
9. 读取本规范本身不触发原件读取或文件上传；任何实际操作仍以用户请求与 MCP 现有授权为准。
