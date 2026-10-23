/* E 组：附件上传、共享、移动、版本与查重分支 */
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

  /* E-01 各业务记录均可上传；虚拟根不可 */
  const e1 = [];
  for (const [name, id] of [["project", FX.company.projectB], ["contract", FX.company.contractC1], ["ip", FX.company.ipB], ["archive", FX.archive.records[0]], ["general", FX.company.general2]]) {
    const up = await L.upload(id, `E01-${name}.txt`, TXT("E01 " + name));
    e1.push({ kind: name, folderId: id, status: up.fileId ? 200 : "ERR", fileId: up.fileId, linkId: up.linkId });
  }
  const rootUp = await L.call("POST", `/api/v2/files/company/upload?folderId=0`, { body: TXT("root"), headers: { "X-File-Name": encodeURIComponent("E01-root.txt"), "Content-Type": "application/octet-stream" } });
  const ok01 = e1.every((x) => x.fileId > 0) && !rootUp.ok;
  rec.rec({
    id: "E-01", status: ok01 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ uploads: e1, virtualRoot: { status: rootUp.status, body: rootUp.data } }),
    workspace: "company", recordIds: e1.map((x) => x.fileId),
    notes: ok01 ? "项目/合同/知产/档案/综合资料五类记录均接收附件；folderId=0 的虚拟根上传被拒绝" : "某类记录无法上传或虚拟根被写入",
  });

  /* E-02 同一 linkId 多版本只一行，历史可下载 */
  const ipLinks = (await links("company", FX.company.ipA)).filter((x) => Number(x.fileId) === Number(FX.files.ipA.fileId));
  const v1 = await verDl("company", FX.files.ipA.fileId, 1);
  const v2 = await verDl("company", FX.files.ipA.fileId, 2);
  const b1 = Buffer.from(await v1.arrayBuffer()), b2 = Buffer.from(await v2.arrayBuffer());
  const ok02 = ipLinks.length === 1 && ipLinks[0].latestVersion === 2 && sha(b1) === sha(TXT("P2 专利说明书 v1")) && sha(b2) === sha(TXT("P2 专利说明书 v2 内容更长"));
  rec.rec({
    id: "E-02", status: ok02 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ linkRowsForFile: ipLinks.length, latestVersion: ipLinks[0] && ipLinks[0].latestVersion, v1: sha(b1).slice(0, 16), v2: sha(b2).slice(0, 16) }),
    workspace: "company", recordIds: [FX.files.ipA.fileId, FX.files.ipA.linkId],
    notes: ok02 ? "同一 linkId 在列表中只一行，历史 v1/v2 均可下载且 SHA 与上传一致" : "版本折叠或历史下载异常",
  });

  /* E-03 修改关联元数据不产生新版本 */
  const beforeMeta = await L.get(`/api/v2/files/company/${FX.files.ipA.fileId}`);
  const e3 = await L.put(`/api/v2/files/company/${FX.files.ipA.fileId}/links/${FX.files.ipA.linkId}`, { FolderId: FX.company.ipA, DisplayName: "E03-展名", MaterialCategory: "证明材料" });
  const afterMeta = await L.get(`/api/v2/files/company/${FX.files.ipA.fileId}`);
  const link3 = (await links("company", FX.company.ipA)).find((x) => Number(x.id) === Number(FX.files.ipA.linkId));
  const ok03 = e3.ok && afterMeta.data.versions.length === beforeMeta.data.versions.length && link3.displayName === "E03-展名";
  rec.rec({
    id: "E-03", status: ok03 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ update: e3.status, versionsBefore: beforeMeta.data.versions.length, versionsAfter: afterMeta.data.versions.length, displayName: link3 && link3.displayName, materialCategory: link3 && link3.materialCategory }),
    workspace: "company", recordIds: [FX.files.ipA.fileId, FX.files.ipA.linkId],
    notes: ok03 ? "关联展示名/材料类别更新成功，版本数不变（未伪造新版本）" : "元数据更新产生版本或未保存",
  });

  /* E-04 同区共享到另一记录 */
  const e4 = await L.post(`/api/v2/files/company/${FX.files.ipA.fileId}/associate`, { linkId: FX.files.ipA.linkId, targetFolderId: FX.company.general1, move: false });
  const g4links = (await links("company", FX.company.general1)).filter((x) => Number(x.fileId) === Number(FX.files.ipA.fileId));
  const ok04 = e4.ok && g4links.length === 1 && Number(g4links[0].id) !== Number(FX.files.ipA.linkId);
  rec.rec({
    id: "E-04", status: ok04 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ associate: e4.status, newLink: g4links[0] && g4links[0].id, sourceLink: FX.files.ipA.linkId, fileId: FX.files.ipA.fileId }),
    workspace: "company", recordIds: [FX.files.ipA.fileId, g4links[0] && g4links[0].id],
    notes: ok04 ? "目标记录生成新 LinkId，FileId 不变，原件只存一份" : "共享未生成独立 LinkId 或原件被复制",
  });

  /* E-05 共享后升第三版，两处同一最新版 */
  const v3buf = TXT("P2 专利说明书 v3 共享后新增");
  const v3 = await L.addVersion("company", FX.files.ipA.fileId, "P2专利说明书.txt", v3buf);
  const ip5 = (await links("company", FX.company.ipA)).find((x) => Number(x.fileId) === Number(FX.files.ipA.fileId));
  const gen5 = (await links("company", FX.company.general1)).find((x) => Number(x.fileId) === Number(FX.files.ipA.fileId));
  const dl5 = await verDl("company", FX.files.ipA.fileId, 3);
  const b5 = Buffer.from(await dl5.arrayBuffer());
  const ok05 = v3.version === 3 && ip5.latestVersion === 3 && gen5.latestVersion === 3 && sha(b5) === sha(v3buf) && ip5.id !== gen5.id;
  rec.rec({
    id: "E-05", status: ok05 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ newVersion: v3, ipALatest: ip5.latestVersion, generalLatest: gen5.latestVersion, twoLinks: [ip5.id, gen5.id], downloadSha: sha(b5).slice(0, 16) }),
    workspace: "company", recordIds: [FX.files.ipA.fileId, ip5.id, gen5.id],
    notes: ok05 ? "第三版上传后两个关联都显示 v3，下载内容与新版一致" : "共享两处未同步最新版本",
  });

  /* E-06 右键移动关联（move=true） */
  const src6 = await L.upload(FX.company.projectA, "E06-移动源.txt", TXT("E06 移动关联正文"));
  src6.linkId = (await links("company", FX.company.projectA)).filter((x) => Number(x.fileId) === Number(src6.fileId)).pop().id;
  const e6 = await L.post(`/api/v2/files/company/${src6.fileId}/associate`, { linkId: src6.linkId, targetFolderId: FX.company.projectB, move: true });
  const src6After = (await links("company", FX.company.projectA)).filter((x) => Number(x.fileId) === Number(src6.fileId));
  const dst6 = (await links("company", FX.company.projectB)).filter((x) => Number(x.fileId) === Number(src6.fileId));
  const details6 = await L.get(`/api/v2/files/company/${src6.fileId}`);
  const ok06 = e6.ok && src6After.length === 0 && dst6.length === 1 && details6.data.versions.length === 1;
  rec.rec({
    id: "E-06", status: ok06 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ move: e6.status, sourceLinksAfter: src6After.length, targetLinks: dst6.length, versions: details6.data && details6.data.versions.length, fileId: src6.fileId }),
    workspace: "company", recordIds: [src6.fileId],
    notes: ok06 ? "移动关联后来源解除、目标建立 LinkId，FileId 与版本链不变" : "移动后来源未解除或版本链变化",
  });

  /* E-07 目标已关联同原件再共享 */
  const before7 = (await links("company", FX.company.general1)).filter((x) => Number(x.fileId) === Number(FX.files.ipA.fileId)).length;
  const e7 = await L.post(`/api/v2/files/company/${FX.files.ipA.fileId}/associate`, { linkId: FX.files.ipA.linkId, targetFolderId: FX.company.general1, move: false });
  const after7 = (await links("company", FX.company.general1)).filter((x) => Number(x.fileId) === Number(FX.files.ipA.fileId)).length;
  const ok07 = !e7.ok && before7 === after7;
  rec.rec({
    id: "E-07", status: ok07 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ status: e7.status, body: e7.data, before: before7, after: after7 }),
    workspace: "company", recordIds: [FX.files.ipA.fileId],
    notes: ok07 ? "目标已关联同一 FileId 时返回冲突，未生成重复 LinkId" : "重复共享产生重复关联",
  });

  /* E-08 删除一条共享关联，另一处历史仍可读 */
  const genLink = (await links("company", FX.company.general1)).find((x) => Number(x.fileId) === Number(FX.files.ipA.fileId));
  const d8 = await L.del(`/api/v2/files/company/${FX.files.ipA.fileId}/links/${genLink.id}`);
  const ip8 = (await links("company", FX.company.ipA)).filter((x) => Number(x.fileId) === Number(FX.files.ipA.fileId));
  const v1after = await verDl("company", FX.files.ipA.fileId, 1);
  const b1a = Buffer.from(await v1after.arrayBuffer());
  const ok08 = d8.ok && ip8.length === 1 && sha(b1a) === sha(TXT("P2 专利说明书 v1"));
  rec.rec({
    id: "E-08", status: ok08 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ deleteLink: d8.status, remainingIpLinks: ip8.length, v1Sha: sha(b1a).slice(0, 16) }),
    workspace: "company", recordIds: [FX.files.ipA.fileId, genLink.id],
    notes: ok08 ? "删除一条共享关联后另一处仍在，v1 历史仍可下载" : "删除一条关联误伤原件或另一处",
  });

  /* E-09 跨工作区共享同一 FileId */
  const e9 = await L.post(`/api/v2/files/company/${FX.files.ipA.fileId}/associate`, { linkId: FX.files.ipA.linkId, targetFolderId: FX.personal.projectP, move: false });
  const ok09 = !e9.ok;
  rec.rec({
    id: "E-09", status: ok09 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ status: e9.status, body: e9.data }), workspace: "company->personal", recordIds: [FX.files.ipA.fileId],
    notes: ok09 ? "跨工作区共享同一 FileId 被拒绝" : "允许个人/公司共享物理对象",
  });

  /* E-10 同内容不同名的选择分支 */
  const body10 = TXT("E10 同内容用于查重分支，SHA 必须一致");
  const prep = (folderId, name) => L.call("POST", `/api/v2/files/company/prepare?folderId=${folderId}`, {
    body: body10, headers: { "X-File-Name": encodeURIComponent(name), "X-File-Description": "", "X-File-Tags": "", "X-File-Number": "", "X-File-Date": "", "Content-Type": "application/octet-stream" },
  });
  const p1 = await prep(FX.company.projectB, "E10-首次.txt");
  let p1res = null;
  if (p1.ok) p1res = await L.post(`/api/v2/files/company/prepared/${p1.data.ticket}/resolve`, { Choice: "independent" });
  const p2 = await prep(FX.company.projectB, "E10-第二次.txt");
  let p2res = null, p3res = null;
  if (p2.ok) {
    const match = (p2.data.matches || []).find((m) => Number(m.fileId) === Number(p1res && p1res.data && p1res.data.fileId));
    p2res = await L.post(`/api/v2/files/company/prepared/${p2.data.ticket}/resolve`, { Choice: "reuse", SourceFileId: match ? match.fileId : (p1res && p1res.data.fileId) });
  }
  const p3 = await prep(FX.company.projectB, "E10-第三次.txt");
  if (p3.ok) p3res = await L.post(`/api/v2/files/company/prepared/${p3.data.ticket}/resolve`, { Choice: "independent" });
  const ok10 = p1res && p1res.ok && p2res && p2res.ok && p3res && p3res.ok &&
    p2res.data.fileId === p1res.data.fileId && p3res.data.fileId !== p1res.data.fileId &&
    p2.data.matches && p2.data.matches.length >= 1;
  rec.rec({
    id: "E-10", status: ok10 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ prepare1: p1.status, independent1: p1res && p1res.data, chooseMatches: p2.data && p2.data.matches, reuse: p2res && p2res.data, independent2: p3res && p3res.data }),
    workspace: "company", recordIds: [p1res && p1res.data.fileId, p3res && p3res.data.fileId],
    notes: ok10 ? "同内容第二次上传命中匹配并可选 reuse；reuse 复用同一 FileId，independent 新建 FileId" : "查重匹配或两条分支不符",
  });

  /* E-11 异常名称 */
  const weird = 'E11-中文 空格 "引号" & <tag>.txt';
  const up11 = await L.upload(FX.company.projectB, weird, TXT("E11 特殊名称正文"));
  const l11 = (await links("company", FX.company.projectB)).find((x) => Number(x.fileId) === Number(up11.fileId));
  const dl11 = await verDl("company", up11.fileId, 1);
  const b11 = Buffer.from(await dl11.arrayBuffer());
  const ok11 = l11 && l11.fileName === weird && sha(b11) === sha(TXT("E11 特殊名称正文"));
  rec.rec({
    id: "E-11", status: ok11 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ storedName: l11 && l11.fileName, expected: weird, downloadSha: sha(b11).slice(0, 16) }),
    workspace: "company", recordIds: [up11.fileId],
    notes: ok11 ? "引号/尖括号/中英文混排名称原样保存，下载内容一致" : "名称转义或下载内容异常",
  });

  /* E-12 中途断开上传不产生假提交 */
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
  await new Promise((r) => setTimeout(r, 800));
  const after12 = (await links("company", FX.company.projectB)).length;
  const chk = await L.get("/api/check");
  const ok12 = before12 === after12;
  rec.rec({
    id: "E-12", status: ok12 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ linksBefore: before12, linksAfter: after12, integrity: chk.data && chk.data.result, writing: chk.data && chk.data.incomplete }),
    workspace: "company", notes: ok12 ? "上传 150ms 后强制断开，未产生成功关联；无假提交" : "中断上传产生了关联",
  });

  rec.flush();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); rec.flush(); process.exit(1); });
