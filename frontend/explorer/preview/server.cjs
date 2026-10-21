/* 本地预览服务 — 模拟管理系统后端契约
   --------------------------------------------------------------------------
   /app.js 与 /style.css 由开发源文件实时拼接,和真实服务端的固定路径一致:
   改 js/*.js 立即生效,不需要先打包。
   部署时用 tools/bundle.cjs 生成静态产物。 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8776);

/* 拼接顺序 = 依赖顺序 */
const BUNDLE = ["js/icons.js", "js/data.js", "js/store.js", "js/app.js", "js/forms.js", "js/interactions.js"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function json(res, body, code = 200) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function text(res, body, type) {
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

/* ---------------- 演示数据 ---------------- */

const projects = [
  { id: 101, name: "智能矿山一体化管控平台", projectType: "科研项目", projectNo: "KY-2026-001", leader: "陈明远", undertakingOrg: "北京北矿智能科技有限公司", startDate: "2026-01-10", endDate: "2026-11-20", projectStatus: "进行中", category: "智能矿山", remarks: "", tags: "矿山;平台" },
  { id: 102, name: "选矿厂数字孪生关键技术", projectType: "科研项目", projectNo: "KY-2026-007", leader: "李维", undertakingOrg: "北京北矿智能科技有限公司", startDate: "2026-03-01", endDate: "2026-12-15", projectStatus: "进行中", category: "数字孪生", remarks: "", tags: "选矿;孪生" },
  { id: 103, name: "国资委对标世界一流管理提升", projectType: "其他项目", projectNo: "DB-2026-002", leader: "陈明远", undertakingOrg: "矿冶科技集团", startDate: "2026-02-01", endDate: "2026-10-31", projectStatus: "进行中", category: "管理提升", remarks: "", tags: "对标;管理" },
  { id: 104, name: "尾矿库在线监测系统集成", projectType: "横向项目", projectNo: "HX-2025-031", leader: "王海涛", undertakingOrg: "北京北矿智能科技有限公司", startDate: "2025-06-01", endDate: "2026-06-30", projectStatus: "已完成", category: "安全监测", remarks: "", tags: "尾矿库;监测" },
];

const contracts = [
  { id: 201, projectId: 101, projectName: "智能矿山一体化管控平台", name: "智能矿山平台技术服务合同", contractNo: "HT-2026-0012", signDate: "2026-01-05", amount: "1860000", signingParties: "北京北矿智能科技有限公司 / 中国黄金集团", category: "技术服务", remarks: "", tags: "" },
  { id: 202, projectId: 102, projectName: "选矿厂数字孪生关键技术", name: "数字孪生联合研发协议", contractNo: "HT-2026-0028", signDate: "2026-02-20", amount: "920000", signingParties: "北京北矿智能科技有限公司 / 中南大学", category: "合作研发", remarks: "", tags: "" },
  { id: 203, projectId: 104, projectName: "尾矿库在线监测系统集成", name: "尾矿库监测系统采购合同", contractNo: "HT-2025-0187", signDate: "2025-05-18", amount: "2450000", signingParties: "北京北矿智能科技有限公司 / 洛阳栾川钼业", category: "设备采购", remarks: "", tags: "" },
];

/* 公司「业务档案」的 7 个系统目录 —— 与 ResourceSchemaV2.cs:200-206 的种子一致 */
const archiveFolders = [
  { id: 1, parentId: null, name: "申报与认定", position: 0, isSystem: true },
  { id: 2, parentId: null, name: "规划与管理", position: 1, isSystem: true },
  { id: 3, parentId: null, name: "汇报与宣传", position: 2, isSystem: true },
  { id: 4, parentId: null, name: "会议与活动", position: 3, isSystem: true },
  { id: 5, parentId: null, name: "专项工作与合作", position: 4, isSystem: true },
  { id: 6, parentId: null, name: "政策与行业资料", position: 5, isSystem: true },
  { id: 7, parentId: null, name: "其他业务资料", position: 6, isSystem: true },
];

const archives = [
  { id: 301, section: "certificate", name: "高新技术企业证书", category: "资质证书", remarks: "有效期至 2027-03-31", tags: "", year: "2024", folderId: null, position: 0 },
  { id: 302, section: "certificate", name: "CMMI 三级认证", category: "体系认证", remarks: "复审 2026-11-30", tags: "", year: "2025", folderId: null, position: 1 },
  { id: 303, section: "certificate", name: "信息系统安全等级保护三级", category: "安全资质", remarks: "", tags: "", year: "2025", folderId: null, position: 2 },
  { id: 304, section: "achievement", name: "智能选矿过程优化技术", category: "科技进步奖", remarks: "2026 年度冶金科学技术奖二等奖", tags: "获奖", year: "2026", folderId: 1, position: 0 },
  { id: 305, section: "achievement", name: "矿山设备预测性维护方法", category: "鉴定成果", remarks: "", tags: "", year: "2025", folderId: 2, position: 1 },
];

const ipRows = [
  { id: 401, data: { name: "一种基于数字孪生的选矿过程优化方法", ipType: "发明专利", status: "实质审查中", applicants: "北京北矿智能科技有限公司", rightHolders: "北京北矿智能科技有限公司", creators: "陈明远;李维", applicationNo: "CN202610123456.7", applicationDate: "2026-02-11", publicationNo: "", publicationDate: "", grantNoticeNo: "", grantNoticeDate: "", publicationInfo: "", grantDate: "", registrationNo: "", firstPublishedDate: "", registrationDate: "", category: "选矿", remarks: "", tags: "" } },
  { id: 402, data: { name: "矿山智能管控平台 V3.0", ipType: "软件著作权", status: "已登记", applicants: "北京北矿智能科技有限公司", rightHolders: "北京北矿智能科技有限公司", creators: "陈明远;王海涛", applicationNo: "", applicationDate: "", publicationNo: "", publicationDate: "", grantNoticeNo: "", grantNoticeDate: "", publicationInfo: "", grantDate: "", registrationNo: "2026SR0456789", firstPublishedDate: "2026-01-20", registrationDate: "2026-03-15", category: "软件", remarks: "", tags: "" } },
];

const general = [
  { id: 501, title: "公司简介与业绩汇编", files: [] },
  { id: 502, title: "ISO 质量体系文件", files: [] },
];

function mkFile(folderId, linkId, fileId, version, name, size, kind) {
  return { linkId, fileId, version, name, displayName: name, category: "", size, sha256: "9f2c4e8a1b7d3f60", folderId, ownerId: folderId, kind };
}

const projectFiles = [
  mkFile(101, 9001, 7001, 1, "智能矿山平台技术方案_v3.pdf", 4820000, "project"),
  mkFile(101, 9002, 7002, 1, "需求规格说明书.docx", 1260000, "project"),
  mkFile(101, 9003, 7003, 1, "接口清单.xlsx", 384000, "project"),
  mkFile(101, 9004, 7004, 2, "现场勘察照片.png", 2140000, "project"),
  mkFile(102, 9005, 7005, 1, "选矿孪生模型说明.docx", 980000, "project"),
  mkFile(102, 9006, 7006, 1, "仿真数据集.xlsx", 5600000, "project"),
  mkFile(103, 9007, 7007, 1, "对标指标体系.xlsx", 620000, "project"),
  mkFile(103, 9008, 7008, 1, "差距分析报告.docx", 1840000, "project"),
  mkFile(103, 9009, 7009, 1, "世界一流企业案例汇编.pdf", 8200000, "project"),
  mkFile(104, 9010, 7010, 1, "尾矿库监测验收报告.pdf", 3400000, "project"),
  mkFile(201, 9101, 7101, 1, "技术服务合同扫描件.pdf", 2680000, "contract"),
  mkFile(201, 9102, 7102, 1, "合同附件-技术条款.docx", 420000, "contract"),
  mkFile(202, 9103, 7103, 1, "联合研发协议.pdf", 1920000, "contract"),
  mkFile(203, 9104, 7104, 1, "采购合同正本.pdf", 2240000, "contract"),
];

const archiveFiles = [
  mkFile(301, 9201, 7201, 1, "高新技术企业证书.pdf", 860000, "archive"),
  mkFile(301, 9202, 7202, 1, "高企认定批复.pdf", 640000, "archive"),
  mkFile(302, 9203, 7203, 1, "CMMI3 评估报告.pdf", 1420000, "archive"),
  mkFile(303, 9204, 7204, 1, "等保测评报告.pdf", 2060000, "archive"),
  mkFile(304, 9205, 7205, 1, "科技进步奖证书.pdf", 780000, "archive"),
  mkFile(305, 9206, 7206, 1, "科技成果鉴定意见.pdf", 1180000, "archive"),
];
archiveFiles.forEach((f) => {
  const a = archives.find((x) => x.id === f.folderId);
  if (a) {
    f.section = a.section;
    f.ownerId = f.folderId;
  }
});

const ipFiles = [
  Object.assign(mkFile(401, 9301, 7301, 1, "专利申请文件.pdf", 1560000, "ip"), { category: "申请文件" }),
  Object.assign(mkFile(402, 9302, 7302, 1, "软件著作权登记证书.pdf", 720000, "ip"), { category: "登记证书" }),
];

const trash = [
  { kind: "project", id: 105, name: "已终止的试点项目", section: "", parent: null },
  { kind: "v2_archive", id: 306, name: "过期的旧版资质", section: "certificate", parent: null },
  { kind: "contract", id: 204, name: "作废的采购合同", section: "", parent: "智能矿山一体化管控平台" },
];

/* ---------------- 个人工作区 ---------------- */

const pProjects = [
  { id: 601, name: "青年科技人才托举工程", projectType: "科研项目", projectNo: "QT-2026-004", leader: "陈明远", undertakingOrg: "北京北矿智能科技有限公司", startDate: "2026-01-01", endDate: "2027-12-31", projectStatus: "进行中", category: "人才培养", remarks: "个人主持", tags: "人才;托举" },
  { id: 602, name: "矿物加工专业知识体系梳理", projectType: "其他项目", projectNo: "QT-2026-011", leader: "陈明远", undertakingOrg: "个人", startDate: "2026-04-01", endDate: "2026-12-31", projectStatus: "进行中", category: "知识管理", remarks: "", tags: "知识库" },
];

const pArchives = [
  { id: 711, section: "certificate", name: "硕士学位证书", category: "学历学位", remarks: "矿物加工工程", tags: "学历", year: "2019", folderId: null, position: 0 },
  { id: 712, section: "certificate", name: "工程师职称证书", category: "职称证书", remarks: "中级", tags: "职称", year: "2023", folderId: null, position: 1 },
  { id: 713, section: "certificate", name: "任职文件（研发部）", category: "任职证明", remarks: "", tags: "", year: "2024", folderId: null, position: 2 },
  { id: 701, section: "achievement", name: "2026 年度青年科技奖", category: "人才荣誉", remarks: "中国有色金属工业协会", tags: "获奖", year: "2026", folderId: null, position: 0 },
  { id: 702, section: "achievement", name: "优秀工程技术人员", category: "荣誉称号", remarks: "矿冶科技集团", tags: "荣誉", year: "2025", folderId: null, position: 1 },
  { id: 703, section: "academic", name: "复杂难选铁矿浮选工艺研究", category: "硕士学位论文", remarks: "中国矿业大学", tags: "论文", year: "2019", folderId: null, position: 0 },
  { id: 704, section: "academic", name: "博士学位证书", category: "学历学位", remarks: "矿物加工工程", tags: "学位", year: "2024", folderId: null, position: 1 },
  { id: 705, section: "academic", name: "智能选矿过程建模方法", category: "期刊论文", remarks: "《有色金属》2026 年第 3 期", tags: "论文;选矿", year: "2026", folderId: null, position: 2 },
];

const pGeneral = [
  { id: 751, title: "个人简历与业绩材料", files: [] },
  { id: 752, title: "职称评审材料（2026）", files: [] },
];

const pIpRows = [
  { id: 801, data: { name: "一种矿浆浓度在线检测装置", ipType: "实用新型", status: "已授权", applicants: "陈明远", rightHolders: "陈明远", creators: "陈明远", applicationNo: "CN202620234567.8", applicationDate: "2026-03-18", publicationNo: "", publicationDate: "", grantNoticeNo: "", grantNoticeDate: "", publicationInfo: "", grantDate: "2026-08-12", registrationNo: "", firstPublishedDate: "", registrationDate: "", category: "检测装置", remarks: "", tags: "" } },
  { id: 802, data: { name: "个人知识库管理工具 V1.0", ipType: "软件著作权", status: "已登记", applicants: "陈明远", rightHolders: "陈明远", creators: "陈明远", applicationNo: "", applicationDate: "", publicationNo: "", publicationDate: "", grantNoticeNo: "", grantNoticeDate: "", publicationInfo: "", grantDate: "", registrationNo: "2026SR0781234", firstPublishedDate: "2026-05-06", registrationDate: "2026-07-01", category: "软件", remarks: "", tags: "" } },
];

const pProjectFiles = [
  mkFile(601, 9601, 7601, 1, "托举工程任务书.pdf", 1240000, "project"),
  mkFile(601, 9602, 7602, 1, "年度进展报告.docx", 680000, "project"),
  mkFile(602, 9603, 7603, 1, "知识体系框架.xlsx", 320000, "project"),
  mkFile(602, 9604, 7604, 1, "专业术语对照表.docx", 410000, "project"),
];

const pArchiveFiles = [
  mkFile(701, 9701, 7701, 1, "青年科技奖证书.pdf", 520000, "archive"),
  mkFile(702, 9702, 7702, 1, "优秀工程技术人员表彰文件.pdf", 460000, "archive"),
  mkFile(703, 9703, 7703, 1, "硕士学位论文.pdf", 8600000, "archive"),
  mkFile(704, 9704, 7704, 1, "博士学位证书.pdf", 380000, "archive"),
  mkFile(705, 9705, 7705, 1, "期刊论文抽印本.pdf", 1120000, "archive"),
];
pArchiveFiles.forEach((f) => {
  const a = pArchives.find((x) => x.id === f.folderId);
  if (a) {
    f.section = a.section;
    f.ownerId = f.folderId;
  }
});

const pIpFiles = [
  Object.assign(mkFile(801, 9801, 7801, 1, "实用新型专利证书.pdf", 640000, "ip"), { category: "证书" }),
  Object.assign(mkFile(802, 9802, 7802, 1, "软件著作权登记证书.pdf", 520000, "ip"), { category: "登记证书" }),
];

const pTrash = [
  { kind: "v2_archive", id: 706, name: "已作废的旧版简历", section: "academic", parent: null },
  { kind: "project", id: 603, name: "未立项的个人选题", section: "", parent: null },
];

const WORKSPACES = {
  company: {
    projects,
    contracts,
    projectFiles,
    ip: { rows: ipRows, files: ipFiles },
    archive: { archives, general, files: archiveFiles, folders: archiveFolders, orders: {} },
    trash,
  },
  personal: {
    projects: pProjects,
    contracts: [],
    projectFiles: pProjectFiles,
    ip: { rows: pIpRows, files: pIpFiles },
    archive: { archives: pArchives, general: pGeneral, files: pArchiveFiles, folders: [], orders: {} },
    trash: pTrash,
  },
};

/* ---------------- 静态 ---------------- */

function serveBundle(res, rels) {
  try {
    const body = rels.map((r) => `\n/* ---- ${r} ---- */\n` + fs.readFileSync(path.join(ROOT, r), "utf8")).join("\n");
    text(res, body, "text/javascript; charset=utf-8");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("bundle failed: " + e.message);
  }
}

function serveFile(res, rel) {
  fs.readFile(path.join(ROOT, rel), (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found: " + rel);
      return;
    }
    text(res, buf, MIME[path.extname(rel)] || "application/octet-stream");
  });
}

function tinyPdf(name) {
  const text = `BT /F1 18 Tf 60 720 Td (${String(name).replace(/[()\\]/g, "")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (out += String(o).padStart(10, "0") + " 00000 n \n"));
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

/* ---------------- 路由 ---------------- */

/* 预览服务也记一下解锁状态:真实后端的 /api/status 会返回 Vault 是否打开,
   这里若永远返回 false,刷新页面就退回登录页,和线上表现不一致。 */
let previewUnlocked = false;
/* 设置面板里的两个服务端状态:预览环境自己记住,关掉浏览器就复位 */
let previewMcp = false;
let previewCompact = null;

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;

  if (p === "/" || p === "/index.html") return serveFile(res, "index.html");
  if (p === "/style.css") return serveFile(res, "css/app.css");
  if (p === "/app.js") return serveBundle(res, BUNDLE);

  if (p === "/api/status") {
    return json(res, { unlocked: previewUnlocked, suggestion: "D:\\IPSys\\研发管理.db", prototype: true });
  }

  if (p === "/api/open" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let input = {};
      try {
        input = JSON.parse(body || "{}");
      } catch {}
      if (!input.path || !input.password) return json(res, { error: "请填写资料库路径与密码" }, 400);
      previewUnlocked = true;
      json(res, { token: "preview-token", name: path.basename(input.path || "资料库.db") });
    });
    return;
  }

  if (p === "/api/check") {
    const tk = req.headers["x-ipsys-token"];
    if (tk !== "preview-token") return json(res, { error: "登录已失效" }, 401);
    /* 真实后端返回 { result, incomplete };这里给同形状的值,设置面板照常渲染 */
    return json(res, { result: "ok", incomplete: 0 });
  }

  /* ---- 设置面板 · 数据库块 ----
     真实后端由 VaultCompactEndpoints / McpLocal 提供,预览环境给一份同形状的模拟,
     这样设置里的按钮在预览里也能真的点下去,而不是点了没反应。 */
  if (p === "/api/mcp") {
    if (req.method !== "POST") return json(res, { enabled: previewMcp });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let input = {};
      try {
        input = JSON.parse(body || "{}");
      } catch {}
      previewMcp = !!input.enabled;
      json(res, { enabled: previewMcp });
    });
    return;
  }

  if (p === "/api/vault/compact/info") {
    const running = previewCompact && previewCompact.state === "running";
    /* 压缩成功后空闲页归零,否则设置面板读到的还是压缩前的数字 */
    const done = previewCompact && previewCompact.state === "succeeded";
    return json(res, {
      fileBytes: done ? previewCompact.bytesAfter : 13246464,
      reusableBytes: running || done ? 0 : 1638400,
      requiredFreeBytes: 16777216,
      canCompact: !running,
    });
  }

  if (p === "/api/vault/compact" && req.method === "POST") {
    req.resume();
    const id = (previewCompact?.taskId || 0) + 1;
    previewCompact = {
      taskId: id,
      state: "running",
      stage: "正在重整数据库",
      bytesBefore: 13246464,
      bytesAfter: 0,
      error: "",
    };
    /* 模拟一次约 2.6 秒的在线压缩,让进度文案与轮询路径都被真实走到 */
    setTimeout(() => {
      if (!previewCompact || previewCompact.taskId !== id) return;
      previewCompact.state = "succeeded";
      previewCompact.stage = "已完成";
      previewCompact.bytesAfter = 11616256;
    }, 2600);
    return json(res, { taskId: id });
  }

  if (p === "/api/vault/compact/task") {
    if (!previewCompact) return json(res, { error: "没有压缩任务" }, 404);
    return json(res, previewCompact);
  }

  /* 资料库仍是打开状态、浏览器丢了 token 时,真实后端走 /api/resume 换 token。
     预览服务原先没实现,刷新后会卡在「预览环境未实现」。 */
  if (p === "/api/resume" && req.method === "POST") {
    req.resume();
    previewUnlocked = true;
    return json(res, { token: "preview-token", name: "研发管理.db" });
  }

  if (p === "/api/lock" && req.method === "POST") {
    previewUnlocked = false;
    return json(res, { ok: true });
  }

  const ui = p.match(/^\/api\/v2\/ui\/(projects|contracts|project-files|ip|archive)\/(company|personal)$/);
  if (ui) {
    const d = WORKSPACES[ui[2]];
    switch (ui[1]) {
      case "projects": return json(res, d.projects);
      case "contracts": return json(res, d.contracts);
      case "project-files": return json(res, d.projectFiles);
      case "ip": return json(res, d.ip);
      case "archive": return json(res, d.archive);
    }
  }

  if (p.startsWith("/api/trash/")) {
    const ws = p.split("/").pop();
    return json(res, (WORKSPACES[ws] || WORKSPACES.company).trash);
  }

  if (/^\/api\/v2\/folders\//.test(p) && ["POST", "PUT", "DELETE"].includes(req.method)) {
    return json(res, { ok: true, id: Date.now() % 10000, preview: true });
  }
  if (/^\/api\/v2\/files\/.*\/links\//.test(p) && req.method === "DELETE") return json(res, { ok: true });
  if (/\/prepare$/.test(p) && req.method === "POST") {
    req.resume();
    return json(res, { ticket: "preview-ticket", matches: [] });
  }
  if (/\/prepared\/.*\/resolve$/.test(p) && req.method === "POST") {
    req.resume();
    return json(res, { ok: true });
  }

  if (/\/download$/.test(p)) {
    const buf = tinyPdf("Preview");
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": buf.length,
      "Content-Disposition": "inline; filename=preview.pdf",
    });
    return res.end(buf);
  }

  if (p.startsWith("/api/")) return json(res, { error: "预览环境未实现：" + p }, 501);

  serveFile(res, decodeURIComponent(p).replace(/^\//, ""));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`preview → http://127.0.0.1:${PORT}`);
});
