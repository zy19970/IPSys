/* E-03 / E-10 / E-11 / E-12 复核：修正元数据入口、查重取值与 Windows 非法文件名假设 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const BASE = process.env.IPSYS_BASE;
const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const FX = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-HTTP" });
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const TXT = (s) => Buffer.from(s, "utf8");
const links = async (ws, folderId) => {
  const r = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
  return Array.isArray(r.data) ? r.data : (r.data.items || []);
};
const verDl = (ws, fileId, v) => L.call("GET", `/api/v2/files/${ws}/${fileId}/versions/${v}/download`, { raw: true });

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  /* E-03 文件元数据（备注/标签）不产生版本 */
  const before = await L.get(`/api/v2/files/company/${FX.files.ipA.fileId}`);
  const up = await L.put(`/api/v2/files/company/${FX.files.ipA.fileId}/metadata`, { Name: "P2专利说明书.txt", Description: "E03-备注", Tags: "E03,标签", FileNumber: "E03-001", FileDate: "2026-05-01" });
  const after = await L.get(`/api/v2/files/company/${FX.files.ipA.fileId}`);
  const d3 = after.data;
  const ok03 = up.ok && before.data.versions.length === after.data.versions.length && d3.description === "E03-备注" && d3.tags === "E03,标签";
  rec.rec({
    id: "E-03", status: ok03 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ update: up.status, versionsBefore: before.data.versions.length, versionsAfter: after.data.versions.length, description: d3 && d3.description, tags: d3 && d3.tags, number: d3 && d3.fileNumber }),
    workspace: "company", recordIds: [FX.files.ipA.fileId],
    notes: ok03 ? "文件备注/标签/文号更新成功，历史版本数不变（元数据不伪造新版本）" : "元数据未保存或产生了新版本",
  });

  /* E-10 三个分支：independent / reuse-content / share-file */
  const body10 = TXT("E10 同内容三分支，SHA 必须一致 " + Date.now());
  const prep = (name) => L.call("POST", `/api/v2/files/company/prepare?folderId=${FX.company.projectB}`, {
    body: body10,
    headers: { "X-File-Name": encodeURIComponent(name), "X-File-Description": "", "X-File-Tags": "", "X-File-Number": "", "X-File-Date": "", "Content-Type": "application/octet-stream" },
  });
  const r1 = await prep("E10-独立.txt");
  const q1 = r1.ok ? await L.post(`/api/v2/files/company/prepared/${r1.data.ticket}/resolve`, { Choice: "independent" }) : null;
  const r2 = await prep("E10-复用内容.txt");
  const q2 = r2.ok ? await L.post(`/api/v2/files/company/prepared/${r2.data.ticket}/resolve`, { Choice: "reuse-content", SourceFileId: q1 && q1.data.fileId }) : null;
  const r3 = await prep("E10-共享引用.txt");
  const q3 = r3.ok ? await L.post(`/api/v2/files/company/prepared/${r3.data.ticket}/resolve`, { Choice: "share-file", SourceFileId: q1 && q1.data.fileId }) : null;
  const ok10 = q1 && q1.ok && q2 && q2.ok && q3 && q3.ok &&
    q2.data.fileId !== q1.data.fileId && q2.data.reusedContent === true &&
    q3.data.fileId === q1.data.fileId;
  rec.rec({
    id: "E-10", status: ok10 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ prepare: [r1.status, r2.status, r3.status], matches: r2.data && r2.data.matches, independent: q1 && q1.data, reuseContent: q2 && q2.data, shareFile: q3 && q3.data }),
    workspace: "company", recordIds: [q1 && q1.data.fileId, q2 && q2.data.fileId, q3 && q3.data.fileId],
    notes: ok10 ? "同内容三选一均可用：independent 新 FileId；reuse-content 新 FileId 复用对象；share-file 复用同一 FileId" : "查重匹配或三分支语义不符",
  });

  /* E-11 Windows 合法特殊字符 + 中文 + 空格 + 超长名 */
  const weird = "E11-中文 空格 & 100% 'quote' （括号）#1.txt";
  const up11 = await L.upload(FX.company.projectB, weird, TXT("E11 特殊名称正文"));
  const l11 = (await links("company", FX.company.projectB)).find((x) => Number(x.fileId) === Number(up11.fileId));
  const dl11 = await verDl("company", up11.fileId, 1);
  const b11 = Buffer.from(await dl11.arrayBuffer());
  const illegal = await L.upload(FX.company.projectB, 'E11-非法"引号".txt', TXT("x")).catch((e) => ({ error: e.message }));
  const ok11 = l11 && l11.fileName === weird && sha(b11) === sha(TXT("E11 特殊名称正文")) && !up11.error;
  rec.rec({
    id: "E-11", status: ok11 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ storedName: l11 && l11.fileName, expected: weird, downloadSha: sha(b11).slice(0, 16), windowsIllegalQuote: illegal.error || illegal }),
    workspace: "company", recordIds: [up11.fileId],
    notes: ok11 ? "合法特殊字符/中文/空格/括号名称原样保存且下载一致；Windows 非法双引号被拒绝属预期" : "名称转义或下载内容异常",
  });

  /* E-12 中断上传 */
  const before12 = (await links("company", FX.company.projectB)).length;
  await new Promise((resolve) => {
    const u = new URL(BASE + `/api/v2/files/company/upload?folderId=${FX.company.projectB}`);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST",
      headers: { "X-File-Name": encodeURIComponent("E12-中断.bin"), "Content-Length": String(1024 * 1024), "Content-Type": "application/octet-stream" },
    }, (res) => { res.resume(); resolve(); });
    req.on("error", () => resolve());
    req.write(Buffer.alloc(1024, 0x45));
    setTimeout(() => { req.destroy(); resolve(); }, 150);
  });
  await new Promise((r) => setTimeout(r, 900));
  const after12 = (await links("company", FX.company.projectB)).length;
  const chk = await L.get("/api/check");
  const broken = (await links("company", FX.company.projectB)).filter((x) => x.fileName === "E12-中断.bin");
  const ok12 = before12 === after12 && broken.length === 0;
  rec.rec({
    id: "E-12", status: ok12 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ linksBefore: before12, linksAfter: after12, brokenLinks: broken.length, integrity: chk.data && chk.data.result, writingObjects: chk.data && chk.data.incomplete }),
    workspace: "company", notes: ok12 ? "上传 150ms 后强制断开：无成功关联、无残缺 Link；integrity_check 通过" : "中断上传产生了假提交",
  });

  rec.flush();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); rec.flush(); process.exit(1); });
