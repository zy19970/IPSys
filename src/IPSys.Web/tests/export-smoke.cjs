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
 {source:'v2file',kind:'project',ownerId:1,ownerName:'研发:项目',id:1,fileId:1,version:1,
  name:'方案.pdf',size:6,workspace:'company'},
 {source:'v2file',kind:'project',ownerId:2,ownerName:'研发:项目',id:2,fileId:2,version:1,
  name:'方案.pdf',size:5,workspace:'company'},
 {source:'v2file',kind:'contract',ownerId:11,ownerName:'合同A',projectId:1,
  projectName:'研发:项目',id:3,fileId:3,version:1,name:'附件.txt',size:7,workspace:'company'},
 {source:'v2file',kind:'contract',ownerId:12,ownerName:'合同A',projectId:1,
  projectName:'研发:项目',id:4,fileId:4,version:1,name:'附件.txt',size:8,workspace:'company'}
];
const urls=selected.map(x=>'/api/v2/files/company/'+x.fileId+
 '/versions/'+x.version+'/download');
['123456','abcde','aFile01','aFile002'].forEach((v,i)=>data.set(urls[i],Buffer.from(v)));
assert.ok(selected.every(x=>x.source==='v2file'&&x.fileId>0&&x.version===1),
 'Current export fixtures must use real V2 version identities');
