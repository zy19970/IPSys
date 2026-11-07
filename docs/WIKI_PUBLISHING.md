# IPSys Wiki 文档发布与维护

## 单一内容来源

正式 Wiki 页面源文件保存在 `docs/wiki/*.md`，与产品源码一起参与 Git 审核与版本追溯。GitHub Wiki 是独立的 `https://github.com/zy19970/IPSys.wiki.git` 仓库，**仅仅提交到主仓库 `docs/wiki/` 不会自动显示在 Wiki**，需要成功完成发布步骤。

文档包括 `Home.md`、`_Sidebar.md`、`_Footer.md` 以及主题页面。页面标题采用稳定英文文件名，正文和导航使用中文，Wiki 内链使用 `[[中文标题|页面名]]` 格式。

## 推荐：自动发布

工作流为 [`.github/workflows/publish-wiki.yml`](../.github/workflows/publish-wiki.yml)，名称“Publish IPSys Wiki”。推送 `docs/wiki/**` 或修改该工作流本身到 `main` 时自动触发，也可在 Actions 页面手动运行。**仅修改本维护说明或 README 不会触发 Wiki 发布**。

工作流先检查 `docs/wiki/*.md` 是否为空、Wiki 内链目标是否存在及表格中不合适的 Wiki 管道链接，再用本仓库 Actions 临时令牌克隆该项目的**独立 Wiki Git 仓库**，复制当前页面后普通非强制推送；内容一致时跳过空提交。工作流权限与账户状态仍可能影响发布。

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
5. `docs/wiki/` 是受版本控制的正式源，GitHub Wiki 站点是独立发布结果。更新前应根据 [现行基线](CURRENT_BASELINE.md) 和对应程序核对功能；改变 Wiki 源后必须分别确认本仓库提交与 Publish IPSys Wiki 的实际运行及线上页面。
6. Wiki 首页、发布说明与截图不要写入会自动过期的“最新 CI / 最新 Release / 当前阶段”静态结论；需要说明版本时优先引用 [Releases](https://github.com/zy19970/IPSys/releases)、[Actions](https://github.com/zy19970/IPSys/actions) 和 [CURRENT_BASELINE.md](CURRENT_BASELINE.md)。历史版本事实应明确注明当时版本及日期，而不是冒充当前状态。
