"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../wwwroot");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const source=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const ids=["setAgentTopic","setAgentMeta","setAgentEditor","setAgentSave",
  "setAgentRestore","setAgentPreview","setAgentPreviewText",
  "setAgentExport","setAgentImport","setAgentImportFile"];
for(const id of ids)assert(html.includes('id="'+id+'"'),"missing settings node: "+id);
assert(html.includes("Agent 工作规范") && html.includes("总规范目录（只读）"));
assert(!source.includes('setAgentEditor").innerHTML'),
  "editable prompt text must never render as arbitrary innerHTML");
assert(source.includes("bindAgentGuidanceSettings();"),
  "setup hook must initialize settings event handlers");
const start=source.indexOf("const agentGuideUi =");
const end=source.indexOf("function bindNav() {",start);
assert(start>0 && end>start,"guidance logic is missing from interactions module");
const fragment=source.slice(start,end);
new vm.Script(fragment,{filename:"agent-guidance-settings.js"});

const nodes=Object.fromEntries(ids.map(id=>[id,{
  id,value:"",textContent:"",disabled:false,hidden:true,files:[],
  addEventListener(){},click(){},
}]));
nodes.setAgentTopic.value="index";
const calls=[];
const messages=[];
let custom=null,revision="r0";
const getDetail=(topic)=>topic==="index"?{
  id:"index",title:"目录",entries:[{id:"search",title:"智能检索",version:"v1",
    summary:"摘要"}],version:"v1",source:"builtin",updatedAt:"2026-10-25"
}:{
  id:topic,title:"智能检索",source:custom===null?"builtin":"user_override",
  version:revision,updatedAt:"2026-10-25",revision,
  editableContent:custom??"初始规则",content:custom??"初始规则",
};
const host={
  $:selector=>nodes[selector.slice(1)],
  VaultStore:{
    token:"smoke",
    async getJson(url){
      if(url==="/api/agent-guidance/export")
        return{schemaVersion:1,overrides:custom===null?{}:{search:custom},revision};
      return getDetail(decodeURIComponent(url.split("/").pop()));
    },
    async api(url,request){
      calls.push({url,request});
      if(url==="/api/agent-guidance/search"&&request.method==="PUT"){
        assert.equal(request.json.expectedRevision,revision);
        custom=request.json.content;revision="r1";
        return{json:async()=>getDetail("search")};
      }
      if(url.endsWith("/restore")){
        custom=null;revision="r2";
        return{json:async()=>getDetail("search")};
      }
      if(url.endsWith("/import")){
        custom=request.json.config.overrides.search??null;revision="r3";
        return{json:async()=>getDetail("index")};
      }
      throw Error("unexpected request: "+url);
    },
  },
  toast:(msg)=>messages.push(msg),
  askConfirm:async()=>true,
  Blob,URL:{
    createObjectURL:()=> "blob:mock",
    revokeObjectURL:()=>{},
  },
  document:{body:{appendChild(){}},createElement:()=>({
    href:"",download:"",click(){},remove(){}
  })},
  setTimeout:()=>{},
};
vm.createContext(host);
vm.runInContext(fragment,host);
(async()=>{
  await vm.runInContext("loadAgentGuidance('search')",host);
  assert.equal(nodes.setAgentEditor.value,"初始规则");
  assert.equal(nodes.setAgentSave.disabled,true);
  nodes.setAgentEditor.value="# 更新后的规则";
  vm.runInContext("paintAgentGuideUi()",host);
  assert.equal(nodes.setAgentSave.disabled,false);
  await vm.runInContext("saveAgentGuidance()",host);
  assert.equal(custom,"# 更新后的规则");
  assert.equal(nodes.setAgentSave.disabled,true);
  assert.equal(nodes.setAgentRestore.disabled,false);
  vm.runInContext("previewAgentGuidance()",host);
  assert.equal(nodes.setAgentPreviewText.textContent,custom);
  assert.equal(nodes.setAgentPreviewText.hidden,false);
  await vm.runInContext("restoreAgentGuidance()",host);
  assert.equal(custom,null);
  assert.equal(nodes.setAgentRestore.disabled,true);
  assert(calls.some(x=>x.url.endsWith("/restore")));
  await vm.runInContext("loadAgentGuidance('index')",host);
  assert.equal(nodes.setAgentEditor.disabled,true);
  assert.equal(nodes.setAgentSave.disabled,true);
  console.log("Agent guidance settings UI: PASS");
})().catch(e=>{console.error(e);process.exitCode=1;});
