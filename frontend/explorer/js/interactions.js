/* ==========================================================================
   交互层 — OneDrive 的指针/键盘模型
   --------------------------------------------------------------------------
   单击选中、Ctrl/Shift 多选、双击进入、右键菜单、框选、拖拽、F2 重命名、
   Delete 删除、Backspace 返回上级。所有业务动作直接调用原服务端接口。
   ========================================================================== */

/* ---------------- 基础 UI ---------------- */

function toast(msg, { action, onAction, ms = 3400, tone = "" } = {}) {
  const host = $("#toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = tone ? `toast is-${tone}` : "toast";
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement("button");
    b.className = "t-action";
    b.textContent = action;
    b.addEventListener("click", () => {
      onAction?.();
      el.remove();
    });
    el.append(b);
  }
  host.append(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 220);
  }, ms);
}

let _resolveConfirm = null;
function askConfirm({ title = "确认", text = "", okText = "确定", danger = false } = {}) {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  const ok = $("#confirmOk");
  ok.textContent = okText;
  ok.classList.toggle("danger", danger);
  $("#confirmMask").classList.add("show");
  return new Promise((resolve) => {
    _resolveConfirm = resolve;
  });
}

function settleConfirm(v) {
  $("#confirmMask").classList.remove("show");
  _resolveConfirm?.(v);
  _resolveConfirm = null;
}

const MI = (act, ic, label, shortcut = "", danger = false, disabled = false) =>
  `<button class="ctx-item ${danger ? "danger" : ""}" data-act="${act}" ${disabled ? "disabled" : ""}>
    ${ic ? (ic.startsWith("cat:") ? catIcon(ic.slice(4), 18) : icon(ic, 18)) : '<span class="ctx-dot"></span>'}
    <span>${label}</span>
    ${shortcut ? `<kbd>${shortcut}</kbd>` : ""}
  </button>`;

function showCtx(x, y, html, handlers) {
  const menu = $("#ctxMenu");

  /* 先解绑上一次的处理器:同一元素会被反复复用,
     只记最后一个 cleanup 会让旧监听器累积并抢走本次点击。 */
  hideCtx();

  menu.innerHTML = html;
  menu.classList.add("show");
  menu.style.left = "0px";
  menu.style.top = "0px";

  const r = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 8);
  const py = Math.min(y, window.innerHeight - r.height - 8);
  menu.style.left = `${Math.max(8, px)}px`;
  menu.style.top = `${Math.max(8, py)}px`;

  const onClick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    hideCtx();
    handlers[act]?.(b);
  };
  menu.addEventListener("click", onClick);
  menu._cleanup = () => menu.removeEventListener("click", onClick);
}

function hideCtx() {
  const menu = $("#ctxMenu");
  menu.classList.remove("show");
  menu._cleanup?.();
  $("#wsSwitchBtn")?.setAttribute("aria-expanded", "false");
}

document.addEventListener("mousedown", (e) => {
  /* 工作区按钮自己要处理「再点一次收起」,这里不抢它的 mousedown */
  if (e.target.closest("#ctxMenu") || e.target.closest("#wsSwitchBtn")) return;
  hideCtx();
});

/* ---------------- 节点解析 ---------------- */

/* id 前缀:
   root / k:分类 / af:业务档案目录 / p:项目 / a:section:档案 / i:知产 / g:综合 / f:link:版本 / t:kind:id */
function nodeTag(id) {
  return String(id).split(":")[0];
}

function isTrashNode(id) {
  return nodeTag(id) === "t";
}

function bizKindOf(node) {
  const b = node.biz || {};
  if (b.kind) return b.kind;
  const t = nodeTag(node.id);
  return { p: "project", af: "archive_folder", a: "archive", i: "ip", g: "general" }[t] || "";
}

/* ==========================================================================
   Boot
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  bootStaticIcons();
  Drive.render();
  if (typeof bootInteractions === "function") bootInteractions();
  startSession();
});

async function startSession() {
  try {
    const st = await VaultStore.status();
    if (st.unlocked && sessionStorage.getItem("od-token")) {
      VaultStore.token = sessionStorage.getItem("od-token");
      VaultStore.dbName = sessionStorage.getItem("od-db") || "";
      try {
        await VaultStore.api("/api/check");
        await enterWorkspace(defaultWorkspace());
        return;
      } catch {
        VaultStore.token = "";
        sessionStorage.clear();
      }
    }
  } catch (e) {
    showLogin(`本地服务不可用:${e.message}`);
    return;
  }
  showLogin();
}

function showLogin(hint) {
  const mask = $("#lockScreen");
  if (!mask) return;
  mask.classList.add("show");
  const hp = $("#lockHint");
  if (hp) hp.textContent = hint || "";

  VaultStore.getJson("/api/status")
    .then((s) => {
      /* 服务端已解锁但没有 token:改为密码恢复模式,路径只读 */
      VaultStore.needsResume = !!s.unlocked;
      const p = $("#dbPath");
      if (p && s.suggestion) p.value = s.suggestion;
      if (s.unlocked) {
        if (p) p.disabled = true;
        const sub = $(".lock-sub");
        if (sub) sub.textContent = "资料库仍处于打开状态。输入密码即可重新连接，数据全部保存在本地。";
      }
    })
    .catch(() => {});
}

/* 登录后统一进个人工作区。OneDrive 的默认落点就是「我的文件」,
   个人/企业是企业网盘附加的维度,不该抢默认位置。
   这里刻意不记忆上次选择:每次进来都从个人开始,需要看企业再手动切。 */
function defaultWorkspace() {
  /* 默认落在个人资料;设置里改过「启动工作区」就按设置来。
     注意:顶栏临时切换不写这个键,只有设置面板会改它。 */
  return Prefs.get("startWs", "personal") === "company" ? "company" : "personal";
}

async function enterWorkspace(ws) {
  ws = ws === "company" ? "company" : "personal";

  $("#lockScreen")?.classList.remove("show");
  const shell = $("#appShell");
  shell?.removeAttribute("aria-hidden");

  Drive.state.ready = false;
  Drive.state.loadError = null;
  Drive.state.wsPending = ws;
  /* 命中项是旧树里的节点引用,重建树之后全部作废 */
  Drive.resetSearch();
  Drive.render();

  try {
    await VaultStore.loadAll(ws);
    Drive.state.ready = true;
    Drive.state.wsPending = null;
    Drive.state.folderId = "root";
    Drive.state.view = "home";
    Drive.navigate("home");
    const av = $("#btnAvatar");
    if (av) av.title = VaultStore.dbName || ME.name;
    /* 上次关页面时可能还有一个彻底删除任务在跑,接回来继续看进度 */
    void resumePurge();
  } catch (e) {
    Drive.state.ready = false;
    Drive.state.loadError = e.message;
    Drive.state.wsPending = null;
    Drive.render();
  }
}

