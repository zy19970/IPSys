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
// UI is frozen: the first real business edit reuses the existing record dialog.
assert.ok(js.includes('data-action="editRecord"'),'Real record detail must offer edit title');
assert.ok(js.includes("case 'editRecord'"),'Title editor must only start from the real record view');
assert.ok(js.includes("method:'PUT'"),'Existing records must use the authorized update endpoint');
assert.ok(js.includes("if(target===null)setPage('general')"),'Editing a record should retain the detail view');
assert.ok(js.includes("editingId=null"),'Record editor mode must be reset after use');

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
for(const cls of ['.recordgrid','.archivecard','.archivecard-real','.archivecard-meta','.archivecard-actions','.archivecategory','.archive-tablewrap']){
 assert.ok(css.includes(cls),'Missing archive card style '+cls);
}
assert.ok(js.includes("['certificate','achievement','academic'].includes(page)?mockCardList(page)"),'Archive mock pages must select card mode');
assert.ok(js.includes("page==='general'?generalList()"),'Real general records must retain their route');
assert.ok(js.includes("isProject(page)?projectList(page)"),'Project pages must use real SQLCipher records');
assert.ok(js.includes("['ip','contract'].includes(page)?mockList(page)"),'Other mock ledger pages remain explicit');
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
 " personalAcademicJobs:mockCategoryTable('academic','学术兼职'),",
 " personalMeetings:mockCategoryTable('academic','会议报告'),",
 " personalPolicies:mockCategoryTable('academic','政策建议'),",
 " personalIdentityLedger:mockCategoryTable('certificate','身份证明'),",
 " personalIdentity:mockCardList('certificate'),",
 " personalAchievement:mockCardList('achievement'),",
 " personalAcademic:mockCardList('academic'),",
 " personalReal:generalList(),",
 " personalPatent:mockList('ip')",
 "};",
 "space='company';",
 "liveRows=[{id:21,title:'公司资料',files:[{id:10}]}];",
 "globalThis.__cards.companyCertificate=mockCardList('certificate');",
 "globalThis.__cards.companyCertificateLedger=mockCategoryTable('certificate','企业资质');",
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
// Only the project ledger loses status/leader. Their values remain on the detail page.
const projectColumnLabels=JSON.parse(vm.runInContext("JSON.stringify(columns('researchProject').map(x=>x[1]))",cardsCtx));
const horizontalColumnLabels=JSON.parse(vm.runInContext("JSON.stringify(columns('horizontalProject').map(x=>x[1]))",cardsCtx));
const patentColumnLabels=JSON.parse(vm.runInContext("JSON.stringify(columns('ip').map(x=>x[1]))",cardsCtx));
for(const labels of [projectColumnLabels,horizontalColumnLabels]){
 assert.deepEqual(labels,['项目名称','项目类别','项目编号','开始日期','附件']);
 assert.ok(!labels.includes('负责人')&&!labels.includes('项目状态'),'Project ledger must omit detail-only fields');
}
assert.ok(patentColumnLabels.includes('状态')&&patentColumnLabels.includes('当前权利人'),'Patent ledger columns must remain unchanged');
const detailSource=js.slice(js.indexOf('function mockDetail(){'),js.indexOf('function ',js.indexOf('function mockDetail(){')+11));
assert.ok(detailSource.includes("infoRow('负责人',r.leader)"),'Project leader must remain visible on its detail page');
assert.ok(detailSource.includes("infoRow('项目状态',r.status)"),'Project status must remain visible on its detail page');
for(const section of ['personalPatent','companyPatent']){
 assert.ok(snapshots[section].includes('<table'),'IP ledger must remain a table: '+section);
}
assert.ok(snapshots.personalReal.includes('data-live-id="41"'),'Real personal card must open stored record');
assert.ok(snapshots.companyReal.includes('data-live-id="21"'),'Real company card must open stored record');
assert.ok(snapshots.personalReal.includes('附件 <strong>2</strong> 份'),'Real attachment count must derive from actual database objects');
assert.ok(snapshots.personalReal.includes('个人&lt;资料&amp;测试&gt;'),'Untrusted card title must be escaped');
assert.ok(snapshots.personalIdentity.includes('data-archive-category="身份证明"'),'Category card must open the category ledger');
assert.ok(!snapshots.personalIdentity.includes('data-live-id'),'Demo card must never masquerade as real SQLCipher data');

