"use strict";
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const BASE = process.env.IPSYS_BASE;

(async () => {
  const b = await launch({ profileDir: path.join(__dirname, "..", "profiles", "probe-" + Date.now()) });
  await b.goto(BASE + "/");
  await sleep(800);
  const state = await b.evalJs(`({
    heading: (document.querySelector('#lockHeading')||{}).textContent,
    submit: (document.querySelector('#submitOpen')||{}).textContent,
    switchText: (document.querySelector('#switchLockMode')||{}).textContent,
    switchHidden: (document.querySelector('#switchLockMode')||{}).hidden,
    confirmHidden: (document.querySelector('#createConfirmField')||{}).hidden,
    path: (document.querySelector('#dbPath')||{}).value,
    hint: (document.querySelector('#lockHint')||{}).textContent,
    bodyClass: document.body.className,
  })`);
  console.log(JSON.stringify(state, null, 1));
  await b.shot(path.join(__dirname, "..", "evidence", "probe-lock.png"));
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
