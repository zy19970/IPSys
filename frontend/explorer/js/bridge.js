/* ==========================================================================
   能力层适配（bridge）
   --------------------------------------------------------------------------
   `src/IPSys.Web/wwwroot/` 下的四个脚本不是本壳的源码,它们有自建 DOM 与固定的
   对外契约。这里的职责只有两件:**把 VaultStore 包装成它们期望的请求对象形状**,
   以及**把本壳的节点翻译成它们要的参数**。不复制任何业务逻辑。

   为什么要这一层:ip-v2.js 要求 `api` 同时是三样东西 ——
     1. `api(path, {method,json,signal})` → Response
     2. `api.uploadFile(path, {method,headers,body})` → {ok,status,json()}
     3. `api.uploadProgress` → IPSysUploadProgress
   普通 JSON 请求走 fetch,上传必须走 XHR(只有 XHR 能拿到真实字节进度),
   两者共用同一个 token,所以只能在外层拼一个混合对象。
   ========================================================================== */

/* 单个原件上限。后端 Kestrel 的 MaxRequestBodySize 是 66 MiB,但 prepare 端点
   会放宽到 8 GiB,与旧壳保持一致。 */
const MAX_ORIGINAL_BYTES = 8 * 1024 ** 3;

const CapabilityApi = Object.assign(
  (path, opts = {}) => VaultStore.api(path, opts),
  {
    uploadProgress: globalThis.IPSysUploadProgress,

    async uploadFile(path, opts) {
      try {
        return await this.uploadProgress.request(path, opts, VaultStore.token);
      } catch (error) {
        /* 上传走 XHR,不经过 VaultStore.api,所以 401 要在这里自己收口:
           否则界面会停在一个已失效的 token 上,后续每个请求都静默失败。 */
        if (error?.status === 401) {
          VaultStore.token = "";
          VaultStore.locked = true;
          showLogin("登录已失效,请重新解锁资料库");
        }
        throw error;
      }
    },
  }
);

/* 能力层任务是否在跑 —— 工作区切换要据此互斥,否则切走时上传还在发,
   结果会落到新工作区的路径上。彻底删除也算文件任务:它同样占着服务端的
   文件任务槽,而且中途切工作区会让进度面板失去归属。 */
let fileTaskActive = false;
let purgeTaskActive = false;

CapabilityApi.uploadProgress.onActiveChanged = (active) => {
  fileTaskActive = !!active;
  if (!active) {
    /* 取消时服务端还要回滚暂存对象,晚一点刷新才看得到真实结果。 */
    setTimeout(() => refreshCurrent().catch(() => {}), 450);
  }
};

function fileTaskBusy() {
  return (
    fileTaskActive || purgeTaskActive || !!CapabilityApi.uploadProgress.status().active
  );
}

/* export.js 会调旧壳的 `notice(message, isError)` 报导出结果与失败原因。
   旧 app.js 删掉后它是未定义引用 —— 第一次导出就在 renderReport 里抛
   ReferenceError,表现是"ZIP 生成完但保存失败、报告为空"。
   这里补同名适配,签名与旧壳一致。 */
function notice(message, bad = false) {
  toast(String(message ?? ""), { ms: 5200, tone: bad ? "error" : "" });
}

/* export.js 的 openResponse() 里 `api(url,{signal})` 是自由变量,旧壳里对应
   全局 `async function api(...)`。留着不补,下载原件会抛 ReferenceError,
   被逐文件 catch 吞掉,最终表现为"每个附件都失败、ZIP 一个都打不进去"。 */
async function api(path, opts = {}) {
  return VaultStore.api(path, opts);
}

/* ---------------- 上传 ---------------- */

const UPLOADABLE_KINDS = ["project", "contract", "archive", "ip", "general"];

/* 批量上传:去重提示、阶段文案、取消全部由 ip-v2 + upload-progress 负责,
   这里只做「一次 begin / 逐件 file / 一次 finish」的编排。 */