/* 切换工作区:两套资料在服务端是独立命名空间,必须整树重载。
   文件夹 id 也带工作区前缀,不能沿用旧位置,统一回首页。 */
async function switchWorkspace(ws) {
  if (Drive.state.wsPending) {
    toast("正在加载，请稍候");
    return;
  }
  /* 上传/导出还在跑时切工作区,请求会落到新工作区的路径上,服务端收到的是
     错配的 folderId;导出则是把旧工作区的树画到新界面上。直接挡住。 */
  if (fileTaskBusy()) {
    toast("文件任务进行中,完成后再切换工作区", { ms: 5000 });
    return;
  }
  const cur = VaultStore.ws === "company" ? "company" : "personal";
  if (ws === cur) {
    toast(ws === "personal" ? "当前已在个人工作区" : "当前已在企业工作区");
    return;
  }
  Drive.state.selection.clear();
  Drive.state.history = [];
  await enterWorkspace(ws);
  if (!Drive.state.loadError) {
    toast(ws === "personal" ? "已切换到个人工作区" : "已切换到企业工作区");
  }
}

/* ==========================================================================
   Bind
   ========================================================================== */

function bootInteractions() {
  bindLockScreen();
  bindWorkspaceSwitch();
  bindTopBar();
  bindNav();
  bindCmdbar();
  bindContent();
  bindSelectionBar();
  bindDetail();
  bindSearch();
  bindSettings();
  bindKeyboard();
  bindOverlays();
  bindExcelActions();
}

function bindLockScreen() {
  const form = $("#lockForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#submitOpen");
    btn.disabled = true;
    $("#lockHint").textContent = "";
    try {
      if (VaultStore.needsResume) {
        await VaultStore.resume($("#password").value);
      } else {
        await VaultStore.open($("#dbPath").value.trim(), $("#password").value, false);
      }
      sessionStorage.setItem("od-token", VaultStore.token);
      sessionStorage.setItem("od-db", VaultStore.dbName);
      $("#password").value = "";
      await enterWorkspace(defaultWorkspace());
    } catch (err) {
      $("#lockHint").textContent = err.message;
      btn.disabled = false;
    }
  });
}

function bindWorkspaceSwitch() {
  const btn = $("#wsSwitchBtn");
  if (!btn) return;

  const item = (ws, ic, label, cur) => `
    <button class="ctx-item ${ws === cur ? "is-current" : ""}" data-act="ws:${ws}">
      ${icon(ic, 18)}
      <span>${label}</span>
      ${ws === cur ? `<span class="ctx-check">${icon("check", 14)}</span>` : ""}
    </button>`;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if ($("#ctxMenu").classList.contains("show")) {
      hideCtx();
      return;
    }
    const cur = VaultStore.ws === "personal" ? "personal" : "company";
    const r = btn.getBoundingClientRect();
    showCtx(
      r.left,
      r.bottom + 6,
      [
        '<div class="ctx-title">切换工作区</div>',
        item("personal", "user", "个人工作区", cur),
        item("company", "building", "企业工作区", cur),
        '<div class="ctx-sep"></div>',
        `<div class="ctx-note">两套资料的分类与记录相互独立</div>`,
      ].join(""),
      {
        "ws:company": () => switchWorkspace("company"),
        "ws:personal": () => switchWorkspace("personal"),
      }
    );
    btn.setAttribute("aria-expanded", "true");
  });
}

function bindTopBar() {
  $("#brandBtn").addEventListener("click", () => Drive.navigate("home"));

  $("#btnHelp").addEventListener("click", () =>
    toast("单击选中,Ctrl 多选,Shift 连选,双击打开,右键更多")
  );

  $("#btnSettings").addEventListener("click", () => openSettings());

  $("#btnAvatar").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const other = VaultStore.ws === "company" ? "personal" : "company";
    showCtx(
      r.right - 210,
      r.bottom + 6,
      [
        `<div class="ctx-title">${esc(VaultStore.dbName || "资料库")}</div>`,
        MI("switch", "user", VaultStore.ws === "company" ? "切换到个人资料" : "切换到公司资料"),
        MI("settings", "settings", "设置"),
        '<div class="ctx-sep"></div>',
        MI("reload", "refresh", "刷新"),
        '<div class="ctx-sep"></div>',
        MI("lock", "info", "关闭资料库"),
      ].join(""),
      {
        switch: () => switchWorkspace(other),
        settings: () => openSettings(),
        reload: () => enterWorkspace(VaultStore.ws),
        lock: () => lockVault(),
      }
    );
  });
}

/* ---------------- 设置 ---------------- */

function openSettings() {
  const mask = $("#settingsMask");
  if (!mask) return;
  paintSettings();
  mask.classList.add("show");
}

function closeSettings() {
  $("#settingsMask")?.classList.remove("show");
}

function paintSettings() {
  const startWs = Prefs.get("startWs", "personal") === "company" ? "company" : "personal";

  $$("#settingsMask .seg").forEach((seg) => {
    const cur = seg.dataset.seg === "startWs" ? startWs : Drive.state.viewMode;
    $$("button", seg).forEach((b) => b.classList.toggle("is-on", b.dataset.v === cur));
  });

  const detail = $("#setDetail");
  if (detail) detail.checked = !!Drive.state.detailOpen;

  const db = $("#setDb");
  if (db) db.textContent = VaultStore.dbName || "未打开";
  /* 工作区与版本压到底栏一行:它们只读、只用于确认"我在哪",不值得占一整组 */
  const meta = $("#setFootMeta");
  if (meta) {
    meta.textContent = `${VaultStore.ws === "company" ? "企业工作区" : "个人工作区"} · 资料库 Web 0.9`;
  }

  /* 数据库块的三项状态都要现拉:MCP 开关是服务端状态,压缩信息每次都变,
     写死在 HTML 里会立刻过期。 */
  void paintMcpRow();
  void paintCompactRow();
}

/* ---------------- 设置 · 数据库块 ---------------- */

/* 压缩任务进行中时这个对象非空。对话框关掉再打开也要能接着显示,
   所以状态放在模块级而不是 DOM 上。 */
let compactTask = null;

function setCompactUi(text, { busy = false, can = false, tone = "" } = {}) {
  const btn = $("#setCompact");
  const msg = $("#setCompactMsg");
  if (!btn || !msg) return;
  msg.textContent = text;
  msg.className = tone;
  btn.textContent = busy ? "压缩中…" : "压缩";
  btn.disabled = busy || !can;
}

