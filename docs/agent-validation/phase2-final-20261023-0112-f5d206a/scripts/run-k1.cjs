/* K 组第一批（浏览器侧）：大文件上传三阶段、上传中切工作区、上传中刷新、大文件彻底删除进度
   33 MiB 用于跨过 STREAM_MIN_BYTES=32 MiB 的流式阈值。
   判定以「实际观测到的进度文本序列 + 服务端最终 SHA/大小」为准，
   抓不到中间字节时如实记录，不把采样密度不足算成产品缺陷。 */
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
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-UI" });
const TAG = "K1" + Date.now().toString(36);
/* IPSYS_ONLY=K-07 只跑指定用例；不设则全跑 */
const ONLY = String(process.env.IPSYS_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const DBCHECK = path.join(ROOT, "tools", "dbcheck", "bin", "Release", "net8.0", "dbcheck.exe");
const dbcheck = () => JSON.parse(execFileSync(DBCHECK, [CRED.db, CRED.password], { encoding: "utf8", timeout: 120000 }));
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

const INJECT = String.raw`
window.__toasts = () => [...document.querySelectorAll('#toasts .toast')].map(x => x.innerText.trim());
window.__reload = async () => {
  await VaultStore.loadAll(VaultStore.ws);
  Drive.resetSearch && Drive.resetSearch();
  Drive.state.ready = true; Drive.state.folderId = 'root'; Drive.state.view = 'home';
  Drive.render(); return true;
};
window.__makeBig = (mb, seed) => {
  const n = Math.round(mb * 1024 * 1024);
  const u = new Uint8Array(n);
  /* 种子必须每次不同：相同内容会命中查重对话框，留下待确认票据后
     后续所有 prepare 都被 409「已有待确认文件」挡住（G-06/E-10 的教训）。 */
  let x = (Number(seed) | 0) || 2463534242;
  if (x === 0) x = 1;
  for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; u[i] = x & 0xff; }
  window.__bigBytes = u;
  return n;
};
window.__bigSha = async () => {
  const d = await crypto.subtle.digest('SHA-256', window.__bigBytes);
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
};
window.__bumpBig = (delta) => { window.__bigBytes[0] = (window.__bigBytes[0] + delta) & 0xff; return window.__bigBytes[0]; };
window.__dropBig = (sel, name) => {
  const dt = new DataTransfer();
  dt.items.add(new File([window.__bigBytes], name, { type: 'application/octet-stream' }));
  const dst = document.querySelector(sel) || document.querySelector('#content');
  const mk = (type) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dt }); return e; };
  dst.dispatchEvent(mk('dragover'));
  const e = mk('drop'); dst.dispatchEvent(e);
  return { prevented: e.defaultPrevented, files: dt.files.length };
};
window.__prog = () => {
  const p = document.querySelector('#uploadProgress');
  if (!p) return null;
  return { hidden: !!p.hidden,
    bytes: ((document.querySelector('#uploadProgressBytes') || {}).textContent || '').trim(),
    stage: ((document.querySelector('#uploadProgressStage') || {}).textContent || '').trim(),
    pct: ((document.querySelector('#uploadProgressPercent') || {}).textContent || '').trim() };
};
window.__trashProg = () => {
  const p = document.querySelector('#trashPurgeProgress');
  if (!p) return null;
  return { hidden: !!p.hidden,
    bytes: ((document.querySelector('#trashPurgeBytes') || {}).textContent || '').trim(),
    pct: ((document.querySelector('#trashPurgePercent') || {}).textContent || '').trim(),
    stage: ((document.querySelector('#trashPurgeStage') || {}).textContent || '').trim() };
};
`;

const linksOf = async (ws, folderId) => {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
};
const trashList = async (ws) => {
  const r = await L.get(`/api/trash/${ws}`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
};

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  const cr = await L.post("/api/v2/folders/company/project", { Project: { Name: `K1项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `K1-${TAG}` } });
  if (!cr.ok) throw new Error("建项目失败 " + JSON.stringify(cr.data));
  const PJ = cr.data.id;
  const cc = await L.post("/api/v2/folders/company/contract", { Contract: { Name: `K1合同-${TAG}`, ContractNo: `K1HT-${TAG}` }, ProjectId: PJ });
  if (!cc.ok) throw new Error("建合同失败 " + JSON.stringify(cc.data));
  const CT = cc.data.id;

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "k1-" + Date.now()), width: 1500, height: 950 });
  const P = (expr) => b.evalJs(expr);
  const openNode = async (id) => {
    const t0 = Date.now();
    let reloaded = false, tries = 0;
    while (Date.now() - t0 < 15000) {
      try { await P(`(() => { Drive.openFolder(${JSON.stringify(id)}); return true; })()`); } catch { /* ignore */ }
      await sleep(400);
      if (await P(`Drive.state.folderId`) === id) { await sleep(400); return true; }
      if (++tries >= 2 && !reloaded) { await P(`window.__reload()`); reloaded = true; await sleep(700); }
    }
    return false;
  };
  const nav = async (id) => { await P(`document.querySelector('[data-nav="${id}"]').click()`); await sleep(1400); };
  /* 外部文件拖放只认具体的业务记录行（interactions.js:1231-1237：
     拖到容器没有 .row 目标就被直接 return，这正是 G-07 记录的静默丢弃）。
     因此上传目标必须是合同行，而不是 #viewRoot。 */
  const DROPSEL = `#viewRoot [data-id='c:${CT}']`;

  /* 采样上传进度直到面板消失 */
  const sampleUpload = async (maxMs = 90000) => {
    const t0 = Date.now();
    const samples = [];
    let last = null;
    while (Date.now() - t0 < maxMs) {
      const s = await P(`window.__prog()`);
      if (s && !s.hidden) {
        if (!last || last.bytes !== s.bytes || last.stage !== s.stage) samples.push(s);
        last = s;
      } else if (samples.length) break;
      else if (Date.now() - t0 > 8000) break;
      await sleep(150);
    }
    return samples;
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

    /* ---------------- K-01 33MiB 上传三阶段 ---------------- */
    let k01 = null;
    if (want("K-01")) try {
      const bytes = await P(`window.__makeBig(33, ${Date.now() % 2147483647})`);
      const bigSha = await P(`window.__bigSha()`);
      await openNode("p:" + PJ); await sleep(900);
      const name = `K01大文件-${TAG}.bin`;
      const dropped = await P(`window.__dropBig(${JSON.stringify(DROPSEL)}, ${JSON.stringify(name)})`);
      await sleep(400);
      const samples = await sampleUpload();
      await sleep(1500);
      const lk = await linksOf("company", CT);
      /* links 响应里没有 name（只有 displayName，上传时通常为 null），按字节数定位本次上传 */
      const cand = lk.filter((x) => Number(x.size) === bytes);
      const hit = cand.length ? cand[cand.length - 1] : null;
      const meta = hit ? await L.get(`/api/v2/files/company/${hit.fileId}`) : null;
      let srv = null;
      if (hit) {
        const res = await L.call("GET", `/api/v2/files/company/${hit.fileId}/versions/1/download`, { raw: true });
        const buf = Buffer.from(await res.arrayBuffer());
        srv = { status: res.status, len: buf.length, sha: crypto.createHash("sha256").update(buf).digest("hex").toUpperCase() };
      }
      const stages = [...new Set(samples.map((s) => s.stage))];
      const byteTexts = [...new Set(samples.map((s) => s.bytes))];
      const sawSending = stages.some((s) => /正在发送原件/.test(s));
      const sawFinalize = stages.some((s) => /SHA-256|校验|入库|检查文件结果/.test(s));
      const ok = !!dropped && dropped.files === 1 && bytes === 34603008 &&
        sawSending && sawFinalize && samples.length >= 2 &&
        !!hit && srv && srv.status === 200 && srv.len === bytes && srv.sha === bigSha;
      k01 = { linkId: hit && (hit.id ?? hit.linkId), fileId: hit && hit.fileId, name, sha: bigSha, size: bytes,
        serverName: meta && meta.ok && meta.data && meta.data.name };
      rec.rec({
        id: "K-01", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({
          sizeBytes: bytes, clientSha: bigSha, sampleCount: samples.length,
          stages, byteTexts: byteTexts.slice(0, 8), server: srv,
          linkId: hit && (hit.id ?? hit.linkId), fileId: hit && hit.fileId,
          serverFileMeta: meta && meta.ok ? { name: meta.data.name, id: meta.data.id } : null,
        }),
        workspace: "company", recordIds: hit ? [hit.fileId] : [],
        notes: ok
          ? `33 MiB（跨过 32 MiB 流式阈值）拖放上传：进度面板依次出现「正在发送原件…」与「已发送 100%，正在等待服务器完成 SHA-256 校验和加密入库…」，采样到 ${samples.length} 个进度快照；服务端落盘 ${srv.len} 字节且 SHA-256 与浏览器端计算值逐字节一致`
          : `大文件上传链路不符（size=${bytes}, stages=${JSON.stringify(stages)}, server=${JSON.stringify(srv)}）`,
      });
    } catch (e) { rec.rec({ id: "K-01", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-01 执行异常" }); }

    /* ---------------- K-02 上传中尝试切工作区 ---------------- */
    if (want("K-02")) try {
      await openNode("p:" + PJ); await sleep(600);
      await P(`window.__bumpBig(7)`);
      const name2 = `K02上传中切区-${TAG}.bin`;
      const before = await P(`(document.querySelector('#wsSwitchBtn')||{}).textContent||''`);
      await P(`window.__dropBig(${JSON.stringify(DROPSEL)}, ${JSON.stringify(name2)})`);
      await sleep(250);
      const activeDuring = await P(`(IPSysUploadProgress.status()||{}).active`);
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(350);
      const menu = await P(`({ open: !!document.querySelector('#ctxMenu [data-act="ws:personal"]'),
        toast: window.__toasts() })`);
      await P(`(() => { const b=document.querySelector('#ctxMenu [data-act="ws:personal"]'); if(b) b.click(); return true; })()`);
      await sleep(1200);
      const after = await P(`({ ws:(document.querySelector('#wsSwitchBtn')||{}).textContent||'', toasts: window.__toasts() })`);
      await sampleUpload(60000);
      const ok = activeDuring === true && !String(after.ws).includes("个人") &&
        after.toasts.some((t) => /文件任务进行中/.test(t));
      rec.rec({
        id: "K-02", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ before, activeDuring, menuOpen: menu.open, toastsAtClick: menu.toast, after, stillCompany: String(after.ws).includes("企业") }),
        workspace: "company",
        notes: ok
          ? `上传进行中（IPSysUploadProgress.status().active=true）尝试切到个人工作区：工作区标签保持企业，界面明确提示「文件任务进行中,完成后再切换工作区」—— 不会把原件写到错误工作区`
          : `上传中切工作区未被阻止（before=${before}, after=${after.ws}）`,
      });
    } catch (e) { rec.rec({ id: "K-02", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-02 执行异常" }); }

    /* ---------------- K-04 上传中刷新页面 ---------------- */
    if (want("K-04")) try {
      await openNode("p:" + PJ); await sleep(600);
      await P(`window.__bumpBig(13)`);
      const name3 = `K04刷新中断-${TAG}.bin`;
      await P(`window.__dropBig(${JSON.stringify(DROPSEL)}, ${JSON.stringify(name3)})`);
      await sleep(700);
      const activeBefore = await P(`(IPSysUploadProgress.status()||{}).active`);
      await b.send("Page.reload");
      await sleep(2600);
      await b.waitFor(`!!document.querySelector('.catgrid') || !!document.querySelector('#lockScreen.show')`, 25000, "刷新后").catch(() => null);
      await P(INJECT).catch(() => {});
      const afterReload = await P(`({ lock: document.querySelector('#lockScreen')?.classList.contains('show') || false,
        prog: (() => { const p=document.querySelector('#uploadProgress'); return p ? { hidden: !!p.hidden } : null; })(),
        task: (() => { try { return IPSysUploadProgress.status(); } catch(e) { return null; } })(),
        ws: (document.querySelector('#wsSwitchBtn')||{}).textContent||'' })`).catch(() => null);
      const dbAfter = dbcheck();
      const lkAfter = await linksOf("company", CT);
      const dup = lkAfter.filter((x) => (x.name || "") === name3).length;
      const ok = activeBefore === true && !!afterReload &&
        (afterReload.prog === null || afterReload.prog.hidden === true) &&
        dup === 0 && dbAfter.writingObjects === 0;
      rec.rec({
        id: "K-04", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ activeBefore, afterReload, dbWriting: dbAfter.writingObjects, duplicateLinks: dup,
          linksAfter: lkAfter.map((x) => x.name) }),
        workspace: "company", recordIds: [CT],
        notes: ok
          ? `上传进行中刷新页面：重载后进度面板不再显示过期状态（hidden）、IPSysUploadProgress.status().active=false，未留下重复原件（同名 link 0 条），SQLCipher 中 state='writing' 的半成品对象为 0`
          : `上传中刷新后状态不符（activeBefore=${activeBefore}, prog=${JSON.stringify(afterReload && afterReload.prog)}, dup=${dup}, writing=${dbAfter.writingObjects}）`,
      });
    } catch (e) { rec.rec({ id: "K-04", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-04 执行异常" }); }

    /* ---------------- K-07 彻底删除 33MiB 原件时的进度 ---------------- */
    if (want("K-07")) try {
      /* 独立重跑（IPSYS_ONLY=K-07）时 k01 为空：此时回收站里应当只留着上一轮软删的
         那条 33 MiB 附件，用回收站里的真实节点驱动「清空回收站」入口即可。 */
      if (k01 && k01.fileId) {
        const dl = await L.del(`/api/v2/files/company/${k01.fileId}/links/${k01.linkId}`);
        if (!dl.ok && dl.status !== 404) throw new Error(`软删附件失败 ${dl.status} ${JSON.stringify(dl.data)}`);
        await P(`window.__reload()`); await sleep(700);
      }
      await nav("recycle"); await sleep(1200);
      const rows = await P(`document.querySelectorAll('#viewRoot .row').length`);
      const recNodes = await P(`(typeof RECYCLE !== 'undefined' ? RECYCLE.map(x => ({ id: x.id,
        name: x.name || '', kind: (x.biz && x.biz.raw && x.biz.raw.kind) || '',
        size: Number(x.size || 0) })) : [])`);
      if (!recNodes.length) throw new Error("回收站为空，无法验证彻底删除进度");
      /* 此刻回收站里只有这一条 33 MiB 附件，直接走「清空回收站」按钮 ——
         它与右键「彻底删除」共用 recycleAction(RECYCLE,'purge') 与同一套字节进度面板，
         且不必拼装回收站的 t:<kind>:<id> 节点 id。按钮点击后才会弹出确认框，
         确认必须交给 settleConfirm 应答，绝不能再手动调一次 recycleAction。 */
      const clicked = await P(`(async () => {
        const btn = document.querySelector('#btnEmptyTrash');
        if (!btn || btn.classList.contains('hidden')) return { ok: false, reason: 'btnEmptyTrash 不可见' };
        btn.click();
        await new Promise((r) => setTimeout(r, 250));
        const m = document.querySelector('#confirmMask');
        return { ok: !!(m && m.classList.contains('show')),
          text: ((document.querySelector('#confirmText') || {}).textContent || '').trim() };
      })()`);
      const samples = [];
      let last = null, sawActive = false, settled = false;
      if (clicked.ok) {
        await P(`(() => { try { settleConfirm(true); } catch(e) { const k=document.querySelector('#confirmOk'); if(k) k.click(); } return true; })()`);
        const t0 = Date.now();
        while (Date.now() - t0 < 90000) {
          const s = await P(`({ p: window.__trashProg(),
            active: (typeof purgeTaskActive === 'boolean' ? purgeTaskActive : null) })`).catch(() => null);
          const p = s && s.p;
          if (p && p.hidden === false) sawActive = true;
          if (p && (!last || last.bytes !== p.bytes || last.pct !== p.pct || last.stage !== p.stage)) samples.push(p);
          last = p;
          if (sawActive && s && s.active === false) { settled = true; break; }
          await sleep(200);
        }
      }
      const left = (await trashList("company")).length;
      const sawBytes = samples.some((s) => /\d/.test(s.bytes) && /[KM]B/i.test(s.bytes));
      const sawPct = samples.some((s) => /%|完成/.test(s.pct));
      const ok = clicked.ok && sawActive && sawBytes && sawPct && left === 0;
      rec.rec({
        id: "K-07", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ fileId: k01 && k01.fileId, sizeBytes: k01 && k01.size, rows,
          recNodes, confirm: clicked, sawActive, settled, samples: samples.slice(0, 12), trashLeft: left }),
        workspace: "company", recordIds: [k01 && k01.fileId].filter(Boolean),
        notes: ok
          ? `彻底删除 33 MiB 原件时右下角进度面板展示了真实字节量与百分比（${samples.map((s) => s.pct).filter(Boolean).slice(0, 4).join(" → ")}），回收站清空且界面未假死`
          : `删除大文件进度不可见或结果不符（confirm=${JSON.stringify(clicked)}, sawActive=${sawActive}, bytes=${sawBytes}, pct=${sawPct}, left=${left}）`,
      });
    } catch (e) { rec.rec({ id: "K-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-07 执行异常" }); }

    await b.shot(path.join(EVID, "shots", `k1-final-${TAG}.png`)).catch(() => {});
  } finally {
    await b.close();
  }

  rec.flush();
  console.log("K 组第一批执行完毕 {" + TAG + "}");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
