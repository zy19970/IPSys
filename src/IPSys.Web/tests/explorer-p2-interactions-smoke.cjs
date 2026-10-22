/* Explorer third-batch regressions: safe serial trash batching and real UI actions. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../../../frontend/explorer");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const bridge=read("js/bridge.js"),inter=read("js/interactions.js"),app=read("js/app.js");
const html=read("index.html");
assert.ok(!html.includes('id="btnPinFolder"'),"Do not advertise nonfunctional pin button");
assert.ok(!app.includes('data-page-act="upload"'),"Home cannot import files without a record");

function between(code,start,end){
 const a=code.indexOf(start),b=code.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"Extract source "+start);
 return code.slice(a,b);
}
const batchSource=between(bridge,"async function waitPurgeIdle()","/* 刷新页面或重进回收站时");
const messages=[],posts=[];
const elements=new Map();
const panel={hidden:true,querySelector(sel){
 if(!elements.has(sel))elements.set(sel,{hidden:false,textContent:"",removeAttribute(){},value:0});
 return elements.get(sel);
}};
let successes=0,idleCalls=0,refreshes=0,selectedClears=0;
const engine=vm.createContext({
 console,Set,Map,Error,Promise,
 purgeBatchActive:false,purgeTaskActive:false,
 purgePanel:()=>panel,
 VaultStore:{
  ws:"company",
  api:async(url,req)=>{
   assert.equal(url,"/api/trash/company/purge-task");
   assert.equal(req.method,"POST");
   assert.ok(req.json.items.length>0&&req.json.items.length<=200);
   posts.push(req.json.items.map(x=>x.id));
   return {json:async()=>({taskId:"task-"+posts.length})};
  },
  getJson:async()=>{idleCalls++;return {active:false};}
 },
 trackPurge:async()=>({state:++successes===2&&failSecond?"failed":"succeeded",error:"模拟失败"}),
 refreshCurrent:async()=>{refreshes++;},
 Drive:{clearSelection:()=>{selectedClears++;}},
 toast:(msg)=>messages.push(msg),
 setTimeout:()=>{throw Error("No sleep needed with idle task");},
});
let failSecond=false;
vm.runInContext(batchSource,engine);
const nodes=Array.from({length:403},(_,i)=>({biz:{raw:{kind:"v2_file",id:i+1,section:""}}}));
(async()=>{
 await vm.runInContext("purgeTrash",engine)(nodes);
 assert.deepEqual(posts.map(x=>x.length),[200,200,3],"Unbounded clear must split into <=200 batches");
 assert.equal(idleCalls,2,"Next task waits for preceding task lock release");
 assert.equal(refreshes,1,"Refresh once after all batches complete");
 assert.equal(selectedClears,1);
 assert.match(messages.at(-1),/已彻底删除 403 条/);
 posts.length=0;messages.length=0;idleCalls=0;refreshes=0;successes=0;
 failSecond=true;
 await vm.runInContext("purgeTrash",engine)(nodes);
 assert.deepEqual(posts.map(x=>x.length),[200,200],"Failure stops the third batch");
 assert.equal(refreshes,1,"Refresh the authoritative recycle list after partial failure");
 assert.match(messages.at(-1),/已确认删除 200 \/ 403/);

 const rename=between(inter,"function renameNode(node) {","function showItemMenu");
 let edit=null,modal=null,put=null;
 const ux=vm.createContext({
 RecordForms:{
  edit:node=>{edit=node;},
  open:args=>{modal=args;}
 },
 VaultStore:{api:async(url,req)=>{put={url,req};}},
 toast:()=>{},
 refreshCurrent:async()=>{}
 });
 vm.runInContext(rename,ux);
 const record={id:"p:7",name:"旧项目",type:"folder",biz:{kind:"project",id:7}};
 vm.runInContext("renameNode",ux)(record);
 assert.equal(edit,record,"Business F2 must open actual edit form");
 const folder={id:"af:8",name:"旧目录",type:"folder",
  biz:{kind:"archive_folder",id:8,parentId:1,isSystem:false}};
 vm.runInContext("renameNode",ux)(folder);
 assert.equal(modal.title,"重命名目录");
 await modal.onSubmit({name:"新目录"});
 assert.equal(put.url,"/api/v2/folders/company/archive_folder/8");
 assert.equal(put.req.method,"PUT");
 assert.deepEqual(JSON.parse(JSON.stringify(put.req.json)),
  {archiveFolder:{name:"新目录",parentId:1}});

 const pick=between(inter,"function canUploadFiles(node) {","function uploadFiles(files, node)");
 let creates=0,clicks=0,lastMsg="";
 const upload=vm.createContext({
 Drive:{state:{folderId:"root"}},
 findById:id=>id==="root"?{id:"root",type:"folder"}:
  {id:"p:7",type:"folder",biz:{kind:"project"}},
 toast:msg=>{lastMsg=msg;},
 document:{createElement:()=>{creates++;return {
  type:"",multiple:false,addEventListener(){},click(){clicks++;}
 };}},
 uploadFiles:()=>{},
 });
 vm.runInContext(pick,upload);
 await vm.runInContext("pickFiles()",upload);
 assert.equal(creates,0,"Root must not open file picker");
 assert.match(lastMsg,/具体业务记录/);
 vm.runInContext('Drive.state.folderId="p:7";pickFiles()',upload);
 assert.equal(clicks,1,"A real business record can open the picker");
 console.log("EXPLORER P2 PASS: 403 serial purge, failed-batch stop, F2 rename, safe upload target, no false pin");
})().catch(e=>{console.error(e);process.exitCode=1;});
