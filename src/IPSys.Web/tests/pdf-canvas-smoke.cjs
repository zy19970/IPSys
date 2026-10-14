// Offline PDF canvas viewer, without Chromium embedded-PDF iframe/plugin.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'../wwwroot');
const pdfJS=fs.readFileSync(path.join(root,'pdfjs/pdf.min.js'));
const worker=fs.readFileSync(path.join(root,'pdfjs/pdf.worker.min.js'));
function gitSha(bytes){return crypto.createHash('sha1').update(
 Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');}
assert.equal(gitSha(pdfJS),'4d430208fdaff174b880faf78aa90eb5280ce90e');
assert.equal(gitSha(worker),'6bbfaeede7465b9270475dd9028e2b7022a2a832');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
const program=fs.readFileSync(path.resolve(__dirname,'../Program.cs'),'utf8');
assert.ok(!app.includes("view.src=previewUrl+'#view=FitH'"),'Native PDF iframe path must be removed');
assert.ok(app.includes("activePdfViewer=renderer.create(body,bytes)")&&
 app.includes("activePdfViewer.destroy()"),'PDF canvas viewer must mount and release');
assert.ok(program.includes("worker-src 'self'")&&
 program.includes('"/pdfjs/pdf.worker.min.js"'),'Worker must be local and allowed by CSP');
assert.ok(css.includes('.preview-body.pdf-mode{display:flex')&&
 css.includes('.pdf-canvas-area{flex:1'),'PDF must occupy actual modal viewport');

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
 console.log('PDF CANVAS SMOKE PASS: offline assets, full-page Canvas, pagination, zoom, cleanup, security');
})().catch(e=>{console.error(e);process.exitCode=1;});
