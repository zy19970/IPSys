/* Explorer capability wiring: streaming download, server-side search, purge task.
   --------------------------------------------------------------------------
   These are the three abilities the shell swap left behind. Each one has a
   backend contract that still exists (versions/download, /api/v2/search/{ws},
   /api/trash/{ws}/purge-task) and a shell-side behaviour that is easy to lose
   without noticing:

   1. Streaming download. Big originals must go straight to disk through File
      System Access API. res.blob() buffers the whole file in memory, so a
      few-hundred-MB attachment either freezes the tab or fails outright. The
      save picker also has to open before the first network await, otherwise the
      user-activation flag is gone and the browser refuses to show it.
   2. Server-side search. The local pass only sees fields already loaded in the
      tree; descriptions, signing parties and original file names live in the
      database. Search hits carry only kind/id, so they have to be mapped back
      onto real tree nodes — otherwise the results cannot be opened or exported.
   3. Purge progress. Permanent deletion is an asynchronous server task measured
      in freed bytes. Reporting success on a synchronous POST means the user is
      told "deleted" while the transaction may still roll back.
   -------------------------------------------------------------------------- */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const SHELL=path.resolve(__dirname,'../../../frontend/explorer');
const read=rel=>fs.readFileSync(path.join(SHELL,rel),'utf8');

const app=read('js/app.js');
const store=read('js/store.js');
const bridge=read('js/bridge.js');
const interactions=read('js/interactions.js');

function between(text,from,to){
 const a=text.indexOf(from);
 assert.ok(a>=0,'missing anchor: '+from);
 const b=to?text.indexOf(to,a):text.length;
 assert.ok(b>a,'missing end anchor: '+to);
 return text.slice(a,b);
}

/* ============================================================
   A. Search hits must resolve to real tree nodes
   ============================================================ */
const ctx=vm.createContext({
 console,Date,Math,JSON,Set,Map,String,Number,Object,Array,Promise,Error,RegExp,
 sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
 window:{},
 fetch:()=>{throw Error('resolveHits must never touch the network');},
});
for(const file of ['js/data.js','js/store.js'])
 vm.runInContext(fs.readFileSync(path.join(SHELL,file),'utf8'),ctx,{filename:file});
const run=code=>vm.runInContext(code,ctx);

ctx.__fixtures={
 projects:[{id:1,name:'研发项目'}],
 contracts:[{id:11,name:'合同A',projectId:1,projectName:'研发项目'}],
 archive:{
  archives:[
   {id:31,name:'资质证书甲',section:'certificate',year:'2025'},
   {id:32,name:'成果乙',section:'achievement',year:'2024'},
  ],
  folders:[{id:70,name:'申报与认定',parentId:null,position:1,isSystem:true}],
  files:[{linkId:5,fileId:501,version:1,ownerId:31,kind:'archive',section:'certificate',name:'证书扫描件.pdf',size:70}],
  general:[{id:41,title:'杂项资料',files:[{linkId:6,fileId:601,version:1,name:'说明.txt',size:9}]}],
 },
 ip:{
  rows:[{id:21,data:{name:'一种装置',ipType:'发明专利',applicationNo:'CN001'}}],
  files:[{linkId:7,fileId:701,version:1,folderId:21,name:'专利证书.pdf',size:30}],
 },
 projectFiles:[
  {linkId:1,fileId:101,version:1,folderId:1,kind:'project',name:'立项报告.pdf',size:100},
  {linkId:2,fileId:201,version:1,folderId:11,kind:'contract',name:'合同正文.pdf',size:200},
 ],
};

run('ROOT=VaultStore.buildTree(Object.assign({ws:"company"},__fixtures));');

