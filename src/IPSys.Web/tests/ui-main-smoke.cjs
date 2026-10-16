'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'../wwwroot');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const js=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const css=fs.readFileSync(path.join(dir,'style.css'),'utf8');
const v2IpJs=fs.readFileSync(path.join(dir,'ip-v2.js'),'utf8');
const exportJs=fs.readFileSync(path.join(dir,'export.js'),'utf8');
const programCs=fs.readFileSync(path.resolve(__dirname,'../Program.cs'),'utf8');
const searchEndpointsCs=fs.readFileSync(path.resolve(__dirname,'../SearchLedgerEndpoints.cs'),'utf8');
assert.ok(!js.includes("'/api/business-files/'")&&!exportJs.includes('/api/business-files/')&&
 !exportJs.includes("'/api/files/'"),
 'Production V2 business pages and all original exports must never use legacy attachment URLs');
assert.ok(js.includes("source:'v2file'")&&js.includes("source:'v2ip'")&&
 !js.includes(":'business'")&&
 exportJs.includes("if(selected.some(file=>!validOriginal(file)))"),
 'All module/selected ZIP exports require a real V2 FileId and FileVersion');
assert.ok(programCs.includes('if(smoke)')&&
 programCs.includes('BusinessFileEndpoints.Map(app);')&&
 programCs.includes('ExcelEndpoints.Map(app, Fail);')&&
 programCs.includes('SearchLedgerEndpoints.Map(app, Fail, smoke);')&&
 searchEndpointsCs.includes('if(includeLegacy)'),
 'Legacy HTTP business mutations and identity search must be registered in smoke only');

new (require('node:vm').Script)(v2IpJs);
assert.ok(html.includes('src="/ip-v2.js" defer'),'Frozen IP page must load embedded V2 adapter before app.js');
for(const apiName of ['IPSysNativeIp','/api/v2/ui/ip/','/api/v2/files/','/api/v2/ip/'])
 assert.ok(v2IpJs.includes(apiName),'Native IP browser bridge missing '+apiName);
const requiredIds=['locked','chooseWorkspace','unlocked','openForm','newMode','oldMode','dbPathWrap','dbPath','resumeHint','password','confirmWrap','confirm','submitOpen','sidebar','bottomnav','projectExcelImport','projectExcelTemplate','projectExcelChoose','projectExcelFile','sidebarDbName','globalSearch','content','dbNameChoice','closeDbFromChoice','modal','newRecordForm','title','saveRecord','cancelRecord','closeDbButton','toast'];
for(const id of requiredIds)assert.match(html,new RegExp(`id="${id}"`),`Missing real page element ${id}`);
for(const phrase of ['选择一个工作区','个人资料','公司资料','app.js','style.css'])assert.ok(html.includes(phrase),'Missing '+phrase);
// Personal files are the primary workflow; both entry points must show personal first.
const choiceArea=html.slice(html.indexOf('<div class="choice-grid">'),html.indexOf('<div class="choice-bottom">'));
const sideSwitches=html.slice(html.indexOf('<div class="workspace-switches"'),html.indexOf('<div class="navlabel">业务导航'));
for(const [area,name] of [[choiceArea,'login workspace choice'],[sideSwitches,'sidebar workspace switch']]){
 const personal=area.indexOf('data-workspace-'+(name.startsWith('login')?'choice':'switch')+'="personal"');
 const company=area.indexOf('data-workspace-'+(name.startsWith('login')?'choice':'switch')+'="company"');
 assert.ok(personal>=0&&company>personal,name+' must list personal before company');
}
assert.ok(html.includes('以个人资料管理为主，公司资料用于集中归纳'),'Workspace copy must reflect personal-data focus');
assert.ok(html.includes('两个工作区独立保存记录与原始附件'),'Reordering must not weaken workspace isolation');
for(const phrase of ['科研项目','横向项目','知识产权','项目基本信息','所属合同','全部附件汇总','申请与登记信息','/api/v2/ui/archive/','/api/resume','/api/lock','/api/v2/files/','/api/check','localFileTaskActive','sessionStorage','mockflag','data-workspace-switch'])assert.ok(js.includes(phrase),'Missing UI/API design anchor '+phrase);
for(const style of ['.shell','.sidebar','.tablewrap','.data','.detailsection','.auth-screen','.workspace-screen'])assert.ok(css.includes(style),'Missing UI style '+style);
assert.ok(!html.includes('onclick='),'No inline script handlers may be added to real HTTP page');
assert.ok(html.includes('<title>资料管理系统</title>')&&
 (html.match(/<strong>资料管理系统<\/strong>/g)||[]).length===3,
 'App-facing title and brand must use the new 资料管理系统 name');
assert.ok(!html.includes('知识产权与资料管理系统'),
 'The old product name must not appear anywhere in the web UI');
assert.ok(html.includes('id="closeDbButton"')&&html.includes('>关闭数据库</button>'),
 'Web header must close the database, not exit the WinForms application');
assert.ok(!html.includes('id="exitDialog"')&&!js.includes("api('/api/exit'")&&
 !js.includes("sendExit(")&&js.includes("el('closeDbButton').onclick=closeDb"),
 'The browser must not expose program-level exit options or API calls');

