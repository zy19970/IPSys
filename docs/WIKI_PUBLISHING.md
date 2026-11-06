# IPSys Wiki 文档发布与维护

## 单一内容来源

正式 Wiki 页面源文件保存在 `docs/wiki/*.md`，与产品源码一起参与 Git 审核与版本追溯。GitHub Wiki 是独立的 `https://github.com/zy19970/IPSys.wiki.git` 仓库，**仅仅提交到主仓库 `docs/wiki/` 不会自动显示在 Wiki**，需要成功完成发布步骤。

文档包括 `Home.md`、`_Sidebar.md`、`_Footer.md` 以及主题页面。页面标题采用稳定英文文件名，正文和导航使用中文，Wiki 内链使用 `[[中文标题|页面名]]` 格式。

## 推荐：自动发布

工作流：`.github/workflows/publish-wiki.yml`，名称为 “Publish IPSys Wiki”。推送 `docs/wiki/**` 到 `main` 时自动触发，也可通过 Actions 页面手动运行。

工作流先检查 Markdown 页面和内部链接，再使用本仓库 Actions 临时令牌克隆该项目的 **Wiki Git 仓库**，复制当前页面并非强制 push。如果已一致，不创建空提交。

第一次覆盖 `Home.md` 时，若 Wiki 原首页已有不同内容，自动保存为 `Home-original-before-IPSys-sync.md`，后续更新不会重复覆盖这份原始备份；其他不在 `docs/wiki/` 中同名的 Wiki 页面不会被删除。

**应核对 Actions 运行状态和 Wiki 页面**。GitHub Actions 写入独立 Wiki 是否成功依赖实际生效的令牌权限，单靠主仓库文件已提交不代表 Wiki 发布成功。工作流失败时应检查 GitHub Actions 日志，禁止通过强制推送绕过权限或冲突。

## 手动发布替代方案

Windows PowerShell 中进入主仓库根目录，确保 GitHub 已通过 Git Credential Manager 或其他安全方式完成授权：

~~~powershell
git clone https://github.com/zy19970/IPSys.wiki.git .wiki-local
# 首次覆盖前自行复制一份已有 Home.md 备份（若存在）
Copy-Item -Path .\docs\wiki\*.md -Destination .\.wiki-local\ -Force
git -C .wiki-local add -A
git -C .wiki-local diff --cached --stat
git -C .wiki-local commit -m "docs(wiki): 更新 IPSys 使用文档"
git -C .wiki-local push
~~~

上述命令只应在确认原 Wiki 当前页面与本次修改范围后执行。`git push` 为普通非强制推送；若远端先有新的提交，需要先审查和合并，不能覆盖已有编辑。请不要把访问令牌写进脚本、提交或聊天。

## 文档更新约定

1. 用户可读的功能说明必须以当前代码、实际 UI 和已确认的需求为依据，避免直接复制过时的阶段计划。
2. CI、人工验证、Release 三种状态分别陈述，不将“源码已实现”视作用户实机全部验收。
3. Wiki 的正式正文只写用户真正需要的介绍、操作方法、安全提示和可核实事实，不存放对话过程、Agent 内部讨论与未确认猜测。
4. 更新原有页面优先延续稳定页面文件名，不轻易重命名以免破坏外部链接。
5. Wiki 与当前版本之间存在差异时，应明确版本范围，并同步最新的正式页面。

## 本次 Wiki 基线

截至 2026-11-06，本轮统一以 SQLCipher schema 4、MCP 43 项、普通资料 Excel 6 列及 [v0.9.3-rc.1](https://github.com/zy19970/IPSys/releases/tag/v0.9.3-rc.1) 为准；[Windows CI #558](https://github.com/zy19970/IPSys/actions/runs/42048982231) 是现行产品代码自动验证，[手动 Publish #6](https://github.com/zy19970/IPSys/actions/runs/42053785425) 是独立 Release 成功记录。当前 `docs/wiki/` 修改仍须在提交后核对 `Publish IPSys Wiki` 的实际成功状态及线上页面，不得将源码已更新直接当作 Wiki 已发布。
