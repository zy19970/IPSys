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
assert.ok(js.includes("archiveSections.includes(page)?realArchiveCards(page)"),'Archive sections must load actual SQLCipher category cards');
assert.ok(js.includes("archiveGroup&&archiveSections.includes(page)?realArchiveTable(page,archiveGroup)"),'Category rows must use SQLCipher');
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
assert.ok(js.includes("projectRows=projects;ipRows=ips;contractRows=contracts;"),'Projects, IP and contracts must refresh from the real database');
const projectCtx=vm.createContext({sessionStorage:{getItem:()=>null}});
const projector=js.slice(js.indexOf('function projectViewRows('),js.indexOf('function archiveCard(',js.indexOf('function projectViewRows(')));
vm.runInContext(preamble+
 '\nfunction heading(t){return t;}\nfunction infoRow(n,v){return n+v;}\nfunction section(n,v){return n+v;}\nfunction businessFileCount(){return 0;}\n'+projector+
 "\nspace='company';projectRows=[{id:12,name:'真实项目',projectType:'科研项目',projectNo:'X-1',startDate:'2026-01-02',projectStatus:'进行中',leader:'负责人甲'}];globalThis.__project=projectList('researchProject');",projectCtx);
assert.ok(projectCtx.__project.includes('data-project-id="12"'),'Real project ledger must open persisted IDs');
assert.ok(!projectCtx.__project.includes('负责人甲'),'Project leader must not appear in the ledger');
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
assert.ok(js.includes("ipRows=ips;contractRows=contracts;"),'IP and contracts must be loaded from real API');
const intellectualCode=js.slice(js.indexOf('const ipStatusByType='),js.indexOf('function projectViewRows(',js.indexOf('const ipStatusByType=')));
assert.ok(intellectualCode.length>0);
const ipCtx=vm.createContext({sessionStorage:{getItem:()=>null}});
vm.runInContext(preamble+
 '\nfunction heading(t){return t;}\nfunction infoRow(n,v){return n+v;}\nfunction section(n,v){return n+v;}\nfunction businessFileCount(){return 0;}\n'+intellectualCode+
 "\nspace='company';businessFileRows=[];ipRows=[{id:32,data:{name:'真实专利',ipType:'发明专利',applicationNo:'CN-42',status:'已申请',rightHolders:'权利人甲',applicationDate:'2026-02-01'}}];globalThis.__ip=ipList();globalThis.__types=Object.keys(ipStatusByType);",ipCtx);
assert.ok(ipCtx.__ip.includes('data-ip-id="32"'),'Real IP rows must link to stored IDs');
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
assert.ok(js.includes("id===null?'/api/projects/'+workspace+'/'+projectId+'/contracts'"),
 'New contracts must be created from their project ID');
