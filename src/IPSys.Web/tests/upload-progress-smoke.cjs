'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync('src/IPSys.Web/wwwroot/upload-progress.js','utf8');
const adapter=fs.readFileSync('src/IPSys.Web/wwwroot/ip-v2.js','utf8');
/* Official frontend sources and capability modules share the wwwroot directory. */
const shell=path.resolve(__dirname,'../wwwroot');
const bridge=fs.readFileSync(path.join(shell,'js/bridge.js'),'utf8');
const html=fs.readFileSync(path.join(shell,'index.html'),'utf8');
/* What actually matters: every capability script must define its global before
   the shell bundle runs — bridge.js reads globalThis.IPSysUploadProgress at the
   top level, so a later load order makes CapabilityApi.uploadProgress undefined
   and every upload dies on the first line. The relative order among the four
   capability scripts is irrelevant. */
const before=file=>html.indexOf(file);
assert.ok(before('/upload-progress.js')>0&&before('/ip-v2.js')>0&&before('/app.js')>0,
 'index.html must load the capability layer and the shell bundle');
for(const file of ['/upload-progress.js','/ip-v2.js','/export.js','/pdf-preview.js'])
 assert.ok(before(file)<before('/app.js'),
  file+' must load before /app.js so its global exists when the shell boots');
assert.ok(adapter.includes('api.uploadFile(path+"/prepare?folderId="')&&
 adapter.includes('api.uploadFile(record.kind==="ip"')&&
 adapter.includes('api.uploadProgress.stage("已选择保存方式')&&
 adapter.includes('signal:api.uploadProgress.signal()'),
 'Both V2 create and version upload must stream with progress and await server confirmation');
assert.ok(bridge.includes('progress.begin(list.length)')&&
 bridge.includes('progress.finish({ completed, errors, skipped })')&&
 bridge.includes('CapabilityApi.uploadProgress.onActiveChanged = (active) =>')&&
 bridge.includes('fileTaskActive = !!active;')&&
 bridge.includes('setTimeout(() => refreshCurrent().catch(() => {}), 450)'),
 'The shell must hand the whole batch to the capability layer and reload only once it is idle');

class FakeNode{
 constructor(){
  this.hidden=false;this.disabled=false;this.textContent='';this.value=0;this.attrs={};
  this.children=new Map();
 }
 setAttribute(key,value){this.attrs[key]=value;}
 set innerHTML(_html){
  for(const id of ['uploadProgressCancel','uploadProgressClose','uploadProgressCount',
   'uploadProgressFile','uploadProgressMeter','uploadProgressPercent',
   'uploadProgressBytes','uploadProgressStage'])this.children.set(id,new FakeNode());
 }
 querySelector(key){return this.children.get(key.replace('#',''));}
}
const created=[];
const document={
 createElement:tag=>new FakeNode(tag),
 body:{append(el){created.push(el);}}
};
class FakeXHR{
 static all=[];
 constructor(){this.upload={};this.headers={};FakeXHR.all.push(this);}
 open(method,path){this.method=method;this.path=path;}
 setRequestHeader(name,value){this.headers[name]=value;}
 send(body){this.body=body;}
 abort(){this.wasAborted=true;this.onabort?.();}
}
const events=[],timers=new Map();
let nextTimerId=0;
const schedule=(callback,delay)=>{
 assert.equal(delay,1800,'success is shown briefly before auto-close');
 const id=++nextTimerId;timers.set(id,callback);return id;
};
const cancelTimer=id=>timers.delete(id);
const flushTimers=()=>{const all=[...timers.values()];timers.clear();all.forEach(fn=>fn());};
const sandbox={document,window:{dispatchEvent:event=>events.push(event.type)},
 Event,XMLHttpRequest:FakeXHR,Blob,DOMException,AbortController,Date,Math,
 Object,Number,JSON,Promise,Error,Set,Map,String,setTimeout:schedule,
 clearTimeout:cancelTimer,globalThis:null};
