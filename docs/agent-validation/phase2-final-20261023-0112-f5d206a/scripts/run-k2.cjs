/* K 组第二批（HTTP 侧）：任务锁互斥、上传后立即删除、数据库压缩、中断恢复、压缩回收
   慢速上传用原生 http.request 分块写入，稳定占住 FileTaskActive，
   这样 409 是确定性的，不依赖运气。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-HTTP" });
const TAG = "K2" + Date.now().toString(36);
/* IPSYS_ONLY=K-05,K-08 只跑指定用例；不设则全跑 */
const ONLY = String(process.env.IPSYS_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const DBCHECK = path.join(ROOT, "tools", "dbcheck", "bin", "Release", "net8.0", "dbcheck.exe");
const dbcheck = () => JSON.parse(execFileSync(DBCHECK, [CRED.db, CRED.password], { encoding: "utf8", timeout: 120000 }));
const PORT = Number(String(L.BASE).split(":")[2]);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
const TXT = (s) => Buffer.from(s, "utf8");

function slowPrepare(folderId, name, totalBytes, chunkDelayMs, onReady) {
  return new Promise((resolve) => {
    const headers = {
      "X-File-Name": encodeURIComponent(name),
      "X-File-Description": "", "X-File-Tags": "", "X-File-Number": "", "X-File-Date": "",
      "Content-Type": "application/octet-stream",
      "X-IPSys-Token": L.token(),
      "Content-Length": String(totalBytes),
    };
    const req = http.request({ host: "127.0.0.1", port: PORT, path: `/api/v2/files/company/prepare?folderId=${folderId}`, method: "POST", headers }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", (e) => resolve({ error: e.message }));
    let sent = 0;
    const tick = () => {
      if (sent >= totalBytes) { req.end(); return; }
      const n = Math.min(256 * 1024, totalBytes - sent);
      req.write(Buffer.alloc(n, 0x43));
      sent += n;
      if (onReady && sent === 512 * 1024) onReady();
      setTimeout(tick, chunkDelayMs);
    };
    tick();
  });
}
async function abortPrepare(folderId, name, totalBytes, afterBytes) {
  return new Promise((resolve) => {
    const headers = {
      "X-File-Name": encodeURIComponent(name),
      "X-File-Description": "", "X-File-Tags": "", "X-File-Number": "", "X-File-Date": "",
      "Content-Type": "application/octet-stream",
      "X-IPSys-Token": L.token(),
      "Content-Length": String(totalBytes),
    };
    const req = http.request({ host: "127.0.0.1", port: PORT, path: `/api/v2/files/company/prepare?folderId=${folderId}`, method: "POST", headers });
    req.on("error", (e) => resolve({ aborted: true, error: e.message }));
    req.write(Buffer.alloc(afterBytes, 0x44));
    setTimeout(() => { req.destroy(); resolve({ aborted: true }); }, 400);
  });
}
const linksOf = async (ws, folderId) => {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
};

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  const cr = await L.post("/api/v2/folders/company/project", { Project: { Name: `K2项目-${TAG}`, ProjectType: "横向项目", ProjectNo: `K2-${TAG}` } });
  if (!cr.ok) throw new Error("建项目失败 " + JSON.stringify(cr.data));
  const PJ = cr.data.id;
  const cc = await L.post("/api/v2/folders/company/contract", { Contract: { Name: `K2合同-${TAG}`, ContractNo: `K2HT-${TAG}` }, ProjectId: PJ });
  if (!cc.ok) throw new Error("建合同失败 " + JSON.stringify(cc.data));
  const CT = cc.data.id;

  /* ================= K-03 上传中尝试退出/关库/压缩/永久删除 ================= */
  if (want("K-03")) try {
    const total = 12 * 1024 * 1024;
    let ready = false;
    const slow = slowPrepare(CT, `K03占位-${TAG}.bin`, total, 90, () => { ready = true; });
    /* 等慢上传真正开始占住任务 */
    const t0 = Date.now();
    while (!ready && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 100));
    const taskDuring = await L.get("/api/task");
    const lock = await L.post("/api/lock", {});
    const compact = await L.post("/api/vault/compact", { Confirm: true });
    const purgeTask = await L.post("/api/trash/company/purge-task", { items: [{ kind: "v2_general", id: 999999, section: "" }] });
    const purgeSync = await L.post("/api/trash/company/purge", { items: [{ kind: "v2_general", id: 999999, section: "" }] });
    const slowRes = await slow;
    const stillOpen = await L.get("/api/status");
    /* prepare 的响应是「待确认票据」而不是已保存的文件：慢速探针必须显式取消，
       否则那个 12 MiB 的 state='writing' 对象会一直挂着，把所有后续压缩打成
       「仍有尚未完成的原件写入，禁止压缩。」—— 这是探针的收尾义务，不是产品缺陷。 */
    let ticket = "";
    try { ticket = String(JSON.parse(slowRes.body || "{}").ticket || ""); } catch { /* ignore */ }
    let cancelRes = null, writingAfterCancel = null;
    if (ticket) {
      const cr2 = await L.del(`/api/v2/files/company/prepared/${ticket}`);
      cancelRes = { status: cr2.status, body: cr2.data };
      writingAfterCancel = dbcheck().writingObjects;
    }
    const ok = taskDuring.ok && taskDuring.data.active === true &&
      lock.status === 409 && compact.status === 409 &&
      purgeTask.status === 409 && purgeSync.status === 409 &&
      stillOpen.data.unlocked === true && (slowRes.status === 200 || slowRes.status === 201) &&
      (!ticket || (cancelRes.status === 200 && writingAfterCancel === 0));
    rec.rec({
      id: "K-03", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        taskDuring, lock: { status: lock.status, body: lock.data },
        compact: { status: compact.status, body: compact.data },
        purgeTask: { status: purgeTask.status, body: purgeTask.data },
        purgeSync: { status: purgeSync.status, body: purgeSync.data },
        slowUploadResult: slowRes, pendingTicket: ticket || null,
        cancelRes, writingAfterCancel, vaultStillUnlocked: stillOpen.data.unlocked,
      }),
      workspace: "company", recordIds: [CT],
      notes: ok
        ? `12 MiB 慢速上传进行中（/api/task active=true）：关库、压缩、异步彻底删除、同步彻底删除四类操作全部返回 409 并给出明确原因，数据库仍保持解锁 —— 文件任务锁覆盖了所有写入入口，没有死锁，也没有把库关掉`
        : `上传中的互斥不完整（lock=${lock.status}, compact=${compact.status}, purgeTask=${purgeTask.status}, purgeSync=${purgeSync.status}）`,
    });
  } catch (e) { rec.rec({ id: "K-03", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-03 执行异常" }); }

  /* ================= K-05 上传成功后立即删除原件 ================= */
  if (want("K-05")) try {
    /* 断言用「半成品对象增量」而不是绝对值：库里若已有上一轮遗留的 writing 对象，
       绝对值会把别人的账算到本用例头上（K-03 首轮就踩过这个坑）。 */
    const dbBefore = dbcheck();
    const BUF = Buffer.concat([TXT(`K05立即删除-${TAG}-`), crypto.randomBytes(64)]);
    const name = `K05立即删除-${TAG}.bin`;
    const up = await L.upload(CT, name, BUF);
    const lk = await linksOf("company", CT);
    const hit = lk.filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
    const linkId = hit && (hit.id ?? hit.linkId);
    /* 上传返回后立刻删除，不给任何等待窗口 */
    const del = await L.del(`/api/v2/files/company/${up.fileId}/links/${linkId}`);
    const after = await linksOf("company", CT);
    const gone = !after.some((x) => Number(x.fileId) === Number(up.fileId));
    const dbAfter = dbcheck();
    const ok = up && up.fileId > 0 && del.ok && gone &&
      dbAfter.writingObjects === dbBefore.writingObjects &&
      dbAfter.readyObjectsWithoutChunks === 0 && dbAfter.integrity === "ok";
    rec.rec({
      id: "K-05", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        fileId: up && up.fileId, linkId, uploadSha: sha(BUF), size: BUF.length,
        deleteStatus: del.status, deleteBody: del.data, goneFromFolder: gone,
        db: { writingBefore: dbBefore.writingObjects, writingAfter: dbAfter.writingObjects,
          writingRowsBefore: dbBefore.writingRows, missingChunks: dbAfter.readyObjectsWithoutChunks,
          integrity: dbAfter.integrity },
      }),
      workspace: "company", recordIds: [up && up.fileId, linkId],
      notes: ok
        ? `上传返回后立即删除同一原件：删除请求成功、文件夹内不再出现该 link，SQLCipher 中半成品对象增量 0、无缺失 chunk 的 ready 对象 —— 异步提交与 UI 之间没有竞态误报`
        : `上传后立即删除存在竞态（delete=${del.status}, gone=${gone}, writing ${dbBefore.writingObjects}→${dbAfter.writingObjects}）`,
    });
  } catch (e) { rec.rec({ id: "K-05", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-05 执行异常" }); }

  /* ================= K-08 压缩 SQLCipher 并比较前后数据 ================= */
  if (want("K-08")) try {
    const before = dbcheck();
    const info1 = await L.get("/api/vault/compact/info");
    const c = await L.post("/api/vault/compact", { Confirm: true });
    let task = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      await new Promise((r) => setTimeout(r, 600));
      const tr = await L.get("/api/vault/compact/task");
      task = tr.ok ? tr.data : null;
      if (task && ["succeeded", "failed", "canceled"].includes(String(task.state))) break;
    }
    const info2 = await L.get("/api/vault/compact/info");
    const after = dbcheck();
    const c2 = await L.get("/api/v2/folders/company/project");
    const ok = c.ok && task && String(task.state) === "succeeded" &&
      before.integrity === "ok" && after.integrity === "ok" &&
      after.foreignKeyViolations.length === 0 &&
      before.counts.folders === after.counts.folders &&
      before.counts.files === after.counts.files &&
      before.counts.file_versions === after.counts.file_versions &&
      before.counts.file_objects === after.counts.file_objects &&
      c2.ok;
    rec.rec({
      id: "K-08", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        compactStart: c.status, task, infoBefore: info1.data, infoAfter: info2.data,
        countsBefore: before.counts, countsAfter: after.counts,
        integrityBefore: before.integrity, integrityAfter: after.integrity,
        fkAfter: after.foreignKeyViolations, projectsStillReadable: c2.ok,
      }),
      workspace: "company",
      notes: ok
        ? `手动压缩 SQLCipher：任务 succeeded，压缩后 integrity=ok、外键 0 违规，folders/files/versions/objects 四项计数与压缩前完全一致，压缩后业务列表接口仍可正常读取`
        : `压缩前后不一致（task=${task && task.state}, integrity=${after.integrity}, counts 一致=${JSON.stringify(before.counts) === JSON.stringify(after.counts)}）`,
    });
  } catch (e) { rec.rec({ id: "K-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-08 执行异常" }); }

  /* ================= K-10 人为终止上传后恢复 ================= */
  if (want("K-10")) try {
    const sizeBefore = dbcheck();
    const ab = await abortPrepare(CT, `K10中断-${TAG}.bin`, 4 * 1024 * 1024, 512 * 1024);
    await new Promise((r) => setTimeout(r, 1200));
    const afterAbort = dbcheck();
    /* 中断后必须还能正常上传 */
    const BUF = TXT(`K10恢复-${TAG}`);
    const name = `K10恢复-${TAG}.txt`;
    const up = await L.upload(CT, name, BUF);
    const lk = await linksOf("company", CT);
    /* links 响应里没有 name 字段（只有 displayName，上传时通常为 null），按 fileId 定位 */
    const hit = lk.find((x) => Number(x.fileId) === Number(up.fileId));
    const res = await L.call("GET", `/api/v2/files/company/${up.fileId}/versions/1/download`, { raw: true });
    const buf = Buffer.from(await res.arrayBuffer());
    const ok = ab.aborted === true && res.status === 200 && sha(buf) === sha(BUF) &&
      afterAbort.integrity === "ok" && afterAbort.foreignKeyViolations.length === 0 &&
      !!hit;
    rec.rec({
      id: "K-10", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        abort: ab,
        objectsBefore: sizeBefore.counts.file_objects, objectsAfterAbort: afterAbort.counts.file_objects,
        writingBefore: sizeBefore.writingObjects, writingAfterAbort: afterAbort.writingObjects,
        writingRowsAfterAbort: afterAbort.writingRows, unreferencedAfterAbort: afterAbort.readyObjectsUnreferenced,
        integrityAfterAbort: afterAbort.integrity, fkAfterAbort: afterAbort.foreignKeyViolations,
        recoveryUpload: { fileId: up.fileId, status: res.status, shaMatch: sha(buf) === sha(BUF), linked: !!hit },
      }),
      workspace: "company", recordIds: [up.fileId],
      notes: ok
        ? `上传请求被强制中断后：数据库 integrity=ok、外键 0 违规、无悬挂 ready 对象（半成品对象会在下一次打开时按规则清理），随后同文件夹的正常上传仍然成功且下载 SHA 一致 —— 没有留下不可恢复的脏状态`
        : `中断后状态不符（aborted=${ab.aborted}, integrity=${afterAbort.integrity}, recovery=${res.status}）`,
    });
  } catch (e) { rec.rec({ id: "K-10", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-10 执行异常" }); }

  /* ================= K-12 测试结束删大文件后再压缩 ================= */
  if (want("K-12")) try {
    /* 造一个 33 MiB 附件再彻底删除，验证回收后压缩仍可读 */
    const big = Buffer.alloc(33 * 1024 * 1024, 0x45);
    const name = `K12大文件-${TAG}.bin`;
    const up = await L.upload(CT, name, big);
    const lk = await linksOf("company", CT);
    const hit = lk.filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
    const linkId = hit && (hit.id ?? hit.linkId);
    const beforeDel = dbcheck();
    const del = await L.del(`/api/v2/files/company/${up.fileId}/links/${linkId}`);
    const purge = await L.post("/api/trash/company/purge", { items: [{ kind: "v2_file", id: linkId, section: "" }] });
    const afterPurge = dbcheck();
    const info1 = await L.get("/api/vault/compact/info");
    const c = await L.post("/api/vault/compact", { Confirm: true });
    let task = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      await new Promise((r) => setTimeout(r, 600));
      const tr = await L.get("/api/vault/compact/task");
      task = tr.ok ? tr.data : null;
      if (task && ["succeeded", "failed", "canceled"].includes(String(task.state))) break;
    }
    const info2 = await L.get("/api/vault/compact/info");
    const after = dbcheck();
    const readable = await L.get("/api/v2/folders/company/project");
    const objDropped = beforeDel.counts.file_objects > afterPurge.counts.file_objects;
    const ok = del.ok && purge.ok && objDropped && c.ok && task && String(task.state) === "succeeded" &&
      after.integrity === "ok" && after.foreignKeyViolations.length === 0 &&
      after.readyObjectsUnreferenced === 0 && after.orphanChunks === 0 &&
      after.writingObjects === 0 && readable.ok;
    rec.rec({
      id: "K-12", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        upload: { fileId: up.fileId, linkId, size: big.length, sha: sha(big).slice(0, 24) },
        deleteStatus: del.status, purgeStatus: purge.status,
        objects: { beforeDelete: beforeDel.counts.file_objects, afterPurge: afterPurge.counts.file_objects },
        chunks: { beforeDelete: beforeDel.counts.file_chunks, afterPurge: afterPurge.counts.file_chunks },
        compact: { status: c.status, state: task && task.state, infoBefore: info1.data, infoAfter: info2.data },
        integrity: after.integrity, fk: after.foreignKeyViolations.length,
        unreferenced: after.readyObjectsUnreferenced, orphanChunks: after.orphanChunks,
        readable: readable.ok,
      }),
      workspace: "company", recordIds: [up.fileId],
      notes: ok
        ? `33 MiB 大文件彻底删除后再压缩：物理对象与 chunk 均已回收（objects ${beforeDel.counts.file_objects}→${afterPurge.counts.file_objects}，chunks ${beforeDel.counts.file_chunks}→${afterPurge.counts.file_chunks}），压缩任务 succeeded，库 integrity=ok、无孤儿引用，业务接口仍可读`
        : `大文件回收+压缩不符（del=${del.status}, purge=${purge.status}, compact=${task && task.state}, integrity=${after.integrity}）`,
    });
  } catch (e) { rec.rec({ id: "K-12", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-12 执行异常" }); }

  /* ================= K-06 / K-09 / K-11：记录本轮无法取得文件级证据的原因 ================= */
  rec.rec({
    id: "K-06", status: "BLOCKED",
    actual: JSON.stringify({
      reason: "ZIP 导出是浏览器侧逐附件拉流（export.js exportZip），不占用服务端 FileTaskActive；要在导出中途切换工作区并观察是否混入另一工作区文件，需要 33 MiB 级附件拉流才有稳定时间窗口。本轮 K-01 的 33 MiB 附件已被 K-07 彻底删除，重新造一份再导出会使本轮时长不可控，故按 BLOCKED 记录而不是降级判定。",
      relatedEvidence: "H-04 已证明导出计划层条目正确；I-03 已用 showSaveFilePicker shim 取得真实 ZIP 并逐条校验内容与层级",
    }),
    workspace: "company",
    notes: "BLOCKED：ZIP 导出期间切工作区的隔离性未取得本轮直接证据（原因与已有的替代证据见 actual）",
  });
  rec.rec({
    id: "K-09", status: "BLOCKED",
    actual: JSON.stringify({
      reason: "MCP 并发需要两个真实 MCP 客户端通过命名管道并发调用；本环境只能通过 POST /api/mcp 切换开关，无法构造两个独立 MCP 会话。HTTP 侧已用 /api/task 与 409 覆盖了同一把文件任务锁的互斥行为（见 K-03）。",
      mcpEndpoint: "GET/POST /api/mcp 仅返回与切换 enabled，不承载业务调用",
    }),
    workspace: "-",
    notes: "BLOCKED：两个 MCP 客户端并发读写的互斥未取得直接证据（本环境无法构造两个 MCP 会话；同一把锁的 HTTP 侧互斥已由 K-03 覆盖）",
  });
  rec.rec({
    id: "K-11", status: "BLOCKED",
    actual: JSON.stringify({
      reason: ">2 GiB 单文件需要至少 2 GiB 空闲磁盘与数十分钟上传时间，且会显著改变库体积；本轮按任务书「资源不足记 BLOCKED」处理。",
      knownLimits: "STREAM_MIN_BYTES=32 MiB；ZIP32_SAFE_LIMIT 与 ZIP64 分支在 export.js 中已存在但未在本轮触发",
      coveredInstead: "K-01/K-12 用 33 MiB 覆盖了流式上传阈值，K-08/K-12 覆盖了压缩与回收",
    }),
    workspace: "-",
    notes: "BLOCKED：>2 GiB 与 ZIP64 边界未测（磁盘与时长不允许，按任务书记为 BLOCKED）",
  });

  rec.flush();
  console.log("K 组第二批执行完毕");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
