/* 用真实 HTTP payload 驱动前端纯函数 buildTree，确定性复现「多级档案目录是否进树」。
   这是判定 BUG-001 最干净的方式：不依赖浏览器时序，也不依赖截图。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-tree.cjs <runid> */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v3a";
const COMMIT = process.env.IPSYS_COMMIT || "49ecf63";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CASES = path.join(EVID, "cases");
const SHELL = path.resolve(ROOT, "..", "..", "..", "frontend", "explorer");
const TMP = path.resolve(ROOT, "..", "..", "..", "build-retest", "agent-validation-v3");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const log = L.makeLog(path.join(EVID, "tree-run.log"));

/* store.js 是顶层对象字面量，方法不调用就不跑，所以可以无 DOM 载入 */
const ctx = vm.createContext({
  console, Date, Math, JSON, Set, Map, String, Number, Object, Array, Promise, Error, RegExp,
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  window: {},
  fetch: () => { throw Error("buildTree 不应发网络请求"); },
});
for (const f of ["js/data.js", "js/store.js"]) {
  vm.runInContext(fs.readFileSync(path.join(SHELL, f), "utf8"), ctx, { filename: f });
}

function rec(o) {
  const row = Object.assign({ runId: RUNID, testedCommit: COMMIT, at: new Date().toISOString() }, o);
  fs.writeFileSync(path.join(CASES, o.id + ".json"), JSON.stringify(row, null, 2), "utf8");
  log.add(`[${o.result}] ${o.id} ${o.feature}${o.defect ? " -> " + o.defect : ""}`);
  return row;
}