async function uploadAttachments(files, node) {
  const list = Array.from(files || []);
  if (!list.length) return;

  const ownerId = node?.biz?.id;
  const kind = node?.biz?.kind;
  if (!ownerId || !UPLOADABLE_KINDS.includes(kind)) {
    return toast("当前记录无法接收附件");
  }

  const progress = CapabilityApi.uploadProgress;
  if (!progress.begin(list.length)) return toast("已有文件任务,请等待完成");

  const workspace = VaultStore.ws;
  const meta = { kind, ownerId };
  const errors = [];
  let completed = 0;
  let skipped = 0;

  try {
    for (let i = 0; i < list.length; i++) {
      if (progress.cancelled()) break;
      progress.file(list[i], i + 1);

      if (list[i].size > MAX_ORIGINAL_BYTES) {
        errors.push(`${list[i].name}:超过 8 GiB`);
        continue;
      }

      try {
        const saved = await globalThis.IPSysNativeIp.upload(CapabilityApi, list[i], meta, workspace);
        /* null = 用户在去重对话框里点了「取消上传」 */
        if (saved) completed++;
        else skipped++;
      } catch (e) {
        if (progress.cancelled() || e?.name === "AbortError") {
          skipped++;
          break;
        }
        errors.push(`${list[i].name}:${e.message}`);
      }
    }
  } finally {
    progress.finish({ completed, errors, skipped });
  }
}

/* ---------------- 上传新版本 / 关联原件 ---------------- */

/* 把本壳的附件节点翻译成 ip-v2 需要的 record。
   附件节点自己不记 ownerId,要顺着父节点找(fileMeta 只有 fileId/version)。 */
function recordOfAttachment(node) {
  const meta = VaultStore.fileMeta.get(node.id);
  if (!meta) return null;
  const owner = findParent(node.id);
  return {
    kind: node.biz?.ownerKind || owner?.biz?.kind || "",
    ownerId: owner?.biz?.id ?? null,
    fileId: meta.fileId,
    version: meta.version,
    category: node.biz?.category || "其他材料",
    name: node.name,
  };
}

async function uploadNewVersion(node) {
  if (!node || node.type !== "file") return;
  const record = recordOfAttachment(node);
  if (!record?.fileId || !record.ownerId) return toast("附件信息缺失,无法上传新版本");

  const result = await globalThis.IPSysNativeIp.newVersion(CapabilityApi, record, VaultStore.ws);
  if (result === true) toast("新版本已保存");
  else if (result instanceof Error) toast(result.message, { ms: 6000 });
}

/* F2-03：所有业务附件共用同一个 FileId/LinkId 关联操作。
   共享只新增 LinkId；移动在服务端事务内建目标 LinkId 并注销来源 LinkId。 */
