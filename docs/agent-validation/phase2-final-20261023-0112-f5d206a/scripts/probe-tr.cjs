/* 探针：回收站视图的行与 RECYCLE 数据是否包含刚删的合同 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");

const BASE = process.env.IPSYS_BASE;
const ROOT = path.resolve(__dirname, "..");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
const TAG = "T" + Date.now().toString(36);

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const pj = (await L.post("/api/v2/folders/company/project", { Project: { Name: `PRJTR-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `TR-${TAG}` } })).data.id;
  const ids = [];
  for (const k of ["A", "B", "C"]) {
    const c = (await L.post("/api/v2/folders/company/contract", { Contract: { Name: `PRJTR-合同${k}-${TAG}`, ContractNo: `TR${k}-${TAG}` }, ProjectId: pj })).data;
    ids.push(c.id);
    await L.del(`/api/v2/folders/company/contract/${c.id}`);
  }
  console.log("created+deleted", pj, ids);

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "probe-tr-" + Date.now()) });
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
    await b.evalJs(`document.querySelector('[data-nav="recycle"]').click()`);
    await sleep(1500);
    console.log("view:", await b.evalJs(`Drive.state.view`));
    console.log("rows:", await b.evalJs(`[...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')].map(r=>({id:r.dataset.id,t:(r.querySelector('.row-title')||{}).textContent})).slice(0,8)`));
    console.log("match TAG:", await b.evalJs(`[...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')].filter(r=>((r.querySelector('.row-title')||{}).textContent||'').includes('${TAG}')).map(r=>r.dataset.id)`));
    console.log("all ids:", await b.evalJs(`[...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')].map(r=>r.dataset.id)`));
    console.log("count:", await b.evalJs(`document.querySelectorAll('#viewRoot .row, #viewRoot .tile').length`));
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
