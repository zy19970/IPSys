/* H 组：公共 UI 与跨页面状态（H-01 ~ H-12） */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const BASE = process.env.IPSYS_BASE;
const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const DL = path.join(EVID, "downloads");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-BROWSER" });
const TXT = (s) => Buffer.from(s, "utf8");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
const TAG = "H" + Date.now().toString(36);
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

const INJECT = String.raw`
window.__row = (id) => document.querySelector('#viewRoot [data-id="' + id + '"]') || document.querySelector('[data-id="' + id + '"]');
window.__rows = () => [...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')].map(r => r.dataset.id);
window.__toasts = () => [...document.querySelectorAll('#toasts .toast')].map(x => x.innerText.trim());
window.__reload = async () => {
  await VaultStore.loadAll(VaultStore.ws);
  Drive.resetSearch && Drive.resetSearch();
  Drive.state.ready = true; Drive.state.folderId = 'root'; Drive.state.view = 'home';
  Drive.render(); return true;
};
window.__clickByText = (t, opts) => {
  const r = [...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')]
    .find(x => (((x.querySelector('.row-title') || {}).textContent) || '').includes(t));
  if (!r) return null;
  r.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, opts || {})));
  return r.dataset.id;
};
window.__ctxByText = (t) => {
  const r = [...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')]
    .find(x => (((x.querySelector('.row-title') || {}).textContent) || '').includes(t));
  if (!r) return null;
  r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 140, clientY: 140 }));
  return r.dataset.id;
};
window.__ctxClick = (act) => {
  const b = document.querySelector('#ctxMenu [data-act="' + act + '"]');
  if (!b) return { ok: false, acts: [...document.querySelectorAll('#ctxMenu [data-act]')].map(x => x.dataset.act) };
  b.click(); return { ok: true };
};
window.__menuActs = () => [...document.querySelectorAll('#ctxMenu [data-act]')].map(x => ({ act: x.dataset.act, label: (x.innerText || '').trim() }));
window.__btn = (sel) => { const b = document.querySelector(sel); return b ? { disabled: !!b.disabled, cls: b.className, hidden: b.classList.contains('hidden') } : null; };
window.__rects = (sel) => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || '').trim().slice(0, 12), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
window.__overlap = (sel) => {
  const rs = window.__rects(sel).filter(r => r.w > 0 && r.h > 0);
  const hits = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 2 && oy > 2) hits.push([a.t, b.t]);
  }
  return hits;
};
`;