async function associateOriginal(node, move = false, directTarget = null) {
  if (node?.type !== "file" || fileTaskBusy()) {
    return toast(fileTaskBusy() ? "有文件任务正在执行，请完成后再操作" : "请选择一条附件");
  }
  const meta = VaultStore.metaOf(node.id);
  const owner = findParent(node.id);
  const sourceKind = owner?.biz?.kind;
  const workspace = VaultStore.ws;
  if (!meta?.fileId || !meta?.linkId || !owner?.biz?.id ||
      !UPLOADABLE_KINDS.includes(sourceKind)) return toast("找不到有效的附件引用");

  const destinations = [];
  walkNodes((target) => {
    if (target.type !== "folder" ||
        !UPLOADABLE_KINDS.includes(target.biz?.kind) ||
        !Number.isSafeInteger(Number(target.biz?.id)) ||
        Number(target.biz.id) <= 0 ||
        target.biz.id === owner.biz.id) return;
    const path = (pathTo(target.id) || [])
      .filter((n) => n.id !== "root")
      .map((n) => n.name)
      .join(" › ");
    destinations.push({ value: String(target.biz.id), label: path || target.name });
  });
  if (!destinations.length) return toast("当前工作区没有其它可接收附件的业务记录");
  destinations.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));

  // Internal drag-and-drop bypasses the chooser, but uses the exact same
  // validate-and-commit callback as F2-03's context-menu operation.
  const submitAssociation = async (data) => {
    if (workspace !== VaultStore.ws) throw new Error("工作区已变化，请重新选择附件");
    if (fileTaskBusy()) throw new Error("有文件任务正在执行，请完成后再操作");
    const selected = destinations.find((d) => d.value === String(data.target));
    if (!selected) throw new Error("目标记录无效或已变化，请重新选择");
    const targetFolderId = Number(selected.value);
    let target = null;
    walkNodes((n) => {
      if (n.type === "folder" && UPLOADABLE_KINDS.includes(n.biz?.kind) &&
          Number(n.biz.id) === targetFolderId) target = n;
    });
    if (!target) throw new Error("目标记录已不存在，请刷新后重试");
    if ((target.children || []).some((child) =>
      child.type === "file" && Number(VaultStore.metaOf(child.id)?.fileId) === Number(meta.fileId))) {
      throw new Error("目标记录已经关联同一原件，请选择其它记录");
    }
    await VaultStore.api("/api/v2/files/" + workspace + "/" + meta.fileId + "/associate", {
      method: "POST",
      json: { linkId: meta.linkId, targetFolderId, move: !!move },
    });
    try {
      await refreshCurrent();
    } catch {
      toast("关联已提交，但列表刷新失败，请手动刷新", { tone: "error", ms: 6000 });
      return;
    }
    Drive.clearSelection();
    toast(move ? "附件已移至目标记录" : "原件已共享到目标记录");
  };
  if (directTarget) {
    if (!UPLOADABLE_KINDS.includes(directTarget.biz?.kind))
      throw new Error("只允许移动到真实业务记录");
    return submitAssociation({ target: String(directTarget.biz.id) });
  }
  RecordForms.open({
    title: move ? "移动附件关联" : "共享附件原件",
    submitText: move ? "确认移动" : "确认共享",
    fields: [{
      key: "target", type: "select", label: "目标业务记录",
      required: true, options: destinations,
      hint: move
        ? "移动后来源位置不再显示此附件；文件历史版本与其它共享关联保持不变。"
        : "目标记录新增一条附件引用，不重复存储原件；所有历史版本保持共用。",
    }],
    onSubmit: submitAssociation,
  });
}

/* F2-04: entire business folders; not the F2-03 attachment LinkId action.
   Whole-record copies duplicate logical FileIds and all versions; the backend
   refuses cross-workspace physical FileObject sharing. */
function recordTransferOptions(node, move) {
  const kind=node?.biz?.kind;
  const ws=VaultStore.ws;
  if(!["project","contract","ip","archive","general"].includes(kind)) return [];
  if(kind==="archive") {
    const section=node.biz.section;
    const modules={
      achievement:["company/achievement","personal/achievement","personal/academic"],
      academic:["company/achievement","personal/achievement","personal/academic"],
      certificate:[ws+"/certificate"],
    };
    const options=(modules[section]||[]).filter(item =>
      item===ws+"/"+section || section!=="certificate");
    return options.filter(item => !move || item!==ws+"/"+section).map(item=>({
      value:item,label:({ "company/achievement":"公司 · 业务档案",
        "personal/achievement":"个人 · 成果资料",
        "personal/academic":"个人 · 学术资料",
        "company/certificate":"公司 · 企业资质",
        "personal/certificate":"个人 · 资质证书" })[item]||item,
    }));
  }
  return ["company","personal"].filter(w=>!move || kind==="contract" || w!==ws)
    .map(w=>({value:w,label:w==="company"?"公司工作区":"个人工作区"}));
}