assert.ok(!/\bfetch\s*\(\s*['"]https?:/.test(js),'No external service access');
assert.ok(js.includes('escapeHtml('),'Untrusted record and attachment names must be escaped');
// UI is frozen: the first real business edit reuses the existing record dialog.
assert.ok(js.includes('data-action="editRecord"'),'Real record detail must offer edit title');
assert.ok(js.includes("case 'editRecord'"),'Title editor must only start from the real record view');
assert.ok(js.includes("case 'generalCopy':")&&
 js.includes("case 'generalMove':")&&
 js.includes("'/api/v2/ui/general/'+space+'/'+record.id+'/transfer'")&&
 js.includes('data-action="generalCopy"')&&
 js.includes('data-action="generalMove"'),
 'General record copy and transfer must preserve FolderId/FileVersion history');
assert.ok(js.includes("method:'PUT'"),'Existing records must use the authorized update endpoint');
assert.ok(js.includes("if(target===null)setPage('general')"),'Editing a record should retain the detail view');
assert.ok(js.includes("editingId=null"),'Record editor mode must be reset after use');

assert.ok(js.includes('space=null')&&js.includes('selectSpace(next)'),'Explicit workspace choice is required');
// Personal navigation is deliberately distinct from the company menu: archive groups
// follow the user-supplied evidence folders without changing SQLCipher record types.
const vm=require('node:vm');
const preamble=js.slice(0,js.indexOf('window.addEventListener('));
const exportDocument={createElement:()=>({}),head:{appendChild:()=>{}},getElementById:()=>({addEventListener:()=>{}})};
assert.ok(preamble.length>0,'Cannot isolate personal archive configuration');
const context=vm.createContext({sessionStorage:{getItem:()=>null},document:exportDocument});
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
assert.deepEqual(Array.from(v.companyNav),['工作台','企业资质','业务档案','公司项目','知识产权','综合资料']);
assert.ok(!v.companyModules.includes('horizontalProject')&&!v.companyModules.includes('contract'),
 'Company sidebar should have one project entry and contracts reached from it');
assert.ok(v.companyModules.includes('achievement'),'Company business archives retain the existing SQLCipher section');
assert.ok(!v.personalModules.includes('contract')&&!v.personalModules.includes('horizontalProject'),'Personal groups should have no redundant separate contract/horizontal menu');
for(const k of ['certificate','ip','researchProject','achievement','academic','general'])assert.ok(v.personalModules.includes(k),'Personal group missing '+k);
for(const t of ['身份证明','学历学位','职称资格','任职证明'])assert.ok(v.identity.includes(t),'Identity credential category missing '+t);
for(const t of ['发明专利','软件著作权','其他著作权'])assert.ok(v.intellectual.includes(t),'Intellectual category missing '+t);
for(const t of ['技术成果','成果评价','项目奖励','个人奖励','人才奖励','标准制定','新产品'])assert.ok(v.achievement.includes(t),'Achievement category missing '+t);
for(const t of ['论文论著','学术兼职','会议报告','政策建议'])assert.ok(v.academic.includes(t),'Academic category missing '+t);
assert.deepEqual(Array.from(v.projectTypes).sort(),['横向项目','科研项目']);
assert.equal(v.foreignProjects.length,2,'Company project lookup must remain unchanged');
for(const k of ['certificate','ip','researchProject','achievement','academic'])assert.ok(v.noteKeys.includes(k),'Personal category note missing '+k);

// The two workbenches use the original workspace chooser's large card layout,
// with direct business links rather than duplicated stats or database-status panels.
const dashboardBegin=js.indexOf('function dashboard(){');
const dashboardEnd=js.indexOf('function generalList(){',dashboardBegin);
assert.ok(dashboardBegin>=0&&dashboardEnd>dashboardBegin,'Dashboard renderer missing');
const dashboardScript=js.slice(dashboardBegin,dashboardEnd);
const iconBegin=js.indexOf('const iconArt=');
const iconEnd=js.indexOf('const labels=',iconBegin);
assert.ok(iconBegin>=0&&iconEnd>iconBegin,'Central offline SVG icons missing');
const iconScript=js.slice(iconBegin,iconEnd);
const dashboardContext=vm.createContext({});
vm.runInContext(`
 let space='personal';
 const personalNav=[
  ['dashboard','个人工作台','▦'],
  ['certificate','身份与资质','▣'],
  ['ip','知识产权与著作','◇'],
  ['researchProject','科研与合作项目','▤'],
  ['achievement','成果与奖励','★'],
  ['academic','学术与社会活动','▥'],
  ['general','其他资料','▧']
 ];
 const companyNav=[
  ['dashboard','工作台','▦'],
  ['certificate','企业资质','▣'],
  ['achievement','业务档案','▤'],
  ['researchProject','公司项目','▤'],
  ['ip','知识产权','◇'],
  ['general','综合资料','▥']
 ];
 function labels(){return space==='personal'?personalNav:companyNav;}
 function title(key){return labels().find(x=>x[0]===key)?.[1]||key;}
 function escapeHtml(s){return String(s);}
 `+iconScript+dashboardScript+`
 globalThis.personalDashboard=dashboard();
 space='company';
 globalThis.companyDashboard=dashboard();
 `,dashboardContext);
const personalHome=dashboardContext.personalDashboard;
const companyHome=dashboardContext.companyDashboard;
assert.ok(personalHome.includes('<h1>个人工作台</h1>')&&companyHome.includes('<h1>工作台</h1>'),
 'Dashboard heading must match the current workspace');
assert.equal((personalHome.match(/class="choice dashboard-choice"/g)||[]).length,6,
 'Personal workbench should show six direct category cards (desktop 3 columns × 2 rows)');
assert.equal((companyHome.match(/class="choice dashboard-choice"/g)||[]).length,5,
 'Company workbench should show five direct category cards (desktop 3 + 2)');
for(const key of ['certificate','ip','researchProject','achievement','academic','general'])
 assert.ok(personalHome.includes('data-nav="'+key+'"'),'Personal workbench lost '+key);
for(const key of ['certificate','achievement','researchProject','ip','general'])
 assert.ok(companyHome.includes('data-nav="'+key+'"'),'Company workbench lost '+key);
for(const home of [personalHome,companyHome]){
 assert.ok(home.includes('class="choice-grid dashboard-choice-grid"')&&home.includes('进入管理 →'),
  'Dashboard must retain workspace-chooser-style cards and navigation labels');
 assert.equal((home.match(/class="ui-icon"/g)||[]).length,(home===personalHome?6:5),
  'Each dashboard tile must render one shared SVG icon');
 assert.ok(!home.includes('▦')&&!home.includes('▣')&&!home.includes('◇'),
  'Dashboard must not render placeholder glyphs as icons');
 assert.ok(!home.includes('class="cards"')&&!home.includes('class="panels"')&&
  !home.includes('当前工作区资料概况')&&!home.includes('metriclabel'),
  'Remove the redundant statistics and workspace-status panels');
}
for(const rule of ['.dashboard-home{width:100%;max-width:1180px;margin:0 auto;',
 '.dashboard-choice-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}',
 '.dashboard-choice{min-height:164px;padding:19px 22px;gap:8px}',
 '@media(max-width:1150px){',
 '.dashboard-choice-grid{grid-template-columns:repeat(2,minmax(0,1fr))}',
 '@media(max-width:780px){',
 '.dashboard-choice-grid{grid-template-columns:1fr;gap:12px}'])
 assert.ok(css.includes(rule),'Simple workbench card CSS missing: '+rule);


// The same icon family must be reused in sidebar, workspaces and the workbench.
for(const key of ['grid','certificate','folder','briefcase','shield','library','person','company','identity','trophy','book','trash','settings'])
 assert.ok(iconScript.includes(key+':'),'Missing SVG drawing '+key);
for(const key of ['personal','company'])assert.ok(html.includes('data-ui-icon="'+key+'"'),
 'Workspace selector must mount the shared icon '+key);
assert.equal((html.match(/data-ui-icon="/g)||[]).length,4,
 'Both unlock choices and both sidebar workspace switches need matching icons');
assert.ok(js.includes('class="nav-symbol"')&&js.includes('class="nav-text"')&&
 (js.match(/uiIcon\(key\)/g)||[]).length>=3,
 'Sidebar and dashboard must reuse the same SVG icon renderer');
assert.ok(css.includes('.dashboard-choice-symbol .ui-icon')&&css.includes('.nav-symbol')&&css.includes('.workspace-switch-icon .ui-icon'),
 'Unified icon sizing and alignment styles are required');
assert.ok(!/\bfetch\s*\(\s*['"]https?:/.test(iconScript),'Icon set must stay self-contained and offline');

/* Document archives are cards, business ledgers are tables. Browserless render checks. */
for(const cls of ['.recordgrid','.archivecard','.archivecard-real','.archivecard-meta','.archivecard-actions','.archivecategory','.archive-tablewrap']){
 assert.ok(css.includes(cls),'Missing archive card style '+cls);
}
assert.ok(js.includes("archiveSections.includes(page)?(space==='company'&&page==='certificate'?realCompanyCertificateList():realArchiveCards(page))"),
 'Company certificate routes directly to its real list; other archives keep category cards');
assert.ok(js.includes("archiveGroup&&archiveSections.includes(page)&&!(space==='company'&&(page==='certificate'||page==='achievement'))?realArchiveTable(page,archiveGroup)"),
 'Personal archives retain category-card drill-down; company business archives use the folder tree');
assert.ok(js.includes("detail.kind==='archive'?realArchiveDetail()"),'Archive records must open real detail');
assert.ok(js.includes("page==='general'?generalList()"),'Real general records must retain their route');
assert.ok(js.includes("isProject(page)?projectList(page)"),'Project pages must use real SQLCipher records');
assert.ok(js.includes("page==='ip'?ipList()"),'IP ledger must render genuine SQLCipher records');
assert.ok(js.includes("page==='contract'?contractList()"),'Contract summary must render real SQLCipher records');
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
const cardsCtx=vm.createContext({sessionStorage:{getItem:()=>null},document:exportDocument});
const renderSetup=[
 "function heading(name){return '<h1>'+escapeHtml(name)+'</h1>';}",
 "function stamp(){return '<span class=mockflag>界面示例</span>';}",
 "space='personal';",
 "liveRows=[{id:41,title:'个人<资料&测试>',files:[{id:3,name:'a.pdf',groupId:'a'},{id:4,name:'b.pdf',groupId:'b'}]}];",
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
vm.runInContext(preamble+'\n'+header+'\nfunction quickExportButtons(){return "excelExport ZIP";}\n'+rendererSource+'\n'+body,cardsCtx);
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
 assert.deepEqual(labels,['项目名称','项目类型','项目编号','开始日期','附件']);
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
for(const route of ["'/api/v2/ui/projects/'+space","'/api/v2/folders/'+space+'/project'","method:'DELETE'","method:'PUT'","method:'POST'"])
 assert.ok(js.includes(route),'Missing project persistence or transfer '+route);
assert.ok(js.includes("projectRows=projects;ipRows=ips.rows;contractRows=contracts;"),
 'Project/contract list and IP rows must use native V2 FolderId sources');
const projectCtx=vm.createContext({sessionStorage:{getItem:()=>null},document:exportDocument});
const projector=js.slice(js.indexOf('function projectViewRows('),js.indexOf('function archiveCard(',js.indexOf('function projectViewRows(')));
vm.runInContext(preamble+
 '\nfunction heading(t,s,actions){return t+(actions||"");}\nfunction infoRow(n,v){return n+v;}\nfunction section(n,v){return n+v;}\nfunction businessFileCount(){return 0;}\nfunction excelExportButton(){return "excelExport";}\nfunction pill(v){return "<span class="+String.fromCharCode(34)+"pill"+String.fromCharCode(34)+">"+escapeHtml(v)+"</span>";}\n'+projector+
 "\nspace='company';projectRows=[{id:12,name:'真实项目',projectType:'科研项目',projectNo:'X-1',startDate:'2026-01-02',projectStatus:'进行中',leader:'负责人甲'}];globalThis.__project=projectList('researchProject');",projectCtx);
assert.ok(projectCtx.__project.includes('data-project-id="12"'),'Real project ledger must open persisted IDs');
assert.ok(projectCtx.__project.includes('<table class="data ledger-project-table">'),
 'Project lists must opt into the long-name-first column sizing');
assert.ok(projectCtx.__project.includes('<th>项目类型</th><th>项目名称</th><th>项目编号</th>'),
 'Project type must precede project name in the header');
assert.ok(projectCtx.__project.indexOf('class="pill"')<
 projectCtx.__project.indexOf('data-project-id="12"'),
 'Project type cell must precede the clickable project-name cell');
assert.ok(projectCtx.__project.includes('data-nav="contract"')&&projectCtx.__project.includes('查看全部合同'),
 'Contract aggregate remains accessible from the company project ledger');
assert.ok(projectCtx.__project.includes('class="pill"')&&projectCtx.__project.includes('科研项目'),
 'Project type must display as a tag in every row');
vm.runInContext(
 "projectRows=["+
 "{id:12,name:'科研甲',projectType:'科研项目',projectNo:'R-12'},"+
 "{id:13,name:'横向乙',projectType:'横向项目',projectNo:'H-13'},"+
 "{id:14,name:'其他丙',projectType:'其他项目',projectNo:'O-14'}];"+
 "space='company';filterKind='全部类型';filterState='全部状态';filterName='';"+
 "globalThis.__allProjects=projectList('researchProject');"+
 "filterKind='横向项目';globalThis.__horizontalOnly=projectList('researchProject');",
 projectCtx);
for(const name of ['科研甲','横向乙','其他丙'])
 assert.ok(projectCtx.__allProjects.includes(name),'Company project view missing '+name);
assert.ok(projectCtx.__horizontalOnly.includes('横向乙')&&
 !projectCtx.__horizontalOnly.includes('科研甲')&&!projectCtx.__horizontalOnly.includes('其他丙'),
 'Project type must filter one common ledger, preserving all types');
assert.ok(js.includes("if(space==='company'&&next==='horizontalProject')next='researchProject'"),
 'Legacy company horizontal route must resolve to unified project ledger');
assert.ok(js.includes("if(p){page='researchProject'")&&
 js.includes("else if(kind==='project')page='researchProject'"),
 'Contract back and search navigation must use common project ledger');
assert.ok(!projectCtx.__project.includes('ledger-excel')&&projectCtx.__project.includes('excelExport')&&
 !projectCtx.__project.includes('excelExportAll'),'One Excel button beside project ZIP');
assert.ok(projectCtx.__project.includes('class="ledger-export-row"')&&projectCtx.__project.includes('ledgerExportAll'),
 'Project ledger must allow selecting multiple actual records');
assert.ok(projectCtx.__project.includes('data-action="projectExportFolder"')&&
 projectCtx.__project.includes('data-action="projectExportZip"'),
 'Project ledger must export selected projects directly as folder or ZIP');
assert.ok(!projectCtx.__project.includes('module-export')&&!projectCtx.__project.includes('选择记录附件'),
 'Project ledger must not require a second file-picking panel');
assert.ok(!projectCtx.__project.includes('负责人甲'),'Project leader must not appear in the ledger');
assert.ok(js.includes("section('项目基本信息','<div class=\"infogrid project-info-grid\">'"),
 'Real project detail must mount the scoped dense information grid');
assert.ok(css.includes('.project-info-grid{grid-template-columns:repeat(auto-fit,minmax(185px,1fr))')&&
 css.includes('.project-info-grid .info strong{font-size:15px')&&
 css.includes('.project-info-grid .info:first-child,.project-info-grid .info:last-child{grid-column:span 2}'),
 'Project field cards should be compact, readable and let longer names/remarks span cells');
assert.ok(css.includes('@media(max-width:420px)')&&
 css.includes('.project-info-grid{grid-template-columns:1fr}'),
 'Project details must keep usable layout at narrow widths');

assert.ok(!projectCtx.__project.includes('仅演示'),'Real project page must not be marked mock');

// Intellectual property now uses a persisted workspace-scoped ledger and a full M0 form.
assert.ok(html.includes('id="ipDialog"'),'IP form modal missing');
for(const name of ['name','ipType','status','applicants','rightHolders','creators','applicationNo',
 'applicationDate','publicationNo','publicationDate','grantNoticeNo','grantNoticeDate',
 'publicationInfo','grantDate','registrationNo','firstPublishedDate','registrationDate',
 'category','tags','remarks'])
 assert.ok(html.includes('id="ip-'+name+'"'),'Missing intellectual-property field '+name);
for(const action of ['ipAdd','ipEdit','ipDelete','ipCopy','ipMove'])
 assert.ok(js.includes("case '"+action+"'"),'IP operation missing '+action);
assert.ok(js.includes("ipRows=ips.rows;contractRows=contracts;"),
 'IP FolderId rows must be projected from the V2 service');
const intellectualCode=js.slice(js.indexOf('const ipStatusByType='),js.indexOf('function projectViewRows(',js.indexOf('const ipStatusByType=')));
assert.ok(intellectualCode.length>0);
const ipCtx=vm.createContext({sessionStorage:{getItem:()=>null},document:exportDocument});
vm.runInContext(preamble+
 '\nfunction heading(t){return t;}\nfunction infoRow(n,v){return n+v;}\nfunction section(n,v){return n+v;}\nfunction businessFileCount(){return 0;}\nfunction excelExportButton(){return "excelExport";}\nfunction quickExportButtons(){return "excelExport ZIP";}\n'+intellectualCode+
 "\nspace='company';businessFileRows=[];ipRows=[{id:32,data:{name:'真实专利',ipType:'发明专利',applicationNo:'CN-42',status:'已申请',rightHolders:'权利人甲',applicationDate:'2026-02-01'}}];globalThis.__ip=ipList();globalThis.__types=Object.keys(ipStatusByType);",ipCtx);
assert.ok(ipCtx.__ip.includes('data-ip-id="32"'),'Real IP rows must link to stored IDs');
assert.ok(ipCtx.__ip.includes('excelExport')&&!ipCtx.__ip.includes('ledger-excel'),'One Excel button beside IP ZIP');
assert.ok(ipCtx.__ip.includes('data-action="ipExportFolder"')&&ipCtx.__ip.includes('data-action="ipExportZip"'),'IP ledger must directly export selected records');
assert.ok(!ipCtx.__ip.includes('选择记录附件')&&!ipCtx.__ip.includes('module-export'),'IP ledger must not render a second selection panel');
assert.ok(ipCtx.__ip.includes('<table class="data ledger-ip-table">'),
 'Knowledge-property ledger needs a separate long-name-friendly column layout');
assert.ok(ipCtx.__ip.includes('class="ledger-export-row"')&&ipCtx.__ip.includes('ledgerExportAll'),
 'IP ledger must allow selecting multiple actual records');
assert.ok(!ipCtx.__ip.includes('仅演示'),'Real IP ledger must not use mock labels');
assert.equal(ipCtx.__types.length,7,'Exactly seven M0 IP types must be selectable');

// Contracts inherit the parent project and use the existing frozen ledger/details UI.
assert.ok(html.includes('id="contractDialog"'),'Contract input form missing');
for(const field of ['name','contractNo','signDate','amount','signingParties','category','tags','remarks'])
 assert.ok(html.includes('id="ct-'+field+'"'),'Contract business field missing '+field);
assert.ok(!js.includes('case \'demoContract\':notice('),'Contract must not be a demo-only operation');
for(const action of ['contractAdd','contractEdit','contractCopy','contractDelete'])
 assert.ok(js.includes("case '"+action+"'"),'Missing real contract action '+action);
assert.ok(js.includes('data-contract-id='),'Real contract items must link to saved IDs');
assert.ok(js.includes('data-contract-back-project'),'Contract detail must return to owning project');
assert.ok(js.includes("section('所属合同',projectContracts(p.id))"),'Project details must list real children');
assert.ok(js.includes("json:{contract:data,...(id===null?{parentId:projectId}:{})}"),
 'New contracts must be created from their project ID');
const contractFrom=js.indexOf('const contractFieldLabels=');
const contractUntil=js.indexOf('function projectViewRows(',contractFrom);
assert.ok(contractFrom>=0&&contractUntil>contractFrom,'Contract renderers not found');
const contractContext=vm.createContext({sessionStorage:{getItem:()=>null},document:exportDocument});
vm.runInContext(preamble+
 '\nfunction excelExportButton(){return "excelExport";}' +
 '\nfunction quickExportButtons(){return "excelExport ZIP";}' +
 '\nfunction heading(n,s,a){return n+(a||"");}\nfunction infoRow(n,v){return n+":"+v;}\nfunction section(n,v){return n+v;}\n'+
 js.slice(contractFrom,contractUntil)+
 "\nspace='company';contractRows=[{id:31,projectId:7,workspace:'company',projectName:'测试科研项目',name:'测试合同',contractNo:'HT-001',signDate:'2026-10-12',amount:'12.3',signingParties:'甲乙'}];"+
 "globalThis.__contracts=contractList();globalThis.__owned=projectContracts(7);"+
 "globalThis.__display=[contractMoney(''),contractMoney('0'),contractMoney('12.3')];",contractContext);
assert.ok(contractContext.__contracts.includes('data-contract-id="31"'),'Contract summary must open actual record IDs');
assert.ok(contractContext.__contracts.includes('测试科研项目'),'Contract summary must show parent project name');
assert.ok(!contractContext.__contracts.includes('data-action="contractAdd"'),'No free-standing create contract action');
assert.ok(contractContext.__owned.includes('data-action="contractAdd"'),'Project detail must offer adding a child contract');
assert.ok(contractContext.__owned.includes('data-contract-id="31"'),'Project detail must list only owned contracts');
assert.deepEqual(Array.from(contractContext.__display),['—','0.00','12.30']);

// B04 minimal archives reuse frozen category cards -> ledger -> detail layout.
for(const id of ['archiveDialog','archiveForm','aName','aCategory','aYear','archiveYearField','archiveFolderField','aFolder','archiveFolderDialog','archiveCreateDialog','archiveCreateRecord','archiveCreateFolder','archiveFolderName','archiveFolderParent','aRemarks','aTags',
 'archiveTransferDialog','archiveTransferForm','archiveDestination'])
 assert.ok(html.includes('id="'+id+'"'),'Archive form or transfer control missing: '+id);
for(const action of ['archiveAdd','archiveEdit','archiveCopy','archiveMove','archiveDelete'])
 assert.ok(js.includes("case '"+action+"'"),'Missing real archive action '+action);
assert.ok(js.includes("api('/api/v2/ui/archive/'+space)"),
 'Real archives must be fetched by current workspace and module');
assert.ok(js.includes('data-archive-id='),'Real archive records must open stored IDs');
assert.ok(js.includes("archiveRows[section]=native.archives.filter(r=>r.section===section)"),'Archive records must be initialized from database');
const archiveFirst=js.indexOf('const archiveSections=['),archiveLast=js.indexOf('function mockCardList(k){',archiveFirst);
assert.ok(archiveFirst>=0&&archiveLast>archiveFirst,'Archive render functions missing');
const realArchiveCtx=vm.createContext({sessionStorage:{getItem:()=>null},document:exportDocument});
vm.runInContext(preamble+'\n'+js.slice(archiveFirst,archiveLast)+
 "\nfunction heading(name,subtitle,actions,breadcrumbBack){return '<div class=\"heading\"><div><div class=\"heading-title-row\">'+(breadcrumbBack||'')+'<h1>'+name+'</h1></div></div></div>'+(actions||'');}"+
 "\nfunction infoRow(k,v){return k+':'+v;}"+
 "\nfunction section(name,content){return name+content;}"+
 "\nfunction businessFileCount(){return 0;}\nfunction businessFiles(kind,ownerId,section){return (globalThis.mockCertificateFiles||[]).filter(f=>f.kind===kind&&f.ownerId===ownerId&&f.section===section);}\nfunction quickExportButtons(){return 'excelExport ZIP';}\nfunction quickExportButtons(){return 'excelExport ZIP';}"+
 "\nspace='personal';page='academic';filterName='';filterKind='全部类型';"+
 "archiveRows={certificate:[],achievement:[],academic:["+
 "{id:21,name:'第一次兼职',category:'学术兼职',remarks:'',tags:''},"+
 "{id:22,name:'第二次兼职',category:'学术兼职',remarks:'',tags:''},"+
 "{id:23,name:'会议报告',category:'会议报告',remarks:'',tags:''}"+
 "]};archiveGroup='学术兼职';"+
 "globalThis.mockCertificateFiles=["+
 "{kind:'archive',ownerId:21,section:'academic',id:101,groupId:'gA',version:1,size:1024,name:'first.pdf',category:''},"+
 "{kind:'archive',ownerId:21,section:'academic',id:102,groupId:'gA',version:2,size:2048,name:'first.pdf',category:''},"+
 "{kind:'archive',ownerId:21,section:'academic',id:103,groupId:'gB',version:1,size:4096,name:'second.pdf',category:''}"+
 "];"+
 "globalThis.__realCards=realArchiveCards('academic');"+
 "globalThis.__realTable=realArchiveTable('academic','学术兼职');"+
 "globalThis.__realOther=realArchiveTable('academic','会议报告');"+
 "globalThis.__realDetail=realArchiveDetail;"+
 "globalThis.__possibleTargets=archiveDestinations;",realArchiveCtx);
assert.ok(realArchiveCtx.__realCards.includes('data-archive-category="学术兼职"'),
 'Even with real data, the category cards must be separate from records');
assert.ok(!realArchiveCtx.__realCards.includes('<table'),'Archive top level cannot turn into a table');
assert.ok(realArchiveCtx.__realTable.includes('<section class="white archive-category-ledger">')&&
 realArchiveCtx.__realTable.includes('<b>共 2 条记录</b>'),
 'Personal category tables must use enterprise-certificate-style compact header and count');
assert.ok(!realArchiveCtx.__realCards.includes('archive-category-ledger'),
 'Category cards must retain their existing header layout');
assert.ok(realArchiveCtx.__realTable.includes('<table class="data ledger-archive-category-table">'),
 'Personal archive category tables must use the shared compact column sizing');
for(const rendered of [realArchiveCtx.__realTable,realArchiveCtx.__companyTable||'']){
 if(!rendered)continue;
 assert.ok(rendered.includes('<th>序号</th><th>资料名称</th><th>附件</th><th>文件大小</th><th>备注</th><th>操作</th>'),
  'Archive category table must use company-certificate column headings');
 assert.ok(rendered.includes('archive-col-order')&&rendered.includes('archive-col-action'),
  'Sort and action must have dedicated columns, in that order');
}
assert.ok(realArchiveCtx.__realTable.includes('<td>2 份</td><td class="archive-category-file-size">6.0 KiB</td>'),
 'Category table must count each original once and total only its latest version sizes');
assert.ok(realArchiveCtx.__realTable.includes('<span class="muted">未上传</span>'),
 'Category table should clearly show records without any attachment');
assert.ok(realArchiveCtx.__realTable.includes('data-archive-id="21"')&&
 realArchiveCtx.__realTable.includes('data-archive-id="22"'),
 'A category must support multiple independently persisted records');
assert.ok(!realArchiveCtx.__realTable.includes('data-archive-id="23"'),
 'Academic categories must not mix their records');
assert.ok(realArchiveCtx.__realOther.includes('data-archive-id="23"'),
 'Conference category must retain its own records');
assert.ok(!realArchiveCtx.__realCards.includes('界面示例'),
 'Real archive pages must not be labelled as demonstration data');
assert.ok(realArchiveCtx.__possibleTargets.some(x=>x.workspace==='company'&&x.kind==='company_certificate'),
 'Company and personal certificates must remain different logical kinds');
vm.runInContext(
 "space='company';page='achievement';archiveRows.achievement=["+
 "{id:31,name:'首台套申报',category:'申报与认定',folderId:201,year:'2026',remarks:'',tags:''},"+
 "{id:32,name:'历史成果资料',category:'技术成果',folderId:202,remarks:'',tags:''},"+
 "{id:33,name:'下级评审报告',category:'申报与认定',folderId:204,remarks:'',tags:''}];"+
 "archiveFolders=["+
 "{id:201,parentId:null,name:'申报与认定',position:0},"+
 "{id:202,parentId:null,name:'技术成果',position:1},"+
 "{id:203,parentId:201,name:'企业行标',position:0},"+
 "{id:204,parentId:203,name:'2026年度',position:0},"+
 "{id:205,parentId:null,name:'自建分类',position:2}];"+
 "archiveFolderId=null;"+
 "globalThis.__companyName=archiveSectionName('achievement');"+
 "globalThis.__companyCats=archiveCategories('achievement');"+
 "globalThis.mockCertificateFiles.push("+ 
 "{kind:'archive',ownerId:31,section:'achievement',id:301,groupId:'zA',version:1,size:100,name:'申报.pdf',category:''},"+
 "{kind:'archive',ownerId:31,section:'achievement',id:302,groupId:'zA',version:2,size:200,name:'申报.pdf',category:''},"+
 "{kind:'archive',ownerId:31,section:'achievement',id:303,groupId:'zB',version:1,size:300,name:'证明.docx',category:''},"+
 "{kind:'archive',ownerId:33,section:'achievement',id:304,groupId:'zC',version:1,size:400,name:'报告.pdf',category:''}"+
 ");"+
 "globalThis.__companyCards=realArchiveCards('achievement');"+
 "archiveFolderId=201;"+
 "globalThis.__companyTable=realArchiveCards('achievement');"+
 "archiveFolderId=203;"+
 "globalThis.__companyNested=realArchiveCards('achievement');"+
 "globalThis.__companyPath=archiveFolderPath(203).map(x=>x.name);"+
 "archiveFolderId=201;"+
 "globalThis.__companyZip=archiveRecordZipOriginals(31,'achievement');"+
 "globalThis.__rootFolderZip=archiveFolderOriginals(201);"+
 "globalThis.__innerFolderZip=archiveFolderOriginals(203);"+
 "globalThis.__combinedZip=archiveChosenOriginals([201],[31]);"+
 "archiveEntryOrders={'201':[{kind:'record',id:31},{kind:'folder',id:203}]};"+
 "globalThis.__companyMixed=realArchiveCards('achievement');"+
 "archiveEntryOrders={};"+
 "globalThis.__emptyCompanyZip=archiveRecordZipOriginals(32,'achievement');",
 realArchiveCtx);
assert.equal(realArchiveCtx.__companyName,'业务档案');
for(const c of ["申报与认定","规划与管理","汇报与宣传","会议与活动","专项工作与合作","政策与行业资料","其他业务资料"])
 assert.ok(realArchiveCtx.__companyCats.includes(c),'Missing business archive category '+c);
assert.ok(realArchiveCtx.__companyCats.includes('技术成果'),'Legacy categories must remain available');
assert.ok(realArchiveCtx.__companyCards.includes('data-archive-folder-id="202"')&&
 realArchiveCtx.__companyCards.includes('data-archive-folder-id="201"')&&
 realArchiveCtx.__companyTable.includes('data-archive-id="31"'),
 'Business archive root must expose legacy first-level categories as clickable cards');
assert.ok(realArchiveCtx.__companyTable.includes('data-archive-folder-id="203"')&&
 realArchiveCtx.__companyNested.includes('data-archive-folder-id="204"')&&
 !realArchiveCtx.__companyNested.includes('data-archive-id="31"'),
 'Nested directory table rows should show direct child folders and only their own records');
assert.ok(realArchiveCtx.__companyCards.includes('class="recordgrid"')&&
 realArchiveCtx.__companyCards.includes('class="archivecard archivecategory"')&&
 !realArchiveCtx.__companyCards.includes('<table')&&
 realArchiveCtx.__companyCards.includes('data-action="archiveFolderAdd"')&&
 !realArchiveCtx.__companyCards.includes('data-action="archiveCreate"')&&
 !realArchiveCtx.__companyCards.includes('archive-folder-check')&&
 !realArchiveCtx.__companyCards.includes('data-archive-folder-download=')&&
 !realArchiveCtx.__companyCards.includes('compact-ledger-export')&&
 realArchiveCtx.__companyCards.includes('data-archive-folder-delete="205"')&&
 !realArchiveCtx.__companyCards.includes('data-archive-folder-delete="201"')&&
 realArchiveCtx.__companyCards.includes('data-archive-folder-delete="202"'),
 'Business archive root keeps cards, creates folders only, hides selection/export, and can delete custom roots only');
for(const view of [realArchiveCtx.__companyTable,realArchiveCtx.__companyNested]){
 assert.ok(view.includes('<table class="data ledger-archive-category-table company-business-archive">')&&
  !view.includes('class="recordgrid"')&&!view.includes('archive-folder-card')&&
  view.includes('<tr class="archive-folder-row" data-archive-folder-row="'),
  'After entering any category, all deeper levels must share one ledger table');
}
const folderRow=realArchiveCtx.__companyTable.match(/<tr class="archive-folder-row"[^>]*>(.*?)<\/tr>/)?.[1];
assert.ok(folderRow&&
 (folderRow.match(/<td\b/g)||[]).length===6&&
 folderRow.includes('class="link" data-archive-folder-id="203">企业行标</button>')&&
 folderRow.includes('data-archive-folder-id="203"')&&
 folderRow.includes('>打开</button>')&&
 !folderRow.includes('data-archive-folder-download=')&&
 !folderRow.includes('>下载</button>')&&
 !folderRow.includes('<svg')&&!folderRow.includes('archive-folder-link')&&
 !folderRow.includes('data-archive-id=')&&!folderRow.includes('type="checkbox"'),
 'Nested folder rows only show 打开, preserving the clickable name');
assert.ok(realArchiveCtx.__companyNested.includes('<tbody><tr class="archive-folder-row"')&&
 !realArchiveCtx.__companyNested.includes('当前目录暂无资料'),
 'Folder-only nested lists must not display a false empty-state row');
assert.ok(realArchiveCtx.__companyMixed.indexOf('data-archive-id="31"')<
 realArchiveCtx.__companyMixed.indexOf('data-archive-folder-row="203"')&&
 realArchiveCtx.__companyMixed.includes('data-archive-entry-kind="record"')&&
 realArchiveCtx.__companyMixed.includes('data-archive-entry-kind="folder"'),
 'Saved per-parent mixed order must allow records to appear before folders');
assert.ok(js.includes("body.querySelectorAll('tr[data-archive-folder-row]')")&&
 js.includes('tr.lastElementChild.before(orderCell)')&&
 css.includes('.company-business-archive .archive-folder-row')&&
 js.includes("check.className='archive-folder-check'")&&
 js.includes("check.checked=archiveSelectedFolders.has(folderId)"),
 'DOM ledger decorator must make folder rows selectable, but keep record delete/order controls separate');
assert.ok(js.includes("items=[...body.querySelectorAll('tr[data-archive-entry-kind]')]")&&
 js.includes("btn.dataset.archiveEntryMove=kind+':'+id;")&&
 js.includes("await api('/api/v2/folders/company/entries/reorder?section=achievement'")&&
 js.includes("archiveEntryOrders[String(parentId)]=entries"),
 'Folder/record arrows must persist the single mixed order to SQLCipher');
assert.ok(css.includes('.company-business-archive th:last-child')&&
 css.includes('.company-business-archive td.archive-category-action{text-align:center}'),
 'Folder 打开 and 操作 heading must share centered alignment');
assert.ok(js.includes("pageHeading.querySelector('[data-archive-back=\"cards\"],[data-archive-folder-back]')"),
 'Compact ledger toolbar must preserve the back-to-parent button while opening folder rows');
assert.ok(realArchiveCtx.__companyTable.includes('data-action="archiveCreate"')&&
 !realArchiveCtx.__companyTable.includes('data-action="archiveFolderAdd"')&&
 !realArchiveCtx.__companyTable.includes('data-action="archiveAdd"')&&
 realArchiveCtx.__companyTable.includes('管理当前目录')&&
 JSON.stringify(Array.from(realArchiveCtx.__companyPath))==='["申报与认定","企业行标"]',
 'Arbitrary-depth navigation must preserve directory controls and full path');
assert.ok(js.includes("await api('/api/v2/folders/company/archive_folder")&&
 js.includes("el('archiveFolderForm').onsubmit")&&
 js.includes('function archiveFolderOptions(')&&
 js.includes("case 'archiveExpand'"),
 'Directory management, record assignment and safe record expansion must be wired');
assert.ok(html.includes('id="archiveFolderParentField"')&&
 js.includes("el('archiveFolderParentField').hidden=!folder")&&
 js.includes("const parentId=id?(Number(el('archiveFolderParent').value)||null):(archiveFolderId||null);"),
 'New subcategory must use the active parent without asking users to choose a parent directory');
assert.ok(realArchiveCtx.__companyTable.includes('<table class="data ledger-archive-category-table company-business-archive">'),
 'Company archive category tables must use the same compact column sizing');
assert.ok(realArchiveCtx.__companyTable.includes('<section class="white archive-category-ledger">')&&
 realArchiveCtx.__companyTable.includes('<b>文件夹 1 个 · 资料 1 条</b>'),
 'Company table header must count same-level folders and records');
assert.ok(realArchiveCtx.__companyTable.includes('company-business-archive')&&
 realArchiveCtx.__companyTable.includes('<th>序号</th><th>名称</th><th>年份</th><th>附件</th><th>备注</th><th>操作</th>')&&
 !realArchiveCtx.__companyTable.includes('<th>文件大小</th>'),
 'Every company business-archive table uses name, year, count, notes, sort and ZIP action');
assert.ok(realArchiveCtx.__companyTable.includes('archive-col-year')&&
 realArchiveCtx.__companyTable.includes('archive-category-year">2026</td>')&&
 realArchiveCtx.__companyTable.includes('<td>2 份</td>')&&
 realArchiveCtx.__companyTable.includes('data-archive-download="31"')&&
 !realArchiveCtx.__companyTable.includes('>查看详情</button>'),
 'Company row shows persisted year, distinct current attachments and direct ZIP button');
assert.deepEqual(Array.from(realArchiveCtx.__companyZip.map(f=>f.id)),[302,303],
 'Company record ZIP must include each current attachment once and omit old versions');
assert.ok(realArchiveCtx.__companyZip.every(f=>f.workspace==='company'&&f.section==='achievement'&&f.ownerId===31),
 'ZIP source must be restricted to the current company record');
assert.equal(realArchiveCtx.__emptyCompanyZip.length,0,'Unrelated categories must not leak into record ZIP');
assert.deepEqual(Array.from(realArchiveCtx.__rootFolderZip.map(f=>f.id)),[302,303,304],
 'A root directory download must recursively include both its own and nested archive originals, latest only');
assert.deepEqual(Array.from(realArchiveCtx.__innerFolderZip.map(f=>f.id)),[304],
 'A nested directory download must exclude originals directly owned by its parent');
assert.deepEqual(Array.from(realArchiveCtx.__combinedZip.map(f=>f.id)),[302,303,304],
 'Selecting a directory and one of its records must not duplicate attachments');
assert.deepEqual(Array.from(realArchiveCtx.__innerFolderZip[0].archiveFolderPath.map(f=>f.name)),
 ['企业行标','2026年度'],'Recursive ZIP must preserve hierarchy relative to selected directory');
assert.ok(js.includes("archiveSelectedFolders.add(folderId)")&&
 js.includes("el('content').querySelectorAll('.archive-folder-check').forEach(")&&
 js.includes("archiveChosenOriginals(selectedAnything?folders:visibleFolders,")&&
 js.includes("const visibleFolders=archiveVisibleFolderIds();"),
 'Folder and record multi-selection must be included in toolbar ZIP export without using record deletion');
assert.ok(js.includes("const deleteFolderButton=ev.target.closest('[data-archive-folder-delete]')")&&
 js.includes("await api('/api/v2/folders/company/archive_folder/'+id,{method:'DELETE'})")&&
 js.indexOf("const deleteFolderButton=ev.target.closest(")<
 js.indexOf("const folderCard=ev.target.closest(")&&
 js.includes("const createAtRoot=id===null&&archiveFolderId===null;")&&
 js.includes("archiveFolderId=createAtRoot?null:newId"),
 'Custom root deletion must be a separate confirmed action and root creation must stay on the landing page');
assert.ok(html.includes('id="archiveCreateDialog"')&&
 js.includes("el('archiveCreateRecord').onclick")&&
 js.includes("el('archiveCreateFolder').onclick")&&
 js.includes("case 'archiveCreate':"),
 'Nested category new-action dialog must still offer record or subcategory, while root creates only a folder');
assert.ok(js.includes("await globalThis.IPSysExport.start('zip',originals)")&&
 js.includes("target.dataset.archiveDownload")&&
 js.includes('el(\'aYear\').disabled=!companyBusiness'),
 'Company business archive year editor and row ZIP action must be wired');
assert.ok(css.includes('ledger-archive-category-table.company-business-archive col.archive-col-year'),
 'Company business archive should dedicate a narrow year column');
assert.ok(realArchiveCtx.__realTable.includes('data-archive-back="cards"'),
 'Personal archive back arrow remains beside the category title');
assert.ok(realArchiveCtx.__companyTable.includes('data-archive-folder-back="1"')&&
 !realArchiveCtx.__companyCards.includes('data-archive-folder-back="1"'),
 'Nested business archives use a back-to-parent control; root has no parent');
assert.ok(realArchiveCtx.__realTable.includes('data-action="archiveAdd"')&&
 realArchiveCtx.__companyTable.includes('data-action="archiveCreate"'),
 'Personal archives retain direct new record; company business archives choose the new item type');
assert.ok(css.includes('.heading-title-row{display:flex;align-items:center;gap:8px;')&&
 css.includes('.archive-breadcrumb-back:focus-visible'),
 'Category back arrow must remain aligned and keyboard accessible');
assert.ok(js.includes("label:'公司资料 / 业务档案'"));
assert.ok(!v.personalNav.includes('业务档案'),'Personal achievements should not change');
// Company enterprise certificates skip category cards and use the original stored records as table rows.
vm.runInContext(
 "space='company';page='certificate';archiveGroup=null;filterName='';filterKind='全部类型';"+
 "archiveRows.certificate=["+
 "{id:51,name:'高新技术企业证书',category:'企业认定',remarks:'2026',tags:'资质'},"+
 "{id:52,name:'质量管理体系认证',category:'体系认证',remarks:'ISO',tags:'认证'},"+
 "{id:53,name:'待分类证明',category:'',remarks:'',tags:''}];"+
 "globalThis.mockCertificateFiles=["+
 "{id:101,kind:'archive',ownerId:51,section:'certificate',name:'旧证书.pdf',size:1024,version:1},"+
 "{id:102,kind:'archive',ownerId:51,section:'certificate',name:'新证书.pdf',size:2457600,version:2},"+
 "{id:103,kind:'archive',ownerId:52,section:'certificate',name:'认证附件.docx',size:65536,version:1}];"+
 "globalThis.__certAll=realCompanyCertificateList();"+
 "certificateSelected.add(52);globalThis.__certSelected=realCompanyCertificateList();"+
 "globalThis.__selectedIds=certificateExportIds();"+
 "certificateSelected.delete(52);certificateSelected.add(51);certificateSelected.add(53);"+
 "globalThis.__certMultiple=realCompanyCertificateList();certificateSelected.clear();"+
 "filterKind='体系认证';globalThis.__certStillAll=realCompanyCertificateList();"+
 "filterName='高新';globalThis.__certKeyword=realCompanyCertificateList();"+
 "filterName='ISO';globalThis.__certRemark=realCompanyCertificateList();"+
 "archiveRows.certificate=[];filterName='';globalThis.__certEmpty=realCompanyCertificateList();",
 realArchiveCtx);
for(const label of ['高新技术企业证书','质量管理体系认证','待分类证明'])
 assert.ok(realArchiveCtx.__certAll.includes(label),'Company certificate list missing actual record '+label);
assert.ok(realArchiveCtx.__certAll.includes('<table')&&
 !realArchiveCtx.__certAll.includes('data-archive-category=')&&
 !realArchiveCtx.__certAll.includes('class="recordgrid"'),
 'Company certificate must enter a direct record table without a category-card stage');
assert.ok(realArchiveCtx.__certAll.includes('data-archive-id="51"')&&
 realArchiveCtx.__certAll.includes('data-archive-id="52"')&&
 realArchiveCtx.__certAll.includes('data-archive-id="53"'),
 'Each existing certificate name must remain an editable detail link');
assert.ok(realArchiveCtx.__certAll.includes('<th class="certificate-check">')&&
 realArchiveCtx.__certAll.includes('class="certificate-checkall"')&&
 realArchiveCtx.__certAll.includes('<th class="certificate-sequence">序号</th>')&&
 realArchiveCtx.__certAll.includes('<th>资料名称</th><th>附件</th><th class="certificate-size">文件大小</th><th>备注</th><th class="certificate-order">排序</th><th class="certificate-action">操作</th>')&&
 !realArchiveCtx.__certAll.includes('<th>类别</th>')&&!realArchiveCtx.__certAll.includes('id="filterKind"'),
 'Company certificate table and filters must exclude the category field');
assert.ok(realArchiveCtx.__certAll.includes('data-certificate-download="102"')&&
 realArchiveCtx.__certAll.includes('新证书.pdf')&&
 !realArchiveCtx.__certAll.includes('data-certificate-download="101"'),
 'One-click download must resolve the newest stored original for each record');
assert.ok(realArchiveCtx.__certAll.includes('<td class="certificate-size">2.3 MiB</td>')&&
 realArchiveCtx.__certAll.includes('<td class="certificate-size">64.0 KiB</td>')&&
 !realArchiveCtx.__certAll.includes('<td class="certificate-size">1.0 KiB</td>'),
 'File size must follow each record\'s latest downloadable attachment, not an older version');
assert.ok(realArchiveCtx.__certAll.includes('<td class="certificate-size">—</td>')&&
 realArchiveCtx.__certEmpty.includes('colspan="8"'),
 'No-attachment row shows a dash and the empty-state row spans five columns');
assert.ok(realArchiveCtx.__certAll.includes('class="certificate-rowcheck" value="51"')&&
 realArchiveCtx.__certAll.includes('class="certificate-rowcheck" value="52"')&&
 realArchiveCtx.__certAll.includes('class="certificate-sequence">1</td>')&&
 realArchiveCtx.__certAll.includes('class="certificate-sequence">3</td>'),
 'All certificate records must have a checkbox and a sequential displayed row number');
assert.equal(Array.from(realArchiveCtx.__selectedIds).join(','),'52',
 'Selected certificate IDs must be the exact subset shown for export');
assert.ok(realArchiveCtx.__certSelected.includes('已选 1 条')&&
 realArchiveCtx.__certSelected.includes('class="certificate-rowcheck" value="52" aria-label="选择资料 质量管理体系认证" checked'),
 'Checked certificate rows and selected count must remain visible after rerender');
assert.ok(realArchiveCtx.__certMultiple.includes('已选 2 条')&&
 realArchiveCtx.__certMultiple.includes('class="certificate-rowcheck" value="53" aria-label="选择资料 待分类证明" checked'),
 'Multiple nonadjacent certificate records must remain selected');
assert.ok(realArchiveCtx.__certAll.includes('data-certificate-move="51" data-move-direction="-1" disabled')&&
 realArchiveCtx.__certAll.includes('data-certificate-move="51" data-move-direction="1"')&&
 realArchiveCtx.__certAll.includes('data-certificate-move="53" data-move-direction="1" disabled'),
 'First and last row movement must be constrained while intermediate moves stay enabled');
assert.ok(js.includes("await api('/api/v2/ui/archive/company/certificate/order',{method:'POST',json:{ids}})")&&
 js.includes("const ids=(archiveRows.certificate||[]).map(r=>r.id)")&&
 js.includes("if(target.dataset.certificateMove)")&&
 js.includes("await moveCompanyCertificate(Number(target.dataset.certificateMove)"),
 'A row move must save the entire company certificate order through its scoped API');
assert.ok(js.includes('if(ev.target.matches(\'.certificate-checkall,.certificate-rowcheck\'))')&&
 js.includes('certificateSelected.clear();render();break;'),
 'Certificate checkbox handlers must update selection and filtering must clear stale selections');
assert.ok(js.includes("ids=certificateExportIds();")&&
 js.includes("new Set(certificateExportIds())"),
 'Both Excel and original-file export must prioritize selected certificate row IDs');
assert.ok(realArchiveCtx.__certAll.includes('data-action="certificateBatchDelete" disabled hidden')&&
 realArchiveCtx.__certSelected.includes('data-action="certificateBatchDelete"')&&
 !realArchiveCtx.__certSelected.includes('data-action="certificateBatchDelete" disabled')&&
 !realArchiveCtx.__certSelected.includes('data-action="certificateBatchDelete" hidden')&&
 realArchiveCtx.__certAll.includes('<colgroup>')&&
 realArchiveCtx.__certAll.includes('certificate-col-action')&&
 css.includes('.certificate-ledger .data col.certificate-col-name{width:auto}')&&
 css.includes('.certificate-ledger .data col.certificate-col-file{width:26%}')&&
 css.includes('.certificate-ledger .data col.certificate-col-remarks{width:160px}')&&
 css.includes('.certificate-ledger .archive-tablewrap .data td:nth-child(2){min-width:0')&&
 css.includes('table-layout:fixed'),
 'Certificate batch delete and fixed utility columns must render correctly');
assert.ok(js.includes('all.indeterminate=count>0&&count<visible.length')&&
 js.includes('syncCompanyCertificateSelectionUi();')&&
 js.includes("case 'certificateBatchDelete':")&&
 js.includes("'/api/v2/folders/company/archive/'+id+'?section=certificate'"),
 'Select-all partial state and batch deletion must call the real API');
// Check the real selection helper with controlled fake table inputs.
const headerCheck={checked:false,indeterminate:false};
const rowChecks=[{value:'51',checked:false},{value:'52',checked:false}];
const deleteAction={disabled:true,hidden:true};
const selectedLabel={textContent:''};
const certificateContent={
 querySelector(selector){return selector==='.certificate-checkall'?headerCheck:
  selector==='[data-action="certificateBatchDelete"]'?deleteAction:null;},
 querySelectorAll(selector){return selector==='.certificate-rowcheck'?rowChecks:[];}
};
const certificateDoc={getElementById(id){return id==='content'?certificateContent:
 id==='certificateSelectedCount'?selectedLabel:null;}};
const selectionVm=vm.createContext({document:certificateDoc});
const selectionStart=js.indexOf('function companyCertificateRows(){');
const selectionEnd=js.indexOf('async function moveCompanyCertificate(',selectionStart);
assert.ok(selectionStart>=0&&selectionEnd>selectionStart,'Company certificate selection helper missing');
vm.runInContext(
 "let archiveRows={certificate:[{id:51,name:'证书甲',remarks:''},{id:52,name:'证书乙',remarks:''}]};"+
 "let filterName='';let certificateSelected=new Set(),certificateDeleteBusy=false;"+
 "function el(id){return document.getElementById(id);}\n"+
 js.slice(selectionStart,selectionEnd),selectionVm);
vm.runInContext('syncCompanyCertificateSelectionUi()',selectionVm);
assert.equal(headerCheck.checked,false);
assert.equal(headerCheck.indeterminate,false);
assert.equal(deleteAction.disabled,true,'No record checked must disable batch deletion');
assert.equal(deleteAction.hidden,true,'No selection must hide batch deletion');
vm.runInContext('certificateSelected.add(51);syncCompanyCertificateSelectionUi()',selectionVm);
assert.equal(headerCheck.checked,false);
assert.equal(headerCheck.indeterminate,true,'Partial row selection must display indeterminate header');
assert.equal(deleteAction.disabled,false,'One selected row enables deletion');
assert.equal(deleteAction.hidden,false,'Selecting a row must reveal batch deletion');
assert.deepEqual(rowChecks.map(x=>x.checked),[true,false]);
assert.equal(selectedLabel.textContent,'已选 1 条');
vm.runInContext('certificateSelected.add(52);syncCompanyCertificateSelectionUi()',selectionVm);
assert.equal(headerCheck.checked,true,'All records checked must show checked header');
assert.equal(headerCheck.indeterminate,false);
assert.deepEqual(rowChecks.map(x=>x.checked),[true,true]);
vm.runInContext('certificateDeleteBusy=true;syncCompanyCertificateSelectionUi()',selectionVm);
assert.equal(deleteAction.disabled,true,'In-flight deletion must prevent repeat submission');
assert.equal(deleteAction.hidden,false,'In-flight deletion remains visible but disabled');
vm.runInContext('certificateDeleteBusy=false;certificateSelected.clear();syncCompanyCertificateSelectionUi()',selectionVm);
assert.equal(headerCheck.checked,false);
assert.equal(selectedLabel.textContent,'已选 0 条');
assert.equal(deleteAction.disabled,true);
assert.equal(deleteAction.hidden,true,'Clearing selection must hide batch deletion again');
assert.ok(realArchiveCtx.__certAll.includes('data-certificate-download="103"')&&
 realArchiveCtx.__certAll.includes('data-certificate-download="" disabled title="该资料尚无附件"'),
 'Download must be disabled for records without attachments, not cause fake download');
assert.ok(realArchiveCtx.__certAll.includes('2026')&&
 realArchiveCtx.__certAll.includes('ISO')&&
 !realArchiveCtx.__certAll.includes('>查看详情</button>'),
 'Company certificate table must show remarks and direct download actions');
assert.ok(realArchiveCtx.__certAll.includes('certificate-toolbar-filter')&&
 realArchiveCtx.__certAll.includes('data-action="archiveAdd"')&&
 realArchiveCtx.__certAll.includes('class="certificate-export-options"'),
 'Direct list must keep the integrated filter, new record, and single export menu');
assert.ok(realArchiveCtx.__certAll.includes('<summary class="btn certificate-export-trigger"')&&
 (realArchiveCtx.__certAll.match(/<summary /g)||[]).length===1&&
 (realArchiveCtx.__certAll.match(/class="certificate-export-options"/g)||[]).length===1,
 'Certificate top bar must offer exactly one visible export trigger');
for(const [action,label] of [['moduleExportFolder','导出附件文件夹'],['moduleExportZip','导出 ZIP'],['excelExport','导出 Excel']])
 assert.ok(realArchiveCtx.__certAll.includes('data-action="'+action+'"')&&
 realArchiveCtx.__certAll.includes(label),'All original export formats must remain inside one menu');
assert.ok(realArchiveCtx.__certAll.indexOf('certificate-toolbar-title')<
 realArchiveCtx.__certAll.indexOf('certificate-toolbar-filter')&&
 realArchiveCtx.__certAll.indexOf('certificate-toolbar-filter')<
 realArchiveCtx.__certAll.indexOf('certificate-toolbar-actions')&&
 !realArchiveCtx.__certAll.includes('class="heading"')&&
 !realArchiveCtx.__certAll.includes('class="tabletools"')&&
 !realArchiveCtx.__certAll.includes('class="certificate-filterline"'),
 'Heading, search, create and export must share one condensed toolbar, without a second header row');
assert.ok(realArchiveCtx.__certStillAll.includes('高新技术企业证书')&&
 realArchiveCtx.__certStillAll.includes('质量管理体系认证'),
 'Hidden legacy category values must not filter company certificate records');
assert.ok(realArchiveCtx.__certKeyword.includes('高新技术企业证书')&&
 !realArchiveCtx.__certKeyword.includes('质量管理体系认证')&&
 realArchiveCtx.__certKeyword.includes('data-export-ids="51"')&&
 realArchiveCtx.__certRemark.includes('质量管理体系认证'),
 'Search by name and remarks must determine the certificate export subset');
assert.ok(realArchiveCtx.__certEmpty.includes('暂无符合条件的资料')&&
 !realArchiveCtx.__certEmpty.includes('企业资质</h3>')&&
 realArchiveCtx.__certEmpty.includes('data-export-ids=""'),
 'Empty enterprise certificate page must display a table empty state, not a fake card');
assert.ok(js.includes("ids=certificateExportIds();")&&
 js.includes("const checked=rows.filter(r=>certificateSelected.has(r.id))")&&
 js.includes("return (checked.length?checked:rows).map(r=>r.id)"),
 'Certificate Excel must export checked records first or all visible filtered records when unchecked');
assert.ok(js.includes("archiveGroup=simpleCertificate?null:workspace==='company'&&section==='achievement'?")&&
 js.includes("detail=simpleCertificate?null:{kind:'archive',id:recordId}"),
 'Saved enterprise certificates retain the direct list and company archives retain selected folders');
assert.ok(js.includes('data-nav="certificate">← 返回企业资质'),
 'Certificate detail must offer a direct list return');
assert.ok(html.includes('id="aAttachment" type="file"')&&
 html.includes('id="archiveAttachmentField" hidden')&&
 html.includes('id="archiveCategoryField"')&&html.includes('id="archiveTagsField"'),
 'Company certificate form needs one optional file input; other archive fields remain for legacy records');
assert.ok(js.includes("el('archiveCategoryField').hidden=simpleCertificate")&&
 js.includes("el('archiveTagsField').hidden=simpleCertificate")&&
 js.includes("el('archiveAttachmentField').hidden=!simpleCertificate")&&
 js.includes("const attachment=simpleCertificate?el('aAttachment').files?.[0]:null"),
 'Only company certificate hides category/tags and offers optional file input');
assert.ok(js.includes("await uploadBusinessAttachment(attachment,")&&
 js.includes("kind:'archive',ownerId:recordId,section:'certificate'")&&
 js.includes("attachmentError?'资料已保存，但附件上传失败：'"),
 'Saved certificate must upload its optional attachment and report upload failure without losing record');
assert.ok(js.includes("detail=simpleCertificate?null:{kind:'archive',id:recordId}")&&
 js.includes("if(target.dataset.certificateDownload)")&&
 js.includes("await downloadBusinessAttachment(Number(target.dataset.certificateDownload))"),
 'Company certificate save must return to list and download directly from existing authorized endpoint');

assert.ok(css.includes('.certificate-ledger .data .certificate-check{width:44px;')&&
 css.includes('.certificate-ledger .data .certificate-sequence{width:60px;')&&
 css.includes('.certificate-ledger .data .certificate-order{width:108px;')&&
 css.includes('.certificate-ledger .certificate-selected-count{'),
 'Checkbox, sequence and move controls should use compact table columns');
assert.ok(css.includes('.certificate-ledger .data th.certificate-size,.certificate-ledger .data td.certificate-size{width:124px;min-width:105px;white-space:nowrap'),
 'Size column should have a compact width and prevent unit wrapping');
assert.ok(css.includes('.certificate-ledger .certificate-toolbar{display:flex')&&
 css.includes('.certificate-ledger .certificate-toolbar-filter input{flex:1 1 300px;max-width:590px;min-width:160px')&&
 css.includes('.certificate-ledger .certificate-export-options{position:absolute')&&
 css.includes('@media(max-width:630px)'),
 'Compact toolbar must grow the search field, position export menu and wrap on narrow screens');
assert.ok(css.includes('.certificate-ledger .certificate-toolbar-title{display:flex;flex:0 0 170px;flex-direction:row;align-items:baseline;')&&
 css.includes('.certificate-ledger .certificate-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:24px;')&&
 css.includes('.certificate-ledger .certificate-toolbar-filter{display:flex;align-items:center;justify-content:flex-start;flex:1 1 840px;max-width:940px;min-width:0;margin-left:clamp(0px,calc(20vw - 280px),70px);')&&
 css.includes('.certificate-ledger .certificate-toolbar-actions{display:flex;align-items:center;gap:8px;margin-left:auto;padding-left:24px;border-left:1px solid var(--line);')&&
 css.includes('.certificate-ledger .certificate-toolbar-filter{order:3;flex:1 1 100%;max-width:none;margin-left:0;justify-content:flex-start;flex-wrap:wrap}'),
 'Company certificate toolbar must shift filters moderately right only on wide desktops, keeping actions separated and responsive wrapping intact');
assert.ok(js.includes("target.closest('.certificate-export-options')")&&
 js.includes("if(event.key==='Escape')el('content').querySelector('.certificate-export[open]')"),
 'Export menu must close on action selection and Escape');
assert.ok(js.includes("data-export-kind=\"archive\" data-export-section=\"certificate\""),
 'Certificate menu original exports must continue using the existing archive export APIs');
assert.ok(js.includes("data-excel-kind=\"archive\" data-excel-section=\"certificate\""),
 'Certificate Excel export must continue using the existing filtered XLSX API');

// B05 real business file links are scoped to stored records, not demo attachments.
assert.ok(html.includes('id="businessFileInput"'),'Business original file picker missing');
assert.ok(js.includes("api('/api/v2/ui/archive/'+space).then(r=>r.json())"),
 'Business attachment metadata must be loaded by workspace');
assert.ok(js.includes("businessFileRows=[...native.files,...native.general.flatMap"),
 'Native FolderId and FileId must replace all IP, project and contract legacy attachments');
for(const text of ["businessAttachmentList('project',p.id)","businessAttachmentList('ip',row.id)",
 "businessAttachmentList('contract',c.id)","businessAttachmentList('archive',record.id,page)"])
 assert.ok(js.includes(text),'Business detail is missing its actual attachment list: '+text);
for(const action of ['businessUpload','businessDownload','businessDelete'])
 assert.ok(js.includes(action),'Required business attachment operation missing: '+action);
assert.ok(js.includes("'/api/v2/ui/contracts/'+space+'/'+c.id+'/copy'"),
 'Native contract duplicate must preserve same-file references transactionally');
assert.ok(js.includes("businessFileCount('archive',r.id,k)"),
 'Archive detail ledger must show actual attachment counts');

// MCP UI is opt-in and scoped to a live unlocked database.
assert.ok(js.includes("case 'mcpToggle'")&&js.includes("api('/api/mcp'")&&
 js.includes("'开启 MCP'")&&js.includes("'关闭 MCP'"),
 'MCP settings toggle must be visible and use authenticated API');

// B06 UX: latest-version-only select all, record-level multiple selection and single-version labels.
for(const phrase of ["class=\"ledger-export-row\"","class=\"ledger-export-all\"",
 "case 'projectExportFolder'","case 'projectExportZip'",
 "case 'ipExportFolder'","case 'ipExportZip'","class=\"export-checkall\"",
 "data-export-latest=\"1\"","(showVersion?'v'+f.version",
 "case 'moduleExportZip'"])assert.ok(js.includes(phrase),'Missing direct export controls '+phrase);
// B06: the selected-original export remains within the current ledger/detail.
for(const needle of ["projectOriginals(ids)","ipOriginals(ids)",
 "quickExportButtons(visible,'contract')","quickExportButtons(rows,'general')",
 "quickExportButtons(rows,'archive',k)","case 'exportFolder'","case 'exportZip'",
 "section('所属合同',projectContracts(p.id))"])
 assert.ok(js.includes(needle),'Selected-original export wiring missing: '+needle);
assert.ok(js.includes("b06Script.src='/export.js'"),'The embedded ZIP/folder engine must load from localhost');

// When only one effective revision survives, never display its stored historical version number.
const fileListStart=js.indexOf('function businessAttachmentList(');
const fileListEnd=js.indexOf('function chooseVersionAction(',fileListStart);
assert.ok(fileListStart>0&&fileListEnd>fileListStart,'Missing business file renderer');
const fileListCtx=vm.createContext({sessionStorage:{getItem:()=>null},document:exportDocument});
vm.runInContext(preamble+
 
 '\nfunction exportCheck(){return "";}\nfunction exportButtons(){return "";}'+
 '\nfunction businessFiles(){return globalThis.filesForTest;}'+
 '\ncontractRows=[];'+js.slice(fileListStart,fileListEnd)+
 '\nglobalThis.filesForTest=[{id:2,name:"test.pdf",category:"申请材料",groupId:"group-A",version:2,size:123,sha256:"0123456789abcdef"}];'+
 '\nglobalThis.__onlyVersion=businessAttachmentList("ip",1);'+
 '\nglobalThis.filesForTest.push({id:1,name:"test.pdf",category:"申请材料",groupId:"group-A",version:1,size:120,sha256:"0123456789abcdef"});'+
 '\nglobalThis.__history=businessAttachmentList("ip",1);',fileListCtx);
assert.ok(!fileListCtx.__onlyVersion.includes('<small>v2'),'Single surviving revision must not show v2');
assert.ok(fileListCtx.__history.includes('<small>v2'),'Two effective revisions must show version history');

// Trash bulk purge becomes red only when records are selected; no selection is inert.
assert.ok(js.includes('data-action="trashPurgeSelected" disabled>永久删除</button>'),
 'Trash bulk purge must use the concise label and start disabled');
assert.ok(!js.includes('永久删除勾选'),'Outdated trash purge label must not remain');
assert.ok(css.includes('.btn.trash-purge-selected.is-active:not(:disabled){background:#bd3446;'),
 'Selected trash purge must use a red destructive style');
assert.ok(css.includes('.btn.trash-purge-selected.is-active:not(:disabled):hover{'),
 'Selected trash purge should have its own hover style');
assert.ok(js.includes("if(ev.target.id==='trashAll'||ev.target.matches('.trashcheck'))syncTrashPurgeSelection()"),
 'Both row selection and select-all must update the purge state');
// Exercise the actual selection helper with a small DOM-like fixture.
const trashFunctionStart=js.indexOf('function syncTrashPurgeSelection(){');
const trashFunctionEnd=js.indexOf('async function changeTrash(',trashFunctionStart);
assert.ok(trashFunctionStart>0&&trashFunctionEnd>trashFunctionStart,'Missing trash selection helper');
const trashChecks=[{checked:false},{checked:false}];
const trashHeader={checked:false,indeterminate:false};
const trashPurge={disabled:true,classes:new Set(),classList:{toggle(name,on){
 if(on)trashPurge.classes.add(name);else trashPurge.classes.delete(name);
}}};
const trashContent={
 querySelectorAll(selector){return selector==='.trashcheck'?trashChecks:[]},
 querySelector(selector){return selector==='#trashAll'?trashHeader:
  selector==='[data-action="trashPurgeSelected"]'?trashPurge:null}
};
const trashContext=vm.createContext({content:trashContent});
vm.runInContext('function el(){return content;}\n'+js.slice(trashFunctionStart,trashFunctionEnd),trashContext);
function verifyTrashSelection(){vm.runInContext('syncTrashPurgeSelection()',trashContext);}
verifyTrashSelection();
assert.equal(trashPurge.disabled,true,'No trash selection disables the irreversible action');
assert.equal(trashPurge.classes.has('is-active'),false,'Unselected purge must not turn red');
trashChecks[0].checked=true;verifyTrashSelection();
assert.equal(trashPurge.disabled,false,'Selecting one trash row enables purge');
assert.equal(trashPurge.classes.has('is-active'),true,'Selecting one trash row makes purge red');
assert.equal(trashHeader.indeterminate,true,'A partial selection should make the header indeterminate');
trashChecks[1].checked=true;verifyTrashSelection();
assert.equal(trashHeader.checked,true,'Selecting all trash rows should check the header');
assert.equal(trashHeader.indeterminate,false);
trashChecks.forEach(box=>box.checked=false);verifyTrashSelection();
assert.equal(trashPurge.disabled,true,'Clearing selection disables purge again');
assert.equal(trashPurge.classes.has('is-active'),false,'Clearing selection restores neutral styling');
assert.equal(trashHeader.checked,false);
// No page should reserve a separate row for paths like 公司资料 / 企业资质.
const headingSlice=js.slice(js.indexOf('function heading('),js.indexOf('function pill('));
const headingVM=vm.createContext({escapeHtml:value=>String(value)});
vm.runInContext(headingSlice+
 '\nglobalThis.plain=heading("知识产权","资料管理");'+
 '\nglobalThis.archive=heading("身份资质","分类台账","",'+
 '"<button data-archive-back=\\"cards\\">←</button>");',
 headingVM);
assert.ok(headingVM.plain.startsWith('<div class="heading">')&&
 !headingVM.plain.includes('breadcrumb')&&!headingVM.plain.includes('公司资料 /'),
 'Common page heading must not contain a separate breadcrumb row');
assert.ok(headingVM.archive.includes('<div class="heading-title-row">')&&
 headingVM.archive.includes('data-archive-back="cards"'),
 'Category heading must retain its return control alongside the title');
const certificateStart=js.indexOf('function realCompanyCertificateList(){');
const certificateEnd=js.indexOf('function realArchiveCards(',certificateStart);
assert.ok(certificateStart>=0&&certificateEnd>certificateStart&&
 !js.slice(certificateStart,certificateEnd).includes('certificate-breadcrumb')&&
 !js.slice(certificateStart,certificateEnd).includes('公司资料 / 企业资质'),
 'Company certificates must not output a separate path row');
assert.ok(!css.includes('.content>.breadcrumb{')&&!css.includes('.certificate-breadcrumb{'),
 'Unused breadcrumb-specific CSS must be removed');

// B05b: real trash and same-workspace attachment association.
assert.ok(html.includes('id="businessAssocDialog"'));
assert.ok(html.includes('id="businessAssocForm"'));
assert.ok(js.includes("api('/api/trash/'+space).then(r=>r.json())"));
assert.ok(js.includes("trashRows=trash"));
assert.ok(js.includes("data-trash-restore=")&&js.includes("data-trash-purge="));
assert.ok(js.includes("case 'trashRestoreSelected'")&&js.includes("case 'trashPurgeSelected'"));
assert.ok(js.includes("'/api/trash/'+space+'/'+operation"));
assert.ok(js.includes("api('/api/v2/files/'+space+'/'+file.fileId+'/associate'"),
 'Same-workspace association must use the native V2 atomic link copy/move route');
assert.ok(!js.includes("'/api/business-files/'"),
 'Current UI must never fall back to legacy business-file IDs');
assert.ok(!v2IpJs.includes('associateGeneric(api,'),
 'Retired prompt-based folder association must not be reachable');
assert.ok(js.includes("api('/api/v2/files/'+space+'/'+file.fileId+'/associate'") &&
 js.includes("targetFolderId:target.id,move") &&
 js.includes("linkId:file.linkId") &&
 js.includes("openBusinessAssoc(Number(target.dataset.businessAssociate))"),
 'Active attachment association must use native V2 FileId/LinkId/FolderId atomic copy/move dialog');
assert.ok(js.includes("kind:'general',id:x.id") &&
 js.includes("kind:'archive',id:x.id") &&
 js.includes("kind:'contract',id:x.id") &&
 js.includes("kind:'project',id:x.id"),
 'Native association must offer current-workspace project, contract, archive and general folders');
assert.ok(js.includes("function chooseVersionAction(file,matches)")&&
 js.includes('data-upload-choice="new"')&&js.includes("if(choice==='new')"),
 'Same-name originals must use explicit action buttons');
assert.ok(!js.includes("const choice=prompt("),'Same-name files must not require typing a choice');
assert.ok(v2IpJs.includes('"/prepare?folderId="+meta.ownerId')&&
 v2IpJs.includes('"/prepared/"+prepared.ticket+"/resolve')&&
 v2IpJs.includes('sourceFileId:matched.fileId'),
 'Business upload must prepare SHA-256, explicitly resolve duplicates and preserve FileId identity');
assert.ok(v2IpJs.includes('share-file')&&v2IpJs.includes('reuse-content')&&
 v2IpJs.includes('independent')&&v2IpJs.includes('cancel')&&
 js.includes('IPSysNativeIp.upload(api,file,meta,workspace)'),
 'Byte deduplication requires explicit share/reuse/independent/cancel choice');
assert.ok(html.includes('id="filePreviewDialog"')&&html.includes('id="filePreviewClose"'),
 'Original file preview must have an accessible closeable dialog');
assert.ok(js.includes('data-preview-business=')&&js.includes('data-preview-general=')&&
 js.includes("URL.revokeObjectURL(activePreviewUrl)"),
 'Both original-file stores must provide preview and release temporary blob URLs');
assert.ok(js.includes("await ensurePdfViewer()")&&
 js.includes("activePdfViewer=renderer.create(body,bytes)")&&
 js.includes("activePdfViewer.destroy()")&&
 !js.includes("view.src=previewUrl+'#view=FitH'"),
 'PDF preview must use the offline Canvas renderer instead of Chromium iframe');

assert.ok(js.includes('data-general-file-delete=')&&js.includes("case 'deleteRecord'"),
 'Legacy general records and originals must expose the trash actions');
assert.ok(js.includes("IPSysNativeIp.upload(api,file,{kind:'general',ownerId:id},workspace)")&&
 js.includes("IPSysNativeIp.newVersion(api,f,space)")&&
 v2IpJs.includes('"/versions"'),
 'General originals must use native FileId/version chain and explicit conflict resolver');
assert.ok(js.includes("el('businessFileInput').multiple=true")&&
 js.includes('id="uploadInput" multiple hidden')&&
 js.includes("uploadBusinessBatch(files,meta)")&&js.includes("uploadGeneralBatch(id,files)"),
 'Both upload paths must support multi-file selections');
assert.ok(js.includes("历史版本"),'Historical file revisions need a readable UI');
assert.ok(!js.includes("删除记录和附件的恢复、永久清理界面布局 · 仅演示"),
 'Trash must no longer appear as a mock page');
console.log('MAIN UI SMOKE PASS: navigation, workspace choice, live API contract, mock markers, CSP-compatible markup');
assert.ok(!js.includes("section('所属合同附件导出',projectContractExport(p.id))"),
 'Project detail must not ask for separate contract attachment choices');

// All Excel importers are moved to their corresponding new-record dialogs.
for(const prefix of ['project','ip','archive','general']){
 for(const suffix of ['ExcelImport','ExcelTemplate','ExcelChoose','ExcelFile'])
  assert.ok(html.includes('id="'+prefix+suffix+'"'),'Missing create Excel '+prefix+suffix);
}
assert.ok(!html.includes('id="contractExcelImport"'),'Contract XLSX export must remain read only');
assert.ok(!js.includes('function excelPanel(')&&!js.includes('function moduleExportPanel('),
 'Old Excel accordion and record-level file selector must not remain on ledgers');
for(const anchor of ["quickExportButtons(rows,'general')","quickExportButtons(visible,'contract')",
 "quickExportButtons(rows,'archive',k)","case 'moduleExportZip'","case 'excelExport'",
 "bindExcelCreate('project'","bindExcelCreate('ip'","bindExcelCreate('archive'","bindExcelCreate('general'"])
 assert.ok(js.includes(anchor),'Missing compact XLSX control '+anchor);
assert.ok(js.includes("chooseExcelDuplicatePolicy()")&&js.includes("showExcelImportReport(report)"),
 'Excel import duplicate policy and result report must remain');
assert.ok(js.includes("el('ipExcelImport').hidden=!!value")&&js.includes("el('archiveExcelImport').hidden=id!==null")&&
 js.includes("el('generalExcelImport').hidden=true")&&js.includes("el('generalExcelImport').hidden=false"),
 'Excel importer should be visible only on new-record mode');
assert.ok(js.includes("const checked=visible.filter(box=>box.checked)"),'Selected project/IP rows should take priority');
const quickCode=js.slice(js.indexOf('function excelExportButton('),js.indexOf('async function saveExcel('));
const quickVm=vm.createContext({escapeHtml:String});
vm.runInContext(quickCode+'\nglobalThis.renderActions=quickExportButtons;',quickVm);
const buttons=quickVm.renderActions([{id:2},{id:5}],'archive','academic');
assert.ok(buttons.indexOf('data-action="moduleExportZip"')<buttons.indexOf('data-action="excelExport"'),
 'Excel button must sit after ZIP');
assert.ok(buttons.includes('data-export-ids="2,5"')&&buttons.includes('data-excel-section="academic"'),
 'Module export must carry current records and section');
const modelCode=quickCode.slice(quickCode.indexOf('function moduleOriginals('));
const model=vm.createContext({});
vm.runInContext("let space='company';function businessFiles(kind,id,section){return globalThis.files.filter(x=>x.kind===kind&&x.ownerId===id&&x.section===section)};"+
 modelCode+"globalThis.files=[{id:6,kind:'archive',ownerId:9,name:'证书.pdf',size:45,section:'certificate'}];"+
 "globalThis.result=moduleOriginals([{id:9,name:'证书甲'}],'archive','certificate');",model);
assert.equal(model.result.length,1,'Archive export must retain section');
assert.equal(model.result[0].ownerName,'证书甲');
assert.equal(model.result[0].section,'certificate');
assert.ok(contractContext.__contracts.includes('excelExport'),'Contract XLSX export required');
assert.ok(realArchiveCtx.__realCards.includes('excelExport')&&realArchiveCtx.__realTable.includes('excelExport'),
 'Archive card and table XLSX export required');

// Updated workspace and batch Excel-entry requirements.
assert.ok(!html.includes('id="workspaceBtn"'),'Top-bar workspace switch should be removed');
for(const x of ['company','personal'])assert.ok(html.includes('data-workspace-switch="'+x+'"'),'Sidebar workspace button missing');
assert.ok(js.includes("button.onclick=()=>selectSpace(button.dataset.workspaceSwitch)"),'Sidebar workspace click must switch workspace');
assert.ok(js.includes("el('projectExcelImport').hidden=!!p"),'Excel import should be visible only when creating a project');
assert.ok(js.includes("await importExcel(kind,file,section)"),'Every modal Excel input must use existing XLSX API');
assert.ok(!projectCtx.__project.includes('真实记录')&&!ipCtx.__ip.includes('真实记录'),'Real ledger badge should disappear');


 // Shared table decoration covers project, IP, contracts and category-specific archive records.
for(const name of ['ledgerScope','ledgerSourceRows','sortLedgerData','decorateLedgerControls',
 'syncLedgerSelection','moveLedgerRecord'])
 assert.ok(js.includes('function '+name+'('),'Shared table helper missing '+name);
for(const token of ["api('/api/v2/ui/archive/'+space)","case 'ledgerBatchDelete':",
 "dataset.ledgerMove","del.dataset.action='ledgerBatchDelete'","'序号'","'排序'",
 ".ledger-record-row:checked","all.indeterminate=count>0&&count<total",
 "ledgerOrders[scope.kind+':'+scope.section]=ids"])
 assert.ok(js.includes(token),'Shared table operation missing '+token);
for(const rule of ['.data.ledger-record-table','.ledger-record-order-cell .btn',
 '.archive-tablewrap .data.ledger-record-table td:nth-child(2)',
 '.ledger-batch-delete[hidden]'])
 assert.ok(css.includes(rule),'Record table sizing / hidden delete missing '+rule);
// Category table toolbars follow enterprise certificates: title at left, growing search and separate right actions.
for(const rule of [
 '.archive-category-ledger>.compact-ledger-toolbar{display:flex;align-items:center;gap:24px}',
 '.archive-category-ledger .compact-ledger-title{flex:0 0 230px;max-width:230px;',
 '.archive-category-ledger .compact-ledger-filters{flex:1 1 auto;width:auto;max-width:none;',
 '.archive-category-ledger .compact-ledger-filters>.field.wide{flex:1 1 300px;max-width:590px;',
 '.archive-category-ledger .compact-ledger-actions{flex:0 0 auto;justify-self:auto;margin-left:auto;',
 '.archive-category-ledger .compact-ledger-filters{order:3;flex:1 1 100%;width:100%;'
])assert.ok(css.includes(rule),'Certificate-style category header layout missing: '+rule);
// Category archive column tracks match enterprise certificates, with one flexible name track.
for(const rule of [
 '.data.ledger-record-table.ledger-archive-category-table col.archive-col-check{width:42px}',
 '.data.ledger-record-table.ledger-archive-category-table col.archive-col-sequence{width:58px}',
 '.data.ledger-record-table.ledger-archive-category-table col.archive-col-name{width:auto}',
 '.data.ledger-record-table.ledger-archive-category-table col.archive-col-attachment{width:24%}',
 '.data.ledger-record-table.ledger-archive-category-table col.archive-col-size{width:110px}',
 '.data.ledger-record-table.ledger-archive-category-table col.archive-col-remarks{width:160px}',
 '.data.ledger-record-table.ledger-archive-category-table col.archive-col-order{width:100px}',
 '.data.ledger-record-table.ledger-archive-category-table col.archive-col-action{width:112px}'
])assert.ok(css.includes(rule),'Certificate-style category table column missing: '+rule);
assert.ok(js.includes('if(archiveSequence)head.lastElementChild.before(last);')&&
 js.includes('if(archiveSequence)tr.lastElementChild.before(td);'),
 'Category order controls must appear before the row action column');
// Project title takes all flexible width; short columns are fixed and the ordering actions stay visible.
for(const rule of [
 '.data.ledger-record-table.ledger-project-table th:nth-child(3){width:116px}',
 '.data.ledger-record-table.ledger-project-table th:nth-child(5){width:160px}',
 '.data.ledger-record-table.ledger-project-table th:nth-child(6){width:126px}',
 '.data.ledger-record-table.ledger-project-table th:nth-child(7){width:74px}',
 '.data.ledger-record-table.ledger-project-table{min-width:1050px}'
])assert.ok(css.includes(rule),'Project register compact column sizing missing: '+rule);
assert.ok(!css.includes('.data.ledger-record-table.ledger-project-table th:nth-child(4){width:'),
 'Project title must receive the remaining available width instead of a fixed narrow track');
// Narrow the sparse IP status, right-holder and attachment columns; give name a wider track.
for(const token of [
 '.data.ledger-record-table.ledger-ip-table th:nth-child(3){width:30%}',
 '.data.ledger-record-table.ledger-ip-table th:nth-child(6){width:92px}',
 '.data.ledger-record-table.ledger-ip-table th:nth-child(7){width:128px}',
 '.data.ledger-record-table.ledger-ip-table th:nth-child(9){width:76px}',
 '@media(max-width:1400px)', '.data.ledger-record-table.ledger-ip-table{min-width:1060px}'
])assert.ok(css.includes(token),'Missing IP ledger width allocation: '+token);
// All business ledgers should show their final controls without horizontal overflow on desktop.
assert.ok(css.includes('.data.ledger-record-table{width:100%;min-width:0;table-layout:fixed;white-space:normal}'),
 'Record tables should fill the desktop pane rather than reserve a rigid 850px width');
assert.ok(css.includes('.data.ledger-record-table td{padding:9px 8px;white-space:normal;overflow-wrap:anywhere'),
 'Business field cells must wrap rather than expand the table outside the viewport');
assert.ok(css.includes('.certificate-ledger .data{width:100%;min-width:0;table-layout:fixed}'),
 'Company certificate ledger should also fit the desktop pane');
assert.ok(css.includes('@media(max-width:900px)')&&css.includes('min-width:760px'),
 'On truly narrow windows keep a scrollable minimum for readable table columns');
// Check SQLCipher ordering metadata is applied across module arrays, not only to the DOM.
const helpers=js.slice(js.indexOf('function ledgerScope(){'),js.indexOf('function render(){'));
assert.ok(helpers.length>3000,'Generic ledger helper span was not found');
const orderVm=vm.createContext({});
vm.runInContext(
 "let space='personal',projectRows=[{id:1},{id:2},{id:3}],ipRows=[{id:4},{id:5}],"+
 "contractRows=[{id:6},{id:7}],archiveRows={certificate:[{id:8},{id:9}],academic:[],achievement:[]},"+
 "ledgerOrders={'project:':[3,1,2],'ip:':[5,4],'contract:':[7,6],'archive:certificate':[9,8]};"+
 helpers+"sortLedgerData();"+
 "globalThis.ids=[projectRows.map(x=>x.id),ipRows.map(x=>x.id),"+
 "contractRows.map(x=>x.id),archiveRows.certificate.map(x=>x.id)];",orderVm);
assert.deepEqual(JSON.parse(JSON.stringify(orderVm.ids)),[[1,2,3],[4,5],[6,7],[8,9]],
 'All project, IP, contract and archive lists now respect native V2 Folder.position');
// Other categories remain untouched by a different section's ordering.
assert.ok(js.includes("if(detail?.kind==='project')return {kind:'contract',section:''}")&&
 js.includes("if(archiveGroup&&archiveSections.includes(page)")&&
 js.includes("content.querySelector('[data-contract-id]')?.closest('table')"),
 'Project-owned contract ledger and category tables must be handled without affecting cards');

// Shared compact ledgers must preserve working filters and the original export action IDs.
 for(const source of ["function compactBusinessListToolbar(content)","compactBusinessListToolbar(content);",
   "'projectExportFolder','projectExportZip','ipExportFolder','ipExportZip'",
   "'moduleExportFolder','moduleExportZip','excelExport'",
   "if(event.key==='Escape')el('content').querySelectorAll('.compact-ledger-export[open]')"])
  assert.ok(js.includes(source),'Unified compact toolbar missing behavior: '+source);
 for(const source of ["compact-ledger-toolbar","compact-ledger-filters","compact-ledger-export-options",
   "compact-ledger .recordgrid","@media(max-width:1350px)"])
  assert.ok(css.includes(source),'Unified compact toolbar missing responsive style: '+source);
 for(const marker of ["function generalList(){","function ipList(){","function projectList(k){",
   "function contractList(){","function realArchiveCards(k){","function realArchiveTable(k,category){"])
  assert.ok(js.includes(marker),'Preserve the original ledger/card renderer: '+marker);
 // Exercise the DOM transformation itself without requiring a browser on the CI runner.
 class CompactNode{
  constructor(tag='div',name=''){this.tag=tag;this.name=name;this.children=[];this.parent=null;
   this.attrs={};this.dataset={};this.textContent='';this.removed=false;this.styles=new Set();}
  get firstChild(){return this.children[0]||null;}
  get className(){return [...this.styles].join(' ');}
  set className(v){this.styles=new Set(String(v).split(' ').filter(Boolean));}
  get classList(){return {contains:x=>this.styles.has(x),add:x=>this.styles.add(x)};}
  append(...nodes){for(const node of nodes){
   if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);
   this.children.push(node);node.parent=this;
  }}
  prepend(...nodes){for(const node of nodes.reverse()){
   if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);
   this.children.unshift(node);node.parent=this;
  }}
  before(node){if(!this.parent)throw Error('missing button parent');
   if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);
   const i=this.parent.children.indexOf(this);this.parent.children.splice(i,0,node);node.parent=this.parent;
  }
  remove(){this.removed=true;if(this.parent){
   this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;
  }}
  getAttribute(key){return this.attrs[key]||null;}
  setAttribute(key,value){this.attrs[key]=value;}
  querySelector(selector){return this.lookup?.[selector]||null;}
  querySelectorAll(selector){
   if(selector==='.field')return this.children.filter(n=>n.styles.has('field'));
   if(selector==='button[data-action]'){
    const output=[];const scan=n=>{if(n.tag==='button'&&n.dataset.action)output.push(n);
     for(const child of n.children)scan(child);};
    scan(this);return output;
   }
   return [];
  }
 }
 const compactHelper=js.slice(js.indexOf('function compactBusinessListToolbar('),
  js.indexOf('function heading(',js.indexOf('function compactBusinessListToolbar(')));
 const compactVM=vm.createContext({document:{createElement:tag=>new CompactNode(tag)}});
 vm.runInContext(compactHelper+'\nglobalThis.compact=compactBusinessListToolbar;',compactVM);
 function compactFixture(recordMode){
  const content=new CompactNode(),header=new CompactNode(),filter=new CompactNode(),
   card=new CompactNode(),tools=new CompactNode(),line=new CompactNode();
  card.className='white';filter.className='white filter';
  const title=new CompactNode('h1'),count=new CompactNode('b');
  const back=new CompactNode('button');
  if(recordMode==='folders')back.dataset.archiveFolderBack='1';
  else back.dataset.archiveBack='cards';
  title.textContent=recordMode==='cards'||recordMode==='folders'?'业务档案':'公司项目';
  count.textContent=recordMode==='cards'?'资料类别 7 类':'业务台账 3 条记录';
  const headActions=new CompactNode(),listActions=new CompactNode();
  const create=new CompactNode('button');create.dataset.action='projectAdd';
  headActions.append(create);
  const folder=new CompactNode('button');folder.dataset.action='moduleExportFolder';
  const zip=new CompactNode('button');zip.dataset.action='moduleExportZip';
  const xlsx=new CompactNode('button');xlsx.dataset.action='excelExport';
  listActions.append(folder,zip,xlsx);
  const field=new CompactNode();field.className='field';
  const label=new CompactNode('label');label.textContent='名称 / 编号';
  const input=new CompactNode('input');
  field.lookup={label,'input,select':input};line.append(field);
  const search=new CompactNode('button');search.dataset.action='filter';line.append(search);
  header.lookup={h1:title,'.actions':headActions,
   '[data-archive-back="cards"],[data-archive-folder-back]':
    (recordMode==='cards'||recordMode==='folders')?back:null};
  filter.lookup={'.filterline':line};filter.nextElementSibling=card;
  tools.lookup={b:count,'.actions':listActions};
  card.lookup={':scope > .tabletools':tools};
  const body=new CompactNode(recordMode==='cards'?'article':'table');body.name=recordMode;
  card.append(tools,body);
  content.append(header,filter,card);
  content.lookup={':scope > .heading':header,':scope > .white.filter':filter};
  compactVM.compact(content);
  assert.ok(card.classList.contains('compact-ledger'),'Unified toolbar must decorate real record/container');
  assert.equal(card.children[0].className,'compact-ledger-toolbar');
  assert.ok(card.children.includes(body),'Record table or category cards must remain in place');
  assert.ok(header.removed&&filter.removed&&tools.removed,'Redundant header/filter/tool rows must be removed');
  assert.equal(input.getAttribute('aria-label'),'名称 / 编号','Moved search must have accessible label');
  const [titleBox,filters,actions]=card.children[0].children;
  assert.ok(titleBox.children.some(x=>x.tag==='h1'),'Original page title must survive');
  if(recordMode==='cards'||recordMode==='folders')assert.ok(titleBox.children.includes(back)&&
   titleBox.children.indexOf(back)<titleBox.children.indexOf(title),
   'Category back arrow must stay to the left of its title after toolbar compaction');
  assert.ok(filters.children.includes(field)&&filters.children.includes(search),'Original filters/buttons must survive');
  assert.ok(actions.children.includes(create),'Original add-record command must survive');
  const exportMenu=actions.children.find(x=>x.tag==='details');
  assert.ok(exportMenu,'3 export buttons must become one dropdown menu');
  const optionButtons=exportMenu.children[1].children;
  assert.deepEqual(optionButtons.map(x=>x.dataset.action),
   ['moduleExportFolder','moduleExportZip','excelExport'],'Export actions must retain exact handlers and order');
 }
 compactFixture('table');
 compactFixture('cards');
 compactFixture('folders');

 // Shared ledger layout: both sides of the query group should receive equal free space,
 // with title and business actions anchored to their own grid tracks.
 assert.ok(css.includes('.compact-ledger>.compact-ledger-toolbar{display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;'),
  'Compact ledger should use three balanced grid tracks rather than pushing the query left');
 assert.ok(css.includes('.compact-ledger-filters{display:flex;align-items:center;justify-content:center;justify-self:center;')&&
  css.includes('width:100%;max-width:850px;flex-wrap:nowrap}'),
  'Query group must be horizontally centered within its available middle track');
 assert.ok(css.includes('.compact-ledger-actions{display:flex;align-items:center;justify-self:end;')&&
  css.includes('margin-left:0;padding-left:18px;border-left:1px solid var(--line);'),
  'Business actions remain right-aligned and visually separated without flex auto-margin');
 assert.ok(css.includes('.compact-ledger>.compact-ledger-toolbar{grid-template-columns:minmax(0,1fr) auto}')&&
  css.includes('.compact-ledger-filters{grid-column:1/-1;grid-row:2;justify-self:stretch;justify-content:flex-start;max-width:none;flex-wrap:wrap}'),
  'Narrow widths should show title/actions above a full-width query row');
 assert.ok(css.includes('.certificate-ledger .certificate-toolbar-filter{')&&
  !js.includes('compactBusinessListToolbar(content) && page===\'certificate\''),
  'The separately approved company certificate toolbar must not be changed by shared grid styling');
