/* Q162 full-scope Excel export and real IP template shape; no contract Excel. */
const assert=require("node:assert/strict"),fs=require("node:fs");
const path=require("node:path"),vm=require("node:vm");
const base=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(base,file),"utf8");
const excel=read("wwwroot/js/excel.js");
const forms=read("wwwroot/js/forms.js");
// Exercise the real IP dependent-select initialization against a minimal DOM
// model: the first status select has no options on open.
const ipTypesSource=forms.slice(forms.indexOf("const IP_TYPES ="),
  forms.indexOf("const RecordForms ="));
const syncStart=forms.indexOf('    const typeSel = mask.querySelector');
const syncEnd=forms.indexOf('    const err = mask.querySelector',syncStart);
assert.ok(syncStart>0 && syncEnd>syncStart,"IP form dynamic select hook exists");
const statusSync=forms.slice(syncStart,syncEnd);
function openIpStatus(type,saved) {
  const listeners={};
  const typeSel={value:type,addEventListener:(name,fn)=>listeners[name]=fn};
  const statusSel={value:"",
    set innerHTML(html) {
      this.html=html;
      this.value=(html.match(/<option value="([^"]*)" selected>/)||[])[1]||"";
    }
  };
  const mask={querySelector:key=>key.includes("ipType")?typeSel:statusSel};
  const context=vm.createContext({mask,values:{status:saved}});
  vm.runInContext(ipTypesSource+statusSync,context);
  return{typeSel,statusSel,change:listeners.change};
}
const typesContext=vm.createContext({});
vm.runInContext(ipTypesSource,typesContext);
for(const [type,statuses] of Object.entries(vm.runInContext("IP_TYPES",typesContext))) {
  const saved=statuses.at(-1);
  const ui=openIpStatus(type,saved);
  assert.equal(ui.statusSel.value,saved,"IP status must preselect saved value: "+type);
  assert.ok(ui.statusSel.html.includes('value="'+saved+'" selected'),
    "Saved status must be selected in actual option HTML: "+type);
}
const sample=openIpStatus("软件著作权","已登记");
assert.equal(sample.statusSel.value,"已登记");
sample.typeSel.value="发明专利";
sample.change();
assert.equal(sample.statusSel.value,"","Invalid status must clear after switching IP type");
sample.statusSel.value="已授权";
sample.typeSel.value="实用新型专利";
sample.change();
assert.equal(sample.statusSel.value,"已授权","Compatible status must survive IP type change");
const blank=openIpStatus("软件著作权","");
assert.equal(blank.statusSel.value,"","New/blank IP status stays optional");
const ledger=read("ExcelLedger.cs");
const shellApp=read("wwwroot/js/app.js");
const shellStore=read("wwwroot/js/store.js");
const generalForm=read("wwwroot/js/forms.js");
const archiveLedger=read("NativeArchiveGeneralExcelLedger.cs");
assert.match(shellApp,/b\.kind === "ip" \? "当前权利人"/,
  "IP details label must match current right-holder ledger heading");
assert.match(shellStore,/remarks: g\.remarks \|\| ""/,
  "General remarks must be mapped from database, not hardcoded empty");
assert.match(generalForm,/remarks: d\.remarks/,
  "General edit/create form must persist remarks");
assert.match(archiveLedger,/DirectoryPath\(db,item\.Folder\.Parent\?\.Id\)/,
  "Archive Excel exports the actual folder ancestry separately from category");
assert.match(archiveLedger,/ReadCompatibleArchive\(bytes\)/,
  "Archive Excel must retain old four-column import compatibility");
const archiveColumns=ledger.match(/private static readonly Column\[\] ArchiveColumns=\s*\[([\s\S]*?)\];/)[1];
assert.match(archiveColumns,/new\("year","年度"\)/);
assert.match(archiveColumns,/new\("directory","所属目录"\)/);
assert.match(ledger,/new\("remarks","备注"\)/,
  "General remarks must be available in Excel metadata");
const filter=read("NativeExcelExportFilter.cs");
const endpoints=["NativeProjectExcelEndpoints.cs","NativeIpExcelEndpoints.cs",
  "NativeArchiveGeneralExcelEndpoints.cs"].map(read);
assert.match(filter,/SearchStore\.Find\(db,workspace,query,int\.MaxValue\)/,
  "Filtered export must search all records, not first 60 hits");
