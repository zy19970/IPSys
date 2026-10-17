/* Local original-file upload progress. XHR reports sent bytes without reading a
   multi-GiB File into JavaScript memory. 100% sent is not database success. */
"use strict";
(function(){
 const fmt=bytes=>bytes>=1024**3?(bytes/1024**3).toFixed(2)+' GiB':
  bytes>=1024**2?(bytes/1024**2).toFixed(1)+' MiB':
  (bytes/1024).toFixed(0)+' KiB';
 let state=null,controller=null,activeXhr=null,panel=null;
 function mount(){
  if(panel)return panel;
  panel=document.createElement('section');
  panel.id='uploadProgress';
  panel.className='upload-progress';
  panel.hidden=true;
  panel.setAttribute('role','region');
  panel.setAttribute('aria-label','原件上传进度');
  panel.innerHTML='<div class="upload-progress-heading"><strong>原件上传</strong>'+
   '<span id="uploadProgressCount"></span></div>'+
   '<div id="uploadProgressFile" class="upload-progress-file"></div>'+
   '<div class="upload-progress-meter"><progress id="uploadProgressMeter" max="100" value="0"></progress>'+
   '<strong id="uploadProgressPercent">0%</strong></div>'+
   '<div id="uploadProgressBytes" class="upload-progress-bytes"></div>'+
   '<div id="uploadProgressStage" class="upload-progress-stage" role="status" aria-live="polite"></div>'+
   '<div class="upload-progress-actions"><button type="button" class="btn btn-sm" id="uploadProgressCancel">取消上传</button>'+
   '<button type="button" class="btn btn-sm" id="uploadProgressClose" hidden>关闭</button></div>';
  document.body.append(panel);
  panel.querySelector('#uploadProgressCancel').onclick=cancel;
  panel.querySelector('#uploadProgressClose').onclick=()=>{if(!state?.active)panel.hidden=true;};
  return panel;
 }
 function field(id,value){mount().querySelector('#'+id).textContent=value;}
 function stage(message){if(state?.active)field('uploadProgressStage',message);}
 function begin(count){
  if(state?.active)return false;
  controller=new AbortController();
  state={active:true,cancelled:false,count,index:0,file:null,started:0,sent:0};
  mount().hidden=false;
  panel.querySelector('#uploadProgressCancel').hidden=false;
  panel.querySelector('#uploadProgressClose').hidden=true;
  field('uploadProgressCount','共 '+count+' 份');
  field('uploadProgressFile','准备上传…');
  field('uploadProgressBytes','');
  meter(0);
  stage('正在准备文件');
  onActiveChanged?.(true);
  return true;
 }
 function meter(p){
  mount().querySelector('#uploadProgressMeter').value=Math.max(0,Math.min(100,p));
  field('uploadProgressPercent',p.toFixed(1)+'%');
 }
 function file(item,index){
  if(!state?.active)return;
  state.index=index;state.file=item;state.sent=0;state.started=Date.now();
  field('uploadProgressCount','第 '+index+' / '+state.count+' 份');
  field('uploadProgressFile',item.name);
  field('uploadProgressBytes','0 B / '+fmt(item.size));
  meter(0);
  stage('正在发送原件…');
 }
 function transfer(loaded,total){
  if(!state?.active||state.cancelled)return;
  const size=state.file?.size??total,denominator=size||total;
  state.sent=Math.min(loaded,size);
  meter(denominator?Math.min(100,100*loaded/denominator):100);
  const seconds=Math.max(0.001,(Date.now()-state.started)/1000);
  field('uploadProgressBytes',fmt(state.sent)+' / '+fmt(size)+
   (state.sent>0&&seconds>=1?' · '+fmt(state.sent/seconds)+'/s':''));
 }
 function signal(){return controller?.signal;}
 function cancelled(){return !!state?.cancelled;}
 function cancel(){
  if(!state?.active||state.cancelled)return;
  state.cancelled=true;
  panel.querySelector('#uploadProgressCancel').disabled=true;
  field('uploadProgressStage','已请求取消，正在终止传输和清理暂存数据…');
  controller.abort();
  window.dispatchEvent(new Event('ipsys-upload-cancel'));
  activeXhr?.abort();
 }
 function finish({completed=0,errors=[],skipped=0,warnings=[]}={}){
  if(!state)return;
  const wasCancelled=state.cancelled;
  const unprocessed=Math.max(0,state.count-completed-errors.length-skipped);
  state.active=false;
  activeXhr=null;
  panel.querySelector('#uploadProgressCancel').hidden=true;
  panel.querySelector('#uploadProgressCancel').disabled=false;
  panel.querySelector('#uploadProgressClose').hidden=false;
  field('uploadProgressCount','共 '+state.count+' 份');
  field('uploadProgressStage',(wasCancelled?'已请求取消；若服务端已提交，请刷新附件列表核对。':'上传已结束。')+
   ' 已保存 '+completed+'，失败 '+errors.length+'，跳过/未处理 '+(skipped+unprocessed)+'。'+
   (errors.length?' 失败：'+errors.join('；'):'')+
   (warnings.length?' 提醒：'+warnings.join('；'):''));
  field('uploadProgressBytes',wasCancelled?'已终止本次传输。':
   '以服务器保存结果为准；已发送 100% 不代表已入库。');
  onActiveChanged?.(false);
 }
 let onActiveChanged=null;
 // The token is set by the authenticated app.js API wrapper; never log it.
 function request(path,opts,token){
  if(!state?.active)throw Error('请先初始化上传任务。');
  if(state.cancelled)return Promise.reject(new DOMException('上传已取消','AbortError'));
  if(!(opts.body instanceof Blob))throw Error('上传请求需要浏览器 File/Blob。');
  return new Promise((resolve,reject)=>{
   const xhr=new XMLHttpRequest();
   activeXhr=xhr;
   let settled=false;
   function settle(error,result){
    if(settled)return;settled=true;
    controller?.signal.removeEventListener('abort',onAbort);
    if(activeXhr===xhr)activeXhr=null;
    if(error)reject(error);else resolve(result);
   }
   function onAbort(){xhr.abort();}
   xhr.open(opts.method||'POST',path,true);
   xhr.setRequestHeader('X-IPSys-Token',token);
   xhr.setRequestHeader('Cache-Control','no-store');
   for(const [name,value] of Object.entries(opts.headers||{}))
    xhr.setRequestHeader(name,value);
   xhr.upload.onprogress=event=>{
    // File length is known even if the browser does not mark its progress computable.
    transfer(event.loaded,event.lengthComputable?event.total:opts.body.size);
   };
   xhr.upload.onload=()=>{
    transfer(opts.body.size,opts.body.size);
    stage('已发送 100%，正在等待服务器完成 SHA-256 校验和加密入库…');
   };
   xhr.onload=()=>{
    if(state?.cancelled)return settle(new DOMException('上传已取消','AbortError'));
    if(xhr.status>=200&&xhr.status<300){
     stage('服务器已返回，正在检查文件结果…');
     settle(null,{ok:true,status:xhr.status,json:async()=>JSON.parse(xhr.responseText)});
    }else{
     let message='请求失败：'+xhr.status;
     try{message=JSON.parse(xhr.responseText).error||message;}catch{}
     const error=new Error(message);error.status=xhr.status;
     settle(error);
    }
   };
   xhr.onerror=()=>settle(new Error('传输连接中断，保存结果可能不确定；请刷新附件列表确认后再重试。'));
   xhr.onabort=()=>settle(new DOMException('上传已取消','AbortError'));
   xhr.upload.onerror=()=>settle(new Error('无法发送原件，请检查连接。'));
   controller.signal.addEventListener('abort',onAbort,{once:true});
   if(controller.signal.aborted){onAbort();return;}
   xhr.send(opts.body);
  });
 }
 const api={begin,file,transfer,stage,finish,cancel,cancelled,signal,request};
 Object.defineProperty(api,'onActiveChanged',{
  set(callback){onActiveChanged=callback;},
  get(){return onActiveChanged;}
 });
 globalThis.IPSysUploadProgress=api;
})();
