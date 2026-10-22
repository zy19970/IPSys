/* D 组：多级业务档案目录、系统保护、移动与混排排序 */
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

const J = async (p) => { const r = await L.get(p); return r; };
const post = (p, b) => L.post(p, b);
const put = (p, b) => L.put(p, b);
const del = (p) => L.del(p);
const mkDir = (name, parentId) => post("/api/v2/folders/company/archive_folder", { ArchiveFolder: { Name: name, ParentId: parentId }, Section: "achievement" });
const mkRec = (name, folderId) => post("/api/v2/folders/company/archive", { Archive: { Name: name, Category: "其他", Year: "2026", FolderId: folderId }, Section: "achievement" });
const getDir = (id) => J(`/api/v2/folders/company/archive_folder/${id}`);
const entries = (parentId) => J(`/api/v2/folders/company/entries?section=achievement&parentId=${parentId}`);

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  /* D-01 三级目录父子链 */
  const d1 = await mkDir("D01-一级", 1);
  const d2 = await mkDir("D01-二级", d1.data.id);
  const d3 = await mkDir("D01-三级", d2.data.id);
  const g1 = await getDir(d1.data.id), g2 = await getDir(d2.data.id), g3 = await getDir(d3.data.id);
  const chain = [g1, g2, g3].map((x) => x.data && x.data.folder && ({ id: x.data.folder.ref.id, parent: x.data.folder.parent && x.data.folder.parent.id, name: x.data.folder.name }));
  const ok01 = chain[1].parent === chain[0].id && chain[2].parent === chain[1].id && chain[0].parent === 1;
  rec.rec({
    id: "D-01", status: ok01 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify(chain), workspace: "company", recordIds: [chain[0].id, chain[1].id, chain[2].id],
    notes: ok01 ? "三级目录 parent_id 链完整（系统目录→一级→二级→三级）" : "父子链不成立",
  });

  /* D-02 目录内建资料并刷新仍归属 */
  const r2 = await mkRec("D02-目录内资料", d3.data.id);
  const g2r = await J(`/api/v2/folders/company/archive/${r2.data.id}?section=achievement`);
  const p2 = g2r.data && g2r.data.folder.parent && g2r.data.folder.parent.id;
  const ok02 = r2.ok && String(p2) === String(d3.data.id);
  rec.rec({
    id: "D-02", status: ok02 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ create: r2.status, parent: p2, expected: d3.data.id }), workspace: "company", recordIds: [r2.data && r2.data.id],
    notes: ok02 ? "资料持久归属于三级目录，而不是被提升到分类根" : "资料归属目录错误",
  });

  /* D-03 档案根直接建资料 */
  const r3 = await mkRec("D03-游离资料", null);
  const ok03 = !r3.ok && /必须指定有效目录|目录/.test(JSON.stringify(r3.data));
  rec.rec({
    id: "D-03", status: ok03 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ status: r3.status, body: r3.data }), workspace: "company",
    notes: ok03 ? "档案根无所属目录直接建资料被明确拒绝，不生成游离资料" : "允许游离资料",
  });

  /* D-04 自建目录改名 */
  const e4 = await put(`/api/v2/folders/company/archive_folder/${d1.data.id}?section=achievement`, { ArchiveFolder: { Name: "D04-一级改名", ParentId: 1 }, Section: "achievement" });
  const g4 = await getDir(d1.data.id);
  const ok04 = e4.ok && g4.data.folder.name === "D04-一级改名";
  rec.rec({
    id: "D-04", status: ok04 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ update: e4.status, name: g4.data && g4.data.folder.name }), workspace: "company", recordIds: [d1.data.id],
    notes: ok04 ? "自建目录改名持久化" : "改名未保存",
  });

  /* D-05 系统目录保护 */
  const s5 = await getDir(1);
  const e5 = await put(`/api/v2/folders/company/archive_folder/1?section=achievement`, { ArchiveFolder: { Name: "D05-篡改", ParentId: 1 }, Section: "achievement" });
  const d5 = await del(`/api/v2/folders/company/archive_folder/1?section=achievement`);
  const m5 = await post(`/api/v2/folders/company/archive_folder/1/move`, { ParentId: d2.data.id });
  const g5 = await getDir(1);
  const ok05 = !e5.ok && !d5.ok && !m5.ok && g5.data.folder.name === s5.data.folder.name;
  rec.rec({
    id: "D-05", status: ok05 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ rename: [e5.status, e5.data], delete: [d5.status, d5.data], move: [m5.status, m5.data], nameAfter: g5.data && g5.data.folder.name }),
    workspace: "company", recordIds: [1],
    notes: ok05 ? "系统目录改名/删除/移动均被拒绝，原目录完整" : "系统目录被篡改或删除",
  });

  /* D-06 子目录移动到合法同级 */
  const sib = await mkDir("D06-目标目录", 1);
  const m6 = await post(`/api/v2/folders/company/archive_folder/${d3.data.id}/move`, { ParentId: sib.data.id });
  const g6 = await getDir(d3.data.id);
  const parent6 = g6.data && g6.data.folder.parent && g6.data.folder.parent.id;
  const ok06 = m6.ok && String(parent6) === String(sib.data.id);
  rec.rec({
    id: "D-06", status: ok06 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ move: m6.status, parent: parent6, expected: sib.data.id }), workspace: "company", recordIds: [d3.data.id],
    notes: ok06 ? "子目录移动后父级实时更新且持久" : "移动后父级未更新",
  });

  /* D-07 移动到自身/子孙 */
  const m7a = await post(`/api/v2/folders/company/archive_folder/${d1.data.id}/move`, { ParentId: d1.data.id });
  const m7b = await post(`/api/v2/folders/company/archive_folder/${d1.data.id}/move`, { ParentId: d3.data.id });
  const g7 = await getDir(d1.data.id);
  const ok07 = !m7a.ok && !m7b.ok && String(g7.data.folder.parent.id) === "1";
  rec.rec({
    id: "D-07", status: ok07 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ self: [m7a.status, m7a.data], descendant: [m7b.status, m7b.data], parentAfter: g7.data && g7.data.folder.parent && g7.data.folder.parent.id }),
    workspace: "company", recordIds: [d1.data.id],
    notes: ok07 ? "移动到自身与子孙目录均被拒绝，父级保持原值" : "形成循环层级",
  });

  /* D-08 非空/空目录删除 */
  const d8empty = await mkDir("D08-空目录", 1);
  const delNonEmpty = await del(`/api/v2/folders/company/archive_folder/${d2.data.id}?section=achievement`);
  const delEmpty = await del(`/api/v2/folders/company/archive_folder/${d8empty.data.id}?section=achievement`);
  const getEmpty = await getDir(d8empty.data.id);
  const ok08 = !delNonEmpty.ok && delEmpty.ok && getEmpty.status === 404;
  rec.rec({
    id: "D-08", status: ok08 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ nonEmpty: [delNonEmpty.status, delNonEmpty.data], empty: [delEmpty.status, delEmpty.data], emptyAfter: getEmpty.status }),
    workspace: "company", recordIds: [d2.data.id, d8empty.data.id],
    notes: ok08 ? "非空目录拒绝删除；空目录删除后不留幽灵节点" : "空/非空目录删除语义不符",
  });

  /* D-09 目录与资料混排持久排序 */
  const before = await entries(1);
  const list = (Array.isArray(before.data) ? before.data : before.data.items || []).map((x) => ({
    id: x.id || (x.folder && x.folder.ref && x.folder.ref.id),
    kind: (x.kind || (x.folder && x.folder.ref && x.folder.ref.kind)) === "archive_folder" ? "folder" : "record",
    name: x.name || (x.folder && x.folder.name),
  }));
  const reversed = list.slice().reverse();
  const r9 = await post("/api/v2/folders/company/entries/reorder?section=achievement", { ParentId: 1, Items: reversed.map((x) => ({ Id: x.id, Kind: x.kind })) });
  const after = await entries(1);
  const order9 = (Array.isArray(after.data) ? after.data : after.data.items || []).map((x) => x.id || (x.folder && x.folder.ref && x.folder.ref.id));
  const expected = reversed.map((x) => x.id);
  const ok09 = r9.ok && JSON.stringify(order9) === JSON.stringify(expected);
  rec.rec({
    id: "D-09", status: ok09 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ before: list, submitted: reversed.map((x) => x.id), reorder: r9.status, after: order9 }),
    workspace: "company", recordIds: list.map((x) => x.id),
    notes: ok09 ? "同级目录与资料混排提交完整清单后，重载顺序与提交完全一致" : "排序未持久或混排被拆开",
  });

  /* D-10 只提交筛选子集 */
  const r10 = await post("/api/v2/folders/company/entries/reorder?section=achievement", { ParentId: 1, Items: [{ Id: list[0].id, Kind: list[0].kind }] });
  const ok10 = !r10.ok;
  rec.rec({
    id: "D-10", status: ok10 ? "PASS" : "CONFIRMED_BUG",
    actual: JSON.stringify({ submitSubset: r10.status, body: r10.data, fullSiblingCount: list.length }),
    workspace: "company",
    notes: ok10 ? "只提交 1 条子集被拒绝，避免隐藏项位置丢失" : "子集排序被接受，存在位置丢失风险",
  });

  rec.flush();
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); rec.flush(); process.exit(1); });
