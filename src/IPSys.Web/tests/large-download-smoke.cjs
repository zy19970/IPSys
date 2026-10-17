'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/IPSys.Web/wwwroot/app.js','utf8');
const start=source.indexOf('async function saveOriginalToDisk(');
const end=source.indexOf('async function downloadBusinessAttachment(',start);
assert.ok(start>0&&end>start,'large download helper is missing');
const helper=source.slice(start,end);

async function testDownload(actualBytes,expectedBytes){
 let selected=0,received=0,closed=0,aborted=0,blobRead=0;
 const file={name:'测试大原件.bin',size:expectedBytes};
 let remaining=actualBytes;
 const reader={
  async read(){
   if(!remaining)return {done:true};
   const count=Math.min(1024*1024,remaining);
   remaining-=count;
   return {done:false,value:new Uint8Array(count)};
  },
  releaseLock(){}
 };
 const writer={
  async write(bytes){received+=bytes.length;},
  async close(){closed++;},
  async abort(){aborted++;}
 };
 const sandbox={
  window:{async showSaveFilePicker(options){
   selected++;
   assert.equal(options.suggestedName,file.name);
   return {async createWritable(){return writer;}};
  }},
  api:async path=>{
   assert.equal(path,'/api/v2/test/large');
   return {body:{getReader(){return reader;}},async blob(){blobRead++;throw Error('large Blob forbidden');}};
  }
 };
 const save=vm.runInNewContext(helper+'\nsaveOriginalToDisk;',sandbox);
 if(actualBytes===expectedBytes){
  await save(file,'/api/v2/test/large');
  assert.equal(closed,1);
  assert.equal(aborted,0);
 }else{
  await assert.rejects(save(file,'/api/v2/test/large'),/下载不完整/);
  assert.equal(closed,0);
  assert.equal(aborted,1);
 }
 assert.equal(selected,1);
 assert.equal(blobRead,0);
 assert.equal(received,actualBytes);
}
(async()=>{
 await testDownload(32*1024*1024+1,32*1024*1024+1);
 await testDownload(1024*1024,32*1024*1024+1);
 console.log('LARGE BROWSER STREAM DOWNLOAD SMOKE PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
