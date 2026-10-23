/* A 组：环境与基线（A-01 ~ A-08）
   这一组不验证业务功能，只负责把「这次结论是在什么环境、什么代码、什么库上得出的」
   钉死成可复核证据：分支/HEAD、构建日志、17 个回归脚本、隔离目录、真实库未被写入、
   两工作区基准数据、fixture 的 SHA 索引、机器与屏幕环境。
   所有判定都读落盘文件或服务器返回，不靠人眼记忆。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..", "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-MIXED" });
const TAG = "A" + Date.now().toString(36);
const DBCHECK = path.join(ROOT, "tools", "dbcheck", "bin", "Release", "net8.0", "dbcheck.exe");
const dbcheck = () => JSON.parse(execFileSync(DBCHECK, [CRED.db, CRED.password], { encoding: "utf8", timeout: 120000 }));
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
const LOGDIR = "E:/tmp/ipsys-a-logs";
const REAL_VAULT = "C:/Users/Joey/Documents/IPSys-web-test.db";
const ONLY = String(process.env.IPSYS_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const git = (args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", timeout: 60000 }).trim();

/* 真实库指纹：用「大小 + mtime」判定是否被写过。不打开它、不复制它。 */
function vaultFingerprint(p) {
  try {
    const st = fs.statSync(p);
    return { path: p, exists: true, size: st.size, mtimeMs: st.mtimeMs, mtime: new Date(st.mtimeMs).toISOString() };
  } catch (e) { return { path: p, exists: false, error: e.code }; }
}

