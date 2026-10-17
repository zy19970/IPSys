/* IPSys UI-first main entry: real SQLCipher general records + clearly marked design-only pages. */
"use strict";
// Export engine is another local embedded asset; no external wwwroot is required.
const b06Script=document.createElement('script');
b06Script.src='/export.js';document.head.appendChild(b06Script);
const el=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let activePreviewUrl=null;
let activePdfViewer=null,previewSerial=0,pdfScriptsPromise=null;
function loadPreviewScript(url){
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=url;
  script.onload=resolve;
  script.onerror=()=>reject(new Error('离线 PDF 组件加载失败：'+url));
  document.head.appendChild(script);
 });
}
async function ensurePdfViewer(){
 if(window.pdfjsLib&&window.IPSysPdfViewer)return window.IPSysPdfViewer;
 if(!pdfScriptsPromise){
  pdfScriptsPromise=(async()=>{
   await loadPreviewScript('/pdfjs/pdf.min.js');
   await loadPreviewScript('/pdf-preview.js');
   if(!window.pdfjsLib||!window.IPSysPdfViewer)
    throw new Error('离线 PDF 阅读器初始化失败。');
   return window.IPSysPdfViewer;
  })().catch(error=>{pdfScriptsPromise=null;throw error;});
 }
 return pdfScriptsPromise;
}

let globalHits=[],globalPending=false,globalError='',globalTruncated=false,globalQuery='',globalSerial=0;
let token=sessionStorage.getItem('ip-token')||'';
let dbName=sessionStorage.getItem('ip-db')||'';
let mcpEnabled=false;
let space=null,creating=false,resuming=false,localFileTaskActive=false;
let page='dashboard',detail=null,archiveGroup=null,archiveFolderId=null,archiveFolders=[],archiveFolderEditingId=null,archiveSelectedFolders=new Set(),archiveEntryOrders={},editingId=null,projectEditingId=null,projectRows=[],ipEditingId=null,ipRows=[],contractEditingId=null,contractProjectId=null,contractRows=[],businessFileRows=[],trashRows=[],pendingBusinessUpload=null,pendingAssocId=null,archiveRows={certificate:[],achievement:[],academic:[]},archiveEditingId=null,archiveTransferId=null,archiveTransferMode=null,liveRows=[],filterName='',filterKind='全部类型',filterState='全部状态',selected=new Set(),certificateSelected=new Set(),certificateDeleteBusy=false;
let ledgerOrders={},ledgerMutationBusy=false;
const companyNav=[['dashboard','工作台','▦'],['certificate','企业资质','▣'],['achievement','业务档案','▤'],['researchProject','公司项目','▤'],['ip','知识产权','◇'],['general','综合资料','▥']];
// Personal archives are grouped by evidence type, not by the company management menu.
const personalNav=[['dashboard','个人工作台','▦'],['certificate','身份与资质','▣'],['ip','知识产权与著作','◇'],['researchProject','科研与合作项目','▤'],['achievement','成果与奖励','★'],['academic','学术与社会活动','▥'],['general','其他资料','▧']];
const personalCategoryNotes={
  certificate:'身份证明、毕业及最高学历学位、职称证书、任职证明',
  ip:'专利、软件著作权、其他著作权与著作材料',
  researchProject:'科研项目、横向合作项目及所属合同',
  achievement:'技术成果证书与评价、各类奖励、标准制定、新产品及人才奖励',
  academic:'论文论著、学术兼职、会议报告、政府起草建议'
};
const mock={
  company:{
    ip:[
      {id:1,name:'一种矿山机器人作业位置自主调整方法',type:'发明专利',code:'CN202410123456.7',status:'实质审查',owner:'示例科技有限公司',date:'2024-03-18',files:4},
      {id:2,name:'液压支架协同控制装置',type:'实用新型',code:'CN202320234567.9',status:'已授权',owner:'示例科技有限公司',date:'2023-05-12',files:3},
      {id:3,name:'矿山智能运维管理软件 V1.0',type:'软件著作权',code:'2026SR0123456',status:'已登记',owner:'示例科技有限公司',date:'2026-02-10',files:2}
    ],
    researchProject:[
      {id:1,name:'矿山机器人研发项目',type:'科研项目',code:'XM-2026-001',status:'进行中',leader:'研发一组',date:'2026-01-10',files:8},
      {id:2,name:'深海探测装备技术研究',type:'科研项目',code:'XM-2026-002',status:'筹备中',leader:'研发二组',date:'2026-05-02',files:3}
    ],
    horizontalProject:[{id:3,name:'智能设备合作研发项目',type:'横向项目',code:'XM-2025-003',status:'已完成',leader:'研发三组',date:'2025-04-11',files:5}],
    contract:[
      {id:1,name:'矿山机器人关键部件采购合同',project:'矿山机器人研发项目',code:'HT-2026-001',date:'2026-04-12',amount:'128000.00',files:2},
      {id:2,name:'研发技术服务合同',project:'矿山机器人研发项目',code:'HT-2026-002',date:'2026-06-08',amount:'380000.00',files:3}
    ],
    certificate:[{id:1,name:'质量管理体系认证证书',type:'企业资质',files:2},{id:2,name:'高新技术企业证书',type:'企业资质',files:1}]
  },
  personal:{
    ip:[
      {id:1,name:'一种轻量化传感器安装方法',type:'发明专利',code:'CN202510112233.4',status:'申请中',owner:'个人示例',date:'2025-03-16',files:2},
      {id:2,name:'个人技术资料整理工具 V1.0',type:'软件著作权',code:'2026SR0033445',status:'已登记',owner:'个人示例',date:'2026-04-02',files:1},
      {id:3,name:'个人著作权登记材料（示例）',type:'其他著作权',code:'',status:'已登记',owner:'个人示例',date:'',files:1}
    ],
    researchProject:[{id:1,name:'个人专业技术研究课题',type:'科研项目',code:'GR-2026-001',status:'进行中',leader:'个人示例',date:'2026-02-15',files:2}],
    horizontalProject:[{id:2,name:'合作技术咨询项目',type:'横向项目',code:'GR-2025-002',status:'已完成',leader:'个人示例',date:'2025-08-03',files:1}],
    contract:[{id:1,name:'个人技术咨询合同',project:'合作技术咨询项目',code:'GRHT-2025-01',date:'2025-09-12',amount:'12000.00',files:1}],
    certificate:[
      {id:1,name:'身份证明材料（示例）',type:'身份证明',files:1},
      {id:2,name:'毕业证及最高学历学位证书（示例）',type:'学历学位',files:3},
      {id:3,name:'专业技术职务证书（示例）',type:'职称资格',files:2},
      {id:4,name:'任职与职务证明（示例）',type:'任职证明',files:1}
    ],
    achievement:[
      {id:1,name:'技术成果证书与评价材料（示例）',type:'技术成果',files:3},
      {id:2,name:'技术成果鉴定（评价）证明（示例）',type:'成果评价',files:1},
      {id:3,name:'工程技术项目获奖证明（示例）',type:'项目奖励',files:2},
      {id:4,name:'个人其他奖项证明（示例）',type:'个人奖励',files:1},
      {id:5,name:'人才奖励证明（示例）',type:'人才奖励',files:1},
      {id:6,name:'参与标准制定证明（示例）',type:'标准制定',files:2},
      {id:7,name:'新产品相关证明（示例）',type:'新产品',files:1}
    ],
    academic:[
      {id:1,name:'论文与论著首页（封面）材料（示例）',type:'论文论著',files:4},
      {id:2,name:'学术兼职证明（示例）',type:'学术兼职',files:1},
      {id:3,name:'会议报告材料（示例）',type:'会议报告',files:2},
      {id:4,name:'政府起草建议相关材料（示例）',type:'政策建议',files:1},
      {id:5,name:'专业学会理事任职证明（示例）',type:'学术兼职',files:2},
      {id:6,name:'学术委员会委员聘任材料（示例）',type:'学术兼职',files:1},
      {id:7,name:'学术交流报告证明（示例）',type:'会议报告',files:1},
      {id:8,name:'行业政策起草参与证明（示例）',type:'政策建议',files:2}
    ]
  }
};

/* Shared, offline-only 24px outline SVG set for workbenches and side navigation. */
const iconArt={
 grid:'<rect x="3.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"/>',
 certificate:'<rect x="5" y="2" width="14" height="17" rx="2"/><path d="M8.5 6.5h7M8.5 10h5"/><circle cx="12" cy="17" r="3"/><path d="m10 19.2-1.2 3 3.2-1.4 3.2 1.4-1.2-3"/>',
 folder:'<path d="M3 8V5.8A2 2 0 0 1 5 3.8h5l2 2h7a2 2 0 0 1 2 2v2"/><path d="M4.5 10h15.7a1.5 1.5 0 0 1 1.4 2l-2.5 7a2 2 0 0 1-1.9 1.3H3.7a2 2 0 0 1-1.9-2.6l2-6.5A1.8 1.8 0 0 1 4.5 10Z"/>',
 briefcase:'<rect x="2.5" y="7" width="19" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M2.5 12.5c5.5 3.1 13.5 3.1 19 0M10 14.1v2.2h4v-2.2"/>',
 shield:'<path d="M12 2.5 19 6v6c0 4.6-3 7.6-7 9.5-4-1.9-7-4.9-7-9.5V6l7-3.5Z"/><path d="M10 11a2 2 0 1 1 4 0c0 1-.6 1.5-1.2 2.1V15h-1.6v-1.9C10.6 12.5 10 12 10 11Z"/><path d="M11.2 17h1.6"/>',
 library:'<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="9.5" y="3" width="5" height="18" rx="1"/><path d="m17 4 4 1 0 16-4-1V4ZM5 7v10M12 7v10"/>',
 person:'<circle cx="12" cy="7.5" r="3.4"/><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2"/>',
 company:'<path d="M4 21V6l8-3 8 3v15M2.5 21h19M9 21v-5h6v5M8 9h1M15 9h1M8 12.5h1M15 12.5h1"/>',
 identity:'<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><circle cx="8.5" cy="10" r="2.2"/><path d="M5 16a3.5 3.5 0 0 1 7 0M15 9h4M15 12h4M15 15h3"/>',
 trophy:'<path d="M7 3h10v8a5 5 0 0 1-10 0V3ZM7 5H4v3a4 4 0 0 0 4 4M17 5h3v3a4 4 0 0 1-4 4M12 16v4M8 21h8"/>',
 book:'<path d="M12 6c-2.4-1.7-5.3-2.2-9-1.5v14c3.7-.7 6.6-.2 9 1.5 2.4-1.7 5.3-2.2 9-1.5v-14c-3.7-.7-6.6-.2-9 1.5ZM12 6v14"/>',
 trash:'<path d="M3.5 6h17M9 6V4h6v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
 settings:'<path d="M9.7 3.2h4.6l.6 2.1 1.7 1 2.1-.5 2.3 4-.5 1.5v1.9l.5 1.5-2.3 4-2.1-.5-1.7 1-.6 2.1H9.7l-.6-2.1-1.7-1-2.1.5-2.3-4 .5-1.5v-1.9L3 9.8l2.3-4 2.1.5 1.7-1 .6-2.1Z"/><circle cx="12" cy="12" r="3"/>'
};
const moduleIconNames={
 company:{dashboard:'grid',certificate:'certificate',achievement:'folder',researchProject:'briefcase',ip:'shield',general:'library'},
 personal:{dashboard:'grid',certificate:'identity',achievement:'trophy',academic:'book',researchProject:'briefcase',ip:'shield',general:'library'}
};
function uiIcon(key,workspace=space){
 const iconName=key==='personal'?'person':key==='company'?'company':
  key==='trash'||key==='settings'?key:(moduleIconNames[workspace]||moduleIconNames.company)[key];
 return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">'+(iconArt[iconName]||iconArt.grid)+'</svg>';
}
function mountStaticIcons(){
 document.querySelectorAll('[data-ui-icon]').forEach(holder=>{
  holder.innerHTML=uiIcon(holder.dataset.uiIcon);
 });
}
const labels=()=>space==='personal'?personalNav:companyNav;
const title=k=>(labels().find(x=>x[0]===k)||[])[1]||({search:'统一搜索',trash:'回收站',settings:'系统设置'}[k]||'记录详情');
const sample=k=>{
  if(space==='personal'&&k==='researchProject')
    return [...mock.personal.researchProject,...mock.personal.horizontalProject];
  return (mock[space]&&mock[space][k])||[];
};
const isProject=k=>k==='researchProject'||k==='horizontalProject';
const MAX_ORIGINAL_BYTES=8*1024*1024*1024;
const fmtSize=n=>n>=1024*1024*1024?(n/1024/1024/1024).toFixed(2)+' GiB':
 n>=1024*1024?(n/1024/1024).toFixed(1)+' MiB':(n/1024).toFixed(1)+' KiB';
window.addEventListener('beforeunload',ev=>{if(localFileTaskActive){ev.preventDefault();ev.returnValue='';}});
function notice(message,bad=false){const e=el('toast');e.textContent=message;e.className=bad?'visible bad':'visible';clearTimeout(notice.timer);notice.timer=setTimeout(()=>e.className='',4300);}
async function api(path,opts={}){
  const headers=new Headers(opts.headers||{});
  if(token)headers.set('X-IPSys-Token',token);
  if(opts.json!==undefined){headers.set('Content-Type','application/json');opts.body=JSON.stringify(opts.json);}
  const response=await fetch(path,{...opts,headers,cache:'no-store'});
  if(!response.ok){let message='请求失败：'+response.status;try{message=(await response.json()).error||message;}catch{}
    if(response.status===401){token='';sessionStorage.clear();screen(false);}
    throw new Error(message);}
  return response;
}
function screen(unlocked){
  el('locked').hidden=unlocked;
  el('chooseWorkspace').hidden=!unlocked||!!space;
  el('unlocked').hidden=!unlocked||!space;
  if(unlocked){el('dbNameChoice').textContent=dbName;if(space){el('sidebarDbName').textContent=dbName;refresh();}}
}
function mode(value){
  creating=value;
  el('newMode').hidden=value;
  el('oldMode').hidden=!value;
  el('confirmWrap').hidden=!value;
  el('dbPathHint').textContent=value?'首次创建前请确保目标文件夹已经存在。':'选择已存在的加密资料库文件。';
  el('submitOpen').textContent=value?'创建并进入':'解锁并进入';
}
function recoveryMode(active){
  resuming=active;el('dbPathWrap').hidden=active;el('resumeHint').hidden=!active;el('dbPath').required=!active;
  el('modeActions').hidden=active;
  el('newMode').disabled=active;el('oldMode').disabled=active;
  if(active){mode(false);el('submitOpen').textContent='验证密码并恢复会话';}
}
el('newMode').onclick=()=>mode(true);el('oldMode').onclick=()=>mode(false);
el('openForm').onsubmit=async event=>{
  event.preventDefault();const pass=el('password').value;
  if(creating&&pass!==el('confirm').value)return notice('两次输入的密码不一致',true);
  el('submitOpen').disabled=true;
  try{
    const endpoint=resuming?'/api/resume':'/api/open';
    const payload=resuming?{password:pass}:{path:el('dbPath').value,password:pass,create:creating};
    const result=await(await api(endpoint,{method:'POST',json:payload})).json();
    token=result.token;dbName=result.name;sessionStorage.setItem('ip-token',token);sessionStorage.setItem('ip-db',dbName);
    el('password').value='';el('confirm').value='';recoveryMode(false);
    space=null;page='dashboard';detail=null;screen(true);
    notice(result.resumed?'已验证密码，请选择工作区':'加密资料库已打开，请选择工作区');
  }catch(error){notice(error.message,true);}finally{el('submitOpen').disabled=false;}
};
function selectSpace(next){
  if(!token)return;
  globalSerial++;globalHits=[];globalQuery='';globalPending=false;globalError='';
  if(space===next)return;
  space=next;page='dashboard';detail=null;archiveGroup=null;archiveFolderId=null;archiveFolders=[];archiveSelectedFolders.clear();archiveEntryOrders={};ledgerOrders={};projectRows=[];ipRows=[];contractRows=[];businessFileRows=[];trashRows=[];archiveRows={certificate:[],achievement:[],academic:[]};filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();certificateSelected.clear();
  el('globalSearch').value='';el('sidebarDbName').textContent=dbName;
  el('chooseWorkspace').hidden=true;el('unlocked').hidden=false;
  refresh();
}
mountStaticIcons();
document.querySelectorAll('[data-workspace-choice]').forEach(b=>b.onclick=()=>selectSpace(b.dataset.workspaceChoice));
document.querySelectorAll('[data-workspace-switch]').forEach(button=>{
 button.onclick=()=>selectSpace(button.dataset.workspaceSwitch);
});
function setPage(next){if(space==='company'&&next==='horizontalProject')next='researchProject';globalSerial++;globalHits=[];globalQuery='';globalPending=false;globalError='';page=next;detail=null;archiveGroup=null;archiveFolderId=null;filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();archiveSelectedFolders.clear();certificateSelected.clear();el('globalSearch').value='';render();}
async function refresh(){
  if(!token||!space)return;
  const requestedSpace=space;
  try{const archiveSections=space==='personal'?['certificate','achievement','academic']:['certificate','achievement'];
  const [native,projects,ips,contracts,nativeProjectFiles,trash,mcpAccess]=await Promise.all([
   api('/api/v2/ui/archive/'+space).then(r=>r.json()),
   api('/api/v2/ui/projects/'+space).then(r=>r.json()),
   IPSysNativeIp.load(api,space),
   api('/api/v2/ui/contracts/'+space).then(r=>r.json()),
   IPSysNativeIp.loadProjectFiles(api,space),
   api('/api/trash/'+space).then(r=>r.json()),
   api('/api/mcp').then(r=>r.json())
  ]);
  if(requestedSpace!==space||!token)return;
  liveRows=native.general;projectRows=projects;ipRows=ips.rows;contractRows=contracts;
  businessFileRows=[...native.files,...native.general.flatMap(r=>r.files.map(f=>({
   ...f,kind:'general',ownerId:r.id,section:''
  }))),...ips.files,...nativeProjectFiles];
  trashRows=trash;archiveFolders=native.folders;archiveEntryOrders=native.orders||{};
  mcpEnabled=!!mcpAccess.enabled;ledgerOrders={};
  archiveRows={certificate:[],achievement:[],academic:[]};
  archiveSections.forEach(section=>archiveRows[section]=native.archives.filter(r=>r.section===section));
  sortLedgerData();render();
  }catch(error){notice(error.message,true);}
}
function refreshSidebar(){
  document.documentElement.dataset.workspace=space;
  document.querySelectorAll('[data-workspace-switch]').forEach(button=>{
   const active=button.dataset.workspaceSwitch===space;
   button.classList.toggle('active',active);
   button.setAttribute('aria-pressed',String(active));
  });
  const nav=el('sidebar');nav.replaceChildren();
  for(const [key,name] of labels()){
    const b=document.createElement('button');b.type='button';b.className='nav'+(page===key?' active':'');
    b.innerHTML='<span class="nav-symbol" aria-hidden="true">'+uiIcon(key)+'</span><span class="nav-text">'+escapeHtml(name)+'</span>';
    b.onclick=()=>setPage(key);nav.append(b);
  }
  const bottom=el('bottomnav');bottom.replaceChildren();
  for(const [key,name] of [['trash','回收站'],['settings','系统设置']]){
    const b=document.createElement('button');b.type='button';b.className='nav'+(page===key?' active':'');
    b.innerHTML='<span class="nav-symbol" aria-hidden="true">'+uiIcon(key)+'</span><span class="nav-text">'+escapeHtml(name)+'</span>';
    b.onclick=()=>setPage(key);bottom.append(b);
  }
}

/* Normalize list/category-card headers into the confirmed compact toolbar,
   retaining the original elements, data-actions, and archive navigation. */
function compactBusinessListToolbar(content){
 const pageHeading=content.querySelector(':scope > .heading');
 const filterPanel=content.querySelector(':scope > .white.filter');
 const ledger=filterPanel?.nextElementSibling;
 const ledgerTools=ledger?.querySelector(':scope > .tabletools');
 const filterLine=filterPanel?.querySelector('.filterline');
 const title=pageHeading?.querySelector('h1');
 if(!pageHeading||!filterPanel||!ledger?.classList.contains('white')||!ledgerTools||!filterLine||!title)return;
 const toolbar=document.createElement('div');toolbar.className='compact-ledger-toolbar';
 const titleGroup=document.createElement('div');titleGroup.className='compact-ledger-title';
 const back=pageHeading.querySelector('[data-archive-back="cards"],[data-archive-folder-back]');
 if(back)titleGroup.append(back);
 titleGroup.append(title);
 const count=ledgerTools.querySelector('b');
 if(count){
  const summary=document.createElement('span');summary.className='compact-ledger-count';
  summary.textContent=count.textContent.trim();titleGroup.append(summary);
 }
 toolbar.append(titleGroup);
 const filters=document.createElement('div');filters.className='compact-ledger-filters';
 for(const field of filterLine.querySelectorAll('.field')){
  const label=field.querySelector('label');
  const control=field.querySelector('input,select');
  if(label&&control&&!control.getAttribute('aria-label'))control.setAttribute('aria-label',label.textContent.trim());
 }
 while(filterLine.firstChild)filters.append(filterLine.firstChild);
 toolbar.append(filters);
 const actions=document.createElement('div');actions.className='compact-ledger-actions';
 for(const parent of [pageHeading.querySelector('.actions'),ledgerTools.querySelector('.actions')]){
  if(parent)while(parent.firstChild)actions.append(parent.firstChild);
 }
 const exportButtons=Array.from(actions.querySelectorAll('button[data-action]')).filter(button=>
  ['projectExportFolder','projectExportZip','ipExportFolder','ipExportZip',
   'moduleExportFolder','moduleExportZip','excelExport'].includes(button.dataset.action));
 if(exportButtons.length>=2){
  const menu=document.createElement('details');menu.className='compact-ledger-export';
  const trigger=document.createElement('summary');trigger.className='btn compact-ledger-export-trigger';
  trigger.textContent='导出 ▾';trigger.setAttribute('aria-label','选择导出方式');
  const choices=document.createElement('div');choices.className='compact-ledger-export-options';
  choices.setAttribute('role','group');choices.setAttribute('aria-label','导出方式');
  exportButtons[0].before(menu);
  for(const button of exportButtons)choices.append(button);
  menu.append(trigger,choices);
 }
 toolbar.append(actions);
 pageHeading.remove();filterPanel.remove();ledgerTools.remove();
 ledger.classList.add('compact-ledger');ledger.prepend(toolbar);
}

