/* IPSys: common file/record update-time display and API contract. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const src=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(src,p),"utf8");
const store=read("wwwroot/js/store.js");
const app=read("wwwroot/js/app.js");
const schema=read("ResourceSchemaV2.cs");
const vault=read("Vault.cs");
const apiPaths=[
  "NativeArchiveUiEndpoints.cs",
  "NativeIpUiEndpoints.cs",
  "NativeProjectContractUiEndpoints.cs"
];
const apis=apiPaths.map(read);

const start=store.indexOf("const toTs = (s) => {");
const end=store.indexOf("/* ---------------- 分类目录",start);
assert.ok(start>=0 && end>start, "store time parser must exist");
const context=vm.createContext({});
vm.runInContext(store.slice(start,end),context);
const ts=val=>vm.runInContext("toTs("+JSON.stringify(val)+")",context);
assert.equal(ts("2026-11-02T00:12:13Z"),Date.parse("2026-11-02T00:12:13Z"));
assert.equal(ts("2026-11-02 00:12:13"),Date.parse("2026-11-02T00:12:13Z"),
  "SQLite UTC timestamps must not be parsed as local wall clock time");
assert.equal(ts(""),null);
assert.equal(ts(null),null);
assert.equal(ts("not a date"),null);

assert.match(app, /data-sort="mtime">更新时间/);
assert.ok(app.includes('class="col-date">${fmtDate(it.mtime)}'),
  "all ordinary file/folder rows must use actual node timestamps");
assert.ok(!app.includes("isFolder && it.dateLabel"),
  "business date must not override the actual update timestamp");
assert.match(store,/mtime:\s*toTs\(f\.modifiedAt\)/,
  "file nodes should take per-version backend time");
/* A02/N2：资料/综合资料已是普通文件夹，只保留真实存在的映射来源。 */
for(const symbol of ["c","p","row","f"]){
  assert.ok(store.includes("toTs("+symbol+".modifiedAt)"),
    "missing folder/record timestamp mapping "+symbol);
}
assert.ok(store.includes("node.mtime = times.length ? Math.max(...times) : null;"),
  "folder and record update time must account for latest contained file");
assert.ok(!store.includes("node.mtime = toTs(applicationDate)"),
  "IP application date is not a modification timestamp");
assert.ok(!store.includes("node.mtime = toTs(p.endDate || p.startDate)"),
  "project business dates are not modification timestamps");
assert.ok(!store.includes("node.mtime = toTs(a.year)"),
  "archive business year must not be a modification timestamp");

assert.match(schema,/modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP/,
  "new V2 folders have real update time");
assert.match(schema,/ALTER TABLE folders ADD COLUMN modified_at TEXT/,
  "existing V2 DBs must receive additive migration");
assert.match(schema,/CREATE TRIGGER IF NOT EXISTS folder_modified_business/,
  "record edits must touch the modification time");
assert.match(schema,/CREATE TRIGGER IF NOT EXISTS folder_modified_link_insert/,
  "file associations must touch the owning folder");
assert.match(schema,/CREATE TRIGGER IF NOT EXISTS folder_modified_version_insert/,
  "new versions must touch shared owners");
assert.match(vault,/ResourceSchemaV2\.EnsureFolderModifiedTimes\(db\)/);
assert.ok(apis.every(s=>s.includes("modifiedAt=version.CreatedAt")),
  "all three business view APIs must return version created_at");
assert.ok(apis.every(s=>s.includes("modifiedAt=")),
  "all business view APIs must expose record timestamps");
const archive=apis[0];
// A02/N2: records and directories are one table, so one timestamp source covers
// the whole module. The requirement is that both times are really exposed.
assert.ok(archive.includes("modifiedAt=row.ModifiedAt") &&
          archive.includes("createdAt=row.CreatedAt"),
  "archive/general records and recursive directories require timestamps");
console.log("MODIFICATION TIME SMOKE PASS: V2 additive schema, latest version timestamps, UTC, all business views");
