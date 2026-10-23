/* F2-05: exercise actual Explorer event handlers, not only source strings. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const frontend = path.resolve(__dirname,"../../../frontend/explorer");
const interactions = fs.readFileSync(path.join(frontend,"js/interactions.js"),"utf8");
const bridge = fs.readFileSync(path.join(frontend,"js/bridge.js"),"utf8");
const start = interactions.indexOf("function validAttachmentDrop(source, target, workspace) {");
const end = interactions.indexOf("/* F2 与右键重命名共用",start);
assert.ok(start>=0&&end>start,"Actual drag event handler boundary exists");
assert.doesNotMatch(interactions.slice(start,end),/附件移动需要后端支持 link 迁移/);
assert.match(bridge,/async function associateOriginal\(node, move = false, directTarget = null\)/);
assert.match(bridge,/return submitAssociation\(\{ target: String\(directTarget.biz.id\) \}\)/);
const handlers = new Map(), docHandlers = new Map(), calls = [], uploads = [], tips = [];
const attachment = {id:"f:12:1",name:"原件.pdf",type:"file"};
const source = {id:"p:10",name:"来源项目",type:"folder",
 biz:{kind:"project",id:10},children:[attachment]};
const target = {id:"c:11",name:"目标合同",type:"folder",
 biz:{kind:"contract",id:11},children:[]};
const invalid = {id:"af:99",name:"虚拟档案目录",type:"folder",
 biz:{kind:"archive_folder",id:99},children:[]};
const byId = new Map([attachment,source,target,invalid].map(n=>[n.id,n]));
const rows = new Map([...byId.keys()].map(id=>[id,{
 dataset:{id},styles:new Set(),classList:{
  add(name){this._set=this._set||new Set();this._set.add(name);},
  remove(...names){for(const n of names)this._set?.delete(n);},
 },closest(selector){return selector.includes(".row")?this:null},
}]));
const content = {
 addEventListener(type,fn){handlers.set(type,fn);},
 querySelectorAll(){return [...rows.values()]},
};
let workspace="company",busy=false,confirm=true,pendingError=null;
let refreshes=0;
const sandbox = vm.createContext({
 $:id=>id==="#content"?content:null,
 document:{addEventListener(type,fn){docHandlers.set(type,fn);}},
 findById:id=>byId.get(id)||null,
 findParent:id=>id===attachment.id?source:null,
 VaultStore:{get ws(){return workspace;},metaOf:()=>({fileId:101,linkId:12})},
 Drive:{state:{folderId:source.id}},
 fileTaskBusy:()=>busy,
 canUploadFiles:n=>!!n&&n.type==="folder"&&
  ["project","contract","archive","ip","general"].includes(n.biz?.kind),
 askConfirm:async()=>confirm,
 associateOriginal:async(node,move,to)=>{
  if(pendingError)throw pendingError;
  calls.push({node,move,to,workspace});
 },
 toast:(msg)=>tips.push(msg),
 refreshCurrent:async()=>{refreshes++;},
 uploadFiles:(files,folder)=>uploads.push({files,folder}),
});
vm.runInContext(interactions.slice(start,end),sandbox);
vm.runInContext("bindContent()",sandbox);
assert.ok(handlers.has("dragstart")&&handlers.has("dragover")&&
 handlers.has("drop")&&handlers.has("dragend"));
const rowEvent=(type,node,data,extra={})=>{
 let prevented=false,stopped=false;
 const e={
  target:rows.get(node.id),
  button:0,
  dataTransfer:data,
  preventDefault(){prevented=true;},
  stopPropagation(){stopped=true;},
  ...extra,
 };
 return {e,p:handlers.get(type)(e),prevented:()=>prevented,stopped:()=>stopped};
};
function transfer(files=[],types=[]) {
 const payload=new Map();
 return {files,types,effectAllowed:"",dropEffect:"",
  setData(type,val){payload.set(type,val);},
  getData(type){return payload.get(type)||"";}};
}
(async()=>{
 let dt=transfer(),drag=rowEvent("dragstart",attachment,dt);
 assert.equal(drag.prevented(),false);
 assert.equal(dt.effectAllowed,"move");
 assert.ok(dt.getData("application/x-ipsys-link")===attachment.id);
 let over=rowEvent("dragover",target,dt);
 assert.equal(over.prevented(),true,"Valid owner row accepts internal attachment");
 assert.equal(dt.dropEffect,"move");
 let dropped=rowEvent("drop",target,dt);
 await dropped.p;
 assert.equal(dropped.stopped(),true,"Consumed target drop must not bubble to page upload");
 assert.equal(calls.length,1);
 assert.equal(calls[0].move,true);
 assert.equal(calls[0].node,attachment);
 assert.equal(calls[0].to,target);
 assert.equal(uploads.length,0);

 confirm=false;
 dt=transfer();rowEvent("dragstart",attachment,dt);
 await rowEvent("drop",target,dt).p;
 assert.equal(calls.length,1,"Cancel must not issue move request");
 confirm=true;

 dt=transfer();rowEvent("dragstart",attachment,dt);
 workspace="personal";
 await rowEvent("drop",target,dt).p;
 assert.equal(calls.length,1,"Workspace switch must block internal transfer");
 workspace="company";

 busy=true;
 dt=transfer();rowEvent("dragstart",attachment,dt);
 await rowEvent("drop",target,dt).p;
 assert.equal(calls.length,1,"An active file task must block moves");
 busy=false;

 dt=transfer();rowEvent("dragstart",attachment,dt);
 await rowEvent("drop",invalid,dt).p;
 assert.equal(calls.length,1,"Archive navigation directory cannot own an attachment");

 dt=transfer();rowEvent("dragstart",attachment,dt);
 await rowEvent("drop",source,dt).p;
 assert.equal(calls.length,1,"Dropping onto same owner does not move");

 dt=transfer([],["text/plain"]);
 dt.setData("text/plain",attachment.id);
 await rowEvent("drop",target,dt).p;
 assert.equal(calls.length,1,"Foreign text/plain drags are not trusted");

 dt=transfer();rowEvent("dragstart",attachment,dt);
 pendingError=Error("HTTP 409 原件冲突");
 await rowEvent("drop",target,dt).p;
 assert.equal(calls.length,1);
 assert.match(tips.at(-1),/移动附件失败.*409/);
 assert.equal(refreshes,1,"Failed move refreshes authoritative state");
 pendingError=null;

 const realFile={name:"外部资料.pdf"};
 dt=transfer([realFile],["Files"]);
 let external=rowEvent("drop",target,dt);
 await external.p;
 assert.equal(uploads.length,1);
 assert.equal(uploads[0].folder,target);
 assert.equal(external.stopped(),true);
 assert.equal(external.stopped(),true,"Consumed target drop does not bubble to document");

 dt=transfer([realFile],["Files"]);
 const invalidDrop=rowEvent("drop",invalid,dt);
 await invalidDrop.p;
 assert.equal(uploads.length,1,"External file cannot upload to virtual archive directory");
 assert.equal(invalidDrop.stopped(),true,"Invalid row consumes the event instead of uploading elsewhere");
 assert.match(tips.at(-1),/请将文件拖入具体业务记录/);

 dt=transfer([realFile],["Files"]);
 const pageOnly={dataTransfer:dt,defaultPrevented:true,preventDefault(){this.defaultPrevented=true;}};
 docHandlers.get("drop")(pageOnly);
 assert.equal(uploads.length,2,"Already-prevented blank page still uploads into a valid current record");

 sandbox.Drive.state.folderId="root";
 dt=transfer([realFile],["Files"]);
 const invalidPage={dataTransfer:dt,defaultPrevented:true,preventDefault(){}};
 const tipsBefore=tips.length;
 docHandlers.get("drop")(invalidPage);
 assert.equal(uploads.length,2,"Home/category background must not upload");
 assert.equal(tips.length,tipsBefore+1,"Invalid page emits one explanatory toast");
 assert.match(tips.at(-1),/请先进入具体业务记录/);

 sandbox.Drive.state.folderId=source.id;
 busy=true;
 docHandlers.get("drop")({dataTransfer:dt,preventDefault(){}});
 assert.equal(uploads.length,2,"Busy file task must not start another upload");
 busy=false;
 console.log("EXPLORER F2-05 PASS: real drop dispatch, cancel, workspace lock, forbidden targets, 409 and single external upload");
})().catch(e=>{console.error(e);process.exitCode=1;});
