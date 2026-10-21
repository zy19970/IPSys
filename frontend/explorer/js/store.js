/* ==========================================================================
   Store — 业务数据 → OneDrive 文件树
   --------------------------------------------------------------------------
   本系统没有"文件系统",只有台账记录。为了让界面真正是 OneDrive 的交互,
   这里做一层语义映射:

     每条业务记录(项目/资质/成果/知产/资料)  →  一个文件夹
     每个该记录下挂的附件                        →  文件夹里的文件

   于是"双击进入项目看附件""右键删除一条资质""拖拽文件到项目里"
   全部复用 OneDrive 原生交互,不需要另造一套表格操作。

   业务字段完整保留在 node.biz 里,由右侧详细信息面板与表单消费。
   ========================================================================== */

/* 业务记录本身没有"修改时间",用业务上的关键日期作为时间轴。
   这是真实字段,不是补造数据;没有日期就留空,界面显示为「—」。 */
const toTs = (s) => {
  if (!s) return null;
  const str = String(s).trim();
  const d = new Date(str.length === 4 ? str + "-01-01" : str);
  return isNaN(d) ? null : d.getTime();
};

/* ---------------- 分类目录 ----------------
   工作区不同,分类的名称、顺序、有无都不一样。这张表是唯一权威:
   导航、首页、表头、新建菜单、详情面板、回收站全部从这里取名字,
   不要在别处再写一遍中文名。

   来源:E:/Github/管理系统/src/IPSys.Web/wwwroot/app.js companyNav / personalNav。
   合同不在其中 —— 它不是业务模块(老系统里只能从项目详情新建),
   「查看全部合同」汇总视图也不做。 */
const WS_CATS = {
  company: [
    { id: "certificate", label: "企业资质" },
    { id: "achievement", label: "业务档案" },
    { id: "project", label: "公司项目" },
    { id: "ip", label: "知识产权" },
    { id: "general", label: "综合资料" },
  ],
  personal: [
    { id: "certificate", label: "身份与资质" },
    { id: "ip", label: "知识产权与著作" },
    { id: "project", label: "科研与合作项目" },
    { id: "achievement", label: "成果与奖励" },
    { id: "academic", label: "学术与社会活动" },
    { id: "general", label: "其他资料" },
  ],
};

const catsOf = (ws) => WS_CATS[ws] || WS_CATS.personal;
const catLabel = (id, ws) => (catsOf(ws || VaultStore.ws).find((c) => c.id === id) || {}).label || id;

/* 公司「业务档案」的一级是目录(7 个系统目录),不是同类记录 ——
   这一层不能出台账列,进了目录才出。 */
const catIsDir = (id, ws) => id === "achievement" && (ws || VaultStore.ws) === "company";