/* 深度遍历整棵树，返回 id 集合 */
function allIds(root) {
  const out = [];
  (function walk(n) {
    out.push(String(n.id));
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}
function pathOf(root, targetId) {
  const stack = [];
  let found = null;
  (function walk(n, trail) {
    if (found) return;
    trail = trail.concat(n.name || n.id);
    if (String(n.id) === String(targetId)) { found = trail; return; }
    for (const c of n.children || []) walk(c, trail);
  })(root, []);
  return found;
}

(async () => {
  const c = await L.connect(cred.db, cred.password);
  log.add(`connect via ${c.via}`);

  const [projects, contracts, archive, ip, projectFiles] = await Promise.all([
    L.get("/api/v2/ui/projects/company").then((r) => r.data).catch(() => []),
    L.get("/api/v2/ui/contracts/company").then((r) => r.data).catch(() => []),
    L.get("/api/v2/ui/archive/company").then((r) => r.data).catch(() => ({})),
    L.get("/api/v2/ui/ip/company").then((r) => r.data).catch(() => ({})),
    L.get("/api/v2/ui/project-files/company").then((r) => r.data).catch(() => []),
  ]);
  log.add(`payload: projects=${projects.length} contracts=${contracts.length} folders=${(archive.folders || []).length} archives=${(archive.archives || []).length} ipFiles=${(ip.files || []).length} projectFiles=${projectFiles.length}`);

  /* 后端给了什么：二级/三级目录是否在 folders 数组里、parentId 是否保留 */
  const dirs = archive.folders || [];
  const lvl2 = dirs.find((d) => Number(d.id) === Number(fx.archive.lvl2));
  const lvl3 = dirs.find((d) => Number(d.id) === Number(fx.archive.lvl3));
  log.add(`后端 folders: 二级-A=${JSON.stringify(lvl2)} 三级-A1=${JSON.stringify(lvl3)}`);

  fs.writeFileSync(path.join(EVID, "tree-payload.json"),
    JSON.stringify({ projects, contracts, archive, ip, projectFiles }, null, 2), "utf8");

  ctx.PAYLOAD = { ws: "company", projects, contracts, archive, ip, projectFiles };
  const tree = vm.runInContext("VaultStore.buildTree(PAYLOAD)", ctx);
  const ids = allIds(tree);
  fs.writeFileSync(path.join(EVID, "tree-built.json"), JSON.stringify(tree, null, 2), "utf8");

  const idAf2 = `af:${fx.archive.lvl2}`;
  const idAf3 = `af:${fx.archive.lvl3}`;
  const recId = `a:${fx.archive.records[0]}`;                     /* 档案记录节点 id 可能需要按真实前缀修 */
  const idsJoined = ids.join(",");
  const inTree2 = ids.includes(idAf2);
  const inTree3 = ids.includes(idAf3);

  /* 档案-01 到底挂在哪个分类下：整棵树找一遍 */
  const recNode = (function find(n) {
    if (!n) return null;
    if (String(n.biz?.kind) === "archive" && Number(n.biz?.id) === Number(fx.archive.records[0])) return n;
    for (const ch of n.children || []) { const r = find(ch); if (r) return r; }
    return null;
  })(tree);
  const recPath = recNode ? pathOf(tree, recNode.id) : null;
  log.add(`树内 id 总数=${ids.length}；af:${fx.archive.lvl2} 在树=${inTree2}；af:${fx.archive.lvl3} 在树=${inTree3}`);
  log.add(`档案-01 节点 id=${recNode && recNode.id}；所在路径=${JSON.stringify(recPath)}`);

  rec({
    id: "T-P0-01-tree",
    feature: "buildTree 是否保留多级档案目录（真实 payload）",
    method: "PURE-FUNCTION + REAL-PAYLOAD",
    expected: "af:8 / af:9 都出现在树里；档案-01 位于 业务档案/申报与认定/二级-A/三级-A1 之下",
    result: inTree2 && inTree3 ? "PASS" : "CONFIRMED_BUG",
    defect: inTree2 && inTree3 ? null : "BUG-001",
    observed: {
      backendHasLvl2: !!lvl2, backendLvl2Parent: lvl2 && lvl2.parentId,
      backendHasLvl3: !!lvl3, backendLvl3Parent: lvl3 && lvl3.parentId,
      af2InTree: inTree2, af3InTree: inTree3,
      record01NodeId: recNode && recNode.id, record01Path: recPath,
      totalNodes: ids.length,
      sampleIds: ids.slice(0, 40),
    },
    rootCause: "frontend/explorer/js/store.js:492-493 buildArchiveDirs 只保留 parentId==null 的目录；" +
      "store.js:507-511 找不到目录的记录被塞进 loose 并提升到分类根",
  });

  /* X-02：children 只按拼音排，忽略 position */
  const sysId = `af:${fx.archive.system[0].id}`;
  const sysNode = (function find(n) {
    if (!n) return null;
    if (String(n.id) === sysId) return n;
    for (const ch of n.children || []) { const r = find(ch); if (r) return r; }
    return null;
  })(tree);
  const childNames = (sysNode?.children || []).map((x) => `${x.type}:${x.name}`);
  log.add(`分类 ${sysId} 的树内子节点: ${JSON.stringify(childNames)}`);

  /* 后端 entries 的真实顺序（position） */
  const entries = (await L.get(`/api/v2/folders/company/entries?section=achievement&parentId=${fx.archive.system[0].id}`)).data || [];
  const beOrder = entries.map((e) => `${e.folder?.ref?.kind === "archive_folder" ? "folder" : "record"}:${e.folder?.name}`);
  log.add(`后端 entries 顺序（position）: ${JSON.stringify(beOrder)}`);

  rec({
    id: "X-02-tree",
    feature: "建树时是否保留后端 position 顺序",
    method: "PURE-FUNCTION + REAL-PAYLOAD",
    expected: "树内子节点顺序应与后端 entries 的 position 顺序一致（含目录与记录混排）",
    result: JSON.stringify(childNames) === JSON.stringify(beOrder) ? "PASS" : "CONFIRMED_BUG",
    defect: JSON.stringify(childNames) === JSON.stringify(beOrder) ? null : "BUG-010",
    observed: { backendOrder: beOrder, treeOrder: childNames },
    rootCause: "store.js:514 d.children.sort((a,b)=>cmpName(a,b)) 只按拼音；" +
      "app.js:415 sortedItems 再强制 folder 排在 file 之前，position 永远无法生效",
  });

  log.flush();
  console.log("\n=== tree 结论 ===");
  console.log(JSON.stringify({
    af2InTree: inTree2, af3InTree: inTree3,
    record01Path: recPath, backendOrder: beOrder, treeOrder: childNames,
  }, null, 2));
})().catch((e) => {
  log.add("TREE FAILED: " + (e && e.stack || e));
  log.flush();
  process.exit(1);
});
