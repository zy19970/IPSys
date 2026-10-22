/* 建独立测试库与 fixture。只碰 build-retest/agent-explorer-full-v2/vault-<runid>.db。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node fixture.cjs <runid> */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v2-" + Date.now();
const ROOT = path.resolve(__dirname, "..");
const EVID = process.env.IPSYS_EVIDENCE_DIR ? path.resolve(process.env.IPSYS_EVIDENCE_DIR) : path.join(ROOT, "evidence");
const TMP = path.resolve(ROOT, "..", "..", "build-retest", "agent-explorer-full-v2");
L.ensureDir(EVID);
L.ensureDir(TMP);

const DB = path.join(TMP, `vault-${RUNID}.db`);
const PASSWORD = process.env.IPSYS_TEST_PASSWORD || require("node:crypto").randomBytes(12).toString("hex");
// 仅测试库；写入 build-retest 的 cred 文件，不进 docs
const log = L.makeLog(path.join(EVID, "fixture-build.log"));

/* 上传只返回 fileId，linkId 要回查目录的 link 列表 */
async function linkIdOf(ws, folderId, fileId) {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  if (!r.ok) throw new Error(`links ${ws}/${folderId} -> ${r.status} ${JSON.stringify(r.data)}`);
  const arr = Array.isArray(r.data) ? r.data : (r.data.items || []);
  const hits = arr.filter((x) => Number(x.fileId) === Number(fileId));
  if (!hits.length) throw new Error(`folder ${folderId} 无 fileId=${fileId} 的 link: ${JSON.stringify(arr).slice(0,400)}`);
  const hit = hits[hits.length - 1];
  const id = hit.id ?? hit.linkId;
  if (!id) throw new Error("link 无 id: " + JSON.stringify(hit));
  return id;
}

/* 新建端点统一返回 {id, reference}；失败时把原文打出来，别让 undefined 传到下一步 */
async function create(kind, body) {
  const r = await L.post(`/api/v2/folders/company/${kind}`, body);
  if (!r.ok) throw new Error(`create ${kind} -> ${r.status} ${JSON.stringify(r.data)} :: ${JSON.stringify(body)}`);
  const id = r.data && (r.data.id ?? (r.data.reference && r.data.reference.id));
  if (!id) throw new Error(`create ${kind} 无 id: ${JSON.stringify(r.data)}`);
  return id;
}


