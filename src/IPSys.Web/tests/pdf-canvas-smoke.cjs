// Offline PDF canvas viewer, without Chromium embedded-PDF iframe/plugin.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'../wwwroot');
const pdfJS=fs.readFileSync(path.join(root,'pdfjs/pdf.min.js'));
const worker=fs.readFileSync(path.join(root,'pdfjs/pdf.worker.min.js'));
function gitSha(bytes){
 // Windows checkout may convert the upstream LF asset to CRLF.
 const raw=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
 return crypto.createHash('sha1').update(
  Buffer.concat([Buffer.from('blob '+raw.length+'\0'),raw])).digest('hex');
}
assert.equal(gitSha(pdfJS),'4d430208fdaff174b880faf78aa90eb5280ce90e');
assert.equal(gitSha(worker),'6bbfaeede7465b9270475dd9028e2b7022a2a832');
// The official frontend and the PDF preview module both reside in wwwroot.
const shell=path.resolve(__dirname,'../wwwroot');
const app=fs.readFileSync(path.join(shell,'js/interactions.js'),'utf8');
const css=fs.readFileSync(path.join(shell,'css/app.css'),'utf8');
const program=fs.readFileSync(path.resolve(__dirname,'../Program.cs'),'utf8');
assert.ok(!app.includes('#view=FitH'),'Native PDF iframe path must be removed');
assert.ok(app.includes('viewer.create(body, buffer)')&&
 app.includes('pdfViewer?.destroy?.()'),'PDF canvas viewer must mount and release');
assert.ok(program.includes("worker-src 'self'")&&
 program.includes('"/pdfjs/pdf.worker.min.js"'),'Worker must be local and allowed by CSP');
function cssBlock(selector){
 const at=css.indexOf(selector);
 assert.ok(at>=0,'Stylesheet must style '+selector);
 const open=css.indexOf('{',at);
 return css.slice(open,css.indexOf('}',open));
}
assert.ok(/display:\s*flex/.test(cssBlock('.pdf-mode'))&&
 /flex-direction:\s*column/.test(cssBlock('.pdf-mode')),'PDF must occupy actual modal viewport');
assert.ok(/flex:\s*1/.test(cssBlock('.pdf-canvas-area'))&&
 /min-height:\s*0/.test(cssBlock('.pdf-canvas-area'))&&
 /overflow:\s*auto/.test(cssBlock('.pdf-canvas-area')),
 'PDF document area must scroll vertically within the modal');
assert.ok(/position:\s*relative/.test(cssBlock('.pdf-page'))&&
 /margin:\s*0 auto 16px/.test(cssBlock('.pdf-page')),
 'Continuous PDF pages must be stacked with a visible gap');

