/* Drive tree shape.
   --------------------------------------------------------------------------
   Contracts are not a top-level category: a contract belongs to a project and
   lives inside it, so the tree must be 项目 / 合同 / 原件. The backend already
   returns the link (`/api/v2/ui/contracts/{ws}` carries projectId) and returns
   contract originals with folderId = the contract's own folder id. What this
   test pins is that buildTree actually assembles those three levels, because a
   contract that fails to land under its project is invisible in the UI and
   silently absent from every export.
   -------------------------------------------------------------------------- */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const SHELL=path.resolve(__dirname,'../wwwroot');
/* store.js is a plain object literal at the top level — nothing runs until a
   method is called — so the whole file can be loaded without a DOM. */
const ctx=vm.createContext({
 console,Date,Math,JSON,Set,Map,String,Number,Object,Array,Promise,Error,RegExp,
 sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
 window:{},
 fetch:()=>{throw Error('buildTree must never touch the network');},
});
for(const file of ['js/data.js','js/store.js'])
 vm.runInContext(fs.readFileSync(path.join(SHELL,file),'utf8'),ctx,{filename:file});

const run=code=>vm.runInContext(code,ctx);

const projects=[
 {id:1,name:'研发项目',projectType:'纵向项目'},
 {id:2,name:'横向项目',projectType:'横向项目'},
];
const contracts=[
 {id:11,name:'合同A',projectId:1,projectName:'研发项目',contractNo:'HT-01',signDate:'2026-03-01',amount:'120000'},
 {id:12,name:'合同B',projectId:2,projectName:'横向项目',contractNo:'HT-02'},
];
/* project-files flattens both kinds together; folderId is the owning folder. */
const projectFiles=[
 {linkId:1,fileId:101,version:1,folderId:1,kind:'project',name:'立项报告.pdf',size:100},
 {linkId:2,fileId:201,version:1,folderId:11,kind:'contract',name:'合同正文.pdf',size:200},
 {linkId:3,fileId:202,version:2,folderId:11,kind:'contract',name:'扫描件.pdf',size:50},
 {linkId:4,fileId:301,version:1,folderId:2,kind:'project',name:'说明.docx',size:10},
];

run(`ROOT=VaultStore.buildTree(${JSON.stringify({
 ws:'company',projects,contracts,archive:{},ip:{},projectFiles,
})});`);

const cat=run(`ROOT.children.find(c=>c.id==='k:project')`);
assert.ok(cat,'The project category must exist');
assert.equal(cat.children.length,2);

const p1=run(`ROOT.children.find(c=>c.id==='k:project').children.find(c=>c.id==='p:1')`);
const ids=Array.from(p1.children,x=>x.id);
assert.ok(ids.includes('c:11'),'A contract must be a child of its own project');
assert.ok(ids.includes('f:1:1'),'The project keeps its own originals alongside its contracts');

const c11=run(`ROOT.children.find(c=>c.id==='k:project').children.find(c=>c.id==='p:1').children.find(c=>c.id==='c:11')`);
assert.equal(c11.type,'folder','A contract is a container, not a file');
assert.deepEqual(Array.from(c11.children,x=>x.id),['f:2:1','f:3:2'],
 'Every version of every contract original hangs off the contract');
assert.equal(c11.biz.kind,'contract');
assert.equal(c11.biz.id,11);
assert.equal(c11.biz.code,'HT-01','Ledger fields stay on the node for the detail panel');
assert.equal(c11.biz.projectId,1,'Export needs projectId to nest the contract under its project');
assert.equal(c11.biz.projectName,'研发项目');
assert.equal(c11.dateLabel,'2026-03-01','The signing date drives the list date column');

/* Attachment identity is what the exporter and the uploader branch on, so the
   owning kind has to survive even though the contract itself is a folder. */
assert.equal(run(`ROOT.children.find(c=>c.id==='k:project').children.find(c=>c.id==='p:1').children.find(c=>c.id==='c:11').children[0].biz.ownerKind`),
 'contract','Contract originals must keep ownerKind=contract, not inherit project');
assert.equal(run(`ROOT.children.find(c=>c.id==='k:project').children.find(c=>c.id==='p:1').children.find(c=>c.id==='f:1:1').biz.ownerKind`),
 'project','Project originals keep ownerKind=project even when a contract sits beside them');

/* Rollups have to include contract originals, otherwise the home page reports
   less storage than the library actually uses. */
assert.equal(p1.size,350,'Project size must include its contracts\' originals (100 + 250)');
assert.equal(run(`ROOT.children.find(c=>c.id==='k:project').children.find(c=>c.id==='p:1').children.find(c=>c.id==='c:11').size`),250);

/* Two contracts under different projects must not be cross-linked. */
const p2=run(`ROOT.children.find(c=>c.id==='k:project').children.find(c=>c.id==='p:2')`);
assert.deepEqual(Array.from(p2.children,x=>x.id).sort(),['c:12','f:4:1']);

