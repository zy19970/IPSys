/* Phase 2 最终验收：隔离库与种子数据
   用法：IPSYS_BASE=http://127.0.0.1:PORT node fixture.cjs <runid>
   只写 build-retest/phase2/vault-p2-<runid>.db，不碰正式库。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "p2-" + Date.now();
const ROOT = path.resolve(__dirname, "..");
const EVID = process.env.IPSYS_EVID || path.join(ROOT, "evidence");
const TMP = path.join(ROOT);
L.ensureDir(EVID);

const DB = path.join(TMP, `vault-p2-${RUNID}.db`);
const PASSWORD = process.env.IPSYS_TEST_PASSWORD || crypto.randomBytes(12).toString("hex");
const log = L.makeLog(path.join(EVID, "fixture-build.log"));

async function linkIdOf(ws, folderId, fileId) {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  if (!r.ok) throw new Error(`links ${ws}/${folderId} -> ${r.status} ${JSON.stringify(r.data)}`);
  const arr = Array.isArray(r.data) ? r.data : (r.data.items || []);
  const hit = arr.filter((x) => Number(x.fileId) === Number(fileId)).pop();
  if (!hit) throw new Error(`folder ${folderId} 无 fileId=${fileId} 的 link`);
  const id = hit.id ?? hit.linkId;
  if (!id) throw new Error("link 无 id: " + JSON.stringify(hit));
  return id;
}

async function create(ws, kind, body) {
  const r = await L.post(`/api/v2/folders/${ws}/${kind}`, body);
  if (!r.ok) throw new Error(`create ${ws}/${kind} -> ${r.status} ${JSON.stringify(r.data)} :: ${JSON.stringify(body)}`);
  const id = r.data && (r.data.id ?? (r.data.reference && r.data.reference.id));
  if (!id) throw new Error(`create ${kind} 无 id: ${JSON.stringify(r.data)}`);
  return id;
}

async function attach(ws, folderId, name, buf) {
  const up = ws === "company"
    ? await L.upload(folderId, name, buf)
    : await L.uploadIn(ws, folderId, name, buf);
  up.linkId = await linkIdOf(ws, folderId, up.fileId);
  up.name = name;
  up.size = buf.length;
  up.sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  return up;
}

/* 合法两页 PDF，带 xref 偏移 */
function twoPagePdf() {
  const objs = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 7 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 7 0 R>>>>/Contents 6 0 R>>endobj",
  ];
  const s1 = "BT /F1 18 Tf 30 120 Td (PAGE ONE - IPSys) Tj ET";
  const s2 = "BT /F1 18 Tf 30 120 Td (PAGE TWO - IPSys) Tj ET";
  objs.push(`5 0 obj<</Length ${s1.length}>>stream\n${s1}\nendstream\nendobj`);
  objs.push(`6 0 obj<</Length ${s2.length}>>stream\n${s2}\nendstream\nendobj`);
  objs.push("7 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const o of objs) { offsets.push(pdf.length); pdf += o + "\n"; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const TXT = (s) => Buffer.from(s, "utf8");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==", "base64");