function transferBusinessRecord(node, move=false) {
  const kind=node?.biz?.kind, id=Number(node?.biz?.id);
  if(node?.type!=="folder" || !Number.isSafeInteger(id) || id<=0) return;
  if(fileTaskBusy()) return toast("当前有文件任务，请完成后再操作");
  const sourceWorkspace=VaultStore.ws;
  const choices=recordTransferOptions(node,move);
  if(!choices.length) return toast("当前记录没有受支持的目标工作区或类别");
  const typeLabel={project:"项目（含全部合同）",contract:"合同",
    ip:"知识产权",archive:"资料档案",general:"综合资料"}[kind]||"记录";
  RecordForms.open({
    title:(move?"移动/转移":"复制")+typeLabel,
    submitText:move?"继续转移":"确认复制",
    fields:[{key:"target",type:"select",label:"目标位置",required:true,
      options:choices,hint:move
        ?"跨工作区转移会复制完整原件历史并保留物理隔离，成功后原记录进入回收站。"
        :"复制整个记录和全部原件历史，不删除来源记录。"}],
    onSubmit:async data=>{
      if(VaultStore.ws!==sourceWorkspace) throw new Error("工作区已经切换，请重新选择");
      if(fileTaskBusy()) throw new Error("有其它文件任务正在执行");
      if(!choices.some(opt=>opt.value===data.target))
        throw new Error("所选位置无效，请重新选择");
      const targetWorkspace=data.target.split("/")[0];
      const targetSection=kind==="archive"?data.target.split("/")[1]:null;
      const route={
        project:"/api/v2/projects/",ip:"/api/v2/ip/",
        general:"/api/v2/ui/general/",contract:"/api/v2/contracts/",
        archive:"/api/v2/ui/archive/",
      };
      let endpoint=route[kind]+sourceWorkspace+"/";
      if(kind==="archive") endpoint+=node.biz.section+"/"+id+"/transfer";
      else endpoint+=id+"/transfer";
      const payload={targetWorkspace,move:!!move};
      if(kind==="archive") payload.targetSection=targetSection;
      const finish=async ()=>{
        // Response is an authoritative transaction result: never auto-retry
        // after successful remote commit even if local refresh fails.
        await VaultStore.api(endpoint,{method:"POST",json:payload});
        try {
          await refreshCurrent();
          Drive.clearSelection();
          toast(move?"记录已转移":"记录已复制");
        } catch {
          toast("事务已提交，界面刷新失败；请手动刷新验证目标记录",
            {tone:"error",ms:6000});
        }
      };
      if(kind!=="contract") return finish();

      // Contracts are never free-standing. Resolve an active project in the
      // destination workspace before opening a second target chooser.
      const projects=await VaultStore.getJson("/api/v2/ui/projects/"+targetWorkspace);
      if(!Array.isArray(projects))throw new Error("目标项目数据无效");
      const projectOptions=projects.filter(x=>Number.isSafeInteger(Number(x.id)) && Number(x.id)>0)
        .filter(x=> !(move&&sourceWorkspace===targetWorkspace &&
          Number(node.biz.projectId)===Number(x.id)))
        .map(x=>({value:String(x.id),label:x.name||"项目 "+x.id}));
      if(!projectOptions.length) throw new Error("目标工作区没有其它有效项目，请先创建项目");
      RecordForms.open({
        title:move?"选择合同的新所属项目":"选择复制合同的所属项目",
        submitText:move?"确认移动合同":"确认复制合同",
        fields:[{key:"targetProjectId",type:"select",label:"目标项目",required:true,
          options:projectOptions}],
        onSubmit:async next=>{
          if(VaultStore.ws!==sourceWorkspace)
            throw new Error("工作区已变化，请重新开始");
          if(fileTaskBusy())throw new Error("有其它文件任务正在执行");
          if(!projectOptions.some(x=>x.value===next.targetProjectId))
            throw new Error("目标项目无效");
          payload.targetProjectId=Number(next.targetProjectId);
          await finish();
        },
      });
    },
  });
}

/* 遍历当前已加载的整棵树(含未展开的分支)。 */
function walkNodes(visit) {
  walk(ROOT, (n) => visit(n));
}

/* ---------------- 导出 ---------------- */

/* 合同也算导出主体:export.js 的 owner() 对 kind==='contract' 有专门分支,
   会用 projectId/projectName 建「项目 / 合同 / 文件」三层目录。 */
const EXPORTABLE_KINDS = new Set(["project", "contract", "archive", "ip", "general"]);

/* 附件上方的 archive_folder 目录链(不含分类根)。export.js 用它在 ZIP 里重建目录树。 */
function archivePathOf(node) {
  const chain = [];
  let cur = findParent(node.id);
  while (cur && cur.biz?.kind === "archive_folder") {
    chain.unshift({ id: cur.biz.id, name: cur.name });
    cur = findParent(cur.id);
  }
  return chain;
}

/* 翻译成 export.js 的 selected[] 元素。
   validOriginal() 的硬约束:source ∈ {v2file,v2ip}、workspace、fileId>0、version>0、size≥0;
   当 source==='v2ip' 时还要求 ownerId>0。漏一项整批导出会被直接拒掉。 */
