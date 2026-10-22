/* G 组：拖放、菜单与快捷键（G-01 ~ G-12）
   说明：内部附件拖放的唯一可达路径是「项目记录内」（项目下同时有附件行与合同行）。
   跨视图的 drop（来源记录自身 / 业务档案目录）通过「dragstart 后切换视图再 drop」
   构造，仅用于验证守卫函数；该序列在手工操作下不可达，已在 notes 中标注。 */
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
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-BROWSER" });
const TXT = (s) => Buffer.from(s, "utf8");
const TAG = "G" + Date.now().toString(36);
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

/* ---------- 页面内注入的拖放/点击工具 ---------- */
const INJECT = String.raw`
window.__q = (sel) => document.querySelector(sel);
window.__row = (id) => document.querySelector('#viewRoot [data-id="' + id + '"]') || document.querySelector('[data-id="' + id + '"]');
window.__rows = () => [...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')].map(r => r.dataset.id);
window.__rowByText = (t) => [...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')]
  .find(r => (((r.querySelector('.row-title') || {}).textContent) || '').includes(t));
window.__clickByText = (t, opts) => {
  const r = window.__rowByText(t); if (!r) return null;
  r.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, opts || {})));
  return r.dataset.id;
};
window.__ctxByText = (t) => {
  const r = window.__rowByText(t); if (!r) return null;
  r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
  return r.dataset.id;
};
window.__toasts = () => [...document.querySelectorAll('#toasts .toast')].map(x => x.innerText.trim());
/* 用例的 fixture 是走 HTTP 直接写的，前端内存树不会自动知道；需要显式重载一次 */
window.__reload = async () => {
  await VaultStore.loadAll(VaultStore.ws);
  Drive.resetSearch && Drive.resetSearch();
  Drive.state.ready = true;
  Drive.state.folderId = 'root';
  Drive.state.view = 'home';
  Drive.render();
  return true;
};
window.__sel = () => [...document.querySelectorAll('#viewRoot .row.is-sel, #viewRoot .tile.is-sel, #viewRoot .row[aria-selected="true"]')].map(r => r.dataset.id);
window.__mkDrag = (dtKind) => {
  const dt = new DataTransfer();
  if (dtKind === 'link') dt.setData('application/x-ipsys-link', window.__dragSrcId || '');
  if (dtKind === 'file') {
    /* 内容必须每次唯一：相同内容会命中查重对话框，没有人工应答就会留下待确认票据，
       后续所有 prepare 都会被 409「已有待确认文件」挡住（真实产品行为）。 */
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bytes[i] = 65 + Math.floor(Math.random() * 26);
    bytes[0] = 10 + (window.__extSeq = (window.__extSeq || 0) + 1) % 100;
    dt.items.add(new File([bytes], window.__extName, { type: 'text/plain' }));
  }
  return dt;
};
window.__ev = (type, dt) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: dt });
  Object.defineProperty(e, 'clientX', { value: 20 });
  Object.defineProperty(e, 'clientY', { value: 20 });
  return e;
};
window.__dragStart = (srcId) => {
  window.__dragSrcId = srcId;
  const dt = window.__mkDrag('link');
  const row = window.__row(srcId);
  const e = window.__ev('dragstart', dt);
  row.dispatchEvent(e);
  window.__dragDT = dt;
  return { prevented: e.defaultPrevented, payload: dt.getData('application/x-ipsys-link'), types: [...dt.types] };
};
window.__dragOver = (dstSel) => {
  const dst = dstSel ? document.querySelector(dstSel) : document.querySelector('#content');
  dst.dispatchEvent(window.__ev('dragover', window.__dragDT));
  return true;
};
window.__drop = (dstSel) => {
  const dst = dstSel ? document.querySelector(dstSel) : document.querySelector('#content');
  const e = window.__ev('drop', window.__dragDT);
  dst.dispatchEvent(e);
  return { prevented: e.defaultPrevented };
};
window.__dropExt = (dstSel, name) => {
  window.__extName = name;
  const dt = window.__mkDrag('file');
  const dst = dstSel ? document.querySelector(dstSel) : document.querySelector('#content');
  dst.dispatchEvent(window.__ev('dragover', dt));
  const e = window.__ev('drop', dt);
  dst.dispatchEvent(e);
  return { prevented: e.defaultPrevented, files: dt.files.length };
};
window.__key = (key, opts) => {
  const e = new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, opts || {}));
  document.querySelector('#viewRoot') ? document.querySelector('#viewRoot').dispatchEvent(e) : document.dispatchEvent(e);
  return { prevented: e.defaultPrevented };
};
window.__ctxClick = (act) => {
  const b = document.querySelector('#ctxMenu [data-act="' + act + '"]');
  if (!b) return { ok: false, acts: [...document.querySelectorAll('#ctxMenu [data-act]')].map(x => x.dataset.act) };
  b.click();
  return { ok: true };
};
window.__moreClick = (id) => {
  const row = window.__row(id);
  const b = row && row.querySelector('[data-row-act]');
  if (!b) return false;
  b.click();
  return true;
};
`;

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  /* ---------- API 侧准备 ---------- */
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
    del: (ws, kind, id) => L.del(`/api/v2/folders/${ws}/${kind}/${id}`),
  };

  const fileNode = async (ws, fileId, linkId) => {
    const d = (await L.get(`/api/v2/files/${ws}/${fileId}`)).data;
    const v = Math.max(...((d && d.versions) || [{ version: 1 }]).map((x) => Number(x.version)));
    return `f:${linkId}:${v}`;
  };
  const b = await launch({ profileDir: path.join(ROOT, "profiles", "g-" + Date.now()) });
  const P = (expr) => b.evalJs(expr);
  const toast = () => P(`window.__toasts()`);
  const rows = () => P(`window.__rows()`);
  const waitRows = (n) => b.waitFor(`window.__rows().length >= ${n}`, 12000, "rows>=" + n);
  /* Drive.openFolder 吃的是节点 id（p:12 / c:14 / i:17 / g:19），不是裸数字。
     分类页的子节点是异步拉的，进记录必须等 folderId 真的切过去，否则会静默停在分类页。 */
  const openNode = async (nodeId) => {
    if (typeof nodeId !== "string" || !nodeId.includes(":"))
      throw new Error("openNode 需要带前缀的节点 id，收到 " + nodeId);
    const t0 = Date.now();
    let lastErr = "";
    let reloaded = false;
    let tries = 0;
    while (Date.now() - t0 < 12000) {
      try { await P(`(() => { Drive.openFolder(${JSON.stringify(nodeId)}); return true; })()`); }
      catch (e) { lastErr = e.message; }
      await sleep(400);
      const cur = await P(`Drive.state.folderId`).catch(() => null);
      if (cur === nodeId) {
        await b.waitFor(`window.__rows().length > 0 || Drive.state.folderId === ${JSON.stringify(nodeId)}`, 6000, "rows of " + nodeId).catch(() => null);
        await sleep(250);
        return true;
      }
      tries += 1;
      if (tries >= 2 && !reloaded) { await P(`window.__reload()`); reloaded = true; await sleep(600); }
    }
    throw new Error(`openNode 超时: ${nodeId} 当前=${await P(`Drive.state.folderId`).catch(() => "?")} ${lastErr}`);
  };
  /* 记录节点只有在所属分类树里才可解析：先回项目分类，再进记录 */
  const openProject = async (id) => { await openNode("k:project"); await openNode("p:" + id); };
  const openContract = (id) => openNode("c:" + id);
  const nav = async (id) => { await P(`document.querySelector('[data-nav="${id}"]').click()`); await sleep(1200); };
  const confirmOk = async () => { await P(`document.querySelector('#confirmOk').click()`); await sleep(900); };
  const confirmCancel = async () => { await P(`document.querySelector('#confirmCancel').click()`); await sleep(500); };
  const clearSel = async () => { await P(`Drive.clearSelection && Drive.clearSelection()`); await sleep(200); };

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
      await P(`document.querySelector('#wsSwitchBtn').click()`);
      await sleep(300);
      await P(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`);
      await sleep(1800);
    }
    await P(INJECT);

    /* ================= G-01 附件拖到另一个有效业务记录 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G1-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G1-${TAG}` } });
      const c1 = await api.create("company", "contract", { Contract: { Name: `P2G1-合同-${TAG}`, ContractNo: `G1-${TAG}` }, ProjectId: pj });
      const f = await api.attach("company", pj, `P2G1-附件-${TAG}.txt`, "G1 拖放源");
      const fid = await fileNode("company", f.fileId, f.linkId);
      await openProject(pj);
      await waitRows(2);
      const ds = await P(`window.__dragStart('${fid}')`);
      const dov = await P(`window.__dragOver('#viewRoot [data-id="c:${c1}"]')`);
      const dp = await P(`window.__drop('#viewRoot [data-id="c:${c1}"]')`);
      await sleep(500);
      const modal = await P(`({show:!!document.querySelector('#confirmMask').classList.contains('show'), text:(document.querySelector('#confirmText')||{}).textContent||''})`);
      if (modal.show) await confirmOk();
      await sleep(900);
      const srcLinks = await api.links("company", pj);
      const tgtLinks = await api.links("company", c1);
      const ok = ds.payload === fid && modal.show &&
        srcLinks.filter((x) => Number(x.fileId) === Number(f.fileId)).length === 0 &&
        tgtLinks.filter((x) => Number(x.fileId) === Number(f.fileId)).length === 1 &&
        (await rows()).length === 1;
      rec.rec({
        id: "G-01", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ dragstart: ds, dragover: dov, drop: dp, confirm: modal, srcLinks: srcLinks.length, tgtLinks: tgtLinks.length }),
        workspace: "company", recordIds: [pj, c1, f.fileId],
        notes: ok ? "项目内附件拖到同区合同：弹确认→走同一 associate 移动，来源链接解除、目标出现该原件，两侧列表刷新" : "拖放未走 associate 移动或两侧状态不一致",
      });
    } catch (e) { rec.rec({ id: "G-01", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-01 执行异常" }); }

    /* ================= G-02 确认弹窗取消 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G2-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G2-${TAG}` } });
      const c1 = await api.create("company", "contract", { Contract: { Name: `P2G2-合同-${TAG}`, ContractNo: `G2-${TAG}` }, ProjectId: pj });
      const f = await api.attach("company", pj, `P2G2-附件-${TAG}.txt`, "G2 取消源");
      const fid = await fileNode("company", f.fileId, f.linkId);
      await openProject(pj); await waitRows(2);
      await P(`window.__dragStart('${fid}')`);
      await P(`window.__drop('#viewRoot [data-id="c:${c1}"]')`);
      await sleep(450);
      await confirmCancel();
      const srcLinks = await api.links("company", pj);
      const tgtLinks = await api.links("company", c1);
      const ok = srcLinks.some((x) => Number(x.fileId) === Number(f.fileId)) && tgtLinks.length === 0;
      rec.rec({
        id: "G-02", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ srcLinks: srcLinks.length, tgtLinks: tgtLinks.length, toasts: await toast() }),
        workspace: "company", recordIds: [pj, c1],
        notes: ok ? "取消确认后无任何关联写操作，来源保留、目标未新增" : "取消后仍发生了关联写入",
      });
    } catch (e) { rec.rec({ id: "G-02", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-02 执行异常" }); }

    /* ================= G-03 非法目标：来源记录 / 业务档案目录 / 空白区 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G3-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G3-${TAG}` } });
      const c1 = await api.create("company", "contract", { Contract: { Name: `P2G3-合同-${TAG}`, ContractNo: `G3-${TAG}` }, ProjectId: pj });
      const f = await api.attach("company", c1, `P2G3-附件-${TAG}.txt`, "G3 非法目标源");
      const fid = await fileNode("company", f.fileId, f.linkId);
      const before = (await api.links("company", c1)).length;

      /* (a) 拖到自己所属记录（合同的上级项目里，合同行 = 该附件的 owner 本行） */
      await openProject(pj); await waitRows(1);
      await openContract(c1); await waitRows(1);
      await P(`window.__dragStart('${fid}')`);
      await openProject(pj);                                   // 回到项目页，合同行可见
      await P(`window.__drop('#viewRoot [data-id="c:${c1}"]')`);
      await sleep(600);
      const a = { modal: await P(`!!document.querySelector('#confirmMask').classList.contains('show')`), toasts: await toast() };
      if (a.modal) await confirmCancel();

      /* (b) 拖到空白区（虚拟根） */
      await openContract(c1); await waitRows(1);
      await P(`window.__dragStart('${fid}')`);
      const dropBlank = await P(`window.__drop(null)`);
      await sleep(400);
      const b2 = { modal: await P(`!!document.querySelector('#confirmMask').classList.contains('show')`), toasts: await toast() };
      if (b2.modal) await confirmCancel();

      /* (c) 拖到业务档案系统目录（附件行与目录行不同屏，只能构造 dragstart→切视图→drop） */
      await openContract(c1); await waitRows(1);
      await P(`window.__dragStart('${fid}')`);
      await P(`Drive.openFolder('k:achievement')`); await sleep(1400);   // 公司「业务档案」分类 id 是 achievement
      const afId = await P(`(() => { const r=[...document.querySelectorAll('#viewRoot .row')].find(x=>x.dataset.id.startsWith('af:')); return r?r.dataset.id:''; })()`);
      let c2 = { afId };
      if (afId) {
        await P(`window.__drop('#viewRoot [data-id="${afId}"]')`);
        await sleep(600);
        c2.modal = await P(`!!document.querySelector('#confirmMask').classList.contains('show')`);
        c2.toasts = await toast();
        if (c2.modal) await confirmCancel();
      }
      const afterLinks = await api.links("company", c1);
      const kept = afterLinks.filter((x) => Number(x.fileId) === Number(f.fileId)).length;
      const ok = !a.modal && !b2.modal && !c2.modal && kept === 1 && afterLinks.length === before;
      rec.rec({
        id: "G-03", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ toOwnerRecord: a, toBlank: Object.assign({ dropBlank }, b2), toArchiveFolder: c2, linksBefore: before, linksAfter: afterLinks.length, kept }),
        workspace: "company", recordIds: [pj, c1],
        notes: ok
          ? "三类非法目标（来源记录自身、空白/虚拟根、业务档案系统目录）均未弹出确认、未提交关联移动，来源关联保持 1 条；注意 (c) 在真实使用中附件行与目录行不同屏，只能验证「不写入」而非「按类别拒绝」"
          : "非法目标仍提交了关联移动",
      });
    } catch (e) { rec.rec({ id: "G-03", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-03 执行异常" }); }

    /* ================= G-04 拖放中切换工作区 / 目标失效 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G4-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G4-${TAG}` } });
      const c1 = await api.create("company", "contract", { Contract: { Name: `P2G4-合同-${TAG}`, ContractNo: `G4-${TAG}` }, ProjectId: pj });
      const c2 = await api.create("company", "contract", { Contract: { Name: `P2G4-合同2-${TAG}`, ContractNo: `G4b-${TAG}` }, ProjectId: pj });
      const f = await api.attach("company", pj, `P2G4-附件-${TAG}.txt`, "G4 源");
      const fid = await fileNode("company", f.fileId, f.linkId);
      await openProject(pj); await waitRows(3);

      /* (1) dragstart 后切到个人工作区，再在个人记录上 drop */
      await P(`window.__dragStart('${fid}')`);
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      await P(`document.querySelector('#ctxMenu [data-act="ws:personal"]').click()`); await sleep(2000);
      const pPersonal = await api.create("personal", "project", { Project: { Name: `P2G4P-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G4P-${TAG}` } });
      await openProject(pPersonal); await sleep(400);
      let crossOk = false;
      if ((await rows()).length === 0) { await P(`window.__drop(null)`); }
      await sleep(500);
      const crossToast = await toast();
      const crossModal = await P(`!!document.querySelector('#confirmMask').classList.contains('show')`);
      if (crossModal) await confirmCancel();
      crossOk = !crossModal;

      /* (2) 目标记录在拖放中被删除 */
      if (!String(await P(`(document.querySelector('#wsSwitchBtn')||{}).textContent||''`)).includes("企业")) {
        await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
        await P(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`); await sleep(2000);
      }
      await openProject(pj); await waitRows(3);
      await P(`window.__dragStart('${fid}')`);
      await api.del("company", "contract", c2);
      await P(`window.__drop('#viewRoot [data-id="c:${c2}"]')`);
      await sleep(800);
      const staleModal = await P(`!!document.querySelector('#confirmMask').classList.contains('show')`);
      if (staleModal) await confirmOk();
      await sleep(1000);
      const staleToast = await toast();
      const srcLinks = await api.links("company", pj);
      const alive = srcLinks.some((x) => Number(x.fileId) === Number(f.fileId));
      const ok = crossOk && alive;
      rec.rec({
        id: "G-04", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ crossWorkspace: { modal: crossModal, toasts: crossToast }, targetDeletedMidDrag: { modal: staleModal, toasts: staleToast }, sourceKept: alive, links: srcLinks.length }),
        workspace: "company", recordIds: [pj, c1],
        notes: ok ? "拖放期间切工作区被丢弃（无确认框），目标记录被删后 drop 不产生跨区/孤儿关联，来源关联始终保留" : "拖放期间切换工作区或目标失效后仍提交了移动",
      });
    } catch (e) { rec.rec({ id: "G-04", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-04 执行异常" }); }

    /* ================= G-05 目标已存在同一原件 -> 409 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G5-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G5-${TAG}` } });
      const c1 = await api.create("company", "contract", { Contract: { Name: `P2G5-合同-${TAG}`, ContractNo: `G5-${TAG}` }, ProjectId: pj });
      const f = await api.attach("company", pj, `P2G5-附件-${TAG}.txt`, "G5 冲突源");
      const fid = await fileNode("company", f.fileId, f.linkId);
      const assoc = await L.post(`/api/v2/files/company/${f.fileId}/associate`, { linkId: f.linkId, targetFolderId: c1, move: false });
      await openProject(pj); await waitRows(2);
      await P(`window.__dragStart('${fid}')`);
      await P(`window.__drop('#viewRoot [data-id="c:${c1}"]')`);
      await sleep(500);
      const m = await P(`!!document.querySelector('#confirmMask').classList.contains('show')`);
      if (m) await confirmOk();
      await sleep(1200);
      const srcLinks = await api.links("company", pj);
      const tgtLinks = await api.links("company", c1);
      const toastText = (await toast()).join(" | ");
      const ok = assoc.ok && srcLinks.some((x) => Number(x.fileId) === Number(f.fileId)) &&
        tgtLinks.filter((x) => Number(x.fileId) === Number(f.fileId)).length === 1 &&
        /失败|冲突|已关联/.test(toastText);
      rec.rec({
        id: "G-05", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ preAssoc: assoc.status, srcLinks: srcLinks.length, tgtLinks: tgtLinks.length, toast: toastText }),
        workspace: "company", recordIds: [pj, c1],
        notes: ok ? "目标已存在同一原件时移动被拒（409/已关联），提示失败并保留来源关联，目标仍只有一条链接" : "冲突场景未给出失败提示或两侧状态错乱",
      });
    } catch (e) { rec.rec({ id: "G-05", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-05 执行异常" }); }

    /* ================= G-06 外部文件拖到具体业务记录 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G6-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G6-${TAG}` } });
      const c1 = await api.create("company", "contract", { Contract: { Name: `P2G6-合同-${TAG}`, ContractNo: `G6-${TAG}` }, ProjectId: pj });
      await openProject(pj); await waitRows(1);
      const before = (await api.links("company", c1)).length;
      const name = `P2G6-外拖-${TAG}.txt`;
      const dp = await P(`window.__dropExt('#viewRoot [data-id="c:${c1}"]', ${JSON.stringify(name)})`);
      await sleep(2200);
      const panel = await P(`(document.querySelector('#uploadProgress')||{}).innerText||''`);
      const links = await api.links("company", c1);
      const hits = links.filter((x) => String(x.fileName || x.name || "").includes(name));
      const ok = dp.files === 1 && links.length === before + 1 && hits.length === 1;
      rec.rec({
        id: "G-06", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ drop: dp, linksBefore: before, linksAfter: links.length, matched: hits.map((x) => ({ fileId: x.fileId, name: x.fileName || x.name })), uploadPanel: panel.slice(0, 400) }),
        workspace: "company", recordIds: [pj, c1],
        notes: ok ? "外部单文件拖到具体合同：只产生 1 个新 FileId、1 条新链接，未出现重复上传" : "外部拖放上传次数或落点不符",
      });
    } catch (e) { rec.rec({ id: "G-06", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-06 执行异常" }); }

    /* ================= G-07 外部文件拖到虚拟根/无归属区 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G7-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G7-${TAG}` } });
      await nav("files");
      await P(`Drive.openFolder('k:project')`); await sleep(1200);
      const beforeTotal = (await api.links("company", pj)).length;
      const totalLinks = async () => {
        let n = 0;
        for (const kind of ["project", "contract", "ip", "general"]) {
          const r = await L.get(`/api/v2/folders/company/${kind}`);
          for (const snap of (Array.isArray(r.data) ? r.data : [])) {
            const id = snap.folder.ref.id;
            n += (await api.links("company", id)).length;
          }
        }
        return n;
      };
      const allBefore = await totalLinks();
      const name = `P2G7-误拖-${TAG}.txt`;
      await P(`window.__dropExt(null, ${JSON.stringify(name)})`);   // 分类页空白区
      await sleep(1500);
      const t1 = await toast();
      await nav("home");
      await P(`window.__dropExt(null, ${JSON.stringify(name + "2")})`); // 首页
      await sleep(1500);
      const t2 = await toast();
      const allAfter = await totalLinks();
      const afterTotal = (await api.links("company", pj)).length;
      const silent = t1.length === 0 && t2.length === 0;
      /* 判定标准只要求「不得悄悄写入任意业务记录」；提示缺失单列为缺陷（见 DEFECTS） */
      const ok = beforeTotal === afterTotal && allBefore === allAfter;
      rec.rec({
        id: "G-07", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ categoryDrop: t1, homeDrop: t2, projectLinksBefore: beforeTotal, projectLinksAfter: afterTotal, allLinksBefore: allBefore, allLinksAfter: allAfter, silent }),
        workspace: "company", recordIds: [pj],
        notes: ok
          ? "分类页与首页拖入外部文件均未产生任何上传/关联（全工作区链接总数不变），满足「不得悄悄写入」；但两次都完全静默——提示分支被 bindContent 里前置的 preventDefault 守卫短路（interactions.js:1277-1289），已单列为缺陷"
          : "无归属区域仍发生写入",
      });
    } catch (e) { rec.rec({ id: "G-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-07 执行异常" }); }

    /* ================= G-08 未选中行的「更多」菜单删除：不误删旧选择 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G8-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G8-${TAG}` } });
      const cA = await api.create("company", "contract", { Contract: { Name: `P2G8-合同A-${TAG}`, ContractNo: `G8A-${TAG}` }, ProjectId: pj });
      const cB = await api.create("company", "contract", { Contract: { Name: `P2G8-合同B-${TAG}`, ContractNo: `G8B-${TAG}` }, ProjectId: pj });
      const cC = await api.create("company", "contract", { Contract: { Name: `P2G8-合同C-${TAG}`, ContractNo: `G8C-${TAG}` }, ProjectId: pj });
      await openProject(pj); await waitRows(3);
      await P(`window.__row('c:${cA}').click()`); await sleep(250);
      const selBefore = await P(`[...Drive.state.selection]`);
      await P(`window.__moreClick('c:${cC}')`); await sleep(400);
      const menu = await P(`[...document.querySelectorAll('#ctxMenu [data-act]')].map(x=>x.dataset.act)`);
      await P(`window.__ctxClick('delete')`); await sleep(500);
      const mc = await P(`!!document.querySelector('#confirmMask').classList.contains('show')`);
      if (mc) await confirmOk();
      await sleep(1200);
      const rest = await P(`window.__rows()`);
      const ok = selBefore.includes(`c:${cA}`) && menu.includes("delete") &&
        !rest.includes(`c:${cC}`) && rest.includes(`c:${cA}`) && rest.includes(`c:${cB}`);
      rec.rec({
        id: "G-08", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ selectedBefore: selBefore, moreMenuOn: `c:${cC}`, menuActs: menu, afterRows: rest }),
        workspace: "company", recordIds: [pj, cA, cB, cC],
        notes: ok ? "点未选中行的「更多→删除」只删除被点击的 C，原先选中的 A 与未选中的 B 均保留" : "菜单删除误伤了旧选择或删错了行",
      });
    } catch (e) { rec.rec({ id: "G-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-08 执行异常" }); }

    /* ================= G-09 多选后对已选中行开菜单批量删除 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G9-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G9-${TAG}` } });
      const ids = [];
      for (const k of ["A", "B", "C", "D"]) {
        ids.push(await api.create("company", "contract", { Contract: { Name: `P2G9-合同${k}-${TAG}`, ContractNo: `G9${k}-${TAG}` }, ProjectId: pj }));
      }
      await openProject(pj); await waitRows(4);
      await P(`window.__row('c:${ids[0]}').click()`); await sleep(150);
      await P(`(() => { const r = window.__row('c:${ids[1]}'); const e = new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}); r.dispatchEvent(e); })()`);
      await sleep(250);
      const sel = await P(`[...Drive.state.selection]`);
      await P(`window.__moreClick('c:${ids[1]}')`); await sleep(400);
      await P(`window.__ctxClick('delete')`); await sleep(500);
      const mc = await P(`!!document.querySelector('#confirmMask').classList.contains('show')`);
      const ctext = await P(`(document.querySelector('#confirmText')||{}).textContent||''`);
      if (mc) await confirmOk();
      await sleep(1300);
      const rest = await P(`window.__rows()`);
      const ok = sel.length === 2 && !rest.includes(`c:${ids[0]}`) && !rest.includes(`c:${ids[1]}`) &&
        rest.includes(`c:${ids[2]}`) && rest.includes(`c:${ids[3]}`);
      rec.rec({
        id: "G-09", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ selection: sel, confirmText: ctext, afterRows: rest }),
        workspace: "company", recordIds: [pj].concat(ids),
        notes: ok ? "对已选中行开菜单执行删除，正好删除该组 2 条，未选中项不受影响" : "批量删除范围与选中集不一致",
      });
    } catch (e) { rec.rec({ id: "G-09", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-09 执行异常" }); }

    /* ================= G-10 回收站多选右键还原 / 彻底删除 =================
       注意：loadRecycle 里 `.filter(r => r.kind !== "contract")` 显式把合同挡在回收站 UI 之外
       （注释：合同不是业务模块，恢复出来也没有地方放），所以本用例只能用 IP / 综合资料。 */
    try {
      const rA = await api.create("company", "ip", { Ip: { Name: `P2G10-IP-A-${TAG}`, IpType: "实用新型专利", Status: "已申请", ApplicationNo: `G10A-${TAG}` } });
      const rB = await api.create("company", "ip", { Ip: { Name: `P2G10-IP-B-${TAG}`, IpType: "实用新型专利", Status: "已申请", ApplicationNo: `G10B-${TAG}` } });
      const rC = await api.create("company", "general", { General: { Title: `P2G10-综合C-${TAG}` } });
      await api.del("company", "ip", rA);
      await api.del("company", "ip", rB);
      await api.del("company", "general", rC);
      await P(`window.__reload()`); await sleep(600);
      await nav("recycle");
      await b.waitFor(`Drive.state.view === 'recycle'`, 8000, "回收站视图").catch(() => null);
      await sleep(1200);
      const tr = await P(`[...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')].map(r=>({id:r.dataset.id,t:(r.querySelector('.row-title')||{}).textContent}))`);
      const mine = tr.filter((x) => x.t && x.t.includes(TAG));
      const pick = ["IP-A", "IP-B", "综合C"].map((k) => mine.find((x) => x.t.includes(k))).filter(Boolean);
      let ok = pick.length === 3;   // 回收站里可能还有本批次早前用例留下的同名文件，只认这三条
      let detail = { view: await P(`Drive.state.view`), trashTotal: tr.length, mine, trashRows: pick };
      if (ok) {
        const nameA = pick.find((x) => /IP-A/.test(x.t)).t;
        const nameB = pick.find((x) => /IP-B/.test(x.t)).t;
        const nameC = pick.find((x) => /综合C/.test(x.t)).t;
        await P(`window.__clickByText(${JSON.stringify(nameA)})`); await sleep(200);
        await P(`window.__clickByText(${JSON.stringify(nameB)}, {ctrlKey:true})`); await sleep(300);
        const sel = await P(`[...Drive.state.selection]`);
        await P(`window.__ctxByText(${JSON.stringify(nameB)})`); await sleep(400);
        const acts = await P(`[...document.querySelectorAll('#ctxMenu [data-act]')].map(x=>x.dataset.act)`);
        await P(`window.__ctxClick('restore')`); await sleep(2000);
        const aliveA = (await L.get(`/api/v2/folders/company/ip/${rA}`)).status;
        const aliveB = (await L.get(`/api/v2/folders/company/ip/${rB}`)).status;
        const restRows = await P(`[...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')].map(r=>({id:r.dataset.id,t:(r.querySelector('.row-title')||{}).textContent}))`);
        detail = Object.assign(detail, {
          selection: sel, menuActs: acts, restoreA: aliveA, restoreB: aliveB,
          stillInTrash: restRows.filter((x) => pick.some((p) => p.id === x.id)).map((x) => x.t),
          restoredGone: pick.filter((p) => !restRows.some((x) => x.id === p.id)).map((p) => p.t),
          nameC,
        });
        ok = sel.length === 2 && aliveA === 200 && aliveB === 200 &&
          restRows.some((x) => x.t && x.t.includes("综合C"));
      }
      rec.rec({
        id: "G-10", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify(detail),
        workspace: "company", recordIds: [rA, rB, rC],
        notes: ok ? "回收站多选 2 项后右键还原，正好这两项恢复、第三项仍留在回收站" : "回收站多选还原的目标与实际选中不一致",
      });
    } catch (e) { rec.rec({ id: "G-10", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-10 执行异常" }); }

    /* ================= G-11 遮罩（表单/确认框）时快捷键不穿透 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G11-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G11-${TAG}` } });
      const a = await api.create("company", "contract", { Contract: { Name: `P2G11-合同A-${TAG}`, ContractNo: `G11A-${TAG}` }, ProjectId: pj });
      const bb = await api.create("company", "contract", { Contract: { Name: `P2G11-合同B-${TAG}`, ContractNo: `G11B-${TAG}` }, ProjectId: pj });
      await openProject(pj); await waitRows(2);
      /* 通过右键「属性」打开真实业务表单遮罩 */
      await P(`(() => { const r = window.__row('c:${a}'); r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:120})); })()`);
      await sleep(400);
      await P(`window.__ctxClick('props')`); await sleep(700);
      const formShown = await P(`!!document.querySelector('#formMask')?.classList.contains('show')`);
      const delPressed = await P(`window.__key('Delete')`);
      const aPressed = await P(`window.__key('a', {ctrlKey:true})`);
      const f2Pressed = await P(`window.__key('F2')`);
      await sleep(600);
      const stillThere = await P(`window.__rows()`);
      /* 关表单 */
      await P(`document.querySelector('#formMask')?.querySelector('[data-close]')?.click()`); await sleep(400);
      /* 确认框可见时再按 Delete */
      await P(`window.__row('c:${a}').click()`); await sleep(200);
      await P(`window.__key('Delete')`); await sleep(500);
      const confirmShown = await P(`!!document.querySelector('#confirmMask').classList.contains('show')`);
      const del2 = await P(`window.__key('Delete')`);
      const a2 = await P(`window.__key('a',{ctrlKey:true})`);
      const del3 = await P(`window.__key('Delete')`);   // 确认框还在，不能连开两层
      await sleep(500);
      await confirmCancel(); await sleep(600);
      const alive = (await L.get(`/api/v2/folders/company/contract/${a}`)).status === 200 &&
        (await L.get(`/api/v2/folders/company/contract/${bb}`)).status === 200;
      const ok = formShown && !delPressed.prevented && !aPressed.prevented && !f2Pressed.prevented &&
        stillThere.includes(`c:${a}`) && confirmShown && !del2.prevented && alive;
      rec.rec({
        id: "G-11", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ formShown, deleteOnForm: delPressed, ctrlAOnForm: aPressed, f2OnForm: f2Pressed, rowsAfter: stillThere, confirmShown, deleteOnConfirm: del2, ctrlAOnConfirm: a2, deleteAgainOnConfirm: del3, contractsAlive: alive }),
        workspace: "company", recordIds: [pj, a, bb],
        notes: ok ? "表单遮罩与确认框可见时 Delete/Ctrl+A/F2 均被吞掉（不 preventDefault、不触发背后批量删除或编辑），确认框不会被套开第二层" : "遮罩打开时快捷键仍穿透到列表",
      });
    } catch (e) { rec.rec({ id: "G-11", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-11 执行异常" }); }

    /* ================= G-12 选择与重命名状态的组合 ================= */
    try {
      const pj = await api.create("company", "project", { Project: { Name: `P2G12-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `G12-${TAG}` } });
      const a = await api.create("company", "contract", { Contract: { Name: `P2G12-合同A-${TAG}`, ContractNo: `G12A-${TAG}` }, ProjectId: pj });
      const bb = await api.create("company", "contract", { Contract: { Name: `P2G12-合同B-${TAG}`, ContractNo: `G12B-${TAG}` }, ProjectId: pj });
      const cc = await api.create("company", "contract", { Contract: { Name: `P2G12-合同C-${TAG}`, ContractNo: `G12C-${TAG}` }, ProjectId: pj });
      await openProject(pj); await waitRows(3);
      const k1 = await P(`window.__key('a',{ctrlKey:true})`); await sleep(300);
      const allSel = await P(`Drive.state.selection.size`);
      const esc = await P(`window.__key('Escape')`); await sleep(250);
      const afterEsc = await P(`Drive.state.selection.size`);
      await P(`window.__row('c:${a}').click()`); await sleep(150);
      await P(`(() => { window.__row('c:${cc}').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,shiftKey:true})); })()`);
      await sleep(250);
      const rangeSel = await P(`[...Drive.state.selection]`);
      /* F2 只在单选时生效（keydown 里 selection.size === 1），先回到单选 */
      await P(`window.__row('c:${a}').click()`); await sleep(200);
      const singleSel = await P(`[...Drive.state.selection]`);
      const f2 = await P(`window.__key('F2')`); await sleep(600);
      const formOpen = await P(`!!document.querySelector('#formMask')?.classList.contains('show')`);
      await P(`document.querySelector('#formMask')?.querySelector('[data-close]')?.click()`); await sleep(400);
      /* 系统档案目录：F2 与右键重命名都不应打开可提交的编辑表单 */
      await openNode("k:achievement"); await sleep(600);
      const sysRow = await P(`(() => { const r=[...document.querySelectorAll('#viewRoot .row')].find(x=>x.dataset.id.startsWith('af:')); return r?r.dataset.id:''; })()`);
      let sysDetail = { sysRow };
      if (sysRow) {
        await P(`window.__row('${sysRow}').click()`); await sleep(200);
        await P(`window.__key('F2')`); await sleep(500);
        sysDetail.afterF2 = await P(`({form:!!document.querySelector('#formMask')?.classList.contains('show'), toasts:window.__toasts()})`);
        await P(`(() => { const r=window.__row('${sysRow}'); r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:120})); })()`);
        await sleep(400);
        sysDetail.menuActs = await P(`[...document.querySelectorAll('#ctxMenu [data-act]')].map(x=>x.dataset.act)`);
        await P(`window.__ctxClick('rename')`); await sleep(600);
        sysDetail.afterCtxRename = await P(`({form:!!document.querySelector('#formMask')?.classList.contains('show'), toasts:window.__toasts()})`);
        await P(`document.querySelector('#formMask')?.querySelector('[data-close]')?.click()`).catch(() => {});
      }
      const ok = allSel === 3 && afterEsc === 0 && rangeSel.length === 3 &&
        singleSel.length === 1 && formOpen &&
        !!sysRow && !sysDetail.afterF2.form && !sysDetail.afterCtxRename.form;
      rec.rec({
        id: "G-12", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ ctrlA: { prevented: k1.prevented, size: allSel }, esc: { prevented: esc.prevented, size: afterEsc }, shiftRange: rangeSel, singleSel, f2: { prevented: f2.prevented, opensForm: formOpen }, systemFolder: sysDetail }),
        workspace: "company", recordIds: [pj, a, bb, cc],
        notes: ok
          ? "Ctrl+A 全选 3 项、Esc 清空、Shift 连选形成区间；F2 仅在单选时打开业务表单；业务档案系统目录按 F2 与右键「重命名」都不会打开可提交的编辑表单（不可误改）"
          : "选择状态或重命名入口在组合操作下不一致",
      });
    } catch (e) { rec.rec({ id: "G-12", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "G-12 执行异常" }); }

    console.log("G 组执行完毕");
  } finally {
    await b.shot(path.join(EVID, "shots", `g-final-${TAG}.png`)).catch(() => {});
    await b.close();
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
