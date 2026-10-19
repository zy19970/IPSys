# IPSys / OneDrive 风格 P0 选型实验

本目录是**隔离的候选组件试验**，不是可连接数据库的正式页面。样本均为合成数据，禁止据此判定任何新建、移动、删除、上传动作已经真实落库。

## 当前候选

Cubone React File Manager（包名 @cubone/react-file-manager，固定试验版本 1.35.0，MIT）。版本依据 npm 公共包版本；上游 GitHub main 与发布包版本不保证一致。React/Vite 等依赖见 package.json；安装前应审查锁文件和完整依赖许可证。

## 在有 Node.js 的开发环境试验

运行 npm install，然后 npm test、npm run build、npm run dev。构建结果位于 dist/；不要求日常使用 IPSys 的电脑安装 Node，正式集成由 P1 决定嵌入方式。

试验包含两个切换视图：“原生开源组件”真实挂载 @cubone/react-file-manager；“IPSys 要求的混排”展示依据 position 的预期顺序及稳定资源身份。此处第二个视图是**契约对照**，不是完整自研文件管理器。内部 identity 采用 FolderId、FileId、LinkId，避免因文件名重复混淆资源；路径只能当候选组件路由，不可作为后端资源 ID。

原生候选 README 明确规定文件夹优先于文件。必须在实际界面确认它与需求的冲突，不能仅仅通过调整传入数组顺序规避。候选组件即使显示了写操作，也只触发本试验的提示回调，不会访问 IPSys API。

## 已知边界

P0 不连接 SQLCipher、不修改现有 wwwroot/index.html/app.js、Program.cs、csproj 或业务接口；不提供真实上传、删除或预览。合成目录中直接出现 file-link 只是测试 UI 混排的压力输入，现行公司业务档案 API 不能直接保证这样的列表输出；进入 P2 前应另行确定资源聚合模型。

P0 的结论与 10 项闸门见仓库根目录的 P0_COMPONENT_EVALUATION.md。该文档记录可验证事实、待验证事项和选型阻断项；没通过的项目不能标成“已通过”。
