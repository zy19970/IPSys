/* B-09 / B-10：工作区隔离与默认工作区 */
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
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-BROWSER" });
const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
async function lockState(b) {
  return b.evalJs(`({heading:(document.querySelector('#lockHeading')||{}).textContent||'',confirmHidden:!!(document.querySelector('#createConfirmField')||{}).hidden,hint:(document.querySelector('#lockHint')||{}).textContent||''})`);
}
async function openPwd(b, dbPath, pwd) {
  const st = await lockState(b);
  if (!st.confirmHidden) { await b.evalJs(`document.querySelector('#switchLockMode').click()`); await sleep2(250); }
  await b.evalJs(setVal("#dbPath", dbPath));
  await b.evalJs(setVal("#password", pwd));
  await b.evalJs(`document.querySelector('#submitOpen').click()`);
  await sleep2(1400);
}
async function waitApp(b) {
  await b.waitFor(`!!document.querySelector('.catgrid') && !document.querySelector('#appShell').getAttribute('aria-hidden')`, 20000, "进入工作台");
  await sleep2(900);
}
async function home(b) {
  return b.evalJs(`({
    text: (document.querySelector('#content')||{}).innerText?.slice(0,300)||'',
    ws: ((document.querySelector('#wsSwitchBtn')||{}).textContent||'').trim(),
    cats: [...document.querySelectorAll('.catcard')].map(x=>x.innerText.split('\\n').map(s=>s.trim()).filter(Boolean)[1]||'').filter(Boolean),
    rows: [...document.querySelectorAll('.row')].map(r=>(r.querySelector('.row-title')||{}).textContent||'').filter(Boolean),
  })`);
}
async function switchWs(b, ws) {
  await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`);
  await sleep2(300);
  await b.evalJs(`document.querySelector('#ctxMenu [data-act="ws:${ws}"]').click()`);
  await sleep2(1600);
}
async function lockCurrent(pwd) {
  const r = await L.post("/api/resume", { password: pwd });
  if (!r.ok) throw new Error("resume " + r.status);
  L.setToken(r.data.token);
  const k = await L.post("/api/lock", {});
  if (!k.ok) throw new Error("lock " + k.status);
}

(async () => {
  const b = await launch({ profileDir: path.join(ROOT, "profiles", "b2-" + Date.now()) });
  await b.goto(BASE + "/");
  await sleep2(600);
  await openPwd(b, CRED.db, CRED.password);
  await waitApp(b);

  const p = await home(b);
  await switchWs(b, "company");
  const c = await home(b);
  await switchWs(b, "personal");
  const p2 = await home(b);

  const ok09 = p.ws.includes("个人") && c.ws.includes("企业") && p2.ws.includes("个人") &&
    p.cats.length === 6 && c.cats.length === 5 &&
    !/P2个人档案/.test(c.text) && !/P2项目A/.test(p2.text) &&
    /P2档案|P2项目A/.test(c.text);
  rec.rec({
    id: "B-09", status: ok09 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ personal: p, company: c, backPersonal: p2 }),
    workspace: "company;personal", notes: ok09 ? "个人 6 类 / 企业 5 类，来回切换记录不串写" : "工作区分类数或记录隔离不符",
    evidence: ["evidence/probe-ws-menu.png"],
  });

  /* B-10 */
  await b.evalJs(`document.querySelector('#btnSettings').click()`);
  await sleep2(400);
  await b.evalJs(`document.querySelector('[data-seg="startWs"] [data-v="company"]').click()`);
  await sleep2(200);
  await b.evalJs(`document.querySelector('#settingsDone').click()`);
  await sleep2(300);
  const pref1 = await b.evalJs(`localStorage.getItem('ipsys.startWs')`);
  await switchWs(b, "personal");
  const pref2 = await b.evalJs(`localStorage.getItem('ipsys.startWs')`);
  await lockCurrent(CRED.password);
  await b.goto(BASE + "/");
  await sleep2(600);
  await openPwd(b, CRED.db, CRED.password);
  let after = null;
  try { await waitApp(b); after = await home(b); } catch (e) { after = { error: e.message }; }
  const ok10 = pref1 === "company" && pref2 === "company" && after && after.ws.includes("企业");
  rec.rec({
    id: "B-10", status: ok10 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ prefAfterSettings: pref1, prefAfterTopbarSwitch: pref2, relogin: after }),
    workspace: "company", notes: ok10 ? "设置持久化，顶栏临时切换不改写，重新登录进入企业工作区" : "默认工作区语义不符",
  });

  // 还原个人默认，避免影响后续
  await b.evalJs(`document.querySelector('#btnSettings').click()`);
  await sleep2(300);
  await b.evalJs(`document.querySelector('[data-seg="startWs"] [data-v="personal"]').click(); document.querySelector('#settingsDone').click()`);
  await sleep2(300);
  rec.flush();
  await b.shot(path.join(EVID, "b-ws-final.png"));
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); rec.flush(); process.exit(1); });