const hits=[
 {kind:'project',id:1},
 {kind:'contract',id:11},
 {kind:'ip',id:21},
 {kind:'archive',id:31,section:'certificate'},
 {kind:'general',id:41},
 {kind:'file',id:101,ownerKind:'project',ownerId:1},
 {kind:'file',id:201,ownerKind:'contract',ownerId:11},
 {kind:'file',id:501,ownerKind:'archive',ownerId:31,section:'certificate'},
 {kind:'file',id:701,ownerKind:'ip',ownerId:21},
 {kind:'file',id:601,ownerKind:'general',ownerId:41},
 /* Resolution must be strict: a stale hit and a file filed under the wrong
    owner are both dropped rather than pointed at some unrelated node. */
 {kind:'project',id:999},
 {kind:'file',id:888,ownerKind:'project',ownerId:1},
 {kind:'unknown',id:1},
];
const resolved=run('VaultStore.resolveHits({results:__hits})'.replace('__hits',JSON.stringify(hits)));
const ids=Array.from(resolved,x=>x.id);
assert.deepEqual(ids,[
 'p:1','c:11','i:21','a:certificate:31','g:41',
 'f:1:1','f:2:1','f:5:1','f:7:1','f:6:1',
],'Every search kind must map onto its real tree node; stale hits must be dropped, not guessed');

/* Duplicates collapse: the backend can legitimately return the same record
   under two groups, and listing it twice would break selection and export. */
const duped=run('VaultStore.resolveHits({results:[{kind:"project",id:1},{kind:"project",id:1}]})');
assert.equal(duped.length,1,'Duplicate hits must collapse to one node');

/* ============================================================
   B. Streaming download
   ============================================================ */
const download=between(interactions,'async function downloadFile','/* ---------------- 预览');

assert.match(download,/showSaveFilePicker/,'Big originals must use the save picker, not an in-memory blob');
/* The picker is the first thing that happens: a network call before it consumes
   the click's user activation and the browser refuses to open the dialog. */