async function paintCompactRow() {
  const btn = $("#setCompact");
  if (!btn) return;
  if (compactTask) {
    setCompactUi("正在压缩，请保持程序运行…", { busy: true });
    return;
  }
  setCompactUi("正在读取空间信息…");
  try {
    const i = await VaultStore.getJson("/api/vault/compact/info");
    const bytes = Number(i.fileBytes) || 0;
    const free = Number(i.reusableBytes) || 0;
    setCompactUi(`当前 ${fmtSize(bytes) || "0 B"} · 空闲页约 ${fmtSize(free) || "0 B"}`, {
      can: !!i.canCompact,
    });
    btn.title = i.canCompact
      ? "永久删除释放的空间可被后续写入复用；压缩需额外磁盘空间，期间请勿关闭程序，不会自动备份"
      : "磁盘或系统临时目录剩余空间不足";
  } catch (e) {
    setCompactUi("无法读取空间信息：" + e.message);
  }
}

async function paintMcpRow() {
  const box = $("#setMcp");
  const msg = $("#setMcpMsg");
  if (!box || !msg) return;
  box.disabled = true;
  try {
    const r = await VaultStore.getJson("/api/mcp");
    box.checked = !!r.enabled;
    msg.textContent = r.enabled
      ? "已开启 · 本机可通过 MCP 操作资料库"
      : "默认关闭 · 仅当前 Windows 用户可用";
    box.disabled = false;
  } catch (e) {
    box.checked = false;
    msg.textContent = "当前环境不支持本机 MCP";
  }
}

async function runIntegrityCheck(btn) {
  const msg = $("#setCheckMsg");
  if (!msg) return;
  btn.disabled = true;
  msg.className = "";
  msg.textContent = "正在检查…";
  try {
    const r = await VaultStore.getJson("/api/check");
    /* 真实后端返回 { result, incomplete };预览服务早期只回了 { ok } */
    const result = r.result || (r.ok ? "ok" : "error");
    const ok = result === "ok";
    const inc = Number(r.incomplete) || 0;
    msg.className = ok ? "is-ok" : "is-bad";
    msg.textContent = ok
      ? `完整性正常，未完成附件 ${inc} 个`
      : `完整性异常：${result}`;
    if (ok) toast("数据库完整性检查通过");
  } catch (e) {
    msg.className = "is-bad";
    msg.textContent = "检查失败：" + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function startCompact() {
  if (compactTask) return;
  let info;
  try {
    info = await VaultStore.getJson("/api/vault/compact/info");
  } catch (e) {
    toast("无法读取空间信息：" + e.message);
    return;
  }
  if (!info.canCompact) {
    toast("磁盘或临时目录剩余空间不足，暂不能压缩");
    return;
  }
  const ok = await askConfirm({
    title: "压缩数据库",
    text:
      `数据库文件 ${fmtSize(Number(info.fileBytes) || 0)}，其中约 ${fmtSize(Number(info.reusableBytes) || 0)} 可回收。` +
      `压缩需要额外约 ${fmtSize(Number(info.requiredFreeBytes) || 0)} 磁盘空间，期间请勿关闭程序，也不会自动备份。`,
    okText: "开始压缩",
    danger: true,
  });
  if (!ok) return;

  try {
    const res = await VaultStore.api("/api/vault/compact", {
      method: "POST",
      json: { confirm: true },
    });
    const r = await res.json();
    compactTask = { id: r.taskId, timer: null };
    setCompactUi("正在压缩，请保持程序运行…", { busy: true });
    void pollCompact();
  } catch (e) {
    toast("无法启动压缩：" + e.message);
  }
}

async function pollCompact() {
  if (!compactTask) return;
  let st;
  try {
    st = await VaultStore.getJson("/api/vault/compact/task");
    if (compactTask && st.taskId && st.taskId !== compactTask.id) {
      throw new Error("压缩任务身份已变化");
    }
  } catch (e) {
    /* 读不到状态不等于任务失败,继续重试 */
    if (!compactTask) return;
    setCompactUi("状态暂时无法获取，继续重试…", { busy: true });
    compactTask.timer = setTimeout(pollCompact, 1300);
    return;
  }

  const terminal = ["succeeded", "failed", "canceled"].includes(st.state);
  if (!terminal) {
    setCompactUi(`${st.stage || "处理中"}…请保持程序运行`, { busy: true });
    compactTask.timer = setTimeout(pollCompact, 700);
    return;
  }

  clearTimeout(compactTask.timer);
  compactTask = null;
  if (st.state === "succeeded") {
    toast(
      `数据库压缩完成：${fmtSize(Number(st.bytesBefore) || 0)} → ${fmtSize(Number(st.bytesAfter) || 0)}`
    );
  } else {
    toast(`压缩未完成：${st.error || st.stage || st.state}`);
  }
  void paintCompactRow();
}

/* 头像菜单和设置面板共用同一段关库逻辑 */
async function lockVault() {
  const ok = await askConfirm({
    title: "关闭资料库",
    text: "关闭后需要重新输入密码，程序继续运行。",
    okText: "关闭",
    danger: true,
  });
  if (!ok) return;
  closeSettings();
  try {
    await VaultStore.api("/api/lock", { method: "POST" });
  } catch {}
  VaultStore.token = "";
  sessionStorage.clear();
  location.reload();
}

function bindSettings() {
  $("#settingsClose").addEventListener("click", closeSettings);
  $("#settingsDone").addEventListener("click", closeSettings);
  $("#settingsMask").addEventListener("mousedown", (e) => {
    if (e.target.id === "settingsMask") closeSettings();
  });

  $("#setCheck").addEventListener("click", (e) => runIntegrityCheck(e.currentTarget));
  $("#setCompact").addEventListener("click", () => startCompact());
  $("#setLock").addEventListener("click", () => lockVault());

  $("#setMcp").addEventListener("change", async (e) => {
    const box = e.currentTarget;
    const msg = $("#setMcpMsg");
    const want = box.checked;
    box.disabled = true;
    try {
      const res = await VaultStore.api("/api/mcp", { method: "POST", json: { enabled: want } });
      const r = await res.json();
      box.checked = !!r.enabled;
      if (msg) {
        msg.className = "";
        msg.textContent = r.enabled
          ? "已开启 · 本机可通过 MCP 操作资料库"
          : "默认关闭 · 仅当前 Windows 用户可用";
      }
      toast(r.enabled ? "已启用本机 MCP" : "已关闭本机 MCP");
    } catch (err) {
      box.checked = !want;
      if (msg) {
        msg.className = "is-bad";
        msg.textContent = "切换失败：" + err.message;
      }
    } finally {
      box.disabled = false;
    }
  });

  $("#settingsMask").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg button");
    if (!btn) return;
    const seg = btn.closest(".seg");
    const v = btn.dataset.v;

    if (seg.dataset.seg === "startWs") {
      Prefs.set("startWs", v);
      paintSettings();
      toast(`下次打开直接进入${v === "company" ? "企业" : "个人"}工作区`);
      return;
    }

    if (seg.dataset.seg === "view") {
      Prefs.set("view", v);
      Drive.state.viewMode = v;
      paintSettings();
      Drive.render();
    }
  });

  $("#setDetail").addEventListener("change", (e) => {
    const on = e.target.checked;
    Prefs.set("detail", on ? "1" : "0");
    Drive.state.detailOpen = on;
    Drive.renderDetail();
  });
}

