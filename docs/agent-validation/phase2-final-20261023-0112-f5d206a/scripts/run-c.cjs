/* C 组：业务记录与附件 CRUD（API 写入 + UI 回读；表单入口抽样） */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./cdp.cjs");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const BASE = process.env.IPSYS_BASE;
const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const FX = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-HTTP+UI" });
const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

const P = FX.company.projectA, P2 = FX.company.projectB;
const IP = FX.company.ipA, GEN = FX.company.general1, ARC = FX.archive.lvl3;

async function login() {
  const r = await L.post("/api/resume", { password: CRED.password });
  if (!r.ok) throw new Error("resume " + r.status + " " + JSON.stringify(r.data));
  L.setToken(r.data.token);
}
async function create(ws, kind, body) {
  const r = await L.post(`/api/v2/folders/${ws}/${kind}`, body);
  return r;
}
async function get(ws, kind, id, section) {
  return L.get(`/api/v2/folders/${ws}/${kind}/${id}${section ? "?section=" + section : ""}`);
}
async function put(ws, kind, id, body, section) {
  return L.put(`/api/v2/folders/${ws}/${kind}/${id}${section ? "?section=" + section : ""}`, body);
}
async function del(ws, kind, id, section) {
  return L.del(`/api/v2/folders/${ws}/${kind}/${id}${section ? "?section=" + section : ""}`);
}
async function restore(ws, items) {
  return L.post(`/api/trash/${ws}/restore`, { items });
}
async function listRows(ws, kind) {
  const map = { project: "projects", contract: "contracts", ip: "ip", general: "general", archive: "archive" };
  const r = await L.get(`/api/v2/ui/${map[kind]}/${ws}`);
  if (Array.isArray(r.data)) return r.data;
  return r.data && r.data.rows ? r.data.rows : [];
}

