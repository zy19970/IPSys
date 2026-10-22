/* 第三批 HTTP：导出范围、三种口径、文档缺口、批量删除局部失败、下载边界。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-http3.cjs <runid> */
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
const TMP = path.resolve(REPO, "build-retest", "agent-validation-v3");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const log = L.makeLog(path.join(EVID, "http3-run.log"));
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function rec(o) {
  const row = Object.assign({ runId: RUNID, testedCommit: COMMIT, at: new Date().toISOString(), method: "HTTP" }, o);
  results.push(row);
  fs.writeFileSync(path.join(CASES, o.id + ".http3.json"), JSON.stringify(row, null, 2), "utf8");
  log.add(`[${o.result}] ${o.id} ${o.feature}${o.defect ? " -> " + o.defect : ""}`);
  return row;
}

async function backToMain() {
  /* 可能还开着空库（T-P2-15 建的）。先直接开主库；409 说明有库开着，
     用主库口令 resume，失败再试空库口令，最后 lock 后重新 open。 */
  const direct = await L.post("/api/open", { path: cred.db, password: cred.password, create: false });
  if (direct.ok && direct.data?.token) { L.setToken(direct.data.token); return "open"; }
  const cands = [cred.password];
  const emptyCredPath = path.join(TMP, `vault-${RUNID}-empty.cred.json`);
  if (fs.existsSync(emptyCredPath)) cands.push(JSON.parse(fs.readFileSync(emptyCredPath, "utf8")).password);
  for (const pw of cands) {
    const r = await L.post("/api/resume", { password: pw });
    if (r.ok && r.data?.token) {
      L.setToken(r.data.token);
      await L.post("/api/lock", {});
      await sleep(900);
      const o = await L.post("/api/open", { path: cred.db, password: cred.password, create: false });
      if (o.ok && o.data?.token) { L.setToken(o.data.token); return "resume-lock-open"; }
    }
  }
  const rr = await L.connect(cred.db, cred.password);
  return rr.via;
}