function heading(name,subtitle,actions='',breadcrumbBack=''){
 const nameHtml='<h1>'+escapeHtml(name)+'</h1>';
 const titleHtml=breadcrumbBack?'<div class="heading-title-row">'+breadcrumbBack+nameHtml+'</div>':nameHtml;
 return '<div class="heading"><div>'+titleHtml+'<div class="subtitle">'+subtitle+'</div></div><div class="actions">'+actions+'</div></div>';
}
function pill(text){return `<span class="pill">${escapeHtml(text)}</span>`;}
function stamp(){return '<span class="mockflag">界面示例 · 未接入业务</span>';}
function dashboard(){
 const modules=labels().filter(item=>item[0]!=='dashboard');
 const descriptions=space==='personal'
  ? {
    certificate:'身份证明、学历学位、职称及任职证明',
    ip:'专利、软件著作权及其他著作材料',
    researchProject:'科研项目、合作项目及所属合同',
    achievement:'技术成果、各类奖励与评价材料',
    academic:'论文论著、学术兼职及社会活动',
    general:'其他个人资料与原始附件'
   }
  : {
    certificate:'企业资质、证书及有关材料',
    achievement:'申报与认定、业务档案及证明材料',
    researchProject:'科研项目、横向项目及所属合同',
    ip:'专利、软件著作权及其他知识产权',
    general:'综合资料与其他业务文件'
   };
 return '<section class="dashboard-home">'+
  '<div class="dashboard-eyebrow">'+(space==='personal'?'个人资料':'公司资料')+'</div>'+
  '<h1>'+escapeHtml(title('dashboard'))+'</h1>'+
  '<p class="dashboard-description">选择资料类别，进入对应管理页面。</p>'+
  '<div class="choice-grid dashboard-choice-grid">'+modules.map(([key,name])=>
    '<button type="button" class="choice dashboard-choice" data-nav="'+key+'">'+
    '<span class="choice-symbol dashboard-choice-symbol" aria-hidden="true">'+uiIcon(key)+'</span>'+
    '<strong>'+escapeHtml(name)+'</strong>'+
    '<small>'+escapeHtml(descriptions[key]||'查看与管理资料')+'</small>'+
    '<span class="choice-arrow">进入管理 →</span></button>'
  ).join('')+'</div></section>';
}
function generalList(){
 const rows=liveRows.filter(r=>r.title.toLowerCase().includes(filterName.toLowerCase()));
 const subtitle=space==='personal'
  ? '尚未归入上述类别的个人资料，使用当前加密库的记录和附件。'
  : '综合资料使用当前加密库的记录和附件。';
 return heading(title('general'),subtitle,`<button class="btn primary" data-action="add">＋ 新建资料</button>`)+
 
 '<section class="white filter"><div class="filterline"><div class="field wide"><label>资料名称</label><input id="filterSearch" placeholder="搜索当前工作区资料"></div><button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><span><b>资料卡片</b> <small class="muted">'+rows.length+' 条记录</small></span><div class="actions"><button class="btn" data-action="check">检查数据库</button>'+quickExportButtons(rows,'general')+'</div></div>'+
 (rows.length?'<div class="recordgrid">'+rows.map(r=>archiveCard(r,{
  title:r.title,type:space==='company'?'综合资料':'其他资料',
  fileCount:new Set(r.files.map(f=>f.groupId||f.name)).size,real:true
 })).join('')+'</div>':'<div class="empty">没有符合条件的资料。可先创建记录，再上传附件。</div>')+
 '<div class="tablefoot">共 '+rows.length+' 条记录 · 数据来自当前加密资料库</div></section>';
}
function realDetail(){
 const r=liveRows.find(r=>r.id===detail.id);
 if(!r)return heading('记录详情','记录不存在或当前工作区无权访问')+'<button class="btn" data-nav="general">返回台账</button>';
 const groups=new Map();
 for(const f of r.files){const key=f.groupId||f.name;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}
 const fileLine=(f,showVersion,latest=false)=>'<div class="fileline"><span class="fileicon">'+escapeHtml(f.name.split('.').pop().slice(0,4).toUpperCase())+'</span>'+
 '<span class="filedesc"><strong>'+escapeHtml(f.name)+'</strong><small>'+(showVersion?'v'+f.version+' · ':'')+fmtSize(f.size)+
 ' · SHA-256 '+escapeHtml(f.sha256.slice(0,16))+'…</small></span>'+
 exportCheck(f,'general',latest)+
 '<button class="btn btn-sm" data-preview-general="'+f.id+'">预览</button>'+
 '<button class="btn btn-sm" data-download="'+f.id+'">下载原件</button>'+
 '<button class="btn btn-sm" data-general-file-delete="'+f.id+'">移除</button></div>';
 return heading(r.title,title('general')+' / 记录详情 · 当前加密库真实数据',
 '<button class="btn" data-nav="general">← 返回台账</button>'+
 '<button class="btn" data-action="editRecord">修改名称</button>'+
 '<button class="btn" data-action="generalCopy">复制</button>'+
 '<button class="btn" data-action="generalMove">转移</button>'+
 '<button class="btn" data-action="deleteRecord">删除资料</button>')+
 '<section class="white detailsection"><div class="detailsectionhead"><h2>基本信息</h2></div>'+
 '<div class="detailbody infogrid"><div class="info"><label>资料名称</label><strong>'+escapeHtml(r.title)+'</strong></div>'+
 '<div class="info"><label>所属工作区</label><strong>'+(space==='company'?'公司资料':'个人资料')+'</strong></div>'+
 '<div class="info"><label>已归档原件</label><strong>'+groups.size+' 份</strong></div></div></section>'+
 '<section class="white detailsection"><div class="detailsectionhead"><h2>附件资料</h2>'+
 '<button class="btn primary" data-action="upload">＋ 上传原件</button></div><div class="detailbody">'+
 '<input type="file" id="uploadInput" multiple hidden><p class="hint">支持更新指定同名原件或单独归档新原件，保留可展开的历史版本。单文件上限 8 GiB。</p>'+
 ([...groups.values()].map(g=>{g.sort((a,b)=>b.version-a.version||b.id-a.id);
 return '<div class="business-file-group">'+fileLine(g[0],g.length>1,true)+
  '<button class="btn btn-sm" data-v2-ip-version="'+g[0].id+'">上传新版本</button>'+
  '<button class="btn btn-sm" data-business-associate="'+g[0].id+'">共享到其它资料</button>'+
 (g.length>1?'<details><summary>查看历史版本（'+(g.length-1)+'）</summary>'+
 g.slice(1).map(f=>fileLine(f,true)).join('')+'</details>':'')+'</div>';}).join('')||
 '<div class="empty">暂无附件，点击“上传原件”开始归档。</div>')+
 (r.files.length?exportButtons():'')+'</div></section>'+
 '<section class="white detailsection"><div class="detailsectionhead"><h2>关联资料</h2>'+stamp()+
 '</div><div class="empty">跨业务记录关联将在后续统一实现</div></section>';
}
function columns(k){
 if(k==='ip')return [['name','名称'],['type','知识产权类型'],['code','申请/登记号'],['status','状态'],['owner','当前权利人'],['date','申请/登记日期'],['files','附件']];
 if(isProject(k))return [['name','项目名称'],['type','项目类型'],['code','项目编号'],['date','开始日期'],['files','附件']];
 if(k==='contract')return [['name','合同名称'],['project','所属项目'],['code','合同编号'],['date','签订日期'],['amount','合同金额（元）'],['files','附件']];
 return [['name','名称'],['type','类别'],['files','附件']];
}


const ipStatusByType={
 '发明专利':['准备中','已申请','已公开','实质审查中','已授权','已失效'],
 '实用新型专利':['准备中','已申请','已授权','已失效'],
 '外观设计专利':['准备中','已申请','已授权','已失效'],
 '软件著作权':['准备中','登记中','已登记'],
 '其他著作权':['准备中','登记中','已登记'],
 '商标':['准备中','申请中','已注册','已失效'],
 '集成电路布图设计':['准备中','登记中','已登记']
};
const ipFieldLabels=[
 ['name','知识产权名称'],['ipType','知识产权类型'],['status','状态'],
 ['applicants','申请人'],['rightHolders','当前权利人'],['creators','发明人 / 作者'],
 ['applicationNo','申请号'],['applicationDate','申请日'],['publicationNo','公开号'],
 ['publicationDate','公开日'],['grantNoticeNo','授权公告号'],['grantNoticeDate','授权公告日'],
 ['publicationInfo','公开 / 授权公告信息'],['grantDate','授权日'],['registrationNo','登记 / 注册号'],
 ['firstPublishedDate','首次发表日期'],['registrationDate','登记 / 注册日期'],
 ['category','辅助分类'],['tags','标签'],['remarks','备注']
];
function ipList(){
 const rows=ipRows.filter(r=>{
  const v=r.data;
  return [v.name,v.ipType,v.applicationNo,v.registrationNo,v.rightHolders].join(' ').toLowerCase().includes(filterName.toLowerCase()) &&
   (filterKind==='全部类型'||v.ipType===filterKind) &&
   (filterState==='全部状态'||v.status===filterState);
 });
 const allTypes=Object.keys(ipStatusByType);
 const allStates=[...new Set(Object.values(ipStatusByType).flat())];
 const options=(vals,active)=>vals.map(v=>'<option value="'+escapeHtml(v)+'" '+(active===v?'selected':'')+'>'+escapeHtml(v)+'</option>').join('');
 return heading(title('ip'),'知识产权业务台账 · 当前加密资料库',
  '<button class="btn primary" data-action="ipAdd">＋ 新建记录</button>')+
 
 '<section class="white filter"><div class="filterline">'+
 '<div class="field wide"><label>名称 / 编号</label><input id="filterSearch" placeholder="搜索知识产权"></div>'+
 '<div class="field"><label>类型</label><select id="filterKind">'+options(['全部类型',...allTypes],filterKind)+'</select></div>'+
 '<div class="field"><label>状态</label><select id="filterState">'+options(['全部状态',...allStates],filterState)+'</select></div>'+
 '<button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><b>业务台账 '+rows.length+' 条记录</b>'+
 '<div class="actions"><span id="ledgerExportCount">已选 0 条</span>'+
 '<button class="btn" data-action="ipExportFolder">导出附件文件夹</button><button class="btn primary" data-action="ipExportZip">导出附件 ZIP</button>'+excelExportButton('ip')+'</div></div>'+
 '<div class="tablewrap"><table class="data ledger-ip-table"><thead><tr><th><input type="checkbox" id="ledgerExportAll" class="ledger-export-all" aria-label="全选当前知识产权"></th><th>名称</th><th>知识产权类型</th><th>申请/登记号</th><th>状态</th><th>当前权利人</th><th>申请/登记日期</th><th>附件</th></tr></thead><tbody>'+
 (rows.length?rows.map(r=>{const v=r.data;return '<tr><td><input type="checkbox" class="ledger-export-row" value="'+r.id+'" aria-label="选择知识产权 '+escapeHtml(v.name)+'"></td>'+
 '<td><button class="link" data-ip-id="'+r.id+'">'+escapeHtml(v.name)+'</button></td>'+
 '<td>'+escapeHtml(v.ipType)+'</td>'+
 '<td>'+escapeHtml(v.applicationNo||v.registrationNo||'—')+'</td>'+
 '<td>'+escapeHtml(v.status||'—')+'</td>'+
 '<td>'+escapeHtml(v.rightHolders||'—')+'</td>'+
 '<td>'+escapeHtml(v.applicationDate||v.registrationDate||'—')+'</td>'+
 '<td>'+businessFileCount('ip',r.id)+'</td></tr>';}).join(''):'<tr><td colspan="8" class="empty">暂无知识产权记录，点击新建。</td></tr>')+
 '</tbody></table></div><div class="tablefoot">共 '+rows.length+' 条记录 · 数据保存在当前 SQLCipher 库</div></section>';
}
function ipDetail(){
 const row=ipRows.find(x=>x.id===detail?.id);
 if(!row)return heading('知识产权不存在','当前工作区无此记录')+'<button class="btn" data-nav="ip">返回台账</button>';
 const v=row.data;
 const fields=ipFieldLabels.map(([k,label])=>infoRow(label,v[k])).join('');
 return heading(v.name,'知识产权详情 · 当前资料库记录',
  '<button class="btn" data-nav="ip">← 返回台账</button>'+
  '<button class="btn" data-action="ipEdit">修改</button>'+
  '<button class="btn" data-action="ipCopy">复制记录</button>'+
  '<button class="btn" data-action="ipMove">转移工作区</button>'+
  '<button class="btn" data-action="ipDelete">删除</button>')+
 section('基本信息','<div class="infogrid">'+fields+'</div>')+
 section('知识产权附件',businessAttachmentList('ip',row.id));
}
function ipUpdateStatus(chosen=''){
 const type=el('ip-ipType').value;
 const status=el('ip-status');
 status.replaceChildren();
 const options=['',...(ipStatusByType[type]||[])];
 for(const val of options){
  const opt=document.createElement('option');opt.value=val;opt.textContent=val||'未选择';status.append(opt);
 }
 status.value=chosen&&options.includes(chosen)?chosen:'';
}
function showIpForm(id=null){
 ipEditingId=id;
 const value=id===null?null:ipRows.find(x=>x.id===id)?.data;
 const form=el('ipForm');form.reset();
 el('ipFormTitle').textContent=value?'修改知识产权':'新建知识产权';
 el('ipExcelImport').hidden=!!value;
 for(const [key] of ipFieldLabels)if(value)el('ip-'+key).value=value[key]||'';
 ipUpdateStatus(value?.status||'');
 el('ipDialog').showModal();
}
// Project-owned contracts. The aggregate view deliberately provides NO "new" action.
const contractFieldLabels=[
 ['name','合同名称'],['contractNo','合同编号'],['signDate','签订日期'],
 ['amount','合同金额（人民币元）'],['signingParties','签约主体'],
 ['category','辅助分类'],['tags','标签'],['remarks','备注']
];
function contractMoney(value){
 if(value===null||value===undefined||String(value).trim()==='')return '—';
 return Number(value).toFixed(2);
}
function contractList(){
 const visible=contractRows.filter(c=>
  [c.name,c.contractNo,c.projectName,c.signingParties].join(' ').toLowerCase().includes(filterName.toLowerCase()));
 return heading('全部合同','当前工作区合同汇总 · 合同只能从所属项目详情新增',
   space==='company'?'<button class="btn" data-nav="researchProject">← 返回公司项目</button>':'')+
 
 '<section class="white filter"><div class="filterline">'+
 '<div class="field wide"><label>名称 / 编号 / 所属项目</label><input id="filterSearch" placeholder="搜索合同或项目"></div>'+
 '<button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><b>合同台账 '+visible.length+' 条记录</b><div class="actions">'+quickExportButtons(visible,'contract')+'</div></div>'+
 '<div class="tablewrap"><table class="data"><thead><tr>'+
 '<th>合同名称</th><th>所属项目</th><th>合同编号</th><th>签订日期</th><th>合同金额（人民币元）</th>'+
 '</tr></thead><tbody>'+
 (visible.length?visible.map(c=>'<tr>'+
 '<td><button class="link" data-contract-id="'+c.id+'">'+escapeHtml(c.name)+'</button></td>'+
 '<td>'+escapeHtml(c.projectName)+'</td><td>'+escapeHtml(c.contractNo||'—')+'</td>'+
 '<td>'+escapeHtml(c.signDate||'—')+'</td><td>'+contractMoney(c.amount)+'</td></tr>').join(''):
 '<tr><td colspan="5" class="empty">暂无合同，请先进入所属项目详情新增。</td></tr>')+
 '</tbody></table></div><div class="tablefoot">共 '+visible.length+' 条合同 · 所属项目从加密库关联读取</div></section>';
}
function projectContracts(projectId){
 const subset=contractRows.filter(c=>c.projectId===projectId);
 return '<div class="tabletools"><b>所属合同 '+subset.length+' 份</b>'+
 '<button class="btn primary" data-action="contractAdd">＋ 新建合同</button></div>'+
 (subset.length?'<div class="tablewrap"><table class="data"><thead><tr><th>合同名称</th><th>合同编号</th><th>签订日期</th><th>金额（人民币元）</th></tr></thead><tbody>'+
 subset.map(c=>'<tr><td><button class="link" data-contract-id="'+c.id+'">'+escapeHtml(c.name)+'</button></td>'+
 '<td>'+escapeHtml(c.contractNo||'—')+'</td><td>'+escapeHtml(c.signDate||'—')+'</td>'+
 '<td>'+contractMoney(c.amount)+'</td></tr>').join('')+
 '</tbody></table></div>':
 '<p class="hint">尚无合同。合同必须由当前项目创建并自动关联。</p>');
}
function contractDetail(){
 const c=contractRows.find(c=>c.id===detail?.id);
 if(!c)return heading('合同不存在','当前工作区无此合同')+
 '<button class="btn" data-nav="contract">返回合同台账</button>';
 const returnToProject=detail?.returnProject&&projectRows.some(p=>p.id===detail.returnProject);
 const back=returnToProject?
 '<button class="btn" data-contract-back-project="'+detail.returnProject+'">← 返回所属项目</button>':
 '<button class="btn" data-nav="contract">← 返回合同台账</button>';
 return heading(c.name,'所属项目：'+escapeHtml(c.projectName)+' · SQLCipher 真实合同',back+
 '<button class="btn" data-action="contractEdit">修改</button>'+
 '<button class="btn" data-action="contractCopy">复制到本项目</button>'+
 '<button class="btn" data-action="contractDelete">删除</button>')+
 section('合同基本信息','<div class="infogrid">'+
 infoRow('所属项目',c.projectName)+
 contractFieldLabels.map(([field,label])=>infoRow(label,
   field==='amount'?(c.amount?contractMoney(c.amount):''):c[field])).join('')+
 '</div>')+
 section('合同附件',businessAttachmentList('contract',c.id));
}
function showContractForm(projectId,id=null){
 const parent=projectRows.find(p=>p.id===projectId);
 if(!parent){notice('请先从有效的项目详情打开合同表单。',true);return;}
 const record=id===null?null:contractRows.find(c=>c.id===id&&c.projectId===projectId);
 if(id!==null&&!record){notice('合同记录不存在或已不属于此项目。',true);return;}
 contractEditingId=id;contractProjectId=projectId;
 el('contractForm').reset();
 el('contractFormTitle').textContent=record?'修改合同':'新建项目合同';
 el('contractProjectHint').textContent='所属项目：'+parent.name+'（合同自动归属于该项目）';
 if(record){
  for(const [field] of contractFieldLabels)el('ct-'+field).value=record[field]??'';
 }
 el('contractDialog').showModal();
}
function projectViewRows(k){
 // Each workspace has one project ledger; projectType is its visible classification tag.
 return projectRows;
}
// Fixed M0 Excel ledgers are separate from the original-file export controls.
// Compact file and Excel exports for each live ledger.
function excelExportButton(kind,section=''){
 return '<button class="btn" data-action="excelExport" data-excel-kind="'+kind+
 '" data-excel-section="'+escapeHtml(section)+'">导出 Excel</button>';
}
function quickExportButtons(records,kind,section=''){
 const ids=records.map(r=>r.id).join(',');
 const attr=' data-export-kind="'+kind+'" data-export-section="'+escapeHtml(section)+'" data-export-ids="'+ids+'"';
 return '<button class="btn" data-action="moduleExportFolder"'+attr+'>导出附件文件夹</button>'+
 '<button class="btn primary" data-action="moduleExportZip"'+attr+'>导出 ZIP</button>'+
 excelExportButton(kind,section);
}
function moduleOriginals(records,kind,section=''){
 if(kind==='general')return records.flatMap(r=>r.files.map(f=>({
  source:'v2file',workspace:space,id:f.id,name:f.name,size:f.size,
   fileId:f.fileId,version:f.version,kind:'general',ownerId:r.id,ownerName:r.title
 })));
 return records.flatMap(r=>businessFiles(kind,r.id,section).map(f=>({
  source:'v2file',workspace:space,id:f.id,name:f.name,size:f.size,
  fileId:f.fileId,version:f.version,kind,ownerId:r.id,
  section:kind==='archive'?section:'',ownerName:r.name,
  ...(kind==='contract'?{projectId:r.projectId,projectName:r.projectName}:{})
 })));
}
async function saveExcel(response,name){
 const file=await response.blob();
 const url=URL.createObjectURL(file);
 const a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function chooseExcelDuplicatePolicy(){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='input-dialog';
  dialog.innerHTML='<h3>重复记录如何处理？</h3>'+
   '<p class="hint">系统会按项目编号、申请/登记号等识别疑似重复项。正确行继续导入，错误行单独报告。</p>'+
   '<div class="excel-choice">'+
   '<button class="btn" data-excel-policy="skip">跳过重复记录（推荐）</button>'+
   '<button class="btn" data-excel-policy="update">更新已有记录</button>'+
   '<button class="btn" data-excel-policy="create">将重复记录另建一条</button>'+
   '<button class="btn" data-excel-policy="cancel">取消导入</button></div>';
  document.body.append(dialog);
  let done=false;
  const finish=value=>{
   if(done)return;done=true;if(dialog.open)dialog.close();dialog.remove();resolve(value);
  };
  dialog.addEventListener('click',event=>{
   const value=event.target.closest('[data-excel-policy]')?.dataset.excelPolicy;
   if(value)finish(value==='cancel'?null:value);
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
  dialog.showModal();
 });
}
function showExcelImportReport(report){
 const details=report.errors||[];
 const dialog=document.createElement('dialog');dialog.className='input-dialog excel-report';
 dialog.innerHTML='<h3>Excel 导入结果</h3>'+
  '<p>新增 '+report.created+' 条，更新 '+report.updated+' 条，跳过 '+report.skipped+
  ' 条，失败 '+report.failed+' 条。</p>'+
  (report.omittedErrors?'<p class="hint">另有 '+report.omittedErrors+' 行错误未展开显示，请先修正已列出的错误再导入。</p>':'')+
  (details.length?'<div class="excel-errors">'+details.map(e=>
   '<p>第 '+Number(e.row)+' 行：'+escapeHtml(e.error)+'</p>').join('')+'</div>':'')+
  '<div class="dialogactions"><button class="btn primary" data-excel-close="1">关闭</button></div>';
 document.body.append(dialog);
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-excel-close]'))dialog.close();});
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.showModal();
}
async function exportExcel(kind,scope,section=''){
 const workspace=space;
 const query=kind==='archive'?'?section='+encodeURIComponent(section):'';
 const path='/api/v2/excel/'+workspace+'/'+kind;
 let ids=null;
 if(scope==='filtered'){
  if(kind==='project'||kind==='ip'){
   const visible=[...el('content').querySelectorAll('.ledger-export-row')];
   const checked=visible.filter(box=>box.checked);
   ids=(checked.length?checked:visible).map(box=>Number(box.value));
  }
  else if(kind==='general')
   ids=liveRows.filter(r=>r.title.toLowerCase().includes(filterName.toLowerCase())).map(r=>r.id);
  else if(kind==='contract')
   ids=contractRows.filter(c=>[c.name,c.contractNo,c.projectName,c.signingParties]
    .join(' ').toLowerCase().includes(filterName.toLowerCase())).map(c=>c.id);
  else if(kind==='archive'&&space==='company'&&section==='certificate')
   ids=certificateExportIds();
  else if(kind==='archive')
   ids=(archiveRows[section]||[]).filter(r=>{
    const category=r.category||'未分类';
    if(space==='company'&&section==='achievement')
     return (r.folderId??0)===(archiveFolderId??0)&&
      [r.name,r.remarks,r.tags].join(' ').toLowerCase().includes(filterName.toLowerCase());
    return archiveGroup?category===archiveGroup&&
     [r.name,r.remarks,r.tags].join(' ').toLowerCase().includes(filterName.toLowerCase()):
     (filterKind==='全部类型'||category===filterKind)&&
      category.toLowerCase().includes(filterName.toLowerCase());
   }).map(r=>r.id);
 }
 const response=await api(path+'/export'+query,{method:'POST',json:{mode:scope,ids}});
 await saveExcel(response,kind+'-'+workspace+(section?'-'+section:'')+'-'+
  (scope==='filtered'?'filtered':'all')+'.xlsx');
}
async function importExcel(kind,file,section=''){
 if(kind==='contract')return notice('合同不允许 Excel 导入，请从所属项目创建合同。',true);
 if(!file||file.size>8*1024*1024)return notice('请使用小于 8 MiB 的固定 XLSX 模板。',true);
 const workspace=space;
 const policy=await chooseExcelDuplicatePolicy();
 if(!policy)return;
 try{
  const query='?policy='+policy+(kind==='archive'?'&section='+encodeURIComponent(section):'');
  const endpoint='/api/v2/excel/'+workspace+'/'+kind;
   const response=await api(endpoint+'/import'+query,{
   method:'POST',headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
   body:file});
  const report=await response.json();
  if(workspace===space)await refresh();
  showExcelImportReport(report);
 }catch(error){notice('Excel 导入失败：'+error.message,true);}
}

