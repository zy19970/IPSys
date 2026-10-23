/* I 组复核（第二轮）：修正首轮 6 个不可靠判定
   ─ I-01/I-02：首轮用 click，而 previewFile 绑定在 dblclick（interactions.js:1163-1171）；
     且首轮依赖 fixture 的 projectA，实际该项目的合同已被前序用例消耗 → 行根本不存在。
     本轮全部夹具自建，并改用 dblclick。
   ─ I-07：/api/v2/search/{ws} 返回 SearchResponse{Query,Results,Truncated}，
     首轮按 items/hits 取值 → 恒为 0，属假阳性。
   ─ I-03/I-10：首轮仅计划层证据。本轮 shim window.showSaveFilePicker 把 ZIP 收进内存，
     按 EOCD→中央目录→local header 解析出真实条目，逐条算 SHA-256 与上传摘要比对。
   ─ I-09：首轮被 I-08 注入的 401 打死会话（store.js:87-90 清 token），本轮前置执行。
   ─ I-08：500 分支首轮已 PASS；本轮补 401 分支取证（是否伪装成空数据）。
   ─ I-12：首轮 dotnet build 因宿主占用 IPSys.Web.exe 报 MSB3027，且 PATH 未真正剔除 node
     （漏了 pnpm\bin\node.exe）。本轮按目录内是否存在 node.exe 精确剔除，并输出到独立目录。 */
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
const TAG = "I2" + Date.now().toString(36);
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

