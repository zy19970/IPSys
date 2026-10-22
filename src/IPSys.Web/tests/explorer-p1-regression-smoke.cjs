/* Explorer P1: server-backed mixed archive order and explicit load failures.
   Execute actual store/app functions in VM with mock network and DOM. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const shell = path.resolve(__dirname, "../../../frontend/explorer");
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
    ],
    archives: [
      { id: 90, name: "第一资料", section: "achievement", folderId: 70, position: 1 },
      { id: 91, name: "第二资料", section: "achievement", folderId: 70, position: 2 },
      { id: 92, name: "三级资料", section: "achievement", folderId: 72, position: 0 },
    ],
    general: [], files: [],
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
  Array.from(run("pathTo('a:achievement:92')"), x => x.id),
  ["root", "k:achievement", "af:70", "af:71", "af:72", "a:achievement:92"],
  "An archive record must remain inside its complete directory path",
);
assert.deepEqual(
  Array.from(run("findById('af:70').children"), x => x.id),
  ["a:achievement:91", "af:71", "a:achievement:90"],
  "Folder and record siblings must retain the authoritative mixed order",
);

run("Drive.state.view='files';Drive.state.folderId='af:70';Drive.enterContext();");
assert.equal(run("Drive.state.sortBy"), "position");
assert.deepEqual(
  Array.from(run("Drive.sortedItems"), x => x.id),
  ["a:achievement:91", "af:71", "a:achievement:90"],
  "The view must not put folders first or override stored position",
);
run("Drive.state.sortBy='_name';");
assert.equal(run("Drive.sortedItems.length"), 3,
  "Explicit column sorting must keep all three mixed entries");
run("Drive.state.folderId='k:project';Drive.enterContext();");
assert.equal(run("Drive.state.sortBy"), "name",
  "Manual archive sort must not leak into other modules");
run("Drive.state.folderId='af:70';Drive.enterContext();");
assert.equal(run("Drive.state.sortBy"), "position",
  "Reopening archive must restore persistent order");

(async () => {
  const oldRoot = run("ROOT");
  const vault = run("VaultStore");
  vault.getJson = async url => {
    if (url.includes("/archive/")) throw Error("HTTP 500");
    return [];
  };
  await assert.rejects(vault.loadAll("company"), /业务档案加载失败.*500/);
  assert.match(vault.error, /业务档案加载失败/);
  assert.equal(vault.loading, false);
  assert.equal(run("ROOT"), oldRoot,
    "One failed endpoint cannot replace existing data with empty records");
  assert.ok(run("findById('a:achievement:92')"),
    "The old record remains intact on load failure");

  run("Drive.state.ready=false;Drive.state.view='home';Drive.state.loadError=VaultStore.error;");
  run("Drive.renderContent()");
  assert.match(els.get("#viewRoot").innerHTML, /读取失败/);
  assert.match(els.get("#viewRoot").innerHTML, /业务档案加载失败/);
  assert.match(els.get("#viewRoot").innerHTML, /data-retry/,
    "The home screen must show error and retry, not its ordinary dashboard");

  vault.getJson = async url => {
    if (url.startsWith("/api/trash/")) throw Error("HTTP 503");
    if (url.includes("/archive/")) return payload.archive;
    if (url.includes("/ip/")) return payload.ip;
    return [];
  };
  await assert.rejects(vault.loadAll("company"), /回收站加载失败.*503/,
    "Trash errors also must not appear as an empty recycle bin");
  assert.equal(run("ROOT"), oldRoot);

  vault.getJson = async url => {
    if (url.startsWith("/api/trash/")) return [];
    if (url.includes("/archive/")) return payload.archive;
    if (url.includes("/ip/")) return payload.ip;
    return [];
  };
  await vault.loadAll("company");
  assert.equal(vault.loading, false);
  assert.equal(vault.error, null);
  assert.ok(run("findById('a:achievement:92')"));
  console.log("EXPLORER P1 PASS: mixed archive order, module 500 error, trash 503 error, retry success");
})().catch(e => { console.error(e); process.exitCode = 1; });