function projectList(k){
 const rows=projectViewRows(k), visible=rows.filter(p=>
  [p.name,p.projectNo,p.leader,p.undertakingOrg].join(' ').toLowerCase().includes(filterName.toLowerCase()) &&
  (filterKind==='全部类型'||p.projectType===filterKind) &&
  (filterState==='全部状态'||p.projectStatus===filterState));
 const types=['全部类型','科研项目','横向项目','其他项目'];
 const statuses=['全部状态','筹备中','进行中','已完成','已终止'];
 return heading(title(k),'科研、横向及其他项目统一归档 · 通过项目类型筛选',
  (space==='company'?'<button class="btn" data-nav="contract">查看全部合同</button>':'')+
  '<button class="btn primary" data-action="projectAdd">＋ 新建项目</button>')+
 '<section class="white filter"><div class="filterline">'+
 '<div class="field wide"><label>名称 / 编号</label><input id="filterSearch" placeholder="输入关键词筛选项目"></div>'+
 '<div class="field"><label>项目类型</label><select id="filterKind">'+types.map(t=>'<option value="'+t+'" '+(filterKind===t?'selected':'')+'>'+t+'</option>').join('')+'</select></div>'+
 '<div class="field"><label>状态</label><select id="filterState">'+statuses.map(t=>'<option value="'+t+'" '+(filterState===t?'selected':'')+'>'+t+'</option>').join('')+'</select></div>'+
 '<button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><b>业务台账 '+visible.length+' 条记录</b>'+
 '<div class="actions"><span id="ledgerExportCount">已选 0 条</span>'+
 '<button class="btn" data-action="projectExportFolder">导出附件文件夹</button>'+
 '<button class="btn primary" data-action="projectExportZip">导出附件 ZIP</button>'+excelExportButton('project')+'</div></div>'+
 '<div class="tablewrap"><table class="data ledger-project-table"><thead><tr><th><input type="checkbox" id="ledgerExportAll" class="ledger-export-all" aria-label="全选当前项目"></th><th>项目类型</th><th>项目名称</th><th>项目编号</th><th>开始日期</th><th>附件</th></tr></thead><tbody>'+
 (visible.length?visible.map(p=>'<tr><td><input type="checkbox" class="ledger-export-row" value="'+p.id+'" aria-label="选择项目 '+escapeHtml(p.name)+'"></td>'+
 '<td>'+pill(p.projectType)+'</td>'+
 '<td><button class="link" data-project-id="'+p.id+'">'+escapeHtml(p.name)+'</button></td><td>'+escapeHtml(p.projectNo||'—')+'</td>'+
 '<td>'+escapeHtml(p.startDate||'—')+'</td>'+
 '<td>'+businessFileCount('project',p.id)+'</td></tr>').join(''):
 '<tr><td colspan="6" class="empty">暂无项目，点击右上角新建项目。</td></tr>')+
 '</tbody></table></div><div class="tablefoot">共 '+visible.length+' 条记录 · 数据保存在当前 SQLCipher 库</div></section>';
}

