/* F2-03 Explorer shared FileId / distinct LinkId association behavior. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const explorer=path.resolve(__dirname,"../../../frontend/explorer");
const bridge=fs.readFileSync(path.join(explorer,"js/bridge.js"),"utf8");
const interactions=fs.readFileSync(path.join(explorer,"js/interactions.js"),"utf8");
const from=bridge.indexOf("async function associateOriginal(node, move = false) {");
const to=bridge.indexOf("/* ---------------- 导出 ---------------- */",from);
assert.ok(from>=0&&to>from,"Unified attachment association routine must exist");
const assoc=bridge.slice(from,to);
assert.match(interactions,/MI\("assoc",\s*"copy",\s*"共享原件到其它记录"\)/);
assert.match(interactions,/MI\("assoc-move",\s*"move",\s*"移动附件到其它记录"\)/);
assert.match(interactions,/"assoc-move": \(\) => associateOriginal\(item, true\)/);

const attachment={id:"f:201:2",type:"file",name:"申请书.pdf",biz:{kind:"file",ownerKind:"ip"}};
const ip={id:"i:11",name:"原知识产权",type:"folder",biz:{id:11,kind:"ip"},children:[attachment]};
const project={id:"p:22",name:"目标项目",type:"folder",biz:{id:22,kind:"project"},children:[]};
const contract={id:"c:33",name:"目标合同",type:"folder",biz:{id:33,kind:"contract"},children:[]};
const archiveDir={id:"af:44",name:"归档目录",type:"folder",biz:{id:44,kind:"archive_folder"},children:[]};
const archive={id:"a:achievement:55",name:"目标资料",type:"folder",biz:{id:55,kind:"archive",section:"achievement"},children:[]};
const general={id:"g:66",name:"综合资料",type:"folder",biz:{id:66,kind:"general"},children:[]};
const category={id:"k:ip",name:"知识产权",type:"folder",children:[ip,project,contract,archiveDir,archive,general]};
const ROOT={id:"root",type:"folder",name:"根目录",children:[category]};
const map=new Map([[attachment.id,ip], [ip.id,category],[project.id,category],[contract.id,category],
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
 ROOT,VaultStore:workspace,RecordForms:{open:o=>dialogs.push(o)},
 Drive:{clearSelection:()=>{clear++;}},
 UPLOADABLE_KINDS:["project","contract","archive","ip","general"],
 findParent:id=>map.get(id)||null,pathTo,fileTaskBusy:()=>busy,
 refreshCurrent:async()=>{refresh++;if(failRefresh)throw Error("刷新失败");},
 toast:(m)=>notes.push(m),
 walk(node,fn){const visit=n=>{fn(n);for(const c of n.children||[])visit(c);};visit(node);},
});
vm.runInContext(assoc,sandbox,{filename:"bridge-file-associate.js"});
const invoke=vm.runInContext("associateOriginal",sandbox);

(async()=>{
 await invoke(attachment,false);
 let f=dialogs.at(-1);
 assert.equal(f.title,"共享附件原件");
 const ids=f.fields[0].options.map(x=>x.value);
 assert.deepEqual(Array.from(ids).sort(),["22","33","55","66"],
  "Only real same-workspace business owners; no virtual, archive or source folders");
 assert.ok(f.fields[0].options.find(x=>x.value==="33").label.includes("目标合同"));
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
 const destinations=dialogs.at(-1).fields[0].options.map(x=>x.value);
 assert.ok(!destinations.includes("22"),"Source project must not be offered");
 assert.ok(destinations.includes("11"),"IP target allowed for normal project source");
 console.log("EXPLORER F2-03 PASS: shared/moved LinkId, target scopes, duplicate, 409, workspace and task locks");
})().catch(e=>{console.error(e);process.exitCode=1;});