for(const section of ['personalAcademicJobs','personalMeetings','personalPolicies','personalIdentityLedger','companyCertificateLedger']){
 assert.ok(snapshots[section].includes('<table'),'Category drill-down must show table: '+section);
 assert.ok(!snapshots[section].includes('class="recordgrid"'),'Category drill-down must not show tiles: '+section);
}
for(const id of ['2','5','6'])assert.ok(snapshots.personalAcademicJobs.includes('data-mock-id="'+id+'"'),'Academic jobs must support multiple distinct entries '+id);
assert.ok(!snapshots.personalAcademicJobs.includes('data-mock-id="3"'),'Academic jobs table must exclude meeting records');
for(const id of ['3','7'])assert.ok(snapshots.personalMeetings.includes('data-mock-id="'+id+'"'),'Meeting reports should be multiple table rows '+id);
for(const id of ['4','8'])assert.ok(snapshots.personalPolicies.includes('data-mock-id="'+id+'"'),'Policy proposals should be multiple table rows '+id);
assert.ok(snapshots.companyCertificateLedger.includes('data-mock-id="1"')&&snapshots.companyCertificateLedger.includes('data-mock-id="2"'),'Enterprise certificates must be distinct rows');
assert.ok(snapshots.personalAcademic.includes('data-archive-category="学术兼职"'),'Academic category card must open table, not single detail');
assert.ok(!snapshots.personalAcademic.includes('data-mock-id='),'Category cards must not link directly to record details');
assert.ok(js.includes('archiveGroup=null')&&js.includes('data-archive-back="cards"')&&js.includes('data-archive-back="table"'),'Three-level navigation must preserve back destinations');

