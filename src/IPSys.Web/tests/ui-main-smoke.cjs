'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'../wwwroot');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const js=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const css=fs.readFileSync(path.join(dir,'style.css'),'utf8');
const requiredIds=['locked','chooseWorkspace','unlocked','openForm','newMode','oldMode','dbPathWrap','dbPath','resumeHint','password','confirmWrap','confirm','submitOpen','sidebar','bottomnav','workspaceBtn','workspacelabel','sidebarDbName','globalSearch','content','dbNameChoice','closeDbFromChoice','modal','newRecordForm','title','saveRecord','cancelRecord','exit','exitDialog','exitCancelTask','exitFinishTask','exitStay','toast'];
for(const id of requiredIds)assert.match(html,new RegExp(`id="${id}"`),`Missing real page element ${id}`);
for(const phrase of ['选择一个工作区','公司资料','个人资料','app.js','style.css'])assert.ok(html.includes(phrase),'Missing '+phrase);
for(const phrase of ['科研项目','横向项目','知识产权','项目基本信息','所属合同','全部附件汇总','申请与登记信息','/api/records/','/api/resume','/api/exit','/api/files/','/api/task','/api/check','localFileTaskActive','sessionStorage','mockflag','realflag'])assert.ok(js.includes(phrase),'Missing UI/API design anchor '+phrase);
for(const style of ['.shell','.sidebar','.tablewrap','.data','.detailsection','.auth-screen','.workspace-screen'])assert.ok(css.includes(style),'Missing UI style '+style);
assert.ok(!html.includes('onclick='),'No inline script handlers may be added to real HTTP page');
assert.ok(!/\bfetch\s*\(\s*['"]https?:/.test(js),'No external service access');
assert.ok(js.includes('escapeHtml('),'Untrusted record and attachment names must be escaped');
assert.ok(js.includes('space=null')&&js.includes('selectSpace(next)'),'Explicit workspace choice is required');
// Personal navigation is deliberately distinct from the company menu: archive groups
// follow the user-supplied evidence folders without changing SQLCipher record types.
const vm=require('node:vm');
const preamble=js.slice(0,js.indexOf('window.addEventListener('));
assert.ok(preamble.length>0,'Cannot isolate personal archive configuration');
const context=vm.createContext({sessionStorage:{getItem:()=>null}});
vm.runInContext(preamble+`
globalThis.__layout={
 companyNav:companyNav.map(x=>x[1]),
 personalNav:personalNav.map(x=>x[1]),
 personalModules:personalNav.map(x=>x[0]),
 companyModules:companyNav.map(x=>x[0]),
 identity:mock.personal.certificate.map(x=>x.type),
 intellectual:mock.personal.ip.map(x=>x.type),
 achievement:mock.personal.achievement.map(x=>x.type),
 academic:mock.personal.academic.map(x=>x.type),
 noteKeys:Object.keys(personalCategoryNotes),
 projectTypes:((space='personal'),sample('researchProject')).map(x=>x.type),
 foreignProjects:((space='company'),sample('researchProject')).map(x=>x.name)
};`,context);
const v=context.__layout;
assert.deepEqual(Array.from(v.personalNav),['个人工作台','身份与资质','知识产权与著作','科研与合作项目','成果与奖励','学术与社会活动','其他资料']);
assert.deepEqual(Array.from(v.companyNav),['工作台','知识产权','科研项目','横向项目','全部合同','企业资质','综合资料']);
assert.ok(!v.personalModules.includes('contract')&&!v.personalModules.includes('horizontalProject'),'Personal groups should have no redundant separate contract/horizontal menu');
for(const k of ['certificate','ip','researchProject','achievement','academic','general'])assert.ok(v.personalModules.includes(k),'Personal group missing '+k);
for(const t of ['身份证明','学历学位','职称资格','任职证明'])assert.ok(v.identity.includes(t),'Identity credential category missing '+t);
for(const t of ['发明专利','软件著作权','其他著作权'])assert.ok(v.intellectual.includes(t),'Intellectual category missing '+t);
for(const t of ['技术成果','成果评价','项目奖励','个人奖励','人才奖励','标准制定','新产品'])assert.ok(v.achievement.includes(t),'Achievement category missing '+t);
for(const t of ['论文论著','学术兼职','会议报告','政策建议'])assert.ok(v.academic.includes(t),'Academic category missing '+t);
assert.deepEqual(Array.from(v.projectTypes).sort(),['横向项目','科研项目']);
assert.equal(v.foreignProjects.length,2,'Company project lookup must remain unchanged');
for(const k of ['certificate','ip','researchProject','achievement','academic'])assert.ok(v.noteKeys.includes(k),'Personal category note missing '+k);

/* Document archives are cards, business ledgers are tables. Browserless render checks. */
for(const cls of ['.recordgrid','.archivecard','.archivecard-real','.archivecard-meta','.archivecard-actions']){
 assert.ok(css.includes(cls),'Missing archive card style '+cls);
}
assert.ok(js.includes("['certificate','achievement','academic'].includes(page)?mockCardList(page)"),'Archive mock pages must select card mode');
assert.ok(js.includes("page==='general'?generalList()"),'Real general records must retain their route');
assert.ok(js.includes("['ip','researchProject','horizontalProject','contract'].includes(page)?mockList(page)"),'Ledger pages must retain tables');
const rendererSource=[
 ['function generalList(){','function realDetail()'],
 ['function columns(k){','function archiveCard('],
 ['function archiveCard(','function mockList(k){'],
 ['function mockList(k){','function mockCardList(k){'],
 ['function mockCardList(k){','function infoRow(']
].map(([start,end])=>{
 const a=js.indexOf(start),b=js.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing renderer: '+start);
 return js.slice(a,b);
}).join('\n');
const cardsCtx=vm.createContext({sessionStorage:{getItem:()=>null}});
const renderSetup=[
 "function heading(name){return '<h1>'+escapeHtml(name)+'</h1>';}",
 "function stamp(){return '<span class=mockflag>界面示例</span>';}",
 "space='personal';",
 "liveRows=[{id:41,title:'个人<资料&测试>',files:[{id:3},{id:4}]}];",
 "globalThis.__cards={",
 " personalIdentity:mockCardList('certificate'),",
 " personalAchievement:mockCardList('achievement'),",
 " personalAcademic:mockCardList('academic'),",
 " personalReal:generalList(),",
 " personalPatent:mockList('ip')",
 "};",
 "space='company';",
 "liveRows=[{id:21,title:'公司资料',files:[{id:10}]}];",
 "globalThis.__cards.companyCertificate=mockCardList('certificate');",
 "globalThis.__cards.companyReal=generalList();",
 "globalThis.__cards.companyPatent=mockList('ip');"
].join('\n');
const header=renderSetup.slice(0,renderSetup.indexOf("space='personal';"));
const body=renderSetup.slice(renderSetup.indexOf("space='personal';"));
vm.runInContext(preamble+'\n'+header+'\n'+rendererSource+'\n'+body,cardsCtx);
const snapshots=cardsCtx.__cards;
for(const section of ['personalIdentity','personalAchievement','personalAcademic','personalReal','companyCertificate','companyReal']){
 assert.match(snapshots[section],/class="recordgrid"/,'Archive section must use a card grid: '+section);
 assert.match(snapshots[section],/class="archivecard/,'Missing card: '+section);
 assert.ok(!snapshots[section].includes('<table'),'Tables are not allowed in archive sections: '+section);
}
for(const section of ['personalPatent','companyPatent']){
 assert.ok(snapshots[section].includes('<table'),'IP ledger must remain a table: '+section);
}
assert.ok(snapshots.personalReal.includes('data-live-id="41"'),'Real personal card must open stored record');
assert.ok(snapshots.companyReal.includes('data-live-id="21"'),'Real company card must open stored record');
assert.ok(snapshots.personalReal.includes('附件 <strong>2</strong> 份'),'Real attachment count must derive from actual database objects');
assert.ok(snapshots.personalReal.includes('个人&lt;资料&amp;测试&gt;'),'Untrusted card title must be escaped');
assert.ok(snapshots.personalIdentity.includes('data-mock-id="1"'),'Demo card must open a design-only record');
assert.ok(!snapshots.personalIdentity.includes('data-live-id'),'Demo card must never masquerade as real SQLCipher data');
console.log('MAIN UI SMOKE PASS: navigation, workspace choice, live API contract, mock markers, CSP-compatible markup');