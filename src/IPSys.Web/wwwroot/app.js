const el=(id)=>document.getElementById(id);
let token=sessionStorage.getItem("ip-token")||"";
let dbName=sessionStorage.getItem("ip-db")||"";
let space="company",creating=true;
function notice(text,bad=false){const e=el("toast");e.textContent=text;e.className=bad?"visible bad":"visible";clearTimeout(notice.timer);notice.timer=setTimeout(()=>e.className="",4200);}
async function api(path,opts={}){
  const headers=new Headers(opts.headers||{});
  if(token)headers.set("X-IPSys-Token",token);
  if(opts.json!==undefined){headers.set("Content-Type","application/json");opts.body=JSON.stringify(opts.json);}
  const res=await fetch(path,{...opts,headers,cache:"no-store"});
  if(!res.ok){let msg="请求失败："+res.status;try{msg=(await res.json()).error||msg;}catch{}
    if(res.status===401){token="";sessionStorage.clear();screen(false);}
    throw new Error(msg);}
  return res;
}
function screen(unlocked){el("locked").hidden=unlocked;el("unlocked").hidden=!unlocked;if(unlocked){el("dbName").textContent=dbName;refresh();}}
function mode(value){creating=value;el("newMode").classList.toggle("chosen",value);el("oldMode").classList.toggle("chosen",!value);
 el("confirmWrap").hidden=!value;el("submitOpen").textContent=value?"创建并进入":"解锁并进入";}
el("newMode").onclick=()=>mode(true);el("oldMode").onclick=()=>mode(false);
el("openForm").onsubmit=async ev=>{
 ev.preventDefault();const pass=el("password").value;
 if(creating&&pass!==el("confirm").value){notice("两次密码不一致",true);return;}
 el("submitOpen").disabled=true;
 try{const data=await(await api("/api/open",{method:"POST",json:{path:el("dbPath").value,password:pass,create:creating}})).json();
   token=data.token;dbName=data.name;sessionStorage.setItem("ip-token",token);sessionStorage.setItem("ip-db",dbName);
   el("password").value="";el("confirm").value="";screen(true);notice("加密资料库已打开");
 }catch(e){notice(e.message,true);}finally{el("submitOpen").disabled=false;}
};
function node(tag,cls="",text=""){const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;}
function button(text,cls,fn){const b=node("button",cls,text);b.type="button";b.onclick=fn;return b;}
async function refresh(){
 if(!token)return screen(false);
 el("workspaceName").textContent=space==="company"?"公司工作区":"个人工作区";
 try{const rows=await(await api("/api/records/"+space)).json();
  el("recordCount").textContent=rows.length;
  el("fileCount").textContent=rows.reduce((n,x)=>n+x.files.length,0);
  const container=el("records");container.replaceChildren();
  if(!rows.length){container.append(node("div","empty","还没有记录。先新建资料，再上传文件。"));return;}
  for(const r of rows){
    const card=node("article","card"),head=node("div","cardhead"),title=node("strong","",r.title);
    title.append(node("span","muted","#"+r.id));head.append(title);
    const f=document.createElement("input");f.type="file";f.className="fileinput";
    f.onchange=async()=>{if(f.files[0])await upload(r.id,f.files[0]);f.value="";};
    head.append(button("＋ 上传文件","sub",()=>f.click()),f);card.append(head);
    if(!r.files.length)card.append(node("p","muted","当前记录尚无附件。"));
    for(const item of r.files){
      const row=node("div","file"),info=node("div","fileinfo",item.name);
      info.append(node("small","",(item.size/1024).toFixed(1)+" KiB · SHA-256 "+item.sha256.slice(0,14)+"…"));
      row.append(info,button("下载原件","sub",()=>download(item)));card.append(row);
    }container.append(card);
  }
 }catch(e){notice(e.message,true);}
}
async function upload(id,file){
 if(file.size>64*1024*1024){notice("首轮网页版单文件不超过 64 MiB",true);return;}
 notice("正在写入加密数据库，请等待上传完成…");
 try{const data=await(await api("/api/records/"+space+"/"+id+"/files",
   {method:"POST",headers:{"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name)},body:file})).json();
   notice("上传成功，SHA-256 "+data.sha256.slice(0,16)+"…");await refresh();
 }catch(e){notice(e.message,true);}
}
async function download(item){
 try{const res=await api("/api/files/"+space+"/"+item.id);const blob=await res.blob();
   const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=item.name;
   document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   notice("已开始下载 "+item.name);
 }catch(e){notice(e.message,true);}
}
document.querySelectorAll("[data-space]").forEach(b=>b.onclick=()=>{
 space=b.dataset.space;document.querySelectorAll("[data-space]").forEach(x=>x.classList.toggle("active",x===b));if(token)refresh();
});
el("addRecord").onclick=()=>el("modal").showModal();
el("cancelRecord").onclick=()=>el("modal").close();
el("newRecordForm").onsubmit=async ev=>{
 ev.preventDefault();el("saveRecord").disabled=true;
 try{await api("/api/records/"+space,{method:"POST",json:{title:el("title").value.trim()}});
   el("modal").close();el("title").value="";await refresh();notice("新建资料成功");
 }catch(e){notice(e.message,true);}finally{el("saveRecord").disabled=false;}
};
el("checkDb").onclick=async()=>{
 try{const s=await(await api("/api/check")).json();el("checkResult").textContent="完整性："+s.result+"；未完成附件："+s.incomplete;
   notice(s.result==="ok"?"数据库完整性检查通过":"数据库检查异常",s.result!=="ok");
 }catch(e){notice(e.message,true);}
};
el("closeDb").onclick=async()=>{
 if(!confirm("关闭数据库？下次打开需要再次输入密码。"))return;
 try{await api("/api/lock",{method:"POST"});token="";sessionStorage.clear();screen(false);notice("已安全关闭数据库");}
 catch(e){notice(e.message,true);}
};
el("exit").onclick=async()=>{
 if(!confirm("安全退出本地服务并关闭数据库？"))return;
 try{if(token)await api("/api/exit",{method:"POST"});sessionStorage.clear();
   document.body.replaceChildren(node("div","empty","IPSys 已退出，可以关闭此页面。"));
 }catch(e){notice(e.message,true);}
};
(async()=>{
 mode(true);
 try{const s=await(await api("/api/status")).json();el("dbPath").value=s.suggestion;
    if(token&&s.unlocked)screen(true);else{token="";sessionStorage.clear();screen(false);}
 }catch(e){notice("本地服务不可用："+e.message,true);}
})();
