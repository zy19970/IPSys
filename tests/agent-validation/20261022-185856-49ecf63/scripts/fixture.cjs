/* 建独立测试库与 fixture（V3）。只碰 build-retest/agent-validation-v3/vault-<runid>.db。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node fixture.cjs <runid>
   覆盖 S01..S12；S12 的 >200 条边界另见 fixture-bulk.cjs（用独立可抛弃库）。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v3-" + Date.now();
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const TMP = path.resolve(ROOT, "..", "..", "..", "build-retest", "agent-validation-v3");
L.ensureDir(EVID);
L.ensureDir(TMP);

const DB = path.join(TMP, `vault-${RUNID}.db`);
const PASSWORD = process.env.IPSYS_TEST_PASSWORD || require("node:crypto").randomBytes(12).toString("hex");
const log = L.makeLog(path.join(EVID, "fixture-build.log"));

/* 上传只返回 fileId，linkId 要回查目录的 link 列表 */
async function linkIdOf(ws, folderId, fileId) {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  if (!r.ok) throw new Error(`links ${ws}/${folderId} -> ${r.status} ${JSON.stringify(r.data)}`);
  const arr = Array.isArray(r.data) ? r.data : (r.data.items || []);
  const hits = arr.filter((x) => Number(x.fileId) === Number(fileId));
  if (!hits.length) throw new Error(`folder ${folderId} 无 fileId=${fileId} 的 link: ${JSON.stringify(arr).slice(0, 400)}`);
  const hit = hits[hits.length - 1];
  const id = hit.id ?? hit.linkId;
  if (!id) throw new Error("link 无 id: " + JSON.stringify(hit));
  return id;
}

async function create(kind, body, ws = "company") {
  const r = await L.post(`/api/v2/folders/${ws}/${kind}`, body);
  if (!r.ok) throw new Error(`create ${kind} -> ${r.status} ${JSON.stringify(r.data)} :: ${JSON.stringify(body)}`);
  const id = r.data && (r.data.id ?? (r.data.reference && r.data.reference.id));
  if (!id) throw new Error(`create ${kind} 无 id: ${JSON.stringify(r.data)}`);
  return id;
}

/* 上传并回填 linkId，统一形状 */
async function attach(ws, folderId, name, buf) {
  const up = ws === "company"
    ? await L.upload(folderId, name, buf)
    : await L.uploadIn("personal", folderId, name, buf);
  up.linkId = await linkIdOf(ws, folderId, up.fileId);
  up.name = name;
  up.size = buf.length;
  up.sha256 = require("node:crypto").createHash("sha256").update(buf).digest("hex");
  return up;
}

