"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const BASE = process.env.IPSYS_BASE;
const CRED = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

(async () => {
  const b = await launch({ profileDir: path.join(__dirname, "..", "profiles", "home-" + Date.now()) });
  await b.goto(BASE + "/");
  await sleep(600);
  const mode = await b.evalJs(`({heading:(document.querySelector('#lockHeading')||{}).textContent, ro:(document.querySelector('#dbPath')||{}).readOnly})`);
  console.log("lock mode", JSON.stringify(mode));
  await b.evalJs(`(() => { const p=document.querySelector('#password'); p.value=${JSON.stringify(CRED.password)}; p.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#submitOpen').click(); return 1; })()`);
  await b.waitFor(`!document.querySelector('#lockScreen') || document.querySelector('#lockScreen').hidden || !!document.querySelector('#content .row, #content .catcard, #homeGrid, .catgrid')`, 20000, "登录完成");
  await sleep(1200);
  const info = await b.evalJs(`({
    hash: location.hash,
    bodyClass: document.body.className,
    wsBtn: (document.querySelector('#wsSwitchBtn')||{}).textContent,
    crumbs: [...document.querySelectorAll('#crumbs *, .crumb')].map(x=>x.textContent.trim()).filter(Boolean).slice(0,10),
    catCards: [...document.querySelectorAll('.catcard .cat-name, .catcard .name')].map(x=>x.textContent.trim()).slice(0,12),
    homeText: (document.querySelector('#content')||{}).innerText?.slice(0,500),
    lockHidden: (document.querySelector('#lockScreen')||{}).hidden,
    ids: ['#viewRoot','#listHead','#content','#homeGrid','.catgrid','#wsSwitchBtn','#btnPinFolder','#settingsMask'].map(s=>s+'='+!!document.querySelector(s)).join(' '),
  })`);
  console.log(JSON.stringify(info, null, 1));
  await b.shot(path.join(__dirname, "..", "evidence", "probe-home.png"));
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
