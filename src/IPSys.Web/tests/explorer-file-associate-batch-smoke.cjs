/* F2-03 batch link sharing/moving: selection, one destination, one request. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const base=path.resolve(__dirname,"../wwwroot/js");
const bridge=fs.readFileSync(path.join(base,"bridge.js"),"utf8");
const picker=fs.readFileSync(path.join(base,"folder-picker.js"),"utf8");
const start=bridge.indexOf("/* Multi-file association:");
const end=bridge.indexOf("/* F2-04:",start);
assert.ok(start>=0 && end>start,"Batch frontend must be bundled with bridge");
const item=(id,name,fileId,linkId)=>({id,name,type:"file",biz:{kind:"file"}});
const f11=item("f:11:1","甲.pdf"),v11=item("f:11:2","甲的旧版本.pdf");
const f12=item("f:12:1","乙.docx"),f13=item("f:13:1","丙.md");
const fOther=item("f:11:3","另一关联的甲.pdf");
const folder=(id,name,children)=>({
 id:"af:"+id,name,type:"folder",children,biz:{kind:"archive_folder",id,section:"general"}});
const a=folder(1,"来源甲",[f11,v11,f12]);
const b=folder(2,"来源乙",[f13,fOther]);
const target=folder(3,"最终归档",[]);
const root={id:"root",name:"我的文件",type:"folder",
 children:[{id:"k:general",name:"综合资料",type:"folder",
  children:[a,b,target]}]};
const nodes=[a,b,target,f11,v11,f12,f13,fOther];
const byId=new Map(nodes.map(x=>[x.id,x]));
const parent=new Map([[f11.id,a],[v11.id,a],[f12.id,a],
 [f13.id,b],[fOther.id,b]]);
const metadata={
 "f:11:1":{fileId:11,linkId:111},
 "f:11:2":{fileId:11,linkId:111},
 "f:12:1":{fileId:12,linkId:112},
 "f:13:1":{fileId:13,linkId:113},
 "f:11:3":{fileId:11,linkId:114}
};
const requests=[],dialogs=[],notes=[];
let refresh=0,cleared=0,busy=false,conflict=false;
const store={ws:"company",metaOf:id=>metadata[id],
 async api(url,opts) {
  requests.push({url,opts});
  if(conflict)throw Error("HTTP 409: target already has source original");
  return {ok:true,count:opts.json.items.length};
 }};
const sandbox=vm.createContext({
 ROOT:root,VaultStore:store,UPLOADABLE_KINDS:["archive_folder","project","contract","ip"],
 Drive:{clearSelection:()=>{cleared++;}},
 findParent:id=>parent.get(id)||null,
 findById:id=>byId.get(id)||null,
 pathTo:id=>{const n=byId.get(id);return n?[root,root.children[0],n]:[];},
 catsOf:()=>[{id:"general"}],catIsDir:id=>id==="general",
 fileTaskBusy:()=>busy,toast:msg=>notes.push(msg),
 refreshCurrent:async()=>{refresh++;},
 dialogs
});
vm.runInContext(picker,sandbox,{filename:"folder-picker.js"});
vm.runInContext(`AttachmentFolderPicker.open=function(options) {
  dialogs.push(options);
  return options;
}`,sandbox);
vm.runInContext(bridge.slice(start,end),sandbox,{filename:"bridge-batch.js"});
const call=(nodes,move,target)=>vm.runInContext("associateOriginalBatch",sandbox)(nodes,move,target);
(async()=>{
 await call([f11,v11,f12,f13],false);
 let dialog=dialogs.at(-1);
 assert.ok(dialog,"Batch share should open picker once");
 assert.equal(dialog.fileIds.length,3,"Two historical versions share one LinkId");
 assert.deepEqual([...dialog.sourceFolderIds].sort(),[1,2]);
 const index=vm.runInContext("AttachmentFolderPicker",sandbox)
   .index(root,dialog.sourceFolderId,dialog.sourceFolderIds);
 assert.equal(index.isTarget(index.byFolderId.get(1)),false);
 assert.equal(index.isTarget(index.byFolderId.get(2)),false);
 assert.equal(index.isTarget(index.byFolderId.get(3)),true);
 await dialog.onSubmit({target:"3"});
 let request=requests.at(-1);
 assert.equal(request.url,"/api/v2/files/company/associate-batch");
 assert.deepEqual(JSON.parse(JSON.stringify(request.opts.json)),{
  targetFolderId:3,move:false,
  items:[{fileId:11,linkId:111},{fileId:12,linkId:112},{fileId:13,linkId:113}]
 });
 assert.equal(refresh,1);assert.equal(cleared,1);

 await call([f11,f12],true);
 dialog=dialogs.at(-1);
 await dialog.onSubmit({target:"3"});
 assert.equal(requests.at(-1).opts.json.move,true);
 assert.equal(requests.at(-1).opts.json.items.length,2);

 const before=requests.length;
 await call([f11,fOther],true);
 assert.equal(requests.length,before);
 assert.match(notes.at(-1),/不同关联指向同一原件/);

 await call([f11,a],true);
 assert.equal(dialogs.length,2,"Folder/file mixed selection must not open picker");
 assert.match(notes.at(-1),/不要混选文件夹/);

 await call([f11,f12],true);
 dialog=dialogs.at(-1);
 store.ws="personal";
 await assert.rejects(dialog.onSubmit({target:"3"}),/工作区已变化/);
 assert.equal(requests.length,before);
 store.ws="company";

 await call([f11,f12],false);
 dialog=dialogs.at(-1);
 conflict=true;
 await assert.rejects(dialog.onSubmit({target:"3"}),/HTTP 409/);
 conflict=false;
 assert.equal(refresh,2,"Failure must not refresh as if successful");

 busy=true;const count=dialogs.length;
 await call([f11,f12],false);
 assert.equal(dialogs.length,count,"File task blocks new batch");
 busy=false;
 const beforeDirectDialogs=dialogs.length;
 await call([f11,f12,f13],true,target);
 assert.equal(dialogs.length,beforeDirectDialogs,
   "Direct multi-drag target must not reopen picker");
 assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).opts.json)),{
  targetFolderId:3,move:true,items:[
   {fileId:11,linkId:111},{fileId:12,linkId:112},{fileId:13,linkId:113}]
 });
 assert.equal(requests.at(-1).url,"/api/v2/files/company/associate-batch");
 // A direct folder move uses the same *one-transaction* folder transfer route.
 const transferred=vm.runInContext("transferFolderBatch",sandbox);
 const beforeFolders=dialogs.length;
 await transferred([a,b],true,target);
 assert.equal(dialogs.length,beforeFolders);
 assert.equal(requests.at(-1).url,
   "/api/v2/ui/folders/company/general/transfer-batch");
 assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).opts.json)),{
  targetFolderId:3,targetSection:"general",move:true,items:[1,2]
 });
 const beforeError=requests.length;
 conflict=true;
 await assert.rejects(transferred([a,b],true,target),/HTTP 409/);
 assert.equal(requests.length,beforeError+1,"Failed batch is a single backend request");
 conflict=false;
 assert.equal(dialogs.length,beforeFolders);
 console.log("EXPLORER BATCH DRAG PASS: one file/folder destination, one atomic endpoint per selection");
 console.log("EXPLORER FILE ASSOCIATION BATCH PASS");
})().catch(e=>{console.error(e);process.exitCode=1;});
