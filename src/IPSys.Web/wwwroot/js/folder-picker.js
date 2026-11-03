const AttachmentFolderPicker = {
  pageSize: 40,

  index(root, sourceFolderId) {
    const nodes = new Map(), byFolderId = new Map();
    const stack = [{node:root, parent:null}];
    while (stack.length) {
      const {node,parent} = stack.pop();
      if (node?.type !== "folder" || nodes.has(String(node.id))) continue;
      const id = String(node.id);
      const folderId = Number(node.biz?.id);
      const selectable = ["project","contract","ip","archive_folder"].includes(node.biz?.kind) &&
        Number.isSafeInteger(folderId) && folderId > 0 && !node.synthetic;
      const record = {id,node,parent,folderId:selectable ? folderId:null,selectable,children:[]};
      nodes.set(id,record);
      if (selectable) byFolderId.set(folderId,record);
      if (parent && nodes.has(parent)) nodes.get(parent).children.push(id);
      const children = (node.children||[]).filter(n=>n.type==="folder");
      for (let i=children.length-1;i>=0;i--) stack.push({node:children[i],parent:id});
    }
    const rootId=String(root.id), source=byFolderId.get(Number(sourceFolderId));
    const paths=new Map();
    const chain=id=>{
      let current=nodes.get(String(id));
      const result=[];
      while (current && current.id!==rootId) {
        result.push(current);
        current=nodes.get(current.parent);
      }
      return result.reverse();
    };
    const path=id=>{
      id=String(id);
      if(!paths.has(id)) paths.set(id,chain(id).map(n=>n.node.name).join(" / "));
      return paths.get(id);
    };
    const module=source && chain(source.id).find(n=>n.id.startsWith("k:"));
    return {nodes,byFolderId,source,rootId,chain,path,
      initialId:module?.id||rootId,
      isTarget:n=>!!(n?.selectable && n.folderId!==Number(sourceFolderId))};
  },

  open({root,workspace,sourceFolderId,fileName,fileId,move,onSubmit}) {
    const model=this.index(root,sourceFolderId);
    if(!model.source) throw new Error("当前附件的来源目录已失效，请刷新重试");
    document.querySelector("#attachmentFolderPicker")?.remove();
    const mask=document.createElement("div");
    mask.id="attachmentFolderPicker";
    mask.className="mask show folder-picker-mask";
    const label=move?"移动附件":"共享附件原件";
    mask.innerHTML=`
      <div class="dialog folder-picker-dialog" role="dialog" aria-modal="true" aria-label="${esc(label)}">
        <div class="dlg-head"><h2>${esc(label)}</h2>
          <button type="button" class="icon-btn sm" data-picker-close aria-label="关闭">${icon("close",15)}</button>
        </div>
        <div class="folder-picker-source">
          <small>当前附件 · ${esc(workspace==="company"?"企业工作区":"个人工作区")}</small>
          <b title="${esc(fileName)}">${esc(fileName)}</b>
          <small title="${esc(model.path(model.source.id))}">来源：${esc(model.path(model.source.id))}</small>
        </div>
        <div class="folder-picker-search">
          <input type="search" data-picker-search placeholder="筛选当前目录的子文件夹…" aria-label="搜索目标文件夹" autocomplete="off">
          <button type="button" class="btn" data-picker-scope>当前目录</button>
        </div>
        <div class="folder-picker-breadcrumb" data-picker-crumb aria-label="当前目录位置"></div>
        <div class="folder-picker-list" data-picker-list role="region" aria-label="子文件夹列表"></div>
        <div class="folder-picker-selection">
          <small>已选择目标</small>
          <b data-picker-target>尚未选择文件夹</b>
          <small>${move?"确认后来源将不再显示此附件；原件、版本及其它共享关联保持不变。":
            "来源保持不变；目标新增共享关联，所有历史版本仍共用。"}</small>
          <span class="folder-picker-error" data-picker-error role="alert"></span>
        </div>
        <div class="dlg-foot">
          <button type="button" class="btn" data-picker-current disabled>选择当前文件夹</button>
          <span class="spacer"></span>
          <button type="button" class="btn" data-picker-close>取消</button>
          <button type="button" class="btn solid" data-picker-submit disabled>${esc(move?"确认移动":"确认共享")}</button>
        </div>
      </div>`;
    document.body.append(mask);
    const list=mask.querySelector("[data-picker-list]");
    const crumb=mask.querySelector("[data-picker-crumb]");
    const search=mask.querySelector("[data-picker-search]");
    const scope=mask.querySelector("[data-picker-scope]");
    const submit=mask.querySelector("[data-picker-submit]");
    const currentButton=mask.querySelector("[data-picker-current]");
    const targetLabel=mask.querySelector("[data-picker-target]");
    const error=mask.querySelector("[data-picker-error]");
    let cursor=model.initialId,selected=null,globalSearch=false,shown=this.pageSize;
    let saving=false,closed=false;
    const pageSize=this.pageSize;
    function unavailable(record) {
      if(!model.isTarget(record)) return true;
      return (record.node.children||[]).some(child=>child.type==="file" &&
        Number(VaultStore.metaOf(child.id)?.fileId)===Number(fileId));
    }
    function close() {
      if(closed||saving) return;
      closed=true;
      mask.removeEventListener("keydown",onKeydown);
      mask.remove();
    }
    function navigate(id) {
      if(!model.nodes.has(String(id))) return;
      cursor=String(id);selected=null;shown=pageSize;search.value="";render();
    }
    function choose(id) {
      const record=model.nodes.get(String(id));
      if(!record||unavailable(record)) return;
      selected=record;error.textContent="";render();
    }
    function matches() {
      const q=search.value.trim().toLocaleLowerCase();
      if(globalSearch&&q) {
        const rows=[];
        for(const record of model.nodes.values()) {
          if(record.selectable && (record.node.name.toLocaleLowerCase().includes(q) ||
            model.path(record.id).toLocaleLowerCase().includes(q))) rows.push(record);
        }
        return rows.sort((a,b)=>model.path(a.id).localeCompare(model.path(b.id),"zh-CN"));
      }
      const children=(model.nodes.get(cursor)?.children||[]).map(id=>model.nodes.get(id));
      return children.filter(n=>!q||n.node.name.toLocaleLowerCase().includes(q))
        .sort((a,b)=>a.node.name.localeCompare(b.node.name,"zh-CN"));
    }
    function render() {
      crumb.innerHTML=`<button type="button" class="folder-picker-crumb" data-picker-go="${esc(model.rootId)}">我的文件</button>`+
        model.chain(cursor).map(r=>`<span aria-hidden="true">›</span>
          <button type="button" class="folder-picker-crumb" data-picker-go="${esc(r.id)}">${esc(r.node.name)}</button>`).join("");
      const rows=matches();
      const isResult=globalSearch&&!!search.value.trim();
      list.innerHTML=rows.slice(0,shown).map(r=>{
        const disabled=unavailable(r);
        const namePath=isResult?model.path(r.id):"";
        return `<div class="folder-picker-row${selected?.id===r.id?" selected":""}">
          <button type="button" class="folder-picker-enter" data-picker-enter="${esc(r.id)}"
            title="${esc(isResult?"定位到："+namePath:"进入文件夹")}">
            ${icon("folder",18)}<span class="folder-picker-row-name">${esc(r.node.name)}
              ${isResult?`<small title="${esc(namePath)}">${esc(namePath)}</small>`:""}</span>
            ${icon("chevronDown",16)}</button>
          ${r.selectable?`<button type="button" class="btn folder-picker-pick"
            data-picker-choose="${esc(r.id)}" ${disabled?"disabled":""}
            title="${disabled?"来源目录不可选或目标已关联相同原件":"设为目标文件夹"}">选择</button>`:""}
        </div>`;
      }).join("")||`<div class="folder-picker-empty">当前没有符合条件的子文件夹</div>`;
      if(rows.length>shown) list.insertAdjacentHTML("beforeend",
        `<button type="button" class="folder-picker-more" data-picker-more>继续显示 ${Math.min(pageSize,rows.length-shown)} 项（剩余 ${rows.length-shown} 项）</button>`);
      const here=model.nodes.get(cursor);
      currentButton.disabled=!here||unavailable(here)||saving;
      targetLabel.textContent=selected?model.path(selected.id):"尚未选择文件夹";
      submit.disabled=!selected||saving;
      scope.textContent=globalSearch?"所有目录":"当前目录";
      search.placeholder=globalSearch?"搜索全部文件夹名称或路径…":"筛选当前目录的子文件夹…";
    }
    function onKeydown(e) {
      if(e.key==="Escape") {e.preventDefault();close();}
    }
    mask.addEventListener("keydown",onKeydown);
    mask.addEventListener("mousedown",e=>{if(e.target===mask) close();});
    mask.querySelectorAll("[data-picker-close]").forEach(b=>b.addEventListener("click",close));
    crumb.addEventListener("click",e=>{
      const b=e.target.closest("[data-picker-go]");
      if(b) navigate(b.dataset.pickerGo);
    });
    list.addEventListener("click",e=>{
      const b=e.target.closest("[data-picker-enter],[data-picker-choose],[data-picker-more]");
      if(!b) return;
      if(b.hasAttribute("data-picker-more")){shown+=pageSize;render();}
      else if(b.hasAttribute("data-picker-enter")) navigate(b.dataset.pickerEnter);
      else choose(b.dataset.pickerChoose);
    });
    search.addEventListener("input",()=>{shown=pageSize;render();});
    scope.addEventListener("click",()=>{
      globalSearch=!globalSearch;search.value="";shown=pageSize;render();search.focus();
    });
    currentButton.addEventListener("click",()=>choose(cursor));
    submit.addEventListener("click",async()=>{
      if(!selected||saving) return;
      if(VaultStore.ws!==workspace) {
        error.textContent="工作区已变化，请取消后重新选择";
        return;
      }
      if(unavailable(selected)) {
        error.textContent="目标已无法接收此附件，请选择其它文件夹";render();return;
      }
      saving=true;submit.disabled=true;currentButton.disabled=true;error.textContent="";
      try {
        await onSubmit({target:String(selected.folderId)});
        saving=false;close();
      }catch(e){saving=false;error.textContent=e.message||"操作失败";render();}
    });
    render();search.focus();
    return {close,index:model};
  },
};