(async () => {
  if (fs.existsSync(DB)) throw new Error("数据库已存在，换一个 runid：" + DB);
  log.add(`BASE=${L.BASE}`);
  log.add(`DB=${DB}`);
  const opened = await L.openVault(DB, PASSWORD, true);
  log.add(`open create -> token len=${opened.token.length}`);

  const fx = { runid: RUNID, db: DB, password: PASSWORD, createdAt: new Date().toISOString(), company: {}, personal: {}, archive: {}, files: {}, groups: {}, trash: {} };

  /* ---------- 公司业务档案：系统目录 + 二级 + 三级 ---------- */
  const ar = (await L.get("/api/v2/ui/archive/company")).data;
  fx.archive.system = ar.folders.map((f) => ({ id: f.id, name: f.name }));
  if (fx.archive.system.length < 7) throw new Error("系统目录不足 7 个");
  const sys1 = fx.archive.system[0].id;
  const lvl2 = (await L.post("/api/v2/folders/company/archive_folder",
    { ArchiveFolder: { Name: "P2二级-A", ParentId: sys1 }, Section: "achievement" })).data;
  const lvl3 = (await L.post("/api/v2/folders/company/archive_folder",
    { ArchiveFolder: { Name: "P2三级-A1", ParentId: lvl2.id }, Section: "achievement" })).data;
  fx.archive.lvl2 = lvl2.id; fx.archive.lvl3 = lvl3.id;
  log.add(`档案目录 sys1=${sys1} lvl2=${lvl2.id} lvl3=${lvl3.id}`);

  const arc1 = await L.post("/api/v2/folders/company/archive", {
    Archive: { Name: "P2档案-01", Category: "其他", Year: "2026", FolderId: lvl3.id }, Section: "achievement",
  });
  const arc2 = await L.post("/api/v2/folders/company/archive", {
    Archive: { Name: "P2档案-02", Category: "其他", Year: "2025", FolderId: sys1 }, Section: "achievement",
  });
  if (!arc1.ok || !arc2.ok) throw new Error("档案创建失败 " + JSON.stringify([arc1.data, arc2.data]));
  fx.archive.records = [arc1.data.id, arc2.data.id];
  log.add(`档案 records=${fx.archive.records.join(",")}`);

  /* ---------- 公司项目 / 合同 ---------- */
  fx.company.projectA = await create("company", "project", { Project: { Name: "P2项目A", ProjectType: "科研项目", ProjectNo: "P2-A", StartDate: "2026-01-01" } });
  fx.company.projectB = await create("company", "project", { Project: { Name: "P2项目B", ProjectType: "横向项目", ProjectNo: "P2-B" } });
  fx.company.contractC1 = await create("company", "contract", { Contract: { Name: "P2合同C1", ContractNo: "P2-HT-01", SignDate: "2026-02-01", Amount: "100000" }, ProjectId: fx.company.projectA });
  fx.company.contractC2 = await create("company", "contract", { Contract: { Name: "P2合同C2", ContractNo: "P2-HT-02", SignDate: "2026-02-02", Amount: "200000" }, ProjectId: fx.company.projectA });
  fx.company.contractC3 = await create("company", "contract", { Contract: { Name: "P2合同C3", ContractNo: "P2-HT-03", SignDate: "2026-02-03" }, ProjectId: fx.company.projectB });
  log.add(`项目 ${fx.company.projectA}/${fx.company.projectB}；合同 ${fx.company.contractC1}/${fx.company.contractC2}/${fx.company.contractC3}`);

  /* ---------- 公司知识产权 / 综合资料 ---------- */
  fx.company.ipA = await create("company", "ip", { Ip: { Name: "P2-IP-A", IpType: "发明专利", Status: "已授权", ApplicationNo: "P2-CN-A" } });
  fx.company.ipB = await create("company", "ip", { Ip: { Name: "P2-IP-B", IpType: "软件著作权", Status: "已登记", ApplicationNo: "P2-CN-B" } });
  fx.company.general1 = await create("company", "general", { General: { Title: "P2综合资料-G1" } });
  fx.company.general2 = await create("company", "general", { General: { Title: "P2综合资料-G2" } });
  log.add(`IP ${fx.company.ipA}/${fx.company.ipB}；综合 ${fx.company.general1}/${fx.company.general2}`);

  /* ---------- 个人：项目 / 知产 / 档案 / 综合 ---------- */
  fx.personal.projectP = await create("personal", "project", { Project: { Name: "P2个人项目P", ProjectType: "科研项目", ProjectNo: "P2-P" } });
  fx.personal.ipP = await create("personal", "ip", { Ip: { Name: "P2个人IP-P", IpType: "实用新型专利", Status: "已申请", ApplicationNo: "P2-CN-P" } });
  const pArc = await L.post("/api/v2/folders/personal/archive", {
    Archive: { Name: "P2个人档案-01", Category: "其他", Year: "2026" }, Section: "achievement",
  });
  if (!pArc.ok) throw new Error("个人档案创建失败 " + JSON.stringify(pArc.data));
  fx.personal.archive1 = pArc.data.id;
  fx.personal.general1 = await create("personal", "general", { General: { Title: "P2个人综合-G1" } });
  log.add(`个人 项目=${fx.personal.projectP} IP=${fx.personal.ipP} 档案=${fx.personal.archive1} 综合=${fx.personal.general1}`);

  /* ---------- 附件矩阵 ---------- */
  fx.files.pdf = await attach("company", fx.company.projectA, "P2两页示例.pdf", twoPagePdf());
  fs.writeFileSync(path.join(EVID, "fixture-two-page.pdf"), twoPagePdf());
  fx.files.txt = await attach("company", fx.company.projectA, "P2说明.txt", TXT("P2 说明文件内容"));
  fx.files.png = await attach("company", fx.company.projectA, "P2示例图.png", PNG);
  fx.files.jpg = await attach("company", fx.company.projectA, "P2示例图.jpg", JPG);
  fx.files.docx = await attach("company", fx.company.projectA, "P2示例文档.docx", Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), Buffer.from("p2-fake-docx")]));
  fx.files.big33 = await attach("company", fx.company.projectA, "P2边界33M.bin", Buffer.alloc(33 * 1024 * 1024, 0x41));
  log.add(`附件 pdf=${fx.files.pdf.fileId} txt=${fx.files.txt.fileId} png=${fx.files.png.fileId} jpg=${fx.files.jpg.fileId} docx=${fx.files.docx.fileId} 33M=${fx.files.big33.fileId}`);

  /* 两版本：IP-A */
  fx.files.ipA = await attach("company", fx.company.ipA, "P2专利说明书.txt", TXT("P2 专利说明书 v1"));
  fx.files.ipAV2 = await L.addVersion("company", fx.files.ipA.fileId, "P2专利说明书.txt", TXT("P2 专利说明书 v2 内容更长"));
  fx.files.ipAV2.sha256 = crypto.createHash("sha256").update(TXT("P2 专利说明书 v2 内容更长")).digest("hex");
  log.add(`IP-A 附件 file=${fx.files.ipA.fileId} link=${fx.files.ipA.linkId} v2=${JSON.stringify(fx.files.ipAV2)}`);

  /* 共享到 IP-B */
  const assoc = await L.post(`/api/v2/files/company/${fx.files.ipA.fileId}/associate`,
    { linkId: fx.files.ipA.linkId, targetFolderId: fx.company.ipB, move: false });
  fx.files.ipAssoc = { status: assoc.status, body: assoc.data };
  if (assoc.ok) fx.files.ipAssoc.linkIdOnIpB = await linkIdOf("company", fx.company.ipB, fx.files.ipA.fileId);
  log.add(`共享 file=${fx.files.ipA.fileId} -> IP-B ${assoc.status} 新 link=${fx.files.ipAssoc.linkIdOnIpB}`);

  /* 其他附件 */
  fx.files.archive1 = await attach("company", fx.archive.records[0], "P2档案-01附件.txt", TXT("最深目录档案附件"));
  fx.files.general1 = await attach("company", fx.company.general1, "P2综合资料附件.txt", TXT("综合资料附件"));
  fx.files.personalProject = await attach("personal", fx.personal.projectP, "P2个人项目附件.txt", TXT("个人项目附件"));
  fx.files.personalIp = await attach("personal", fx.personal.ipP, "P2个人IP附件.txt", TXT("个人IP附件"));

  /* 同内容不同名（E-10 复用/独立分支） */
  const same = TXT("P2 完全相同的内容，用于 SHA-256 判定");
  fx.groups.sameSha = {
    a: await attach("company", fx.company.projectB, "P2同内容-A.txt", same),
    b: await attach("company", fx.company.projectB, "P2同内容-B.txt", same),
  };
  fx.groups.sameSha.sameFileId = fx.groups.sameSha.a.fileId === fx.groups.sameSha.b.fileId;
  log.add(`同内容两次上传 fileId ${fx.groups.sameSha.a.fileId} vs ${fx.groups.sameSha.b.fileId} 同=${fx.groups.sameSha.sameFileId}`);

  /* 回收站素材（软删，不彻底删除） */
  fx.trash.contractC3 = { status: (await L.del(`/api/v2/folders/company/contract/${fx.company.contractC3}`)).status };
  fx.trash.archive2 = { status: (await L.del(`/api/v2/folders/company/archive/${fx.archive.records[1]}?section=achievement`)).status };
  log.add(`软删合同C3=${fx.trash.contractC3.status} 档案-02=${fx.trash.archive2.status}`);

  /* 回读校验 */
  const views = {};
  for (const p of ["archive/company", "projects/company", "ip/company", "general/company", "trash/company", "archive/personal", "projects/personal", "ip/personal", "general/personal"]) {
    const r = await L.get(`/api/v2/ui/${p}`);
    views[p] = { status: r.status, size: Array.isArray(r.data) ? r.data.length : (r.data ? Object.keys(r.data).length : 0) };
    log.add(`GET /api/v2/ui/${p} -> ${r.status} ${JSON.stringify(views[p])}`);
  }
  fx.viewCounts = views;

  fs.writeFileSync(path.join(EVID, "fixture.json"), JSON.stringify(fx, null, 2), "utf8");
  fs.writeFileSync(path.join(TMP, `vault-p2-${RUNID}.cred.json`), JSON.stringify({ db: DB, password: PASSWORD, runid: RUNID }, null, 2), "utf8");
  log.add("fixture.json 已写入");
  log.flush();
})().catch((e) => {
  log.add("FIXTURE FAILED: " + (e && e.stack || e));
  log.flush();
  process.exit(1);
});