endpoints.forEach(s=>assert.match(s,/ExcelLedger\.ExportIds\(/));
assert.match(endpoints[0],/kind!="project"/,"Contract Excel export must be rejected");
assert.ok(!excel.includes('kind: "contract"'),"No independent contract Excel UI");
const cols=ledger.match(/private static readonly Column\[\] IntellectualProperty=\s*\[([\s\S]*?)\];/)[1];
assert.equal((cols.match(/new\("/g)||[]).length,19,"IP workbook has 19 columns");
for(const col of ['new("number","编号")','new("publicationNo","公开号")',
                  'new("grantNoticeNo","授权公告号")'])
  assert.ok(cols.includes(col),"IP workbook: "+col);
assert.ok(!cols.includes('registrationNo'),"No duplicate primary number column");

// Third-batch source-to-view contracts: every Excel IP field must be visible
// and round-trip in the edit dialog instead of silently surviving in ...r.
const ipForm=forms.slice(forms.indexOf("  ip(node) {"),
  forms.indexOf("  /* ---------------- 综合资料"));
const workbookKeys=[...cols.matchAll(/new\("([^"]+)","[^"]+"\)/g)].map(x=>x[1]);
for(const field of workbookKeys) {
  assert.match(ipForm,new RegExp('key: "'+field+'"'),
    "IP form must expose workbook field "+field);
  assert.match(ipForm,new RegExp(field+': d\\.'+field+'(?:,|\\n)'),
    "IP form must save workbook field "+field);
}
assert.match(forms,/十种类型/,"IP comment must match current types");
assert.match(forms,/: \{ projectStatus: "筹备中" \}/,
  "New project status must match backend default before save");
assert.match(shellStore,/node\.dateLabel = p\.startDate \|\| p\.endDate \|\| ""/,
  "Project visible date should align with ledger year source");
assert.match(shellStore,/year: String\(p\.startDate \|\| p\.endDate \|\| ""\)/,
  "Project detail year must match list year");
assert.match(forms,/文件本体名称/);
assert.match(forms,/当前位置显示名/,"File property explains LinkId display alias");
const archiveUi=read("NativeArchiveUiEndpoints.cs");
assert.equal((archiveUi.match(/displayName=link\.DisplayName\?\?link\.FileName/g)||[]).length,2,
  "General and archive file snapshots include per-location display aliases");
assert.match(shellApp,/line\("当前位置显示名", it\.name\)/);
assert.match(shellApp,/line\("当前版本原件名", meta\.name\)/);
const toneSource=shellApp.slice(shellApp.indexOf("function statusTone(v) {"),
  shellApp.indexOf("/* 金额千分位"));
const toneScope=vm.createContext({});
vm.runInContext(toneSource,toneScope);
const tone=x=>vm.runInContext("statusTone("+JSON.stringify(x)+")",toneScope);
for(const st of ["已登记","已注册","已发布","已公开","已授权","已完成"])
  assert.equal(tone(st),"green","Completed IP status should use success tone: "+st);
for(const st of ["准备中","制定中","登记中","申请中","实质审查中","进行中"])
  assert.equal(tone(st),"blue","In-progress status should use ongoing tone: "+st);
for(const st of ["已失效","已废止","已终止"])
  assert.equal(tone(st),"red","Invalid status should use negative tone: "+st);
assert.equal(tone("未定义状态"),"gray","Unknown status remains neutral");

const requests=[],names=[];
const state={folderId:"k:project",view:"files",ready:true,query:"能源",statusFilter:"进行中"};
const ctx=vm.createContext({Drive:{state},VaultStore:{ws:"company"},
  api:async(url,opts)=>{requests.push({url,body:opts.json});return {blob:async()=>({})};},
  toast(){},notice(){},document:{},URL:{},setTimeout(){},$(){return {classList:{toggle(){}}};}});
vm.runInContext(excel,ctx);
ctx.saveName=name=>names.push(name);
vm.runInContext('downloadBlob = (_b,n) => saveName(n);',ctx);
async function call(category,mode){
  ctx.mode=mode;
  vm.runInContext('chooseExcelExportScope = async () => mode;',ctx);
  await vm.runInContext('exportLedger('+JSON.stringify(category)+')',ctx);
}
(async()=>{
  await call("project","filtered");
  assert.equal(requests.at(-1).url,"/api/v2/excel/company/project/export");
  assert.equal(requests.at(-1).body.mode,"filtered");
  assert.equal(requests.at(-1).body.query,"能源");
  assert.equal(requests.at(-1).body.status,"进行中");
  await call("project","all");
  assert.equal(requests.at(-1).body.query,null);
  assert.equal(requests.at(-1).body.status,null);
  ctx.VaultStore.ws="personal";state.folderId="k:ip";state.query="专利";state.statusFilter="";
  await call("ip","filtered");
  assert.equal(requests.at(-1).url,"/api/v2/excel/personal/ip/export");
  assert.equal(requests.at(-1).body.query,"专利");
  ctx.VaultStore.ws="company";state.folderId="k:party";state.query="";
  await call("party","filtered");
  assert.equal(requests.at(-1).url,"/api/v2/excel/company/archive/export?section=party");
  assert.equal(requests.at(-1).body.query,"");
  const count=requests.length;
  await call("party",null);
  assert.equal(requests.length,count,"Cancel must not export");
  assert.equal(names.length,count);
  assert.match(excel,/data-excel-mode="filtered"/);
  assert.match(excel,/留空保留原有属性/,"Excel update blank-cell semantics must be visible");
  assert.match(excel,/data-excel-mode="all"/);
  console.log("EXCEL SCOPE SMOKE PASS: scopes, 19 IP form fields, status tones, project years, aliases, Excel semantics");
})().catch(e=>{console.error(e);process.exitCode=1;});
