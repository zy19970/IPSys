"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const code=fs.readFileSync(path.resolve(__dirname,"../wwwroot/js/folder-picker.js"),"utf8");

class FakeElement {
  constructor(name="") {
    this.name=name; this.listeners=new Map(); this.value="";
    this.innerHTML="";this.textContent="";this.disabled=false;this.focused=false;
    this.dataset={}; this.removed=false;
  }
  addEventListener(name,fn){this.listeners.set(name,fn);}
  removeEventListener(name){this.listeners.delete(name);}
  emit(name,ev={}){return this.listeners.get(name)?.(ev);}
  focus(){this.focused=true;}
  remove(){this.removed=true;}
  insertAdjacentHTML(where,html){this.innerHTML+=html;}
}
class FakeMask extends FakeElement {
  constructor() {
    super("mask");
    this.parts=new Map();
    for(const key of ["[data-picker-list]","[data-picker-crumb]","[data-picker-search]",
      "[data-picker-scope]","[data-picker-submit]","[data-picker-current]",
      "[data-picker-target]","[data-picker-error]"])
      this.parts.set(key,new FakeElement(key));
    this.cancel=[new FakeElement("close1"),new FakeElement("close2")];
  }
  querySelector(key){return this.parts.get(key)||null;}
  querySelectorAll(key){return key==="[data-picker-close]"?this.cancel:[];}
}
let mask;
const document={
  querySelector:()=>null,
  createElement:()=>{mask=new FakeMask();return mask;},
  body:{append(){}}
};
const folder=(id,name,kind,children=[],extra={})=>({
  id,name,type:"folder",children,
  biz:kind?{id:Number(id.replace(/^\D+/,"")),kind,...extra}:undefined,
  synthetic:!kind
});
const category={id:"k:achievement",type:"folder",name:"业务档案",synthetic:true,children:[]};
const root={id:"root",type:"folder",name:"我的文件",children:[category]};
const source=folder("af:1","来源", "archive_folder",[]);
const main=folder("af:2","多层归档","archive_folder",[]);
category.children.push(source,main);
let cursor=main;
for(let i=0;i<75;i++) {
  const child=folder("af:"+(100+i),"第"+(i+1)+"层","archive_folder",[]);
  cursor.children.push(child);cursor=child;
}
const deep=folder("af:8888","最深目标","archive_folder",[]);
cursor.children.push(deep);
for(let i=0;i<1230;i++)
  category.children.push(folder("af:"+(2000+i),"备选目录"+i,"archive_folder",[]));
const duplicate=folder("af:9999","已有相同原件","archive_folder",
  [{id:"f:9",type:"file",name:"重复附件"}]);
category.children.push(duplicate);
const sandbox=vm.createContext({
  document,
  VaultStore:{ws:"company",metaOf:id=>id==="f:9"?{fileId:555}:null},
  esc:s=>String(s).replace(/[&<>"']/g,ch=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch])),
  icon:(name,size)=>'<svg data-icon="'+name+'"></svg>'
});
vm.runInContext(code,sandbox,{filename:"folder-picker.js"});
const picker=vm.runInContext("AttachmentFolderPicker",sandbox);

const model=picker.index(root,1);
assert.equal(model.initialId,"k:achievement");
assert.equal(model.isTarget(model.byFolderId.get(1)),false,"Source cannot target itself");
assert.equal(model.isTarget(model.byFolderId.get(8888)),true,"Deepest real folder is valid");
assert.equal(model.path("af:8888").split(" / ").length,78,"75 nested levels preserve entire path");
assert.equal(model.nodes.get("k:achievement").selectable,false,"Virtual module is never a target");
assert.equal(model.nodes.get("root").selectable,false,"Virtual root is never a target");

function pickClick(target,name,id) {
  const attr="data-picker-"+name;
  const event={target:{closest:()=>({
    dataset:{"pickerEnter":id,"pickerChoose":id,"pickerGo":id},
    hasAttribute:key=>key===attr
  })}};
  return target.emit("click",event);
}
const get=key=>mask.querySelector("[data-picker-"+key+"]");
const submitted=[];
function open(move=false) {
  return picker.open({
    root,workspace:"company",sourceFolderId:1,fileName:"测试原件.pdf",
    fileId:555,move,onSubmit:async data=>{submitted.push(JSON.parse(JSON.stringify(data)));}
  });
}
(async()=>{
  const opened=open();
  assert.ok(get("search").focused,"Search input receives focus");
  assert.match(get("crumb").innerHTML,/业务档案/);
  assert.equal((get("list").innerHTML.match(/data-picker-enter=/g)||[]).length,40,
    "Only first 40 direct children rendered for over 1,000 siblings");
  assert.match(get("list").innerHTML,/剩余/);
  assert.equal(get("submit").disabled,true,"Browsing alone cannot commit");
  pickClick(get("list"),"more");
  assert.equal((get("list").innerHTML.match(/data-picker-enter=/g)||[]).length,80);
  get("search").value="备选目录1229";
  get("search").emit("input");
  assert.match(get("list").innerHTML,/备选目录1229/);
  assert.equal((get("list").innerHTML.match(/data-picker-enter=/g)||[]).length,1);
  get("search").value="";
  get("search").emit("input");

  // Click folder to navigate, not to submit; depth is not bounded.
  pickClick(get("list"),"enter","af:2");
  for(let i=0;i<75;i++)
    pickClick(get("list"),"enter","af:"+(100+i));
  assert.match(get("list").innerHTML,/最深目标/);
  assert.equal(get("submit").disabled,true);
  pickClick(get("list"),"enter","af:8888");
  get("current").emit("click");
  assert.match(get("target").textContent,/最深目标/);
  assert.equal(get("submit").disabled,false);
  await get("submit").emit("click");
  assert.deepEqual(submitted.at(-1),{target:"8888"});
  assert.equal(mask.removed,true);

  // Global search locates a deep folder by its name or full ancestor path.
  open(true);
  get("scope").emit("click");
  get("search").value="最深目标";
  get("search").emit("input");
  assert.match(get("list").innerHTML,/最深目标/);
  assert.match(get("list").innerHTML,/业务档案/);
  pickClick(get("list"),"enter","af:8888");
  assert.match(get("crumb").innerHTML,/最深目标/);
  assert.equal(get("submit").disabled,true);
  get("current").emit("click");
  await get("submit").emit("click");
  assert.deepEqual(submitted.at(-1),{target:"8888"});

  // Same-source and duplicate-FileId directories are not allowed targets.
  open();
  get("search").value="来源";
  get("search").emit("input");
  assert.match(get("list").innerHTML,/来源/);
  assert.match(get("list").innerHTML,/disabled/);
  get("search").value="已有相同原件";
  get("search").emit("input");
  assert.match(get("list").innerHTML,/已有相同原件/);
  assert.match(get("list").innerHTML,/disabled/);

  // Changed workspace must not write. Cancelling must be side-effect free.
  get("search").value="多层归档";
  get("search").emit("input");
  pickClick(get("list"),"choose","af:2");
  const before=submitted.length;
  sandbox.VaultStore.ws="personal";
  await get("submit").emit("click");
  assert.equal(submitted.length,before);
  assert.match(get("error").textContent,/工作区已变化/);
  sandbox.VaultStore.ws="company";
  mask.cancel[0].emit("click");
  assert.equal(mask.removed,true);
  assert.equal(submitted.length,before);
  console.log("FOLDER PICKER PASS: 75 levels, 1230 siblings, search, breadcrumb, selection, security");
})().catch(e=>{console.error(e);process.exitCode=1;});