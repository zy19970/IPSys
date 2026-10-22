"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const BASE = process.env.IPSYS_BASE;
const CRED = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await launch({ profileDir: path.join(__dirname, "..", "profiles", "ws-" + Date.now()) });
  await b.goto(BASE + "/");
  await sleep2(400);
  if (await b.evalJs(`!!document.querySelector('#password')`)) {
    await b.evalJs(`(() => { const p=document.querySelector('#password'); p.value=${JSON.stringify(CRED.password)}; p.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#submitOpen').click(); return 1; })()`);
    await sleep2(2000);
  }
  await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`);
  await sleep2(400);
  const menu = await b.evalJs(`({
    text: (document.querySelector('.menu')||document.querySelector('#ctxMenu')||{}).innerText,
    html: (document.querySelector('.menu')||document.querySelector('#ctxMenu')||{}).outerHTML?.slice(0,600)
  })`);
  console.log("WS MENU", JSON.stringify(menu, null, 1));
  await b.shot(path.join(__dirname, "..", "evidence", "probe-ws-menu.png"));
  await b.evalJs(`document.body.click()`);
  await sleep2(200);
  await b.evalJs(`document.querySelector('#btnSettings').click()`);
  await sleep2(400);
  const st = await b.evalJs(`({
    visible: !document.querySelector('#settingsMask').hidden,
    startWs: [...document.querySelectorAll('[data-seg="startWs"] [data-v], [data-seg="startWs"] button')].map(x=>({v:x.getAttribute('data-v'),t:x.textContent.trim(),on:x.classList.contains('is-on')||x.getAttribute('aria-selected')})),
    lockBtn: !!document.querySelector('#setLock'),
    done: !!document.querySelector('#settingsDone'),
    pref: localStorage.getItem('ipsys.startWs'),
  })`);
  console.log("SETTINGS", JSON.stringify(st, null, 1));
  await b.shot(path.join(__dirname, "..", "evidence", "probe-settings.png"));
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
