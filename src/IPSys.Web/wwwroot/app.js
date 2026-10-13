/* IPSys UI-first main entry: real SQLCipher general records + clearly marked design-only pages. */
"use strict";
const el=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token=sessionStorage.getItem('ip-token')||'';
let dbName=sessionStorage.getItem('ip-db')||'';
let space=null,creating=false,resuming=false,localFileTaskActive=false;
let page='dashboard',detail=null,archiveGroup=null,editingId=null,projectEditingId=null,projectRows=[],ipEditingId=null,ipRows=[],contractEditingId=null,contractProjectId=null,contractRows=[],liveRows=[],filterName='',filterKind='全部类型',filterState='全部状态',selected=new Set();
const companyNav=[['dashboard','工作台','▦'],['ip','知识产权','◇'],['researchProject','科研项目','▤'],['horizontalProject','横向项目','▥'],['contract','全部合同','▧'],['certificate','企业资质','▣'],['general','综合资料','▥']];
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
const labels=()=>space==='personal'?personalNav:companyNav;
const title=k=>(labels().find(x=>x[0]===k)||[])[1]||({search:'统一搜索',trash:'回收站',settings:'系统设置'}[k]||'记录详情');
const sample=k=>{
  if(space==='personal'&&k==='researchProject')
    return [...mock.personal.researchProject,...mock.personal.horizontalProject];
  return (mock[space]&&mock[space][k])||[];
};
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
  space=next;page='dashboard';detail=null;archiveGroup=null;projectRows=[];ipRows=[];contractRows=[];filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();
  el('globalSearch').value='';el('sidebarDbName').textContent=dbName;
  el('chooseWorkspace').hidden=true;el('unlocked').hidden=false;
  refresh();
}
document.querySelectorAll('[data-workspace-choice]').forEach(b=>b.onclick=()=>selectSpace(b.dataset.workspaceChoice));
el('workspaceBtn').onclick=()=>{space=null;el('unlocked').hidden=true;el('chooseWorkspace').hidden=false;};
function setPage(next){page=next;detail=null;archiveGroup=null;filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();el('globalSearch').value='';render();}
async function refresh(){
  if(!token||!space)return;
  const requestedSpace=space;
  try{const [rows,projects,ips,contracts]=await Promise.all([api('/api/records/'+space).then(r=>r.json()),api('/api/projects/'+space).then(r=>r.json()),api('/api/ip/'+space).then(r=>r.json()),api('/api/contracts/'+space).then(r=>r.json())]);
    if(requestedSpace!==space||!token)return;
    liveRows=rows;projectRows=projects;ipRows=ips;contractRows=contracts;render();
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
 const counts=space==='personal'
  ? [['其他资料',general,'条真实记录'],['已归档原件',fileCount,'份真实附件'],['身份与资质',sample('certificate').length,'条界面示例'],['成果与奖励',sample('achievement').length,'条界面示例']]
  : [['综合资料',general,'条真实记录'],['已归档原件',fileCount,'份真实附件'],['知识产权',ipRows.length,'条真实记录'],['科研项目',projectRows.filter(p=>p.projectType!=='横向项目').length,'条真实记录']];
 return heading(title('dashboard'),'当前工作区 · 真实综合资料与其余模块的界面示例')+
 '<div class="cards">'+counts.map(([name,num,s])=>`<div class="card"><div class="metriclabel">${name}</div><div class="metric">${num}</div><div class="metricfoot">${s}</div></div>`).join('')+'</div>'+
 '<div class="panels"><section class="card"><h2 class="sectiontitle">'+(space==='personal'?'个人资料分类入口':'业务模块快捷入口')+'</h2><div class="modulegrid">'+mods.map(([key,name])=>`<button class="modulelink" data-nav="${key}"><span><b>${name}</b><small>${key==='general'?general+' 条真实记录':key==='ip'?ipRows.length+' 条真实记录':key==='contract'?contractRows.length+' 条真实记录':isProject(key)?projectViewRows(key).length+' 条真实记录':(sample(key).length||0)+' 条演示记录'}</small></span><span class="arrow">→</span></button>`).join('')+'</div></section>'+
 '<section class="card"><h2 class="sectiontitle">当前工作区资料概况</h2><div class="minirow"><span>公司 / 个人隔离</span><strong>已启用</strong></div><div class="minirow"><span>'+ (space==='personal'?'其他资料':'综合资料') +'存储</span><strong>真实 SQLCipher</strong></div><div class="minirow"><span>'+ (space==='personal'?'分类资料':'知识产权、项目与合同') +'</span>'+pill('界面设计')+'</div><div class="minirow"><span>当前数据库</span><span class="muted">'+escapeHtml(dbName)+'</span></div><p class="hint">证件、成果等分类仍为界面示例。真实文件请在“'+(space==='personal'?'其他资料':'综合资料')+'”中管理。</p></section></div>';
}
function generalList(){
 const rows=liveRows.filter(r=>r.title.toLowerCase().includes(filterName.toLowerCase()));
 const subtitle=space==='personal'
  ? '尚未归入上述类别的个人资料，使用当前加密库的真实记录和附件。'
  : '综合资料使用当前加密库的真实记录和附件。';
 return heading(title('general'),subtitle,`<button class="btn primary" data-action="add">＋ 新建资料</button>`)+
 '<section class="white filter"><div class="filterline"><div class="field wide"><label>资料名称</label><input id="filterSearch" placeholder="搜索当前工作区资料"></div><button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><span><b>资料卡片</b> <small class="muted">'+rows.length+' 条真实记录</small></span><div class="actions"><span class="realflag">真实数据库</span><button class="btn" data-action="check">检查数据库</button></div></div>'+
 (rows.length?'<div class="recordgrid">'+rows.map(r=>archiveCard(r,{
  title:r.title,type:space==='company'?'综合资料':'其他资料',
  fileCount:r.files.length,real:true
 })).join('')+'</div>':'<div class="empty">没有符合条件的资料。可先创建记录，再上传附件。</div>')+
 '<div class="tablefoot">共 '+rows.length+' 条记录 · 数据来自当前加密资料库</div></section>';
}
function realDetail(){
 const r=liveRows.find(r=>r.id===detail.id);
 if(!r)return heading('记录详情','记录不存在或当前工作区无权访问')+'<button class="btn" data-nav="general">返回台账</button>';
 return heading(r.title,title('general')+' / 记录详情 · 当前加密库真实数据',`<button class="btn" data-nav="general">← 返回台账</button><button class="btn" data-action="editRecord">修改名称</button>`)+
 `<section class="white detailsection"><div class="detailsectionhead"><h2>基本信息</h2><span class="realflag">真实记录</span></div><div class="detailbody infogrid"><div class="info"><label>资料名称</label><strong>${escapeHtml(r.title)}</strong></div><div class="info"><label>所属工作区</label><strong>${space==='company'?'公司资料':'个人资料'}</strong></div><div class="info"><label>已归档附件</label><strong>${r.files.length} 份</strong></div></div></section>`+
 `<section class="white detailsection"><div class="detailsectionhead"><h2>附件资料</h2><button class="btn primary" data-action="upload">＋ 上传原件</button></div><div class="detailbody"><input type="file" id="uploadInput" hidden><p class="hint">当前原型支持真实上传与下载，单文件不超过 64 MiB。附件展示在该记录下。</p>`+
 (r.files.length?r.files.map(f=>`<div class="fileline"><span class="fileicon">${escapeHtml(f.name.split('.').pop().slice(0,4).toUpperCase())}</span><span class="filedesc"><strong>${escapeHtml(f.name)}</strong><small>${fmtSize(f.size)} · SHA-256 ${escapeHtml(f.sha256.slice(0,16))}…</small></span><button class="btn btn-sm" data-download="${f.id}">下载原件</button></div>`).join(''):'<div class="empty">暂无附件，点击“上传原件”开始归档。</div>')+'</div></section>'+
 '<section class="white detailsection"><div class="detailsectionhead"><h2>关联资料</h2>'+stamp()+'</div><div class="empty">关联功能尚待开发</div></section>';
}
function columns(k){
 if(k==='ip')return [['name','名称'],['type','知识产权类型'],['code','申请/登记号'],['status','状态'],['owner','当前权利人'],['date','申请/登记日期'],['files','附件']];
 if(isProject(k))return [['name','项目名称'],['type','项目类别'],['code','项目编号'],['date','开始日期'],['files','附件']];
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
 return heading(title('ip'),'知识产权真实业务台账 · 当前加密资料库',
  '<span class="realflag">真实记录</span><button class="btn primary" data-action="ipAdd">＋ 新建记录</button>')+
 '<section class="white filter"><div class="filterline">'+
 '<div class="field wide"><label>名称 / 编号</label><input id="filterSearch" placeholder="搜索知识产权"></div>'+
 '<div class="field"><label>类型</label><select id="filterKind">'+options(['全部类型',...allTypes],filterKind)+'</select></div>'+
 '<div class="field"><label>状态</label><select id="filterState">'+options(['全部状态',...allStates],filterState)+'</select></div>'+
 '<button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><b>业务台账 '+rows.length+' 条真实记录</b></div>'+
 '<div class="tablewrap"><table class="data"><thead><tr><th>名称</th><th>知识产权类型</th><th>申请/登记号</th><th>状态</th><th>当前权利人</th><th>申请/登记日期</th><th>附件</th></tr></thead><tbody>'+
 (rows.length?rows.map(r=>{const v=r.data;return '<tr>'+
 '<td><button class="link" data-ip-id="'+r.id+'">'+escapeHtml(v.name)+'</button></td>'+
 '<td>'+escapeHtml(v.ipType)+'</td>'+
 '<td>'+escapeHtml(v.applicationNo||v.registrationNo||'—')+'</td>'+
 '<td>'+escapeHtml(v.status||'—')+'</td>'+
 '<td>'+escapeHtml(v.rightHolders||'—')+'</td>'+
 '<td>'+escapeHtml(v.applicationDate||v.registrationDate||'—')+'</td>'+
 '<td>0</td></tr>';}).join(''):'<tr><td colspan="7" class="empty">暂无知识产权记录，点击新建。</td></tr>')+
 '</tbody></table></div><div class="tablefoot">共 '+rows.length+' 条记录 · 数据保存在当前 SQLCipher 库</div></section>';
}
function ipDetail(){
 const row=ipRows.find(x=>x.id===detail?.id);
 if(!row)return heading('知识产权不存在','当前工作区无此记录')+'<button class="btn" data-nav="ip">返回台账</button>';
 const v=row.data;
 const fields=ipFieldLabels.map(([k,label])=>infoRow(label,v[k])).join('');
 return heading(v.name,'知识产权详情 · SQLCipher 真实记录',
  '<button class="btn" data-nav="ip">← 返回台账</button>'+
  '<button class="btn" data-action="ipEdit">修改</button>'+
  '<button class="btn" data-action="ipCopy">复制记录</button>'+
  '<button class="btn" data-action="ipMove">转移工作区</button>'+
  '<button class="btn" data-action="ipDelete">删除</button>')+
 section('基本信息','<div class="infogrid">'+fields+'</div>')+
 section('知识产权附件','<p class="hint">附件归属与版本管理下一阶段接入。</p>');
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
 return heading('全部合同','当前工作区真实合同汇总 · 合同只能从所属项目详情新增',
   '<span class="realflag">真实记录</span>')+
 '<section class="white filter"><div class="filterline">'+
 '<div class="field wide"><label>名称 / 编号 / 所属项目</label><input id="filterSearch" placeholder="搜索合同或项目"></div>'+
 '<button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><b>合同台账 '+visible.length+' 条真实记录</b></div>'+
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
 section('合同附件','<p class="hint">合同原件附件将在后续附件功能阶段接入。</p>');
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
 return projectRows.filter(p=>space==='personal'||(k==='researchProject'?p.projectType!=='横向项目':p.projectType==='横向项目'));
}
function projectList(k){
 const rows=projectViewRows(k), visible=rows.filter(p=>
  [p.name,p.projectNo,p.leader,p.undertakingOrg].join(' ').toLowerCase().includes(filterName.toLowerCase()) &&
  (filterKind==='全部类型'||p.projectType===filterKind) &&
  (filterState==='全部状态'||p.projectStatus===filterState));
 const types=['全部类型','科研项目','横向项目','其他项目'];
 const statuses=['全部状态','筹备中','进行中','已完成','已终止'];
 return heading(title(k),'真实业务台账 · 当前加密资料库',
  '<span class="realflag">真实记录</span><button class="btn primary" data-action="projectAdd">＋ 新建项目</button>')+
 '<section class="white filter"><div class="filterline">'+
 '<div class="field wide"><label>名称 / 编号</label><input id="filterSearch" placeholder="输入关键词筛选项目"></div>'+
 '<div class="field"><label>类型</label><select id="filterKind">'+types.map(t=>'<option value="'+t+'" '+(filterKind===t?'selected':'')+'>'+t+'</option>').join('')+'</select></div>'+
 '<div class="field"><label>状态</label><select id="filterState">'+statuses.map(t=>'<option value="'+t+'" '+(filterState===t?'selected':'')+'>'+t+'</option>').join('')+'</select></div>'+
 '<button class="btn primary" data-action="filter">查询</button><button class="btn" data-action="clearFilter">重置</button></div></section>'+
 '<section class="white"><div class="tabletools"><b>业务台账 '+visible.length+' 条真实记录</b></div>'+
 '<div class="tablewrap"><table class="data"><thead><tr><th>项目名称</th><th>项目类别</th><th>项目编号</th><th>开始日期</th><th>附件</th></tr></thead><tbody>'+
 (visible.length?visible.map(p=>'<tr>'+
 '<td><button class="link" data-project-id="'+p.id+'">'+escapeHtml(p.name)+'</button></td>'+
 '<td>'+escapeHtml(p.projectType)+'</td><td>'+escapeHtml(p.projectNo||'—')+'</td>'+
 '<td>'+escapeHtml(p.startDate||'—')+'</td>'+
 '<td>0</td></tr>').join(''):
 '<tr><td colspan="5" class="empty">暂无项目，点击右上角新建项目。</td></tr>')+
 '</tbody></table></div><div class="tablefoot">共 '+visible.length+' 条记录 · 数据保存在当前 SQLCipher 库</div></section>';
}
function projectDetail(){
 const p=projectRows.find(x=>x.id===detail.id);
 if(!p)return heading('项目不存在','当前工作区无此项目')+'<button class="btn" data-nav="researchProject">返回台账</button>';
 return heading(p.name,'项目详情 · 真实 SQLCipher 记录',
 '<button class="btn" data-nav="'+page+'">← 返回台账</button>'+
 '<button class="btn" data-action="projectEdit">修改</button>'+
 '<button class="btn" data-action="projectCopy">复制项目</button>'+
 '<button class="btn" data-action="projectMove">转移工作区</button>'+
 '<button class="btn" data-action="projectDelete">删除</button>')+
 section('项目基本信息','<div class="infogrid">'+
 infoRow('项目名称',p.name)+infoRow('项目类别',p.projectType)+infoRow('项目编号',p.projectNo)+
 infoRow('负责人',p.leader)+infoRow('承担单位',p.undertakingOrg)+
 infoRow('项目状态',p.projectStatus)+infoRow('开始日期',p.startDate)+
 infoRow('结束日期',p.endDate)+infoRow('辅助分类',p.category)+
 infoRow('标签',p.tags)+infoRow('备注',p.remarks)+'</div>')+
 section('所属合同',projectContracts(p.id))+
 section('项目自身附件','<p class="hint">项目附件归属与附件版本管理下一阶段接入。</p>');
}
function showProjectForm(id=null){
 projectEditingId=id;
 const p=id===null?null:projectRows.find(r=>r.id===id);
 el('projectForm').reset();
 el('projectFormTitle').textContent=p?'修改项目':'新建项目';
 el('pType').value=p?.projectType||(page==='horizontalProject'?'横向项目':'科研项目');
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
     <span class="${real?'realflag':'mockflag'}">${real?'真实记录':'界面示例'}</span>
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
  out+=section('项目基本信息','<div class="infogrid">'+infoRow('项目名称',r.name)+infoRow('项目类别',r.type)+infoRow('项目编号',r.code)+infoRow('负责人',r.leader)+infoRow('项目状态',r.status)+infoRow('开始日期',r.date)+'</div>');
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
 content.innerHTML=detail?(detail.kind==='general'?realDetail():detail.kind==='project'?projectDetail():detail.kind==='contract'?contractDetail():detail.kind==='ip'?ipDetail():mockDetail()):
   archiveGroup&&['certificate','achievement','academic'].includes(page)?mockCategoryTable(page,archiveGroup):
   page==='dashboard'?dashboard():page==='general'?generalList():
   isProject(page)?projectList(page):page==='ip'?ipList():
   page==='contract'?contractList():
   ['certificate','achievement','academic'].includes(page)?mockCardList(page):
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
function openMockRecord(kind,id){if(page!==kind)archiveGroup=null;detail={kind,id};page=kind;render();el('content').scrollTo(0,0);}
el('content').addEventListener('click',async ev=>{
 const categoryCard=ev.target.closest('[data-archive-category]');
 if(categoryCard){
  const category=categoryCard.dataset.archiveCategory;
  if(['certificate','achievement','academic'].includes(page)&&sample(page).some(r=>r.type===category)){
   archiveGroup=category;detail=null;filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();render();el('content').scrollTo(0,0);
  }
  return;
 }
 const target=ev.target.closest('button');if(!target)return;
 if(target.hasAttribute('data-archive-back')){
  if(target.dataset.archiveBack==='cards')archiveGroup=null;
  detail=null;filterName='';filterKind='全部类型';selected.clear();render();el('content').scrollTo(0,0);return;
 }
 if(target.dataset.nav){setPage(target.dataset.nav);return;}
 if(target.dataset.liveId){openLiveRecord(Number(target.dataset.liveId));return;}
 if(target.dataset.projectId){detail={kind:'project',id:Number(target.dataset.projectId)};render();el('content').scrollTo(0,0);return;}
 if(target.dataset.ipId){detail={kind:'ip',id:Number(target.dataset.ipId)};page='ip';render();el('content').scrollTo(0,0);return;}
 if(target.dataset.mockId){openMockRecord(page,Number(target.dataset.mockId));return;}
 if(target.dataset.contractBackProject){
  const p=projectRows.find(r=>r.id===Number(target.dataset.contractBackProject));
  if(p){page=space==='personal'?'researchProject':p.projectType==='横向项目'?'horizontalProject':'researchProject';
   detail={kind:'project',id:p.id};render();}
  return;
 }
 if(target.dataset.contractId){
  const parent=detail?.kind==='project'?detail.id:null;
  detail={kind:'contract',id:Number(target.dataset.contractId),returnProject:parent};
  render();el('content').scrollTo(0,0);return;
 }
 if(target.dataset.searchDetail){const [k,id]=target.dataset.searchDetail.split(':');openMockRecord(k,Number(id));return;}
 if(target.dataset.download){const r=liveRows.find(r=>r.id===detail?.id);const file=r?.files.find(f=>f.id===Number(target.dataset.download));if(file)await download(file);return;}
 switch(target.dataset.action){
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
    const input=Object.fromEntries(contractFieldLabels.map(([key])=>[key,c[key]]));
    const response=await api('/api/projects/'+space+'/'+c.projectId+'/contracts',
      {method:'POST',json:input});
    const newId=(await response.json()).id;
    const projectReturn=detail.returnProject;
    await refresh();
    detail={kind:'contract',id:newId,returnProject:projectReturn};render();
    notice('合同已复制到原所属项目');
   }catch(e){notice(e.message,true);}break;
  }
  case 'contractDelete':{
   const c=contractRows.find(row=>row.id===detail?.id);if(!c)break;
   if(!confirm('将合同“'+c.name+'”从台账移除？此操作为软删除。'))break;
   try{
    await api('/api/contracts/'+space+'/'+c.id,{method:'DELETE'});
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
   try{await api('/api/ip/'+space+'/'+row.id,{method:'DELETE'});detail=null;await refresh();notice('知识产权记录已删除');}
   catch(e){notice(e.message,true);}break;
  }
  case 'ipCopy':
  case 'ipMove':{
   const row=ipRows.find(r=>r.id===detail?.id);if(!row)break;
   const move=target.dataset.action==='ipMove';
   const other=space==='company'?'personal':'company';
   const dest=move?other:(confirm('复制到另一工作区？取消则复制到当前工作区。')?other:space);
   if(!confirm((move?'转移':'复制')+'知识产权“'+row.data.name+'”至'+(dest==='company'?'公司':'个人')+'工作区？'))break;
   try{
    await api('/api/ip/'+space+'/'+row.id+'/transfer',{method:'POST',json:{targetWorkspace:dest,move}});
    if(move)detail=null;
    await refresh();notice(move?'知识产权记录已转移':'知识产权记录已复制');
   }catch(e){notice(e.message,true);}break;
  }
  case 'projectAdd':showProjectForm();break;
  case 'projectEdit':showProjectForm(detail?.id);break;
  case 'projectDelete':{
   const p=projectRows.find(x=>x.id===detail?.id);
   if(!p||!confirm('将项目“'+p.name+'”移出当前台账？此操作为软删除。'))break;
   try{await api('/api/projects/'+space+'/'+p.id,{method:'DELETE'});detail=null;await refresh();notice('项目已移出当前台账');}
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
    await api('/api/projects/'+space+'/'+p.id+'/transfer',{method:'POST',json:{targetWorkspace:destination,move}});
    if(move)detail=null;
    await refresh();notice(move?'项目已转移到另一工作区':'项目已复制');
   }catch(e){notice(e.message,true);}
   break;
  }
  case 'add':
   editingId=null;el('title').value='';el('saveRecord').textContent='创建记录';
   el('newRecordForm').querySelector('h2').textContent=space==='personal'?'新建其他资料':'新建综合资料';
   el('modal').showModal();break;
  case 'editRecord':{
   const r=detail?.kind==='general'?liveRows.find(row=>row.id===detail.id):null;
   if(!r){notice('找不到要修改的真实记录。',true);break;}
   editingId=r.id;el('title').value=r.title;el('saveRecord').textContent='保存修改';
   el('newRecordForm').querySelector('h2').textContent='修改资料名称';
   el('modal').showModal();break;
  }
  case 'upload':el('uploadInput')?.click();break;
  case 'filter':filterName=el('filterSearch')?.value.trim()||'';filterKind=el('filterKind')?.value||'全部类型';filterState=el('filterState')?.value||'全部状态';selected.clear();render();break;
  case 'clearFilter':filterName='';filterKind='全部类型';filterState='全部状态';selected.clear();render();break;
  case 'check':try{const status=await(await api('/api/check')).json();const out=el('checkResult');if(out)out.textContent='完整性：'+status.result+'；未完成附件：'+status.incomplete;notice(status.result==='ok'?'数据库完整性检查通过':'数据库检查异常',status.result!=='ok');}catch(e){notice(e.message,true);}break;
  case 'lock':await closeDb();break;
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
el('content').addEventListener('keydown',event=>{
 if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-archive-category]')){event.preventDefault();event.target.click();return;}
 if(event.key==='Enter'&&event.target.id==='filterSearch'){event.preventDefault();el('content').querySelector('[data-action=filter]')?.click();}
});
el('globalSearch').onkeydown=event=>{if(event.key==='Enter'&&space){filterName=el('globalSearch').value.trim();page='search';detail=null;render();}};
el('cancelRecord').onclick=()=>{editingId=null;el('modal').close();};
el('modal').addEventListener('close',()=>{editingId=null;});
el('contractCancel').onclick=()=>el('contractDialog').close();
el('contractDialog').addEventListener('close',()=>{contractEditingId=null;contractProjectId=null;});
el('contractForm').onsubmit=async event=>{
 event.preventDefault();
 const id=contractEditingId,projectId=contractProjectId,workspace=space;
 if(projectId===null)return notice('合同缺少所属项目，无法保存。',true);
 const data=Object.fromEntries(new FormData(el('contractForm')).entries());
 el('contractSave').disabled=true;
 try{
  const endpoint=id===null?'/api/projects/'+workspace+'/'+projectId+'/contracts':
   '/api/contracts/'+workspace+'/'+id;
  const response=await api(endpoint,{method:id===null?'POST':'PUT',json:data});
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
  const resp=await api('/api/ip/'+space+(id===null?'':'/'+id),
   {method:id===null?'POST':'PUT',json:fields});
  const created=id===null?(await resp.json()).id:id;
  el('ipDialog').close();await refresh();
  if(ipRows.some(r=>r.id===created)){page='ip';detail={kind:'ip',id:created};render();}
  notice(id===null?'知识产权已创建':'知识产权修改已保存');
 }catch(error){notice(error.message,true);}
 finally{el('ipSave').disabled=false;}
};
el('cancelProject').onclick=()=>el('projectDialog').close();
el('projectDialog').addEventListener('close',()=>{projectEditingId=null;});
el('projectForm').onsubmit=async ev=>{
 ev.preventDefault();
 const id=projectEditingId;
 const values=Object.fromEntries(new FormData(el('projectForm')).entries());
 el('saveProject').disabled=true;
 try{
  const result=await api('/api/projects/'+space+(id===null?'':'/'+id),
   {method:id===null?'POST':'PUT',json:values});
  const created=id===null?(await result.json()).id:id;
  el('projectDialog').close();
  await refresh();
  const project=projectRows.find(p=>p.id===created);
  if(project){
   page=space==='personal'?'researchProject':project.projectType==='横向项目'?'horizontalProject':'researchProject';
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
   await api('/api/records/'+workspace+'/'+target,{method:'PUT',json:{title:name}});
  else
   await api('/api/records/'+workspace,{method:'POST',json:{title:name}});
  el('modal').close();editingId=null;el('title').value='';
  if(target===null)setPage('general');
  await refresh();
  notice(target!==null?'资料名称已更新':workspace==='personal'?'新建其他资料成功':'新建综合资料成功');
 }catch(e){notice(e.message,true);}finally{el('saveRecord').disabled=false;}
};
async function closeDb(){
 if(!confirm('关闭当前数据库？再次打开时需要输入数据库密码。'))return;
 try{await api('/api/lock',{method:'POST'});token='';dbName='';space=null;liveRows=[];projectRows=[];ipRows=[];contractRows=[];sessionStorage.clear();recoveryMode(false);mode(false);screen(false);notice('已安全关闭数据库');}catch(e){notice(e.message,true);}
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
 mode(false);
 try{const status=await(await api('/api/status')).json();el('dbPath').value=status.suggestion;
  let valid=false;
  if(status.unlocked&&token){try{await api('/api/check');valid=true;}catch{valid=false;}}
  if(status.unlocked&&valid){recoveryMode(false);space=null;screen(true);}
  else if(status.unlocked){token='';dbName='';space=null;sessionStorage.clear();recoveryMode(true);screen(false);}
  else{token='';dbName='';space=null;sessionStorage.clear();recoveryMode(false);screen(false);}
 }catch(error){notice('本地服务不可用：'+error.message,true);}
})();