const plan=exporter.makePlan(selected);
assert.deepEqual(JSON.parse(JSON.stringify(plan.map(x=>x.path))),[
 '研发_项目/方案.pdf','研发_项目 (2)/方案.pdf',
 '研发_项目/合同A/附件.txt','研发_项目/合同A (2)/附件.txt'
]);
(async()=>{
 await exporter.start('folder',selected);
 assert.match(elems.get('exportResult').textContent,/成功 4，失败 0/);
 assert.equal((await (await root.getDirectoryHandle('研发_项目')).getFileHandle('方案.pdf')).bytes.toString(),'123456');
 await exporter.start('folder',[{...selected[0],fileId:0}]);
 assert.match(notices.at(-1).message,/V2 FileId/,'Missing native file identity must fail closed before folder writes');
 assert.equal((await (await root.getDirectoryHandle('研发_项目')).getDirectoryHandle('合同A')).children.get('附件.txt').bytes.toString(),'aFile01');
 
// The shell projects the drive tree into export.js identities. The old shell
// did this in projectOriginals(); the new one walks the real node tree, so the
// same invariants are asserted through that entry point: every version of every
// attachment under the selected node, the right owner, and the archive folder
// chain that lets the ZIP rebuild nested directories.
const bridge=fs.readFileSync(path.resolve(__dirname,'../../../frontend/explorer/js/bridge.js'),'utf8');
const bridgeStart=bridge.indexOf('const EXPORTABLE_KINDS');
const bridgeEnd=bridge.indexOf('async function exportNodes',bridgeStart);
assert.ok(bridgeStart>=0&&bridgeEnd>bridgeStart,'Shell export projection missing');
const fileMeta=new Map();
const parents=new Map();
const shellCtx={VaultStore:{ws:'company',fileMeta},findParent:id=>parents.get(id)||null};
vm.runInNewContext(bridge.slice(bridgeStart,bridgeEnd)+
 '\nthis.collect=collectExportEntries;',shellCtx);
function folder(id,name,biz,children=[]){
 const node={id,type:'folder',name,biz,children,size:children.reduce((s,c)=>s+c.size,0)};
 for(const child of children)parents.set(child.id,node);
 return node;
}
function attachment(id,name,size,ownerKind,meta){
 fileMeta.set(id,meta);
 return {id,type:'file',name,size,biz:{kind:'file',ownerKind}};
}

// Nested archive directories: category -> 认定申报 -> 企业行标 -> record -> file.
const achievement=folder('k:achievement','业务档案',{kind:'k'},[
 folder('a:201','认定申报',{kind:'archive_folder',id:201},[
  folder('a:203','企业行标',{kind:'archive_folder',id:203},[
   folder('a:31','评审资料',{kind:'archive',id:31},[
    attachment('f:31:1','证明.docx',4,'archive',{fileId:401,version:1}),
   ]),
  ]),
 ]),
]);
const archiveEntries=Array.from(shellCtx.collect(achievement));
assert.equal(archiveEntries.length,1,'Every attachment under the selected category must be exported');
assert.equal(archiveEntries[0].kind,'archive');
assert.equal(archiveEntries[0].source,'v2file');
assert.equal(archiveEntries[0].ownerName,'评审资料','The record, not the directory, owns the ZIP subfolder');
assert.deepEqual(Array.from(archiveEntries[0].archiveFolderPath,x=>x.name),['认定申报','企业行标'],
 'The archive directory chain must survive the projection');
assert.deepEqual(JSON.parse(JSON.stringify(exporter.makePlan(archiveEntries).map(x=>x.path))),
 ['认定申报/企业行标/评审资料/证明.docx'],'ZIP must rebuild every nested directory level');

// Homonymous projects stay separated; every version of a file is included.
const projects=folder('k:project','公司项目',{kind:'k'},[
 folder('p:1','研发项目',{kind:'project',id:1},[
  attachment('f:1:1','报告.pdf',3,'project',{fileId:101,version:1}),
  attachment('f:2:2','报告.pdf',5,'project',{fileId:102,version:2}),
 ]),
 folder('p:2','横向项目',{kind:'project',id:2},[
  attachment('f:3:1','报告.pdf',8,'project',{fileId:103,version:1}),
 ]),
]);
const projectEntries=Array.from(shellCtx.collect(projects));
assert.deepEqual(Array.from(projectEntries,x=>x.fileId),[101,102,103],
 'Every attachment version of every selected project must be exported');
assert.deepEqual(Array.from(projectEntries,x=>x.ownerId),[1,1,2],'Owners must not bleed between records');
assert.ok(projectEntries.every(x=>x.workspace==='company'),'Workspace isolation');
assert.deepEqual(JSON.parse(JSON.stringify(exporter.makePlan(projectEntries).map(x=>x.path))),[
 '研发项目/报告.pdf','研发项目/报告 (2).pdf','横向项目/报告.pdf',
],'Same-named files inside one record must be suffixed, not merged');

// IP attachments download through their own route.
const ip=folder('k:ip','知识产权',{kind:'k'},[
 folder('i:5','一种专利',{kind:'ip',id:5},[
  attachment('f:9:1','权利要求.pdf',12,'ip',{fileId:501,version:1}),
 ]),
]);
assert.equal(Array.from(shellCtx.collect(ip))[0].source,'v2ip','IP attachments keep the v2ip route');
// Records the shell cannot export must be dropped, not silently mislabelled.
const unknown=folder('k:general','其他资料',{kind:'k'},[
 folder('g:7','杂项',{kind:'general',id:7},[
  attachment('f:8:1','说明.txt',2,'contract',{fileId:601,version:1}),
 ]),
]);
assert.equal(Array.from(shellCtx.collect(unknown)).length,0,
 'Unsupported owner kinds must be dropped instead of exported under the wrong record');

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
  assert.equal(content.toString(),data.get('/api/v2/files/company/'+item.fileId+
    '/versions/'+item.version+'/download').toString());
  offset+=46+length;
 }
 // Individual missing file is skipped and the rest of the ZIP remains complete.
 await exporter.start('zip',[...selected.slice(0,1),{...selected[1],id:999,fileId:999}]);
 assert.ok(savedZip.bytes,'ZIP should be retained if one file succeeded');
 assert.match(elems.get('exportResult').textContent,/成功 1，失败 1/);
 assert.equal(savedZip.bytes.readUInt16LE(savedZip.bytes.length-22+10),1);
 assert.equal(elems.get('exportStatus').hidden,false,'Export result visible briefly');
 const lastTimer=[...timers.values()].at(-1);
 assert.equal(lastTimer.delay,18000,'Failures should remain visible longer');
 lastTimer.fn();
 assert.equal(elems.get('exportStatus').hidden,true,'Export result must auto-dismiss');
 // Directory exports use folder identities and keep arbitrary depth in the ZIP.
 const archiveFiles=[
  {source:'v2file',kind:'archive',section:'achievement',workspace:'company',
   ownerId:31,ownerName:'申报资料',id:401,fileId:401,version:1,name:'申报.pdf',size:3,
   archiveFolderPath:[{id:201,name:'认定申报'},{id:203,name:'企业行标'}]},
  {source:'v2file',kind:'archive',section:'achievement',workspace:'company',
   ownerId:33,ownerName:'评审资料',id:402,fileId:402,version:1,name:'证明.docx',size:4,
   archiveFolderPath:[{id:201,name:'认定申报'},{id:203,name:'企业行标'},{id:204,name:'2026年度'}]},
  {source:'v2file',kind:'archive',section:'achievement',workspace:'company',
   ownerId:34,ownerName:'申报资料',id:403,fileId:403,version:1,name:'申报.pdf',size:5,
   archiveFolderPath:[{id:201,name:'认定申报'},{id:205,name:'技术认证'}]}
 ];
 const archivePlan=exporter.makePlan(archiveFiles);
 assert.deepEqual(JSON.parse(JSON.stringify(archivePlan.map(x=>x.path))),[
  '认定申报/企业行标/申报资料/申报.pdf',
  '认定申报/企业行标/2026年度/评审资料/证明.docx',
  '认定申报/技术认证/申报资料/申报.pdf'
 ],'Archive folder download must retain all nested directory/record levels');
 for(const [index,file] of archiveFiles.entries())
  data.set('/api/v2/files/company/'+file.fileId+'/versions/'+file.version+'/download',
   Buffer.from(['abc','defg','12345'][index]));
 await exporter.start('zip',archiveFiles);
 const directoryZip=savedZip.bytes;
 assert.ok(directoryZip&&directoryZip.length>22,'Nested directory ZIP must be generated');
 let centralOffset=directoryZip.readUInt32LE(directoryZip.length-22+16);
 for(const entry of archivePlan){
  assert.equal(directoryZip.readUInt32LE(centralOffset),0x02014b50);
  const len=directoryZip.readUInt16LE(centralOffset+28);
  assert.equal(directoryZip.subarray(centralOffset+46,centralOffset+46+len).toString(),entry.path);
  centralOffset+=46+len;
 }
 console.log('ARCHIVE DIRECTORY EXPORT PASS: recursive path hierarchy in ZIP');
 console.log('EXPORT SMOKE PASS: naming, nested projects, archive directories, repeated folders, ZIP bytes, partial failures');
})().catch(err=>{console.error(err);process.exitCode=1});