function businessFiles(kind,ownerId,section=''){
 return businessFileRows.filter(f=>f.kind===kind&&f.ownerId===ownerId&&
  (kind!=='archive'||f.section===section));
}
function exportCheck(file,source='v2file',latest=false){
 return '<label class="export-check"><input type="checkbox" class="export-filecheck"'+
  ' data-export-source="'+source+'" data-export-id="'+file.id+'"'+
  (latest?' data-export-latest="1"':'')+'> 导出此版</label>';
}
function exportButtons(){
 return '<div class="export-tools"><span>只导出手动勾选的原件（含可单独勾选的历史版本）</span>'+
 '<div class="actions"><label class="export-check"><input type="checkbox" class="export-checkall"> 全选附件</label>'+ 
 '<button class="btn" data-action="exportFolder">导出至文件夹</button>'+
 '<button class="btn primary" data-action="exportZip">导出 ZIP</button></div></div>';
}
function selectedOriginals(){
 const items=[];
 for(const checkbox of document.querySelectorAll('.export-filecheck:checked')){
  const id=Number(checkbox.dataset.exportId),source=checkbox.dataset.exportSource;
  if(source==='general'){
   const found=liveRows.flatMap(r=>r.files.map(f=>({record:r,file:f}))).find(x=>x.file.id===id);
   if(found)items.push({source:'v2file',workspace:space,id,name:found.file.name,
    fileId:found.file.fileId,version:found.file.version,kind:'general',
    size:found.file.size,ownerId:found.record.id,ownerName:found.record.title});
   continue;
  }
  const f=businessFileRows.find(x=>x.id===id);
  if(!f)continue;
  const parent=f.kind==='contract'?contractRows.find(x=>x.id===f.ownerId):null;
  const ownerName=f.kind==='project'?projectRows.find(x=>x.id===f.ownerId)?.name:
   f.kind==='ip'?ipRows.find(x=>x.id===f.ownerId)?.data.name:
   f.kind==='contract'?parent?.name:
   archiveRows[f.section]?.find(x=>x.id===f.ownerId)?.name;
  if(!ownerName)continue;
  items.push({source:f.kind==='ip'?'v2ip':'v2file',workspace:space,id:f.id,
   name:f.name,size:f.size,fileId:f.fileId,version:f.version,
   kind:f.kind,ownerId:f.ownerId,section:f.section,ownerName,
   ...(parent?{projectId:parent.projectId,projectName:parent.projectName}:{})});
 }
 return items;
}
// Project export is one action: every active original in the project and all its contracts.
// Version links remain distinct; no file checkbox or second selection panel is needed.
function projectOriginals(projectIds){
 const selected=new Set(projectIds.map(Number));
 const projects=new Map(projectRows.filter(p=>selected.has(p.id)).map(p=>[p.id,p]));
 const contracts=new Map(contractRows.filter(c=>projects.has(c.projectId)).map(c=>[c.id,c]));
 return businessFileRows.filter(f=>
   (f.kind==='project'&&projects.has(f.ownerId))||
   (f.kind==='contract'&&contracts.has(f.ownerId))
 ).map(f=>{
   const contract=f.kind==='contract'?contracts.get(f.ownerId):null;
   const project=projects.get(contract?contract.projectId:f.ownerId);
   return {
    source:'v2file',workspace:space,id:f.id,name:f.name,size:f.size,
    fileId:f.fileId,version:f.version,
    kind:f.kind,ownerId:f.ownerId,section:f.section,
    ownerName:contract?contract.name:project.name,
    ...(contract?{projectId:contract.projectId,projectName:project.name}:{})
   };
 });
}
function ipOriginals(ids){
 const chosen=new Set(ids.map(Number));
 const names=new Map(ipRows.filter(r=>chosen.has(r.id)).map(r=>[r.id,r.data.name]));
 return businessFileRows.filter(f=>f.kind==='ip'&&names.has(f.ownerId)).map(f=>({
  source:'v2ip',workspace:space,id:f.id,name:f.name,size:f.size,
  fileId:f.fileId,version:f.version,
  kind:'ip',ownerId:f.ownerId,section:f.section||'',ownerName:names.get(f.ownerId)
 }));
}
function businessFileCount(kind,ownerId,section=''){
 return new Set(businessFiles(kind,ownerId,section).map(f=>f.groupId||f.name+'\u0000'+f.category)).size;
}
function businessAttachmentList(kind,ownerId,section=''){
 const files=businessFiles(kind,ownerId,section);
 const groups=new Map();
 for(const f of files){
  const key=f.groupId||f.name+'\u0000'+f.category;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(f);
 }
 const category=kind==='ip'?'<label for="businessMaterialCategory">附件材料类别</label>'+
 '<select id="businessMaterialCategory">'+
 ['申请材料','通知文件','证书文件','其他材料'].map(x=>'<option>'+x+'</option>').join('')+'</select>':'';
 const line=(f,showVersion,latest=false)=>'<div class="fileline"><span class="fileicon">'+
 escapeHtml(f.name.split('.').pop().slice(0,4).toUpperCase())+'</span>'+
 '<span class="filedesc"><strong>'+escapeHtml(f.name)+'</strong><small>'+(showVersion?'v'+f.version+' · ':'')+
 (f.category?escapeHtml(f.category)+' · ':'')+fmtSize(f.size)+
 ' · SHA-256 '+escapeHtml(f.sha256.slice(0,12))+'…</small></span>'+
 (kind==='project'?'':exportCheck(f,kind==='ip'?'v2ip':'v2file',latest))+'<button class="btn btn-sm" data-preview-business="'+f.id+'">预览</button>'+
 '<button class="btn btn-sm" data-business-download="'+f.id+'">下载</button>'+
 '<button class="btn btn-sm" data-business-delete="'+f.id+'">移除</button></div>';
 return '<div class="tabletools"><b>原件附件 '+groups.size+' 份</b><div class="actions">'+category+
 (['ip','project','contract'].includes(kind)?'':'<label class="file-dedup-choice"><input type="checkbox" id="businessReuseExisting"> 同内容复用存储</label>')+
 '<button class="btn primary" data-action="businessUpload">＋ 上传原件</button></div></div>'+
 '<p class="hint">'+(['ip','project','contract','archive'].includes(kind)?'按内容摘要查重并明确选择共享身份、复用内容、独立保存或取消；支持文件历史版本。':'同名原件可选择更新已有版本链，或作为独立新文件归档；同工作区共享引用自动显示新版本。')+' 单文件上限 8 GiB。</p>'+
 ([...groups.values()].map(g=>{g.sort((a,b)=>b.version-a.version||b.id-a.id);
  return '<div class="business-file-group">'+line(g[0],g.length>1,true)+
   (['ip','project','contract','archive'].includes(kind)?'<button class="btn btn-sm" data-v2-ip-version="'+g[0].id+'">上传新版本</button>':'')+
   '<button class="btn btn-sm" data-business-associate="'+g[0].id+'">'+(['ip','project','contract'].includes(kind)?'共享到其它资料':'复制／移动关联')+'</button>'+ 
   (g.length>1?'<details><summary>查看历史版本（'+(g.length-1)+'）</summary>'+
    g.slice(1).map(f=>line(f,true)).join('')+'</details>':'')+'</div>';}).join('')||
 '<p class="hint">暂无附件，可上传原始文件。</p>')+
 (kind!=='project'&&files.length?exportButtons():'');
}
async function uploadBusinessAttachment(file,meta,workspace){
 return IPSysNativeIp.upload(api,file,meta,workspace);
}
async function uploadBusinessBatch(files,meta){
 if(localFileTaskActive)return notice('已有文件任务，请等待完成。',true);
 const workspace=space,errors=[];let completed=0,skipped=0;
 localFileTaskActive=true;
 try{
  for(const file of files){
   if(space!==workspace){errors.push('工作区已切换，上传终止');break;}
   if(file.size>MAX_ORIGINAL_BYTES){errors.push(file.name+'：超过 8 GiB');continue;}
   if(!['ip','project','contract','archive','general'].includes(meta.kind)){
    errors.push(file.name+'：不支持的资料归属类别');continue;
   }
   notice('正在检查重复内容：'+file.name);
   try{
    const saved=await uploadBusinessAttachment(file,meta,workspace);
    if(saved){completed++;await refresh();}else skipped++;
   }catch(err){errors.push(file.name+'：'+err.message);}
  }
 }finally{localFileTaskActive=false;}
 notice('上传完成：成功 '+completed+'，失败 '+errors.length+'，跳过 '+skipped+
  (errors.length?'；'+errors.join('；'):''),errors.length>0);
}
async function previewOriginal(file,url){
 if(file.size>128*1024*1024)
  return notice('大于 128 MiB 的文件不进行浏览器内预览，请直接下载原件。',true);
 const serial=++previewSerial;
 const extension=(file.name.split('.').pop()||'').toLowerCase();
 const images=['png','jpg','jpeg','gif','webp','bmp'];
 if(extension!=='pdf'&&!images.includes(extension))
  return notice('仅 PDF 或常见图片支持直接预览，请下载原件。',true);
 try{
  const response=await api(url);
  if(serial!==previewSerial)return;
  const body=el('filePreviewBody'),dialog=el('filePreviewDialog');
  if(activePdfViewer){activePdfViewer.destroy();activePdfViewer=null;}
  if(activePreviewUrl){URL.revokeObjectURL(activePreviewUrl);activePreviewUrl=null;}
  body.replaceChildren();
  el('filePreviewTitle').textContent=file.name;
  if(extension==='pdf'){
   // Render directly to a canvas: Chromium's embedded PDF iframe viewer has
   // an internal 150px surface defect that cannot be fixed with CSS sizing.
   body.classList.add('pdf-mode');
   body.textContent='正在加载 PDF 预览…';
   dialog.showModal();
   const bytes=await response.arrayBuffer();
   if(serial!==previewSerial||!dialog.open)return;
   const renderer=await ensurePdfViewer();
   if(serial!==previewSerial||!dialog.open)return;
   activePdfViewer=renderer.create(body,bytes);
   await activePdfViewer.open();
  }else{
   const raw=await response.blob();
   if(serial!==previewSerial)return;
   const mime=extension==='png'?'image/png':extension==='gif'?'image/gif':
    extension==='webp'?'image/webp':extension==='bmp'?'image/bmp':'image/jpeg';
   activePreviewUrl=URL.createObjectURL(new Blob([raw],{type:mime}));
   body.classList.remove('pdf-mode');
   const image=document.createElement('img');
   image.alt=file.name;image.src=activePreviewUrl;body.append(image);
   dialog.showModal();
  }
 }catch(e){
  if(serial===previewSerial)notice('无法预览：'+e.message,true);
 }
}
el('filePreviewClose').onclick=()=>el('filePreviewDialog').close();
el('filePreviewDialog').addEventListener('close',()=>{
 ++previewSerial;
 if(activePdfViewer){activePdfViewer.destroy();activePdfViewer=null;}
 el('filePreviewBody').replaceChildren();
 el('filePreviewBody').classList.remove('pdf-mode');
 if(activePreviewUrl){URL.revokeObjectURL(activePreviewUrl);activePreviewUrl=null;}
});
// Avoid buffering a multi-GiB Blob in browser memory on ordinary downloads.
async function saveOriginalToDisk(file,path){
 if(file.size>32*1024*1024){
  if(typeof window.showSaveFilePicker!=='function')
   throw Error('大附件下载需使用支持本地文件流写入的新版 Edge 或 Chrome。');
  // Invoke picker before network awaits while the click still has user activation.
  const handle=await window.showSaveFilePicker({suggestedName:file.name});
  const writer=await handle.createWritable();
  let finished=false,received=0;
  try{
   const response=await api(path);
   if(!response.body)throw Error('浏览器不支持流式下载。');
   const reader=response.body.getReader();
   try{
    while(true){
     const item=await reader.read();
     if(item.done)break;
     received+=item.value.byteLength;
     if(received>file.size)throw Error('原件下载长度异常。');
     await writer.write(item.value);
    }
   }finally{reader.releaseLock();}
   if(received!==file.size)throw Error('原件下载不完整，请核对数据库与磁盘。');
   await writer.close();finished=true;
  }finally{if(!finished)try{await writer.abort()}catch{}}
 }else{
  const response=await api(path);
  const blob=await response.blob();
  if(blob.size!==file.size)throw Error('原件下载长度异常。');
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=file.name;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
}
async function downloadBusinessAttachment(fileId){
 try{
  const file=businessFileRows.find(f=>f.id===fileId);if(!file)return;
  if(!file.v2)throw Error('此附件不是 V2 原件，刷新资料库后重试。');
  await saveOriginalToDisk(file,IPSysNativeIp.fileUrl(space,file));
  notice('原件已下载：'+file.name);
 }catch(e){if(e.name!=='AbortError')notice(e.message,true);}
}
function projectDetail(){
 const p=projectRows.find(x=>x.id===detail.id);
 if(!p)return heading('项目不存在','当前工作区无此项目')+'<button class="btn" data-nav="researchProject">返回台账</button>';
 return heading(p.name,'项目详情 · 当前资料库记录',
 '<button class="btn" data-nav="'+page+'">← 返回台账</button>'+
 '<button class="btn" data-action="projectEdit">修改</button>'+
 '<button class="btn" data-action="projectCopy">复制项目</button>'+
 '<button class="btn" data-action="projectMove">转移工作区</button>'+
 '<button class="btn" data-action="projectDelete">删除</button>'+
 '<button class="btn" data-action="projectExportFolder">导出文件夹</button>'+
 '<button class="btn primary" data-action="projectExportZip">导出 ZIP</button>')+
 section('项目基本信息','<div class="infogrid project-info-grid">'+
 infoRow('项目名称',p.name)+infoRow('项目类型',p.projectType)+infoRow('项目编号',p.projectNo)+
 infoRow('负责人',p.leader)+infoRow('承担单位',p.undertakingOrg)+
 infoRow('项目状态',p.projectStatus)+infoRow('开始日期',p.startDate)+
 infoRow('结束日期',p.endDate)+infoRow('辅助分类',p.category)+
 infoRow('标签',p.tags)+infoRow('备注',p.remarks)+'</div>')+
 section('所属合同',projectContracts(p.id))+
 section('项目自身附件',businessAttachmentList('project',p.id));
}
function showProjectForm(id=null){
 projectEditingId=id;
 const p=id===null?null:projectRows.find(r=>r.id===id);
 el('projectForm').reset();
 el('projectFormTitle').textContent=p?'修改项目':'新建项目';
 el('projectExcelImport').hidden=!!p;
 el('pType').value=p?.projectType||'科研项目';
 const fields={pName:'name',pNo:'projectNo',pStatus:'projectStatus',pLeader:'leader',
  pOrg:'undertakingOrg',pStart:'startDate',pEnd:'endDate',pCategory:'category',pTags:'tags',pRemarks:'remarks'};
 for(const [id,key] of Object.entries(fields))if(p)el(id).value=p[key]||'';
 el('projectDialog').showModal();
}
function archiveCard(record,options={}){
 const headingText=options.title??record.name??record.title??'未命名资料';
 const typeText=options.type??record.type??'未分类';
 const fileCount=options.fileCount??(Array.isArray(record.files)?record.files.length:(record.files??0));
 const real=options.real===true;
 const action=real?'live':'mock';
 return `<article class="archivecard${real?' archivecard-real':''}">
   <div class="archivecard-head">
     <div class="archivecard-titlewrap">
       <span class="archivecard-symbol" aria-hidden="true">▤</span>
       <h3 class="archivecard-title">${escapeHtml(headingText)}</h3>
     </div>
     ${real?'':'<span class="mockflag">界面示例</span>'}
   </div>
   <div class="archivecard-meta">
     <span class="archivecard-type">${escapeHtml(typeText)}</span>
     <span class="archivecard-count">附件 <strong>${Number(fileCount)}</strong> 份</span>
   </div>
   <div class="archivecard-actions">
     <button class="btn btn-sm" data-${action}-id="${Number(record.id)}">查看详情</button>
   </div>
 </article>`;
}
function mockList(k){
 const all=sample(k);
 const visible=all.filter(r=>{
  const text=Object.values(r).join(' ').toLowerCase();
  return text.includes(filterName.toLowerCase())&&(filterKind==='全部类型'||r.type===filterKind)&&(filterState==='全部状态'||r.status===filterState);
 });
 const types=[...new Set(all.map(x=>x.type).filter(Boolean))];const states=[...new Set(all.map(x=>x.status).filter(Boolean))];
 const cols=columns(k);
 return heading(title(k),(space==='personal'&&personalCategoryNotes[k]?personalCategoryNotes[k]+' · ':'')+'台账页面布局预览 · 记录均为虚构样例',`<span class="mockflag">仅演示</span>${k==='contract'?'':`<button class="btn primary" data-action="demoAdd">＋ 新建${isProject(k)?'项目':'记录'}</button>`}`)+
 `<section class="white filter"><div class="filterline"><div class="field wide"><label>名称 / 编号</label><input id="filterSearch" placeholder="输入关键词筛选演示记录"></div><div class="field"><label>类型</label><select id="filterKind">${['全部类型',...types].map(x=>`<option value="${escapeHtml(x)}" ${x===filterKind?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select></div>`+
 (states.length?`<div class="field"><label>状态</label><select id="filterState">${['全部状态',...states].map(x=>`<option value="${escapeHtml(x)}" ${x===filterState?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select></div>`:'')+
 '<button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><span><b>业务台账</b> <small class="muted">'+visible.length+' 条示例</small></span><div class="actions"><button class="btn" data-action="demoExcel">导出 XLSX（演示）</button><button class="btn" data-action="demoColumns">列设置（演示）</button></div></div>'+
 '<div class="tablewrap"><table class="data"><thead><tr><th><input type="checkbox" id="checkAll"></th>'+cols.map(c=>`<th>${c[1]}</th>`).join('')+'</tr></thead><tbody>'+
 (visible.length?visible.map(r=>`<tr><td><input type="checkbox" class="rowcheck" value="${r.id}"></td>`+cols.map(([field],i)=>`<td>${field==='name'?`<button class="link" data-mock-id="${r.id}">${escapeHtml(r[field])}</button>`:field==='amount'?(r[field]?Number(r[field]).toFixed(2):'—'):field==='status'?`<span class="tag">${escapeHtml(r[field]||'—')}</span>`:escapeHtml(r[field]??'—')}</td>`).join('')+'</tr>').join(''):`<tr><td colspan="${cols.length+1}" class="empty">没有符合条件的演示记录</td></tr>`)+
 '</tbody></table></div><div class="tablefoot"><span>显示 '+visible.length+' 条演示记录</span><span id="selectionInfo">已勾选 0 条</span></div></section>';
}

function archiveCategoryCard(type,rows){
 const total=rows.reduce((sum,r)=>sum+Number(r.files||0),0);
 return '<article class="archivecard archivecategory" data-archive-category="'+escapeHtml(type)+'" role="button" tabindex="0" aria-label="查看'+escapeHtml(type)+'台账">'+
   '<div class="archivecard-head"><div class="archivecard-titlewrap">'+
   '<span class="archivecard-symbol" aria-hidden="true">▤</span>'+
   '<h3 class="archivecard-title">'+escapeHtml(type)+'</h3></div>'+
   '<span class="mockflag">类别示例</span></div>'+
   '<div class="archivecard-meta"><span class="archivecard-type">'+rows.length+' 条归档记录</span>'+
   '<span class="archivecard-count">附件 <strong>'+total+'</strong> 份</span></div>'+
   '<div class="archivecard-actions"><span class="archivecategory-open">进入台账 →</span></div></article>';
}

const archiveSections=['certificate','achievement','academic'];
const archiveDestinations=[
 {workspace:'company',section:'certificate',label:'公司资料 / 企业资质',kind:'company_certificate'},
 {workspace:'personal',section:'certificate',label:'个人资料 / 身份与资质',kind:'personal_certificate'},
 {workspace:'company',section:'achievement',label:'公司资料 / 业务档案',kind:'research_output'},
 {workspace:'personal',section:'achievement',label:'个人资料 / 成果与奖励',kind:'research_output'},
 {workspace:'personal',section:'academic',label:'个人资料 / 学术与社会活动',kind:'research_output'}
];
function archiveSectionName(k){return space==='company'&&k==='achievement'?'业务档案':title(k);}
function archiveCategories(k){
 // Legacy company/achievement data and custom categories remain visible.
 const defaults=space==='company'&&k==='achievement'
  ?["申报与认定","规划与管理","汇报与宣传","会议与活动","专项工作与合作","政策与行业资料","其他业务资料"]
  :[...new Set(sample(k).map(r=>r.type))];
 return [...new Set([...defaults,...(archiveRows[k]||[]).map(r=>r.category||'未分类')])];
}
function realArchiveCategoryCard(category,count,files,folderId=null){
 const companyFolder=folderId!==null;
 const target=companyFolder?'data-archive-folder-id="'+folderId+'"':
  'data-archive-category="'+escapeHtml(category)+'"';
 // The landing page is navigation only. System roots and the virtual root
 // category cannot be removed; user-created empty roots may be deleted.
 const defaults=["申报与认定","规划与管理","汇报与宣传","会议与活动",
  "专项工作与合作","政策与行业资料","其他业务资料"];
 const canDelete=companyFolder&&folderId>0&&!defaults.includes(category);
 const remove=canDelete?'<button type="button" class="btn btn-sm archive-root-delete" '+
  'data-archive-folder-delete="'+folderId+'" aria-label="删除分类 '+escapeHtml(category)+'">删除</button>':'';
 return '<article class="archivecard archivecategory" '+target+' role="button" tabindex="0" aria-label="查看'+escapeHtml(category)+'台账">'+
 '<div class="archivecard-head"><div class="archivecard-titlewrap">'+
 '<span class="archivecard-symbol" aria-hidden="true">▤</span><h3 class="archivecard-title">'+escapeHtml(category)+'</h3></div></div>'+
 '<div class="archivecard-meta"><span class="archivecard-type">'+count+' 条归档记录</span>'+
 '<span class="archivecard-count">附件 <strong>'+files+'</strong> 份</span></div>'+
 '<div class="archivecard-actions">'+remove+
 '<span class="archivecategory-open">进入台账 →</span></div></article>';
}

function archiveFolderPath(id){
 const path=[],seen=new Set();
 while(id){
  if(seen.has(id))break;
  seen.add(id);
  const folder=archiveFolders.find(f=>f.id===id);
  if(!folder)break;
  path.unshift(folder);
  id=folder.parentId||null;
 }
 return path;
}
function archiveFolderOptions(selected){
 return '<option value="0"'+(selected===0?' selected':'')+'>业务档案根目录</option>'+
 archiveFolders.map(f=>'<option value="'+f.id+'"'+(selected===f.id?' selected':'')+'>'+
  escapeHtml(archiveFolderPath(f.id).map(p=>p.name).join(' / '))+'</option>').join('');
}
// Folders are rows inside the SAME ledger as this directory's archive records.
// They are navigation targets, not archive records: no selection or record ordering.
// One stable sequence for both child categories and records, keyed by type + ID.
// Persisted order wins; new/unordered entries join by name, not forced category-first.
function archiveMixedEntries(folders,records){
 const items=[
  ...folders.map(folder=>({kind:'folder',id:folder.id,name:folder.name,folder})),
  ...records.map(record=>({kind:'record',id:record.id,name:record.name,record}))
 ];
 const positions=new Map((archiveEntryOrders[String(archiveFolderId??0)]||[])
  .map((item,index)=>[item.kind+':'+item.id,index]));
 return items.sort((a,b)=>{
  const ar=positions.get(a.kind+':'+a.id),br=positions.get(b.kind+':'+b.id);
  if(ar!==undefined||br!==undefined){
   if(ar===undefined)return 1;
   if(br===undefined)return -1;
   return ar-br;
  }
  return a.name.localeCompare(b.name,'zh-CN',{numeric:true})||
   a.kind.localeCompare(b.kind)||a.id-b.id;
 });
}
function archiveFolderTableRow(folder,index){
 const count=(archiveRows.achievement||[]).filter(r=>r.folderId===folder.id).length;
 const children=archiveFolders.filter(f=>f.parentId===folder.id).length;
 const name=escapeHtml(folder.name);
 return '<tr class="archive-folder-row" data-archive-folder-row="'+folder.id+
  '" data-archive-entry-kind="folder" data-archive-entry-id="'+folder.id+'">'+
  '<td class="ledger-record-sequence-cell">'+(index+1)+'</td>'+
  '<td><button type="button" class="link" data-archive-folder-id="'+folder.id+'">'+name+'</button></td>'+
  '<td class="archive-category-year muted">—</td>'+
  '<td class="muted">—</td>'+
  '<td class="archive-folder-summary muted">'+count+' 条资料'+(children?' · '+children+' 个下级分类':'')+'</td>'+
  '<td class="archive-category-action"><button type="button" class="btn btn-sm" data-archive-folder-id="'+folder.id+'">打开</button></td></tr>';
}
function openArchiveFolder(id){
 if(id&&!archiveFolders.some(f=>f.id===id))return notice('目录已变化，请刷新。',true);
 archiveFolderId=id===0?0:(id||null);
 archiveGroup=archiveFolders.find(f=>f.id===archiveFolderId)?.name||null;
 detail=null;filterName='';filterKind='全部类型';selected.clear();archiveSelectedFolders.clear();render();
 el('content').scrollTo(0,0);
}
function showArchiveFolderForm(id=null){
 if(space!=='company'||page!=='achievement')return;
 const folder=id?archiveFolders.find(f=>f.id===id):null;
 if(id&&!folder)return notice('目录不存在。',true);
 archiveFolderEditingId=id;
 el('archiveFolderForm').reset();
 el('archiveFolderDialogTitle').textContent=folder?'管理目录':archiveFolderId===null?'新建分类':'新建下级分类';
 el('archiveFolderParentField').hidden=!folder;
 el('archiveFolderName').value=folder?.name||'';
 const blocked=new Set(folder?[folder.id,...archiveFolders.filter(f=>archiveFolderPath(f.id).some(p=>p.id===folder.id)).map(f=>f.id)]:[]);
 el('archiveFolderParent').innerHTML='<option value="0">业务档案根目录</option>'+
  archiveFolders.filter(f=>!blocked.has(f.id)).map(f=>'<option value="'+f.id+'">'+
  escapeHtml(archiveFolderPath(f.id).map(p=>p.name).join(' / '))+'</option>').join('');
 el('archiveFolderParent').value=String(folder?.parentId??archiveFolderId??0);
 el('archiveFolderDelete').hidden=!folder;
 el('archiveFolderDialog').showModal();
}
function companyCertificateRows(){
 return (archiveRows.certificate||[]).filter(r=>{
  const category=r.category||'未分类';
  return [r.name,r.remarks].join(' ').toLowerCase().includes(filterName.toLowerCase());
 });
}
function certificateExportIds(){
 const rows=companyCertificateRows();
 const checked=rows.filter(r=>certificateSelected.has(r.id));
 return (checked.length?checked:rows).map(r=>r.id);
}
// Keep individual rows, header all/partial state, counter and batch action synchronized.
function syncCompanyCertificateSelectionUi(){
 const content=el('content');
 const all=content?.querySelector('.certificate-checkall');
 if(!all)return;
 const visible=companyCertificateRows();
 const count=visible.filter(row=>certificateSelected.has(row.id)).length;
 all.checked=visible.length>0&&count===visible.length;
 all.indeterminate=count>0&&count<visible.length;
 for(const box of content.querySelectorAll('.certificate-rowcheck'))
  box.checked=certificateSelected.has(Number(box.value));
 const status=el('certificateSelectedCount');
 if(status)status.textContent='已选 '+count+' 条';
 const bulk=content.querySelector('[data-action="certificateBatchDelete"]');
 if(bulk){bulk.hidden=count===0;bulk.disabled=certificateDeleteBusy||count===0;}
}
async function moveCompanyCertificate(id,direction){
 const visible=companyCertificateRows();
 const at=visible.findIndex(r=>r.id===id);
 const next=at+direction;
 if(at<0||next<0||next>=visible.length)return;
 const ids=(archiveRows.certificate||[]).map(r=>r.id);
 const a=ids.indexOf(visible[at].id),b=ids.indexOf(visible[next].id);
 if(a<0||b<0)return;
 [ids[a],ids[b]]=[ids[b],ids[a]];
 try{
  await api('/api/v2/ui/archive/company/certificate/order',{method:'POST',json:{ids}});
  await refresh();
  notice('顺序已保存。');
 }catch(error){
  await refresh();
  notice('排序失败：'+error.message,true);
 }
}
function certificateExportMenu(rows){
 const attrs=' data-export-kind="archive" data-export-section="certificate" data-export-ids="'+rows.map(r=>r.id).join(',')+'"';
 return '<details class="certificate-export">'+
  '<summary class="btn certificate-export-trigger" aria-label="选择导出格式">导出 <span aria-hidden="true">▾</span></summary>'+
  '<div class="certificate-export-options" role="group" aria-label="企业资质导出方式">'+
  '<button type="button" data-action="moduleExportFolder"'+attrs+'>导出附件文件夹</button>'+
  '<button type="button" data-action="moduleExportZip"'+attrs+'>导出 ZIP</button>'+
  '<button type="button" data-action="excelExport" data-excel-kind="archive" data-excel-section="certificate">导出 Excel</button>'+
  '</div></details>';
}
function companyCertificateAttachment(recordId){
 // Prefer the latest uploaded original. Multiple attachments are not restricted.
 return businessFiles('archive',recordId,'certificate').slice().sort((a,b)=>b.id-a.id)[0]||null;
}
function realCompanyCertificateList(){
 const all=archiveRows.certificate||[],rows=companyCertificateRows();
 const checkedCount=rows.filter(r=>certificateSelected.has(r.id)).length;
 return '<section class="white certificate-ledger">'+
 '<div class="certificate-toolbar">'+
 '<div class="certificate-toolbar-title"><h1>企业资质</h1><span>共 '+all.length+' 条记录</span></div>'+
 '<div class="certificate-toolbar-filter">'+
 '<label class="certificate-sr-only" for="filterSearch">资料名称或备注</label>'+
 '<input id="filterSearch" aria-label="资料名称或备注" placeholder="搜索资料名称或备注">'+
 '<button class="btn primary" data-action="filter">查询</button>'+
 '<button class="btn" data-action="clearFilter">重置</button></div>'+
 '<div class="certificate-toolbar-actions">'+
 '<span class="certificate-selected-count" id="certificateSelectedCount">已选 '+checkedCount+' 条</span>'+
 '<button type="button" class="btn certificate-batch-delete" data-action="certificateBatchDelete"'+(checkedCount?'':' disabled hidden')+'>批量删除</button>'+
 '<button class="btn primary" data-action="archiveAdd">＋ 新建记录</button>'+
 certificateExportMenu(rows)+'</div></div>'+
 '<div class="tablewrap archive-tablewrap"><table class="data">'+
 '<colgroup><col class="certificate-col-check"><col class="certificate-col-sequence">'+
 '<col class="certificate-col-name"><col class="certificate-col-file">'+
 '<col class="certificate-col-size"><col class="certificate-col-remarks">'+
 '<col class="certificate-col-order"><col class="certificate-col-action"></colgroup><thead><tr>'+
 '<th class="certificate-check"><input type="checkbox" class="certificate-checkall" aria-label="全选当前列表"'+
 (rows.length&&checkedCount===rows.length?' checked':'')+(rows.length?'':' disabled')+'></th>'+
 '<th class="certificate-sequence">序号</th><th>资料名称</th><th>附件</th><th class="certificate-size">文件大小</th>'+
 '<th>备注</th><th class="certificate-order">排序</th><th class="certificate-action">操作</th></tr></thead><tbody>'+
 (rows.length?rows.map((r,index)=>{
  const original=companyCertificateAttachment(r.id);
  return '<tr><td class="certificate-check"><input type="checkbox" class="certificate-rowcheck" value="'+r.id+
   '" aria-label="选择资料 '+escapeHtml(r.name)+'"'+(certificateSelected.has(r.id)?' checked':'')+'></td>'+
   '<td class="certificate-sequence">'+(index+1)+'</td>'+
   '<td><button class="link" data-archive-id="'+r.id+'">'+escapeHtml(r.name)+'</button></td>'+
   '<td>'+(original?escapeHtml(original.name):'<span class="muted">未上传</span>')+'</td>'+
   '<td class="certificate-size">'+(original?fmtSize(original.size):'—')+'</td>'+
   '<td>'+escapeHtml(r.remarks||'—')+'</td>'+
   '<td class="certificate-order">'+
   '<button type="button" class="btn btn-sm" aria-label="将'+escapeHtml(r.name)+'上移" data-certificate-move="'+r.id+'" data-move-direction="-1"'+(index===0?' disabled':'')+'>↑</button>'+
   '<button type="button" class="btn btn-sm" aria-label="将'+escapeHtml(r.name)+'下移" data-certificate-move="'+r.id+'" data-move-direction="1"'+(index===rows.length-1?' disabled':'')+'>↓</button></td>'+
   '<td class="certificate-action"><button class="btn btn-sm" data-certificate-download="'+(original?.id||'')+'"'+
   (original?'':' disabled title="该资料尚无附件"')+'>下载</button></td></tr>';
 }).join(''):
 '<tr><td colspan="8" class="empty">暂无符合条件的资料，可点击上方新建。</td></tr>')+
 '</tbody></table></div><div class="tablefoot">显示 '+rows.length+' 条 · 共 '+all.length+' 条企业资质记录</div></section>';
}
function realArchiveCards(k){
 if(space==='company'&&k==='achievement'){
  if(archiveFolderId!==null)return realArchiveTable(k,'业务档案');
  const roots=archiveFolders.filter(f=>f.parentId===null&&
   f.name.toLowerCase().includes(filterName.toLowerCase()));
  const all=archiveRows.achievement||[];
  const unfiled=all.filter(r=>!r.folderId);
  return heading('业务档案','选择分类进入对应资料台账',
   '<button class="btn primary" data-action="archiveFolderAdd">＋ 新建</button>')+
   '<section class="white filter"><div class="filterline"><div class="field wide">'+
   '<label>分类名称</label><input id="filterSearch" placeholder="查找业务档案分类"></div>'+
   '<button class="btn primary" data-action="filter">查询</button>'+
   '<button class="btn" data-action="clearFilter">重置</button></div></section>'+
   '<section class="white archive-category-root"><div class="tabletools"><b>资料类别 · '+roots.length+' 类</b>'+
   '<div class="actions"></div></div>'+
   '<div class="recordgrid">'+roots.map(f=>{
    const members=all.filter(r=>archiveFolderPath(r.folderId).some(p=>p.id===f.id));
    return realArchiveCategoryCard(f.name,members.length,
     members.reduce((n,r)=>n+businessFileCount('archive',r.id,k),0),f.id);
   }).join('')+
   (unfiled.length&&(!filterName||'本级资料'.includes(filterName))?
    realArchiveCategoryCard('本级资料',unfiled.length,
     unfiled.reduce((n,r)=>n+businessFileCount('archive',r.id,k),0),0):'')+
   '</div><div class="tablefoot">选择分类后按表格管理资料；各级分类可继续新建下级分类。</div></section>';
 }
 const rows=archiveRows[k]||[],categories=archiveCategories(k);
 const visible=categories.filter(category=>
  (filterKind==='全部类型'||category===filterKind)&&category.toLowerCase().includes(filterName.toLowerCase()));
 return heading(archiveSectionName(k),'按材料类别归档 · 当前资料库记录',
  '<button class="btn primary" data-action="archiveAdd">＋ 新建记录</button>')+
 
 '<section class="white filter"><div class="filterline"><div class="field wide"><label>类别名称</label><input id="filterSearch" placeholder="查找资料类别"></div>'+
 '<div class="field"><label>类别</label><select id="filterKind">'+
 ['全部类型',...categories].map(x=>'<option value="'+escapeHtml(x)+'" '+(x===filterKind?'selected':'')+'>'+escapeHtml(x)+'</option>').join('')+
 '</select></div><button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><b>资料类别 · '+visible.length+' 类</b><div class="actions">'+quickExportButtons(rows.filter(r=>visible.includes(r.category||'未分类')),'archive',k)+'</div></div>'+
 '<div class="recordgrid">'+visible.map(category=>{
  const members=rows.filter(r=>(r.category||'未分类')===category);
  return realArchiveCategoryCard(category,members.length,
    members.reduce((n,r)=>n+businessFileCount('archive',r.id,k),0));
 }).join('')+'</div>'+
 '<div class="tablefoot">记录 '+rows.length+' 条 · 可在每一类别下归档多条独立记录</div></section>';
}
// Archive records can contain multiple original files and multiple historical versions.
// Display one current version per file group, consistent with the record detail page.
function archiveTableAttachmentSummary(recordId,section){
 const current=new Map();
 for(const file of businessFiles('archive',recordId,section)){
  const key=file.groupId||file.name+'\u0000'+file.category;
  const old=current.get(key);
  if(!old||file.version>old.version||(file.version===old.version&&file.id>old.id))
   current.set(key,file);
 }
 const files=[...current.values()];
 return {count:files.length,size:files.reduce((sum,file)=>sum+file.size,0),files};
}
// A row download contains the current version of each distinct original, not
// duplicate historical versions. Reuse the existing browser ZIP export engine.
function archiveRecordZipOriginals(recordId,section){
 const record=(archiveRows[section]||[]).find(r=>r.id===recordId);
 if(!record)return [];
 return archiveTableAttachmentSummary(recordId,section).files.map(file=>({
  source:'v2file',workspace:space,id:file.id,name:file.name,size:file.size,
  fileId:file.fileId,version:file.version,
  kind:'archive',ownerId:recordId,section,ownerName:record.name
 }));
}
// Archive directories and records share one attachment export pipeline.
// Folder downloads include all descendants, taking only the latest version
// of each original while retaining each directory and record level in the ZIP.
function archiveFolderOriginals(folderId){
 if(space!=='company'||(!archiveFolders.some(f=>f.id===folderId)&&folderId!==0))return [];
 const subtree=new Set([folderId]);
 if(folderId!==0){
  for(let i=0,walk=[folderId];i<walk.length;i++){
   for(const child of archiveFolders.filter(f=>f.parentId===walk[i])){
    if(!subtree.has(child.id)){subtree.add(child.id);walk.push(child.id);}
   }
  }
 }
 const rootPath=folderId===0?[]:archiveFolderPath(folderId);
 const files=[];
 for(const record of archiveRows.achievement||[]){
  if(!subtree.has(record.folderId??0))continue;
  const path=folderId===0?[{id:0,name:'本级资料'}]:
   archiveFolderPath(record.folderId).slice(rootPath.length-1);
  for(const original of archiveRecordZipOriginals(record.id,'achievement'))
   files.push({...original,archiveFolderPath:path.map(f=>({id:f.id,name:f.name}))});
 }
 return files;
}
function archiveChosenOriginals(folderIds,recordIds){
 const found=new Map();
 for(const folderId of folderIds)
  for(const file of archiveFolderOriginals(folderId))if(!found.has(file.id))found.set(file.id,file);
 for(const id of recordIds)
  for(const file of archiveRecordZipOriginals(id,'achievement'))
   if(!found.has(file.id))found.set(file.id,file);
 return [...found.values()];
}
function archiveVisibleFolderIds(){
 if(archiveFolderId===null)
  return archiveFolders.filter(f=>f.parentId===null&&f.name.toLowerCase().includes(filterName.toLowerCase()))
   .map(f=>f.id).concat((archiveRows.achievement||[]).some(r=>!r.folderId)&&
    (!filterName||'本级资料'.includes(filterName))?[0]:[]);
 return archiveFolderId===0?[]:
  archiveFolders.filter(f=>f.parentId===archiveFolderId&&
   f.name.toLowerCase().includes(filterName.toLowerCase())).map(f=>f.id);
}
function realArchiveTable(k,category){
 const companyBusiness=space==='company'&&k==='achievement';
 const folderMode=companyBusiness&&typeof archiveFolders!=='undefined'&&archiveFolders.length>0;
 const folder=folderMode&&archiveFolderId?archiveFolders.find(f=>f.id===archiveFolderId):null;
 const folderChildren=folderMode&&archiveFolderId!==0?archiveFolders.filter(f=>
  (f.parentId??null)===(archiveFolderId??null)&&
  f.name.toLowerCase().includes(filterName.toLowerCase())):[];
 const folderPath=folderMode?archiveFolderPath(archiveFolderId):[];
 const all=(archiveRows[k]||[]).filter(r=>folderMode?
  (r.folderId??0)===(archiveFolderId??0):(r.category||'未分类')===category);
 const rows=all.filter(r=>[r.name,r.remarks,r.tags].join(' ').toLowerCase().includes(filterName.toLowerCase()));
 const entries=folderMode?archiveMixedEntries(folderChildren,rows):[];
 return heading(folderMode?(archiveFolderId===0?'本级资料':folder?.name||'业务档案'):category,
  folderMode?'业务档案'+(folderPath.length?' / '+folderPath.map(f=>escapeHtml(f.name)).join(' / '):'')+
   ' · 本级目录与资料':archiveSectionName(k)+' / 分类台账 · 同一类别可归档多条记录',
 companyBusiness?'':'<button class="btn primary" data-action="archiveAdd">＋ 新建记录</button>',
 folderMode?(folder||archiveFolderId===0?'<button type="button" class="archive-breadcrumb-back" data-archive-folder-back="1" aria-label="返回上级分类" title="返回上级分类">←</button>':''):
 '<button type="button" class="archive-breadcrumb-back" data-archive-back="cards" aria-label="返回类别卡片" title="返回类别卡片">←</button>')+
 
 '<section class="white filter"><div class="filterline"><div class="field wide"><label>资料名称</label><input id="filterSearch" placeholder="搜索此类别下的记录"></div>'+
 '<button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white archive-category-ledger"><div class="tabletools"><b>'+
 (folderMode?'文件夹 '+folderChildren.length+' 个 · 资料 '+rows.length+' 条':'共 '+rows.length+' 条记录')+
 '</b><div class="actions">'+
 (folderMode?'<button class="btn primary" data-action="archiveCreate">＋ 新建</button>'+
  (folder?'<button class="btn" data-action="archiveFolderEdit">管理当前目录</button>':''):'')+
 quickExportButtons(rows,'archive',k)+'</div></div>'+
 '<div class="tablewrap archive-tablewrap"><table class="data ledger-archive-category-table'+(companyBusiness?' company-business-archive':'')+'">'+
 '<colgroup><col class="archive-col-check"><col class="archive-col-sequence">'+
 '<col class="archive-col-name">'+(companyBusiness?'<col class="archive-col-year">':'')+
 '<col class="archive-col-attachment">'+(companyBusiness?'':'<col class="archive-col-size">')+
 '<col class="archive-col-remarks"><col class="archive-col-order"><col class="archive-col-action"></colgroup>'+
 (companyBusiness?
 '<thead><tr><th>序号</th><th>名称</th><th>年份</th><th>附件</th><th>备注</th><th>操作</th></tr></thead><tbody>':
 '<thead><tr><th>序号</th><th>资料名称</th><th>附件</th><th>文件大小</th><th>备注</th><th>操作</th></tr></thead><tbody>')+
 ((folderMode?entries:rows.map(record=>({kind:'record',record}))).length?
  (folderMode?entries:rows.map(record=>({kind:'record',record}))).map((entry,i)=>{
   if(entry.kind==='folder')return archiveFolderTableRow(entry.folder,i);
   const r=entry.record,files=archiveTableAttachmentSummary(r.id,k);
   return '<tr'+(folderMode?' data-archive-entry-kind="record" data-archive-entry-id="'+r.id+'"':'')+
    '><td>'+(i+1)+'</td><td>'+
    '<button class="link" data-archive-id="'+r.id+'">'+escapeHtml(r.name)+'</button></td>'+
    (companyBusiness?'<td class="archive-category-year">'+escapeHtml(r.year||'—')+'</td>':'')+
    '<td>'+(companyBusiness?files.count+' 份':
     files.count?files.count+' 份':'<span class="muted">未上传</span>')+'</td>'+
    (companyBusiness?'':'<td class="archive-category-file-size">'+(files.count?fmtSize(files.size):'—')+'</td>')+
    '<td>'+escapeHtml(r.remarks||'—')+'</td>'+
    '<td class="archive-category-action">'+(companyBusiness?
     '<button type="button" class="btn btn-sm" data-archive-download="'+r.id+'"'+
     (files.count?'':' disabled title="该记录尚无附件"')+'>下载</button>':
     '<button class="btn btn-sm" data-archive-id="'+r.id+'">查看详情</button>')+'</td></tr>';
  }).join(''):
 '<tr><td colspan="6" class="empty">'+
 (folderMode?'当前目录暂无资料，可新增资料或下级分类。':'此类别暂无记录，点击右上角新建。')+
 '</td></tr>')+
 '</tbody></table></div><div class="tablefoot">'+
 (folderMode?'本级文件夹 '+folderChildren.length+' 个 · 资料 '+all.length+' 条':'当前类别共 '+all.length+' 条记录')+
 '</div></section>';
}
function realArchiveDetail(){
 const record=(archiveRows[page]||[]).find(r=>r.id===detail?.id);
 if(!record)return heading('资料不存在','当前工作区找不到此记录');
 const back=space==='company'&&page==='certificate'?
 '<button class="btn" data-nav="certificate">← 返回企业资质</button>':
 archiveGroup?'<button class="btn" data-archive-back="table">← 返回'+escapeHtml(archiveGroup)+'台账</button>':
 '<button class="btn" data-nav="'+page+'">← 返回类别卡片</button>';
 const moveAvailable=page!=='certificate';
 return heading(record.name,archiveSectionName(page)+' · 资料记录',
  back+'<button class="btn" data-action="archiveEdit">修改</button>'+
  '<button class="btn" data-action="archiveCopy">复制</button>'+
  (moveAvailable?'<button class="btn" data-action="archiveMove">转移</button>':'')+
  (space==='company'&&page==='achievement'?'<button class="btn" data-action="archiveExpand">作为分类继续细分</button>':'')+
  '<button class="btn" data-action="archiveDelete">删除</button>')+
 section('基本信息','<div class="infogrid">'+infoRow('资料名称',record.name)+
 (space==='company'&&page==='certificate'?infoRow('备注',record.remarks):
 infoRow('类别',record.category)+
 (space==='company'&&page==='achievement'?infoRow('年份',record.year):'')+
 infoRow('备注',record.remarks)+infoRow('标签',record.tags))+'</div>')+
 section('附件资料',businessAttachmentList('archive',record.id,page));
}
function showArchiveForm(id=null){
 const record=id===null?null:(archiveRows[page]||[]).find(r=>r.id===id);
 if(id!==null&&!record){notice('记录不存在。',true);return;}
 archiveEditingId=id;
 el('archiveForm').reset();
 const simpleCertificate=space==='company'&&page==='certificate';
 const companyBusiness=space==='company'&&page==='achievement';
 el('archiveFolderField').hidden=!companyBusiness;
 el('aFolder').disabled=!companyBusiness;
 if(companyBusiness){
  el('aFolder').innerHTML=archiveFolderOptions(record?.folderId??archiveFolderId??0);
  el('aCategory').disabled=true;
 }else el('aCategory').disabled=false;
 el('archiveYearField').hidden=!companyBusiness;
 el('aYear').disabled=!companyBusiness;
 el('aYear').value=companyBusiness?(record?.year||''):'';
 el('archiveCategoryField').hidden=simpleCertificate||companyBusiness;
 el('archiveTagsField').hidden=simpleCertificate;
 el('archiveAttachmentField').hidden=!simpleCertificate;
 el('archiveFormHint').textContent=simpleCertificate?'仅资料名称必填，附件与备注选填。':
  companyBusiness?'资料名称必填，可选目录与四位年份；目录可继续向下扩展。':
  '资料名称必填，类别、备注与标签可选。';
 el('archiveFormTitle').textContent=id===null?'新建资料':'修改资料';
 el('archiveExcelImport').hidden=id!==null;
 el('aCategory').value=record?.category??(archiveGroup==='未分类'?'':archiveGroup||'');
 el('aName').value=record?.name??'';
 el('aRemarks').value=record?.remarks??'';
 el('aTags').value=record?.tags??'';
 const datalist=el('archiveCategories');datalist.replaceChildren();
 archiveCategories(page).filter(x=>x!=='未分类').forEach(x=>{
  const opt=document.createElement('option');opt.value=x;datalist.append(opt);
 });
 el('archiveDialog').showModal();
}
function showArchiveTransfer(move){
 const record=(archiveRows[page]||[]).find(r=>r.id===detail?.id);
 if(!record)return;
 const current=archiveDestinations.find(x=>x.workspace===space&&x.section===page);
 const legal=archiveDestinations.filter(x=>x.kind===current?.kind&&
  (!move||x.workspace!==space||x.section!==page));
 if(!legal.length){notice('当前资料类别没有可用的转移目标。',true);return;}
 archiveTransferId=record.id;archiveTransferMode=move?'move':'copy';
 const select=el('archiveDestination');select.replaceChildren();
 legal.forEach(d=>{
  const opt=document.createElement('option');opt.value=d.workspace+':'+d.section;
  opt.textContent=d.label;select.append(opt);
 });
 el('archiveTransferTitle').textContent=move?'转移资料':'复制资料';
 el('archiveTransferDialog').showModal();
}
function mockCardList(k){
 const all=sample(k);
 const visible=all.filter(r=>{
  const data=Object.values(r).join(' ').toLowerCase();
  return data.includes(filterName.toLowerCase())&&(filterKind==='全部类型'||r.type===filterKind);
 });
 const types=[...new Set(all.map(r=>r.type).filter(Boolean))];
 const groups=[...new Set(visible.map(r=>r.type))].map(t=>({
  type:t,rows:visible.filter(r=>r.type===t)
 }));
 const subtitle=(space==='personal'&&personalCategoryNotes[k]?personalCategoryNotes[k]+' · ':'')+'按材料类别归档 · 点击类别进入该类别的多条记录台账';
 const options=['全部类型',...types].map(t=>'<option value="'+escapeHtml(t)+'" '+(t===filterKind?'selected':'')+'>'+escapeHtml(t)+'</option>').join('');
 return heading(title(k),subtitle,'<span class="mockflag">仅演示</span>')+
 '<section class="white filter"><div class="filterline"><div class="field wide"><label>名称 / 关键词</label><input id="filterSearch" placeholder="输入关键词筛选演示资料"></div><div class="field"><label>类别</label><select id="filterKind">'+options+'</select></div><button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><span><b>资料类别</b> <small class="muted">'+groups.length+' 个类别 · '+visible.length+' 条演示记录</small></span><span class="mockflag">类别卡片 / 记录台账</span></div>'+
 (groups.length?'<div class="recordgrid">'+groups.map(g=>archiveCategoryCard(g.type,g.rows)).join('')+'</div>':'<div class="empty">没有符合条件的演示资料</div>')+
 '<div class="tablefoot">当前显示 '+groups.length+' 个类别 · 数据均为界面演示</div></section>';
}
function mockCategoryTable(k,category){
 const rows=sample(k).filter(r=>r.type===category);
 const visible=rows.filter(r=>r.name.toLowerCase().includes(filterName.toLowerCase()));
 return heading(category,title(k)+' / 分类台账 · 一个类别可以归档多条独立记录',
  '<button class="btn" data-archive-back="cards">← 返回类别卡片</button><span class="mockflag">模拟数据</span><button class="btn primary" data-action="demoAdd">＋ 新建记录（演示）</button>')+
 '<section class="white filter"><div class="filterline"><div class="field wide"><label>资料名称</label><input id="filterSearch" placeholder="搜索此类别下的演示记录"></div><button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><span><b>'+escapeHtml(category)+'台账</b> <small class="muted">'+visible.length+' 条示例 / 共 '+rows.length+' 条</small></span><span class="mockflag">仅演示</span></div>'+
 '<div class="tablewrap archive-tablewrap"><table class="data"><thead><tr><th>序号</th><th>资料名称</th><th>资料类别</th><th>附件数量</th><th>操作</th></tr></thead><tbody>'+
 (visible.length?visible.map((r,i)=>'<tr><td>'+(i+1)+'</td><td><button class="link" data-mock-id="'+Number(r.id)+'">'+escapeHtml(r.name)+'</button></td><td>'+escapeHtml(r.type)+'</td><td>'+(Number(r.files)||0)+' 份</td><td><button class="btn btn-sm" data-mock-id="'+Number(r.id)+'">查看详情</button></td></tr>').join('')
 :'<tr><td colspan="5" class="empty">该类别下暂无符合条件的演示记录</td></tr>')+
 '</tbody></table></div><div class="tablefoot">同一类别可对应多条资料及各自的附件 · 尚未接入真实业务</div></section>';
}
function infoRow(label,value){return `<div class="info"><label>${label}</label><strong>${escapeHtml(value||'—')}</strong></div>`;}
function section(name,body,action=''){return `<section class="white detailsection"><div class="detailsectionhead"><h2>${name}</h2>${action}</div><div class="detailbody">${body}</div></section>`;}
function mockFile(name,metadata){return `<div class="fileline"><span class="fileicon">${name.split('.').pop().toUpperCase()}</span><span class="filedesc"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(metadata)}</small></span><button class="btn btn-sm" data-action="demoFile">导出原件</button></div>`;}
function mockDetail(){
 const k=detail.kind,r=sample(k).find(x=>x.id===detail.id);
 if(!r)return heading('记录不存在','演示记录不存在')+`<button class="btn" data-nav="${k}">返回列表</button>`;
 const returnButton=archiveGroup&&['certificate','achievement','academic'].includes(k)?'<button class="btn" data-archive-back="table">← 返回'+escapeHtml(archiveGroup)+'台账</button>':`<button class="btn" data-nav="${k}">← 返回台账</button>`;
 let out=heading(r.name,`独立详情页 · ${title(k)} · 所有区块按顺序展开`,returnButton+'<span class="mockflag">模拟数据</span>');
 if(k==='ip'){
  out+=section('基本信息','<div class="infogrid">'+infoRow('知识产权名称',r.name)+infoRow('知识产权类型',r.type)+infoRow('当前状态',r.status)+infoRow('当前权利人',r.owner)+infoRow('申请/登记号',r.code)+infoRow('申请/登记日期',r.date)+'</div>');
  out+=section('申请与登记信息','<div class="infogrid">'+infoRow('申请人',r.owner)+infoRow('发明人 / 作者','未填写')+infoRow('公开/授权公告信息','未填写')+'</div>');
  out+=section('知识产权附件',mockFile('专利申请文件.pdf','申请材料 · 1.8 MB · v1')+mockFile('受理通知书.pdf','通知文件 · 0.6 MB · v1')+mockFile('电子证书.pdf','证书文件 · 1.1 MB · v2'),stamp());
 }else if(isProject(k)){
  const cs=sample('contract').filter(c=>c.project===r.name);
  out+=section('项目基本信息','<div class="infogrid">'+infoRow('项目名称',r.name)+infoRow('项目类型',r.type)+infoRow('项目编号',r.code)+infoRow('负责人',r.leader)+infoRow('项目状态',r.status)+infoRow('开始日期',r.date)+'</div>');
  out+=section('所属合同',(cs.length?cs.map(c=>`<div class="minirow"><button class="link" data-contract-id="${c.id}">${escapeHtml(c.name)}</button><span>${escapeHtml(c.amount?Number(c.amount).toFixed(2)+' 元':'金额未填')}</span></div>`).join(''):'<div class="empty">暂无合同示例</div>'),'<button class="btn primary" data-action="demoContract">＋ 新建合同（演示）</button>');
  out+=section('项目自身附件',mockFile('项目实施方案.pdf','项目原件 · 2.4 MB · v1')+mockFile('项目说明.docx','项目原件 · 0.8 MB · v2'),stamp());
  out+=section('全部附件汇总',`<p class="hint">此处汇总项目附件及所属合同附件，不重复存储二进制。</p><div class="minirow"><span>项目自身附件</span><strong>2 份</strong></div>${cs.map(c=>`<div class="minirow"><span>${escapeHtml(c.name)}</span><span>${c.files} 份</span></div>`).join('')}`,stamp());
 }else if(k==='contract'){
  out+=section('合同基本信息','<div class="infogrid">'+infoRow('合同名称',r.name)+infoRow('所属项目',r.project)+infoRow('合同编号',r.code)+infoRow('签订日期',r.date)+infoRow('合同金额',r.amount?Number(r.amount).toFixed(2)+' 元':'')+'</div>');
  out+=section('合同附件',mockFile('合同扫描件.pdf','原件示例 · 1.6 MB'),stamp());
 }else{
  out+=section('基本信息','<div class="infogrid">'+infoRow('名称',r.name)+infoRow('类别',r.type)+infoRow('备注','未填写')+'</div>');
  const exampleName=space==='personal'?
    (k==='academic'?'学术与交流材料.pdf':k==='achievement'?'成果与奖励证明.pdf':k==='certificate'?'身份与资质证明.pdf':'归档材料.pdf')
    :'归档证件.pdf';
  out+=section('附件资料',mockFile(exampleName,'原件示例 · 1.2 MB'),stamp());
 }
 out+=section('关联资料','<div class="empty">暂无已关联的演示资料</div>',stamp());
 return out;
}
const searchGroupLabels={project:'项目',contract:'合同',ip:'知识产权',archive:'资质、成果与学术资料',general:'综合及其他资料',file:'附件文件名'};
async function runGlobalSearch(input){
 if(!space||!token)return;
 const q=String(input??'').trim(),workspace=space,serial=++globalSerial;
 globalQuery=q;globalHits=[];globalPending=!!q;globalError='';globalTruncated=false;
 page='search';detail=null;archiveGroup=null;selected.clear();
 filterName='';filterKind='全部类型';filterState='全部状态';
 el('globalSearch').value=q;render();
 if(!q)return;
 try{
  const response=await api('/api/v2/search/'+workspace+'?q='+encodeURIComponent(q));
  const data=await response.json();
  if(serial!==globalSerial||workspace!==space||page!=='search'||!token)return;
  globalHits=Array.isArray(data.results)?data.results:[];
  globalTruncated=!!data.truncated;
 }catch(e){if(serial===globalSerial&&workspace===space)globalError=e.message;}
 finally{if(serial===globalSerial&&workspace===space&&page==='search'){globalPending=false;render();}}
}
function openSearchHit(index){
 const h=globalHits[index];if(!h||!space)return;
 const kind=h.kind==='file'?h.ownerKind:h.kind,id=h.kind==='file'?h.ownerId:h.id;
 const candidates=kind==='general'?liveRows:kind==='project'?projectRows:
  kind==='contract'?contractRows:kind==='ip'?ipRows:
  kind==='archive'?(archiveRows[h.section]||[]):[];
 const row=candidates.find(r=>r.id===id);
 if(!row){notice('记录已发生变化，请重新搜索。',true);return;}
 if(kind==='general')page='general';
 else if(kind==='project')page='researchProject';
 else if(kind==='contract')page='contract';
 else if(kind==='ip')page='ip';
 else if(kind==='archive'){
  page=h.section;
  if(space==='company'&&page==='achievement'){
   archiveFolderId=row.folderId>0?row.folderId:null;
   archiveGroup=archiveFolders.find(f=>f.id===archiveFolderId)?.name||null;
  }else archiveGroup=space==='company'&&page==='certificate'?null:row.category||'未分类';
 }
 else return;
 detail={kind,id};globalSerial++;globalPending=false;
 filterName='';filterKind='全部类型';filterState='全部状态';
 render();el('content').scrollTo(0,0);
}
function searchPage(){
 let out=heading('统一搜索','当前工作区真实业务记录和附件名称检索')+
 '<section class="white search-summary"><strong>'+escapeHtml(globalQuery||'输入关键词后按 Enter 搜索')+'</strong>'+
 '<span class="muted">'+(globalPending?'正在搜索…':globalError?'查询失败':globalQuery?'匹配 '+globalHits.length+' 条':'项目、合同、专利、资料与附件')+'</span></section>';
 if(globalError)return out+'<section class="white empty">'+escapeHtml(globalError)+'</section>';
 if(globalPending)return out+'<section class="white empty">正在检索加密台账…</section>';
 if(!globalQuery)return out+'<section class="white empty">请在顶部搜索框输入关键词并按 Enter。</section>';
 if(!globalHits.length)return out+'<section class="white empty">当前工作区没有匹配的记录或附件。</section>';
 for(const [kind,label] of Object.entries(searchGroupLabels)){
  const hits=globalHits.map((hit,index)=>({hit,index})).filter(item=>item.hit.kind===kind);
  if(!hits.length)continue;
  out+='<section class="white searchgroup"><h2 class="sectiontitle">'+escapeHtml(label)+' <small class="muted">'+hits.length+' 条</small></h2>'+
   hits.map(({hit,index})=>'<div class="minirow search-hit"><button class="link" data-search-index="'+index+'">'+
    escapeHtml(hit.title)+'</button><span class="muted search-hit-description">'+escapeHtml(hit.description||'')+
    '</span></div>').join('')+'</section>';
 }
 if(globalTruncated)out+='<p class="hint">每类最多显示 60 条，请缩小关键词。</p>';
 return out;
}
function settingsPage(){return heading('系统设置','数据库管理与已确认的维护操作','<button class="btn" data-nav="trash">查看回收站</button>')+
 `<section class="white detailsection"><div class="detailsectionhead"><h2>当前加密数据库</h2></div><div class="detailbody"><div class="minirow"><span>数据库文件</span><strong>${escapeHtml(dbName)}</strong></div><div class="minirow"><span>加密状态</span><span class="realflag">SQLCipher 已启用</span></div><div class="minirow"><span>数据库完整性检查</span><button class="btn" data-action="check">立即检查</button></div><div id="checkResult" class="hint"></div><div class="minirow"><span>本机 Codex MCP</span><span class="actions"><span class="hint">${mcpEnabled?'已开启':'默认关闭'}</span><button class="btn" data-action="mcpToggle">${mcpEnabled?'关闭 MCP':'开启 MCP'}</button></span></div><p class="hint">仅允许当前 Windows 用户通过本机 Codex MCP 操作已解锁的数据库；关库或退出自动失效。开启后 Codex 可新增项目、合同及原件。</p><div class="minirow"><span>关闭当前数据库</span><button class="btn" data-action="lock">关闭数据库</button></div></div></section>`+
 section('尚未接入的设置项','<div class="minirow"><span>修改数据库密码</span>'+stamp()+'</div><div class="minirow"><span>记录类别与标签</span>'+stamp()+'</div><p class="hint">手动备份需安全退出程序后在 Windows 资源管理器复制加密库。</p>');}
function trashPage(){
 const names={project:'项目',contract:'合同',ip:'知识产权',archive:space==='company'?'资质与业务档案':'证件与成果',file:'业务附件',general:'综合资料',general_file:'综合资料附件',v2_ip_file:'知识产权原件关联'};
 return heading('回收站','当前工作区的真实已删除记录与附件',
 '<button class="btn" data-nav="settings">返回设置</button>')+
 '<section class="white"><div class="tabletools"><b>已删除 '+trashRows.length+' 条</b><div class="actions">'+
 '<button class="btn" data-action="trashRestoreSelected">恢复勾选</button>'+
 '<button type="button" class="btn trash-purge-selected" data-action="trashPurgeSelected" disabled>永久删除</button></div></div>'+
 '<p class="hint">恢复项目将一并恢复其所属合同与关联附件；永久删除不可撤销。仅支持逐条或勾选多条，不提供一键清空。</p>'+
 '<div class="tablewrap"><table class="data"><thead><tr><th><input type="checkbox" id="trashAll"></th>'+
 '<th>类别</th><th>名称</th><th>原归属</th><th>操作</th></tr></thead><tbody>'+
 (trashRows.length?trashRows.map((r,i)=>'<tr><td><input class="trashcheck" type="checkbox" value="'+i+'"></td>'+
 '<td>'+escapeHtml(names[r.kind]||r.kind)+'</td><td>'+escapeHtml(r.name)+'</td><td>'+
 escapeHtml(r.parent||r.section||'—')+'</td><td>'+
 '<button class="btn btn-sm" data-trash-restore="'+i+'">恢复</button>'+
 '<button class="btn btn-sm" data-trash-purge="'+i+'">永久删除</button></td></tr>').join(''):
 '<tr><td colspan="5" class="empty">回收站为空</td></tr>')+'</tbody></table></div></section>';
}
// The irreversible action is highlighted only when one or more rows are selected.
function syncTrashPurgeSelection(){
 const content=el('content');
 const checks=[...content.querySelectorAll('.trashcheck')];
 const selected=checks.filter(box=>box.checked).length;
 const purge=content.querySelector('[data-action="trashPurgeSelected"]');
 if(purge){
  purge.disabled=selected===0;
  purge.classList.toggle('is-active',selected>0);
 }
 const all=content.querySelector('#trashAll');
 if(all){
  all.checked=checks.length>0&&selected===checks.length;
  all.indeterminate=selected>0&&selected<checks.length;
 }
}
async function changeTrash(operation,indices){
 const items=[...new Set(indices)].map(i=>trashRows[i]).filter(Boolean)
   .map(r=>({kind:r.kind,id:r.id,section:r.section||''}));
 if(!items.length)return notice('请先勾选资料。',true);
 if(operation==='purge'&&!confirm('永久删除选中的 '+items.length+' 条资料及适用附件？该操作不可撤销。'))return;
 try{
  await api('/api/trash/'+space+'/'+operation,{method:'POST',json:{items}});
  await refresh();notice(operation==='restore'?'资料已恢复':'资料已永久删除');
 }catch(e){notice(e.message,true);}
}
function businessAssocOptions(){
 return [
  ...projectRows.map(x=>({kind:'project',id:x.id,section:'',label:'项目 · '+x.name})),
  ...contractRows.map(x=>({kind:'contract',id:x.id,section:'',label:'合同 · '+x.name})),
  ...ipRows.map(x=>({kind:'ip',id:x.id,section:'',label:'知识产权 · '+x.data.name})),
  ...Object.entries(archiveRows).flatMap(([section,rows])=>
   rows.map(x=>({kind:'archive',id:x.id,section,label:'归档 · '+x.name}))),
  ...liveRows.map(x=>({kind:'general',id:x.id,section:'',label:'综合资料 · '+x.title}))
 ];
}
function openBusinessAssoc(id){
 const src=businessFileRows.find(x=>x.id===id);if(!src)return;
 const options=businessAssocOptions().filter(x=>
  !(x.kind===src.kind&&x.id===src.ownerId&&x.section===src.section));
 if(!options.length)return notice('当前工作区没有其它可关联的业务记录。',true);
 pendingAssocId=id;
 const select=el('businessAssocTarget');select.replaceChildren();
 options.forEach((x,i)=>{const opt=document.createElement('option');
  opt.value=String(i);opt.textContent=x.label;select.append(opt);});
 select.dataset.targets=JSON.stringify(options);
 el('businessAssocMode').value='copy';
 el('businessAssocNote').textContent='文件：'+src.name+'。共享同一 FileId 及全部历史版本；移动则解除来源位置关联。';
 el('businessAssocDialog').showModal();
}

function ledgerScope(){
 if(detail?.kind==='project')return {kind:'contract',section:''};
 if(detail)return null;
 if(isProject(page))return {kind:'project',section:''};
 if(page==='ip'||page==='contract')return {kind:page,section:''};
 if(space==='company'&&page==='achievement')return {kind:'archive',section:page};
 if(archiveGroup&&archiveSections.includes(page)&&!(space==='company'&&page==='certificate'))
  return {kind:'archive',section:page};
 return null;
}
function ledgerSourceRows(scope){
 return scope.kind==='project'?projectRows:scope.kind==='ip'?ipRows:
  scope.kind==='contract'?contractRows:(archiveRows[scope.section]||[]);
}
function sortLedgerData(){
 for(const [kind,section,rows] of [
  ['project','',projectRows],['ip','',ipRows],['contract','',contractRows],
  ...Object.entries(archiveRows).filter(([part])=>!(space==='company'&&part==='certificate'))
   .map(([part,items])=>['archive',part,items])
 ]){
  if(['ip','project','contract','archive'].includes(kind))continue; // V2 positions are authoritative.
  const ranks=new Map((ledgerOrders[kind+':'+section]||[]).map((id,i)=>[id,i]));
  const before=new Map(rows.map((row,i)=>[row.id,i]));
  rows.sort((a,b)=>(ranks.get(a.id)??Number.MAX_SAFE_INTEGER)-
   (ranks.get(b.id)??Number.MAX_SAFE_INTEGER)||before.get(a.id)-before.get(b.id));
 }
}
function ledgerRecordId(row,kind){
 const attrs={project:['project-id','projectId'],ip:['ip-id','ipId'],
  contract:['contract-id','contractId'],archive:['archive-id','archiveId']};
 const [attr,key]=attrs[kind],button=row.querySelector('[data-'+attr+']');
 return button?Number(button.dataset[key]):null;
}
function decorateLedgerControls(content){
 const scope=ledgerScope();if(!scope)return;
 const table=detail?.kind==='project'?
  content.querySelector('[data-contract-id]')?.closest('table'):
  content.querySelector('.tablewrap table.data');
 if(!table||!table.tHead||!table.tBodies.length)return;
 table.classList.add('ledger-record-table');
 const head=table.tHead.rows[0],body=table.tBodies[0];
 const rows=[...body.rows].map(tr=>({tr,id:ledgerRecordId(tr,scope.kind)}))
  .filter(x=>Number.isInteger(x.id)&&x.id>0);
 let all=head.querySelector('.ledger-export-all');
 if(!all){
  const th=document.createElement('th');th.className='ledger-record-check-cell';
  all=document.createElement('input');all.type='checkbox';th.append(all);head.prepend(th);
 }else all.closest('th').classList.add('ledger-record-check-cell');
 all.classList.add('ledger-record-all');all.setAttribute('aria-label','全选当前列表');
 const archiveSequence=scope.kind==='archive';
 const mixedArchive=archiveSequence&&space==='company'&&scope.section==='achievement';
 if(!archiveSequence){
  const th=document.createElement('th');th.className='ledger-record-sequence-cell';th.textContent='序号';
  head.cells[0].after(th);
 }else head.cells[1].classList.add('ledger-record-sequence-cell');
 const last=document.createElement('th');last.className='ledger-record-order-cell';last.textContent='排序';
 if(archiveSequence)head.lastElementChild.before(last);
 else head.append(last);
 rows.forEach(({tr,id},index)=>{
  tr.dataset.ledgerRecordId=String(id);
  let check=tr.querySelector('.ledger-export-row');
  if(!check){
   const td=document.createElement('td');td.className='ledger-record-check-cell';
   check=document.createElement('input');check.type='checkbox';check.value=String(id);
   td.append(check);tr.prepend(td);
  }else check.closest('td').classList.add('ledger-record-check-cell');
  check.classList.add('ledger-record-row');
  check.setAttribute('aria-label','选择第'+(index+1)+'条记录');
  if(!archiveSequence){
   const td=document.createElement('td');td.className='ledger-record-sequence-cell';
   td.textContent=String(index+1);tr.cells[0].after(td);
  }else tr.cells[1].classList.add('ledger-record-sequence-cell');
  const td=document.createElement('td');td.className='ledger-record-order-cell';
  if(!mixedArchive)for(const direction of [-1,1]){
   const btn=document.createElement('button');btn.type='button';btn.className='btn btn-sm';
   btn.textContent=direction<0?'↑':'↓';btn.dataset.ledgerMove=String(id);
   btn.dataset.ledgerDirection=String(direction);
   btn.disabled=direction<0?index===0:index===rows.length-1;
   btn.setAttribute('aria-label','将第'+(index+1)+'条记录'+(direction<0?'上移':'下移'));
   td.append(btn);
  }
  if(archiveSequence)tr.lastElementChild.before(td);
  else tr.append(td);
 });
 // Folder rows participate in archive selection/export, not record deletion/order.
 if(mixedArchive){
  for(const tr of body.querySelectorAll('tr[data-archive-folder-row]')){
   const checkCell=document.createElement('td');checkCell.className='ledger-record-check-cell';
   const check=document.createElement('input');check.type='checkbox';
   const folderId=Number(tr.dataset.archiveFolderRow);
   check.className='archive-folder-check';check.dataset.folderId=String(folderId);
   check.setAttribute('aria-label','选择分类');
   check.checked=archiveSelectedFolders.has(folderId);
   checkCell.append(check);tr.prepend(checkCell);
   const orderCell=document.createElement('td');orderCell.className='ledger-record-order-cell';
   tr.lastElementChild.before(orderCell);
  }
  // Unified buttons act on the combined, visible order rather than separate
  // folder/record lists. Persist a complete permutation for the current parent.
  const items=[...body.querySelectorAll('tr[data-archive-entry-kind]')];
  items.forEach((tr,index)=>{
   const kind=tr.dataset.archiveEntryKind,id=Number(tr.dataset.archiveEntryId);
   const cell=tr.querySelector('.ledger-record-order-cell');
   for(const direction of [-1,1]){
    const btn=document.createElement('button');btn.type='button';
    btn.className='btn btn-sm';btn.textContent=direction<0?'↑':'↓';
    btn.dataset.archiveEntryMove=kind+':'+id;
    btn.dataset.archiveEntryDirection=String(direction);
    btn.disabled=direction<0?index===0:index===items.length-1;
    btn.setAttribute('aria-label','将第'+(index+1)+'项'+(direction<0?'上移':'下移'));
    cell.append(btn);
   }
  });
 }
 const empty=body.querySelector('td[colspan]');
 if(empty&&rows.length===0)empty.colSpan+=archiveSequence?2:scope.kind==='contract'?3:2;
 const toolbar=detail?.kind==='project'?
  table.closest('.detailsection')?.querySelector('.tabletools'):
  content.querySelector('.compact-ledger-actions')||content.querySelector('.tabletools .actions');
 if(toolbar){
  const status=document.createElement('span');status.className='ledger-selected-count';status.hidden=true;
  const del=document.createElement('button');del.type='button';del.className='btn ledger-batch-delete';
  del.dataset.action='ledgerBatchDelete';del.textContent='批量删除';del.hidden=true;del.disabled=true;
  toolbar.append(status,del);
 }
 syncLedgerSelection();
}
function syncLedgerSelection(){
 const content=el('content'),table=content?.querySelector('.ledger-record-table');if(!table)return;
 const checks=[...table.querySelectorAll('.ledger-record-row')];
 const folderChecks=space==='company'&&page==='achievement'?
  [...table.querySelectorAll('.archive-folder-check')]:[];
 const recordCount=checks.filter(c=>c.checked).length;
 const count=recordCount+folderChecks.filter(c=>c.checked).length;
 const total=checks.length+folderChecks.length;
 const all=table.querySelector('.ledger-record-all');
 if(all){all.checked=total>0&&count===total;all.indeterminate=count>0&&count<total;}
 const button=content.querySelector('[data-action="ledgerBatchDelete"]');
 if(button){
  const folderSelected=folderChecks.some(c=>c.checked);
  button.hidden=recordCount===0||folderSelected;
  button.disabled=ledgerMutationBusy||recordCount===0||folderSelected;
 }
 const status=content.querySelector('.ledger-selected-count');
 if(status){status.hidden=count===0;status.textContent='已选 '+count+' 项';}
}
async function moveLedgerRecord(id,direction){
 const scope=ledgerScope(),content=el('content'),table=content.querySelector('.ledger-record-table');
 if(scope?.kind==='archive'&&space==='company'&&page==='achievement'){
  await moveArchiveEntry('record',id,direction);return;
 }
 if(!scope||!table||ledgerMutationBusy)return;
 const visible=[...table.querySelectorAll('tr[data-ledger-record-id]')]
  .map(row=>Number(row.dataset.ledgerRecordId));
 const at=visible.indexOf(id),other=visible[at+direction];
 if(at<0||!other)return;
 const ids=ledgerSourceRows(scope).map(x=>x.id);
 const first=ids.indexOf(id),second=ids.indexOf(other);
 if(first<0||second<0)return;
 [ids[first],ids[second]]=[ids[second],ids[first]];
 const chosen=[...table.querySelectorAll('.ledger-record-row:checked')].map(c=>Number(c.value));
 ledgerMutationBusy=true;syncLedgerSelection();
 try{
  await api(scope.kind==='ip'?'/api/v2/ui/ip/'+space+'/order':
   ['project','contract'].includes(scope.kind)?'/api/v2/ui/order/'+space+'/'+scope.kind:
   '/api/v2/ui/archive/'+space+'/'+scope.section+'/order',
   {method:'POST',json:{ids,section:scope.section}});
  if(['ip','project','contract','archive'].includes(scope.kind))await refresh();
  else{ledgerOrders[scope.kind+':'+scope.section]=ids;sortLedgerData();render();}
  el('content').querySelectorAll('.ledger-record-row').forEach(c=>c.checked=chosen.includes(Number(c.value)));
  syncLedgerSelection();notice('顺序已保存。');
 }catch(error){notice('调整排序失败：'+error.message,true);}
 finally{ledgerMutationBusy=false;syncLedgerSelection();}
}

async function moveArchiveEntry(kind,id,direction){
 if(space!=='company'||page!=='achievement'||detail||ledgerMutationBusy||
    archiveFolderId===null)return;
 const table=el('content').querySelector('.company-business-archive');
 if(!table)return;
 const visible=[...table.querySelectorAll('tr[data-archive-entry-kind]')]
  .map(tr=>({kind:tr.dataset.archiveEntryKind,id:Number(tr.dataset.archiveEntryId)}));
 const at=visible.findIndex(x=>x.kind===kind&&x.id===id),next=visible[at+direction];
 if(at<0||!next)return;
 const parentId=archiveFolderId;
 const fullFolders=archiveFolderId===0?[]:archiveFolders.filter(f=>f.parentId===parentId);
 const fullRecords=(archiveRows.achievement||[]).filter(r=>(r.folderId??0)===parentId);
 // The root-level "本级资料" pseudo-directory shares parent 0 with first-level
 // folders in storage, even though those folders have their own card view.
 if(parentId===0)fullFolders.push(...archiveFolders.filter(f=>f.parentId===null));
 const entries=archiveMixedEntries(fullFolders,fullRecords)
  .map(x=>({kind:x.kind,id:x.id}));
 const first=entries.findIndex(x=>x.kind===kind&&x.id===id);
 const second=entries.findIndex(x=>x.kind===next.kind&&x.id===next.id);
 if(first<0||second<0)return;
 [entries[first],entries[second]]=[entries[second],entries[first]];
 const checked=[...table.querySelectorAll('.ledger-record-row:checked')]
  .map(box=>Number(box.value));
 ledgerMutationBusy=true;syncLedgerSelection();
 try{
  await api('/api/v2/folders/company/entries/reorder?section=achievement',{method:'POST',json:{parentId,items:entries}});
  archiveEntryOrders[String(parentId)]=entries;
  render();
  el('content').querySelectorAll('.ledger-record-row').forEach(box=>{
   box.checked=checked.includes(Number(box.value));
  });
  syncLedgerSelection();notice('分类与资料的排列顺序已保存。');
 }catch(error){notice('调整排序失败：'+error.message,true);}
 finally{ledgerMutationBusy=false;syncLedgerSelection();}
}
function render(){
 if(!space||!token)return;
 refreshSidebar();
 const content=el('content');
 content.innerHTML=detail?(detail.kind==='general'?realDetail():detail.kind==='project'?projectDetail():detail.kind==='contract'?contractDetail():detail.kind==='ip'?ipDetail():detail.kind==='archive'?realArchiveDetail():mockDetail()):
   archiveGroup&&archiveSections.includes(page)&&!(space==='company'&&(page==='certificate'||page==='achievement'))?realArchiveTable(page,archiveGroup):
   page==='dashboard'?dashboard():page==='general'?generalList():
   isProject(page)?projectList(page):page==='ip'?ipList():
   page==='contract'?contractList():
   archiveSections.includes(page)?(space==='company'&&page==='certificate'?realCompanyCertificateList():realArchiveCards(page)):
   page==='search'?searchPage():page==='settings'?settingsPage():trashPage();
 compactBusinessListToolbar(content);
 decorateLedgerControls(content);
 const searchBox=el('filterSearch');if(searchBox)searchBox.value=filterName;
 syncCompanyCertificateSelectionUi();
}
async function uploadGeneralBatch(id,files){
 if(localFileTaskActive)return notice('已有文件任务，请等待完成。',true);
 const workspace=space,errors=[];let completed=0,skipped=0;
 localFileTaskActive=true;
 try{
  for(const file of files){
   if(space!==workspace){errors.push('工作区已切换，上传终止');break;}
   if(file.size>MAX_ORIGINAL_BYTES){errors.push(file.name+'：超过 8 GiB');continue;}
   if(!liveRows.some(r=>r.id===id)){errors.push('资料已不存在');break;}
   try{
    const saved=await IPSysNativeIp.upload(api,file,{kind:'general',ownerId:id},workspace);
    if(saved){completed++;await refresh();}else skipped++;
   }catch(err){errors.push(file.name+'：'+err.message);}
  }
 }finally{localFileTaskActive=false;}
 notice('上传完成：成功 '+completed+'，失败 '+errors.length+'，跳过 '+skipped+
  (errors.length?'；'+errors.join('；'):''),errors.length>0);
}
async function download(file){
 try{
  await saveOriginalToDisk(file,IPSysNativeIp.fileUrl(space,file));
  notice('原件已下载：'+file.name);
 }catch(e){if(e.name!=='AbortError')notice(e.message,true);}
}
function openLiveRecord(id){detail={kind:'general',id};page='general';render();el('content').scrollTo(0,0);}
function openMockRecord(kind,id){if(page!==kind)archiveGroup=null;detail={kind,id};page=kind;render();el('content').scrollTo(0,0);}
el('content').addEventListener('click',async ev=>{
 const expandedExport=el('content').querySelector('.certificate-export[open]');
 if(expandedExport&&!ev.target.closest('.certificate-export'))expandedExport.removeAttribute('open');
 for(const menu of el('content').querySelectorAll('.compact-ledger-export[open]')){
  if(!ev.target.closest('.compact-ledger-export')||ev.target.closest('.compact-ledger-export-options button'))menu.removeAttribute('open');
 }
 // Root category cards only navigate; deletion is separate and never opens a card.
 const deleteFolderButton=ev.target.closest('[data-archive-folder-delete]');
 if(deleteFolderButton&&space==='company'&&page==='achievement'&&archiveFolderId===null){
  const id=Number(deleteFolderButton.dataset.archiveFolderDelete);
  const folder=archiveFolders.find(f=>f.id===id&&f.parentId===null);
  if(!folder)return notice('分类不存在，请刷新。',true);
  if(!confirm('确定删除空分类“'+folder.name+'”？分类中含资料或下级分类时不会删除。'))return;
  try{
   await api('/api/v2/folders/company/archive_folder/'+id,{method:'DELETE'});
   await refresh();notice('分类已删除。');
  }catch(error){notice('删除分类失败：'+error.message,true);}
  return;
 }
 const folderCard=ev.target.closest('[data-archive-folder-id]');
 if(folderCard&&space==='company'&&page==='achievement'){
  openArchiveFolder(Number(folderCard.dataset.archiveFolderId));return;
 }
 const categoryCard=ev.target.closest('[data-archive-category]');
 if(categoryCard){
  const category=categoryCard.dataset.archiveCategory;
  if(archiveSections.includes(page)&&archiveCategories(page).includes(category)){
   archiveGroup=category;detail=null;filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();render();el('content').scrollTo(0,0);
  }
  return;
 }
 const target=ev.target.closest('button');if(!target)return;
 if(target.closest('.certificate-export-options'))target.closest('.certificate-export')?.removeAttribute('open');
 if(target.hasAttribute('data-archive-folder-back')&&space==='company'&&page==='achievement'){
  const current=archiveFolders.find(f=>f.id===archiveFolderId);
  openArchiveFolder(current?.parentId??null);return;
 }
 if(target.hasAttribute('data-archive-back')){
  if(target.dataset.archiveBack==='cards')archiveGroup=null;
  detail=null;filterName='';filterKind='全部类型';selected.clear();render();el('content').scrollTo(0,0);return;
 }
 if(target.dataset.nav){setPage(target.dataset.nav);return;}
 if(target.dataset.liveId){openLiveRecord(Number(target.dataset.liveId));return;}
 if(target.dataset.projectId){detail={kind:'project',id:Number(target.dataset.projectId)};render();el('content').scrollTo(0,0);return;}
 if(target.dataset.ipId){detail={kind:'ip',id:Number(target.dataset.ipId)};page='ip';render();el('content').scrollTo(0,0);return;}
 if(target.dataset.archiveEntryMove){
  const [kind,id]=target.dataset.archiveEntryMove.split(':');
  await moveArchiveEntry(kind,Number(id),Number(target.dataset.archiveEntryDirection));return;
 }
 if(target.dataset.ledgerMove){
  await moveLedgerRecord(Number(target.dataset.ledgerMove),Number(target.dataset.ledgerDirection));return;
 }
 if(target.dataset.certificateMove){
  await moveCompanyCertificate(Number(target.dataset.certificateMove),Number(target.dataset.moveDirection));
  return;
 }
 if(target.dataset.certificateDownload){
  await downloadBusinessAttachment(Number(target.dataset.certificateDownload));return;
 }
 if(target.dataset.archiveDownload){
  if(space!=='company'||page!=='achievement')return;
  const originals=archiveRecordZipOriginals(Number(target.dataset.archiveDownload),page);
  if(!originals.length)return notice('该记录尚无可下载的附件。',true);
  if(!globalThis.IPSysExport)return notice('导出模块仍在初始化，请稍后重试。',true);
  await globalThis.IPSysExport.start('zip',originals);
  return;
 }
 if(target.dataset.archiveId){
  detail={kind:'archive',id:Number(target.dataset.archiveId)};render();
  el('content').scrollTo(0,0);return;
 }
 if(target.dataset.trashRestore!==undefined){
  await changeTrash('restore',[Number(target.dataset.trashRestore)]);return;
 }
 if(target.dataset.trashPurge!==undefined){
  await changeTrash('purge',[Number(target.dataset.trashPurge)]);return;
 }
 if(target.dataset.businessAssociate){
  const f=businessFileRows.find(x=>x.id===Number(target.dataset.businessAssociate));
  if(!f)return;
  openBusinessAssoc(Number(target.dataset.businessAssociate));return;
 }
 if(target.dataset.v2IpVersion){
  const f=businessFileRows.find(x=>x.id===Number(target.dataset.v2IpVersion))||
    liveRows.flatMap(r=>r.files).find(x=>x.id===Number(target.dataset.v2IpVersion));
  if(f){const result=await IPSysNativeIp.newVersion(api,f,space);
   if(result===true){await refresh();notice('新文件版本已保存。');}
   else if(result instanceof Error)notice(result.message,true);}
  return;
 }
 if(target.dataset.businessDownload){
  await downloadBusinessAttachment(Number(target.dataset.businessDownload));return;
 }
 if(target.dataset.previewBusiness){
  const file=businessFileRows.find(f=>f.id===Number(target.dataset.previewBusiness));
  if(file){
   if(!file.v2)return notice('附件身份不符，请刷新资料列表。',true);
   await previewOriginal(file,IPSysNativeIp.fileUrl(space,file));
  }
  return;
 }
 if(target.dataset.previewGeneral){
  const row=liveRows.find(x=>x.id===detail?.id);
  const file=row?.files.find(f=>f.id===Number(target.dataset.previewGeneral));
  if(file)await previewOriginal(file,IPSysNativeIp.fileUrl(space,file));
  return;
 }
 if(target.dataset.generalFileDelete){
  const record=liveRows.find(r=>r.id===detail?.id);
  const file=record?.files.find(f=>f.id===Number(target.dataset.generalFileDelete));
  if(!file||!confirm('移除原件“'+file.name+'”（v'+file.version+'）？可以在回收站恢复。'))return;
  try{
   await api('/api/v2/files/'+space+'/'+file.fileId+'/links/'+file.linkId,
     {method:'DELETE'});
   await refresh();notice('原件已移至回收站。');
  }catch(e){notice(e.message,true);}
  return;
 }
 if(target.dataset.businessDelete){
  const fileId=Number(target.dataset.businessDelete);
  const f=businessFileRows.find(x=>x.id===fileId);
  if(!f||!confirm('从这条业务记录中移除“'+f.name+'”（v'+f.version+'）？可在回收站恢复。'))return;
  try{
   if(!f.v2)throw Error('附件身份不符，请刷新资料列表。');
   await api('/api/v2/files/'+space+'/'+f.fileId+'/links/'+f.linkId,{method:'DELETE'});
   await refresh();notice('已从此记录移除附件（未物理删除原件）。');
  }catch(e){notice(e.message,true);}
  return;
 }
 if(target.dataset.mockId){openMockRecord(page,Number(target.dataset.mockId));return;}
 if(target.dataset.contractBackProject){
  const p=projectRows.find(r=>r.id===Number(target.dataset.contractBackProject));
  if(p){page='researchProject';
   detail={kind:'project',id:p.id};render();}
  return;
 }
 if(target.dataset.contractId){
  const parent=detail?.kind==='project'?detail.id:null;
  detail={kind:'contract',id:Number(target.dataset.contractId),returnProject:parent};
  render();el('content').scrollTo(0,0);return;
 }
 if(target.dataset.searchIndex!==undefined){openSearchHit(Number(target.dataset.searchIndex));return;}
 if(target.dataset.download){const r=liveRows.find(r=>r.id===detail?.id);const file=r?.files.find(f=>f.id===Number(target.dataset.download));if(file)await download(file);return;}
 switch(target.dataset.action){
  case 'trashRestoreSelected':
  case 'trashPurgeSelected':{
   const chosen=[...document.querySelectorAll('.trashcheck:checked')].map(x=>Number(x.value));
   await changeTrash(target.dataset.action==='trashRestoreSelected'?'restore':'purge',chosen);break;
  }
  case 'excelExport':{
    const kind=target.dataset.excelKind,section=target.dataset.excelSection||'';
    if(!['project','ip','archive','general','contract'].includes(kind))break;
    try{await exportExcel(kind,'filtered',section);}
    catch(error){notice('Excel 导出失败：'+error.message,true);}
    break;
   }
   case 'moduleExportFolder':
   case 'moduleExportZip':{
    const kind=target.dataset.exportKind,section=target.dataset.exportSection||'';
    if(!['archive','general','contract'].includes(kind))break;
    const ids=kind==='archive'&&space==='company'&&section==='certificate'?
     new Set(certificateExportIds()):
     new Set((target.dataset.exportIds||'').split(',').filter(Boolean).map(Number));
    const records=kind==='general'?liveRows.filter(r=>ids.has(r.id)):
     kind==='contract'?contractRows.filter(r=>ids.has(r.id)):
     (archiveRows[section]||[]).filter(r=>ids.has(r.id));
    const originals=kind==='archive'&&space==='company'&&section==='achievement'?
     (()=>{
      const folders=[...el('content').querySelectorAll('.archive-folder-check:checked')]
       .map(box=>Number(box.dataset.folderId));
      const checkedRecords=[...el('content').querySelectorAll('.ledger-record-row:checked')]
       .map(box=>Number(box.value));
      const selectedAnything=folders.length>0||checkedRecords.length>0;
      const visibleFolders=archiveVisibleFolderIds();
      const visibleRecordIds=records.filter(r=>archiveFolderId!==null||
       (!r.folderId?visibleFolders.includes(0):
        archiveFolderPath(r.folderId).some(f=>visibleFolders.includes(f.id)))).map(r=>r.id);
      return archiveChosenOriginals(selectedAnything?folders:visibleFolders,
       selectedAnything?checkedRecords:visibleRecordIds);
     })():moduleOriginals(records,kind,section);
    if(!originals.length){notice('当前筛选结果没有可导出的附件。',true);break;}
    if(!globalThis.IPSysExport){notice('导出模块仍在初始化，请稍后重试。',true);break;}
    await globalThis.IPSysExport.start(target.dataset.action==='moduleExportFolder'?'folder':'zip',originals);
    break;
   }
   case 'projectExportFolder':
  case 'projectExportZip':{
   const ids=detail?.kind==='project'?[detail.id]:
    [...el('content').querySelectorAll('.ledger-export-row:checked')].map(x=>Number(x.value));
   if(!ids.length){notice('请先勾选要导出的项目。',true);break;}
   const originals=projectOriginals(ids);
   if(!originals.length){
    notice('所选项目及其所属合同没有可导出的原件。',true);break;
   }
   if(!globalThis.IPSysExport){notice('导出功能仍在初始化，请稍后重试。',true);break;}
   await globalThis.IPSysExport.start(target.dataset.action==='projectExportFolder'?'folder':'zip',originals);
   break;
  }
  case 'ipExportFolder':
  case 'ipExportZip':{
   const ids=[...el('content').querySelectorAll('.ledger-export-row:checked')].map(x=>Number(x.value));
   if(!ids.length){notice('请先勾选知识产权记录。',true);break;}
   const originals=ipOriginals(ids);
   if(!originals.length){notice('所选知识产权没有可导出的附件。',true);break;}
   if(!globalThis.IPSysExport){notice('导出模块仍在初始化，请稍后重试。',true);break;}
   await globalThis.IPSysExport.start(target.dataset.action==='ipExportFolder'?'folder':'zip',originals);
   break;
  }
  case 'exportFolder':
  case 'exportZip':{
   const originals=selectedOriginals();
   if(!globalThis.IPSysExport){notice('导出模块仍在初始化，请重试。',true);break;}
   await globalThis.IPSysExport.start(target.dataset.action==='exportFolder'?'folder':'zip',originals);
   break;
  }
  case 'businessUpload':{
   if(!detail||!['project','ip','contract','archive'].includes(detail.kind))break;
   const owner=detail.kind==='archive'?(archiveRows[page]||[]).find(x=>x.id===detail.id):null;
   if(detail.kind==='archive'&&!owner)break;
   pendingBusinessUpload={
    kind:detail.kind,ownerId:detail.id,
    section:detail.kind==='archive'?page:'',
    category:detail.kind==='ip'?(el('businessMaterialCategory')?.value||'其他材料'):'',
    duplicateMode:el('businessReuseExisting')?.checked?'reuse':'independent'
   };
   const chooser=el('businessFileInput');chooser.value='';chooser.click();
   break;
  }
  case 'archiveCreate':el('archiveCreateDialog').showModal();break;
  case 'archiveFolderAdd':showArchiveFolderForm();break;
  case 'archiveFolderEdit':showArchiveFolderForm(archiveFolderId);break;
  case 'archiveExpand':{
   if(space!=='company'||page!=='achievement'||detail?.kind!=='archive')break;
   const record=(archiveRows.achievement||[]).find(r=>r.id===detail.id);
   if(!record||!confirm('以“'+record.name+'”建立下级分类？原资料和附件会保留在此分类内。'))break;
   try{
    const result=await(await api('/api/v2/ui/archive/company/achievement/'+record.id+
      '/expand',{method:'POST'})).json();
    detail=null;archiveFolderId=result.id;archiveGroup=record.name;
    await refresh();notice('已创建下级分类，原有资料及附件已保留。');
   }catch(error){notice(error.message,true);}break;
  }
  case 'archiveAdd':showArchiveForm();break;
  case 'archiveEdit':showArchiveForm(detail?.id);break;
  case 'archiveCopy':showArchiveTransfer(false);break;
  case 'archiveMove':showArchiveTransfer(true);break;
  case 'certificateBatchDelete':{
    if(space!=='company'||page!=='certificate'||certificateDeleteBusy)break;
    const ids=companyCertificateRows().filter(r=>certificateSelected.has(r.id)).map(r=>r.id);
    if(!ids.length)break;
    if(!confirm('确定删除选中的 '+ids.length+' 条企业资质记录吗？删除后可在回收站恢复。'))break;
    certificateDeleteBusy=true;syncCompanyCertificateSelectionUi();
    try{
     for(const id of ids)
       await api('/api/v2/folders/company/archive/'+id+'?section=certificate',
        {method:'DELETE'});
     certificateSelected.clear();
     await refresh();
     notice('已删除 '+ids.length+' 条企业资质记录，可在回收站恢复。');
    }catch(error){notice('批量删除失败：'+error.message,true);}
    finally{certificateDeleteBusy=false;syncCompanyCertificateSelectionUi();}
    break;
   }
   case 'ledgerBatchDelete':{
    const scope=ledgerScope(),table=el('content').querySelector('.ledger-record-table');
    if(!scope||!table||ledgerMutationBusy)break;
    const ids=[...table.querySelectorAll('.ledger-record-row:checked')].map(box=>Number(box.value));
    if(!ids.length)break;
    if(!confirm('确定删除选中的 '+ids.length+' 条记录吗？删除后可在回收站恢复。'))break;
    ledgerMutationBusy=true;syncLedgerSelection();
    try{
     if(['ip','project','contract'].includes(scope.kind)){
      for(const id of ids)await api('/api/v2/folders/'+space+'/'+scope.kind+'/'+id,{method:'DELETE'});
     }else for(const id of ids)
      await api('/api/v2/folders/'+space+'/archive/'+id+'?section='+scope.section,
       {method:'DELETE'});
     await refresh();notice('已删除 '+ids.length+' 条记录，可在回收站恢复。');
    }catch(error){notice('批量删除失败：'+error.message,true);}
    finally{ledgerMutationBusy=false;syncLedgerSelection();}
    break;
   }
   case 'archiveDelete':{
   const record=(archiveRows[page]||[]).find(r=>r.id===detail?.id);
   if(!record||!confirm('移除资料“'+record.name+'”？此操作为软删除。'))break;
   try{
    await api('/api/v2/folders/'+space+'/archive/'+record.id+'?section='+page,
      {method:'DELETE'});
    detail=null;await refresh();notice('资料已从当前台账移除');
   }catch(e){notice(e.message,true);}
   break;
  }
  case 'contractAdd':
   if(detail?.kind==='project')showContractForm(detail.id);break;
  case 'contractEdit':{
   const c=contractRows.find(row=>row.id===detail?.id);
   if(c)showContractForm(c.projectId,c.id);break;
  }
  case 'contractCopy':{
   const c=contractRows.find(row=>row.id===detail?.id);if(!c)break;
   if(!confirm('在“'+c.projectName+'”项目下复制合同“'+c.name+'”？'))break;
   try{
    const response=await api('/api/v2/ui/contracts/'+space+'/'+c.id+'/copy',{method:'POST'});
    const newId=(await response.json()).id;
    const projectReturn=detail.returnProject;
    await refresh();
    detail={kind:'contract',id:newId,returnProject:projectReturn};render();
    notice('合同及全部文件关联已复制到原项目，原件只保留一份，版本共享。');
   }catch(e){notice(e.message,true);}break;
  }
  case 'contractDelete':{
   const c=contractRows.find(row=>row.id===detail?.id);if(!c)break;
   if(!confirm('将合同“'+c.name+'”从台账移除？此操作为软删除。'))break;
   try{
    await api('/api/v2/folders/'+space+'/contract/'+c.id,{method:'DELETE'});
    const projectReturn=detail.returnProject;
    detail=null;
    await refresh();
    if(projectReturn&&projectRows.some(p=>p.id===projectReturn))
      detail={kind:'project',id:projectReturn};
    render();notice('合同已移出当前台账');
   }catch(e){notice(e.message,true);}break;
  }
  case 'ipAdd':showIpForm();break;
  case 'ipEdit':showIpForm(detail?.id);break;
  case 'ipDelete':{
   const row=ipRows.find(r=>r.id===detail?.id);if(!row)break;
   if(!confirm('删除知识产权“'+row.data.name+'”？记录将从台账隐藏。'))break;
   try{await api('/api/v2/folders/'+space+'/ip/'+row.id,{method:'DELETE'});detail=null;await refresh();notice('知识产权记录已删除');}
   catch(e){notice(e.message,true);}break;
  }
  case 'ipCopy':
  case 'ipMove':{
   const row=ipRows.find(r=>r.id===detail?.id);if(!row)break;
   const move=target.dataset.action==='ipMove';
   const other=space==='company'?'personal':'company';
   const destination=move?other:
    (confirm('复制到另一个工作区？取消则在当前工作区复制。')?other:space);
   if(!confirm((move?'转移':'复制')+'知识产权“'+row.data.name+'”以及其全部原件版本至'+
      (destination==='company'?'公司':'个人')+'工作区？'))break;
   try{
    const response=await api('/api/v2/ip/'+space+'/'+row.id+'/transfer',
      {method:'POST',json:{targetWorkspace:destination,move}});
    const copied=await response.json();
    if(move)detail=null;
    await refresh();
    if(!move&&destination===space){detail={kind:'ip',id:copied.id};render();}
    notice((move?'知识产权已转移':'知识产权已复制')+
      '：'+copied.files+' 份原件，'+copied.versions+' 个文件版本。');
   }catch(error){notice('知识产权复制或移动失败：'+error.message,true);}
   break;
  }
  case 'projectAdd':showProjectForm();break;
  case 'projectEdit':showProjectForm(detail?.id);break;
  case 'projectDelete':{
   const p=projectRows.find(x=>x.id===detail?.id);
   if(!p||!confirm('将项目“'+p.name+'”移出当前台账？此操作为软删除。'))break;
   try{await api('/api/v2/folders/'+space+'/project/'+p.id,{method:'DELETE'});detail=null;await refresh();notice('项目已移出当前台账');}
   catch(e){notice(e.message,true);}break;
  }
  case 'projectCopy':
  case 'projectMove':{
   const p=projectRows.find(x=>x.id===detail?.id);if(!p)break;
   const move=target.dataset.action==='projectMove';
   const destination=move?(space==='company'?'personal':'company'):
     (confirm('复制到另一个工作区？选择“取消”将在当前工作区复制。')?(space==='company'?'personal':'company'):space);
   if(!confirm((move?'转移':'复制')+'项目“'+p.name+'”至'+(destination==='company'?'公司资料':'个人资料')+'？'))break;
   try{
    await api('/api/v2/projects/'+space+'/'+p.id+'/transfer',{method:'POST',
     json:{targetWorkspace:destination,move}});
    if(move)detail=null;
    await refresh();notice(move?'项目已转移到另一工作区':'项目已复制');
   }catch(e){notice(e.message,true);}
   break;
  }
  case 'add':
   editingId=null;el('title').value='';el('saveRecord').textContent='创建记录';
   el('newRecordForm').querySelector('h2').textContent=space==='personal'?'新建其他资料':'新建综合资料';
   el('generalExcelImport').hidden=false;
   el('modal').showModal();break;
  case 'editRecord':{
   const r=detail?.kind==='general'?liveRows.find(row=>row.id===detail.id):null;
   if(!r){notice('找不到要修改的记录。',true);break;}
   editingId=r.id;el('title').value=r.title;el('saveRecord').textContent='保存修改';
   el('newRecordForm').querySelector('h2').textContent='修改资料名称';
   el('generalExcelImport').hidden=true;
   el('modal').showModal();break;
  }
  case 'generalCopy':
  case 'generalMove':{
   const record=liveRows.find(r=>r.id===detail?.id);
   if(!record)break;
   const move=target.dataset.action==='generalMove';
   const other=space==='company'?'personal':'company';
   const destination=move?other:
    (confirm('复制到另一个工作区？取消则在当前工作区复制。')?other:space);
   if(!confirm((move?'转移':'复制')+'综合资料“'+record.title+
      '”及所有原件版本至'+(destination==='company'?'公司':'个人')+'工作区？'))break;
   try{
    const response=await api('/api/v2/ui/general/'+space+'/'+record.id+'/transfer',
     {method:'POST',json:{targetWorkspace:destination,move}});
    const result=await response.json();
    if(move)detail=null;
    await refresh();
    if(!move&&destination===space){detail={kind:'general',id:result.id};render();}
    notice((move?'资料已转移':'资料已复制')+
      '：'+result.files+' 份原件，'+result.versions+' 个文件版本。');
   }catch(error){notice('综合资料复制或转移失败：'+error.message,true);}
   break;
  }
  case 'deleteRecord':{
   const record=liveRows.find(r=>r.id===detail?.id);
   if(!record||!confirm('将综合资料“'+record.title+'”及其附件移至回收站？'))break;
   try{
    await api('/api/v2/folders/'+space+'/general/'+record.id,{method:'DELETE'});
    detail=null;await refresh();notice('综合资料已移至回收站。');
   }catch(e){notice(e.message,true);}
   break;
  }
  case 'upload':el('uploadInput')?.click();break;
  case 'filter':filterName=el('filterSearch')?.value.trim()||'';filterKind=el('filterKind')?.value||'全部类型';filterState=el('filterState')?.value||'全部状态';selected.clear();certificateSelected.clear();render();break;
  case 'clearFilter':filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();certificateSelected.clear();render();break;
  case 'mcpToggle':
   try{
    const updated=await(await api('/api/mcp',{method:'POST',json:{enabled:!mcpEnabled}})).json();
    mcpEnabled=!!updated.enabled;render();
    notice(mcpEnabled?'已启用本机 Codex MCP':'已关闭本机 Codex MCP');
   }catch(e){notice(e.message,true);}break;
  case 'check':try{const status=await(await api('/api/check')).json();const out=el('checkResult');if(out)out.textContent='完整性：'+status.result+'；未完成附件：'+status.incomplete;notice(status.result==='ok'?'数据库完整性检查通过':'数据库检查异常',status.result!=='ok');}catch(e){notice(e.message,true);}break;
  case 'lock':await closeDb();break;
  default:notice('当前仅展示界面设计，尚未接入该业务功能');
 }
});
el('businessAssocCancel').onclick=()=>el('businessAssocDialog').close();
el('businessAssocDialog').addEventListener('close',()=>{pendingAssocId=null;});
el('businessAssocForm').onsubmit=async event=>{
 event.preventDefault();
 const id=pendingAssocId,sel=el('businessAssocTarget');
 const target=JSON.parse(sel.dataset.targets||'[]')[Number(sel.value)];
 if(id===null||!target)return notice('请选择有效目标记录。',true);
 const move=el('businessAssocMode').value==='move';
 if(!confirm((move?'移动':'复制')+'所选附件及其历史版本至“'+target.label+'”？'))return;
 el('businessAssocSave').disabled=true;
 try{
  const file=businessFileRows.find(x=>x.id===id);
  if(!file?.v2)throw Error('附件身份不符，请刷新资料列表。');
  await api('/api/v2/files/'+space+'/'+file.fileId+'/associate',
   {method:'POST',json:{linkId:file.linkId,targetFolderId:target.id,move}});
  el('businessAssocDialog').close();await refresh();notice('附件关联操作已完成');
 }catch(e){notice(e.message,true);}
 finally{el('businessAssocSave').disabled=false;}
};
el('businessFileInput').multiple=true;
el('businessFileInput').onchange=async event=>{
 const input=event.target,files=[...(input.files||[])],meta=pendingBusinessUpload;
 pendingBusinessUpload=null;input.value='';
 if(files.length&&meta)await uploadBusinessBatch(files,meta);
};
el('content').addEventListener('change',async ev=>{
 if(ev.target.matches('.certificate-checkall,.certificate-rowcheck')){
  const visible=companyCertificateRows();
  if(ev.target.matches('.certificate-checkall')){
   for(const row of visible){
    if(ev.target.checked)certificateSelected.add(row.id);
    else certificateSelected.delete(row.id);
   }
  }else{
   const id=Number(ev.target.value);
   if(ev.target.checked)certificateSelected.add(id);
   else certificateSelected.delete(id);
  }
  const count=visible.filter(row=>certificateSelected.has(row.id)).length;
  const all=el('content').querySelector('.certificate-checkall');
  if(all)all.checked=visible.length>0&&count===visible.length;
  const status=el('certificateSelectedCount');
  if(status)status.textContent='已选 '+count+' 条';
   syncCompanyCertificateSelectionUi();
 }
 if(ev.target.id==='uploadInput'){
  const files=[...(ev.target.files||[])],id=detail?.id;ev.target.value='';
  if(files.length&&detail?.kind==='general')await uploadGeneralBatch(id,files);
 }
 if(ev.target.matches('.export-checkall')){
  const scope=detail?.kind==='project'?el('content'):
   ev.target.closest('.module-export')||ev.target.closest('.detailsection')||el('content');
  const files=scope.querySelectorAll('.export-filecheck');
  files.forEach(box=>box.checked=ev.target.checked&&box.dataset.exportLatest==='1');
 }
 if(ev.target.matches('.export-filecheck')){
  const scope=ev.target.closest('.module-export')||ev.target.closest('.detailsection');
  const all=scope?.querySelector('.export-checkall');
  if(all)all.checked=[...scope.querySelectorAll('.export-filecheck[data-export-latest="1"]')]
    .every(box=>box.checked);
 }
 if(ev.target.matches('.ledger-export-all')){
  el('content').querySelectorAll('.ledger-export-row').forEach(box=>box.checked=ev.target.checked);
 }
 if(ev.target.matches('.ledger-record-all')&&!ev.target.matches('.ledger-export-all')){
   el('content').querySelectorAll('.ledger-record-row').forEach(box=>box.checked=ev.target.checked);
   if(space==='company'&&page==='achievement'){
    el('content').querySelectorAll('.archive-folder-check').forEach(box=>{
     box.checked=ev.target.checked;
     const folderId=Number(box.dataset.folderId);
     if(box.checked)archiveSelectedFolders.add(folderId);else archiveSelectedFolders.delete(folderId);
    });
   }
  }
 if(ev.target.matches('.archive-folder-check')){
  const folderId=Number(ev.target.dataset.folderId);
  if(ev.target.checked)archiveSelectedFolders.add(folderId);else archiveSelectedFolders.delete(folderId);
 }
  if(ev.target.matches('.ledger-export-row')||ev.target.matches('.ledger-export-all')){
  const rows=[...el('content').querySelectorAll('.ledger-export-row')];
  const checked=rows.filter(box=>box.checked);
  const counter=el('ledgerExportCount');if(counter)counter.textContent='已选 '+checked.length+' 条';
  const all=el('ledgerExportAll');if(all)all.checked=rows.length>0&&checked.length===rows.length;
 }
 if(ev.target.matches('.ledger-record-row,.ledger-record-all,.archive-folder-check'))syncLedgerSelection();
 if(ev.target.id==='trashAll')
  el('content').querySelectorAll('.trashcheck').forEach(c=>c.checked=ev.target.checked);
 if(ev.target.id==='trashAll'||ev.target.matches('.trashcheck'))syncTrashPurgeSelection();
 if(ev.target.id==='checkAll')document.querySelectorAll('.rowcheck').forEach(c=>c.checked=ev.target.checked);
 if(ev.target.matches('.rowcheck')||ev.target.id==='checkAll'){
  selected=new Set([...document.querySelectorAll('.rowcheck:checked')].map(x=>x.value));
  const counter=el('selectionInfo');if(counter)counter.textContent='已勾选 '+selected.size+' 条';
 }
});
el('content').addEventListener('keydown',event=>{
 if(event.key==='Escape')el('content').querySelector('.certificate-export[open]')?.removeAttribute('open');
 if(event.key==='Escape')el('content').querySelectorAll('.compact-ledger-export[open]').forEach(menu=>menu.removeAttribute('open'));
 if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-archive-category],[data-archive-folder-id]')){event.preventDefault();event.target.click();return;}
 if(event.key==='Enter'&&event.target.id==='filterSearch'){event.preventDefault();el('content').querySelector('[data-action=filter]')?.click();}
});
el('globalSearch').onkeydown=event=>{
 if(event.key==='Enter'&&space){event.preventDefault();void runGlobalSearch(el('globalSearch').value);}
};
el('cancelRecord').onclick=()=>{editingId=null;el('modal').close();};
el('modal').addEventListener('close',()=>{editingId=null;});
el('archiveCreateCancel').onclick=()=>el('archiveCreateDialog').close();
el('archiveCreateRecord').onclick=()=>{
 el('archiveCreateDialog').close();showArchiveForm();
};
el('archiveCreateFolder').onclick=()=>{
 el('archiveCreateDialog').close();showArchiveFolderForm();
};
el('archiveFolderCancel').onclick=()=>el('archiveFolderDialog').close();
el('archiveFolderDialog').addEventListener('close',()=>{archiveFolderEditingId=null;});
el('archiveFolderForm').onsubmit=async event=>{
 event.preventDefault();
 if(space!=='company'||page!=='achievement')return;
 const id=archiveFolderEditingId,name=el('archiveFolderName').value.trim();
 const createAtRoot=id===null&&archiveFolderId===null;
 const parentId=id?(Number(el('archiveFolderParent').value)||null):(archiveFolderId||null);
 el('archiveFolderSave').disabled=true;
 try{
  const current=id?archiveFolders.find(f=>f.id===id):null;
   const response=await api('/api/v2/folders/company/archive_folder'+
    (id?'/'+id+'?section=achievement':''),
    {method:id?'PUT':'POST',json:{archiveFolder:{name,parentId:id?current?.parentId??null:parentId}}});
   if(id&&current&&current.parentId!==parentId)
    await api('/api/v2/folders/company/archive_folder/'+id+'/move?section=achievement',
     {method:'POST',json:{parentId}});
  const newId=id||(await response.json()).id;
  el('archiveFolderDialog').close();
  archiveFolderId=createAtRoot?null:newId;archiveGroup=createAtRoot?null:name;
  await refresh();notice(id?'目录已更新。':createAtRoot?'分类已创建。':'下级分类已创建。');
 }catch(error){notice(error.message,true);}
 finally{el('archiveFolderSave').disabled=false;}
};
el('archiveFolderDelete').onclick=async()=>{
 const id=archiveFolderEditingId,folder=archiveFolders.find(f=>f.id===id);
 if(!folder||!confirm('删除空目录“'+folder.name+'”？含资料或下级目录时不会删除。'))return;
 try{
  await api('/api/v2/folders/company/archive_folder/'+id,{method:'DELETE'});
  el('archiveFolderDialog').close();archiveFolderId=folder.parentId||null;
  archiveGroup=null;await refresh();notice('空目录已删除。');
 }catch(error){notice(error.message,true);}
};
el('archiveCancel').onclick=()=>el('archiveDialog').close();
el('archiveDialog').addEventListener('close',()=>{archiveEditingId=null;});
el('archiveForm').onsubmit=async event=>{
 event.preventDefault();
 const id=archiveEditingId,workspace=space,section=page;
 const simpleCertificate=workspace==='company'&&section==='certificate';
 const attachment=simpleCertificate?el('aAttachment').files?.[0]:null;
 const input=Object.fromEntries(new FormData(el('archiveForm')).entries());
 if(workspace==='company'&&section==='achievement')input.folderId=Number(input.folderId);
 el('archiveSave').disabled=true;
 try{
  const path='/api/v2/folders/'+workspace+'/archive'+
   (id===null?'':'/'+id+'?section='+encodeURIComponent(section));
  const response=await api(path,{method:id===null?'POST':'PUT',
    json:{archive:input,...(id===null?{section}:{})}});
  const recordId=id===null?(await response.json()).id:id;
  el('archiveDialog').close();
  let attachmentError=null;
  if(attachment){
   try{
    await uploadBusinessAttachment(attachment,{
     kind:'archive',ownerId:recordId,section:'certificate',
     category:'',mode:'new',duplicateMode:'independent'
    },workspace);
   }catch(error){attachmentError=error.message;}
  }
  await refresh();
  const record=(archiveRows[section]||[]).find(r=>r.id===recordId);
  if(record){
   page=section;
   archiveFolderId=workspace==='company'&&section==='achievement'?
    (record.folderId>0?record.folderId:null):archiveFolderId;
   archiveGroup=simpleCertificate?null:workspace==='company'&&section==='achievement'?
    (archiveFolders.find(f=>f.id===archiveFolderId)?.name||null):record.category||'未分类';
   detail=simpleCertificate?null:{kind:'archive',id:recordId};render();
  }
  notice(attachmentError?'资料已保存，但附件上传失败：'+attachmentError:
   id===null?'资料已创建'+(attachment?'并上传附件':''):'资料修改已保存'+(attachment?'并上传附件':''),!!attachmentError);
 }catch(error){notice(error.message,true);}
 finally{el('archiveSave').disabled=false;}
};
el('archiveTransferCancel').onclick=()=>el('archiveTransferDialog').close();
el('archiveTransferDialog').addEventListener('close',()=>{
 archiveTransferId=null;archiveTransferMode=null;
});
el('archiveTransferForm').onsubmit=async event=>{
 event.preventDefault();
 const id=archiveTransferId,move=archiveTransferMode==='move';
 const sourceWorkspace=space,sourceSection=page;
 const [targetWorkspace,targetSection]=el('archiveDestination').value.split(':');
 if(id===null)return;
 el('archiveTransferSave').disabled=true;
 try{
  await api('/api/v2/ui/archive/'+sourceWorkspace+'/'+sourceSection+'/'+id+'/transfer',
   {method:'POST',json:{targetWorkspace,targetSection,move}});
  el('archiveTransferDialog').close();
  if(move)detail=null;
  await refresh();notice(move?'资料已转移':'资料已复制');
 }catch(error){notice(error.message,true);}
 finally{el('archiveTransferSave').disabled=false;}
};
el('contractCancel').onclick=()=>el('contractDialog').close();
el('contractDialog').addEventListener('close',()=>{contractEditingId=null;contractProjectId=null;});
el('contractForm').onsubmit=async event=>{
 event.preventDefault();
 const id=contractEditingId,projectId=contractProjectId,workspace=space;
 if(projectId===null)return notice('合同缺少所属项目，无法保存。',true);
 const data=Object.fromEntries(new FormData(el('contractForm')).entries());
 el('contractSave').disabled=true;
 try{
  const endpoint='/api/v2/folders/'+workspace+'/contract'+(id===null?'':'/'+id);
  const response=await api(endpoint,{method:id===null?'POST':'PUT',
   json:{contract:data,...(id===null?{parentId:projectId}:{})}});
  const savedId=id===null?(await response.json()).id:id;
  const projectReturn=detail?.kind==='project'?projectId:detail?.returnProject||null;
  el('contractDialog').close();
  await refresh();
  detail={kind:'contract',id:savedId,returnProject:projectReturn};render();
  notice(id===null?'合同已创建并关联项目':'合同修改已保存');
 }catch(error){notice(error.message,true);}
 finally{el('contractSave').disabled=false;}
};
el('ipCancel').onclick=()=>el('ipDialog').close();
el('ipDialog').addEventListener('close',()=>{ipEditingId=null;});
el('ip-ipType').onchange=()=>ipUpdateStatus();
el('ipForm').onsubmit=async ev=>{
 ev.preventDefault();
 const id=ipEditingId;
 const fields=Object.fromEntries(new FormData(el('ipForm')).entries());
 el('ipSave').disabled=true;
 try{
  const resp=await api('/api/v2/folders/'+space+'/ip'+(id===null?'':'/'+id),
   {method:id===null?'POST':'PUT',json:{ip:fields}});
  const created=id===null?(await resp.json()).id:id;
  el('ipDialog').close();await refresh();
  if(ipRows.some(r=>r.id===created)){page='ip';detail={kind:'ip',id:created};render();}
  notice(id===null?'知识产权已创建':'知识产权修改已保存');
 }catch(error){notice(error.message,true);}
 finally{el('ipSave').disabled=false;}
};
function bindExcelCreate(prefix,kind,dialogId,isNew,sectionOf=()=> ''){
 const template=el(prefix+'ExcelTemplate'),choose=el(prefix+'ExcelChoose'),input=el(prefix+'ExcelFile');
 template.onclick=async()=>{
  if(!isNew())return;
  const section=sectionOf();
  try{
   const query=kind==='archive'?'?section='+encodeURIComponent(section):'';
   const endpoint='/api/v2/excel/'+space+'/'+kind;
    const response=await api(endpoint+'/template'+query);
   await saveExcel(response,kind+(section?'-'+section:'')+'-template.xlsx');
  }catch(error){notice('下载 Excel 模板失败：'+error.message,true);}
 };
 choose.onclick=()=>{if(!isNew())return;
  input.value='';input.click();};
 input.onchange=async event=>{
  const file=event.target.files?.[0];event.target.value='';
  if(!file||!isNew())return;
  const section=sectionOf();
  el(dialogId).close();
  await importExcel(kind,file,section);
 };
}
bindExcelCreate('project','project','projectDialog',()=>projectEditingId===null);
bindExcelCreate('ip','ip','ipDialog',()=>ipEditingId===null);
bindExcelCreate('archive','archive','archiveDialog',()=>archiveEditingId===null,()=>page);
bindExcelCreate('general','general','modal',()=>editingId===null);
el('cancelProject').onclick=()=>el('projectDialog').close();
el('projectDialog').addEventListener('close',()=>{projectEditingId=null;});
el('projectForm').onsubmit=async ev=>{
 ev.preventDefault();
 const id=projectEditingId;
 const values=Object.fromEntries(new FormData(el('projectForm')).entries());
 el('saveProject').disabled=true;
 try{
  const result=await api('/api/v2/folders/'+space+'/project'+(id===null?'':'/'+id),
   {method:id===null?'POST':'PUT',json:{project:values}});
  const created=id===null?(await result.json()).id:id;
  el('projectDialog').close();
  await refresh();
  const project=projectRows.find(p=>p.id===created);
  if(project){
   page='researchProject';
   detail={kind:'project',id:created};
   render();
  }
  notice(id===null?'项目已创建':'项目修改已保存');
 }catch(error){notice(error.message,true);}
 finally{el('saveProject').disabled=false;}
};
el('newRecordForm').onsubmit=async ev=>{
 ev.preventDefault();el('saveRecord').disabled=true;
 const name=el('title').value.trim(),target=editingId,workspace=space;
 try{
  if(target!==null)
   await api('/api/v2/folders/'+workspace+'/general/'+target,
    {method:'PUT',json:{general:{title:name}}});
  else
   await api('/api/v2/folders/'+workspace+'/general',
    {method:'POST',json:{general:{title:name}}});
  el('modal').close();editingId=null;el('title').value='';
  if(target===null)setPage('general');
  await refresh();
  notice(target!==null?'资料名称已更新':workspace==='personal'?'新建其他资料成功':'新建综合资料成功');
 }catch(e){notice(e.message,true);}finally{el('saveRecord').disabled=false;}
};
async function closeDb(){
 if(localFileTaskActive)return notice('文件任务进行中，请等待任务完成后再关闭数据库。',true);
 if(!confirm('关闭当前数据库？本地程序将继续运行，再次打开需要输入数据库密码。'))return;
 try{
  await api('/api/lock',{method:'POST'});
  token='';dbName='';space=null;page='dashboard';detail=null;archiveGroup=null;
  liveRows=[];projectRows=[];ipRows=[];contractRows=[];businessFileRows=[];trashRows=[];
  archiveRows={certificate:[],achievement:[],academic:[]};globalHits=[];globalQuery='';
  sessionStorage.clear();el('password').value='';el('confirm').value='';
  recoveryMode(false);mode(false);screen(false);notice('数据库已关闭，程序仍在运行');
 }catch(e){notice(e.message,true);}
}
el('closeDbFromChoice').onclick=closeDb;
el('closeDbButton').onclick=closeDb;
(async()=>{
 mode(false);
 try{const status=await(await api('/api/status')).json();el('dbPath').value=status.suggestion;
  let valid=false;
  if(status.unlocked&&token){try{await api('/api/check');valid=true;}catch{valid=false;}}
  if(status.unlocked&&valid){recoveryMode(false);space=null;screen(true);}
  else if(status.unlocked){token='';dbName='';space=null;sessionStorage.clear();recoveryMode(true);screen(false);}
  else{token='';dbName='';space=null;sessionStorage.clear();recoveryMode(false);screen(false);}
 }catch(error){notice('本地服务不可用：'+error.message,true);}
})();