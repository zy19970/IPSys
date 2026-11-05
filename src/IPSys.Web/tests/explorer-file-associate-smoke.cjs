/* F2-03 Explorer shared FileId / distinct LinkId association behavior. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const explorer=path.resolve(__dirname,"../wwwroot");
const bridge=fs.readFileSync(path.join(explorer,"js/bridge.js"),"utf8");
const interactions=fs.readFileSync(path.join(explorer,"js/interactions.js"),"utf8");
const picker=fs.readFileSync(path.join(explorer,"js/folder-picker.js"),"utf8");
const from=bridge.indexOf("async function associateOriginal(node, move = false, directTarget = null) {");
const to=bridge.indexOf("/* ---------------- 导出 ---------------- */",from);
assert.ok(from>=0&&to>from,"Unified attachment association routine must exist");
const assoc=bridge.slice(from,to);
assert.match(interactions,/MI\("assoc",\s*"copy",\s*"共享原件到其它记录"\)/);
assert.match(interactions,/MI\("assoc-move",\s*"move",\s*"移动附件到其它记录"\)/);
assert.match(interactions,/"assoc-move": inWorkspace\(\(\) => moveSelectedItems\(\[item\]\)\)/,
 "Single-file move uses the common dispatcher with workspace validation");
// Verify the real shared icon and context-menu renderer, not just the "move" key.
const icons=fs.readFileSync(path.join(explorer,"js/icons.js"),"utf8");
const iconEnd=icons.indexOf("/* ---------- OneDrive brand mark");
const menuStart=interactions.indexOf("const MI = (");
const menuEnd=interactions.indexOf("function showCtx(",menuStart);
assert.ok(iconEnd>0 && menuStart>=0 && menuEnd>menuStart,"Shared icon and menu renderers exist");
const iconVm=vm.createContext({});
vm.runInContext(icons.slice(0,iconEnd),iconVm,{filename:"icons.js"});
vm.runInContext(interactions.slice(menuStart,menuEnd),iconVm,{filename:"menu.js"});
// Move actions share the same SVG. Folder-specific moves are now distinct
// from independent record transfer and the retired move-archive command.
const moveActions=[
 ["assoc-move","移动附件到其它记录"],
 ["move-folder","移动文件夹到其它目录"],
 ["transfer-record","跨工作区或类别转移"],
 ["transfer-record","移动或跨区转移"],
];
assert.match(interactions,/MI\("assoc-move",\s*"move",\s*"移动附件到其它记录"\)/);
assert.match(interactions,/MI\("move-folder",\s*"move",\s*"移动文件夹到其它目录"\)/);
assert.ok(interactions.includes('MI("transfer-record","move",recordKind==="archive_folder" ? "跨工作区或类别转移" : "移动或跨区转移")'),
 "Record transfer must retain both folder-specific and business labels");
