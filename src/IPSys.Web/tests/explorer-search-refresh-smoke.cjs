/* A04: refreshing must keep the search the user is actually running.
   Runs the real Drive.runSearch / refreshCurrent sources in a mocked context,
   so the assertions cover the serial guard and the error path, not a regex. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const root=path.resolve(__dirname,'../wwwroot/js');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const inter=fs.readFileSync(path.join(root,'interactions.js'),'utf8');

function slice(source,start,end){
  const a=source.indexOf(start);
  assert.ok(a>=0,'missing '+start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(b>a,'missing '+end);
  return source.slice(a,b);
}
/* Drive.runSearch is an object-literal method; re-wrap it as one. */
const runSource=slice(app,'  async runSearch(raw) {','  /* 搜索结果的状态条')
  .trim().replace(/,$/,'');
const refreshSource=slice(inter,'async function refreshCurrent() {',
  '/* ---------------- 文件下载 / 预览');

(async()=>{
  /* ---- 1. 正常检索：串行号、查询词与 pending 状态 ---- */
  let renders=0;
  const vault={
    ws:'company',
    search:async(ws,q)=>({results:[{kind:'project',id:1,query:q}],truncated:false}),
    resolveHits:data=>data.results,
    loadAll:async()=>{},
    token:'session',
  };
  const drive={
    state:{searchSerial:0,searchHits:null,searchQuery:'',searchPending:false,
      searchTruncated:false,searchMissed:0,searchError:'',query:'',folderId:'root',
      view:'files',selection:new Set()},
    render(){renders++;},
  };
  const ctx=vm.createContext({VaultStore:vault,Promise,Error,Math,Number,String});
  const api=vm.runInContext('({'+runSource+'})',ctx);

  await api.runSearch.call(drive,'  跨目录词  ');
  assert.equal(drive.state.searchQuery,'跨目录词','query is trimmed and kept');
  assert.equal(drive.state.searchPending,false);
  assert.deepEqual(drive.state.searchHits,[{kind:'project',id:1,query:'跨目录词'}]);
  assert.equal(drive.state.searchError,'');
  assert.ok(renders>=2,'pending and final states both render');

  /* ---- 2. 服务端失败：显式记录错误，不伪装成全量结果 ---- */
  vault.search=async()=>{throw new Error('HTTP 503');};
  await api.runSearch.call(drive,'失败词');
  assert.equal(drive.state.searchError,'HTTP 503');
  assert.equal(drive.state.searchQuery,'失败词','failed search still owns the query');
  assert.equal(drive.state.searchHits,null);

  /* ---- 3. 过期响应：慢的第一次请求不得覆盖后来的结果 ---- */
  const pending=[];
  vault.search=(ws,q)=>new Promise(resolve=>pending.push({q,resolve}));
  drive.state.searchHits=null;
  const first=api.runSearch.call(drive,'第一次');
  const second=api.runSearch.call(drive,'第二次');
  assert.equal(pending.length,2);
  pending[1].resolve({results:['second'],truncated:false});
  await second;
  pending[0].resolve({results:['first'],truncated:false});
  await first;
  assert.deepEqual(drive.state.searchHits,['second'],
    'stale response must not replace the newer search');
  assert.equal(drive.state.searchQuery,'第二次');

  /* ---- 4. refreshCurrent：树重建后仍按原查询重走服务端检索 ---- */
  const order=[];
  let reloadWorkspace='';
  const refreshVault={
    ws:'company',
    loadAll:async ws=>{reloadWorkspace=ws;},
    refreshStorage:()=>{},
  };
  const refreshDrive={
    state:{query:'  跨目录词  ',folderId:'af:5',view:'files',selection:new Set()},
    resetSearch(){order.push('reset');this.state.searchHits=null;},
    render(){order.push('render');},
    runSearch(q){order.push('search:'+q);},
  };
  const refreshCtx=vm.createContext({
    VaultStore:refreshVault,Drive:refreshDrive,RECYCLE:[],
    findById:id=>id==='af:5'?{id,type:'folder'}:null,
    Promise,Set,Error,
  });
  vm.runInContext(refreshSource,refreshCtx);
  await refreshCtx.refreshCurrent();
  assert.equal(reloadWorkspace,'company','reload uses the current workspace');
  assert.deepEqual(order,['reset','render','search:跨目录词'],
    'refresh resets stale hits, renders, then re-runs the server search');
  assert.equal(refreshDrive.state.folderId,'af:5','current folder survives refresh');
  assert.equal(refreshDrive.state.view,'files');

  console.log('SEARCH REFRESH SMOKE PASS: query preserved, stale responses ignored, failures surfaced');
})().catch(e=>{console.error(e);process.exitCode=1;});