function bindNav() {
  document.addEventListener("click", (e) => {
    /* 表头是动态生成的(列集变了就重建),所以勾选框和列排序必须走委托:
       一次性 addEventListener 绑在旧元素上,innerHTML 一换就失效。 */
    if (e.target.closest("#selectAll")) {
      Drive.toggleSelectAll();
      return;
    }
    const th = e.target.closest("#listHead .th-sort");
    if (th) {
      sortBy(th.dataset.sort);
      return;
    }

    /* 面包屑:点任意一段回到那一层(根节点 id 是 root,findById 认它) */
    const crumb = e.target.closest("[data-crumb]");
    if (crumb) {
      const id = crumb.dataset.crumb;
      if (id !== Drive.state.folderId) Drive.openFolder(id);
      return;
    }

    const nav = e.target.closest("[data-nav]");
    if (nav) {
      Drive.navigate(nav.dataset.nav);
      return;
    }
    const quick = e.target.closest("[data-quick]");
    if (quick) {
      Drive.state.history.push({ view: Drive.state.view, folderId: Drive.state.folderId });
      Drive.state.view = "files";
      Drive.state.folderId = quick.dataset.quick;
      Drive.state.selection.clear();
      Drive.state.query = "";
      Drive.resetSearch();
      const si = $("#searchInput");
      if (si) si.value = "";
      Drive.enterContext();
      Drive.render();
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) {
      const id = open.dataset.open;
      const node = findById(id);
      if (node?.type === "folder") Drive.openFolder(id);
      return;
    }
    /* 首页页头的主操作:命令栏在首页是隐藏的,入口在这里 */
    const pageAct = e.target.closest("[data-page-act]");
    if (pageAct) {
      const a = pageAct.dataset.pageAct;
      if (a === "upload") pickFiles();
      else if (a === "new") openNewMenu(pageAct);
      return;
    }
    if (e.target.closest("[data-retry]")) {
      enterWorkspace(VaultStore.ws);
    }
  });

  $("#btnNewSide").addEventListener("click", (e) => openNewMenu(e.currentTarget));
  $("#btnPinFolder").addEventListener("click", () => toast("「快捷访问」已按资料分类自动生成"));
}

function bindCmdbar() {
  $("#btnNew").addEventListener("click", (e) => openNewMenu(e.currentTarget));
  $("#btnUpload").addEventListener("click", () => pickFiles());

  $("#btnRefresh").addEventListener("click", async () => {
    const keep = Drive.state.folderId;
    await enterWorkspace(VaultStore.ws);
    const node = findById(keep);
    if (node) {
      Drive.state.folderId = keep;
      Drive.state.view = "files";
      Drive.render();
    }
    toast("已刷新");
  });

  $("#btnEmptyTrash").addEventListener("click", () => emptyRecycle());

  $("#btnSort").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = Drive.state;
    /* 台账里能排的是该分类的列;通用视图仍是文件语义的三项。
       名称列在列集里叫 _name,但排序键统一是 name —— 菜单直接用列标题,不再单列一项。 */
    const cols = Drive.columns();
    const items = cols
      ? cols.map((c) => [c.k === "_name" ? "name" : c.k, c.t])
      : [["name", "名称"], ["mtime", "修改日期"], ["size", "大小"]];
    showCtx(
      r.left,
      r.bottom + 6,
      items.map(([key, label]) => MI(`s-${key}`, s.sortBy === key ? "check" : "", label)).join("") +
        '<div class="ctx-sep"></div>' +
        MI("dir", "sort", s.sortDir === "asc" ? "升序" : "降序"),
      {
        ...Object.fromEntries(items.map(([key]) => [`s-${key}`, () => sortBy(key)])),
        dir: () => {
          s.sortDir = s.sortDir === "asc" ? "desc" : "asc";
          Drive.render();
        },
      }
    );
  });

  $("#btnFilter").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = Drive.state;

    /* 台账里筛的是「状态」,通用视图里筛的是扩展名。
       台账那一屏全是文件夹,按扩展名筛等于把列表清空,所以两条路分开走。 */
    if (Drive.columns()) {
      const pool = [...new Set((Drive.currentFolder.children || []).map((n) => n.biz?.status).filter(Boolean))];
      if (!pool.length) {
        toast("这个分类的记录还没有状态字段");
        return;
      }
      const opts = pool.map((v, i) => ({ id: `v-${i}`, label: v }));
      const apply = (v) => {
        s.statusFilter = v;
        Drive.renderContent();
        Drive.renderChrome();
      };
      showCtx(
        r.left,
        r.bottom + 6,
        MI("vf-all", s.statusFilter ? "" : "check", "全部状态") +
          '<div class="ctx-sep"></div>' +
          opts.map((o) => MI(o.id, s.statusFilter === o.label ? "check" : "", o.label)).join(""),
        {
          "vf-all": () => apply(null),
          ...Object.fromEntries(opts.map((o) => [o.id, () => apply(o.label)])),
        }
      );
      return;
    }

    const groups = [
      ["文档", ["doc", "docx", "pdf", "txt", "md", "wps"]],
      ["表格", ["xls", "xlsx", "csv"]],
      ["演示", ["ppt", "pptx"]],
      ["图片", ["png", "jpg", "jpeg", "gif", "webp", "bmp"]],
      ["压缩包", ["zip", "rar", "7z"]],
    ];
    showCtx(
      r.left,
      r.bottom + 6,
      MI("all", "minus", "全部文件") + '<div class="ctx-sep"></div>' + groups.map(([l], i) => MI(`g-${i}`, "filter", l)).join(""),
      {
        all: () => filterExt(null),
        ...Object.fromEntries(groups.map(([, exts], i) => [`g-${i}`, () => filterExt(exts)])),
      }
    );
  });

  $("#btnViewToggle").addEventListener("click", () => {
    Drive.state.viewMode = Drive.state.viewMode === "list" ? "grid" : "list";
    Drive.render();
  });

  $("#btnDetailToggle").addEventListener("click", () => {
    Drive.state.detailOpen = !Drive.state.detailOpen;
    Drive.renderDetail();
    Drive.renderChrome();
  });

}