assert.match(interactions,/MI\("move-folder-batch",\s*"move",\s*"移动选中的 "\s*\+/);
assert.doesNotMatch(interactions,/MI\("move-archive",/,"Retired move-archive action must remain absent");
for(const [act,label] of moveActions){
 const html=vm.runInContext("MI("+JSON.stringify(act)+',"move",'+JSON.stringify(label)+")",iconVm);
 assert.match(html,/<svg[^>]*width="18" height="18"[^>]*>[\s\S]*<\/svg>/,
  "Move menu must render a complete 18px SVG: "+act);
 assert.ok(html.includes('data-act="'+act+'"'),"Move action remains wired: "+act);
 assert.ok(html.includes("<span>"+label+"</span>"),"Move menu label renders fully: "+act);
}


const attachment={id:"f:201:2",type:"file",name:"申请书.pdf",biz:{kind:"file",ownerKind:"ip"}};
const ip={id:"i:11",name:"原知识产权",type:"folder",biz:{id:11,kind:"ip"},children:[attachment]};
const project={id:"p:22",name:"目标项目",type:"folder",biz:{id:22,kind:"project"},children:[]};
const projectDir={id:"af:33",name:"项目合同目录",type:"folder",biz:{id:33,kind:"archive_folder",section:"project"},children:[]};
const archiveDir={id:"af:44",name:"归档目录",type:"folder",biz:{id:44,kind:"archive_folder",section:"achievement"},children:[]};
const archive={id:"a:achievement:55",name:"目标资料",type:"folder",biz:{id:55,kind:"archive_folder",section:"achievement"},children:[]};
const general={id:"g:66",name:"综合资料",type:"folder",biz:{id:66,kind:"archive_folder",section:"general"},children:[]};
const category={id:"k:ip",name:"知识产权",type:"folder",children:[ip,project,projectDir,archiveDir,archive,general]};
const ROOT={id:"root",type:"folder",name:"根目录",children:[category]};
const map=new Map([[attachment.id,ip], [ip.id,category],[project.id,category],[projectDir.id,category],
 [archiveDir.id,category],[archive.id,category],[general.id,category],[category.id,ROOT]]);
const pathTo=id=>{
 const find=(node,stack)=>{
  if(node.id===id)return [...stack,node];
  for(const child of node.children||[]){
   const ans=find(child,[...stack,node]);if(ans)return ans;
  }
  return null;
 };
 return find(ROOT,[]);
};
const requests=[],dialogs=[],notes=[];
let refresh=0,clear=0,busy=false,simulate409=false,failRefresh=false;
const workspace={ws:"company",metaOf:()=>({fileId:101,linkId:201,version:2}),
 async api(url,opts){
  requests.push({url,opts});
  if(simulate409)throw Error("HTTP 409：此原件已关联目标文件夹");
  return {ok:true};
 }};
const sandbox=vm.createContext({
 ROOT,VaultStore:workspace,dialogs,
 Drive:{clearSelection:()=>{clear++;}},
 UPLOADABLE_KINDS:["project","archive_folder","ip"],
 findParent:id=>map.get(id)||null,pathTo,findById:id=>pathTo(id)?.at(-1)||null,
 fileTaskBusy:()=>busy,
 refreshCurrent:async()=>{refresh++;if(failRefresh)throw Error("刷新失败");},
 toast:(m)=>notes.push(m),
 walk(node,fn){const visit=n=>{fn(n);for(const c of n.children||[])visit(c);};visit(node);},
});
vm.runInContext(picker,sandbox,{filename:"folder-picker.js"});
// The association regression exercises the exact index and submit callback.
// The chooser's actual DOM navigation is checked in folder-picker-smoke.cjs.
vm.runInContext(`AttachmentFolderPicker.open = function(o) {
  const data = {title:o.move?"移动附件关联":"共享附件原件",
    onSubmit:o.onSubmit,index:this.index(o.root,o.sourceFolderId)};
  dialogs.push(data);
  return data;
}`,sandbox);
vm.runInContext(assoc,sandbox,{filename:"bridge-file-associate.js"});
const invoke=vm.runInContext("associateOriginal",sandbox);

(async()=>{
 await invoke(attachment,false);
 let f=dialogs.at(-1);
 assert.equal(f.title,"共享附件原件");
 const ids=[...f.index.byFolderId.values()].filter(r=>f.index.isTarget(r))
  .map(r=>String(r.folderId));
 assert.deepEqual(Array.from(ids).sort(),["22","33","44","55","66"],
  "Only real project/IP/ordinary-folder destinations");
 assert.ok(f.index.path(f.index.byFolderId.get(33).id).includes("项目合同目录"));
 await f.onSubmit({target:"22"});
 assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))),{
  url:"/api/v2/files/company/101/associate",
  opts:{method:"POST",json:{linkId:201,targetFolderId:22,move:false}}
 });
 assert.equal(refresh,1);assert.equal(clear,1);
 assert.match(notes.at(-1),/已共享/);

 await invoke(attachment,true);
 f=dialogs.at(-1);
 assert.equal(f.title,"移动附件关联");
 await f.onSubmit({target:"33"});
 assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).opts.json)),
  {linkId:201,targetFolderId:33,move:true});
 assert.equal(refresh,2);
 assert.match(notes.at(-1),/已移至/);

 const duplicate={id:"f:301:3",type:"file",name:"相同原件",biz:{kind:"file"}};
 project.children.push(duplicate);
 const initial=requests.length;
 await assert.rejects(f.onSubmit({target:"22"}),/已经关联同一原件/);
 assert.equal(requests.length,initial,"A known duplicate must not issue a write request");
 project.children.pop();

 simulate409=true;
 const beforeRefresh=refresh;
 await assert.rejects(f.onSubmit({target:"22"}),/409/);
 assert.equal(refresh,beforeRefresh,"409 must not refresh or report success");
 simulate409=false;

 workspace.ws="personal";
 await assert.rejects(f.onSubmit({target:"22"}),/工作区已变化/);
 assert.equal(requests.length,initial+1,"Cross-workspace dialog must never submit");
 workspace.ws="company";
 await assert.rejects(f.onSubmit({target:"999"}),/无效/);
 assert.equal(requests.length,initial+1);

 busy=true;
 const beforeDialogs=dialogs.length;
 await invoke(attachment,false);
 assert.equal(dialogs.length,beforeDialogs,"Busy file task cannot open association dialog");
 busy=false;

 failRefresh=true;
 await f.onSubmit({target:"55"});
 assert.equal(requests.length,initial+2);
 assert.match(notes.at(-1),/已提交.*刷新失败/);
 failRefresh=false;

 const projectFile={id:"f:401:1",type:"file",name:"项目附件.pdf",biz:{ownerKind:"project"}};
 project.children.push(projectFile);map.set(projectFile.id,project);
 await invoke(projectFile,false);
 const finalIndex=dialogs.at(-1).index;
 const destinations=[...finalIndex.byFolderId.values()].filter(r=>finalIndex.isTarget(r))
   .map(r=>String(r.folderId));
 assert.ok(!destinations.includes("22"),"Source project must not be offered");
 assert.ok(destinations.includes("11"),"IP target allowed for normal project source");

 // File right-click rename and F2 use the same dedicated one-field dialog.
 // A FileId rename is deliberately different from a per-LinkId display alias.
 assert.match(interactions,/!isFolder\s*\?\s*MI\("rename",\s*"rename",\s*"重命名",\s*"F2"\)/);
 assert.match(interactions,/rename: inWorkspace\(\(\) => renameNode\(item\)\)/);
 assert.match(interactions,/RecordForms\.renameFile\(node\)/);
 assert.match(interactions,/node\?\.type === "folder" \|\| node\?\.type === "file"/);
 const forms=fs.readFileSync(path.join(explorer,"js/forms.js"),"utf8");
 const mcp=fs.readFileSync(path.join(explorer,"../McpLocalExtras.cs"),"utf8");
 assert.match(mcp,/Tool\("update_file_metadata"/);
 assert.match(mcp,/case "update_file_metadata":/);
 assert.match(mcp,/Files\(file\)\+"\/metadata"/);
 const fileRenameRequests=[],fileRenameNotes=[];
 let details={name:"申请书.pdf",description:"原说明",tags:"科研;专利",
   fileNumber:"IP-2026-1",fileDate:"2026-11-05"};
 let renameDialog=null,renameRefreshes=0;
 const renameStore={
   ws:"company",
   metaOf:()=>({fileId:101,linkId:201,version:2}),
   async getJson(url){
     assert.equal(url,"/api/v2/files/company/101");
     return {...details};
   },
   async api(url,opts){
     fileRenameRequests.push({url,opts:JSON.parse(JSON.stringify(opts))});
     details={...details,...opts.json};
     return {ok:true};
   },
 };
 const renameNodeItem={id:attachment.id,type:"file",name:"申请书.pdf",biz:{kind:"file"}};
 const renameCtx=vm.createContext({
   VaultStore:renameStore,
   node:renameNodeItem,
   openRename:config=>{renameDialog=config;},
   toast:msg=>fileRenameNotes.push(msg),
   refreshCurrent:async()=>{renameRefreshes++;},
 });
 vm.runInContext(forms,renameCtx,{filename:"forms.js"});
 vm.runInContext("RecordForms.open = openRename",renameCtx);
 await vm.runInContext("RecordForms.renameFile(node)",renameCtx);
 assert.equal(renameDialog.title,"重命名文件");
 assert.equal(renameDialog.fields.length,1);
 assert.equal(renameDialog.fields[0].key,"name");
 assert.equal(renameDialog.values.name,"申请书.pdf");
 assert.match(renameDialog.fields[0].hint,/共享文件.*FileId/);
 // Another client may change file metadata while the dialog is open:
 // the submit callback must fetch the latest values and preserve them.
 details.description="MCP刚更新的说明";
 await renameDialog.onSubmit({name:"新的申请书.pdf"});
 assert.equal(fileRenameRequests.length,1);
 assert.equal(fileRenameRequests[0].url,"/api/v2/files/company/101/metadata");
 assert.equal(fileRenameRequests[0].opts.method,"PUT");
 assert.deepEqual(fileRenameRequests[0].opts.json,{
   name:"新的申请书.pdf",description:"MCP刚更新的说明",
   tags:"科研;专利",fileNumber:"IP-2026-1",fileDate:"2026-11-05",
 });
 assert.equal(renameRefreshes,1);
 assert.match(fileRenameNotes.at(-1),/重命名/);
 const beforeRename=fileRenameRequests.length;
 await renameDialog.onSubmit({name:"新的申请书.pdf"});
 assert.equal(fileRenameRequests.length,beforeRename,"No-op rename must not write");
 // Only the current association may have an independent display alias.
 renameNodeItem.name="当前位置别名.pdf";
 await vm.runInContext("RecordForms.renameFile(node)",renameCtx);
 assert.match(renameDialog.fields[0].hint,/关联显示名.*LinkId/);
 renameStore.ws="personal";
 await assert.rejects(renameDialog.onSubmit({name:"改名.pdf"}),/工作区已切换/);
 assert.equal(fileRenameRequests.length,beforeRename,
   "A stale rename dialog cannot write into another workspace");
 renameStore.ws="company";
 console.log("EXPLORER FILE RENAME PASS: menu/F2, FileId rename, preserved metadata, shared alias and workspace guard");

 console.log("EXPLORER F2-03 PASS: shared/moved LinkId, target scopes, duplicate, 409, workspace and task locks");
})().catch(e=>{console.error(e);process.exitCode=1;});
