/* IPSys UI-first main entry: real SQLCipher general records + clearly marked design-only pages. */
"use strict";
const el=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token=sessionStorage.getItem('ip-token')||'';
let dbName=sessionStorage.getItem('ip-db')||'';
let space=null,creating=true,resuming=false,localFileTaskActive=false;
let page='dashboard',detail=null,liveRows=[],filterName='',filterKind='全部类型',filterState='全部状态',selected=new Set();
const companyNav=[['dashboard','工作台','▦'],['ip','知识产权','◇'],['researchProject','科研项目','▤'],['horizontalProject','横向项目','▥'],['contract','全部合同','▧'],['certificate','企业资质','▣'],['general','综合资料','▥']];
const personalNav=[['dashboard','个人工作台','▦'],['ip','个人知识产权','◇'],['researchProject','个人科研项目','▤'],['horizontalProject','个人横向项目','▥'],['contract','个人合同','▧'],['certificate','个人证件','▣'],['general','个人综合资料','▥']];
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
    ip:[{id:1,name:'一种轻量化传感器安装方法',type:'发明专利',code:'CN202510112233.4',status:'申请中',owner:'个人示例',date:'2025-03-16',files:2}],
    researchProject:[{id:1,name:'个人专业技术研究课题',type:'科研项目',code:'GR-2026-001',status:'进行中',leader:'个人示例',date:'2026-02-15',files:2}],
    horizontalProject:[{id:2,name:'合作技术咨询项目',type:'横向项目',code:'GR-2025-002',status:'已完成',leader:'个人示例',date:'2025-08-03',files:1}],
    contract:[{id:1,name:'个人技术咨询合同',project:'合作技术咨询项目',code:'GRHT-2025-01',date:'2025-09-12',amount:'12000.00',files:1}],
    certificate:[{id:1,name:'学历学位证书',type:'学历学位',files:2},{id:2,name:'专业技术资格证书',type:'职称资格',files:1}]
  }
};
const labels=()=>space==='personal'?personalNav:companyNav;
const title=k=>(labels().find(x=>x[0]===k)||[])[1]||({search:'统一搜索',trash:'回收站',settings:'系统设置'}[k]||'记录详情');
const sample=k=>(mock[space]&&mock[space][k])||[];
const isProject=k=>k==='researchProject'||k==='horizontalProject';
const fmtSize=n=>n>=1024*1024?(n/1024/1024).toFixed(1)+' MiB':(n/1024).toFixed(1)+' KiB';
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
function mode(value){creating=value;el('newMode').classList.toggle('chosen',value);el('oldMode').classList.toggle('chosen',!value);el('confirmWrap').hidden=!value;el('submitOpen').textContent=value?'创建并进入':'解锁并进入';}
function recoveryMode(active){
  resuming=active;el('dbPathWrap').hidden=active;el('resumeHint').hidden=!active;el('dbPath').required=!active;
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
  space=next;page='dashboard';detail=null;filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();
  el('globalSearch').value='';el('sidebarDbName').textContent=dbName;
  el('chooseWorkspace').hidden=true;el('unlocked').hidden=false;
  refresh();
}
document.querySelectorAll('[data-workspace-choice]').forEach(b=>b.onclick=()=>selectSpace(b.dataset.workspaceChoice));
el('workspaceBtn').onclick=()=>{space=null;el('unlocked').hidden=true;el('chooseWorkspace').hidden=false;};
function setPage(next){page=next;detail=null;filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();el('globalSearch').value='';render();}
async function refresh(){
  if(!token||!space)return;
  const requestedSpace=space;
  try{const rows=await(await api('/api/records/'+space)).json();
    if(requestedSpace!==space||!token)return;
    liveRows=rows;render();
  }catch(error){notice(error.message,true);}
}
function refreshSidebar(){
  document.documentElement.dataset.workspace=space;
  el('workspacelabel').textContent=space==='company'?'公司资料':'个人资料';
  const nav=el('sidebar');nav.replaceChildren();
  for(const [key,name,ico] of labels()){
    const b=document.createElement('button');b.type='button';b.className='nav'+(page===key?' active':'');b.textContent=ico+'   '+name;b.onclick=()=>setPage(key);nav.append(b);
  }
  const bottom=el('bottomnav');bottom.replaceChildren();
  for(const [key,name,ico] of [['trash','回收站','♺'],['settings','系统设置','⚙']]){
    const b=document.createElement('button');b.type='button';b.className='nav'+(page===key?' active':'');b.textContent=ico+'   '+name;b.onclick=()=>setPage(key);bottom.append(b);
  }
}
function heading(name,subtitle,actions=''){
 return `<div class="breadcrumb">${space==='company'?'公司资料':'个人资料'} / ${escapeHtml(name)}</div><div class="heading"><div><h1>${escapeHtml(name)}</h1><div class="subtitle">${subtitle}</div></div><div class="actions">${actions}</div></div>`;
}
function pill(text){return `<span class="pill">${escapeHtml(text)}</span>`;}
function stamp(){return '<span class="mockflag">界面示例 · 未接入业务</span>';}
function dashboard(){
 const mods=labels().filter(x=>x[0]!=='dashboard');
 const general=liveRows.length;const fileCount=liveRows.reduce((n,r)=>n+r.files.length,0);
 const counts=[['综合资料',general,'条真实记录'],['已归档原件',fileCount,'份真实附件'],['知识产权',sample('ip').length,'条界面示例'],['科研项目',sample('researchProject').length,'条界面示例']];
 return heading(title('dashboard'),'当前工作区 · 真实综合资料与其余模块的界面示例')+
 '<div class="cards">'+counts.map(([name,num,s])=>`<div class="card"><div class="metriclabel">${name}</div><div class="metric">${num}</div><div class="metricfoot">${s}</div></div>`).join('')+'</div>'+
 '<div class="panels"><section class="card"><h2 class="sectiontitle">业务模块快捷入口</h2><div class="modulegrid">'+mods.map(([key,name])=>`<button class="modulelink" data-nav="${key}"><span><b>${name}</b><small>${key==='general'?general+' 条真实记录':(sample(key).length||0)+' 条演示记录'}</small></span><span class="arrow">→</span></button>`).join('')+'</div></section>'+
 '<section class="card"><h2 class="sectiontitle">当前工作区资料概况</h2><div class="minirow"><span>公司 / 个人隔离</span><strong>已启用</strong></div><div class="minirow"><span>综合资料存储</span><strong>真实 SQLCipher</strong></div><div class="minirow"><span>知识产权、项目与合同</span>'+pill('界面设计')+'</div><div class="minirow"><span>当前数据库</span><span class="muted">'+escapeHtml(dbName)+'</span></div><p class="hint">界面设计阶段，未开发模块的数据仅为样例。真实文件请在“综合资料”中管理。</p></section></div>';
}
function generalList(){
 const rows=liveRows.filter(r=>r.title.toLowerCase().includes(filterName.toLowerCase()));
 return heading(title('general'),'综合资料使用当前加密库的真实记录和附件数据。',`<button class="btn primary" data-action="add">＋ 新建资料</button>`)+
 '<section class="white filter"><div class="filterline"><div class="field wide"><label>资料名称</label><input id="filterSearch" placeholder="搜索当前工作区资料"></div><button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><span><b>资料列表</b> <small class="muted">'+rows.length+' 条真实记录</small></span><div class="actions"><span class="realflag">真实数据库</span><button class="btn" data-action="check">检查数据库</button></div></div>'+
 '<div class="tablewrap"><table class="data"><thead><tr><th>资料名称</th><th>附件数量</th><th>所属工作区</th><th>操作</th></tr></thead><tbody>'+
 (rows.length?rows.map(r=>`<tr><td><button class="link" data-live-id="${r.id}">${escapeHtml(r.title)}</button></td><td>${r.files.length} 份</td><td>${space==='company'?'公司资料':'个人资料'}</td><td><button class="btn btn-sm" data-live-id="${r.id}">查看详情</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty">没有符合条件的资料。可先创建记录，再上传附件。</td></tr>')+'</tbody></table></div><div class="tablefoot">共 '+rows.length+' 条记录 · 数据来自当前加密资料库</div></section>';
}
function realDetail(){
 const r=liveRows.find(r=>r.id===detail.id);
 if(!r)return heading('记录详情','记录不存在或当前工作区无权访问')+'<button class="btn" data-nav="general">返回台账</button>';
 return heading(r.title,'综合资料 / 记录详情 · 当前加密库真实数据',`<button class="btn" data-nav="general">← 返回台账</button>`)+
 `<section class="white detailsection"><div class="detailsectionhead"><h2>基本信息</h2><span class="realflag">真实记录</span></div><div class="detailbody infogrid"><div class="info"><label>资料名称</label><strong>${escapeHtml(r.title)}</strong></div><div class="info"><label>所属工作区</label><strong>${space==='company'?'公司资料':'个人资料'}</strong></div><div class="info"><label>已归档附件</label><strong>${r.files.length} 份</strong></div></div></section>`+
 `<section class="white detailsection"><div class="detailsectionhead"><h2>附件资料</h2><button class="btn primary" data-action="upload">＋ 上传原件</button></div><div class="detailbody"><input type="file" id="uploadInput" hidden><p class="hint">当前原型支持真实上传与下载，单文件不超过 64 MiB。附件展示在该记录下。</p>`+
 (r.files.length?r.files.map(f=>`<div class="fileline"><span class="fileicon">${escapeHtml(f.name.split('.').pop().slice(0,4).toUpperCase())}</span><span class="filedesc"><strong>${escapeHtml(f.name)}</strong><small>${fmtSize(f.size)} · SHA-256 ${escapeHtml(f.sha256.slice(0,16))}…</small></span><button class="btn btn-sm" data-download="${f.id}">下载原件</button></div>`).join(''):'<div class="empty">暂无附件，点击“上传原件”开始归档。</div>')+'</div></section>'+
 '<section class="white detailsection"><div class="detailsectionhead"><h2>关联资料</h2>'+stamp()+'</div><div class="empty">关联功能尚待开发</div></section>';
}
function columns(k){
 if(k==='ip')return [['name','名称'],['type','知识产权类型'],['code','申请/登记号'],['status','状态'],['owner','当前权利人'],['date','申请/登记日期'],['files','附件']];
 if(isProject(k))return [['name','项目名称'],['type','项目类别'],['code','项目编号'],['status','项目状态'],['leader','负责人'],['date','开始日期'],['files','附件']];
 if(k==='contract')return [['name','合同名称'],['project','所属项目'],['code','合同编号'],['date','签订日期'],['amount','合同金额（元）'],['files','附件']];
 return [['name','名称'],['type','类别'],['files','附件']];
}
function mockList(k){
 const all=sample(k);
 const visible=all.filter(r=>{
  const text=Object.values(r).join(' ').toLowerCase();
  return text.includes(filterName.toLowerCase())&&(filterKind==='全部类型'||r.type===filterKind)&&(filterState==='全部状态'||r.status===filterState);
 });
 const types=[...new Set(all.map(x=>x.type).filter(Boolean))];const states=[...new Set(all.map(x=>x.status).filter(Boolean))];
 const cols=columns(k);
 return heading(title(k),'台账页面布局预览 · 记录均为虚构样例',`<span class="mockflag">仅演示</span>${k==='contract'?'':`<button class="btn primary" data-action="demoAdd">＋ 新建${isProject(k)?'项目':'记录'}</button>`}`)+
 `<section class="white filter"><div class="filterline"><div class="field wide"><label>名称 / 编号</label><input id="filterSearch" placeholder="输入关键词筛选演示记录"></div><div class="field"><label>类型</label><select id="filterKind">${['全部类型',...types].map(x=>`<option value="${escapeHtml(x)}" ${x===filterKind?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select></div>`+
 (states.length?`<div class="field"><label>状态</label><select id="filterState">${['全部状态',...states].map(x=>`<option value="${escapeHtml(x)}" ${x===filterState?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select></div>`:'')+
 '<button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><span><b>业务台账</b> <small class="muted">'+visible.length+' 条示例</small></span><div class="actions"><button class="btn" data-action="demoExcel">导出 XLSX（演示）</button><button class="btn" data-action="demoColumns">列设置（演示）</button></div></div>'+
 '<div class="tablewrap"><table class="data"><thead><tr><th><input type="checkbox" id="checkAll"></th>'+cols.map(c=>`<th>${c[1]}</th>`).join('')+'</tr></thead><tbody>'+
 (visible.length?visible.map(r=>`<tr><td><input type="checkbox" class="rowcheck" value="${r.id}"></td>`+cols.map(([field],i)=>`<td>${field==='name'?`<button class="link" data-mock-id="${r.id}">${escapeHtml(r[field])}</button>`:field==='amount'?(r[field]?Number(r[field]).toFixed(2):'—'):field==='status'?`<span class="tag">${escapeHtml(r[field]||'—')}</span>`:escapeHtml(r[field]??'—')}</td>`).join('')+'</tr>').join(''):`<tr><td colspan="${cols.length+1}" class="empty">没有符合条件的演示记录</td></tr>`)+
 '</tbody></table></div><div class="tablefoot"><span>显示 '+visible.length+' 条演示记录</span><span id="selectionInfo">已勾选 0 条</span></div></section>';
}
function infoRow(label,value){return `<div class="info"><label>${label}</label><strong>${escapeHtml(value||'—')}</strong></div>`;}
function section(name,body,action=''){return `<section class="white detailsection"><div class="detailsectionhead"><h2>${name}</h2>${action}</div><div class="detailbody">${body}</div></section>`;}
function mockFile(name,metadata){return `<div class="fileline"><span class="fileicon">${name.split('.').pop().toUpperCase()}</span><span class="filedesc"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(metadata)}</small></span><button class="btn btn-sm" data-action="demoFile">导出原件</button></div>`;}
function mockDetail(){
 const k=detail.kind,r=sample(k).find(x=>x.id===detail.id);
 if(!r)return heading('记录不存在','演示记录不存在')+`<button class="btn" data-nav="${k}">返回列表</button>`;
 let out=heading(r.name,`独立详情页 · ${title(k)} · 所有区块按顺序展开`,`<button class="btn" data-nav="${k}">← 返回台账</button><span class="mockflag">模拟数据</span>`);
 if(k==='ip'){
  out+=section('基本信息','<div class="infogrid">'+infoRow('知识产权名称',r.name)+infoRow('知识产权类型',r.type)+infoRow('当前状态',r.status)+infoRow('当前权利人',r.owner)+infoRow('申请/登记号',r.code)+infoRow('申请/登记日期',r.date)+'</div>');
  out+=section('申请与登记信息','<div class="infogrid">'+infoRow('申请人',r.owner)+infoRow('发明人 / 作者','未填写')+infoRow('公开/授权公告信息','未填写')+'</div>');
  out+=section('知识产权附件',mockFile('专利申请文件.pdf','申请材料 · 1.8 MB · v1')+mockFile('受理通知书.pdf','通知文件 · 0.6 MB · v1')+mockFile('电子证书.pdf','证书文件 · 1.1 MB · v2'),stamp());
 }else if(isProject(k)){
  const cs=sample('contract').filter(c=>c.project===r.name);
  out+=section('项目基本信息','<div class="infogrid">'+infoRow('项目名称',r.name)+infoRow('项目类别',r.type)+infoRow('项目编号',r.code)+infoRow('负责人',r.leader)+infoRow('项目状态',r.status)+infoRow('开始日期',r.date)+'</div>');
  out+=section('所属合同',(cs.length?cs.map(c=>`<div class="minirow"><button class="link" data-contract-id="${c.id}">${escapeHtml(c.name)}</button><span>${escapeHtml(c.amount?Number(c.amount).toFixed(2)+' 元':'金额未填')}</span></div>`).join(''):'<div class="empty">暂无合同示例</div>'),'<button class="btn primary" data-action="demoContract">＋ 新建合同（演示）</button>');
  out+=section('项目自身附件',mockFile('项目实施方案.pdf','项目原件 · 2.4 MB · v1')+mockFile('项目说明.docx','项目原件 · 0.8 MB · v2'),stamp());
  out+=section('全部附件汇总',`<p class="hint">此处汇总项目附件及所属合同附件，不重复存储二进制。</p><div class="minirow"><span>项目自身附件</span><strong>2 份</strong></div>${cs.map(c=>`<div class="minirow"><span>${escapeHtml(c.name)}</span><span>${c.files} 份</span></div>`).join('')}`,stamp());
 }else if(k==='contract'){
  out+=section('合同基本信息','<div class="infogrid">'+infoRow('合同名称',r.name)+infoRow('所属项目',r.project)+infoRow('合同编号',r.code)+infoRow('签订日期',r.date)+infoRow('合同金额',r.amount?Number(r.amount).toFixed(2)+' 元':'')+'</div>');
  out+=section('合同附件',mockFile('合同扫描件.pdf','原件示例 · 1.6 MB'),stamp());
 }else{
  out+=section('基本信息','<div class="infogrid">'+infoRow('名称',r.name)+infoRow('类别',r.type)+infoRow('备注','未填写')+'</div>');
  out+=section('附件资料',mockFile('归档证件.pdf','原件示例 · 1.2 MB'),stamp());
 }
 out+=section('关联资料','<div class="empty">暂无已关联的演示资料</div>',stamp());
 return out;
}
function searchPage(){
 const q=filterName.toLowerCase();
 const datasets=labels().filter(([k])=>k!=='dashboard').map(([k,n])=>({k,n,rows:k==='general'?liveRows.filter(r=>r.title.toLowerCase().includes(q)):sample(k).filter(r=>Object.values(r).join(' ').toLowerCase().includes(q))})).filter(g=>g.rows.length);
 return heading('统一搜索','当前工作区跨模块查找 · 综合资料为真实数据，其他模块为界面示例')+
 (datasets.length?datasets.map(g=>`<section class="card searchgroup"><h2 class="sectiontitle">${escapeHtml(g.n)} <small class="muted">${g.rows.length} 条</small> ${g.k==='general'?'<span class="realflag">真实数据</span>':stamp()}</h2>${g.rows.map(r=>`<div class="minirow"><button class="link" ${g.k==='general'?`data-live-id="${r.id}"`:`data-search-detail="${g.k}:${r.id}"`}>${escapeHtml(g.k==='general'?r.title:r.name)}</button><span class="muted">进入详情 →</span></div>`).join('')}</section>`).join(''):'<section class="white empty">当前工作区没有匹配的资料。</section>');
}
function settingsPage(){return heading('系统设置','数据库管理与已确认的维护操作')+
 `<section class="white detailsection"><div class="detailsectionhead"><h2>当前加密数据库</h2></div><div class="detailbody"><div class="minirow"><span>数据库文件</span><strong>${escapeHtml(dbName)}</strong></div><div class="minirow"><span>加密状态</span><span class="realflag">SQLCipher 已启用</span></div><div class="minirow"><span>数据库完整性检查</span><button class="btn" data-action="check">立即检查</button></div><div id="checkResult" class="hint"></div><div class="minirow"><span>关闭当前数据库</span><button class="btn" data-action="lock">关闭数据库</button></div></div></section>`+
 section('尚未接入的设置项','<div class="minirow"><span>修改数据库密码</span>'+stamp()+'</div><div class="minirow"><span>记录类别与标签</span>'+stamp()+'</div><p class="hint">手动备份需安全退出程序后在 Windows 资源管理器复制加密库。</p>');}
function trashPage(){return heading('回收站','删除记录和附件的恢复、永久清理界面布局 · 仅演示')+
 `<section class="white"><div class="tabletools"><b>已删除资料</b>${stamp()}</div><div class="empty">此功能尚未接入真实数据库。</div></section>`;}
function render(){
 if(!space||!token)return;
 refreshSidebar();
 const content=el('content');
 content.innerHTML=detail?(detail.kind==='general'?realDetail():mockDetail()):
   page==='dashboard'?dashboard():page==='general'?generalList():
   ['ip','researchProject','horizontalProject','contract','certificate'].includes(page)?mockList(page):
   page==='search'?searchPage():page==='settings'?settingsPage():trashPage();
 const searchBox=el('filterSearch');if(searchBox)searchBox.value=filterName;
}
async function upload(id,file){
 if(file.size>64*1024*1024)return notice('本阶段单文件不能超过 64 MiB',true);
 if(localFileTaskActive)return notice('当前已有文件上传任务，请等待完成',true);
 notice('正在向加密资料库写入文件…');localFileTaskActive=true;
 const destSpace=space;
 try{
  const result=await(await api(`/api/records/${destSpace}/${id}/files`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file})).json();
  notice('已成功归档文件，SHA-256 '+result.sha256.slice(0,16)+'…');await refresh();
 }catch(e){notice(e.message,true);}finally{localFileTaskActive=false;}
}
async function download(file){
 try{const result=await api(`/api/files/${space}/${file.id}`);const blob=await result.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);notice('已开始下载 '+file.name);
 }catch(e){notice(e.message,true);}
}
function openLiveRecord(id){detail={kind:'general',id};page='general';render();el('content').scrollTo(0,0);}
function openMockRecord(kind,id){detail={kind,id};page=kind;render();el('content').scrollTo(0,0);}
el('content').addEventListener('click',async ev=>{
 const target=ev.target.closest('button');if(!target)return;
 if(target.dataset.nav){setPage(target.dataset.nav);return;}
 if(target.dataset.liveId){openLiveRecord(Number(target.dataset.liveId));return;}
 if(target.dataset.mockId){openMockRecord(page,Number(target.dataset.mockId));return;}
 if(target.dataset.contractId){openMockRecord('contract',Number(target.dataset.contractId));return;}
 if(target.dataset.searchDetail){const [k,id]=target.dataset.searchDetail.split(':');openMockRecord(k,Number(id));return;}
 if(target.dataset.download){const r=liveRows.find(r=>r.id===detail?.id);const file=r?.files.find(f=>f.id===Number(target.dataset.download));if(file)await download(file);return;}
 switch(target.dataset.action){
  case 'add':el('modal').showModal();break;
  case 'upload':el('uploadInput')?.click();break;
  case 'filter':filterName=el('filterSearch')?.value.trim()||'';filterKind=el('filterKind')?.value||'全部类型';filterState=el('filterState')?.value||'全部状态';selected.clear();render();break;
  case 'clearFilter':filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();render();break;
  case 'check':try{const status=await(await api('/api/check')).json();const out=el('checkResult');if(out)out.textContent='完整性：'+status.result+'；未完成附件：'+status.incomplete;notice(status.result==='ok'?'数据库完整性检查通过':'数据库检查异常',status.result!=='ok');}catch(e){notice(e.message,true);}break;
  case 'lock':await closeDb();break;
  case 'demoContract':notice('合同新增功能尚未开发，本页仅为布局演示');break;
  default:notice('当前仅展示界面设计，尚未接入该业务功能');
 }
});
el('content').addEventListener('change',async ev=>{
 if(ev.target.id==='uploadInput'){
  const files=ev.target.files;if(files?.length&&detail?.kind==='general')await upload(detail.id,files[0]);ev.target.value='';
 }
 if(ev.target.id==='checkAll')document.querySelectorAll('.rowcheck').forEach(c=>c.checked=ev.target.checked);
 if(ev.target.matches('.rowcheck')||ev.target.id==='checkAll'){
  selected=new Set([...document.querySelectorAll('.rowcheck:checked')].map(x=>x.value));
  const counter=el('selectionInfo');if(counter)counter.textContent='已勾选 '+selected.size+' 条';
 }
});
el('content').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='filterSearch'){event.preventDefault();el('content').querySelector('[data-action=filter]')?.click();}});
el('globalSearch').onkeydown=event=>{if(event.key==='Enter'&&space){filterName=el('globalSearch').value.trim();page='search';detail=null;render();}};
el('cancelRecord').onclick=()=>el('modal').close();
el('newRecordForm').onsubmit=async ev=>{
 ev.preventDefault();el('saveRecord').disabled=true;
 try{await api('/api/records/'+space,{method:'POST',json:{title:el('title').value.trim()}});el('modal').close();el('title').value='';setPage('general');await refresh();notice('新建综合资料成功');}
 catch(e){notice(e.message,true);}finally{el('saveRecord').disabled=false;}
};
async function closeDb(){
 if(!confirm('关闭当前数据库？再次打开时需要输入数据库密码。'))return;
 try{await api('/api/lock',{method:'POST'});token='';dbName='';space=null;liveRows=[];sessionStorage.clear();recoveryMode(false);mode(false);screen(false);notice('已安全关闭数据库');}catch(e){notice(e.message,true);}
}
el('closeDbFromChoice').onclick=closeDb;
async function sendExit(choice){
 el('exitDialog').close();if(choice==='stay')return;
 try{const response=await(await api('/api/exit',{method:'POST',json:{choice}})).json();
  if(response.exiting){el('exit').disabled=true;sessionStorage.clear();notice(choice==='wait'?'文件任务完成后将安全退出。':choice==='cancel'?'正在取消文件任务并安全退出…':'正在安全退出…');}
 }catch(e){if(choice==='normal'&&e.message.includes('文件任务'))el('exitDialog').showModal();else notice(e.message,true);}
}
el('exit').onclick=async()=>{
 try{let active=false;if(token){const task=await(await api('/api/task')).json();active=task.active;if(task.exiting){notice('程序已进入安全退出流程。');return;}}
  if(active){el('exitDialog').showModal();return;}
  if(confirm('安全退出本地服务并关闭数据库？'))await sendExit('normal');
 }catch(e){notice(e.message,true);}
};
el('exitCancelTask').onclick=()=>sendExit('cancel');
el('exitFinishTask').onclick=()=>sendExit('wait');
el('exitStay').onclick=()=>el('exitDialog').close();
(async()=>{
 mode(true);
 try{const status=await(await api('/api/status')).json();el('dbPath').value=status.suggestion;
  let valid=false;
  if(status.unlocked&&token){try{await api('/api/check');valid=true;}catch{valid=false;}}
  if(status.unlocked&&valid){recoveryMode(false);space=null;screen(true);}
  else if(status.unlocked){token='';dbName='';space=null;sessionStorage.clear();recoveryMode(true);screen(false);}
  else{token='';dbName='';space=null;sessionStorage.clear();recoveryMode(false);screen(false);}
 }catch(error){notice('本地服务不可用：'+error.message,true);}
})();