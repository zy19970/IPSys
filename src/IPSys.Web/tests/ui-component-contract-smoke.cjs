'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'wwwroot','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'wwwroot','style.css'),'utf8');
const html=fs.readFileSync(path.join(root,'wwwroot','index.html'),'utf8');

const matrix={
 'ui-list-toolbar':['.compact-ledger-toolbar','.certificate-toolbar','.tabletools'],
 'ui-toolbar-title':['.compact-ledger-title','.certificate-toolbar-title'],
 'ui-toolbar-filters':['.compact-ledger-filters','.certificate-toolbar-filter'],
 'ui-toolbar-actions':['.compact-ledger-actions','.certificate-toolbar-actions'],
 'ui-section-header':['.detailsectionhead'],
 'ui-table-viewport':['.tablewrap'],
 'ui-data-table':['table.data'],
 'ui-info-grid':['.infogrid'],
 'ui-file-item':['.fileline'],
 'ui-navigation-card':['.archivecard','.dashboard-choice'],
 'ui-export-menu':['.compact-ledger-export','.certificate-export','.module-export'],
 'ui-selection-count':['.ledger-selected-count','.certificate-selected-count','.attachment-selected']
};
const uiStart=js.indexOf('const uiComponentRoots=[');
const uiEnd=js.indexOf('function heading(',uiStart);
assert.ok(uiStart>=0&&uiEnd>uiStart,'Shared role registry missing');
const uiSource=js.slice(uiStart,uiEnd);
const uiElements=new Map();
const content={
 querySelectorAll(selector){
  const item={classes:new Set(),classList:{add(name){item.classes.add(name)}}};
  uiElements.set(selector,item);return [item];
 }
};
const thisSet=new Set();
const roleCtx=vm.createContext({document:{querySelectorAll:()=>[{classList:{add:x=>thisSet.add(x)}}]}});
vm.runInContext(uiSource+
 '\nglobalThis.contractRoles=uiComponentRoots;globalThis.apply=normalizeUiComponents;',roleCtx);
const configured=Object.fromEntries([...roleCtx.contractRoles].map(([key,value])=>[value,key.split(',')]));
for(const [role,required] of Object.entries(matrix)){
 const attached=configured[role]||[];
 for(const selector of required)
  assert.ok(attached.includes(selector),'Shared role '+role+' missing its consumer '+selector);
}
roleCtx.apply(content);
for(const [selector,element] of uiElements){
 const matching=[...roleCtx.contractRoles].find(([entry])=>entry===selector);
 assert.ok(matching&&element.classes.has(matching[1]),
  'DOM component role not assigned: '+selector);
}
assert.ok(thisSet.has('ui-dialog'),'Static form dialogs should inherit common visual shell');

// General-document cards share whole-card navigation semantics with category cards.
assert.ok(js.includes('data-${action}-card="${Number(record.id)}" role="button" tabindex="0"')&&
 js.includes("const recordCard=ev.target.closest('[data-live-card],[data-mock-card]');")&&
 js.includes("if(recordCard&&!ev.target.closest('button,a,input,select,textarea,label'))")&&
 js.includes("openLiveRecord(Number(recordCard.dataset.liveCard))")&&
 js.includes("openMockRecord(page,Number(recordCard.dataset.mockCard))")&&
 js.includes("event.target.matches('[data-archive-category],[data-archive-folder-id],[data-live-card],[data-mock-card]')"),
 'Personal other-material and company comprehensive document tiles must both be mouse/keyboard clickable without hijacking their inner detail buttons');
assert.ok(css.includes('.archivecard:is([data-live-card],[data-mock-card]){cursor:pointer}')&&
 css.includes('.archivecard:is([data-live-card],[data-mock-card]):focus-visible{'),
 'Record-card visual affordances and keyboard focus should match category cards');
const start=js.indexOf('function attachmentFileRow(');
const end=js.indexOf('function businessAttachmentList(',start);
assert.ok(start>0&&end>start,'Shared attachment renderer not found');
const attachmentVm=vm.createContext({
 escapeHtml:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
 fmtSize:size=>String(size)+' B',
 exportCheck:(file,source,latest)=>'<label data-source="'+source+
  '" data-export-latest="'+(latest?'1':'0')+'"></label>'
});
vm.runInContext(js.slice(start,end)+
 '\nglobalThis.renderFile=attachmentFileRow;globalThis.renderGroup=attachmentFileGroup;',
 attachmentVm);
const latest={id:88,name:'<test>&.txt',category:'申请材料',sha256:'0123456789abcdef012345',
 version:2,size:1024};
