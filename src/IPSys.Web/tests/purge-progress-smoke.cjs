'use strict';
// Reproduce the real purge-progress UI controller in an isolated DOM/timer VM.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const bridge=fs.readFileSync(path.resolve(__dirname,'../wwwroot/js/bridge.js'),'utf8');
const start=bridge.indexOf('const PURGE_POLL_MS = 550;');
assert.ok(start>0,'purge controller must exist');
const purgeCode=bridge.slice(start);

class FakeNode {
  constructor(){this.hidden=false;this.textContent='';this.value=0;this.children=new Map();this.handlers={};}
  setAttribute(){}
  removeAttribute(name){if(name==='value')this.value=undefined;}
  addEventListener(event,fn){this.handlers[event]=fn;}
  set innerHTML(html){
    for(const [,id] of html.matchAll(/id="([^"]+)"/g)) this.children.set(id,new FakeNode());
  }
  querySelector(selector){return this.children.get(selector.replace(/^#/,'')||'');}
}

let panel;
const document={
  createElement:()=>new FakeNode(),
  body:{append(node){panel=node;}},
};
const timers=new Map();let timerId=0;
/* 记录每次 setTimeout 的间隔：自动收起是 4000，异常重试是 1200，
   两者混用会把"重试"错当成"成功"。 */
const timerDelays=[];
const setTimeoutFake=(fn,ms)=>{
  const id=++timerId;timers.set(id,{fn,ms});timerDelays.push(ms);return id;
};
const clearTimeoutFake=id=>timers.delete(id);
const runTimer=()=>{
  const callbacks=[...timers.values()];timers.clear();
  callbacks.forEach(item=>item.fn());
};
let mode='succeeded',currentTask='',taskNum=0,apiCalls=0,refreshes=0,selectedClears=0;
let toastMessages=[];
const VaultStore={
  ws:'company',token:'session',
  api:async (url,opts)=>{
    assert.match(url,/^\/api\/trash\/company\/purge-task$/);
    assert.equal(opts.method,'POST');
    assert.equal(timers.size,0,'new batch cancels previous success timeout');
    apiCalls++;
    currentTask='task-'+(++taskNum);
    return {json:async()=>({taskId:currentTask})};
  },
  getJson:async()=>({active:false}),
};
const sandbox={
  document,
  $:id=>id==='#trashPurgeProgress'?panel:null,
  VaultStore,
  Drive:{clearSelection:()=>{selectedClears++;}},
  refreshCurrent:async()=>{refreshes++;},
  toast:(message)=>{toastMessages.push(message);},
  fetch:async()=>({
    status:200,ok:true,
    json:async()=>({taskId:currentTask,workspace:'company',state:mode,
      count:1,bytesTotal:0,bytesDone:0,stage:mode==='succeeded'?'已提交':'未完成',
      error:mode==='succeeded'?null:'模拟删除未完成'}),
  }),
  fmtSize:n=>String(n),
  setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,
  Promise,Error,Number,Set,Map,Math,
};
vm.createContext(sandbox);
vm.runInContext('let purgeTaskActive=false;\n'+purgeCode,sandbox,{filename:'bridge-purge.js'});
const nodes=(n)=>Array.from({length:n},(_,i)=>({
  biz:{raw:{id:i+1,kind:'v2_archive_folder',section:'general'}}
}));
const run=js=>vm.runInContext(js,sandbox);

(async()=>{
  mode='succeeded';
  await run('purgeTrash('+JSON.stringify(nodes(1))+')');
  assert.equal(panel.hidden,false,'completed delete remains visible briefly');
  assert.equal(panel.querySelector('#trashPurgePercent').textContent,'完成');
  assert.equal(panel.querySelector('#trashPurgeClose').hidden,false);
  assert.equal(timers.size,1,'committed delete schedules a single hide');
  runTimer();
  assert.equal(panel.hidden,true,'success progress panel closes automatically');
  assert.equal(await run('resumePurge()'),false);
  assert.equal(panel.hidden,true,'clicking Recycle Bin must not reopen the last success');
  assert.equal(timers.size,0,'no repeated auto-hide timer after navigation');

  // Cancellation/error must stay visible so users can read the failure.
  mode='failed';toastMessages=[];
  await run('purgeTrash('+JSON.stringify(nodes(1))+')');
  assert.equal(panel.hidden,false);
  assert.equal(timers.size,0,'failure must never auto-hide');
  assert.ok(toastMessages.some(x=>x.includes('模拟删除未完成')));

  mode='canceled';
  await run('purgeTrash('+JSON.stringify(nodes(1))+')');
  assert.equal(panel.hidden,false);
  assert.equal(timers.size,0,'canceled task remains for inspection');

  // One timeout for the entire transaction, not one per 200-record batch.
  mode='succeeded';let oldCalls=apiCalls;
  await run('purgeTrash('+JSON.stringify(nodes(201))+')');
  assert.equal(apiCalls-oldCalls,2,'201 entries use two server batches');
  assert.equal(timers.size,1,'only entire successful batch queues close');
  assert.equal(panel.hidden,false);

  // Manual close dismisses immediately and cancels the timer.
  panel.querySelector('#trashPurgeClose').handlers.click();
  assert.equal(panel.hidden,true);
  assert.equal(timers.size,0);
  assert.equal(await run('resumePurge()'),false);
  assert.equal(panel.hidden,true,'manual close survives revisiting Recycle Bin');

  // A new operation cancels any old success callback, even if it races.
  await run('purgeTrash('+JSON.stringify(nodes(1))+')');
  const oldCallback=[...timers.values()][0];
  mode='failed';
  const originalApi=VaultStore.api;
  VaultStore.api=async(...args)=>{
    assert.equal(timers.size,0,'new delete cancels old pending auto-close');
    oldCallback();
    assert.equal(panel.hidden,false,'stale callback must not hide active delete');
    return originalApi(...args);
  };
  await run('purgeTrash('+JSON.stringify(nodes(1))+')');
  assert.equal(timers.size,0);
  assert.equal(panel.hidden,false,'failed newer operation remains visible');
  VaultStore.api=originalApi;

  // The server retains terminal snapshots. Re-entering Recycle Bin or refreshing
  // must never resurrect a completed (or manually dismissed failed) progress panel.
  mode='succeeded';panel.hidden=true;
  assert.equal(await run('resumePurge()'),false);
  assert.equal(panel.hidden,true,'previously hidden success must stay dismissed');
  assert.equal(timers.size,0,'terminal snapshot must not schedule another timeout');
  mode='failed';
  assert.equal(await run('resumePurge()'),false);
  assert.equal(panel.hidden,true,'dismissed failure must stay dismissed');
  assert.equal(timers.size,0);

  // Resuming a real running task still displays progress and tracks its terminal
  // state; once it auto-hides, navigation must not show the same result again.
  mode='running';panel.hidden=true;timerDelays.length=0;
  assert.equal(await run('resumePurge()'),true);
  await new Promise(r=>setImmediate(r));
  assert.equal(panel.hidden,false,'active purge remains recoverable');
  assert.ok(timerDelays.includes(550),'resumed task polls the server');
  mode='succeeded';
  runTimer();
  await new Promise(r=>setImmediate(r));
  assert.equal(timers.size,1,'resumed success auto-hides once');
  runTimer();
  assert.equal(panel.hidden,true);
  assert.equal(await run('resumePurge()'),false);
  assert.equal(panel.hidden,true,'auto-hidden resumed success cannot reopen');
  assert.equal(timers.size,0);

  /* B04: 轮询中会话变更 —— 停止跟踪、提示核对，绝不替用户宣告成功或失败。 */
  mode='running';toastMessages=[];timerDelays.length=0;panel.hidden=true;
  VaultStore.token='session-A';
  const tracking=run('trackPurge('+JSON.stringify(currentTask)+',"company",false)');
  await new Promise(r=>setImmediate(r));
  assert.ok(timerDelays.includes(550),'running task polls at the normal interval');
  assert.equal(panel.hidden,false,'progress panel stays open while running');
  VaultStore.token='session-B';
  runTimer();
  const stopped=await tracking;
  assert.equal(stopped,null,'session change must end tracking without a verdict');
  assert.match(panel.querySelector('#trashPurgeStage').textContent,/会话已变更/);
  assert.equal(toastMessages.length,0,'session change must not claim success or failure');
  assert.equal(timers.size,0,'an unconfirmed result must not schedule auto-hide');

  /* 任务身份对不上（服务端另开了新任务）时按 1.2 秒重试，而不是采纳别人的进度。 */
  mode='running';toastMessages=[];timerDelays.length=0;panel.hidden=true;
  VaultStore.token='session-C';
  const foreign=run('trackPurge("task-of-another-client","company",true)');
  await new Promise(r=>setImmediate(r));
  assert.ok(timerDelays.includes(1200),'identity mismatch retries after 1.2 seconds');
  assert.match(panel.querySelector('#trashPurgeStage').textContent,
    /暂时无法获取删除进度/);
  VaultStore.token='session-D';
  runTimer();
  assert.equal(await foreign,null,'a foreign task id must never be reported as ours');
  assert.equal(toastMessages.length,0,'silent tracking never toasts');

  assert.ok(refreshes>0&&selectedClears>0);
  console.log('PURGE PROGRESS SMOKE PASS: terminal snapshots not replayed on navigation, running resume, auto-close, batch gating, failure/cancel visibility and stale timer');
})().catch(e=>{console.error(e);process.exitCode=1;});
