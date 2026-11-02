/* F2-02 Explorer archive behavior tests. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../wwwroot");
const code=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const forms=fs.readFileSync(path.join(root,"js/forms.js"),"utf8");

/* The one ordinary-folder action opens the form directly, not an extra one-item menu. */
assert.match(code,/if \(archiveScope\(\)\) return createArchiveFolder\(\);/);
assert.doesNotMatch(code,/MI\("new-record","doc","新建资料"\)/);
assert.match(forms,/archiveFolder\(section, node = null, parentId = null/);
function extract(start,end){
 const a=code.indexOf(start),b=code.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"source anchor "+start);
 return code.slice(a,b);
}
const guard=extract("function canCreateHere() {","function safeRefresh() {");
const part=extract("function archiveScopeSection() {","/* ---------------- 内容区 ---------------- */");
function folder(id,name,children,parentId,isSystem){
 return {id:"af:"+id,name,type:"folder",
  biz:{kind:"archive_folder",id,section:"achievement",parentId,isSystem:!!isSystem},children:children||[]};
}
function record(id,parentId){
 return {id:"a:achievement:"+id,name:"资料"+id,type:"folder",
  biz:{kind:"archive",section:"achievement",id,folderId:parentId},children:[]};
}
const rec1=record(91,70),rec2=record(90,70);
const child=folder(71,"下级目录",[],70);
const parent=folder(70,"系统目录",[rec1,child,rec2],null,true);
const other=folder(72,"另一目录",[],null);
const rootNode={id:"k:achievement",name:"业务档案",children:[parent,other]};
const nodes=new Map([rootNode,parent,child,other,rec1,rec2].map(x=>[x.id,x]));
const parents=new Map([[parent.id,rootNode],[other.id,rootNode],[child.id,parent],
 [rec1.id,parent],[rec2.id,parent]]);
const pathTo=id=>{
 const out=[];let cur=nodes.get(id);
 while(cur){out.unshift(cur);cur=parents.get(cur.id);}
 return out;
};
const calls=[],modals=[],menus=[],toasts=[];
let refreshCount=0,clearCount=0,allowDelete=true;
const Drive={
 state:{view:"files",folderId:"af:70",query:"",ready:true,sortBy:"position",sortDir:"asc",
  statusFilter:null,extFilter:null},
 get currentFolder(){return nodes.get(this.state.folderId);},
 clearSelection(){clearCount++;}
};
const VaultStore={ws:"company",async api(url,opts){
 calls.push({url,opts});return {ok:true};
}};
const RecordForms={open(form){modals.push(form);},
 archive(...args){menus.push({archive:args});},
 archiveFolder(...args){menus.push({archiveFolder:args});},
 project(){},contract(){},ip(){},general(...args){menus.push({general:args});}};
