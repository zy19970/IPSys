/* F2-04: use the real Explorer record-transfer functions with mock HTTP. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../wwwroot");
const bridge=fs.readFileSync(path.join(root,"js/bridge.js"),"utf8");
const interactions=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
// 普通文件夹的独立复制/跨区转移与新的同FileId共享/同模块移动语义分开。
assert.ok(interactions.includes('MI("copy-record","copy",recordKind==="archive_folder" ? "复制文件夹（独立副本）" : "复制整条记录")'));
assert.ok(interactions.includes('MI("transfer-record","move",recordKind==="archive_folder" ? "跨工作区或类别转移" : "移动或跨区转移")'));
assert.match(interactions,/"copy-record": inWorkspace\(\(\) => transferBusinessRecord\(item, false\)\)/);
assert.match(interactions,/"transfer-record": inWorkspace\(\(\) => transferBusinessRecord\(item, true\)\)/);
const from=bridge.indexOf("function recordTransferOptions(node, move) {");
const until=bridge.indexOf("/* 遍历当前已加载的整棵树",from);
assert.ok(from>=0&&until>from);
const calls=[],dialogs=[],msgs=[],clear=[];
let refresh=0,busy=false,failed=false;
const projects={
 company:[{id:8,name:"目标公司项目"},{id:15,name:"其它公司项目"}],
 personal:[{id:70,name:"个人科研项目"}]
};
/* B02：资料转移必须落到用户指定的目录，转移前会读目标工作区的目录快照。 */
const archiveFolders={
 company:[{id:70,name:"申报与认定",parentId:null,section:"achievement"},
          {id:71,name:"其他业务资料",parentId:null,section:"achievement"}],
 personal:[{id:80,name:"个人成果",parentId:null,section:"achievement"},
           {id:81,name:"个人学术",parentId:null,section:"academic"}]
};
const vault={
 ws:"company",
 async api(url,opts){
  calls.push({url,opts});
  if(failed)throw Error("HTTP 409 测试拒绝");
  return {id:10};
 },
 async getJson(url){
  const ws=url.split("/").at(-1);
  if(url.includes("/api/v2/ui/folders/"))
   return {folders:archiveFolders[ws]||[],orders:{},files:[]};
  assert.ok(url.includes("/api/v2/ui/projects/"));
  return projects[ws];
 }
};
const context=vm.createContext({
 VaultStore:vault,
 RecordForms:{open:form=>dialogs.push(form)},
 Drive:{clearSelection:()=>clear.push(true)},
 toast:m=>msgs.push(m),
 /* 打包后 catLabel 是全局函数，这里按同一口径提供类别名。 */
 catLabel:id=>({achievement:"成果资料",academic:"学术资料"})[id]||id,
 fileTaskBusy:()=>busy,
 refreshCurrent:async()=>{refresh++;},
});
vm.runInContext(bridge.slice(from,until),context);
const invoke=vm.runInContext("transferBusinessRecord",context);
const opt=vm.runInContext("recordTransferOptions",context);
const node=(kind,id,extra={})=>({id:kind+":"+id,type:"folder",name:kind+id,biz:{kind,id,...extra}});
(async()=>{
 const project=node("project",5);
 assert.deepEqual(Array.from(opt(project,true),x=>x.value),["personal"]);
 invoke(project,false);
 assert.equal(dialogs.at(-1).title,"复制项目（含全部合同）");
 await dialogs.at(-1).onSubmit({target:"company"});
 assert.equal(calls.at(-1).url,"/api/v2/projects/company/5/transfer");
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),
  {targetWorkspace:"company",move:false});
 invoke(project,true);
 await dialogs.at(-1).onSubmit({target:"personal"});
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),
  {targetWorkspace:"personal",move:true});
 assert.equal(clear.length,2);

 const ip=node("ip",17);
 invoke(ip,true);
 await dialogs.at(-1).onSubmit({target:"personal"});
 assert.equal(calls.at(-1).url,"/api/v2/ip/company/17/transfer");

 const general=node("archive_folder",12,{section:"general"});
 invoke(general,false);
 await dialogs.at(-1).onSubmit({target:"personal/general"});
 let generalDialog=dialogs.at(-1);
 assert.deepEqual(Array.from(generalDialog.fields[0].options,x=>x.value),["0"]);
 await generalDialog.onSubmit({folderId:"0"});
 assert.equal(calls.at(-1).url,"/api/v2/ui/folders/company/general/12/transfer");
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),
  {targetWorkspace:"personal",move:false,targetSection:"general"});

 const archive=node("archive_folder",6,{section:"achievement"});
 assert.deepEqual(Array.from(opt(archive,true),x=>x.value),
  ["personal/achievement","personal/academic"]);
 invoke(archive,false);
 await dialogs.at(-1).onSubmit({target:"personal/academic"});
 /* 只有选定目录后才提交：顶层是 0，具体目录是它的 FolderId。 */
 let archiveDialog=dialogs.at(-1);
 assert.equal(archiveDialog.title,"选择目标分类目录");
 assert.deepEqual(Array.from(archiveDialog.fields[0].options,x=>x.value),["0","81"]);
 await archiveDialog.onSubmit({folderId:"81"});
 assert.equal(calls.at(-1).url,"/api/v2/ui/folders/company/achievement/6/transfer");
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),
  {targetWorkspace:"personal",move:false,targetSection:"academic",targetFolderId:81});

 /* 公司业务档案也是普通文件夹，目标可直接选顶层。 */
 invoke(archive,false);
 await dialogs.at(-1).onSubmit({target:"company/achievement"});
 archiveDialog=dialogs.at(-1);
 assert.deepEqual(Array.from(archiveDialog.fields[0].options,x=>x.value),["0","70","71"]);
 await archiveDialog.onSubmit({folderId:"71"});
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),
  {targetWorkspace:"company",move:false,targetSection:"achievement",targetFolderId:71});
 const certificate=node("archive_folder",10,{section:"certificate"});
 assert.equal(opt(certificate,true).length,0,
  "Certificate transfer cannot bypass module compatibility constraints");
 const beforeDialogs=dialogs.length;
 invoke(certificate,true);
 // No new modal for an unsupported target; the caller only sees a toast.
 assert.equal(dialogs.length,beforeDialogs);
 assert.match(msgs.at(-1),/没有受支持的目标/);

 const contract=node("contract",30,{projectId:8});
 invoke(contract,true);
 let dialog=dialogs.at(-1);
 await dialog.onSubmit({target:"company"});
 dialog=dialogs.at(-1);
 assert.equal(dialog.title,"选择合同的新所属项目");
 assert.deepEqual(Array.from(dialog.fields[0].options,x=>x.value),["15"],
  "Same-workspace contract move cannot select original project");
 await dialog.onSubmit({targetProjectId:"15"});
 assert.equal(calls.at(-1).url,"/api/v2/contracts/company/30/transfer");
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),
  {targetWorkspace:"company",move:true,targetProjectId:15});

 invoke(contract,false);
 dialog=dialogs.at(-1);
 await dialog.onSubmit({target:"personal"});
 dialog=dialogs.at(-1);
 assert.deepEqual(Array.from(dialog.fields[0].options,x=>x.value),["70"]);
 await dialog.onSubmit({targetProjectId:"70"});
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).opts.json)),
  {targetWorkspace:"personal",move:false,targetProjectId:70});

 const previousCalls=calls.length;
 invoke(project,false);
 const lockedDialog=dialogs.at(-1);
 vault.ws="personal";
 await assert.rejects(lockedDialog.onSubmit({target:"personal"}),/工作区已经切换/);
 assert.equal(calls.length,previousCalls);
 vault.ws="company";
 busy=true;
 await assert.rejects(lockedDialog.onSubmit({target:"personal"}),/其它文件任务/);
 assert.equal(calls.length,previousCalls);
 busy=false;

 failed=true;
 await assert.rejects(lockedDialog.onSubmit({target:"personal"}),/409/);
 assert.equal(calls.length,previousCalls+1);
 failed=false;

 await assert.rejects(lockedDialog.onSubmit({target:"invalid"}),/无效/);
 assert.equal(calls.length,previousCalls+1);
 console.log("EXPLORER F2-04 PASS: project/contract/IP/archive_folder transfers, sections, project target and busy/409");
})().catch(e=>{console.error(e);process.exitCode=1;});