const older={...latest,id:87,version:1,size:512};
for(const [kind,source,preview,remove] of [
 ['general','general','data-preview-general','data-general-file-delete'],
 ['project','v2file','data-preview-business','data-business-delete'],
 ['contract','v2file','data-preview-business','data-business-delete'],
 ['ip','v2ip','data-preview-business','data-business-delete'],
 ['archive','v2file','data-preview-business','data-business-delete']
]){
 const output=attachmentVm.renderGroup([older,latest],kind);
 assert.ok(output.includes('class="business-file-group"')&&
  output.includes('查看历史版本（1）')&&
  output.includes('data-v2-ip-version="88"')&&
  output.includes('data-business-associate="88"')&&
  output.includes('data-source="'+source+'"')&&
  output.includes(preview+'="88"')&&output.includes(remove+'="88"'),
  'Different record attachment routes must have the same full interaction set: '+kind);
 assert.ok(output.includes('v2 ·')&&output.includes('v1 ·'),
  'Version metadata missing on '+kind);
 assert.ok(output.includes('&lt;test&gt;&amp;.txt')&&!output.includes('<test>'),
  'User-uploaded attachment names must be escaped');
}
assert.ok(js.includes("attachmentFileGroup(g,'general')")&&
 js.includes('attachmentFileGroup(g,kind)')&&
 !js.includes('const fileLine=(f,showVersion')&&
 !js.includes('const line=(f,showVersion'),
 'General and business records must call the same physical attachment renderer');

// Business and certificate list headers use one responsive three-slot layout.
assert.ok(css.includes('.ui-list-toolbar:is(.certificate-toolbar,.compact-ledger-toolbar){')&&
 css.includes('grid-template-columns:max-content minmax(0,1fr) max-content;')&&
 css.includes('.ui-list-toolbar > .ui-toolbar-filters{')&&
 css.includes('grid-column:2;grid-row:1;')&&
 css.includes('.ui-list-toolbar > .ui-toolbar-actions{')&&
 css.includes('grid-column:3;grid-row:1;'),
 'Wide business/certificate/archive headers must align title, filters and actions in one row');
assert.ok(css.includes('@media(max-width:1440px){')&&
 css.includes('grid-column:1/-1;grid-row:2;')&&
 css.includes('@media(max-width:860px){')&&
 css.includes('grid-column:1;grid-row:3;'),
 'Shared header must wrap predictably on medium and narrow viewports');

/* The shared filter cluster stays horizontally centered, whether on the first
   grid row or on its own second row. This must cover all list consumers. */
const toolbarFilterRules=[...css.replace(/\r/g,'').matchAll(/\.ui-list-toolbar > \.ui-toolbar-filters\s*\{([^}]+)\}/g)];
assert.equal(toolbarFilterRules.length,3,
 'Shared toolbar must keep the default, two-row and narrow viewport filter rules');
const centerRules=toolbarFilterRules.slice(0,2).map(match=>match[1]);
for(const [index,rule] of centerRules.entries()){
 assert.ok(rule.includes('justify-self:center')&&
  rule.includes('justify-content:center')&&
  rule.includes('max-width:960px'),
  'The common list filter group must center as a unit, in row '+(index+1));
}
assert.ok(toolbarFilterRules[0][1].includes('grid-column:2;grid-row:1;')&&
 toolbarFilterRules[1][1].includes('grid-column:1/-1;grid-row:2;')&&
 toolbarFilterRules[2][1].includes('grid-column:1;grid-row:2'),
 'Centered list filters must retain their approved responsive grid positions');
for(const [kind,call] of [
 ['project',"attachmentHeaderActions('project')"],
 ['contract',"attachmentHeaderActions('contract')"],
 ['ip',"attachmentHeaderActions('ip')"],
 ['archive',"attachmentHeaderActions('archive')"],
 ['general',"attachmentHeaderActions('general')"]
]){
 assert.ok(js.includes(call),'Detail attachment header coverage: '+kind);
}
assert.ok(js.includes("section('基本信息','<div class=\"infogrid\">'")&&
 js.includes("section('关联资料'")&&
 js.includes("infoRow('所属工作区'"),
 'General detail must use the same section/info primitives as business details');

assert.ok(js.includes('data-ledger-actions')&&
 js.includes("table.closest('.detailsection')?.querySelector('[data-ledger-actions]')")&&
 !js.includes("table.closest('.detailsection')?.querySelector('.tabletools')"),
 'Project contract batch actions must use a stable extension point');
for(const style of ['.ui-list-toolbar{','.ui-section-header{','.ui-table-viewport{',
 '.ui-data-table :is(th,td)','.ui-info-grid{','.ui-navigation-card{',
 '.ui-export-menu{','.ui-selection-count{','.ui-dialog{',
 '.ui-detail-ledger-actions:not(:has(> :not([hidden]))){display:none}']){
 assert.ok(css.includes(style),'Shared CSS contract missing '+style);
}
const dialogsHtml=[...html.matchAll(/<dialog\b[^>]*>/g)].map(m=>m[0]);
assert.ok(dialogsHtml.length>=9&&dialogsHtml.every(x=>x.includes('input-dialog')),
 'All modal dialogs should share the form shell while retaining their own fields');
console.log('UI COMPONENT CONTRACT PASS: 9 shared categories, five file owners, stable contract actions');
