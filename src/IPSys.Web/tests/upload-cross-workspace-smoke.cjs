'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('src/IPSys.Web/wwwroot/app.js','utf8').replace(/\r\n/g,'\n');
function slice(start,end){
 const a=app.indexOf(start),b=app.indexOf(end,a);
 assert.ok(a>=0&&b>a,'Could not locate '+start);
 return app.slice(a,b);
}
const select=slice('function selectSpace(next){','mountStaticIcons();');
const refresh=slice('async function refresh(){','function refreshSidebar(){');
const render=slice('function render(){','async function uploadGeneralBatch(');
const business=slice('async function uploadBusinessBatch(', 'async function previewOriginal(');
const general=slice('async function uploadGeneralBatch(', 'async function download(');
const taskWait=slice('async function refreshWhenFileTaskIdle(', 'function setPage(');
assert.ok(select.includes('if(trashPurgeTaskActive||localFileTaskActive){render();return;}'),
 'switching workspace during upload must not enqueue database reads');
assert.ok(refresh.includes('if(trashPurgeTaskActive||localFileTaskActive){render();return;}'),
 'module refresh during upload must not enqueue database reads');
assert.ok(render.includes('if(trashPurgeTaskActive||localFileTaskActive)')&&
 render.includes('原件正在上传')&&render.includes('右下角可查看上传进度'),
 'the new workspace must display clear busy status without removing progress');
assert.ok(app.includes('if(!active&&space&&token)void refreshWhenFileTaskIdle(space);'),
 'upload completion must load the selected workspace AFTER backend task is idle');
assert.ok(!business.includes('if(space!==workspace)')&&!general.includes('if(space!==workspace)'),
 'workspace switching must never cancel the rest of a batch');
assert.ok(!general.includes('liveRows.some('),
 'the original General folder identity must not depend on the newly selected workspace');
assert.ok(!business.includes('await refresh()')&&!general.includes('await refresh()'),
 'refreshes must not compete with streaming the next batch file for SQLCipher Gate');

// Exercise the real workspace-switch entry rather than checking prompt text
// alone. Canceling must be side-effect free; accepting must keep upload alive.
{
 const choices=[],renders=[];
 let accept=false;
 const dummyElements=new Map();
 const ctx={
  token:'token',space:'company',dbName:'test.db',globalSerial:9,
  globalHits:['old'],globalQuery:'old',globalPending:true,globalError:'old',
  page:'general',detail:{kind:'general',id:7},
  archiveGroup:'archive',archiveFolderId:123,archiveFolders:[7],
  archiveSelectedFolders:new Set([7]),archiveEntryOrders:{a:1},
  ledgerOrders:{b:1},projectRows:[1],ipRows:[2],contractRows:[3],
  businessFileRows:[4],trashRows:[5],archiveRows:{certificate:[6]},
  filterName:'keep',filterKind:'全部类型',filterState:'全部状态',
  selected:new Set([1]),certificateSelected:new Set([2]),
  localFileTaskActive:true,trashPurgeTaskActive:false,
  api:{uploadProgress:{status:()=>({active:true,count:2,index:1})}},
  confirm:message=>{choices.push(message);return accept;},
  el:id=>{if(!dummyElements.has(id))dummyElements.set(id,{});return dummyElements.get(id);},
  render:()=>renders.push(ctx.space),
  refreshSidebar(){throw Error('SQLCipher refresh must be deferred during upload');},
  resumeTrashPurgeStatus(){throw Error('Do not read from Vault during active upload');}
 };
 vm.runInNewContext(select+'\nthis.switchSpace=selectSpace;',ctx);
 ctx.switchSpace('company');
 assert.equal(choices.length,0,'selecting current workspace never prompts');
 ctx.switchSpace('personal');
 assert.equal(choices.length,1,'switching during active batch requires confirmation');
 assert.match(choices[0],/第 1 \/ 2 份/);
 assert.match(choices[0],/仍保存到开始上传时的原工作区/);
 assert.match(choices[0],/等上传结束后才能加载/);
 assert.equal(ctx.space,'company','cancel must preserve original workspace');
 assert.equal(ctx.globalSerial,9,'cancel must not alter UI search/navigation');
 assert.equal(ctx.detail.id,7,'cancel must preserve the current record');
 assert.equal(renders.length,0,'cancel must not rerender the current page');
 accept=true;
 ctx.switchSpace('personal');
 assert.equal(ctx.space,'personal','confirm permits navigation');
 assert.deepEqual(renders,['personal'],'confirmed switch shows busy page only');
 assert.equal(ctx.localFileTaskActive,true,'navigation must not cancel the upload');
}
(async()=>{
 const files=[{name:'part1.bin',size:300},{name:'part2.bin',size:500}];
 const bus=[];
 const busContext={
  space:'company',localFileTaskActive:false,MAX_ORIGINAL_BYTES:8*1024**3,
  api:{uploadProgress:{
   begin(n){assert.equal(n,2);busContext.localFileTaskActive=true;return true;},
   file(){},cancelled(){return false;},
   finish(v){bus.push({finished:v});busContext.localFileTaskActive=false;}
  }},
  async uploadBusinessAttachment(file,meta,workspace){
   bus.push({file:file.name,workspace});
   busContext.space='personal'; // switch during the first active File
   return {fileId:bus.length};
  },
  notice(){}
 };
 vm.runInNewContext(business+'\nthis.uploadBatch=uploadBusinessBatch;',busContext);
 await busContext.uploadBatch(files,{kind:'project',ownerId:123});
 assert.deepEqual(bus.filter(x=>x.file).map(x=>x.workspace),['company','company'],
  'Both file operations must remain tied to original company workspace');
 assert.equal(bus.at(-1).finished.completed,2);

 const g=[];
 const generalContext={
  space:'company',localFileTaskActive:false,MAX_ORIGINAL_BYTES:8*1024**3,
  liveRows:[], // after switching, this list no longer contains the original owner
  api:{uploadProgress:{
   begin(){generalContext.localFileTaskActive=true;return true;},
   file(){},cancelled(){return false;},
   finish(v){g.push({finished:v});generalContext.localFileTaskActive=false;}
  }},
  IPSysNativeIp:{async upload(api,file,meta,workspace){
   g.push({file:file.name,workspace,id:meta.ownerId});
   generalContext.space='personal';return true;
  }},
  notice(){}
 };
 vm.runInNewContext(general+'\nthis.uploadBatch=uploadGeneralBatch;',generalContext);
 await generalContext.uploadBatch(888,files);
 assert.equal(g.filter(x=>x.file).length,2);
 assert.ok(g.filter(x=>x.file).every(x=>x.workspace==='company'&&x.id===888));
 assert.equal(g.at(-1).finished.completed,2);

 let polls=0,reads=0;
 const waiting={
  token:'session',space:'personal',localFileTaskActive:false,trashPurgeTaskActive:false,
  api:async path=>{
   assert.equal(path,'/api/task');polls++;
   return {json:async()=>({active:polls===1})};
  },
  refreshSidebar(){},el(){return {innerHTML:''}},
  async refresh(){assert.equal(polls,2,'must not refresh until server file task completed');reads++;},
  notice(){throw Error('Unexpected error notice')},
  setTimeout(callback){callback();}
 };
 vm.runInNewContext(taskWait+'\nthis.resumeWorkspace=refreshWhenFileTaskIdle;',waiting);
 await waiting.resumeWorkspace('personal');
 assert.equal(reads,1);
 assert.equal(polls,2);
 console.log('UPLOAD CROSS-WORKSPACE SQLITE GATE UI SMOKE PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
