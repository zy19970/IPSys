/* E-10 查重三分支 —— 修正版
   上一版把三个分支都放在同一个文件夹里，而 share-file 对「目标文件夹已关联该 FileId」
   是显式拒绝的（NativeFileChoiceResolve.cs:50-64）。真实语义必须跨文件夹验证：
     folder A: independent -> F1
     folder A: reuse-content(F1) -> F2（新 FileId、复用同一 object）
     folder B: share-file(F1)  -> FileId 仍是 F1
     folder A: share-file(F1)  -> 409（已关联，设计上就拒绝）
*/
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const FX = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-HTTP" });
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const A = FX.company.projectB;
const B = FX.company.projectA;

function headers(name) {
  return {
    "X-File-Name": encodeURIComponent(name),
    "X-File-Description": "", "X-File-Tags": "", "X-File-Number": "", "X-File-Date": "",
    "Content-Type": "application/octet-stream",
  };
}
const prep = (folderId, name, buf) =>
  L.call("POST", `/api/v2/files/company/prepare?folderId=${folderId}`, { body: buf, headers: headers(name) });
const resolve = (ticket, body) => L.post(`/api/v2/files/company/prepared/${ticket}/resolve`, body);
const cancel = (ticket) => L.del(`/api/v2/files/company/prepared/${ticket}`);
const links = async (folderId) => {
  const r = await L.get(`/api/v2/files/company/folders/${folderId}/links?includeDeleted=false`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
};
const fileObj = async (fileId) => {
  const r = await L.get(`/api/v2/files/company/${fileId}`);
  const vs = (r.data && r.data.versions) || [];
  return { status: r.status, name: r.data && r.data.name, versions: vs.length, objectId: vs.length ? vs[0].objectId : null };
};

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));
  const body = Buffer.from("E10 同内容三分支，SHA 必须一致 " + Date.now(), "utf8");
  const H = sha(body);
  const log = {};

  /* 1) A 区独立保存 */
  const p1 = await prep(A, "E10-A独立.txt", body);
  log.p1 = { status: p1.status, ticket: p1.data && p1.data.ticket, matches: p1.data && p1.data.matches && p1.data.matches.length };
  const q1 = p1.ok ? await resolve(p1.data.ticket, { Choice: "independent" }) : null;
  log.q1 = q1 && { status: q1.status, data: q1.data };
  const F1 = q1 && q1.ok ? q1.data.fileId : null;

  /* 2) A 区复用内容 */
  const p2 = await prep(A, "E10-A复用.txt", body);
  log.p2 = { status: p2.status, matches: p2.data && p2.data.matches };
  const q2 = p2.ok ? await resolve(p2.data.ticket, { Choice: "reuse-content", SourceFileId: F1 }) : null;
  log.q2 = q2 && { status: q2.status, data: q2.data };
  const F2 = q2 && q2.ok ? q2.data.fileId : null;

  /* 3) B 区共享引用（同一 FileId、另一个文件夹） */
  const p3 = await prep(B, "E10-B共享.txt", body);
  log.p3 = { status: p3.status, matches: p3.data && p3.data.matches && p3.data.matches.length };
  const q3 = p3.ok ? await resolve(p3.data.ticket, { Choice: "share-file", SourceFileId: F1 }) : null;
  log.q3 = q3 && { status: q3.status, data: q3.data };

  /* 4) 负向：A 区重复共享同一个 FileId 必须被拒 */
  const p4 = await prep(A, "E10-A重复共享.txt", body);
  const q4 = p4.ok ? await resolve(p4.data.ticket, { Choice: "share-file", SourceFileId: F1 }) : null;
  log.q4 = q4 && { status: q4.status, data: q4.data };
  if (p4.ok && q4 && !q4.ok) await cancel(p4.data.ticket); // 票据残留会阻塞后续上传

  /* 5) 去重事实：再准备一次同内容，用 matches 证明 F1/F2 指向同一 object */
  const pD = await prep(A, "E10-去重证明.txt", body);
  const matches = (pD.data && pD.data.matches) || [];
  log.pD = { status: pD.status, matches };
  if (pD.ok) await cancel(pD.data.ticket); // 不落库就必须取消，否则阻塞后续上传
  const m1 = matches.find((x) => Number(x.fileId) === Number(F1));
  const m2 = matches.find((x) => Number(x.fileId) === Number(F2));
  const o1 = F1 ? await fileObj(F1) : null;
  const o2 = F2 ? await fileObj(F2) : null;
  const la = await links(A);
  const lb = await links(B);
  log.objects = {
    f1: o1, f2: o2,
    objectIdF1: m1 && m1.objectId, objectIdF2: m2 && m2.objectId,
    sameObject: !!(m1 && m2 && m1.objectId === m2.objectId),
  };
  log.linksA = la.filter((x) => [F1, F2].includes(Number(x.fileId))).map((x) => ({ fileId: x.fileId, name: x.displayName || x.fileName, link: x.id }));
  log.linksB = lb.filter((x) => Number(x.fileId) === Number(F1)).map((x) => ({ fileId: x.fileId, name: x.displayName || x.fileName, link: x.id }));

  const ok =
    p1.ok && q1 && q1.ok && q1.data.reusedContent === false &&
    p2.ok && q2 && q2.ok && Number(F2) !== Number(F1) && q2.data.reusedContent === true &&
    q2.data.sha256.toUpperCase() === H.toUpperCase() &&
    p3.ok && q3 && q3.ok && Number(q3.data.fileId) === Number(F1) && q3.data.reusedContent === true &&
    q4 && q4.status === 409 &&
    log.objects.sameObject &&
    log.linksA.length === 2 && log.linksB.length === 1;

  log.sha = H;
  rec.rec({
    id: "E-10", status: ok ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(log),
    workspace: "company",
    recordIds: [F1, F2],
    notes: ok
      ? "三分支语义成立：independent 新建 FileId 且 reusedContent=false；reuse-content 新建 FileId 但复用同一 object（reusedContent=true，SHA 一致）；share-file 复用同一 FileId 并在另一文件夹建立新链接；同一文件夹重复 share-file 被 409 显式拒绝（代码注释标注为唯一活动链接约束）"
      : "三分支中至少一支的 fileId / reusedContent / object 复用关系不符合契约",
  });
  console.log(JSON.stringify({ ok, F1, F2, linkA: log.linksA.length, linkB: log.linksB.length, sameObject: log.objects.sameObject }));
})();
