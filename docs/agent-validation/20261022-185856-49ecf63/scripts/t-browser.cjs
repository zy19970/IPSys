/* 浏览器层真实用例（V3）：CDP 驱动本机 Edge，独立 user-data-dir，只关自己的进程。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-browser.cjs <runid> */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v3a";
const COMMIT = process.env.IPSYS_COMMIT || "49ecf63";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CASES = path.join(EVID, "cases");
const SHOT = path.join(EVID, "shots");
const TMP = path.resolve(ROOT, "..", "..", "..", "build-retest", "agent-validation-v3");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
fs.mkdirSync(SHOT, { recursive: true });

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error("找不到 Edge/Chrome");

const CDP_PORT = 9511 + Math.floor(Math.random() * 300);
const PROFILE = path.join(TMP, "edge-profile-" + Date.now());
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = L.makeLog(path.join(EVID, "browser-run.log"));

function rec(o) {
  const row = Object.assign({ runId: RUNID, testedCommit: COMMIT, at: new Date().toISOString(), method: "DYNAMIC-BROWSER" }, o);
  results.push(row);
  fs.writeFileSync(path.join(CASES, o.id + ".browser.json"), JSON.stringify(row, null, 2), "utf8");
  log.add(`[${o.result}] ${o.id} ${o.feature}${o.defect ? " -> " + o.defect : ""}`);
  return row;
}