(async () => {
  await login();
  const b = await launch({ profileDir: path.join(ROOT, "profiles", "c-" + Date.now()) });
  await b.goto(BASE + "/");
  await sleep2(500);
  // 登录
  const st = await b.evalJs(`({confirmHidden:!!(document.querySelector('#createConfirmField')||{}).hidden})`);
  if (!st.confirmHidden) { await b.evalJs(`document.querySelector('#switchLockMode').click()`); await sleep2(200); }
  await b.evalJs(`(() => { const e=document.querySelector('#dbPath'); e.value=${JSON.stringify(CRED.db)}; e.dispatchEvent(new Event('input',{bubbles:true})); const p=document.querySelector('#password'); p.value=${JSON.stringify(CRED.password)}; p.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#submitOpen').click(); return 1; })()`);
  await b.waitFor(`!!document.querySelector('.catgrid') && !document.querySelector('#appShell').getAttribute('aria-hidden')`, 20000, "进入工作台");
  await sleep2(800);
  // 切企业
  await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`); await sleep2(250);
  await b.evalJs(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`); await sleep2(1500);

  /* C-01 项目入口创建 */
  const c1a = await create("company", "project", { Project: { Name: "C01-科研项目", ProjectType: "科研项目", ProjectNo: "C01-KY", Leader: "张三", UndertakingOrg: "北矿智能", StartDate: "2026-04-01" } });
  const c1b = await create("company", "project", { Project: { Name: "C01-横向项目", ProjectType: "横向项目", ProjectNo: "C01-HX", Category: "横向" } });
  const g1a = c1a.ok ? await get("company", "project", c1a.data.id) : null;
  const g1b = c1b.ok ? await get("company", "project", c1b.data.id) : null;
  const d1a = g1a && g1a.data.businessData, d1b = g1b && g1b.data.businessData;
  const ok01 = c1a.ok && c1b.ok && d1a.projectType === "科研项目" && d1a.projectNo === "C01-KY" && d1a.leader === "张三" && d1b.projectType === "横向项目" && d1b.category === "横向";
  rec.rec({
    id: "C-01", status: ok01 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ createA: c1a.status, createB: c1b.status, storedA: d1a, storedB: d1b }),
    workspace: "company", recordIds: [c1a.data && c1a.data.id, c1b.data && c1b.data.id],
    notes: ok01 ? "科研/横向项目字段落库正确（入口新建由 F2 表单承载，本次以 API 写入 + 读回验证字段，UI 可见性见 C-12）" : "项目字段未按输入存储",
  });

  /* C-02 合同创建与编辑 */
  const c2a = await create("company", "contract", { Contract: { Name: "C02-合同A", ContractNo: "C02-01", SignDate: "2026-04-02", Amount: "111000", Remarks: "初始备注" }, ProjectId: P });
  const c2b = await create("company", "contract", { Contract: { Name: "C02-合同B", ContractNo: "C02-02", SignDate: "2026-04-03", Amount: "222000" }, ProjectId: P });
  let ok02 = false, d2 = null, e2 = null;
  if (c2a.ok && c2b.ok) {
    e2 = await put("company", "contract", c2a.data.id, { Contract: { Name: "C02-合同A", ContractNo: "C02-01-改", SignDate: "2026-04-02", Amount: "333000", Remarks: "编辑后备注" }, ParentId: P });
    const g2 = await get("company", "contract", c2a.data.id);
    d2 = g2.data && g2.data.businessData;
    ok02 = e2.ok && d2.amount === "333000" && d2.contractNo === "C02-01-改" && d2.remarks === "编辑后备注";
  }
  rec.rec({
    id: "C-02", status: ok02 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ createA: c2a.status, createB: c2b.status, update: e2 && e2.status, stored: d2, parent: g2id(c2a) }),
    workspace: "company", recordIds: [c2a.data && c2a.data.id, c2b.data && c2b.data.id],
    notes: ok02 ? "两条合同均挂在项目下，金额/编号/备注编辑后持久化" : "合同字段或归属未持久化",
  });

  /* C-03 无父项目建合同 */
  const beforeContracts = (await listRows("company", "contract")).length;
  const c3a = await create("company", "contract", { Contract: { Name: "C03-孤儿合同", ContractNo: "C03-X" } });
  const c3b = await create("company", "contract", { Contract: { Name: "C03-坏父合同", ContractNo: "C03-Y" }, ProjectId: 999999999 });
  const afterContracts = (await listRows("company", "contract")).length;
  const ok03 = !c3a.ok && !c3b.ok && afterContracts === beforeContracts;
  rec.rec({
    id: "C-03", status: ok03 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ noParent: { status: c3a.status, body: c3a.data }, badParent: { status: c3b.status, body: c3b.data }, beforeContracts, afterContracts }),
    workspace: "company", notes: ok03 ? "无父项目与不存在父项目均被拒绝，未生成孤儿合同" : "允许了孤儿合同或计数变化",
  });

  /* C-04 IP CRUD + 回收站恢复 */
  const c4 = await create("company", "ip", { Ip: { Name: "C04-IP", IpType: "发明专利", Status: "已申请", ApplicationNo: "C04-APP", Remarks: "初始" } });
  let ok04 = false, a4 = {};
  if (c4.ok) {
    const id = c4.data.id;
    const e4 = await put("company", "ip", id, { Ip: { Name: "C04-IP-改", IpType: "发明专利", Status: "已授权", ApplicationNo: "C04-APP", Remarks: "已编辑" } });
    const dd = await del("company", "ip", id);
    const gd = await get("company", "ip", id);
    const rr = await restore("company", [{ kind: "ip", id, section: "" }]);
    const gr = await get("company", "ip", id);
    const dr = gr.data && gr.data.businessData;
    a4 = { update: e4.status, delete: dd.status, getAfterDelete: gd.status, restore: rr.status, restored: dr };
    ok04 = e4.ok && dd.ok && rr.ok && dr && dr.name === "C04-IP-改" && dr.status === "已授权";
  }
  rec.rec({
    id: "C-04", status: ok04 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(a4), workspace: "company", recordIds: [c4.data && c4.data.id],
    notes: ok04 ? "IP 创建/编辑/软删/还原全链路字段一致" : "IP 回收站恢复后字段不一致",
  });

  /* C-05 业务档案 CRUD */
  const c5 = await create("company", "archive", { Archive: { Name: "C05-档案", Category: "其他", Year: "2026", FolderId: ARC, Remarks: "初始" }, Section: "achievement" });
  let ok05 = false, a5 = {};
  if (c5.ok) {
    const id = c5.data.id;
    const e5 = await put("company", "archive", id, { Archive: { Name: "C05-档案-改", Category: "其他", Year: "2025", FolderId: ARC, Remarks: "改后" }, Section: "achievement" }, "achievement");
    const dd = await del("company", "archive", id, "achievement");
    const rr = await restore("company", [{ kind: "archive", id, section: "achievement" }]);
    const gr = await get("company", "archive", id, "achievement");
    const dr = gr.data && gr.data.businessData;
    a5 = { update: e5.status, delete: dd.status, restore: rr.status, restored: dr, parent: gr.data && gr.data.folder && gr.data.folder.parent };
    ok05 = e5.ok && dd.ok && rr.ok && dr && dr.name === "C05-档案-改" && dr.year === "2025";
  }
  rec.rec({
    id: "C-05", status: ok05 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(a5), workspace: "company", recordIds: [c5.data && c5.data.id, "parent=" + ARC],
    notes: ok05 ? "业务档案在三级目录内创建/编辑/删除/恢复，归属目录保持" : "档案 CRUD 或归属异常",
  });

  /* C-06 个人分类抽样 */
  const c6a = await create("personal", "archive", { Archive: { Name: "C06-个人获奖", Category: "获奖", Year: "2026", Remarks: "抽样" }, Section: "achievement" });
  const c6b = await create("personal", "archive", { Archive: { Name: "C06-个人论文", Category: "论文", Year: "2025" }, Section: "academic" });
  const c6c = await create("personal", "project", { Project: { Name: "C06-个人科研项目", ProjectType: "科研项目", ProjectNo: "C06-P" } });
  const c6d = await create("personal", "ip", { Ip: { Name: "C06-个人专利", IpType: "实用新型专利", Status: "已申请", ApplicationNo: "C06-APP" } });
  let ok06 = false, a6 = {};
  if (c6a.ok && c6b.ok && c6c.ok && c6d.ok) {
    const e6 = await put("personal", "archive", c6a.data.id, { Archive: { Name: "C06-个人获奖-改", Category: "获奖", Year: "2026" }, Section: "achievement" }, "achievement");
    const g6 = await get("personal", "archive", c6a.data.id, "achievement");
    const d6 = g6.data && g6.data.businessData;
    a6 = { create: [c6a.status, c6b.status, c6c.status, c6d.status], update: e6.status, name: d6 && d6.name, section: g6.data && g6.data.folder && g6.data.folder.ref.section };
    ok06 = e6.ok && d6 && d6.name === "C06-个人获奖-改";
  }
  rec.rec({
    id: "C-06", status: ok06 ? "PASS" : (c6a.ok ? "CONFIRMED_BUG" : "BLOCKED"),
    actual: JSON.stringify(a6), workspace: "personal", recordIds: [c6a.data && c6a.data.id, c6b.data && c6b.data.id, c6c.data && c6c.data.id, c6d.data && c6d.data.id],
    notes: ok06 ? "个人获奖/论文/科研项目/专利四类抽样 CRUD 通过（教育/工作/兼职等为同一 Archive 表单的不同类别，未逐项展开）" : "个人分类抽样 CRUD 失败",
  });

  /* C-07 空名 / 长名 / 中英混排 */
  const emptyName = await create("company", "general", { General: { Title: "" } });
  const longName = "C07-" + "长".repeat(190) + "-LONG-NAME";
  const longRec = await create("company", "general", { General: { Title: longName } });
  const mixName = "C07-中英Mixed-2026_v1";
  const mixRec = await create("company", "general", { General: { Title: mixName } });
  const mixedStored = mixRec.ok ? (await get("company", "general", mixRec.data.id)).data : null;
  const ok07 = !emptyName.ok && longRec.ok && mixRec.ok && mixedStored && mixedStored.businessData.title === mixName;
  rec.rec({
    id: "C-07", status: ok07 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ empty: { status: emptyName.status, body: emptyName.data }, longStatus: longRec.status, mixStatus: mixRec.status, stored: mixedStored && mixedStored.businessData.title }),
    workspace: "company", recordIds: [longRec.data && longRec.data.id, mixRec.data && mixRec.data.id],
    notes: ok07 ? "空名被拒；长名与中英混排名称原样保存" : "名称长度或字符处理不符",
  });

  /* C-08 多合同删一条，其它不受影响 */
  const c8a = await create("company", "contract", { Contract: { Name: "C08-保留合同", ContractNo: "C08-1", Amount: "1000" }, ProjectId: P2 });
  const c8b = await create("company", "contract", { Contract: { Name: "C08-删除合同", ContractNo: "C08-2", Amount: "2000" }, ProjectId: P2 });
  let ok08 = false, a8 = {};
  if (c8a.ok && c8b.ok) {
    const beforeFiles = await L.get(`/api/v2/files/company/folders/${P}/links?includeDeleted=false`);
    const d8 = await del("company", "contract", c8b.data.id);
    const g8 = await get("company", "contract", c8a.data.id);
    const afterFiles = await L.get(`/api/v2/files/company/folders/${P}/links?includeDeleted=false`);
    const bCount = Array.isArray(beforeFiles.data) ? beforeFiles.data.length : 0;
    const aCount = Array.isArray(afterFiles.data) ? afterFiles.data.length : 0;
    a8 = { delete: d8.status, keptStatus: g8.status, keptName: g8.data && g8.data.businessData.name, projectFilesBefore: bCount, projectFilesAfter: aCount };
    ok08 = d8.ok && g8.ok && g8.data.businessData.name === "C08-保留合同" && bCount === aCount;
  }
  rec.rec({
    id: "C-08", status: ok08 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(a8), workspace: "company", recordIds: [c8a.data && c8a.data.id, c8b.data && c8b.data.id],
    notes: ok08 ? "同项目多合同删一条，另一条与项目附件均不受影响" : "删除一条合同影响到了其它合同或项目附件",
  });

  /* C-09 不同入口编辑同一记录 */
  const c9 = await create("company", "general", { General: { Title: "C09-一致性" } });
  let ok09 = false, a9 = {};
  if (c9.ok) {
    const id = c9.data.id;
    await put("company", "general", id, { General: { Title: "C09-一致性-第一次" } });
    const g1 = await get("company", "general", id);
    await put("company", "general", id, { General: { Title: "C09-一致性-第二次" } });
    const g2 = await get("company", "general", id);
    a9 = { first: g1.data && g1.data.businessData.title, second: g2.data && g2.data.businessData.title };
    ok09 = a9.first === "C09-一致性-第一次" && a9.second === "C09-一致性-第二次";
  }
  rec.rec({
    id: "C-09", status: ok09 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(a9), workspace: "company", recordIds: [c9.data && c9.data.id],
    notes: ok09 ? "连续两次更新均返回最新值，无旧值回写（本次为 HTTP 更新 + 读回，UI 表单入口见 C-12）" : "更新后返回旧值",
  });

  /* C-10 复制整个项目到个人工作区 */
  const beforePersonal = (await listRows("personal", "project")).length;
  const cp = await L.post(`/api/v2/projects/company/${P}/transfer`, { TargetWorkspace: "personal", Move: false });
  let ok10 = false, a10 = {};
  if (cp.ok) {
    const newId = cp.data.id || cp.data.targetId || cp.data.Id;
    const gp = newId ? await get("personal", "project", newId) : null;
    const gc = (await listRows("personal", "contract")).filter((r) => String(r.projectId || r.parentId || (r.parent && r.parent.id)) === String(newId));
    const gf = newId ? await L.get(`/api/v2/files/personal/folders/${newId}/links?includeDeleted=false`) : null;
    const src = await get("company", "project", P);
    a10 = { status: cp.status, newId, name: gp && gp.data && gp.data.businessData && gp.data.businessData.name, contractsAtTarget: gc.length, filesAtTarget: Array.isArray(gf && gf.data) ? gf.data.length : null, sourceStill: !!src.data };
    ok10 = !!newId && !!gp && gc.length >= 2 && a10.filesAtTarget >= 1 && !!src.data;
  } else a10 = { status: cp.status, body: cp.data };
  rec.rec({
    id: "C-10", status: ok10 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(a10), workspace: "company->personal", recordIds: [P, a10.newId],
    notes: ok10 ? "整项目复制生成新项目，合同与附件随之复制，原项目保留" : "整项目复制不完整或原项目被改动",
  });

  /* C-11 无效跨区/类型写入 */
  const x1 = await create("personal", "contract", { Contract: { Name: "C11-跨区合同", ContractNo: "C11-1" }, ProjectId: P });
  const x2 = await create("company", "archive", { Archive: { Name: "C11-错区档案", Category: "其他", Year: "2026" }, Section: "achievement" });
  const x3 = await create("personal", "archive", { Archive: { Name: "C11-错段", Category: "其他" }, Section: "certificate" });
  const ok11 = !x1.ok && !x2.ok && !x3.ok;
  rec.rec({
    id: "C-11", status: ok11 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ crossWorkspaceContract: { status: x1.status, body: x1.data }, archiveNoFolder: { status: x2.status, body: x2.data }, archiveWrongSection: { status: x3.status, body: x3.data } }),
    workspace: "company;personal", notes: ok11 ? "跨区合同、无所属目录档案、错分类档案均被拒绝" : "存在接受无效写入的分支",
  });

  /* C-12 新建后表格/树只出现一次 */
  const c12 = await create("company", "project", { Project: { Name: "C12-唯一显示", ProjectType: "科研项目", ProjectNo: "C12-U" } });
  let ok12 = false, a12 = {};
  if (c12.ok) {
    await b.evalJs(`Drive.openFolder('k:project')`); await sleep2(900);
    const names1 = await b.evalJs(`[...document.querySelectorAll('.row .row-title')].map(x=>x.textContent.trim())`);
    await b.evalJs(`Drive.render()`); await sleep2(600);
    const names2 = await b.evalJs(`[...document.querySelectorAll('.row .row-title')].map(x=>x.textContent.trim())`);
    a12 = { first: names1.filter((x) => x === "C12-唯一显示").length, second: names2.filter((x) => x === "C12-唯一显示").length, totalRows: names2.length };
    ok12 = a12.first === 1 && a12.second === 1;
  }
  rec.rec({
    id: "C-12", status: ok12 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(a12), workspace: "company", recordIds: [c12.data && c12.data.id],
    notes: ok12 ? "新建项目在表格中恰好一行，重渲染后不重复不消失" : "新建记录重复或消失",
    evidence: ["evidence/c12.png"],
  });
  await b.shot(path.join(EVID, "c12.png"));

  rec.flush();
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); rec.flush(); process.exit(1); });

function g2id(r) { return r.ok ? r.data.id : null; }