function exportEntryOf(node, owner, path) {
  const meta = VaultStore.fileMeta.get(node.id);
  if (!meta || !owner) return null;
  const ownerKind = node.biz?.ownerKind || owner.biz?.kind || "";
  if (!EXPORTABLE_KINDS.has(ownerKind)) return null;

  const entry = {
    kind: ownerKind,
    source: ownerKind === "ip" ? "v2ip" : "v2file",
    workspace: VaultStore.ws,
    ownerId: owner.biz?.id,
    ownerName: owner.name,
    section: node.biz?.section || "",
    fileId: meta.fileId,
    version: meta.version,
    name: node.name,
    size: node.size || 0,
  };
  if (path && path.length) entry.archiveFolderPath = path;
  /* export.js 的 owner() 认这三个字段才能把合同放回它所隶属的项目下;缺了
     projectId 会退化成项目根目录下的一层平铺。 */
  if (ownerKind === "contract") {
    entry.projectId = owner.biz?.projectId;
    entry.projectName = owner.biz?.projectName || owner.name;
  }
  return entry;
}

/* 深度优先摊平:选中一个目录就等于选中它下面的所有附件。 */
function collectExportEntries(node) {
  const out = [];

  if (node.type === "file") {
    const entry = exportEntryOf(node, findParent(node.id), archivePathOf(node));
    if (entry) out.push(entry);
    return out;
  }

  const visit = (cur, owner, path) => {
    if (cur.type === "file") {
      const entry = exportEntryOf(cur, owner, path);
      if (entry) out.push(entry);
      return;
    }
    const kind = cur.biz?.kind;
    let nextOwner = owner;
    let nextPath = path;
    if (kind === "archive_folder") {
      nextPath = [...path, { id: cur.biz.id, name: cur.name }];
    } else if (EXPORTABLE_KINDS.has(kind)) {
      nextOwner = cur;
    } else if (cur.id === "root") {
      nextOwner = null;
      nextPath = [];
    }
    for (const child of cur.children || []) visit(child, nextOwner, nextPath);
  };

  visit(node, null, []);
  return out;
}

/* 导出入口:单个附件直接下载,其余打包成 ZIP。
   目录结构、重名去重、ZIP64、超 4 GiB 分卷全由 export.js 负责。 */
async function exportNodes(nodes) {
  const list = (nodes || []).filter(Boolean);
  if (!list.length) return toast("请先选择要导出的内容");

  if (list.length === 1 && list[0].type === "file") return downloadFile(list[0].id);

  const exporter = globalThis.IPSysExport;
  if (!exporter) return toast("导出组件未加载,请刷新页面");
  if (exporter.isActive()) return toast("已有导出任务,请先完成或取消");

  const selected = [];
  for (const node of list) selected.push(...collectExportEntries(node));
  if (!selected.length) return toast("选中的内容里没有可导出的附件");

  await exporter.start("zip", selected);
}

/* ---------------- 彻底删除(服务端任务 + 字节进度) ----------------
   POST /api/trash/{ws}/purge-task 只负责受理并返回 taskId,真正的清理在服务端
   独立执行,浏览器轮询 GET /api/trash/purge-task 的快照。任务按整个 Vault 计,
   不按工作区 —— 所以用的是不带 workspace 的那个端点。
   进度 100% 也不等于事务已提交,只有 state=succeeded 才能宣告成功。 */

const PURGE_POLL_MS = 550;
const PURGE_DONE = new Set(["succeeded", "failed", "canceled"]);

let purgeTracking = false;
let purgeBatchActive = false;

