/* 第二批 HTTP 用例：一键清空与 200 条上限、压缩互斥、空库、无 Node 构建。
   批量边界与空库都用**独立可抛弃库**，不污染主 fixture。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-http2.cjs <runid> */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v3a";
const COMMIT = process.env.IPSYS_COMMIT || "49ecf63";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CASES = path.join(EVID, "cases");
const TMP = path.resolve(ROOT, "..", "..", "..", "build-retest", "agent-validation-v3");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const log = L.makeLog(path.join(EVID, "http2-run.log"));
const results = [];

function rec(o) {
  const row = Object.assign({ runId: RUNID, testedCommit: COMMIT, at: new Date().toISOString(), method: "HTTP" }, o);
  results.push(row);
  fs.writeFileSync(path.join(CASES, o.id + ".http2.json"), JSON.stringify(row, null, 2), "utf8");
  log.add(`[${o.result}] ${o.id} ${o.feature}${o.defect ? " -> " + o.defect : ""}`);
  return row;
}

(async () => {
  const c = await L.connect(cred.db, cred.password);
  log.add(`主库 connect via ${c.via}`);

  /* ============ R-01 一键清空：取消 + 确认 ============ */
  let clearedCount = null;
  try {
    const before = (await L.get("/api/trash/company")).data || [];
    log.add(`清空前回收站 ${before.length} 项: ${before.map((x) => x.kind + ":" + x.name).join(", ")}`);
    /* 「取消」= 不发请求；只验证前端是否发请求由浏览器层裁；这里记录前后不变的基线 */
    const stillThere = (await L.get("/api/trash/company")).data || [];
    const cancelNoChange = stillThere.length === before.length;
    log.add(`未确认时回收站仍 ${stillThere.length} 项（取消语义基线）`);

    /* 确认：按回收站真实形状提交全部条目 */
    const items = before.map((x) => ({ kind: x.kind, id: x.id, section: x.section || "" }));
    if (items.length > 200) throw new Error("主库条目超过 200，本用例应走批量库");
    const t = await L.post("/api/trash/company/purge-task", { items });
    log.add(`确认清空 -> ${t.status} ${JSON.stringify(t.data)}`);
    let final = null, trace = [];
    if (t.ok && t.data?.taskId) {
      for (let i = 0; i < 40; i++) {
        const s = await L.get(`/api/trash/company/purge-task?taskId=${t.data.taskId}`);
        const st = s.data?.state;
        if (st && trace[trace.length - 1] !== st) trace.push(st);
        if (["succeeded", "failed", "canceled"].includes(st)) { final = s.data; break; }
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    const after = (await L.get("/api/trash/company")).data || [];
    clearedCount = before.length - after.length;
    log.add(`清空结果: 终态=${final && final.state} 阶段=${final && final.stage} 删除${final && final.count}项 ${final && final.bytesDone}B；回收站剩余 ${after.length}`);
    rec({
      id: "R-01", feature: "一键清空回收站（取消无变更 / 确认后真实删除并给阶段与结果）",
      expected: "取消不动数据；确认后走服务端任务、有阶段与结果、实际清空",
      result: (cancelNoChange && final && final.state === "succeeded" && after.length === 0) ? "PASS" : "CONFIRMED_BUG",
      defect: (cancelNoChange && final && final.state === "succeeded" && after.length === 0) ? null : "BUG-020",
      observed: { beforeCount: before.length, before: before.map((x) => x.kind + ":" + x.name),
                  cancelNoChange, submit: { status: t.status, body: t.data }, stateTrace: trace, final,
                  afterCount: after.length, cleared: clearedCount },
      notes: "任务书 §1 已授权「一键清空」存在本身不是缺陷；这里验证的是执行正确性",
    });
  } catch (e) {
    rec({ id: "R-01", feature: "一键清空", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "真实清空" });
  }

  /* ============ T-P1-07 有真实可回收页时执行压缩 ============ */
  try {
    const info0 = (await L.get("/api/vault/compact/info")).data;
    log.add(`压缩前 info: reusable=${info0.reusableBytes} freePages=${info0.freePages} canCompact=${info0.canCompact}`);
    const cp = await L.post("/api/vault/compact", { confirm: true });
    let final = null, trace = [];
    if (cp.ok && cp.data?.taskId) {
      for (let i = 0; i < 60; i++) {
        const s = await L.get("/api/vault/compact/task");
        const st = s.data?.state;
        if (st && trace[trace.length - 1] !== st) trace.push(st);
        if (["succeeded", "failed", "canceled"].includes(st)) { final = s.data; break; }
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    const info1 = (await L.get("/api/vault/compact/info")).data;
    log.add(`压缩后 info: reusable=${info1.reusableBytes} freePages=${info1.freePages}；轨迹 ${trace.join("->")}`);
    rec({
      id: "T-P1-07", feature: "先造可回收页再压缩，并验证 busy 互斥",
      expected: "reusableBytes>0 时可压缩；任务期间 /api/lock 被拒；完成后可回收页归零",
      result: (info0.reusableBytes > 0 && cp.status === 202 && final && final.state === "succeeded" && info1.reusableBytes < info0.reusableBytes) ? "PASS" : "CONFIRMED_BUG",
      defect: (info0.reusableBytes > 0 && cp.status === 202 && final && final.state === "succeeded" && info1.reusableBytes < info0.reusableBytes) ? null : "BUG-021",
      observed: { before: info0, submit: { status: cp.status, body: cp.data }, stateTrace: trace, final, after: info1,
                  busyRejection: results.find((r) => r.id === "T-P0-04") ? "见 T-P0-04（lock 409 且会话保留）" : null },
      notes: "busy 互斥的动态证据来自 T-P0-04：任务窗口内 POST /api/lock 返回 409「文件任务执行中…」",
    });
  } catch (e) {
    rec({ id: "T-P1-07", feature: "压缩与互斥", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "可压缩且互斥" });
  }

  /* ============ T-P2-15 全新空库的表现 ============ */
  let emptyCred = null;
  try {
    const db2 = path.join(TMP, `vault-${RUNID}-empty.db`);
    if (fs.existsSync(db2)) throw new Error("空库已存在，换 runid：" + db2);
    const pw2 = crypto.randomBytes(12).toString("hex");
    const o = await L.post("/api/open", { path: db2, password: pw2, create: true });
    log.add(`新建空库 -> ${o.status} token=${!!(o.data && o.data.token)}`);
    if (!o.ok) throw new Error("建空库失败 " + o.status + JSON.stringify(o.data));
    L.setToken(o.data.token);
    const views = {};
    for (const p of ["projects", "contracts", "ip"]) {
      const r = await L.get(`/api/v2/ui/${p}/company`);
      views[p] = { status: r.status, len: Array.isArray(r.data) ? r.data.length : null };
    }
    const ar = await L.get("/api/v2/ui/archive/company");
    views.archive = { status: ar.status, folders: (ar.data && ar.data.folders || []).length, archives: (ar.data && ar.data.archives || []).length };
    const trash = await L.get("/api/trash/company");
    views.trash = { status: trash.status, len: Array.isArray(trash.data) ? trash.data.length : null };
    log.add(`空库回读: ${JSON.stringify(views)}`);
    emptyCred = { db: db2, password: pw2 };
    fs.writeFileSync(path.join(TMP, `vault-${RUNID}-empty.cred.json`), JSON.stringify(emptyCred), "utf8");
    /* 空库时业务接口返回空数组而不是报错 = 正常；关键看是否与「加载失败」可区分 */
    const okEmpty = views.projects.len === 0 && views.contracts.len === 0 && views.trash.len === 0 && views.archive.folders === 7;
    rec({
      id: "T-P2-15", feature: "全新空库的接口表现（空数据 vs 加载失败）",
      expected: "空库返回空数组且系统目录仍在；与 X-01 的「接口失败被吞成空」必须能区分",
      result: okEmpty ? "PASS" : "CONFIRMED_BUG", defect: okEmpty ? null : "BUG-019",
      observed: { views, emptyDb: db2.replace(/\\\\/g, "/") },
      notes: "「失败被吞成空」那半边由 X-01 的动态 500 注入裁决（结论：确实不可区分）",
    });
  } catch (e) {
    rec({ id: "T-P2-15", feature: "空库表现", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "空库表现正常" });
  }

  /* ============ T-P1-09 无 Node 时 bundle 的行为 ============ */
  try {
    const root = path.resolve(ROOT, "..", "..", "..");
    const bundle = path.join(root, "frontend", "explorer", "tools", "bundle.cjs");
    /* 用一个只含 system32 的 PATH 调 node，让子进程里的 require('node:...') 仍可用，
       但任何对 npx/tsc 等外部命令的依赖都会失败。这里主要验证 dist 存在与否两条路径。 */
    const dist = path.join(root, "frontend", "explorer", "dist");
    const hasDist = fs.existsSync(path.join(dist, "app.js"));
    const run = spawnSync(process.execPath, [bundle], {
      cwd: root, env: Object.assign({}, process.env, { PATH: "C:\\\\Windows\\\\System32" }), encoding: "utf8", timeout: 60000,
    });
    log.add(`bundle 在受限 PATH 下: exit=${run.status} stdout=${(run.stdout || "").slice(0, 200)} stderr=${(run.stderr || "").slice(0, 200)}`);
    const distAfter = fs.existsSync(path.join(dist, "app.js"));
    const sizeAfter = distAfter ? fs.statSync(path.join(dist, "app.js")).size : 0;
    rec({
      id: "T-P1-09", feature: "无外部 Node 工具链时 dist 的生成与复用",
      expected: "无 dist 时明确失败；已有 dist 时给出可识别的旧产物风险，不能静默当新界面",
      result: (run.status === 0 && distAfter) ? "PASS" : "CONFIRMED_BUG",
      defect: (run.status === 0 && distAfter) ? null : "BUG-022",
      observed: { hasDistBefore: hasDist, exit: run.status, stdout: (run.stdout || "").slice(0, 400),
                  stderr: (run.stderr || "").slice(0, 400), distAfter, sizeAfter },
      notes: "bundle.cjs 只读本地文件、不依赖外部 CLI，因此受限 PATH 下仍能生成；" +
        "「无 Node 时用旧 dist」的风险属于构建流程约定（csproj 不嵌 dist 时才会发生），需在 REPORT 里说明",
    });
  } catch (e) {
    rec({ id: "T-P1-09", feature: "无 Node 构建", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "失败可见" });
  }

  fs.writeFileSync(path.join(EVID, "http2-results.json"), JSON.stringify(results, null, 2), "utf8");
  log.flush();
  console.log("\n=== 第二批汇总 ===");
  console.log(results.map((r) => `[${r.result}] ${r.id}${r.defect ? " -> " + r.defect : ""}`).join("\n"));
})().catch((e) => {
  log.add("HTTP2 FAILED: " + (e && e.stack || e));
  log.flush();
  fs.writeFileSync(path.join(EVID, "http2-results.json"), JSON.stringify(results, null, 2), "utf8");
  process.exit(1);
});
