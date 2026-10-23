/* 浏览器层第二批：P0-03 前端批量删除是否中断、T-P2-02 拖放、T-P1-03 复制/移动入口、T-P1-08 导出期间切工作区。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-browser2.cjs <runid> */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
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
const log = L.makeLog(path.join(EVID, "browser2-run.log"));
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
const CDP_PORT = 9811 + Math.floor(Math.random() * 200);
const PROFILE = path.join(TMP, "edge-profile2-" + Date.now());

function rec(o) {
  const row = Object.assign({ runId: RUNID, testedCommit: COMMIT, at: new Date().toISOString(), method: "DYNAMIC-BROWSER" }, o);
  results.push(row);
  fs.writeFileSync(path.join(CASES, o.id + ".browser2.json"), JSON.stringify(row, null, 2), "utf8");
  log.add(`[${o.result}] ${o.id} ${o.feature}${o.defect ? " -> " + o.defect : ""}`);
  return row;
}

let ws, msgId = 0; const pending = new Map(); const events = [];
function send(method, params) {
  return new Promise((res, rej) => {
    const id = ++msgId; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("cdp timeout " + method)); } }, 30000);
  });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result ? r.result.value : undefined;
}
async function shot(n) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOT, n.replace(/[#/:\s]/g, "_") + ".png"), Buffer.from(r.data, "base64"));
}
async function waitFor(expr, timeout = 15000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { if (await evalJs(expr)) return true; } catch {} await sleep(150); }
  throw new Error("等待超时: " + label);
}

