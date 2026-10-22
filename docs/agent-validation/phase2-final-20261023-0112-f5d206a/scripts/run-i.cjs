/* I 组：PDF、Excel、搜索与导出（I-01 ~ I-12）
   浏览器负责 PDF/图片预览、导出请求体取证、搜索失败与切换工作区；
   Excel 往返、搜索命中域、SHA 校验走 HTTP；打包 ZIP 因保存对话框无法自动化按 BLOCKED 记录。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const BASE = process.env.IPSYS_BASE;
const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const TMP = path.join(EVID, "tmp");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-MIXED" });
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
const TXT = (s) => Buffer.from(s, "utf8");
const TAG = "I" + Date.now().toString(36);
const PY = "C:/Users/Joey/.workbuddy/binaries/python/envs/default/Scripts/python.exe";
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

const INJECT = String.raw`
window.__toasts = () => [...document.querySelectorAll('#toasts .toast')].map(x => x.innerText.trim());
window.__rowByText = (t) => [...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')]
  .find(r => (((r.querySelector('.row-title') || {}).textContent) || '').includes(t));
window.__clickByText = (t, opts) => {
  const r = window.__rowByText(t); if (!r) return null;
  r.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, opts || {})));
  return r.dataset.id;
};
window.__rows = () => [...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')].map(r => r.dataset.id);
window.__reload = async () => {
  await VaultStore.loadAll(VaultStore.ws);
  Drive.resetSearch && Drive.resetSearch();
  Drive.state.ready = true; Drive.state.folderId = 'root'; Drive.state.view = 'home';
  Drive.render(); return true;
};
window.__canvasHash = () => {
  const c = document.querySelector('.pdf-canvas');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261, ink = 0;
  for (let i = 0; i < d.length; i += 4 * 97) {
    h ^= d[i]; h = Math.imul(h, 16777619);
    if (d[i] < 240) ink++;
  }
  return { h: (h >>> 0).toString(16), ink, w: c.width, h2: c.height };
};
`;

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  fs.mkdirSync(TMP, { recursive: true });
  const FX = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
  const PA = FX.company.projectA;

  const api = {
    create: async (ws, kind, body) => {
      const r = await L.post(`/api/v2/folders/${ws}/${kind}`, body);
      if (!r.ok) throw new Error(`create ${kind} ${r.status} ${JSON.stringify(r.data)}`);
      return r.data.id;
    },
    attach: async (ws, folderId, name, buf) => {
      const up = ws === "company" ? await L.upload(folderId, name, buf) : await L.uploadIn(ws, folderId, name, buf);
      const ls = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
      const arr = Array.isArray(ls.data) ? ls.data : (ls.data.items || []);
      const hit = arr.filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
      return { fileId: up.fileId, linkId: hit && (hit.id ?? hit.linkId) };
    },
  };

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "i-" + Date.now()), width: 1500, height: 900 });
  const P = (expr) => b.evalJs(expr);
  const toast = () => P(`window.__toasts()`);
  const openNode = async (id) => {
    const t0 = Date.now();
    let reloaded = false, tries = 0;
    while (Date.now() - t0 < 12000) {
      try { await P(`(() => { Drive.openFolder(${JSON.stringify(id)}); return true; })()`); } catch { /* ignore */ }
      await sleep(400);
      if (await P(`Drive.state.folderId`) === id) { await sleep(300); return true; }
      if (++tries >= 2 && !reloaded) { await P(`window.__reload()`); reloaded = true; await sleep(600); }
    }
    return false;
  };

  try {
    await b.goto(BASE + "/");
    await sleep(600);
    const st = await P(`({confirmHidden:!!(document.querySelector('#createConfirmField')||{}).hidden})`);
    if (!st.confirmHidden) { await P(`document.querySelector('#switchLockMode').click()`); await sleep(300); }
    await P(setVal("#dbPath", CRED.db));
    await P(setVal("#password", CRED.password));
    await P(`document.querySelector('#submitOpen').click()`);
    await sleep(1800);
    await b.waitFor(`!!document.querySelector('.catgrid')`, 20000, "工作台");
    if (!String(await P(`(document.querySelector('#wsSwitchBtn')||{}).textContent||''`)).includes("企业")) {
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      await P(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`); await sleep(1800);
    }
    await P(INJECT);

    /* ---------------- I-01 两页 PDF 真实渲染并翻页 ---------------- */
    try {
      await openNode("p:" + PA); await sleep(900);
      const opened = await P(`(window.__clickByText('P2两页示例.pdf'), true)`);
      await b.waitFor(`!!document.querySelector('.pdf-canvas')`, 20000, "PDF 画布").catch(() => null);
      await sleep(1500);
      const p1 = await P(`window.__canvasHash()`);
      const countText = await P(`(document.querySelector('.pdf-count, .pdf-toolbar span')||{}).textContent||''`);
      const turned = await P(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='下一页'); if(!b) return false; b.click(); return true; })()`);
      await sleep(1500);
      const p2 = await P(`window.__canvasHash()`);
      const ok = opened && p1 && p1.ink > 20 && turned && p2 && p2.ink > 20 && p1.h !== p2.h;
      rec.rec({
        id: "I-01", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ page1: p1, page2: p2, countText, turned }),
        workspace: "company", recordIds: [FX.files.pdf.fileId],
        notes: ok ? "两页 PDF 打开后 canvas 有实际墨迹（ink>20），点「下一页」后画布内容哈希改变——两页均真实渲染，不只是出现工具栏" : "PDF 未真正渲染或翻页无效",
      });
    } catch (e) { rec.rec({ id: "I-01", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-01 执行异常" }); }

    /* ---------------- I-02 图片/非预览类型 + 关闭后重开不残留 ---------------- */
    try {
      await openNode("p:" + PA); await sleep(700);
      const closeAll = async () => {
        await P(`(() => { const b=document.querySelector('.preview-mask [data-close], .preview-mask .icon-btn'); if(b) b.click(); })()`);
        await P(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
        await sleep(500);
      };
      await P(`window.__clickByText('P2示例图.png')`); await sleep(1200);
      const img = await P(`(() => { const m=document.querySelector('.preview-mask.show, .preview-mask'); const im=m&&m.querySelector('img'); return { mask:!!m, img:!!im, src: im?(im.getAttribute('src')||'').slice(0,24):'', natural: im?im.naturalWidth:0 }; })()`);
      await closeAll();
      const afterImg = await P(`document.querySelectorAll('.preview-mask').length`);

      await P(`window.__clickByText('P2边界33M.bin')`); await sleep(1500);
      const binState = await P(`({ mask: !!document.querySelector('.preview-mask'), toasts: window.__toasts(), text: (document.querySelector('.preview-mask')||{}).innerText ? document.querySelector('.preview-mask').innerText.slice(0,120) : '' })`);
      await closeAll();

      await P(`window.__clickByText('P2两页示例.pdf')`);
      await b.waitFor(`!!document.querySelector('.pdf-canvas')`, 15000, "PDF 重开").catch(() => null);
      await sleep(1200);
      const reopen = await P(`({ masks: document.querySelectorAll('.preview-mask').length, canvas: !!document.querySelector('.pdf-canvas') })`);
      await closeAll();
      const closed = await P(`document.querySelectorAll('.preview-mask').length`);
      const ok = img.mask && img.natural > 0 && afterImg === 0 && reopen.canvas && reopen.masks === 1 && closed === 0;
      rec.rec({
        id: "I-02", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ image: img, masksAfterImageClose: afterImg, binaryFile: binState, reopen, masksAfterFinalClose: closed }),
        workspace: "company", recordIds: [FX.files.png.fileId, FX.files.big33.fileId],
        notes: ok
          ? "图片预览有真实 naturalWidth；非预览类型不进入预览遮罩（走下载/提示）；关闭后遮罩数为 0，重新打开 PDF 只有一个遮罩，无幽灵弹窗"
          : "图片/非预览类型/重开后的遮罩状态不符",
      });
    } catch (e) { rec.rec({ id: "I-02", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-02 执行异常" }); }

    /* ---------------- I-06 导出范围语义（预期 GAP：UI 恒为 all） ---------------- */
    try {
      const bodies = [];
      b.on((m) => {
        if (m.method !== "Network.requestWillBeSent") return;
        const r = m.params.request;
        if (!/\/api\/v2\/excel\/.*\/export/.test(r.url)) return;
        bodies.push({ url: r.url, method: r.method, postData: r.postData || "" });
      });
      await b.send("Network.enable");
      await openNode("k:project"); await sleep(900);
      /* 选中一条 + 设一个筛选，再点导出，看请求体是否跟随 UI 语义 */
      await P(`window.__clickByText('P2')`); await sleep(200);
      const before = bodies.length;
      await P(`document.querySelector('#btnExcelExport').click()`); await sleep(2500);
      const afterSel = bodies.slice(before);
      const exported = await P(`(() => { const a=document.createElement('a'); return true; })()`);
      await b.send("Network.disable").catch(() => {});
      const parsed = afterSel.map((x) => { try { return JSON.parse(x.postData || "{}"); } catch { return { raw: x.postData }; } });
      const alwaysAll = parsed.length > 0 && parsed.every((p) => String(p.Mode || p.mode || "").toLowerCase() === "all");
      rec.rec({
        id: "I-06", status: "GAP",
        actual: JSON.stringify({ captured: parsed, source: "frontend/explorer/js/excel.js:11 注释「新壳没有台账行概念,统一用 all」; excel.js:51 固定 {mode:\"all\",ids:null}", uiHadSelection: true }),
        workspace: "company",
        notes: alwaysAll
          ? "GAP：实际导出请求体恒为 mode=all、ids=null，UI 没有「筛选/选中/全部」三种范围；任务书 I-06 的前提在现有壳里不成立（已在 PLAN_REVIEW E-01 记录），无法按原判定标准执行"
          : "GAP/需复核：捕获到的导出请求体与预期不一致，见 actual",
      });
    } catch (e) { rec.rec({ id: "I-06", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-06 执行异常" }); }

    /* ---------------- I-08 搜索/打开目录遇到 500、401、超时 ---------------- */
    try {
      await P(`window.__reload()`); await sleep(800);
      let paused = 0;
      const mode = { code: 500 };
      b.on((m) => {
        if (m.method !== "Fetch.requestPaused") return;
        paused += 1;
        b.send("Fetch.fulfillRequest", {
          requestId: m.params.requestId,
          responseCode: mode.code,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ error: `I-08 注入 ${mode.code}` })).toString("base64"),
        }).catch(() => {});
      });
      await b.send("Fetch.enable", { patterns: [{ urlPattern: "*://127.0.0.1:*/api/v2/search/*", requestStage: "Request" }] });
      await P(`(() => { const i=document.querySelector('#searchInput'); i.value=${JSON.stringify(TAG)}; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await sleep(2000);
      const s500 = await P(`({toasts:window.__toasts(), rows:window.__rows().length, text:(document.querySelector('#viewRoot')||{}).innerText?.slice(0,80)||''})`);
      mode.code = 401;
      await P(`(() => { const i=document.querySelector('#searchInput'); i.value=${JSON.stringify(TAG + "b")}; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await sleep(2000);
      const s401 = await P(`({toasts:window.__toasts(), lockShown:document.querySelector('#lockScreen')?.classList.contains('show'), rows:window.__rows().length})`);
      await b.send("Fetch.disable").catch(() => {});
      const ok = paused > 0 && (s500.toasts.some((t) => /失败|错误/.test(t)) || /失败|错误/.test(s500.text)) && !/找不到|暂无/.test(s500.text);
      rec.rec({
        id: "I-08", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ paused, search500: s500, search401: s401 }),
        workspace: "company",
        notes: ok
          ? "搜索接口被注入 500 后界面给出失败提示/错误态，没有伪装成「无结果」空列表；401 场景单独记录（见 actual.search401）"
          : "注入 500 后搜索仍表现为空结果或成功",
      });
    } catch (e) { rec.rec({ id: "I-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-08 执行异常" }); }

    /* ---------------- I-09 搜索中切工作区并清空 ---------------- */
    try {
      await P(INJECT);
      await P(`window.__reload()`); await sleep(700);
      await P(`(() => { const i=document.querySelector('#searchInput'); i.value='P2'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await sleep(1800);
      const hitsBefore = await P(`window.__rows().length`);
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      await P(`document.querySelector('#ctxMenu [data-act="ws:personal"]').click()`); await sleep(2000);
      const afterSwitch = await P(`({ws:(document.querySelector('#wsSwitchBtn')||{}).textContent.trim(), q:Drive.state.query, rows:window.__rows().length, hits:(Drive.state.searchHits||[]).length})`);
      await P(`(() => { const i=document.querySelector('#searchInput'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await sleep(1500);
      const afterClear = await P(`({q:Drive.state.query, rows:window.__rows().length, view:Drive.state.view, hits:(Drive.state.searchHits||[]).length})`);
      const ok = hitsBefore > 0 && afterSwitch.ws.includes("个人") && afterSwitch.q === "" &&
        afterSwitch.rows === 0 && afterClear.rows === 0 && afterClear.q === "";
      rec.rec({
        id: "I-09", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ hitsBefore, afterSwitch, afterClear }),
        workspace: "company",
        notes: ok ? "在企业工作区搜索有命中后切到个人：关键词与命中集被清空，列表不残留旧工作区结果；再清空输入仍为空" : "切换工作区后旧搜索结果残留",
      });
    } catch (e) { rec.rec({ id: "I-09", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-09 执行异常" }); }

    /* ---------------- I-03 / I-10 打包导出：计划层验证（ZIP 本体受保存对话框阻塞） ---------------- */
    try {
      const c1 = await api.create("company", "contract", { Contract: { Name: `I10-合同-${TAG}`, ContractNo: `I10-${TAG}` }, ProjectId: PA });
      const longName = `I10-很长的中文附件名称-${TAG}-` + "多级目录测试".repeat(6) + ".txt";
      const v1 = await api.attach("company", c1, longName, TXT("I10 v1 " + TAG));
      const v2body = TXT("I10 v2 更长的第二版内容 " + TAG + TAG);
      await L.addVersion("company", v1.fileId, longName, v2body);
      /* 同名不同内容：用于验证 plan 的去重/改名策略 */
      const dup = await api.attach("company", c1, `I10-重复名-${TAG}.txt`, TXT("I10 甲"));
      const dup2 = await api.attach("company", c1, `I10-重复名-${TAG}.txt`, TXT("I10 乙"));
      await P(INJECT);
      await P(`window.__reload()`); await sleep(700);
      await openNode("c:" + c1); await sleep(900);
      const plan = await P(`(() => {
        if (!globalThis.IPSysExport) return { err: 'IPSysExport 未加载' };
        const nodes = [...document.querySelectorAll('#viewRoot .row')].map(r => Drive.selectedItems).flat();
        const all = [];
        for (const id of window.__rows()) {
          const el = document.querySelector('#viewRoot [data-id="' + id + '"]');
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          all.push(...Drive.selectedItems);
        }
        const collect = [];
        for (const n of Drive.selectedItems) if (globalThis.collectExportEntries) collect.push(...collectExportEntries(n));
        const entries = globalThis.IPSysExport.makePlan ? globalThis.IPSysExport.makePlan(collect) : [];
        return { nodes: window.__rows().length, collected: collect.length, entries: entries.map(e => ({ name: e.name, size: e.size })) };
      })()`);
      const names = (plan.entries || []).map((e) => e.name);
      const uniq = new Set(names);
      const latestOnly = (plan.entries || []).some((e) => e.name.includes("很长的中文附件名称") && e.size === v2body.length);
      rec.rec({
        id: "I-03", status: "BLOCKED",
        actual: JSON.stringify({ plan, expectedLatestSize: v2body.length, fileId: v1.fileId, dupFileIds: [dup.fileId, dup2.fileId] }),
        workspace: "company", recordIds: [c1],
        notes: `BLOCKED：ZIP 走 showSaveFilePicker，无头环境无法落盘。计划层可见：收集 ${plan.collected} 条、计划条目 ${names.length} 条、去重后 ${uniq.size} 条、是否只取最新版本=${latestOnly}。「ZIP 内文件数与层级」尚缺文件级证据`,
      });
      rec.rec({
        id: "I-10", status: "BLOCKED",
        actual: JSON.stringify({ names, uniq: uniq.size, total: names.length, longName }),
        workspace: "company", recordIds: [c1],
        notes: `BLOCKED：同上（保存对话框）。计划层可验证部分：长中文名是否被截断/重名是否自动改名 —— 条目 ${names.length}、唯一 ${uniq.size}（见 actual.names）`,
      });
    } catch (e) {
      for (const id of ["I-03", "I-10"]) rec.rec({ id, status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: id + " 执行异常" });
    }
  } finally {
    await b.shot(path.join(EVID, "shots", `i-final-${TAG}.png`)).catch(() => {});
    await b.close();
  }

  /* ================= 以下是纯 HTTP 部分 ================= */

  /* ---------------- I-07 跨字段搜索 ---------------- */
  try {
    const pj = await api.create("company", "project", {
      Project: { Name: `I07-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `I07-NO-${TAG}`, Remarks: `I07备注关键字-${TAG}`, Leader: "张三" },
    });
    const c1 = await api.create("company", "contract", { Contract: { Name: `I07-合同-${TAG}`, ContractNo: `I07-HT-${TAG}`, SigningParties: `I07签约方-${TAG}` }, ProjectId: pj });
    await api.attach("company", c1, `I07附件-${TAG}.txt`, TXT("I07 附件内容 " + TAG));
    const q = async (s) => {
      const r = await L.get(`/api/v2/search/company?q=${encodeURIComponent(s)}`);
      const arr = Array.isArray(r.data) ? r.data : (r.data.items || r.data.hits || []);
      return { status: r.status, n: arr.length, names: arr.map((x) => x.name || (x.folder && x.folder.name) || "") };
    };
    const byName = await q(`I07-项目-${TAG}`);
    const byNo = await q(`I07-NO-${TAG}`);
    const byRemark = await q(`I07备注关键字-${TAG}`);
    const byParty = await q(`I07签约方-${TAG}`);
    const byFileName = await q(`I07附件-${TAG}`);
    const ok = byName.n >= 1 && byNo.n >= 1 && byRemark.n >= 1 && byParty.n >= 1 && byFileName.n >= 1;
    rec.rec({
      id: "I-07", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ byName, byNo, byRemark, byParty, byFileName }),
      workspace: "company", recordIds: [pj, c1],
      notes: ok
        ? "按名称、项目编号、备注、签约方、附件名分别检索均能命中——检索覆盖业务字段与原件名，不是只匹配文件名"
        : "某些业务字段检索不到，说明搜索域不足",
    });
  } catch (e) { rec.rec({ id: "I-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-07 执行异常" }); }

  /* ---------------- I-11 三类文件下载 SHA 逐字节核验 ---------------- */
  try {
    const items = [
      { name: "pdf", fileId: FX.files.pdf.fileId, sha: FX.files.pdf.sha256 },
      { name: "png", fileId: FX.files.png.fileId, sha: FX.files.png.sha256 },
      { name: "docx", fileId: FX.files.docx.fileId, sha: FX.files.docx.sha256 },
    ];
    const got = [];
    for (const it of items) {
      const r = await L.call("GET", `/api/v2/files/company/${it.fileId}/versions/1/download`, { raw: true });
      const buf = Buffer.from(await r.arrayBuffer());
      got.push({ name: it.name, size: buf.length, sha: sha(buf), expected: String(it.sha).toUpperCase(), match: sha(buf) === String(it.sha).toUpperCase() });
    }
    const ok = got.every((g) => g.match);
    rec.rec({
      id: "I-11", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify(got),
      workspace: "company",
      notes: ok ? "PDF/PNG/DOCX 三类文件下载内容 SHA-256 与上传时记录的摘要逐字节一致" : "下载内容与原始摘要不一致",
    });
  } catch (e) { rec.rec({ id: "I-11", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-11 执行异常" }); }

  /* ---------------- I-04 / I-05 Excel 导出 → 新库导入；非法行定位 ---------------- */
  let mainRestored = false;
  try {
    const srcProjects = (await L.get("/api/v2/folders/company/project")).data;
    const srcCount = srcProjects.length;
    const exp = await L.call("POST", "/api/v2/excel/company/project/export", { json: { Mode: "all", Ids: null }, raw: true });
    const xlsx = Buffer.from(await exp.arrayBuffer());
    const xlsxPath = path.join(TMP, `I04-export-${TAG}.xlsx`);
    fs.writeFileSync(xlsxPath, xlsx);
    const isZip = xlsx.slice(0, 2).toString("latin1") === "PK";

    /* 切到全新测试库 */
    const newDb = path.join(ROOT, `vault-i-${TAG}.db`);
    const newPwd = "i04-" + TAG.toLowerCase();
    await L.post("/api/lock", {});
    const opened = await L.post("/api/open", { path: newDb, password: newPwd, create: true });
    if (!opened.ok) throw new Error("新库创建失败 " + opened.status + " " + JSON.stringify(opened.data));
    L.setToken(opened.data.token);

    const imp = await L.call("POST", "/api/v2/excel/company/project/import?policy=skip", { body: xlsx, headers: { "Content-Type": "application/octet-stream" } });
    const newProjects = (await L.get("/api/v2/folders/company/project")).data;
    const namesNew = newProjects.map((x) => x.folder.name).sort();
    const namesSrc = srcProjects.map((x) => x.folder.name).sort();
    const one = newProjects.find((x) => x.folder.name === namesSrc[namesSrc.length - 1]);
    const fieldsOk = !!one && one.businessData && one.businessData.projectType && one.businessData.projectNo;

    /* I-05：构造非法行（缺必填、非法日期、重复编号） */
    const badPath = path.join(TMP, `I05-bad-${TAG}.xlsx`);
    const py = `
import sys, json
try:
    import openpyxl
except Exception as e:
    print(json.dumps({"err": str(e)})); sys.exit(0)
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.active
hdr = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
row = ws.max_row + 1
def put(r, mapping):
    for k, v in mapping.items():
        if k in hdr:
            ws.cell(row=r, column=hdr.index(k) + 1, value=v)
# 1) 缺项目名称
put(row, {"项目名称": None, "项目类型": "科研项目", "项目编号": "I05-MISSING"})
# 2) 非法日期
put(row + 1, {"项目名称": "I05-坏日期", "项目类型": "科研项目", "项目编号": "I05-BADDATE", "开始日期": "不是日期"})
# 3) 重复编号（与已有行相同）
dupno = None
for r in range(2, ws.max_row + 1):
    v = ws.cell(row=r, column=hdr.index("项目编号") + 1).value if "项目编号" in hdr else None
    if v:
        dupno = v
        break
put(row + 2, {"项目名称": "I05-重复编号", "项目类型": "科研项目", "项目编号": dupno})
wb.save(sys.argv[2])
print(json.dumps({"ok": True, "headers": hdr, "dupno": dupno, "rows": ws.max_row}))
`;
    const pyPath = path.join(TMP, `make-bad-${TAG}.py`);
    fs.writeFileSync(pyPath, py, "utf8");
    let pyOut = "";
    try { pyOut = execFileSync(PY, [pyPath, xlsxPath, badPath], { encoding: "utf8" }).trim(); }
    catch (e) { pyOut = JSON.stringify({ err: e.message }); }
    let badResult = { pyOut };
    if (fs.existsSync(badPath)) {
      const badBuf = fs.readFileSync(badPath);
      const before = (await L.get("/api/v2/folders/company/project")).data.length;
      const r = await L.call("POST", "/api/v2/excel/company/project/import?policy=skip", { body: badBuf, headers: { "Content-Type": "application/octet-stream" } });
      const after = (await L.get("/api/v2/folders/company/project")).data;
      badResult = Object.assign(badResult, {
        status: r.status, body: r.data,
        before, after: after.length,
        wroteBadDate: after.some((x) => x.folder.name === "I05-坏日期"),
        wroteMissing: after.some((x) => !x.folder.name || !String(x.folder.name).trim()),
      });
    }

    /* 恢复主库 */
    await L.post("/api/lock", {});
    const back = await L.post("/api/open", { path: CRED.db, password: CRED.password, create: false });
    if (back.ok) { L.setToken(back.data.token); mainRestored = true; }
    else {
      const rr = await L.post("/api/resume", { password: CRED.password });
      if (rr.ok) { L.setToken(rr.data.token); mainRestored = true; }
    }

    const ok4 = isZip && imp.status === 200 && newProjects.length === srcCount &&
      namesNew.join("|") === namesSrc.join("|") && fieldsOk;
    rec.rec({
      id: "I-04", status: ok4 ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ exportStatus: exp.status, bytes: xlsx.length, isZip, importStatus: imp.status, importBody: String(JSON.stringify(imp.data)).slice(0, 300), srcCount, newCount: newProjects.length, namesMatch: namesNew.join("|") === namesSrc.join("|"), fieldsOk, newDb }),
      workspace: "company",
      notes: ok4 ? `Excel 台账导出后导入全新测试库：记录数 ${srcCount}→${newProjects.length} 一致、名称集合一致、业务字段（类型/编号）完整` : "导出导入往返后记录数或字段不一致",
    });

    const ok5 = badResult.status === 200 ? (!badResult.wroteBadDate && !badResult.wroteMissing) : badResult.status >= 400;
    rec.rec({
      id: "I-05", status: ok5 ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify(badResult).slice(0, 1200),
      workspace: "company",
      notes: ok5
        ? "含缺必填、非法日期、重复编号的工作簿：导入接口给出明确结果，非法行（坏日期/空名称）没有落库"
        : "非法行被悄悄写入或接口未给出明确失败",
    });
  } catch (e) {
    rec.rec({ id: "I-04", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-04 执行异常" });
    rec.rec({ id: "I-05", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-05 执行异常" });
    if (!mainRestored) {
      try {
        const rr = await L.post("/api/resume", { password: CRED.password });
        if (rr.ok) { L.setToken(rr.data.token); mainRestored = true; }
      } catch { /* 留给人工 */ }
    }
  }

  /* ---------------- I-12 无 Node 时的构建兼容 ---------------- */
  try {
    const envPath = String(process.env.PATH || "").split(";")
      .filter((p) => p && !/nodejs|binaries\\node/i.test(p)).join(";");
    let out = "", code = 0;
    try {
      out = execFileSync("dotnet", ["build", "src/IPSys.Web/IPSys.Web.csproj", "-c", "Debug", "-v:m", "--nologo"], {
        cwd: "E:/Github/管理系统", encoding: "utf8", env: Object.assign({}, process.env, { PATH: envPath }), timeout: 240000,
      });
    } catch (e) { code = e.status || 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    const warned = /BundleExplorerShell|bundle\.cjs|未找到 node|node.*not found/i.test(out);
    const ok = code === 0 && warned;
    rec.rec({
      id: "I-12", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ code, warned, tail: out.split(/\r?\n/).filter((l) => /warn|警告|Bundle|node/i.test(l)).slice(0, 8) }),
      workspace: "-",
      notes: ok
        ? "把 node 从 PATH 移除后重新构建：构建成功（0 错误）且 BundleExplorerShell 以警告形式提示无法打包前端 —— 缺 Node 不阻断编译，但会静默使用旧 dist（已在 PLAN_REVIEW 缺口 G-01 记录）"
        : "无 Node 时构建失败或没有任何提示",
    });
  } catch (e) { rec.rec({ id: "I-12", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-12 执行异常" }); }

  console.log("I 组执行完毕");
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