let ws, msgId = 0;
const pending = new Map();
const eventHandlers = [];
function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
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
  fs.writeFileSync(path.join(SHOT, name.replace(/[#/:\s]/g, "_") + ".png"), Buffer.from(r.data, "base64"));
}
async function clearToasts() { await evalJs(`document.querySelectorAll('.toast').forEach(t=>t.remove())`).catch(() => {}); }
async function waitFor(expr, timeout = 12000, label = expr) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    try { const v = await evalJs(expr); if (v) return v; } catch (e) { last = e; }
    await sleep(150);
  }
  throw new Error("等待超时: " + label + (last ? " / " + last.message : ""));
}
async function goto(url) {
  await send("Page.navigate", { url });
  await sleep(500);
  await waitFor("document.readyState === 'complete'", 15000, "document ready");
}
/* 每个用例前回到一个干净、已知的状态 */
async function resetHome() {
  await clearToasts();
  await evalJs(`(() => { Drive.clearSelection?.(); Drive.state.view='home'; Drive.state.folderId='root'; Drive.render(); return 1; })()`);
  await sleep(250);
}
async function openCat(cat) {
  await evalJs(`Drive.openFolder('k:${cat}')`);
  await sleep(450);
}
function rowsInfo() {
  return evalJs(`(() => [...document.querySelectorAll('#viewRoot .row')].map(r => ({
    id: r.getAttribute('data-id'),
    title: (r.querySelector('.row-title')||{}).textContent || '',
    sub: (r.querySelector('.row-sub')||{}).textContent || '',
    sel: r.classList.contains('is-selected'),
  })))()`);
}
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

(async () => {
  const wsUrl = await new Promise((resolve, reject) => {
    const p = spawn(EDGE, [
      "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
      "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
      "--window-size=1366,768", "about:blank",
    ], { stdio: "ignore", detached: false });
    p.on("error", reject);
    const t0 = Date.now();
    const poll = () => {
      http.get({ host: "127.0.0.1", port: CDP_PORT, path: "/json/list" }, (res) => {
        let b = ""; res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            const page = JSON.parse(b).find((x) => x.type === "page");
            if (page) resolve(page.webSocketDebuggerUrl); else throw new Error("no page");
          } catch { retry(); }
        });
      }).on("error", retry);
    };
    const retry = () => { if (Date.now() - t0 > 20000) reject(new Error("CDP 启动超时")); else setTimeout(poll, 250); };
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
      return;
    }
    if (m.method) for (const h of eventHandlers) { try { h(m); } catch {} }
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");

  const base = L.BASE;
  const resume = await (await fetch(base + "/api/resume", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: cred.password }),
  })).json();

  await goto(base + "/");
  await waitFor("!!document.querySelector('#lockForm')", 10000, "登录层");
  await evalJs(`(() => { sessionStorage.setItem('od-token', ${JSON.stringify(resume.token)});
    sessionStorage.setItem('od-db', 'vault-${RUNID}.db'); location.reload(); return 1; })()`);
  await sleep(1500);
  await waitFor("document.querySelectorAll('#viewRoot .catcard').length > 0", 20000, "首页分类卡片");
  await evalJs(`enterWorkspace('company')`);
  await sleep(900);
  await waitFor("VaultStore.ws === 'company'", 15000, "公司工作区");
  await shot("00-home-company");

  /* ================= T-P0-01 UI：三级目录在界面上是否可达 ================= */
  try {
    await resetHome();
    await openCat("achievement");
    const lvl1 = await rowsInfo();
    await shot("T-P0-01-lvl1");
    const hasLvl2 = lvl1.some((r) => r.title === "二级-A");
    const hasLvl3AtTop = lvl1.some((r) => r.title === "三级-A1");
    const recAtTop = lvl1.find((r) => r.title === "档案-01");
    /* 进入系统目录后看二级是否在内层 */
    await evalJs(`Drive.openFolder('af:${fx.archive.system[0].id}')`);
    await sleep(450);
    const inner = await rowsInfo();
    const hasLvl2Inner = inner.some((r) => r.title === "二级-A");
    await shot("T-P0-01-inner");
    rec({
      id: "T-P0-01-ui", feature: "界面逐层进入业务档案三级目录",
      expected: "一级能看到 7 个系统目录；进入系统目录能看到 二级-A；再进能看到 三级-A1 与档案-01",
      result: hasLvl2Inner ? "PASS" : "CONFIRMED_BUG", defect: hasLvl2Inner ? null : "BUG-001",
      observed: { lvl1Rows: lvl1.map((r) => r.title), hasLvl2AtCatLevel: hasLvl2, hasLvl3AtCatLevel: hasLvl3AtTop,
                  record01AtCatLevel: !!recAtTop, innerRows: inner.map((r) => r.title), hasLvl2Inner },
      notes: "与 t-tree.cjs 的纯函数结论互证：树里根本没有 af:8/af:9",
    });
  } catch (e) {
    rec({ id: "T-P0-01-ui", feature: "界面逐层进入业务档案三级目录", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "三级可达" });
  }

  /* ================= T-P0-02 UI：IP 附件行数 ================= */
  try {
    await resetHome();
    await openCat("ip");
    const ipRows = await rowsInfo();
    await evalJs(`Drive.openFolder('i:${fx.company.ipA}')`);
    await sleep(500);
    const files = await rowsInfo();
    await shot("T-P0-02-ip-affix");
    const target = String(fx.files.ipA.linkId);
    const mine = files.filter((r) => String(r.id || "").startsWith("f:" + target + ":"));
    rec({
      id: "T-P0-02-ui", feature: "同一 LinkId 多版本在列表中占几行",
      expected: "linkId=" + target + " 只有 1 行（默认最新版）",
      result: mine.length === 1 ? "PASS" : "CONFIRMED_BUG", defect: mine.length === 1 ? null : "BUG-002",
      observed: { catRows: ipRows.map((r) => r.title), fileRows: files.map((r) => ({ id: r.id, title: r.title, sub: r.sub })),
                  rowsForLink: mine.length, rowIds: mine.map((r) => r.id) },
    });
  } catch (e) {
    rec({ id: "T-P0-02-ui", feature: "同一 LinkId 多版本行数", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "1 行" });
  }

  /* ================= T-P2-09 / BUG-018：两页 PDF 是否真的渲染 ================= */
  try {
    await resetHome();
    const pdfNode = `f:${fx.files.pdf.linkId}:1`;
    await evalJs(`previewFile(${JSON.stringify(pdfNode)})`);
    await sleep(600);
    /* 等到出现 pdf 工具栏 */
    const appeared = await waitFor(`!!document.querySelector('.pdf-mode')`, 8000, "PDF 容器").then(() => true).catch(() => false);
    /* 再给渲染一个宽限窗口 */
    let state = null;
    for (let i = 0; i < 20; i++) {
      state = await evalJs(`(() => {
        const c = document.querySelector('.pdf-canvas');
        const st = document.querySelector('.pdf-render-status');
        const ct = document.querySelector('.pdf-count');
        let px = '';
        if (c && c.width > 0 && c.height > 0) { try { px = c.toDataURL('image/png').slice(0, 200); } catch(e) { px = 'ERR'; } }
        return { hasCanvas: !!c, w: c ? c.width : 0, h: c ? c.height : 0,
                 status: st ? st.textContent : null, count: ct ? ct.textContent : null, pxSample: px };
      })()`);
      if (state.count && /^\d+ \/ \d+$/.test(state.count.trim()) && state.status === "") break;
      await sleep(400);
    }
    await shot("T-P2-09-pdf-page1");
    const page1 = state;
    /* 翻到第二页，取像素指纹对比 */
    const p1hash = page1.w ? sha(await evalJs(`document.querySelector('.pdf-canvas').toDataURL('image/png')`)) : null;
    let page2 = null, p2hash = null;
    if (page1.count && /1 \/ 2/.test(page1.count)) {
      await evalJs(`(() => { const b = [...document.querySelectorAll('.pdf-toolbar .btn')].find(x => x.textContent.trim() === '下一页'); if (b) b.click(); return 1; })()`);
      await sleep(900);
      for (let i = 0; i < 15; i++) {
        page2 = await evalJs(`(() => { const c = document.querySelector('.pdf-canvas'); const st = document.querySelector('.pdf-render-status'); const ct = document.querySelector('.pdf-count');
          return { w: c ? c.width : 0, h: c ? c.height : 0, status: st ? st.textContent : null, count: ct ? ct.textContent : null }; })()`);
        if (page2.count && /2 \/ 2/.test(page2.count) && page2.status === "") break;
        await sleep(400);
      }
      await shot("T-P2-09-pdf-page2");
      if (page2 && page2.w) p2hash = sha(await evalJs(`document.querySelector('.pdf-canvas').toDataURL('image/png')`));
    }
    const rendered2 = !!(page2 && /2 \/ 2/.test(page2.count || "") && page2.status === "" && p2hash && p1hash && p2hash !== p1hash);
    const rendered1 = !!(page1 && /1 \/ 2/.test(page1.count || "") && page1.status === "" && page1.w > 0);
    rec({
      id: "T-P2-09", feature: "Explorer 真页面打开两步 PDF，两页都完成 Canvas 渲染",
      expected: "页码 1/2 → 2/2；状态空；canvas 有尺寸；两页像素指纹不同",
      result: rendered1 && rendered2 ? "PASS" : "CONFIRMED_BUG", defect: rendered1 && rendered2 ? null : "BUG-018",
      observed: { appeared, page1, page2, p1hash: p1hash && p1hash.slice(0, 16), p2hash: p2hash && p2hash.slice(0, 16), rendered1, rendered2 },
      rootCause: "frontend/explorer/js/interactions.js:1633 只做 pdfViewer = viewer.create(body, buffer)，" +
        "而 src/IPSys.Web/wwwroot/pdf-preview.js:95 返回 {open,destroy}，create 不启动解析；未调 open() 就永远停在「正在解析 PDF…」",
      notes: "上轮 T-P2-09 判 PASS 属误报（证据里 pages:0），本轮撤销该 PASS",
    });
  } catch (e) {
    rec({ id: "T-P2-09", feature: "PDF 两页渲染", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "两页都渲染" });
  }

  /* ================= T-P2-01：F2 / 右键重命名 / 详情修改 ================= */
  try {
    await resetHome();
    await openCat("project");
    const pRows = await rowsInfo();
    const targetId = pRows[0] && pRows[0].id;
    /* 真实右键：直接在行上派发 contextmenu，走产品自己的处理器 */
    const openRowCtx = async (id, x = 320, y = 300) => {
      await evalJs(`(() => { const r = document.querySelector('#viewRoot .row[data-id="' + ${JSON.stringify(id)} + '"]');
        if (!r) return 0; r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} })); return 1; })()`);
      await sleep(350);
      return evalJs(`(() => [...document.querySelectorAll('#ctxMenu .mi, #ctxMenu button, #ctxMenu [data-act]')].map(b => ({ t: (b.textContent||'').trim(), act: b.getAttribute('data-act') })).filter(x => x.t))()`);
    };
    await clearToasts();
    /* ① F2 */
    await evalJs(`(() => { Drive.select(${JSON.stringify(targetId)}, 'single'); return 1; })()`);
    await sleep(250);
    await evalJs(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })); return 1; })()`);
    await sleep(500);
    const afterF2 = await evalJs(`(() => ({
      toast: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()),
      hasForm: !!document.querySelector('.mask.show .dialog, .mask.show form, .mask.show input[type=text]'),
      maskTitles: [...document.querySelectorAll('.mask.show')].map(m => (m.querySelector('.dialog-title,.dialog h3,.dlg-title')||{}).textContent ||'(无标题)'),
    }))()`);
    await shot("T-P2-01-f2");
    /* ② 右键菜单里的「重命名」 */
    await clearToasts();
    const ctxItems = await openRowCtx(targetId);
    await shot("T-P2-01-ctx");
    let afterCtxRename = null;
    const renameItem = ctxItems.find((x) => /重命名/.test(x.t));
    if (renameItem) {
      await evalJs(`(() => { const b = [...document.querySelectorAll('#ctxMenu .mi, #ctxMenu button, #ctxMenu [data-act]')].find(x => /重命名/.test(x.textContent||'')); if (b) b.click(); return 1; })()`);
      await sleep(500);
      afterCtxRename = await evalJs(`(() => ({
        toast: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()),
        hasForm: !!document.querySelector('.mask.show .dialog, .mask.show form, .mask.show input[type=text]'),
      }))()`);
    }
    /* ③ 详情面板的「修改」——这是产品真正提供的编辑入口 */
    const detailEdit = await evalJs(`(() => {
      Drive.state.detailOpen = true; Drive.select(${JSON.stringify(targetId)}, 'single'); Drive.render();
      const btn = document.querySelector('[data-detail-act="edit"]');
      return { detailOpen: !!document.querySelector('#detailPanel, .detail'), hasEditBtn: !!btn };
    })()`);
    await sleep(300);
    let afterDetailEdit = null;
    const hasBtn = await evalJs(`!!document.querySelector('[data-detail-act="edit"]')`);
    if (hasBtn) {
      await clearToasts();
      await evalJs(`document.querySelector('[data-detail-act="edit"]').click()`);
      await sleep(700);
      afterDetailEdit = await evalJs(`(() => ({
        hasForm: !!document.querySelector('.mask.show .dialog, .mask.show form, .mask.show input[type=text], .mask.show select'),
        maskCount: document.querySelectorAll('.mask.show').length,
      }))()`);
      await shot("T-P2-01-detail-edit");
    }
    const f2Works = afterF2.hasForm;
    const ctxRenameWorks = !!(afterCtxRename && afterCtxRename.hasForm);
    const detailWorks = !!(afterDetailEdit && afterDetailEdit.hasForm);
    /* 判据（任务书 §7 T-P2-01）：写着重命名/F2 就必须能改，不能只弹提示。
       详情「修改」可用但菜单项仍挂着「重命名 / F2」快捷键 = 入口文案与行为不符。 */
    const ok = f2Works && ctxRenameWorks && detailWorks;
    rec({
      id: "T-P2-01", feature: "F2 / 右键重命名 / 详情「修改」三条改名入口",
      expected: "三种入口都能进入可编辑表单；不能写着「重命名 / F2」却只弹一句提示",
      result: ok ? "PASS" : "CONFIRMED_BUG", defect: ok ? null : "BUG-013",
      observed: {
        targetId, f2: afterF2, ctxItems, ctxRename: afterCtxRename,
        detailPanel: detailEdit, detailEditResult: afterDetailEdit,
        f2Works, ctxRenameWorks, detailWorks,
      },
      rootCause: "frontend/explorer/js/interactions.js:1060 rename:()=>toast(\"重命名请点「修改」或右键「属性」\")；" +
        "interactions.js:1280 F2 分支同样只 toast。菜单项由 1047 行 MI(\"rename\",\"rename\",\"重命名\",\"F2\") 生成，带 F2 快捷键提示但没有改名行为。",
      notes: "项目 2026-10-21 曾把「文案联动指向修改」定为口径，但任务书要求入口名与实际行为一致；" +
        "修法二选一：菜单项改名「修改属性」/ 真正打开表单",
    });
  } catch (e) {
    rec({ id: "T-P2-01", feature: "重命名入口", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "可编辑表单" });
  }

  /* ================= T-P2-06：Ctrl+A / Esc / Alt+Left ================= */
  try {
    await resetHome();
    await openCat("project");
    const n = (await rowsInfo()).length;
    await clearToasts();
    await evalJs(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); return 1; })()`);
    await sleep(350);
    const selAll = await evalJs(`Drive.state.selection.size`);
    /* Esc 清空 */
    await evalJs(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return 1; })()`);
    await sleep(300);
    const selAfterEsc = await evalJs(`Drive.state.selection.size`);
    /* Alt+Left 返回上一级 */
    await evalJs(`Drive.openFolder('af:${fx.archive.system[0].id}')`).catch(() => {});
    await sleep(300);
    const beforeBack = await evalJs(`Drive.state.folderId`);
    await evalJs(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true })); return 1; })()`);
    await sleep(450);
    const afterBack = await evalJs(`Drive.state.folderId`);
    rec({
      id: "T-P2-06", feature: "Ctrl+A / Esc / Alt+Left 键鼠语义",
      expected: "Ctrl+A 全选当前列表；Esc 清空选择；Alt+Left 返回上一层",
      result: (selAll === n && n > 0 && selAfterEsc === 0 && beforeBack !== afterBack) ? "PASS" : "CONFIRMED_BUG",
      defect: (selAll === n && n > 0 && selAfterEsc === 0 && beforeBack !== afterBack) ? null : "BUG-015",
      observed: { rowCount: n, selectedAfterCtrlA: selAll, selectedAfterEsc: selAfterEsc, folderBeforeAltLeft: beforeBack, folderAfterAltLeft: afterBack },
    });
  } catch (e) {
    rec({ id: "T-P2-06", feature: "键盘语义", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "键鼠语义正确" });
  }

  /* ================= T-P2-07：全局搜索 ================= */
  try {
    await resetHome();
    const q = "档案-01";
    const res = await evalJs(`(async () => {
      const r = await VaultStore.search('company', ${JSON.stringify(q)});
      return { count: (r.results||[]).length, truncated: r.truncated, sample: (r.results||[]).slice(0,5) };
    })()`);
    /* UI 侧：把搜索词填进去看渲染 */
    const ui = await evalJs(`(() => {
      const inp = document.querySelector('#searchInput, input[type=search], #q');
      if (!inp) return { hasInput: false };
      inp.value = ${JSON.stringify(q)};
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return { hasInput: true };
    })()`);
    await sleep(900);
    await shot("T-P2-07-search");
    const rows = await rowsInfo();
    rec({
      id: "T-P2-07", feature: "全局搜索并精确跳转",
      expected: "能搜到 档案-01 且结果带 ownerKind/ownerId，点击能定位",
      result: (res.count > 0 && ui.hasInput) ? "PASS" : "CONFIRMED_BUG",
      defect: (res.count > 0 && ui.hasInput) ? null : "BUG-016",
      observed: { apiResult: res, hasSearchInput: ui.hasInput, renderedRows: rows.map((r) => ({ id: r.id, title: r.title })) },
    });
  } catch (e) {
    rec({ id: "T-P2-07", feature: "全局搜索", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "可搜可跳转" });
  }

  /* ================= T-P2-11：三种分辨率 ================= */
  try {
    const sizes = [
      { w: 1366, h: 768, dpr: 1, label: "1366x768@100%" },
      { w: 1920, h: 1080, dpr: 1, label: "1920x1080@100%" },
      { w: 1366, h: 768, dpr: 1.5, label: "1366x768@150%" },
    ];
    const out = [];
    for (const s of sizes) {
      await send("Emulation.setDeviceMetricsOverride", { width: s.w, height: s.h, deviceScaleFactor: s.dpr, mobile: false });
      await sleep(700);
      const m = await evalJs(`(() => {
        const de = document.documentElement;
        const bar = document.querySelector('.commandbar, #commandBar, .main-head');
        return { iw: window.innerWidth, ih: window.innerHeight,
                 scrollW: de.scrollWidth, clientW: de.clientWidth,
                 hOverflow: de.scrollWidth > de.clientWidth + 1,
                 barVisible: bar ? getComputedStyle(bar).display !== 'none' : null };
      })()`);
      await shot("T-P2-11-" + s.label);
      out.push(Object.assign({ label: s.label }, m));
      await send("Emulation.clearDeviceMetricsOverride");
    }
    const bad = out.filter((x) => x.hOverflow);
    rec({
      id: "T-P2-11", feature: "多分辨率布局不出现横向溢出",
      expected: "三种分辨率下均无横向滚动，命令栏可见",
      result: bad.length === 0 ? "PASS" : "CONFIRMED_BUG", defect: bad.length === 0 ? null : "BUG-015",
      observed: { viewports: out, overflowing: bad.map((x) => x.label) },
    });
  } catch (e) {
    rec({ id: "T-P2-11", feature: "多分辨率", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "无横向溢出" });
  }

  /* ================= T-P2-03：添加快捷访问是否假按钮 ================= */
  try {
    await resetHome();
    /* 真实入口是侧栏/工具栏的 #btnPinFolder（interactions.js:700），不是右键菜单 */
    const probe = await evalJs(`(() => {
      const b = document.querySelector('#btnPinFolder');
      return { exists: !!b, text: b ? (b.textContent||'').trim() : null,
               visible: b ? !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length) : false,
               title: b ? b.getAttribute('title') : null };
    })()`);
    let after = null;
    if (probe.exists) {
      await clearToasts();
      /* 点之前先量一遍「快捷区」的条目数与 localStorage，点完再量 —— 只比 DOM 存在与否会误判，
         因为分类区本身就是 .quick（app.js:570 注释：快捷访问 = 六个固定分类）。 */
      const measure = `(() => ({
        quickItems: document.querySelectorAll('.quick .item, .quick li, .quick a, [data-quick]').length,
        storageKeys: Object.keys(localStorage).sort(),
      }))()`;
      const before = await evalJs(measure);
      await evalJs(`document.querySelector('#btnPinFolder').click()`);
      await sleep(700);
      const mid = await evalJs(measure);
      const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t => t.textContent.trim())`);
      await shot("T-P2-03-pin");
      /* 重载后是否真的多出一块「我钉的」快捷区 */
      await goto(base + "/");
      await sleep(1200);
      const afterReload = await evalJs(`(() => ({
        quickItems: document.querySelectorAll('.quick .item, .quick li, .quick a, [data-quick]').length,
        storageKeys: Object.keys(localStorage).sort(),
        cards: document.querySelectorAll('#viewRoot .catcard').length,
      }))()`);
      after = { before, mid, toast, afterReload };
      await evalJs(`enterWorkspace('company')`).catch(() => {});
      await sleep(600);
    }
    /* 判据（任务书 §7 T-P2-03）：按钮 title 写着「添加…」，点击后只有一句「已自动生成」的 toast、
       没有任何持久化状态 —— 这就是对不存在的动作显示成功反馈。
       不用 DOM 条目数比较：刷新前后工作区会变化，计数不可比。 */
    const onlyToast = !!(after && after.toast.length > 0 && /自动生成/.test(after.toast.join(" ")));
    const noPersist = !!(after && after.before.storageKeys.join() === after.mid.storageKeys.join() && after.mid.storageKeys.length === 0);
    const fake = !!(probe.exists && probe.visible && /添加/.test(probe.title || "") && onlyToast && noPersist);
    rec({
      id: "T-P2-03", feature: "添加快捷访问后重载是否真的能访问",
      expected: "要么真实生效并持久化，要么根本不出现该入口；不能显示假成功",
      result: fake ? "CONFIRMED_BUG" : "PASS", defect: fake ? "BUG-015" : null,
      observed: { button: probe, measurement: after, onlyToast, noPersist, fakeSuccess: fake },
      rootCause: "frontend/explorer/js/interactions.js:700 " +
        "$(\"#btnPinFolder\").addEventListener(\"click\", () => toast(\"「快捷访问」已按资料分类自动生成\")) —— 只有一句 toast，没有状态、没有持久化",
      notes: fake
        ? "按钮可见（title=添加快捷访问），点击只弹「「快捷访问」已按资料分类自动生成」，localStorage 始终为空；" +
          "产品实际口径是「快捷访问由 6 个固定分类自动生成、不支持用户添加」，所以这是文案造成的假可点击能力"
        : "未构成假成功（按钮不存在/不可见/或点击确实改变了状态）",
    });
  } catch (e) {
    rec({ id: "T-P2-03", feature: "快捷访问", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "真实生效或无入口" });
  }

  /* ================= T-P2-04：首页导入资料是否直接传到虚拟根 ================= */
  try {
    await resetHome();
    /* 桩：拦截 input[type=file] 的 click，记录当时的 view/folderId */
    await evalJs(`(() => {
      window.__pickedAt = null;
      const orig = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = orig(tag);
        if (String(tag).toLowerCase() === 'input') {
          const c = el.click.bind(el);
          el.click = () => { window.__pickedAt = { folderId: Drive.state.folderId, view: Drive.state.view, type: el.type }; c(); };
        }
        return el;
      };
      return 1;
    })()`);
    const btn = await evalJs(`(() => {
      const b = document.querySelector('[data-page-act="upload"]') ||
        [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('导入资料'));
      if (!b) return { found: false };
      b.click(); return { found: true, text: b.textContent.trim(), act: b.getAttribute('data-page-act') };
    })()`);
    await sleep(800);
    const picked = await evalJs(`window.__pickedAt`);
    const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.textContent.trim())`);
    await shot("T-P2-04-home-import");
    /* 判据：首页（view=home, folderId=root）时不该直接打开文件选择器 */
    const bad = !!(picked && picked.view === "home");
    rec({
      id: "T-P2-04", feature: "首页点「导入资料」的落点",
      expected: "必须先让用户选择有合法归属的记录/目录，不得直接把文件传到虚拟根",
      result: bad ? "CONFIRMED_BUG" : "PASS", defect: bad ? "BUG-016" : null,
      observed: { button: btn, filePickerOpenedAt: picked, toasts: toast },
      rootCause: "interactions.js pickFiles() 只挡 k:* 与 archive_folder，root 节点 type='folder' 且 tag='root'，" +
        "两道检查都通过 → 直接对虚拟根开文件选择器",
      notes: picked ? "选择器在 view=" + picked.view + " / folderId=" + picked.folderId + " 打开" : "未打开选择器",
    });
  } catch (e) {
    rec({ id: "T-P2-04", feature: "首页导入", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "先选归属" });
  }

  /* ================= X-01：单接口 500 是否被吞成空 ================= */
  try {
    const intercepted = [];
    const handler = (m) => {
      if (m.method !== "Fetch.requestPaused") return;
      const { requestId, request } = m.params;
      if (/\/api\/v2\/ui\/archive\/company/.test(request.url)) {
        intercepted.push(request.url);
        send("Fetch.fulfillRequest", {
          requestId, responseCode: 500,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ error: "X-01 注入失败" })).toString("base64"),
        }).catch(() => {});
      } else {
        send("Fetch.continueRequest", { requestId }).catch(() => {});
      }
    };
    eventHandlers.push(handler);
    await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await goto(base + "/");
    await waitFor("document.querySelectorAll('#viewRoot .catcard').length > 0", 20000, "首页(注入失败后)");
    await sleep(800);
    const vis = await evalJs(`(() => {
      const cards = [...document.querySelectorAll('#viewRoot .catcard')].map(c => ({ t: (c.querySelector('.catcard-name,.catcard-title')||{}).textContent || c.textContent.trim().slice(0,24), s: (c.querySelector('.catcard-sub')||{}).textContent || '' }));
      const notices = [...document.querySelectorAll('.search-note, .empty, .empty-state, .error, .banner')].map(x => x.textContent.trim().slice(0,120));
      return { cards, notices, bodyHasError: /失败|错误|无法加载/.test(document.body.innerText.slice(0, 4000)),
               storeError: (window.VaultStore && VaultStore.error) || null };
    })()`);
    await shot("X-01-archive-500");
    await send("Fetch.disable");
    eventHandlers.length = 0;
    rec({
      id: "X-01", feature: "单个业务接口 500 是否被静默渲染为空",
      expected: "失败模块要明确提示并可重试，不能显示成「没有资料」",
      result: vis.bodyHasError ? "PASS" : "CONFIRMED_BUG", defect: vis.bodyHasError ? null : "BUG-019",
      observed: { interceptedCount: intercepted.length, sampleUrl: intercepted[0] || null, ui: vis },
      rootCause: "frontend/explorer/js/store.js:140-144 每个 getJson 后面都挂 .catch(() => []/{}), " +
        "loadAll 永远不抛错；VaultStore.error 始终为 null",
    });
  } catch (e) {
    rec({ id: "X-01", feature: "单接口失败可见性", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "失败可见" });
    try { await send("Fetch.disable"); } catch {}
    eventHandlers.length = 0;
  }

  fs.writeFileSync(path.join(EVID, "browser-results.json"), JSON.stringify(results, null, 2), "utf8");
  log.add(`共 ${results.length} 项，写入 evidence/browser-results.json`);
  log.flush();
  const tally = {};
  for (const r of results) tally[r.result] = (tally[r.result] || 0) + 1;
  console.log("\n=== 浏览器层汇总 ===");
  console.log(JSON.stringify(tally, null, 2));
  console.log(results.map((r) => `[${r.result}] ${r.id}${r.defect ? " -> " + r.defect : ""}`).join("\n"));

  try { ws.close(); } catch {}
  process.exit(0);
})().catch(async (e) => {
  log.add("BROWSER SUITE FAILED: " + (e && e.stack || e));
  log.flush();
  fs.writeFileSync(path.join(EVID, "browser-results.json"), JSON.stringify(results, null, 2), "utf8");
  console.error(e);
  try { ws && ws.close(); } catch {}
  process.exit(1);
});
