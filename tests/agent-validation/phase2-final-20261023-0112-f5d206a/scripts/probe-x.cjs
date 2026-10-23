/* 探针：混合选择打包导出与详情面板下载 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");

const BASE = process.env.IPSYS_BASE;
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const DL = path.join(EVID, "downloads");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const projects = (await L.get("/api/v2/folders/company/project")).data;
  const pj = (Array.isArray(projects) ? projects : []).map((x) => x.folder).filter((f) => /P2H-项目/.test(f.name)).pop();
  console.log("project:", pj && pj.ref.id, pj && pj.name);

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "probe-x-" + Date.now()) });
  try {
    fs.mkdirSync(DL, { recursive: true });
    await b.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});
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
    await b.evalJs(`Drive.openFolder('k:project')`); await sleep(700);
    await b.evalJs(`Drive.openFolder('p:${pj.ref.id}')`); await sleep(1200);
    console.log("rows:", await b.evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`));
    console.log("export api:", await b.evalJs(`({has:!!globalThis.IPSysExport, keys: globalThis.IPSysExport?Object.keys(globalThis.IPSysExport):[], active: globalThis.IPSysExport?globalThis.IPSysExport.isActive():null})`));

    /* 选中合同 + 附件 */
    await b.evalJs(`(() => {
      const rows=[...document.querySelectorAll('#viewRoot .row')];
      const c=rows.find(r=>r.dataset.id.startsWith('c:'));
      const f=rows.find(r=>r.dataset.id.startsWith('f:'));
      c.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      f.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));
      return {c:c.dataset.id,f:f.dataset.id};
    })()`);
    await sleep(400);
    console.log("sel:", await b.evalJs(`[...Drive.state.selection]`));
    await b.evalJs(`document.querySelector('#selDownload').click()`);
    for (const ms of [500, 1200, 2500]) {
      await sleep(ms);
      console.log("t+" + ms, JSON.stringify(await b.evalJs(`({toasts:window.__toasts?window.__toasts():[...document.querySelectorAll('#toasts .toast')].map(x=>x.innerText.trim()), panels:[...document.querySelectorAll('.upload-progress,#exportProgress')].map(x=>({id:x.id,txt:(x.innerText||'').slice(0,160)}))})`)).slice(0, 600));
    }
    console.log("files:", fs.readdirSync(DL));

    /* 详情面板 */
    await b.evalJs(`(() => { const t=document.querySelector('#btnDetailToggle'); if(t) t.click(); })()`); await sleep(600);
    console.log("detail:", await b.evalJs(`({open:document.querySelector('#detail').classList.contains('open'), acts:[...document.querySelectorAll('#detailBody [data-detail-act]')].map(x=>x.dataset.detailAct)})`));
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
