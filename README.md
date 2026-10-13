# IPSys — 知识产权与综合资料管理系统

IPSys 是面向 **Windows 10/11 x64** 的离线便携式单用户资料管理系统，使用加密 SQLite 主数据库归档业务台账与原始附件，区分公司与个人工作区，通过本机 Edge/Chrome 浏览器使用。

> **当前阶段：V1.0 产品需求已冻结；技术方案尚待验证，应用尚未开发完成。**  
> **当前任务：M0 已完成；M1 网页最小原型现由 WinForms 启动器托管，Windows CI 已完成发布和 SQLCipher/HTTP 冒烟测试。WinForms 按钮及关闭窗口仍需实机验证，超大附件、SSD 断连和原生目录选择仍待开发。**  
> 请勿把历史 DESIGN.md 中的探索功能当作现行产品需求。

## 最快开始测试 WinForms 启动器与网页

1. 打开 [WinForms 启动器 Windows 构建](https://github.com/zy19970/IPSys/actions/runs/38378877601)，在 **Artifacts** 下载 `IPSys-Web-win-x64`。
2. 解压后双击 `IPSys.Web.exe`，会显示 **WinForms 启动器**；点击“打开浏览器管理界面”才会打开网页。**网页 HTML/CSS/JS 已直接编译进 EXE，不再复制或依赖运行目录里的 `wwwroot`**。关闭浏览器标签不会退出软件，点击 WinForms 的“退出程序”或窗口 X 才会关闭本地服务。
3. 输入新测试库路径、密码，新建“综合资料”，上传无敏感文件，再下载验证；切换公司/个人检查隔离；完成后安全退出。
4. 请阅读 [WEB_TESTING.md](./WEB_TESTING.md) 的细节和原型限制。本次是可以操作的**最小业务网页**，不是完整 IPSys V1.0。

## 先看哪里？

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | **开发主计划**：现在是否能定稿、准备工作、阶段顺序、交付物与验收门槛 | **V0.1 路线图；未锁定工期** |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | V1.0 产品功能和业务行为的唯一需求基线，截止 Q162 | **范围冻结** |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | **M0 数据设计**：全部模块字段、固定/候选状态、Excel 映射、关系草图与验证样例 | **M0 已确认（R1–R3 默认方案）** |
| [WEB_TESTING.md](./WEB_TESTING.md) | **WinForms 启动器 + 网页**：按钮打开浏览器、关闭 WinForms 退出程序、加密库与附件测试 | **Windows CI 已通过；GUI 点击/关窗待用户实机测试** |
| [M1_TESTING.md](./M1_TESTING.md) | 早期 M1 命令行存储原型的测试方法 | SQLCipher 命令行冒烟通过；其余 M1 验证待进行 |
| [FREEZE_AUDIT.md](./FREEZE_AUDIT.md) | 需求审查、历史冲突消解、已废弃特性、关键技术验证项目 | 审查记录 |
| [DESIGN.md](./DESIGN.md) | 早期架构探索稿，含过期方案 | **历史稿，M2 前需重构** |

## 当前推进顺序

1. **M0**：字段、状态与 Excel 列字典、实体关系草图已定稿；R1–R3 采用默认方案，详见 [M0 字典](./M0_DATA_DICTIONARY.md)。
2. **M1（进行中）**：命令行 SQLCipher 测试通过；[最小网页版](./WEB_TESTING.md) 已通过 Windows CI 的 HTTP 往返冒烟测试。下阶段重点是 Edge/Chrome 实机交互、移动 SSD、>2 GiB 附件和用户选定导出目录的 Windows 原生交互原型。
3. **M2**：根据验证结果重构正式 DESIGN.md，完善 Schema 和可验收开发任务，届时再锁定开发工期。
4. **M3–M7**：遵循 DEVELOPMENT_PLAN.md 的顺序实施完整业务闭环、模块功能、附件生命周期、导入检索导出与稳定性发布。

**文档维护规则**：需求变更仅更新 REQUIREMENTS.md；阶段计划仅更新 DEVELOPMENT_PLAN.md；技术设计在 M2 完成后以 DESIGN.md 为准。详细审查过程留在 FREEZE_AUDIT.md，不新增重复的零散 Markdown 计划文件。
