/* F2-06 — real action functions, selection safety, upload scope, refresh. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../wwwroot");
const inter=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const app=fs.readFileSync(path.join(root,"js/app.js"),"utf8");
function part(code,begin,end) {
 const a=code.indexOf(begin),b=code.indexOf(end,a+begin.length);
 assert.ok(a>=0&&b>a,"Missing source range: "+begin);
 return code.slice(a,b);
}
const downloads=[],exportedCalls=[],notes=[];
const nodes=[
 {id:"p:1",name:"项目",type:"folder",biz:{kind:"project",id:1}},
 {id:"f:12:1",name:"附件.pdf",type:"file",biz:{kind:"file"}},
 {id:"p:2",name:"其它项目",type:"folder",biz:{kind:"project",id:2}},
 {id:"t:8",name:"回收条目甲",type:"folder",biz:{kind:"trash",id:8}},
 {id:"t:9",name:"回收条目乙",type:"folder",biz:{kind:"trash",id:9}},
];
const found=new Map(nodes.map(n=>[n.id,n]));
const trash=nodes.slice(3);
const selection=new Set(["p:1"]);
const drive={
 state:{selection,view:"files",folderId:"p:1",ready:true,
  query:"",wsPending:null,sortBy:"name",extFilter:null,statusFilter:null},
 get selectedItems(){return [...this.state.selection].map(id=>found.get(id)).filter(Boolean);},
 select(id,mode){if(mode==="single"){this.state.selection=new Set([id]);}},
 render(){},resetSearch(){},clearSelection(){this.state.selection.clear();},
};
const menus=[],deleted=[],recycled=[],dialogs=[];
const sandbox=vm.createContext({
 Drive:drive,VaultStore:{ws:"company"},
 findById:id=>found.get(id)||null,RECYCLE:trash,
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
 recycleAction:(items,op)=>recycled.push({ids:Array.from(items,i=>i.id),op}),
 askConfirm:async()=>true,
});
vm.runInContext(part(inter,"/* 下载入口共用","function bindCmdbar() {"),sandbox);
vm.runInContext(part(inter,"function showItemMenu(id, x, y) {","function showBlankMenu(x, y) {"),sandbox);
vm.runInContext(part(inter,"function showBlankMenu(x, y) {","/* ---------------- 框选"),sandbox);
const act=cmd=>vm.runInContext(cmd,sandbox);
(async()=>{
 act("downloadNodes([findById('f:12:1')])");
 assert.deepEqual(downloads,["f:12:1"],"Single file downloads directly");
 act("downloadNodes([findById('p:1')])");
 assert.deepEqual(exportedCalls.at(-1),["p:1"],"Folder download uses exporter");
 act("downloadNodes([findById('p:1'),findById('f:12:1')])");
 assert.deepEqual(exportedCalls.at(-1),["p:1","f:12:1"],"Mixed selection preserves folders and files");
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
 // Opening a context menu on an already-selected row retains multiselection.
 drive.state.selection=new Set(["p:1","p:2"]);
 act("showItemMenu('p:2',10,20)");
 menus.at(-1).handlers.delete();
 assert.deepEqual(deleted.at(-1),["p:1","p:2"]);
 drive.state.selection=new Set(["t:8","t:9"]);
 drive.state.view="recycle";
 act("showItemMenu('t:8',10,20)");
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

 // Reload never changes home into a files view and prunes deleted selections.
 const refreshRange=part(inter,"async function refreshCurrent() {","/* ---------------- 文件下载");
 const reloadSandbox=vm.createContext({
  Drive:drive,
  VaultStore:{ws:"company",loadAll:async()=>{}},
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

 // A modal guard must precede Delete, F2 and Ctrl+A keyboard actions.
 const key=part(inter,"function bindKeyboard() {","/* ---------------- 遮罩层");
 assert.match(key,/formMask/);
 assert.match(key,/confirmMask/);
 assert.match(key,/preview-mask\.show/);
 assert.ok(key.indexOf('$("#formMask")')<key.indexOf('if (e.key === "Delete")'));
 // Recycle details must not advertise preview/open while soft-deleted.
 assert.match(app,/locked \? "" : isFolder/);
 console.log("EXPLORER F2-06 PASS: row/menu selection, folder exportedCalls, virtual scope, chrome, modal guards and refresh state");
})().catch(err=>{console.error(err);process.exitCode=1;});
