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
  console.log("EXCEL SCOPE SMOKE PASS: scopes, IP status prefill, type changes, and blank Excel semantics");
})().catch(e=>{console.error(e);process.exitCode=1;});
