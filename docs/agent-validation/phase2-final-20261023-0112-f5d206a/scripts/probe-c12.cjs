"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const BASE = process.env.IPSYS_BASE;
const CRED = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vault-p2-p2b.cred.json"), "utf8"));
const s = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await launch({ profileDir: path.join(__dirname, "..", "profiles", "c12-" + Date.now()) });
  await b.goto(BASE + "/");
  await s(400);
  await b.evalJs(`(() => { const e=document.querySelector('#dbPath'); if(e){e.value=${JSON.stringify(CRED.db)};e.dispatchEvent(new Event('input',{bubbles:true}));const p=document.querySelector('#password');p.value=${JSON.stringify(CRED.password)};p.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#submitOpen').click();} return 1; })()`);
  await b.waitFor(`!!document.querySelector('.catgrid')`, 20000, "app");
  await s(800);
  console.log("ws", await b.evalJs(`document.querySelector('#wsSwitchBtn').textContent.trim()`));
  await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`); await s(250);
  await b.evalJs(`document.querySelector('#ctxMenu [data-act="ws:company"]')?.click()`); await s(1500);
  console.log("ws2", await b.evalJs(`document.querySelector('#wsSwitchBtn').textContent.trim()`));
  await b.evalJs(`Drive.openFolder('k:project')`); await s(1200);
  const info = await b.evalJs(`({
    ws: Drive.state.ws, folderId: Drive.state.folderId, view: Drive.state.view, keyword: Drive.state.keyword,
    crumbs: [...document.querySelectorAll('#crumbs *')].map(x=>x.textContent.trim()).filter(Boolean),
    rows: [...document.querySelectorAll('.row')].map(r=>({id:r.getAttribute('data-id'),t:(r.querySelector('.row-title')||{}).textContent})),
    nav: [...document.querySelectorAll('.nav-btn')].map(x=>({t:x.textContent.trim(),on:x.classList.contains('is-active')})),
  })`);
  console.log(JSON.stringify(info, null, 1).slice(0, 2500));
  await b.shot(path.join(__dirname, "..", "evidence", "probe-c12.png"));
  await b.close(); process.exit(0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