const context=vm.createContext({
 Drive,VaultStore,RecordForms,
 findById:id=>nodes.get(id)||null,pathTo,
 toast:message=>toasts.push(message),askConfirm:async()=>allowDelete,
 refreshCurrent:async()=>{refreshCount++;},
 showCtx:(x,y,html,handlers)=>menus.push({html,handlers}),
 MI:(action,icon,label)=>'<button data-act="'+action+'">'+label+'</button>',
 nodeTag:id=>String(id).split(":")[0],
 catsOf:()=>[{id:"achievement",label:"业务档案"}],
 catLabel:id=>id,
 catIsDir:(id,ws)=>ws==="company"
  ?["certificate","achievement","party","general"].includes(id)
  :["certificate","achievement","academic","general"].includes(id),
});
vm.runInContext(guard,context,{filename:"interactions-create-guard.js"});
vm.runInContext(part,context,{filename:"interactions-archive.js"});
const fn=name=>vm.runInContext(name,context);
(async()=>{
 const anchor={getBoundingClientRect:()=>({left:0,bottom:32})};
 for(const [ws,id,section,parentId] of [
  ["company","k:achievement","achievement",null],
  ["company","af:70","achievement",70],
  ["company","k:general","general",null],
  ["company","k:certificate","certificate",null],
  ["personal","k:academic","academic",null],
 ]) {
  VaultStore.ws=ws;
  Drive.state.folderId=id;
  const count=menus.length;
  fn("openNewMenu")(anchor);
  assert.equal(menus.length,count+1,"New must invoke the folder form immediately");
  assert.deepEqual(menus.at(-1).archiveFolder,[section,null,parentId]);
  assert.equal(menus.at(-1).html,undefined,"No second-level one-item menu");
 }
 VaultStore.ws="company";
 Drive.state.folderId="af:70";

 /* Right-click's initial New/Upload/Refresh menu stays; choosing New
    invokes the folder form without opening yet another sub-menu. */
 context.canUploadFiles=()=>false;
 context.$=sel=>sel==="#btnNew"?anchor:null;
 vm.runInContext(extract("function showBlankMenu(x, y) {","/* ---------------- 框选"),context);
 fn("showBlankMenu")(20,30);
 const blankMenu=menus.at(-1);
 assert.match(blankMenu.html,/data-act="new"/);
 const beforeDirect=menus.length;
 blankMenu.handlers.new();
 assert.equal(menus.length,beforeDirect+1,"Right-click New opens one form, not another menu");
 assert.deepEqual(menus.at(-1).archiveFolder,["achievement",null,70]);

 /* Other modes retain their multi-option menu behavior. */
 Drive.state.view="home";
 Drive.state.folderId="root";
 const beforeHome=menus.length;
 fn("openNewMenu")(anchor);
 assert.equal(menus.length,beforeHome+1);
 assert.match(menus.at(-1).html,/data-act="new-achievement"/);
 assert.ok(menus.at(-1).handlers["new-achievement"]);
 Drive.state.view="files";
 Drive.state.folderId="af:70";

 await fn("reorderArchiveEntry")(child,-1);
 assert.equal(calls.at(-1).url,
  "/api/v2/folders/company/entries/reorder?section=achievement");
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),{
  parentId:70,items:[{kind:"folder",id:71},{kind:"record",id:91},
   {kind:"record",id:90}]
 });
 const count=calls.length;
 Drive.state.query="search";
 await fn("reorderArchiveEntry")(child,1);
 Drive.state.query="";
 Drive.state.sortBy="name";
 await fn("reorderArchiveEntry")(child,1);
 Drive.state.sortBy="position";
 assert.equal(calls.length,count,"Filtered/manual sort must not reorder hidden siblings");

 fn("moveArchiveEntry")(rec1);
 assert.equal(modals.at(-1).title,"移动资料");
 const choices=modals.at(-1).fields[0].options;
 assert.ok(choices.some(x=>x.value==="71"));
 assert.ok(!choices.some(x=>x.value==="0"));
 assert.ok(!choices.some(x=>x.value==="70"));
 await modals.at(-1).onSubmit({target:"71"});
 assert.equal(calls.at(-1).url,
  "/api/v2/folders/company/archive/91/move?section=achievement");
 assert.equal(calls.at(-1).opts.json.parentId,71);

 const descendant=folder(73,"下级子目录",[],72);
 other.children.push(descendant);
 nodes.set(descendant.id,descendant);
 parents.set(descendant.id,other);
 fn("moveArchiveEntry")(other);
 const candidates=modals.at(-1).fields[0].options;
 assert.ok(!candidates.some(x=>x.value==="73"),
  "A folder cannot be moved into its own descendant");
 assert.ok(candidates.some(x=>x.value==="70"));
 assert.ok(!candidates.some(x=>x.value==="0"),
  "A folder already at root should not offer a no-op root target");
 await modals.at(-1).onSubmit({target:"70"});
 assert.equal(calls.at(-1).url,
  "/api/v2/folders/company/archive_folder/72/move?section=achievement");
 assert.equal(calls.at(-1).opts.json.parentId,70);
 const beforeSystem=modals.length;
 fn("moveArchiveEntry")(child);
 assert.ok(modals.at(-1).fields[0].options.some(x=>x.value==="0"),
  "A nested folder may move to archive root");
 const beforeInitial=modals.length;
 fn("moveArchiveEntry")(parent);
 assert.equal(modals.length,beforeInitial+1,
  "An initially seeded folder opens the same move dialog as a user folder");
 assert.equal(modals.at(-1).title,"移动目录");

 const last=calls.length;
 await fn("deleteArchiveFolder")(parent);
 assert.equal(calls.length,last+1,
  "Nonempty folder is moved to the recycle bin");
 assert.equal(calls.at(-1).url,
  "/api/v2/folders/company/archive_folder/70?section=achievement");
 assert.equal(calls.at(-1).opts.method,"DELETE");
 await fn("deleteArchiveFolder")(child);
 assert.equal(calls.at(-1).url,
  "/api/v2/folders/company/archive_folder/71?section=achievement");
 assert.equal(calls.at(-1).opts.method,"DELETE");
 assert.ok(refreshCount>0&&clearCount>0);
 const occupied=folder(81,"非空目录",[record(99,81)],70);
 await fn("deleteArchiveFolder")(occupied);
 assert.equal(calls.length,last+3,
  "Nested folders containing records must be recyclable");
 allowDelete=false;
 await fn("deleteArchiveFolder")(other);
 assert.equal(calls.length,last+3,"Cancelled delete does not submit");
 allowDelete=true;
 const initialEmpty=folder(75,"初始空目录",[],null,true);
 await fn("deleteArchiveFolder")(initialEmpty);
 assert.equal(calls.at(-1).url,"/api/v2/folders/company/archive_folder/75?section=achievement",
  "Empty initial directories are recyclable via the same endpoint");
 assert.equal(calls.at(-1).opts.method,"DELETE");

 vm.runInContext(extract("function renameNode(node) {","function showItemMenu(id, x, y) {"),context);
 fn("renameNode")(parent);
 assert.deepEqual(menus.at(-1).archiveFolder,["achievement",parent,null,true],
  "The existing directory must use the common folder editor for F2 rename");

 const formContext=vm.createContext({
 catLabel:id=>id,VaultStore,toast:()=>{},refreshCurrent:async()=>{}
 });
 vm.runInContext(forms,formContext,{filename:"forms.js"});
 const real=vm.runInContext("RecordForms",formContext);
 let dialog=null;
 real.open=opts=>{dialog=opts;};
 real.archiveFolder("achievement",null,71);
 assert.equal(dialog.title,"新建文件夹");
 await dialog.onSubmit({name:"新文件夹",category:"证书",year:"2026",tags:"标签",remarks:"说明"});
 assert.equal(calls.at(-1).url,"/api/v2/folders/company/archive_folder");
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),{
  section:"achievement",
  archiveFolder:{name:"新文件夹",parentId:71,category:"证书",year:"2026",tags:"标签",remarks:"说明"}
 });
 const edit=folder(81,"原有目录",[],70);
 edit.biz.section="general";
 edit.biz.raw={category:"类别",year:"2025",tags:"旧标签",remarks:"原备注"};
 real.archiveFolder("general",edit,70,true);
 assert.equal(dialog.title,"重命名文件夹");
 await dialog.onSubmit({name:"新的名称"});
 assert.equal(calls.at(-1).url,"/api/v2/folders/company/archive_folder/81?section=general");
 assert.equal(calls.at(-1).opts.json.archiveFolder.category,"类别");
 assert.equal(calls.at(-1).opts.json.archiveFolder.year,"2025");
 console.log("EXPLORER ARCHIVE F2-02 PASS: create, true parentId, mixed position, safe moves, deletion");
})().catch(err=>{console.error(err);process.exitCode=1;});
