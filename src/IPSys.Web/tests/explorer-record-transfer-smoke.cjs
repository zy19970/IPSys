/* S3: exercise the real Explorer record transfer UI handler, not just a map.
   Detached target trees must never replace the current VaultStore workspace. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"../wwwroot");
const bridge=fs.readFileSync(path.join(root,"js/bridge.js"),"utf8");
const interactions=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
assert.match(interactions,/"copy-record": inWorkspace\(\(\) => transferBusinessRecord\(item, false\)\)/);
assert.match(interactions,/"transfer-record": inWorkspace\(\(\) => transferBusinessRecord\(item, true\)\)/);
const from=bridge.indexOf("/* Mirrors server FolderTransferPolicy");
const end=bridge.indexOf("/* 遍历当前已加载的整棵树",from);
assert.ok(from>0&&end>from,"S3 Explorer handler and chooser builder loaded");

const projects={
 company:[{id:8,name:"公司源项目"},{id:15,name:"目标公司项目"}],
 personal:[{id:70,name:"个人目标科研项目"},{id:90,name:"另一目标项目"}]
};
const archiveFolders={
 company:[
 {id:71,name:"公司业务档案",parentId:null,section:"achievement"},
 {id:12,name:"公司综合资料",parentId:null,section:"general"},
 {id:81,name:"公司源项目下资料",parentId:8,section:"project"},
 {id:82,name:"另一项目内同名目录",parentId:15,section:"project"},
 {id:83,name:"另一个深层目录",parentId:82,section:"project"}
 ],
 personal:[
 {id:101,name:"个人成果",parentId:null,section:"achievement"},
 {id:102,name:"个人学术",parentId:null,section:"academic"},
 {id:103,name:"个人其他资料",parentId:null,section:"general"},
 {id:104,name:"个人项目的三级目录",parentId:70,section:"project"},
 {id:105,name:"再下一层",parentId:104,section:"project"}
 ]
};
const calls=[],dialogs=[],pickers=[],msgs=[],readUrls=[],clear=[];
const view=new Map();
const node=(kind,id,extra={})=>{
 const n={id:(kind==="archive_folder"?"af:":kind+":")+id,
  type:"folder",name:extra.name||kind+id,biz:{kind,id,...extra}};
 view.set(n.id,n);return n;
};
const current={project:node("project",8),ip:node("ip",9),
 source:node("archive_folder",81,{section:"project",name:"公司源项目下资料"}),
 general:node("archive_folder",12,{section:"general",name:"公司综合资料"}),
 achievement:node("archive_folder",71,{section:"achievement"}),
 certificate:node("archive_folder",77,{section:"certificate"})};
let busy=false,failWrite=false,failRead=false,failRefresh=false,refresh=0;
const vault={
 ws:"company",
 async api(url,opts){
  calls.push({url,payload:JSON.parse(JSON.stringify(opts.json))});
  if(failWrite)throw Error("HTTP 409 测试拒绝");
  return {id:777};
 },
 async getJson(url){
  readUrls.push(url);
  if(failRead)throw Error("HTTP 500 获取目录失败");
  const ws=url.split("/").at(-1);
  if(url.includes("/api/v2/ui/projects/"))return projects[ws]||[];
  assert.match(url,/\/api\/v2\/ui\/folders\//);
  return {folders:archiveFolders[ws]||[],orders:{},files:[]};
 }
};
const context=vm.createContext({
 VaultStore:vault,
 RecordForms:{open:form=>dialogs.push(form)},
 Drive:{clearSelection:()=>clear.push(true)},
 toast:(msg)=>msgs.push(String(msg)),
 catLabel:section=>section,
 fileTaskBusy:()=>busy,
 refreshCurrent:async()=>{refresh++;if(failRefresh)throw Error("refresh failed");},
 findById:id=>view.get(id)
});
const pickerContext=vm.createContext({});
const index=vm.runInContext(fs.readFileSync(path.join(root,"js/folder-picker.js"),"utf8")+"\nAttachmentFolderPicker.index.bind(AttachmentFolderPicker)",pickerContext);
context.AttachmentFolderPicker={index,open:opts=>{pickers.push(opts);return opts;}};
vm.runInContext(bridge.slice(from,end),context,{filename:"s3-real-bridge-transfer.js"});
const invoke=vm.runInContext("transferBusinessRecord",context);
const opt=vm.runInContext("recordTransferOptions",context);
const choices=n=>Array.from(opt(n,true),x=>x.value);

(async()=>{
 // Keep project/IP business record transfers separate and unchanged.
 assert.deepEqual(choices(current.project),["personal"]);
 invoke(current.project,false);
 await dialogs.at(-1).onSubmit({target:"company"});
 assert.deepEqual(calls.at(-1),{
  url:"/api/v2/projects/company/8/transfer",
  payload:{targetWorkspace:"company",move:false}
 });
 invoke(current.ip,true);
 await dialogs.at(-1).onSubmit({target:"personal"});
 assert.equal(calls.at(-1).url,"/api/v2/ip/company/9/transfer");

 // X01: a project subdirectory now has copy targets in the same real project
 // and across workspaces. No copy is written before a real FolderId is chosen.
 assert.ok(choices(current.source).includes("company/project"));
 assert.ok(choices(current.source).includes("personal/project"));
 assert.ok(choices(current.source).includes("company/general"));
 assert.ok(choices(current.source).includes("company/certificate"));
 invoke(current.source,false);
 const before=calls.length;
 await dialogs.at(-1).onSubmit({target:"company/project"});
 assert.equal(calls.length,before,"opening picker never writes");
 let picker=pickers.at(-1);
 const model=index(picker.root,81,[81]);
 assert.ok(model.byFolderId.has(15),"actual project node can be destination");
 assert.ok(model.byFolderId.has(83),"deep project directory is browsable");
 assert.ok(model.path(model.byFolderId.get(83).id).includes("另一个深层目录"));
 await picker.onSubmit({target:"15",targetSection:"project"});
 assert.equal(calls.at(-1).url,
  "/api/v2/ui/folders/company/project/81/transfer");
 assert.deepEqual(calls.at(-1).payload,{
  targetWorkspace:"company",targetSection:"project",move:false,targetFolderId:15
 });

 // Same-section move to another physical parent preserves IDs on server.
 invoke(current.source,true);
 await dialogs.at(-1).onSubmit({target:"company/project"});
 picker=pickers.at(-1);
 await picker.onSubmit({target:"83",targetSection:"project"});
 assert.equal(calls.at(-1).payload.move,true);
 assert.equal(calls.at(-1).payload.targetFolderId,83);
 // X02: cross-module root is represented by 0, never a pretend project root.
 invoke(current.source,true);
 await dialogs.at(-1).onSubmit({target:"company/general"});
 picker=pickers.at(-1);
 await picker.onSubmit({target:"0",targetSection:"general"});
 assert.deepEqual(calls.at(-1).payload,{
  targetWorkspace:"company",targetSection:"general",move:true
 });

 // X03/X08: same numeric FolderId in another workspace is not a descendant.
 invoke(current.source,false);
 await dialogs.at(-1).onSubmit({target:"personal/project"});
 picker=pickers.at(-1);
 assert.equal(picker.originWorkspace,"company");
 assert.equal(picker.workspace,"personal");
 assert.deepEqual(Array.from(picker.sourceFolderIds),[],
  "Cross-workspace picker must not inherit source FolderIds");
 assert.ok(index(picker.root,null,[]).byFolderId.has(70));
 await picker.onSubmit({target:"70",targetSection:"project"});
 assert.deepEqual(calls.at(-1).payload,{
  targetWorkspace:"personal",targetSection:"project",move:false,targetFolderId:70
 });
 assert.equal(vault.ws,"company","loading target snapshot never switches current workspace");
 assert.ok(readUrls.includes("/api/v2/ui/projects/personal"));

 // X12: unauthorized target matrix values cannot open a picker.
 assert.deepEqual(choices(current.certificate),[
  "company/certificate","company/achievement","company/party",
  "company/general","company/project"]);
 assert.ok(!choices(current.certificate).includes("personal/certificate"));
 assert.ok(!choices(current.achievement).includes("personal/general"));
 assert.ok(choices(current.achievement).includes("personal/academic"));

 // X09: cancellation from picker must send no write; workspace switch
 // after a chooser was opened must be rejected before submitting.
 invoke(current.source,false);
 await dialogs.at(-1).onSubmit({target:"personal/general"});
 picker=pickers.at(-1);
 const beforeSwitch=calls.length;
 vault.ws="personal";
 await assert.rejects(picker.onSubmit({target:"103",targetSection:"general"}),
  /工作区已变化/);
 assert.equal(calls.length,beforeSwitch);
 vault.ws="company";
 busy=true;
 await assert.rejects(picker.onSubmit({target:"103",targetSection:"general"}),
  /文件任务/);
 assert.equal(calls.length,beforeSwitch);
 busy=false;
 await assert.rejects(picker.onSubmit({target:"0",targetSection:"project"}),
  /目标项目或目录无效/);
 assert.equal(calls.length,beforeSwitch);
 failWrite=true;
 await assert.rejects(picker.onSubmit({target:"103",targetSection:"general"}),/409/);
 failWrite=false;
 assert.equal(calls.length,beforeSwitch+1);

 // X11: server commits once; failed UI refresh is not a retry.
 invoke(current.source,false);
 await dialogs.at(-1).onSubmit({target:"company/achievement"});
 picker=pickers.at(-1);
 const previous=calls.length;
 failRefresh=true;
 await picker.onSubmit({target:"71",targetSection:"achievement"});
 failRefresh=false;
 assert.equal(calls.length,previous+1);
 assert.match(msgs.at(-1),/事务已提交.*刷新失败/);

 // Failed snapshot retrieval is visible and never creates a write.
 failRead=true;
 invoke(current.source,false);
 const previousPickers=pickers.length,previousCalls=calls.length;
 await dialogs.at(-1).onSubmit({target:"personal/project"});
 failRead=false;
 assert.equal(pickers.length,previousPickers);
 assert.equal(calls.length,previousCalls);
 assert.match(msgs.at(-1),/无法读取目标目录/);

 // No hidden record-specific contract transfer fallback.
 const retired=node("contract",301);
 assert.equal(opt(retired,false).length,0);
 console.log("EXPLORER S3 RECORD TRANSFER PASS: project picker, modules, cross-workspace, validation, refresh, no native huge select");
})().catch(e=>{console.error(e);process.exitCode=1;});
