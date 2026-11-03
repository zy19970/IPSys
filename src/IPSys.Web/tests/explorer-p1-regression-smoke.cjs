/* Explorer P1: server-backed mixed archive order and explicit load failures.
   Execute actual store/app functions in VM with mock network and DOM. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const shell = path.resolve(__dirname, "../wwwroot");
const source = p => fs.readFileSync(path.join(shell, "js", p), "utf8");

const els = new Map();
for (const id of ["#viewRoot", "#content", "#main", "#listHead"]) {
  els.set(id, {
    innerHTML: "",
    classList: { add(){}, remove(){}, toggle(){} },
    style: { setProperty(){} },
  });
}
const sandbox = vm.createContext({
  console, Date, Math, JSON, Set, Map, String, Number, Object, Array, Promise, Error, RegExp,
  window: { innerWidth: 1440 },
  document: { querySelector: id => els.get(id) || null },
  localStorage: { getItem: () => null, setItem(){} },
  sessionStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  icon: () => "",
  fetch: () => { throw Error("Build-tree test must not call real network"); },
});
for (const name of ["data.js", "store.js", "app.js"])
  vm.runInContext(source(name), sandbox, { filename: name });
const run = js => vm.runInContext(js, sandbox);
const payload = {
  ws: "company", projects: [], contracts: [], projectFiles: [],
  archive: {
    folders: [
      { id: 70, name: "一级系统目录", parentId: null, position: 0, isSystem: true },
      { id: 71, name: "二级目录", parentId: 70, position: 5 },
      { id: 72, name: "三级目录", parentId: 71, position: 0 },
      /* A02/N2：资料就是普通文件夹，同一张表同一层排序。 */
      { id: 90, name: "第一资料", section: "achievement", parentId: 70, position: 1 },
      { id: 91, name: "第二资料", section: "achievement", parentId: 70, position: 2 },
      { id: 92, name: "三级资料", section: "achievement", parentId: 72, position: 0 },
    ],
    files: [],
    orders: {
      "0": [{ kind: "folder", id: 70 }],
      "70": [
        { kind: "record", id: 91 },
        { kind: "folder", id: 71 },
        { kind: "record", id: 90 },
      ],
      "71": [{ kind: "folder", id: 72 }],
      "72": [{ kind: "record", id: 92 }],
    },
  },
  ip: { rows: [], files: [] },
};
run("VaultStore.ws='company';ROOT=VaultStore.buildTree(" + JSON.stringify(payload) + ");");
assert.deepEqual(
  Array.from(run("pathTo('af:92')"), x => x.id),
  ["root", "k:achievement", "af:70", "af:71", "af:72", "af:92"],
  "An archive record must remain inside its complete directory path",
);
assert.deepEqual(
  Array.from(run("findById('af:70').children"), x => x.id),
  ["af:91", "af:71", "af:90"],
  "Folder and record siblings must retain the authoritative mixed order",
);

run("Drive.state.view='files';Drive.state.folderId='af:70';Drive.enterContext();");
assert.equal(run("Drive.state.sortBy"), "ctime");
assert.equal(run("Drive.state.sortDir"), "desc");
assert.deepEqual(
  Array.from(run("Drive.sortedItems"), x => x.id),
  ["af:91", "af:90", "af:71"],
  "Legacy folders without creation times use descending FolderId",
);
run("Drive.state.sortBy='position';Drive.state.sortDir='asc';");
assert.deepEqual(
  Array.from(run("Drive.sortedItems"), x => x.id),
  ["af:91", "af:71", "af:90"],
  "Explicit persistent custom order remains available",
);
run("Drive.state.folderId='k:project';Drive.enterContext();");
assert.equal(run("Drive.state.sortBy"), "_year");
assert.equal(run("Drive.state.sortDir"), "desc");
run("Drive.state.folderId='af:70';Drive.enterContext();");
assert.equal(run("Drive.state.sortBy"), "ctime",
  "Returning to an ordinary folder restores newest-created-first");

