/* 用 File System Access API shim 把 H-04 与 K-06 从 BLOCKED 里救回来。
   H-04 之前卡在「无头浏览器没人应答保存对话框」，K-06 卡在「没有稳定的导出时间窗口」；
   两者都可以用 I-03 已验证过的 shim 解决：ZIP 直接收进内存，再离线解包逐条核对。
   这两个用例都是 P0，不能用「环境做不到」含混过去。 */
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
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-UI" });
const TAG = "N" + Date.now().toString(36);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

const INJECT = String.raw`
window.__toasts = () => [...document.querySelectorAll('#toasts .toast')].map(x => x.innerText.trim());
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
    items.push({ name, size, method, sha: h });
    off += 46 + nl + el + cl;
  }
  return { ok: true, zipLen: b.length, count, items };
};
`;

const linksOf = async (ws, folderId) => {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  return Array.isArray(r.data) ? r.data : ((r.data && r.data.items) || []);
};
async function attach(ws, folderId, name, buf) {
  const up = ws === "company" ? await L.upload(folderId, name, buf) : await L.uploadIn(ws, folderId, name, buf);
  const arr = await linksOf(ws, folderId);
  const hit = arr.filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
  return { fileId: up.fileId, linkId: hit && (hit.id ?? hit.linkId), size: buf.length };
}

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  /* H-04 用：一个项目 + 两张合同，各挂 1 个附件 —— 只有分层对了，ZIP 里才会出现两条不同合同路径 */
  const pj = await L.post("/api/v2/folders/company/project",
    { Project: { Name: `N04项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `N04-${TAG}` } });
  if (!pj.ok) throw new Error("建项目失败 " + JSON.stringify(pj.data));
  const PJ = pj.data.id;
  const c1 = await L.post("/api/v2/folders/company/contract",
    { Contract: { Name: `N04合同甲-${TAG}`, ContractNo: `N04A-${TAG}` }, ProjectId: PJ });
  const c2 = await L.post("/api/v2/folders/company/contract",
    { Contract: { Name: `N04合同乙-${TAG}`, ContractNo: `N04B-${TAG}` }, ProjectId: PJ });
  const B1 = Buffer.from(`N04 甲附件 ${TAG}`, "utf8");
  const B2 = Buffer.from(`N04 乙附件 ${TAG} `.repeat(3), "utf8");
  const f1 = await attach("company", c1.data.id, `N04甲-${TAG}.txt`, B1);
  const f2 = await attach("company", c2.data.id, `N04乙-${TAG}.txt`, B2);

  /* K-06 用：33 MiB 附件（跨过 32 MiB 流式阈值），导出时给切工作区留出稳定窗口 */
  const BIG = crypto.randomBytes(33 * 1024 * 1024);
  const c3 = await L.post("/api/v2/folders/company/contract",
    { Contract: { Name: `N06合同-${TAG}`, ContractNo: `N06-${TAG}` }, ProjectId: PJ });
  const fBig = await attach("company", c3.data.id, `N06大附件-${TAG}.bin`, BIG);

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "n-" + Date.now()), width: 1500, height: 950 });
  const P = (expr) => b.evalJs(expr);
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

    /* ---------------- H-04 两个不同合同下的附件打包成 ZIP ---------------- */
    try {
      await P(`window.__zipShip = null`);
      const plan = await P(`(() => {
        const a = findById('c:${c1.data.id}'), b2 = findById('c:${c2.data.id}');
        if (!a || !b2) return { err: '找不到合同节点' };
        const ea = collectExportEntries(a), eb = collectExportEntries(b2);
        return { collected: ea.length + eb.length,
          plan: [...ea, ...eb].map(e => ({ name: e.name, size: e.size })) };
      })()`);
      await P(`(async () => { await exportNodes([findById('c:${c1.data.id}'), findById('c:${c2.data.id}')]); return true; })()`)
        .catch(() => {});
      if (!await P(`!!window.__zipShip`)) await P(`(async()=>{ for(let i=0;i<150;i++){ if(window.__zipShip) return true; await new Promise(r=>setTimeout(r,100)); } return false; })()`);
      const zip = await P(`window.__zipRead()`);
      const items = (zip && zip.items) || [];
      const names = items.map((x) => x.name);
      const inA = items.find((x) => x.name.includes(`N04合同甲-${TAG}`));
      const inB = items.find((x) => x.name.includes(`N04合同乙-${TAG}`));
      const hierOk = !!inA && !!inB && names.every((n) => n.includes(`N04项目-${TAG}`));
      const shaOk = !!inA && inA.sha === sha(B1) && !!inB && inB.sha === sha(B2);
      const sizeOk = !!inA && inA.size === B1.length && !!inB && inB.size === B2.length;
      const ok = !!zip.ok && zip.count === 2 && hierOk && shaOk && sizeOk;
      rec.rec({
        id: "H-04", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ plan, zipCount: zip && zip.count, zipLen: zip && zip.zipLen, items,
          hierOk, shaOk, sizeOk, expect: { a: sha(B1), b: sha(B2) } }),
        workspace: "company", recordIds: [f1.fileId, f2.fileId],
        notes: ok
          ? `用 showSaveFilePicker shim 真正拿到 ZIP（${zip.zipLen} 字节）：选中的 2 个附件来自两张不同合同，ZIP 里各自落在「N04项目/N04合同甲」与「N04项目/N04合同乙」两条独立路径下，条目数 2、字节数与 SHA-256 均与上传原件逐条一致 —— 层级与文件数都没丢`
          : `ZIP 层级或文件数不符（count=${zip && zip.count}, hier=${hierOk}, sha=${shaOk}, size=${sizeOk}）`,
      });
    } catch (e) { rec.rec({ id: "H-04", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "H-04 执行异常" }); }

    /* ---------------- K-06 33 MiB 导出进行中切工作区 ---------------- */
    try {
      await P(`window.__zipShip = null`);
      const beforeWs = String(await P(`(document.querySelector('#wsSwitchBtn')||{}).textContent||''`));
      /* 启动导出，不 await —— 立刻去切工作区，制造「导出中途切区」的真实窗口 */
      await P(`(() => { window.__k06done = false;
        exportNodes([findById('c:${c3.data.id}')]).then(() => { window.__k06done = true; })
          .catch((e) => { window.__k06err = e.message; window.__k06done = true; });
        return true; })()`);
      await sleep(280);
      const switched = await P(`(async () => {
        const btn = document.querySelector('#wsSwitchBtn');
        btn.click();
        await new Promise(r => setTimeout(r, 150));
        const item = document.querySelector('#ctxMenu [data-act="ws:personal"]');
        if (!item) return { ok: false, reason: '菜单里没有个人工作区项' };
        item.click();
        await new Promise(r => setTimeout(r, 1600));
        return { ok: true, ws: ((document.querySelector('#wsSwitchBtn')||{}).textContent||'').trim(),
          toasts: window.__toasts() };
      })()`);
      /* 等 ZIP 落地（33 MiB 流式拉取），最多 90 s */
      if (!await P(`!!window.__zipShip`)) await P(`(async()=>{ for(let i=0;i<300;i++){ if(window.__zipShip) return true; await new Promise(r=>setTimeout(r,300)); } return false; })()`);
      const zip = await P(`window.__zipRead()`);
      const items = (zip && zip.items) || [];
      const done = await P(`({ done: !!window.__k06done, err: window.__k06err || null })`);
      /* 切区之后列表可能已经换成个人区，用 API 取个人区里有没有同名文件，验证「没有混入」 */
      const personalLinks = [];
      for (const p of ((await L.get("/api/v2/ui/projects/personal")).data || []).slice(0, 40)) {
        if (!p || !p.id) continue;
        const arr = await linksOf("personal", p.id);
        for (const a of arr) personalLinks.push(String(a.fileName || a.displayName || ""));
      }
      const personalNames = personalLinks.filter(Boolean);
      const onlyCompany = items.length > 0 &&
        items.every((x) => x.name.includes(`N04项目-${TAG}`) || x.name.includes(`N06合同-${TAG}`)) &&
        !items.some((x) => personalNames.some((pn) => pn && x.name.includes(pn)));
      const bigOk = items.length === 1 && items[0].size === BIG.length && items[0].sha === sha(BIG);
      const switchedOk = switched.ok === true && String(switched.ws).includes("个人");
      const noHang = done.done === true && !done.err;
      const ok = onlyCompany && bigOk && switchedOk && noHang;
      rec.rec({
        id: "K-06", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({
          beforeWs, switched, zipCount: zip && zip.count, zipLen: zip && zip.zipLen, items,
          exportDone: done, personalFileNamesSample: personalNames.slice(0, 8), onlyCompany, bigOk,
        }),
        workspace: "company", recordIds: [fBig.fileId],
        notes: ok
          ? `33 MiB 附件导出进行中切到个人工作区：切换本身成功（顶栏变为「${String(switched.ws).trim()}」），导出没有被中断也没有报错，最终 ZIP 里只有 1 个条目且落在公司侧「N04项目/N06合同」路径下，大小 ${items[0].size} 字节、SHA-256 与原件一致；个人工作区同名文件 0 个混入 —— 浏览器侧逐附件拉流天然按 fileId 取数，跨区不串味`
          : `导出中途切区出现混入或挂死（onlyCompany=${onlyCompany}, big=${bigOk}, switched=${switchedOk}, noHang=${noHang}）`,
      });
    } catch (e) { rec.rec({ id: "K-06", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "K-06 执行异常" }); }

    await b.shot(path.join(EVID, "shots", `n-final-${TAG}.png`)).catch(() => {});
  } finally {
    await b.close();
  }

  rec.flush();
  console.log("H-04 / K-06 复核执行完毕 {" + TAG + "}");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
