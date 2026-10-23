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
