# P0 开源文件管理器选型与集成可行性记录

> 对应 [ONEDRIVE_REFACTOR_PLAN.md](./ONEDRIVE_REFACTOR_PLAN.md) 的 P0。状态：**选型试验已建立；候选组件未获得整体采用许可**。下面的“源码确认”“自动回归”“真实浏览器”是不同证据等级。不得将试验页面当成已实现的 IPSys 新 UI。

## 1. 实际候选调查

| 维度 | Cubone React File Manager | harryy2510 React File Browser |
| --- | --- | --- |
| 上游 | https://github.com/Saifullah-dev/react-file-manager | https://github.com/harryy2510/react-file-browser |
| 固定评估版本 | @cubone/react-file-manager 1.35.0 | @harryy/react-file-browser 1.5.1（只做源码调查，未安装到 P0 页面） |
| 上游授权 | 根目录 MIT；版权声明应随复制、发布包保留 | 根目录及 package.json MIT；依赖另行核查 |
| 技术形式 | 高层 FileManager + path/name/isDirectory 数组 + callbacks | FileBrowser + FileBrowserAdapter + 独立身份/metadata + 按能力隐藏动作 |
| 当前优点 | 中文、面包屑、右键、选择、拖放、成熟演示入口 | 不直接绑定云服务，适配器明确，业务 metadata 和 capability 可扩展 |
| **主要冲突** | README 明确写“Folders are always displayed before files regardless of sort criteria” | src/core/use-file-browser.ts 的 compareNodes() 同样把 folder 固定放在 file 前 |
| 另一个风险 | path 作为主要身份，没有直接区分 LinkId/FileId 的完整约定；上传需接管 | path 是 immutable storage key，缺少 IPSys 所需的“资源路径变化但真实 ID 不变”适配；默认 Zip/预览/上传需禁用或重接 |
| P0 取舍 | 作为当前真实组件试验对象，但不能直接投入所有模块 | 保留备选，下一步优先调查可配置排序或维护小补丁的实际成本 |

直接读取源码/README 的静态结论不等于已完成 Edge/Chrome 人工验证。两个组件均未自然满足本项目“同一 position 中夹杂 Folder 与 FileLink，并永久保存自定义顺序”的条件；不得未经证据改写这一前提。

## 2. 已搭建的试验与身份映射

| 交付 | 文件 | 实际含义 |
| --- | --- | --- |
| React 候选接入 | experiments/onedrive-p0/src/main.jsx | 真正 import @cubone/react-file-manager，挂载合成 FileManager；响应事件只显示试验提示 |
| 合成模型 | experiments/onedrive-p0/src/fixture.mjs | 具有 FolderId、FileId、LinkId、nodeKey、position、parent 的稳定标识；同一 FileId=501 对应两个 LinkId=9001/9002 |
| 两种视图 | 同一个 P0 页面 | 原生组件显示“上游实际行为”；对照列表显示“按 position 混排”的 IPSys 目标行为 |
| 合约测试 | experiments/onedrive-p0/tests/fixture-smoke.mjs | 验证混排数据输入、两处 Link 不同身份、名称不作为唯一 ID |
| 包构建 | experiments/onedrive-p0/package.json / vite.config.js | npm 固定直接依赖版本，Vite 相对 base，构建静态本地资源 |
| 分支 CI | .github/workflows/onedrive-p0.yml | 在 work/onedrive-file-manager 分支运行 npm 安装、测试和构建；不更新 main |

合成场景仅验证**前端展示契约**，不代表所有层级都由现有业务 API 支持。公司业务档案的 archive_folder/archive 两种 Folder 当前可以混排；Folder 与 FileLink 的直接混排需要后续确定新聚合接口与业务边界。

## 3. P0 十项闸门逐条结论

