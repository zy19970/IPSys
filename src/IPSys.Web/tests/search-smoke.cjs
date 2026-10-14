const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const js=fs.readFileSync(path.resolve(__dirname,'../wwwroot/app.js'),'utf8');
const first=js.indexOf('const searchGroupLabels='),last=js.indexOf('function settingsPage(){',first);
assert.ok(first>=0&&last>first,'Real unified search source must exist');
const source=js.slice(first,last);
assert.ok(!source.includes('sample(')&&!source.includes('stamp()'),
 'Search must never display sample/mock records');
assert.ok(js.includes("api('/api/search/'+workspace+'?q='+encodeURIComponent(q))"),
 'Search must use the authenticated workspace-scoped endpoint');
assert.ok(js.includes("openSearchHit(Number(target.dataset.searchIndex))"),
 'Search results must open real records, not demo entries');
assert.ok(js.includes("void runGlobalSearch(el('globalSearch').value)"),
 'Existing top search input must invoke the search service');

const elements={
 globalSearch:{value:''},content:{scrollTo(){}}
};
const notifications=[],fetches=[];
const ctx=vm.createContext({
 escapeHtml:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 heading:(n,s)=>n+':'+s,el:id=>elements[id],
 api:async url=>{fetches.push(url);return{json:async()=>({results:[
  {kind:'project',id:1,title:'测试<项目>',description:'科研项目'},
  {kind:'file',id:16,ownerKind:'project',ownerId:1,title:'测试<附件>.pdf',description:'测试项目'}
 ],truncated:false})};},
 notice:text=>notifications.push(text),
 render(){ctx.__renders=(ctx.__renders||0)+1;},
 space:'company',token:'session',page:'dashboard',detail:null,archiveGroup:null,
 filterName:'',filterKind:'全部类型',filterState:'全部状态',
 selected:new Set(),globalSerial:0,globalHits:[],globalPending:false,
 globalError:'',globalTruncated:false,globalQuery:'',
 liveRows:[],projectRows:[{id:1,name:'项目',projectType:'科研项目'}],
 ipRows:[],contractRows:[],archiveRows:{academic:[],certificate:[],achievement:[]}
});
vm.runInContext(source,ctx);
(async()=>{
 await vm.runInContext("runGlobalSearch('测试')",ctx);
 assert.equal(fetches[0],'/api/search/company?q=%E6%B5%8B%E8%AF%95');
 assert.equal(ctx.globalHits.length,2);
 const html=vm.runInContext('searchPage()',ctx);
 assert.ok(html.includes('项目')&&html.includes('附件文件名'));
 assert.ok(html.includes('测试&lt;项目&gt;')&&!html.includes('测试<项目>'),
  'Untrusted record titles must be escaped');
 assert.ok(html.includes('data-search-index="1"'),'Attachments must have own search link');
 assert.ok(!html.includes('进入详情 →'),
  'Search rows must not repeat a non-clickable detail-entry label after the linked title');
 assert.equal((html.match(/data-search-index="/g)||[]).length,2,
  'Each result keeps one clickable title that opens the original business detail');
 assert.ok(html.includes('search-hit-description')&&html.includes('科研项目'),
  'Result description remains visible without a redundant action column');

 vm.runInContext('openSearchHit(1)',ctx);
 assert.equal(ctx.page,'researchProject','Attachment must resolve owning real project');
 assert.equal(ctx.detail.kind,'project');assert.equal(ctx.detail.id,1);
 ctx.globalHits=[{kind:'archive',id:8,section:'academic',title:'专家',description:'学术'}];
 ctx.space='personal';ctx.page='search';
 ctx.archiveRows.academic=[{id:8,name:'专家',category:'学术兼职'}];
 vm.runInContext('openSearchHit(0)',ctx);
 assert.equal(ctx.page,'academic');
 assert.equal(ctx.archiveGroup,'学术兼职','Academic result opens correct category');
 assert.equal(ctx.detail.id,8);
 ctx.globalHits=[{kind:'file',id:18,ownerKind:'contract',ownerId:200,title:'合同原件',section:''}];
 ctx.page='search';vm.runInContext('openSearchHit(0)',ctx);
 assert.equal(notifications.length,1,'Stale/deleted record must be rejected');
 await vm.runInContext("runGlobalSearch('')",ctx);
 assert.equal(ctx.globalHits.length,0,'Blank query must not return all records');
 console.log('SEARCH UI SMOKE PASS: real query, grouped escaped result, attachment parent, academic route, stale result');
})().catch(error=>{console.error(error);process.exitCode=1;});
