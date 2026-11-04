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
  // Folder sharing/moving can select the module root, but never a source
  // folder, its descendant, a different module or the global drive root.
  const stack=[category];
  while(stack.length) {
    const n=stack.pop();
    if(n.biz?.kind==="archive_folder")n.biz.section="achievement";
    stack.push(...(n.children||[]).filter(x=>x.type==="folder"));
  }
  const nested=folder("af:90000","来源的下一级","archive_folder",[],{section:"achievement"});
  source.children.push(nested);
  const folderTargets=[];
  const openFolder=(move=false)=>picker.open({
    root,workspace:"company",sourceFolderId:1,sourceFolderIds:[1],
    folderMode:true,folderSection:"achievement",fileName:"来源",
    move,onSubmit:async data=>folderTargets.push(JSON.parse(JSON.stringify(data)))
  });
  openFolder(true);
  assert.match(mask.innerHTML,/移动文件夹/);
  assert.match(get("crumb").innerHTML,/业务档案/);
  assert.doesNotMatch(get("crumb").innerHTML,/data-picker-go="root"/);
  assert.equal(get("current").disabled,false,"Category top is a valid destination");
  get("current").emit("click");
  await get("submit").emit("click");
  assert.deepEqual(folderTargets.at(-1),{target:"0",targetSection:"achievement"},
    "Module root is sent as parent 0 with its module section");
  openFolder();
  assert.match(mask.innerHTML,/共享文件夹/);
  get("search").value="来源";
  get("search").emit("input");
  assert.match(get("list").innerHTML,/disabled/,"Selected folder cannot target itself");
  pickClick(get("list"),"enter","af:1");
  assert.match(get("list").innerHTML,/来源的下一级/);
  assert.match(get("list").innerHTML,/disabled/,"Descendant cannot be selected");
  assert.equal(get("current").disabled,true,"Source folder cannot be destination");
  get("scope").emit("click");
  get("search").value="最深目标";
  get("search").emit("input");
  assert.match(get("list").innerHTML,/最深目标/);
  pickClick(get("list"),"choose","af:8888");
  await get("submit").emit("click");
  assert.deepEqual(folderTargets.at(-1),{target:"8888",targetSection:"achievement"});
  // Cross-module moves expose only ordinary-data module categories.
  const another={id:"k:certificate",name:"企业资质",type:"folder",synthetic:true,
    children:[folder("af:90001","跨模块目标","archive_folder",[],
      {section:"certificate"})]};
  const projectCat={id:"k:project",name:"公司项目",type:"folder",synthetic:true,
    children:[folder("p:90002","项目容器","project",[])]};
  root.children.push(another,projectCat);
  const cross=()=>picker.open({
    root,workspace:"company",sourceFolderId:1,sourceFolderIds:[1],
    folderMode:true,folderSection:"achievement",
    folderSections:["achievement","certificate"],fileName:"来源",
    move:true,onSubmit:async data=>folderTargets.push(JSON.parse(JSON.stringify(data)))
  });
  cross();
  assert.match(get("crumb").innerHTML,/data-picker-go="root"/);
  pickClick(get("crumb"),"go","root");
  assert.equal(get("current").disabled,true,"Global root cannot be target");
  assert.match(get("list").innerHTML,/企业资质/);
  assert.doesNotMatch(get("list").innerHTML,/公司项目/);
  pickClick(get("list"),"enter","k:certificate");
  get("current").emit("click");
  await get("submit").emit("click");
  assert.deepEqual(folderTargets.at(-1),{target:"0",targetSection:"certificate"},
    "A different archive module top level is a valid target");
  cross();
  pickClick(get("crumb"),"go","root");
  pickClick(get("list"),"enter","k:certificate");
  pickClick(get("list"),"choose","af:90001");
  await get("submit").emit("click");
  assert.deepEqual(folderTargets.at(-1),{target:"90001",targetSection:"certificate"},
    "A folder under another archive module can receive an entire folder tree");
  cross();
  get("scope").emit("click");
  get("search").value="公司项目";
  get("search").emit("input");
  assert.doesNotMatch(get("list").innerHTML,/项目容器/,
    "Project business records remain forbidden as ordinary folder parents");
  mask.cancel[0].emit("click");
  // Project is a real destination parent, but the virtual project category
  // root is not: project-owned folders must always have a real project ancestor.
  const project=projectCat.children[0];
  const owned=folder("af:90003","项目内部目标","archive_folder",[],
    {section:"project",parentId:90002});
  project.children.push(owned);
  const crossProject=()=>picker.open({
    root,workspace:"company",sourceFolderId:1,sourceFolderIds:[1],
    folderMode:true,folderSection:"achievement",
    folderSections:["achievement","certificate","project"],fileName:"来源",
    move:true,onSubmit:async data=>folderTargets.push(JSON.parse(JSON.stringify(data)))
  });
  crossProject();
  pickClick(get("crumb"),"go","root");
  pickClick(get("list"),"enter","k:project");
  assert.equal(get("current").disabled,true,
    "Project module root is not a real destination");
  assert.match(get("list").innerHTML,/项目容器/);
  pickClick(get("list"),"choose","p:90002");
  await get("submit").emit("click");
  assert.deepEqual(folderTargets.at(-1),{target:"90002",targetSection:"project"},
    "Project record can receive ordinary folder tree as direct child");
  crossProject();
  pickClick(get("crumb"),"go","root");
  pickClick(get("list"),"enter","k:project");
  pickClick(get("list"),"enter","p:90002");
  pickClick(get("list"),"choose","af:90003");
  await get("submit").emit("click");
  assert.deepEqual(folderTargets.at(-1),{target:"90003",targetSection:"project"},
    "Nested ordinary project folder can receive moved subtree");
  // Regression: start from the real Explorer movement entry, not only the
  // picker in isolation. This previously closed the right-click menu without
  // displaying anything because bridge.js omitted "project" from its scopes.
  const projectSource=folder("af:90004","项目待移动","archive_folder",[],
    {section:"project",parentId:90002});
  const anotherProject=folder("p:90005","另一项目","project",[]);
  project.children.push(projectSource);
  projectCat.children.push(anotherProject);
  const locate=(id,node=root)=>{
    if(node.id===id)return node;
    for(const child of node.children||[]) {
      const found=locate(id,child);
      if(found)return found;
    }
    return null;
  };
  const locatePath=(id,node=root,ancestry=[])=>{
    if(node.id===id)return [...ancestry,node];
    for(const child of node.children||[]) {
      const found=locatePath(id,child,[...ancestry,node]);
      if(found)return found;
    }
    return null;
  };
  const commands=[],errors=[];
  sandbox.ROOT=root;
  sandbox.findById=id=>locate(id);
  sandbox.pathTo=id=>locatePath(id);
  sandbox.catsOf=()=>[
    {id:"achievement"},{id:"certificate"},{id:"project"}];
  sandbox.catIsDir=id=>["achievement","certificate"].includes(id);
  sandbox.fileTaskBusy=()=>false;
  sandbox.toast=msg=>errors.push(String(msg));
  sandbox.Drive={clearSelection(){}};
  sandbox.refreshCurrent=async()=>{};
  sandbox.VaultStore.api=async(url,opts)=>{
    commands.push({url,request:JSON.parse(JSON.stringify(opts.json))});
    return {ids:opts.json.items};
  };
  const bridge=fs.readFileSync(path.resolve(__dirname,
    "../wwwroot/js/bridge.js"),"utf8");
  const entryStart=bridge.indexOf("/* Ordinary-folder sharing and moving");
  const entryEnd=bridge.indexOf("/* F2-04:",entryStart);
  assert.ok(entryStart>=0 && entryEnd>entryStart,
    "Explorer folder transfer entry must be loaded for integration coverage");
  vm.runInContext(bridge.slice(entryStart,entryEnd),sandbox,
    {filename:"bridge-project-folder-move.js"});
  const moveFromMenu=vm.runInContext("moveSelectedItems",sandbox);
  const shareFromMenu=vm.runInContext("transferFolderBatch",sandbox);
  moveFromMenu([projectSource]);
  assert.ok(mask && !mask.removed,
    "Clicking move on a project child must open the destination dialog");
  assert.match(mask.innerHTML,/移动文件夹/);
  pickClick(get("crumb"),"go","root");
  assert.match(get("list").innerHTML,/公司项目/);
  pickClick(get("list"),"enter","k:achievement");
  get("current").emit("click");
  await get("submit").emit("click");
  assert.deepEqual(commands.at(-1),{
    url:"/api/v2/ui/folders/company/project/transfer-batch",
    request:{targetFolderId:0,targetSection:"achievement",
      move:true,items:[90004]}
  },"Moving a project subfolder to ordinary materials uses the project source scope");

  moveFromMenu([projectSource]);
  pickClick(get("crumb"),"go","root");
  pickClick(get("list"),"enter","k:project");
  assert.equal(get("current").disabled,true,
    "The virtual company-project category cannot own a folder");
  pickClick(get("list"),"choose","p:90005");
  await get("submit").emit("click");
  assert.deepEqual(commands.at(-1).request,{
    targetFolderId:90005,targetSection:"project",
    move:true,items:[90004]
  },"Project business records accept folders as direct children");

  shareFromMenu([projectSource],false);
  pickClick(get("crumb"),"go","root");
  pickClick(get("list"),"enter","k:certificate");
  pickClick(get("list"),"choose","af:90001");
  await get("submit").emit("click");
  assert.deepEqual(commands.at(-1).request,{
    targetFolderId:90001,targetSection:"certificate",
    move:false,items:[90004]
  },"Project folders share to other modules without changing their originals");

  const invalid=folder("af:90006","非法来源","archive_folder",[],
    {section:"invalid_section",parentId:90002});
  project.children.push(invalid);
  const countBefore=commands.length;
  moveFromMenu([invalid]);
  assert.equal(commands.length,countBefore);
  assert.match(errors.at(-1),/无法打开目标目录选择器/,
    "Synchronous picker rejection must be visible instead of a silent no-op");
  project.children.pop();
  console.log("FOLDER PICKER PASS: 75 levels, 1230 siblings, project-entry move/share, project destinations, search, security");
})().catch(e=>{console.error(e);process.exitCode=1;});