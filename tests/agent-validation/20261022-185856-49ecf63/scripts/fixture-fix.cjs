/* 修正 fixture 中的两个问题（不重建库）：
   1) S10 的 purge 用错了 kind（"file"），正确值是 v2_ip_file / v2_file，且 id 是 linkId；
   2) 顺带回读 compact/info，确认是否真的产生了可回收页。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node fixture-fix.cjs <runid> */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v3a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const TMP = path.resolve(ROOT, "..", "..", "..", "build-retest", "agent-validation-v3");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fxPath = path.join(EVID, "fixture.json");
const fx = JSON.parse(fs.readFileSync(fxPath, "utf8"));
const log = L.makeLog(path.join(EVID, "fixture-fix.log"));

(async () => {
  const c = await L.connect(cred.db, cred.password);
  log.add(`connect via ${c.via}`);

  /* 找到回收站里的 6M 原件，按它自己的 kind/id/section 提交，别再猜 */
  const trash = await L.get("/api/trash/company");
  const arr = Array.isArray(trash.data) ? trash.data : [];
  const target = arr.find((x) => x.name === fx.files.reclaimSrc.name);
  log.add(`trash 命中 ${JSON.stringify(target)}`);
  if (!target) throw new Error("回收站里找不到 " + fx.files.reclaimSrc.name);

  const info0 = await L.get("/api/vault/compact/info");
  log.add(`purge 前 compact/info -> ${JSON.stringify(info0.data)}`);

  const p = await L.post("/api/trash/company/purge-task", {
    items: [{ kind: target.kind, id: target.id, section: target.section || "" }],
  });
  log.add(`purge-task -> ${p.status} ${JSON.stringify(p.data)}`);
  if (!p.ok) throw new Error("purge-task 提交失败 " + p.status + JSON.stringify(p.data));

  let final = null;
  for (let i = 0; i < 40; i++) {
    const t = await L.get(`/api/trash/company/purge-task?taskId=${p.data.taskId}`);
    if (!t.ok) { log.add(`轮询失败 ${t.status}`); break; }
    if (["succeeded", "failed", "canceled"].includes(t.data?.state)) { final = t.data; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  log.add(`purge 终态 -> ${JSON.stringify(final)}`);

  const info1 = await L.get("/api/vault/compact/info");
  log.add(`purge 后 compact/info -> ${JSON.stringify(info1.data)}`);

  fx.purgeTask = { status: p.status, body: p.data, final, infoBefore: info0.data, infoAfter: info1.data };
  fs.writeFileSync(fxPath, JSON.stringify(fx, null, 2), "utf8");
  log.add("fixture.json 已更新");
  log.flush();
})().catch((e) => {
  log.add("FIX FAILED: " + e.stack);
  log.flush();
  process.exit(1);
});