/* Whole-tree index: navigation, right-click and preview all resolve by id. */
assert.equal(run(`findById('c:11').name`),'合同A');
assert.equal(run(`findParent('f:2:1').id`),'c:11','A contract original must resolve its contract as parent');
assert.equal(run(`findParent('c:11').id`),'p:1','A contract must resolve its project as parent');

/* A contract with no parent in this workspace must not be invented anywhere:
   the endpoint filters those out, and a defensive filter here keeps a stale
   response from producing an orphan node. */
run(`globalThis.orphan=VaultStore.buildTree(${JSON.stringify({
 ws:'company',
 projects:[{id:1,name:'研发项目'}],
 contracts:[{id:99,name:'孤儿合同',projectId:404,projectName:'已删除项目'}],
 archive:{},ip:{},projectFiles:[],
})});`);
assert.equal(run(`orphan.children.find(c=>c.id==='k:project').children[0].children.length`),0,
 'A contract whose project is absent must not be attached to an unrelated project');

/* Recycle-bin entries keep their own shape; contracts were declared out of
   scope there, so nothing may leak into the normal tree through that path. */
assert.ok(run(`typeof VaultStore.loadRecycle==='function'`));


/* BUG-001：扁平 parentId 接口必须构造完整三级目录；记录不能被提升到分类根。 */
const multilevel={
 ws:'company',
 projects:[{id:1,name:'项目甲'}],
 contracts:[{id:11,name:'合同甲',projectId:1,projectName:'项目甲'}],
 archive:{
  folders:[
   {id:70,name:'系统目录',parentId:null,position:0,isSystem:true},
   {id:71,name:'二级目录',parentId:70,position:0},
   {id:72,name:'三级目录',parentId:71,position:0},
  ],
  archives:[{id:91,name:'三级归档',section:'achievement',folderId:72}],
  files:[
   {linkId:10,fileId:510,version:1,ownerId:91,kind:'archive',name:'档案旧版',size:10},
   {linkId:10,fileId:510,version:2,ownerId:91,kind:'archive',name:'档案新版',size:20},
  ],
  general:[{id:92,title:'综合资料',files:[
   {linkId:11,fileId:511,version:1,name:'综合旧版',size:1},
   {linkId:11,fileId:511,version:2,name:'综合新版',size:2},
  ]}],
 },
 ip:{
  rows:[{id:93,data:{name:'知识产权'}}],
  files:[
   {linkId:12,fileId:512,version:1,folderId:93,name:'知识产权旧版',size:5},
   {linkId:12,fileId:512,version:2,folderId:93,name:'知识产权新版',size:7},
   {linkId:13,fileId:512,version:2,folderId:93,name:'独立关联同一原件',size:7},
  ],
 },
 projectFiles:[
  {linkId:14,fileId:514,version:1,folderId:1,kind:'project',name:'项目旧版',size:3},
  {linkId:14,fileId:514,version:2,folderId:1,kind:'project',name:'项目新版',size:4},
  {linkId:15,fileId:515,version:1,folderId:11,kind:'contract',name:'合同旧版',size:6},
  {linkId:15,fileId:515,version:2,folderId:11,kind:'contract',name:'合同新版',size:8},
 ],
};
run('ROOT=VaultStore.buildTree('+JSON.stringify(multilevel)+')');
const archivePath=Array.from(run("pathTo('a:achievement:91')"),x=>x.id);
assert.deepEqual(archivePath,['root','k:achievement','af:70','af:71','af:72','a:achievement:91'],
 'A record must stay under its full three-level archive directory path');
assert.equal(run("findParent('af:72').id"),'af:71');
assert.equal(run("findParent('af:71').id"),'af:70');
assert.equal(run("findById('af:70').size"),20,
 'Parent folder bytes must include nested record only once, at the latest version');

/* BUG-002：所有业务模块只按 LinkId 展示最新版，不能按 FileId 合并共享引用。 */
const childIds=id=>Array.from(run("findById("+JSON.stringify(id)+").children"),x=>x.id);
assert.deepEqual(childIds('a:achievement:91'),['f:10:2']);
assert.deepEqual(childIds('g:92'),['f:11:2']);
assert.deepEqual(childIds('i:93').sort(),['f:12:2','f:13:2']);
assert.deepEqual(childIds('c:11'),['f:15:2']);
assert.deepEqual(childIds('p:1').sort(),['c:11','f:14:2']);
assert.equal(run("VaultStore.metaOf('f:12:2').version"),2);
assert.equal(run("findById('i:93').size"),14,
 'Two distinct LinkIds for one FileId each count their current version once');
assert.equal(run("findById('p:1').size"),12,
 'Project rollup must count newest project and contract originals, not old versions');

console.log('DRIVE TREE SMOKE PASS: project / contract / original nesting, rollups, identity, orphan guard');
