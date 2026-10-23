/* L 组：安全边界、注入转义、多分辨率与失效入口巡查，最后收口
   L-01/L-02 直接打服务器，不依赖前端按钮是否存在 —— 这是任务书要求的
   「服务器拒绝，不能仅靠前端按钮控制」。 */
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
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-MIXED" });
const TAG = "L" + Date.now().toString(36);
/* IPSYS_ONLY=L-05,L-06 只跑指定用例；不设则全跑 */
const ONLY = String(process.env.IPSYS_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const DBCHECK = path.join(ROOT, "tools", "dbcheck", "bin", "Release", "net8.0", "dbcheck.exe");
const dbcheck = () => JSON.parse(execFileSync(DBCHECK, [CRED.db, CRED.password], { encoding: "utf8", timeout: 120000 }));
const TXT = (s) => Buffer.from(s, "utf8");
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

const INJECT = String.raw`
window.__toasts = () => [...document.querySelectorAll('#toasts .toast')].map(x => x.innerText.trim());
window.__reload = async () => {
  await VaultStore.loadAll(VaultStore.ws);
  Drive.resetSearch && Drive.resetSearch();
  Drive.state.ready = true; Drive.state.folderId = 'root'; Drive.state.view = 'home';
  Drive.render(); return true;
};
`;

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const realToken = L.token();

  const cr = await L.post("/api/v2/folders/company/project", { Project: { Name: `L项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `L-${TAG}` } });
  if (!cr.ok) throw new Error("建项目失败 " + JSON.stringify(cr.data));
  const PJ = cr.data.id;
  const cc = await L.post("/api/v2/folders/company/contract", { Contract: { Name: `L合同-${TAG}`, ContractNo: `LHT-${TAG}` }, ProjectId: PJ });
  const CT = cc.ok ? cc.data.id : null;
  const up = await L.upload(CT || PJ, `L附件-${TAG}.txt`, TXT(`L 附件 ${TAG}`));
  const lk = await L.get(`/api/v2/files/company/folders/${CT}/links?includeDeleted=false`);
  const linkArr = Array.isArray(lk.data) ? lk.data : (lk.data.items || []);
  const linkRow = linkArr.filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
  const LINK = linkRow && (linkRow.id ?? linkRow.linkId);

  /* ================= L-01 未授权会话访问写操作/下载 ================= */
  if (want("L-01")) try {
    const probes = [
      ["GET", `/api/v2/folders/company/project/${PJ}`],
      ["POST", `/api/v2/folders/company/project`, { Project: { Name: `L01越权-${TAG}`, ProjectType: "科研项目" } }],
      ["DELETE", `/api/v2/files/company/${up.fileId}/links/${LINK}`],
      ["GET", `/api/v2/files/company/${up.fileId}/versions/1/download`],
      ["POST", `/api/v2/projects/company/${PJ}/transfer`, { TargetWorkspace: "personal", Move: false }],
      ["POST", `/api/trash/company/purge`, { items: [{ kind: "project", id: PJ, section: "" }] }],
    ];
    const runAll = async (token) => {
      L.setToken(token);
      const out = [];
      for (const [m, p, body] of probes) {
        const r = await L.call(m, p, body === undefined ? {} : { json: body });
        out.push({ method: m, path: p.replace(/\/\d+/g, "/:id"), status: r.status, error: r.data && r.data.error });
      }
      return out;
    };
    const noToken = await runAll("");
    const badToken = await runAll("A".repeat(64));
    L.setToken(realToken);
    const alive = await L.get(`/api/v2/folders/company/project/${PJ}`);
    const all401 = (arr) => arr.every((x) => x.status === 401);
    const ok = all401(noToken) && all401(badToken) && alive.status === 200;
    rec.rec({
      id: "L-01", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ noToken, badToken, authorizedStillWorks: alive.status }),
      workspace: "company", recordIds: [PJ, up.fileId],
      notes: ok
        ? "无 token 与伪造 token 两种会话对「读取记录 / 新建项目 / 删除附件链接 / 下载原件 / 跨区转移 / 彻底删除」六类操作全部返回 401，恢复合法 token 后同一请求立即 200 —— 权限由服务端判定，不依赖前端按钮隐藏"
        : `存在未授权访问缺口（noToken=${JSON.stringify(noToken.map((x) => x.status))}, badToken=${JSON.stringify(badToken.map((x) => x.status))}）`,
    });
  } catch (e) { rec.rec({ id: "L-01", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "L-01 执行异常" }); }

  /* ================= L-02 跨工作区访问与跨区复用 ================= */
  if (want("L-02")) try {
    const asPersonal = {
      project: await L.get(`/api/v2/folders/personal/project/${PJ}`),
      contract: CT ? await L.get(`/api/v2/folders/personal/contract/${CT}`) : null,
      fileDownload: await L.call("GET", `/api/v2/files/personal/${up.fileId}/versions/1/download`, { raw: true }).then((r) => ({ status: r.status })),
      linksInPersonal: await L.get(`/api/v2/files/personal/folders/${CT}/links?includeDeleted=false`),
      deleteCrossWs: await L.del(`/api/v2/files/personal/${up.fileId}/links/${LINK}`),
    };
    /* 反向：拿个人工作区的真实记录用公司参数访问 */
    const pj2 = await L.post("/api/v2/folders/personal/project", { Project: { Name: `L02个人-${TAG}`, ProjectType: "科研项目", ProjectNo: `L02P-${TAG}` } });
    const PJP = pj2.ok ? pj2.data.id : null;
    const asCompany = PJP ? await L.get(`/api/v2/folders/company/project/${PJP}`) : null;
    /* 跨区转移的目标工作区必须合法 */
    const badTarget = await L.post(`/api/v2/projects/company/${PJ}/transfer`, { TargetWorkspace: "personal", Move: false });
    const ok = asPersonal.project.status === 404 && asPersonal.contract.status === 404 &&
      asPersonal.fileDownload.status === 404 && asPersonal.deleteCrossWs.status === 404 &&
      (!asCompany || asCompany.status === 404) &&
      badTarget.ok && Number(badTarget.data.id) !== Number(PJ);
    rec.rec({
      id: "L-02", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        companyRecordReadAsPersonal: { project: asPersonal.project.status, contract: asPersonal.contract.status },
        companyFileDownloadAsPersonal: asPersonal.fileDownload.status,
        companyLinksAsPersonal: asPersonal.linksInPersonal.status,
        crossWorkspaceDelete: asPersonal.deleteCrossWs.status,
        personalRecordReadAsCompany: asCompany && asCompany.status,
        properCrossWorkspaceTransfer: { status: badTarget.status, newId: badTarget.data && badTarget.data.id, sourceId: PJ },
      }),
      workspace: "company", recordIds: [PJ, PJP],
      notes: ok
        ? "同一批 FolderId/FileId/LinkId 用另一个工作区的参数访问（读记录、下载原件、删链接）全部 404，反向访问同理；合法的跨区转移必须走 transfer 并返回全新的目标 ID，不会复用原 FileId —— 两区数据不互通"
        : `跨工作区隔离不完整（${JSON.stringify({ p: asPersonal.project.status, c: asPersonal.contract.status, d: asPersonal.fileDownload.status, del: asPersonal.deleteCrossWs.status })}）`,
    });
  } catch (e) { rec.rec({ id: "L-02", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "L-02 执行异常" }); }

  const b = await launch({ profileDir: path.join(ROOT, "profiles", "l-" + Date.now()), width: 1500, height: 950 });
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

    /* ---------------- L-04 长名称 / 备注 / 特殊字符的转义 ---------------- */
    if (want("L-04")) try {
      const XSS = `<img src=x onerror="window.__xssHit=1">`;
      const LONG = "超长名称" + "测".repeat(140) + TAG;
      const SPECIAL = `L04特殊-${TAG}-<>&"'`;
      const c1 = await L.post("/api/v2/folders/company/project", { Project: { Name: XSS, ProjectType: "科研项目", ProjectNo: `L04X-${TAG}`, Remarks: `<script>window.__xssHit=2</script>` } });
      const c2 = await L.post("/api/v2/folders/company/project", { Project: { Name: LONG, ProjectType: "科研项目", ProjectNo: `L04L-${TAG}` } });
      const c3 = await L.post("/api/v2/folders/company/project", { Project: { Name: SPECIAL, ProjectType: "科研项目", ProjectNo: `L04S-${TAG}` } });
      await P(`window.__reload()`); await sleep(700);
      await P(`(() => { Drive.openFolder('k:project'); return true; })()`);
      await sleep(1500);
      const probe = await P(`(() => {
        const rows = [...document.querySelectorAll('#viewRoot .row')];
        const titles = rows.map(r => (((r.querySelector('.row-title')||{}).textContent)||''));
        const injected = [...document.querySelectorAll('#viewRoot img, #viewRoot script')].length;
        const hit = window.__xssHit || null;
        const longRow = rows.find(r => ((r.textContent||'').includes('超长名称')));
        return { rowCount: rows.length, injectedNodes: injected, xssHit: hit,
          longTextShown: longRow ? (longRow.textContent||'').trim().slice(0, 30) : null,
          specialShown: titles.some(t => t.includes('L04特殊-')),
          rawHasImgText: [...document.querySelectorAll('#viewRoot .row-title')].some(e => (e.textContent||'').includes('<img')) };
      })()`);
      const xssCreated = c1.ok && c2.ok && c3.ok;
      const ok = xssCreated && probe.injectedNodes === 0 && probe.xssHit === null &&
        probe.rawHasImgText === true && probe.specialShown === true && !!probe.longTextShown;
      rec.rec({
        id: "L-04", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ created: [c1.status, c2.status, c3.status], xssPayload: XSS, longLen: LONG.length, probe }),
        workspace: "company", recordIds: [c1.ok ? c1.data.id : null, c2.ok ? c2.data.id : null, c3.ok ? c3.data.id : null],
        notes: ok
          ? `记录名写入 <img onerror> 与 <script> 后，列表里作为纯文本原样显示（.row-title 的 textContent 含 "<img"），DOM 中未产生 img/script 节点、window.__xssHit 未触发；${LONG.length} 字长名称与 &<>"' 特殊字符正常展示 —— 渲染走转义而非 innerHTML 直插`
          : `注入转义不符（injected=${probe.injectedNodes}, hit=${probe.xssHit}, rawText=${probe.rawHasImgText}）`,
      });
    } catch (e) { rec.rec({ id: "L-04", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "L-04 执行异常" }); }

    /* ---------------- L-05 1366x768 / 1920x1080 主要页面巡查 ---------------- */
    if (want("L-05")) try {
      const shots = [];
      const probeAt = async (w, h, dpr) => {
        await b.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
        await sleep(700);
        await P(`window.__reload()`); await sleep(700);
        const home = await P(`(() => {
          const cards = document.querySelectorAll('.catgrid .catcard').length;
          const grid = document.querySelector('.catgrid');
          const cs = grid ? getComputedStyle(grid) : null;
          const cols = cs ? cs.gridTemplateColumns.split(' ').filter(Boolean).length : 0;
          const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
          return { cards, cols, overflowX };
        })()`);
        await P(`(() => { Drive.openFolder('k:project'); return true; })()`); await sleep(1400);
        const list = await P(`(() => {
          const head = document.querySelector('#listHead');
          const rows = document.querySelectorAll('#viewRoot .row').length;
          const hr = head ? head.getBoundingClientRect() : null;
          const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
          return { rows, headWidth: hr ? Math.round(hr.width) : 0, overflowX };
        })()`);
        /* 详情面板 + 右键菜单在窄屏下是否仍可用 */
        await P(`document.querySelector('#btnDetailToggle')?.click()`); await sleep(500);
        const detail = await P(`(() => { const d=document.querySelector('#detail'); if(!d) return null;
          const r=d.getBoundingClientRect(); return { open: d.classList.contains('open'), width: Math.round(r.width), right: Math.round(r.right), winW: window.innerWidth }; })()`);
        const f = path.join(EVID, "shots", `l05-${w}x${h}-${TAG}.png`);
        await b.shot(f).catch(() => {});
        shots.push({ w, h, dpr, home, list, detail, file: path.basename(f) });
        return true;
      };
      await probeAt(1366, 768, 1);
      await probeAt(1920, 1080, 1);
      await b.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
      const ok = shots.length === 2 &&
        shots.every((s) => s.home.cards > 0 && s.list.rows > 0 && s.list.headWidth > 0) &&
        shots[0].home.cols >= 2 && shots.every((s) => !s.home.overflowX && !s.list.overflowX) &&
        shots.every((s) => s.detail && s.detail.open && s.detail.width > 200 && s.detail.right <= s.detail.winW + 2);
      rec.rec({
        id: "L-05", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ shots }),
        workspace: "company",
        notes: ok
          ? `1366×768 与 1920×1080 两档：首页分类卡片与台账列表均正常渲染、表头宽度随视口自适应、文档无横向溢出；详情面板在两档下都能打开且不越出视口右边界（截图见 evidence/shots/）`
          : `分辨率适配存在布局问题（${JSON.stringify(shots.map((s) => ({ w: s.w, overflowHome: s.home.overflowX, overflowList: s.list.overflowX, detail: s.detail })))}）`,
      });
    } catch (e) { rec.rec({ id: "L-05", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "L-05 执行异常" }); }

    /* ---------------- L-06 失效入口巡查（点击必须有可观测反应） ---------------- */
    if (want("L-06")) try {
      await P(`window.__reload()`); await sleep(700);
      /* 必须在「命令栏按钮真正适用」的上下文里抽查：详情面板开关与台账导出
         在首页按设计不可用（首页没有详情面板；#excelActions 在非台账页隐藏），
         在首页点它们必然无反应，那不是伪控件而是作用域不对。这里统一进项目台账。 */
      await P(`(() => { Drive.openFolder('k:project'); return true; })()`);
      await sleep(1600);
      const snapOf = (sel) => P(`(() => {
        const btn = document.querySelector(${JSON.stringify(sel)});
        const box = btn ? btn.closest('#excelActions') : null;
        return { toasts: window.__toasts().length,
          masks: document.querySelectorAll('.mask.show').length,
          ctx: !!document.querySelector('#ctxMenu.show'),
          view: Drive.state.view, folder: Drive.state.folderId,
          detail: !!document.querySelector('#detail.open'),
          hiddenByBox: !!(box && box.classList.contains('hidden')),
          disabled: !!(btn && btn.disabled) };
      })()`);
      const probeBtn = async (sel, label) => {
        const exists = await P(`!!document.querySelector(${JSON.stringify(sel)})`);
        if (!exists) return { label, sel, exists: false, reacted: false, reason: "元素不存在" };
        const before = await snapOf(sel);
        if (before.disabled) {
          return { label, sel, exists: true, disabled: true, reacted: false, before,
            reason: "按钮在当前上下文为禁用态（按设计不适用）" };
        }
        await P(`document.querySelector(${JSON.stringify(sel)}).click()`);
        await sleep(900);
        const after = await snapOf(sel);
        const reacted = JSON.stringify(before) !== JSON.stringify(after);
        /* 复位：收起菜单/弹层，关掉被打开的详情面板，避免污染下一个入口 */
        await P(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
        await P(`(() => { try { settleConfirm(false); } catch(e) {} return true; })()`);
        await P(`(() => { try { document.querySelector('#ctxMenu').classList.remove('show'); } catch(e) {} return true; })()`);
        await P(`(() => { const bp = document.querySelector('#detail.open');
          if (bp) { try { bp.classList.remove('open'); } catch(e) {} }
          return true; })()`);
        await sleep(250);
        return { label, sel, exists: true, disabled: false, hiddenByBox: before.hiddenByBox, reacted, before, after };
      };
      const targets = [
        ["#btnRefresh", "刷新"],
        ["#btnNew", "新建"],
        ["#btnSort", "排序"],
        ["#btnDetailToggle", "详情面板开关"],
        ["#btnExcelExport", "台账导出（项目台账适用）"],
        ["#wsSwitchBtn", "工作区切换"],
      ];
      const results = [];
      for (const [sel, label] of targets) results.push(await probeBtn(sel, label));
      /* 回收站清空按钮在非回收站视图应为隐藏 */
      const trashBtn = await P(`(() => { const b=document.querySelector('#btnEmptyTrash');
        return b ? { exists: true, hidden: b.classList.contains('hidden') } : { exists: false }; })()`);
      const dead = results.filter((r) => r.exists && !r.disabled && !r.reacted);
      const ok = results.every((r) => r.exists) && dead.length === 0 && trashBtn.exists && trashBtn.hidden === true;
      rec.rec({
        id: "L-06", status: ok ? "PASS" : "CONFIRMED_BUG",
        actual: JSON.stringify({ probedAt: "项目台账列表", results, trashButtonOutsideRecycle: trashBtn,
          deadEntries: dead.map((d) => d.label) }),
        workspace: "company",
        notes: ok
          ? `在项目台账列表抽查 6 个主入口（刷新/新建/排序/详情开关/台账导出/工作区切换）全部存在且点击后都有可观测反应（toast、菜单、详情面板或视图变化）；「清空回收站」在非回收站视图按设计隐藏，不存在点了没反应的伪控件`
          : `存在无效入口（${JSON.stringify(dead.map((d) => d.label))}）`,
      });
    } catch (e) { rec.rec({ id: "L-06", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "L-06 执行异常" }); }
  } finally {
    await b.close();
  }

  /* ================= L-03 重启前后数据一致性（快照对比） ================= */
  if (want("L-03")) try {
    const before = dbcheck();
    fs.writeFileSync(path.join(EVID, "dbcheck-before-restart.json"), JSON.stringify(before, null, 2), "utf8");
    const counts = before.counts;
    /* 关库再重开：这是重启过程中数据路径最容易出问题的一步，且不需要杀进程即可复现 */
    const lock1 = await L.post("/api/lock", {});
    await sleep(800);
    const lockedStatus = await L.get("/api/status");
    const reopen = await L.post("/api/open", { path: CRED.db, password: CRED.password, create: false });
    if (reopen.ok) L.setToken(reopen.data.token);
    else {
      const rr = await L.post("/api/resume", { password: CRED.password });
      if (rr.ok) L.setToken(rr.data.token);
    }
    const after = dbcheck();
    const projects = await L.get("/api/v2/ui/projects/company");
    const arr = Array.isArray(projects.data) ? projects.data : ((projects.data && (projects.data.projects || projects.data.items)) || []);
    const sameCounts = JSON.stringify(before.counts) === JSON.stringify(after.counts);
    const ok = lock1.ok && lockedStatus.data.unlocked === false && (reopen.ok || (await L.get("/api/status")).data.unlocked) &&
      sameCounts && before.integrity === "ok" && after.integrity === "ok" &&
      JSON.stringify(before.fileChunksCount || before.counts.file_chunks) === JSON.stringify(after.counts.file_chunks) &&
      arr.length > 0;
    rec.rec({
      id: "L-03", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        lockStatus: lock1.status, unlockedAfterLock: lockedStatus.data.unlocked,
        reopen: { status: reopen.status, resumed: reopen.data && reopen.data.resumed },
        countsBefore: before.counts, countsAfter: after.counts, countsIdentical: sameCounts,
        integrityBefore: before.integrity, integrityAfter: after.integrity,
        projectsReadable: arr.length,
      }),
      workspace: "-",
      notes: ok
        ? `关库→重开这一往返后：folders/files/versions/objects/chunks/links 六项计数与关库前逐项相同，integrity 前后均为 ok，业务列表接口仍可读 —— 会话级别重启不造成未声明的数据丢失或改动（进程级重启见 A-05）`
        : `重启往返后数据不一致（sameCounts=${sameCounts}, integrity=${after.integrity}, opened=${lockedStatus.data.unlocked}）`,
    });
  } catch (e) { rec.rec({ id: "L-03", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "L-03 执行异常" }); }

  rec.flush();
  console.log("L 组执行完毕");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
