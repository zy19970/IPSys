/* F 组：业务整记录复制与跨区转移（F-01 ~ F-12）
   契约来源：
     POST /api/v2/projects/{ws}/{id}/transfer   {TargetWorkspace, Move}
     POST /api/v2/contracts/{ws}/{id}/transfer  {TargetWorkspace, TargetProjectId, Move}
     POST /api/v2/ip/{ws}/{id}/transfer         {TargetWorkspace, Move}
     POST /api/v2/ui/general/{ws}/{id}/transfer {TargetWorkspace, Move}
     POST /api/v2/ui/archive/{ws}/{section}/{id}/transfer {TargetWorkspace, TargetSection, Move}
   同区合同移动 = 纯改 parent（FolderId / LinkId 不变，Versions=0、NewObjects=0）；
   跨区 = 复制 FileId/版本链 + 独立物理对象，Move 时在同一事务里软删来源。
*/
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const FX = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-HTTP" });
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
const TXT = (s) => Buffer.from(s, "utf8");
const PA = FX.company.projectA;   // 12
const PB = FX.company.projectB;   // 13
const PP = FX.personal.projectP;  // 21
const TAG = "F" + Date.now().toString(36);

/* ---------- 基础访问 ---------- */
const folderGet = (ws, kind, id, section) =>
  L.get(`/api/v2/folders/${ws}/${kind}/${id}${section ? `?section=${section}` : ""}`);
