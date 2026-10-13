# IPSys — 知识产权与综合资料管理系统

IPSys 是面向 **Windows 10/11 x64** 的离线便携式单用户资料管理系统，使用加密 SQLite 主数据库归档业务台账与原始附件，区分公司与个人工作区，通过本机 Edge/Chrome 浏览器使用。

> **当前阶段：V1.0 产品需求已冻结；技术方案尚待验证，应用尚未开发完成。**  
> **当前任务：M0 字段/状态/Excel 映射初稿已形成，待集中评审；M1 加密大文件等关键原型尚未开始。**  
> 请勿把历史 DESIGN.md 中的探索功能当作现行产品需求。

## 先看哪里？

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | **开发主计划**：现在是否能定稿、准备工作、阶段顺序、交付物与验收门槛 | **V0.1 路线图；未锁定工期** |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | V1.0 产品功能和业务行为的唯一需求基线，截止 Q162 | **范围冻结** |
| [M0_DATA_DICTIONARY.md](./M0_DATA_DICTIONARY.md) | **M0 数据设计**：全部模块字段、固定/候选状态、Excel 映射、关系草图与验证样例 | **初稿已提交，R1–R3 待集中审阅** |
| [FREEZE_AUDIT.md](./FREEZE_AUDIT.md) | 需求审查、历史冲突消解、已废弃特性、关键技术验证项目 | 审查记录 |
| [DESIGN.md](./DESIGN.md) | 早期架构探索稿，含过期方案 | **历史稿，M2 前需重构** |

## 当前推进顺序

1. **M0**：字段/状态与 Excel 列字典、实体草图、数据验证用例已形成初稿；先集中审阅 [R1–R3](./M0_DATA_DICTIONARY.md#8-m0-交付完成条件与待审计项)，不把候选项写成冻结需求。
2. **M1**：验证 SQLCipher 实际加密、超过 2 GB 附件、移动 SSD 故障恢复、退出后手工备份、Edge/Chrome 选择导出目录。
3. **M2**：根据验证结果重构正式 DESIGN.md，完善 Schema 和可验收开发任务，届时再锁定开发工期。
4. **M3–M7**：遵循 DEVELOPMENT_PLAN.md 的顺序实施完整业务闭环、模块功能、附件生命周期、导入检索导出与稳定性发布。

**文档维护规则**：需求变更仅更新 REQUIREMENTS.md；阶段计划仅更新 DEVELOPMENT_PLAN.md；技术设计在 M2 完成后以 DESIGN.md 为准。详细审查过程留在 FREEZE_AUDIT.md，不新增重复的零散 Markdown 计划文件。