/* Valid two-page PDF fixture: correct xref, font resources and stream lengths. */
function makeTwoPagePdf() {
  const stream = (label) => {
    const content = "BT /F1 12 Tf 20 100 Td (" + label + ") Tj ET";
    return "<< /Length " + Buffer.byteLength(content, "ascii") + " >>\nstream\n" + content + "\nendstream";
  };
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    stream("Page One"),
    stream("Page Two"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += (i + 1) + " 0 obj\n" + objects[i] + "\nendobj\n";
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF\n";
  return Buffer.from(pdf, "ascii");
}

(async () => {
  if (fs.existsSync(DB)) throw new Error("数据库已存在，换一个 runid：" + DB);
  log.add(`BASE=${L.BASE}`);
  log.add(`DB=${DB}`);
  const opened = await L.openVault(DB, PASSWORD, true);
  log.add(`open create -> token len=${opened.token.length}`);

  const fx = { runid: RUNID, db: DB, company: {}, personal: {}, archive: {}, trash: {}, files: {} };

  /* ---------- 公司档案：7 个系统目录 + 二级/三级 ---------- */
  let ar = (await L.get("/api/v2/ui/archive/company")).data;
  log.add(`system folders: ${ar.folders.length} -> ${ar.folders.map((f) => f.id + ":" + f.name).join(", ")}`);
  if (ar.folders.length !== 7) throw new Error("系统目录不是 7 个");
  fx.archive.system = ar.folders.map((f) => ({ id: f.id, name: f.name }));

  const sys1 = fx.archive.system[0].id;
  const lvl2 = (await L.post("/api/v2/folders/company/archive_folder",
    { ArchiveFolder: { Name: "二级-A", ParentId: sys1 }, Section: "achievement" })).data;
  log.add("二级-A -> " + JSON.stringify(lvl2));
  const lvl2Id = lvl2.id;

  const lvl3 = (await L.post("/api/v2/folders/company/archive_folder",
    { ArchiveFolder: { Name: "三级-A1", ParentId: lvl2Id }, Section: "achievement" })).data;
  log.add("三级-A1 -> " + JSON.stringify(lvl3));
  const lvl3Id = lvl3.id;
  fx.archive.lvl2 = lvl2Id;
  fx.archive.lvl3 = lvl3Id;

  /* 最深处的档案记录 + 另外 4 条（用于 Excel 5 行） */
  const recIds = [];
  for (let i = 1; i <= 5; i++) {
    const folderId = i === 1 ? lvl3Id : sys1;
    const r = await L.post("/api/v2/folders/company/archive", {
      Archive: { Name: `档案-${String(i).padStart(2, "0")}`, Category: "其他", Year: "2026", FolderId: folderId },
      Section: "achievement",
    });
    if (!r.ok) throw new Error("archive create " + JSON.stringify(r.data));
    recIds.push(r.data.id);
    log.add(`档案-0${i} -> id=${r.data.id} folderId=${folderId}`);
  }
  fx.archive.records = recIds;

  /* ---------- 项目 / 合同 ---------- */
  const pA = { id: await create("project", { Project: { Name: "项目A", ProjectType: "科研项目", ProjectNo: "P-A", StartDate: "2026-01-01" } }) };
  const pB = { id: await create("project", { Project: { Name: "项目B", ProjectType: "横向项目", ProjectNo: "P-B" } }) };
  fx.company.projectA = pA.id; fx.company.projectB = pB.id;
  log.add(`项目A=${pA.id} 项目B=${pB.id}`);

  const c1 = { id: await create("contract", { Contract: { Name: "合同C1", ContractNo: "HT-01", SignDate: "2026-02-01", Amount: "100000" }, ProjectId: pA.id }) };
  const c2 = { id: await create("contract", { Contract: { Name: "合同C2", ContractNo: "HT-02", SignDate: "2026-02-02" }, ProjectId: pA.id }) };
  fx.company.contractC1 = c1.id; fx.company.contractC2 = c2.id;
  log.add(`合同C1=${c1.id} 合同C2=${c2.id}（均挂项目A）`);

  /* ---------- IP / 综合资料 ---------- */
  const ipA = { id: await create("ip", { Ip: { Name: "IP-A", IpType: "发明专利", Status: "已授权", ApplicationNo: "CN-A" } }) };
  const ipB = { id: await create("ip", { Ip: { Name: "IP-B", IpType: "软件著作权", Status: "已登记", ApplicationNo: "CN-B" } }) };
  fx.company.ipA = ipA.id; fx.company.ipB = ipB.id;
  log.add(`IP-A=${ipA.id} IP-B=${ipB.id}`);

  const g1 = { id: await create("general", { General: { Title: "综合资料-G1" } }) };
  fx.company.general = g1.id;
  log.add(`综合资料G1=${g1.id}`);

  /* ---------- 附件 ---------- */
  const txt = (s) => Buffer.from(s, "utf8");

  const upProj = await L.upload(pA.id, "项目A说明.txt", txt("项目A的说明文件 v1"));
  upProj.linkId = await linkIdOf("company", pA.id, upProj.fileId);
  fx.files.projectA = upProj;
  log.add("项目A附件 -> " + JSON.stringify(upProj));

  const upC1 = await L.upload(c1.id, "合同C1扫描.txt", txt("合同C1扫描件正文"));
  upC1.linkId = await linkIdOf("company", c1.id, upC1.fileId);
  fx.files.contractC1 = upC1;
  log.add("合同C1附件 -> " + JSON.stringify(upC1));

  const upIp = await L.upload(ipA.id, "专利说明书.txt", txt("专利说明书 v1 短"));
  upIp.linkId = await linkIdOf("company", ipA.id, upIp.fileId);
  fx.files.ipA = upIp;
  log.add("IP-A附件 -> " + JSON.stringify(upIp));

  const v2 = await L.addVersion("company", upIp.fileId, "专利说明书.txt", txt("专利说明书 v2 内容更长一些"));
  fx.files.ipAV2 = v2;
  log.add("IP-A 附件 v2 -> " + JSON.stringify(v2));

  /* 跨记录引用：把 IP-A 的同一个 fileId 关联到 IP-B，move=false → 新 linkId */
  const assoc = await L.post(`/api/v2/files/company/${upIp.fileId}/associate`,
    { linkId: upIp.linkId, targetFolderId: ipB.id, move: false });
  fx.files.ipAssoc = assoc.data;
  log.add(`associate IP-A.fileId=${upIp.fileId} link=${upIp.linkId} -> IP-B(${ipB.id}) : ${assoc.status} ${JSON.stringify(assoc.data)}`);

  const upArc = await L.upload(recIds[0], "档案-01附件.txt", txt("最深目录档案的附件"));
  upArc.linkId = await linkIdOf("company", recIds[0], upArc.fileId);
  fx.files.archive1 = upArc;
  log.add("档案-01附件 -> " + JSON.stringify(upArc));

  const upGen = await L.upload(g1.id, "综合资料附件.txt", txt("综合资料附件正文"));
  upGen.linkId = await linkIdOf("company", g1.id, upGen.fileId);
  fx.files.general = upGen;
  log.add("综合资料附件 -> " + JSON.stringify(upGen));

  /* 同名不同内容：公司 + 个人，用于 R-03 隔离 */
  const sameName = "同名附件.txt";
  const upSameCo = await L.upload(pA.id, sameName, txt("公司侧同名附件，内容-COMPANY"));
  upSameCo.linkId = await linkIdOf("company", pA.id, upSameCo.fileId);
  fx.files.sameNameCompany = upSameCo;
  log.add("同名附件(公司) -> " + JSON.stringify(upSameCo));

  /* ---------- 个人工作区 ---------- */
  const rP = await L.post("/api/v2/folders/personal/project", { Project: { Name: "项目P", ProjectType: "科研项目", ProjectNo: "P-P", StartDate: "2026-03-01" } });
  if (!rP.ok || !rP.data?.id) throw new Error("个人项目创建失败 " + rP.status + JSON.stringify(rP.data));
  const pP = rP.data;
  fx.personal.projectP = pP.id;
  log.add(`个人项目P=${pP.id}`);

  const rIp = await L.post("/api/v2/folders/personal/ip", { Ip: { Name: "IP-P", IpType: "实用新型专利", Status: "已申请", ApplicationNo: "CN-P" } });
  if (!rIp.ok || !rIp.data?.id) throw new Error("个人IP创建失败 " + rIp.status + JSON.stringify(rIp.data));
  const ipP = rIp.data;
  fx.personal.ipP = ipP.id;
  log.add(`个人IP-P=${ipP.id}`);

  const upSamePe = await L.uploadIn("personal", pP.id, sameName, txt("个人侧同名附件，内容-PERSONAL 不同长度"));
  upSamePe.linkId = await linkIdOf("personal", pP.id, upSamePe.fileId);
  fx.files.sameNamePersonal = upSamePe;
  log.add("同名附件(个人) -> " + JSON.stringify(upSamePe));


  /* ---------- 预览与下载素材 ---------- */
  const pdf = makeTwoPagePdf();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const docx = Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), Buffer.from("fake-docx-payload")]);
  const upPdf = await L.upload(pA.id, "两页示例.pdf", pdf); upPdf.linkId = await linkIdOf("company", pA.id, upPdf.fileId);
  const upPng = await L.upload(pA.id, "示例图.png", png); upPng.linkId = await linkIdOf("company", pA.id, upPng.fileId);
  const upDocx = await L.upload(pA.id, "示例文档.docx", docx); upDocx.linkId = await linkIdOf("company", pA.id, upDocx.fileId);
  fx.files.pdf = upPdf; fx.files.png = upPng; fx.files.docx = upDocx;
  log.add("预览素材 -> pdf/png/docx " + JSON.stringify([upPdf.fileId, upPng.fileId, upDocx.fileId]));

  /* 33 MiB：超过 32 MiB 流式下载阈值 */
  const big = Buffer.alloc(33 * 1024 * 1024, 0x41);
  const upBig = await L.upload(pA.id, "大文件33M.bin", big); upBig.linkId = await linkIdOf("company", pA.id, upBig.fileId);
  fx.files.big33 = { fileId: upBig.fileId, linkId: upBig.linkId, size: big.length };
  log.add(`33MiB -> fileId=${upBig.fileId} size=${big.length}`);

  /* ---------- 回收站 fixture ----------
     ① 单独删合同 C1（父项目 A 仍在）
     ② 单独删项目 A 的一个附件 link
     ③ 整体删项目 B
     ④ 单独删档案-05
  */
  const dC1 = await L.del(`/api/v2/folders/company/contract/${c1.id}`);
  log.add(`delete 合同C1 -> ${dC1.status} ${JSON.stringify(dC1.data)}`);

  const dLink = await L.del(`/api/v2/files/company/${upProj.fileId}/links/${upProj.linkId}`);
  log.add(`delete 项目A附件 link -> ${dLink.status} ${JSON.stringify(dLink.data)}`);

  const dB = await L.del(`/api/v2/folders/company/project/${pB.id}`);
  log.add(`delete 项目B -> ${dB.status} ${JSON.stringify(dB.data)}`);

  const dArc5 = await L.del(`/api/v2/folders/company/archive/${recIds[4]}?section=achievement`);
  log.add(`delete 档案-05 -> ${dArc5.status} ${JSON.stringify(dArc5.data)}`);

  const trash = await L.get("/api/trash/company");
  log.add("回收站(company): " + JSON.stringify(trash.data));
  fx.trash.company = trash.data;

  const trashP = await L.get("/api/trash/personal");
  fx.trash.personal = trashP.data;
  log.add("回收站(personal): " + JSON.stringify(trashP.data));

  /* ---------- 记录回读，确认 fixture 真的落库 ---------- */
  const views = {};
  for (const p of ["archive", "projects", "ip", "general", "contracts", "project-files"]) {
    const r = await L.get(`/api/v2/ui/${p}/company`);
    views[p] = Array.isArray(r.data) ? r.data.length : Object.keys(r.data || {});
    log.add(`GET /api/v2/ui/${p}/company -> ${r.status} (${Array.isArray(r.data) ? r.data.length + " rows" : JSON.stringify(views[p])})`);
  }
  fx.viewCounts = views;

  fs.writeFileSync(path.join(EVID, "fixture.json"), JSON.stringify(fx, null, 2), "utf8");
  fs.writeFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), JSON.stringify({ db: DB, password: PASSWORD }), "utf8");
  log.add("fixture.json 已写入");
  log.flush();
})().catch((e) => {
  log.add("FIXTURE FAILED: " + e.stack);
  log.flush();
  process.exit(1);
});
