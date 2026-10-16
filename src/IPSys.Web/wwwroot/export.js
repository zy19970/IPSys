/* B06: selected originals -> user-chosen folder or streamed ZIP (Edge/Chrome).
   No plaintext copies are left by IPSys: writes go directly to user-approved handles. */
"use strict";
const IPSysExport=(()=>{
 const encoder=new TextEncoder();
 const MAX32=0xffffffff;
 let active=null;
 let hideTimer=null;
 function cleanName(value,isFile=false){
  let n=String(value||'未命名').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').trim();
  if(!n||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(n))n='_'+(n||'未命名');
  return n.slice(0,isFile?240:170);
 }
 function suffix(name,index){
  if(index===1)return name;
  const dot=name.lastIndexOf('.');
  return dot>0?name.slice(0,dot)+' ('+index+')'+name.slice(dot):
   name+' ('+index+')';
 }
 function distinctName(base,used,isDirectory=false){
  let candidate=base,n=1;
  while(used.has(candidate.toLowerCase())){
   candidate=isDirectory?base+' ('+(++n)+')':suffix(base,++n);
  }
  used.add(candidate.toLowerCase());
  return candidate;
 }
 function owner(file){
  if(file.source==='general')return {recordKey:'g:'+file.ownerId,root:file.ownerName};
  if(file.kind==='project')return {recordKey:'p:'+file.ownerId,root:file.ownerName};
  if(file.kind==='contract')return {recordKey:'c:'+file.ownerId,root:file.projectName,
   parentKey:'p:'+file.projectId,sub:file.ownerName};
  return {recordKey:file.kind+':'+file.ownerId+':'+file.section,root:file.ownerName};
 }
 // The plan is stable regardless of download ordering and never merges homonymous records.
 function makePlan(files){
  const roots=new Map(),children=new Map(),fileNames=new Map(),usedRoots=new Set();
  return files.map(file=>{
   // Archive folder exports preserve the full selected directory hierarchy.
   // Stable IDs distinguish same-named records from child directories.
   if(Array.isArray(file.archiveFolderPath)&&file.archiveFolderPath.length){
    const chain=file.archiveFolderPath;
    const rootKey='archive-folder:'+chain[0].id;
    if(!roots.has(rootKey))roots.set(rootKey,distinctName(cleanName(chain[0].name),usedRoots,true));
    const parts=[roots.get(rootKey)];
    let directoryKey=rootKey;
    for(const entry of chain.slice(1)){
     const childKey='archive-folder:'+entry.id;
     if(!children.has(directoryKey))children.set(directoryKey,new Map());
     const group=children.get(directoryKey);
     if(!group.has(childKey)){
      const used=new Set([...group.values()].map(x=>x.toLowerCase()));
      group.set(childKey,distinctName(cleanName(entry.name),used,true));
     }
     parts.push(group.get(childKey));
     directoryKey=childKey;
    }
    const recordKey='archive-record:'+file.ownerId+':'+file.section;
    if(!children.has(directoryKey))children.set(directoryKey,new Map());
    const records=children.get(directoryKey);
    if(!records.has(recordKey)){
     const used=new Set([...records.values()].map(x=>x.toLowerCase()));
     records.set(recordKey,distinctName(cleanName(file.ownerName),used,true));
    }
    parts.push(records.get(recordKey));
    if(!fileNames.has(recordKey))fileNames.set(recordKey,new Set());
    parts.push(distinctName(cleanName(file.name,true),fileNames.get(recordKey)));
    return {...file,parts,path:parts.join('/')};
   }
   const where=owner(file);
   const rootKey=where.parentKey||where.recordKey;
   if(!roots.has(rootKey))roots.set(rootKey,distinctName(cleanName(where.root),usedRoots,true));
   const parts=[roots.get(rootKey)];
   let directoryKey=rootKey;
   if(where.parentKey){
    if(!children.has(rootKey))children.set(rootKey,new Map());
    const group=children.get(rootKey);
    if(!group.has(where.recordKey)){
     const used=new Set([...group.values()].map(x=>x.toLowerCase()));
     group.set(where.recordKey,distinctName(cleanName(where.sub),used,true));
    }
    parts.push(group.get(where.recordKey));
    directoryKey=where.recordKey;
   }
   if(!fileNames.has(directoryKey))fileNames.set(directoryKey,new Set());
   parts.push(distinctName(cleanName(file.name,true),fileNames.get(directoryKey)));
   return {...file,parts,path:parts.join('/')};
  });
 }
 async function existingNames(directory){
  const used=new Set();
  for await(const [name] of directory.entries())used.add(name.toLowerCase());
  return used;
 }
 async function chooseFolder(){
  if(typeof window.showDirectoryPicker!=='function')
   throw Error('当前浏览器不支持选择导出文件夹，请使用新版 Edge 或 Chrome。');
  return window.showDirectoryPicker({mode:'readwrite'});
 }
 async function chooseZip(){
  if(typeof window.showSaveFilePicker!=='function')
   throw Error('当前浏览器不支持选择 ZIP 保存位置，请使用新版 Edge 或 Chrome。');
  return window.showSaveFilePicker({
   suggestedName:'IPSys-原件导出.zip',
   types:[{description:'ZIP 压缩包',accept:{'application/zip':['.zip']}}]
  });
 }
 function isCancel(err){
  return active?.cancelled||err?.name==='AbortError';
 }
 function status(message){
  const el=document.getElementById('exportStatusText');
  if(el)el.textContent=message;
 }
 function fatal(err){
  return /quota|space|disk|no space|空间不足|容量不足|存储空间/i.test(err?.message||'')||
   err?.name==='QuotaExceededError'||err?.fatal===true;
 }
 async function openResponse(file,signal){
  const url=file.source==='general'?'/api/files/'+file.workspace+'/'+file.id:
   file.source==='v2ip'?'/api/v2/ip/'+file.workspace+'/'+file.ownerId+'/files/'+
    file.fileId+'/versions/'+file.version+'/download':
   '/api/business-files/'+file.workspace+'/download/'+file.id;
  const response=await api(url,{signal});
  if(!response.body)throw Error('浏览器未提供流式读取能力');
  return response;
 }
 async function pipe(file,write,signal){
  const response=await openResponse(file,signal);
  const reader=response.body.getReader();
  let length=0;
  let checksum=0xffffffff;
  try{
   while(true){
    if(signal.aborted)throw new DOMException('已取消','AbortError');
    const result=await reader.read();
    if(result.done)break;
    const bytes=result.value;
    length+=bytes.byteLength;
    checksum=crcStep(checksum,bytes);
    await write(bytes);
   }
  }finally{reader.releaseLock();}
  if(length!==file.size)throw Error('原件大小不一致，应停止导出并检查数据库：'+file.name);
  return {size:length,crc:(checksum^0xffffffff)>>>0};
 }
 const crcTable=Uint32Array.from({length:256},(_,i)=>{
  let c=i;
  for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;
  return c>>>0;
 });
 function crcStep(crc,bytes){
  for(const value of bytes)crc=crcTable[(crc^value)&255]^(crc>>>8);
  return crc>>>0;
 }
 const u16=(d,at,val)=>d.setUint16(at,val,true);
 const u32=(d,at,val)=>d.setUint32(at,val>>>0,true);
 function dosDate(date){
  const y=Math.min(2107,Math.max(1980,date.getFullYear()));
  return ((y-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate();
 }
 function dosTime(date){
  return (date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1);
 }
 function localHeader(name,date){
  const bytes=encoder.encode(name),b=new Uint8Array(30+bytes.length),d=new DataView(b.buffer);
  u32(d,0,0x04034b50);u16(d,4,20);u16(d,6,0x0808);u16(d,8,0);
  u16(d,10,dosTime(date));u16(d,12,dosDate(date));
  u16(d,26,bytes.length);b.set(bytes,30);return b;
 }
 function descriptor(size,crc){
  const b=new Uint8Array(16),d=new DataView(b.buffer);
  u32(d,0,0x08074b50);u32(d,4,crc);u32(d,8,size);u32(d,12,size);return b;
 }
 function centralHeader(item){
  const bytes=encoder.encode(item.name),b=new Uint8Array(46+bytes.length),d=new DataView(b.buffer);
  u32(d,0,0x02014b50);u16(d,4,20);u16(d,6,20);u16(d,8,0x0808);
  u16(d,10,0);u16(d,12,dosTime(item.date));u16(d,14,dosDate(item.date));
  u32(d,16,item.crc);u32(d,20,item.size);u32(d,24,item.size);
  u16(d,28,bytes.length);u32(d,42,item.offset);b.set(bytes,46);return b;
 }
 function endHeader(count,offset,size){
  const b=new Uint8Array(22),d=new DataView(b.buffer);
  u32(d,0,0x06054b50);u16(d,8,count);u16(d,10,count);
  u32(d,12,size);u32(d,16,offset);return b;
 }
 async function exportFolder(root,items,signal,report){
  const rootUsed=await existingNames(root);
  const dirs=new Map(),nameMap=new Map();
  for(let i=0;i<items.length;i++){
   if(signal.aborted)break;
   const item=items[i],key=item.parts.slice(0,-1).join('/');
   let parent=root,uniquePath='';
   try{
    for(let j=0;j<item.parts.length-1;j++){
     const keyPart=item.parts.slice(0,j+1).join('/');
     if(!dirs.has(keyPart)){
      const used=j===0?rootUsed:await existingNames(parent);
      const name=distinctName(item.parts[j],used,true);
      dirs.set(keyPart,{name,handle:await parent.getDirectoryHandle(name,{create:true})});
     }
     parent=dirs.get(keyPart).handle;
     uniquePath+=dirs.get(keyPart).name+'/';
    }
    if(!nameMap.has(key))nameMap.set(key,await existingNames(parent));
    const name=distinctName(item.parts.at(-1),nameMap.get(key));
    const file=await parent.getFileHandle(name,{create:true});
    const writer=await file.createWritable();
    let committed=false;
    try{
     await pipe(item,bytes=>writer.write(bytes),signal);
     await writer.close();committed=true;
     report.success++;
    }finally{
     if(!committed){
      try{await writer.abort()}catch{}
      try{await parent.removeEntry(name)}catch{}
     }
    }
   }catch(err){
    if(isCancel(err))break;
    report.failures.push({name:item.path,error:String(err.message||err)});
    if(fatal(err))throw err;
   }
   status('导出文件夹：'+(i+1)+' / '+items.length+'，成功 '+report.success+'，失败 '+report.failures.length);
  }
 }
 async function exportZip(fileHandle,items,signal,report){
  const writer=await fileHandle.createWritable();
  let offset=0,done=false;
  const central=[];
  async function write(bytes){
   if(offset+bytes.byteLength>=MAX32)throw Error('ZIP 超过 4 GiB 容量范围，请缩小选择规模。');
   try{await writer.write(bytes)}catch(err){err.fatal=true;throw err}
   offset+=bytes.byteLength;
  }
  try{
   for(let i=0;i<items.length;i++){
    if(signal.aborted)break;
    const file=items[i],begin=offset,date=new Date();
    try{
     await write(localHeader(file.path,date));
     const info=await pipe(file,write,signal);
     await write(descriptor(info.size,info.crc));
     central.push({name:file.path,offset:begin,date,...info});
     report.success++;
    }catch(err){
     if(isCancel(err))break;
     if(fatal(err))throw err;
     try{await writer.truncate(begin);await writer.seek(begin);offset=begin}
     catch(e){e.fatal=true;throw e}
     report.failures.push({name:file.path,error:String(err.message||err)});
    }
    status('生成 ZIP：'+(i+1)+' / '+items.length+'，成功 '+report.success+'，失败 '+report.failures.length);
   }
   if(signal.aborted)throw new DOMException('已取消','AbortError');
   if(central.length>65535)throw Error('ZIP 文件数超过 65535，请分批导出。');
   if(central.length===0)throw Error('所选附件全部导出失败，未生成 ZIP。');
   const start=offset;
   for(const entry of central)await write(centralHeader(entry));
   await write(endHeader(central.length,start,offset-start));
   await writer.close();done=true;
  }finally{if(!done){try{await writer.abort()}catch{}}}
 }
 function renderReport(report,format,cancelled,discarded){
  if(format==='zip'&&discarded)report.success=0;
  const skipped=report.total-report.success-report.failures.length;
  const detail=report.failures.map(x=>x.name+'：'+x.error).join('\n');
  const summary=(cancelled?'导出已取消。':discarded?'ZIP 导出失败，未保存不完整压缩包。':'导出完成。')+
   '成功 '+report.success+'，失败 '+report.failures.length+
   '，取消/未完成 '+Math.max(0,skipped)+'。';
  status(summary);
  const result=document.getElementById('exportResult');
  if(result)result.textContent=summary+(detail?'\n失败清单：\n'+detail:'');
  notice(summary,report.failures.length>0);
  if(typeof setTimeout==='function'){
   hideTimer=setTimeout(()=>{
    if(!active){const panel=document.getElementById('exportStatus');if(panel)panel.hidden=true;}
    hideTimer=null;
   },report.failures.length?18000:9000);
  }
 }
 async function start(format,selected){
  if(active)return notice('已有导出任务，请先完成或取消。',true);
  if(!selected.length)return notice('请先勾选需要导出的原件。',true);
  if(!['folder','zip'].includes(format))throw Error('无效导出格式');
  if(format==='zip'){
   const bytes=selected.reduce((n,f)=>n+f.size+200+encoder.encode(f.name).length,0);
   if(bytes>=MAX32)return notice('本版 ZIP 不支持超过 4 GiB，请分批导出。',true);
  }
  if(hideTimer!==null&&typeof clearTimeout==='function')clearTimeout(hideTimer);
  hideTimer=null;
  let target;
  try{target=format==='folder'?await chooseFolder():await chooseZip()}
  catch(err){if(err.name!=='AbortError')notice(err.message||String(err),true);return}
  const abort=new AbortController(),report={total:selected.length,success:0,failures:[]};
  active={controller:abort,cancelled:false};
  const bar=document.getElementById('exportStatus');
  if(bar)bar.hidden=false;
  const cancelButton=document.getElementById('exportCancel');
  if(cancelButton)cancelButton.disabled=false;
  const result=document.getElementById('exportResult');
  if(result)result.textContent='';
  status('准备导出已勾选的 '+selected.length+' 份原件…');
  const plan=makePlan(selected);
  let cancelled=false,discarded=false;
  try{
   if(format==='folder')await exportFolder(target,plan,abort.signal,report);
   else await exportZip(target,plan,abort.signal,report);
   cancelled=abort.signal.aborted;
  }catch(err){
   cancelled=isCancel(err);
   if(format==='zip')discarded=true;
   if(!cancelled)report.failures.push({name:'导出任务',error:String(err.message||err)});
  }finally{
   if(abort.signal.aborted)cancelled=true;
   if(cancelButton)cancelButton.disabled=true;
   active=null;
   renderReport(report,format,cancelled,discarded);
  }
 }
 function cancel(){
  if(!active)return;
  active.cancelled=true;active.controller.abort();
  status('正在取消并清理未完成文件…');
 }
 return {start,cancel,makePlan,cleanName,crcStep,isActive:()=>!!active};
})();
globalThis.IPSysExport=IPSysExport;
(function setupExportBar(){
 const bar=document.createElement('div');bar.id='exportStatus';bar.className='export-status';
 bar.hidden=true;
 const heading=document.createElement('strong');heading.textContent='原件导出';
 const message=document.createElement('span');message.id='exportStatusText';
 const cancel=document.createElement('button');cancel.id='exportCancel';
 cancel.type='button';cancel.className='btn btn-sm';cancel.textContent='取消导出';
 const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='btn btn-sm';
 dismiss.textContent='关闭';dismiss.setAttribute('aria-label','关闭导出结果');
 dismiss.onclick=()=>{if(!IPSysExport.isActive())bar.hidden=true;};
 const report=document.createElement('pre');report.id='exportResult';report.setAttribute('aria-live','polite');
 bar.append(heading,message,cancel,dismiss,report);document.body.append(bar);
 cancel.onclick=()=>IPSysExport.cancel();
})();