(async () => {
  if (fs.existsSync(DB)) throw new Error("数据库已存在，换一个 runid：" + DB);
  log.add(`BASE=${L.BASE}`);
  log.add(`DB=${DB}`);
  const opened = await L.openVault(DB, PASSWORD, true);
  log.add(`open create -> token len=${opened.token.length}`);

  const fx = {
    runid: RUNID, db: DB, createdAt: new Date().toISOString(),
    company: {}, personal: {}, archive: {}, trash: {}, files: {}, groups: {},
  };

  /* ================= S02 业务档案：系统目录 7 个 + 二级/三级 ================= */
  let ar = (await L.get("/api/v2/ui/archive/company")).data;
  fx.archive.system = ar.folders.map((f) => ({ id: f.id, name: f.name }));
  log.add(`S02 系统目录 ${ar.folders.length} 个 -> ${fx.archive.system.map((f) => f.id + ":" + f.name).join(", ")}`);
  if (ar.folders.length !== 7) throw new Error("系统目录不是 7 个");

  const sys1 = fx.archive.system[0].id;
  const lvl2 = (await L.post("/api/v2/folders/company/archive_folder",
    { ArchiveFolder: { Name: "二级-A", ParentId: sys1 }, Section: "achievement" })).data;
  const lvl2Id = lvl2.id;
  const lvl3 = (await L.post("/api/v2/folders/company/archive_folder",
    { ArchiveFolder: { Name: "三级-A1", ParentId: lvl2Id }, Section: "achievement" })).data;
  const lvl3Id = lvl3.id;
  fx.archive.lvl2 = lvl2Id;
  fx.archive.lvl3 = lvl3Id;
  log.add(`S02 二级-A=${lvl2Id}（父=${sys1}） 三级-A1=${lvl3Id}（父=${lvl2Id}）`);

  const recIds = [];
  for (let i = 1; i <= 5; i++) {
    const folderId = i === 1 ? lvl3Id : sys1;
    const r = await L.post("/api/v2/folders/company/archive", {
      Archive: { Name: `档案-${String(i).padStart(2, "0")}`, Category: "其他", Year: "2026", FolderId: folderId },
      Section: "achievement",
    });
    if (!r.ok) throw new Error("archive create " + JSON.stringify(r.data));
    recIds.push(r.data.id);
    log.add(`S02 档案-0${i} id=${r.data.id} folderId=${folderId}`);
  }
  fx.archive.records = recIds;

  /* ================= S03 项目 / 合同 ================= */
  const pA = await create("project", { Project: { Name: "项目A", ProjectType: "科研项目", ProjectNo: "P-A", StartDate: "2026-01-01" } });
  const pB = await create("project", { Project: { Name: "项目B", ProjectType: "横向项目", ProjectNo: "P-B" } });
  fx.company.projectA = pA; fx.company.projectB = pB;
  log.add(`S03 项目A=${pA} 项目B=${pB}`);

  const c1 = await create("contract", { Contract: { Name: "合同C1", ContractNo: "HT-01", SignDate: "2026-02-01", Amount: "100000" }, ProjectId: pA });
  const c2 = await create("contract", { Contract: { Name: "合同C2", ContractNo: "HT-02", SignDate: "2026-02-02" }, ProjectId: pA });
  fx.company.contractC1 = c1; fx.company.contractC2 = c2;
  log.add(`S03 合同C1=${c1} 合同C2=${c2}（都挂项目A）`);

  /* E-11 待实测：合同不带 projectId 会怎样 */
  const orphan = await L.post("/api/v2/folders/company/contract", { Contract: { Name: "孤儿合同X", ContractNo: "HT-X" } });
  fx.company.orphanContract = { status: orphan.status, body: orphan.data };
  log.add(`E-11 无 projectId 建合同 -> ${orphan.status} ${JSON.stringify(orphan.data).slice(0, 300)}`);

  /* ================= S04 IP 多版本 + 跨记录引用 ================= */
  const ipA = await create("ip", { Ip: { Name: "IP-A", IpType: "发明专利", Status: "已授权", ApplicationNo: "CN-A" } });
  const ipB = await create("ip", { Ip: { Name: "IP-B", IpType: "软件著作权", Status: "已登记", ApplicationNo: "CN-B" } });
  const ipC = await create("ip", { Ip: { Name: "IP-C", IpType: "商标", Status: "已注册", ApplicationNo: "CN-C" } });
  fx.company.ipA = ipA; fx.company.ipB = ipB; fx.company.ipC = ipC;
  log.add(`S04 IP-A=${ipA} IP-B=${ipB} IP-C=${ipC}`);

  const g1 = await create("general", { General: { Title: "综合资料-G1" } });
  fx.company.general = g1;
  log.add(`S06 综合资料G1=${g1}`);

  /* ================= 附件矩阵 ================= */
  const txt = (s) => Buffer.from(s, "utf8");

  const upProj = await attach("company", pA, "项目A说明.txt", txt("项目A的说明文件 v1"));
  fx.files.projectA = upProj;

  const upC1 = await attach("company", c1, "合同C1扫描.txt", txt("合同C1扫描件正文"));
  fx.files.contractC1 = upC1;

  /* S04: 同一 linkId 下 v1/v2 */
  const upIp = await attach("company", ipA, "专利说明书.txt", txt("专利说明书 v1 短"));
  const v2 = await L.addVersion("company", upIp.fileId, "专利说明书.txt", txt("专利说明书 v2 内容更长一些"));
  fx.files.ipA = upIp;
  fx.files.ipAV2 = v2;
  log.add(`S04 IP-A 附件 fileId=${upIp.fileId} linkId=${upIp.linkId} v1=${upIp.size}B -> v2 ${JSON.stringify(v2)}`);

  /* S04/S05: 同一 fileId 关联到 IP-B（新 linkId） */
  const assoc = await L.post(`/api/v2/files/company/${upIp.fileId}/associate`,
    { linkId: upIp.linkId, targetFolderId: ipB, move: false });
  let assocLinkId = null;
  if (assoc.ok) {
    assocLinkId = await linkIdOf("company", ipB, upIp.fileId);
  }
  fx.files.ipAssoc = { status: assoc.status, body: assoc.data, linkIdOnIpB: assocLinkId };
  log.add(`S04 associate fileId=${upIp.fileId} IP-A.link=${upIp.linkId} -> IP-B=${ipB} : ${assoc.status} 新 linkId=${assocLinkId}`);

  const upArc = await attach("company", recIds[0], "档案-01附件.txt", txt("最深目录档案的附件"));
  fx.files.archive1 = upArc;

  const upGen = await attach("company", g1, "综合资料附件.txt", txt("综合资料附件正文"));
  fx.files.general = upGen;

  /* S09: 三个不同 linkId（用于批量删除的局部失败） */
  const s09 = [];
  for (let i = 1; i <= 3; i++) {
    s09.push(await attach("company", ipC, `S09-${i}.txt`, txt(`S09 第 ${i} 项内容`)));
  }
  fx.groups.s09 = s09;
  log.add(`S09 三条不同 linkId -> ${s09.map((x) => `file=${x.fileId}/link=${x.linkId}`).join(", ")}`);

  /* S05: 同内容两次上传（不同文件名，观察是否复用 FileId） */
  const sameBody = txt("完全相同的内容，用于 SHA 相同判定");
  const dup1 = await attach("company", pA, "同内容-A.txt", sameBody);
  const dup2 = await attach("company", pA, "同内容-B.txt", sameBody);
  fx.groups.sameSha = { a: dup1, b: dup2, sameFileId: dup1.fileId === dup2.fileId };
  log.add(`S05 同 SHA 两次上传 fileId ${dup1.fileId} vs ${dup2.fileId}（是否同一 FileId=${dup1.fileId === dup2.fileId}）sha=${dup1.sha256.slice(0, 16)}`);

  /* S01: 跨工作区同名附件 */
  const sameName = "同名附件.txt";
  const upSameCo = await attach("company", pA, sameName, txt("公司侧同名附件，内容-COMPANY"));
  fx.files.sameNameCompany = upSameCo;
  const pP = await create("project", { Project: { Name: "项目P", ProjectType: "科研项目", ProjectNo: "P-P", StartDate: "2026-03-01" } }, "personal");
  const ipP = await create("ip", { Ip: { Name: "IP-P", IpType: "实用新型专利", Status: "已申请", ApplicationNo: "CN-P" } }, "personal");
  fx.personal.projectP = pP; fx.personal.ipP = ipP;
  const upSamePe = await attach("personal", pP, sameName, txt("个人侧同名附件，内容-PERSONAL 不同长度"));
  fx.files.sameNamePersonal = upSamePe;
  log.add(`S01 同名附件 公司 fileId=${upSameCo.fileId} / 个人 fileId=${upSamePe.fileId}`);

  /* ================= S07 预览素材（合法两页 PDF） ================= */
  const pdfObjs = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 7 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 7 0 R>>>>/Contents 6 0 R>>endobj",
  ];
  const s1 = "BT /F1 18 Tf 30 120 Td (PAGE ONE - IPSys) Tj ET";
  const s2 = "BT /F1 18 Tf 30 120 Td (PAGE TWO - IPSys) Tj ET";
  pdfObjs.push(`5 0 obj<</Length ${s1.length}>>stream\n${s1}\nendstream\nendobj`);
  pdfObjs.push(`6 0 obj<</Length ${s2.length}>>stream\n${s2}\nendstream\nendobj`);
  pdfObjs.push("7 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const o of pdfObjs) { offsets.push(pdf.length); pdf += o + "\n"; }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${pdfObjs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer<</Size ${pdfObjs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  const pdfBuf = Buffer.from(pdf, "latin1");
  fs.writeFileSync(path.join(EVID, "fixture-two-page.pdf"), pdfBuf);
  const upPdf = await attach("company", pA, "两页示例.pdf", pdfBuf);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const upPng = await attach("company", pA, "示例图.png", png);
  const docx = Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), Buffer.from("fake-docx-payload")]);
  const upDocx = await attach("company", pA, "示例文档.docx", docx);
  fx.files.pdf = upPdf; fx.files.png = upPng; fx.files.docx = upDocx;
  log.add(`S07 两页 PDF ${pdfBuf.length}B xref@${xrefPos} -> fileId=${upPdf.fileId}；png/docx 已传`);

  /* ================= S08 大小边界 ================= */
  const zero = await attach("company", pB, "零字节.bin", Buffer.alloc(0));
  const small = await attach("company", pB, "小文本.txt", txt("小文本内容"));
  const big31 = await attach("company", pB, "边界31M.bin", Buffer.alloc(31 * 1024 * 1024, 0x42));
  const big33 = await attach("company", pB, "边界33M.bin", Buffer.alloc(33 * 1024 * 1024, 0x41));
  fx.files.zero = zero; fx.files.small = small; fx.files.big31 = big31; fx.files.big33 = big33;
  log.add(`S08 0B=${zero.fileId} 小=${small.fileId} 31MiB=${big31.fileId} 33MiB=${big33.fileId}`);

  /* ================= S10 可回收页素材：大文件上传后解除关联并永久删除 ================= */
  const big6 = await attach("company", ipC, "待回收6M.bin", Buffer.alloc(6 * 1024 * 1024, 0x43));
  fx.files.reclaimSrc = big6;
  const dBig = await L.del(`/api/v2/files/company/${big6.fileId}/links/${big6.linkId}`);
  log.add(`S10 解除 ${big6.fileId} 的 link -> ${dBig.status}`);

  /* ================= S12 回收站素材 ================= */
  const dC1 = await L.del(`/api/v2/folders/company/contract/${c1}`);
  const dLink = await L.del(`/api/v2/files/company/${upProj.fileId}/links/${upProj.linkId}`);
  const dB = await L.del(`/api/v2/folders/company/project/${pB}`);
  const dArc5 = await L.del(`/api/v2/folders/company/archive/${recIds[4]}?section=achievement`);
  log.add(`S12 删合同C1=${dC1.status} 删项目A附件link=${dLink.status} 删项目B=${dB.status} 删档案-05=${dArc5.status}`);

  /* 彻底删除 6M 原件，制造可回收页（T-P1-07 前置） */
  const purge = await L.post(`/api/trash/company/purge-task`, {
    items: [{ kind: "file", id: big6.fileId, section: "" }],
  });
  log.add(`S10 purge-task -> ${purge.status} ${JSON.stringify(purge.data)}`);
  fx.purgeTask = { status: purge.status, body: purge.data };
  if (purge.ok && purge.data?.taskId) {
    for (let i = 0; i < 30; i++) {
      const t = await L.get(`/api/trash/company/purge-task?taskId=${purge.data.taskId}`);
      if (!t.ok) break;
      if (["succeeded", "failed", "canceled"].includes(t.data?.state)) {
        log.add(`S10 purge 结束 state=${t.data.state}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const compactInfo = await L.get("/api/vault/compact/info");
  fx.compactInfo = compactInfo.data;
  log.add(`S10 compact/info -> ${compactInfo.status} ${JSON.stringify(compactInfo.data)}`);

  const trash = await L.get("/api/trash/company");
  fx.trash.company = trash.data;
  log.add(`S12 回收站(company) -> ${JSON.stringify(trash.data).slice(0, 600)}`);
  const trashP = await L.get("/api/trash/personal");
  fx.trash.personal = trashP.data;

  /* ================= 回读校验 ================= */
  const views = {};
  for (const p of ["archive", "projects", "ip", "general", "contracts", "project-files"]) {
    const r = await L.get(`/api/v2/ui/${p}/company`);
    views[p] = Array.isArray(r.data) ? r.data.length : Object.keys(r.data || {});
    log.add(`GET /api/v2/ui/${p}/company -> ${r.status} (${Array.isArray(r.data) ? r.data.length + " rows" : JSON.stringify(views[p])})`);
  }
  fx.viewCounts = views;

  fs.writeFileSync(path.join(EVID, "fixture.json"), JSON.stringify(fx, null, 2), "utf8");
  fs.writeFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), JSON.stringify({ db: DB, password: PASSWORD }), "utf8");
  log.add("fixture.json 已写入：" + path.join(EVID, "fixture.json"));
  log.flush();
})().catch((e) => {
  log.add("FIXTURE FAILED: " + e.stack);
  log.flush();
  process.exit(1);
});
