'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.resolve(__dirname,'../wwwroot/export.js'),'utf8');
const data=new Map();
const notices=[];
const elems=new Map();
function element(){
 return {id:'',children:[],hidden:false,textContent:'',disabled:false,
  append(...children){this.children.push(...children)},
  setAttribute(k,v){this[k]=v}};
}
function register(node){
 if(node.id)elems.set(node.id,node);
 for(const child of node.children)register(child);
}
const document={
 createElement:()=>element(),
 body:{append:register},
 getElementById:id=>elems.get(id)||null
};
class Writer{
 constructor(file){this.file=file;this.parts=Buffer.alloc(0);this.position=0;this.closed=false;this.aborted=false;}
 async write(bytes){
  const chunk=Buffer.from(bytes),after=this.position+chunk.length;
  if(after>this.parts.length)this.parts=Buffer.concat([this.parts,Buffer.alloc(after-this.parts.length)]);
  chunk.copy(this.parts,this.position);this.position=after;
 }
 async truncate(size){this.parts=this.parts.subarray(0,size);this.position=Math.min(this.position,size)}
 async seek(position){this.position=position}
 async close(){this.file.bytes=Buffer.from(this.parts);this.closed=true}
 async abort(){this.aborted=true;this.file.aborted=true}
}
class FileHandle{
 constructor(){this.bytes=null;this.aborted=false;}
 async createWritable(){return new Writer(this)}
}
class Folder{
 constructor(){this.children=new Map();}
 async *entries(){for(const item of this.children)yield item}
 async getDirectoryHandle(name,{create=false}={}){
  let d=this.children.get(name);
  if(!d&&create){d=new Folder();this.children.set(name,d)}
  if(!(d instanceof Folder))throw Error('folder does not exist');
  return d;
 }
 async getFileHandle(name,{create=false}={}){
  let f=this.children.get(name);
  if(!f&&create){f=new FileHandle();this.children.set(name,f)}
  if(!(f instanceof FileHandle))throw Error('file not found');
  return f;
 }
 async removeEntry(name){this.children.delete(name)}
}
const root=new Folder();
let savedZip=null;
const window={
 async showDirectoryPicker(){return root;},
 async showSaveFilePicker(){savedZip=new FileHandle();return savedZip;}
};
async function api(url,{signal}={}){
 if(!data.has(url))throw Error('原件不存在：'+url);
 const bytes=data.get(url);let called=0;
 return {body:{getReader(){return {
  async read(){
   if(signal?.aborted)throw new DOMException('已取消','AbortError');
   if(called++)return {done:true};
   return {done:false,value:new Uint8Array(bytes)};
  },
  releaseLock(){}
 }}}};
}
const timers=new Map();let timerId=0;
const fakeSetTimeout=(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId};
const fakeClearTimeout=id=>timers.delete(id);
const sandbox={document,window,TextEncoder,Uint32Array,Uint8Array,DataView,api,
 notice:(message,bad)=>notices.push({message,bad}),DOMException,AbortController,console,
 setTimeout:fakeSetTimeout,clearTimeout:fakeClearTimeout};
