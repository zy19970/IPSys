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

/* 公司「业务档案」的一级是普通目录(新库默认建七个),不是同类记录 ——
   这一层不能出台账列,进了目录才出。 */
const catIsDir = (id, ws) => id === "achievement" && (ws || VaultStore.ws) === "company";

const VaultStore = {
  ws: "personal",
  token: "",
  dbName: "",
  locked: true,
  loading: false,
  error: null,
  onSessionExpired: null,
  // Physical SQLCipher page usage is shared by all workspaces.
  storage: null,
  storageError: "",
  storageRequest: 0,

  async refreshStorage(attempt = 0) {
    const token = this.token;
    if (!token) return;
    const request = ++this.storageRequest;
    try {
      const values = await this.getJson("/api/vault/storage");
      if (token !== this.token || request !== this.storageRequest) return;
      const total = Number(values.totalBytes);
      const used = Number(values.usedBytes);
      const free = Number(values.freeBytes);
      if (![total, used, free].every(Number.isSafeInteger) ||
          total <= 0 || used < 0 || free < 0 || used + free !== total)
        throw new Error("数据库页面统计不完整");
      this.storage = { total, used, free };
      this.storageError = "";
      Drive.paintStorage();
    } catch (error) {
      if (token !== this.token || request !== this.storageRequest) return;
      // The read-only endpoint returns 409 instead of waiting for file tasks.
      if (/请求失败：409|正在处理任务|文件任务进行中|数据库忙/.test(error.message) && attempt < 3) {
        setTimeout(() => {
          if (this.token === token) void this.refreshStorage(attempt + 1);
        }, 650);
        return;
      }
      this.storageError = "数据库空间暂不可用";
      Drive.paintStorage();
    }
  },

  /* nodeId -> 业务数据 */
  biz: new Map(),
  /* nodeId -> 附件元信息(下载/预览需要 fileId + version) */
  fileMeta: new Map(),

  /* ---------------- HTTP ---------------- */

  /* One transition per authenticated session. Late replies cannot revoke
     the token from a newer /api/resume; shared by fetch, XHR and purge. */
  expireSession(requestToken) {
    if (!requestToken || this.token !== requestToken) return false;
    this.token = "";
    this.locked = true;
    this.needsResume = false;
    this.storageRequest++;
    this.storage = null;
    this.storageError = "";
    sessionStorage.removeItem("od-token");
    sessionStorage.removeItem("od-db");
    this.onSessionExpired?.();
    return true;
  },

  async api(path, opts = {}) {
    const requestToken = this.token;
    const headers = new Headers(opts.headers || {});
    if (requestToken) headers.set("X-IPSys-Token", requestToken);
    if (opts.json !== undefined) {
      headers.set("Content-Type", "application/json");
      opts.body = JSON.stringify(opts.json);
    }
    const res = await fetch(path, { ...opts, headers, cache: "no-store" });
    if (res.status === 401) this.expireSession(requestToken);
    if (!res.ok) {
      let msg = `请求失败：${res.status}`;
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch {}
      throw new Error(msg);
    }
    if (requestToken && this.token !== requestToken)
      throw new Error("会话已变更，请重新连接资料库。");
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
    this.storageRequest++;
    this.storage = null;
    this.storageError = "";
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
    this.storageRequest++;
    this.storage = null;
    this.storageError = "";
    return r;
  },

  /* ---------------- 加载 ---------------- */

  async loadAll(ws = "company") {
    this.ws = ws;
    this.loading = true;
    this.error = null;
    const w = encodeURIComponent(ws);

    const required = async (label, path) => {
      try {
        return await this.getJson(path);
      } catch (e) {
        throw new Error(label + "加载失败：" + (e.message || String(e)));
      }
    };
    try {
      const [projects, contracts, archive, ip, projectFiles] = await Promise.all([
        required("项目", `/api/v2/ui/projects/${w}`),
        required("合同", `/api/v2/ui/contracts/${w}`),
        required("业务档案", `/api/v2/ui/archive/${w}`),
        required("知识产权", `/api/v2/ui/ip/${w}`),
        required("附件", `/api/v2/ui/project-files/${w}`),
      ]);
      /* 全部必需接口成功以后，才可以替换旧树；失败不是「空库」。 */
      const recycle = await this.loadRecycle(ws);
      this.biz.clear();
      this.fileMeta.clear();
      ROOT = this.buildTree({ ws, projects, contracts, archive, ip, projectFiles });
      RECYCLE = recycle;
      return ROOT;
    } catch (e) {
      this.error = e.message || String(e);
      throw e;
    } finally {
      this.loading = false;
    }
  },

  /* 后端回收站是扁平的 {kind,id,name,section,parent} 列表,
     kind 用 v2_* 前缀区分资源类型。这里翻译成可浏览的节点。 */
  /* ---- 服务端搜索 ----
     后端按名称、编号、备注、标签、签约方、原件名等业务字段在整库范围检索。
     前端只保留一个本地兜底(见 app.js 的 localSearch),权威结果从这里来。 */
  async search(ws, q) {
    const text = String(q ?? "").trim();
    if (!text) return { query: "", results: [], truncated: false };
    return this.getJson(
      `/api/v2/search/${encodeURIComponent(ws)}?q=${encodeURIComponent(text)}`
    );
  },

  /* 命中项只带 kind/id/section,节点本身仍从已加载的树里取 ——
     这样双击、右键、导出、详情面板全部沿用现有语义,不必单开一套只读节点。
     取不到说明这条数据在本次加载之后变了,直接丢弃并计数。 */
  resolveHits(response) {
    const out = [];
    const seen = new Set();
    for (const hit of response?.results || []) {
      const node = this.nodeOfHit(hit);
      if (node && !seen.has(node.id)) {
        seen.add(node.id);
        out.push(node);
      }
    }
    return out;
  },

  /* 命中项 → 树节点 id。附件归 owner 管,所以分两步。 */
  nodeOfHit(hit) {
    const id = Number(hit?.id) || 0;
    if (!id) return null;
    if (hit.kind === "file") {
      const owner = findById(this.ownerIdOfHit(hit));
      if (!owner) return null;
      const meta = this.fileMeta;
      return (owner.children || []).find((c) => meta.get(c.id)?.fileId === id) || null;
    }
    const nodeId =
      hit.kind === "project"
        ? `p:${id}`
        : hit.kind === "contract"
        ? `c:${id}`
        : hit.kind === "ip"
        ? `i:${id}`
        : hit.kind === "archive"
        ? `a:${hit.section}:${id}`
        : hit.kind === "general"
        ? `g:${id}`
        : "";
    return nodeId ? findById(nodeId) : null;
  },

  /* 附件的 ownerKind 用的是后端 FolderKinds 的字面值(project/contract/ip/archive/general) */
  ownerIdOfHit(hit) {
    const id = Number(hit?.ownerId) || 0;
    if (!id) return "";
    switch (hit.ownerKind) {
      case "project":
        return `p:${id}`;
      case "contract":
        return `c:${id}`;
      case "ip":
        return `i:${id}`;
      case "archive":
        return `a:${hit.section}:${id}`;
      case "general":
        return `g:${id}`;
      default:
        return "";
    }
  },

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
    } catch (e) {
      throw new Error("回收站加载失败：" + (e.message || String(e)));
    }
  },

  /* ---------------- 建树 ---------------- */

  buildTree({ ws, projects, contracts, archive, ip, projectFiles }) {
    const root = F("我的文件", { id: "root", mtime: Date.now() });
    root.children = [];

    /* 附件按 owner 分组 —— 各接口字段名不统一,这里统一成 ownerId */
    const byOwner = new Map();
    const push = (ownerId, node) => {
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
      byOwner.get(ownerId).push(node);
    };


    /* 每个 LinkId 是一条逻辑附件。只展示当前最高版本；历史版本仍由后端保存。 */
    const latestLinks = (rows) => {
      const latest = new Map();
      for (const f of rows || []) {
        if (f?.linkId == null || f.version == null) continue;
        const key = String(f.linkId);
        if (!latest.has(key) || Number(f.version) > Number(latest.get(key).version))
          latest.set(key, f);
      }
      return [...latest.values()];
    };
    const attachmentNode = (f, ownerKind, extra = {}) => {
      const node = D(f.displayName || f.name || "附件", f.size, {
        id: "f:" + f.linkId + ":" + f.version,
      });
      node.biz = { kind: "file", ownerKind, ...extra };
      this.fileMeta.set(node.id, {
        fileId: f.fileId,
        version: f.version,
        linkId: f.linkId,
        name: f.name,
        sha256: f.sha256,
      });
      return node;
    };

    for (const f of latestLinks(projectFiles)) {
      push(f.folderId, attachmentNode(f, f.kind));
    }

    for (const f of latestLinks(archive?.files)) {
      push(f.ownerId, attachmentNode(f, f.kind, {
        section: f.section, category: f.category,
      }));
    }

    for (const f of latestLinks(ip?.files)) {
      push(f.folderId, attachmentNode(f, "ip"));
    }

    const attach = (node, ownerId) => {
      const kids = byOwner.get(ownerId) || [];
      kids.sort((a, b) => cmpName(a, b));
      node.children = kids;
      const bytes = kids.reduce((s, k) => s + (k.size || 0), 0);
      node.size = bytes;
      return node;
    };

    /* ---- 合同 ----
       合同跟着项目走:合同节点是所属项目的一个子节点,合同自己的附件再挂在
       合同下面,于是「项目 / 合同 / 原件」三层在树里是真实层级,不用另外拼。
       后端 project-files 里合同附件的 folderId 就是合同 folder 自己的 id,
       所以附件照样由 attach() 按 ownerId 挂载,这里只负责把合同节点建出来。 */
    const contractsByProject = new Map();
    for (const c of contracts || []) {
      const node = F(c.name || `合同 ${c.id}`, { id: `c:${c.id}` });
      node.mtime = toTs(c.signDate);
      node.dateLabel = c.signDate || "";
      node.biz = {
        kind: "contract",
        typeName: "合同",
        status: "",
        code: c.contractNo || "",
        owner: c.signingParties || "",
        amount: c.amount || "",
        start: c.signDate || "",
        category: c.category || "",
        remarks: c.remarks || "",
        tags: c.tags || "",
        projectId: c.projectId,
        projectName: c.projectName || "",
        raw: c,
        id: c.id,
      };
      this.biz.set(node.id, node.biz);
      attach(node, c.id);
      if (!contractsByProject.has(c.projectId)) contractsByProject.set(c.projectId, []);
      contractsByProject.get(c.projectId).push(node);
    }

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
          node.order = a.position == null ? null : Number(a.position);
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
          const own = attach(node, p.id);
          /* 合同和项目自己的附件同层。合同节点已由上面建好并 attach 过,
             这里只做合并与统一排序,避免两段各自的排序规则不一致。 */
          const subs = contractsByProject.get(p.id);
          if (subs?.length) {
            node.children = [...own.children, ...subs].sort((a, b) => cmpName(a, b));
            node.size = node.children.reduce((s, k) => s + (k.size || 0), 0);
          }
          return node;
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
          const kids = latestLinks(g.files).map((f) => attachmentNode(f, "general"));
          kids.sort((a, b) => cmpName(a, b));
          node.children = kids;
          node.size = kids.reduce((s, k) => s + (k.size || 0), 0);
          return node;
        }),
    };

    /* 公司业务档案以普通目录构成目录树，新库初始建立七个目录。
       目录可以重命名、移动或删除；记录按 folderId 挂入目录。 */

    const buildArchiveDirs = (records) => {
      const folders = archive?.folders || [];
      const dirs = folders.map((f) => {
        const d = F(f.name || "未命名目录", { id: "af:" + f.id });
        d.biz = {
          kind: "archive_folder", typeName: "目录", id: f.id,
          parentId: f.parentId ?? null,
        };
        d.order = f.position == null ? null : Number(f.position);
        d.children = [];
        return d;
      });
      const byId = new Map(dirs.map((d) => [String(d.biz.id), d]));
      const roots = [];
      for (const f of folders) {
        const dir = byId.get(String(f.id));
        const parent = f.parentId == null ? null : byId.get(String(f.parentId));
        if (parent && parent !== dir) parent.children.push(dir);
        else roots.push(dir);
      }

      const loose = [];
      for (const r of records) {
        const dir = r.biz.folderId != null ? byId.get(String(r.biz.folderId)) : null;
        if (dir) dir.children.push(r);
        else loose.push(r);
      }

      /* 服务端 orders 已混排目录与记录：统一按这一顺序处理每层兄弟节点。 */
      const sortPeers = (nodes, parentId) => {
        const entries = archive?.orders?.[String(parentId ?? 0)] || [];
        const positions = new Map(entries.map((item, i) => [
          item.kind === "folder" ? "af:" + item.id : "a:achievement:" + item.id, i,
        ]));
        for (const item of nodes) {
          const index = positions.get(item.id);
          if (index !== undefined) item.order = index;
        }
        nodes.sort((a, b) => {
          const ao = Number.isFinite(a.order) ? a.order : Infinity;
          const bo = Number.isFinite(b.order) ? b.order : Infinity;
          return ao - bo || cmpName(a, b);
        });
      };

      const finalize = (dir) => {
        for (const child of dir.children) {
          if (child.biz?.kind === "archive_folder") finalize(child);
        }
        sortPeers(dir.children, dir.biz.id);
        const times = dir.children.map((x) => x.mtime).filter(Boolean);
        dir.mtime = times.length ? Math.max(...times) : null;
        dir.size = dir.children.reduce((n, x) => n + (x.size || 0), 0);
      };
      for (const dir of roots) finalize(dir);
      const rootItems = [...roots, ...loose];
      sortPeers(rootItems, null);
      return rootItems;
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
