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
 /min-height:\s*0/.test(cssBlock('.pdf-canvas-area')),'Canvas area must own the leftover height');

const elements=[];
function node(tag){
 const e={
  tag,children:[],listeners:{},className:'',attributes:{},style:{},disabled:false,
  classList:{add(){},remove(){}},
  clientWidth:850,width:0,height:0,textContent:'',
  append(...items){this.children.push(...items);},
  replaceChildren(){this.children=[];},
  addEventListener(event,cb){this.listeners[event]=cb;},
  setAttribute(key,value){this.attributes[key]=value;},
  click(){this.listeners.click?.();},
  getContext(){return {fillRect(){}};}
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
    numPages:3,
    async getPage(no){
     return {
      getViewport({scale}){return {width:600*scale,height:840*scale};},
      render(opts){
       views.push({page:no,canvasWidth:opts.canvasContext,viewport:opts.viewport});
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
 document:{createElement:node},window:{pdfjsLib:library,devicePixelRatio:2},
 Uint8Array,Math,Promise,Error
});
vm.runInContext(fs.readFileSync(path.join(root,'pdf-preview.js'),'utf8'),vmCtx);
(async()=>{
 const viewer=vmCtx.window.IPSysPdfViewer.create(body,new Uint8Array([37,80,68,70]));
 await viewer.open();
 assert.equal(loadingSettings.isEvalSupported,false,'Must prohibit unsafe PDF font evaluator');
 assert.equal(library.GlobalWorkerOptions.workerSrc,'/pdfjs/pdf.worker.min.js');
 assert.equal(views.length,1,'Render only the first page by default');
 assert.ok(body.children.some(e=>e.className==='pdf-toolbar'));
 assert.ok(!elements.some(e=>e.tag==='iframe'),'No PDF iframe may be created');
 const area=elements.find(e=>e.className==='pdf-canvas-area');
 const canvas=elements.find(e=>e.tag==='canvas');
 assert.ok(area&&canvas&&canvas.height>0&&canvas.width>0,'A full size canvas is required');
 assert.ok(canvas.width*canvas.height<=16000000+10000,'Canvas render must cap memory');
 const next=elements.find(e=>e.tag==='button'&&e.textContent==='下一页');
 assert.ok(next);next.click();
 await new Promise(r=>setImmediate(r));
 assert.equal(views.at(-1).page,2,'Next button must render a new PDF page');
 const zoom=elements.find(e=>e.tag==='button'&&e.textContent==='＋');
 const before=canvas.width;zoom.click();await new Promise(r=>setImmediate(r));
 assert.ok(canvas.width>before,'Zoom button must change canvas resolution');
 viewer.destroy();
 assert.equal(canvas.width,0,'Destroy must release canvas dimensions');
 assert.equal(wasDestroyed,true,'Destroy must release PDF document/worker');

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

 console.log('PDF CANVAS SMOKE PASS: offline assets, full-page Canvas, pagination, zoom, cleanup, security');
})().catch(e=>{console.error(e);process.exitCode=1;});
