/* D-07 / D-08 复核：用未被前序用例改变的新目录重测循环与“非空” */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const BASE = process.env.IPSYS_BASE;
const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-HTTP" });
const mkDir = (name, parentId) => L.post("/api/v2/folders/company/archive_folder", { ArchiveFolder: { Name: name, ParentId: parentId }, Section: "achievement" });
const mkRec = (name, folderId) => L.post("/api/v2/folders/company/archive", { Archive: { Name: name, Category: "其他", Year: "2026", FolderId: folderId }, Section: "achievement" });
const getDir = (id) => L.get(`/api/v2/folders/company/archive_folder/${id}`);
const del = (id) => L.del(`/api/v2/folders/company/archive_folder/${id}?section=achievement`);

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  /* D-07：新建 A→B，把 A 移进 B（B 是 A 的子孙） */
  const A = await mkDir("D07-父", 1);
  const B = await mkDir("D07-子", A.data.id);
  const mSelf = await L.post(`/api/v2/folders/company/archive_folder/${A.data.id}/move`, { ParentId: A.data.id });
  const mDown = await L.post(`/api/v2/folders/company/archive_folder/${A.data.id}/move`, { ParentId: B.data.id });
  const gA = await getDir(A.data.id);
  const parentA = gA.data && gA.data.folder.parent && gA.data.folder.parent.id;
  const ok07 = !mSelf.ok && !mDown.ok && String(parentA) === "1";
  rec.rec({
    id: "D-07", status: ok07 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ self: [mSelf.status, mSelf.data], descendant: [mDown.status, mDown.data], parentAfter: parentA, chain: { A: A.data.id, B: B.data.id } }),
    workspace: "company", recordIds: [A.data.id, B.data.id],
    notes: ok07 ? "新建 A→B 后，A 移入自身或子孙 B 均被拒绝，父级保持系统目录" : "允许把父目录移入子孙，形成循环",
  });

  /* D-08：新建 C 并放一条资料，删除必须拒绝；空目录 D 删除成功 */
  const C = await mkDir("D08-非空", 1);
  const cr = await mkRec("D08-非空内资料", C.data.id);
  const nonEmpty = await del(C.data.id);
  const gC = await getDir(C.data.id);
  const D = await mkDir("D08-空", 1);
  const empty = await del(D.data.id);
  const gD = await getDir(D.data.id);
  const ok08 = !nonEmpty.ok && gC.status === 200 && empty.ok && gD.status === 404;
  rec.rec({
    id: "D-08", status: ok08 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ nonEmpty: [nonEmpty.status, nonEmpty.data], stillExists: gC.status, recordInside: cr.data && cr.data.id, empty: [empty.status, empty.data], emptyAfter: gD.status }),
    workspace: "company", recordIds: [C.data.id, cr.data && cr.data.id, D.data.id],
    notes: ok08 ? "含资料的目录拒绝删除且原目录仍在；空目录删除后 404" : "非空目录被删除或空目录未删除",
  });

  rec.flush();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); rec.flush(); process.exit(1); });
