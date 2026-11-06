/* Real settings integrity progress, and MCP default-on smoke. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../wwwroot");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"css/app.css"),"utf8");
const js=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const vault=fs.readFileSync(path.resolve(__dirname,"../Vault.cs"),"utf8");
const api=fs.readFileSync(path.resolve(__dirname,"../VaultIntegrityEndpoints.cs"),"utf8");
for(const id of ["setCheck","setCheckMsg","setCheckProgress","setMcp"])
  assert.ok(html.includes('id="'+id+'"'),"Missing settings element "+id);
assert.match(css,/\.integrity-progress\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
assert.match(css,/prefers-reduced-motion:\s*reduce/);
assert.match(vault,/_db = db; Path = path;_mcpEnabled=true;/,
  "MCP must be enabled when a vault is unlocked, not only checked in the UI");
assert.match(vault,/_mcpEnabled=false;/,
  "Closing a vault must still revoke MCP");
assert.match(api,/PRAGMA integrity_check;/);
assert.match(api,/CommandTimeout=0;/);
assert.match(api,/MapGet\("\/api\/vault\/integrity\/task"/);
assert.match(api,/MapPost\("\/api\/vault\/integrity"/);
assert.ok(!js.includes('getJson("/api/check")'),
  "Settings must not block on the old synchronous HTTP integrity scan");
assert.ok(js.includes('await VaultStore.api("/api/task");'),
  "Reauthentication must not secretly run full integrity scan");

const start=js.indexOf("/* An integrity scan can hold");
const end=js.indexOf("async function startCompact()",start);
assert.ok(start>=0 && end>start,"Missing async integrity UI handlers");
const elements=new Map([
  ["#setCheck",{textContent:"",disabled:false}],
  ["#setCheckMsg",{textContent:"",className:""}],
  ["#setCheckProgress",{hidden:true,attrs:{},setAttribute(k,v){this.attrs[k]=v;}}],
]);
const timers=[], cleared=[], toasted=[];
let status={taskId:"integrity-123456",state:"queued",stage:"等待数据库锁",completedSteps:0,totalSteps:2};
let startFails=false;
const fake={
  token:"vault-session",
  async api(url,options){
    assert.equal(url,"/api/vault/integrity");
    assert.equal(options.method,"POST");
    if(startFails)throw Error("已有后台任务");
    return {async json(){return {taskId:status.taskId};}};
  },
  async getJson(url){
    assert.equal(url,"/api/vault/integrity/task");
    return status;
  },
};
const ctx=vm.createContext({
  $:selector=>elements.get(selector)||null,
  VaultStore:fake,
  toast:message=>toasted.push(message),
  setTimeout:handler=>{timers.push(handler);return timers.length;},
  clearTimeout:id=>cleared.push(id),
});
vm.runInContext(js.slice(start,end),ctx);
const run=code=>vm.runInContext(code,ctx);
(async()=>{
  await run("runIntegrityCheck()");
  await Promise.resolve();
  assert.equal(elements.get("#setCheck").disabled,true);
  assert.equal(elements.get("#setCheckProgress").hidden,false);
  assert.match(elements.get("#setCheckMsg").textContent,/0\/2 阶段/);
  assert.equal(timers.length,1);

  status={...status,state:"running",stage:"正在统计未完成附件",completedSteps:1};
  await run("pollIntegrityCheck()");
  assert.match(elements.get("#setCheckMsg").textContent,/1\/2 阶段/);
  status={...status,state:"succeeded",stage:"完整性检查完成",completedSteps:2,result:"ok",incomplete:0};
  await run("pollIntegrityCheck()");
  assert.equal(elements.get("#setCheckProgress").hidden,true);
  assert.equal(elements.get("#setCheck").disabled,false);
  assert.match(elements.get("#setCheckMsg").textContent,/完整性正常/);
  assert.equal(elements.get("#setCheckMsg").className,"is-ok");
  assert.match(toasted.at(-1),/通过/);

  startFails=true;
  await run("runIntegrityCheck()");
  assert.equal(elements.get("#setCheck").disabled,false);
  assert.equal(elements.get("#setCheckMsg").className,"is-bad");
  assert.match(elements.get("#setCheckMsg").textContent,/已有后台任务/);

  startFails=false;
  status={taskId:"integrity-restored",state:"running",stage:"正在校验加密数据库页面",
    completedSteps:0,totalSteps:2};
  await run("resumeIntegrityCheck()");
  await Promise.resolve();
  assert.equal(elements.get("#setCheckProgress").hidden,false);
  assert.equal(elements.get("#setCheck").disabled,true);
  status={...status,state:"failed",error:"测试失败"};
  await run("pollIntegrityCheck()");
  assert.equal(elements.get("#setCheckProgress").hidden,true);
  assert.equal(elements.get("#setCheckMsg").className,"is-bad");
  assert.match(elements.get("#setCheckMsg").textContent,/测试失败/);
  console.log("INTEGRITY UI PASS: indeterminate progress, server stages, resume, completion, failure, MCP default-on");
})().catch(e=>{console.error(e);process.exitCode=1;});