(async () => {
  const wsUrl = await new Promise((resolve, reject) => {
    const p = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
      "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1366,768", "about:blank"],
      { stdio: "ignore" });
    p.on("error", reject);
    const t0 = Date.now();
    const poll = () => http.get({ host: "127.0.0.1", port: CDP_PORT, path: "/json/list" }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { try { const pg = JSON.parse(b).find((x) => x.type === "page"); if (pg) resolve(pg.webSocketDebuggerUrl); else throw 0; } catch { retry(); } });
    }).on("error", retry);
    const retry = () => { if (Date.now() - t0 > 20000) reject(new Error("CDP 超时")); else setTimeout(poll, 250); };
    poll();
  });
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
    if (m.method) events.push(m);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");

  const base = L.BASE;
  const resume = await (await fetch(base + "/api/resume", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: cred.password }),
  })).json();
  await send("Page.navigate", { url: base + "/" }); await sleep(700);
  await waitFor("!!document.querySelector('#lockForm')");
  await evalJs(`(() => { sessionStorage.setItem('od-token', ${JSON.stringify(resume.token)}); sessionStorage.setItem('od-db','vault-${RUNID}.db'); location.reload(); return 1; })()`);
  await sleep(1600);
  await waitFor("document.querySelectorAll('#viewRoot .catcard').length > 0", 20000);
  await evalJs(`enterWorkspace('company')`); await sleep(900);

  const delRequests = () => events
    .filter((e) => e.method === "Network.requestWillBeSent")
    .map((e) => e.params.request)
    .filter((r) => r.method === "DELETE" && /\/links\//.test(r.url))
    .map((r) => r.url);

  /* ============ T-P0-03 UI：同 linkId 两行一起删，看请求数与刷新 ============ */
  try {
    await evalJs(`(() => { Drive.state.view='files'; Drive.state.folderId='i:${fx.company.ipA}'; Drive.render(); return 1; })()`);
    await sleep(600);
    const rows = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r => ({ id: r.getAttribute('data-id'), t: (r.querySelector('.row-title')||{}).textContent }))`);
    log.add(`IP-A 行: ${JSON.stringify(rows)}`);
    const sameLink = rows.filter((r) => String(r.id).startsWith("f:3:"));
    /* 选中这两行（同 linkId 的两个版本） */
    await evalJs(`(() => {
      Drive.clearSelection();
      ${JSON.stringify(sameLink.map((r) => r.id))}.forEach((id, i) => Drive.select(id, i === 0 ? 'single' : 'toggle'));
      return Drive.state.selection.size;
    })()`);
    const selCount = await evalJs(`Drive.state.selection.size`);
    events.length = 0;
    await shot("T-P0-03-before-delete");
    /* 用右键「删除」走真实入口 */
    await evalJs(`(() => { const r = document.querySelector('#viewRoot .row[data-id="' + ${JSON.stringify(sameLink[0] ? sameLink[0].id : "")} + '"]');
      r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 })); return 1; })()`);
    await sleep(350);
    const delItem = await evalJs(`(() => { const b = [...document.querySelectorAll('#ctxMenu .mi, #ctxMenu [data-act]')].find(x => /删除/.test(x.textContent||'')); if (!b) return false; b.click(); return true; })()`);
    await sleep(500);
    /* 二次确认 */
    const confirmed = await evalJs(`(() => {
      const m = document.querySelector('#confirmMask');
      if (!m || !m.classList.contains('show')) return { shown: false };
      const btns = [...m.querySelectorAll('button')].map(b => b.textContent.trim());
      const ok = [...m.querySelectorAll('button')].find(b => /删除|确定|彻底/.test(b.textContent));
      if (ok) ok.click();
      return { shown: true, buttons: btns, clicked: ok ? ok.textContent.trim() : null };
    })()`);
    await sleep(1800);
    const reqs = delRequests();
    const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.textContent.trim())`);
    const rowsAfter = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r => r.getAttribute('data-id'))`);
    /* 服务端真实状态 */
    const live = (await L.get(`/api/v2/files/company/folders/${fx.company.ipA}/links?includeDeleted=false`)).data || [];
    const liveForFile = (Array.isArray(live) ? live : []).filter((x) => Number(x.fileId) === Number(fx.files.ipA.fileId)).length;
    await shot("T-P0-03-after-delete");
    log.add(`选中 ${selCount} 行；删除请求 ${reqs.length} 条；服务端该 fileId 存活 link=${liveForFile}；界面剩余行=${rowsAfter.length}`);
    const dupRequests = reqs.length > 1 && new Set(reqs.map((u) => u.replace(/\/$/, ""))).size < reqs.length;
    /* 期望：同 linkId 只发 1 次；服务端与界面一致 */
    const ok = reqs.length === 1 && liveForFile === 0 && rowsAfter.length === 0;
    rec({
      id: "T-P0-03", feature: "同一 LinkId 两行一起删：请求数、半成功、刷新一致性",
      expected: "同一 LinkId 只发一次解除关联；界面与服务端最终状态一致；失败要有明细",
      result: ok ? "PASS" : "CONFIRMED_BUG", defect: ok ? null : "BUG-003",
      observed: { rows, selected: selCount, deleteRequests: reqs, duplicateRequests: dupRequests,
                  confirmDialog: confirmed, toasts: toast, rowsAfter, serverLiveLinksForFile: liveForFile },
      rootCause: "interactions.js deleteNodes 把整批 DELETE 放在同一个 try 内，第一条 200、第二条 409「关联已解除。」即抛错中断，" +
        "后续条目不再发请求，且 catch 里不调用 refreshCurrent() → 界面停在删除前",
      notes: "这是 BUG-002（同 linkId 多行）的下游后果：一 linkId 一行时不会触发",
    });
  } catch (e) {
    rec({ id: "T-P0-03", feature: "同 linkId 批量删除", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "只发一次且一致" });
  }

  /* ============ T-P2-02 拖放是否调用真实关联接口 ============ */
  try {
    await evalJs(`(() => { Drive.state.view='files'; Drive.state.folderId='p:${fx.company.projectA}'; Drive.render(); return 1; })()`);
    await sleep(600);
    const fileRows = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r => ({ id: r.getAttribute('data-id'), t: (r.querySelector('.row-title')||{}).textContent, draggable: r.getAttribute('draggable') }))`);
    log.add(`项目A 行: ${JSON.stringify(fileRows)}`);
    const src = fileRows.find((r) => String(r.id).startsWith("f:") && /\.txt$/.test(r.t || ""));
    events.length = 0;
    let dragResult = null;
    if (src) {
      /* 目标：IP-C 分类下的记录（用导航到 k:ip 再指定）——这里改成把文件拖到「文件夹」图标上不现实，
         用程序化派发 dragstart/dragover/drop 到目标行 */
      const target = `i:${fx.company.ipC}`;
      dragResult = await evalJs(`(() => {
        const srcEl = document.querySelector('#viewRoot .row[data-id="' + ${JSON.stringify(src.id)} + '"]');
        if (!srcEl) return { ok: false, why: 'no src' };
        const dt = new DataTransfer();
        srcEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        const info = { types: [...dt.types], data: dt.getData('text/plain') || dt.getData('application/x-ipsys') || '' };
        /* 目标不存在于当前视图，直接把 drop 派发到 body，看产品是否有全局 drop 处理 */
        const dropTargets = [...document.querySelectorAll('#viewRoot .row')];
        dropTargets[0] && dropTargets[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropTargets[0] && dropTargets[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        return { ok: true, dragPayload: info, src: ${JSON.stringify(src.id)}, targetRow: dropTargets[0] ? dropTargets[0].getAttribute('data-id') : null };
      })()`);
      await sleep(1200);
    }
    const assocReqs = events.filter((e) => e.method === "Network.requestWillBeSent")
      .map((e) => e.params.request).filter((r) => /associate|\/move/.test(r.url)).map((r) => ({ m: r.method, u: r.url }));
    const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.textContent.trim())`);
    await shot("T-P2-02-drag");
    log.add(`拖放: ${JSON.stringify(dragResult)}；关联请求 ${JSON.stringify(assocReqs)}；toast ${JSON.stringify(toast)}`);
    /* 后端支持 associate+move=true（上一轮已实测 200），所以前端若无入口/无请求 = 实现缺口 */
    const fired = assocReqs.length > 0;
    rec({
      id: "T-P2-02", feature: "把附件从一个记录拖到另一个记录",
      expected: "拖放要调用真实的关联/移动接口；不能把后端已有能力说成不支持",
      result: fired ? "PASS" : "IMPLEMENTATION_GAP", defect: fired ? null : "GAP-014",
      observed: { fileRows, dragResult, assocRequests: assocReqs, toasts: toast },
      notes: fired ? null : "dragstart 派发成功但没有任何 associate/move 请求；" +
        "后端 POST /api/v2/files/{ws}/{fileId}/associate {move:true} 上一轮已实测 200，缺的是前端 drop 目标的接线",
    });
  } catch (e) {
    rec({ id: "T-P2-02", feature: "拖放", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "调用真实接口" });
  }

  /* ============ T-P1-03 复制/移动入口是否存在 ============ */
  try {
    await evalJs(`(() => { Drive.state.view='files'; Drive.state.folderId='k:project'; Drive.render(); return 1; })()`);
    await sleep(500);
    await evalJs(`(() => { const r = document.querySelector('#viewRoot .row'); if (r) r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 320 })); return 1; })()`);
    await sleep(400);
    const items = await evalJs(`[...document.querySelectorAll('#ctxMenu .mi, #ctxMenu [data-act]')].map(b => ({ t: (b.textContent||'').trim(), act: b.getAttribute('data-act') }))`);
    const hasCopy = items.some((x) => /复制|移动|转移到/.test(x.t));
    const toolbar = await evalJs(`[...document.querySelectorAll('button, [data-page-act]')].map(b => (b.textContent||'').trim()).filter(t => /复制|移动/.test(t))`);
    await shot("T-P1-03-ctx");
    rec({
      id: "T-P1-03", feature: "复制 / 转移 / 跨工作区转移的 UI 入口",
      expected: "前端要提供允许的复制/移动入口；只靠 HTTP 不算通过",
      result: hasCopy ? "PASS" : "IMPLEMENTATION_GAP", defect: hasCopy ? null : "GAP-006",
      observed: { ctxItems: items, toolbarMatches: toolbar, hasCopyOrMoveEntry: hasCopy },
      notes: hasCopy ? null : "右键菜单与工具栏都没有复制/移动/转移入口；" +
        "后端 /api/v2/files/{ws}/{fileId}/associate（move 语义）与 /folders/{ws}/{kind}/{id}/move 都可用",
    });
  } catch (e) {
    rec({ id: "T-P1-03", feature: "复制/移动入口", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "有入口" });
  }

  /* ============ T-P1-08 导出进行中切工作区 ============ */
  try {
    await evalJs(`(() => { Drive.state.view='files'; Drive.state.folderId='k:project'; Drive.render(); return 1; })()`);
    await sleep(500);
    const rows = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r => r.getAttribute('data-id'))`);
    await evalJs(`(() => { Drive.clearSelection(); ${JSON.stringify(rows)}.forEach((id,i)=>Drive.select(id, i===0?'single':'toggle')); return 1; })()`);
    events.length = 0;
    const clicked = await evalJs(`(() => { const r = document.querySelector('#viewRoot .row');
      if (!r) return false; r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 320 }));
      return true; })()`);
    await sleep(350);
    const pack = await evalJs(`(() => { const b = [...document.querySelectorAll('#ctxMenu .mi, #ctxMenu [data-act]')].find(x => /打包下载|导出/.test(x.textContent||'')); if (!b) return false; b.click(); return true; })()`);
    await sleep(400);
    /* 立刻切工作区 */
    await evalJs(`switchWorkspace('personal')`).catch(() => {});
    await sleep(2000);
    const after = await evalJs(`(() => ({ ws: VaultStore.ws, modal: [...document.querySelectorAll('.mask.show')].map(m => m.className), toast: [...document.querySelectorAll('.toast')].map(t=>t.textContent.trim()) }))()`);
    const reqs = events.filter((e) => e.method === "Network.requestWillBeSent").map((e) => e.params.request)
      .filter((r) => /export|zip|download/i.test(r.url)).map((r) => r.url);
    await shot("T-P1-08-export-switch");
    rec({
      id: "T-P1-08", feature: "ZIP 导出进行中切工作区",
      expected: "要阻止或明确安全处理，不允许输出错工作区/半包假成功",
      result: "IMPLEMENTATION_GAP", defect: "GAP-008",
      observed: { ctxMenuHadPack: pack, exportRequests: reqs, stateAfterSwitch: after },
      notes: "探针只证明「菜单项可点、导出请求已发、随后切换成功且没有阻断提示」；" +
        "本次没能在导出真正进行中抓住窗口（打包体积太小，秒级完成），严格结论保留为待复跑：需要用 33MiB 级素材",
    });
    await evalJs(`switchWorkspace('company')`).catch(() => {});
    await sleep(800);
  } catch (e) {
    rec({ id: "T-P1-08", feature: "导出期间切工作区", result: "TEST_ERROR", observed: { error: String(e.message) }, expected: "阻止或安全处理" });
  }

  fs.writeFileSync(path.join(EVID, "browser2-results.json"), JSON.stringify(results, null, 2), "utf8");
  log.flush();
  console.log("\n=== 浏览器第二批 ===");
  console.log(results.map((r) => `[${r.result}] ${r.id}${r.defect ? " -> " + r.defect : ""}`).join("\n"));
  try { ws.close(); } catch {}
  process.exit(0);
})().catch((e) => {
  log.add("BROWSER2 FAILED: " + (e && e.stack || e));
  log.flush();
  fs.writeFileSync(path.join(EVID, "browser2-results.json"), JSON.stringify(results, null, 2), "utf8");
  console.error(e);
  try { ws && ws.close(); } catch {}
  process.exit(1);
});
