/* IPSys local continuous PDF viewer; PDF.js © Mozilla Foundation, Apache-2.0.
 * Pages form one vertical scroll surface; canvases are rasterized only near
 * the viewport and released when far away. No PDF plugin, CDN, eval, or temp file.
 */
(function(){
"use strict";

function button(label,title,fn){
 const b=document.createElement('button');
 b.type='button';b.className='btn btn-sm';
 b.textContent=label;b.title=title;b.addEventListener('click',fn);
 return b;
}

function create(body,data){
 if(!window.pdfjsLib)throw Error('离线 PDF 阅读器未初始化。');
 const lib=window.pdfjsLib;
 lib.GlobalWorkerOptions.workerSrc='/pdfjs/pdf.worker.min.js';
 let closed=false,doc=null,loadTask=null,renderTask=null,active=null;
 let zoom=1,baseWidth=0,baseHeight=0,currentPage=1,rendering=false;
 let refreshFrame=0;
 const pages=[],queued=new Set();

 body.replaceChildren();
 body.classList.add('pdf-mode');
 const toolbar=document.createElement('div');
 toolbar.className='pdf-toolbar';
 const count=document.createElement('span');
 count.className='pdf-count';count.setAttribute('aria-live','polite');
 const minus=button('−','缩小',()=>setZoom(zoom/1.25));
 const plus=button('＋','放大',()=>setZoom(zoom*1.25));
 const fit=button('适应宽度','按预览框宽度显示',()=>setZoom(1));
 toolbar.append(count,minus,plus,fit);

 const area=document.createElement('div');
 area.className='pdf-canvas-area';
 area.setAttribute('aria-label','PDF 连续滚动阅读区域');
 const status=document.createElement('div');
 status.className='pdf-render-status';status.setAttribute('role','status');
 status.textContent='正在解析 PDF…';
 body.append(toolbar,area,status);

 function updateToolbar(){
  if(closed)return;
  count.textContent=doc?'第 '+currentPage+' / '+doc.numPages+' 页':'加载中';
  minus.disabled=!doc||zoom<=.5;
  plus.disabled=!doc||zoom>=3;
  fit.disabled=!doc;
 }

 function scale(){
  const available=Math.max(200,area.clientWidth-32);
  return Math.min(3.5,Math.max(.15,available/baseWidth))*zoom;
 }

 function release(item){
  item.needed=false;item.generation++;
  queued.delete(item);
  if(active===item&&renderTask){try{renderTask.cancel();}catch{}}
  if(item.canvas){
   item.canvas.width=0;item.canvas.height=0;
   item.canvas.remove();item.canvas=null;
  }
 }

 function layout(){
  if(!doc||closed)return;
  const keep=currentPage;
  const factor=scale();
  for(const item of pages){
   release(item);
   item.failed=false;
   // Use the first page as a low-cost placeholder until the real page loads.
   const width=item.sourceWidth||baseWidth;
   const height=item.sourceHeight||baseHeight;
   item.slot.style.width=Math.round(width*factor)+'px';
   item.slot.style.height=Math.round(height*factor)+'px';
  }
  if(pages[keep-1])area.scrollTop=pages[keep-1].slot.offsetTop;
  scheduleRefresh();
 }

 function setZoom(value){
  const next=Math.min(3,Math.max(.5,value));
  if(closed||!doc||next===zoom)return;
  zoom=next;
  layout();
 }

 function updateVisible(){
  if(closed||!doc)return;
  const top=area.scrollTop;
  const height=Math.max(200,area.clientHeight);
  const nearTop=top-height;
  const nearBottom=top+height*2;
  const focus=top+height*.35;
  let current=1;
  for(const item of pages){
   const start=item.slot.offsetTop;
   const end=start+item.slot.offsetHeight;
   if(start<=focus)current=item.no;
   const needed=end>=nearTop&&start<=nearBottom;
   if(needed){
    item.needed=true;
    if(!item.canvas&&!item.failed)queued.add(item);
   }else if(item.needed||item.canvas){
    release(item);
   }
  }
  currentPage=current;
  updateToolbar();
  void drawQueue();
 }

 function scheduleRefresh(){
  if(closed||refreshFrame)return;
  refreshFrame=window.requestAnimationFrame(()=>{
   refreshFrame=0;
   updateVisible();
  });
 }

 async function drawQueue(){
  if(rendering||closed)return;
  rendering=true;
  try{
   while(!closed&&queued.size){
    // Prioritize the page nearest the current view, even after a fast scroll.
    const item=Array.from(queued).sort((a,b)=>
     Math.abs(a.no-currentPage)-Math.abs(b.no-currentPage))[0];
    queued.delete(item);
    if(!item.needed||item.canvas||item.failed)continue;
    const generation=item.generation;
    try{
     const page=await doc.getPage(item.no);
     if(closed||!item.needed||generation!==item.generation)continue;
     const size=page.getViewport({scale:1});
     item.sourceWidth=size.width;item.sourceHeight=size.height;
     const viewport=page.getViewport({scale:scale()});
     item.slot.style.width=Math.round(viewport.width)+'px';
     item.slot.style.height=Math.round(viewport.height)+'px';
     const maxDpr=Math.min(window.devicePixelRatio||1,2);
     const dpr=Math.min(maxDpr,Math.sqrt(16000000/(viewport.width*viewport.height)));
     const canvas=document.createElement('canvas');
     canvas.className='pdf-canvas';
     canvas.setAttribute('aria-label','PDF 第 '+item.no+' 页');
     canvas.width=Math.max(1,Math.floor(viewport.width*dpr));
     canvas.height=Math.max(1,Math.floor(viewport.height*dpr));
     canvas.style.width=viewport.width+'px';
     canvas.style.height=viewport.height+'px';
     const ctx=canvas.getContext('2d',{alpha:false});
     if(!ctx)throw Error('当前浏览器不支持 PDF Canvas 预览。');
     item.canvas=canvas;item.slot.append(canvas);
     active=item;
     renderTask=page.render({
      canvasContext:ctx,viewport,
      transform:dpr===1?undefined:[dpr,0,0,dpr,0,0]
     });
     await renderTask.promise;
     if(!closed&&generation===item.generation)status.textContent='';
    }catch(e){
     if(closed||generation!==item.generation||e?.name==='RenderingCancelledException')
      continue;
     item.failed=true;
     status.textContent='PDF 第 '+item.no+' 页渲染失败：'+(e?.message||String(e));
     release(item);
    }finally{
     if(active===item){active=null;renderTask=null;}
    }
   }
  }finally{
   rendering=false;
   if(!closed&&queued.size)void drawQueue();
  }
 }

 async function open(){
  try{
   // Disable PDF font evaluator (CVE-2024-4367 mitigation). CSP forbids eval.
   loadTask=lib.getDocument({data:new Uint8Array(data),isEvalSupported:false});
   const nextDoc=await loadTask.promise;
   if(closed){void nextDoc.destroy();return;}
   doc=nextDoc;
   const first=await doc.getPage(1);
   if(closed)return;
   const dimensions=first.getViewport({scale:1});
   baseWidth=dimensions.width;baseHeight=dimensions.height;
   const factor=scale();
   for(let no=1;no<=doc.numPages;no++){
    const slot=document.createElement('div');
    slot.className='pdf-page';
    slot.setAttribute('role','group');
    slot.setAttribute('aria-label','第 '+no+' 页');
    slot.style.width=Math.round(baseWidth*factor)+'px';
    slot.style.height=Math.round(baseHeight*factor)+'px';
    const item={no,slot,canvas:null,needed:false,failed:false,
     generation:0,sourceWidth:0,sourceHeight:0};
    pages.push(item);area.append(slot);
   }
   currentPage=1;
   updateToolbar();
   scheduleRefresh();
  }catch(e){
   if(!closed)status.textContent='PDF 解析失败：'+(e?.message||String(e))+'。请下载原件检查。';
  }
 }

 function destroy(){
  if(closed)return;
  closed=true;
  area.removeEventListener('scroll',scheduleRefresh);
  window.removeEventListener('resize',layout);
  if(refreshFrame)window.cancelAnimationFrame(refreshFrame);
  if(renderTask){try{renderTask.cancel();}catch{}renderTask=null;}
  for(const item of pages)release(item);
  pages.length=0;queued.clear();
  if(loadTask){void loadTask.destroy();loadTask=null;}
  doc=null;
  body.replaceChildren();
  body.classList.remove('pdf-mode');
 }

 area.addEventListener('scroll',scheduleRefresh,{passive:true});
 window.addEventListener('resize',layout);
 updateToolbar();
 return {open,destroy};
}
window.IPSysPdfViewer={create};
})();