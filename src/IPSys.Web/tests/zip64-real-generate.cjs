/* Physical ZIP64 generation-only QA using the shipped IPSysExport code.
 * Streams >4 GiB to a real file; never creates sparse files or claims to
 * exercise the native save picker or third-party decompression.
 * Local manual archive remains available under IPSYS_ZIP64_OUTPUT_DIR.
 */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"), fsp=fs.promises;
const os=require("node:os"),path=require("node:path"),vm=require("node:vm");
const crypto=require("node:crypto");
const {ReadableStream,TextEncoder}=require("node:stream/web");
const root=path.resolve(__dirname,"../../..");
const src=fs.readFileSync(path.join(root,"src/IPSys.Web/wwwroot/export.js"),"utf8");
const marker="globalThis.IPSysExport=IPSysExport;";
assert.equal(src.split(marker).length,2,"IPSys export implementation changed");
const outDir=process.env.IPSYS_ZIP64_OUTPUT_DIR||
 path.join(process.env.RUNNER_TEMP||os.tmpdir(),"ipsys-real-zip64");
const zipPath=path.join(outDir,"IPSys-actual-over-4GiB.zip");
const chunkSize=4*1024*1024;
const eachSize=2*1024*1024*1024+80*1024*1024; // two distinct >2 GiB originals
const selected=[101,102].map((id,i)=>({
 source:"v2file",workspace:"company",fileId:id,version:1,
 kind:"project",ownerId:100+i,ownerName:"ZIP64-QA-project-"+(i+1),
 name:"source-"+id+".bin",size:eachSize
}));
const originalHashes=new Map(),notices=[];
const sourceNames=new Map(selected.map(x=>[x.fileId,x.name]));
function sourcePattern(id){
 const chunk=Buffer.allocUnsafe(chunkSize);
 for(let i=0;i<chunk.length;i++)chunk[i]=(i*37+id*29)&255;
 return chunk;
}
function responseFor(id){
 const base=sourcePattern(id);
 const hasher=crypto.createHash("sha256");
 let pending=eachSize;
 return {body:new ReadableStream({
  pull(controller){
   if(pending===0){
    originalHashes.set(id,hasher.digest("hex").toUpperCase());
    controller.close();return;
   }
   const part=base.subarray(0,Math.min(chunkSize,pending));
   pending-=part.length;hasher.update(part);controller.enqueue(part);
  }
 },{highWaterMark:1})};
}
let writableCreated=0, fd=null, writerClosed=false;
const picker=async()=>{
 writableCreated++;
 assert.equal(writableCreated,1,"Unexpected repeated save picker");
 fd=await fsp.open(zipPath,"w");
 return {createWritable:async()=>({
  write:async bytes=>{
   let done=0;
   while(done<bytes.byteLength){
    const {bytesWritten}=await fd.write(bytes,done,bytes.byteLength-done,null);
    assert.ok(bytesWritten>0,"Failed writing real file");
    done+=bytesWritten;
   }
  },
  close:async()=>{await fd.sync();await fd.close();fd=null;writerClosed=true;},
  abort:async()=>{if(fd){await fd.close();fd=null;}await fsp.rm(zipPath,{force:true});},
  truncate:async n=>{await fd.truncate(n);},
  seek:async()=>{throw Error("Unexpected writer rollback");}
 })};
};
const sourceCode=src.slice(0,src.indexOf(marker));
const sandbox={Date,Math,Number,String,Array,Map,Set,Uint8Array,Uint32Array,
 DataView,BigInt,TextEncoder,ReadableStream,DOMException,AbortController,
 window:{showSaveFilePicker:picker},
 document:{getElementById:()=>null},
 api:async url=>{
  const hit=/\/api\/v2\/files\/company\/(\d+)\/versions\/1\/download$/.exec(url);
  assert.ok(hit,"Unexpected backend stream request: "+url);
  const id=Number(hit[1]);assert.ok(sourceNames.has(id),"Unexpected source ID");
  return responseFor(id);
 },
 notice:(msg,flag)=>notices.push({message:msg,error:!!flag})};
