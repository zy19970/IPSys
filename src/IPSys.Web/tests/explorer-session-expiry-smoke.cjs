/* D-01: run real Explorer store + lock-screen handlers under Node VM.
   No SQLCipher database, Windows session or online service required. */
"use strict";
const assert=require("node:assert/strict"), fs=require("node:fs");
const path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"../wwwroot/js");
const storeText=fs.readFileSync(path.join(root,"store.js"),"utf8");
const ui=fs.readFileSync(path.join(root,"interactions.js"),"utf8");
const bridge=fs.readFileSync(path.join(root,"bridge.js"),"utf8");
function part(a,b){const i=ui.indexOf(a),j=ui.indexOf(b,i+a.length);
 assert.ok(i>=0&&j>i,"Missing live handler "+a);return ui.slice(i,j);}
const classes=()=>{const v=new Set();return {add:x=>v.add(x),
 remove:x=>v.delete(x),contains:x=>v.has(x)};};
const elements=new Map();
for(const id of ["#lockScreen","#appShell","#lockForm","#switchLockMode",
 "#lockHeading","#lockSub","#lockHint","#createConfirmField",
 "#confirmPassword","#password","#dbPath","#submitOpen"]){
 elements.set(id,{classList:classes(),disabled:false,hidden:id==="#createConfirmField",
 value:"",textContent:"",addEventListener(){},setAttribute(k,v){if(k==="hidden")this.hidden=true;else this[k]=v;}});
}
const storage=new Map([["od-token","old-token"],["od-db","vault.db"]]);
const state={ready:true,wsPending:null,loadError:null,selection:new Set(["p:1"]),searchSerial:0};
const drive={state,resetSearch(){state.searchSerial++;}};
const calls={hide:0,settings:0,confirm:0};
let transport=async()=>({ok:true,status:200,json:async()=>({})});
const env=vm.createContext({console,Headers,Error,Promise,Map,Set,Date,
 fetch:(...a)=>transport(...a),
 sessionStorage:{removeItem:k=>storage.delete(k),setItem:(k,v)=>storage.set(k,v),
 getItem:k=>storage.get(k)||null},
 $:k=>elements.get(k)||null,Drive:drive,
 hideCtx:()=>calls.hide++,closeSettings:()=>calls.settings++,
 settleConfirm:()=>calls.confirm++,_resolveConfirm:null});
vm.runInContext(storeText,env);
vm.runInContext(part("function handleSessionExpired() {","async function startSession()")+
 part("function showLogin(hint) {","function defaultWorkspace()")+
 part("function bindLockScreen() {","function bindWorkspaceSwitch()"),env);
const vault=vm.runInContext("VaultStore",env);
vault.onSessionExpired=env.handleSessionExpired;
env.bindLockScreen();
const r=(status,error)=>({ok:status>=200&&status<300,status,
 json:async()=>error?{error}:{}});
const deferred=()=>{let resolve;const promise=new Promise(f=>resolve=f);return {resolve,promise};};
(async()=>{
 vault.token="old-token";vault.locked=false;
 elements.get("#submitOpen").disabled=true;
 elements.get("#password").value="do-not-leak";
 const d1=deferred(),d2=deferred();let count=0;
 transport=()=>++count===1?d1.promise:d2.promise;
 const a=vault.api("/api/v2/search/company").catch(e=>e.message);
 const b=vault.api("/api/v2/ui/projects/company").catch(e=>e.message);
 d1.resolve(r(401,"未授权"));assert.match(await a,/未授权/);
 assert.equal(vault.token,"");assert.equal(vault.locked,true);
 assert.equal(storage.has("od-token"),false);assert.equal(storage.has("od-db"),false);
 assert.equal(elements.get("#lockScreen").classList.contains("show"),true);
 assert.equal(elements.get("#appShell")["aria-hidden"],"true");
 assert.equal(elements.get("#submitOpen").disabled,false);
 assert.equal(elements.get("#password").value,"");
 assert.match(elements.get("#lockHint").textContent,/登录已失效/);
 assert.equal(state.ready,false);assert.equal(state.searchSerial,1);
 const firstCount=calls.hide;
 d2.resolve(r(401));await b;
 assert.equal(calls.hide,firstCount,"Duplicate 401 must not enter handler twice");
 // A response from the previous session may arrive after a new password login.
 vault.token="new-token";vault.locked=false;
 const old401=deferred();transport=()=>old401.promise;
 const delayed=vault.api("/api/check").catch(e=>e.message);
 vault.token="newer-token";old401.resolve(r(401));await delayed;
 assert.equal(vault.token,"newer-token");
 assert.equal(calls.hide,firstCount);
 const old200=deferred();transport=()=>old200.promise;
 const oldRead=vault.api("/api/v2/ui/projects/company").catch(e=>e.message);
 vault.token="latest-token";old200.resolve(r(200));
 assert.match(await oldRead,/会话已变更/);
 transport=()=>r(409,"文件任务执行中");
 assert.match(await vault.api("/api/lock").catch(e=>e.message),/文件任务/);
 assert.equal(vault.token,"latest-token","409 must not force a login");
 vault.token="";vault.locked=true;
 transport=()=>r(200);
 vault.getJson=async()=>({unlocked:true,suggestion:"C:\\QA\\vault.db"});
 env.showLogin("请重新连接");
 await Promise.resolve();await Promise.resolve();
 assert.equal(vault.needsResume,true);
 assert.equal(elements.get("#submitOpen").textContent,"重新连接");
 assert.equal(elements.get("#submitOpen").disabled,false);
 assert.equal(elements.get("#dbPath").disabled,true);
 assert.equal(elements.get("#createConfirmField").hidden,true);
 assert.equal((bridge.match(/VaultStore\.expireSession\(requestToken\)/g)||[]).length,2,
  "XHR and purge must use the shared token guard");
 assert.ok(!bridge.includes("VaultStore.locked = true"),
  "No second session-expiry state machine in bridge");
 console.log("EXPLORER SESSION EXPIRY PASS: 401 lock screen, concurrent/late auth, stale success, 409, resume controls, XHR/purge");
})().catch(e=>{console.error(e);process.exitCode=1;});