const contractFrom=js.indexOf('const contractFieldLabels=');
const contractUntil=js.indexOf('function projectViewRows(',contractFrom);
assert.ok(contractFrom>=0&&contractUntil>contractFrom,'Contract renderers not found');
const contractContext=vm.createContext({sessionStorage:{getItem:()=>null}});
vm.runInContext(preamble+
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
for(const id of ['archiveDialog','archiveForm','aName','aCategory','aRemarks','aTags',
 'archiveTransferDialog','archiveTransferForm','archiveDestination'])
 assert.ok(html.includes('id="'+id+'"'),'Archive form or transfer control missing: '+id);
for(const action of ['archiveAdd','archiveEdit','archiveCopy','archiveMove','archiveDelete'])
 assert.ok(js.includes("case '"+action+"'"),'Missing real archive action '+action);
assert.ok(js.includes("archiveSections.map(section=>api('/api/archives/'+space+'/'+section)"),
 'Real archives must be fetched by current workspace and module');
assert.ok(js.includes('data-archive-id='),'Real archive records must open stored IDs');
assert.ok(js.includes("archiveRows[section]=archiveResults[i]"),'Archive records must be initialized from database');
const archiveFirst=js.indexOf('const archiveSections=['),archiveLast=js.indexOf('function mockCardList(k){',archiveFirst);
assert.ok(archiveFirst>=0&&archiveLast>archiveFirst,'Archive render functions missing');
const realArchiveCtx=vm.createContext({sessionStorage:{getItem:()=>null}});
vm.runInContext(preamble+'\n'+js.slice(archiveFirst,archiveLast)+
 "\nfunction heading(name,subtitle,actions){return '<h1>'+name+'</h1>'+(actions||'');}"+
 "\nfunction infoRow(k,v){return k+':'+v;}"+
 "\nfunction section(name,content){return name+content;}"+
 "\nfunction businessFileCount(){return 0;}"+
 "\nspace='personal';page='academic';filterName='';filterKind='全部类型';"+
 "archiveRows={certificate:[],achievement:[],academic:["+
 "{id:21,name:'第一次兼职',category:'学术兼职',remarks:'',tags:''},"+
 "{id:22,name:'第二次兼职',category:'学术兼职',remarks:'',tags:''},"+
 "{id:23,name:'会议报告',category:'会议报告',remarks:'',tags:''}"+
 "]};archiveGroup='学术兼职';"+
 "globalThis.__realCards=realArchiveCards('academic');"+
 "globalThis.__realTable=realArchiveTable('academic','学术兼职');"+
 "globalThis.__realOther=realArchiveTable('academic','会议报告');"+
 "globalThis.__realDetail=realArchiveDetail;"+
 "globalThis.__possibleTargets=archiveDestinations;",realArchiveCtx);
assert.ok(realArchiveCtx.__realCards.includes('data-archive-category="学术兼职"'),
 'Even with real data, the category cards must be separate from records');
assert.ok(!realArchiveCtx.__realCards.includes('<table'),'Archive top level cannot turn into a table');
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

// B05 real business file links are scoped to stored records, not demo attachments.
assert.ok(html.includes('id="businessFileInput"'),'Business original file picker missing');
assert.ok(js.includes("api('/api/business-files/'+space).then(r=>r.json())"),
 'Business attachment metadata must be loaded by workspace');
assert.ok(js.includes("businessFileRows=files"),'Real attachment rows must be bound from SQLCipher');
for(const text of ["businessAttachmentList('project',p.id)","businessAttachmentList('ip',row.id)",
 "businessAttachmentList('contract',c.id)","businessAttachmentList('archive',record.id,page)"])
 assert.ok(js.includes(text),'Business detail is missing its actual attachment list: '+text);
for(const action of ['businessUpload','businessDownload','businessDelete'])
 assert.ok(js.includes(action),'Required business attachment operation missing: '+action);
assert.ok(js.includes("'/api/contracts/'+space+'/'+c.id+'/copy'"),
 'Duplicating contracts must clone persisted file references with the contract');
assert.ok(js.includes("businessFileCount('archive',r.id,k)"),
 'Archive detail ledger must show actual attachment counts');

// B05b: real trash and same-workspace attachment association.
assert.ok(html.includes('id="businessAssocDialog"'));
assert.ok(html.includes('id="businessAssocForm"'));
assert.ok(js.includes("api('/api/trash/'+space).then(r=>r.json())"));
assert.ok(js.includes("trashRows=trash"));
assert.ok(js.includes("data-trash-restore=")&&js.includes("data-trash-purge="));
assert.ok(js.includes("case 'trashRestoreSelected'")&&js.includes("case 'trashPurgeSelected'"));
assert.ok(js.includes("'/api/trash/'+space+'/'+operation"));
assert.ok(js.includes("'/api/business-files/'+space+'/'+id+'/associate'"));
assert.ok(js.includes("openBusinessAssoc(Number(target.dataset.businessAssociate))"));
assert.ok(js.includes("const matches=[...new Map(")&&js.includes("const choice=prompt("),
 'Same-name originals must offer explicit new-file versus update choice');
assert.ok(js.includes("'X-Upload-Mode':meta.mode||'new'")&&js.includes("'X-File-Group':meta.groupId||''"),
 'Business upload must identify the selected original group');
assert.ok(js.includes("'X-Duplicate-Mode':meta.duplicateMode||'independent'")&&
 js.includes('id="businessReuseExisting"'),
 'Byte deduplication must require a visible user choice');
assert.ok(js.includes('data-general-file-delete=')&&js.includes("case 'deleteRecord'"),
 'Legacy general records and originals must expose the trash actions');
assert.ok(js.includes("'X-Upload-Mode':mode")&&js.includes("'X-File-Group':groupId"),
 'Legacy general files must also support explicit version updates');
assert.ok(js.includes("历史版本"),'Historical file revisions need a readable UI');
assert.ok(!js.includes("删除记录和附件的恢复、永久清理界面布局 · 仅演示"),
 'Trash must no longer appear as a mock page');
console.log('MAIN UI SMOKE PASS: navigation, workspace choice, live API contract, mock markers, CSP-compatible markup');