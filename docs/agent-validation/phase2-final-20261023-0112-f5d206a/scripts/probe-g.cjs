/* 探针：G 组所需的 DOM 事实（行 id、搜索视图混合行、确认框、ctx 菜单） */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");

const BASE = process.env.IPSYS_BASE;
const ROOT = path.resolve(__dirname, "..");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const b = await launch({ profileDir: path.join(ROOT, "profiles", "probe-g-" + Date.now()) });
  try {
    await b.goto(BASE + "/");
    await sleep(600);
    const st = await b.evalJs(`({heading:(document.querySelector('#lockHeading')||{}).textContent||'',confirmHidden:!!(document.querySelector('#createConfirmField')||{}).hidden})`);
    if (!st.confirmHidden) { await b.evalJs(`document.querySelector('#switchLockMode').click()`); await sleep(300); }
    await b.evalJs(setVal("#dbPath", CRED.db));
    await b.evalJs(setVal("#password", CRED.password));
    await b.evalJs(`document.querySelector('#submitOpen').click()`);
    await sleep(1600);
    await b.waitFor(`!!document.querySelector('.catgrid')`, 20000, "工作台");

    console.log("ws:", await b.evalJs(`(document.querySelector('#wsSwitchBtn')||{}).textContent`));

    /* 切企业 + 打开知识产权分类 */
    if (!String(await b.evalJs(`(document.querySelector('#wsSwitchBtn')||{}).textContent||''`)).includes("企业")) {
      await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`);
      await sleep(300);
      await b.evalJs(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`);
      await sleep(1800);
    }
    await b.evalJs(`Drive.openFolder('k:ip')`);
    await sleep(1200);
    console.log("k:ip rows:", await b.evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>({id:r.dataset.id,t:(r.querySelector('.row-title')||{}).textContent}))`));

    /* 进第一条记录看附件行 */
    const first = await b.evalJs(`(document.querySelector('#viewRoot .row')||{}).dataset?.id||''`);
    console.log("first record:", first);
    await b.evalJs(`Drive.openFolder(${JSON.stringify(first)})`);
    await sleep(1200);
    console.log("inside rows:", await b.evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>({id:r.dataset.id,t:(r.querySelector('.row-title')||{}).textContent,acts:[...r.querySelectorAll('[data-row-act]')].map(x=>x.dataset.rowAct)}))`));
    console.log("meta:", await b.evalJs(`(()=>{const id=${JSON.stringify(first)};const n=Drive.findNode?Drive.findNode(id):null;return {hasFindNode:!!Drive.findNode, meta:(window.VaultStore&&VaultStore.metaOf)?VaultStore.metaOf(id):null};})()`).catch((e) => "ERR " + e.message));

    /* 搜索视图：附件 + 记录是否同屏 */
    await b.evalJs(`(() => { const i=document.querySelector('#searchInput'); i.value='P2'; i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await sleep(1600);
    console.log("search view:", await b.evalJs(`({view:Drive.state.view, q:Drive.state.query, rows:[...document.querySelectorAll('#viewRoot .row')].slice(0,12).map(r=>({id:r.dataset.id,t:(r.querySelector('.row-title')||{}).textContent}))})`));
    console.log("df types test:", await b.evalJs(`(()=>{const d=new DataTransfer();d.setData('application/x-ipsys-link','f:1');d.items.add(new File(['x'],'probe.txt',{type:'text/plain'}));return {types:[...d.types],files:d.files.length};})()`));

    await b.shot(path.join(ROOT, "evidence", "shots", "probe-g.png"));
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