function purgePanel() {
  let p = $("#trashPurgeProgress");
  if (p) return p;
  p = document.createElement("section");
  p.id = "trashPurgeProgress";
  p.className = "upload-progress";
  p.setAttribute("role", "region");
  p.setAttribute("aria-label", "彻底删除进度");
  p.innerHTML = `
    <div class="upload-progress-heading"><strong>彻底删除进度</strong><span id="trashPurgeCount"></span></div>
    <div class="upload-progress-meter">
      <progress id="trashPurgeMeter" max="100"></progress>
      <strong id="trashPurgePercent">准备中</strong>
    </div>
    <div class="upload-progress-bytes" id="trashPurgeBytes"></div>
    <div class="upload-progress-stage" id="trashPurgeStage" role="status" aria-live="polite"></div>
    <div class="upload-progress-actions">
      <button type="button" class="btn btn-sm" id="trashPurgeClose" hidden>关闭</button>
    </div>`;
  p.hidden = true;
  document.body.append(p);
  p.querySelector("#trashPurgeClose").addEventListener("click", () => {
    if (!purgeTaskActive) p.hidden = true;
  });
  return p;
}

function renderPurge(state) {
  const panel = purgePanel();
  const field = (id) => panel.querySelector(`#${id}`);
  const done = PURGE_DONE.has(state.state);
  const total = Number(state.bytesTotal) || 0;
  const bytes = Number(state.bytesDone) || 0;

  panel.hidden = false;
  field("trashPurgeCount").textContent = `共 ${state.count} 条记录`;

  const meter = field("trashPurgeMeter");
  if (state.state === "succeeded") {
    meter.value = 100;
    field("trashPurgePercent").textContent = "完成";
  } else if (total > 0) {
    const percent = Math.min(100, Math.floor((bytes / total) * 100));
    meter.value = percent;
    field("trashPurgePercent").textContent = `${percent}%`;
  } else {
    /* 只清元数据时没有总字节数,用不确定态而不是假装 0% */
    meter.removeAttribute("value");
    field("trashPurgePercent").textContent = done ? "—" : "处理中";
  }

  field("trashPurgeBytes").textContent =
    total > 0
      ? `已清理加密原件数据 ${fmtSize(bytes)} / ${fmtSize(total)}`
      : "本次只清理关联或元数据,没有需要释放的原件字节";

  field("trashPurgeStage").textContent =
    `${state.stage || ""}${state.error ? `:${state.error}` : ""}` +
    (done ? "。数据库文件大小不一定立即缩小。" : "。事务提交前不代表删除成功。");

  field("trashPurgeClose").hidden = !done;
}

/* 404 = 没有任务,不是错误,直接用 fetch 而不是 VaultStore.api —— api() 会把
   404 当成失败抛出来,分不清「没任务」和「查询失败」。 */
async function purgeSnapshot() {
  const headers = VaultStore.token ? { "X-IPSys-Token": VaultStore.token } : {};
  const res = await fetch("/api/trash/purge-task", { headers, cache: "no-store" });
  if (res.status === 404) return null;
  if (res.status === 401) {
    VaultStore.token = "";
    VaultStore.locked = true;
    throw new Error("登录已失效,请重新解锁资料库");
  }
  if (!res.ok) throw new Error(`删除进度查询失败:HTTP ${res.status}`);
  return res.json();
}

async function trackPurge(taskId, workspace, silent = false) {
  if (purgeTracking) return null;
  purgeTracking = true;
  purgeTaskActive = true;
  try {
    while (VaultStore.token) {
      let state;
      try {
        state = await purgeSnapshot();
        /* 身份对不上说明这一轮已经结束、服务端另开了新任务 —— 不能把别人的
           进度当成自己的,更不能据此宣告成功。 */
        if (!state || state.taskId !== taskId || state.workspace !== workspace) {
          throw new Error("删除任务身份已变化,请检查回收站");
        }
        renderPurge(state);
      } catch (e) {
        const panel = purgePanel();
        panel.hidden = false;
        panel.querySelector("#trashPurgeStage").textContent =
          `暂时无法获取删除进度:${e.message}。正在重试查询服务端,删除结果尚未确认。`;
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }

      if (PURGE_DONE.has(state.state)) {
        if (!silent) {
          if (state.state === "succeeded") {
            try {
              await refreshCurrent();
              Drive.clearSelection();
              toast(`已彻底删除 ${state.count} 条记录`);
            } catch {
              toast("删除已提交,但列表刷新失败,请重新进入回收站", { tone: "error" });
            }
          } else {
            toast(state.error || "删除未完成,数据库已回滚", { tone: "error", ms: 6000 });
          }
        }
        return state;
      }
      await new Promise((r) => setTimeout(r, PURGE_POLL_MS));
    }
    return null;
  } finally {
    purgeTracking = false;
    if (!purgeBatchActive) purgeTaskActive = false;
  }
}