/* Creation timestamp must be independent of modification; years are business dates. */
const newestFirst = {
  ...payload,
  projects: [
    {id:10,name:"旧项目",startDate:"2021-02-01"},
    {id:11,name:"新项目",startDate:"2026-03-01"},
    {id:12,name:"无日期项目",startDate:""},
  ],
  ip: {rows:[
    {id:1,data:{name:"旧申请",applicationDate:"2021-05-01",grantDate:"2026-07-01"}},
    {id:2,data:{name:"新申请",applicationDate:"2026-02-01"}},
    {id:3,data:{name:"无申请日",grantDate:"2027-01-01"}},
  ],files:[]},
  archive: {...payload.archive,folders:[
    {id:60,section:"achievement",name:"后来改过的旧目录",createdAt:"2020-01-02T00:00:00Z",modifiedAt:"2026-10-31T12:00:00Z"},
    {id:61,section:"achievement",name:"最近创建的目录",createdAt:"2026-10-01T00:00:00Z",modifiedAt:"2026-10-01T00:00:00Z"},
  ],archives:[],orders:{}},
};
run("ROOT=VaultStore.buildTree("+JSON.stringify(newestFirst)+")");
run("Drive.state.folderId='k:project';Drive.enterContext();");
assert.deepEqual(Array.from(run("Drive.sortedItems"),x=>x.id),["p:11","p:10","p:12"],
  "Projects sort by year descending with missing dates last");
run("Drive.state.folderId='k:ip';Drive.enterContext();");
assert.deepEqual(Array.from(run("Drive.sortedItems"),x=>x.id),["i:2","i:1","i:3"],
  "IP uses application year, not the later grant year");
run("Drive.state.folderId='k:achievement';Drive.enterContext();");
assert.deepEqual(Array.from(run("Drive.sortedItems"),x=>x.id),["af:61","af:60"],
  "Folder creation timestamp wins over newer modifiedAt");
run("ROOT=VaultStore.buildTree("+JSON.stringify(payload)+")");

/* 知识产权的年份仅取申请日期;授权日期不可作为隐含年份。 */
assert.equal(run("Drive.yearOf({biz:{kind:'ip',start:'2023-06-15',end:'2026-09-20',year:'2026'}})"),"2023");
assert.equal(run("Drive.cellValue({biz:{kind:'ip',start:'2023-06-15',end:'2026-09-20'}},{k:'_year'})"),"2023");
assert.equal(run("Drive.yearOf({biz:{kind:'ip',start:'',end:'2026-09-20',year:'2026'}})"),"",
  "Grant date or a stale year field cannot replace a missing IP application date");
assert.equal(run("Drive.yearOf({biz:{kind:'ip',start:'2024-01-01',end:''}})"),"2024");
assert.equal(run("Drive.yearOf({biz:{kind:'archive_folder',year:'2025'}})"),"2025",
  "Explicit archive year must retain its current meaning");
assert.equal(run("Drive.yearOf({biz:{kind:'project',start:'',end:'2022-12-31'}})"),"2022",
  "Project year fallback must remain unchanged");

(async () => {
  const oldRoot = run("ROOT");
  const vault = run("VaultStore");
  vault.getJson = async url => {
    if (url.includes("/api/v2/ui/folders/")) throw Error("HTTP 500");
    return [];
  };
  await assert.rejects(vault.loadAll("company"), /业务档案加载失败.*500/);
  assert.match(vault.error, /业务档案加载失败/);
  assert.equal(vault.loading, false);
  assert.equal(run("ROOT"), oldRoot,
    "One failed endpoint cannot replace existing data with empty records");
  assert.ok(run("findById('af:92')"),
    "The old record remains intact on load failure");

  run("Drive.state.ready=false;Drive.state.view='home';Drive.state.loadError=VaultStore.error;");
  run("Drive.renderContent()");
  assert.match(els.get("#viewRoot").innerHTML, /读取失败/);
  assert.match(els.get("#viewRoot").innerHTML, /业务档案加载失败/);
  assert.match(els.get("#viewRoot").innerHTML, /data-retry/,
    "The home screen must show error and retry, not its ordinary dashboard");

  vault.getJson = async url => {
    if (url.startsWith("/api/trash/")) throw Error("HTTP 503");
    if (url.includes("/api/v2/ui/folders/")) return payload.archive;
    if (url.includes("/ip/")) return payload.ip;
    return [];
  };
  await assert.rejects(vault.loadAll("company"), /回收站加载失败.*503/,
    "Trash errors also must not appear as an empty recycle bin");
  assert.equal(run("ROOT"), oldRoot);

  vault.getJson = async url => {
    if (url.startsWith("/api/trash/")) return [];
    if (url.includes("/api/v2/ui/folders/")) return payload.archive;
    if (url.includes("/ip/")) return payload.ip;
    return [];
  };
  await vault.loadAll("company");
  assert.equal(vault.loading, false);
  assert.equal(vault.error, null);
  assert.ok(run("findById('af:92')"));
  console.log("EXPLORER P1 PASS: mixed archive order, module 500 error, trash 503 error, retry success");
})().catch(e => { console.error(e); process.exitCode = 1; });
