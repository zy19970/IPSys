/* IPSys local PDF canvas viewer; PDF.js © Mozilla Foundation, Apache-2.0.
 * Renders one page at a time and never executes embedded PDF JavaScript.
 * No browser PDF plugin, iframe, network CDN, or decrypted disk temp files.
 */
(function(){
"use strict";
function button(label,title,fn){
 const b=document.createElement('button');b.type='button';b.className='btn btn-sm';
 b.textContent=label;b.title=title;b.addEventListener('click',fn);return b;
}
function create(body,data){
 if(!window.pdfjsLib)throw Error('离线 PDF 阅读器未初始化。');
 const lib=window.pdfjsLib;
 lib.GlobalWorkerOptions.workerSrc='/pdfjs/pdf.worker.min.js';
 let closed=false,doc=null,loadTask=null,renderTask=null,pageNo=1,zoom=1,renderId=0;
 let next,prev,count,minus,plus,fit,canvas,area,status;
 body.replaceChildren();
 body.classList.add('pdf-mode');
 const toolbar=document.createElement('div');toolbar.className='pdf-toolbar';
 prev=button('上一页','上一页',()=>{if(pageNo>1){pageNo--;void renderPage();}});
 next=button('下一页','下一页',()=>{if(doc&&pageNo<doc.numPages){pageNo++;void renderPage();}});
 count=document.createElement('span');count.className='pdf-count';count.setAttribute('aria-live','polite');
 minus=button('−','缩小',()=>{zoom=Math.max(.5,zoom/1.25);void renderPage();});
 plus=button('＋','放大',()=>{zoom=Math.min(3,zoom*1.25);void renderPage();});
 fit=button('适应宽度','按预览框宽度显示',()=>{zoom=1;void renderPage();});
 toolbar.append(prev,count,next,minus,plus,fit);
 area=document.createElement('div');area.className='pdf-canvas-area';
 canvas=document.createElement('canvas');canvas.className='pdf-canvas';canvas.setAttribute('aria-label','PDF 当前页');
 area.append(canvas);
 status=document.createElement('div');status.className='pdf-render-status';status.setAttribute('role','status');
 status.textContent='正在解析 PDF…';
 body.append(toolbar,area,status);
 function updateButtons(){
  if(closed)return;
  count.textContent=doc?pageNo+' / '+doc.numPages:'加载中';
  prev.disabled=!doc||pageNo<=1;next.disabled=!doc||pageNo>=doc.numPages;
  minus.disabled=!doc||zoom<=.5;plus.disabled=!doc||zoom>=3;
  fit.disabled=!doc;
 }
 updateButtons();
 async function renderPage(){
  if(closed||!doc)return;
  const id=++renderId;
  if(renderTask){try{renderTask.cancel();}catch{}renderTask=null;}
  status.textContent='正在渲染第 '+pageNo+' 页…';
  updateButtons();
  try{
   const page=await doc.getPage(pageNo);
   if(closed||id!==renderId)return;
   const first=page.getViewport({scale:1});
   const available=Math.max(200,area.clientWidth-32);
   const scale=Math.min(3.5,Math.max(.15,available/first.width))*zoom;
   const viewport=page.getViewport({scale});
   const maxDpr=Math.min(window.devicePixelRatio||1,2);
   const dpr=Math.min(maxDpr,Math.sqrt(16000000/(viewport.width*viewport.height)));
   canvas.width=Math.max(1,Math.floor(viewport.width*dpr));
   canvas.height=Math.max(1,Math.floor(viewport.height*dpr));
   canvas.style.width=viewport.width+'px';
   canvas.style.height=viewport.height+'px';
   const context=canvas.getContext('2d',{alpha:false});
   if(!context)throw Error('当前浏览器不支持 PDF Canvas 预览。');
   area.scrollTop=0;area.scrollLeft=0;
   renderTask=page.render({
    canvasContext:context,viewport,
    transform:dpr===1?undefined:[dpr,0,0,dpr,0,0]
   });
   await renderTask.promise;
   if(!closed&&id===renderId)status.textContent='';
  }catch(e){
   if(closed||id!==renderId||e?.name==='RenderingCancelledException')return;
   status.textContent='PDF 第 '+pageNo+' 页渲染失败：'+(e?.message||String(e));
  }
 }
 async function open(){
  try{
   // Disable PDF font evaluator (CVE-2024-4367 mitigation). CSP forbids eval.
   loadTask=lib.getDocument({data:new Uint8Array(data),isEvalSupported:false});
   const nextDoc=await loadTask.promise;
   if(closed){void nextDoc.destroy();return;}
   doc=nextDoc;
   await renderPage();
  }catch(e){
   if(!closed)status.textContent='PDF 解析失败：'+(e?.message||String(e))+'。请下载原件检查。';
  }
 }
 function destroy(){
  if(closed)return;closed=true;renderId++;
  if(renderTask){try{renderTask.cancel();}catch{}renderTask=null;}
  if(loadTask){void loadTask.destroy();loadTask=null;}
  doc=null;
  canvas.width=0;canvas.height=0;
  body.replaceChildren();
  body.classList.remove('pdf-mode');
 }
 return {open,destroy};
}
window.IPSysPdfViewer={create};
})();
