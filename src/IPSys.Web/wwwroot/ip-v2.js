// Knowledge-property V2 user-interface adapter.
// This file maps actual FolderId/FileId/linkId/version to the frozen table
// without creating a second resource table or writing the legacy IP store.
(function(){
 "use strict";
 const clean=s=>String(s??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
 }[c]));
 function url(workspace,ipId,fileId,version){
  return "/api/v2/ip/"+workspace+"/"+ipId+"/files/"+fileId+
   "/versions/"+version+"/download";
 }
 function project(raw){
  return {
   rows:raw.rows.map(r=>({id:r.id,workspace:r.workspace,data:r.data})),
   files:raw.files.map(f=>({
    id:-(f.linkId*100000+f.version),v2:true,
    linkId:f.linkId,fileId:f.fileId,ownerId:f.folderId,
    kind:"ip",section:"",groupId:"v2-ip-"+f.linkId,
    version:f.version,name:f.name,category:f.category,
    size:f.size,sha256:f.sha256,source:"v2ip"
   }))
  };
 }
 async function load(api,workspace){
  const resp=await api("/api/v2/ui/ip/"+workspace);
  return project(await resp.json());
 }
 function selectMatch(file,matches,signal){
  if(signal?.aborted)return Promise.resolve(null);
  return new Promise(resolve=>{
   const dlg=document.createElement("dialog");
   dlg.className="input-dialog upload-conflict-dialog";
   dlg.setAttribute("aria-label","相同内容附件的处理方式");
   const options=matches.map((m,i)=>
    '<div class="fileline"><div class="filedesc"><strong>'+clean(m.name)+
    '</strong><small>位置：'+clean(m.folders.join(" / "))+
    ' · FileId '+m.fileId+' · 版本 '+m.version+
    '</small></div><div class="actions">'+
    '<button class="btn" data-pick="'+i+':share-file">引用同一文件</button>'+
    '<button class="btn" data-pick="'+i+':reuse-content">仅复用内容</button>'+
    '</div></div>').join("");
   dlg.innerHTML='<h3>上传内容检索</h3><p class="hint">文件“'+
    clean(file.name)+'”已计算内容摘要。'+
    (matches.length?"检测到相同原件，包含名称不同的文件；请选择复用方式。":
     "未发现相同内容，可保存为独立文件。")+
    '</p>'+options+'<div class="dialogactions">'+
    '<button class="btn primary" data-pick="independent">独立保存</button>'+
    '<button class="btn" data-pick="cancel">取消上传</button></div>';
   document.body.append(dlg);
   let done=false;
   function finish(value){
    if(done)return;done=true;
    signal?.removeEventListener("abort",onAbort);
    if(dlg.open)dlg.close();dlg.remove();resolve(value);
   }
   function onAbort(){finish(null);}
   signal?.addEventListener("abort",onAbort,{once:true});
   dlg.addEventListener("click",event=>{
    const value=event.target.closest("[data-pick]")?.dataset.pick;
    if(!value)return;
    if(value==="cancel")return finish(null);
    if(value==="independent")return finish({choice:value});
    const [index,choice]=value.split(":");
    const matched=matches[Number(index)];
    if(matched)finish({choice,sourceFileId:matched.fileId});
   });
   dlg.addEventListener("cancel",event=>{event.preventDefault();finish(null);});
   if(signal?.aborted)finish(null);else dlg.showModal();
  });
 }
 async function upload(api,file,meta,workspace){
  const path="/api/v2/files/"+workspace;
  const headers={
   "Content-Type":"application/octet-stream",
   "X-File-Name":encodeURIComponent(file.name),
   ...(meta.kind==="ip"?{"X-Material-Category":encodeURIComponent(meta.category||"其他材料")}:{})
  };
  const prepared=await(await api.uploadFile(path+"/prepare?folderId="+meta.ownerId,
   {method:"POST",headers,body:file})).json();
  api.uploadProgress.stage("原件已加密暂存，正在查找相同内容…");
  let finished=false;
  try{
   // A unique original has only one meaningful action. Do not make the
   // user confirm it for every small file in a batch. Duplicates still require
   // an explicit decision because they may share FileId or physical bytes.
   const matches=prepared.matches||[];
   let choice;
   if(matches.length){
    api.uploadProgress.stage("检测到相同内容，请选择共享、复用或独立保存。");
    choice=await selectMatch(file,matches,api.uploadProgress.signal());
   }else{
    api.uploadProgress.stage("未发现相同内容，正在自动独立保存…");
    choice={choice:"independent"};
   }
   if(!choice)return null;
   api.uploadProgress.stage("已选择保存方式，正在提交文件关联与版本记录…");
   const result=await(await api(path+"/prepared/"+prepared.ticket+"/resolve",
    {method:"POST",json:choice,signal:api.uploadProgress.signal()})).json();
   finished=true;
   api.uploadProgress.stage("服务器已确认：原件归档成功。");
   return result;
  }finally{
   if(!finished){
    try{await api(path+"/prepared/"+prepared.ticket,{method:"DELETE"});}
    catch(e){/* The vault will also discard unfinished objects on lock/reopen. */}
   }
  }
 }
 async function newVersion(api,record,workspace){
  const input=document.createElement("input");
  input.type="file";
  return new Promise(resolve=>{
   input.addEventListener("cancel",()=>resolve(false),{once:true});
   input.addEventListener("change",async()=>{
    const file=input.files?.[0];if(!file)return resolve(false);
    const progress=api.uploadProgress;
    if(!progress.begin(1))return resolve(new Error("已有文件正在上传。"));
    progress.file(file,1);
    let completed=0;
    const errors=[];
    try{
     await api.uploadFile(record.kind==="ip"?"/api/v2/ip/"+workspace+"/"+record.ownerId+"/files/"+
      record.fileId+"/versions":"/api/v2/files/"+workspace+"/"+record.fileId+"/versions",{method:"POST",
      headers:{"Content-Type":"application/octet-stream",
       "X-File-Name":encodeURIComponent(file.name)},body:file});
     completed=1;resolve(true);
    }catch(error){
     if(error?.name!=="AbortError")errors.push(file.name+"："+error.message);
     resolve(error?.name==="AbortError"?false:error);
    }finally{progress.finish({completed,errors});}
   },{once:true});
   input.click();
  });
 }
 async function associate(api,record,workspace,records){
  const others=records.filter(r=>r.id!==record.ownerId);
  if(!others.length)throw Error("当前工作区还没有其它知识产权记录。");
  const dlg=document.createElement("dialog");
  dlg.className="input-dialog";
  dlg.innerHTML='<h3>将现有 FileId 共享至其它知识产权</h3>'+
   '<p class="hint">共享后仍只有一份文件和同一个版本历史，解除某个位置不会删除原件。</p>'+
   '<label>目标知识产权</label><select id="nativeIpTarget">'+others.map(r=>
    '<option value="'+r.id+'">'+clean(r.data.name)+'</option>').join("")+
   '</select><div class="dialogactions"><button class="btn primary" data-assoc="yes">确认共享</button>'+
   '<button class="btn" data-assoc="no">取消</button></div>';
  document.body.append(dlg);
  const id=await new Promise(resolve=>{
   let done=false;
   const finish=x=>{if(done)return;done=true;if(dlg.open)dlg.close();dlg.remove();resolve(x);};
   dlg.addEventListener("click",ev=>{
    const choice=ev.target.closest("[data-assoc]")?.dataset.assoc;
    if(choice)finish(choice==="yes"?Number(dlg.querySelector("select").value):null);
   });
   dlg.addEventListener("cancel",ev=>{ev.preventDefault();finish(null);});
   dlg.showModal();
  });
  if(id==null)return false;
  await api("/api/v2/ip/"+workspace+"/"+id+"/files/"+record.fileId+"/associate",
   {method:"POST",json:{materialCategory:record.category||"其他材料"}});
  return true;
 }
 function fileUrl(workspace,record){
  return record.kind==="ip"?url(workspace,record.ownerId,record.fileId,record.version):
   "/api/v2/files/"+workspace+"/"+record.fileId+"/versions/"+record.version+"/download";
 }
 async function loadProjectFiles(api,workspace){
  const response=await api("/api/v2/ui/project-files/"+workspace);
  const files=await response.json();
  return files.map(f=>({
   id:-(f.linkId*100000+f.version),v2:true,
   linkId:f.linkId,fileId:f.fileId,ownerId:f.folderId,
   kind:f.kind,section:"",groupId:"v2-file-"+f.linkId,
   version:f.version,name:f.name,category:f.category,
   size:f.size,sha256:f.sha256,source:"v2file"
  }));
 }
 globalThis.IPSysNativeIp={load,url,fileUrl,loadProjectFiles,upload,
  newVersion,associate};
})();
