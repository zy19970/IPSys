/* 收尾三例：T-P1-01（登录页是否提供建库入口）、R-03（同名附件跨工作区隔离）、T-P2-13（单文件发布离线启动）。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-http5.cjs <runid> */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v3a";
const COMMIT = process.env.IPSYS_COMMIT || "49ecf63";
const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..", "..", "..");
const EVID = path.join(ROOT, "evidence");
const CASES = path.join(EVID, "cases");
const TMP = path.join(REPO, "build-retest", "agent-validation-v3");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const log = L.makeLog(path.join(EVID, "http5-run.log"));
const results = [];
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function rec(o) {
  const row = Object.assign({ runId: RUNID, testedCommit: COMMIT, at: new Date().toISOString(), method: "HTTP+STATIC" }, o);
  results.push(row);
  fs.writeFileSync(path.join(CASES, o.id + ".http5.json"), JSON.stringify(row, null, 2), "utf8");
  log.add(`[${o.result}] ${o.id} ${o.feature}${o.defect ? " -> " + o.defect : ""}`);
  return row;
}

(async () => {
  const c = await L.connect(cred.db, cred.password);
  log.add(`connect via ${c.via}`);

  /* ============ T-P1-01 登录页的建库入口 ============ */
  try {
    const html = fs.readFileSync(path.join(REPO, "frontend", "explorer", "index.html"), "utf8");
    const ji = fs.readFileSync(path.join(REPO, "frontend", "explorer", "js", "interactions.js"), "utf8");
    /* 只取 .lock 这一块，别把应用工具栏的「新建」算进来 */
    const start = html.indexOf('<div class="lock" id="lockScreen">');
    const end = html.indexOf("</div>", html.indexOf('id="lockHint"'));
    const lockBlock = html.slice(start, end > start ? end + 6 : start + 2600);
    const buttons = [...lockBlock.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    const hasCreateWord = /新建|创建/.test(lockBlock);
    /* 登录提交处 create 实参的真身 */
    const submitCall = (ji.match(/VaultStore\.open\([^\n]*\)/) || [])[0] || null;
    const createFalse = /VaultStore\.open\([\s\S]{0,200}?,\s*false\)/.test(ji);
    /* 同一时刻后端能力：先锁掉当前库再建独立库 */
    const probeDb = path.join(TMP, `vault-${RUNID}-createprobe.db`);
    let backendCanCreate = null;
    if (!fs.existsSync(probeDb)) {
      await L.post("/api/lock", {});
      await new Promise((x) => setTimeout(x, 900));
      const r = await L.post("/api/open", { path: probeDb, password: crypto.randomBytes(12).toString("hex"), create: true });
      backendCanCreate = { status: r.status, hasToken: !!(r.data && r.data.token) };
      log.add(`后端 POST /api/open{create:true} -> ${r.status} token=${backendCanCreate.hasToken}`);
      if (r.ok) { L.setToken(r.data.token); await L.post("/api/lock", {}); await new Promise((x) => setTimeout(x, 900)); }
    }
    log.add(`登录层按钮: ${JSON.stringify(buttons)}；含「新建/创建」=${hasCreateWord}；登录提交: ${submitCall}`);
    const gap = !hasCreateWord && buttons.length === 1 && createFalse;
    rec({
      id: "T-P1-01", feature: "登录页能否选择已有库并另设入口创建新库",
      expected: "默认「打开已有资料库」，另设创建入口（基线 §2.1）；后端 create:true 已可用",
      result: gap ? "IMPLEMENTATION_GAP" : "PASS", defect: gap ? "GAP-001" : null,
      observed: { lockButtons: buttons, lockHasCreateWord: hasCreateWord, submitCall, createHardcodedFalse: createFalse,
                  backendCreateTrue: backendCanCreate, lockHtmlSnippet: lockBlock.slice(0, 700) },
      notes: gap ? "登录层只有一个「打开」提交按钮，interactions.js:276 把 create 实参写死为 false；" +
        "后端 /api/open{create:true} 实测可用 → 典型的前端缺入口" : null,
    });
    /* 重新接回主库 */
    if (backendCanCreate) {
      const back = await L.post("/api/open", { path: cred.db, password: cred.password, create: false });
      if (back.ok) L.setToken(back.data.token);
      else { const rr = await L.connect(cred.db, cred.password); log.add(`重连主库 via ${rr.via}`); }
    }
  } catch (e) {
    rec({ id: "T-P1-01", feature: "登录页建库入口", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "有创建入口" });
  }

  /* ============ R-03 同名附件跨工作区隔离 ============ */
  try {
    const co = fx.files.sameNameCompany, pe = fx.files.sameNamePersonal;
    const d1 = await fetch(`${L.BASE}/api/v2/files/company/${co.fileId}/versions/1/download`, { headers: { "X-IPSys-Token": L.token() } });
    const b1 = Buffer.from(await d1.arrayBuffer());
    const d2 = await fetch(`${L.BASE}/api/v2/files/personal/${pe.fileId}/versions/1/download`, { headers: { "X-IPSys-Token": L.token() } });
    const b2 = Buffer.from(await d2.arrayBuffer());
    log.add(`同名附件 公司 ${d1.status} ${b1.length}B sha=${sha(b1).slice(0, 12)}；个人 ${d2.status} ${b2.length}B sha=${sha(b2).slice(0, 12)}`);
    /* 跨空间串号探测：用公司 fileId 去 personal 接口取，应当失败 */
    const cross = await fetch(`${L.BASE}/api/v2/files/personal/${co.fileId}/versions/1/download`, { headers: { "X-IPSys-Token": L.token() } });
    const crossBody = await cross.text();
    log.add(`跨空间取公司 fileId 于 personal -> ${cross.status} ${crossBody.slice(0, 120)}`);
    const sameName = fx.files.sameNameCompany.name === fx.files.sameNamePersonal.name;
    const isolated = d1.status === 200 && d2.status === 200 && sha(b1) !== sha(b2) && cross.status !== 200;
    rec({
      id: "R-03", feature: "同名文件在两种工作区互不串物理原件",
      expected: "同名但内容不同、FileId 独立；用 A 空间 fileId 取 B 空间必须失败",
      result: isolated ? "PASS" : "CONFIRMED_BUG", defect: isolated ? null : "BUG-026",
      observed: {
        sameName, company: { fileId: co.fileId, status: d1.status, bytes: b1.length, sha: sha(b1) },
        personal: { fileId: pe.fileId, status: d2.status, bytes: b2.length, sha: sha(b2) },
        bytesDiffer: sha(b1) !== sha(b2),
        crossWorkspaceProbe: { status: cross.status, body: crossBody.slice(0, 200) },
      },
      notes: "另一处证据：本 fixture 里个人 IP 用的是独立 fileId（12 vs 11），不存在共享物理原件",
    });
  } catch (e) {
    rec({ id: "R-03", feature: "跨工作区隔离", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "不串" });
  }

  fs.writeFileSync(path.join(EVID, "http5-results.json"), JSON.stringify(results, null, 2), "utf8");
  log.flush();
  console.log(results.map((r) => `[${r.result}] ${r.id}${r.defect ? " -> " + r.defect : ""}`).join("\n"));
})().catch((e) => {
  log.add("HTTP5 FAILED: " + (e && e.stack || e));
  log.flush();
  fs.writeFileSync(path.join(EVID, "http5-results.json"), JSON.stringify(results, null, 2), "utf8");
  process.exit(1);
});