const linksOf = async (ws, folderId) => {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  const arr = Array.isArray(r.data) ? r.data : (r.data.items || []);
  return arr;
};
const linkIdOf = async (ws, folderId, fileId) => {
  const hit = (await linksOf(ws, folderId)).filter((x) => Number(x.fileId) === Number(fileId)).pop();
  return hit ? (hit.id ?? hit.linkId) : null;
};
async function create(ws, kind, body) {
  const r = await L.post(`/api/v2/folders/${ws}/${kind}`, body);
  if (!r.ok) throw new Error(`create ${ws}/${kind} ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.id ?? (r.data.reference && r.data.reference.id);
}
async function attach(ws, folderId, name, buf) {
  const up = ws === "company" ? await L.upload(folderId, name, buf) : await L.uploadIn(ws, folderId, name, buf);
  return Object.assign(up, { linkId: await linkIdOf(ws, folderId, up.fileId), name, size: buf.length, sha256: sha(buf) });
}
async function shas(ws, fileId) {
  const d = (await L.get(`/api/v2/files/${ws}/${fileId}`)).data;
  return (d.versions || []).map((v) => String(v.sha256).toUpperCase()).sort();
}
async function contractIds(ws, projectId) {
  const r = await L.get(`/api/v2/folders/${ws}/contract?projectId=${projectId}`);
  return Array.isArray(r.data) ? r.data.map((x) => x.folder.ref.id) : [];
}
async function findByName(ws, kind, name, q = "") {
  const r = await L.get(`/api/v2/folders/${ws}/${kind}${q}`);
  const arr = Array.isArray(r.data) ? r.data : (r.data.items || []);
  return arr.filter((x) => x.folder && x.folder.name === name && !x.folder.deleted)
    .map((x) => x.folder.ref.id).pop();
}
async function archiveList(ws, section) {
  const r = await L.get(`/api/v2/folders/${ws}/archive?section=${section}`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
}
/* 软删后 GET 会 404，统一用回收站条目判断「是否已进回收站、是否保留父级」 */
async function trashOf(ws, kind, id) {
  const r = await L.get(`/api/trash/${ws}`);
  const arr = Array.isArray(r.data) ? r.data : (r.data.items || []);
  return arr.find((x) => String(x.kind) === kind && Number(x.id) === Number(id)) || null;
}

/* ---------- 一个项目的完整快照（本项目自身附件 + 每个合同附件） ---------- */
async function projectSnapshot(ws, pid) {
  const p = await folderGet(ws, "project", pid);
  const own = (await linksOf(ws, pid)).map((x) => Number(x.fileId));
  const cs = [];
  for (const cid of await contractIds(ws, pid)) {
    cs.push({ id: cid, files: (await linksOf(ws, cid)).map((x) => Number(x.fileId)) });
  }
  return {
    name: p.data && p.data.folder.name,
    deleted: p.data && p.data.folder.deleted,
    parent: p.data && p.data.folder.parent && p.data.folder.parent.id,
    own, contracts: cs,
    allFiles: [...own, ...cs.flatMap((c) => c.files)],
  };
}

/* ---------- 慢速 prepare：用于占住 file task，制造确定性 409 ---------- */
function slowPrepare(folderId, totalBytes, chunkDelayMs, onReady) {
  return new Promise((resolve) => {
    const headers = {
      "X-File-Name": encodeURIComponent(`P2F12-占位-${TAG}.bin`),
      "X-File-Description": "", "X-File-Tags": "", "X-File-Number": "", "X-File-Date": "",
      "Content-Type": "application/octet-stream",
      "X-IPSys-Token": L.token(),
      "Content-Length": String(totalBytes),
    };
    const req = http.request({ host: "127.0.0.1", port: Number(L.BASE.split(":")[2]), path: `/api/v2/files/company/prepare?folderId=${folderId}`, method: "POST", headers }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", (e) => resolve({ error: e.message }));
    let sent = 0;
    const tick = () => {
      if (sent >= totalBytes) { req.end(); return; }
      const n = Math.min(256 * 1024, totalBytes - sent);
      req.write(Buffer.alloc(n, 0x42));
      sent += n;
      if (onReady && sent === 512 * 1024) onReady();
      setTimeout(tick, chunkDelayMs);
    };
    tick();
  });
}

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  /* ============ F-01 公司项目（含 2 合同 + 附件）复制到个人 ============ */
  try {
    const pj = await create("company", "project", { Project: { Name: `P2F1-项目甲-${TAG}`, ProjectType: "科研项目", ProjectNo: `F1-${TAG}` } });
    const c1 = await create("company", "contract", { Contract: { Name: `P2F1-合同甲1-${TAG}`, ContractNo: `F1-1-${TAG}` }, ProjectId: pj });
    const c2 = await create("company", "contract", { Contract: { Name: `P2F1-合同甲2-${TAG}`, ContractNo: `F1-2-${TAG}` }, ProjectId: pj });
    const f0 = await attach("company", pj, `P2F1-项目附件-${TAG}.txt`, TXT("F1 项目自身附件"));
    const f1 = await attach("company", c1, `P2F1-合同1附件-${TAG}.txt`, TXT("F1 合同1附件"));
    const f2 = await attach("company", c2, `P2F1-合同2附件-${TAG}.txt`, TXT("F1 合同2附件"));
    const before = await projectSnapshot("company", pj);
    const r = await L.post(`/api/v2/projects/company/${pj}/transfer`, { TargetWorkspace: "personal", Move: false });
    const tgt = r.ok ? await findByName("personal", "project", `P2F1-项目甲-${TAG}`) : null;
    const after = tgt ? await projectSnapshot("personal", tgt) : null;
    const srcAfter = await projectSnapshot("company", pj);
    const srcSha = {}; for (const f of [f0.fileId, f1.fileId, f2.fileId]) srcSha[f] = await shas("company", f);
    let shaOk = !!after && after.allFiles.length === 3;
    if (shaOk) {
      const list = [...after.own, ...after.contracts.flatMap((c) => c.files)];
      for (const nf of list) {
        const s = await shas("personal", nf);
        const matched = Object.values(srcSha).some((x) => x.join("|") === s.join("|"));
        if (!matched) { shaOk = false; break; }
      }
    }
    const ok = r.ok && tgt && after &&
      after.contracts.length === 2 && after.own.length === 1 &&
      after.allFiles.every((x) => !before.allFiles.includes(x)) &&
      after.allFiles.length === before.allFiles.length &&
      srcAfter.contracts.length === 2 && !srcAfter.deleted && shaOk;
    rec.rec({
      id: "F-01", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ transfer: { status: r.status, data: r.data }, sourceProject: pj, targetProject: tgt, before, after, sourceRetained: { deleted: srcAfter.deleted, contracts: srcAfter.contracts.length, files: srcAfter.allFiles.length }, shaOk }),
      workspace: "company", recordIds: [pj, tgt].filter(Boolean),
      notes: ok ? "项目/合同/附件整树复制成功：目标 2 合同 + 3 文件全部为新 FileId、SHA 一致；来源项目与附件原位保留" : "整树复制后目标结构或来源保留不符合预期",
    });
  } catch (e) {
    rec.rec({ id: "F-01", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-01 执行异常，见 actual" });
  }

  /* ============ F-02 公司项目整体转移（Move） ============ */
  try {
    const pj = await create("company", "project", { Project: { Name: `P2F2-项目乙-${TAG}`, ProjectType: "横向项目", ProjectNo: `F2-${TAG}` } });
    const c1 = await create("company", "contract", { Contract: { Name: `P2F2-合同乙1-${TAG}`, ContractNo: `F2-1-${TAG}` }, ProjectId: pj });
    await attach("company", c1, `P2F2-附件-${TAG}.txt`, TXT("F2 合同附件"));
    const before = await projectSnapshot("company", pj);
    const r = await L.post(`/api/v2/projects/company/${pj}/transfer`, { TargetWorkspace: "personal", Move: true });
    const tgt = r.ok ? await findByName("personal", "project", `P2F2-项目乙-${TAG}`) : null;
    const after = tgt ? await projectSnapshot("personal", tgt) : null;
    const srcGet = await folderGet("company", "project", pj);
    const srcTrash = await trashOf("company", "project", pj);
    const ok = r.ok && r.data.moved === true && tgt && after &&
      after.contracts.length === 1 && afterallFiles(after) === 1 &&
      srcGet.status === 404 && !!srcTrash;
    rec.rec({
      id: "F-02", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ transfer: { status: r.status, data: r.data }, before, target: tgt, after, sourceGet: srcGet.status, sourceInTrash: !!srcTrash, sourceTrashEntry: srcTrash }),
      workspace: "company", recordIds: [pj, tgt].filter(Boolean),
      notes: ok ? "Move 语义成立：目标项目/合同/附件完整后，来源项目才在同一事务内置 deleted=1 并出现在公司回收站" : "转移后来源未软删、未进回收站或目标不完整",
    });
  } catch (e) {
    rec.rec({ id: "F-02", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-02 执行异常" });
  }

  /* ============ F-03 合同同区移动到另一个项目 ============ */
  try {
    const c = await create("company", "contract", { Contract: { Name: `P2F3-合同-${TAG}`, ContractNo: `F3-${TAG}` }, ProjectId: PA });
    const f = await attach("company", c, `P2F3-附件-${TAG}.txt`, TXT("F3 附件"));
    const linkBefore = (await linksOf("company", c)).map((x) => Number(x.id ?? x.linkId)).sort();
    const r = await L.post(`/api/v2/contracts/company/${c}/transfer`, { TargetWorkspace: "company", TargetProjectId: PB, Move: true });
    const g = await folderGet("company", "contract", c);
    const linkAfter = (await linksOf("company", c)).map((x) => Number(x.id ?? x.linkId)).sort();
    const parentNow = g.data && g.data.folder.parent && g.data.folder.parent.id;
    const ok = r.ok && r.data.id === c && Number(parentNow) === Number(PB) &&
      linkBefore.join(",") === linkAfter.join(",") &&
      r.data.versions === 0 && r.data.newObjects === 0 && r.data.moved === true &&
      Number(f.fileId) === Number((await linksOf("company", c))[0].fileId);
    rec.rec({
      id: "F-03", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ transfer: { status: r.status, data: r.data }, contractId: c, parentBefore: PA, parentAfter: parentNow, linkBefore, linkAfter }),
      workspace: "company", recordIds: [c],
      notes: ok ? "同区移动是纯改父：合同 FolderId 与 LinkId 均不变，parent 由项目A改为项目B，且不产生新版本/新对象" : "同区移动改动了 FolderId/LinkId 或未更新所属项目",
    });
  } catch (e) {
    rec.rec({ id: "F-03", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-03 执行异常" });
  }

  /* ============ F-04 合同同区复制到另一个项目 ============ */
  try {
    const c = await create("company", "contract", { Contract: { Name: `P2F4-合同-${TAG}`, ContractNo: `F4-${TAG}` }, ProjectId: PA });
    const f = await attach("company", c, `P2F4-附件-${TAG}.txt`, TXT("F4 附件"));
    const r = await L.post(`/api/v2/contracts/company/${c}/transfer`, { TargetWorkspace: "company", TargetProjectId: PB, Move: false });
    const newId = r.ok ? r.data.id : null;
    const g = newId ? await folderGet("company", "contract", newId) : null;
    const src = await folderGet("company", "contract", c);
    const newLinks = newId ? await linksOf("company", newId) : [];
    const srcLinks = await linksOf("company", c);
    const ok = r.ok && newId !== c && g && Number(g.data.folder.parent.id) === Number(PB) &&
      newLinks.length === 1 && srcLinks.length === 1 &&
      Number(newLinks[0].fileId) !== Number(srcLinks[0].fileId) &&
      !src.data.folder.deleted && r.data.newObjects === 0 &&
      (await shas("company", newLinks[0].fileId)).join("|") === (await shas("company", srcLinks[0].fileId)).join("|");
    rec.rec({
      id: "F-04", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ transfer: { status: r.status, data: r.data }, sourceContract: c, newContract: newId, newParent: g && g.data.folder.parent.id, newFile: newLinks[0] && newLinks[0].fileId, sourceFile: srcLinks[0] && srcLinks[0].fileId }),
      workspace: "company", recordIds: [c, newId].filter(Boolean),
      notes: ok ? "同区复制生成新合同与新 FileId（同区走 reuse-content，物理对象复用 newObjects=0），原合同与原件完整保留" : "复制合同后父子关系/FileId 独立性不符合预期",
    });
  } catch (e) {
    rec.rec({ id: "F-04", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-04 执行异常" });
  }

  /* ============ F-05 跨区复制两个历史版本 ============ */
  try {
    const c = await create("company", "contract", { Contract: { Name: `P2F5-合同-${TAG}`, ContractNo: `F5-${TAG}` }, ProjectId: PA });
    const up = await attach("company", c, `P2F5-两版本文档-${TAG}.txt`, TXT("F5 版本一"));
    await L.addVersion("company", up.fileId, `P2F5-两版本文档-${TAG}.txt`, TXT("F5 版本二，内容更长一些"));
    const srcShas = await shas("company", up.fileId);
    const r = await L.post(`/api/v2/contracts/company/${c}/transfer`, { TargetWorkspace: "personal", TargetProjectId: PP, Move: false });
    const newId = r.ok ? r.data.id : null;
    const newLinks = newId ? await linksOf("personal", newId) : [];
    const newFile = newLinks.length ? Number(newLinks[0].fileId) : null;
    const newShas = newFile ? await shas("personal", newFile) : [];
    const ok = r.ok && newId !== c && newFile && newFile !== Number(up.fileId) &&
      srcShas.length === 2 && newShas.join("|") === srcShas.join("|") &&
      r.data.versions === 2 && r.data.newObjects === 2;
    rec.rec({
      id: "F-05", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ transfer: { status: r.status, data: r.data }, sourceContract: c, newContract: newId, sourceFile: up.fileId, newFile, srcShas, newShas }),
      workspace: "company", recordIds: [c, newId].filter(Boolean),
      notes: ok ? "跨区复制两个历史版本：目标为新 FileId、versions=2、newObjects=2（物理对象独立），两个版本 SHA 与来源逐条一致" : "跨区复制后的版本链或对象独立性不符",
    });
  } catch (e) {
    rec.rec({ id: "F-05", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-05 执行异常" });
  }

  /* ============ F-06 合同跨区移动 ============ */
  try {
    const c = await create("company", "contract", { Contract: { Name: `P2F6-合同-${TAG}`, ContractNo: `F6-${TAG}` }, ProjectId: PB });
    await attach("company", c, `P2F6-附件-${TAG}.txt`, TXT("F6 附件"));
    const r = await L.post(`/api/v2/contracts/company/${c}/transfer`, { TargetWorkspace: "personal", TargetProjectId: PP, Move: true });
    const srcTrash = await trashOf("company", "contract", c);
    const newId = r.ok ? r.data.id : null;
    const newLinks = newId ? await linksOf("personal", newId) : [];
    const parentIntact = !!srcTrash && !!srcTrash.parent;
    const ok = r.ok && r.data.moved === true && newId && newLinks.length === 1 &&
      !!srcTrash && parentIntact;
    rec.rec({
      id: "F-06", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ transfer: { status: r.status, data: r.data }, sourceTrashEntry: srcTrash, newContract: newId, newLinks: newLinks.length }),
      workspace: "company", recordIds: [c, newId].filter(Boolean),
      notes: ok ? "跨区 Move：目标合同与附件完整后来源合同软删；回收站条目仍带原所属项目名，说明未成为孤儿" : "跨区 Move 后来源状态或目标结构不符",
    });
  } catch (e) {
    rec.rec({ id: "F-06", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-06 执行异常" });
  }

  /* ============ F-07 目标项目不存在 / 已删除 / 工作区不匹配 ============ */
  try {
    const c = await create("company", "contract", { Contract: { Name: `P2F7-合同-${TAG}`, ContractNo: `F7-${TAG}` }, ProjectId: PA });
    const f = await attach("company", c, `P2F7-附件-${TAG}.txt`, TXT("F7 附件"));
    const before = { links: (await linksOf("company", c)).length, parent: (await folderGet("company", "contract", c)).data.folder.parent.id };
    const missing = await L.post(`/api/v2/contracts/company/${c}/transfer`, { TargetWorkspace: "personal", TargetProjectId: 999999, Move: false });
    const mismatch = await L.post(`/api/v2/contracts/company/${c}/transfer`, { TargetWorkspace: "company", TargetProjectId: PP, Move: false });
    const after = { links: (await linksOf("company", c)).length, parent: (await folderGet("company", "contract", c)).data.folder.parent.id, deleted: (await folderGet("company", "contract", c)).data.folder.deleted };
    const ok = missing.status === 404 && mismatch.status === 404 &&
      before.links === after.links && before.parent === after.parent && after.deleted === false;
    rec.rec({
      id: "F-07", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ missing: { status: missing.status, data: missing.data }, crossWorkspaceMismatch: { status: mismatch.status, data: mismatch.data }, before, after }),
      workspace: "company", recordIds: [c],
      notes: ok ? "目标项目不存在与工作区不匹配均 404，来源合同与附件链接完全不变（事务未开或已回滚）" : "非法目标未拒绝或来源被改动",
    });
  } catch (e) {
    rec.rec({ id: "F-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-07 执行异常" });
  }

  /* ============ F-08 知识产权跨区复制 / 移动 + 附件历史 ============ */
  try {
    const ipA = FX.company.ipA;
    const srcFiles = await linksOf("company", ipA);
    const srcDetail = (await L.get(`/api/v2/folders/company/ip/${ipA}`)).data;
    const srcShaMap = {};
    for (const l of srcFiles) srcShaMap[l.fileId] = await shas("company", l.fileId);
    const cp = await L.post(`/api/v2/ip/company/${ipA}/transfer`, { TargetWorkspace: "personal", Move: false });
    const newIp = cp.ok ? cp.data.id : null;
    const newDetail = newIp ? (await L.get(`/api/v2/folders/personal/ip/${newIp}`)).data : null;
    const newFiles = newIp ? await linksOf("personal", newIp) : [];
    let shaOk = newFiles.length === srcFiles.length;
    for (const l of newFiles) {
      const s = await shas("personal", l.fileId);
      if (!Object.values(srcShaMap).some((x) => x.join("|") === s.join("|"))) { shaOk = false; break; }
    }
    const fieldOk = newDetail && newDetail.businessData.name === srcDetail.businessData.name &&
      newDetail.businessData.ipType === srcDetail.businessData.ipType &&
      newDetail.businessData.applicationNo === srcDetail.businessData.applicationNo;
    const srcStill = (await L.get(`/api/v2/folders/company/ip/${ipA}`)).data;

    const mvIp = await create("company", "ip", { Ip: { Name: `P2F8-待转移IP-${TAG}`, IpType: "实用新型专利", Status: "已申请", ApplicationNo: `F8-${TAG}` } });
    await attach("company", mvIp, `P2F8-附件-${TAG}.txt`, TXT("F8 移动附件"));
    const mv = await L.post(`/api/v2/ip/company/${mvIp}/transfer`, { TargetWorkspace: "personal", Move: true });
    const mvNew = mv.ok ? mv.data.id : null;
    const mvTrash = await trashOf("company", "ip", mvIp);
    const mvNewLinks = mvNew ? await linksOf("personal", mvNew) : [];
    const ok = cp.ok && newIp && fieldOk && shaOk && srcStill && !srcStill.folder.deleted &&
      mv.ok && mv.data.moved === true && !!mvTrash && mvNewLinks.length === 1 &&
      Number(cp.data.newObjects) >= 1;
    rec.rec({
      id: "F-08", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ copy: { status: cp.status, data: cp.data }, newIp, fieldOk, shaOk, srcFiles: srcFiles.length, newFiles: newFiles.length, move: { source: mvIp, status: mv.status, data: mv.data, newIp: mvNew, sourceTrash: mvTrash, newLinks: mvNewLinks.length } }),
      workspace: "company", recordIds: [ipA, newIp, mvIp, mvNew].filter(Boolean),
      notes: ok ? "知识产权跨区复制：业务字段、附件版本与 SHA 一致且对象独立；跨区移动：目标完整、来源软删" : "知识产权跨区复制/移动后字段、版本或来源状态不符",
    });
  } catch (e) {
    rec.rec({ id: "F-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-08 执行异常" });
  }

  /* ============ F-09 综合资料复制与跨区转移 ============ */
  try {
    /* 注意：fixture 里的 general1/general2 已被前次执行消耗（M-04 的现场证据），这里改用自建记录 */
    const g1 = await create("company", "general", { General: { Title: `P2F9-综合甲-${TAG}` } });
    await attach("company", g1, `P2F9-甲附件-${TAG}.txt`, TXT("F9 综合甲附件"));
    const src = (await L.get(`/api/v2/folders/company/general/${g1}`)).data;
    const srcLinks = await linksOf("company", g1);
    const cp = await L.post(`/api/v2/ui/general/company/${g1}/transfer`, { TargetWorkspace: "personal", Move: false });
    const newId = cp.ok ? (cp.data.id ?? cp.data.Id) : null;
    const det = newId ? (await L.get(`/api/v2/folders/personal/general/${newId}`)).data : null;
    const nl = newId ? await linksOf("personal", newId) : [];
    const shaOk = nl.length === srcLinks.length &&
      (await shas("personal", nl[0].fileId)).join("|") === (await shas("company", srcLinks[0].fileId)).join("|");
    const keepSrc = (await L.get(`/api/v2/folders/company/general/${g1}`)).data;

    const g2 = await create("company", "general", { General: { Title: `P2F9-综合乙-${TAG}` } });
    await attach("company", g2, `P2F9-乙附件-${TAG}.txt`, TXT("F9 综合乙附件"));
    const mv = await L.post(`/api/v2/ui/general/company/${g2}/transfer`, { TargetWorkspace: "personal", Move: true });
    const mvNew = mv.ok ? (mv.data.id ?? mv.data.Id) : null;
    const mvTrash = await trashOf("company", "v2_general", g2);
    const ok = cp.ok && newId && det && det.businessData.title === src.businessData.title && shaOk &&
      keepSrc && !keepSrc.folder.deleted && mv.ok && mvNew && !!mvTrash;
    rec.rec({
      id: "F-09", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ copy: { status: cp.status, data: cp.data, newId, title: det && det.businessData.title, srcTitle: src.businessData.title, links: nl.length, shaOk }, move: { source: g2, status: mv.status, data: mv.data, newId: mvNew, sourceTrash: mvTrash } }),
      workspace: "company", recordIds: [g1, newId, g2, mvNew].filter(Boolean),
      notes: ok ? "综合资料复制：标题/附件/SHA 一致且来源保留；跨区移动：目标生成、来源软删" : "综合资料复制或移动语义不符",
    });
  } catch (e) {
    rec.rec({ id: "F-09", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-09 执行异常" });
  }

  /* ============ F-10 兼容的成果档案：company/achievement -> personal/achievement ============ */
  try {
    const mk = await L.post("/api/v2/folders/company/archive", { Archive: { Name: `P2F10-成果-${TAG}`, Category: "其他", Year: "2026", FolderId: FX.archive.system[0].id }, Section: "achievement" });
    const id = mk.ok ? mk.data.id : null;
    const f = id ? await attach("company", id, `P2F10-附件-${TAG}.txt`, TXT("F10 成果附件")) : null;
    const r = id ? await L.post(`/api/v2/ui/archive/company/achievement/${id}/transfer`, { TargetWorkspace: "personal", TargetSection: "achievement", Move: false }) : { status: 0 };
    const newId = r.ok ? (r.data.id ?? r.data.Id) : null;
    const det = newId ? (await L.get(`/api/v2/folders/personal/archive/${newId}?section=achievement`)).data : null;
    const nl = newId ? await linksOf("personal", newId) : [];
    const listP = await archiveList("personal", "achievement");
    const inList = newId ? listP.some((x) => Number(x.folder.ref.id) === Number(newId)) : false;
    const parentOk = det ? (det.folder.parent === null || det.folder.parent === undefined) : false;
    const ok = mk.ok && r.ok && newId && newId !== id && nl.length === 1 &&
      inList && parentOk && det && det.businessData.name === `P2F10-成果-${TAG}` &&
      (await shas("personal", nl[0].fileId)).join("|") === (await shas("company", f.fileId)).join("|");
    rec.rec({
      id: "F-10", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ create: { status: mk.status, id }, transfer: { status: r.status, data: r.data }, newId, newParent: det && det.folder.parent, inSectionList: inList, links: nl.length, section: "achievement" }),
      workspace: "company", recordIds: [id, newId].filter(Boolean),
      notes: ok ? "company/achievement → personal/achievement 兼容转移成功：新记录落在目标类别根下（parent=null）、附件随迁、业务名称一致，无跨工作区无效 FolderId" : "成果档案跨工作区转移后的类别归属或附件不符",
    });
  } catch (e) {
    rec.rec({ id: "F-10", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-10 执行异常" });
  }

  /* ============ F-11 非兼容档案类别（资质证书）跨区 ============ */
  try {
    const mk = await L.post("/api/v2/folders/company/archive", { Archive: { Name: `P2F11-资质-${TAG}`, Category: "其他", Year: "2026" }, Section: "certificate" });
    const id = mk.ok ? mk.data.id : null;
    const r = id ? await L.post(`/api/v2/ui/archive/company/certificate/${id}/transfer`, { TargetWorkspace: "personal", TargetSection: "certificate", Move: true }) : { status: 0 };
    const still = id ? await folderGet("company", "archive", id, "certificate") : null;
    const ok = mk.ok && r.status === 400 && still && still.data && still.data.folder.deleted === false;
    rec.rec({
      id: "F-11", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ create: { status: mk.status, id, data: mk.data }, transfer: { status: r.status, data: r.data }, sourceIntact: still && still.data && still.data.folder.deleted === false }),
      workspace: "company", recordIds: id ? [id] : [],
      notes: ok ? "资质证书跨工作区被服务端以 400 明确拒绝（Module 不兼容），来源记录保持可用，边界无法绕过" : "不兼容类别未被拒绝或来源被改动",
    });
  } catch (e) {
    rec.rec({ id: "F-11", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-11 执行异常" });
  }

  /* ============ F-12 并发 409 与中途取消：不得留下部分目标 ============ */
  try {
    const pj = await create("company", "project", { Project: { Name: `P2F12-项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `F12-${TAG}` } });
    const c = await create("company", "contract", { Contract: { Name: `P2F12-合同-${TAG}`, ContractNo: `F12-${TAG}` }, ProjectId: pj });
    await attach("company", c, `P2F12-附件-${TAG}.txt`, TXT("F12 附件"));
    const beforeCount = (await L.get("/api/v2/folders/personal/project")).data.length;

    /* (a) 慢速 prepare 占住 file task，同时发起转移 -> 必须 409，且不产生任何目标 */
    let transferDuring = null;
    const slow = slowPrepare(PA, 6 * 1024 * 1024, 40, async () => {
      transferDuring = await L.post(`/api/v2/projects/company/${pj}/transfer`, { TargetWorkspace: "personal", Move: false });
    });
    const slowRes = await slow;
    if (slowRes.status === 200) {
      const tk = JSON.parse(slowRes.body).ticket;
      await L.del(`/api/v2/files/company/prepared/${tk}`); // 清掉占位票据，避免阻塞后续
    }
    const after409 = (await L.get("/api/v2/folders/personal/project")).data.length;
    const srcAlive = (await folderGet("company", "project", pj)).data.folder.deleted === false;

    /* (b) 中途断开客户端连接 */
    const body = Buffer.from(JSON.stringify({ TargetWorkspace: "personal", Move: false }));
    const aborted = await new Promise((resolve) => {
      const req = http.request({
        host: "127.0.0.1", port: Number(L.BASE.split(":")[2]),
        path: `/api/v2/projects/company/${pj}/transfer`, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(body.length), "X-IPSys-Token": L.token() },
      }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b })); });
      req.on("error", (e) => resolve({ error: e.message }));
      req.write(body);
      setTimeout(() => { req.destroy(); resolve({ aborted: true }); }, 15);
    });
    const afterAbort = (await L.get("/api/v2/folders/personal/project")).data;
    const dup = afterAbort.filter((x) => x.folder.name === `P2F12-项目-${TAG}`);
    const partial = dup.filter((x) => x.folder.deleted === false);
    const contractsInTarget = dup.length ? await contractIds("personal", dup[0].folder.ref.id) : [];

    const ok = transferDuring && transferDuring.status === 409 && after409 === beforeCount && srcAlive &&
      (partial.length === 0 || (dup.length === 1 && contractsInTarget.length === 1));
    rec.rec({
      id: "F-12", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({ duringTask: transferDuring && { status: transferDuring.status, data: transferDuring.data }, projectCountBefore: beforeCount, after409, srcAlive, slowPrepare: slowRes.status, abortResult: aborted, targetAfterAbort: dup.map((x) => ({ id: x.folder.ref.id, deleted: x.folder.deleted, contracts: contractsInTarget.length })) }),
      workspace: "company", recordIds: [pj].concat(dup.map((x) => x.folder.ref.id)),
      notes: ok ? "并发受限：文件任务进行中转移被 409 拒绝且目标零残留；客户端中途断开后目标要么完整要么不存在，无半截项目" : "并发 409 未生效或取消后留下部分目标",
    });
  } catch (e) {
    rec.rec({ id: "F-12", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "F-12 执行异常" });
  }

  console.log("F 组执行完毕");
})();

function afterallFiles(x) { return x.own.length + x.contracts.reduce((s, c) => s + c.files.length, 0); }
