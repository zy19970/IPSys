/* F2-06 — real action functions, selection safety, upload scope, refresh. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../wwwroot");
const inter=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const app=fs.readFileSync(path.join(root,"js/app.js"),"utf8");
const css=fs.readFileSync(path.join(root,"css/app.css"),"utf8");
// A fixed-width detail panel must not lay four action buttons in one line.
assert.match(css,/\.detail-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
assert.match(css,/\.detail-actions \.btn\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);

function part(code,begin,end) {
 const a=code.indexOf(begin),b=code.indexOf(end,a+begin.length);
 assert.ok(a>=0&&b>a,"Missing source range: "+begin);
 return code.slice(a,b);
}
const downloads=[],exportedCalls=[],notes=[];
const nodes=[
 {id:"p:1",name:"项目",type:"folder",biz:{kind:"project",id:1}},
 {id:"f:12:1",name:"附件.pdf",type:"file",biz:{kind:"file"}},
 {id:"f:13:1",name:"另一附件.docx",type:"file",biz:{kind:"file"}},
 {id:"f:99:1",name:"旧版本.pdf",type:"file",biz:{kind:"file"}},
 {id:"f:99:2",name:"新版本.pdf",type:"file",biz:{kind:"file"}},
 {id:"p:2",name:"其它项目",type:"folder",biz:{kind:"project",id:2}},
 {id:"af:31",name:"资质甲",type:"folder",biz:{kind:"archive_folder",id:31,section:"certificate"}},
 {id:"af:32",name:"资质乙",type:"folder",biz:{kind:"archive_folder",id:32,section:"certificate"}},
 {id:"t:8",name:"回收条目甲",type:"folder",biz:{kind:"trash",id:8}},
 {id:"t:9",name:"回收条目乙",type:"folder",biz:{kind:"trash",id:9}},
];
const found=new Map(nodes.map(n=>[n.id,n]));
const trash=nodes.filter(n=>n.id.startsWith("t:"));
const selection=new Set(["p:1"]);
const drive={
 state:{selection,view:"files",folderId:"p:1",ready:true,
  query:"",wsPending:null,sortBy:"name",extFilter:null,statusFilter:null},
 get selectedItems(){return [...this.state.selection].map(id=>found.get(id)).filter(Boolean);},
 select(id,mode){if(mode==="single"){this.state.selection=new Set([id]);}},
 render(){},resetSearch(){},clearSelection(){this.state.selection.clear();},
};
const menus=[],deleted=[],recycled=[],dialogs=[],bulkAssociations=[],folderTransfers=[],moves=[];
const sandbox=vm.createContext({
 Drive:drive,VaultStore:{ws:"company",metaOf:id=>({
  "f:12:1":{linkId:12,fileId:12},"f:13:1":{linkId:13,fileId:13},
  "f:99:1":{linkId:99,fileId:99},"f:99:2":{linkId:99,fileId:99}
 }[id])},
 findById:id=>found.get(id)||null,RECYCLE:trash,
 pathTo:id=>id==="f:12:1"?[found.get("p:1"),found.get(id)]:[found.get(id)],
 nodeTag:id=>String(id).split(":")[0],
 isTrashNode:id=>id.startsWith("t:"),fileTaskBusy:()=>false,
 canUploadFiles:n=>!!n&&n.type==="folder"&&
  ["project","contract","ip","archive","general"].includes(n.biz?.kind),
 MI:(id,ico,label)=>'<button data-act="'+id+'">'+label+'</button>',
 showCtx:(x,y,markup,handlers)=>menus.push({markup,handlers}),
 archiveSortAllowed:()=>false,RecordForms:{open:opts=>dialogs.push(opts)},
 icon:()=>"",downloadFile:id=>downloads.push(id),
 exportNodes:items=>exportedCalls.push(Array.from(items,i=>i.id)),
 toast:msg=>notes.push(msg),
 deleteNodes:items=>deleted.push(Array.from(items,i=>i.id)),
 associateOriginalBatch:(items,move)=>bulkAssociations.push({
  ids:Array.from(items,i=>i.id),move}),
 transferFolderBatch:(items,move)=>folderTransfers.push({
  ids:Array.from(items,i=>i.id),move}),
 moveSelectedItems:items=>moves.push(Array.from(items,i=>i.id)),
 recycleAction:(items,op)=>recycled.push({ids:Array.from(items,i=>i.id),op}),
 askConfirm:async()=>true,
});
vm.runInContext(part(inter,"/* 所有批量入口共用目标规范化","function bindCmdbar() {"),sandbox);
vm.runInContext(part(inter,"function showItemMenu(id, x, y) {","function showBlankMenu(x, y) {"),sandbox);
vm.runInContext(part(inter,"function showBlankMenu(x, y) {","/* ---------------- 框选"),sandbox);
const act=cmd=>vm.runInContext(cmd,sandbox);
(async()=>{
 act("downloadNodes([findById('f:12:1')])");
 assert.deepEqual(downloads,["f:12:1"],"Single file downloads directly");
 act("downloadNodes([findById('p:1')])");
 assert.deepEqual(exportedCalls.at(-1),["p:1"],"Folder download uses exporter");
 act("downloadNodes([findById('p:1'),findById('f:12:1')])");
 assert.deepEqual(exportedCalls.at(-1),["p:1"],
  "Selected parent already includes its child; do not duplicate in ZIP");
 drive.state.view="home";
 assert.equal(act("canCreateHere()"),true);
 drive.state.view="files";
 drive.state.folderId="root";
 assert.equal(act("canCreateHere()"),false);
 drive.state.folderId="p:1";
 assert.equal(act("canCreateHere()"),true);
 drive.state.query="搜索";
 assert.equal(act("canCreateHere()"),false);
 drive.state.query="";
 drive.state.folderId="af:40";
 assert.equal(act("canCreateHere()"),true);
 drive.state.folderId="k:ip";
 assert.equal(act("canCreateHere()"),true);
 drive.state.folderId="f:12:1";
 assert.equal(act("canCreateHere()"),false);
 drive.state.folderId="p:1";

 // The row more-button must not delete whichever unrelated row was selected.
 act("showItemMenu('p:2',10,20)");
 assert.deepEqual([...drive.state.selection],["p:2"]);
 menus.at(-1).handlers.delete();
 assert.deepEqual(deleted.at(-1),["p:2"]);
 // Single-file commands are exclusive to the sole selected attachment.
 drive.state.selection=new Set(["f:12:1"]);
 act("showItemMenu('f:12:1',10,20)");
 assert.match(menus.at(-1).markup,/data-act="(?:open|props|newver|assoc|assoc-move)"/);
 assert.match(menus.at(-1).markup,/data-act="newver"/);
 assert.match(menus.at(-1).markup,/data-act="assoc-move"/);
 menus.at(-1).handlers["assoc-move"]();
 assert.deepEqual(moves.at(-1),["f:12:1"],
  "Single-file move also routes through the shared movement entry");

 // Two checked files must offer only full-selection actions, never a hidden
 // write to the last right-clicked file.
 drive.state.selection=new Set(["f:12:1","f:13:1"]);
 act("showItemMenu('f:13:1',10,20)");
 let menu=menus.at(-1);
 assert.deepEqual([...drive.state.selection],["f:12:1","f:13:1"]);
 assert.match(menu.markup,/data-act="download">打包下载<\/button>/);
 assert.match(menu.markup,/data-act="delete">删除<\/button>/);
 assert.doesNotMatch(menu.markup,/data-act="(?:open|props|newver|assoc|assoc-move|rename|copy-record|transfer-record|move-archive|sort-up|sort-down|newcontract)"/);
 assert.match(menu.markup,/data-act="assoc-batch">共享<\/button>/);
 assert.match(menu.markup,/data-act="assoc-move-batch">移动<\/button>/);
 assert.deepEqual(Object.keys(menu.handlers).sort(),
  ["assoc-batch","assoc-move-batch","delete","download"]);
 menu.handlers["assoc-batch"]();
 assert.deepEqual(bulkAssociations.at(-1),{ids:["f:12:1","f:13:1"],move:false});
 menu.handlers["assoc-move-batch"]();
 assert.deepEqual(moves.at(-1),["f:12:1","f:13:1"]);
 menu.handlers.download();
 assert.deepEqual(exportedCalls.at(-1),["f:12:1","f:13:1"]);
 menu.handlers.delete();
 assert.deepEqual(deleted.at(-1),["f:12:1","f:13:1"]);

 // Two checked folders and mixed file/folder selections use the same
 // batch-only menu; one selected folder keeps its own single-item commands.
 drive.state.selection=new Set(["p:1","p:2"]);
 act("showItemMenu('p:2',10,20)");
 menu=menus.at(-1);
 assert.deepEqual([...drive.state.selection],["p:1","p:2"]);
 assert.doesNotMatch(menu.markup,/data-act="(?:open|props|rename|copy-record|transfer-record|newcontract)"/);
 assert.match(menu.markup,/data-act="download">打包下载<\/button>/);
 menu.handlers.delete();
 assert.deepEqual(deleted.at(-1),["p:1","p:2"]);
 // Two checked ordinary folders support full-selection share and move;
 // a single folder keeps dedicated single-item commands.
 drive.state.selection=new Set(["af:31","af:32"]);
 act("showItemMenu('af:31',10,20)");
 menu=menus.at(-1);
 assert.match(menu.markup,/data-act="share-folder-batch">共享<\/button>/);
 assert.match(menu.markup,/data-act="move-folder-batch">移动<\/button>/);
 assert.doesNotMatch(menu.markup,/data-act="(?:rename|share-folder|move-folder|copy-record|transfer-record)"/);
 assert.deepEqual(Object.keys(menu.handlers).sort(),
  ["delete","download","move-folder-batch","share-folder-batch"]);
 menu.handlers["share-folder-batch"]();
 assert.deepEqual(folderTransfers.at(-1),{ids:["af:31","af:32"],move:false});
 menu.handlers["move-folder-batch"]();
 assert.deepEqual(moves.at(-1),["af:31","af:32"]);
 drive.state.selection=new Set(["af:31"]);
 act("showItemMenu('af:31',10,20)");
 menu=menus.at(-1);
 assert.match(menu.markup,/data-act="share-folder"/);
 assert.match(menu.markup,/data-act="move-folder"/);
 assert.doesNotMatch(menu.markup,/data-act="move-archive"/);
 menu.handlers["share-folder"]();
 assert.deepEqual(folderTransfers.at(-1),{ids:["af:31"],move:false});
 menu.handlers["move-folder"]();
 assert.deepEqual(moves.at(-1),["af:31"]);
 drive.state.selection=new Set(["af:31","f:12:1"]);
 act("showItemMenu('af:31',10,20)");
 menu=menus.at(-1);
 assert.deepEqual(Object.keys(menu.handlers).sort(),["delete","download"],
  "Mixed folder and attachment selection cannot share or move in one action");
 assert.doesNotMatch(menu.markup,/data-act="(?:assoc-batch|assoc-move-batch|share-folder-batch|move-folder-batch)"/);
  drive.state.selection=new Set(["p:2","f:12:1"]);
 act("showItemMenu('f:12:1',10,20)");
 menu=menus.at(-1);
 assert.deepEqual(Object.keys(menu.handlers).sort(),["delete","download"]);
 assert.doesNotMatch(menu.markup,/data-act="(?:assoc-batch|assoc-move-batch|share-folder-batch|move-folder-batch)"/);
 menu.handlers.delete();
 assert.deepEqual(deleted.at(-1),["p:2","f:12:1"]);

 // Parent + child is one effective operation. Repeated versions sharing
 // LinkId remain two download versions but only one unlink/delete target.
 drive.state.selection=new Set(["p:1","f:12:1"]);
 act("showItemMenu('f:12:1',10,20)");
 menu=menus.at(-1);
 assert.match(menu.markup,/data-act="delete">删除<\/button>/);
 menu.handlers.delete();
 assert.deepEqual(deleted.at(-1),["p:1"]);
 drive.state.selection=new Set(["f:99:1","f:99:2"]);
 act("showItemMenu('f:99:2',10,20)");
 menu=menus.at(-1);
 assert.match(menu.markup,/data-act="download">打包下载<\/button>/);
 assert.match(menu.markup,/data-act="delete">删除<\/button>/);
 menu.handlers.delete();
 assert.deepEqual(deleted.at(-1),["f:99:1"]);

 // Stale menu actions must never execute in a different workspace.
 const before=deleted.length;
 sandbox.VaultStore.ws="personal";
 menu.handlers.delete();
 assert.equal(deleted.length,before);
 assert.match(notes.at(-1),/工作区已经切换/);
 sandbox.VaultStore.ws="company";

 // A right click on a row outside the selection must replace the selection.
 act("showItemMenu('p:2',10,20)");
 assert.deepEqual([...drive.state.selection],["p:2"]);
 assert.match(menus.at(-1).markup,/data-act="props"/);
 assert.match(menus.at(-1).markup,/data-act="copy-record"/);

 drive.state.selection=new Set(["t:8","t:9"]);
 drive.state.view="recycle";
 act("showItemMenu('t:8',10,20)");
 assert.match(menus.at(-1).markup,/data-act="restore">还原<\/button>/);
 assert.match(menus.at(-1).markup,/data-act="purge">彻底删除<\/button>/);
 assert.deepEqual(Object.keys(menus.at(-1).handlers).sort(),["purge","restore"]);
 menus.at(-1).handlers.purge();
 assert.deepEqual(recycled.at(-1),{ids:["t:8","t:9"],op:"purge"});
 menus.at(-1).handlers.restore();
 assert.deepEqual(recycled.at(-1),{ids:["t:8","t:9"],op:"restore"});
 drive.state.selection=new Set(["p:1"]);
 drive.state.view="files";
 drive.state.folderId="root";
 act("showBlankMenu(10,20)");
 assert.doesNotMatch(menus.at(-1).markup,/data-act="new"/,
  "Virtual root should not pretend to create a business record");
 assert.doesNotMatch(menus.at(-1).markup,/data-act="upload"/);
 drive.state.folderId="p:1";
 act("showBlankMenu(10,20)");
 assert.match(menus.at(-1).markup,/data-act="new"/);
 assert.match(menus.at(-1).markup,/data-act="upload"/);

 // Drive.renderChrome uses exactly the same capability rules as context menus.
 const first=app.indexOf("    const canNew = !locked && canCreateHere();");
 const last=app.indexOf('    $("#btnFilter")?.classList.toggle',first);
 assert.ok(first>0&&last>first);
 const ui=new Map(["btnNew","btnNewSide","btnUpload","btnFilter","btnRefresh"]
  .map(id=>["#"+id,{disabled:false,title:""}]));
 const runChrome=vm.runInContext("(function(s,locked){"+
  "const $=id=>ui.get(id);"+app.slice(first,last)+"})",vm.createContext({
   canCreateHere:()=>act("canCreateHere()"),
   canUploadFiles:n=>!!n&&n.biz?.kind==="project",
   ui,
 }));
 drive.state.folderId="root";
 runChrome.call({currentFolder:{id:"root",type:"folder"}},drive.state,false);
 assert.equal(ui.get("#btnNew").disabled,true);
 assert.equal(ui.get("#btnUpload").disabled,true);
 assert.equal(ui.get("#btnNewSide").disabled,true);
 drive.state.folderId="p:1";
 runChrome.call({currentFolder:nodes[0]},drive.state,false);
 assert.equal(ui.get("#btnUpload").disabled,false);
 assert.equal(ui.get("#btnNew").disabled,false);
 runChrome.call({currentFolder:nodes[0]},drive.state,true);
 assert.equal(ui.get("#btnUpload").disabled,true);


 // The real command bar and detail pane must label actions by verb, not
 // repeat the selected count. Count remains in the selection summary.
 const actionSlice=part(app,"    const n = s.selection.size;","    const allIds = this.sortedItems.map");
 const barElements=new Map(["selbar","selCount","selShare","selMove","selDownload","selDelete"]
  .map(id=>["#"+id,{innerHTML:"",textContent:"",
   classList:{hidden:false,toggle(name,on){if(name==="hidden")this.hidden=on;}}}]));
 const renderActions=vm.runInNewContext("(function(s,locked){const $=id=>ui.get(id);"+
  actionSlice+"})",{ui:barElements,icon:()=>"<svg/>"});
 const renderBar=(items,locked=false)=>{
  renderActions.call({selectedItems:items},
   {selection:new Set(items.map(i=>i.id))},locked);
  return {
   count:barElements.get("#selCount").textContent,
   download:barElements.get("#selDownload").innerHTML,
   share:barElements.get("#selShare").textContent,
   move:barElements.get("#selMove").textContent,
   delete:barElements.get("#selDelete").innerHTML,
   shareHidden:barElements.get("#selShare").classList.hidden,
  };
 };
 let labels=renderBar([found.get("f:12:1"),found.get("f:13:1")]);
 assert.equal(labels.count,"已选择 2 项");
 assert.match(labels.download,/<span>打包下载<\/span>/);
 assert.equal(labels.share,"共享");assert.equal(labels.move,"移动");
 assert.match(labels.delete,/<span>删除<\/span>/);
 assert.equal(labels.shareHidden,false);
 labels=renderBar([found.get("af:31"),found.get("af:32")]);
 assert.equal(labels.share,"共享");assert.equal(labels.move,"移动");
 assert.equal(labels.shareHidden,false);
 labels=renderBar([found.get("f:12:1")]);
 assert.match(labels.download,/<span>下载<\/span>/);
 assert.equal(labels.shareHidden,true);
 labels=renderBar([found.get("t:8"),found.get("t:9")],true);
 assert.match(labels.delete,/<span>彻底删除<\/span>/);
 const detailStart=app.indexOf("  renderDetail() {");
 const detailEnd=app.indexOf("\n  },\n};",detailStart);
 assert.ok(detailStart>=0&&detailEnd>detailStart,"Detail method exists");
 const detailPanel={classList:{toggle(){}}},detailBody={innerHTML:""};
 const detailMethod=vm.runInNewContext("({"+
  app.slice(detailStart,detailEnd)+"\n  }})",{
   $:id=>id==="#detail"?detailPanel:detailBody,
   icon:()=>"<svg/>",fmtSize:()=>"-",esc:x=>x,
  }).renderDetail;
 const renderSelectedDetail=(items,view="files")=>{
  detailMethod.call({state:{detailOpen:true,view},selectedItems:items});
  return detailBody.innerHTML;
 };
 let detailHtml=renderSelectedDetail([found.get("f:12:1"),found.get("f:13:1")]);
 assert.match(detailHtml,/已选择 2 项/);
 for(const [action,label] of [["download","打包下载"],["assoc-batch","共享"],
   ["assoc-move-batch","移动"],["delete","删除"]])
  assert.match(detailHtml,new RegExp('data-detail-act="'+action+'">[^<]*<svg\\/>'
   +label+'<\\/button>'));
 detailHtml=renderSelectedDetail([found.get("af:31"),found.get("af:32")]);
 for(const [action,label] of [["share-folder-batch","共享"],["move-folder-batch","移动"]])
  assert.match(detailHtml,new RegExp('data-detail-act="'+action+'">[^<]*<svg\\/>'
   +label+'<\\/button>'));
 detailHtml=renderSelectedDetail([found.get("t:8"),found.get("t:9")],"recycle");
 assert.match(detailHtml,/data-detail-act="delete"><svg\/>彻底删除<\/button>/);
 assert.doesNotMatch(detailHtml,/data-detail-act="download"/);

 // Reload never changes home into a files view and prunes deleted selections.
 const refreshRange=part(inter,"async function refreshCurrent() {","/* ---------------- 文件下载");
 let storageRefreshes=0;
 const reloadSandbox=vm.createContext({
  Drive:drive,
  VaultStore:{ws:"company",loadAll:async()=>{},refreshStorage:()=>{storageRefreshes++;}},
  findById:id=>found.get(id)||null,
  RECYCLE:trash,
 });
 vm.runInContext(refreshRange,reloadSandbox);
 drive.state.view="home";drive.state.folderId="root";
 drive.state.selection=new Set(["p:1","missing"]);
 await vm.runInContext("refreshCurrent()",reloadSandbox);
 assert.equal(drive.state.view,"home");
 assert.deepEqual([...drive.state.selection],["p:1"]);
 drive.state.view="files";drive.state.folderId="p:1";
 await vm.runInContext("refreshCurrent()",reloadSandbox);
 assert.equal(drive.state.folderId,"p:1");
 drive.state.view="recycle";drive.state.selection=new Set(["t:8"]);
 await vm.runInContext("refreshCurrent()",reloadSandbox);
 assert.equal(drive.state.view,"recycle");
 assert.deepEqual([...drive.state.selection],["t:8"]);
 assert.equal(storageRefreshes,3,"Refresh must request updated whole-vault pages");

 // A modal guard must precede Delete, F2 and Ctrl+A keyboard actions.
 const key=part(inter,"function bindKeyboard() {","/* ---------------- 遮罩层");
 assert.match(key,/formMask/);
 assert.match(key,/confirmMask/);
 assert.match(key,/preview-mask\.show/);
 assert.ok(key.indexOf('$("#formMask")')<key.indexOf('if (e.key === "Delete")'));
 // Detail sidebar defaults open for every viewport unless explicitly disabled.
 // Match the section delimiter, not a newline (Windows checkout uses CRLF).
 const prefsSource=part(app,"const Prefs = {","/* ==========================================================================");
 const init=app.match(/^\s*detailOpen:\s*(.*),\s*$/m);
 assert.ok(init,"Detail default state expression exists");
 const initialDetail=(width,stored)=>vm.runInNewContext(
  prefsSource+"\n"+init[1],{
   window:{innerWidth:width},
   localStorage:{getItem:key=>{assert.equal(key,"ipsys.detail");return stored;}},
  });
 for(const width of [800,1024,1920])
  assert.equal(initialDetail(width,null),true,
   "Detail defaults open even on narrow screens: "+width);
 assert.equal(initialDetail(1920,"0"),false,
  "An explicitly saved closed preference is respected");
 assert.equal(initialDetail(800,"1"),true,
  "An explicitly saved open preference is respected");
 const enterMethod=part(app,"  enterContext() {","  resetSort() {");
 const nav=vm.runInNewContext("({"+enterMethod+"})");
 for(const currentlyOpen of [true,false]){
  const state={detailOpen:currentlyOpen,statusFilter:"已授权",
   ipTypeFilter:"发明专利",extFilter:["pdf"]};
  let sortCalls=0;
  nav.enterContext.call({state,resetSort(){sortCalls++;}});
  assert.equal(state.detailOpen,currentlyOpen,
   "Entering a ledger must preserve the user-chosen detail state");
  assert.equal(state.statusFilter,null);
  assert.equal(state.ipTypeFilter,null);
  assert.equal(state.extFilter,null);
  assert.equal(sortCalls,1);
 }
 assert.match(app,/detailOpen && this.state.view !== "home"/,
  "Homepage continues to use its dedicated dashboard layout");
 // Recycle details must not advertise preview/open while soft-deleted.
 assert.match(app,/locked \? "" : isFolder/);
 console.log("EXPLORER F2-06 PASS: detail default/navigation, row/menu selection, folder exportedCalls, virtual scope, chrome, modal guards and refresh state");
})().catch(err=>{console.error(err);process.exitCode=1;});
