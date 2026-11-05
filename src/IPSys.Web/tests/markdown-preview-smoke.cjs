/* Offline Markdown/TXT preview logic; Edge CDP separately verifies actual DOMPurify sanitization. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {TextDecoder,TextEncoder}=require("node:util");
const root=path.resolve(__dirname,"../wwwroot");
const source=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const start=source.indexOf("const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;");
const end=source.indexOf("function openPreviewShell(name) {",start);
assert.ok(start>0&&end>start,"Text preview helpers must be callable in isolation");
assert.match(source,/const isText = \["md", "markdown", "txt"\]/);
assert.match(source,/const isMarkdown = ext === "md" \|\| ext === "markdown"/);
assert.match(source,/await VaultStore\.api\(url, \{ signal: previewAbort\.signal \}\)/);
assert.match(source,/showTextPreview\(body, source, isMarkdown\)/);
assert.match(source,/previewAbort\.abort\(\)/);
assert.match(source,/if \(!isPdf && !isImg && !isText\)/);

const markedLib=fs.readFileSync(path.join(root,"js/marked.umd.min.js"),"utf8");
const purifyLib=fs.readFileSync(path.join(root,"js/purify.min.js"),"utf8");
assert.ok(markedLib.includes("marked"));
assert.ok(purifyLib.includes("DOMPurify"));
const calls=[];
function node(tag) {
 return {
   tagName:tag,children:[],attrs:{},handlers:{},className:"",textContent:"",
   classList:{toggle(){}},
   append(...children){this.children.push(...children);},
   replaceChildren(){this.children=[];},
   addEventListener(name,handler){this.handlers[name]=handler;},
   setAttribute(name,value){this.attrs[name]=value;},
   querySelectorAll(){return [];},
   getAttribute(name){return this.attrs[name]??null;},
   removeAttribute(name){delete this.attrs[name];},
   remove(){this.removed=true;},
   set innerHTML(value){this.html=value;},
   get innerHTML(){return this.html||"";},
 };
}
const sandbox={
 document:{createElement:node},TextDecoder,Uint8Array,Number,Error,Promise,
 DOMPurify:{sanitize(html,config){calls.push({html,config});return "<h1>安全输出</h1>";}}
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(markedLib,sandbox,{filename:"marked.umd.min.js"});
assert.equal(typeof sandbox.marked?.parse,"function","Pinned Marked UMD must expose parse");
vm.runInContext(source.slice(start,end),sandbox,{filename:"markdown-reader.js"});
const run=code=>vm.runInContext(code,sandbox);
const fence=String.fromCharCode(96).repeat(3);
const md="# 演示\n\n| 左 | 右 |\n|---|---|\n| 1 | 2 |\n\n- [x] 已完成\n\n"+
  fence+"js\nconst x = 1;\n"+fence+"\n\n"+
  "[危险](javascript:alert(1)) <img src=\"https://evil.example/t\" onerror=\"alert(1)\">";
sandbox.markdown=md;
const rendered=run("sanitizedMarkdownHtml(markdown)");
assert.equal(rendered,"<h1>安全输出</h1>","sanitizer output, not raw HTML, must be returned");
assert.match(calls[0].html,/<h1>演示<\/h1>/);
assert.match(calls[0].html,/<table>/);
assert.match(calls[0].html,/type="checkbox"/);
assert.match(calls[0].html,/<pre><code class="language-js">/);
assert.ok(calls[0].config.FORBID_TAGS.includes("img")&&
 calls[0].config.FORBID_TAGS.includes("iframe")&&
 calls[0].config.FORBID_TAGS.includes("svg"));
assert.equal(calls[0].config.ALLOW_DATA_ATTR,false);
assert.equal(calls[0].config.ALLOW_ARIA_ATTR,false);
const host=node("div");sandbox.host=host;
run("showTextPreview(host,markdown,true)");
const main=host.children[0],toolbar=main.children[0],viewport=main.children[1];
assert.equal(main.className,"text-preview");
assert.equal(toolbar.children[0].textContent,"预览");
assert.equal(toolbar.children[1].textContent,"源码");
assert.equal(viewport.children[0].className,"markdown-view");
assert.equal(viewport.children[0].innerHTML,"<h1>安全输出</h1>");
toolbar.children[1].handlers.click();
assert.equal(viewport.children[0].className,"text-preview-source");
assert.equal(viewport.children[0].textContent,md,"Source mode must use textContent");
run("showTextPreview(host,'<script>alert(1)</script>',false)");
assert.equal(host.children[0].children[1].children[0].textContent,
 "<script>alert(1)</script>","TXT must be literal text");
const enc=new TextEncoder();
async function decode(res){
 sandbox.response=res;
 return run("readTextPreviewResponse(response)");
}
(async()=>{
 const utf8=enc.encode("# 文档😀");
 let step=0;
 const reader={
   async read(){
     if(step===0){step++;return {done:false,value:utf8.subarray(0,3)};}
     if(step===1){step++;return {done:false,value:utf8.subarray(3)};}
     return {done:true};
   },
   releaseLock(){}
 };
 const result=await decode({headers:{get:()=>String(utf8.length)},
   body:{getReader:()=>reader}});
 assert.equal(result,"# 文档😀");
 const fallback=await decode({headers:{get:()=>null},body:null,
   arrayBuffer:async()=>enc.encode("文字").buffer});
 assert.equal(fallback,"文字");
 await assert.rejects(()=>decode({headers:{get:()=>"999999999"},body:null,
   arrayBuffer(){throw Error("must not read oversized response")}}),/2 MiB/);
 let canceled=false;
 const oversized=new Uint8Array(2*1024*1024+1);
 await assert.rejects(()=>decode({headers:{get:()=>null},body:{
   getReader:()=>({read:async()=>({done:false,value:oversized}),
     cancel:async()=>{canceled=true;},releaseLock(){}})
 }}),/2 MiB/);
 assert.equal(canceled,true,"Reader must cancel after crossing limit");
 await assert.rejects(()=>decode({headers:{get:()=>null},body:null,
   arrayBuffer:async()=>new Uint8Array([0xff,0xfe]).buffer}),/UTF-8/);
 console.log("MARKDOWN PREVIEW SMOKE PASS: offline Marked, GFM, safe rendering contract, tabs, UTF-8 stream and size guard");
})().catch(err=>{console.error(err);process.exitCode=1;});