const exported=vm.runInNewContext(sourceCode+"\nIPSysExport;",sandbox);
async function exactRead(file,position,n){
 const b=Buffer.alloc(n);let got=0;
 while(got<n){let {bytesRead}=await file.read(b,got,n-got,position+got);
  assert.ok(bytesRead>0,"Short read at "+position);got+=bytesRead;}
 return b;
}
async function validate(){
 const stat=await fsp.stat(zipPath);
 assert.ok(stat.size>0xffffffff,"ZIP output must exceed 4 GiB");
 const f=await fsp.open(zipPath,"r");
 let items=[],zip64Offset,centralOffset,centralSize;
 try{
  const end=await exactRead(f,stat.size-98,98),d=new DataView(end.buffer,end.byteOffset,end.byteLength);
  assert.equal(d.getUint32(0,true),0x06064b50,"ZIP64 end-of-directory missing");
  assert.equal(d.getBigUint64(24,true),2n,"ZIP64 entry count wrong");
  assert.equal(d.getBigUint64(32,true),2n,"ZIP64 disk entry count wrong");
  assert.equal(d.getUint32(56,true),0x07064b50,"ZIP64 locator missing");
  assert.equal(d.getUint32(76,true),0x06054b50,"classic EOCD compatibility missing");
  assert.equal(d.getUint16(84,true),0xffff);
  assert.equal(d.getUint32(88,true),0xffffffff);
  zip64Offset=stat.size-98;
  assert.equal(d.getBigUint64(64,true),BigInt(zip64Offset),"ZIP64 locator offset wrong");
  centralOffset=Number(d.getBigUint64(48,true));
  centralSize=Number(d.getBigUint64(40,true));
  assert.equal(centralOffset+centralSize,zip64Offset,"Central directory boundaries wrong");
  let at=centralOffset;
  for(const item of selected){
   const h=await exactRead(f,at,46);
   assert.equal(h.readUInt32LE(0),0x02014b50,"Central directory entry missing");
   const nameLength=h.readUInt16LE(28),extraLen=h.readUInt16LE(30);
   assert.equal(extraLen,28,"ZIP64 central-directory extra length");
   const full=await exactRead(f,at,46+nameLength+extraLen);
   const name=full.toString("utf8",46,46+nameLength);
   const e=46+nameLength;
   assert.equal(full.readUInt16LE(e),1,"ZIP64 extra header absent");
   assert.equal(Number(full.readBigUInt64LE(e+4)),eachSize,"Uncompressed size mismatch");
   assert.equal(Number(full.readBigUInt64LE(e+12)),eachSize,"Stored size mismatch");
   const localOffset=Number(full.readBigUInt64LE(e+20));
   const local=await exactRead(f,localOffset,30);
   assert.equal(local.readUInt32LE(0),0x04034b50,"Local ZIP entry missing");
   const dataAt=localOffset+30+local.readUInt16LE(26)+local.readUInt16LE(28);
   const probe=await exactRead(f,dataAt,128);
   const expected=sourcePattern(item.fileId).subarray(0,128);
   assert.deepEqual(probe,expected,"Saved file bytes differ from generated source");
   assert.ok(name.includes(item.name),"Archive name does not match source");
   items.push({fileId:item.fileId,path:name,size:eachSize,
    contentOffset:dataAt,localOffset,crc32:h.readUInt32LE(16),
    sourceSha256:originalHashes.get(item.fileId),sampleBytesVerified:128});
   at+=full.length;
  }
  assert.equal(at,centralOffset+centralSize,"Archive has unexpected central-directory records");
 }finally{await f.close();}
 const sha=crypto.createHash("sha256");
 for await(const block of fs.createReadStream(zipPath,{highWaterMark:8*1024*1024}))
  sha.update(block);
 return {result:"PASS_GENERATION_ONLY",producer:"production IPSysExport.start/ZIP64 writer",
  uiPickerTested:false,extractionTested:false,actualFile:zipPath,bytes:stat.size,
  zipSha256:sha.digest("hex").toUpperCase(),
  zip64EocdFound:true,zip64LocatorFound:true,centralOffset,centralSize,
  fileCount:items.length,files:items};
}
(async()=>{
 await fsp.mkdir(outDir,{recursive:true});
 const total=BigInt(eachSize*2+1024*1024);
 const free=fs.statfsSync(outDir,{bigint:true});
 const available=free.bavail*free.bsize;
 assert.ok(available>=total+512n*1024n*1024n,
  "Insufficient real free space for 4 GiB archive: "+available);
 const t=Date.now();
 await exported.start("zip",selected);
 assert.ok(writerClosed,"Production ZIP writer did not close successfully");
 assert.equal(writableCreated,1);
 assert.equal(originalHashes.size,2,"One of the two sources did not stream completely");
 assert.ok(notices.some(x=>!x.error&&/成功 2，失败 0/.test(x.message)),
  "Production export did not report both files saved: "+JSON.stringify(notices));
 const result=await validate();
 result.elapsedSeconds=Number(((Date.now()-t)/1000).toFixed(1));
 result.originalTotalBytes=eachSize*2;
 const report=path.join(outDir,"zip64-generation-evidence.json");
 await fsp.writeFile(report,JSON.stringify(result,null,2)+"\n");
 console.log("REAL ZIP64 FILE GENERATED AND STRUCTURALLY VERIFIED: "+JSON.stringify(
  {size:result.bytes,fileCount:result.fileCount,sha256:result.zipSha256,
   seconds:result.elapsedSeconds,evidence:report,archive:zipPath}));
})().catch(async e=>{
 if(fd){try{await fd.close()}catch{}}
 console.error("REAL ZIP64 GENERATION FAILED",e);
 process.exitCode=1;
});