/* 服务端每项任务最多 200 条，批量清空按受控串行任务分批；
   每批须有成功终态且任务写锁已释放后才能提交下一批。 */
async function waitPurgeIdle() {
  for (let n = 0; n < 90; n++) {
    const task = await VaultStore.getJson("/api/task");
    if (!task.active) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("上一批彻底删除仍占用数据库，请稍后检查回收站");
}

/* 真正发起彻底删除。调用方只负责确认，进度与结果归这里。 */
async function purgeTrash(nodes) {
  const unique = new Map();
  for (const node of nodes || []) {
    const r = node.biz?.raw;
    if (r?.id > 0 && r.kind) unique.set(r.kind + ":" + r.id + ":" + (r.section || ""),
      { kind: r.kind, id: r.id, section: r.section || "" });
  }
  const items = [...unique.values()];
  if (!items.length) return toast("这些条目缺少回收站标识");
  if (purgeTaskActive) return toast("已有彻底删除任务在执行，请看右下角进度");

  const workspace = VaultStore.ws;
  const batches = [];
  for (let i = 0; i < items.length; i += 200) batches.push(items.slice(i, i + 200));
  const panel = purgePanel();
  panel.hidden = false;
  panel.querySelector("#trashPurgeClose").hidden = true;
  panel.querySelector("#trashPurgeMeter").removeAttribute("value");
  panel.querySelector("#trashPurgePercent").textContent = "准备中";
  panel.querySelector("#trashPurgeBytes").textContent = "";
  purgeBatchActive = true;
  purgeTaskActive = true;
  let confirmed = 0;

  try {
    for (let i = 0; i < batches.length; i++) {
      if (i) await waitPurgeIdle();
      panel.querySelector("#trashPurgeCount").textContent =
        "共 " + items.length + " 条 · 第 " + (i + 1) + "/" + batches.length + " 批";
      panel.querySelector("#trashPurgeStage").textContent =
        "已确认删除 " + confirmed + " 条，正在提交第 " + (i + 1) + " 批";
      panel.querySelector("#trashPurgeClose").hidden = true;
      const task = await VaultStore.api("/api/trash/" + workspace + "/purge-task", {
        method: "POST", json: { items: batches[i] },
      }).then((r) => r.json());
      const state = await trackPurge(task.taskId, workspace, true);
      if (!state || state.state !== "succeeded") {
        throw new Error(state?.error || "本批删除结果尚未确认，停止后续批次");
      }
      confirmed += batches[i].length;
    }
    try {
      await refreshCurrent();
      Drive.clearSelection();
      toast("已彻底删除 " + confirmed + " 条记录");
    } catch {
      toast("删除已提交，但列表刷新失败，请重新进入回收站", { tone: "error" });
    }
  } catch (e) {
    /* 不回滚已经成功提交的批次，也绝不把未确认的批次说成成功。 */
    try { await refreshCurrent(); } catch {}
    toast("已确认删除 " + confirmed + " / " + items.length +
      " 条；" + (e.message || String(e)) + "。请核查剩余回收站记录",
      { ms: 9000, tone: "error" });
    panel.querySelector("#trashPurgeStage").textContent =
      "只确认完成 " + confirmed + " / " + items.length + " 条；其余未确认";
  } finally {
    purgeBatchActive = false;
    purgeTaskActive = false;
    panel.querySelector("#trashPurgeClose").hidden = false;
  }
}

/* 刷新页面或重进回收站时把还在跑的任务接回来 —— 否则用户一关页面就再也
   看不到删除是否成功,只能靠猜。 */
async function resumePurge() {
  if (purgeTracking || purgeTaskActive || !VaultStore.token) return false;
  let state;
  try {
    state = await purgeSnapshot();
  } catch {
    return false;
  }
  if (!state) return false;
  renderPurge(state);
  if (PURGE_DONE.has(state.state)) return false;
  void trackPurge(state.taskId, state.workspace);
  return true;
}