sandbox.globalThis=sandbox;
vm.runInNewContext(source,sandbox,{filename:'upload-progress.js'});
const upload=sandbox.IPSysUploadProgress;
const child=id=>created[0].querySelector('#'+id);
const blob=new Blob(['1234567890']);
(async()=>{
 assert.equal(upload.begin(2),true);
 assert.equal(upload.status().active,true);
 assert.equal(upload.status().count,2);
 assert.equal(upload.begin(1),false,'no parallel upload batches');
 upload.file({name:'big.pdf',size:10},1);
 assert.equal(upload.status().index,1,'workspace prompt shows the active batch position');
 const first=upload.request('/api/v2/files/company/prepare',{method:'POST',
  headers:{'X-File-Name':'big.pdf','Content-Type':'application/octet-stream'},body:blob},'token');
 let xhr=FakeXHR.all.at(-1);
 assert.equal(xhr.headers['X-IPSys-Token'],'token');
 assert.equal(xhr.body,blob,'never materialize a second original-file copy');
 xhr.upload.onprogress({loaded:4,total:10,lengthComputable:true});
 assert.equal(child('uploadProgressPercent').textContent,'40.0%');
 xhr.upload.onload();
 assert.equal(child('uploadProgressPercent').textContent,'100.0%');
 assert.match(child('uploadProgressStage').textContent,/正在等待服务器/);
 assert.equal(child('uploadProgressClose').hidden,true,
  '100% sent is not a successful saved file');
 xhr.status=200;xhr.responseText=JSON.stringify({ticket:'ticket-1'});
 xhr.onload();
 const response=await first;
 assert.equal((await response.json()).ticket,'ticket-1');
 upload.stage('正在确认文件关联');
 assert.match(child('uploadProgressStage').textContent,/正在确认/);
 upload.file({name:'another.pdf',size:10},2);
 const second=upload.request('/prepare',{method:'POST',headers:{},body:blob},'token');
 xhr=FakeXHR.all.at(-1);
 xhr.status=409;xhr.responseText=JSON.stringify({error:'有待确认文件'});
 xhr.onload();
 await assert.rejects(second,/有待确认文件/);
 upload.finish({completed:1,errors:['another.pdf：有待确认文件']});
 assert.equal(upload.status().active,false,'workspace prompt stops after upload finishes');
 assert.match(child('uploadProgressStage').textContent,/已保存 1，失败 1/);
 assert.equal(child('uploadProgressClose').hidden,false);
 assert.equal(child('uploadProgressCancel').hidden,true);
 child('uploadProgressClose').onclick();
 assert.equal(created[0].hidden,true);
 assert.equal(upload.begin(1),true);
 upload.file({name:'cancel.bin',size:10},1);
 const canceled=upload.request('/prepare',{method:'POST',headers:{},body:blob},'token');
 xhr=FakeXHR.all.at(-1);
 upload.cancel();
 await assert.rejects(canceled,e=>e.name==='AbortError');
 assert.equal(xhr.wasAborted,true,'cancel aborts in-flight XHR');
 assert.equal(upload.cancelled(),true);
 assert.ok(events.includes('ipsys-upload-cancel'),'cancel also dismisses dedup dialogs');
 upload.finish({completed:0});
 assert.match(child('uploadProgressStage').textContent,/已请求取消/);
 assert.equal(timers.size,0,'cancel must keep the panel visible');
 // A fully committed successful batch automatically closes after 1.8 seconds.
 assert.equal(upload.begin(1),true);
 upload.file({name:'ok.bin',size:10},1);
 upload.finish({completed:1});
 assert.equal(created[0].hidden,false,'success remains briefly readable');
 assert.equal(timers.size,1,'success schedules one close');
 flushTimers();
 assert.equal(created[0].hidden,true,'successful upload auto-hides the panel');
 // A new upload may start within the old success timer; it must stay visible.
 assert.equal(upload.begin(1),true);
 upload.finish({completed:1});
 assert.equal(timers.size,1);
 assert.equal(upload.begin(1),true,'finished task permits another upload');
 assert.equal(timers.size,0,'a newer batch cancels the old timer');
 flushTimers();
 assert.equal(created[0].hidden,false,'old timeout must not hide a new upload');
 upload.finish({completed:0,errors:['simulated failure']});
 assert.equal(timers.size,0,'failed upload must preserve the error summary');
 assert.equal(created[0].hidden,false);
 console.log('UPLOAD PROGRESS SMOKE PASS: progress, server confirmation, failure/cancel and success auto-hide');
})().catch(e=>{console.error(e);process.exitCode=1;});