function sortBy(key) {
  const s = Drive.state;
  if (s.sortBy === key) s.sortDir = s.sortDir === "asc" ? "desc" : "asc";
  else {
    s.sortBy = key;
    s.sortDir = "asc";
  }
  Drive.render();
}

function filterExt(exts) {
  Drive.state.extFilter = exts;
  Drive.renderContent();
  Drive.renderChrome();
}

/* ---------------- 新建菜单 ---------------- */

function openNewMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  const s = Drive.state;

  /* 首页没有"当前分类",新建时全部开放:表单提交时会把 kind/section
     写进自己的接口地址,记录自然落到对应分类,不依赖当前目录。 */
  const onHome = s.view === "home" && !s.query.trim();
  const tag = nodeTag(s.folderId);
  const cur = tag === "k" ? s.folderId.slice(2) : "";
  /* 公司「业务档案」的目录节点:在这里新建 = 建到该目录下 */
  const inDir = tag === "af" ? "achievement" : "";
  const parentId = tag === "af" ? s.folderId.slice(3) : null;
  const here = inDir || cur;

  /* 菜单项直接由当前工作区的分类表生成 —— 有几个模块就几项,
     顺序也和左侧导航一致,不另写一份清单。 */
  const rows = catsOf(VaultStore.ws).map((c) => {
    const label =
      c.id === "project" ? "新建项目" : c.id === "ip" ? "新建知识产权" : c.id === "general" ? "新建资料" : `新建${c.label}`;
    return { id: c.id, label, can: onHome || c.id === here };
  });

  /* 合同不是顶层分类,它只能挂在项目下,所以不进分类表 —— 只有站在项目里
     才出现,而且带着这个项目的 id 走。 */
  const inProject = tag === "p" ? s.folderId.slice(2) : "";
  if (inProject) rows.push({ id: "contract", label: "新建合同", can: true });

  const handlers = {
    upload: () => pickFiles(),
  };
  for (const m of rows) {
    handlers[`new-${m.id}`] =
      m.id === "project"
        ? () => RecordForms.project()
        : m.id === "contract"
        ? () => RecordForms.contract(null, Number(inProject))
        : m.id === "ip"
        ? () => RecordForms.ip()
        : m.id === "general"
        ? () => RecordForms.general()
        : () => RecordForms.archive(m.id, null, m.id === "achievement" ? parentId : null);
  }

  /* 站在分类里,分类已经决定了子项类型,只留这一项 —— 不让用户再选一次。
     站在项目里,唯一能建的是合同(顶层分类在这里都建不了,列出置灰项只会
     让人以为点错了)。根目录 / 其它记录内部仍然全列出来但置灰。 */
  const items = inProject
    ? rows.filter((m) => m.id === "contract")
    : !onHome && here
    ? rows.filter((m) => m.can)
    : rows;

  showCtx(
    r.left,
    r.bottom + 6,
    items
      .map((m) =>
        MI(`new-${m.id}`, m.id === "contract" ? "folder" : `cat:${m.id}`, m.label, "", false, !m.can)
      )
      .join("") +
      '<div class="ctx-sep"></div>' +
      MI("upload", "upload", "上传文件"),
    handlers
  );

  if (!onHome && !here && !inProject) toast("先进入某个资料分类，才能新建记录");
}

/* ---------------- 内容区 ---------------- */

function bindContent() {
  const content = $("#content");

  content.addEventListener("click", (e) => {
    const actBtn = e.target.closest("[data-row-act]");
    if (actBtn) {
      e.stopPropagation();
      const r = actBtn.getBoundingClientRect();
      showItemMenu(actBtn.dataset.id, r.left, r.bottom + 4);
      return;
    }

    const row = e.target.closest(".row, .tile");
    if (!row) return;

    const id = row.dataset.id;
    const onCheck = e.target.closest(".row-check, .tile-check");
    /* Shift = 连选,Ctrl+Shift = 区间并入已有选择;
       点行首勾选框 = 逐条累加/取消(不需要按 Ctrl);点行内其它位置 = 单选。 */
    if (e.shiftKey) Drive.select(id, e.ctrlKey || e.metaKey ? "range-add" : "range");
    else if (e.ctrlKey || e.metaKey) Drive.select(id, "toggle");
    else if (onCheck) Drive.select(id, "toggle");
    else Drive.select(id, "single");

    row.focus?.();
  });

  content.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) return;
    const id = row.dataset.id;
    const item = findById(id) || RECYCLE.find((i) => i.id === id);
    if (!item) return;
    if (item.type === "folder" && !isTrashNode(id)) Drive.openFolder(id);
    else if (item.type === "file") previewFile(id);
  });

  content.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) {
      e.preventDefault();
      showBlankMenu(e.clientX, e.clientY);
      return;
    }
    e.preventDefault();
    const id = row.dataset.id;
    if (!Drive.state.selection.has(id)) Drive.select(id, "single");
    showItemMenu(id, e.clientX, e.clientY);
  });

  content.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".row, .tile, .icon-btn, .dash")) return;
    startMarquee(e);
  });

  /* 拖拽:把文件拖到记录上 = 把该附件挂到这条记录 */
  content.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) return;
    const item = findById(row.dataset.id);
    if (!item || item.type !== "file") {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", row.dataset.id);
    row.classList.add("is-dragging");
  });

  content.addEventListener("dragend", (e) => {
    e.target.closest(".row, .tile")?.classList.remove("is-dragging");
  });

  content.addEventListener("dragover", (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) return;
    const item = findById(row.dataset.id);
    if (!item || item.type !== "folder") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    row.classList.add("is-drop");
  });

  content.addEventListener("dragleave", (e) => {
    e.target.closest(".row, .tile")?.classList.remove("is-drop");
  });

  content.addEventListener("drop", async (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) return;
    row.classList.remove("is-drop");
    const target = findById(row.dataset.id);
    if (!target || target.type !== "folder") return;
    e.preventDefault();

    /* 外部文件拖入 → 上传到该记录 */
    if (e.dataTransfer.files?.length) {
      uploadFiles(e.dataTransfer.files, target);
      return;
    }

    const srcId = e.dataTransfer.getData("text/plain");
    const src = findById(srcId);
    if (!src || src === target) return;
    toast("附件移动需要后端支持 link 迁移；当前请用「上传」挂到目标记录");
  });

  /* 整页拖入 */
  ["dragover", "drop"].forEach((t) =>
    document.addEventListener(t, (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
    })
  );
  document.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    const node = findById(Drive.state.folderId);
    if (node?.type === "folder") uploadFiles(e.dataTransfer.files, node);
  });
}

