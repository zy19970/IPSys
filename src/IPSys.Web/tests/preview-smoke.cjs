// B05 PDF preview integration: project/IP/business entry uses canvas rather than Chromium PDF iframe.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const app=fs.readFileSync(path.resolve(__dirname,'../wwwroot/app.js'),'utf8');
const start=app.indexOf('async function previewOriginal(');
const end=app.indexOf('async function downloadBusinessAttachment(',start);
assert.ok(start>=0&&end>start,'Attachment preview implementation missing');
const bodyCode=app.slice(start,end);
assert.ok(!bodyCode.includes("createElement('iframe')"),'Native PDF iframe is forbidden');
assert.ok(bodyCode.includes('await ensurePdfViewer()')&&
 bodyCode.includes('activePdfViewer=renderer.create(body,bytes)'),
 'PDF must load the local canvas renderer');
assert.ok(app.includes("await loadPreviewScript('/pdfjs/pdf.min.js')")&&
 app.includes("await loadPreviewScript('/pdf-preview.js')"),
 'Offline renderer dependencies must load from the packaged EXE');

const events=[],urls=[];
const body={
 children:[],textContent:'',
 replaceChildren(){this.children=[];events.push('clear');},
 append(element){this.children.push(element);events.push('append');},
 classList:{add(x){events.push('mode-'+x);},remove(x){events.push('remove-'+x);}}
};
const dialog={open:false,listeners:{},
 addEventListener(kind,handler){this.listeners[kind]=handler;},
 showModal(){this.open=true;events.push('show');},
 close(){this.open=false;events.push('close');this.listeners.close?.();}};
const title={textContent:''};
const objects=[];
const context=vm.createContext({
 activePreviewUrl:null,activePdfViewer:null,previewSerial:0,
 URL:{createObjectURL(){urls.push('blob:test-image');return 'blob:test-image';},
 revokeObjectURL(value){events.push('revoke-'+value);}},
 Blob,ArrayBuffer,
 api:async()=>({arrayBuffer:async()=>new Uint8Array([37,80,68,70]).buffer,
 blob:async()=>new Blob(['image'])}),
 ensurePdfViewer:async()=>({create(target,bytes){
  events.push('create-canvas-viewer');
  assert.equal(target,body);assert.equal(bytes.byteLength,4);
  const viewer={destroy(){events.push('destroy-canvas-viewer');},async open(){events.push('render-pdf')}};
  objects.push(viewer);return viewer;
 }}),
 el:id=>({filePreviewBody:body,filePreviewDialog:dialog,filePreviewTitle:title})[id],
 document:{createElement(tag){
  events.push('create-'+tag);
  return {tag,src:'',alt:''};
 }},
 notice:msg=>{throw Error(msg)}
});
vm.runInContext(bodyCode,context);
(async()=>{
 await vm.runInContext('previewOriginal({name:"test.pdf"},"/files/1")',context);
 assert.equal(dialog.open,true);
 assert.ok(events.indexOf('show')<events.indexOf('create-canvas-viewer'),
  'PDF modal opens before mounting the canvas viewer');
 assert.ok(events.includes('render-pdf'));
 assert.equal(objects.length,1);
 assert.ok(!events.includes('create-iframe'));
 dialog.close();
 assert.ok(events.includes('destroy-canvas-viewer'),'Closing must destroy the active PDF canvas viewer');
 dialog.open=false;events.length=0;
 await vm.runInContext('previewOriginal({name:"image.jpg"},"/files/2")',context);
 assert.ok(events.includes('create-img')&&events.includes('show'),'Images remain supported');
 assert.equal(urls.length,1);
 console.log('PDF PREVIEW SMOKE PASS: local canvas preview routing, load after modal, cleanup and images');
})().catch(err=>{console.error(err);process.exitCode=1;});
