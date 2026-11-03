/* P0 regression: batch DELETE dedup/partial failure and busy-vault lock.
   Both functions are executed from the real Explorer source in a mocked
   browser context; this deliberately tests behavior, not a source regex. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const shell=fs.readFileSync(path.resolve(__dirname,
 '../wwwroot/js/interactions.js'),'utf8');
function extract(start,end){
 const a=shell.indexOf(start), b=shell.indexOf(end,a+start.length);
 assert.ok(a>=0 && b>a,'Cannot extract '+start);
 return shell.slice(a,b);
}
const selection=extract('function selectionActionTargets(nodes, forDelete = false) {',
 '/* 下载入口共用：单文件直下');
const deletion=extract('async function deleteNodes(nodes) {','async function recycleAction(nodes, op) {');
const locking=extract('async function lockVault() {','function bindSettings()');

(async()=>{
 /* Same LinkId, two historical versions: exactly one DELETE.
    Another independent LinkId fails 409: subsequent items must still run.
    The UI must refresh even after partial failure. */
 const requested=[], messages=[], meta=new Map([
  ['f:3:1',{fileId:77,linkId:3,version:1}],
  ['f:3:2',{fileId:77,linkId:3,version:2}],
  ['f:4:2',{fileId:77,linkId:4,version:2}],
  ['f:5:1',{fileId:78,linkId:5,version:1}],
 ]);
 let confirms=0, refreshes=0, clears=0, allow=true;
 const context=vm.createContext({
  console,Set,Error,encodeURIComponent,
  VaultStore:{
   ws:'company',
   metaOf:id=>meta.get(id),
   api:async(url,opts)=>{
    assert.equal(opts.method,'DELETE');
    requested.push(url);
    if(url.endsWith('/links/4')) throw new Error('关联已解除。');
   },
  },
  bizKindOf:node=>node.biz?.kind||'',
  askConfirm:async()=>{confirms++;return allow;},
  toast:(message,opts)=>messages.push({message,opts}),
  Drive:{clearSelection:()=>{clears++;}},
  refreshCurrent:async()=>{refreshes++;},
 });
 vm.runInContext(selection,context);
 vm.runInContext(deletion,context);
 const nodes=[
  {id:'f:3:1',type:'file',name:'旧版'},
  {id:'f:3:2',type:'file',name:'新版'},
  {id:'f:4:2',type:'file',name:'另一引用'},
  {id:'f:5:1',type:'file',name:'后续附件'},
 ];
 await context.deleteNodes(nodes);
 assert.deepEqual(requested.map(x=>x.split('/').pop()),['3','4','5'],
  'Deduplicate by LinkId and continue after 409');
 assert.equal(confirms,1);
 assert.equal(refreshes,1,'Partial failure must refresh the server truth');
 assert.equal(clears,1);
 assert.ok(messages.some(x=>x.message.includes('成功 2 项，失败 1 项')));
 assert.ok(messages.some(x=>x.message.includes('关联已解除。')));

 requested.length=0; messages.length=0;
 allow=false;
 await context.deleteNodes(nodes);
 assert.equal(requested.length,0,'Canceled deletion must not send requests');
 assert.equal(refreshes,1,'Canceled deletion must not refresh');

 /* If the user changes workspace during confirmation, no DELETE starts. */
 allow=true;
 requested.length=0;
 const originalConfirm=context.askConfirm;
 context.VaultStore.ws='company';
 context.askConfirm=async()=>{
  context.VaultStore.ws='personal';
  return true;
 };
 await context.deleteNodes([{
  id:'af:99',type:'folder',name:'原工作区目录',
  biz:{kind:'archive_folder',id:99,section:'general'}
 }]);
 assert.equal(requested.length,0,
  'confirmation cannot transfer an old selection into a new workspace');
 assert.ok(messages.some(x=>x.message.includes('工作区已经切换')));
 context.askConfirm=originalConfirm;
 context.VaultStore.ws='company';

 /* B03: 批处理执行中切换工作区，后续请求不得改投到新工作区。
    否则会出现"成功 N 失败 M"的假象，甚至把公司对象当成个人对象删除。 */
 allow=true;
 const switched=[];
 let left=2;
 context.VaultStore.ws='company';
 context.VaultStore.api=async(url,opts)=>{
  assert.equal(opts.method,'DELETE');
  switched.push(url);
  if(--left===0) context.VaultStore.ws='personal';
 };
 messages.length=0;
 await context.deleteNodes([
  {id:'af:1',type:'folder',name:'目录甲',
   biz:{kind:'archive_folder',id:1,section:'general',raw:{name:'甲',category:'合同'}}},
  {id:'af:2',type:'folder',name:'目录乙',
   biz:{kind:'archive_folder',id:2,section:'general',raw:{name:'乙',category:'资质'}}},
 ]);
 assert.equal(switched.length,2,'Both selected folders are submitted');
 assert.ok(switched.every(url=>url.startsWith('/api/v2/folders/company/')),
  'Every request keeps the workspace captured when the batch started');
 assert.equal(context.VaultStore.ws,'personal','The simulated switch did happen');
 assert.ok(messages.some(x=>x.message.includes('已删除 2 项')),
  'Reported counts must describe the real outcome');

 /* Switching from the UI is forbidden during an in-flight DELETE. */
 const switching=extract('async function switchWorkspace(ws) {',
  '/* ==========================================================================');
 vm.runInContext(switching,context);
 context.Drive.state={wsPending:null,selection:new Set(),history:[]};
 context.fileTaskBusy=()=>false;
 context.enterWorkspace=async()=>{throw Error('must not switch');};
 context.VaultStore.ws='company';
 let finishDelete;
 context.VaultStore.api=()=>new Promise(resolve=>{finishDelete=resolve;});
 const active=context.deleteNodes([
  {id:'af:8',type:'folder',name:'处理中目录',
   biz:{kind:'archive_folder',id:8,section:'general'}},
 ]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(context.Drive.batchDeleteActive,true);
 await context.switchWorkspace('personal');
 assert.equal(context.VaultStore.ws,'company');
 assert.ok(messages.some(x=>x.message.includes('批量删除任务进行中')));
 finishDelete();
 await active;
 assert.equal(context.Drive.batchDeleteActive,false);

 /* A refused POST /api/lock (409) must neither drop tokens nor reload UI.
    On success the server has locked, so clearing only own session keys is OK. */
 let rejectLock=true, confirmLock=true, closes=0, reloads=0;
 const removed=[], lockToasts=[];
 const vault={token:'auth-token',api:async(p,opts)=>{
  assert.equal(p,'/api/lock');
  assert.equal(opts.method,'POST');
  if(rejectLock) throw new Error('文件任务执行中，不可关闭数据库');
 }};
 const lockContext=vm.createContext({
  Error,console,
  askConfirm:async()=>confirmLock,
  VaultStore:vault,
  sessionStorage:{removeItem:k=>removed.push(k)},
  location:{reload:()=>{reloads++;}},
  closeSettings:()=>{closes++;},
  toast:(m,o)=>lockToasts.push({m,o}),
 });
 vm.runInContext(locking,lockContext);
 await lockContext.lockVault();
 assert.equal(vault.token,'auth-token');
 assert.equal(reloads,0);
 assert.equal(removed.length,0);
 assert.equal(closes,0);
 assert.ok(lockToasts.some(x=>x.m.includes('文件任务执行中')));

 rejectLock=false;
 await lockContext.lockVault();
 assert.equal(vault.token,'');
 assert.equal(reloads,1);
 assert.equal(closes,1);
 assert.deepEqual(removed,['od-token','od-db']);

 confirmLock=false;
 await lockContext.lockVault();
 assert.equal(reloads,1,'Cancel lock must do nothing');
 console.log('EXPLORER P0 INTERACTIONS PASS: logical delete dedup, partial failure refresh, refused lock preserves session');
})().catch(e=>{console.error(e);process.exitCode=1;});
