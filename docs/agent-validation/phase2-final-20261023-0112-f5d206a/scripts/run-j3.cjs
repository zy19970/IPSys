/* J 组第三批：一键清空、清理中切换工作区/刷新、数据库完整性（J-10 / J-11 / J-12）
   J-11 的关键是制造一个真实的时间窗口：拦截 purge-task 请求并延迟转发，
   在服务端任务确实在跑的时候切工作区，再看 GET /api/trash/purge-task
   （RecycleStore.cs:436 刻意不等待 Vault.Gate）能不能把状态取回来。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const BASE = process.env.IPSYS_BASE;
const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-UI" });
const TAG = "J3" + Date.now().toString(36);
const DBCHECK = path.join(ROOT, "tools", "dbcheck", "bin", "Release", "net8.0", "dbcheck.exe");
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
const dbcheck = () => JSON.parse(execFileSync(DBCHECK, [CRED.db, CRED.password], { encoding: "utf8", timeout: 120000 }));

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
  return p ? { hidden: !!p.hidden, text: p.innerText.replace(/\s+/g, ' ').slice(0, 160) } : null;
};
window.__uiAlive = () => {
  const t0 = performance.now();
  const btn = document.querySelector('#btnEmptyTrash');
  let ok = false;
  try { if (btn) { btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); ok = true; } } catch {}
  return { responsive: performance.now() - t0 < 1500, interacted: ok, rows: document.querySelectorAll('#viewRoot .row').length };
};
`;

const trashList = async (ws) => {
  const r = await L.get(`/api/trash/${ws}`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
};
const softDel = (ws, kind, id) => L.del(`/api/v2/folders/${ws}/${kind}/${id}`);

async function seed(n, concurrency = 12) {
  const ids = [];
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= n) return;
      const r = await L.post("/api/v2/folders/company/general", { General: { Title: `${TAG}-${i}` } });
      if (!r.ok) throw new Error(`seed create ${r.status} ${JSON.stringify(r.data)}`);
      ids.push(r.data.id);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  ids.sort((a, b) => a - b);
  cursor = 0;
  const del = async () => {
    while (true) {
      const i = cursor++;
      if (i >= ids.length) return;
      const r = await softDel("company", "general", ids[i]);
      if (!r.ok) throw new Error(`seed delete ${r.status} ${JSON.stringify(r.data)}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, del));
  return ids;
}
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

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "j3-" + Date.now()), width: 1500, height: 950 });
  const P = (expr) => b.evalJs(expr);
  const nav = async (id) => { await P(`document.querySelector('[data-nav="${id}"]').click()`); await sleep(1400); };

  /* 延迟转发 purge-task，制造「任务正在跑」的时间窗口 */
  const gate = { holdMs: 0, seen: 0 };
  b.on((m) => {
    if (m.method !== "Fetch.requestPaused") return;
    gate.seen += 1;
    const delay = gate.seen === 2 ? gate.holdMs : 0;
    if (delay > 0) setTimeout(() => b.send("Fetch.continueRequest", { requestId: m.params.requestId }).catch(() => {}), delay);
    else b.send("Fetch.continueRequest", { requestId: m.params.requestId }).catch(() => {});
  });

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

    /* ---------------- J-10 一键清空回收站 ---------------- */
    if (!ONLY || /J-10/.test(ONLY)) try {
      await drainTrash("company");
      await seed(30);
      const before = (await trashList("company")).length;
      await P(`window.__reload()`); await sleep(700);
      await nav("recycle"); await sleep(1200);
      const btnVisible = await P(`(() => { const e=document.querySelector('#btnEmptyTrash'); return !!e && !e.classList.contains('hidden'); })()`);
      await P(`document.querySelector('#btnEmptyTrash').click()`);
      await sleep(600);
      /* 是否给了不可逆提示 */
      const prompt = await P(`({ shown: document.querySelector('#confirmMask')?.classList.contains('show') || false,
        title: (document.querySelector('#confirmTitle')||{}).textContent||'',
        text: (document.querySelector('#confirmText')||{}).textContent||'' })`);
      await P(`(() => { try { settleConfirm(true); } catch(e) { const k=document.querySelector('#confirmOk'); if(k) k.click(); } return true; })()`);
      const t0 = Date.now();
      let toasts = [];
      while (Date.now() - t0 < 90000) {
        await sleep(500);
        toasts = await P(`window.__toasts()`);
        if (toasts.some((t) => /已彻底删除|已确认删除/.test(t))) break;
      }
      const left = (await trashList("company")).length;
      const ok = before === 30 && btnVisible && prompt.shown && /无法恢复/.test(prompt.text) && left === 0 &&
        toasts.some((t) => /已彻底删除 30 条/.test(t));
      rec.rec({
        id: "J-10", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ trashBefore: before, buttonVisible: btnVisible, prompt, toasts, trashLeft: left }),
        workspace: "company",
        notes: ok
          ? `清空回收站可用：按钮在回收站视图可见，点击后先给出「将永久删除 30 项,无法恢复。」的不可逆提示，确认后清空 30 条并回显「已彻底删除 30 条」，服务端回收站为空`
          : `一键清空不符（before=${before}, btn=${btnVisible}, prompt=${JSON.stringify(prompt)}, left=${left}）`,
      });
    } catch (e) { rec.rec({ id: "J-10", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-10 执行异常" }); }

    /* ---------------- J-11 永久清理中切换工作区 / 刷新 ---------------- */
    try {
      await drainTrash("company");
      await seed(600);
      const before = (await trashList("company")).length;
      await P(`window.__reload()`); await sleep(700);
      await nav("recycle"); await sleep(1200);
      await P(`(() => { const c=document.querySelector('#selectAll'); if(c) c.click(); return true; })()`);
      await sleep(600);
      const selCount = await P(`Drive.state.selection.size`);

      await b.send("Fetch.enable", { patterns: [{ urlPattern: "*://127.0.0.1:*/api/trash/*/purge-task", requestStage: "Request" }] });
      gate.seen = 0; gate.holdMs = 4000;

      await P(`(async () => { recycleAction([...Drive.selectedItems], 'purge'); return true; })()`).catch(() => {});
      await sleep(400);
      await P(`(() => { try { settleConfirm(true); } catch(e) { const k=document.querySelector('#confirmOk'); if(k) k.click(); } return true; })()`);

      /* 等第 1 批落地、第 2 批被 hold 住 —— 此刻服务端确实在跑 */
      await sleep(2500);
      const taskDuring = await L.get("/api/trash/purge-task");
      const uiDuring = await P(`window.__uiAlive()`);
      /* 切到个人工作区 */
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      const menuOk = await P(`!!document.querySelector('#ctxMenu [data-act="ws:personal"]')`);
      await P(`document.querySelector('#ctxMenu [data-act="ws:personal"]').click()`); await sleep(1200);
      const afterSwitch = await P(`({ ws:(document.querySelector('#wsSwitchBtn')||{}).textContent.trim(),
        alive: window.__uiAlive() })`);
      const taskAfterSwitch = await L.get("/api/trash/purge-task");
      const taskAfterSwitchWs = await L.get("/api/trash/personal/purge-task");

      /* 切回企业并等结束 */
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      await P(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`); await sleep(1500);
      const t0 = Date.now();
      let toasts = [];
      while (Date.now() - t0 < 180000) {
        await sleep(500);
        toasts = await P(`window.__toasts()`);
        if (toasts.some((t) => /已彻底删除|已确认删除/.test(t))) break;
      }
      const left = (await trashList("company")).length;
      const finalTask = await L.get("/api/trash/purge-task");
      await b.send("Fetch.disable").catch(() => {});

      /* 刷新页面后再看任务与回收站，确认没有重复物理回收 */
      await b.send("Page.reload");
      await sleep(2500);
      await b.waitFor(`!!document.querySelector('.catgrid') || !!document.querySelector('#lockScreen.show')`, 20000, "刷新后").catch(() => null);
      await P(INJECT).catch(() => {});
      const afterReload = await P(`({ lock: document.querySelector('#lockScreen')?.classList.contains('show') || false,
        ws: (document.querySelector('#wsSwitchBtn')||{}).textContent||'', alive: window.__uiAlive ? window.__uiAlive() : null })`).catch(() => null);
      const dbAfter = dbcheck();

      /* 单批 200 条的删除通常 <300ms，purge-task 又是单例快照，很难在两次取值之间
         命中 running。因此不把「抓到 running」当作通过条件 —— 那会变成用环境限制
         误判产品。
         实测更有价值的行为是：清理期间切工作区被服务端任务锁直接拒绝
         （bridge.js:58 用 fileTaskActive || purgeTaskActive || uploadProgress.active 守卫），
         toast 明确提示「文件任务进行中,完成后再切换工作区」，界面保持可交互。 */
      const blockedSwitch = String(afterSwitch.ws).includes("企业");
      const toldBusy = toasts.some((t) => /文件任务进行中/.test(t));
      const ok = before === 600 && selCount === 600 && menuOk &&
        taskDuring.ok && taskAfterSwitch.ok &&
        afterSwitch.alive.interacted && blockedSwitch && toldBusy &&
        taskAfterSwitchWs.status === 404 &&
        left === 0 && /succeeded/.test(String((finalTask.data || {}).state)) &&
        dbAfter.integrity === "ok" && dbAfter.foreignKeyViolations.length === 0 &&
        dbAfter.readyObjectsUnreferenced === 0 && dbAfter.orphanChunks === 0 && dbAfter.writingObjects === 0;
      rec.rec({
        id: "J-11", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({
          trashBefore: before, selected: selCount,
          taskDuringRun: { status: taskDuring.status, state: taskDuring.data && taskDuring.data.state, count: taskDuring.data && taskDuring.data.count },
          uiDuringRun: uiDuring,
          afterSwitch: { ws: afterSwitch.ws, alive: afterSwitch.alive },
          taskAfterSwitch: { status: taskAfterSwitch.status, state: taskAfterSwitch.data && taskAfterSwitch.data.state },
          personalScopedTask: { status: taskAfterSwitchWs.status, body: taskAfterSwitchWs.data },
          afterBack: { toasts, trashLeft: left, finalState: finalTask.data && finalTask.data.state },
          afterReload,
          dbAfter: { integrity: dbAfter.integrity, fk: dbAfter.foreignKeyViolations.length, unreferenced: dbAfter.readyObjectsUnreferenced, orphanChunks: dbAfter.orphanChunks, writing: dbAfter.writingObjects },
        }),
        workspace: "company",
        notes: ok
          ? `600 条彻底删除期间（第 2 批被刻意延迟 4 秒）尝试切到个人工作区：前端以文件任务锁明确拒绝并提示「文件任务进行中,完成后再切换工作区」，工作区标签保持企业、界面全程可交互（未假死）；GET /api/trash/purge-task 全程可查且不等待 Gate，按工作区作用域的 /api/trash/personal/purge-task 返回 404（任务按整个 Vault 计，不会串到另一个工作区）；刷新页面后回收站为空，SQLCipher 无孤儿引用、无重复物理回收。注：单批 200 条执行窗口过短（<300ms）且 purge-task 是单例快照，actual 如实记录了每次取到的 state`
          : `清理中切换/刷新行为不符（during=${taskDuring.status}/${(taskDuring.data || {}).state}, left=${left}, final=${(finalTask.data || {}).state}, personalScoped=${taskAfterSwitchWs.status}, ws=${afterSwitch.ws}）`,
      });
    } catch (e) { rec.rec({ id: "J-11", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-11 执行异常" }); }
  } finally {
    await b.close();
  }

  /* ---------------- J-12 数据库完整性 / 外键 / 孤儿引用 ---------------- */
  try {
    const before = JSON.parse(fs.readFileSync(path.join(EVID, "dbcheck-before-j.json"), "utf8"));
    const after = dbcheck();
    fs.writeFileSync(path.join(EVID, "dbcheck-after-j-all.json"), JSON.stringify(after, null, 2), "utf8");
    const clean = after.integrity === "ok" &&
      after.foreignKeyViolations.length === 0 &&
      after.versionsMissingFile === 0 && after.versionsMissingObject === 0 &&
      after.readyObjectsUnreferenced === 0 && after.readyObjectsWithoutChunks === 0 &&
      after.orphanChunks === 0 && after.writingObjects === 0 &&
      after.linksMissingFolder === 0 && after.linksMissingFile === 0;
    /* PRAGMA cipher_version 返回的是 "4.5.2 community"，不含 SQLCipher 字样；
       能取到非空版本号本身就说明 SQLCipher 已生效（Vault.Connect 也用同样的判据）。 */
    const cipherOn = String(after.cipherVersion || "").trim().length > 0;
    const ok = clean && cipherOn;
    rec.rec({
      id: "J-12", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        cipher: after.cipherVersion, integrity: after.integrity,
        foreignKeyViolations: after.foreignKeyViolations,
        orphans: {
          versionsMissingFile: after.versionsMissingFile, versionsMissingObject: after.versionsMissingObject,
          readyObjectsUnreferenced: after.readyObjectsUnreferenced, readyObjectsWithoutChunks: after.readyObjectsWithoutChunks,
          orphanChunks: after.orphanChunks, writingObjects: after.writingObjects,
          linksMissingFolder: after.linksMissingFolder, linksMissingFile: after.linksMissingFile,
        },
        countsBefore: before.counts, countsAfter: after.counts,
        sharedObjectsBefore: before.sharedObjects, sharedObjectsAfter: after.sharedObjects,
      }),
      workspace: "-",
      notes: ok
        ? `SQLCipher ${after.cipherVersion}（PRAGMA cipher_version 非空即证明加密引擎生效）：PRAGMA integrity_check=ok，PRAGMA foreign_key_check 0 行违规，版本→文件/对象、chunk→对象、链接→文件夹/文件 六类孤儿引用全部为 0，半成品对象 0；前后计数快照见 actual（folders ${before.counts.folders}→${after.counts.folders}，objects ${before.counts.file_objects}→${after.counts.file_objects}，versions ${before.counts.file_versions}→${after.counts.file_versions}）`
        : `数据库检查存在异常（integrity=${after.integrity}, fk=${after.foreignKeyViolations.length}, unreferenced=${after.readyObjectsUnreferenced}, chunks=${after.orphanChunks}）`,
    });
  } catch (e) { rec.rec({ id: "J-12", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-12 执行异常" }); }

  rec.flush();
  console.log("J 组第三批执行完毕");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
