/* ==========================================================================
   OneDrive UI — 渲染层
   --------------------------------------------------------------------------
   数据来自 store.js 构建的文件树:每条业务记录是一个文件夹,附件是文件。
   渲染管线本身与 OneDrive 一致:
     导航 → 命令栏 → 面包屑 → 列表/网格 → 详细信息
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const NAV_ITEMS = [
  { id: "home", label: "首页", icon: "home" },
  { id: "files", label: "我的文件", icon: "folder" },
  { id: "recycle", label: "回收站", icon: "trash" },
];

/* 本机偏好:只影响界面,不写服务端。键统一 ipsys.* */
const Prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`ipsys.${key}`);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`ipsys.${key}`, String(value));
    } catch {}
  },
};

/* ==========================================================================
   台账列集
   --------------------------------------------------------------------------
   一条铁律:**列集由上层分类决定,不由节点自己声明**。
   分类节点(k:*)下面建的文件夹必然是这一类记录(用户口径:「项目台账下建的
   文件夹全是项目,知识产权下建的全是专利、软著」),所以"现在该用哪套列"
   只看 state.folderId,不需要读 biz.kind,也不需要判断这批节点是否同构。

   反过来说,下面这些界面没有单一分类,天然没有列集,统一退回
   「名称 / 修改日期 / 大小」——这不是缺陷,是定义:
     根目录     六类并列
     搜索结果   跨类混排(还可能命中附件)
     回收站     各类混在一起
     记录内部   那是附件列表,按文件语义看
   ========================================================================== */

/* 资质 / 成果 / 学术 共用一套档案列:它们的字段完全一致(年度 + 类别 + 备注) */
/* 名称列也写进列集里。它的位置各分类不同(项目台账/资质第二列,知识产权第三列),
   所以不能像以前那样硬编码在行首 —— 位置由列集决定。排序键统一映射到 name。 */
const NAME = (t) => ({ k: "_name", t, w: "minmax(180px,1fr)" });

/* 年份:档案类后端直接给 year,项目与知产只有起止日期,统一从日期里取前四位。
   见 Drive.yearOf()。 */
const YEAR = { k: "_year", t: "年份", w: "84px", f: "num" };

const ARCHIVE_COLS = [
  YEAR,
  NAME("名称"),
  { k: "category", t: "类别", w: "104px" },
  { k: "remarks", t: "备注", w: "minmax(140px,1.15fr)", f: "sub" },
  { k: "_files", t: "附件", w: "56px", f: "num", r: 1 },
  { k: "_bytes", t: "大小", w: "88px", f: "size", r: 1 },
];

const LEDGER_COLS = {
  project: [
    YEAR,
    NAME("项目名称"),
    { k: "typeName", t: "项目类型", w: "92px", f: "tag" },
    { k: "code", t: "项目编号", w: "124px", f: "mono" },
    { k: "_files", t: "附件数量", w: "84px", f: "num", r: 1 },
  ],
  ip: [
    YEAR,
    { k: "typeName", t: "类型", w: "92px", f: "tag" },
    NAME("名称"),
    { k: "code", t: "申请/登记号", w: "132px", f: "mono" },
    { k: "owner", t: "当前权利人", w: "176px" },
    { k: "status", t: "状态", w: "96px", f: "pill" },
    { k: "_files", t: "附件", w: "56px", f: "num", r: 1 },
  ],
  certificate: ARCHIVE_COLS,
  achievement: ARCHIVE_COLS,
  academic: ARCHIVE_COLS,
  party: ARCHIVE_COLS,
  general: [
    NAME("资料名称"),
    { k: "remarks", t: "备注", w: "minmax(160px,1fr)", f: "sub" },
    { k: "_files", t: "附件", w: "56px", f: "num", r: 1 },
    { k: "_bytes", t: "大小", w: "88px", f: "size", r: 1 },
  ],
};

/* 状态 → 颜色。先判负向,再判正向,最后判进行中;都不中就是中性灰。
   顺序不能反:"已完成"含"完成","已终止"里没有正向词,先判红才不会误判。 */
function statusTone(v) {
  const s = String(v || "");
  if (/终止|驳回|撤销|失效|逾期|超期|废止|解除|退款|作废/.test(s)) return "red";
  if (/完成|结题|已结|归档|通过|授权|有效|已签|在用|结项/.test(s)) return "green";
  if (/进行|在研|执行|审查|受理|申请|公示|待|草稿|拟|立项/.test(s)) return "blue";
  return "gray";
}

/* 金额千分位。解析不出数字就原样返回("面议"这类不该被抹成 0) */
function fmtMoney(v) {
  const n = Number(String(v).replace(/[,\s]/g, ""));
  if (!isFinite(n) || n === 0) return String(v);
  return n.toLocaleString("zh-CN");
}

