/* F2-02 Explorer archive behavior tests. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../../../frontend/explorer");
const code=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const forms=fs.readFileSync(path.join(root,"js/forms.js"),"utf8");
function extract(start,end){
 const a=code.indexOf(start),b=code.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"source anchor "+start);
 return code.slice(a,b);
}
const part=extract("function archiveScope() {","/* ---------------- 内容区 ---------------- */");
function folder(id,name,children,parentId,isSystem){
 return {id:"af:"+id,name,type:"folder",
  biz:{kind:"archive_folder",id,parentId,isSystem:!!isSystem},children:children||[]};
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
 state:{view:"files",folderId:"af:70",query:"",sortBy:"position",sortDir:"asc",
  statusFilter:null,extFilter:null},
 get currentFolder(){return nodes.get(this.state.folderId);},
 clearSelection(){clearCount++;}
};
const VaultStore={ws:"company",async api(url,opts){
 calls.push({url,opts});return {ok:true};
}};
const RecordForms={open(form){modals.push(form);},
 archive(...args){menus.push({archive:args});},
 project(){},contract(){},ip(){},general(){}};
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
});
vm.runInContext(part,context,{filename:"interactions-archive.js"});
const fn=name=>vm.runInContext(name,context);
(async()=>{
 const anchor={getBoundingClientRect:()=>({left:0,bottom:32})};
 Drive.state.folderId="k:achievement";
 fn("openNewMenu")(anchor);
 assert.match(menus.at(-1).html,/new-folder/);
 assert.doesNotMatch(menus.at(-1).html,/new-record/);
 menus.at(-1).handlers["new-folder"]();
 await modals.at(-1).onSubmit({name:"新一级目录"});
 assert.equal(calls.at(-1).url,"/api/v2/folders/company/archive_folder");
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),
  {archiveFolder:{name:"新一级目录",parentId:null}});
 Drive.state.folderId="af:70";
 fn("openNewMenu")(anchor);
 assert.match(menus.at(-1).html,/new-folder/);
 assert.match(menus.at(-1).html,/new-record/);
 const handlers=menus.at(-1).handlers;
 handlers["new-record"]();
 assert.deepEqual(menus.at(-1).archive,["achievement",null,70]);
 handlers["new-folder"]();
 await modals.at(-1).onSubmit({name:"新二级目录"});
 assert.equal(calls.at(-1).opts.json.archiveFolder.parentId,70);

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
 assert.ok(candidates.some(x=>x.value==="0"));
 await modals.at(-1).onSubmit({target:"70"});
 assert.equal(calls.at(-1).url,
  "/api/v2/folders/company/archive_folder/72/move?section=achievement");
 assert.equal(calls.at(-1).opts.json.parentId,70);
 const beforeSystem=modals.length;
 fn("moveArchiveEntry")(parent);
 assert.equal(modals.length,beforeSystem,
  "A system directory cannot open the move dialog");

 const last=calls.length;
 await fn("deleteArchiveFolder")(parent);
 assert.equal(calls.length,last,"System folder cannot be removed");
 await fn("deleteArchiveFolder")(child);
 assert.equal(calls.at(-1).url,
  "/api/v2/folders/company/archive_folder/71");
 assert.equal(calls.at(-1).opts.method,"DELETE");
 assert.ok(refreshCount>0&&clearCount>0);
 const occupied=folder(81,"非空目录",[record(99,81)],70);
 await fn("deleteArchiveFolder")(occupied);
 assert.equal(calls.length,last+1,"Non-empty folder is protected");
 allowDelete=false;
 await fn("deleteArchiveFolder")(other);
 assert.equal(calls.length,last+1,"Cancelled delete does not submit");

 const formContext=vm.createContext({
 catLabel:id=>id,VaultStore,toast:()=>{},refreshCurrent:async()=>{}
 });
 vm.runInContext(forms,formContext,{filename:"forms.js"});
 const real=vm.runInContext("RecordForms",formContext);
 let dialog=null;
 real.open=opts=>{dialog=opts;};
 real.archive("achievement",null,71);
 await dialog.onSubmit({name:"目录资料",category:"",year:"",tags:"",remarks:""});
 assert.equal(calls.at(-1).url,
  "/api/v2/folders/company/archive?section=achievement");
 assert.equal(calls.at(-1).opts.json.archive.folderId,71);
 assert.ok(!("parentId" in calls.at(-1).opts.json));
 console.log("EXPLORER ARCHIVE F2-02 PASS: create, true parentId, mixed position, safe moves, deletion");
})().catch(err=>{console.error(err);process.exitCode=1;});
