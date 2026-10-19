// Entirely synthetic. No request to /api, no SQLCipher connection or persisted data.
// IDs, names and ordering mimic IPSys V2 Folder/File/Link identities.
export const rows=Object.freeze([
 {nodeKey:"folder:company:archive_folder:100",id:100,kind:"archive_folder",nodeType:"business-folder",name:"申报与认定",parent:null,position:0,workspace:"company"},
 {nodeKey:"folder:company:archive:201",id:201,kind:"archive",nodeType:"business-folder",name:"资料记录 A",parent:100,position:0,workspace:"company"},
 {nodeKey:"link:company:9001",folderId:100,fileId:501,linkId:9001,nodeType:"file-link",name:"技术报告.pdf",size:324200,version:2,parent:100,position:1,workspace:"company"},
 {nodeKey:"folder:company:archive_folder:102",id:102,kind:"archive_folder",nodeType:"business-folder",name:"2025 年度归档",parent:100,position:2,workspace:"company"},
 {nodeKey:"folder:company:archive:202",id:202,kind:"archive",nodeType:"business-folder",name:"资料记录 B",parent:100,position:3,workspace:"company"},
 {nodeKey:"link:company:9002",folderId:202,fileId:501,linkId:9002,nodeType:"file-link",name:"技术报告.pdf",size:324200,version:2,parent:202,position:0,workspace:"company"},
 {nodeKey:"link:company:9003",folderId:201,fileId:502,linkId:9003,nodeType:"file-link",name:"非常非常长的文件名用于验证文件列表宽度与摘要信息自动省略.txt",size:1024,version:1,parent:201,position:1,workspace:"company"}
]);
export const byNodeKey=new Map(rows.map(x=>[x.nodeKey,x]));
export function childrenOf(folderId){
 return rows.filter(x=>x.parent===folderId).sort((a,b)=>a.position-b.position);
}
export function pathOf(node){
 if(!node.parent)return "/f-"+node.id;
 const owner=rows.find(x=>x.id===node.parent);
 if(!owner)throw Error("missing owner "+node.parent);
 const parentPath=pathOf(owner);
 return parentPath+"/"+(node.nodeType==="file-link"?"link-"+node.linkId:"f-"+node.id);
}
export const byPath=new Map(rows.map(x=>[pathOf(x),x]));
export const cuboneFiles=rows.map(x=>({
 name:x.name, isDirectory:x.nodeType!=="file-link",path:pathOf(x),
 updatedAt:"2026-10-18T08:00:00Z",...(x.size==null?{}:{size:x.size}),
 // Kept for host adapter. Do not feed file paths into backend as IDs.
 ipsysNodeKey:x.nodeKey
}));
export function routeFor(path){
 const found=byPath.get(path);
 if(!found)throw Error("unknown synthetic route: "+path);
 return found;
}
