/* Explorer F2-05: real delegated drag/drop with single/multi selection and external uploads. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const js=path.resolve(__dirname,"../wwwroot/js");
const interactions=fs.readFileSync(path.join(js,"interactions.js"),"utf8");
const bridge=fs.readFileSync(path.join(js,"bridge.js"),"utf8");
const start=interactions.indexOf("function validAttachmentDrop(source, target, workspace) {");
const end=interactions.indexOf("/* F2 与右键重命名共用",start);
assert.ok(start>=0&&end>start,"Actual delegated drag/drop handlers must be testable");
assert.match(bridge,/async function associateOriginalBatch\(nodes, move = false, directTarget = null\)/);
assert.match(bridge,/function transferFolderBatch\(nodes,move=false,directTarget=null\)/);
assert.match(bridge,/function moveSelectedItems\(nodes,directTarget=null\)/);
assert.match(bridge,/return onSubmit\(\{target:String\(directTarget\.biz\.id\)\}\)/);
assert.match(bridge,/return onSubmit\(\{target:String\(directTarget\.biz\.id\),targetSection:section\}\)/);
assert.doesNotMatch(interactions.slice(start,end),/await associateOriginal\(findById\(sourceId\),true/);

const file=(id,name)=>({id,name,type:"file"});
const a=file("f:12:1","甲.pdf"),b=file("f:13:1","乙.docx");
const folder=(id,name,kind,section,children=[])=>({
 id,name,type:"folder",biz:{id:Number(id.split(":")[1]),kind,section},children});
const sub=folder("af:21","子目录甲","archive_folder","project");
const sub2=folder("af:22","子目录乙","archive_folder","project");
const nested=folder("af:23","甲的下一级","archive_folder","project");
sub.children.push(nested);
const source=folder("p:10","来源项目","project","project",[a,b,sub,sub2]);
const dest=folder("af:11","目标目录","archive_folder","project");
const invalid=folder("af:99","无效类别","archive_folder",null);
const nodes=[a,b,sub,sub2,nested,source,dest,invalid];
const byId=new Map(nodes.map(n=>[n.id,n]));
const parent=new Map([[a.id,source],[b.id,source],[sub.id,source],
 [sub2.id,source],[nested.id,sub]]);
const rows=new Map(nodes.map(n=>[n.id,{
 dataset:{id:n.id},classList:{add(){},remove(){}},
 closest(sel){return sel.includes(".row")?this:null}
}]));
const handlers=new Map(),docHandlers=new Map();
const content={addEventListener(t,f){handlers.set(t,f);},
 querySelectorAll(){return [...rows.values()]}};
let ws="company",busy=false,confirm=true,failure=null,refresh=0;
const transfers=[],uploads=[],toasts=[],prompts=[];
const selection=new Set();
const drive={
 state:{selection,folderId:source.id},
 get selectedItems(){return [...this.state.selection].map(id=>byId.get(id)).filter(Boolean)},
 select(id,mode){
  if(mode==="single")this.state.selection.clear();
  this.state.selection.add(id);
 }
};
const parentOf=id=>parent.get(id)||null;
const sandbox=vm.createContext({
 $:selector=>selector==="#content"?content:null,
 document:{addEventListener(type,fn){docHandlers.set(type,fn)}},
 Drive:drive,
 findById:id=>byId.get(id)||null,findParent:parentOf,
 pathTo:id=>{
  const chain=[];let node=byId.get(id);
  while(node){chain.unshift(node);node=parentOf(node.id)}
  return chain;
 },
 VaultStore:{get ws(){return ws},metaOf:id=>{
  if(id===a.id)return{fileId:101,linkId:201};
  if(id===b.id)return{fileId:102,linkId:202};
  return null;
 }},
 selectionActionTargets:items=>{
  const ids=new Set(items.filter(n=>n.type==="folder").map(n=>n.id));
  return items.filter(n=>!(()=>{let p=parentOf(n.id);
    while(p){if(ids.has(p.id))return true;p=parentOf(p.id)}return false})());
 },
 batchAssociationItems:items=>{
  if(items.some(n=>n.type!=="file"))throw Error("mixed files");
  return items.map(n=>({fileId:n.id===a.id?101:102,linkId:n.id===a.id?201:202}));
 },
 selectedArchiveFolders:items=>{
  if(items.some(n=>n.type!=="folder"||n.biz?.kind!=="archive_folder"))
    throw Error("invalid folders");
  return items;
 },
 fileTaskBusy:()=>busy,
 canUploadFiles:n=>!!n&&n.type==="folder"&&(
  ["project","ip"].includes(n.biz?.kind)||
  n.biz?.kind==="archive_folder"&&!!n.biz?.section),
 askConfirm:async info=>{prompts.push(info);return confirm},
 moveSelectedItems:async(items,target)=>{
  if(failure)throw failure;
  transfers.push({ids:items.map(n=>n.id),target:target.id,ws});
 },
 toast:msg=>toasts.push(String(msg)),
 refreshCurrent:async()=>{refresh++},
 uploadFiles:(files,target)=>uploads.push({files,target:target.id}),
});
vm.runInContext(interactions.slice(start,end),sandbox,{filename:"real-delegated-drag.js"});
vm.runInContext("bindContent()",sandbox);
for(const type of ["dragstart","dragover","drop","dragend"])
 assert.ok(handlers.has(type),"Missing delegated "+type);

function dt(files=[],types=[]){
 const m=new Map();
 return{files,types,effectAllowed:"",dropEffect:"",
  setData(k,v){m.set(k,v)},getData(k){return m.get(k)||""}};
}
function event(type,node,transfer,extra={}){
 let prevented=false,stopped=false;
 const e={target:rows.get(node.id),button:0,dataTransfer:transfer,
  preventDefault(){prevented=true},stopPropagation(){stopped=true},...extra};
 return{value:handlers.get(type)(e),prevented:()=>prevented,stopped:()=>stopped};
}
async function move(sourceNode,targetNode=dest){
 const data=dt();
 const startEvent=event("dragstart",sourceNode,data);
 const over=event("dragover",targetNode,data);
 const drop=event("drop",targetNode,data);
 await drop.value;
 return {data,startEvent,over,drop};
}
(async()=>{
 // A source outside the selection moves only itself, never stale other rows.
 drive.state.selection=new Set([b.id]);
 let x=await move(a);
 assert.equal(x.startEvent.prevented(),false);
 assert.equal(x.over.prevented(),true);
 assert.equal(x.drop.stopped(),true);
 assert.deepEqual(transfers.at(-1).ids,[a.id]);
 assert.deepEqual([...drive.state.selection],[a.id]);

 // Selected files must travel as one immutable batch.
 drive.state.selection=new Set([a.id,b.id]);
 x=await move(a);
 assert.deepEqual(transfers.at(-1).ids,[a.id,b.id]);
 assert.equal(transfers.length,2);
 assert.match(prompts.at(-1).text,/2 个附件/);
 assert.equal(uploads.length,0);

 // Selected ordinary folders also use the batch path.
 drive.state.selection=new Set([sub.id,sub2.id]);
 x=await move(sub);
 assert.equal(x.over.prevented(),true);
 assert.deepEqual(transfers.at(-1).ids,[sub.id,sub2.id]);
 assert.match(prompts.at(-1).text,/2 个文件夹/);

 // Selected parent and child are normalized before movement.
 drive.state.selection=new Set([sub.id,nested.id]);
 await move(sub);
 assert.deepEqual(transfers.at(-1).ids,[sub.id]);
 const movedSoFar=transfers.length;

 // Mixed file/folder selections must never partially move only the dragged row.
 drive.state.selection=new Set([a.id,sub.id]);
 x=await move(a);
 assert.equal(x.startEvent.prevented(),true);
 assert.equal(transfers.length,movedSoFar);
 assert.match(toasts.at(-1),/混合选择/);

 // Neither self nor descendant folders can be drop targets.
 drive.state.selection=new Set([sub.id]);
 x=await move(sub,nested);
 assert.equal(x.over.prevented(),false);
 assert.equal(transfers.length,movedSoFar);
 x=await move(sub,sub);
 assert.equal(transfers.length,movedSoFar);
 // An existing parent is not a useful move target.
 await move(sub,source);
 assert.equal(transfers.length,movedSoFar);

 // A cancelled dialog must not write; a workspace switch rejects the full batch.
 drive.state.selection=new Set([a.id,b.id]);
 confirm=false;await move(a);confirm=true;
 assert.equal(transfers.length,movedSoFar);
 const transfer=dt();event("dragstart",a,transfer);
 ws="personal";
 await event("drop",dest,transfer).value;
 assert.equal(transfers.length,movedSoFar);
 ws="company";
 busy=true;
 x=await move(a);
 assert.equal(x.startEvent.prevented(),true);
 assert.equal(transfers.length,movedSoFar);
 busy=false;

 drive.state.selection=new Set([a.id,b.id]);
 await move(a,invalid);
 assert.equal(transfers.length,movedSoFar);
 const injected=dt();
 event("dragstart",a,injected);
 // Any concurrent source move / association switch cancels the entire snapshot.
 parent.set(b.id,dest);
 await event("drop",dest,injected).value;
 assert.equal(transfers.length,movedSoFar);
 parent.set(b.id,source);

 // One atomic backend rejection must not produce any partial success.
 failure=Error("HTTP 409: target already has one of the selected files");
 await move(a);
 assert.equal(transfers.length,movedSoFar);
 assert.match(toasts.at(-1),/409/);
 assert.equal(refresh,1);
 failure=null;

 // Untrusted text/plain drags are never accepted.
 const foreign=dt([],["text/plain"]);
 foreign.setData("text/plain",a.id);
 await event("drop",dest,foreign).value;
 assert.equal(transfers.length,movedSoFar);

 // External upload still accepts *all* files in a single drop.
 const external=dt([{name:"甲.pdf"},{name:"乙.docx"}],["Files"]);
 const rowDrop=event("drop",dest,external);
 await rowDrop.value;
 assert.equal(rowDrop.stopped(),true);
 assert.equal(uploads.length,1);
 assert.equal(uploads[0].files.length,2);
 assert.equal(uploads[0].target,dest.id);

 const bad=event("drop",invalid,external);
 await bad.value;
 assert.equal(bad.stopped(),true);
 assert.equal(uploads.length,1);
 assert.match(toasts.at(-1),/可上传的文件夹/);
 const page={dataTransfer:external,preventDefault(){}};
 docHandlers.get("drop")(page);
 assert.equal(uploads.length,2,"Blank page still handles one external multi-upload");
 drive.state.folderId="root";
 docHandlers.get("drop")(page);
 assert.equal(uploads.length,2);
 assert.match(toasts.at(-1),/进入文件夹/);
 console.log("EXPLORER F2-05 PASS: selected multi-file/folder drag, mixed rejection, snapshots, rollback dispatch and external batch upload");
})().catch(e=>{console.error(e);process.exitCode=1});
