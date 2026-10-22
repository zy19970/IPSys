/* 探针：外部文件 drop 后上传为何没有落库 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");

const BASE = process.env.IPSYS_BASE;
const ROOT = path.resolve(__dirname, "..");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
const TAG = "U" + Date.now().toString(36);

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const pj = (await L.post("/api/v2/folders/company/project", { Project: { Name: `PRJU-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `U-${TAG}` } })).data.id;
  const c1 = (await L.post("/api/v2/folders/company/contract", { Contract: { Name: `PRJU-合同-${TAG}`, ContractNo: `U-${TAG}` }, ProjectId: pj })).data.id;

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "probe-u-" + Date.now()) });
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
    await b.evalJs(`VaultStore.loadAll(VaultStore.ws)`);
    await sleep(800);
    await b.evalJs(`Drive.openFolder('k:project')`); await sleep(800);
    await b.evalJs(`Drive.openFolder('p:${pj}')`); await sleep(1000);
    console.log("rows:", await b.evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`));

    const r = await b.evalJs(`(() => {
      const dst = document.querySelector('#viewRoot [data-id="c:${c1}"]');
      if (!dst) return { err: 'no row' };
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([65,66,67,10])], 'PRJU-drop-${TAG}.txt', { type: 'text/plain' }));
      const mk = (t) => { const e = new Event(t, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dt }); return e; };
      dst.dispatchEvent(mk('dragover'));
      const d = mk('drop');
      dst.dispatchEvent(d);
      return { prevented: d.defaultPrevented, files: dt.files.length, fname: dt.files[0] && dt.files[0].name, fsize: dt.files[0] && dt.files[0].size };
    })()`);
    console.log("drop:", r);
    for (const ms of [400, 900, 1800, 3000]) {
      await sleep(ms);
      const st2 = await b.evalJs(`({
        toasts: [...document.querySelectorAll('#toasts .toast')].map(x=>x.innerText.trim()),
        panels: [...document.querySelectorAll('[class*=upload],[id*=upload]')].map(x=>({id:x.id,cls:x.className,txt:(x.innerText||'').slice(0,600)})).slice(0,4),
        rows: [...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)
      })`);
      console.log("t+" + ms, JSON.stringify(st2).slice(0, 700));
    }
    console.log("api links:", (await L.get(`/api/v2/files/company/folders/${c1}/links?includeDeleted=false`)).data.length);
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
