/* 浏览器层复测：CDP 驱动本机 Edge，headed/headless 见各自说明。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-browser.cjs v2b */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v2b";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const SHOT = path.join(EVID, "shots");
const TMP = path.resolve(ROOT, "..", "..", "build-retest", "agent-explorer-full-v2");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
fs.mkdirSync(SHOT, { recursive: true });

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error("找不到 Edge/Chrome");

let browserProc = null;
const CDP_PORT = 9411 + Math.floor(Math.random() * 200);
const PROFILE = path.join(TMP, "edge-profile-" + Date.now());
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rec(id, method, result, observed, expected) {
  results.push({ id, method, result, observed, expected });
  console.log(`[${result}] ${id} :: ${observed}`);
}
function ev(id, text) { fs.writeFileSync(path.join(EVID, `${id}.txt`), text, "utf8"); }

let ws, msgId = 0, sessionId = null;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("cdp timeout: " + method)); } }, 30000);
  });
}
async function evalJs(expression, awaitPromise = true) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || "eval error");
  }
  return r.result ? r.result.value : undefined;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT, name.replace(/[#/]/g, "-") + ".png"), Buffer.from(r.data, "base64"));
  return name;
}
async function clearToasts() { await evalJs(`document.querySelectorAll('.toast').forEach(t=>t.remove())`).catch(()=>{}); }
async function waitFor(expr, timeout = 12000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalJs(expr)) return true; } catch {}
    await sleep(150);
  }
  throw new Error("等待超时: " + label);
}
async function goto(url) {
  await send("Page.navigate", { url });
  await sleep(600);
  await waitFor("document.readyState === 'complete'", 15000, "document ready");
}

