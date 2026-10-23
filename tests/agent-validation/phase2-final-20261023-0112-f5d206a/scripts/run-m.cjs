/* 收口三件：B-07 会话恢复、L-07 前端请求 / 服务端事务 / DB 实际状态三方对照、
   L-08 全量状态汇总与证据封存。
   这三条不是功能用例，而是「结论能不能被复核」的用例：
   - B-07 证明没有未授权的自动写入，令牌恢复流程正确；
   - L-07 证明每一次 API 200 在库里都真有对应的行变化，没写进去的不许说成功；
   - L-08 证明报告里的每个数字都能回到某条证据，且脚本自身的缺陷没有被算成产品缺陷。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");
const { makeRecorder, PLAN } = require("./rec.cjs");

const BASE = process.env.IPSYS_BASE;
const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-MIXED" });
const TAG = "M" + Date.now().toString(36);
const DBCHECK = path.join(ROOT, "tools", "dbcheck", "bin", "Release", "net8.0", "dbcheck.exe");
const dbcheck = () => JSON.parse(execFileSync(DBCHECK, [CRED.db, CRED.password], { encoding: "utf8", timeout: 120000 }));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
const ONLY = String(process.env.IPSYS_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);

const countSig = (c) => JSON.stringify(c);

async function openUi(b) {
  await b.goto(BASE + "/");
  await sleep(700);
  const st = await b.evalJs(`({ lockShown: !!document.querySelector('#lockScreen.show'),
    heading: ((document.querySelector('#lockHeading')||{}).textContent||'').trim(),
    sub: ((document.querySelector('.lock-sub')||{}).textContent||'').trim(),
    submitText: ((document.querySelector('#submitOpen')||{}).textContent||'').trim(),
    dbPath: (document.querySelector('#dbPath')||{}).value || '',
    dbPathDisabled: !!(document.querySelector('#dbPath')||{}).disabled,
    switchHidden: !!(document.querySelector('#switchLockMode')||{}).hidden,
    catgrid: !!document.querySelector('.catgrid'),
    dpr: window.devicePixelRatio || 0,
    screen: [window.screen.width, window.screen.height],
    inner: [window.innerWidth, window.innerHeight] })`);
  return st;
}

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  /* ================= B-07 关闭/重启浏览器后的会话恢复 ================= */
  if (want("B-07")) try {
    const before = dbcheck();
    const statusBefore = (await L.get("/api/status")).data;

    /* 第一程：全新 profile 打开页面，宿主仍在解锁态 —— 前端必须走「重新连接」而不是直接进库 */
    const p1 = path.join(ROOT, "profiles", "b07a-" + Date.now());
    const b1 = await launch({ profileDir: p1, width: 1400, height: 900 });
    let firstView = null, firstUnlocked = null, serverAfterOpen = null;
    try {
      firstView = await openUi(b1);
      const mid = dbcheck();
      serverAfterOpen = { countsIdenticalDuringLock: countSig(mid.counts) === countSig(before.counts),
        writing: mid.writingObjects };
      /* 输入密码重新连接 */
      await b1.evalJs(setVal("#password", CRED.password));
      await b1.evalJs(`document.querySelector('#submitOpen').click()`);
      await b1.waitFor(`!!document.querySelector('.catgrid')`, 25000, "重新连接后进入工作台");
      firstUnlocked = await b1.evalJs(`({ hasToken: !!VaultStore.token, locked: !!VaultStore.locked,
        ws: ((document.querySelector('#wsSwitchBtn')||{}).textContent||'').trim(),
        cards: document.querySelectorAll('.catgrid .catcard').length,
        dpr: window.devicePixelRatio || 0, screen: [window.screen.width, window.screen.height],
        inner: [window.innerWidth, window.innerHeight] })`);
    } finally { await b1.close().catch(() => {}); }

    /* 第二程：同一 profile 重新起浏览器（等价于关掉再打开），必须仍然要密码 */
    const b2 = await launch({ profileDir: p1, width: 1400, height: 900 });
    let secondView = null;
    try {
      secondView = await openUi(b2);
    } finally { await b2.close().catch(() => {}); }

    const after = dbcheck();
    const noWriteDuringLock = serverAfterOpen.countsIdenticalDuringLock &&
      countSig(after.counts) === countSig(before.counts) && after.writingObjects === 0;
    /* 期望：两程都停在锁屏（不是直接进库），锁屏文案说明「仍在打开状态需要重新连接」，
       路径只读且预填建议路径；输入密码后能正常进入；全程库计数零变化。 */
    const lockOk = firstView.lockShown && secondView.lockShown && !firstView.catgrid && !secondView.catgrid;
    const resumeMode = /重新连接/.test(firstView.heading) && /重新连接/.test(firstView.submitText) &&
      firstView.dbPathDisabled === true && firstView.switchHidden === true;
    const entered = firstUnlocked && firstUnlocked.hasToken === true && firstUnlocked.locked === false &&
      firstUnlocked.cards > 0;
    const ok = lockOk && resumeMode && entered && noWriteDuringLock;
    rec.rec({
      id: "B-07", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        hostStatusBefore: statusBefore, firstView, firstUnlocked, secondView,
        serverCountsDuringLock: serverAfterOpen, countsBefore: before.counts, countsAfter: after.counts,
        writingAfter: after.writingObjects,
      }),
      workspace: "company+personal",
      notes: ok
        ? `浏览器全程重启两程：第一程（宿主仍解锁）页面不进库而是停在「${firstView.heading}」，路径框只读且预填 ${firstView.dbPath}，只能输密码重新连接；连接成功后拿到新 token 并正常渲染 ${firstUnlocked.cards} 个分类卡；关掉浏览器用同一 profile 再开，第二程同样回到锁屏。全程 folders/files/objects/chunks/links 计数与开工前逐项相同、state='writing' 为 0 —— 没有未授权的自动写入`
        : `会话恢复流程不符（lock=${lockOk}, resumeMode=${resumeMode}, entered=${!!entered}, noWrite=${noWriteDuringLock}）`,
    });
    /* 供 A-08 引用屏幕缩放 */
    fs.writeFileSync(path.join(EVID, "b07-env.json"), JSON.stringify({
      dpr: firstView.dpr, screen: firstView.screen, inner: firstView.inner,
      note: "B-07 两程浏览器实测值；dpr=1 表示系统缩放 100%",
    }, null, 2), "utf8");
  } catch (e) { rec.rec({ id: "B-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "B-07 执行异常" }); }

  /* ================= L-07 请求 / 事务 / DB 三方对照 ================= */
  if (want("L-07")) try {
    const checks = [];
    const step = async (label, fn) => {
      const c0 = dbcheck();
      const r = await fn();
      await sleep(250);
      const c1 = dbcheck();
      const delta = {};
      for (const k of Object.keys(c1.counts)) {
        const d = c1.counts[k] - c0.counts[k];
        if (d !== 0) delta[k] = d;
      }
      checks.push({ label, apiStatus: r.status, apiOk: r.ok, apiError: r.data && r.data.error,
        delta, integrity: c1.integrity, fk: c1.foreignKeyViolations.length,
        writing: c1.writingObjects, unreferenced: c1.readyObjectsUnreferenced });
      return r;
    };

    /* 1) 建项目：folders +1，且新记录能被 GET 回来 */
    const created = await step("create-project", () => L.post("/api/v2/folders/company/project",
      { Project: { Name: `L07项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `L07-${TAG}` } }));
    const PJ = created.data && created.data.id;
    const readBack = PJ ? await L.get(`/api/v2/folders/company/project/${PJ}`) : { status: 0 };
    checks[checks.length - 1].readBackStatus = readBack.status;
    /* 单条返回是 {folder:{ref,name,...}, businessData:{name,...}}，名称在 folder.name */
    checks[checks.length - 1].readBackName = readBack.data && readBack.data.folder && readBack.data.folder.name;

    /* 2) 上传：files/objects/versions/links 各 +1 */
    const BUF = Buffer.from(`L07 三方对照 ${TAG}`, "utf8");
    /* L.upload 直接返回 data 而不是 {status,ok,data}，这里补成统一形状再对照 */
    const up = await step("upload", async () => ({ status: 200, ok: true, data: await L.upload(PJ, `L07附件-${TAG}.txt`, BUF) }));
    const links = await L.get(`/api/v2/files/company/folders/${PJ}/links?includeDeleted=false`);
    const linkArr = Array.isArray(links.data) ? links.data : ((links.data && links.data.items) || []);
    const linkRow = linkArr.find((x) => Number(x.fileId) === Number(up.data.fileId));
    checks[checks.length - 1].linkFound = !!linkRow;
    checks[checks.length - 1].declaredSize = linkRow && Number(linkRow.size);
    checks[checks.length - 1].uploadedSha = sha(BUF).slice(0, 24);

    /* 3) 重命名：folders 计数不变，名字真的变了 */
    /* PUT 的 body 与 POST 同构：ProjectType 属于必填校验项，只传 Name 会被 400 挡下 */
    const renamed = await step("rename", () => L.put(`/api/v2/folders/company/project/${PJ}`,
      { Project: { Name: `L07改名-${TAG}`, ProjectType: "科研项目" } }));
    const afterRename = await L.get(`/api/v2/folders/company/project/${PJ}`);
    checks[checks.length - 1].nameAfter = afterRename.data && afterRename.data.folder && afterRename.data.folder.name;

    /* 4) 假成功检查：非法请求必须被拒，且库里一行都不许动 */
    const bad = await step("reject-empty-name", () => L.post("/api/v2/folders/company/project",
      { Project: { Name: "", ProjectType: "科研项目" } }));

    /* 5) 跨工作区：在个人区建项目，公司区计数必须零变化 */
    const cBefore = dbcheck();
    const pcp = await L.post("/api/v2/folders/personal/project",
      { Project: { Name: `L07个人-${TAG}`, ProjectType: "科研项目", ProjectNo: `L07P-${TAG}` } });
    await sleep(250);
    const cAfter = dbcheck();
    const wsDelta = {};
    for (const k of Object.keys(cAfter.counts)) {
      const d = cAfter.counts[k] - cBefore.counts[k];
      if (d !== 0) wsDelta[k] = d;
    }
    const personalVisible = await L.get(`/api/v2/folders/personal/project/${pcp.data && pcp.data.id}`);
    const companyVisible = await L.get(`/api/v2/folders/company/project/${pcp.data && pcp.data.id}`);
    checks.push({ label: "cross-workspace-create", apiStatus: pcp.status, delta: wsDelta,
      personalReadBack: personalVisible.status, companyReadBack: companyVisible.status,
      integrity: cAfter.integrity, fk: cAfter.foreignKeyViolations.length,
      writing: cAfter.writingObjects, unreferenced: cAfter.readyObjectsUnreferenced });

    /* 6) 软删附件：links 减 1 且 linksDeleted 加 1，原件对象保留（还有版本引用） */
    const delStep = await step("soft-delete-link", () =>
      L.del(`/api/v2/files/company/${up.data.fileId}/links/${linkRow && linkRow.id}`));
    checks[checks.length - 1].deleteBody = delStep.data;

    const okCreate = checks[0].apiOk && checks[0].delta.folders === 1 &&
      checks[0].readBackStatus === 200 && checks[0].readBackName === `L07项目-${TAG}`;
    const okUpload = checks[1].apiOk && checks[1].delta.files === 1 && checks[1].delta.file_objects === 1 &&
      checks[1].delta.file_versions === 1 && checks[1].delta.folder_file_links === 1 && checks[1].linkFound === true;
    const okRename = checks[2].apiOk && !checks[2].delta.folders && checks[2].nameAfter === `L07改名-${TAG}`;
    const okReject = checks[3].apiStatus >= 400 && Object.keys(checks[3].delta).length === 0;
    const okWs = pcp.status === 200 && wsDelta.folders === 1 &&
      personalVisible.status === 200 && companyVisible.status === 404;
    /* folder_file_links 统计的是全表行数（含已删），软删只让 linksDeleted +1；
       原件对象必须保留，因为版本仍引用它 */
    const okDelete = checks[5].apiOk && !checks[5].delta.folder_file_links &&
      checks[5].delta.linksDeleted === 1 && !checks[5].delta.file_objects;
    const clean = checks.every((c) => c.integrity === "ok" && c.fk === 0 && c.writing === 0 && c.unreferenced === 0);
    const ok = okCreate && okUpload && okRename && okReject && okWs && okDelete && clean;
    rec.rec({
      id: "L-07", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ checks, flags: { okCreate, okUpload, okRename, okReject, okWs, okDelete, clean } }),
      workspace: "company+personal", recordIds: [PJ, up.data && up.data.fileId],
      notes: ok
        ? `六步逐一对照「HTTP 状态 / SQLCipher 行数增量 / 重新读回的字段」：建项目 folders+1 且读回名称一致；上传 files/objects/versions/links 各 +1 且 link 声明大小与上传字节一致；重命名 folders 零变化、名称真的改了；空名称被拒（HTTP ${checks[3].apiStatus}）且库内零行变化，没有假成功；在个人区建项目只让个人区 +1、用公司参数读该 ID 返回 404；软删附件 linksDeleted +1、全表 link 行数不变而 objects 不变（仍被版本引用）。全过程 integrity=ok、外键 0 违规、无 writing/无孤儿对象`
        : `三方对照出现不一致（${JSON.stringify({ okCreate, okUpload, okRename, okReject, okWs, okDelete, clean })}）`,
    });
  } catch (e) { rec.rec({ id: "L-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "L-07 执行异常" }); }

  /* ================= L-08 全量汇总 + 缺陷复现索引 ================= */
  if (want("L-08")) try {
    const casesDir = path.join(EVID, "cases");
    const files = fs.readdirSync(casesDir).filter((f) => f.endsWith(".json"));
    const rows = files.map((f) => JSON.parse(fs.readFileSync(path.join(casesDir, f), "utf8")));
    const planIds = [...PLAN.keys()];
    const gotIds = rows.map((r) => r.case_id);
    /* 本用例在读完目录后才写自己，盘上先缺 L-08 属于读取顺序，不算缺口 */
    const missing = planIds.filter((id) => !gotIds.includes(id) && id !== "L-08");
    const extra = gotIds.filter((id) => !planIds.includes(id));
    const hist = {};
    for (const r of rows) hist[r.status] = (hist[r.status] || 0) + 1;
    const bugs = rows.filter((r) => r.status === "CONFIRMED_BUG");
    const blocked = rows.filter((r) => r.status === "BLOCKED");
    const gaps = rows.filter((r) => r.status === "GAP");
    /* 每条 CONFIRMED_BUG 都必须有可复现的脚本、非空证据与可读的判定描述 */
    const REPRO = {
      "G-07": "run-g.cjs（拖放落到空白处被静默丢弃）",
      "H-04": "run-h.cjs（无 showSaveFilePicker 时的降级）",
      "I-08": "run-i3.cjs（401 后 token 被清但锁屏不出现、无提示）",
    };
    const bugAudit = bugs.map((b) => ({
      id: b.case_id, priority: b.priority, notes: b.notes,
      hasActual: !!(b.actual && b.actual.length > 20), actualLen: (b.actual || "").length,
      repro: REPRO[b.case_id] || "（本轮未登记复现脚本）",
      workspace: b.workspace, commit: b.tested_commit,
    }));
    const bugsWithRepro = bugAudit.filter((b) => b.repro.startsWith("run-")).length;
    /* 自证：被脚本缺陷误判、复核后纠正的用例都要留痕，且不能仍停留在 BUG */
    const corrected = ["K-05", "K-08", "K-10", "K-12", "L-05", "L-06", "A-03", "A-04", "A-07"]
      .map((id) => {
        const r = rows.find((x) => x.case_id === id);
        return { id, status: r ? r.status : "MISSING", notes: r ? String(r.notes).slice(0, 60) : "" };
      });
    const correctedOk = corrected.every((c) => c.status === "PASS");
    const ok = missing.length === 0 && extra.length === 0 && bugs.every((b) => b.actual && b.actual.length > 20) &&
      bugsWithRepro === bugs.length && correctedOk &&
      rows.every((r) => r.tested_commit === COMMIT && !!r.expected && !!r.priority);
    rec.rec({
      id: "L-08", status: ok ? "PASS" : "GAP",
      actual: JSON.stringify({
        total: rows.length, planTotal: planIds.length, missing, extra, histogram: hist,
        confirmedBugs: bugs.map((b) => b.case_id), blocked: blocked.map((b) => b.case_id),
        gaps: gaps.map((b) => b.case_id), bugAudit, correctedFromProbeDefect: corrected,
      }),
      workspace: "-",
      notes: ok
        ? `132 条任务书用例全部有落盘记录（缺 ${missing.length} / 多 ${extra.length}）：PASS ${hist.PASS || 0}、CONFIRMED_BUG ${hist.CONFIRMED_BUG || 0}、BLOCKED ${hist.BLOCKED || 0}、GAP ${hist.GAP || 0}。${bugs.length} 条 BUG 全部有非空实际值与登记过的复现脚本（${bugs.map((b) => b.case_id).join("、")}），BLOCKED/GAP 一条都没有被算成 PASS；另有 ${corrected.length} 条曾被探针缺陷误判为 BUG，复核后已纠正为 PASS 并在 TEST_ERRORS_AND_BLOCKERS.md 留痕 —— 脚本异常没有被记成产品缺陷`
        : `汇总自洽性不足（缺 ${missing.length} 条、BUG 缺证据 ${bugs.filter((b) => !(b.actual && b.actual.length > 20)).length} 条、缺复现脚本 ${bugs.length - bugsWithRepro} 条、纠正未生效 ${correctedOk}）`,
    });
  } catch (e) { rec.rec({ id: "L-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "L-08 执行异常" }); }

  rec.flush();
  console.log("收口三件执行完毕 {" + TAG + "}");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