| 编号 | 指标 | 当前可确认的事实与剩余工作 | 判定 |
| --- | --- | --- | --- |
| G01 | 挂载原本 localhost 页面并保留会话 | React 独立试验源已建；尚未接 IPSys Program.cs、会话 | 待 P1 |
| G02 | 布局、可收起导航/右详情 | Cubone 自带导航与工具栏；右详情需 IPSys 外壳适配，未实际视觉验收 | 待验证 |
| G03 | 单击选中、双击打开、多选、右键 | 上游声称支持；需浏览器真实鼠标/键盘试验 | 待验证 |
| G04 | 虚拟业务根 + Folder 与 FileLink 同表 | 原始 synthetic paths 可加载；真实数据库聚合仍需实现 | 待验证 |
| G05 | Folder 与 File 按持久 position 自由混排 | 首选 README 明确“folder first”；备选 compareNodes 同样如此 | **阻断：不通过** |
| G06 | LinkId/FileId/FolderId 稳定身份 | 宿主层能生成独立 nodeKey，但 Cubone 核心以 path 路由；重命名及共享后身份语义未实测 | 待验证 |
| G07 | 顶部/右键同一个 CommandRegistry | 候选有内部菜单，不能直接证明可替换为 IPSys 命令注册器 | 待验证 |
| G08 | 接管现有 8 GiB 上传/去重/任务锁 | P0 不允许模拟原件写入；需研究组件阻止默认写入及接入原任务 | 待验证 |
| G09 | 离线嵌入 VS Debug / Release 单 EXE | 本阶段使用静态 Vite build；集成到 WinForms/C# 资源编译的端到端验收在 P1 | 待 P1 |
| G10 | 许可证、版本、补丁成本可审计 | 两上游根许可证 MIT，候选固定直接包版本；完整传递依赖/字体/图标 NOTICE、锁文件待补 | 部分通过 |

**当前总判定：不能批准直接大范围引入 Cubone，也不能在未改造前直接切换到 harryy。** 最关键失败项 G05 是此前冻结的混排用户需求。下一轮仍属于 P0：验证是否能用可维护扩展实现完全混排和统一命令，否则转为更薄的自研 UI 壳复用开源图标/交互原语，而不是大改数据库去迎合组件。

## 4. 数据语义必须保留

1. FolderId 是业务记录/分类的稳定 ID，不含版本；FileId 是原件身份；LinkId 是文件出现在具体 Folder 下的可见引用。不同 LinkId 可以指向同一 FileId，不能因按文件名或路径去重而消失。
2. 项目/合同、IP 和公司档案仍受 ResourceSchemaV2.cs 业务父子约束。合同只归属于项目；archive_folder/archive 混排已有独立持久排序 API；普通业务 Folder 不是任意可嵌套通用目录。
3. 数据层可为 Explorer 提供模拟或实际节点，但真正写操作必须经过 /api/v2 和 C# 权限/任务锁；上游自带删除/重命名/上传不可被直接当作业务成功。
4. 上传 8 GiB 流式写入、SHA 去重、共享与独立保存选项不能改成纯前端 FileReader 全文件读入；跨公司/个人空间内容不能直接共享物理字节。
5. V2 当前上传需要先有业务记录或合法 Folder；此次试验中的直接 Link 行只是验证通用文件视图排序，不能作为 API 已支持全部组合的证据。

## 5. 下一次 P0 补充检查顺序

1. 查看新分支 CI 的 Node fixture 及 Vite build 结论，确认证明本次实验可构建；保存 package-lock/npm 依赖许可树、确切版本和 bundle 分析，禁止 CDN 运行依赖。
2. 从 Windows 浏览器打开独立试验，实际验证中文、Ctrl/Shift、多选、右键、路径回退、列表与对照面板顺序，记录截图和“文件夹优先”行为差异。
3. 在不修改业务数据库的前提下评估 Cubone 的排序覆盖及命令分发能力；若核心渲染器无法以可维护的补丁/扩展实现，试验第二候选的 FileBrowserAdapter 与排序注入/源码补丁成本。
4. 再验证候选静态构建资产可被现有 C# EmbeddedResource 提供，WinForms 离线 Debug/Release 单 EXE 的完整流程及分支回归；未完成前 P1 不开始替换正式业务界面。
5. 编制最终 P0 十项闸门评审与明确选型。不能因有试验页面就宣布 P0 整体通过。

## 6. 使用者能看到什么

在 Node.js 环境，进入 experiments/onedrive-p0，运行 npm install、npm test、npm run build、npm run dev，打开 Vite 提示的 127.0.0.1 地址；原生组件与目标混排对照均只使用合成数据。正式 IPSys 入口、现有数据库和 main 分支不发生变化。