vm.runInNewContext(code,sandbox,{filename:'export.js'});
const exporter=sandbox.IPSysExport;
assert.ok(exporter);
assert.equal(exporter.cleanName('CON.pdf'),'_CON.pdf');
const selected=[
 {source:'business',kind:'project',ownerId:1,ownerName:'研发:项目',id:1,
  name:'方案.pdf',size:6,workspace:'company'},
 {source:'business',kind:'project',ownerId:2,ownerName:'研发:项目',id:2,
  name:'方案.pdf',size:5,workspace:'company'},
 {source:'business',kind:'contract',ownerId:11,ownerName:'合同A',projectId:1,
  projectName:'研发:项目',id:3,name:'附件.txt',size:7,workspace:'company'},
 {source:'business',kind:'contract',ownerId:12,ownerName:'合同A',projectId:1,
  projectName:'研发:项目',id:4,name:'附件.txt',size:8,workspace:'company'}
];
const urls=selected.map(x=>'/api/business-files/company/download/'+x.id);
['123456','abcde','aFile01','aFile002'].forEach((v,i)=>data.set(urls[i],Buffer.from(v)));
const plan=exporter.makePlan(selected);
assert.deepEqual(JSON.parse(JSON.stringify(plan.map(x=>x.path))),[
 '研发_项目/方案.pdf','研发_项目 (2)/方案.pdf',
 '研发_项目/合同A/附件.txt','研发_项目/合同A (2)/附件.txt'
]);
(async()=>{
 await exporter.start('folder',selected);
 assert.match(elems.get('exportResult').textContent,/成功 4，失败 0/);
 assert.equal((await (await root.getDirectoryHandle('研发_项目')).getFileHandle('方案.pdf')).bytes.toString(),'123456');
 assert.equal((await (await root.getDirectoryHandle('研发_项目')).getDirectoryHandle('合同A')).children.get('附件.txt').bytes.toString(),'aFile01');
 
// Project export must include all active project and linked-contract file versions,
// while excluding unrelated project/contract and IP originals.
const appCode=fs.readFileSync(path.resolve(__dirname,'../wwwroot/app.js'),'utf8');
const projectStart=appCode.indexOf('function projectOriginals(');
const projectEnd=appCode.indexOf('function businessFileCount(',projectStart);
assert.ok(projectStart>=0&&projectEnd>projectStart,'Project all-original export helper missing');
const projectContext={
 projectRows:[{id:1,name:'研发:项目'},{id:2,name:'研发:项目'},{id:3,name:'未选项目'}],
 contractRows:[{id:11,name:'合同A',projectId:1},{id:12,name:'合同A',projectId:2},
  {id:13,name:'无关合同',projectId:3}],
 businessFileRows:[
  {id:101,name:'报告.pdf',size:3,kind:'project',ownerId:1,version:1},
  {id:102,name:'报告.pdf',size:5,kind:'project',ownerId:1,version:2},
  {id:103,name:'合同.pdf',size:8,kind:'contract',ownerId:11,version:1},
  {id:104,name:'合同.pdf',size:9,kind:'contract',ownerId:12,version:1},
  {id:105,name:'忽略.pdf',size:6,kind:'contract',ownerId:13,version:1},
  {id:106,name:'忽略.pdf',size:6,kind:'project',ownerId:3,version:1},
  {id:107,name:'其他专利.pdf',size:3,kind:'ip',ownerId:1,version:1}
 ],
 space:'personal'
};
const projectFiles=vm.runInNewContext(appCode.slice(projectStart,projectEnd)+
 '\nprojectOriginals([1,2])',projectContext);
assert.deepEqual(Array.from(projectFiles,x=>x.id),[101,102,103,104],
 'Every selected project must include all project/contract versions, excluding others');
assert.ok(projectFiles.every(x=>x.workspace==='personal'),'Workspace isolation');
assert.deepEqual(JSON.parse(JSON.stringify(exporter.makePlan(projectFiles).map(x=>x.path))),[
 '研发_项目/报告.pdf','研发_项目/报告 (2).pdf',
 '研发_项目/合同A/合同.pdf','研发_项目 (2)/合同A/合同.pdf'
],'ZIP/folder grouping must keep each project and its contracts separate');

 // Q149: repeating export never changes the prior export tree.
 await exporter.start('folder',selected.slice(0,1));
 assert.ok(root.children.has('研发_项目 (3)'));
 await exporter.start('zip',selected.slice(0,3));
 const zip=savedZip.bytes;
 assert.ok(zip&&zip.length>0);
 const footer=zip.length-22;
 assert.equal(zip.readUInt32LE(footer),0x06054b50,'ZIP end marker');
 const count=zip.readUInt16LE(footer+10);
 assert.equal(count,3,'selected file count');
 let offset=zip.readUInt32LE(footer+16);
 for(const item of plan.slice(0,3)){
  assert.equal(zip.readUInt32LE(offset),0x02014b50,'ZIP central record');
  const length=zip.readUInt16LE(offset+28);
  const name=zip.subarray(offset+46,offset+46+length).toString();
  assert.equal(name,item.path);
  const local=zip.readUInt32LE(offset+42),nameBytes=zip.readUInt16LE(local+26);
  const content=zip.subarray(local+30+nameBytes,local+30+nameBytes+item.size);
  assert.equal(content.toString(),data.get('/api/business-files/company/download/'+item.id).toString());
  offset+=46+length;
 }
 // Individual missing file is skipped and the rest of the ZIP remains complete.
 await exporter.start('zip',[...selected.slice(0,1),{...selected[1],id:999}]);
 assert.ok(savedZip.bytes,'ZIP should be retained if one file succeeded');
 assert.match(elems.get('exportResult').textContent,/成功 1，失败 1/);
 assert.equal(savedZip.bytes.readUInt16LE(savedZip.bytes.length-22+10),1);
 assert.equal(elems.get('exportStatus').hidden,false,'Export result visible briefly');
 const lastTimer=[...timers.values()].at(-1);
 assert.equal(lastTimer.delay,18000,'Failures should remain visible longer');
 lastTimer.fn();
 assert.equal(elems.get('exportStatus').hidden,true,'Export result must auto-dismiss');
 console.log('EXPORT SMOKE PASS: naming, nested contracts, repeated folders, ZIP bytes and partial failures');
})().catch(err=>{console.error(err);process.exitCode=1});