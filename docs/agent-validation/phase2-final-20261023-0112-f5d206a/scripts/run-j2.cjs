/* J 组第二批：大批量彻底删除的真实分批与失败中断（J-07 / J-08 / J-09）
   前端的批次切分在 bridge.js:610-611（for i += 200），每批调用
   POST /api/trash/{ws}/purge-task，再轮询 GET /api/trash/purge-task。
   本脚本不自己分批，而是造出 201 / 403 条已删记录后，在浏览器里全选 + 彻底删除，
   通过网络层抓每一批的请求体，用「实际发出的批次」而不是「我以为的批次」来判定。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const BASE = process.env.IPSYS_BASE;
const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-UI" });
const TAG = "J2" + Date.now().toString(36);
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

const INJECT = String.raw`
window.__toasts = () => [...document.querySelectorAll('#toasts .toast')].map(x => x.innerText.trim());
window.__reload = async () => {
  await VaultStore.loadAll(VaultStore.ws);
  Drive.resetSearch && Drive.resetSearch();
  Drive.state.ready = true; Drive.state.folderId = 'root'; Drive.state.view = 'home';
  Drive.render(); return true;
};
window.__purgePanel = () => {
  const p = document.querySelector('#trashPurgeProgress');
  return p ? { hidden: !!p.hidden, text: p.innerText.replace(/\s+/g, ' ').slice(0, 200) } : null;
};
`;

const trashList = async (ws) => {
  const r = await L.get(`/api/trash/${ws}`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
};
const softDel = (ws, kind, id) => L.del(`/api/v2/folders/${ws}/${kind}/${id}`);

/* 并发批量建 general 记录并软删，返回 ids */
async function seed(n, concurrency = 12) {
  const ids = [];
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= n) return;
      const r = await L.post("/api/v2/folders/company/general", { General: { Title: `${TAG}-${i}` } });
      if (!r.ok) throw new Error(`seed ${i} create ${r.status} ${JSON.stringify(r.data)}`);
      ids.push(r.data.id);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  ids.sort((a, b) => a - b);
  /* 逐条软删（同样并发） */
  cursor = 0;
  const del = async () => {
    while (true) {
      const i = cursor++;
      if (i >= ids.length) return;
      const r = await softDel("company", "general", ids[i]);
      if (!r.ok) throw new Error(`seed ${ids[i]} delete ${r.status} ${JSON.stringify(r.data)}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, del));
  return ids;
}

/* 用 HTTP 分批把回收站清空（这是准备步骤，不是被测行为） */
async function drainTrash(ws) {
  for (let guard = 0; guard < 200; guard++) {
    const t = await trashList(ws);
    if (!t.length) return 0;
    const batch = t.slice(0, 200).map((x) => ({ kind: x.kind, id: x.id, section: x.section || "" }));
    const r = await L.post(`/api/trash/${ws}/purge`, { items: batch });
    if (!r.ok) throw new Error(`drain ${r.status} ${JSON.stringify(r.data)}`);
  }
  return -1;
}

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "j2-" + Date.now()), width: 1500, height: 950 });
  const P = (expr) => b.evalJs(expr);
  const nav = async (id) => { await P(`document.querySelector('[data-nav="${id}"]').click()`); await sleep(1400); };

  /* 抓 /purge-task 的 POST 请求体，并允许按序号注入失败 */
  const purgeCalls = [];
  const inject = { failAt: 0, code: 409 };
  let fetchSeen = 0;
  b.on((m) => {
    if (m.method === "Network.requestWillBeSent") {
      const r = m.params.request;
      if (r.method === "POST" && /\/api\/trash\/[a-z]+\/purge-task$/.test(r.url)) {
        let parsed = null;
        try { parsed = JSON.parse(r.postData || "{}"); } catch { parsed = { raw: r.postData }; }
        purgeCalls.push({ url: r.url, count: (parsed.items || []).length, items: parsed.items || [] });
      }
    }
    if (m.method === "Fetch.requestPaused") {
      /* 用独立计数器：requestWillBeSent 与 requestPaused 的到达顺序不稳定 */
      fetchSeen += 1;
      if (inject.failAt > 0 && fetchSeen >= inject.failAt) {
        b.send("Fetch.fulfillRequest", {
          requestId: m.params.requestId,
          responseCode: inject.code,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ error: "J-09 注入的第二批失败" })).toString("base64"),
        }).catch(() => {});
        inject.failAt = 0;
        return;
      }
      b.send("Fetch.continueRequest", { requestId: m.params.requestId }).catch(() => {});
    }
  });

  const runPurgeScenario = async ({ codeInject }) => {
    purgeCalls.length = 0;
    fetchSeen = 0;
    inject.failAt = 0;
    await P(`window.__reload()`); await sleep(700);
    await nav("recycle"); await sleep(1200);
    const rows = await P(`document.querySelectorAll('#viewRoot .row').length`);
    await P(`(() => { const c=document.querySelector('#selectAll'); if(c) c.click(); return true; })()`);
    await sleep(600);
    const selCount = await P(`Drive.state.selection.size`);
    if (codeInject) {
      await b.send("Fetch.enable", { patterns: [{ urlPattern: "*://127.0.0.1:*/api/trash/*/purge-task", requestStage: "Request" }] });
      inject.failAt = codeInject.at;
      inject.code = codeInject.code;
    }
    /* 直接走与右键菜单同一条业务路径 */
    await P(`(async () => { recycleAction([...Drive.selectedItems], 'purge'); return true; })()`).catch(() => {});
    await sleep(400);
    await P(`(() => { try { settleConfirm(true); } catch(e) { const k=document.querySelector('#confirmOk'); if(k) k.click(); } return true; })()`);
    /* 结束判定看 toast：purge-task 是单例任务快照，第 2 批被拒时它仍是第 1 批的 succeeded，
       拿任务状态当结束信号会提前退出。 */
    const t0 = Date.now();
    let toasts = [], panel = null, taskState = null;
    while (Date.now() - t0 < 180000) {
      await sleep(500);
      panel = await P(`window.__purgePanel()`);
      toasts = await P(`window.__toasts()`);
      if (toasts.some((t) => /已彻底删除|已确认删除/.test(t))) break;
      if (purgeCalls.length === 0 && Date.now() - t0 > 15000) break;
    }
    const tr = await L.get("/api/trash/purge-task");
    taskState = tr.ok ? tr.data : null;
    if (codeInject) await b.send("Fetch.disable").catch(() => {});
    await sleep(800);
    const left = (await trashList("company")).length;
    return { rows, selCount, batches: purgeCalls.map((x) => x.count), total: purgeCalls.reduce((n, x) => n + x.count, 0), panel, taskState, toasts, left };
  };

  const ONLY = process.env.IPSYS_ONLY || "";
  try {
    await b.goto(BASE + "/");
    await sleep(600);
    const st = await P(`({confirmHidden:!!(document.querySelector('#createConfirmField')||{}).hidden})`);
    if (!st.confirmHidden) { await P(`document.querySelector('#switchLockMode').click()`); await sleep(300); }
    await P(setVal("#dbPath", CRED.db));
    await P(setVal("#password", CRED.password));
    await P(`document.querySelector('#submitOpen').click()`);
    await sleep(1800);
    await b.waitFor(`!!document.querySelector('.catgrid')`, 20000, "工作台");
    if (!String(await P(`(document.querySelector('#wsSwitchBtn')||{}).textContent||''`)).includes("企业")) {
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      await P(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`); await sleep(1800);
    }
    await P(INJECT);
    await b.send("Network.enable");

    /* ---------------- J-07 选择 201 条彻底删除 ---------------- */
    if (!ONLY || /J-07/.test(ONLY)) try {
      const drained = await drainTrash("company");
      await seed(201);
      const before = (await trashList("company")).length;
      const r = await runPurgeScenario({ expected: { batches: [200, 1], total: 201 } });
      const ok = drained === 0 && before === 201 && r.total === 201 &&
        r.batches.length === 2 && r.batches[0] === 200 && r.batches[1] === 1 &&
        String((r.taskState || {}).state) === "succeeded" && r.left === 0 &&
        r.toasts.some((t) => /已彻底删除 201 条/.test(t));
      rec.rec({
        id: "J-07", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ drained, trashBefore: before, uiRows: r.rows, selected: r.selCount, batches: r.batches, total: r.total, taskState: r.taskState, toasts: r.toasts, trashLeft: r.left }),
        workspace: "company",
        notes: ok
          ? `选择 201 条：前端真实切成 2 批（200 + 1）提交，服务端任务 succeeded，结果 toast 与提交条数一致（201），回收站清空 —— 不是一次性超限提交`
          : `201 条分批不符（批次=${JSON.stringify(r.batches)}，总计=${r.total}，left=${r.left}）`,
      });
    } catch (e) { rec.rec({ id: "J-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-07 执行异常" }); }

    /* ---------------- J-08 选择 403 条彻底删除 ---------------- */
    if (!ONLY || /J-08/.test(ONLY)) try {
      await drainTrash("company");
      await seed(403);
      const before = (await trashList("company")).length;
      const r = await runPurgeScenario({ expected: { batches: [200, 200, 3], total: 403 } });
      const ok = before === 403 && r.total === 403 &&
        r.batches.length === 3 && r.batches[0] === 200 && r.batches[1] === 200 && r.batches[2] === 3 &&
        String((r.taskState || {}).state) === "succeeded" && r.left === 0 &&
        r.toasts.some((t) => /已彻底删除 403 条/.test(t));
      rec.rec({
        id: "J-08", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ trashBefore: before, uiRows: r.rows, selected: r.selCount, batches: r.batches, total: r.total, taskState: r.taskState, toasts: r.toasts, trashLeft: r.left }),
        workspace: "company",
        notes: ok
          ? `选择 403 条：按 200/200/3 三批真实提交（服务端上限正是 200），任务 succeeded，toast 与实际提交条数 403 一致`
          : `403 条分批不符（批次=${JSON.stringify(r.batches)}, total=${r.total}, left=${r.left}）`,
      });
    } catch (e) { rec.rec({ id: "J-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-08 执行异常" }); }

    /* ---------------- J-09 第二批失败：后续批次必须停止且已/未提交可区分 ---------------- */
    try {
      await drainTrash("company");
      await seed(403);
      const before = (await trashList("company")).length;
      const r = await runPurgeScenario({ expected: { failAtSecond: true }, codeInject: { at: 2, code: 409 } });
      const firstOk = r.batches.length >= 1 && r.batches[0] === 200;
      /* 第 2 批确实发出了（requestWillBeSent 会记录），但被 409 拒；
         关键是不再有第 3 批。之前把它写成 batches.length===1 是错的。 */
      const secondRejected = r.batches.length === 2 && r.batches[1] === 200;
      const noThird = !r.batches.some((n, i) => i >= 2);
      const leftOk = r.left === 203;             /* 403 - 200 = 203 仍在回收站 */
      const toldUser = r.toasts.some((t) => /已确认删除 200\s*\/\s*403/.test(t));
      const ok = before === 403 && firstOk && secondRejected && noThird && leftOk && toldUser;
      rec.rec({
        id: "J-09", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ trashBefore: before, batches: r.batches, total: r.total, taskState: r.taskState, toasts: r.toasts, trashLeft: r.left }),
        workspace: "company",
        notes: ok
          ? `第 2 批被注入 409 后前端立即停止，未发出第 3 批；toast 明确区分「已确认删除 200 / 403 条」，回收站实际剩 203 条 —— 已提交与未提交界限清晰，不会把未确认批次说成成功`
          : `第二批失败后的行为不符（批次=${JSON.stringify(r.batches)}, left=${r.left}, toast=${JSON.stringify(r.toasts.slice(0, 2))}）`,
      });
    } catch (e) { rec.rec({ id: "J-09", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-09 执行异常" }); }

    await b.shot(path.join(EVID, "shots", `j2-final-${TAG}.png`)).catch(() => {});
  } finally {
    await b.close();
  }

  rec.flush();
  console.log("J 组第二批执行完毕");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