function showItemMenu(id, x, y) {
  const item = findById(id) || RECYCLE.find((i) => i.id === id);
  if (!item) return;
  const trash = isTrashNode(id);
  const isFolder = item.type === "folder";
  const b = item.biz || {};

  if (trash) {
    showCtx(x, y, [
      MI("restore", "restore", "还原"),
      MI("purge", "trashForever", "彻底删除", "", true),
    ].join(""), {
      restore: () => recycleAction([item], "restore"),
      purge: () => recycleAction([item], "purge"),
    });
    return;
  }

  const html = [
    isFolder ? MI("open", "folder", "打开") : MI("open", "eye", "预览"),
    /* 合同挂在项目下,所以在项目节点上直接给一个建合同的入口 —— 比先打开
       项目再点工具栏少一步。 */
    b.kind === "project" ? MI("newcontract", "folder", "新建合同") : "",
    isFolder && b.kind !== "archive_folder" ? MI("props", "info", "属性") : "",
    MI("download", "download", isFolder ? "打包下载" : "下载"),
    !isFolder ? MI("newver", "upload", "上传新版本") : "",
    !isFolder && b.ownerKind === "ip" ? MI("assoc", "copy", "共享到其它知识产权") : "",
    '<div class="ctx-sep"></div>',
    isFolder && b.kind !== "archive_folder" ? MI("rename", "rename", "重命名", "F2") : "",
    b.kind !== "archive_folder" ? MI("delete", "trash", "删除", "Del", true) : "",
  ]
    .filter(Boolean)
    .join("");

  showCtx(x, y, html, {
    open: () => (isFolder ? Drive.openFolder(id) : previewFile(id)),
    newcontract: () => RecordForms.contract(null, b.id),
    props: () => RecordForms.edit(item),
    download: () => (isFolder ? exportNodes([item]) : downloadFile(id)),
    newver: () => uploadNewVersion(item),
    assoc: () => associateOriginal(item),
    rename: () => toast("重命名请点「修改」或右键「属性」"),
    delete: () => deleteNodes([...Drive.state.selection].map((i) => findById(i) || RECYCLE.find((n) => n.id === i)).filter(Boolean)),
  });
}

function showBlankMenu(x, y) {
  const s = Drive.state;
  if (s.view !== "files") {
    showCtx(x, y, MI("refresh", "refresh", "刷新"), { refresh: () => enterWorkspace(VaultStore.ws) });
    return;
  }
  const cur = nodeTag(s.folderId) === "k" ? s.folderId.slice(2) : "";
  showCtx(
    x,
    y,
    [MI("new", "plus", "新建"), MI("upload", "upload", "上传"), '<div class="ctx-sep"></div>', MI("refresh", "refresh", "刷新")].join(""),
    {
      new: () => ($(`#btnNew`) ? openNewMenu($("#btnNew")) : null),
      upload: () => pickFiles(),
      refresh: () => enterWorkspace(VaultStore.ws),
    }
  );
}

/* ---------------- 框选 ---------------- */

function startMarquee(startEvt) {
  const box = $("#marquee");
  if (!box) return;
  const startX = startEvt.clientX;
  const startY = startEvt.clientY;
  /* 按住 Ctrl 拖框 = 并进已有选择,否则替换 */
  const base = startEvt.ctrlKey || startEvt.metaKey ? new Set(Drive.state.selection) : null;
  let dragging = false;

  const onMove = (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.abs(dx) + Math.abs(dy) < 4) return;
    dragging = true;

    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    box.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

    const rect = { left: x, top: y, right: x + w, bottom: y + h };
    const hits = base ? new Set(base) : new Set();
    $$("#viewRoot .row, #viewRoot .tile").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) hits.add(el.dataset.id);
    });
    Drive.state.selection = hits;
    Drive.renderChrome();
    Drive.renderDetail();
  };

  const onUp = () => {
    box.style.cssText = "display:none";
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (!dragging) Drive.clearSelection();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/* ---------------- 选择栏 ---------------- */

function bindSelectionBar() {
  $("#selClear").addEventListener("click", () => Drive.clearSelection());

  $("#selDownload").addEventListener("click", () => {
    const items = Drive.selectedItems;
    if (!items.length) return toast("请选择要下载的内容");
    void exportNodes(items);
  });

  $("#selDelete").addEventListener("click", () => {
    const items = Drive.selectedItems;
    if (!items.length) return;
    if (Drive.state.view === "recycle") recycleAction(items, "purge");
    else deleteNodes(items);
  });
}

function bindDetail() {
  $("#detailClose").addEventListener("click", () => {
    Drive.state.detailOpen = false;
    Drive.renderDetail();
    Drive.renderChrome();
  });

  $("#detailBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-detail-act]");
    if (!btn) return;
    const items = Drive.selectedItems;
    const one = items[0];

    switch (btn.dataset.detailAct) {
      case "open":
        if (one?.type === "folder") Drive.openFolder(one.id);
        break;
      case "preview":
        if (one) previewFile(one.id);
        break;
      case "download":
        items.filter((i) => i.type === "file").forEach((i) => downloadFile(i.id));
        if (!items.some((i) => i.type === "file")) toast("文件夹不包含可直接下载的附件");
        break;
      case "delete":
        if (Drive.state.view === "recycle") recycleAction(items, "purge");
        else deleteNodes(items);
        break;
      case "restore":
        recycleAction(items, "restore");
        break;
      case "edit":
        if (one) RecordForms.edit(one);
        break;
    }
  });
}

/* ---------------- 搜索 ---------------- */

function bindSearch() {
  const input = $("#searchInput");
  const wrap = $("#searchWrap");
  let timer = null;

  /* 打字停顿 180ms 后发服务端检索。本地匹配在 runSearch 里先顶上,
     所以这里不用再单独 render 一次。 */
  input.addEventListener("input", () => {
    wrap.classList.toggle("has-value", !!input.value);
    clearTimeout(timer);
    timer = setTimeout(() => {
      Drive.state.query = input.value;
      Drive.state.selection.clear();
      Drive.resetSort();
      if (Drive.state.query.trim() && Drive.state.view === "home") Drive.state.view = "files";
      void Drive.runSearch(Drive.state.query);
    }, 180);
  });

  const clear = () => {
    input.value = "";
    wrap.classList.remove("has-value");
    Drive.state.query = "";
    Drive.resetSearch();
    Drive.resetSort();
    Drive.render();
  };

  $("#searchClear").addEventListener("click", () => {
    clear();
    input.focus();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clear();
      input.blur();
      return;
    }
    /* 回车跳过防抖,立刻检索 —— 关键词长的时候不用干等那 180ms */
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timer);
      Drive.state.query = input.value;
      if (Drive.state.query.trim() && Drive.state.view === "home") Drive.state.view = "files";
      void Drive.runSearch(Drive.state.query);
    }
  });
}

