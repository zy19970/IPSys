/* 探针：确认项目节点 id 与 openFolder 行为 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");

const BASE = process.env.IPSYS_BASE;
const ROOT = path.resolve(__dirname, "..");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
const TXT = (s) => Buffer.from(s, "utf8");
const TAG = "P" + Date.now().toString(36);

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const pj = (await L.post("/api/v2/folders/company/project", { Project: { Name: `P2PR-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `PR-${TAG}` } })).data.id;
  const c1 = (await L.post("/api/v2/folders/company/contract", { Contract: { Name: `P2PR-合同-${TAG}`, ContractNo: `PR-${TAG}` }, ProjectId: pj })).data.id;
  const up = await L.upload(pj, `P2PR-附件-${TAG}.txt`, TXT("probe"));
  const ls = (await L.get(`/api/v2/files/company/folders/${pj}/links?includeDeleted=false`)).data;
  console.log("ids", { pj, c1, fileId: up.fileId, links: ls.length, linkId: ls[0] && ls[0].id });

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "probe-p-" + Date.now()) });
  try {
    await b.goto(BASE + "/");
    await sleep(600);
    const st = await b.evalJs(`({confirmHidden:!!(document.querySelector('#createConfirmField')||{}).hidden})`);
    if (!st.confirmHidden) { await b.evalJs(`document.querySelector('#switchLockMode').click()`); await sleep(300); }
    await b.evalJs(setVal("#dbPath", CRED.db));
    await b.evalJs(setVal("#password", CRED.password));
    await b.evalJs(`document.querySelector('#submitOpen').click()`);
    await sleep(1800);
    await b.waitFor(`!!document.querySelector('.catgrid')`, 20000, "工作台");
    if (!String(await b.evalJs(`(document.querySelector('#wsSwitchBtn')||{}).textContent||''`)).includes("企业")) {
      await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      await b.evalJs(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`); await sleep(1800);
    }
    console.log("open k:project ->", await b.evalJs(`(() => { try { Drive.openFolder('k:project'); return 'ok'; } catch(e) { return 'ERR '+e.message; } })()`));
    await sleep(1200);
    console.log("rows:", await b.evalJs(`[...document.querySelectorAll('#viewRoot .row')].slice(0,6).map(r=>r.dataset.id)`));
    console.log("open p: ->", await b.evalJs(`(() => { try { Drive.openFolder('p:${pj}'); return 'ok'; } catch(e) { return 'ERR '+e.message; } })()`));
    await sleep(1500);
    console.log("state:", await b.evalJs(`({folderId:Drive.state.folderId, view:Drive.state.view, rows:[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)})`));
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
