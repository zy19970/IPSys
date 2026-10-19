import React,{useMemo,useState} from "react";
import {createRoot} from "react-dom/client";
import {FileManager} from "@cubone/react-file-manager";
import "@cubone/react-file-manager/dist/style.css";
import {rows,childrenOf,routeFor,cuboneFiles} from "./fixture.mjs";
import "./trial.css";

const folder=rows.find(x=>x.id===100);
function describe(n){
 return n.nodeType==="file-link"
  ? "FileId "+n.fileId+" · LinkId "+n.linkId+" · 第 "+n.version+" 版"
  : "FolderId "+n.id+" · "+n.kind;
}
function Prototype(){
 const [mode,setMode]=useState("upstream");
 const [active,setActive]=useState(null);
 const [message,setMessage]=useState("操作试验数据，不会访问 IPSys 数据库。");
 const [path,setPath]=useState("/");
 const ordered=useMemo(()=>childrenOf(folder.id),[]);
 function dispatchAction(label,selected){
  setMessage(label+"：仅供评估交互，P0 不保存或调用数据库。");
  if(selected?.[0]?.path) {
   try{setActive(routeFor(selected[0].path));}catch{/* upstream may return virtual root */}
  }
 }
 return <main className="p0-shell">
  <header className="p0-top">
   <div><strong className="p0-brand">IPSys</strong><span className="p0-subtitle">文件管理器 P0 选型试验</span></div>
   <span className="p0-tag">合成数据 · 不连接 SQLCipher · 无网络业务调用</span>
  </header>
  <section className="p0-body">
   <aside className="p0-sidebar">
    <div className="p0-heading">工作空间</div>
    <div className="p0-nav current">▣　公司资料</div>
    <div className="p0-nav">▤　个人资料（只读示意）</div>
    <div className="p0-heading">业务导航</div>
    <div className="p0-nav current">▰　业务档案</div>
    <div className="p0-nav">▱　公司项目</div>
    <div className="p0-nav">▱　知识产权</div>
    <div className="p0-note">仅验证 React 文件管理器与 IPSys 身份模型是否兼容。未接入真实业务接口。</div>
   </aside>
   <section className="p0-work">
    <div className="p0-breadcrumb">公司资料　›　业务档案　›　申报与认定</div>
    <div className="p0-tabs" role="tablist" aria-label="P0 试验视图">
     <button type="button" role="tab" aria-selected={mode==="upstream"} onClick={()=>setMode("upstream")}>原生开源组件</button>
     <button type="button" role="tab" aria-selected={mode==="contract"} onClick={()=>setMode("contract")}>IPSys 要求的混排</button>
    </div>
    <div className="p0-tip">P0 重点验证：①文件夹和文件能否按同一 position 混排；②相同 FileId 的多个 LinkId 是否仍为不同可见项；③命令是否由真实后台裁决。</div>
    {mode==="upstream"
     ? <div className="p0-component" aria-label="Cubone React File Manager 原生试验">
        <FileManager
         files={cuboneFiles}
         layout="list"
         language="zh-CN"
         initialPath="/f-100"
         onFolderChange={(p)=>setPath(p)}
         onSelectionChange={(items)=>{const value=Array.isArray(items)?items[0]:null;if(value?.path)try{setActive(routeFor(value.path))}catch{}}}
         onFileOpen={(file)=>dispatchAction("打开 / 预览",[file])}
         onDownload={(items)=>dispatchAction("下载",items)}
         onDelete={(items)=>dispatchAction("删除",items)}
         onCopy={(items)=>dispatchAction("复制",items)}
         onCut={(items)=>dispatchAction("剪切",items)}
         onRename={(file)=>dispatchAction("重命名",[file])}
         onCreateFolder={()=>dispatchAction("新建文件夹")}
         onFileUploading={()=>dispatchAction("上传")}
        />
       </div>
     : <div className="p0-contract" aria-label="IPSys 持久混排顺序契约">
        <div className="p0-colhead"><span>名称（按 position 排序）</span><span>资源身份</span></div>
        {ordered.map(row=><button type="button" key={row.nodeKey} className={"p0-row "+(active?.nodeKey===row.nodeKey?"selected":"")} onClick={()=>setActive(row)}>
          <span><span className="p0-icon">{row.nodeType==="file-link"?"▧":"▰"}</span>{row.name}</span>
          <small>{describe(row)}</small>
        </button>)}
       </div>}
    <div className="p0-status" role="status">{message}</div>
    <div className="p0-footer">原生组件当前路径：<code>{path}</code>　·　说明：上方两种视图用于对照排序契约，非正式 UI。</div>
   </section>
   <aside className="p0-inspector">
    <strong>详细信息 · P0 验证</strong>
    {active
     ? <dl><dt>名称</dt><dd>{active.name}</dd><dt>节点类型</dt><dd>{active.nodeType}</dd><dt>稳定标识</dt><dd>{active.nodeKey}</dd><dt>归属工作区</dt><dd>{active.workspace}</dd><dt>版本 / 共享</dt><dd>{describe(active)}</dd></dl>
     : <p>选择“IPSys 要求的混排”中的一行，查看完整身份信息。</p>}
    <div className="p0-warning">此页面是功能适配试验。不允许据此认定项目、合同、上传、删除等业务操作已经实现。</div>
   </aside>
  </section>
 </main>;
}
createRoot(document.getElementById("root")).render(<Prototype/>);