const VaultStore = {
  ws: "personal",
  token: "",
  dbName: "",
  locked: true,
  loading: false,
  error: null,

  /* nodeId -> 业务数据 */
  biz: new Map(),
  /* nodeId -> 附件元信息(下载/预览需要 fileId + version) */
  fileMeta: new Map(),

  /* ---------------- HTTP ---------------- */

  async api(path, opts = {}) {
    const headers = new Headers(opts.headers || {});
    if (this.token) headers.set("X-IPSys-Token", this.token);
    if (opts.json !== undefined) {
      headers.set("Content-Type", "application/json");
      opts.body = JSON.stringify(opts.json);
    }
    const res = await fetch(path, { ...opts, headers, cache: "no-store" });
    if (!res.ok) {
      let msg = `请求失败：${res.status}`;
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch {}
      if (res.status === 401) {
        this.token = "";
        this.locked = true;
      }
      throw new Error(msg);
    }
    return res;
  },

  async getJson(path) {
    return (await this.api(path)).json();
  },

  /* ---------------- 会话 ---------------- */

  async status() {
    const s = await this.getJson("/api/status");
    this.locked = !s.unlocked;
    return s;
  },

  async open(path, password, create = false) {
    const res = await this.api("/api/open", {
      method: "POST",
      json: { path, password, create },
    });
    const r = await res.json();
    this.token = r.token;
    this.dbName = r.name;
    this.locked = false;
    return r;
  },

  /* 服务端资料库仍是打开状态、但浏览器已丢失 token(换标签页/刷新后)时,
     只能用密码重新换一个 token,不能再走 /api/open。 */
  async resume(password) {
    const res = await this.api("/api/resume", { method: "POST", json: { password } });
    const r = await res.json();
    this.token = r.token;
    this.dbName = r.name;
    this.locked = false;
    return r;
  },

  /* ---------------- 加载 ---------------- */

  async loadAll(ws = "company") {
    this.ws = ws;
    this.loading = true;
    this.error = null;
    const w = encodeURIComponent(ws);

    const [projects, archive, ip, projectFiles] = await Promise.all([
      this.getJson(`/api/v2/ui/projects/${w}`).catch(() => []),
      this.getJson(`/api/v2/ui/archive/${w}`).catch(() => ({})),
      this.getJson(`/api/v2/ui/ip/${w}`).catch(() => ({})),
      this.getJson(`/api/v2/ui/project-files/${w}`).catch(() => []),
    ]);

    this.biz.clear();
    this.fileMeta.clear();

    ROOT = this.buildTree({ ws, projects, archive, ip, projectFiles });
    RECYCLE = await this.loadRecycle(ws);
    this.loading = false;
    return ROOT;
  },

  /* 后端回收站是扁平的 {kind,id,name,section,parent} 列表,
     kind 用 v2_* 前缀区分资源类型。这里翻译成可浏览的节点。 */
  async loadRecycle(ws) {
    const KIND_MAP = {
      project: { typeName: "项目", folder: true },
      ip: { typeName: "知识产权", folder: true },
      v2_archive: { typeName: "档案记录", folder: true },
      v2_general: { typeName: "综合资料", folder: true },
      v2_ip_file: { typeName: "知识产权附件", folder: false },
      v2_file: { typeName: "项目附件", folder: false },
      v2_archive_file: { typeName: "档案附件", folder: false },
    };

    try {
      const rows = await this.getJson(`/api/trash/${encodeURIComponent(ws)}`);
      const list = Array.isArray(rows) ? rows : rows.items || [];
      /* 合同不是业务模块,恢复出来也没有地方放 —— 不进回收站列表 */
      return list
        .filter((r) => r.kind !== "contract")
        .map((r) => {
          const info = KIND_MAP[r.kind] || { typeName: r.kind || "记录", folder: true };
          const id = `t:${r.kind}:${r.id}`;
          const node = info.folder
            ? F(r.name || "未命名", { id })
            : D(r.name || "未命名", 0, { id });
          node.biz = {
            kind: "trash",
            typeName: info.typeName,
            folder: info.folder,
            raw: r,
          };
          return node;
        });
    } catch {
      return [];
    }
  },

  /* ---------------- 建树 ---------------- */

  buildTree({ ws, projects, archive, ip, projectFiles }) {
    const root = F("我的文件", { id: "root", mtime: Date.now() });
    root.children = [];

    /* 附件按 owner 分组 —— 各接口字段名不统一,这里统一成 ownerId */
    const byOwner = new Map();
    const push = (ownerId, node) => {
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
      byOwner.get(ownerId).push(node);
    };

    for (const f of projectFiles || []) {
      const node = D(f.displayName || f.name || "附件", f.size, {
        id: `f:${f.linkId}:${f.version}`,
      });
      node.biz = { kind: "file", ownerKind: f.kind };
      this.fileMeta.set(node.id, {
        fileId: f.fileId,
        version: f.version,
        linkId: f.linkId,
        name: f.name,
        sha256: f.sha256,
      });
      push(f.folderId, node);
    }

    const archiveFiles = archive?.files || [];
    for (const f of archiveFiles) {
      const node = D(f.name || "附件", f.size, { id: `f:${f.linkId}:${f.version}` });
      node.biz = { kind: "file", ownerKind: f.kind, section: f.section, category: f.category };
      this.fileMeta.set(node.id, {
        fileId: f.fileId,
        version: f.version,
        linkId: f.linkId,
        name: f.name,
        sha256: f.sha256,
      });
      push(f.ownerId, node);
    }

    for (const f of ip?.files || []) {
      const node = D(f.displayName || f.name || "附件", f.size, { id: `f:${f.linkId}:${f.version}` });
      node.biz = { kind: "file", ownerKind: "ip" };
      this.fileMeta.set(node.id, {
        fileId: f.fileId,
        version: f.version,
        linkId: f.linkId,
        name: f.name,
        sha256: f.sha256,
      });
      push(f.folderId, node);
    }

    const attach = (node, ownerId) => {
      const kids = byOwner.get(ownerId) || [];
      kids.sort((a, b) => cmpName(a, b));
      node.children = kids;
      const bytes = kids.reduce((s, k) => s + (k.size || 0), 0);
      node.size = bytes;
      return node;
    };

    /* ---- 各分类的记录 ----
       分类的顺序、名称、有无全部由 WS_CATS 决定,这里只负责把数据装进去。 */

    /* 档案类(资质 / 成果 / 学术)字段完全一致,共用一套构造 */
    const archiveRecordsOf = (section) =>
      (archive?.archives || [])
        .filter((a) => a.section === section)
        .map((a) => {
          const node = F(a.name || `记录 ${a.id}`, { id: `a:${section}:${a.id}` });
          node.mtime = toTs(a.year);
          node.dateLabel = a.year ? `${a.year} 年` : "";
          node.biz = {
            kind: "archive",
            section,
            typeName: catLabel(section, ws),
            status: "",
            code: "",
            owner: "",
            year: a.year || "",
            category: a.category || "",
            remarks: a.remarks || "",
            tags: a.tags || "",
            folderId: a.folderId ?? null,
            raw: a,
            id: a.id,
          };
          this.biz.set(node.id, node.biz);
          return attach(node, a.id);
        });

    const builders = {
      certificate: () => archiveRecordsOf("certificate"),
      achievement: () => archiveRecordsOf("achievement"),
      academic: () => archiveRecordsOf("academic"),

      project: () =>
        (projects || []).map((p) => {
          const node = F(p.name || `项目 ${p.id}`, { id: `p:${p.id}` });
          node.mtime = toTs(p.endDate || p.startDate);
          node.dateLabel = p.endDate || p.startDate || "";
          node.biz = {
            kind: "project",
            typeName: p.projectType || "项目",
            status: p.projectStatus || "",
            code: p.projectNo || "",
            owner: p.leader || "",
            org: p.undertakingOrg || "",
            start: p.startDate || "",
            end: p.endDate || "",
            category: p.category || "",
            remarks: p.remarks || "",
            tags: p.tags || "",
            raw: p,
            id: p.id,
          };
          this.biz.set(node.id, node.biz);
          return attach(node, p.id);
        }),

      ip: () =>
        (ip?.rows || []).map((row) => {
          const d = row.data || row;
          const node = F(d.name || d.Name || `知识产权 ${row.id}`, { id: `i:${row.id}` });
          node.mtime = toTs(d.applicationDate || d.ApplicationDate || d.grantDate || d.GrantDate);
          node.dateLabel = d.applicationDate || d.ApplicationDate || d.grantDate || d.GrantDate || "";
          node.biz = {
            kind: "ip",
            typeName: d.ipType || d.IpType || "知识产权",
            status: d.status || d.Status || "",
            code: d.applicationNo || d.ApplicationNo || "",
            owner: d.rightHolders || d.RightHolders || "",
            start: d.applicationDate || d.ApplicationDate || "",
            end: d.grantDate || d.GrantDate || "",
            category: d.category || d.Category || "",
            remarks: d.remarks || d.Remarks || "",
            tags: d.tags || d.Tags || "",
            applicants: d.applicants || d.Applicants || "",
            creators: d.creators || d.Creators || "",
            raw: d,
            id: row.id,
          };
          this.biz.set(node.id, node.biz);
          return attach(node, row.id);
        }),

      general: () =>
        (archive?.general || []).map((g) => {
          const node = F(g.title || `资料 ${g.id}`, { id: `g:${g.id}` });
          node.biz = {
            kind: "general",
            typeName: "综合资料",
            status: "",
            code: "",
            owner: "",
            remarks: "",
            tags: "",
            raw: g,
            id: g.id,
          };
          this.biz.set(node.id, node.biz);
          const kids = (g.files || []).map((f) => {
            const n = D(f.name || "附件", f.size, { id: `f:${f.linkId}:${f.version}` });
            n.biz = { kind: "file", ownerKind: "general" };
            this.fileMeta.set(n.id, {
              fileId: f.fileId,
              version: f.version,
              linkId: f.linkId,
              name: f.name,
              sha256: f.sha256,
            });
            return n;
          });
          kids.sort((a, b) => cmpName(a, b));
          node.children = kids;
          node.size = kids.reduce((s, k) => s + (k.size || 0), 0);
          return node;
        }),
    };

    /* 公司「业务档案」的一级是目录树:7 个系统目录(后端 is_system=1),
       记录按 folderId 挂进目录;目录本身不是业务记录。 */
    const buildArchiveDirs = (records) => {
      const dirs = (archive?.folders || [])
        .filter((f) => f.parentId === null || f.parentId === undefined)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((f) => {
          const d = F(f.name || "未命名目录", { id: `af:${f.id}` });
          d.biz = { kind: "archive_folder", typeName: "目录", id: f.id, isSystem: !!f.isSystem };
          /* order 是后端 position:系统目录有固定业务顺序(申报与认定打头),
             不能被拼音序打乱。见 app.js sortedItems。 */
          d.order = Number(f.position) || 0;
          d.children = [];
          return d;
        });

      const byId = new Map(dirs.map((d) => [String(d.biz.id), d]));
      const loose = [];
      for (const r of records) {
        const dir = r.biz.folderId != null ? byId.get(String(r.biz.folderId)) : null;
        if (dir) dir.children.push(r);
        else loose.push(r);
      }

      for (const d of dirs) {
        d.children.sort((a, b) => cmpName(a, b));
        const times = d.children.map((x) => x.mtime).filter(Boolean);
        d.mtime = times.length ? Math.max(...times) : null;
        d.size = d.children.reduce((n, x) => n + (x.size || 0), 0);
      }
      /* 目录在前(按后端 position 排),没归目录的记录跟在后面 */
      return [...dirs, ...loose.sort((a, b) => cmpName(a, b))];
    };

    root.children = catsOf(ws).map(({ id, label }, i) => {
      const k = F(label, { id: `k:${id}`, synthetic: true });
      /* 分类的先后由 WS_CATS 决定,不参与拼音排序(见 app.js sortedItems) */
      k.order = i;
      const records = builders[id] ? builders[id]() : [];

      if (catIsDir(id, ws)) k.children = buildArchiveDirs(records);
      else k.children = records.sort((a, b) => cmpName(a, b));

      /* 根节点时间 = 最新子项时间，用于排序稳定 */
      const times = k.children.map((x) => x.mtime).filter(Boolean);
      k.mtime = times.length ? Math.max(...times) : null;
      return k;
    });

    return root;
  },

  /* ---------------- 查询 ---------------- */

  bizOf(id) {
    return this.biz.get(id) || findById(id)?.biz || null;
  },

  metaOf(id) {
    return this.fileMeta.get(id) || null;
  },

  /* 分类汇总，首页与导航用。
     条数按「业务记录」递归数,不能拿 children.length ——
     公司业务档案的一级是 7 个目录,那些不是记录。 */
  summary() {
    const RECORD_KINDS = new Set(["project", "archive", "ip", "general"]);
    const out = [];
    for (const c of ROOT.children || []) {
      const st = folderStats(c);
      let count = 0;
      walk(c, (n) => {
        if (n !== c && n.type === "folder" && RECORD_KINDS.has((n.biz || {}).kind)) count++;
      });
      out.push({
        id: c.id,
        name: c.name,
        count,
        files: st.count,
        bytes: st.bytes,
        mtime: c.mtime || null,
        kind: c.id.slice(2),
      });
    }
    return out;
  },
};