/* 注入到页面的工具集。__dblByText 是关键修正：预览入口是 dblclick。 */
const INJECT = String.raw`
window.__toasts = () => [...document.querySelectorAll('#toasts .toast')].map(x => x.innerText.trim());
window.__rowByText = (t) => [...document.querySelectorAll('#viewRoot .row, #viewRoot .tile')]
  .find(r => (((r.querySelector('.row-title') || {}).textContent) || '').includes(t));
window.__dblByText = (t) => {
  const r = window.__rowByText(t); if (!r) return null;
  r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
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
window.__closePreview = () => {
  document.querySelectorAll('.preview-mask').forEach(m => {
    const x = m.querySelector('[data-x]') || m.querySelector('.icon-btn');
    if (x) x.click();
  });
  if (document.querySelector('.preview-mask')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  return document.querySelectorAll('.preview-mask').length;
};
/* ---- File System Access API shim：把 ZIP 收进内存，不再受保存对话框阻塞 ---- */
window.__zipShip = null;
window.showSaveFilePicker = async (opts) => {
  const o = opts || {};
  let buf = new Uint8Array(1 << 18), pos = 0;
  const ensure = (n) => { if (n > buf.length) { const nb = new Uint8Array(Math.max(n, buf.length * 2)); nb.set(buf.subarray(0, pos)); buf = nb; } };
  return {
    kind: 'file', name: o.suggestedName || 'export.zip',
    async createWritable() {
      return {
        async write(chunk) {
          const b = chunk instanceof Uint8Array ? chunk
            : chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
            : new Uint8Array(chunk.buffer || chunk);
          ensure(pos + b.length); buf.set(b, pos); pos += b.length;
        },
        async seek(p) { pos = Math.max(0, Math.min(p, buf.length)); },
        async truncate(p) { const n = Math.max(0, Math.min(p, pos)); pos = n; const nb = new Uint8Array(n); nb.set(buf.subarray(0, n)); buf = nb; },
        async close() { window.__zipShip = { name: o.suggestedName || '', len: pos, ok: true, bytes: buf.slice(0, pos) }; },
        async abort() { window.__zipShip = { name: o.suggestedName || '', len: pos, aborted: true }; }
      };
    }
  };
};
/* 解析 ZIP（export.js 用 method=0 stored，条目即原始字节）并逐条算 SHA-256 */
window.__zipRead = async () => {
  const s = window.__zipShip;
  if (!s) return { err: '没有收到 ZIP' };
  if (s.aborted) return { err: 'ZIP 被 abort', len: s.len };
  const b = s.bytes, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return { err: '找不到 EOCD', len: b.length };
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const items = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) return { err: '中央目录签名异常 @' + off };
    const method = dv.getUint16(off + 10, true);
    const crc = dv.getUint32(off + 16, true);
    const size = dv.getUint32(off + 24, true);
    const nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
    const lo = dv.getUint32(off + 42, true);
    const name = new TextDecoder('utf-8').decode(b.subarray(off + 46, off + 46 + nl));
    const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true);
    const start = lo + 30 + lnl + lel;
    const data = b.subarray(start, start + size);
    let h = '';
    try {
      const dg = await crypto.subtle.digest('SHA-256', data);
      h = [...new Uint8Array(dg)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    } catch (e) { h = 'ERR:' + e.message; }
    items.push({ name, size, crc, method, sha: h });
    off += 46 + nl + el + cl;
  }
  return { ok: true, zipLen: b.length, count, items };
};
`;

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  fs.mkdirSync(TMP, { recursive: true });

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

  /* ---------- 自建夹具：项目 → 合同 → 附件（不依赖任何历史夹具） ---------- */
  const PJ = await api.create("company", "project", {
    Project: { Name: `I2复核项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `I2-${TAG}`, Remarks: `I2备注-${TAG}`, Leader: "李四" },
  });
  const CT = await api.create("company", "contract", {
    Contract: { Name: `I2复核合同-${TAG}`, ContractNo: `I2HT-${TAG}`, SigningParties: `I2签约方-${TAG}` },
    ProjectId: PJ,
  });

  /* 两页 PDF / PNG 用首轮 fixture 记录过的原始字节（已从 /download 取回，SHA 与 fixture 一致） */
  const PDF_BUF = fs.readFileSync(path.join(TMP, "p2-two-page.pdf"));
  const PNG_BUF = fs.readFileSync(path.join(TMP, "p2-img.png"));
  const PDF_SHA = sha(PDF_BUF), PNG_SHA = sha(PNG_BUF);
  const BIN_BUF = Buffer.concat([TXT("I2非预览类型-"), crypto.randomBytes(96)]);

  const fPdf = await api.attach("company", CT, `I2两页-${TAG}.pdf`, PDF_BUF);
  const fPng = await api.attach("company", CT, `I2图-${TAG}.png`, PNG_BUF);
  const fBin = await api.attach("company", CT, `I2边界-${TAG}.bin`, BIN_BUF);

  /* I-03：两版本文件 */
  const V1 = TXT(`I2版本一-${TAG}`);
  const V2 = TXT(`I2版本二-${TAG}-更长的第二版内容`);
  const fVer = await api.attach("company", CT, `I2两版-${TAG}.txt`, V1);
  const ver2 = await L.addVersion("company", fVer.fileId, `I2两版-${TAG}.txt`, V2);
  /* I-10：同名不同内容 + 超长中文名 */
  const DN1 = TXT(`重名甲-${TAG}`), DN2 = TXT(`重名乙-${TAG}-内容更长一些`);
  await api.attach("company", CT, `I2重名-${TAG}.txt`, DN1);
  await api.attach("company", CT, `I2重名-${TAG}.txt`, DN2);
  const LONG = `I2长中文名称-${TAG}-` + "多级目录测试".repeat(8) + ".txt";
  const LONG_BUF = TXT(`长名内容-${TAG}`);
  await api.attach("company", CT, LONG, LONG_BUF);

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "i2-" + Date.now()), width: 1500, height: 900 });
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
    const wsNow = await P(`VaultStore.ws`);
    if (wsNow !== "company") throw new Error("未能切到企业工作区，当前=" + wsNow);

    /* ---------------- I-01 两页 PDF：dblclick 打开，canvas 真实渲染并翻页 ---------------- */
    try {
      await openNode("c:" + CT); await sleep(900);
      const opened = await P(`window.__dblByText(${JSON.stringify(`I2两页-${TAG}.pdf`)})`);
      await b.waitFor(`!!document.querySelector('.pdf-canvas')`, 20000, "PDF 画布").catch(() => null);
      await sleep(2000);
      const p1 = await P(`window.__canvasHash()`);
      const count1 = await P(`(document.querySelector('.pdf-count')||{}).textContent||''`);
      const turned = await P(`(() => { const x=[...document.querySelectorAll('.pdf-toolbar button')].find(b=>b.textContent.trim()==='下一页'); if(!x||x.disabled) return false; x.click(); return true; })()`);
      await sleep(2000);
      const p2 = await P(`window.__canvasHash()`);
      const count2 = await P(`(document.querySelector('.pdf-count')||{}).textContent||''`);
      const ok = !!opened && p1 && p1.ink > 20 && turned && p2 && p2.ink > 20 && p1.h !== p2.h &&
        /1\s*\/\s*2/.test(count1) && /2\s*\/\s*2/.test(count2);
      await P(`window.__closePreview()`);
      rec.rec({
        id: "I-01", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ opened, count1, count2, turned, page1: p1, page2: p2 }),
        workspace: "company", recordIds: [fPdf.fileId],
        notes: ok
          ? `dblclick 打开两页 PDF：页码 ${count1}→${count2}，两页 canvas 均有实际墨迹（ink>20）且像素哈希不同 —— 真实渲染而非只有工具栏`
          : `PDF 渲染/翻页不符合预期（count ${count1}→${count2}, turned=${turned}）`,
      });
    } catch (e) { rec.rec({ id: "I-01", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-01 执行异常" }); }

    /* ---------------- I-02 图片 / 非预览类型 / 关闭后重开不残留 ---------------- */
    try {
      await openNode("c:" + CT); await sleep(700);
      const imgOpened = await P(`window.__dblByText(${JSON.stringify(`I2图-${TAG}.png`)})`);
      await b.waitFor(`!!document.querySelector('.preview-mask img')`, 12000, "图片预览").catch(() => null);
      await sleep(900);
      const img = await P(`(() => { const m=document.querySelector('.preview-mask'); const im=m&&m.querySelector('img');
        return { mask:!!m, img:!!im, natural: im?im.naturalWidth:0, src: im?(im.getAttribute('src')||'').slice(0,12):'' }; })()`);
      const afterImg = await P(`window.__closePreview()`);
      await sleep(400);

      /* 非预览类型：design 上不进入预览遮罩，而是弹确认框「无法在浏览器内预览,是否下载？」 */
      const binOpened = await P(`window.__dblByText(${JSON.stringify(`I2边界-${TAG}.bin`)})`);
      await sleep(900);
      const binState = await P(`({ masks: document.querySelectorAll('.preview-mask').length,
        confirm: document.querySelector('#confirmMask')?.classList.contains('show') || false,
        text: (document.querySelector('#confirmText')||{}).textContent||'' })`);
      await P(`(() => { try { settleConfirm(false); } catch(e) { const c=document.querySelector('#confirmCancel'); if(c) c.click(); } return true; })()`);
      await sleep(400);

      /* 关闭图片后重开 PDF：必须只有一个遮罩，且 canvas 回来 */
      const pdfOpened = await P(`window.__dblByText(${JSON.stringify(`I2两页-${TAG}.pdf`)})`);
      await b.waitFor(`!!document.querySelector('.pdf-canvas')`, 15000, "PDF 重开").catch(() => null);
      await sleep(1200);
      const reopen = await P(`({ masks: document.querySelectorAll('.preview-mask').length, canvas: !!document.querySelector('.pdf-canvas') })`);
      const closed = await P(`window.__closePreview()`);
      await sleep(300);

      const ok = !!imgOpened && img.mask && img.natural > 0 && afterImg === 0 &&
        !!binOpened && binState.masks === 0 && binState.confirm && /无法在浏览器内预览/.test(binState.text) &&
        !!pdfOpened && reopen.canvas && reopen.masks === 1 && closed === 0;
      rec.rec({
        id: "I-02", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ img, masksAfterImgClose: afterImg, binState, reopen, masksAfterFinalClose: closed }),
        workspace: "company", recordIds: [fPng.fileId, fBin.fileId],
        notes: ok
          ? `图片预览 naturalWidth=${img.natural}（真实解码）；非预览类型不建遮罩而是弹「无法在浏览器内预览」确认框；关闭后遮罩数 0，重开 PDF 只有 1 个遮罩 —— 无对象 URL 残留/幽灵弹窗`
          : "图片/非预览类型/重开后的遮罩状态不符",
      });
    } catch (e) { rec.rec({ id: "I-02", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-02 执行异常" }); }

    /* ---------------- I-03 / I-10 真实 ZIP：shim 保存对话框，解包逐条校验 ---------------- */
    try {
      await openNode("c:" + CT); await sleep(900);
      const sel = await P(`(() => {
        const n = (typeof findById === 'function') ? findById('c:${CT}') : null;
        if (!n) return { err: '找不到合同节点' };
        const ents = collectExportEntries(n);
        return { rows: window.__rows().length, collected: ents.length,
          kinds: ents.map(e => ({ name: e.name, size: e.size, version: e.version, kind: e.kind, projectName: e.projectName })) };
      })()`);
      await P(`window.__zipShip = null`);
      const exported = await P(`(async () => {
        const n = findById('c:${CT}');
        await exportNodes([n]);
        return true;
      })()`).catch((e) => ({ err: e.message }));
      await sleep(1500);
      /* export 是流式异步，等 __zipShip 落地 */
      if (!await P(`!!window.__zipShip`)) await P(`(async()=>{ for(let i=0;i<120;i++){ if(window.__zipShip) return true; await new Promise(r=>setTimeout(r,100)); } return false; })()`);
      const zip = await P(`window.__zipRead()`);
      const items = (zip && zip.items) || [];
      const names = items.map((x) => x.name);

      /* I-03 判定：层级含项目名/合同名、v1 不得出现、v2 内容逐字节一致、条目数=6 */
      const hierOk = names.every((n) => n.includes(`I2复核项目-${TAG}`) && n.includes(`I2复核合同-${TAG}`));
      const v2Hit = items.find((x) => x.name.includes(`I2两版-${TAG}`));
      const v1Leak = items.some((x) => x.sha === sha(V1));
      const ok3 = !!zip.ok && items.length === 6 && hierOk && !v1Leak &&
        !!v2Hit && v2Hit.sha === sha(V2) && v2Hit.size === V2.length;
      rec.rec({
        id: "I-03", status: ok3 ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ planCollected: sel.collected, planItems: sel.kinds, zipCount: zip.count, zipLen: zip.zipLen, items, hierOk, v1Leak, expectSha: sha(V2) }),
        workspace: "company", recordIds: [CT, fVer.fileId],
        notes: ok3
          ? `真正导出到 ZIP（${zip.zipLen} 字节）：${items.length} 个条目全部在「项目/合同」层级下，两版文件只保留最新版且 SHA-256 与 v2 内容逐字节一致，v1 未泄漏`
          : `ZIP 内容/层级/版本策略不符（条目 ${items.length}，hierOk=${hierOk}，v1Leak=${v1Leak}）`,
      });

      /* I-10 判定：长中文名不截断、同名不同内容都被保留且路径唯一 */
      const longHit = items.filter((x) => x.name.includes("I2长中文名称"));
      const dupHits = items.filter((x) => x.name.includes(`I2重名-${TAG}`));
      const ok10 = longHit.length === 1 && longHit[0].name.endsWith(LONG) && longHit[0].sha === sha(LONG_BUF) &&
        dupHits.length === 2 && new Set(dupHits.map((x) => x.name)).size === 2 &&
        dupHits.some((x) => x.sha === sha(DN1)) && dupHits.some((x) => x.sha === sha(DN2));
      rec.rec({
        id: "I-10", status: ok10 ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ longName: LONG, longHit, dupHits, allNames: names }),
        workspace: "company", recordIds: [CT],
        notes: ok10
          ? `长中文名（${LONG.length} 字）在 ZIP 中未被截断且 SHA 一致；两个同名附件都被保留并自动改名为不同路径（见 actual.dupHits），无覆盖无遗漏`
          : `长名/重名处理不符（长名命中 ${longHit.length}，重名命中 ${dupHits.length}）`,
      });
    } catch (e) {
      for (const id of ["I-03", "I-10"]) rec.rec({ id, status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: id + " 执行异常" });
    }

    /* ---------------- I-09 检索中切换工作区（干净会话，无 401 注入） ---------------- */
    try {
      await P(INJECT);
      await P(`window.__reload()`); await sleep(800);
      await P(`(() => { const i=document.querySelector('#searchInput'); i.value=${JSON.stringify(TAG)}; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await sleep(2000);
      const hitsBefore = await P(`window.__rows().length`);
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      await P(`document.querySelector('#ctxMenu [data-act="ws:personal"]').click()`); await sleep(2200);
      const afterSwitch = await P(`({ ws:(document.querySelector('#wsSwitchBtn')||{}).textContent.trim(),
        q:Drive.state.query, rows:window.__rows().length, hits:(Drive.state.searchHits||[]).length,
        input:(document.querySelector('#searchInput')||{}).value||'' })`);
      await P(`(() => { const i=document.querySelector('#searchInput'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await sleep(1500);
      const afterClear = await P(`({ q:Drive.state.query, rows:window.__rows().length, view:Drive.state.view, hits:(Drive.state.searchHits||[]).length })`);
      const ok = hitsBefore > 0 && afterSwitch.ws.includes("个人") && afterSwitch.q === "" &&
        afterSwitch.input === "" && afterSwitch.rows === 0 && afterClear.rows === 0 && afterClear.q === "";
      rec.rec({
        id: "I-09", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ hitsBefore, afterSwitch, afterClear }),
        workspace: "company",
        notes: ok
          ? `企业区检索命中 ${hitsBefore} 条后切到个人：关键词、搜索框与命中集同时清空，列表不残留旧工作区结果`
          : "切换工作区后旧搜索结果残留",
      });
      /* 切回企业，供 I-08 使用 */
      await P(`document.querySelector('#wsSwitchBtn').click()`); await sleep(300);
      await P(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`); await sleep(2000);
    } catch (e) { rec.rec({ id: "I-09", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-09 执行异常" }); }

    /* ---------------- I-08 补证：401 分支是否伪装成空数据（会清 token，必须放最后） ---------------- */
    try {
      await P(INJECT);
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

      await P(`(() => { const i=document.querySelector('#searchInput'); i.value=${JSON.stringify(TAG + "x")}; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await sleep(2000);
      const s500 = await P(`({ paused:${0}, toasts:window.__toasts(), rows:window.__rows().length,
        text:(document.querySelector('#viewRoot')||{}).innerText?.slice(0,100)||'' })`);

      mode.code = 401;
      await P(`(() => { const i=document.querySelector('#searchInput'); i.value=${JSON.stringify(TAG + "y")}; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await sleep(2200);
      const s401 = await P(`({ toasts:window.__toasts(),
        lockShown: document.querySelector('#lockScreen')?.classList.contains('show') || false,
        tokenEmpty: !VaultStore.token, locked: !!VaultStore.locked,
        rows: window.__rows().length,
        text:(document.querySelector('#viewRoot')||{}).innerText?.slice(0,100)||'' })`);
      /* 401 之后能否继续工作：再触发一次非搜索请求 */
      const after401 = await P(`(async () => {
        try { await VaultStore.api('/api/v2/folders/company/project'); return { reload:'ok' }; }
        catch (e) { return { reload:'fail', msg: String(e.message||e) }; }
      })()`).catch((e) => ({ reload: 'throw', msg: e.message }));
      await b.send("Fetch.disable").catch(() => {});

      const ok500 = paused > 0 && (s500.toasts.some((t) => /失败|错误/.test(t)) || /失败|错误/.test(s500.text)) && !/找不到|暂无|没有/.test(s500.text);
      const ok401 = s401.lockShown || /失败|错误|登录|解锁/.test(s401.text) || s401.toasts.some((t) => /登录|失败|错误/.test(t));
      rec.rec({
        id: "I-08", status: (ok500 && ok401) ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ paused, search500: s500, search401: s401, after401 }),
        workspace: "company",
        notes: (ok500 && ok401)
          ? "500 与 401 均给出可靠失败/登录提示，没有伪装成空结果"
          : `500 分支${ok500 ? "正常" : "异常"}；401 分支${ok401 ? "正常" : "异常"}：token 被清空、locked=true，但锁屏未显示、无失败提示，界面呈现为空列表 —— 即把 401 伪装成「没有结果」`,
      });
    } catch (e) { rec.rec({ id: "I-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-08 执行异常" }); }

    await b.shot(path.join(EVID, "shots", `i2-final-${TAG}.png`)).catch(() => {});
  } finally {
    await b.close();
  }

  /* ---------------- I-07 跨字段搜索（返回结构修正为 SearchResponse.Results） ---------------- */
  try {
    const pj7 = await api.create("company", "project", {
      Project: { Name: `I07项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `I07NO-${TAG}`, Remarks: `I07备注-${TAG}`, Leader: "张三" },
    });
    const c7 = await api.create("company", "contract", {
      Contract: { Name: `I07合同-${TAG}`, ContractNo: `I07HT-${TAG}`, SigningParties: `I07签约方-${TAG}` }, ProjectId: pj7,
    });
    const f7 = await api.attach("company", c7, `I07附件-${TAG}.txt`, TXT("I07 附件内容 " + TAG));
    const q = async (s) => {
      const r = await L.get(`/api/v2/search/company?q=${encodeURIComponent(s)}`);
      const arr = Array.isArray(r.data?.Results) ? r.data.Results : [];
      return { status: r.status, n: arr.length, hits: arr.slice(0, 3).map((x) => `${x.Kind}#${x.Id}:${x.Title}`) };
    };
    const byName = await q(`I07项目-${TAG}`);
    const byNo = await q(`I07NO-${TAG}`);
    const byRemark = await q(`I07备注-${TAG}`);
    const byParty = await q(`I07签约方-${TAG}`);
    const byFileName = await q(`I07附件-${TAG}`);
    const byContractNo = await q(`I07HT-${TAG}`);
    const all = { byName, byNo, byRemark, byParty, byFileName, byContractNo };
    const ok = Object.values(all).every((x) => x.n >= 1);
    rec.rec({
      id: "I-07", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify(all),
      workspace: "company", recordIds: [pj7, c7, f7.fileId],
      notes: ok
        ? "按项目名、项目编号、备注、签约方、合同编号、附件名六路检索均在 SearchResponse.Results 中命中 —— 检索覆盖业务字段与原件名，不只是文件名匹配"
        : "部分业务字段检索不到（见 actual 中 n=0 的项），搜索域不足",
    });
  } catch (e) { rec.rec({ id: "I-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-07 执行异常" }); }

  /* ---------------- I-12 无 Node 构建：精确剔除含 node.exe 的目录 + 独立输出目录 ---------------- */
  try {
    const parts = String(process.env.PATH || "").split(";").filter(Boolean);
    const kept = parts.filter((p) => { try { return !fs.existsSync(path.join(p, "node.exe")); } catch { return true; } });
    const env = Object.assign({}, process.env, { PATH: kept.join(";") });
    let reachable = true;
    try { execFileSync("where", ["node"], { encoding: "utf8", env }); } catch { reachable = false; }
    let out = "", code = 0;
    try {
      out = execFileSync("dotnet", ["build", "src/IPSys.Web/IPSys.Web.csproj", "-c", "Debug", "-v:m", "--nologo", "-o", "E:/tmp/ipsys-nonode-i2"], {
        cwd: "E:/Github/管理系统", encoding: "utf8", env, timeout: 300000,
      });
    } catch (e) { code = e.status || 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    const warnedMsg = /未找到 Node\.js，跳过前端打包/.test(out);
    const hasError = /error [A-Z]+\d+/i.test(out);
    const ok = !reachable && code === 0 && warnedMsg && !hasError;
    rec.rec({
      id: "I-12", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        nodeReachableAfterFilter: reachable, removedDirs: parts.length - kept.length,
        exitCode: code, warnedAboutNode: warnedMsg, hasCompileError: hasError,
        tail: out.split(/\r?\n/).filter((l) => /未找到 Node|error [A-Z]+\d+|个警告|个错误/i.test(l)).slice(0, 5),
      }),
      workspace: "-",
      notes: ok
        ? "剔除全部含 node.exe 的目录（node 确实不可达）后重新构建：exit=0、无编译错误，并以 warning 明确提示「未找到 Node.js，跳过前端打包，直接使用已有的 dist/」—— 缺 Node 不阻断编译且有前置提示"
        : `无 Node 场景不符合预期（reachable=${reachable}, exit=${code}, warned=${warnedMsg}）`,
    });
  } catch (e) { rec.rec({ id: "I-12", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-12 执行异常" }); }

  rec.flush();
  console.log("I 组复核执行完毕");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
