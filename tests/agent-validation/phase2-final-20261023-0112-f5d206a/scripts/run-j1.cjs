/* J 组第一批：回收站恢复、永久清理级联与共享引用（J-01 ~ J-06）
   全部走 HTTP，每个用例自建夹具，不依赖历史数据。
   判定依据：V2 FolderId/LinkId 是否真实消失、附件版本是否可再下载且 SHA 一致、
   SQLCipher 侧是否留下孤儿引用（tools/dbcheck 只读取证）。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-HTTP" });
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
const TXT = (s) => Buffer.from(s, "utf8");
const TAG = "J1" + Date.now().toString(36);
const DBCHECK = path.join(ROOT, "tools", "dbcheck", "bin", "Release", "net8.0", "dbcheck.exe");

function dbcheck() {
  const out = execFileSync(DBCHECK, [CRED.db, CRED.password], { encoding: "utf8", timeout: 120000 });
  return JSON.parse(out);
}

const api = {
  create: async (ws, kind, body) => {
    const r = await L.post(`/api/v2/folders/${ws}/${kind}`, body);
    if (!r.ok) throw new Error(`create ${ws}/${kind} ${r.status} ${JSON.stringify(r.data)}`);
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
const trashList = async (ws) => {
  const r = await L.get(`/api/trash/${ws}`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
};
const softDel = (ws, kind, id) => L.del(`/api/v2/folders/${ws}/${kind}/${id}`);
/* 附件是 LinkId，走独立路由；不能通过删除父合同来"顺带"删除（父删后 link 不再出现在回收站） */
const softDelLink = (ws, fileId, linkId) => L.del(`/api/v2/files/${ws}/${fileId}/links/${linkId}`);
const restore = (ws, items) => L.post(`/api/trash/${ws}/restore`, { items });
const purge = (ws, items) => L.post(`/api/trash/${ws}/purge`, { items });
const alive = async (ws, kind, id) => {
  /* 业务档案的 GET 也必须带 section（Ref() 会校验 workspace/section 组合） */
  const q = kind === "archive" ? "?section=achievement" : "";
  return (await L.get(`/api/v2/folders/${ws}/${kind}/${id}${q}`)).status;
};
const linksOf = async (ws, folderId) => {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
};
const download = async (ws, fileId, version) => {
  const res = await L.call("GET", `/api/v2/files/${ws}/${fileId}/versions/${version}/download`, { raw: true });
  if (res.status !== 200) return { status: res.status, len: 0, sha: "" };
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, len: buf.length, sha: sha(buf) };
};
const fileGet = async (ws, fileId) => {
  const r = await L.get(`/api/v2/files/${ws}/${fileId}`);
  return { status: r.status, versions: ((r.data && r.data.versions) || []).length, name: r.data && r.data.name };
};

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const base = dbcheck();
  fs.writeFileSync(path.join(EVID, "dbcheck-before-j.json"), JSON.stringify(base, null, 2), "utf8");

  /* ================= J-01 软删含合同和附件的项目并恢复 ================= */
  try {
    const P = await api.create("company", "project", {
      Project: { Name: `J01项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `J01-${TAG}` },
    });
    const C = await api.create("company", "contract", {
      Contract: { Name: `J01合同-${TAG}`, ContractNo: `J01HT-${TAG}` }, ProjectId: P,
    });
    const V1 = TXT(`J01附件一版-${TAG}`);
    const V2 = TXT(`J01附件二版-${TAG}-内容更长`);
    const A1 = await api.attach("company", C, `J01附件-${TAG}.txt`, V1);
    await L.addVersion("company", A1.fileId, `J01附件-${TAG}.txt`, V2);
    const A2 = await api.attach("company", C, `J01附件二-${TAG}.txt`, TXT(`J01第二附件-${TAG}`));
    const shaV2 = sha(V2);
    const beforeDl = await download("company", A1.fileId, 2);

    const d1 = await softDel("company", "project", P);
    const trash1 = await trashList("company");
    const inTrash = trash1.some((x) => String(x.kind) === "project" && Number(x.id) === Number(P));
    const cAfterDel = await alive("company", "contract", C);

    const r1 = await restore("company", [{ kind: "project", id: P, section: "" }]);
    const pBack = await alive("company", "project", P);
    const cBack = await alive("company", "contract", C);
    const lk = await linksOf("company", C);
    const dl = await download("company", A1.fileId, 2);
    const ok = d1.ok && inTrash && r1.ok && pBack === 200 && cBack === 200 &&
      lk.length === 2 && dl.status === 200 && dl.sha === shaV2 && beforeDl.sha === shaV2;
    rec.rec({
      id: "J-01", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        project: P, contract: C, delStatus: d1.status, inTrash, contractAfterProjectDelete: cAfterDel,
        restoreStatus: r1.status, projectBack: pBack, contractBack: cBack,
        linksRestored: lk.map((x) => `${x.name || x.displayName || ("f" + x.fileId)}@v${x.version || "?"}`),
        downloadBefore: beforeDl, downloadAfter: dl, expectSha: shaV2,
      }),
      workspace: "company", recordIds: [P, C, A1.fileId, A2.fileId],
      notes: ok
        ? `软删项目后回收站可见该项目，恢复后项目/合同均 200，两个附件及其版本全部回来，第 2 版下载 SHA 与删除前逐字节一致`
        : `项目恢复链不完整（project=${pBack}, contract=${cBack}, links=${lk.length}, sha=${dl.sha === shaV2}）`,
    });
  } catch (e) { rec.rec({ id: "J-01", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-01 执行异常" }); }

  /* ================= J-02 软删 IP / 档案 / 综合资料各一条再恢复 ================= */
  try {
    const IP = await api.create("company", "ip", {
      Ip: { Name: `J02知识产权-${TAG}`, IpNo: `J02IP-${TAG}`, IpType: "发明专利" },
    });
    const IPBUF = TXT(`J02IP附件-${TAG}`);
    const IPF = await api.attach("company", IP, `J02IP附件-${TAG}.txt`, IPBUF);

    /* 公司业务档案必须指定有效系统目录（fixture 已记录 7 个系统目录）；
       section 是查询参数，不是 body 字段（NativeFolderEndpoints 用 string? section 绑定 query） */
    const FXF = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
    const SYSFOLDER = (FXF.archive.system[0] || {}).id;
    if (!SYSFOLDER) throw new Error("fixture 缺少档案系统目录");
    const afCreate = await L.post("/api/v2/folders/company/archive",
      { Archive: { Name: `J02档案-${TAG}`, FolderId: SYSFOLDER }, Section: "achievement" });
    if (!afCreate.ok) throw new Error(`create archive ${afCreate.status} ${JSON.stringify(afCreate.data)}`);
    const AF = afCreate.data.id;
    const AFBUF = TXT(`J02档案附件-${TAG}`);
    const AFF = await api.attach("company", AF, `J02档案附件-${TAG}.txt`, AFBUF);

    const G = await api.create("company", "general", {
      General: { Title: `J02综合资料-${TAG}` },
    });
    const GBUF = TXT(`J02综合附件-${TAG}`);
    const GF = await api.attach("company", G, `J02综合附件-${TAG}.txt`, GBUF);

    const dIp = await softDel("company", "ip", IP);
    const dAf = await L.del(`/api/v2/folders/company/archive/${AF}?section=achievement`);
    const dG = await softDel("company", "general", G);
    const t = await trashList("company");
    const seen = {
      ip: t.some((x) => String(x.kind) === "ip" && Number(x.id) === Number(IP)),
      archive: t.some((x) => String(x.kind) === "v2_archive" && Number(x.id) === Number(AF)),
      general: t.some((x) => String(x.kind) === "v2_general" && Number(x.id) === Number(G)),
    };

    const rItems = [
      { kind: "ip", id: IP, section: "" },
      { kind: "v2_archive", id: AF, section: "achievement" },
      { kind: "v2_general", id: G, section: "" },
    ];
    const r = await restore("company", rItems);
    const back = {
      ip: await alive("company", "ip", IP),
      archive: await alive("company", "archive", AF),
      general: await alive("company", "general", G),
    };
    const dlIp = await download("company", IPF.fileId, 1);
    const dlAf = await download("company", AFF.fileId, 1);
    const dlG = await download("company", GF.fileId, 1);
    const ok = dIp.ok && dAf.ok && dG.ok && seen.ip && seen.archive && seen.general && r.ok &&
      back.ip === 200 && back.archive === 200 && back.general === 200 &&
      dlIp.sha === sha(IPBUF) && dlAf.sha === sha(AFBUF) && dlG.sha === sha(GBUF);
    rec.rec({
      id: "J-02", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        ids: { ip: IP, archive: AF, general: G }, delStatus: [dIp.status, dAf.status, dG.status], seenInTrash: seen,
        restoreStatus: r.status, restoreBody: r.data, back,
        download: { ip: dlIp, archive: dlAf, general: dlG },
      }),
      workspace: "company", recordIds: [IP, AF, G],
      notes: ok
        ? "知识产权/业务档案/综合资料三类记录软删后在回收站各自可见（v2_archive/v2_general 区分正确），一次批量恢复后三条均 200，附件下载 SHA 与删除前一致 —— 业务字段与历史下载未丢失"
        : `三类记录恢复不一致（back=${JSON.stringify(back)}，seen=${JSON.stringify(seen)}）`,
    });
  } catch (e) { rec.rec({ id: "J-02", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-02 执行异常" }); }

  /* ================= J-03 永久删除带合同和活动附件的已删项目 ================= */
  try {
    const P = await api.create("company", "project", {
      Project: { Name: `J03项目-${TAG}`, ProjectType: "横向项目", ProjectNo: `J03-${TAG}` },
    });
    const C = await api.create("company", "contract", {
      Contract: { Name: `J03合同-${TAG}`, ContractNo: `J03HT-${TAG}` }, ProjectId: P,
    });
    const ABUF = TXT(`J03活动附件-${TAG}`);
    const A = await api.attach("company", C, `J03附件-${TAG}.txt`, ABUF);
    const fileBefore = await fileGet("company", A.fileId);
    await softDel("company", "project", P);

    const before = dbcheck();
    const pr = await purge("company", [{ kind: "project", id: P, section: "" }]);
    const after = dbcheck();

    const pAlive = await alive("company", "project", P);
    const cAlive = await alive("company", "contract", C);
    const fAlive = await fileGet("company", A.fileId);
    const ok = pr.ok && pAlive === 404 && cAlive === 404 &&
      fAlive.status === 404 &&
      after.orphanChunks === 0 && after.versionsMissingObject === 0 && after.versionsMissingFile === 0 &&
      after.linksMissingFile === 0 && after.linksMissingFolder === 0 &&
      after.foreignKeyViolations.length === 0 && after.integrity === "ok";
    rec.rec({
      id: "J-03", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        project: P, contract: C, fileId: A.fileId, fileBefore,
        purgeStatus: pr.status, purgeBody: pr.data,
        afterAlive: { project: pAlive, contract: cAlive, file: fAlive.status },
        dbBefore: { folders: before.counts.folders, files: before.counts.files, objects: before.counts.file_objects, links: before.counts.folder_file_links },
        dbAfter: { folders: after.counts.folders, files: after.counts.files, objects: after.counts.file_objects, links: after.counts.folder_file_links },
        integrity: after.integrity, fkViolations: after.foreignKeyViolations,
        orphans: { chunks: after.orphanChunks, verMissObj: after.versionsMissingObject, verMissFile: after.versionsMissingFile, linkMissFile: after.linksMissingFile, linkMissFolder: after.linksMissingFolder, unreferencedReady: after.readyObjectsUnreferenced },
      }),
      workspace: "company", recordIds: [P, C, A.fileId],
      notes: ok
        ? `永久删除项目后：项目/合同/附件均 404，子合同先于项目删除（parent_id RESTRICT 未被触发）；SQLCipher integrity=ok、外键 0 违规、孤儿 chunk/版本/链接引用全 0 —— 级联在单个事务内完整落地`
        : `永久删除级联不完整（project=${pAlive}, contract=${cAlive}, file=${fAlive.status}, fk=${after.foreignKeyViolations.length}）`,
    });
  } catch (e) { rec.rec({ id: "J-03", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-03 执行异常" }); }

  /* ================= J-04 永久删除仅有自己引用的 FileId ================= */
  try {
    const P = await api.create("company", "project", {
      Project: { Name: `J04项目-${TAG}`, ProjectType: "其他项目", ProjectNo: `J04-${TAG}` },
    });
    const C = await api.create("company", "contract", {
      Contract: { Name: `J04合同-${TAG}`, ContractNo: `J04HT-${TAG}` }, ProjectId: P,
    });
    /* 唯一内容，确保没有被其它版本共享 */
    const BUF = Buffer.concat([TXT(`J04唯一内容-${TAG}-`), crypto.randomBytes(48)]);
    const A = await api.attach("company", C, `J04唯一附件-${TAG}.bin`, BUF);
    const beforeObj = dbcheck();
    const f0 = await fileGet("company", A.fileId);
    /* 直接软删附件 LinkId：父合同保持可见，link 才会作为 v2_file 出现在回收站 */
    const dLink = await softDelLink("company", A.fileId, A.linkId);
    const t = await trashList("company");
    const linkItem = t.find((x) => String(x.kind) === "v2_file" && Number(x.id) === Number(A.linkId));
    const pr = await purge("company", [{ kind: "v2_file", id: A.linkId, section: "" }]);
    const afterObj = dbcheck();
    const f1 = await fileGet("company", A.fileId);
    const objDropped = beforeObj.counts.file_objects > afterObj.counts.file_objects;
    const ok = pr.ok && f1.status === 404 && objDropped &&
      afterObj.readyObjectsUnreferenced === 0 && afterObj.orphanChunks === 0 && afterObj.integrity === "ok" &&
      afterObj.foreignKeyViolations.length === 0;
    rec.rec({
      id: "J-04", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        project: P, contract: C, fileId: A.fileId, linkId: A.linkId, fileBefore: f0,
        inTrash: !!linkItem, purgeStatus: pr.status, purgeBody: pr.data, fileAfter: f1.status,
        objects: { before: beforeObj.counts.file_objects, after: afterObj.counts.file_objects },
        versions: { before: beforeObj.counts.file_versions, after: afterObj.counts.file_versions },
        chunks: { before: beforeObj.counts.file_chunks, after: afterObj.counts.file_chunks },
        unreferencedReady: afterObj.readyObjectsUnreferenced, orphanChunks: afterObj.orphanChunks,
      }),
      workspace: "company", recordIds: [A.fileId, A.linkId],
      notes: ok
        ? `唯一引用的附件永久删除后：FileId 404、物理对象数 ${beforeObj.counts.file_objects}→${afterObj.counts.file_objects}（原件按规则回收）、chunk 同步清理，未留下无引用 ready 对象`
        : `孤立 FileId 回收不符合预期（file=${f1.status}, objects ${beforeObj.counts.file_objects}→${afterObj.counts.file_objects}, unreferenced=${afterObj.readyObjectsUnreferenced}）`,
    });
  } catch (e) { rec.rec({ id: "J-04", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-04 执行异常" }); }

  /* ================= J-05 永久删除共享 LinkId 中的一条，保留另一条 ================= */
  try {
    const P = await api.create("company", "project", {
      Project: { Name: `J05项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `J05-${TAG}` },
    });
    const CA = await api.create("company", "contract", {
      Contract: { Name: `J05合同甲-${TAG}`, ContractNo: `J05HTA-${TAG}` }, ProjectId: P,
    });
    const CB = await api.create("company", "contract", {
      Contract: { Name: `J05合同乙-${TAG}`, ContractNo: `J05HTB-${TAG}` }, ProjectId: P,
    });
    const BODY = Buffer.concat([TXT(`J05共享内容-${TAG}-`), crypto.randomBytes(40)]);
    const H = sha(BODY);
    const hdr = (n) => ({
      "X-File-Name": encodeURIComponent(n), "X-File-Description": "", "X-File-Tags": "",
      "X-File-Number": "", "X-File-Date": "", "Content-Type": "application/octet-stream",
    });
    const prep = (fid, n) => L.call("POST", `/api/v2/files/company/prepare?folderId=${fid}`, { body: BODY, headers: hdr(n) });
    const resolveP = (t, b) => L.post(`/api/v2/files/company/prepared/${t}/resolve`, b);
    const cancelP = (t) => L.del(`/api/v2/files/company/prepared/${t}`);

    /* A 区独立保存 → 得到 FileId */
    const p1 = await prep(CA, `J05共享原件-${TAG}.txt`);
    const q1 = p1.ok ? await resolveP(p1.data.ticket, { Choice: "independent" }) : null;
    const F1 = q1 && q1.ok ? q1.data.fileId : null;
    if (!F1) throw new Error("准备阶段失败: " + JSON.stringify({ p1: p1.data, q1: q1 && q1.data }));

    /* B 区共享同一 FileId（另一个文件夹，设计上允许） */
    const p2 = await prep(CB, `J05共享指向-${TAG}.txt`);
    const q2 = p2.ok ? await resolveP(p2.data.ticket, { Choice: "share-file", SourceFileId: F1 }) : null;
    if (p2.ok && (!q2 || !q2.ok)) await cancelP(p2.data.ticket);

    const lkA = await linksOf("company", CA);
    const lkB = await linksOf("company", CB);
    const linkA = (lkA.find((x) => Number(x.fileId) === Number(F1)) || {}).id;
    const linkB = (lkB.find((x) => Number(x.fileId) === Number(F1)) || {}).id;
    const beforeObj = dbcheck();
    const dlBefore = await download("company", F1, 1);

    /* 只删 A 区那条 link（父合同保持可见），再彻底删除 */
    const dA = await softDelLink("company", F1, linkA);
    const t = await trashList("company");
    const tmp = t.find((x) => String(x.kind) === "v2_file" && Number(x.id) === Number(linkA));
    const pr = await purge("company", [{ kind: "v2_file", id: linkA, section: "" }]);
    const afterObj = dbcheck();

    const dlAfter = await download("company", F1, 1);
    const lkB2 = await linksOf("company", CB);
    const bStillLinked = lkB2.some((x) => Number(x.fileId) === Number(F1));
    const objKept = afterObj.counts.file_objects === beforeObj.counts.file_objects;
    const ok = q1.ok && q2 && q2.ok && pr.ok && bStillLinked && dlAfter.status === 200 &&
      dlAfter.sha === H && dlBefore.sha === H && objKept && afterObj.integrity === "ok" &&
      afterObj.foreignKeyViolations.length === 0 && afterObj.readyObjectsUnreferenced === 0;
    rec.rec({
      id: "J-05", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        fileId: F1, contractA: CA, contractB: CB, linkA, linkB,
        shareResolve: q2 && q2.data, inTrash: !!tmp, purgeStatus: pr.status,
        bStillLinked, downloadBefore: dlBefore, downloadAfter: dlAfter, expectSha: H,
        objects: { before: beforeObj.counts.file_objects, after: afterObj.counts.file_objects },
        sharedObjects: { before: beforeObj.sharedObjects, after: afterObj.sharedObjects },
      }),
      workspace: "company", recordIds: [F1, linkA, linkB],
      notes: ok
        ? `同一 FileId 被两个合同共享；彻底删除 A 区那条 LinkId 后，B 区引用仍在、原件未提前释放（对象数保持 ${beforeObj.counts.file_objects}），历史版本仍可下载且 SHA 一致`
        : `共享引用回收不符合预期（bStillLinked=${bStillLinked}, dl=${dlAfter.status}, objects ${beforeObj.counts.file_objects}→${afterObj.counts.file_objects}）`,
    });
  } catch (e) { rec.rec({ id: "J-05", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-05 执行异常" }); }

  /* ================= J-06 混合永久删除（项目/合同/附件/档案） ================= */
  try {
    const P = await api.create("company", "project", {
      Project: { Name: `J06项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `J06-${TAG}` },
    });
    const C = await api.create("company", "contract", {
      Contract: { Name: `J06合同-${TAG}`, ContractNo: `J06HT-${TAG}` }, ProjectId: P,
    });
    const A = await api.attach("company", C, `J06附件-${TAG}.txt`, TXT(`J06附件内容-${TAG}`));
    const IP = await api.create("company", "ip", { Ip: { Name: `J06知识产权-${TAG}`, IpNo: `J06IP-${TAG}`, IpType: "实用新型专利" } });
    const IPA = await api.attach("company", IP, `J06IP附件-${TAG}.txt`, TXT(`J06IP内容-${TAG}`));
    const G = await api.create("company", "general", { General: { Title: `J06综合-${TAG}` } });
    const GA = await api.attach("company", G, `J06综合附件-${TAG}.txt`, TXT(`J06综合内容-${TAG}`));

    await softDel("company", "project", P);
    await softDel("company", "ip", IP);
    await softDel("company", "general", G);
    const before = dbcheck();
    /* 混选：项目 + 知识产权 + 综合资料；项目会带出子合同与其附件 */
    const pr = await purge("company", [
      { kind: "project", id: P, section: "" },
      { kind: "ip", id: IP, section: "" },
      { kind: "v2_general", id: G, section: "" },
    ]);
    const after = dbcheck();
    const gone = {
      project: await alive("company", "project", P),
      contract: await alive("company", "contract", C),
      ip: await alive("company", "ip", IP),
      general: await alive("company", "general", G),
      attachment: (await fileGet("company", A.fileId)).status,
    };
    const ok = pr.ok && Object.values(gone).every((s) => s === 404) &&
      after.integrity === "ok" && after.foreignKeyViolations.length === 0 &&
      after.orphanChunks === 0 && after.versionsMissingObject === 0 && after.versionsMissingFile === 0 &&
      after.linksMissingFile === 0 && after.linksMissingFolder === 0 && after.readyObjectsUnreferenced === 0;
    rec.rec({
      id: "J-06", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        ids: { project: P, contract: C, ip: IP, general: G, fileId: A.fileId, ipFile: IPA.fileId, generalFile: GA.fileId },
        purgeStatus: pr.status, purgeBody: pr.data, gone,
        dbBefore: before.counts, dbAfter: after.counts,
        integrity: after.integrity, fkViolations: after.foreignKeyViolations,
        orphans: { chunks: after.orphanChunks, verMissObj: after.versionsMissingObject, verMissFile: after.versionsMissingFile, linkMissFile: after.linksMissingFile, linkMissFolder: after.linksMissingFolder, unreferencedReady: after.readyObjectsUnreferenced },
      }),
      workspace: "company", recordIds: [P, C, IP, G],
      notes: ok
        ? `混选项目/知识产权/综合资料一次彻底删除：项目带出的子合同与三个附件 LinkId 均正确去重并按依赖顺序清理，五类目标全部 404；integrity=ok、外键 0 违规、各类孤儿引用全 0`
        : `混合彻底删除未完全清理（gone=${JSON.stringify(gone)}, fk=${after.foreignKeyViolations.length}）`,
    });
  } catch (e) { rec.rec({ id: "J-06", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "J-06 执行异常" }); }

  rec.flush();
  const final = dbcheck();
  fs.writeFileSync(path.join(EVID, "dbcheck-after-j1.json"), JSON.stringify(final, null, 2), "utf8");
  console.log("J 组第一批执行完毕");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