const Drive = {
  state: {
    view: "home",
    folderId: "root",
    sortBy: "name",
    sortDir: "asc",
    viewMode: Prefs.get("view", "list") === "grid" ? "grid" : "list",
    selection: new Set(),
    anchorId: null,
    query: "",
    detailOpen: Prefs.get("detail", window.innerWidth > 1200 ? "1" : "0") === "1",
    navCollapsed: false,
    history: [],
    extFilter: null,
    statusFilter: null,
    lastSelectedIds: [],
    ready: false,
    loadError: null,
    wsPending: null,
    /* 搜索:本地兜底 + 服务端权威结果。searchQuery 记的是 searchHits 对应的
       关键词,输入一变就失效,列表立刻退回本地匹配,不会停在旧结果上。 */
    searchHits: null,
    searchQuery: "",
    searchPending: false,
    searchTruncated: false,
    searchMissed: 0,
    searchError: "",
    searchSerial: 0,
  },

  /* ---------- derived ---------- */

  get currentFolder() {
    return findById(this.state.folderId) || ROOT;
  },

  /* 本地搜索只在已加载的树上做字符串匹配,用来给服务端结果到达前兜底。
     它覆盖不了备注、签约方、原件名这类服务端才查的字段,所以不当作最终结果。 */
  localSearch(q, recycleOnly) {
    const needle = q.toLowerCase();
    if (recycleOnly) return RECYCLE.filter((i) => i.name.toLowerCase().includes(needle));
    const out = [];
    walk(ROOT, (n) => {
      if (n === ROOT) return;
      /* 搜索同时覆盖文件夹名与业务编号 */
      const hay = [n.name, n.biz?.code, n.biz?.status, n.biz?.owner, n.biz?.tags]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(needle)) out.push(n);
    });
    return out;
  },

  get sourceItems() {
    const s = this.state;
    let out;

    if (s.query.trim()) {
      /* 服务端结果优先;还没回来(或已经过期)就先给本地匹配,
         这样打字时列表不会空一下再跳出来。 */
      out =
        s.searchQuery === s.query.trim() && Array.isArray(s.searchHits)
          ? s.searchHits
          : this.localSearch(s.query.trim(), s.view === "recycle");
    } else {
      switch (s.view) {
        case "home":
          out = [];
          break;
        case "files":
          out = this.currentFolder.children || [];
          break;
        case "recycle":
          out = RECYCLE;
          break;
        default:
          out = [];
      }
    }

    /* 两套筛选各管一段:台账里按记录状态筛,通用视图里按扩展名筛文件。
       台账里也曾能点扩展名筛选,但那一屏全是文件夹,点了只会把列表清空 —— 已掐断。 */
    if (s.statusFilter) {
      out = out.filter((i) => (i.biz || {}).status === s.statusFilter);
    }
    if (s.extFilter) {
      out = out.filter((i) => i.type === "file" && s.extFilter.includes(extOf(i.name)));
    }
    return out;
  },

  /* ---------- 台账列集 ----------
     columns() 是「现在有没有列集」的唯一答案:null = 通用三列。
     渲染、表头、排序都从这里取,不要在别处另算一遍。 */

  columns() {
    const s = this.state;
    /* 搜索、回收站、首页、记录内部一律没有列集 —— 那里没有单一分类 */
    if (s.view !== "files" || s.query.trim()) return null;
    const id = String(s.folderId || "");
    /* 业务档案的目录里装的仍然是同类记录,照样出台账 */
    if (id.startsWith("af:")) return ARCHIVE_COLS;
    if (!id.startsWith("k:")) return null;
    const sec = id.slice(2);
    /* 公司业务档案入口展示普通目录树，所有目录操作规则一致 → 通用三列 */
    if (catIsDir(sec)) return null;
    return LEDGER_COLS[sec] || null;
  },

  colTemplate(cols) {
    if (!cols) return "minmax(0,1fr) 168px 96px 56px";
    /* 名称列已在列集里;万一某个列集漏了它,补一列兜底,免得整行没有名字 */
    const tpl = cols.some((c) => c.k === "_name")
      ? cols.map((c) => c.w)
      : ["minmax(150px,1fr)", ...cols.map((c) => c.w)];
    return [...tpl, "56px"].join(" ");
  },

  headHtml(cols) {
    if (!cols) {
      return `<button class="head-check" id="selectAll" title="全选"></button>
        <div class="col-name"><button class="th-sort" data-sort="name">名称<span class="caret">▾</span></button></div>
        <div class="col-date"><button class="th-sort" data-sort="mtime">修改日期<span class="caret">▾</span></button></div>
        <div class="col-size"><button class="th-sort" data-sort="size">大小<span class="caret">▾</span></button></div>
        <div class="col-gap"></div>`;
    }
    /* 台账表头:逐列生成,名称列不再是固定槽位。
       第一格要往左让出 26px 给勾选框(勾选框是 absolute)。 */
    const cells = cols
      .map((c, i) => {
        const key = c.k === "_name" ? "name" : c.k;
        const cls = [
          "cell",
          c.k === "_name" ? "col-name" : "",
          c.r ? "ta-r" : "",
          i === 0 ? "is-first" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<div class="${cls}"><button class="th-sort" data-sort="${key}">${esc(c.t)}<span class="caret">▾</span></button></div>`;
      })
      .join("");
    return `<button class="head-check" id="selectAll" title="全选"></button>${cells}<div class="col-gap"></div>`;
  },

  /* 年份:档案类有 year 字段,项目/知产只有日期。都从这两个地方取,
     取不到就留空(表格显示「—」),不要拿创建时间凑。 */
  yearOf(it) {
    const b = it.biz || {};
    const y = String(b.year || "").match(/\d{4}/);
    if (y) return y[0];
    const d = String(b.start || b.end || "").match(/\d{4}/);
    return d ? d[0] : "";
  },

  cellValue(it, c) {
    if (c.k === "_name") return it.name || "";
    if (c.k === "_year") return this.yearOf(it);
    if (c.k === "_files") return (it.children || []).length;
    if (c.k === "_bytes") return (it.children || []).reduce((n, x) => n + (x.size || 0), 0);
    return (it.biz || {})[c.k] ?? "";
  },

  cellHtml(it, c, first) {
    const v = this.cellValue(it, c);
    const cls = `cell${c.r ? " ta-r" : ""}${first ? " is-first" : ""}`;
    if (v === "" || v === null || v === undefined) return `<div class="${cls}"><span class="c-nil">—</span></div>`;
    let inner;
    switch (c.f) {
      case "pill":
        inner = `<span class="pill ${statusTone(v)}">${esc(v)}</span>`;
        break;
      case "tag":
        inner = `<span class="pill tag">${esc(v)}</span>`;
        break;
      case "mono":
        inner = `<span class="mono" title="${esc(v)}">${esc(v)}</span>`;
        break;
      case "date":
        inner = `<span class="mono">${esc(String(v).slice(0, 10))}</span>`;
        break;
      case "money":
        inner = `<span class="mono">${esc(fmtMoney(v))}</span>`;
        break;
      case "size":
        inner = `<span class="mono">${fmtSize(Number(v) || 0)}</span>`;
        break;
      case "num":
        inner = Number(v) ? `<span class="mono">${esc(v)}</span>` : `<span class="c-nil">—</span>`;
        break;
      default:
        inner = `<span class="c-txt" title="${esc(v)}">${esc(v)}</span>`;
    }
    return `<div class="${cls}">${inner}</div>`;
  },

  /* 导航到新上下文后的统一收尾:
     1) 旧排序键在新列集里可能不存在(在项目台账按「项目编号」排,再进根目录)
        → 退回按名称;
     2) 进分类 = 进台账,列多,右侧详情面板会把名称列压到 180px 左右 → 自动收起。
        用户仍可手动打开,那是他自己选的窄。 */
  enterContext() {
    this.resetSort();
    if (this.columns()) this.state.detailOpen = false;
    /* 筛选是跟着分类列的,换目录一定得清,否则进另一个分类会莫名其妙少一半行 */
    this.state.statusFilter = null;
    this.state.extFilter = null;
  },

  resetSort() {
    const s = this.state;
    if (this.isArchiveOrderScope()) {
      s.sortBy = "position";
      s.sortDir = "asc";
      return;
    }
    const cols = this.columns();
    const keys = cols ? ["name", ...cols.map((c) => c.k)] : ["name", "mtime", "size"];
    if (!keys.includes(s.sortBy)) {
      s.sortBy = "name";
      s.sortDir = "asc";
    }
  },

  /* 公司业务档案内层允许目录与资料混排，按服务端持久顺序默认展示。 */
  isArchiveOrderScope() {
    const s = this.state;
    return s.view === "files" && !s.query.trim() && VaultStore.ws === "company" &&
      (s.folderId === "k:achievement" || String(s.folderId).startsWith("af:"));
  },

  /* ---------- 搜索 ---------- */

  /* 清空搜索状态。serial 自增一次,正在飞的服务端请求回来时会自己作废,
     不会把上一个关键词的结果盖到新界面上。 */
  resetSearch() {
    const s = this.state;
    s.searchSerial++;
    s.searchHits = null;
    s.searchQuery = "";
    s.searchPending = false;
    s.searchTruncated = false;
    s.searchMissed = 0;
    s.searchError = "";
  },

  async runSearch(raw) {
    const q = String(raw ?? "").trim();
    const serial = ++this.state.searchSerial;
    const ws = VaultStore.ws;
    const s = this.state;

    /* 旧结果立刻作废,列表先退回本地匹配 */
    s.searchHits = null;
    s.searchQuery = "";
    s.searchError = "";
    s.searchTruncated = false;
    s.searchMissed = 0;

    if (!q) {
      s.searchPending = false;
      this.render();
      return;
    }

    s.searchPending = true;
    this.render();

    try {
      const data = await VaultStore.search(ws, q);
      if (serial !== s.searchSerial) return;
      const hits = VaultStore.resolveHits(data);
      s.searchHits = hits;
      s.searchTruncated = !!data.truncated;
      s.searchMissed = Math.max(0, (data.results || []).length - hits.length);
      s.searchQuery = q;
    } catch (e) {
      if (serial !== s.searchSerial) return;
      /* 服务端挂了就把本地结果留在屏幕上,而不是给用户一片空白 */
      s.searchError = e.message || "搜索失败";
      s.searchQuery = q;
    } finally {
      if (serial === s.searchSerial) {
        s.searchPending = false;
        this.render();
      }
    }
  },

  /* 搜索结果的状态条:截断 / 失效命中 / 服务端失败退回本地。
     没有要说的事就返回空串,不占版面。 */
  searchNote() {
    const s = this.state;
    if (!s.query.trim() || s.searchQuery !== s.query.trim()) return "";
    const bits = [];
    if (s.searchError) bits.push(`服务端检索失败(${esc(s.searchError)}),下面是本地已加载内容的结果`);
    if (s.searchTruncated) bits.push("同类命中过多,每种类型只显示前 60 条");
    if (s.searchMissed) bits.push(`${s.searchMissed} 项在资料库中已变化,未列入`);
    if (!bits.length) return "";
    return `<div class="search-note">${icon("info", 15)}<span>${bits.join(" · ")}</span></div>`;
  },

  get sortedItems() {
    const { sortBy, sortDir } = this.state;
    const dir = sortDir === "asc" ? 1 : -1;
    const items = [...this.sourceItems];
    const col = this.columns()?.find((c) => c.k === sortBy);
    const archiveOrderScope = this.isArchiveOrderScope();

    items.sort((a, b) => {
      if (archiveOrderScope && sortBy === "position") {
        const ao = Number.isFinite(a.order) ? a.order : Infinity;
        const bo = Number.isFinite(b.order) ? b.order : Infinity;
        return ao - bo || cmpName(a, b);
      }
      if (!archiveOrderScope && a.type !== b.type) return a.type === "folder" ? -1 : 1;
      if (col) {
        /* 名称列走拼音序,和通用列表的「名称」保持一致 */
        if (col.k === "_name") return cmpName(a, b) * dir;
        const x = this.cellValue(a, col);
        const y = this.cellValue(b, col);
        const xe = x === "" || x === null || x === undefined;
        const ye = y === "" || y === null || y === undefined;
        /* 空值恒定沉底,不跟着升降序翻转 —— 否则降序时空行会全冒到顶上 */
        if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;
        if (col.f === "money" || col.f === "num" || col.f === "size") {
          return ((Number(x) || 0) - (Number(y) || 0)) * dir;
        }
        return String(x).localeCompare(String(y), "zh-CN") * dir;
      }
      let r = 0;
      if (sortBy === "name") {
        /* 业务档案目录带 order(后端 position),按用户顺序排;
           其余节点没有 order,照旧按拼音。 */
        const ao = a.order ?? null;
        const bo = b.order ?? null;
        r = ao !== null && bo !== null ? ao - bo : cmpName(a, b);
      } else if (sortBy === "mtime") r = (a.mtime || 0) - (b.mtime || 0);
      else if (sortBy === "size") r = (a.size || 0) - (b.size || 0);
      return r * dir;
    });
    return items;
  },

  get selectedItems() {
    return [...this.state.selection]
      .map((id) => findById(id) || RECYCLE.find((i) => i.id === id))
      .filter(Boolean);
  },

  /* ---------- navigation ---------- */

  navigate(view, folderId) {
    this.state.history.push({ view: this.state.view, folderId: this.state.folderId });
    this.state.view = view;
    if (folderId) this.state.folderId = folderId;
    else if (view === "files") this.state.folderId = "root";
    this.state.selection.clear();
    this.state.anchorId = null;
    this.state.query = "";
    this.resetSearch();
    const si = $("#searchInput");
    if (si) si.value = "";
    $("#searchWrap")?.classList.remove("has-value");
    this.enterContext();
    this.render();
    /* 进回收站时把服务端还在跑的彻底删除任务接回来,否则刷新一次就再也
       看不到删除是否成功 */
    if (view === "recycle") void resumePurge();
  },

  openFolder(id) {
    const node = findById(id);
    if (!node || node.type !== "folder") return;
    this.state.history.push({ view: this.state.view, folderId: this.state.folderId });
    this.state.view = "files";
    this.state.folderId = id;
    this.state.selection.clear();
    this.state.query = "";
    this.resetSearch();
    const si = $("#searchInput");
    if (si) si.value = "";
    this.enterContext();
    this.render();
  },

  goBack() {
    const prev = this.state.history.pop();
    if (!prev) return;
    this.state.view = prev.view;
    this.state.folderId = prev.folderId;
    this.state.selection.clear();
    this.enterContext();
    this.render();
  },

  /* ---------- selection ----------
     三档:点行 = 单选;点行首勾选框 = 多选(逐条累加/取消);Shift = 连选,
     Ctrl+Shift = 区间并进已有选择。表头勾选框 = 全选,
     0 < 已选 < 总数 时表头显示半选态 —— 这就是「中间态」。 */

  select(id, mode = "single") {
    const list = this.sortedItems.map((i) => i.id);
    const sel = this.state.selection;
    const anchor = this.state.anchorId;

    if (mode === "toggle") {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      this.state.anchorId = id;
    } else if (mode === "range" || mode === "range-add") {
      const a = list.indexOf(anchor || id);
      const b = list.indexOf(id);
      if (a < 0 || b < 0) {
        if (mode === "range") sel.clear();
        sel.add(id);
      } else {
        if (mode === "range") sel.clear();
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(list[i]);
      }
      this.state.anchorId = anchor || id;
    } else {
      sel.clear();
      sel.add(id);
      this.state.anchorId = id;
    }
    this.renderChrome();
    this.renderDetail();
  },

  /* 表头勾选框与 Ctrl+A 共用:全选 ↔ 全不选 */
  toggleSelectAll() {
    const ids = this.sortedItems.map((i) => i.id);
    const all = ids.length > 0 && ids.every((id) => this.state.selection.has(id));
    this.state.selection = new Set(all ? [] : ids);
    this.state.anchorId = null;
    this.renderChrome();
    this.renderDetail();
  },

  clearSelection() {
    this.state.selection.clear();
    this.state.anchorId = null;
    this.renderChrome();
    this.renderDetail();
  },

  /* ---------- render ---------- */

  render() {
    this.renderNav();
    this.renderChrome();
    this.renderCrumb();
    this.renderContent();
    this.renderDetail();
    this.paintStorage();
  },

  /* All capacity surfaces use one authenticated whole-vault page snapshot. */
  paintStorage() {
    const stats = VaultStore.storage;
    const error = VaultStore.storageError;
    const value = (field) => stats ? fmtSize(stats[field]) : (error || "读取中");
    const rate = stats ? (100 * stats.used / stats.total).toFixed(1) + "%" : "—";
    const width = stats ? (100 * stats.used / stats.total).toFixed(3) + "%" : "0%";
    const side = $("#storageSideSummary");
    if (side) side.textContent = stats ?
      `总 ${fmtSize(stats.total)} · 已用 ${fmtSize(stats.used)}` : (error || "正在读取数据库容量…");
    const spare = $("#storageSideFree");
    if (spare) spare.textContent = stats ?
      `空闲 ${fmtSize(stats.free)} · 使用率 ${rate}` : "";
    for (const [field,selector] of [
      ["total","[data-storage-total]"], ["used","[data-storage-used]"],
      ["free","[data-storage-free]"]])
      document.querySelectorAll(selector).forEach(el => { el.textContent = value(field); });
    document.querySelectorAll("[data-storage-percent]").forEach(el => { el.textContent = rate; });
    const fill = $("#storageFill");
    const homeFill = $("#homeStorageFill");
    for (const bar of [fill,homeFill]) if (bar) bar.style.width = width;
  },

  renderNav() {
    const s = this.state;
    const counts = { files: (ROOT.children || []).length, recycle: RECYCLE.length };

    $("#navMain").innerHTML = NAV_ITEMS.map((n) => {
      const active = s.view === n.id;
      const c = counts[n.id];
      return `<button class="nav-item ${active ? "is-active" : ""}" data-nav="${n.id}">
        ${icon(n.icon, 20)}
        <span class="nav-label">${n.label}</span>
        ${c ? `<span class="nav-count">${c}</span>` : ""}
      </button>`;
    }).join("");

    /* 快捷访问 = 六个固定分类。分类用类型图标,不是文件夹 */
    const quick = ROOT.children || [];
    $("#navQuick").innerHTML = quick
      .map(
        (f) => `<button class="nav-item" data-quick="${f.id}" title="${esc(f.name)}">
          <span class="nav-ico">${this.nodeMark(f, 20)}</span>
          <span class="nav-label">${esc(f.name)}</span>
          <span class="nav-count">${this.recordCount(f)}</span>
        </button>`
      )
      .join("");

    this.paintStorage();
  },

  /* 顶栏的工作区标识。数据未回来前先用待切换的目标,
     避免「点了切换、标签还是旧值」的错位感。 */
  renderWorkspace() {
    const btn = $("#wsSwitchBtn");
    if (!btn) return;
    const ws = this.state.wsPending || VaultStore.ws || "personal";
    const personal = ws === "personal";

    const ico = $("#wsSwitchIcon");
    if (ico && ico.dataset.ws !== ws) {
      ico.dataset.ws = ws;
      ico.innerHTML = icon(personal ? "user" : "building", 17);
    }
    const lb = $("#wsSwitchLabel");
    if (lb) lb.textContent = personal ? "个人工作区" : "企业工作区";
    const ct = $("#wsSwitchCaret");
    if (ct && !ct.dataset.done) {
      ct.dataset.done = "1";
      ct.innerHTML = icon("chevronDown", 14);
    }
    btn.title = `${personal ? "个人资料" : "公司资料与项目台账"} · 点击切换工作区`;
    btn.classList.toggle("ws-loading", !!this.state.wsPending);
  },

  renderChrome() {
    this.renderWorkspace();
    const s = this.state;
    const locked = s.view === "recycle" || !s.ready;

    const canNew = !locked && canCreateHere();
    const canUpload = !locked && canUploadFiles(this.currentFolder);
    const newButton = $("#btnNew");
    if (newButton) {
      newButton.disabled = !canNew;
      newButton.title = canNew ? "新建记录或下级目录" : "请先进入可新建资料的分类或项目";
    }
    const sideNew = $("#btnNewSide");
    if (sideNew) sideNew.disabled = !canNew;
    const uploadButton = $("#btnUpload");
    if (uploadButton) {
      uploadButton.disabled = !canUpload;
      uploadButton.title = canUpload ? "上传到当前业务记录" : "请先进入具体业务记录上传";
    }
    const filterButton = $("#btnFilter");
    if (filterButton) filterButton.disabled = locked;
    const refreshButton = $("#btnRefresh");
    if (refreshButton) refreshButton.disabled = !s.ready;

    $("#btnFilter")?.classList.toggle("is-active", !!(s.extFilter || s.statusFilter));
    const et = $("#btnEmptyTrash");
    if (et) {
      et.classList.toggle("hidden", s.view !== "recycle");
      et.innerHTML = `${icon("trashForever", 17)}<span>清空回收站</span>`;
    }

    /* 表头由列集生成。只在列集变了时重建 —— 否则每次勾选/排序都重建,
       按钮的焦点和 hover 都会丢。 */
    const cols = this.columns();
    const hd = $("#listHead");
    if (hd) {
      const sig = cols ? cols.map((c) => c.k).join(",") : "generic";
      if (hd.dataset.sig !== sig) {
        hd.dataset.sig = sig;
        hd.innerHTML = this.headHtml(cols);
      }
      hd.classList.toggle("is-ledger", !!cols);
    }

    const vt = $("#btnViewToggle");
    if (vt) {
      vt.innerHTML = s.viewMode === "list" ? icon("gridView", 20) : icon("listView", 20);
      vt.title = cols
        ? "台账视图固定为表格"
        : s.viewMode === "list"
        ? "切换到网格视图"
        : "切换到列表视图";
      vt.classList.toggle("is-active", s.viewMode === "grid" && !cols);
      vt.disabled = !!cols;
    }

    $("#btnDetailToggle")?.classList.toggle("is-active", s.detailOpen);

    /* Excel 导入导出只在有台账的分类页出现(见 excel.js) */
    renderExcelButtons();

    $$("#viewRoot .row, #viewRoot .tile, #viewRoot .photo-cell").forEach((el) => {
      el.classList.toggle("is-selected", s.selection.has(el.dataset.id));
    });

    const n = s.selection.size;
    const bar = $("#selbar");
    if (bar) bar.classList.toggle("show", n > 0);
    const sc = $("#selCount");
    if (sc) sc.textContent = `已选择 ${n} 项`;
    $("#selDownload")?.classList.toggle("hidden", locked);
    const sd = $("#selDelete");
    if (sd) sd.innerHTML = `${icon("trash", 18)}<span>${locked ? "彻底删除" : "删除"}</span>`;

    const allIds = this.sortedItems.map((i) => i.id);
    const total = allIds.length;
    const picked = allIds.filter((id) => s.selection.has(id)).length;
    const allSel = total > 0 && picked === total;
    /* 0 < 已选 < 总数 = 中间态,表头显示横线 */
    const someSel = picked > 0 && !allSel;
    const head = $("#selectAll");
    if (head) {
      head.innerHTML = someSel ? icon("minus", 11) : icon("check", 11);
      head.classList.toggle("all", allSel);
      head.classList.toggle("some", someSel);
      head.title = allSel ? "取消全选" : someSel ? `已选 ${picked} 项，点此全选` : "全选";
      head.setAttribute("aria-checked", someSel ? "mixed" : allSel ? "true" : "false");
    }

    $$(".th-sort").forEach((th) => {
      const active = th.dataset.sort === s.sortBy;
      th.dataset.active = active;
      th.classList.toggle("ascending", active && s.sortDir === "asc");
      th.classList.toggle("descending", active && s.sortDir === "desc");
      const c = th.querySelector(".caret");
      if (c) c.textContent = active ? (s.sortDir === "asc" ? "▲" : "▼") : "▾";
    });
  },

  renderCrumb() {
    const s = this.state;
    const bar = $("#crumbbar");

    if (s.query.trim()) {
      bar.innerHTML = `<span class="crumb current">“${esc(s.query)}” 的搜索结果</span>`;
      return;
    }

    if (s.view !== "files") {
      const label = NAV_ITEMS.find((n) => n.id === s.view)?.label || "";
      bar.innerHTML = `<span class="crumb current">${label}</span>`;
      return;
    }

    const path = pathTo(s.folderId) || [ROOT];
    bar.innerHTML = path
      .map((node, i) => {
        const last = i === path.length - 1;
        const crumb = `<button class="crumb ${last ? "current" : ""}" data-crumb="${node.id}">${esc(node.name)}</button>`;
        return last ? crumb : crumb + `<span class="crumb-sep">›</span>`;
      })
      .join("");
  },

  renderContent() {
    const root = $("#viewRoot");
    const content = $("#content");
    const s = this.state;
    /* 首页是工作台,不是列表:命令栏/面包屑在这一页没有意义,整块隐掉 */
    const isHome = s.view === "home" && !s.query.trim();

    $("#main")?.classList.toggle("home-mode", isHome);
    content.classList.toggle("is-home", isHome);

    if (!s.ready) {
      $("#listHead").classList.add("hidden");
      content.classList.remove("view-grid");
      root.innerHTML = s.loadError ? this.errorHtml(s.loadError) : this.loadingHtml();
      return;
    }

    if (isHome) {
      $("#listHead").classList.add("hidden");
      content.classList.remove("view-grid");
      root.innerHTML = this.dashboard();
      return;
    }

    const cols = this.columns();
    /* 台账只有表格一种形态:列集存在时忽略网格偏好,切换按钮同时置灰 */
    const useGrid = s.viewMode === "grid" && !cols;
    content.style.setProperty("--cols", this.colTemplate(cols));
    content.classList.toggle("is-ledger", !!cols);

    const items = this.sortedItems;
    $("#listHead").classList.toggle("hidden", useGrid);
    content.classList.toggle("view-grid", useGrid);

    if (!items.length) {
      root.innerHTML = this.emptyHtml();
      return;
    }

    /* 状态条只在有结果时才有意义 —— 没有结果时 emptyHtml 自己会说明白 */
    root.innerHTML = this.searchNote() + (useGrid ? this.renderGrid(items) : this.renderList(items));
  },

  /* ---------- 首页 ---------- */

  /* ---------- 图标口径 ----------
     一个地方决定,列表 / 网格 / 详情 / 首页不会各画各的:
       固定分类(k:*) → 类型图标
       记录、目录     → 琥珀色文件夹
       附件           → 扩展名色块 */

  sectionOf(node) {
    if (!node) return "";
    if (node.synthetic && String(node.id).startsWith("k:")) return node.id.slice(2);
    const b = node.biz || {};
    if (b.kind === "project") return "project";
    if (b.kind === "ip") return "ip";
    if (b.kind === "archive") return b.section || "";
    if (b.kind === "general") return "general";
    return "";
  },

  nodeMark(node, size = 20, plate = false) {
    if (!node) return folderIcon(size);
    if (node.type === "file") return fileIcon(node.name, size);
    const sec = this.sectionOf(node);
    if (node.synthetic && hasCat(sec)) return catIcon(sec, size, plate);
    return folderIcon(size);
  },

  /* 一个节点下有多少条业务记录。公司业务档案的目录不是记录,不能算进去。 */
  recordCount(node) {
    const kinds = new Set(["project", "archive", "ip", "general"]);
    let n = 0;
    walk(node, (x) => {
      if (x !== node && x.type === "folder" && kinds.has((x.biz || {}).kind)) n++;
    });
    return n;
  },

  /* 一条记录所属的顶层分类。业务档案里的记录父级是目录,
     直接取 findParent 会显示成「申报与认定」而不是「业务档案」。 */
  categoryOf(node) {
    const path = pathTo(node.id) || [];
    const k = [...path].reverse().find((n) => String(n.id).startsWith("k:"));
    return k ? k.name : "";
  },

  shortDate(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return "—";
    const p = (n) => String(n).padStart(2, "0");
    const md = `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`;
  },

  dashboard() {
    const s = this.state;
    if (!s.ready) {
      return s.loadError ? this.errorHtml(s.loadError) : this.loadingHtml();
    }

    const sum = VaultStore.summary();
    const files = allFiles(ROOT);
    const bytes = files.reduce((a, b) => a + (b.size || 0), 0);

    /* 记录 = 挂在分类下的文件夹。分类本身是 synthetic 节点,没有 biz;
       业务档案的目录也不是记录(它只是分组的壳)。 */
    const records = [];
    walk(ROOT, (n) => {
      if (n.type === "folder" && n.biz && n.biz.kind !== "archive_folder") records.push(n);
    });

    /* 最近更新按业务日期倒序。未来计划日不算「最近」,所以优先只取今天及以前;
       全库都是未来日期时才退回完整列表,避免面板空着。 */
    const todayEnd = new Date().setHours(23, 59, 59, 999);
    const past = records.filter((r) => r.mtime && r.mtime <= todayEnd).sort((a, b) => b.mtime - a.mtime);
    const pool = past.length ? past : records.filter((r) => r.mtime).sort((a, b) => b.mtime - a.mtime);
    /* 右栏只有 300px,两行一条刚好;条数按栏高收敛,不要滚动条 */
    const recent = pool.slice(0, 7);

    const personal = VaultStore.ws === "personal";
    const dbName = VaultStore.dbName || "本地资料库";
    /* 页头只留一句规模描述,不再摊成指标卡:这里是资料库,不是管理看板 */
    const sub = `${records.length} 条记录 · ${files.length} 个附件${bytes ? ` · ${fmtSize(bytes)}` : ""}`;

    const usage = VaultStore.storage;
    const storageValue = key => usage ? fmtSize(usage[key]) : (VaultStore.storageError || "读取中");
    const storageRate = usage ? (100 * usage.used / usage.total).toFixed(1) + "%" : "—";
    const storageWidth = usage ? (100 * usage.used / usage.total).toFixed(3) + "%" : "0%";

    return `
    <div class="dash">
      <header class="pagehead">
        <div class="ph-txt">
          <h1>${personal ? "个人工作台" : "公司工作台"}</h1>
          <p title="${esc(dbName)} · ${esc(sub)}">${esc(dbName)} · ${esc(sub)}</p>
        </div>
        <div class="ph-acts">
          <button class="btn solid" data-page-act="new">${icon("plus", 16)}<span>新建记录</span></button>
        </div>
      </header>

      <div class="home-grid">
        <!-- 主区:先把「往哪儿放东西」摆出来。分类就是工作目录,点进去才是记录列表 -->
        <section class="workdirs">
          <div class="sec-head">
            <h2>分类目录</h2>
            <span class="sec-n">${sum.length} 类</span>
          </div>
          <div class="catgrid">
            ${sum
              .map((c) => {
                const ct = CAT_TYPES[c.kind] || CAT_TYPES.general;
                const empty = !c.count && !c.files;
                const meta = empty
                  ? "暂无记录"
                  : `${c.count} 条记录 · ${c.files} 个附件${c.bytes ? ` · ${fmtSize(c.bytes)}` : ""}`;
                return `<button class="catcard ${empty ? "is-empty" : ""}" data-quick="${c.id}"
                    style="--cat:${ct.color};--cat-soft:${ct.soft}" title="${esc(c.name)}">
                  <span class="cc-head">
                    <span class="cc-plate">${catIcon(c.kind, 46, true)}</span>
                    <span class="cc-when">${c.mtime ? `更新 ${this.shortDate(c.mtime)}` : ""}</span>
                  </span>
                  <span class="cc-name">${esc(c.name)}</span>
                  <span class="cc-meta">${meta}</span>
                </button>`;
              })
              .join("")}
          </div>
        </section>

        <div class="home-col">
          <section class="panel">
            <div class="ph">
              <h3>最近更新</h3><span class="sp"></span>
              <button class="link" data-nav="files">查看全部</button>
            </div>
            <div class="plist tight">
              ${
                recent.length
                  ? recent
                      .map((r) => {
                        const cat = this.categoryOf(r);
                        return `<button class="home-row" data-open="${r.id}" title="${esc(r.name)}">
                          <span class="fi">${this.nodeMark(r, 18)}</span>
                          <span class="ht">
                            <span class="nm">${esc(r.name)}</span>
                            <span class="sub">${esc(cat)}${cat && r.mtime ? " · " : ""}${r.mtime ? this.shortDate(r.mtime) : ""}</span>
                          </span>
                        </button>`;
                      })
                      .join("")
                  : `<div class="panel-empty">这个工作区还没有记录,点右上角「新建记录」开始。</div>`
              }
            </div>
          </section>

          <section class="panel">
            <div class="ph"><h3>资料库</h3></div>
            <div class="store">
              <div class="dbname" title="${esc(dbName)}">${esc(dbName)}</div>
              <div class="store-metrics">
                <div><span>总大小</span><b data-storage-total>${storageValue("total")}</b></div>
                <div><span>已用大小</span><b data-storage-used>${storageValue("used")}</b></div>
                <div><span>空闲大小</span><b data-storage-free>${storageValue("free")}</b></div>
              </div>
              <div class="bar" title="已分配数据库页面的使用比例"><i id="homeStorageFill" style="width:${storageWidth}"></i></div>
              <div class="store-legend"><span>已分配页面使用率 <b data-storage-percent>${storageRate}</b></span><span>当前工作区 ${files.length} 个附件</span></div>
              <div class="note">空闲页可复用，不代表磁盘剩余空间</div>
            </div>
          </section>
        </div>
      </div>
    </div>`;
  },


  /* ---------- 列表 / 网格 ---------- */

  renderList(items) {
    const cols = this.columns();
    if (cols) return this.renderLedger(items, cols);

    const searching = !!this.state.query.trim();

    return items
      .map((it) => {
        const sel = this.state.selection.has(it.id);
        const isFolder = it.type === "folder";
        const b = it.biz || {};

        let sub = "";
        if (searching) {
          const par = findParent(it.id);
          const cat = this.categoryOf(it);
          /* 业务档案里的记录,父级是目录 —— 带上顶层分类,否则只看到「申报与认定」 */
          const where = par && par.id !== "root" ? (cat && cat !== par.name ? `${cat} › ${par.name}` : par.name) : "";
          sub = where ? `<span class="row-sub">› ${esc(where)}</span>` : "";
        } else if (isFolder) {
          const bits = [b.code, b.status, b.category, b.year].filter(Boolean);
          if (b.kind === "trash" && b.typeName) sub = `<span class="row-sub">${esc(b.typeName)}</span>`;
          else if (bits.length) sub = `<span class="row-sub">${esc(bits.join(" · "))}</span>`;
          /* 没有业务副标题就留空 —— 子项数量已经由「大小」列给出,不再重复一遍 */
        }

        return `<div class="row ${sel ? "is-selected" : ""}" data-id="${esc(it.id)}" draggable="true">
          <span class="row-check">${icon("check", 10)}</span>
          <div class="col-name">
            <span class="row-icon">${this.nodeMark(it, 20)}</span>
            <span class="row-title">${esc(it.name)}</span>
            ${it.starred ? `<span style="color:#c19c00;display:flex">${icon("star", 12)}</span>` : ""}
            ${sub}
          </div>
          <div class="col-date">${isFolder && it.dateLabel ? esc(it.dateLabel) : fmtDate(it.mtime)}</div>
          <div class="col-size">${isFolder ? (it.children?.length ? `${it.children.length} 项` : "—") : fmtSize(it.size)}</div>
          <div class="col-gap"></div>
          <div class="row-actions">
            <button class="icon-btn" data-row-act="more" data-id="${esc(it.id)}" title="更多">${icon("more", 15)}</button>
          </div>
        </div>`;
      })
      .join("");
  },

  /* 台账行:按列集顺序铺开,名称列也由列集给出位置。
     第一列的勾选框和末尾的「更多」都是 absolute,不参与网格排版。 */
  renderLedger(items, cols) {
    return items
      .map((it) => {
        const sel = this.state.selection.has(it.id);
        const cells = cols
          .map((c, i) => {
            if (c.k === "_name") {
              return `<div class="col-name${i === 0 ? " is-first" : ""}">
                <span class="row-icon">${this.nodeMark(it, 20)}</span>
                <span class="row-title">${esc(it.name)}</span>
                ${it.starred ? `<span style="color:#c19c00;display:flex">${icon("star", 12)}</span>` : ""}
              </div>`;
            }
            const html = this.cellHtml(it, c, i === 0);
            return html;
          })
          .join("");
        return `<div class="row is-ledger ${sel ? "is-selected" : ""}" data-id="${esc(it.id)}" draggable="true">
          <span class="row-check">${icon("check", 10)}</span>
          ${cells}
          <div class="col-gap"></div>
          <div class="row-actions">
            <button class="icon-btn" data-row-act="more" data-id="${esc(it.id)}" title="更多">${icon("more", 15)}</button>
          </div>
        </div>`;
      })
      .join("");
  },

  renderGrid(items) {
    return `<div class="grid">${items
      .map((it) => {
        const sel = this.state.selection.has(it.id);
        const isFolder = it.type === "folder";
        return `<div class="tile ${sel ? "is-selected" : ""}" data-id="${esc(it.id)}" draggable="true">
          <span class="tile-check">${icon("check", 11)}</span>
          <div class="tile-thumb">${this.nodeMark(it, 52, true)}</div>
          <div class="tile-name">${esc(it.name)}</div>
          <div class="tile-meta">${isFolder ? `${(it.children || []).length} 项` : fmtSize(it.size)}</div>
        </div>`;
      })
      .join("")}</div>`;
  },

  loadingHtml() {
    return `<div class="empty"><div class="spinner"></div><h3>正在读取资料库</h3><p>首次打开需要几秒钟。</p></div>`;
  },

  errorHtml(msg) {
    return `<div class="empty">${icon("info", 44)}<h3>读取失败</h3>
      <p>${esc(msg)}</p>
      <button class="btn" style="margin-top:14px" data-retry>重试</button></div>`;
  },

  emptyHtml() {
    const s = this.state;
    if (s.query.trim()) {
      if (s.searchPending) {
        return `<div class="empty"><div class="spinner"></div><h3>正在检索资料库</h3>
          <p>关键词:${esc(s.query.trim())}</p></div>`;
      }
      if (s.searchError) {
        return `<div class="empty">${icon("info", 44)}<h3>检索失败</h3>
          <p>${esc(s.searchError)}</p>
          <p>本地已加载的内容里也没有匹配项。</p></div>`;
      }
      return `<div class="empty">${icon("search", 44)}<h3>没有找到“${esc(s.query)}”</h3>
        <p>已在整库检索名称、编号、备注、标签与原件名。</p></div>`;
    }
    if (s.view === "recycle") {
      return `<div class="empty">${icon("trash", 44)}<h3>回收站是空的</h3><p>删除的记录会在这里保留 30 天。</p></div>`;
    }
    /* 筛选造成的空,和"这个分类本来就没东西"要分开说,否则用户会以为数据丢了 */
    if (s.statusFilter || s.extFilter) {
      const what = s.statusFilter ? `状态为「${esc(s.statusFilter)}」的记录` : "符合条件的文件";
      return `<div class="empty">${icon("filter", 44)}<h3>没有${what}</h3>
        <p>再点一次顶部的「筛选」,选「全部」即可清除条件。</p></div>`;
    }
    return `<div class="empty">${icon("folder", 44)}<h3>这里还没有内容</h3>
      <p>点击“新建”添加一条记录,或把文件拖进来。</p></div>`;
  },

  /* ---------- 详细信息面板 ---------- */

  renderDetail() {
    const panel = $("#detail");
    /* 首页把库概况并进了右栏「资料库」卡片,再开详情就是重复信息 */
    const open = this.state.detailOpen && this.state.view !== "home";
    panel.classList.toggle("open", open);
    if (!open) return;

    const s = this.state;
    const items = this.selectedItems;
    const body = $("#detailBody");
    const locked = s.view === "recycle";

    /* 未选中：当前文件夹信息 */
    if (items.length === 0) {
      const f = s.view === "files" ? this.currentFolder : null;
      if (!f) {
        const sum = s.ready ? VaultStore.summary() : [];
        const all = s.ready ? allFiles(ROOT) : [];
        body.innerHTML = `
          <div class="detail-hero">
            <div class="big-icon">${s.view === "home" ? icon("home", 56) : icon("trash", 56)}</div>
            <div class="detail-title">${esc(s.view === "home" ? VaultStore.dbName || "资料库" : "回收站")}</div>
            <div class="detail-sub">${
              s.view === "recycle" ? RECYCLE.length + " 项" : `${all.length} 个附件`
            }</div>
          </div>
          ${
            s.view === "home" && sum.length
              ? `<div class="detail-section" style="border-bottom:0">
                  <h4>资料构成</h4>
                  ${sum
                    .map(
                      (c) =>
                        `<div class="detail-line"><span>${esc(c.name)}</span><span>${c.count} 条 / ${c.files} 份</span></div>`
                    )
                    .join("")}
                </div>`
              : ""
          }`;
        return;
      }
      const kids = f.children || [];
      const files = kids.filter((k) => k.type === "file").length;
      const folders = kids.length - files;
      /* 分类文件夹里挂的是记录,附件在记录里,所以附件数要递归统计 */
      const st = folderStats(f);
      body.innerHTML = `
        <div class="detail-hero">
          <div class="big-icon">${this.nodeMark(f, 56, true)}</div>
          <div class="detail-title">${esc(f.name)}</div>
          <div class="detail-sub">${folders ? `${folders} 条记录 · ${st.count} 个附件` : `${files} 个附件`}</div>
        </div>
        <div class="detail-section" style="border-bottom:0">
          <h4>位置</h4>
          <div class="detail-line"><span>路径</span><span>${esc((pathTo(f.id) || [ROOT]).map((x) => x.name).join(" / "))}</span></div>
        </div>`;
      return;
    }

    /* 多选 */
    if (items.length > 1) {
      const total = items.reduce((a, b) => a + (b.size || 0), 0);
      body.innerHTML = `
        <div class="detail-hero">
          <div class="big-icon" style="color:var(--brand)">${icon("copy", 56)}</div>
          <div class="detail-title">已选择 ${items.length} 项</div>
          <div class="detail-sub">${total ? `共 ${fmtSize(total)}` : "均为记录"}</div>
        </div>
        <div class="detail-actions">
          ${locked ? "" : `<button class="btn" data-detail-act="download">${icon("download", 16)}下载</button>`}
          <button class="btn" data-detail-act="delete">${icon("trash", 16)}${locked ? "彻底删除" : "删除"}</button>
        </div>
        <div class="detail-section" style="border-bottom:0">
          <h4>包含</h4>
          ${items
            .slice(0, 6)
            .map(
              (i) =>
                `<div class="detail-line"><span class="ellipsis">${esc(i.name)}</span><span>${
                  i.type === "folder" ? `${(i.children || []).length} 项` : fmtSize(i.size)
                }</span></div>`
            )
            .join("")}
          ${items.length > 6 ? `<div class="detail-line"><span>…还有 ${items.length - 6} 项</span><span></span></div>` : ""}
        </div>`;
      return;
    }

    const it = items[0];
    const b = it.biz || {};
    const parent = findParent(it.id);
    const path = parent ? (pathTo(parent.id) || [ROOT]).map((n) => n.name).join(" / ") : "回收站";
    const isFolder = it.type === "folder";

    /* 「修改」入口:只有挂在分类下、带业务字段的记录才给。
       固定分类(没有记录可改)、附件、回收站里的删除项都不出现这个按钮。 */
    const canEdit = isFolder && !it.synthetic && !locked && !!b.kind && b.kind !== "trash" && b.kind !== "archive_folder" && !!b.id;
    const editAct = canEdit
      ? `<button class="sec-act" data-detail-act="edit" title="修改这条记录的属性">${icon("rename", 13)}<span>修改</span></button>`
      : "";

    const actions = `
      <div class="detail-actions">
        ${
          locked ? "" : isFolder
            ? `<button class="btn solid" data-detail-act="open">${icon("folder", 16)}打开</button>`
            : `<button class="btn solid" data-detail-act="preview">${icon("eye", 16)}预览</button>`
        }
        ${
          locked
            ? `<button class="btn" data-detail-act="restore">${icon("restore", 16)}还原</button>
               <button class="btn" data-detail-act="delete">${icon("trashForever", 16)}彻底删除</button>`
            : `<button class="btn" data-detail-act="download">${icon("download", 16)}下载</button>
               <button class="btn" data-detail-act="delete">${icon("trash", 16)}删除</button>`
        }
      </div>`;

    /* 业务字段：只显示有值的行 */
    const rows = [];
    const line = (k, v) => {
      if (v === undefined || v === null || v === "") return;
      rows.push(`<div class="detail-line"><span>${k}</span><span class="ellipsis">${esc(v)}</span></div>`);
    };

    if (isFolder) {
      /* 合同的字段语义和项目不同:签约方 / 签订日期 / 金额,
         共用一个字段表但按 kind 换标签,免得把「负责人」扣在合同上。 */
      const contract = b.kind === "contract";
      line("编号", b.code);
      line("类型", b.typeName);
      line("状态", b.status);
      line(contract ? "签约方" : "负责人", b.owner);
      line("承担单位", b.org);
      line(contract ? "签订日期" : "开始日期", b.start);
      line("结束日期", b.end);
      line("金额", b.amount);
      line("所属年度", b.year);
      line("类别", b.category);
      line("标签", b.tags);
    } else {
      line("大小", fmtSize(it.size));
      const meta = VaultStore.metaOf(it.id);
      if (meta) {
        line("版本", meta.version > 1 ? `第 ${meta.version} 版` : "初版");
        line("摘要", meta.sha256 ? meta.sha256.slice(0, 16) + "…" : "");
      }
    }

    body.innerHTML = `
      <div class="detail-hero">
        <div class="big-icon">${this.nodeMark(it, 56, true)}</div>
        <div class="detail-title">${esc(it.name)}</div>
        <div class="detail-sub">${
          isFolder
            ? it.synthetic
              ? `固定分类 · ${(it.children || []).length} 条记录`
              : b.typeName || "文件夹"
            : typeLabel(it)
        }</div>
      </div>

      ${actions}

      ${
        rows.length
          ? `<div class="detail-section">
              <h4>属性${editAct}</h4>
              ${rows.join("")}
              <div class="detail-line"><span>位置</span><span class="ellipsis">${esc(path)}</span></div>
            </div>`
          : `<div class="detail-section">
              <h4>属性${editAct}</h4>
              ${isFolder ? "" : `<div class="detail-line"><span>大小</span><span>${fmtSize(it.size)}</span></div>`}
              <div class="detail-line"><span>位置</span><span class="ellipsis">${esc(path)}</span></div>
            </div>`
      }

      ${
        isFolder && (it.children || []).length
          ? `<div class="detail-section" style="border-bottom:0">
              <h4>包含 ${it.children.length} 项</h4>
              ${it.children
                .slice(0, 5)
                .map(
                  (c) =>
                    `<div class="detail-line"><span class="ellipsis">${esc(c.name)}</span><span>${
                      c.type === "folder" ? "文件夹" : fmtSize(c.size)
                    }</span></div>`
                )
                .join("")}
              ${it.children.length > 5 ? `<div class="detail-line"><span>…还有 ${it.children.length - 5} 项</span><span></span></div>` : ""}
            </div>`
          : ""
      }

      ${
        b.remarks
          ? `<div class="detail-section" style="border-bottom:0">
              <h4>备注</h4>
              <p class="detail-note">${esc(b.remarks)}</p>
            </div>`
          : ""
      }`;
  },
};

/* ==========================================================================
   Boot
   ========================================================================== */

function bootStaticIcons() {
  const set = (id, svg) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = svg;
  };
  set("brandLogo", brandLogo(26, "top"));
  set("lockLogo", brandLogo(24, "lock"));
  set("searchIcon", icon("search", 16));
  set("searchClear", icon("close", 13));
  set("btnHelp", icon("help", 18));
  set("btnSettings", icon("settings", 18));
  set("settingsClose", icon("close", 15));

  const av = $("#btnAvatar");
  if (av) {
    /* 头像是矢量剪影,不再用姓氏首字 */
    av.innerHTML = icon("avatar", 21);
    av.title = ME.name;
  }

  set("icoNewSide", icon("plus", 18));
  set("icoNew", icon("plus", 17));
  set("icoUpload", icon("upload", 17));
  set("icoRefresh", icon("refresh", 17));
  set("icoSort", icon("sort", 17));
  set("icoFilter", icon("filter", 17));
  set("btnDetailToggle", icon("info", 20));
  set("icoSelDownload", icon("download", 17));
  set("selClear", icon("close", 14));
  set("detailClose", icon("close", 15));
  set("icoSelDelete", icon("trash", 17));
}