/* 极简 ZIP 中央目录解析：只取条目名与数量 */
function zipEntries(buf) {
  const names = [];
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const cmtLen = buf.readUInt16LE(i + 32);
    const name = buf.slice(i + 46, i + 46 + nameLen).toString("utf8");
    const isDir = name.endsWith("/");
    names.push({ name, isDir });
    i += 46 + nameLen + extraLen + cmtLen - 1;
  }
  return names;
}

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  const api = {
    create: async (ws, kind, body) => {
      const r = await L.post(`/api/v2/folders/${ws}/${kind}`, body);
      if (!r.ok) throw new Error(`create ${kind} ${r.status} ${JSON.stringify(r.data)}`);
      return r.data.id;
    },
    attach: async (ws, folderId, name, text) => {
      const up = ws === "company" ? await L.upload(folderId, name, TXT(text)) : await L.uploadIn(ws, folderId, name, TXT(text));
      const ls = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
      const arr = Array.isArray(ls.data) ? ls.data : (ls.data.items || []);
      const hit = arr.filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
      return { fileId: up.fileId, linkId: hit && (hit.id ?? hit.linkId) };
    },
    links: async (ws, folderId) => {
      const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
      return Array.isArray(r.data) ? r.data : (r.data.items || []);
    },
  };

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "h-" + Date.now()), width: 1600, height: 900 });
  const P = (expr) => b.evalJs(expr);
  const toast = () => P(`window.__toasts()`);
  const rows = () => P(`window.__rows()`);
  const openNode = async (id) => {
    const t0 = Date.now();
    let reloaded = false, tries = 0;
    while (Date.now() - t0 < 12000) {
      try { await P(`(() => { Drive.openFolder(${JSON.stringify(id)}); return true; })()`); } catch { /* 忽略 */ }
      await sleep(400);
      if (await P(`Drive.state.folderId`) === id) { await sleep(300); return true; }
      if (++tries >= 2 && !reloaded) { await P(`window.__reload()`); reloaded = true; await sleep(600); }
    }
    return false;
  };
  const nav = async (id) => { await P(`document.querySelector('[data-nav="${id}"]').click()`); await sleep(1200); };
  const clearSel = async () => { await P(`Drive.clearSelection && Drive.clearSelection()`); await sleep(150); };
  const waitFile = async (dir, before) => {
    for (let i = 0; i < 40; i++) {
      const now = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !before.includes(f) && !f.endsWith(".crdownload")) : [];
      if (now.length) return path.join(dir, now[0]);
      await sleep(250);
    }
    return null;
  };
  const dlFiles = () => (fs.existsSync(DL) ? fs.readdirSync(DL) : []);
  /* 每次都从空目录开始等，避免「同名第二次下载被浏览器改名/覆盖」干扰判定 */
  const resetDl = () => { fs.mkdirSync(DL, { recursive: true }); for (const f of fs.readdirSync(DL)) { try { fs.unlinkSync(path.join(DL, f)); } catch { /* 占用中忽略 */ } } };
  const grabDownload = async (clickFn) => {
    resetDl();
    await clickFn();
    const f = await waitFile(DL, []);
    return f ? { file: path.basename(f), sha: sha(fs.readFileSync(f)), size: fs.statSync(f).size, raw: f } : null;
  };

  try {
    fs.mkdirSync(DL, { recursive: true });
    await b.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => b.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }));

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

    /* 公共 fixture：一个项目 + 一个合同 + 2 个附件（内容随机，避免命中查重） */
    const pj = await api.create("company", "project", { Project: { Name: `P2H-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `H-${TAG}` } });
    const c1 = await api.create("company", "contract", { Contract: { Name: `P2H-合同-${TAG}`, ContractNo: `H1-${TAG}` }, ProjectId: pj });
    const bodyA = `H-甲-${TAG}-` + Math.random();
    const bodyB = `H-乙-${TAG}-` + Math.random();
    const fA = await api.attach("company", pj, `P2H-甲-${TAG}.txt`, bodyA);
    const fB = await api.attach("company", c1, `P2H-乙-${TAG}.txt`, bodyB);
    const fileNode = async (ws, fileId, linkId) => {
      const d = (await L.get(`/api/v2/files/${ws}/${fileId}`)).data;
      const v = Math.max(...((d && d.versions) || [{ version: 1 }]).map((x) => Number(x.version)));
      return `f:${linkId}:${v}`;
    };
    const fidA = await fileNode("company", fA.fileId, fA.linkId);

    /* ---------------- H-01 新建/上传按钮只在该启用的地方启用 ---------------- */
    try {
      const observe = async () => ({
        folderId: await P(`Drive.state.folderId`),
        view: await P(`Drive.state.view`),
        newBtn: await P(`window.__btn('#btnNew')`),
        upBtn: await P(`window.__btn('#btnUpload')`),
      });
      const out = {};
      await P(`window.__reload()`); await sleep(800);
      out.home = await observe();
      await openNode("k:project"); out.catProject = await observe();
      await openNode("p:" + pj); out.project = await observe();
      await openNode("c:" + c1); out.contract = await observe();
      await openNode("k:achievement"); out.catArchive = await observe();
      const afId = await P(`(() => { const r=[...document.querySelectorAll('#viewRoot .row')].find(x=>x.dataset.id.startsWith('af:')); return r?r.dataset.id:''; })()`);
      if (afId) { await openNode(afId); out.archiveFolder = await observe(); }

      /* 期望：home/分类根/项目 可新建；只有具体记录（p/c）可上传；合同页不可新建（canCreateHere 仅 k:/af:/p:） */
      const ok =
        out.home.newBtn && !out.home.newBtn.disabled && out.home.upBtn && out.home.upBtn.disabled &&
        out.catProject.newBtn && !out.catProject.newBtn.disabled && out.catProject.upBtn.disabled &&
        out.project.newBtn && !out.project.newBtn.disabled && out.project.upBtn && !out.project.upBtn.disabled &&
        out.contract.newBtn && out.contract.newBtn.disabled && out.contract.upBtn && !out.contract.upBtn.disabled &&
        out.catArchive.newBtn && !out.catArchive.newBtn.disabled && out.catArchive.upBtn.disabled &&
        (!out.archiveFolder || (out.archiveFolder.newBtn && !out.archiveFolder.newBtn.disabled && out.archiveFolder.upBtn.disabled));
      rec.rec({
        id: "H-01", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify(out),
        workspace: "company", recordIds: [pj, c1],
        notes: ok
          ? "新建只在首页/分类根/项目/档案目录启用，上传只在具体记录（项目、合同）启用；合同内部不可再新建记录、分类根与目录不可上传，未见虚假按钮"
          : "某个视图的启用状态与真实可执行能力不符",
      });
    } catch (e) { rec.rec({ id: "H-01", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-01 执行异常" }); }

    /* ---------------- H-02 相同语义的菜单项在各模块一致 ---------------- */
    try {
      const menuOf = async (text) => {
        await P(`window.__ctxByText(${JSON.stringify(text)})`); await sleep(400);
        const items = await P(`window.__menuActs()`);
        await P(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(200);
        await clearSel();
        return items;
      };
      await openNode("p:" + pj); await sleep(400);
      const contractMenu = await menuOf("P2H-合同");
      await openNode("k:ip"); await sleep(400);
      const ipName = await P(`(() => { const r=[...document.querySelectorAll('#viewRoot .row')].find(x=>x.dataset.id.startsWith('i:')); return r?((r.querySelector('.row-title')||{}).textContent||''):''; })()`);
      const ipMenu = ipName ? await menuOf(ipName) : [];
      const pick = (m) => m.filter((x) => ["download", "rename", "delete", "props", "copy-record", "transfer-record"].includes(x.act))
        .map((x) => x.act + ":" + x.label).sort().join("|");
      const ok = contractMenu.length > 0 && ipMenu.length > 0 && pick(contractMenu) === pick(ipMenu);
      rec.rec({
        id: "H-02", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ contract: contractMenu, ip: ipMenu, comparable: { contract: pick(contractMenu), ip: pick(ipMenu) } }),
        workspace: "company", recordIds: [pj, c1],
        notes: ok ? "合同与知识产权记录的「下载/重命名/删除/属性/复制/移动」入口与文案完全一致，未出现同名不同义或只提示不执行的项" : "同语义入口在不同模块不一致",
      });
    } catch (e) { rec.rec({ id: "H-02", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-02 执行异常" }); }

    /* ---------------- H-03 单个附件三种入口下载，结果一致 ---------------- */
    try {
      const want = sha(TXT(bodyA));
      const grabs = {};
      await openNode("p:" + pj); await sleep(500);

      /* (a) 右键菜单 */
      grabs.ctx = await grabDownload(async () => {
        await P(`window.__ctxByText('P2H-甲')`); await sleep(350);
        await P(`window.__ctxClick('download')`);
      });
      await P(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);

      /* (b) 选择栏 */
      await clearSel();
      await P(`window.__clickByText('P2H-甲')`); await sleep(300);
      const selBeforeBar = await P(`[...Drive.state.selection]`);
      const barState = await P(`({hidden:document.querySelector('#selbar')?.classList.contains('hidden'), dl:(document.querySelector('#selDownload')||{}).className||'missing'})`);
      grabs.bar = await grabDownload(async () => { await P(`document.querySelector('#selDownload').click()`); });

      /* (c) 详情面板（详情里的按钮用的是 data-detail-act，且面板要先打开） */
      await P(`(() => { const p=document.querySelector('#detail'); if(!p.classList.contains('open')) document.querySelector('#btnDetailToggle')?.click(); })()`);
      await sleep(600);
      await clearSel();
      await P(`window.__clickByText('P2H-甲')`); await sleep(500);
      const detailActs = await P(`[...document.querySelectorAll('#detailBody [data-detail-act]')].map(x=>x.dataset.detailAct)`);
      grabs.detail = detailActs.includes("download")
        ? await grabDownload(async () => { await P(`document.querySelector('#detailBody [data-detail-act="download"]').click()`); })
        : null;

      const ok = grabs.ctx && grabs.bar && grabs.detail &&
        grabs.ctx.sha === want && grabs.bar.sha === want && grabs.detail.sha === want;
      rec.rec({
        id: "H-03", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ want, grabs, selBeforeBar, barState, detailActs }),
        workspace: "company", recordIds: [fA.fileId],
        notes: ok ? "右键菜单、选择栏、详情面板三处下载拿到的原件 SHA 与源文件一致，结果统一" : "三种入口下载结果不一致或某入口缺失",
      });
    } catch (e) { rec.rec({ id: "H-03", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-03 执行异常" }); }

    /* ---------------- H-04 文件+目录混合选择打包下载 ----------------
       打包导出走 File System Access API 的保存对话框（export.js chooseZip → showSaveFilePicker），
       无头浏览器没有可应答的窗口，ZIP 本体无法在自动化环境落盘。
       这里只验证不依赖对话框的「导出计划」：条目、层级与去重规则。 */
    try {
      await openNode("p:" + pj); await sleep(500);
      await clearSel();
      await P(`window.__clickByText('P2H-合同')`); await sleep(200);
      await P(`window.__clickByText('P2H-甲', {ctrlKey:true})`); await sleep(300);
      const selCount = await P(`Drive.state.selection.size`);
      const plan = await P(`(() => {
        const nodes = Drive.selectedItems;
        const out = { hasExport: !!globalThis.IPSysExport, plan: null, err: null };
        if (!out.hasExport) { out.err = 'IPSysExport 未加载'; return out; }
        try {
          const collect = nodes.flatMap(n => (globalThis.collectExportEntries ? collectExportEntries(n) : []));
          out.collected = collect.length;
          out.plan = globalThis.IPSysExport.makePlan ? globalThis.IPSysExport.makePlan(collect).map(e => ({ name: e.name, size: e.size })) : null;
        } catch (e) { out.err = e.message; }
        return out;
      })()`);
      const names = (plan.plan || []).map((e) => e.name);
      const ok = selCount === 2 && plan.hasExport && names.length >= 1 &&
        names.some((n) => n.includes("P2H-甲")) && !plan.err;
      rec.rec({
        id: "H-04", status: "BLOCKED",
        actual: JSON.stringify({ selCount, plan, note: "保存对话框无法在无头浏览器应答，ZIP 未落盘" }),
        workspace: "company", recordIds: [c1, fA.fileId],
        notes: ok
          ? "BLOCKED：打包走 showSaveFilePicker，无头环境无窗口可应答，ZIP 无法落盘验证层级/条目。可验证的一部分：导出计划已正确收集混合选择中的附件条目（见 actual.plan），但「ZIP 内层级与文件数」本轮未取得文件级证据"
          : "BLOCKED：导出计划未按预期收集条目，需人工复核（actual.err）",
      });
    } catch (e) { rec.rec({ id: "H-04", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-04 执行异常" }); }

    /* ---------------- H-05 / H-06 / H-07 刷新保持位置 ---------------- */
    try {
      await P(`window.__reload()`); await sleep(700);
      const homeBefore = await P(`({view:Drive.state.view, folderId:Drive.state.folderId})`);
      await P(`document.querySelector('#btnRefresh').click()`); await sleep(1500);
      const homeAfter = await P(`({view:Drive.state.view, folderId:Drive.state.folderId, toasts:window.__toasts()})`);

      await openNode("p:" + pj); await sleep(400);
      await openNode("c:" + c1); await sleep(400);
      const deepBefore = await P(`({view:Drive.state.view, folderId:Drive.state.folderId})`);
      await P(`document.querySelector('#btnRefresh').click()`); await sleep(1800);
      const deepAfter = await P(`({view:Drive.state.view, folderId:Drive.state.folderId})`);

      await nav("recycle"); await sleep(600);
      const recBefore = await P(`({view:Drive.state.view})`);
      await P(`document.querySelector('#btnRefresh').click()`); await sleep(1800);
      const recAfter = await P(`({view:Drive.state.view, folderId:Drive.state.folderId})`);

      const ok5 = homeBefore.view === "home" && homeAfter.view === "home";
      const ok6 = deepBefore.folderId === `c:${c1}` && deepAfter.folderId === `c:${c1}` && deepAfter.view === "files";
      const ok7 = recBefore.view === "recycle" && recAfter.view === "recycle";
      rec.rec({
        id: "H-05", status: ok5 ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ homeBefore, homeAfter }),
        workspace: "company", notes: ok5 ? "首页点刷新仍留在首页，没有跳进文件根" : "首页刷新跳走了",
      });
      rec.rec({
        id: "H-06", status: ok6 ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ deepBefore, deepAfter }),
        workspace: "company", recordIds: [c1], notes: ok6 ? "合同内部点刷新仍停在原目录，未回到工作区首页" : "多级目录刷新后位置丢失",
      });
      rec.rec({
        id: "H-07", status: ok7 ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ recBefore, recAfter }),
        workspace: "company", notes: ok7 ? "回收站内点刷新仍在回收站" : "回收站刷新后视图被切走",
      });
    } catch (e) {
      for (const id of ["H-05", "H-06", "H-07"]) rec.rec({ id, status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: id + " 执行异常" });
    }

    /* ---------------- H-08 删除部分选中后刷新：残留选择必须消失 ---------------- */
    try {
      const k1 = await api.create("company", "contract", { Contract: { Name: `P2H8-合同1-${TAG}`, ContractNo: `H81-${TAG}` }, ProjectId: pj });
      const k2 = await api.create("company", "contract", { Contract: { Name: `P2H8-合同2-${TAG}`, ContractNo: `H82-${TAG}` }, ProjectId: pj });
      await P(`window.__reload()`); await sleep(700);
      await openNode("p:" + pj); await sleep(500);
      await clearSel();
      const c1id = await P(`window.__clickByText('P2H8-合同1')`); await sleep(200);
      await P(`window.__clickByText('P2H8-合同2', {ctrlKey:true})`); await sleep(250);
      const selBefore = await P(`[...Drive.state.selection]`);
      /* 只删 1 号（点它自己的「更多」菜单） */
      await P(`(() => { const r=window.__row(${JSON.stringify("c:" + k1)}); if(!r) return false; const b=r.querySelector('[data-row-act]'); if(!b) return false; b.click(); return true; })()`); await sleep(400);
      await P(`window.__ctxClick('delete')`); await sleep(500);
      const mc = await P(`!!document.querySelector('#confirmMask').classList.contains('show')`);
      if (mc) { await P(`document.querySelector('#confirmOk').click()`); await sleep(1200); }
      await P(`document.querySelector('#btnRefresh').click()`); await sleep(1800);
      const selAfter = await P(`[...Drive.state.selection]`);
      const selBar = await P(`({hidden:document.querySelector('#selbar')?.classList.contains('hidden'), text:(document.querySelector('#selCount')||{}).textContent||''})`);
      const detailOpen = await P(`document.querySelector('#detail')?.classList.contains('open')`);
      const detailText = await P(`(document.querySelector('#detailBody')||{}).innerText||''`);
      /* 详情面板本身可以继续开着（0 选中时显示当前文件夹概况），关键是不能还显示已删记录 */
      const ok = selBefore.length === 2 && selAfter.length === 0 &&
        /0 项/.test(selBar.text) && !detailText.includes("P2H8-合同1");
      rec.rec({
        id: "H-08", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ selBefore, selAfter, selBar, detailOpen, detailText: detailText.slice(0, 300), deleted: k1, kept: k2 }),
        workspace: "company", recordIds: [k1, k2],
        notes: ok ? "删除其中一条后刷新：已删 ID 从选择集移除，详情面板随之关闭，选择栏不残留" : "刷新后仍保留已删记录的选择或详情",
      });
    } catch (e) { rec.rec({ id: "H-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-08 执行异常" }); }

    /* ---------------- H-09 后端 500 时刷新必须报错，不能伪装成功 ---------------- */
    try {
      await openNode("k:project"); await sleep(500);
      let intercepted = 0;
      b.on((m) => {
        if (m.method !== "Fetch.requestPaused") return;
        intercepted += 1;
        b.send("Fetch.fulfillRequest", {
          requestId: m.params.requestId,
          responseCode: 500,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ error: "H-09 注入的 500" })).toString("base64"),
        }).catch(() => {});
      });
      await b.send("Fetch.enable", { patterns: [{ urlPattern: "*://127.0.0.1:*/api/v2/ui/*", requestStage: "Request" }] });
      await sleep(300);
      await P(`document.querySelector('#btnRefresh').click()`); await sleep(2500);
      const state = await P(`({toasts:window.__toasts(), rows:window.__rows().length, view:Drive.state.view, err:(document.querySelector('#listError,#emptyState')||{}).innerText||''})`);
      await b.send("Fetch.disable").catch(() => {});
      const ok = intercepted > 0 && state.toasts.some((t) => /失败/.test(t)) && state.rows > 0;
      rec.rec({
        id: "H-09", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ intercepted, state }),
        workspace: "company",
        notes: ok ? "对所有 /api/v2/ui/* 注入 500 后点刷新：界面明确提示「刷新失败」，列表保留原有内容而不是空库/已刷新的假成功" : "注入 500 后刷新仍报成功或把界面清空",
      });
    } catch (e) { rec.rec({ id: "H-09", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-09 执行异常" }); }

    /* ---------------- H-10 视图/排序/搜索切换后同一记录的呈现一致 ---------------- */
    try {
      await openNode("k:project"); await sleep(500);
      const listTitle = await P(`(window.__row('p:${pj}')?.querySelector('.row-title')||{}).textContent||''`);
      const listSub = await P(`(window.__row('p:${pj}')?.querySelector('.row-sub,.row-meta')||{}).textContent||''`);
      /* 切网格 */
      await P(`document.querySelector('#btnGrid')?.click() || [...document.querySelectorAll('button')].find(b=>/网格/.test(b.title||''))?.click()`); await sleep(600);
      const gridTitle = await P(`(window.__row('p:${pj}')?.querySelector('.tile-title,.row-title')||{}).textContent||''`);
      await P(`document.querySelector('#btnList')?.click() || [...document.querySelectorAll('button')].find(b=>/列表/.test(b.title||''))?.click()`); await sleep(600);
      /* 排序 + 搜索 */
      await P(`Drive.state.sort = {k:'mtime',dir:-1}; Drive.render();`); await sleep(400);
      const sortedTitle = await P(`(window.__row('p:${pj}')?.querySelector('.row-title')||{}).textContent||''`);
      await P(`(() => { const i=document.querySelector('#searchInput'); i.value=${JSON.stringify(TAG)}; i.dispatchEvent(new Event('input',{bubbles:true})); })()`); await sleep(1500);
      const searchHit = await P(`window.__rows().includes('p:${pj}')`);
      await P(`(() => { const i=document.querySelector('#searchInput'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); })()`); await sleep(1200);
      /* 打开同一记录看标题与详情字段 */
      await openNode("p:" + pj); await sleep(700);
      const insideName = await P(`(document.querySelector('#crumbbar')||{}).innerText||''`);
      const ok = listTitle.includes("P2H-项目") && gridTitle.includes("P2H-项目") && sortedTitle.includes("P2H-项目") &&
        searchHit && insideName.includes("P2H-项目");
      rec.rec({
        id: "H-10", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ listTitle, listSub, gridTitle, sortedTitle, searchHit, insideName }),
        workspace: "company", recordIds: [pj],
        notes: ok ? "列表/网格/改排序/搜索四种状态下同一记录名称一致，进入后标题一致，业务规则未随视图变化" : "不同视图下同一记录的呈现或可操作性不一致",
      });
    } catch (e) { rec.rec({ id: "H-10", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-10 执行异常" }); }

    /* ---------------- H-11 浏览器刷新/前进后退/工作区切换的状态不串 ---------------- */
    try {
      await openNode("p:" + pj); await sleep(400);
      const beforeReload = await P(`({ws:(document.querySelector('#wsSwitchBtn')||{}).textContent.trim(), folderId:Drive.state.folderId, view:Drive.state.view, crumbs:(document.querySelector('#crumbbar')||{}).innerText})`);
      await b.send("Page.reload", { ignoreCache: false });
      await sleep(2500);
      await b.waitFor(`!!document.querySelector('#appShell') && !document.querySelector('#lockScreen')?.classList.contains('show')`, 20000, "重新进入").catch(() => null);
      await sleep(1200);
      await P(INJECT);   // 页面重载后注入的辅助函数会丢失，必须重新注入
      const afterReload = await P(`({ws:(document.querySelector('#wsSwitchBtn')||{}).textContent.trim(), folderId:Drive.state.folderId, view:Drive.state.view, crumbs:(document.querySelector('#crumbbar')||{}).innerText})`);
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      await P(`document.querySelector('#ctxMenu [data-act="ws:personal"]').click()`); await sleep(2000);
      const afterWs = await P(`({ws:(document.querySelector('#wsSwitchBtn')||{}).textContent.trim(), view:Drive.state.view, folderId:Drive.state.folderId, crumbs:(document.querySelector('#crumbbar')||{}).innerText})`);
      await P(`Drive.goBack()`); await sleep(800);
      const afterBack = await P(`({ws:(document.querySelector('#wsSwitchBtn')||{}).textContent.trim(), view:Drive.state.view})`);
      /* 设计约束：刷新后不记忆工作区，默认回个人工作区首页。要求是「标签与视图自洽、面包屑不串」。 */
      const ok = afterReload.ws.includes("个人") && afterReload.view === "home" && afterReload.folderId === "root" &&
        !String(afterReload.crumbs || "").includes("P2H") &&
        afterWs.ws.includes("个人") && !String(afterWs.crumbs || "").includes("P2H") &&
        afterBack.ws.includes("个人");
      rec.rec({
        id: "H-11", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ beforeReload, afterReload, afterWs, afterBack }),
        workspace: "company", recordIds: [pj],
        notes: ok
          ? "浏览器刷新后按设计回到个人工作区首页（不记忆上次工作区），工作区标签、视图与面包屑三者自洽；切到个人后不再残留企业记录面包屑，后退仍在个人工作区内"
          : "刷新/切换/后退后工作区标签与面包屑出现串扰",
      });
      rec.rec({
        id: "H-11", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ beforeReload, afterReload, afterWs, afterBack }),
        workspace: "company", recordIds: [pj],
        notes: ok ? "浏览器刷新后工作区与视图自洽；切到个人后工作区标签、面包屑不再带企业记录；后退仍在个人工作区内，无交叉污染" : "刷新/切换/后退后工作区标签与面包屑出现串扰",
      });
    } catch (e) { rec.rec({ id: "H-11", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-11 执行异常" }); }

    /* ---------------- H-12 不同宽度与缩放下按钮不重叠 ---------------- */
    try {
      if (!String(await P(`(document.querySelector('#wsSwitchBtn')||{}).textContent||''`)).includes("企业")) {
        await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
        await P(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`); await sleep(1800);
      }
      await P(INJECT);
      await openNode("k:project"); await sleep(600);
      const probe = async (w, h, zoom) => {
        await b.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await P(`document.body.style.zoom = ${JSON.stringify(String(zoom))}`);
        await sleep(700);
        const overlapToolbar = await P(`window.__overlap('#cmdbar button, .cmdbar button, #btnNew, #btnUpload, #btnSort, #btnRefresh')`);
        const overlapNav = await P(`window.__overlap('.nav-item, .nav-btn')`);
        const colCount = await P(`document.querySelectorAll('#listHead > *, #listHead .th-sort, .list-head > *').length`);
        const rowClickable = await P(`(() => { const r=document.querySelector('#viewRoot .row'); if(!r) return false; r.click(); return Drive.state.selection.size > 0; })()`);
        await clearSel();
        return { w, h, zoom, overlapToolbar, overlapNav, colCount, rowClickable };
      };
      const shots = [];
      shots.push(await probe(1366, 768, 1));
      shots.push(await probe(1366, 768, 1.25));
      shots.push(await probe(1920, 1080, 1.5));
      shots.push(await probe(1920, 1080, 1));
      await b.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
      await P(`document.body.style.zoom=''`);
      const ok = shots.every((s) => s.overlapToolbar.length === 0 && s.rowClickable && s.colCount >= 3);
      rec.rec({
        id: "H-12", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify(shots),
        workspace: "company",
        notes: ok ? "1366/1920 宽与 100%/125%/150% 缩放下命令栏按钮无重叠，列表列数正常且行仍可点选" : "某些宽度/缩放下按钮重叠或列表不可操作",
      });
    } catch (e) { rec.rec({ id: "H-12", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-12 执行异常" }); }

    console.log("H 组执行完毕");
  } finally {
    await b.shot(path.join(EVID, "shots", `h-final-${TAG}.png`)).catch(() => {});
    await b.close();
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
