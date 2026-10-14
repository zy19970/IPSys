// Regression: Chromium's embedded PDF viewer must not load while its host
// dialog has display:none, when it can lock its surface at the 150px default.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const app=fs.readFileSync(path.resolve(__dirname,'../wwwroot/app.js'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'../wwwroot/style.css'),'utf8');
const start=app.indexOf('async function previewOriginal(');
const end=app.indexOf("el('filePreviewClose').onclick",start);
assert.ok(start>=0&&end>start,'previewOriginal implementation missing');
assert.match(css,/\.preview-body\.pdf-mode\{display:block/);
assert.match(css,/\.preview-body\.pdf-mode iframe\{display:block;width:100%;height:100%/);

function harness(){
 const events=[],frames=[],removed=[],allViews=[];
 const body={
  children:[],modes:{},
  replaceChildren(){this.children.forEach(x=>x.isConnected=false);this.children=[];events.push('clear');},
  append(view){view.isConnected=true;this.children.push(view);events.push('append');},
  classList:{toggle(key,val){body.modes[key]=val;events.push('mode:'+val);}}
 };
 const dialog={
  open:false,
  showModal(){this.open=true;events.push('show');},
  close(){this.open=false;events.push('close');}
 };
 const title={textContent:''};
 const context=vm.createContext({
  activePreviewUrl:null,
  Blob,
  URL:{
   createObjectURL(){return 'blob:ipsys-test-preview';},
   revokeObjectURL(url){removed.push(url);}
  },
  api:async()=>({blob:async()=>new Blob(['test-content'])}),
  el:id=>({
   filePreviewBody:body,filePreviewDialog:dialog,filePreviewTitle:title
  })[id],
  document:{createElement(tag){
   const view={
    tagName:tag,isConnected:false,source:'',
    getBoundingClientRect(){events.push('measure');return {width:900,height:500};},
    set src(value){this.source=value;events.push('src');},
    get src(){return this.source;}
   };
   allViews.push(view);
   return view;
  }},
  requestAnimationFrame:callback=>{frames.push(callback);events.push('schedule-frame');},
  notice:()=>{throw Error('Unexpected preview error')}
 });
 vm.runInContext(app.slice(start,end),context);
 return {events,frames,removed,allViews,body,dialog,title,context};
}
(async()=>{
 const pdf=harness();
 await vm.runInContext('previewOriginal({name:"demo.pdf"},"/api/files/demo")',pdf.context);
 assert.equal(pdf.dialog.open,true,'PDF modal must be visible');
 assert.equal(pdf.allViews[0].tagName,'iframe');
 assert.equal(pdf.body.modes['pdf-mode'],true,'PDF must use its dedicated viewport');
 assert.equal(pdf.allViews[0].src,'','PDF cannot start loading in the hidden dialog');
 assert.equal(pdf.frames.length,1,'PDF must defer its viewer load until animation frame');
 pdf.frames.shift()();
 assert.equal(pdf.allViews[0].src,'blob:ipsys-test-preview#view=FitH');
 assert.ok(pdf.events.indexOf('show')<pdf.events.indexOf('measure'),
  'Modal must open before measuring the iframe');
 assert.ok(pdf.events.indexOf('measure')<pdf.events.indexOf('src'),
  'PDF source cannot be assigned before viewer dimensions are known');
 // Closing the dialog before the next frame must never load a stale blob.
 const closed=harness();
 await vm.runInContext('previewOriginal({name:"demo.pdf"},"/api/files/demo")',closed.context);
 closed.dialog.close();
 closed.context.activePreviewUrl=null;
 closed.frames.shift()();
 assert.equal(closed.allViews[0].src,'','Closed modal must ignore stale viewer callbacks');
 // The image preview is unaffected by PDF-specific deferred loading.
 const image=harness();
 await vm.runInContext('previewOriginal({name:"photo.png"},"/api/files/image")',image.context);
 assert.equal(image.allViews[0].tagName,'img');
 assert.equal(image.allViews[0].src,'blob:ipsys-test-preview');
 assert.equal(image.body.modes['pdf-mode'],false);
 assert.equal(image.frames.length,0);
 console.log('PDF PREVIEW SMOKE PASS: dialog-first sizing, deferred source and image compatibility');
})().catch(err=>{console.error(err);process.exitCode=1;});