// Opening an existing encrypted vault is the default; creating one is a secondary action.
assert.ok(html.includes('id="newMode" type="button" class="auth-mode-link"'),'One secondary create database control is required');
assert.ok(html.includes('id="oldMode" type="button" class="auth-mode-link" hidden'),'Back to login should be hidden initially');
assert.ok(html.includes('id="confirmWrap" hidden'),'Password confirmation must be hidden in the default login view');
assert.ok(html.includes('id="submitOpen" class="btn primary full" type="submit">解锁并进入'),'Main submit must unlock existing vault by default');
assert.ok(!html.includes('class="switch"'),'Login must not show creation as an equal primary tab');
assert.ok(js.includes('let space=null,creating=false'),'Authentication must initially use existing-vault mode');
assert.match(js,/\(async\(\)=>\{\s*mode\(false\);/,'Startup mode must be existing-vault login');
const authFields={};
for(const id of ['newMode','oldMode','confirmWrap','dbPathHint','submitOpen','dbPathWrap','resumeHint','dbPath','modeActions'])
 authFields[id]={hidden:false,disabled:false,required:true,textContent:''};
const authStart=js.indexOf('function mode(value){');
const authEnd=js.indexOf("el('newMode').onclick=",authStart);
assert.ok(authStart>=0&&authEnd>authStart,'Authentication mode functions must be found');
const authVm=vm.createContext({document:{getElementById:id=>authFields[id]}});
vm.runInContext('let creating=false,resuming=false;function el(id){return document.getElementById(id);}\n'+js.slice(authStart,authEnd)+`
 mode(false);
 globalThis.__login={create:creating,newHidden:el('newMode').hidden,returnHidden:el('oldMode').hidden,
   confirmHidden:el('confirmWrap').hidden,submit:el('submitOpen').textContent};
 mode(true);
 globalThis.__create={create:creating,newHidden:el('newMode').hidden,returnHidden:el('oldMode').hidden,
   confirmHidden:el('confirmWrap').hidden,submit:el('submitOpen').textContent};
 mode(false);
 recoveryMode(true);
 globalThis.__resume={create:creating,actionsHidden:el('modeActions').hidden,
   pathHidden:el('dbPathWrap').hidden,submit:el('submitOpen').textContent};
 recoveryMode(false);
 globalThis.__resumeFinished={actionsHidden:el('modeActions').hidden,pathRequired:el('dbPath').required};
`,authVm);
assert.equal(authVm.__login.create,false);
assert.equal(authVm.__login.newHidden,false);
assert.equal(authVm.__login.returnHidden,true);
assert.equal(authVm.__login.confirmHidden,true);
assert.equal(authVm.__login.submit,'解锁并进入');
assert.equal(authVm.__create.create,true);
assert.equal(authVm.__create.newHidden,true);
assert.equal(authVm.__create.returnHidden,false);
assert.equal(authVm.__create.confirmHidden,false);
assert.equal(authVm.__create.submit,'创建并进入');
assert.equal(authVm.__resume.create,false);
assert.equal(authVm.__resume.actionsHidden,true);
assert.equal(authVm.__resume.pathHidden,true);
assert.equal(authVm.__resume.submit,'验证密码并恢复会话');
assert.equal(authVm.__resumeFinished.actionsHidden,false);
assert.equal(authVm.__resumeFinished.pathRequired,true);
// A small ledger should not contain a fixed-height blank area below its records.
assert.ok(css.includes('max-height:calc(100vh - 355px);min-height:0'),'Ledger should size to content instead of 260px minimum');
assert.ok(css.includes('min-width:100%;font-size:15px;line-height:1.5'),'Ledger body text must be larger');
assert.ok(css.includes('text-align:left;font-size:13px;font-weight:650'),'Ledger headings must be readable');
assert.ok(css.includes('.auth-mode-actions{display:flex'),'Secondary new-vault button must be styled');

// Project tables are now real while other prototype business layouts are still mock.
assert.ok(html.includes('id="projectDialog"'),'Project editor must be a real modal');
for(const name of ['pName','pType','pNo','pStatus','pLeader','pOrg','pStart','pEnd','pCategory','pTags','pRemarks'])
 assert.ok(html.includes('id="'+name+'"'),'Missing project field '+name);
for(const route of ["'/api/projects/'+space","method:'DELETE'","method:'PUT'","method:'POST'","targetWorkspace:destination"])
 assert.ok(js.includes(route),'Missing project persistence or transfer '+route);
assert.ok(js.includes("projectRows=projects;render()"),'Projects must refresh from the real database');
const projectCtx=vm.createContext({sessionStorage:{getItem:()=>null}});
const projector=js.slice(js.indexOf('function projectViewRows('),js.indexOf('function archiveCard(',js.indexOf('function projectViewRows(')));
vm.runInContext(preamble+
 '\nfunction heading(t){return t;}\nfunction infoRow(n,v){return n+v;}\nfunction section(n,v){return n+v;}\n'+projector+
 "\nspace='company';projectRows=[{id:12,name:'真实项目',projectType:'科研项目',projectNo:'X-1',startDate:'2026-01-02',projectStatus:'进行中',leader:'负责人甲'}];globalThis.__project=projectList('researchProject');",projectCtx);
assert.ok(projectCtx.__project.includes('data-project-id="12"'),'Real project ledger must open persisted IDs');
assert.ok(!projectCtx.__project.includes('负责人甲'),'Project leader must not appear in the ledger');
assert.ok(!projectCtx.__project.includes('仅演示'),'Real project page must not be marked mock');
console.log('MAIN UI SMOKE PASS: navigation, workspace choice, live API contract, mock markers, CSP-compatible markup');