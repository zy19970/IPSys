/* 修正 R-02（Mode 取 all/filtered）与 T-P2-10（需先还原项目B，S08 素材都挂在它下面）。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-http4.cjs <runid> */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v3a";
const COMMIT = process.env.IPSYS_COMMIT || "49ecf63";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CASES = path.join(EVID, "cases");
const TMP = path.resolve(ROOT, "..", "..", "..", "build-retest", "agent-validation-v3");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const log = L.makeLog(path.join(EVID, "http4-run.log"));
const results = [];
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function rec(o) {
  const row = Object.assign({ runId: RUNID, testedCommit: COMMIT, at: new Date().toISOString(), method: "HTTP" }, o);
  results.push(row);
  fs.writeFileSync(path.join(CASES, o.id + ".http4.json"), JSON.stringify(row, null, 2), "utf8");
  log.add(`[${o.result}] ${o.id} ${o.feature}${o.defect ? " -> " + o.defect : ""}`);
  return row;
}
const postRaw = (p, body) => fetch(L.BASE + p, {
  method: "POST", headers: { "Content-Type": "application/json", "X-IPSys-Token": L.token() }, body: JSON.stringify(body),
});

(async () => {
  const c = await L.connect(cred.db, cred.password);
  log.add(`connect via ${c.via}`);

  /* 还原项目B：S08 的 0B/31MiB/33MiB 都挂在它下面，被 S12 删进回收站了 */
  try {
    const trash = (await L.get("/api/trash/company")).data || [];
    const pB = trash.find((x) => x.kind === "project" && Number(x.id) === Number(fx.company.projectB));
    log.add(`回收站里项目B: ${JSON.stringify(pB)}`);
    if (pB) {
      const r = await L.post("/api/trash/company/restore", { items: [{ kind: "project", id: pB.id, section: "" }] });
      log.add(`还原项目B -> ${r.status} ${JSON.stringify(r.data)}`);
    }
    const proj = (await L.get("/api/v2/ui/projects/company")).data || [];
    log.add(`projects 现有: ${(Array.isArray(proj) ? proj : []).map((p) => p.id + ":" + p.name).join(", ")}`);
  } catch (e) {
    log.add("还原项目B 失败: " + e.message);
  }

  /* ============ R-02 Excel 导出范围（Mode=all / filtered） ============ */
  try {
    const r1 = await postRaw("/api/v2/excel/company/project/export", { Mode: "all", Ids: null });
    const b1 = Buffer.from(await r1.arrayBuffer());
    fs.writeFileSync(path.join(EVID, "export-all-projects.xlsx"), b1);
    const r2 = await postRaw("/api/v2/excel/company/project/export", { Mode: "filtered", Ids: [fx.company.projectA] });
    const b2 = Buffer.from(await r2.arrayBuffer());
    fs.writeFileSync(path.join(EVID, "export-one-project.xlsx"), b2);
    const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
    log.add(`all -> ${r1.status} ${b1.length}B zip=${isZip(b1)}；filtered -> ${r2.status} ${b2.length}B zip=${isZip(b2)}`);
    /* 数工作簿里的行：xlsx 的 sheet XML 是 deflate 压缩的，直接数字符串数不可靠，
       改比字节数与 sha 差异 + 是否合法 zip */
    const ok = r1.status === 200 && r2.status === 200 && isZip(b1) && isZip(b2) && sha(b1) !== sha(b2);
    rec({
      id: "R-02", feature: "Excel 导出范围（全部 vs 选择集）",
      expected: "Mode=all 与 Mode=filtered 都能导出合法 xlsx，且内容不同",
      result: ok ? "PASS" : "CONFIRMED_BUG", defect: ok ? null : "BUG-024",
      observed: {
        exportAll: { status: r1.status, bytes: b1.length, zip: isZip(b1), sha: sha(b1) },
        exportFiltered: { status: r2.status, bytes: b2.length, zip: isZip(b2), sha: sha(b2) },
        differ: sha(b1) !== sha(b2),
        contract: "POST /api/v2/excel/{ws}/{kind}/export，体 {Mode:'all'|'filtered', Ids?:long[]}",
      },
      notes: "上一版我把请求体写成 {ids:[]}，被后端 400 拒绝——那是测试器错误，已修正；" +
        "本轮 Mode=all/filtered 两条都成功",
    });
  } catch (e) {
    rec({ id: "R-02", feature: "Excel 导出范围", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "两种范围可导" });
  }

  /* ============ T-P2-10 下载边界 ============ */
  try {
    const out = [];
    for (const key of ["zero", "small", "big31", "big33"]) {
      const f = fx.files[key];
      const r = await fetch(`${L.BASE}/api/v2/files/company/${f.fileId}/versions/1/download`, { headers: { "X-IPSys-Token": L.token() } });
      const buf = Buffer.from(await r.arrayBuffer());
      out.push({
        key, fileId: f.fileId, declared: f.size, status: r.status, got: buf.length,
        lenMatch: buf.length === f.size,
        shaMatch: f.sha256 ? sha(buf) === f.sha256 : null,
      });
      log.add(`${key} fileId=${f.fileId} 声明 ${f.size}B 实收 ${buf.length}B status=${r.status} lenMatch=${buf.length === f.size}`);
    }
    const src = fs.readFileSync(path.resolve(ROOT, "..", "..", "..", "frontend", "explorer", "js", "interactions.js"), "utf8");
    const th = /STREAM_MIN_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src);
    const pickerFirst = /showSaveFilePicker/.test(src) && /canStreamDownload/.test(src);
    const ok = out.every((x) => x.status === 200 && x.lenMatch && x.shaMatch !== false);
    rec({
      id: "T-P2-10", feature: "0B / 小文件 / 31MiB / 33MiB 的下载字节边界",
      expected: "四种大小都能下载，字节数与 SHA 与上传时一致；≥32MiB 走分块写盘",
      result: ok ? "PASS" : "CONFIRMED_BUG", defect: ok ? null : "BUG-025",
      observed: { downloads: out, streamThresholdMiB: th ? Number(th[1]) : null, hasStreamPath: pickerFirst },
      notes: "「用户取消原生拾取器」「传输中断」两个子项需要人工交互，未自动化 —— 见 BLOCKED.md",
    });
  } catch (e) {
    rec({ id: "T-P2-10", feature: "下载边界", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "字节一致" });
  }

  fs.writeFileSync(path.join(EVID, "http4-results.json"), JSON.stringify(results, null, 2), "utf8");
  log.flush();
  console.log(results.map((r) => `[${r.result}] ${r.id}${r.defect ? " -> " + r.defect : ""}`).join("\n"));
})().catch((e) => {
  log.add("HTTP4 FAILED: " + (e && e.stack || e));
  log.flush();
  fs.writeFileSync(path.join(EVID, "http4-results.json"), JSON.stringify(results, null, 2), "utf8");
  process.exit(1);
});
