/* Q162 full-scope Excel export and real IP template shape; no contract Excel. */
const assert=require("node:assert/strict"),fs=require("node:fs");
const path=require("node:path"),vm=require("node:vm");
const base=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(base,file),"utf8");
const excel=read("wwwroot/js/excel.js");
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
  assert.match(excel,/data-excel-mode="all"/);
  console.log("EXCEL SCOPE SMOKE PASS: full-scope/filter/all/cancel/19 columns/no contract");
})().catch(e=>{console.error(e);process.exitCode=1;});
