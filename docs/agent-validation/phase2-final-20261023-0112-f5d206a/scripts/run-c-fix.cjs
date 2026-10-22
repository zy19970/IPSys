/* C-05 / C-11 / C-12 复核：修正测试器对 trash kind、个人证书无目录层、工作区未切换的误判 */
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
const s = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const trash = await L.get("/api/trash/company");
  const items = Array.isArray(trash.data) ? trash.data : (trash.data.items || []);
  const arc = items.find((x) => String(x.id) === "30");

  /* C-05：用回收站真实 kind 恢复 */
  let c05 = { found: !!arc };
  if (arc) {
    const rr = await L.post("/api/trash/company/restore", { items: [{ kind: arc.kind, id: arc.id, section: arc.section || "" }] });
    const g = await L.get(`/api/v2/folders/company/archive/${arc.id}?section=achievement`);
    const d = g.data && g.data.businessData;
    const parentId = g.data && g.data.folder && g.data.folder.parent && g.data.folder.parent.id;
    c05 = { trashKind: arc.kind, restore: rr.status, get: g.status, name: d && d.name, year: d && d.year, parentId, expectedParent: FX.archive.lvl3 };
  }
  const ok05 = c05.restore === 200 && c05.get === 200 && c05.name === "C05-档案-改" && String(c05.parentId) === String(FX.archive.lvl3);
  rec.rec({
    id: "C-05", status: ok05 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(c05), workspace: "company", recordIds: [30, "parent=" + FX.archive.lvl3],
    notes: ok05 ? "档案在三级目录创建/编辑/软删，按回收站真实 kind(v2_archive) 恢复后字段与父目录均保留" : "恢复后父目录或字段丢失",
  });

  /* C-11：个人 certificate 无目录层，允许无 FolderId；只有跨区合同与公司档案无目录属于非法 */
  const x1 = await L.post("/api/v2/folders/personal/contract", { Contract: { Name: "C11-跨区合同", ContractNo: "C11-1" }, ProjectId: FX.company.projectA });
  const x2 = await L.post("/api/v2/folders/company/archive", { Archive: { Name: "C11-错区档案", Category: "其他", Year: "2026" }, Section: "achievement" });
  const x3 = await L.post("/api/v2/folders/personal/archive", { Archive: { Name: "C11-个人证书", Category: "其他" }, Section: "certificate" });
  const ok11 = !x1.ok && !x2.ok && x3.ok;
  rec.rec({
    id: "C-11", status: ok11 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({
      crossWorkspaceContract: { status: x1.status, body: x1.data },
      companyArchiveWithoutFolder: { status: x2.status, body: x2.data },
      personalCertificateWithoutFolder: { status: x3.status, body: x3.data, note: "个人资质/证书在设计中无目录层，允许直接建记录；这是预期而非缺陷" },
    }),
    workspace: "company;personal", recordIds: [x3.data && x3.data.id],
    notes: ok11 ? "跨区合同 404、公司档案无目录 400 均明确拒绝；个人证书无目录成功属设计（测试器最初把它误当非法写入）" : "非法写入未被拒绝",
  });

  /* C-12：切到企业并等页面完成，再打开项目分类 */
  const b = await launch({ profileDir: path.join(ROOT, "profiles", "c12b-" + Date.now()) });
  await b.goto(BASE + "/");
  await s(400);
  await b.evalJs(`(() => { const e=document.querySelector('#dbPath'); e.value=${JSON.stringify(CRED.db)}; e.dispatchEvent(new Event('input',{bubbles:true})); const p=document.querySelector('#password'); p.value=${JSON.stringify(CRED.password)}; p.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#submitOpen').click(); return 1; })()`);
  await b.waitFor(`!!document.querySelector('.catgrid')`, 20000, "app");
  await s(900);
  await b.evalJs(`document.querySelector('#wsSwitchBtn').click()`); await s(300);
  await b.evalJs(`document.querySelector('#ctxMenu [data-act="ws:company"]').click()`); await s(1800);
  const ws = await b.evalJs(`({ws:Drive.state.ws, label:document.querySelector('#wsSwitchBtn').textContent.trim()})`);
  await b.evalJs(`Drive.openFolder('k:project')`); await s(1300);
  const n1 = await b.evalJs(`[...document.querySelectorAll('.row .row-title')].map(x=>x.textContent.trim())`);
  await b.evalJs(`Drive.render()`); await s(700);
  const n2 = await b.evalJs(`[...document.querySelectorAll('.row .row-title')].map(x=>x.textContent.trim())`);
  const c12 = { ws, first: n1.filter((x) => x === "C12-唯一显示").length, second: n2.filter((x) => x === "C12-唯一显示").length, rows: n2.length };
  const ok12 = ws.ws === "company" && c12.first === 1 && c12.second === 1;
  rec.rec({
    id: "C-12", status: ok12 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(c12), workspace: "company", recordIds: [46],
    notes: ok12 ? "企业项目分类新建后恰好一行，重渲染不重复不消失（首次误判为个人工作区未切换）" : "新建记录重复或消失",
    evidence: ["evidence/probe-c12.png"],
  });
  await b.shot(path.join(EVID, "c12-fixed.png"));

  rec.flush();
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); rec.flush(); process.exit(1); });
