/* Release reminder: offline-safe browser contract and explicit user click. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../wwwroot");
const html = fs.readFileSync(path.join(root,"index.html"),"utf8");
const src = fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const server = fs.readFileSync(path.resolve(__dirname,"../UpdateCheck.cs"),"utf8");
const project = fs.readFileSync(path.resolve(__dirname,"../IPSys.Web.csproj"),"utf8");
const publish = fs.readFileSync(path.resolve(__dirname,"../../../.github/workflows/publish-release.yml"),"utf8");
for (const id of ["setUpdate","setUpdateMsg","setFootMeta"])
  assert.ok(html.includes('id="'+id+'"'),"Missing update settings element "+id);
assert.ok(src.includes("void checkForUpdates(false)"),"Login must invoke optional auto-check");
assert.ok(src.includes('checkForUpdates(true)'),"Settings must force a manual check");
assert.ok(!src.includes("资料库 Web 0.9"),"Version must not be hardcoded");
assert.ok(server.includes("TimeSpan.FromHours(24)") &&
          server.includes("https://api.github.com/repos/zy19970/IPSys/releases?per_page=30") &&
          server.includes("Registry.CurrentUser") &&
          server.includes("vault.Allowed(ctx)"),"Backend update throttling and authorization missing");
assert.ok(project.includes('0.0.0-dev'),"Local builds must be marked as development");
assert.ok(publish.includes("-p:Version=$productVersion"),
  "Published EXEs must contain their actual version");

const start = src.indexOf("/* Lightweight, opt-in release navigation.");
const end = src.indexOf("let _resolveConfirm = null;",start);
assert.ok(start>=0 && end>start,"Cannot isolate update UI handlers");
const values = new Map();
for (const id of ["#setUpdate","#setUpdateMsg","#setFootMeta"])
  values.set(id,{textContent:"",disabled:false});
const messages=[], opened=[];
let nextResult, throwNext = false;
const vault = {
  token:"session-token",ws:"personal",
  async api(url) {
    assert.ok(url === "/api/update/check" || url === "/api/update/check?force=1");
    if (throwNext) throw Error("offline");
    return {async json(){return nextResult;}};
  },
};
const context=vm.createContext({
  $:selector=>values.get(selector)||null,
  VaultStore:vault,
  toast:(message,opts)=>messages.push({message,opts}),
  window:{open:(...args)=>opened.push(args)},
});
vm.runInContext(src.slice(start,end),context);
const call=js=>vm.runInContext(js,context);
(async()=>{
  nextResult={ok:true,supported:true,currentVersion:"0.9.3-rc.1",
    latestVersion:"v0.9.3-rc.1",updateAvailable:false,notify:false,message:"当前已经是最新版本。"};
  await call("checkForUpdates(false)");
  assert.equal(messages.length,0,"Automatic check must be silent when current");
  assert.match(values.get("#setFootMeta").textContent,/个人工作区 · 版本 v0.9.3-rc.1/);
  assert.equal(values.get("#setUpdate").disabled,false);
  await call("checkForUpdates(true)");
  assert.match(messages.at(-1).message,/最新版本/);

  nextResult={ok:true,supported:true,currentVersion:"0.9.3-rc.1",
    latestVersion:"v0.9.4",updateAvailable:true,notify:true,
    releaseUrl:"https://github.com/zy19970/IPSys/releases/tag/v0.9.4"};
  const before=messages.length;
  await call("checkForUpdates(false)");
  assert.equal(messages.length,before+1,"Automatic check should show an available release");
  messages.at(-1).opts.onAction();
  assert.equal(opened.length,1);
  assert.equal(opened[0][0],"https://github.com/zy19970/IPSys/releases/tag/v0.9.4");
  assert.equal(opened[0][2],"noopener,noreferrer");
  await call('openOfficialRelease("https://example.com/phishing")');
  assert.equal(opened.length,1,"Never open untrusted update URLs");
  nextResult.releaseUrl="https://example.com/phishing";
  await call("checkForUpdates(true)");
  assert.equal(messages.length,before+1,"Invalid release links must not be shown");

  nextResult={ok:false,supported:true,currentVersion:"0.9.3-rc.1",
    updateAvailable:false,notify:false,message:"无法连接 GitHub"};
  await call("checkForUpdates(false)");
  assert.equal(messages.length,before+1,"Offline automatic checks must be silent");
  await call("checkForUpdates(true)");
  assert.match(messages.at(-1).message,/无法连接 GitHub/);
  assert.equal(messages.at(-1).opts.tone,"error");

  nextResult={ok:true,supported:false,currentVersion:"0.0.0-dev",
    updateAvailable:false,notify:false,message:"当前为开发构建"};
  const oldCount=messages.length;
  await call("checkForUpdates(false)");
  assert.equal(messages.length,oldCount,"Development auto-check must be silent");
  await call("checkForUpdates(true)");
  assert.match(messages.at(-1).message,/开发构建/);
  assert.equal(values.get("#setUpdate").disabled,false);

  throwNext=true;
  const beforeOffline=messages.length;
  await call("checkForUpdates(false)");
  assert.equal(messages.length,beforeOffline);
  await call("checkForUpdates(true)");
  assert.match(messages.at(-1).message,/offline/);
  assert.equal(values.get("#setUpdate").disabled,false);
  console.log("UPDATE REMINDER UI PASS: manual/automatic, release links, dev build and offline");
})().catch(e=>{console.error(e);process.exitCode=1;});
