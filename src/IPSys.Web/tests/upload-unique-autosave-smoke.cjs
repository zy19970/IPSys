'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/IPSys.Web/wwwroot/ip-v2.js','utf8')
 .replace(/\r\n/g,'\n');
const start=source.indexOf(' async function upload(api,file,meta,workspace){');
const stop=source.indexOf(' async function newVersion(',start);
assert.ok(start>=0&&stop>start,'native V2 prepare/resolve uploader exists');
const uploader=source.slice(start,stop);
async function scenario(matches,pick,expectedChoice){
 let prompted=0,discarded=0,preparedCount=0,postCount=0;
 const stages=[],decisions=[];
 const context={
  selectMatch:async(file,found)=>{
   prompted++;
   assert.deepEqual(JSON.parse(JSON.stringify(found)),matches,
    'user choice must be given the exact duplicate list');
   return pick;
  }
 };
 vm.runInNewContext(uploader+'\nthis.upload=upload;',context);
 const progress={
  signal:()=>({aborted:false}),
  stage:message=>stages.push(message)
 };
 const api=Object.assign(async (path,options)=>{
  if(options.method==='DELETE'){discarded++;return {};}
  assert.equal(options.method,'POST','resolve must be POST');
  assert.match(path,/\/prepared\/ticket-42\/resolve$/);
  postCount++;
  decisions.push(options.json);
  return {json:async()=>({fileId:77})};
 },{
  uploadProgress:progress,
  uploadFile:async(path,options)=>{
   assert.match(path,/\/api\/v2\/files\/company\/prepare\?folderId=9$/);
   assert.equal(options.body.name,'demo.pdf');
   preparedCount++;
   return {json:async()=>({ticket:'ticket-42',matches})};
  }
 });
 const result=await context.upload(api,{name:'demo.pdf'},{
  kind:'project',ownerId:9
 },'company');
 assert.equal(preparedCount,1);
 assert.equal(discarded,result?0:1,'only uncommitted tickets should be discarded');
 assert.equal(postCount,result?1:0);
 if(expectedChoice){
  assert.equal(prompted,0,'unique files must never prompt');
  assert.equal(decisions[0].choice,expectedChoice);
  assert.ok(stages.some(s=>s.includes('未发现相同内容，正在自动独立保存')),
   'progress should describe the automatic resolve stage');
 }else{
  assert.equal(prompted,1,'duplicate byte content requires user interaction');
  assert.ok(stages.some(s=>s.includes('检测到相同内容')),
   'duplicate prompt stage should be visible');
  if(pick)assert.deepEqual(JSON.parse(JSON.stringify(decisions[0])),
   pick,'duplicate must respect user choice');
 }
 return {result,prompted,discarded};
}
(async()=>{
 const unique=await scenario([],null,'independent');
 assert.equal(unique.result.fileId,77);
 const duplicates=[{fileId:15,name:'same.pdf',version:1,folders:['项目A']}];
 const matched=await scenario(duplicates,{choice:'reuse-content',sourceFileId:15},null);
 assert.equal(matched.result.fileId,77);
 const canceled=await scenario(duplicates,null,null);
 assert.equal(canceled.result,null);
 assert.equal(canceled.discarded,1,'cancel must release prepared content');
 console.log('UPLOAD UNIQUE AUTO-SAVE AND DUPLICATE CONFIRMATION SMOKE PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
