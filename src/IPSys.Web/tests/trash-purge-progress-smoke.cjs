'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('src/IPSys.Web/wwwroot/app.js','utf8').replace(/\r\n/g,'\n');
const from=app.indexOf('let trashPurgePolling=false');
const to=app.indexOf('async function changeTrash(',from);
assert.ok(from>0&&to>from,'persistent purge panel and task polling must exist');
const section=app.slice(from,to);
assert.ok(app.includes("/api/trash/'+workspace+'/purge-task")&&
 app.includes("method:'POST',json:{items}")&&
 app.includes('void trackTrashPurge(result.taskId,workspace)'),
 'delete command must start a task and then poll it');
assert.ok(section.includes("state.state==='succeeded'")&&
 section.includes('await refresh()')&&
 section.includes('!trashPurgeTaskActive'),
 'only successful server state allows UI to announce permanent deletion');
assert.ok(app.includes('return resumeTrashPurgeStatus().then(active=>')&&
 app.includes('async function resumeTrashPurgeStatus()')&&
 app.includes("await fetch('/api/trash/purge-task'"),
 'Switch must check the vault-wide task before starting database reads');
assert.ok(!section.includes('while(space===workspace&&token)')&&
 section.includes('while(token)')&&
 section.includes("api('/api/trash/purge-task')"),
 'Progress polling must survive switching between personal and company');
assert.ok(app.includes("if(trashPurgeTaskActive||vaultCompactTaskActive||localFileTaskActive){render();return;}")&&
 app.includes('if(trashPurgeTaskActive||vaultCompactTaskActive||localFileTaskActive){render();return;}\n  const requestedSpace=space;')&&
 app.includes('暂缓加载资料'),
 'Uploads and deletes must both prevent workspace reads on the busy SQLCipher Gate');
assert.ok(section.includes("status.bytesDone")&&section.includes("status.bytesTotal"),
 'progress must use actual deleted bytes, not a fake timer');
assert.ok(section.includes('status.state')&&section.includes("state.error"),
 'task must expose status and failures');
const elements=new Map();
class Element{
 constructor(){this.hidden=false;this.textContent='';this.value=0;this.children=new Map();}
 setAttribute(){}
 set innerHTML(_value){
  for(const name of ['trashPurgeCount','trashPurgeMeter','trashPurgePercent',
  'trashPurgeBytes','trashPurgeStage','trashPurgeClose'])
   this.children.set(name,new Element());
 }
 querySelector(selector){return this.children.get(selector.slice(1));}
 removeAttribute(attribute){if(attribute==='value')this.value=undefined;}
}
const document={
 createElement:()=>new Element(),
 getElementById:key=>elements.get(key)||null,
 body:{append:node=>elements.set(node.id,node)}
};
const ctx={document,fmtSize:n=>(n/1024/1024).toFixed(1)+' MiB',
 space:'company',token:'test-token',trashPurgeTaskActive:false,setTimeout,clearTimeout,
 Promise,console,globalThis:null,api(){throw Error('API unused');}};
ctx.globalThis=ctx;
vm.runInNewContext(section+'\nthis.render=renderTrashPurge;this.panel=trashPurgePanel;this.track=trackTrashPurge;',ctx);
ctx.render({state:'running',count:1,bytesDone:32*1024*1024,bytesTotal:128*1024*1024,
 stage:'正在清理加密原件数据块',error:null});
const panel=ctx.panel(),field=id=>panel.querySelector('#'+id);
assert.equal(panel.hidden,false);
assert.equal(field('trashPurgeMeter').value,25);
assert.equal(field('trashPurgePercent').textContent,'25%');
assert.match(field('trashPurgeStage').textContent,/未提交完成前不代表删除成功/);
assert.equal(field('trashPurgeClose').hidden,true);
ctx.render({state:'committing',count:1,bytesDone:128*1024*1024,bytesTotal:128*1024*1024,
 stage:'正在提交事务',error:null});
assert.equal(field('trashPurgeMeter').value,100);
assert.equal(field('trashPurgeClose').hidden,true,'100% deleted is not committed');
ctx.render({state:'failed',count:1,bytesDone:128*1024*1024,bytesTotal:128*1024*1024,
 stage:'删除失败，数据库已回滚',error:'模拟磁盘错误'});
assert.equal(field('trashPurgeClose').hidden,false);
assert.match(field('trashPurgeStage').textContent,/模拟磁盘错误/);
ctx.render({state:'succeeded',count:1,bytesDone:128*1024*1024,bytesTotal:128*1024*1024,
 stage:'永久删除成功',error:null});
assert.equal(field('trashPurgePercent').textContent,'完成');
assert.equal(field('trashPurgeClose').hidden,false);
ctx.render({state:'running',count:1,bytesDone:0,bytesTotal:0,
 stage:'正在清理关联',error:null});
assert.equal(field('trashPurgePercent').textContent,'处理中');
assert.match(field('trashPurgeBytes').textContent,/没有需要释放的原件字节/);
// Exercise the real polling function with a company purge while personal is
// selected. Before the fix this loop exited without making ANY request.
(async()=>{
 let calls=0,refreshed=0;
 ctx.space='personal';
 ctx.refresh=async()=>{refreshed++;};
 ctx.notice=()=>{};
 ctx.api=async path=>{
  assert.equal(path,'/api/trash/purge-task');
  calls++;
  return {json:async()=>({
   taskId:'company-purge',workspace:'company',state:'succeeded',
   stage:'永久删除成功',count:1,bytesDone:128*1024*1024,
   bytesTotal:128*1024*1024,error:null
  })};
 };
 await ctx.track('company-purge','company');
 assert.equal(calls,1,'changing workspace must not interrupt purge polling');
 assert.equal(refreshed,1,'completed company purge refreshes selected personal workspace');
 console.log('RECYCLE PURGE CROSS-WORKSPACE POLLING UI SMOKE PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
console.log('RECYCLE PURGE REAL-BYTE PROGRESS UI SMOKE PASS');
