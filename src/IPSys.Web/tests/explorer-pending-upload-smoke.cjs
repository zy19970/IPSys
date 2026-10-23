/* D-05: exercise real settings recovery handlers without a real database. */
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),
 path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"../../../frontend/explorer");
const src=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const css=fs.readFileSync(path.join(root,"css/app.css"),"utf8");
assert.match(css,/#setPendingUploadCancel\\[hidden\\]\\s*\\{\\s*display:\\s*none/, "Pending action hidden must override .btn display");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
for(const marker of ['id="setPendingUploadMsg"','id="setPendingUploadCancel"'])
 assert.ok(html.includes(marker),"Missing recovery UI element "+marker);
const begin=src.indexOf("let pendingUpload = null;");
const end=src.indexOf("/* 压缩任务进行中时",begin);
assert.ok(begin>0 && end>begin);
const msg={textContent:""},btn={hidden:true,disabled:true};
const toasts=[],deletes=[],statuses=[];
let busy=false,confirmation=true,refresh=0;
const current={pending:{ticket:"TEST-TICKET",workspace:"company",name:"悬挂原件.pdf",size:1234,
 expiresAt:"2026-10-23T08:00:00Z"},writingCount:1};
const vault={token:"live-token",
 getJson:async url=>{assert.equal(url,"/api/v2/files/pending");statuses.push(url);return current;},
 api:async(url,opts)=>{deletes.push({url,method:opts.method});current.pending=null;current.writingCount=0;return {ok:true};}};
const env=vm.createContext({
 console,Date,Number,encodeURIComponent,Error,
 VaultStore:vault,$:id=>id==="#setPendingUploadMsg"?msg:id==="#setPendingUploadCancel"?btn:null,
 fileTaskBusy:()=>busy,fmtSize:n=>n+" B",
 askConfirm:async()=>confirmation,toast:(message,opts)=>toasts.push({message,opts}),
 openSettings:()=>{},paintCompactRow:()=>{refresh++;}});
vm.runInContext(src.slice(begin,end),env);
(async()=>{
 await env.paintPendingUploadRow();
 assert.equal(btn.hidden,false);assert.equal(btn.disabled,false);
 assert.match(msg.textContent,/悬挂原件.pdf/);
 assert.equal(deletes.length,0);
 confirmation=false;
 await env.cancelPendingUpload();
 assert.equal(deletes.length,0,"Cancel dialog must not delete on rejection");
 confirmation=true;busy=true;
 await env.cancelPendingUpload();
 assert.equal(deletes.length,0,"Busy uploads cannot be canceled out of band");
 busy=false;
 await env.cancelPendingUpload();
 assert.deepEqual(deletes,[{url:"/api/v2/files/company/prepared/TEST-TICKET",method:"DELETE"}]);
 assert.equal(btn.hidden,true);assert.equal(btn.disabled,true);
 assert.equal(msg.textContent,"没有待确认上传。");
 assert.equal(refresh,1,"Compaction status must be refreshed after cleanup");
 assert.match(toasts.at(-1).message,/待确认上传已取消/);
 current.writingCount=1;
 await env.paintPendingUploadRow();
 assert.match(msg.textContent,/关闭并重新打开资料库/);
 assert.equal(btn.hidden,true,"Orphaned writing rows must not expose arbitrary delete");
 console.log("EXPLORER PENDING UPLOAD PASS: staged status, safe cancel, busy guard, stale write guidance");
})().catch(e=>{console.error(e);process.exitCode=1;});