const elements=[];
let rafId=0;
const frames=new Map();
const resizeListeners={};
function node(tag){
 const e={
  tag,children:[],listeners:{},className:'',attributes:{},style:{},disabled:false,
  classList:{add(){},remove(){}},
  clientWidth:850,clientHeight:620,scrollTop:0,width:0,height:0,textContent:'',
  parent:null,
  append(...items){for(const item of items){item.parent=this;this.children.push(item);}},
  replaceChildren(){for(const child of this.children)child.parent=null;this.children=[];},
  addEventListener(event,cb){this.listeners[event]=cb;},
  removeEventListener(event){delete this.listeners[event];},
  setAttribute(key,value){this.attributes[key]=value;},
  click(){this.listeners.click?.();},
  remove(){
   if(this.parent){
    const at=this.parent.children.indexOf(this);
    if(at>=0)this.parent.children.splice(at,1);
   }
   this.parent=null;
  },
  getContext(){return {fillRect(){}};},
  get offsetHeight(){return parseInt(this.style.height,10)||0;},
  get offsetTop(){
   if(!this.parent)return 0;
   let y=16; // scroll area's top padding
   for(const previous of this.parent.children){
    if(previous===this)break;
    y+=previous.offsetHeight+16; // inter-page gutter
   }
   return y;
  }
 };
 elements.push(e);
 return e;
}
const body=node('body');
const views=[];
let loadingSettings,wasDestroyed=false;
const library={
 GlobalWorkerOptions:{},
 getDocument(options){
  loadingSettings=options;
  return {
   promise:Promise.resolve({
    numPages:7,
    async getPage(no){
     return {
      getViewport({scale}){return {width:600*scale,height:840*scale};},
      render(opts){
       views.push({page:no,viewport:opts.viewport});
       return {promise:Promise.resolve(),cancel(){}};
      }
     };
    },
    destroy(){wasDestroyed=true;}
   }),
   destroy(){wasDestroyed=true;return Promise.resolve();}
  };
 }
};
const vmCtx=vm.createContext({
 document:{createElement:node},
 window:{
  pdfjsLib:library,devicePixelRatio:2,
  requestAnimationFrame(cb){const id=++rafId;frames.set(id,cb);return id;},
  cancelAnimationFrame(id){frames.delete(id);},
  addEventListener(event,cb){resizeListeners[event]=cb;},
  removeEventListener(event){delete resizeListeners[event];}
 },
 Uint8Array,Math,Promise,Error
});
vm.runInContext(fs.readFileSync(path.join(root,'pdf-preview.js'),'utf8'),vmCtx);
async function flushViewer(){
 for(let i=0;i<25;i++){
  const ready=Array.from(frames.values());
  frames.clear();
  for(const frame of ready)frame();
  await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));
  if(frames.size===0)break;
 }
}
(async()=>{
 const viewer=vmCtx.window.IPSysPdfViewer.create(body,new Uint8Array([37,80,68,70]));
 await viewer.open();
 await flushViewer();
 assert.equal(loadingSettings.isEvalSupported,false,'Must prohibit unsafe PDF font evaluator');
 assert.equal(library.GlobalWorkerOptions.workerSrc,'/pdfjs/pdf.worker.min.js');
 assert.ok(body.children.some(e=>e.className==='pdf-toolbar'));
 assert.ok(!elements.some(e=>e.tag==='iframe'),'No PDF iframe may be created');
 const area=elements.find(e=>e.className==='pdf-canvas-area');
 assert.ok(area,'A scrollable PDF document area is required');
 assert.equal(area.children.length,7,'All seven pages must form a continuous document');
 assert.ok(area.children.every(e=>e.className==='pdf-page'),'Each page must have a scroll placeholder');
 assert.ok(!elements.some(e=>e.tag==='button'&&
  (e.textContent==='上一页'||e.textContent==='下一页')),
  'Continuous reader must not depend on previous/next buttons');
 assert.ok(views.some(v=>v.page===1),'First page should be rendered');
 assert.ok(views.length<7,'Long PDFs must lazily render, not rasterize every page');
 assert.ok(elements.filter(e=>e.tag==='canvas').every(c=>c.width*c.height<=16000000+10000),
  'Every rasterized page must cap Canvas memory');

 const original=elements.find(e=>e.tag==='canvas'&&e.attributes['aria-label']==='PDF 第 1 页');
 assert.ok(original&&original.width>0,'First page Canvas must have pixels');
 area.scrollTop=2500;
 area.listeners.scroll();
 await flushViewer();
 assert.ok(views.some(v=>v.page>=3),'Scrolling down must automatically render later PDF pages');
 assert.equal(original.width,0,'Distant page Canvas must release pixel memory');
 const count=elements.find(e=>e.className==='pdf-count');
 assert.ok(count.textContent.includes(' / 7 页'),'Page position must follow scroll');
 const nextPage=views.at(-1).page;
 const zoom=elements.find(e=>e.tag==='button'&&e.textContent==='＋');
 assert.ok(zoom,'Zoom controls should be retained');
 const before=views.at(-1).viewport.width;
 zoom.click();
 await flushViewer();
 assert.ok(views.some(v=>v.viewport.width>before),
  'Zoom must rerender pages around the current reading position');
 assert.ok(views.at(-1).page>=2,'Zoom must not reset reading to page one');
 assert.equal(typeof resizeListeners.resize,'function','Resize must recalculate page layout');

 viewer.destroy();
 assert.ok(elements.filter(e=>e.tag==='canvas').every(e=>e.width===0),
  'Closing viewer must release all Canvas raster buffers');
 assert.equal(wasDestroyed,true,'Closing viewer must destroy PDF document/worker');
 assert.equal(frames.size,0,'Closing viewer must cancel scheduled scroll work');

 /* BUG-018: test the Explorer preview entry itself, not just the standalone
    viewer's open method. create() without open() leaves the canvas empty. */
 let opened=0, destroyed=0, created=0;
 const previewBody={innerHTML:''};
 const mask={
  isConnected:true,
  querySelector(sel){
   if(sel==='.preview-body')return previewBody;
   return {addEventListener(){}};
  },
  addEventListener(){},
  remove(){this.isConnected=false;}
 };
 const previewCtx=vm.createContext({
  console,Error,Promise,
  findById:()=>({id:'f:123:2',name:'two-pages.pdf',type:'file'}),
  fileUrlOf:()=>'/download/123',
  extOf:()=> 'pdf',
  openPreviewShell:()=>mask,
  document:{
   body:{append(node){node.isConnected=true;}},
   addEventListener(){},removeEventListener(){},
   querySelector:()=>mask,
  },
  VaultStore:{api:async()=>({arrayBuffer:async()=>new ArrayBuffer(844)})},
  ensurePdfViewer:async()=>({
   create(target,data){
    created++;
    assert.equal(target,previewBody);
    assert.equal(data.byteLength,844);
    return {async open(){opened++;},destroy(){destroyed++;}};
   }
  }),
  askConfirm:async()=>false,
  toast:()=>{throw Error('PDF preview must not show a failure toast');},
  esc:s=>String(s),
  icon:()=> '',
  URL:{revokeObjectURL(){}},
  setTimeout:()=>{},
 });
 const start=app.indexOf('async function previewFile(id) {');
 const end=app.indexOf('/* ---------------- 上传 ---------------- */',start);
 assert.ok(start>=0&&end>start,'Explorer previewFile function must be present');
 vm.runInContext(app.slice(start,end),previewCtx,{filename:'interactions.previewFile.js'});
 await vm.runInContext("previewFile('f:123:2')",previewCtx);
 assert.equal(created,1,'Explorer must create exactly one PDF viewer');
 assert.equal(opened,1,'Explorer must call viewer.open() so PDF parsing starts');
 assert.equal(destroyed,0,'Viewer must stay open during preview');

 console.log('PDF CONTINUOUS SCROLL SMOKE PASS: all pages, scroll-driven lazy canvas, zoom, cleanup, offline security');
})().catch(e=>{console.error(e);process.exitCode=1;});
