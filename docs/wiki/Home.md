# IPSys · 资料管理系统

IPSys 是面向个人和公司资料的 Windows 本地管理软件。它使用接近 OneDrive 的文件管理界面，将项目、知识产权、业务档案与附件集中保存到**用户自己选定的加密数据库文件**中。

软件由 WinForms 启动器、本机 Web 服务和 Edge/Chrome 界面组成。浏览器负责显示与操作，数据库仍存放在本机，**不是云盘，也不会自动同步到 OneDrive**。

> **项目状态**：当前处于实际使用细节精修阶段。已发布预发布版 [v0.9.3-rc.1](https://github.com/zy19970/IPSys/releases/tag/v0.9.3-rc.1)（2026-11-05，双 Windows 单 EXE）；对应 [手动 Publish #6](https://github.com/zy19970/IPSys/actions/runs/42053785425) 成功。普通 Windows CI 与手动发布分别验证，后者不重复运行 smoke；用户本机人工整体验收仍需独立记录。

## 从这里开始

| 我想做什么 | 阅读指南 |
| --- | --- |
| 第一次下载、启动与建库 | [快速开始](https://github.com/zy19970/IPSys/wiki/Getting-Started) |
| 理解日常操作与菜单 | [日常使用](https://github.com/zy19970/IPSys/wiki/Daily-Workflow) |
| 看看公司和个人分别有什么栏目 | [工作区与业务模块](https://github.com/zy19970/IPSys/wiki/Workspaces-and-Modules) |
| 建文件夹、归档业务记录 | [目录与资料记录](https://github.com/zy19970/IPSys/wiki/Folders-and-Records) |
| 上传、预览、下载附件 | [附件管理](https://github.com/zy19970/IPSys/wiki/File-Management) |
| 了解共享、查重与文件版本 | [文件共享与版本](https://github.com/zy19970/IPSys/wiki/File-Sharing-and-Versions) |
| 备份、删除和恢复资料 | [回收站与彻底删除](https://github.com/zy19970/IPSys/wiki/Recycle-Bin)、[备份与数据安全](https://github.com/zy19970/IPSys/wiki/Backup-and-Security) |
| 搜索与 Excel 台账 | [搜索与 Excel](https://github.com/zy19970/IPSys/wiki/Search-and-Excel) |
| 用 Agent/Codex 管理本机资料 | [MCP 接入](https://github.com/zy19970/IPSys/wiki/MCP-and-Agent) |

## 你需要了解的三个对象

**EXE 程序**：启动、显示与操作资料管理系统的应用程序，可以更新或重新下载。

**加密 DB 文件**：保存业务记录、目录、附件、文件版本及工作区数据；它是最重要的数据资产。需要妥善备份并保管密码。

**浏览器页面**：软件在本机打开的操作界面。关掉浏览器页面并不意味着删除数据或退出服务。

## 设计原则

1. 以**资料归属**组织内容：项目、知识产权与普通文件夹都有明确位置；合同材料存放在所属项目的普通目录中，附件归属具体记录或目录。
2. 以**统一文件身份**管理原件：文件拥有版本，目录和业务记录没有文件版本；同一文件可以在适用位置显式共享。
3. 以**工作区隔离**保护数据：同一加密库中区分个人与公司，跨工作区不共享同一物理原件对象。
4. 以**可恢复操作**降低误删风险：普通删除进入回收站，永久删除才解除关联并清理不再被引用的原件。
5. 以**实际核验**判断成功：上传传输进度、删除进度和构建任务均需等待最终成功结果。

## 项目入口

[源码仓库](https://github.com/zy19970/IPSys) · [版本与下载](https://github.com/zy19970/IPSys/releases) · [构建记录](https://github.com/zy19970/IPSys/actions) · [[常见问题|FAQ]] · [[开发者指南|Developer-Architecture]]

本 Wiki 介绍当前源码已实现的能力。具体界面和工具参数以正在运行的 EXE 版本为准。