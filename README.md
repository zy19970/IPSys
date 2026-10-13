# IPSys — 知识产权与综合资料管理系统

IPSys 是面向 **Windows 10/11 x64** 的离线便携式单用户资料管理系统，使用加密 SQLite 主数据库归档业务台账与原始附件，区分公司与个人工作区，通过本机 Edge/Chrome 浏览器使用。

> **当前阶段：V1.0 产品需求已冻结；技术方案尚待验证，应用尚未开发完成。**  
> **当前任务：M0 已完成；M1 首版 Windows 加密存储原型在 GitHub Actions 中编译及小文件冒烟测试通过，2 GiB 以上文件、SSD 故障与浏览器导出仍待实测。**  
> 请勿把历史 DESIGN.md 中的探索功能当作现行产品需求。

## 先看哪里？

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | **开发主计划**：现在是否能定稿、准备工作、阶段顺序、交付物与验收门槛 | **V0.1 路线图；未锁定工期** |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | V1.0 产品功能和业务行为的唯一需求基线，截止 Q162 | **范围冻结** |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | **M0 数据设计**：全部模块字段、固定/候选状态、Excel 映射、关系草图与验证样例 | **M0 已确认（R1–R3 默认方案）** |
| [M1_TESTING.md](./M1_TESTING.md) | Windows M1 原型运行方法、已验证范围、手工测试命令、Actions 构建产物下载 | **首轮 CI 冒烟已通过；其余 M1 验证待进行** |
| [FREEZE_AUDIT.md](./FREEZE_AUDIT.md) | 需求审查、历史冲突消解、已废弃特性、关键技术验证项目 | 审查记录 |
| [DESIGN.md](./DESIGN.md) | 早期架构探索稿，含过期方案 | **历史稿，M2 前需重构** |

## 当前推进顺序

1. **M0**：字段、状态与 Excel 列字典、实体关系草图已定稿；R1–R3 采用默认方案，详见 [M0 字典](./M0_DATA_DICTIONARY.md)。
2. **M1（进行中）**：已提交 C# 控制台原型并通过 [Windows 构建/冒烟](https://github.com/zy19970/IPSys/actions/runs/38372112267)；从 [M1 测试指南](./M1_TESTING.md) 获取可执行文件并测试超 2 GiB 附件和移动 SSD。Edge/Chrome 浏览器导出待下一轮实现。
3. **M2**：根据验证结果重构正式 DESIGN.md，完善 Schema 和可验收开发任务，届时再锁定开发工期。
4. **M3–M7**：遵循 DEVELOPMENT_PLAN.md 的顺序实施完整业务闭环、模块功能、附件生命周期、导入检索导出与稳定性发布。

**文档维护规则**：需求变更仅更新 REQUIREMENTS.md；阶段计划仅更新 DEVELOPMENT_PLAN.md；技术设计在 M2 完成后以 DESIGN.md 为准。详细审查过程留在 FREEZE_AUDIT.md，不新增重复的零散 Markdown 计划文件。
