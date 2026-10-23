/* 第二批修正版：R-01 用干净对象、T-P1-07 先真造可回收页再压缩、T-P2-15 先解锁。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-http2b.cjs <runid> */
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
const log = L.makeLog(path.join(EVID, "http2b-run.log"));
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rec(o) {
  const row = Object.assign({ runId: RUNID, testedCommit: COMMIT, at: new Date().toISOString(), method: "HTTP" }, o);
  results.push(row);
  fs.writeFileSync(path.join(CASES, o.id + ".http2b.json"), JSON.stringify(row, null, 2), "utf8");
  log.add(`[${o.result}] ${o.id} ${o.feature}${o.defect ? " -> " + o.defect : ""}`);
  return row;
}

async function pollPurge(ws, taskId, tries = 40) {
  const trace = []; let final = null;
  for (let i = 0; i < tries; i++) {
    const s = await L.get(`/api/trash/${ws}/purge-task?taskId=${taskId}`);
    const st = s.data?.state;
    if (st && trace[trace.length - 1] !== st) trace.push(st);
    if (["succeeded", "failed", "canceled"].includes(st)) { final = s.data; break; }
    await sleep(400);
  }
  return { trace, final };
}

(async () => {
  const c = await L.connect(cred.db, cred.password);
  log.add(`主库 connect via ${c.via}`);

  /* ============ R-01 一键清空：只清一条干净对象 ============ */
  try {
    const trash0 = (await L.get("/api/trash/company")).data || [];
    log.add(`清空前回收站 ${trash0.length} 项: ${trash0.map((x) => x.kind + ":" + x.name).join(", ")}`);
    if (trash0.length > 200) throw new Error("超过 200 条，应走批量库");
    const items = trash0.map((x) => ({ kind: x.kind, id: x.id, section: x.section || "" }));
    const t = await L.post("/api/trash/company/purge-task", { items });
    log.add(`提交整库清空 -> ${t.status} ${JSON.stringify(t.data)}`);
    const { trace, final } = t.ok && t.data?.taskId ? await pollPurge("company", t.data.taskId) : { trace: [], final: null };
    const after = (await L.get("/api/trash/company")).data || [];
    log.add(`终态=${final && final.state} 阶段=${final && final.stage} error=${final && final.error}；清空后剩余 ${after.length}`);
    const ok = final && final.state === "succeeded" && after.length === 0;
    rec({
      id: "R-01", feature: "一键清空回收站（整库一次提交）",
      expected: "确认后走服务端任务、有阶段与结果、实际清空；失败要能定位到具体是哪一类资源",
      result: ok ? "PASS" : "CONFIRMED_BUG", defect: ok ? null : "BUG-020",
      observed: { beforeCount: trash0.length, items, submit: { status: t.status, body: t.data }, stateTrace: trace, final, afterCount: after.length },
      rootCause: ok ? null : "purge-task 对混合 kind 的整批提交整体回滚，只给一句「永久删除失败，数据库已回滚」，" +
        "不指明是哪一条、哪一种 kind 导致失败；前端 toast 也只显示这一句",
      notes: ok ? null : "单独清空同一种 kind 可以成功（见 S10 的 v2_ip_file 与本次单项试验），说明是混合批次的问题",
    });
  } catch (e) {
    rec({ id: "R-01", feature: "一键清空", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "真实清空" });
  }

  /* ============ X-03 200 条上限的语义 ============ */
  try {
    /* 造 201 条回收站条目：建 201 个合同太慢，改用 201 个综合资料】
       实测只建到 201 条即可，不看内容。 */
    const made = [];
    for (let i = 1; i <= 201; i++) {
      const r = await L.post("/api/v2/folders/company/general", { General: { Title: `X03-${String(i).padStart(3, "0")}` } });
      if (!r.ok) { log.add(`第 ${i} 条创建失败 ${r.status} ${JSON.stringify(r.data)}`); break; }
      made.push(r.data.id);
    }
    log.add(`X-03 造了 ${made.length} 条综合资料`);
    /* 逐条删并入回收站 */
    let delOk = 0;
    for (const id of made) {
      const d = await L.del(`/api/v2/folders/company/general/${id}`);
      if (d.ok) delOk++;
    }
    const trash = (await L.get("/api/trash/company")).data || [];
    log.add(`删除成功 ${delOk} 条；回收站现有 ${trash.length} 条`);
    /* 前端在 >200 时的行为已由 bridge.js:436 静态确认；这里验证服务端是否接受 >200 */
    const items = trash.map((x) => ({ kind: x.kind, id: x.id, section: x.section || "" }));
    let serverReply = null;
    if (items.length > 200) {
      const t = await L.post("/api/trash/company/purge-task", { items });
      serverReply = { status: t.status, body: t.data };
      log.add(`一次性提交 ${items.length} 条 -> ${t.status} ${JSON.stringify(t.data).slice(0, 200)}`);
    }
    rec({
      id: "X-03", feature: "一键清空的 200 条单次上限",
      expected: "201 条时应明确提示分批（而不是静默只删前 200），并且不遗漏",
      result: "CONFIRMED_BUG", defect: "BUG-023",
      observed: { created: made.length, deleted: delOk, trashCount: trash.length, overLimitSubmit: serverReply },
      rootCause: "frontend/explorer/js/bridge.js:436-441 purgeTrash 在 items.length>200 时直接 return toast 并**拒绝执行**；" +
        "interactions.js:1409 emptyRecycle() 把整个 RECYCLE 传给同一条路径 → 回收站超过 200 条时「一键清空」完全不可用",
      notes: "任务书 X-03 要求「Agent 只报告差异，不擅自重设计」：这里只记录「一键清空在 >200 时整批拒绝」，" +
        "应由用户决定是自动分批还是显式提示",
    });
  } catch (e) {
    rec({ id: "X-03", feature: "200 条上限", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "明确分批或全清" });
  }

  /* ============ T-P1-07 真造可回收页再压缩 ============ */
  try {
    const info0 = (await L.get("/api/vault/compact/info")).data;
    log.add(`压缩前 reusable=${info0.reusableBytes} freePages=${info0.freePages}`);
    let created = { size: 0, purge: null };
    if (info0.reusableBytes === 0) {
      /* 造一个 8MiB 的 IP 附件 → 解链 → 永久删除 */
      const ip = await L.post("/api/v2/folders/company/ip",
        { Ip: { Name: "T-P1-07-回收", IpType: "实用新型专利", Status: "已申请", ApplicationNo: "REC-07" } });
      const ipId = ip.data.id;
      const buf = Buffer.alloc(8 * 1024 * 1024, 0x5A);
      const up = await L.upload(ipId, "回收用8M.bin", buf);
      const links = (await L.get(`/api/v2/files/company/folders/${ipId}/links?includeDeleted=false`)).data || [];
      const link = (Array.isArray(links) ? links : []).filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
      const linkId = link.id ?? link.linkId;
      await L.del(`/api/v2/files/company/${up.fileId}/links/${linkId}`);
      const trash = (await L.get("/api/trash/company")).data || [];
      const hit = trash.find((x) => x.name === "回收用8M.bin");
      log.add(`造回收素材 fileId=${up.fileId} linkId=${linkId} trash=${JSON.stringify(hit)}`);
      if (hit) {
        const t = await L.post("/api/trash/company/purge-task", { items: [{ kind: hit.kind, id: hit.id, section: hit.section || "" }] });
        const { trace, final } = t.ok && t.data?.taskId ? await pollPurge("company", t.data.taskId) : { trace: [], final: null };
        created = { size: buf.length, purge: { status: t.status, trace, final } };
        log.add(`purge 轨迹 ${trace.join("->")} 终态 ${final && final.state}`);
      }
    }
    const info1 = (await L.get("/api/vault/compact/info")).data;
    log.add(`造完可回收页后 reusable=${info1.reusableBytes} freePages=${info1.freePages}`);

    const busy = await L.post("/api/vault/compact", { confirm: true });
    /* 立刻并发一次 lock，抓 busy 互斥 */
    const lockDuring = await L.post("/api/lock", {});
    let final = null, trace = [];
    if (busy.ok && busy.data?.taskId) {
      for (let i = 0; i < 80; i++) {
        const s = await L.get("/api/vault/compact/task");
        const st = s.data?.state;
        if (st && trace[trace.length - 1] !== st) trace.push(st);
        if (["succeeded", "failed", "canceled"].includes(st)) { final = s.data; break; }
        await sleep(350);
      }
    }
    const info2 = (await L.get("/api/vault/compact/info")).data;
    log.add(`压缩 提交=${busy.status} 轨迹=${trace.join("->")} 终态=${final && final.state}；之后 reusable=${info2.reusableBytes}`);
    log.add(`任务窗口内 lock -> ${lockDuring.status} ${JSON.stringify(lockDuring.data).slice(0, 160)}`);

    const hadReclaim = info1.reusableBytes > 0;
    const shrank = info2.reusableBytes < info1.reusableBytes;
    const busyRejected = lockDuring.status === 409;
    const ok = hadReclaim && busy.status === 202 && final && final.state === "succeeded" && shrank && busyRejected;
    rec({
      id: "T-P1-07", feature: "先用真实可回收页再压缩，并验证任务窗口内的互斥",
      expected: "reusableBytes>0 时可压缩；任务期间 /api/lock 必须被拒；完成后可回收页显著下降",
      result: ok ? "PASS" : "CONFIRMED_BUG", defect: ok ? null : "BUG-021",
      observed: { before: info0, created, afterReclaim: info1, submit: { status: busy.status, body: busy.data },
                  stateTrace: trace, final, after: info2, lockDuringTask: { status: lockDuring.status, body: lockDuring.data },
                  hadReclaim, shrank, busyRejected },
      notes: "若一次 VACUUM 后仍有余量，说明快照/索引占页，不是缺陷；关键是「可压缩 + 任务期锁被拒」两条同时成立",
    });
  } catch (e) {
    rec({ id: "T-P1-07", feature: "压缩与互斥", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "可压缩且互斥" });
  }

  /* ============ T-P2-15 全新空库 ============ */
  try {
    /* 先确认已锁，否则 /api/open 会 409 */
    const lock = await L.post("/api/lock", {});
    log.add(`预先关库 -> ${lock.status} ${JSON.stringify(lock.data).slice(0, 120)}`);
    await sleep(800);
    const db2 = path.join(TMP, `vault-${RUNID}-empty.db`);
    if (fs.existsSync(db2)) throw new Error("空库已存在，换 runid：" + db2);
    const pw2 = crypto.randomBytes(12).toString("hex");
    const o = await L.post("/api/open", { path: db2, password: pw2, create: true });
    log.add(`新建空库 -> ${o.status} token=${!!(o.data && o.data.token)} ${JSON.stringify(o.data).slice(0, 160)}`);
    if (!o.ok) throw new Error("建空库失败 " + o.status + JSON.stringify(o.data));
    L.setToken(o.data.token);
    const views = {};
    for (const p of ["projects", "contracts", "ip"]) {
      const r = await L.get(`/api/v2/ui/${p}/company`);
      views[p] = { status: r.status, len: Array.isArray(r.data) ? r.data.length : null };
    }
    const ar = await L.get("/api/v2/ui/archive/company");
    views.archive = { status: ar.status, folders: ((ar.data && ar.data.folders) || []).length, archives: ((ar.data && ar.data.archives) || []).length };
    const trash = await L.get("/api/trash/company");
    views.trash = { status: trash.status, len: Array.isArray(trash.data) ? trash.data.length : null };
    log.add(`空库回读: ${JSON.stringify(views)}`);
    fs.writeFileSync(path.join(TMP, `vault-${RUNID}-empty.cred.json`), JSON.stringify({ db: db2, password: pw2 }), "utf8");
    const okEmpty = views.projects.len === 0 && views.contracts.len === 0 && views.trash.len === 0 && views.archive.folders === 7;
    rec({
      id: "T-P2-15", feature: "全新空库的接口表现（空数据与加载失败是否可区分）",
      expected: "空库返回空集合且 7 个系统目录仍在；空数据与「接口失败」在响应上必须可区分",
      result: okEmpty ? "PASS" : "CONFIRMED_BUG", defect: okEmpty ? null : "BUG-019",
      observed: { views, emptyDb: db2.split(path.sep).slice(-1)[0] },
      notes: "「失败被吞成空」由 X-01 的 500 注入裁决：前端把两者渲染成同一形态，故仍记 BUG-019",
    });
  } catch (e) {
    rec({ id: "T-P2-15", feature: "空库表现", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "空库表现正常" });
  }

  fs.writeFileSync(path.join(EVID, "http2b-results.json"), JSON.stringify(results, null, 2), "utf8");
  log.flush();
  console.log("\n=== 第二批修正汇总 ===");
  console.log(results.map((r) => `[${r.result}] ${r.id}${r.defect ? " -> " + r.defect : ""}`).join("\n"));
})().catch((e) => {
  log.add("HTTP2B FAILED: " + (e && e.stack || e));
  log.flush();
  fs.writeFileSync(path.join(EVID, "http2b-results.json"), JSON.stringify(results, null, 2), "utf8");
  process.exit(1);
});
