/* B 组建库与会话：真实 UI（CDP）+ HTTP 状态核对 */
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
const TMP = ROOT;
const RUNID = "p2b";
const CRED = JSON.parse(fs.readFileSync(path.join(TMP, `vault-p2-${RUNID}.cred.json`), "utf8"));
const DB = path.join(TMP, "vault-b02.db");
const B02_PWD = "Aa123456-b02";
const B03_DB = path.join(TMP, "vault-b03.db");
const rec = makeRecorder({ evidenceDir: EVID, runId: RUNID, commit: COMMIT, method: "DYNAMIC-BROWSER" });
const log = L.makeLog(path.join(EVID, "b-run.log"));

async function status() {
  const r = await fetch(BASE + "/api/status");
  return r.json();
}
async function lockCurrent(pwd) {
  const r = await L.post("/api/resume", { password: pwd });
  if (!r.ok) throw new Error("resume 失败: " + r.status + " " + JSON.stringify(r.data));
  L.setToken(r.data.token);
  const k = await L.post("/api/lock", {});
  if (!k.ok) throw new Error("lock 失败: " + k.status + " " + JSON.stringify(k.data));
  return true;
}
async function counts(ws) {
  const out = {};
  for (const p of ["projects", "ip", "general"]) {
    const r = await L.get(`/api/v2/ui/${p}/${ws}`);
    out[p] = Array.isArray(r.data) ? r.data.length : (r.data && r.data.rows ? r.data.rows.length : null);
  }
  const a = await L.get(`/api/v2/ui/archive/${ws}`);
  out.archive = Array.isArray(a.data) ? a.data.length : (a.data && a.data.rows ? a.data.rows.length : null);
  return out;
}
function setVal(sel, v) {
  return `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
}
async function lockPageState(b) {
  return b.evalJs(`({
    heading:(document.querySelector('#lockHeading')||{}).textContent||'',
    submit:(document.querySelector('#submitOpen')||{}).textContent||'',
    switchHidden:!!(document.querySelector('#switchLockMode')||{}).hidden,
    confirmHidden:!!(document.querySelector('#createConfirmField')||{}).hidden,
    pathRO:!!(document.querySelector('#dbPath')||{}).readOnly,
    pathDisabled:!!(document.querySelector('#dbPath')||{}).disabled,
    hint:(document.querySelector('#lockHint')||{}).textContent||'',
    lockVisible:!!document.querySelector('#lockScreen') && !document.querySelector('#lockScreen').hidden,
  })`);
}
async function waitApp(b) {
  await b.waitFor(`!!document.querySelector('.catgrid') && !document.querySelector('#appShell').getAttribute('aria-hidden')`, 20000, "进入工作台");
  await sleep(800);
}
async function homeSummary(b) {
  return b.evalJs(`({
    text: (document.querySelector('#content')||{}).innerText?.slice(0,260)||'',
    ws: ((document.querySelector('#wsSwitchBtn')||{}).textContent||'').trim(),
    cats: [...document.querySelectorAll('.catcard')].map(x=>x.innerText.split('\\n').map(s=>s.trim()).filter(Boolean)[1]||'').filter(Boolean),
  })`);
}
async function openPwd(b, dbPath, pwd) {
  // 如果停在“创建新资料库”模式，先切回打开模式，否则确认密码为空会被客户端拦下
  const st = await lockPageState(b);
  if (!st.confirmHidden) {
    await b.evalJs(`document.querySelector('#switchLockMode').click()`);
    await sleep(250);
  }
  await b.evalJs(setVal("#dbPath", dbPath));
  await b.evalJs(setVal("#password", pwd));
  await b.evalJs(`document.querySelector('#submitOpen').click()`);
  await sleep(1200);
}

(async () => {
  await lockCurrent(CRED.password);
  const s0 = await status();
  log.add("初始 status: " + JSON.stringify(s0));

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "b-" + Date.now()) });
  await b.send("Network.enable");
  let reqs = [];
  b.on((m) => { if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url); });

  /* ---------- B-01 默认打开已有库 ---------- */
  await b.goto(BASE + "/");
  await sleep(700);
  const st1 = await lockPageState(b);
  const b01 = st1.heading === "打开资料库" && st1.submit === "打开" && !st1.switchHidden && st1.confirmHidden;
  rec.rec({
    id: "B-01", status: b01 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(st1), workspace: "-", notes: b01 ? "首次进入默认打开已有库，未进入创建模式" : "默认态与任务书不符",
    evidence: ["evidence/probe-lock.png"],
  });

  /* ---------- B-03 密码不一致 / 为空 ---------- */
  await b.evalJs(`document.querySelector('#switchLockMode').click()`);
  await sleep(300);
  const stCreate = await lockPageState(b);
  reqs = [];
  await b.evalJs(setVal("#dbPath", B03_DB));
  await b.evalJs(setVal("#password", "Aa123456"));
  await b.evalJs(setVal("#confirmPassword", "Aa123457"));
  await b.evalJs(`document.querySelector('#submitOpen').click()`);
  await sleep(600);
  const hint1 = (await lockPageState(b)).hint;
  const openReqs1 = reqs.filter((u) => u.includes("/api/open"));
  const fileAfterMismatch = fs.existsSync(B03_DB);
  reqs = [];
  await b.evalJs(setVal("#password", ""));
  await b.evalJs(setVal("#confirmPassword", ""));
  await b.evalJs(`document.querySelector('#submitOpen').click()`);
  await sleep(600);
  const hint2 = (await lockPageState(b)).hint;
  const openReqs2 = reqs.filter((u) => u.includes("/api/open"));
  const b03ok = /不一致|为空/.test(hint1) && openReqs1.length === 0 && !fileAfterMismatch &&
    (/不一致|为空|不能为空/.test(hint2)) && openReqs2.length === 0 && !fs.existsSync(B03_DB);
  rec.rec({
    id: "B-03", status: b03ok ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ hint1, openRequestsMismatch: openReqs1.length, fileAfterMismatch, hint2, openRequestsEmpty: openReqs2.length, fileAfterEmpty: fs.existsSync(B03_DB) }),
    workspace: "-", notes: b03ok ? "两次客户端校验均拒绝，未发出 /api/open，未产生残留库" : "客户端校验未按预期阻止提交",
  });

  /* ---------- B-02 创建新库 ---------- */
  if (fs.existsSync(DB)) fs.unlinkSync(DB);
  const stCreate2 = await lockPageState(b);
  await b.evalJs(setVal("#dbPath", DB));
  await b.evalJs(setVal("#password", B02_PWD));
  await b.evalJs(setVal("#confirmPassword", B02_PWD));
  await b.evalJs(`document.querySelector('#submitOpen').click()`);
  let b02ok = false, b02actual = {};
  try {
    await waitApp(b);
    const h = await homeSummary(b);
    const st = await status();
    const exists = fs.existsSync(DB);
    b02actual = { home: h, unlocked: st.unlocked, fileExists: exists, size: exists ? fs.statSync(DB).size : 0, createMode: stCreate2.confirmHidden === false };
    b02ok = st.unlocked && exists && /个人工作台/.test(h.text) && h.ws.includes("个人");
    fs.writeFileSync(path.join(TMP, "vault-b02.cred.json"), JSON.stringify({ db: DB, password: B02_PWD }, null, 2));
  } catch (e) {
    b02actual = { error: e.message, state: await lockPageState(b).catch(() => null) };
  }
  rec.rec({
    id: "B-02", status: b02ok ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(b02actual), workspace: "personal", recordIds: ["b02:" + DB],
    notes: b02ok ? "UI 创建加密库成功，默认进入个人工作区" : "创建库后未进入预期工作区",
    evidence: ["evidence/b-create.png"],
  });
  await b.shot(path.join(EVID, "b-create.png"));

  /* ---------- B-04 已有库路径再次创建 ---------- */
  await lockCurrent(B02_PWD);
  await b.goto(BASE + "/");
  await sleep(700);
  await b.evalJs(`document.querySelector('#switchLockMode').click()`);
  await sleep(250);
  const sizeBefore = fs.statSync(CRED.db).size;
  const mtimeBefore = fs.statSync(CRED.db).mtimeMs;
  await b.evalJs(setVal("#dbPath", CRED.db));
  await b.evalJs(setVal("#password", "Other-pass-1"));
  await b.evalJs(setVal("#confirmPassword", "Other-pass-1"));
  await b.evalJs(`document.querySelector('#submitOpen').click()`);
  await sleep(900);
  const st4 = await lockPageState(b);
  const sizeAfter = fs.statSync(CRED.db).size;
  const mtimeAfter = fs.statSync(CRED.db).mtimeMs;
  // 切回打开模式，用正确口令打开，证明原库仍可用
  await b.evalJs(`document.querySelector('#switchLockMode').click()`);
  await sleep(250);
  await openPwd(b, CRED.db, CRED.password);
  let b04reopen = false, b04counts = null;
  try {
    await waitApp(b);
    await L.post("/api/resume", { password: CRED.password }).then((r) => { if (r.ok) L.setToken(r.data.token); });
    b04counts = await counts("company");
    b04reopen = true;
  } catch (e) { b04counts = { error: e.message }; }
  const b04ok = /已存在|不会覆盖/.test(st4.hint) && sizeBefore === sizeAfter && mtimeBefore === mtimeAfter && b04reopen && b04counts.projects >= 2;
  rec.rec({
    id: "B-04", status: b04ok ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ hint: st4.hint, sizeBefore, sizeAfter, mtimeSame: mtimeBefore === mtimeAfter, reopened: b04reopen, counts: b04counts }),
    workspace: "company", recordIds: ["p2b:projects=12,13"], notes: b04ok ? "服务端拒绝覆盖，原库字节与修改时间未变，重新打开数据完整" : "覆盖保护或原库可用性不成立",
  });

  /* ---------- B-05 错误密码再正确密码 ---------- */
  await lockCurrent(CRED.password);
  await b.goto(BASE + "/");
  await sleep(700);
  await openPwd(b, CRED.db, "definitely-wrong");
  const st5wrong = await lockPageState(b);
  const s5 = await status();
  await b.evalJs(setVal("#password", CRED.password));
  await b.evalJs(`document.querySelector('#submitOpen').click()`);
  let b05ok = false, b05home = null;
  try { await waitApp(b); b05home = await homeSummary(b); b05ok = /密码错误|打开失败/.test(st5wrong.hint) && s5.unlocked === false && b05home.ws.includes("个人"); }
  catch (e) { b05home = { error: e.message }; }
  rec.rec({
    id: "B-05", status: b05ok ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ wrongHint: st5wrong.hint, unlockedAfterWrong: s5.unlocked, home: b05home }),
    workspace: "personal", notes: b05ok ? "错误密码不解锁，正确密码正常打开" : "错误密码或重试流程异常",
  });

  /* ---------- B-06 服务端已解锁但令牌丢失 ---------- */
  await lockCurrent(CRED.password);
  await b.goto(BASE + "/");
  await sleep(500);
  await openPwd(b, CRED.db, CRED.password);
  await waitApp(b);
  const b2 = await launch({ profileDir: path.join(ROOT, "profiles", "b2-" + Date.now()) });
  await b2.send("Network.enable");
  let reqs2 = [];
  b2.on((m) => { if (m.method === "Network.requestWillBeSent") reqs2.push(m.params.request.url); });
  await b2.goto(BASE + "/");
  await sleep(700);
  const st6 = await lockPageState(b2);
  reqs2 = [];
  const otherDb = path.join(TMP, "vault-b02.db");
  await b2.evalJs(setVal("#dbPath", otherDb));
  await b2.evalJs(setVal("#password", CRED.password));
  await b2.evalJs(`document.querySelector('#submitOpen').click()`);
  await sleep(1200);
  const st6after = await lockPageState(b2);
  const req6 = reqs2.filter((u) => /\/api\/(open|resume)/.test(u));
  const s6 = await status();
  const b06ok = st6.heading === "重新连接资料库" && st6.submit === "重新连接" && st6.switchHidden && st6.confirmHidden && s6.unlocked === true && req6.every((u) => u.includes("/api/resume"));
  rec.rec({
    id: "B-06", status: b06ok ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ before: st6, pathAfterEdit: st6after.pathRO, hintAfter: st6after.hint, apiCalls: req6, stillUnlocked: s6.unlocked }),
    workspace: "-", notes: b06ok ? "令牌丢失后进入重新连接模式，路径不可改库，只走 /api/resume" : "重连模式未按预期限制路径或请求",
    evidence: ["evidence/probe-lock.png"],
  });
  await b2.close();

  /* ---------- B-08 非法路径 ---------- */
  await lockCurrent(CRED.password);
  await b.goto(BASE + "/");
  await sleep(600);
  await b.evalJs(`document.querySelector('#switchLockMode').click()`);
  await sleep(250);
  const missing = path.join(TMP, "no-such-dir", "x.db");
  await b.evalJs(setVal("#dbPath", missing));
  await b.evalJs(setVal("#password", "Aa123456"));
  await b.evalJs(setVal("#confirmPassword", "Aa123456"));
  await b.evalJs(`document.querySelector('#submitOpen').click()`);
  await sleep(700);
  const hintMissing = (await lockPageState(b)).hint;
  const relPath = "relative-vault.db";
  await b.evalJs(setVal("#dbPath", relPath));
  await b.evalJs(setVal("#password", "Aa123456"));
  await b.evalJs(setVal("#confirmPassword", "Aa123456"));
  await b.evalJs(`document.querySelector('#submitOpen').click()`);
  await sleep(700);
  const hintRel = (await lockPageState(b)).hint;
  const b08ok = /文件夹不存在|不存在/.test(hintMissing) && /绝对路径/.test(hintRel) && !fs.existsSync(missing) && !fs.existsSync(path.join(process.cwd(), relPath));
  rec.rec({
    id: "B-08", status: b08ok ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ hintMissing, hintRel, missingFile: fs.existsSync(missing) }),
    workspace: "-", notes: (b08ok ? "缺失目录与相对路径均明确拒绝，未产生半成品库" : "非法路径提示或残留库不符合要求") + "；只读目录子场景未构造，见 notes",
  });

  /* ---------- B-09 工作区反复切换 ---------- */
  await openPwd(b, CRED.db, CRED.password);
  await waitApp(b);
  const hPersonal = await homeSummary(b);
  await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`);
  await sleep(300);
  await b.evalJs(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`);
  await sleep(1500);
  const hCompany = await homeSummary(b);
  await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`);
  await sleep(300);
  await b.evalJs(`document.querySelector('#ctxMenu [data-act="ws:personal"]').click()`);
  await sleep(1500);
  const hBack = await homeSummary(b);
  const b09ok = hPersonal.ws.includes("个人") && hCompany.ws.includes("企业") && hBack.ws.includes("个人") &&
    /P2个人档案/.test(hPersonal.text) && !/P2个人档案/.test(hCompany.text) && /项目A|P2档案/.test(hCompany.text) === false ? true : true;
  const b09strict = hPersonal.ws.includes("个人") && hCompany.ws.includes("企业") && hBack.ws.includes("个人") &&
    hPersonal.cats.length === 6 && hCompany.cats.length === 5 && !/P2个人项目P/.test(hCompany.text) && !/P2项目A/.test(hBack.text);
  rec.rec({
    id: "B-09", status: b09strict ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ personal: hPersonal, company: hCompany, back: hBack }),
    workspace: "company;personal", notes: b09strict ? "两工作区分类数与记录严格隔离，来回切换无残留" : "工作区切换出现分类数或记录串写",
    evidence: ["evidence/probe-ws-menu.png"],
  });

  /* ---------- B-10 默认启动工作区 ---------- */
  await b.evalJs(`document.querySelector('#btnSettings').click()`);
  await sleep(400);
  await b.evalJs(`document.querySelector('[data-seg="startWs"] [data-v="company"]').click()`);
  await sleep(200);
  await b.evalJs(`document.querySelector('#settingsDone').click()`);
  await sleep(300);
  const pref1 = await b.evalJs(`localStorage.getItem('ipsys.startWs')`);
  await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`);
  await sleep(250);
  await b.evalJs(`document.querySelector('#ctxMenu [data-act="ws:personal"]').click()`);
  await sleep(1200);
  const pref2 = await b.evalJs(`localStorage.getItem('ipsys.startWs')`);
  await lockCurrent(CRED.password);
  await b.goto(BASE + "/");
  await sleep(600);
  await openPwd(b, CRED.db, CRED.password);
  let b10home = null;
  try { await waitApp(b); b10home = await homeSummary(b); } catch (e) { b10home = { error: e.message }; }
  const b10ok = pref1 === "company" && pref2 === "company" && b10home.ws.includes("企业");
  rec.rec({
    id: "B-10", status: b10ok ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ prefAfterSettings: pref1, prefAfterTopbarSwitch: pref2, reloginHome: b10home }),
    workspace: "company", notes: b10ok ? "设置值持久化，顶栏临时切换不改写，重新登录按设置进入企业工作区" : "默认工作区或顶栏切换语义不符",
  });
  // 恢复默认个人，避免影响后续用例
  await b.evalJs(`document.querySelector('#btnSettings').click()`);
  await sleep(300);
  await b.evalJs(`document.querySelector('[data-seg="startWs"] [data-v="personal"]').click(); document.querySelector('#settingsDone').click()`);
  await sleep(400);

  rec.flush();
  log.flush();
  await b.shot(path.join(EVID, "b-final.png"));
  await b.close();
  process.exit(0);
})().catch((e) => {
  console.error(e.stack || e);
  rec.flush();
  process.exit(1);
});
