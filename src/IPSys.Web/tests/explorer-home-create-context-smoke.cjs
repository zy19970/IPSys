/* 回首页后残留的 folderId 不能再被当成"当前所在项目"。
   缺陷表现:项目内 → 点品牌回首页 → 点「新建」,误把创建绑在隐藏的项目,
   且真的建进了那个看不见的项目。这里跑真实的 navigate / goBack 与
   openNewMenu 构造段,断言首页状态下既清了目录、也不认旧项目前缀。 */
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

/* Drive.navigate / Drive.goBack 都是对象字面量方法,重新包成对象再调用。 */
const navSource=slice(app,'  navigate(view, folderId) {','  openFolder(id) {')
  .trim().replace(/,$/,'');
const backSource=slice(app,'  goBack() {','  /* ---------- selection')
  .trim().replace(/,$/,'');
/* openNewMenu 里从首页判定到最终 items 的整段,依赖全部从参数注入。 */
const menuBody=slice(inter,'  const onHome = ','  showCtx(');

const ctx=vm.createContext({$:()=>null,Number,String,resumePurge:()=>{}});
const api=vm.runInContext('({'+navSource+','+backSource+'})',ctx);
const buildMenu=vm.runInContext(
  '(function(s,nodeTag,archiveScopeSection,catsOf,catIsDir,VaultStore){'+menuBody+
  '\nreturn {items,onHome,here,inProject};})',ctx);

const CATS=[{id:'project',label:'公司项目'},{id:'ip',label:'知识产权'},{id:'certificate',label:'企业资质'}];
const nodeTag=id=>{
  const v=String(id||'');
  if(v.startsWith('k:')) return 'k';
  if(v.startsWith('af:')) return 'af';
  if(v.startsWith('p:')) return 'p';
  return '';
};
const vault={ws:'company'};
const menu=(state)=>buildMenu(
  {view:state.view,folderId:state.folderId,query:state.query||''},
  nodeTag,()=>'',()=>CATS,()=>false,vault);

function freshDrive(){
  return {
    state:{view:'files',folderId:'p:9',history:[],selection:new Set(),anchorId:null,query:''},
    resetSearch(){},enterContext(){},render(){},
  };
}

/* ---- 1. 从项目回首页:目录必须清掉,历史要能退回项目 ---- */
{
  const drive=freshDrive();
  api.navigate.call(drive,'home');
  assert.equal(drive.state.view,'home','view switches to home');
  assert.equal(drive.state.folderId,'root','leaving a folder for home clears folderId');
  assert.equal(drive.state.history.length,1,'history keeps the folder we came from');
  assert.equal(drive.state.history[0].view,'files','history records the view we came from');
  assert.equal(drive.state.history[0].folderId,'p:9','history records the folder we came from');

  api.goBack.call(drive);
  assert.equal(drive.state.view,'files','back returns to the folder view');
  assert.equal(drive.state.folderId,'p:9','back restores the project the user came from');
}

/* ---- 2. 其它视图的既有语义不能被顺手改掉 ---- */
{
  const drive=freshDrive();
  api.navigate.call(drive,'files');
  assert.equal(drive.state.folderId,'root','plain files navigation still resets to root');

  const drive2=freshDrive();
  drive2.state.folderId='af:3';
  api.navigate.call(drive2,'recycle');
  assert.equal(drive2.state.folderId,'af:3','recycle keeps its previous behaviour');
}

/* ---- 3. 首页菜单:即便 folderId 仍是 p:9,也不能当成"在项目里" ---- */
{
  const stale=menu({view:'home',folderId:'p:9'});
  assert.equal(stale.onHome,true,'home view is recognised');
  assert.equal(stale.inProject,'','home never counts as being inside a project');
  assert.ok(!stale.items.some(m=>m.id==='contract'),'home offers no contract-only entry');
  assert.ok(stale.items.some(m=>m.id==='project'),'home still offers the normal categories');
  assert.ok(stale.items.length>=3,'home offers every category, not a single entry');

  /* 项目内部实际走 archiveScope()→普通文件夹表单，
     因此这里不能再构造旧的“新建合同”专用选项。 */
  const inside=menu({view:'files',folderId:'p:9'});
  assert.equal(inside.onHome,false,'files view is not home');
  assert.equal(inside.inProject,'9','inside a project the prefix is still used');
  assert.ok(!inside.items.some(m=>m.id==='contract'),
    'project-specific contract creation entry is retired');
  assert.match(inter,/if \(archiveScope\(\)\) return createArchiveFolder\(\);/);

  /* 首页搜索态不算首页:查询词在时仍按分类筛选 */
  const searching=menu({view:'home',folderId:'p:9',query:'选矿'});
  assert.equal(searching.onHome,false,'a running query is not the home state');
}

console.log('home create context: PASS');