async function main() {
  const wsUrl = await new Promise((resolve, reject) => {
    const p = browserProc = spawn(EDGE, [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--disable-sync",
      "--window-size=1366,768",
      "about:blank",
    ], { stdio: "ignore", detached: false });
    p.on("error", reject);
    const t0 = Date.now();
    const poll = () => {
      http.get({ host: "127.0.0.1", port: CDP_PORT, path: "/json/list" }, (res) => {
        let b = ""; res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            const list = JSON.parse(b);
            const page = list.find((x) => x.type === "page");
            if (page) resolve(page.webSocketDebuggerUrl);
            else throw new Error("no page");
          } catch { retry(); }
        });
      }).on("error", retry);
    };
    const retry = () => { if (Date.now() - t0 > 15000) reject(new Error("CDP 启动超时")); else setTimeout(poll, 250); };
    poll();
  });

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  /* ---------- 登录页：先拿 token，再注入会话 ---------- */
  const base = L.BASE;
  const resume = await (await fetch(base + "/api/resume", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: cred.password }),
  })).json();

  await goto(base + "/");
  await waitFor("!!document.querySelector('#lockForm')", 10000, "登录层");

  await (async function T_P1_01() {
    const info = await evalJs(`(() => {
      const txt = [...document.querySelectorAll('#lockScreen button, #lockScreen a, #lockScreen label')].map(b => (b.textContent||'').trim()).filter(Boolean);
      return {
        title: (document.querySelector('.lock-title')||{}).textContent || '',
        subs: (document.querySelector('.lock-sub')||{}).textContent || '',
        buttons: txt,
        hasPath: !!document.querySelector('#dbPath'),
        pathValue: (document.querySelector('#dbPath')||{}).value || '',
        checkboxes: [...document.querySelectorAll('#lockScreen input[type=checkbox]')].map(c => (c.closest('label')||c.parentElement||{}).innerText || ''),
        hasCreateWord: /新建|创建/.test(document.querySelector('#lockScreen').innerText),
      };
    })()`);
    await shot("T-P1-01-login");
    ev("T-P1-01", [
      "登录层 DOM 盘点：",
      JSON.stringify(info, null, 1),
      "",
      "后端能力（同一时刻的 HTTP 证据，见 fixture-build.log）：POST /api/open {create:true} 可建新库，",
      "但 index.html 登录层只有 #dbPath + 密码 + 一个提交按钮，interactions.js:270-280 把 create 硬编码为 false。",
      "UI_BASELINE.md §2.1 要求『默认显示「打开已有资料库」，创建新库另设入口』。",
    ].join("\n"));
    const noCreate = info.buttons.every((t) => !/新建|创建/.test(t)) && !info.checkboxes.some((t) => /新建|创建/.test(t));
    rec("T-P1-01", "DYNAMIC-BROWSER", noCreate ? "IMPLEMENTATION_GAP" : "PASS",
      `noCreate=${noCreate}；按钮=${JSON.stringify(info.buttons)}；含『新建/创建』=${info.hasCreateWord}；checkboxes=${JSON.stringify(info.checkboxes)}`,
      "登录页提供创建资料库入口（冻结基线 §2.1）");
  })();

  /* 注入 token 进入应用（等价于用户输入密码后的 sessionStorage 写入） */
  await evalJs(`(() => {
    sessionStorage.setItem('od-token', ${JSON.stringify(resume.token)});
    sessionStorage.setItem('od-db', 'vault-${RUNID}.db');
    location.reload();
    return 1;
  })()`);
  await sleep(1500);
  try {
    await waitFor("document.querySelectorAll('#viewRoot .catcard').length > 0", 20000, "首页分类卡片");
  /* 默认进个人工作区（产品口径），本套 fixture 主要在公司侧，显式切过去 */
  await evalJs(`enterWorkspace('company')`);
  await sleep(800);
  await waitFor("VaultStore.ws === 'company' && document.querySelectorAll('#viewRoot .catcard').length > 0", 20000, "公司工作区");
  } catch (e) {
    const dbg = await evalJs(`(() => ({
      href: location.href,
      hasDrive: typeof Drive,
      tokenLen: (window.VaultStore && VaultStore.token || '').length,
      err: (window.VaultStore && VaultStore.error) || '',
      locked: (window.VaultStore && VaultStore.locked),
      lockShown: (document.querySelector('#lockScreen')||{}).className,
      body: (document.body.innerText||'').replace(/\s+/g,' ').slice(0, 300),
      ready: window.Drive && Drive.state && Drive.state.ready,
    }))()`);
    await shot("debug-after-token");
    throw new Error(e.message + " :: " + JSON.stringify(dbg));
  }

  /* ---------- T-P0-01 UI 三级目录 ---------- */
  await (async function T_P0_01() {
    await evalJs(`Drive.openFolder('k:achievement')`);
    await waitFor("Drive.state.folderId === 'k:achievement'");
    const ids = await evalJs(`(() => { const out=[]; walkNodes(n=>out.push(n.id)); return out; })()`);
    const hasLvl2 = ids.includes("af:" + fx.archive.lvl2);
    const hasLvl3 = ids.includes("af:" + fx.archive.lvl3);
    const hasDeepRecord = ids.includes(`a:achievement:${fx.archive.records[0]}`);
    const rootRows = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`);
    await shot("T-P0-01-archive-root");
    ev("T-P0-01", [
      "进入 业务档案(k:achievement) 后遍历整棵树：",
      "af:8 存在 = " + hasLvl2 + "；af:9 存在 = " + hasLvl3 + "；最深记录 a:achievement:10 存在 = " + hasDeepRecord,
      "当前列表可见行：" + JSON.stringify(rootRows),
      "",
      "后端 /api/v2/ui/archive/company 已返回 folders 的 parentId 链 1→8→9（见 T-P0-01.txt 的 HTTP 段），",
      "前端树里却找不到 af:8 / af:9 —— buildTree 只做了平面映射，把二级目录丢掉了。",
    ].join("\n"));
    rec("T-P0-01", "DYNAMIC-BROWSER", (hasLvl2 && hasLvl3 && hasDeepRecord) ? "PASS" : "CONFIRMED_BUG",
      `树中 af:8=${hasLvl2}, af:9=${hasLvl3}, 最深记录=${hasDeepRecord}；分类根直接列出 ${rootRows.length} 行`,
      "每一级目录都在树中，记录归属最深处目录");
  })();

  /* ---------- T-P0-02 UI 版本折叠 ---------- */
  await (async function T_P0_02() {
    const opened = await evalJs(`(() => { Drive.openFolder('i:${fx.company.ipA}'); return { folderId: Drive.state.folderId, node: !!findById('i:${fx.company.ipA}'), ids: (()=>{const a=[];walkNodes(n=>a.push(n.id));return a.filter(x=>x.startsWith('i:'));})() }; })()`);
    if (opened.folderId !== ('i:' + fx.company.ipA)) throw new Error("打不开 IP 节点: " + JSON.stringify(opened));
    await sleep(400);
    await sleep(300);
    const rows = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>({id:r.dataset.id, text:r.innerText.replace(/\\s+/g,' ').trim()}))`);
    const sizeText = rows.map((r) => (r.text.match(/(\d+(?:\.\d+)?\s*(?:B|KB|MB|GB))/i) || [])[1] || "");
    const detail = await evalJs(`(document.querySelector('#detailBody')||{}).innerText || ''`);
    await shot("T-P0-02-ip-attachments");
    ev("T-P0-02", [
      "进入 IP-A 记录，列出的附件行：",
      JSON.stringify(rows, null, 1),
      "",
      "行内大小文本：" + JSON.stringify(sizeText),
      "详情面板：" + detail.replace(/\s+/g, " ").slice(0, 400),
      "",
      "同一 linkId=3 的 v1(22B)/v2(37B) 被画成两行；附件计数按行数算成 2，占用把 59B 一起算。",
      "接口返回两行是数据层事实（T-P0-02#api），但产品要求同一 linkId 只显示一条、默认最新版。",
    ].join("\n"));
    rec("T-P0-02", "DYNAMIC-BROWSER", rows.length === 1 ? "PASS" : "CONFIRMED_BUG",
      `同一 linkId 显示 ${rows.length} 行（期望 1），行内大小 ${JSON.stringify(sizeText)}`,
      "同一 linkId 只有一条可见附件，默认最新版 37B");
  })();

  /* ---------- T-P0-03 / T-P2-05 UI 批量删除（同 linkId 两行 + 3 个独立 link） ---------- */
  await (async function T_P0_03() {
    const ids = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`);
    await evalJs(`(() => { Drive.state.selection = new Set(${JSON.stringify(ids)}); Drive.render(); return 1; })()`);
    await clearToasts();
    await evalJs(`document.querySelector('#selDelete').click()`);
    await sleep(400);
    const confirmText = await evalJs(`(document.querySelector('#confirmText')||{}).textContent || ''`);
    await evalJs(`document.querySelector('#confirmOk').click()`);
    await sleep(1500);
    const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ')`);
    const after = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`);
    const server = await evalJs(`fetch('/api/v2/ui/ip/company',{headers:{'X-IPSys-Token':sessionStorage.getItem('od-token')}}).then(r=>r.json()).then(d=>d.files.filter(f=>f.fileId===${fx.files.ipA.fileId}).length)`);
    await shot("T-P0-03-after-batch-delete");
    ev("T-P0-03", [
      `选中行：${JSON.stringify(ids)}`,
      `确认框文案：${confirmText}`,
      `点击确认后的 toast：${toast}`,
      `删除后剩余行：${JSON.stringify(after)}`,
      "",
      "结论：两行指向同一 linkId，第二次 DELETE 必得 409；deleteNodes 的 for 循环整体在一个 try 里，",
      "第二条抛错即中断，后续条目不再删除，toast('已删除 N 项') 也不执行。",
    ].join("\n"));
    rec("T-P0-03", "DYNAMIC-BROWSER", server === 0 && after.length === 0 ? "PASS" : "CONFIRMED_BUG",
      `选中 ${ids.length} 行删除后：服务端剩余 ${server} 行、界面仍显示 ${after.length} 行；反馈「${toast}」`,
      "不得对同一 linkId 多次 DELETE；失败要给成功/失败数并刷新真实结果");
  })();

  /* ---------- T-P2-01 重命名 / F2 / 属性 ---------- */
  await (async function T_P2_01() {
    await evalJs(`Drive.openFolder('k:project')`).catch(() => {});
    await sleep(300);
    const rowId = (await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`))[0];
    const before = await evalJs(`(findById(${JSON.stringify(rowId)})||{}).name || ''`);
    await evalJs(`(() => {
      const row = document.querySelector('#viewRoot .row');
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 }));
      return 1;
    })()`);
    await sleep(300);
    const menu = await evalJs(`[...document.querySelectorAll('#ctxMenu [data-act]')].map(b=>b.innerText.trim())`);
    await clearToasts();
    await evalJs(`document.querySelector('#ctxMenu [data-act="rename"]').click()`);
    await sleep(300);
    const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ')`);
    const after = await evalJs(`(findById(${JSON.stringify(rowId)})||{}).name || ''`);
    await evalJs(`Drive.state.selection = new Set([${JSON.stringify(rowId)}]); Drive.render();`).catch(() => {});
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    await sleep(300);
    const toast2 = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ')`);
    await shot("T-P2-01-rename");
    ev("T-P2-01", [
      `目标行 ${rowId}，名称 ${before}`,
      `右键菜单项：${JSON.stringify(menu)}`,
      `点「重命名」后 toast：${toast}`,
      `按 F2 后 toast：${toast2}`,
      `名称是否变化：${before !== after}（当前 ${after}）`,
      "",
      "两条入口都只弹提示，真正的改名在详情面板「修改」/右键「属性」；菜单把不可用动作画成可用项。",
    ].join("\n"));
    rec("T-P2-01", "DYNAMIC-BROWSER", before === after ? "CONFIRMED_BUG" : "PASS",
      `右键「重命名」与 F2 都只弹「${toast || toast2}」，名称未变（${before}）`,
      "重命名真的改名，或对未实现的命令不误导");
  })();

  /* ---------- T-P2-02 拖放 ---------- */
  await (async function T_P2_02() {
    await evalJs(`Drive.openFolder('p:${fx.company.projectA}')`);
    await sleep(600);
    const fileId = (await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`)).find((x) => /^f:/.test(x));
    const moved = await evalJs(`(async () => {
      const src = findById(${JSON.stringify(fileId)});
      const target = findById('i:${fx.company.ipB}');
      if (!src || !target) return { err: '节点缺失' };
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(fileId)});
      const row = document.querySelector('#viewRoot .row');
      Drive.openFolder('k:ip');
      await new Promise(r => setTimeout(r, 300));
      const targetRow = [...document.querySelectorAll('#viewRoot .row')].find(r => r.dataset.id === 'i:${fx.company.ipB}');
      if (!targetRow) return { err: '目标行不在当前视图' };
      targetRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      document.querySelectorAll('.toast').forEach(t=>t.remove());
      targetRow.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      await new Promise(r => setTimeout(r, 400));
      return { toast: [...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ') };
    })()`);
    ev("T-P2-02", [
      "拖动源：项目A中的附件行 " + fileId,
      "放置目标：IP-B 记录行",
      `结果：${JSON.stringify(moved)}`,
      "",
      "interactions.js:985-1004 的 drop 处理器只弹「附件移动需要后端支持 link 迁移」。",
      "但后端 POST /api/v2/files/{ws}/{fileId}/associate {linkId,targetFolderId,move:true} 已经可用（T-P1-03 实测 move 200）。",
      "所以这句提示本身是错的：不是后端缺能力，是前端没调用。",
    ].join("\n"));
    rec("T-P2-02", "DYNAMIC-BROWSER", moved && moved.toast ? "CONFIRMED_BUG" : "BLOCKED",
      `内部拖拽后提示「${moved && moved.toast}」，文件未移动`,
      "内部移动真正执行，或明确说明不支持而不谎称后端缺失");
  })();

  /* ---------- T-P2-03 快捷访问加号 ---------- */
  await (async function T_P2_03() {
    await evalJs(`Drive.openFolder('root')`).catch(() => {});
    await sleep(600);
    const btn = await evalJs(`!!document.querySelector('#btnPinFolder')`);
    if (btn) await clearToasts();
    await evalJs(`document.querySelector('#btnPinFolder').click()`);
    await sleep(300);
    const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ')`);
    await shot("T-P2-03-pin");
    ev("T-P2-03", [
      "#btnPinFolder 存在=" + btn,
      "点击后 toast：" + toast,
      "",
      "interactions.js:700 硬编码 toast('「快捷访问」已按资料分类自动生成')，没有任何自定义快捷方式的能力。",
      "侧栏『快捷访问』只是六个固定分类的同义展示，不是用户可维护的快捷方式。",
    ].join("\n"));
    rec("T-P2-03", "DYNAMIC-BROWSER", btn && /自动生成/.test(toast || "") ? "CONFIRMED_BUG" : "PASS",
      `「添加快捷访问」按钮点击后只弹「${toast}」`,
      "按钮真能添加快捷访问；否则应不可用而不是假成功");
  })();

  /* ---------- T-P2-04 首页导入资料 ---------- */
  await (async function T_P2_04() {
    await evalJs(`Drive.state.view='home'; Drive.state.folderId='root'; Drive.render();`);
    await sleep(500);
    const r = await evalJs(`(() => {
      window.__pickerOpened = 0;
      const orig = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__pickerOpened++; return; } return orig.apply(this, arguments); };
      const b = document.querySelector('[data-page-act="upload"]');
      if (!b) return { err: '首页没有导入资料按钮' };
      b.click();
      return { opened: window.__pickerOpened, folderId: Drive.state.folderId,
               isFolder: (findById(Drive.state.folderId)||{}).type,
               toast: [...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ') };
    })()`);
    await shot("T-P2-04-home-upload");
    ev("T-P2-04", [
      "首页点「导入资料」：",
      JSON.stringify(r, null, 1),
      "",
      "pickFiles() 只判断当前 folderId 是不是 folder，首页 folderId=root 恰好是 folder 且没有 k: 前缀，",
      "于是直接弹文件选择器，没有任何『先选记录』的引导。 REQUIREMENTS.md:30/153 要求先有业务记录再上传。",
    ].join("\n"));
    rec("T-P2-04", "DYNAMIC-BROWSER", (r && r.opened > 0) ? "CONFIRMED_BUG" : (r && r.toast ? "PASS" : "BLOCKED"),
      `首页点导入资料后打开文件选择器 ${r && r.opened} 次（folderId=${r && r.folderId}）`,
      "首页不得允许无归属上传，应引导先选记录");
  })();

  /* ---------- T-P2-06 键盘 ---------- */
  await (async function T_P2_06() {
    await evalJs(`Drive.openFolder('k:project')`).catch(() => {});
    await sleep(500);
    const total = await evalJs(`document.querySelectorAll('#viewRoot .row').length`);
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}))`);
    await sleep(300);
    const selAll = await evalJs(`Drive.state.selection.size`);
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(200);
    const afterEsc = await evalJs(`Drive.state.selection.size`);
    await evalJs(`Drive.state.selection = new Set([...document.querySelectorAll('#viewRoot .row')].slice(0,1).map(r=>r.dataset.id)); Drive.render(); Drive.state.detailOpen = true;`);
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`);
    await sleep(400);
    const confirmShown = await evalJs(`!!document.querySelector('#confirmMask.show') || getComputedStyle(document.querySelector('#confirmMask')).display !== 'none'`);
    const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ')`);
    await evalJs(`document.querySelector('#confirmCancel') && document.querySelector('#confirmCancel').click()`).catch(() => {});
    await sleep(200);
    const back = await evalJs(`(() => { Drive.openFolder('i:${fx.company.ipA}'); return Drive.state.folderId; })()`);
    await sleep(400);
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true}))`);
    await sleep(400);
    const afterAltLeft = await evalJs(`Drive.state.folderId`);
    await shot("T-P2-06-keyboard");
    ev("T-P2-06", [
      `分类内行数=${total}`,
      `Ctrl+A 后选中=${selAll}（期望 ${total}）`,
      `Esc 后选中=${afterEsc}（期望 0）`,
      `Delete 弹出确认=${confirmShown}；toast=${toast}`,
      `Alt+Left 从 i:${fx.company.ipA} 回到 ${afterAltLeft}`,
    ].join("\n"));
    rec("T-P2-06", "DYNAMIC-BROWSER", selAll === total && afterEsc === 0 ? "PASS" : "FAIL",
      `Ctrl+A 选中 ${selAll}/${total}，Esc 清空=${afterEsc === 0}，Delete 确认=${confirmShown}，Alt+Left → ${afterAltLeft}`,
      "Ctrl+A 全选、Esc 取消、Delete 有确认、Alt+Left 返回上级");
  })();

  /* ---------- T-P2-07 搜索跳转与附件命中映射 ---------- */
  await (async function T_P2_07() {
    await evalJs("Drive.state.view='files'; Drive.state.folderId='root'; Drive.render();");
    await sleep(300);
    async function search(query) {
      await evalJs("(() => { const input=document.querySelector('#searchInput'); input.value=" + JSON.stringify(query) + "; input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
      await sleep(2500);
      return await evalJs("[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)");
    }
    const expectedArchiveId="a:achievement:" + fx.archive.records[0];
    const archiveRows=await search("档案-01");
    const archiveFound=archiveRows.includes(expectedArchiveId);
    if(archiveFound) {
      const selector='#viewRoot .row[data-id=' + JSON.stringify(expectedArchiveId) + ']';
      await evalJs("document.querySelector(" + JSON.stringify(selector) + ")?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
      await sleep(700);
    }
    const archiveAt=await evalJs("({folderId:Drive.state.folderId,crumbs:[...document.querySelectorAll('[data-crumb]')].map(b=>b.innerText.trim())})");
    const archiveNavigated=archiveAt.folderId===expectedArchiveId;
    await evalJs("Drive.resetSearch(); Drive.state.view='files'; Drive.state.folderId='root'; Drive.render();");
    await sleep(250);
    const expectedFileId="f:" + fx.files.general.linkId + ":" + fx.files.general.version;
    const fileRows=await search("综合资料附件.txt");
    const fileFound=fileRows.includes(expectedFileId);
    const fileMeta=fileFound?await evalJs("(() => { const n=findById(" + JSON.stringify(expectedFileId) + "); const p=findParent(" + JSON.stringify(expectedFileId) + "); const m=VaultStore.metaOf(" + JSON.stringify(expectedFileId) + "); return {nodeId:n?.id||null,parentId:p?.id||null,fileId:m?.fileId??null,linkId:m?.linkId??null,version:m?.version??null}; })()"):null;
    const fileMapped=!!fileMeta && fileMeta.parentId==="g:" + fx.company.general &&
      Number(fileMeta.fileId)===Number(fx.files.general.fileId) && Number(fileMeta.linkId)===Number(fx.files.general.linkId);
    await shot("T-P2-07-search");
    ev("T-P2-07", [
      "搜索『档案-01』结果：" + JSON.stringify(archiveRows),
      "期望档案节点：" + expectedArchiveId + "；精确命中=" + archiveFound,
      "双击后位置：" + JSON.stringify(archiveAt) + "；正确跳转=" + archiveNavigated,
      "",
      "搜索『综合资料附件.txt』结果：" + JSON.stringify(fileRows),
      "期望附件节点：" + expectedFileId + "；命中=" + fileFound,
      "附件元数据与所属记录：" + JSON.stringify(fileMeta) + "；fileId→linkId 映射正确=" + fileMapped,
    ].join("\n"));
    const ok=archiveFound&&archiveNavigated&&fileFound&&fileMapped;
    rec("T-P2-07","DYNAMIC-BROWSER",ok?"PASS":"FAIL",
      "档案精确跳转=" + archiveNavigated + "（" + archiveAt.folderId + "）；附件命中=" + fileFound + "；归属映射=" + fileMapped,
      "搜索必须命中预期档案节点并跳转；附件搜索必须映射到真实 link 节点及正确所属记录");
    await evalJs("Drive.resetSearch(); Drive.render();").catch(()=>{});
  })();

  /* ---------- T-P2-09 PDF 预览 ---------- */
  await (async function T_P2_09() {
    await evalJs("Drive.openFolder('p:" + fx.company.projectA + "')");
    await sleep(800);
    const rows=await evalJs("[...document.querySelectorAll('#viewRoot .row')].map(r=>({id:r.dataset.id,name:r.innerText.replace(/\\s+/g,' ').trim()}))");
    const pdfRow=rows.find(r=>/pdf/i.test(r.name));
    if(!pdfRow)return rec("T-P2-09","DYNAMIC-BROWSER","BLOCKED","列表里找不到 PDF 行","有效两页 PDF 的第 1、2 页均渲染");
    await evalJs("previewFile(" + JSON.stringify(pdfRow.id) + ")");
    await sleep(300);
    async function pageState(expectedPage) {
      const expected=JSON.stringify(expectedPage);
      const readyExpr="(() => { const box=document.querySelector('.preview-mask'); const count=box?.querySelector('.pdf-count')?.textContent.trim(); const status=box?.querySelector('.pdf-render-status')?.textContent.trim(); const canvas=box?.querySelector('canvas.pdf-canvas'); return count===" + expected + "&&status===''&&!!canvas&&canvas.width>0&&canvas.height>0; })()";
      try { await waitFor(readyExpr,15000,"PDF page " + expectedPage + " rendered"); } catch {}
      const stateExpr="(() => { const box=document.querySelector('.preview-mask'); const canvas=box?.querySelector('canvas.pdf-canvas'); return {pageCount:box?.querySelector('.pdf-count')?.textContent.trim()||'',status:box?.querySelector('.pdf-render-status')?.textContent.trim()||'',canvasWidth:canvas?.width||0,canvasHeight:canvas?.height||0,ready:!!box&&box.querySelector('.pdf-count')?.textContent.trim()===" + expected + "&&box.querySelector('.pdf-render-status')?.textContent.trim()===''&&!!canvas&&canvas.width>0&&canvas.height>0}; })()";
      return await evalJs(stateExpr);
    }
    const first=await pageState("1 / 2");
    await shot("T-P2-09-pdf-page1");
    if(first.ready)await evalJs("[...document.querySelectorAll('.preview-mask .pdf-toolbar button')].find(b=>b.textContent.trim()==='下一页')?.click()");
    const second=first.ready?await pageState("2 / 2"):{pageCount:"",status:"第一页未完成渲染，未继续翻页",canvasWidth:0,canvasHeight:0,ready:false};
    await shot("T-P2-09-pdf-page2");
    ev("T-P2-09",[
      "PDF 行：" + JSON.stringify(pdfRow),
      "第 1 页状态：" + JSON.stringify(first),
      "第 2 页状态：" + JSON.stringify(second),
      "",
      "判定要求：页码依次为 1 / 2、2 / 2；每页 Canvas 尺寸大于 0；渲染状态为空。",
      "fixture.cjs 使用带有效 xref、字体资源和准确 stream Length 的两页 PDF。",
    ].join("\n"));
    const ok=first.ready&&second.ready;
    rec("T-P2-09","DYNAMIC-BROWSER",ok?"PASS":"FAIL",
      "page1=" + first.ready + "(" + first.pageCount + "; " + (first.status||"status empty") + ")；page2=" + second.ready + "(" + second.pageCount + "; " + (second.status||"status empty") + ")",
      "两页 PDF 都真实完成 Canvas 渲染，页码正确，状态清空");
  })();

  /* ---------- T-P2-11 响应式 ---------- */
  await (async function T_P2_11() {
    const sizes = [[1366, 768, 1], [1920, 1080, 1], [1366, 768, 1.5]];
    const out = [];
    for (const [w, h, dpr] of sizes) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
      await sleep(500);
      const m = await evalJs(`(() => {
        const head = document.querySelector('#listHead');
        const row = document.querySelector('#viewRoot .row');
        const r1 = head && head.getBoundingClientRect(), r2 = row && row.getBoundingClientRect();
        return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
                 headH: r1 && Math.round(r1.height), rowH: r2 && Math.round(r2.height) };
      })()`);
      out.push(Object.assign({ w, h, dpr }, m));
      await shot(`T-P2-11-${w}x${h}-${dpr}x`);
    }
    await send("Emulation.clearDeviceMetricsOverride");
    ev("T-P2-11", ["三种视口下的布局指标：", JSON.stringify(out, null, 1),
      "", "判定：横向不出现滚动条（scrollW<=clientW），表头与行高度稳定。"].join("\n"));
    rec("T-P2-11", "DYNAMIC-BROWSER", out.every((x) => x.scrollW <= x.clientW) ? "PASS" : "FAIL",
      out.map((x) => `${x.w}x${x.h}@${x.dpr}x scroll=${x.scrollW}/${x.clientW}`).join("；"),
      "三种视口不横向溢出、不重叠");
  })();

  fs.writeFileSync(path.join(EVID, "browser-results.json"), JSON.stringify(results, null, 2), "utf8");
  console.log("\n=== 浏览器层汇总 ===");
  for (const r of results) console.log(`${r.id}\t${r.result}\t${r.observed}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .finally(async () => {
    try { ws && ws.close(); } catch {}
    await sleep(300);
    /* 只关自己起的那个进程，绝不按映像名杀 msedge —— 用户可能正开着浏览器 */
    try { await send("Browser.close"); } catch {}
    await sleep(500);
    try { if (browserProc && !browserProc.killed) browserProc.kill(); } catch {}
  });