/* ---------------- 键盘 ---------------- */

function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    /* 设置面板在最上层,先处理它 */
    if ($("#settingsMask")?.classList.contains("show")) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSettings();
      }
      return;
    }

    if (e.target.matches("input, textarea, select")) return;
    if ($("#lockScreen")?.classList.contains("show")) return;

    const s = Drive.state;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      Drive.toggleSelectAll();
      return;
    }

    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      $("#searchInput").focus();
      return;
    }

    if (e.key === "Delete") {
      const items = Drive.selectedItems;
      if (!items.length) return;
      e.preventDefault();
      if (s.view === "recycle") recycleAction(items, "purge");
      else deleteNodes(items);
      return;
    }

    if (e.key === "F2") {
      e.preventDefault();
      if (s.selection.size === 1) toast("重命名请点「修改」或右键「属性」");
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      if (s.view === "files" && s.folderId !== "root") {
        const parent = findParent(s.folderId);
        if (parent) Drive.openFolder(parent.id);
      }
      return;
    }

    if (e.key === "Escape") {
      if ($("#ctxMenu").classList.contains("show")) return hideCtx();
      if (s.selection.size) return Drive.clearSelection();
    }

    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      Drive.goBack();
      return;
    }

    /* 上下键在列表内移动选中 */
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const ids = Drive.sortedItems.map((i) => i.id);
      if (!ids.length) return;
      e.preventDefault();
      const cur = s.anchorId || ids[0];
      const i = ids.indexOf(cur);
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      Drive.select(next, e.shiftKey ? "range" : "single");
      $$(`#viewRoot [data-id="${CSS.escape(next)}"]`)[0]?.scrollIntoView({ block: "nearest" });
    }
  });
}

/* ---------------- 遮罩层 ---------------- */

function bindOverlays() {
  $("#confirmOk").addEventListener("click", () => settleConfirm(true));
  $("#confirmCancel").addEventListener("click", () => settleConfirm(false));
  $("#confirmMask").addEventListener("mousedown", (e) => {
    if (e.target.id === "confirmMask") settleConfirm(false);
  });
}

/* ==========================================================================
   业务动作 — 全部走真实接口
   ========================================================================== */