const pickerAt=download.indexOf('showSaveFilePicker({');
assert.ok(pickerAt>0,'downloadFile must actually open the picker');
assert.ok(
 !/VaultStore\.api\(|fetch\(/.test(download.slice(0,pickerAt)),
 'No network call may run before the picker — it burns the user-activation flag '
 +'and the browser then refuses to open the save dialog');

assert.match(download,/blob\.size !== expected/,'The blob fallback must still verify the byte count');
assert.match(download,/if \(e\?\.name === "AbortError"\) return/,'Cancelling the picker must not fall through to a download');

const stream=between(interactions,'async function streamToDisk','async function downloadFile');
assert.match(stream,/reader\.read\(\)/,'Streaming download must read the response body incrementally');
assert.match(stream,/await writer\.write\(value\)/,'Chunks must be written to disk as they arrive');
assert.match(stream,/written > expected/,'An oversized response must abort rather than fill the disk');
assert.match(stream,/written !== expected/,'A short response must be treated as a failed download');
assert.match(stream,/writer\.abort\(\)/,'A failed download must not leave a half-written file behind');

/* ============================================================
   C. Server-side search
   ============================================================ */
assert.match(
 store,/\/api\/v2\/search\/\$\{encodeURIComponent\(ws\)\}\?q=\$\{encodeURIComponent\(text\)\}/,
 'VaultStore.search must call the real server endpoint with an encoded keyword');

const sourceItems=between(app,'get sourceItems()','/* ---------- 台账列集');
assert.match(sourceItems,/s\.searchQuery === s\.query\.trim\(\) && Array\.isArray\(s\.searchHits\)/,
 'The list must prefer server results and only fall back locally before they arrive');
assert.match(sourceItems,/localSearch\(/,'A local pass is still needed so the list does not blank out while typing');

const runSearch=between(app,'async runSearch(raw)','/* 搜索结果的状态条');
assert.match(runSearch,/const serial = \+\+this\.state\.searchSerial/,'Each search must take a serial');
assert.ok(
 runSearch.split('serial !== s.searchSerial').length-1>=2,
 'Both the success and the failure path must drop results whose keyword is already stale');
assert.match(runSearch,/s\.searchQuery = q/,'Only the keyword that produced the hits may unlock them');

/* Every reload invalidates the previous hit list: those objects are not in the
   rebuilt tree any more, and keeping them would render rows that cannot open. */
for(const [label,body,pattern] of [
 ['Drive.openFolder',between(app,'openFolder(id) {','  goBack()'),/this\.resetSearch\(\)/],
 ['Drive.navigate',between(app,'navigate(view, folderId) {','  openFolder(id) {'),/this\.resetSearch\(\)/],
 ['enterWorkspace',between(interactions,'async function enterWorkspace','async function switchWorkspace'),/Drive\.resetSearch\(\)/],
 ['refreshCurrent',between(interactions,'async function refreshCurrent','/* ---------------- 文件下载'),/Drive\.resetSearch\(\)/],
])
 assert.match(body,pattern,label+' must clear search state when the tree is rebuilt or left');

/* ============================================================
   D. Purge task and its progress panel
   ============================================================ */
/* The newer Explorer uses serial bounded tasks; P2 VM tests execute real
   purgeTrash with 403 records and verify the exact endpoint for each batch. */
const purgeRunner=between(bridge,'async function purgeTrash(nodes) {',
 '/* 刷新页面或重进回收站时');
assert.match(purgeRunner,/VaultStore\.api\(/,
 'Permanent deletion must send an authenticated task request');
assert.match(purgeRunner,/\/purge-task/,
 'Permanent deletion must start the asynchronous task endpoint');
assert.match(
 bridge,/fetch\("\/api\/trash\/purge-task"/,
 'Progress must poll the Vault-wide endpoint: the task outlives a workspace switch');
assert.match(bridge,/res\.status === 404\) return null/,'No running task is a normal answer, not an error');
assert.match(bridge,/state\.taskId !== taskId/,'Progress must verify it is reading its own task');
assert.match(bridge,/state\.workspace !== workspace/,'Progress must verify the task belongs to the right workspace');

assert.match(
 bridge,/if \(state\.state === "succeeded"\)/,
 'Success must be announced only after the transaction is committed');
const track=between(bridge,'async function trackPurge','/* 真正发起彻底删除');
assert.ok(
 track.indexOf('state.state === "succeeded"')<track.indexOf('已彻底删除'),
 'The deletion toast must sit inside the committed branch');
assert.match(track,/toast\(state\.error \|\| "删除未完成,数据库已回滚"/,'A failed or rolled-back task must say so');

assert.match(purgeRunner,/i \+= 200/,
 'Selections over the server limit must be split into batches');
assert.match(purgeRunner,/items\.slice\(i, i \+ 200\)/,
 'Each purge task may include at most 200 records');
assert.match(purgeRunner,/await waitPurgeIdle\(\)/,
 'The next batch must wait until the previous file task releases its lock');
assert.match(purgeRunner,/state\.state !== "succeeded"/,
 'Failure or uncertain result must stop all subsequent batches');
assert.match(
 bridge,/fileTaskActive \|\| purgeTaskActive/,
 'A running purge occupies the server file-task slot, so workspace switching must be blocked too');
assert.match(purgeRunner,/finally\s*\{\s*purgeBatchActive = false;\s*purgeTaskActive = false;/,
 'A completed or failed batch must clear the busy flags in finally');
assert.match(bridge,/async function resumePurge/,'A page reload must pick the running task back up');
assert.match(app,/if \(view === "recycle"\) void resumePurge\(\)/,'Entering the recycle bin must resume an unfinished purge');

/* The recycle bin must route permanent deletion through the task, and the old
   synchronous call must be gone — leaving both would let one path silently
   regress to "toast says deleted". */
assert.match(
 interactions,/if \(op === "purge"\) return purgeTrash\(nodes\)/,
 'recycleAction must hand permanent deletion to the task runner');
assert.ok(
 !/\/api\/trash\/\$\{VaultStore\.ws\}\/\$\{op\}/.test(interactions),
 'The synchronous /api/trash/{ws}/{operation} route must no longer handle purge');

console.log('EXPLORER CAPABILITIES PASS: streaming download, server search and purge progress');