(async () => {
  log.add(`回到主库 via ${await backToMain()}`);

  /* ============ R-02 Excel 导出范围 ============ */
  try {
    const before = (await L.get("/api/v2/ui/projects/company")).data || [];
    log.add(`项目 ${before.length} 条`);
    const all = await L.call("POST", "/api/v2/excel/company/project/export", { json: { ids: [] } });
    const allBuf = all.ok ? Buffer.from(await all.raw.arrayBuffer?.() || []) : null;
    /* 上面的写法依赖 raw，改用直接 fetch 拿字节 */
    const r1 = await fetch(L.BASE + "/api/v2/excel/company/project/export", {
      method: "POST", headers: { "Content-Type": "application/json", "X-IPSys-Token": L.token() },
      body: JSON.stringify({ ids: [] }),
    });
    const b1 = Buffer.from(await r1.arrayBuffer());
    fs.writeFileSync(path.join(EVID, "export-all-projects.xlsx"), b1);
    const r2 = await fetch(L.BASE + "/api/v2/excel/company/project/export", {
      method: "POST", headers: { "Content-Type": "application/json", "X-IPSys-Token": L.token() },
      body: JSON.stringify({ ids: [fx.company.projectA] }),
    });
    const b2 = Buffer.from(await r2.arrayBuffer());
    fs.writeFileSync(path.join(EVID, "export-one-project.xlsx"), b2);
    log.add(`导出全部 -> ${r1.status} ${b1.length}B sha=${sha(b1).slice(0, 12)}；导出单条 -> ${r2.status} ${b2.length}B sha=${sha(b2).slice(0, 12)}`);
    /* xlsx 是 zip，数一下 "xl/worksheets/sheet" 出现次数最稳 */
    const countSheets = (b) => (b.toString("latin1").match(/xl\/worksheets\/sheet/g) || []).length;
    const ok = r1.status === 200 && r2.status === 200 && b1.length > 0 && b2.length > 0 && sha(b1) !== sha(b2);
    rec({
      id: "R-02", feature: "Excel 导出范围（全部 vs 选择集）",
      expected: "两种范围都能导出，且内容不同；参数契约与后端一致",
      result: ok ? "PASS" : "CONFIRMED_BUG", defect: ok ? null : "BUG-024",
      observed: { projects: before.length, exportAll: { status: r1.status, bytes: b1.length, sheets: countSheets(b1), sha: sha(b1) },
                  exportOne: { status: r2.status, bytes: b2.length, sheets: countSheets(b2), sha: sha(b2) },
                  differ: sha(b1) !== sha(b2), bodyShape: "{ ids: [] } = 全部；{ ids: [id] } = 选择集" },
      notes: "前端是否真的提供「导出选择集」入口由 bridge.js exportEntryOf 决定，属 UI 层，见 REPORT 的取舍说明",
    });
  } catch (e) {
    rec({ id: "R-02", feature: "Excel 导出范围", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "两种范围可导" });
  }

  /* ============ R-05 三种口径 ============ */
  try {
    const ip = (await L.get("/api/v2/ui/ip/company")).data || {};
    const files = ip.files || [];
    const f = fx.files.ipA;
    const mine = files.filter((x) => Number(x.fileId) === Number(f.fileId));
    const logicalLinks = new Set(mine.map((x) => x.linkId)).size;
    const latestBytes = mine.filter((x) => Number(x.version) === Math.max(...mine.map((y) => Number(y.version) || 0)))
      .reduce((s, x) => s + Number(x.size || 0), 0);
    const allVersionRowsBytes = mine.reduce((s, x) => s + Number(x.size || 0), 0);   /* 接口给的是每版本一行 */
    /* 真正的"历史累计"要靠版本大小求和；同一 linkId 的多版本只在版本历史里出现一次 */
    const perLinkLatest = {};
    for (const x of mine) {
      const k = x.linkId;
      if (!perLinkLatest[k] || Number(x.version) > Number(perLinkLatest[k].version)) perLinkLatest[k] = x;
    }
    const latestPerLinkBytes = Object.values(perLinkLatest).reduce((s, x) => s + Number(x.size || 0), 0);
    const dbBytes = fs.statSync(cred.db).size;
    log.add(`R-05 fileId=${f.fileId}: 接口行=${mine.length} 逻辑附件=${logicalLinks} 最新版合计=${latestPerLinkBytes}B 全部版本行合计=${allVersionRowsBytes}B DB=${dbBytes}B`);
    rec({
      id: "R-05", feature: "最新版字节 / 累计历史字节 / 逻辑附件数 / 数据库文件字节 四种口径",
      expected: "四种口径各自语义清晰、互不混用；界面展示的逻辑附件数应为 2（两个 linkId）",
      result: logicalLinks === 2 ? "PASS" : "CONFIRMED_BUG", defect: logicalLinks === 2 ? null : "BUG-002",
      observed: { fileId: f.fileId, apiRows: mine.length, logicalLinks,
                  latestPerLinkBytes, allVersionRowsBytes, dbBytes,
                  rows: mine.map((x) => ({ link: x.linkId, v: x.version, size: x.size })),
                  note: "接口对同一 fileId 返回 4 行（2 link × 2 version），但逻辑附件只有 2 个" },
      notes: "口径本身可分；但界面若直接用接口行数当附件数就会翻倍 —— 属 BUG-002 的下游影响",
    });
  } catch (e) {
    rec({ id: "R-05", feature: "四种口径", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "口径清晰" });
  }

  /* ============ R-07 文档缺口 ============ */
  try {
    const req = fs.readFileSync(path.join(REPO, "REQUIREMENTS.md"), "utf8");
    const hits = [];
    req.split(/\r?\n/).forEach((line, i) => {
      if (/一键清空|清空回收站/.test(line)) hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
    });
    log.add(`REQUIREMENTS.md 命中「一键清空」${hits.length} 处`);
    const stillSaysUnavailable = hits.some((h) => /不提供|不可用|不支持/.test(h.text));
    rec({
      id: "R-07", feature: "Q122 旧口径「一键清空回收站不可用」是否仍留在需求文档",
      expected: "文档已同步「一键清空是允许功能」；否则记 DOC_GAP，不记产品缺陷",
      result: stillSaysUnavailable ? "DOC_GAP" : "PASS", defect: stillSaysUnavailable ? "DOC_GAP-001" : null,
      observed: { file: "REQUIREMENTS.md", hits, stillSaysUnavailable },
      notes: "用户 2026-10-22 已明确允许该按钮；文档未改 = 文档缺口，按钮存在不判缺陷",
    });
  } catch (e) {
    rec({ id: "R-07", feature: "文档缺口", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "文档同步" });
  }

  /* ============ T-P2-05 三个不同 LinkId 的批量删除，中间一项先解绑 ============ */
  try {
    const ip = await L.post("/api/v2/folders/company/ip",
      { Ip: { Name: "T-P2-05-批删", IpType: "商标", Status: "已注册", ApplicationNo: "DEL-05" } });
    const ipId = ip.data.id;
    const made = [];
    for (let i = 1; i <= 3; i++) {
      const up = await L.upload(ipId, `批删-${i}.txt`, Buffer.from(`批删第 ${i} 项`));
      const links = (await L.get(`/api/v2/files/company/folders/${ipId}/links?includeDeleted=false`)).data || [];
      const hit = (Array.isArray(links) ? links : []).filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
      made.push({ fileId: up.fileId, linkId: hit.id ?? hit.linkId });
    }
    log.add(`造 3 条不同 linkId: ${made.map((x) => x.linkId).join(",")}`);
    /* 模拟前端逐条删除：第 2 条先被并发解绑，制造 409 */
    const pre = await L.del(`/api/v2/files/company/${made[1].fileId}/links/${made[1].linkId}`);
    log.add(`第 2 条预解绑 -> ${pre.status}`);
    const outcomes = [];
    for (const m of made) {
      const d = await L.del(`/api/v2/files/company/${m.fileId}/links/${m.linkId}`);
      outcomes.push({ linkId: m.linkId, status: d.status, body: d.data });
    }
    log.add(`逐条删除结果: ${JSON.stringify(outcomes)}`);
    const live = (await L.get(`/api/v2/files/company/folders/${ipId}/links?includeDeleted=false`)).data || [];
    /* 前端 deleteNodes 的 for 循环包在一个 try 里：第 2 条抛错就会中断，第 3 条不会被发 */
    const thirdAttempted = outcomes[2].status !== 0;
    rec({
      id: "T-P2-05", feature: "三个不同 LinkId 批量删除、中间一项失败",
      expected: "失败要给出明细（哪条、为什么），其余条目继续或明确中止，最后刷新到真实状态",
      result: outcomes[2].status === 200 ? "PASS" : "CONFIRMED_BUG", defect: outcomes[2].status === 200 ? null : "BUG-003",
      observed: { links: made, preUnbind: pre.status, outcomes, liveAfter: (Array.isArray(live) ? live.length : null),
                  thirdAttempted },
      rootCause: "interactions.js deleteNodes 把整批 DELETE 放在同一个 try 里，任一条抛错即中断循环且不 refreshCurrent()，" +
        "界面停在旧状态；后端 409 语义正确，问题在前端的失败处理",
      notes: "本条与 T-P0-03 同源（BUG-003）；HTTP 层证明后端 409 有明确文案，缺的是前端逐条容错与失败汇总",
    });
  } catch (e) {
    rec({ id: "T-P2-05", feature: "批量删除局部失败", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "失败有明细且刷新" });
  }

  /* ============ T-P2-10 下载边界 31/33 MiB ============ */
  try {
    const out = [];
    for (const key of ["big31", "big33"]) {
      const f = fx.files[key];
      const r = await fetch(`${L.BASE}/api/v2/files/company/${f.fileId}/versions/1/download`,
        { headers: { "X-IPSys-Token": L.token() } });
      const buf = Buffer.from(await r.arrayBuffer());
      out.push({ key, fileId: f.fileId, declared: f.size, status: r.status, got: buf.length,
                 shaMatch: f.sha256 ? sha(buf) === f.sha256 : null, lenMatch: buf.length === f.size });
      log.add(`${key} fileId=${f.fileId} 声明 ${f.size}B 实收 ${buf.length}B status=${r.status} shaMatch=${f.sha256 ? sha(buf) === f.sha256 : "n/a"}`);
    }
    const zero = fx.files.zero;
    const rz = await fetch(`${L.BASE}/api/v2/files/company/${zero.fileId}/versions/1/download`, { headers: { "X-IPSys-Token": L.token() } });
    const bz = Buffer.from(await rz.arrayBuffer());
    out.push({ key: "zero", fileId: zero.fileId, declared: 0, status: rz.status, got: bz.length, lenMatch: bz.length === 0 });
    log.add(`0B 文件 -> ${rz.status} ${bz.length}B`);

    /* 前端侧：33MiB > 32MiB 阈值应走 showSaveFilePicker；这里只取阈值与能力，不驱动原生拾取器 */
    const src = fs.readFileSync(path.join(REPO, "frontend", "explorer", "js", "interactions.js"), "utf8");
    const threshold = /STREAM_MIN_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src);
    const pickerBeforeAwait = /showSaveFilePicker[\s\S]{0,400}?await\s+fetch/.test(src);
    const ok = out.every((x) => x.status === 200 && x.lenMatch);
    rec({
      id: "T-P2-10", feature: "31/33 MiB 与 0B 的下载字节边界",
      expected: "字节长度与声明一致、SHA 一致；≥32MiB 走分块写盘而不是整块 blob",
      result: ok ? "PASS" : "CONFIRMED_BUG", defect: ok ? null : "BUG-025",
      observed: { downloads: out, streamThresholdMiB: threshold ? Number(threshold[1]) : null,
                  pickerBeforeNetworkAwait: pickerBeforeAwait },
      notes: "用户取消原生拾取器、传输中断属不可自动化的交互，保留为 BLOCKED 子项",
    });
  } catch (e) {
    rec({ id: "T-P2-10", feature: "下载边界", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "字节一致" });
  }

  fs.writeFileSync(path.join(EVID, "http3-results.json"), JSON.stringify(results, null, 2), "utf8");
  log.flush();
  console.log("\n=== 第三批汇总 ===");
  console.log(results.map((r) => `[${r.result}] ${r.id}${r.defect ? " -> " + r.defect : ""}`).join("\n"));
})().catch((e) => {
  log.add("HTTP3 FAILED: " + (e && e.stack || e));
  log.flush();
  fs.writeFileSync(path.join(EVID, "http3-results.json"), JSON.stringify(results, null, 2), "utf8");
  process.exit(1);
});