async function deleteNodes(nodes) {
  /* 业务档案的系统目录不是记录,不能删;混合选中时把它们摘出去 */
  const dirs = nodes.filter((n) => (n.biz || {}).kind === "archive_folder");
  if (dirs.length) {
    nodes = nodes.filter((n) => (n.biz || {}).kind !== "archive_folder");
    toast("业务档案的目录不能删除");
  }
  if (!nodes.length) return;
  const ok = await askConfirm({
    title: "删除",
    text: `将 ${nodes.length} 项移到回收站？可以稍后还原。`,
    okText: "删除",
    danger: true,
  });
  if (!ok) return;

  try {
    for (const n of nodes) {
      if (n.type === "file") {
        const meta = VaultStore.metaOf(n.id);
        if (!meta) {
          toast(`${n.name}:找不到附件引用`, { ms: 5000 });
          continue;
        }
        await VaultStore.api(`/api/v2/files/${VaultStore.ws}/${meta.fileId}/links/${meta.linkId}`, { method: "DELETE" });
      } else {
        const b = n.biz || {};
        const kind = bizKindOf(n);
        if (!kind || !b.id) continue;
        const qs = kind === "archive" ? `?section=${encodeURIComponent(b.section || "")}` : "";
        await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/${kind}/${b.id}${qs}`, { method: "DELETE" });
      }
    }
    toast(`已删除 ${nodes.length} 项`);
    Drive.clearSelection();
    await refreshCurrent();
  } catch (e) {
    toast(e.message, { ms: 6000 });
  }
}

async function recycleAction(nodes, op) {
  if (!nodes.length) return;
  if (op === "purge") {
    const ok = await askConfirm({
      title: "彻底删除",
      text: `将永久删除 ${nodes.length} 项,无法恢复。`,
      okText: "彻底删除",
      danger: true,
    });
    if (!ok) return;
  }

  try {
    /* 彻底删除走服务端任务,进度与结果由 bridge.js 的 purgeTrash 接管 ——
       它自己会校验 items 并在右下角显示字节进度,成功与否看事务提交。 */
    if (op === "purge") return purgeTrash(nodes);

    const items = nodes
      .map((n) => {
        const r = n.biz?.raw;
        if (!r) return null;
        return { kind: r.kind, id: r.id, section: r.section || "" };
      })
      .filter(Boolean);

    if (!items.length) return toast("这些条目缺少回收站标识");

    await VaultStore.api(`/api/trash/${VaultStore.ws}/restore`, { method: "POST", json: { items } });
    toast(`已还原 ${items.length} 项`);
    Drive.clearSelection();
    await refreshCurrent();
  } catch (e) {
    toast(e.message, { ms: 6000, tone: "error" });
  }
}

async function emptyRecycle() {
  if (!RECYCLE.length) return toast("回收站已经是空的");
  recycleAction(RECYCLE, "purge");
}

async function refreshCurrent() {
  const keep = Drive.state.folderId;
  const view = Drive.state.view;
  await VaultStore.loadAll(VaultStore.ws);
  /* 树重建了,旧的搜索命中项指向已经不在树里的节点,全部作废 */
  Drive.resetSearch();
  const node = findById(keep);
  Drive.state.ready = true;
  if (node) {
    Drive.state.folderId = node.type === "folder" ? keep : findParent(keep)?.id || "root";
    Drive.state.view = view === "recycle" ? "recycle" : "files";
  } else {
    Drive.state.folderId = "root";
    Drive.state.view = "home";
  }
  Drive.render();
}

/* ---------------- 文件下载 / 预览 ---------------- */

function fileUrlOf(id) {
  const meta = VaultStore.metaOf(id);
  if (!meta) return null;
  const node = findById(id);
  const ownerKind = node?.biz?.ownerKind || "";
  if (ownerKind === "ip") {
    /* 知识产权附件走专属路由 */
    const owner = findParent(id);
    const ipId = owner ? Number(String(owner.id).split(":")[1]) : 0;
    return `/api/v2/ip/${VaultStore.ws}/${ipId}/files/${meta.fileId}/versions/${meta.version}/download`;
  }
  return `/api/v2/files/${VaultStore.ws}/${meta.fileId}/versions/${meta.version}/download`;
}

/* 大文件阈值:32 MiB 以下用 blob 更快,以上就必须边下边写盘 ——
   blob 会把整个文件读进内存,几百 MB 的原件会把标签页拖死。 */
const STREAM_MIN_BYTES = 32 * 1024 * 1024;

function canStreamDownload() {
  return typeof window.showSaveFilePicker === "function";
}

/* 边下边写。写入失败一律 abort,磁盘上不留半个文件 ——
   半个附件比没有附件更危险,用户会以为下载成功了。 */
async function streamToDisk(handle, url, node) {
  const expected = Number(node.size) || 0;
  const writer = await handle.createWritable();
  let written = 0;
  let ok = false;
  try {
    const res = await VaultStore.api(url);
    if (!res.body) throw new Error("浏览器不支持流式下载");
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        written += value.byteLength;
        /* 后端声明的长度是唯一可信的边界,超了立刻停 */
        if (expected && written > expected) throw new Error("原件长度异常,已中止");
        await writer.write(value);
      }
    } finally {
      reader.releaseLock();
    }
    /* 少一个字节也算失败:这是完整的原件,不是尽力而为的缓存 */
    if (expected && written !== expected) {
      throw new Error(`原件下载不完整:${fmtSize(written)} / ${fmtSize(expected)}`);
    }
    await writer.close();
    ok = true;
    toast(`已保存:${node.name}(${fmtSize(written)})`);
  } finally {
    if (!ok) {
      try {
        await writer.abort();
      } catch {}
    }
  }
}

async function downloadFile(id) {
  const url = fileUrlOf(id);
  const node = findById(id);
  if (!url || !node) return toast("附件信息缺失");

  /* 拾取器必须趁用户点击的激活还没失效时打开,所以排在所有网络请求之前。
     放到请求之后会抛 SecurityError,那样就只剩「全量进内存」一条路。 */
  if ((Number(node.size) || 0) >= STREAM_MIN_BYTES && canStreamDownload()) {
    let handle = null;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: node.name });
    } catch (e) {
      /* 用户取消就到此为止;其它错误退回 blob 路径,不让下载彻底不可用 */
      if (e?.name === "AbortError") return;
    }
    if (handle) {
      try {
        await streamToDisk(handle, url, node);
      } catch (e) {
        if (e?.name === "AbortError") return;
        toast(`下载失败:${e.message}`, { ms: 6000, tone: "error" });
      }
      return;
    }
  }

  try {
    const res = await VaultStore.api(url);
    const blob = await res.blob();
    const expected = Number(node.size) || 0;
    if (expected && blob.size !== expected) throw new Error("原件下载长度异常");
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = node.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 60000);
    toast(`已下载:${node.name}`);
  } catch (e) {
    toast(e.message, { ms: 6000, tone: "error" });
  }
}

/* ---------------- 预览 ---------------- */

/* pdf.min.js 有 1 MB,不进首屏:首次打开 PDF 时才注入。
   pdf-preview.js 已在首屏加载,它只提供 create(),要求 window.pdfjsLib 已就绪。
   旧壳用 Chromium 内嵌 PDF 插件(iframe)渲染,插件缺失或策略收紧时直接白屏,
   所以这里统一走 canvas 阅读器 —— 与"无插件、无 CDN、不落临时文件"的口径一致。 */
let pdfLibPromise = null;

function ensurePdfViewer() {
  if (window.pdfjsLib && window.IPSysPdfViewer) return Promise.resolve(window.IPSysPdfViewer);
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/pdfjs/pdf.min.js";
      script.onload = () => {
        if (window.pdfjsLib && window.IPSysPdfViewer) resolve(window.IPSysPdfViewer);
        else reject(new Error("离线 PDF 阅读器初始化失败。"));
      };
      script.onerror = () => reject(new Error("离线 PDF 组件加载失败:/pdfjs/pdf.min.js"));
      document.head.append(script);
    }).catch((error) => {
      pdfLibPromise = null; // 允许下次重试
      throw error;
    });
  }
  return pdfLibPromise;
}

function openPreviewShell(name) {
  const mask = document.createElement("div");
  mask.className = "mask show preview-mask";
  mask.innerHTML = `
    <div class="preview-box">
      <div class="preview-head">
        <span>${esc(name)}</span>
        <button class="icon-btn sm" data-x>${icon("close", 15)}</button>
      </div>
      <div class="preview-body"></div>
    </div>`;
  return mask;
}

async function previewFile(id) {
  const node = findById(id);
  if (!node) return;
  const url = fileUrlOf(id);
  if (!url) return toast("附件信息缺失");

  const ext = extOf(node.name);
  const isPdf = ext === "pdf";
  const isImg = ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext);

  if (!isPdf && !isImg) {
    const ok = await askConfirm({
      title: "预览",
      text: `「${node.name}」无法在浏览器内预览,是否下载？`,
      okText: "下载",
    });
    if (ok) downloadFile(id);
    return;
  }

  const mask = openPreviewShell(node.name);
  const body = mask.querySelector(".preview-body");
  document.body.append(mask);

  let pdfViewer = null;
  let objectUrl = "";
  const close = () => {
    document.removeEventListener("keydown", onKey);
    pdfViewer?.destroy?.();
    pdfViewer = null;
    mask.remove();
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    const top = document.querySelector(".mask.show.preview-mask");
    if (top === mask) close();
  };
  mask.querySelector("[data-x]").addEventListener("click", close);
  mask.addEventListener("mousedown", (e) => {
    if (e.target === mask) close();
  });
  document.addEventListener("keydown", onKey);

  try {
    const res = await VaultStore.api(url);
    if (isPdf) {
      const buffer = await res.arrayBuffer();
      if (!mask.isConnected) return;
      const viewer = await ensurePdfViewer();
      if (!mask.isConnected) return;
      pdfViewer = viewer.create(body, buffer);
    } else {
      const blob = await res.blob();
      if (!mask.isConnected) return;
      objectUrl = URL.createObjectURL(blob);
      body.innerHTML = `<img src="${objectUrl}" alt="${esc(node.name)}">`;
    }
  } catch (e) {
    if (!mask.isConnected) return;
    body.innerHTML = `<p class="preview-fail">${esc(e.message || String(e))}</p>`;
  }
}

/* ---------------- 上传 ---------------- */

function pickFiles() {
  const node = findById(Drive.state.folderId);
  if (!node || node.type !== "folder") return toast("请先进入一条记录,再上传附件");
  if (nodeTag(node.id) === "k" || node.biz?.kind === "archive_folder")
    return toast("请先进入具体记录,再上传附件");

  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.addEventListener("change", () => {
    if (input.files?.length) uploadFiles(input.files, node);
  });
  input.click();
}
function uploadFiles(files, node) {
  /* 上传全流程交给能力层编排:prepare → 相同内容检测 → resolve。
     进度、阶段文案、取消、失败明细由 IPSysUploadProgress 自带面板负责,
     本壳不再自己维护队列与进度条。 */
  void uploadAttachments(files, node);
}
