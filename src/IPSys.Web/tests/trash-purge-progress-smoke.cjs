'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('src/IPSys.Web/wwwroot/app.js','utf8');
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
assert.ok(app.includes('void resumeTrashPurgeStatus();')&&
 app.includes('async function resumeTrashPurgeStatus()'),
 'Browser reload and workspace re-selection must reattach to the running task');
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
vm.runInNewContext(section+'\nthis.render=renderTrashPurge;this.panel=trashPurgePanel;',ctx);
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
console.log('RECYCLE PURGE REAL-BYTE PROGRESS UI SMOKE PASS');