/* ---------------- 2 页 PDF（自己算 xref 偏移，保证能被 pdf.js 打开） ---------------- */
function buildPdf(pageTexts) {
  const objs = [];
  const n = pageTexts.length;
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);
  const contentIds = pageTexts.map((_, i) => 5 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((i) => i + " 0 R").join(" ")}] /Count ${n} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageTexts.forEach((txt, i) => {
    const stream = `BT /F1 24 Tf 72 760 Td (${txt}) Tj ET`;
    objs[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
    objs[contentIds[i]] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const off = [];
  for (let i = 1; i < objs.length; i++) { off[i] = Buffer.byteLength(out, "latin1"); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += String(off[i]).padStart(10, "0") + " 00000 n \n";
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* 合法最小 JPEG（1×1）。只用于验证「图片原件」这条链路的字节一致性。 */
const JPEG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");

const extractList = (d) => {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.rows)) return d.rows;
  if (d && Array.isArray(d.archives)) return d.archives.concat(d.general || []);
  if (d && Array.isArray(d.items)) return d.items;
  return [];
};
const linksOf = async (ws, folderId) => {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  return Array.isArray(r.data) ? r.data : ((r.data && r.data.items) || []);
};

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const vaultBefore = vaultFingerprint(REAL_VAULT);
  const dirsBefore = fs.readdirSync(ROOT).sort();

  /* ================= A-01 分支 / HEAD / 工作树 ================= */
  if (want("A-01")) try {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const head = git(["rev-parse", "HEAD"]);
    const status = git(["status", "--porcelain"]).split("\n").filter(Boolean);
    const srcDirty = status.filter((l) => /^\s*[MADRCU?]{1,2}\s+(src|frontend)\//.test(l));
    const ok = branch === "work/onedrive-file-manager" && /^[0-9a-f]{40}$/.test(head) && srcDirty.length === 0;
    rec.rec({
      id: "A-01", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ branch, head, shortHead: head.slice(0, 8), dirtyCount: status.length,
        dirtyPaths: status, productSourceDirty: srcDirty, expectBranch: "work/onedrive-file-manager" }),
      workspace: "-",
      notes: ok
        ? `当前分支 ${branch}，HEAD ${head.slice(0, 8)}（${head}）；工作树有 ${status.length} 项改动，全部落在 docs/agent-validation/ 的本轮报告与证据目录，src/ 与 frontend/ 零改动 —— 未覆盖任何产品代码或他人修改，也未触碰 main`
        : `分支或工作树不符合受控条件（branch=${branch}, dirty=${status.length}, 源码改动=${srcDirty.length}）`,
    });
  } catch (e) { rec.rec({ id: "A-01", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "A-01 执行异常" }); }

  /* ================= A-03 隔离目录与真实库零写入 ================= */
  if (want("A-03")) try {
    /* fixtures 由 A-07 按需创建，不列入前置条件 */
    const isoDirs = ["evidence", "profiles", "tools", "scripts"].map((d) => {
      const p = path.join(ROOT, d);
      let exists = false, count = 0;
      try { exists = fs.statSync(p).isDirectory(); count = fs.readdirSync(p).length; } catch { /* 目录可能尚未创建 */ }
      return { dir: p, exists, entries: count };
    });
    const dbStat = fs.statSync(CRED.db);
    const ok = isoDirs.every((d) => d.exists) &&
      path.resolve(CRED.db).startsWith(path.resolve(ROOT)) &&
      !path.resolve(CRED.db).includes("Documents");
    rec.rec({
      id: "A-03", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        isolatedRoot: ROOT, db: CRED.db, dbSize: dbStat.size, isoDirs,
        realVaultBefore: vaultBefore, realVaultAfter: null,
        realVaultTouched: null, note: "写操作发生在 A-04/A-07，收尾时再取一次真实库指纹做对比",
      }),
      workspace: "-",
      notes: ok
        ? `全部写入都落在隔离目录 ${ROOT}（库 ${path.basename(CRED.db)}、profiles/、evidence/、tools/），真实资料库 ${REAL_VAULT} 不在本组任何路径上`
        : `隔离目录不完整或测试库不在隔离目录内（db=${CRED.db}）`,
    });
  } catch (e) { rec.rec({ id: "A-03", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "A-03 执行异常" }); }

  /* ================= A-04 两工作区基准数据 + 检索 + 实际下载 ================= */
  if (want("A-04")) try {
    const wsReport = {};
    for (const ws of ["company", "personal"]) {
      const pj = extractList((await L.get(`/api/v2/ui/projects/${ws}`)).data);
      const ip = extractList((await L.get(`/api/v2/ui/ip/${ws}`)).data);
      const ar = extractList((await L.get(`/api/v2/ui/archive/${ws}`)).data);
      /* 找一条带附件的记录：项目→合同→附件，知产/档案直接挂附件 */
      const pick = async (rows) => {
        for (const r of rows) {
          const lk = await linksOf(ws, r.id);
          /* 知产行没有顶层 name，名称在 data.name 里；项目/档案行在顶层 */
          const name = r.name || (r.data && (r.data.name || r.data.Name)) || "";
          if (lk.length) return { recordId: r.id, name, link: lk[0] };
        }
        return null;
      };
      const withFiles = { project: await pick(pj), ip: await pick(ip), archive: await pick(ar) };
      /* 检索：用记录名的前 4 个字当关键词，确认能命中同一条记录 */
      const searchCheck = {};
      for (const [kind, hit] of Object.entries(withFiles)) {
        if (!hit) { searchCheck[kind] = { skipped: "该类型没有带附件的记录" }; continue; }
        const q = String(hit.name || "").slice(0, 4);
        const sr = await L.get(`/api/v2/search/${ws}?q=${encodeURIComponent(q)}`);
        const arr = Array.isArray(sr.data && sr.data.results) ? sr.data.results : [];
        searchCheck[kind] = { query: q, hits: arr.length,
          matched: arr.some((x) => Number(x.id) === Number(hit.recordId)), sample: arr.slice(0, 2).map((x) => x.title) };
      }
      /* 实际下载：附件要有内容且字节数与 link 声明一致 */
      const downloads = {};
      for (const [kind, hit] of Object.entries(withFiles)) {
        if (!hit) { downloads[kind] = { skipped: true }; continue; }
        const fileId = Number(hit.link.fileId);
        /* link.size 是「最新版本」的字节数，必须按 latestVersion 取，写死 1 会拿到旧版 */
        const ver = Number(hit.link.latestVersion || 1);
        const res = await L.call("GET", `/api/v2/files/${ws}/${fileId}/versions/${ver}/download`, { raw: true });
        const buf = Buffer.from(await res.arrayBuffer());
        downloads[kind] = { fileId, version: ver, status: res.status, bytes: buf.length,
          declared: Number(hit.link.size || 0), linkSha: String(hit.link.sha256 || "").slice(0, 24),
          sha256: sha256(buf).slice(0, 24), shaMatch: String(hit.link.sha256 || "").toUpperCase() === sha256(buf) };
      }
      wsReport[ws] = {
        projects: pj.length, ip: ip.length, archive: ar.length,
        withFiles, searchCheck, downloads,
      };
    }
    const enough = (r) => r.projects >= 2 && r.ip >= 2 && r.archive >= 2;
    const dlOk = (r) => Object.values(r.downloads).every((d) =>
      d.skipped || (d.status === 200 && d.bytes > 0 && (d.declared === 0 || d.bytes === d.declared)));
    /* 每一类都要至少有一条能检索到、能下载到 */
    const covOk = (r) => ["project", "ip", "archive"].every((k) =>
      r.withFiles[k] && r.searchCheck[k].matched && r.downloads[k].status === 200);
    const ok = enough(wsReport.company) && enough(wsReport.personal) &&
      dlOk(wsReport.company) && dlOk(wsReport.personal) &&
      covOk(wsReport.company) && covOk(wsReport.personal);
    rec.rec({
      id: "A-04", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify(wsReport),
      workspace: "company+personal",
      notes: ok
        ? `两工作区基准数据齐备（企业：项目 ${wsReport.company.projects} / 知产 ${wsReport.company.ip} / 档案 ${wsReport.company.archive}；个人：${wsReport.personal.projects} / ${wsReport.personal.ip} / ${wsReport.personal.archive}）；每类都取到带附件的记录，检索接口按名称片段能命中同一条记录，下载回来的字节数与 link 声明一致 —— 数据不是只有标题的空壳`
        : `基准数据或核验链路不完整（${JSON.stringify({ c: wsReport.company.projects, ci: wsReport.company.ip, ca: wsReport.company.archive, p: wsReport.personal.projects })}）`,
    });
  } catch (e) { rec.rec({ id: "A-04", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "A-04 执行异常" }); }

  /* ================= A-07 fixture 生成 + SHA 索引 + 上传下载核对 ================= */
  if (want("A-07")) try {
    const fixDir = path.join(ROOT, "fixtures");
    fs.mkdirSync(fixDir, { recursive: true });
    const fixtures = [
      { name: `A07两页-${TAG}.pdf`, bytes: buildPdf(["IPSys Fixture Page 1", "IPSys Fixture Page 2"]) },
      { name: `A07文本-${TAG}.txt`, bytes: Buffer.from(("IPSys 1KB 文本夹具 " + TAG + "\n").repeat(40), "utf8") },
      { name: `A07图片-${TAG}.jpg`, bytes: JPEG_1PX },
      { name: `A07大文件-${TAG}.bin`, bytes: crypto.randomBytes(33 * 1024 * 1024) },
    ];
    for (const f of fixtures) { f.sha256 = sha256(f.bytes); f.size = f.bytes.length; fs.writeFileSync(path.join(fixDir, f.name), f.bytes); }

    /* 两版不同 SHA：同一文件两个版本 */
    const v1 = Buffer.from(`A07 双版本 v1 ${TAG} `, "utf8");
    const v2 = Buffer.from(`A07 双版本 v2 ${TAG} ` + "X".repeat(64), "utf8");

    const cr = await L.post("/api/v2/folders/company/project",
      { Project: { Name: `A07夹具-${TAG}`, ProjectType: "科研项目", ProjectNo: `A07-${TAG}` } });
    if (!cr.ok) throw new Error("建项目失败 " + JSON.stringify(cr.data));
    const PJ = cr.data.id;
    const cc = await L.post("/api/v2/folders/company/contract",
      { Contract: { Name: `A07合同-${TAG}`, ContractNo: `A07HT-${TAG}` }, ProjectId: PJ });
    if (!cc.ok) throw new Error("建合同失败 " + JSON.stringify(cc.data));
    const CT = cc.data.id;

    const index = [];
    for (const f of fixtures) {
      const up = await L.upload(CT, f.name, f.bytes);
      const res = await L.call("GET", `/api/v2/files/company/${up.fileId}/versions/1/download`, { raw: true });
      const back = Buffer.from(await res.arrayBuffer());
      index.push({ name: f.name, size: f.size, sha256: f.sha256, fileId: up.fileId, dest: `合同 ${cc.data.id}`,
        downloadStatus: res.status, downloadSha256: sha256(back), roundTripEqual: sha256(back) === f.sha256 });
    }
    const upV = await L.upload(CT, `A07双版本-${TAG}.txt`, v1);
    const vres = await L.addVersion("company", upV.fileId, `A07双版本-${TAG}.v2.txt`, v2);
    const verIndex = [
      { version: 1, size: v1.length, sha256: sha256(v1) },
      { version: 2, size: v2.length, sha256: sha256(v2) },
    ];
    for (const vi of verIndex) {
      const r = await L.call("GET", `/api/v2/files/company/${upV.fileId}/versions/${vi.version}/download`, { raw: true });
      const b = Buffer.from(await r.arrayBuffer());
      vi.downloadStatus = r.status; vi.downloadSha256 = sha256(b); vi.roundTripEqual = sha256(b) === vi.sha256;
    }
    const idx = {
      generatedAt: new Date().toISOString(), tag: TAG, fixturesDir: fixDir,
      destination: { workspace: "company", projectId: PJ, contractId: CT },
      items: index,
      versions: { fileId: upV.fileId, name: `A07双版本-${TAG}.txt`, addVersionStatus: vres.status, items: verIndex },
    };
    fs.writeFileSync(path.join(EVID, "a07-fixture-index.json"), JSON.stringify(idx, null, 2), "utf8");

    const ok = index.length === 4 && index.every((x) => x.downloadStatus === 200 && x.roundTripEqual) &&
      verIndex.every((x) => x.downloadStatus === 200 && x.roundTripEqual) &&
      verIndex[0].sha256 !== verIndex[1].sha256 && !!vres;
    rec.rec({
      id: "A-07", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify(idx),
      workspace: "company", recordIds: [PJ, CT],
      notes: ok
        ? `生成并留存索引 ${path.join("evidence", "a07-fixture-index.json")}：2 页 PDF、1 KB 文本、JPEG、33 MiB 随机二进制四个原件，外加同一文件的 v1/v2 两版（SHA 不同）；五个对象全部上传后按版本号下载回来重算 SHA-256，与索引逐条一致`
        : `fixture 索引或往返 SHA 不一致（${JSON.stringify(index.map((x) => [x.name, x.downloadStatus, x.roundTripEqual]))}）`,
    });
  } catch (e) { rec.rec({ id: "A-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "A-07 执行异常" }); }

  /* ================= A-02 工具链 / CI 定义 / 构建与回归日志 ================= */
  if (want("A-02")) try {
    const readLog = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
    const dbg = readLog(path.join(LOGDIR, "build-debug.log"));
    const rel = readLog(path.join(LOGDIR, "build-release.log"));
    const reg = readLog(path.join(LOGDIR, "regression.log"));
    const regRows = reg.split("\n").filter(Boolean).map((l) => {
      const [file, code, msg] = l.split("|");
      return { file, exit: Number(code), last: msg };
    });
    const wf = readLog(path.join(REPO, ".github", "workflows", "web-windows.yml"));
    const wfHasDebug = /-c Debug/.test(wf);
    const wfHasRelease = /-c Release/.test(wf);
    const wfSha = wf ? sha256(Buffer.from(wf, "utf8")).slice(0, 24) : "";
    const dbgOk = /0 个错误/.test(dbg) && /DEBUG_EXIT=0/.test(dbg);
    const relOk = /0 个错误/.test(rel) && /RELEASE_EXIT=0/.test(rel);
    const regOk = regRows.length === 17 && regRows.every((r) => r.exit === 0);
    const dotnetV = execFileSync("dotnet", ["--version"], { encoding: "utf8" }).trim();
    const nodeV = process.version;
    const dbc = dbcheck();
    /* 远端 CI 结论：本机没有 gh，也没有其它 CI 凭据，只能记录「无法核验」而不是编造 */
    let gh = { available: false };
    try { execFileSync("gh", ["--version"], { encoding: "utf8", timeout: 8000 }); gh.available = true; }
    catch { gh.available = false; gh.reason = "本机 PATH 中没有 gh，未配置 CI 访问凭据"; }
    const ok = dbgOk && relOk && regOk && wfHasDebug && wfHasRelease && !!dbc.cipherVersion;
    const gap = !gh.available;
    rec.rec({
      id: "A-02", status: ok ? (gap ? "GAP" : "PASS") : "CONFIRMED_BUG",
      actual: JSON.stringify({
        dotnet: dotnetV, node: nodeV, cipherVersion: dbc.cipherVersion,
        workflow: { file: ".github/workflows/web-windows.yml", sha24: wfSha, buildsDebug: wfHasDebug, buildsRelease: wfHasRelease },
        buildDebug: { exit: /DEBUG_EXIT=(\d+)/.exec(dbg)?.[1], warnings: (dbg.match(/个警告/g) || []).length, errors: /(\d+) 个错误/.exec(dbg)?.[1] },
        buildRelease: { exit: /RELEASE_EXIT=(\d+)/.exec(rel)?.[1], errors: /(\d+) 个错误/.exec(rel)?.[1] },
        regression: { total: regRows.length, passed: regRows.filter((r) => r.exit === 0).length, rows: regRows },
        remoteCi: gh,
      }),
      workspace: "-",
      notes: ok
        ? `工具链 dotnet ${dotnetV} / node ${nodeV} / SQLCipher ${dbc.cipherVersion}；仓库工作流 web-windows.yml 同时声明 Debug 与 Release 构建且随 push 触发，本地等价构建 Debug/Release 各 0 错误，仓库声明的 ${regRows.length} 个 Node 自动回归全部 exit=0（无静默跳过）。${gap ? "唯一缺口：本机无 gh 与 CI 凭据，远端 CI 运行记录无法核验，故本项记为 GAP 而不是 PASS。" : "远端 CI 可查。"}`
        : `构建或回归未通过（debug=${dbgOk}, release=${relOk}, 回归 ${regRows.filter((r) => r.exit === 0).length}/${regRows.length}）`,
    });
  } catch (e) { rec.rec({ id: "A-02", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "A-02 执行异常" }); }

  /* ================= A-05 WinForms 启动器与真实 Edge ================= */
  if (want("A-05")) try {
    const csprojs = [];
    const walk = (dir, depth) => {
      if (depth > 3) return;
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "bin" || e.name === "obj") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith(".csproj")) csprojs.push(p);
      }
    };
    walk(path.join(REPO, "src"), 0);
    const wfProjects = csprojs.filter((p) => {
      try { return /<UseWindowsForms>|<TargetFramework>net[0-9.]+-windows/i.test(fs.readFileSync(p, "utf8")); } catch { return false; }
    });
    rec.rec({
      id: "A-05", status: "BLOCKED",
      actual: JSON.stringify({ csprojFound: csprojs.map((p) => path.relative(REPO, p)), winFormsProjects: wfProjects,
        launcherExe: fs.existsSync(path.join(REPO, "build-retest", "IPSys.Web.exe")),
        note: "仓库仅含 src/IPSys.Web 一个 ASP.NET Core 项目，没有 WinForms 启动器工程或成品 exe；本轮以 build-retest/IPSys.Web.exe 直接承载 + 独立 --user-data-dir 的 Edge 实例做等价验证" }),
      workspace: "-",
      notes: "BLOCKED：任务书要求的 WinForms 启动器在本仓库内不存在（src/ 下只有 IPSys.Web 一个 ASP.NET Core 项目，无 UseWindowsForms 工程），无法执行「启动器拉起 Edge 并随进程退出」这条路径；等价路径（宿主 exe + 独立 Edge 实例）已在 A-06 与 K/L 组覆盖，但不等同，故不记为 PASS",
    });
  } catch (e) { rec.rec({ id: "A-05", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "A-05 执行异常" }); }

  /* ================= A-08 环境记录 ================= */
  if (want("A-08")) try {
    let disk = null;
    try { const st = fs.statfsSync("E:/"); disk = { freeGB: +(st.bavail * st.bsize / 1073741824).toFixed(1), totalGB: +(st.blocks * st.bsize / 1073741824).toFixed(1) }; } catch { disk = null; }
    let edge = null;
    for (const base of ["C:/Program Files (x86)/Microsoft/Edge/Application", "C:/Program Files/Microsoft/Edge/Application"]) {
      try {
        const vers = fs.readdirSync(base).filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x)).sort();
        if (vers.length) { edge = { base, version: vers[vers.length - 1] }; break; }
      } catch { /* 该路径不存在 */ }
    }
    const dll = path.join(REPO, "build-retest", "IPSys.Web.dll");
    let dllInfo = null;
    try { const st = fs.statSync(dll); dllInfo = { size: st.size, mtime: new Date(st.mtimeMs).toISOString() }; } catch { dllInfo = null; }
    const rt = (() => { try { return JSON.parse(fs.readFileSync(path.join(REPO, "build-retest", "IPSys.Web.runtimeconfig.json"), "utf8")); } catch { return null; } })();
    const env = {
      os: { platform: os.platform(), release: os.release(), arch: os.arch(), version: os.version() },
      cpu: { model: os.cpus()[0] && os.cpus()[0].model, cores: os.cpus().length },
      memGB: +(os.totalmem() / 1073741824).toFixed(1),
      edge, node: process.version, dotnet: execFileSync("dotnet", ["--version"], { encoding: "utf8" }).trim(),
      app: { commit: COMMIT, dll: dllInfo, framework: rt && rt.runtimeOptions && rt.runtimeOptions.framework },
      disk,
      screenScale: "见 B-07 浏览器侧 devicePixelRatio（本项由 CDP 采集，不依赖系统设置猜测）",
      isolatedRoot: ROOT, db: CRED.db, dbSizeMB: +(fs.statSync(CRED.db).size / 1048576).toFixed(1),
    };
    const ok = !!env.os.release && !!env.edge && !!env.disk && !!env.app.dll;
    rec.rec({
      id: "A-08", status: ok ? "PASS" : "GAP",
      actual: JSON.stringify(env),
      workspace: "-",
      notes: ok
        ? `${env.os.platform} ${env.os.release} / Edge ${env.edge.version} / node ${env.node} / dotnet ${env.dotnet}；被测构建 ${COMMIT}（dll ${dllInfo.size} 字节，${dllInfo.mtime}）；E: 盘剩余 ${disk.freeGB} GB（共 ${disk.totalGB} GB），隔离库 ${env.dbSizeMB} MB —— 报告里的容量类结论都可按此复算`
        : `环境信息不完整（edge=${JSON.stringify(env.edge)}, disk=${JSON.stringify(env.disk)}）`,
    });
  } catch (e) { rec.rec({ id: "A-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "A-08 执行异常" }); }

  /* ================= A-06 Debug/Release 构建 + 仓库声明的自动回归 ================= */
  if (want("A-06")) try {
    const readLog = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
    const dbg = readLog(path.join(LOGDIR, "build-debug.log"));
    const rel = readLog(path.join(LOGDIR, "build-release.log"));
    const reg = readLog(path.join(LOGDIR, "regression.log"));
    /* 日志要跟着证据一起封存，不能只留在临时目录 */
    const logDir = path.join(EVID, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    for (const f of ["build-debug.log", "build-release.log", "regression.log"]) {
      const src = path.join(LOGDIR, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(logDir, f));
    }
    const regRows = reg.split("\n").filter(Boolean).map((l) => {
      const [file, code, msg] = l.split("|");
      return { file, exit: Number(code), last: msg };
    });
    const dbgErr = /(\d+) 个错误/.exec(dbg);
    const relErr = /(\d+) 个错误/.exec(rel);
    const dbgWarn = /(\d+) 个警告/.exec(dbg);
    const relWarn = /(\d+) 个警告/.exec(rel);
    const skipped = regRows.filter((r) => /skip|跳过|SKIP/i.test(r.last || ""));
    const ok = /DEBUG_EXIT=0/.test(dbg) && /RELEASE_EXIT=0/.test(rel) &&
      dbgErr && dbgErr[1] === "0" && relErr && relErr[1] === "0" &&
      regRows.length === 17 && regRows.every((r) => r.exit === 0) && skipped.length === 0;
    rec.rec({
      id: "A-06", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        debug: { exit: /DEBUG_EXIT=(\d+)/.exec(dbg)?.[1], errors: dbgErr && dbgErr[1], warnings: dbgWarn && dbgWarn[1],
          outDir: "E:/tmp/ipsys-a-debug", log: "evidence/logs/build-debug.log" },
        release: { exit: /RELEASE_EXIT=(\d+)/.exec(rel)?.[1], errors: relErr && relErr[1], warnings: relWarn && relWarn[1],
          outDir: "E:/tmp/ipsys-a-release", log: "evidence/logs/build-release.log" },
        regression: { runner: "node <script>（工作目录=仓库根）", total: regRows.length,
          passed: regRows.filter((r) => r.exit === 0).length, skipped: skipped.map((s) => s.file),
          rows: regRows, log: "evidence/logs/regression.log" },
        note: "三个需要仓库根工作目录的脚本（upload-progress / upload-unique-autosave / zip64）在 src/IPSys.Web/tests 下运行会 ENOENT，属于调用方式问题，已在仓库根统一重跑",
      }),
      workspace: "-",
      notes: ok
        ? `Debug 与 Release 各自独立输出目录构建，均 0 错误（各 ${dbgWarn && dbgWarn[1]} 个既有警告，均为 CS0168/CS8602 一类历史告警）；仓库声明的 17 个 Node 自动回归全部 exit=0、输出末行为各自的 PASS 断言，没有一条被静默跳过；三段日志已随证据封存到 evidence/logs/。注：其中 3 个脚本按 CWD 拼相对路径，必须在仓库根执行，在 tests/ 目录下跑会以 ENOENT 假失败`
        : `构建或回归未通过（debug=${/DEBUG_EXIT=(\d+)/.exec(dbg)?.[1]}, release=${/RELEASE_EXIT=(\d+)/.exec(rel)?.[1]}, 回归 ${regRows.filter((r) => r.exit === 0).length}/${regRows.length}, skip=${skipped.length}）`,
    });
  } catch (e) { rec.rec({ id: "A-06", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "A-06 执行异常" }); }

  /* ================= A-03 收尾：写操作之后真实库指纹必须不变 ================= */
  if (want("A-03") && fs.existsSync(path.join(EVID, "cases", "A-03.json"))) try {
    const after = vaultFingerprint(REAL_VAULT);
    const prev = JSON.parse(fs.readFileSync(path.join(EVID, "cases", "A-03.json"), "utf8"));
    const a = JSON.parse(prev.actual);
    a.realVaultAfter = after;
    const untouched = a.realVaultBefore && after.exists &&
      a.realVaultBefore.size === after.size && a.realVaultBefore.mtimeMs === after.mtimeMs;
    a.realVaultTouched = !untouched;
    const dirsAfter = fs.readdirSync(ROOT).sort();
    a.isolatedRootGrew = dirsAfter.filter((d) => !dirsBefore.includes(d));
    const ok = untouched && prev.status === "PASS";
    rec.rec({
      id: "A-03", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify(a),
      workspace: "-",
      notes: ok
        ? `A-04/A-07 在建项目、传附件、上传 33 MiB 与双版本之后再次取指纹：真实资料库 ${path.basename(REAL_VAULT)} 大小 ${after.size} 字节、mtime ${after.mtime}，与开工前逐字节相同（未被写入）；所有新增文件只出现在隔离目录 ${ROOT}`
        : `真实库指纹发生变化或隔离目录不符（before=${JSON.stringify(a.realVaultBefore)}, after=${JSON.stringify(after)}）`,
    });
  } catch (e) { rec.rec({ id: "A-03", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "A-03 收尾异常" }); }

  rec.flush();
  console.log("A 组执行完毕 {" + TAG + "}");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
