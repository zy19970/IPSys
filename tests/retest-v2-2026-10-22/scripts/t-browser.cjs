/* 浏览器层复测：CDP 驱动本机 Edge，headed/headless 见各自说明。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-browser.cjs v2b */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v2b";
const ROOT = path.resolve(__dirname, "..");
const EVID = process.env.IPSYS_EVIDENCE_DIR ? path.resolve(process.env.IPSYS_EVIDENCE_DIR) : path.join(ROOT, "evidence");
const SHOT = path.join(EVID, "shots");
const TMP = path.resolve(ROOT, "..", "..", "build-retest", "agent-explorer-full-v2");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
fs.mkdirSync(SHOT, { recursive: true });

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error("找不到 Edge/Chrome");

let browserProc = null;
const CDP_PORT = 9411 + Math.floor(Math.random() * 200);
const PROFILE = path.join(TMP, "edge-profile-" + Date.now());
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rec(id, method, result, observed, expected) {
  results.push({ id, method, result, observed, expected });
  console.log(`[${result}] ${id} :: ${observed}`);
}
function ev(id, text) { fs.writeFileSync(path.join(EVID, `${id}.txt`), text, "utf8"); }

let ws, msgId = 0, sessionId = null;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("cdp timeout: " + method)); } }, 30000);
  });
}
async function evalJs(expression, awaitPromise = true) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || "eval error");
  }
  return r.result ? r.result.value : undefined;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT, name.replace(/[#/]/g, "-") + ".png"), Buffer.from(r.data, "base64"));
  return name;
}
async function clearToasts() { await evalJs(`document.querySelectorAll('.toast').forEach(t=>t.remove())`).catch(()=>{}); }
async function waitFor(expr, timeout = 12000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalJs(expr)) return true; } catch {}
    await sleep(150);
  }
  throw new Error("等待超时: " + label);
}
async function goto(url) {
  await send("Page.navigate", { url });
  await sleep(600);
  await waitFor("document.readyState === 'complete'", 15000, "document ready");
}

async function main() {
  const wsUrl = await new Promise((resolve, reject) => {
    const p = browserProc = spawn(EDGE, [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--disable-sync",
      "--window-size=1366,768",
      "about:blank",
    ], { stdio: "ignore", detached: false });
    p.on("error", reject);
    const t0 = Date.now();
    const poll = () => {
      http.get({ host: "127.0.0.1", port: CDP_PORT, path: "/json/list" }, (res) => {
        let b = ""; res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            const list = JSON.parse(b);
            const page = list.find((x) => x.type === "page");
            if (page) resolve(page.webSocketDebuggerUrl);
            else throw new Error("no page");
          } catch { retry(); }
        });
      }).on("error", retry);
    };
    const retry = () => { if (Date.now() - t0 > 15000) reject(new Error("CDP 启动超时")); else setTimeout(poll, 250); };
    poll();
  });

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  /* ---------- 登录页：先拿 token，再注入会话 ---------- */
  const base = L.BASE;
  const resume = await (await fetch(base + "/api/resume", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: cred.password }),
  })).json();

  await goto(base + "/");
  await waitFor("!!document.querySelector('#lockForm')", 10000, "登录层");

  await (async function T_P1_01() {
    const info = await evalJs(`(() => {
      const txt = [...document.querySelectorAll('#lockScreen button, #lockScreen a, #lockScreen label')].map(b => (b.textContent||'').trim()).filter(Boolean);
      return {
        title: (document.querySelector('.lock-title')||{}).textContent || '',
        subs: (document.querySelector('.lock-sub')||{}).textContent || '',
        buttons: txt,
        hasPath: !!document.querySelector('#dbPath'),
        pathValue: (document.querySelector('#dbPath')||{}).value || '',
        checkboxes: [...document.querySelectorAll('#lockScreen input[type=checkbox]')].map(c => (c.closest('label')||c.parentElement||{}).innerText || ''),
        hasCreateWord: /新建|创建/.test(document.querySelector('#lockScreen').innerText),
      };
    })()`);
    await shot("T-P1-01-login");
    ev("T-P1-01", [
      "登录层 DOM 盘点：",
      JSON.stringify(info, null, 1),
      "",
      "后端能力（同一时刻的 HTTP 证据，见 fixture-build.log）：POST /api/open {create:true} 可建新库，",
      "但 index.html 登录层只有 #dbPath + 密码 + 一个提交按钮，interactions.js:270-280 把 create 硬编码为 false。",
      "UI_BASELINE.md §2.1 要求『默认显示「打开已有资料库」，创建新库另设入口』。",
    ].join("\n"));
    const noCreate = info.buttons.every((t) => !/新建|创建/.test(t)) && !info.checkboxes.some((t) => /新建|创建/.test(t));
    rec("T-P1-01", "DYNAMIC-BROWSER", noCreate ? "IMPLEMENTATION_GAP" : "PASS",
      `noCreate=${noCreate}；按钮=${JSON.stringify(info.buttons)}；含『新建/创建』=${info.hasCreateWord}；checkboxes=${JSON.stringify(info.checkboxes)}`,
      "登录页提供创建资料库入口（冻结基线 §2.1）");
  })();

  /* 注入 token 进入应用（等价于用户输入密码后的 sessionStorage 写入） */
  await evalJs(`(() => {
    sessionStorage.setItem('od-token', ${JSON.stringify(resume.token)});
    sessionStorage.setItem('od-db', 'vault-${RUNID}.db');
    location.reload();
    return 1;
  })()`);
  await sleep(1500);
  try {
    await waitFor("document.querySelectorAll('#viewRoot .catcard').length > 0", 20000, "首页分类卡片");
  /* 默认进个人工作区（产品口径），本套 fixture 主要在公司侧，显式切过去 */
  await evalJs(`enterWorkspace('company')`);
  await sleep(800);
  await waitFor("VaultStore.ws === 'company' && document.querySelectorAll('#viewRoot .catcard').length > 0", 20000, "公司工作区");
  } catch (e) {
    const dbg = await evalJs(`(() => ({
      href: location.href,
      hasDrive: typeof Drive,
      tokenLen: (window.VaultStore && VaultStore.token || '').length,
      err: (window.VaultStore && VaultStore.error) || '',
      locked: (window.VaultStore && VaultStore.locked),
      lockShown: (document.querySelector('#lockScreen')||{}).className,
      body: (document.body.innerText||'').replace(/\s+/g,' ').slice(0, 300),
      ready: window.Drive && Drive.state && Drive.state.ready,
    }))()`);
    await shot("debug-after-token");
    throw new Error(e.message + " :: " + JSON.stringify(dbg));
  }

  /* ---------- T-UI-SELECT-ALL: trusted Edge mouse events ----------
     Clicking the header must not start blank-space marquee selection:
     its mouseup used to repaint the header SVG before the click event. */
  await (async function T_UI_SELECT_ALL() {
    const testViews = [
      ["项目台账","k:project"],
      ["知识产权台账","k:ip"],
      ["项目附件","p:" + fx.company.projectA],
    ];
    const findings = [];
    async function clickHeaderWithMouse() {
      const hit=await evalJs(`(() => {
        const b=document.querySelector("#selectAll");
        if (!b) return null;
        const r=b.getBoundingClientRect();
        const x=r.left+r.width/2,y=r.top+r.height/2;
        return {x,y,hit:document.elementFromPoint(x,y)?.closest("#selectAll")===b};
      })()`);
      if (!hit?.hit) throw new Error("全选框被其他元素遮挡: "+JSON.stringify(hit));
      await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:hit.x,y:hit.y});
      await send("Input.dispatchMouseEvent",{type:"mousePressed",x:hit.x,y:hit.y,button:"left",clickCount:1});
      await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:hit.x,y:hit.y,button:"left",clickCount:1});
      await sleep(100);
      return evalJs(`(() => {
        const rows=[...document.querySelectorAll("#viewRoot .row")];
        return {total:rows.length,selected:rows.filter(x=>x.classList.contains("is-selected")).length,
          selectedIds:Drive.state.selection.size,
          checked:document.querySelector("#selectAll")?.getAttribute("aria-checked"),
          bar:document.querySelector("#selbar")?.classList.contains("show")};
      })()`);
    }
    for (const [label,folder] of testViews) {
      await evalJs("Drive.openFolder("+JSON.stringify(folder)+")");
      await waitFor("document.querySelectorAll('#viewRoot .row').length>0",10000,label+" rows");
      await evalJs("Drive.clearSelection()");
      const all=await clickHeaderWithMouse();
      if(all.selected!==all.total || all.selectedIds!==all.total ||
          all.checked!=="true" || !all.bar)
        throw new Error(label+" 点击表头未全选: "+JSON.stringify(all));
      if(folder==="k:project") await shot("T-UI-SELECT-ALL-project");
      const none=await clickHeaderWithMouse();
      if(none.selected!==0 || none.selectedIds!==0 || none.checked!=="false")
        throw new Error(label+" 再次点击未取消全选: "+JSON.stringify(none));
      findings.push(label+":"+all.total+" 条，全选/取消通过");
    }
    await evalJs("Drive.openFolder('k:ip')");
    await waitFor("document.querySelectorAll('#viewRoot .row').length>1");
    await evalJs("Drive.select(Drive.sortedItems[0].id,'toggle')");
    const mixed=await evalJs("document.querySelector('#selectAll').getAttribute('aria-checked')");
    if(mixed!=="mixed") throw new Error("部分选择未显示表头半选状态");
    const filled=await clickHeaderWithMouse();
    if(filled.selected!==filled.total || filled.checked!=="true")
      throw new Error("部分选择时点击表头未补全: "+JSON.stringify(filled));
    await clickHeaderWithMouse(); // Leave later scenarios unselected.
    rec("T-UI-SELECT-ALL","DYNAMIC-BROWSER","PASS",
      findings.join("；")+"；半选补全通过",
      "点击表头全选、再次取消、部分选中后补全，全部使用真实 Edge 鼠标事件");
    ev("T-UI-SELECT-ALL",findings.join("\n")+"\n半选补全通过");
  })();

  /* ---------- T-P0-01 UI 三级目录 ---------- */
  await (async function T_P0_01() {
    await evalJs(`Drive.openFolder('k:achievement')`);
    await waitFor("Drive.state.folderId === 'k:achievement'");
    const ids = await evalJs(`(() => { const out=[]; walkNodes(n=>out.push(n.id)); return out; })()`);
    const hasLvl2 = ids.includes("af:" + fx.archive.lvl2);
    const hasLvl3 = ids.includes("af:" + fx.archive.lvl3);
    /* A02/N2：资料已是普通文件夹节点，节点前缀由 a:<section>: 改为 af:。 */
    const hasDeepRecord = ids.includes(`af:${fx.archive.records[0]}`);
    const rootRows = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`);
    await shot("T-P0-01-archive-root");
    ev("T-P0-01", [
      "进入 业务档案(k:achievement) 后遍历整棵树：",
      "第二级目录存在 = " + hasLvl2 + "；第三级目录存在 = " + hasLvl3 + "；最深记录 af:" + fx.archive.records[0] + " 存在 = " + hasDeepRecord,
      "当前列表可见行：" + JSON.stringify(rootRows),
      "",
      "后端 /api/v2/ui/folders/company 已返回 folders 的 parentId 链（见 HTTP 段的 T-P0-01#backend），",
      "此处核对前端 buildTree 是否忠实还原每一级目录，以及最深记录是否挂在第三级目录下。",
    ].join("\n"));
    rec("T-P0-01", "DYNAMIC-BROWSER", (hasLvl2 && hasLvl3 && hasDeepRecord) ? "PASS" : "CONFIRMED_BUG",
      `树中 af:8=${hasLvl2}, af:9=${hasLvl3}, 最深记录=${hasDeepRecord}；分类根直接列出 ${rootRows.length} 行`,
      "每一级目录都在树中，记录归属最深处目录");
  })();

  /* ---------- T-P0-02 UI 版本折叠 ---------- */
  await (async function T_P0_02() {
    const opened = await evalJs(`(() => { Drive.openFolder('i:${fx.company.ipA}'); return { folderId: Drive.state.folderId, node: !!findById('i:${fx.company.ipA}'), ids: (()=>{const a=[];walkNodes(n=>a.push(n.id));return a.filter(x=>x.startsWith('i:'));})() }; })()`);
    if (opened.folderId !== ('i:' + fx.company.ipA)) throw new Error("打不开 IP 节点: " + JSON.stringify(opened));
    await sleep(400);
    await sleep(300);
    const rows = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>({id:r.dataset.id, text:r.innerText.replace(/\\s+/g,' ').trim()}))`);
    const sizeText = rows.map((r) => (r.text.match(/(\d+(?:\.\d+)?\s*(?:B|KB|MB|GB))/i) || [])[1] || "");
    const detail = await evalJs(`(document.querySelector('#detailBody')||{}).innerText || ''`);
    await shot("T-P0-02-ip-attachments");
    ev("T-P0-02", [
      "进入 IP-A 记录，列出的附件行：",
      JSON.stringify(rows, null, 1),
      "",
      "行内大小文本：" + JSON.stringify(sizeText),
      "详情面板：" + detail.replace(/\s+/g, " ").slice(0, 400),
      "",
      "同一 linkId=3 的 v1(22B)/v2(37B) 被画成两行；附件计数按行数算成 2，占用把 59B 一起算。",
      "接口返回两行是数据层事实（T-P0-02#api），但产品要求同一 linkId 只显示一条、默认最新版。",
    ].join("\n"));
    rec("T-P0-02", "DYNAMIC-BROWSER", rows.length === 1 ? "PASS" : "CONFIRMED_BUG",
      `同一 linkId 显示 ${rows.length} 行（期望 1），行内大小 ${JSON.stringify(sizeText)}`,
      "同一 linkId 只有一条可见附件，默认最新版 37B");
  })();

  /* ---------- T-P0-03 / T-P2-05 UI 批量删除（同 linkId 两行 + 3 个独立 link） ---------- */
  await (async function T_P0_03() {
    const ids = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`);
    await evalJs(`(() => { Drive.state.selection = new Set(${JSON.stringify(ids)}); Drive.render(); return 1; })()`);
    await clearToasts();
    await evalJs(`document.querySelector('#selDelete').click()`);
    await sleep(400);
    const confirmText = await evalJs(`(document.querySelector('#confirmText')||{}).textContent || ''`);
    await evalJs(`document.querySelector('#confirmOk').click()`);
    await sleep(1500);
    const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ')`);
    const after = await evalJs(`[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)`);
    const server = await evalJs(`fetch('/api/v2/ui/ip/company',{headers:{'X-IPSys-Token':sessionStorage.getItem('od-token')}}).then(r=>r.json()).then(d=>d.files.filter(f=>f.fileId===${fx.files.ipA.fileId}).length)`);
    await shot("T-P0-03-after-batch-delete");
    ev("T-P0-03", [
      `选中行：${JSON.stringify(ids)}`,
      `确认框文案：${confirmText}`,
      `点击确认后的 toast：${toast}`,
      `删除后剩余行：${JSON.stringify(after)}`,
      "",
      "结论：两行指向同一 linkId，第二次 DELETE 必得 409；deleteNodes 的 for 循环整体在一个 try 里，",
      "第二条抛错即中断，后续条目不再删除，toast('已删除 N 项') 也不执行。",
    ].join("\n"));
    rec("T-P0-03", "DYNAMIC-BROWSER", server === 0 && after.length === 0 ? "PASS" : "CONFIRMED_BUG",
      `选中 ${ids.length} 行删除后：服务端剩余 ${server} 行、界面仍显示 ${after.length} 行；反馈「${toast}」`,
      "不得对同一 linkId 多次 DELETE；失败要给成功/失败数并刷新真实结果");
  })();

  /* ---------- T-P2-01 右键/F2真实改名及恢复 ---------- */
  await (async function T_P2_01() {
    await evalJs("Drive.openFolder('k:project')").catch(() => {});
    await sleep(350);
    const rowId=(await evalJs("[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)"))[0];
    if(!rowId) {
      rec("T-P2-01","DYNAMIC-BROWSER","BLOCKED","没有项目行可供重命名","右键和F2都可提交真实改名");
      return;
    }
    const before=await evalJs("findById("+JSON.stringify(rowId)+")?.name || ''");
    const temporary=before+"-验收";
    await evalJs("(() => { const row=document.querySelector('#viewRoot .row'); const r=row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+20,clientY:r.top+10})); return 1; })()");
    await sleep(200);
    const menu=await evalJs("[...document.querySelectorAll('#ctxMenu [data-act]')].map(b=>b.innerText.trim())");
    const hasRename=await evalJs("!!document.querySelector('#ctxMenu [data-act=\"rename\"]')");
    if(hasRename) await evalJs("document.querySelector('#ctxMenu [data-act=\"rename\"]').click()");
    await sleep(200);
    const contextForm=await evalJs("!!document.querySelector('#formMask [data-key=\"name\"]')");
    if(contextForm){
      await evalJs("(() => {const input=document.querySelector('#formMask [data-key=\"name\"]');input.value="+JSON.stringify(temporary)+";document.querySelector('#formMask [data-submit]').click();return true;})()");
      await waitFor("findById("+JSON.stringify(rowId)+")?.name==="+JSON.stringify(temporary),9000,"右键重命名持久化").catch(()=>{});
    }
    const after=await evalJs("findById("+JSON.stringify(rowId)+")?.name || ''");
    await evalJs("document.querySelector('#formMask [data-close]')?.click()").catch(()=>{});
    await evalJs("Drive.state.selection=new Set(["+JSON.stringify(rowId)+"]);Drive.render()");
    await evalJs("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))");
    await sleep(250);
    const f2Form=await evalJs("!!document.querySelector('#formMask [data-key=\"name\"]')");
    if(f2Form){
      await evalJs("(() => {const input=document.querySelector('#formMask [data-key=\"name\"]');input.value="+JSON.stringify(before)+";document.querySelector('#formMask [data-submit]').click();return true;})()");
      await waitFor("findById("+JSON.stringify(rowId)+")?.name==="+JSON.stringify(before),9000,"F2恢复原名").catch(()=>{});
    }
    const restored=await evalJs("findById("+JSON.stringify(rowId)+")?.name || ''");
    await evalJs("document.querySelector('#formMask [data-close]')?.click()").catch(()=>{});
    await shot("T-P2-01-rename");
    const ok=hasRename&&contextForm&&after===temporary&&f2Form&&restored===before;
    ev("T-P2-01",[
      "右键菜单："+JSON.stringify(menu),
      "原名："+before+"；右键提交后："+after+"；F2恢复后："+restored,
      "右键进入真实表单："+contextForm+"；F2进入真实表单："+f2Form,
      "两次实际提交成功且恢复初始测试数据："+ok,
    ].join("\n"));
    rec("T-P2-01","DYNAMIC-BROWSER",ok?"PASS":"CONFIRMED_BUG",
      "右键表单="+contextForm+"，提交改名="+(after===temporary)+"；F2表单="+f2Form+"，恢复原名="+(restored===before),
      "右键与F2真实提交更新，并在测试结束后恢复原名");
  })();

  /* ---------- T-P2-02 真实 Explorer 拖放 + 关联持久验证 ---------- */
  await (async function T_P2_02() {
    await evalJs("Drive.openFolder('p:" + fx.company.projectA + "')");
    await sleep(600);
    const fileId=(await evalJs("[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)"))
      .find(x=>/^f:/.test(x));
    if(!fileId) {
      rec("T-P2-02","DYNAMIC-BROWSER","BLOCKED","没有可拖动的项目附件","项目附件拖到 IP-B 后真实迁移");
      return;
    }
    const drag=await evalJs([
      "(async () => {",
      "const sourceId="+JSON.stringify(fileId)+";",
      "const targetId='i:"+fx.company.ipB+"';",
      "const source=findById(sourceId);",
      "const meta=VaultStore.metaOf(sourceId);",
      "const sourceRow=[...document.querySelectorAll('#viewRoot .row')].find(r=>r.dataset.id===sourceId);",
      "if(!sourceRow||!source||!meta?.fileId)return {err:'缺少来源附件或 FileId'};",
      "const dt=new DataTransfer();",
      "sourceRow.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));",
      "const prepared=dt.getData('application/x-ipsys-link')===sourceId;",
      "Drive.openFolder('k:ip');",
      "await new Promise(r=>setTimeout(r,350));",
      "const row=[...document.querySelectorAll('#viewRoot .row')].find(r=>r.dataset.id===targetId);",
      "if(!row)return {err:'目标 IP-B 行不存在',prepared,fileId:meta.fileId};",
      "row.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));",
      "const drop=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});",
      "row.dispatchEvent(drop);",
      "await new Promise(r=>setTimeout(r,150));",
      "const confirmed=document.querySelector('#confirmMask')?.classList.contains('show')===true;",
      "if(confirmed)settleConfirm(true);",
      "await new Promise(r=>setTimeout(r,900));",
      "return {prepared,confirmed,dropPrevented:drop.defaultPrevented,fileId:meta.fileId,",
      "toast:[...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ')};",
      "})()"
    ].join("\n"));
    if(drag?.fileId) {
      const targetCheck="(() => {const target=findById('i:"+fx.company.ipB+"'); return !!target?.children?.some(n=>n.type==='file'&&Number(VaultStore.metaOf(n.id)?.fileId)==="+Number(drag.fileId)+");})()";
      await waitFor(targetCheck,9000,"拖放后目标 FileId 关联可见").catch(()=>{});
    }
    const after=await evalJs([
      "(() => {",
      "const fileId="+Number(drag?.fileId||0)+";",
      "const contains=id=>!!findById(id)?.children?.some(n=>n.type==='file'&&Number(VaultStore.metaOf(n.id)?.fileId)===fileId);",
      "return {source:contains('p:"+fx.company.projectA+"'),target:contains('i:"+fx.company.ipB+"')};",
      "})()"
    ].join("\n"));
    await shot("T-P2-02-drop-verified");
    const ok=drag?.prepared&&drag.confirmed&&drag.dropPrevented&&after.target&&!after.source;
    ev("T-P2-02",[
      "真实来源附件节点="+fileId,
      "dragstart 已产生应用专用 DataTransfer 类型="+!!drag?.prepared,
      "确认弹窗已出现并点击确认="+!!drag?.confirmed,
      "drop 已消费事件="+!!drag?.dropPrevented,
      "原件 FileId="+(drag?.fileId||"未知"),
      "移动后来源仍有同 FileId="+after.source,
      "移动后目标含同 FileId="+after.target,
      "动态状态="+JSON.stringify(drag),
      "判据为 FileId 关联真实迁移，而不是只要出现 toast 就判缺陷。"
    ].join("\n"));
    rec("T-P2-02","DYNAMIC-BROWSER",ok?"PASS":"FAIL",
      JSON.stringify({drag,after}),"实际 dragstart/drop/确认，来源解除关联、目标新增相同 FileId");
  })();

  /* ---------- T-P2-03 虚假快捷访问按钮不存在 ---------- */
  await (async function T_P2_03() {
    const button=await evalJs("!!document.querySelector('#btnPinFolder')");
    await shot("T-P2-03-pin");
    ev("T-P2-03",[
      "#btnPinFolder 存在="+button,
      "快捷访问是系统固定类别，不应该展示未实现的「添加快捷访问」操作",
    ].join("\n"));
    rec("T-P2-03","DYNAMIC-BROWSER",!button?"PASS":"CONFIRMED_BUG",
      "不支持自定义快捷方式的假添加按钮"+(button?"仍然存在":"已经移除"),
      "不存在无业务行为的快捷访问添加按钮");
  })();

  /* ---------- T-P2-04 虚拟根不得打开上传文件选择器 ---------- */
  await (async function T_P2_04() {
    await evalJs("Drive.state.view='home';Drive.state.folderId='root';Drive.render()");
    await sleep(300);
    const r=await evalJs("(() => {const original=HTMLInputElement.prototype.click;let opened=0;HTMLInputElement.prototype.click=function(){if(this.type==='file'){opened++;return;}return original.apply(this,arguments);};try {const button=document.querySelector('[data-page-act=\"upload\"]');if(button)button.click();else pickFiles();return {button:!!button,opened,folderId:Drive.state.folderId,toast:[...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ')};}finally{HTMLInputElement.prototype.click=original;}})()");
    await shot("T-P2-04-home-upload");
    const ok=r && r.opened===0 && (!r.button || /具体业务记录/.test(r.toast||""));
    ev("T-P2-04",[
      "首页无归属导入保护："+JSON.stringify(r,null,2),
      "首页无导入入口时直接调用 pickFiles()，仍必须拒绝虚拟根上传。",
    ].join("\n"));
    rec("T-P2-04","DYNAMIC-BROWSER",ok?"PASS":"CONFIRMED_BUG",
      "首页导入入口存在="+r.button+"，文件选择器打开次数="+r.opened+"，提示="+r.toast,
      "虚拟根不能上传；仅进入真实业务记录才能选择附件");
  })();

  /* ---------- T-P2-06 键盘 ---------- */
  await (async function T_P2_06() {
    await evalJs(`Drive.openFolder('k:project')`).catch(() => {});
    await sleep(500);
    const total = await evalJs(`document.querySelectorAll('#viewRoot .row').length`);
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}))`);
    await sleep(300);
    const selAll = await evalJs(`Drive.state.selection.size`);
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(200);
    const afterEsc = await evalJs(`Drive.state.selection.size`);
    await evalJs(`Drive.state.selection = new Set([...document.querySelectorAll('#viewRoot .row')].slice(0,1).map(r=>r.dataset.id)); Drive.render(); Drive.state.detailOpen = true;`);
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`);
    await sleep(400);
    const confirmShown = await evalJs(`!!document.querySelector('#confirmMask.show') || getComputedStyle(document.querySelector('#confirmMask')).display !== 'none'`);
    const toast = await evalJs(`[...document.querySelectorAll('.toast')].map(t=>t.innerText.trim()).join(' | ')`);
    await evalJs(`document.querySelector('#confirmCancel') && document.querySelector('#confirmCancel').click()`).catch(() => {});
    await sleep(200);
    const back = await evalJs(`(() => { Drive.openFolder('i:${fx.company.ipA}'); return Drive.state.folderId; })()`);
    await sleep(400);
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true}))`);
    await sleep(400);
    const afterAltLeft = await evalJs(`Drive.state.folderId`);
    await shot("T-P2-06-keyboard");
    ev("T-P2-06", [
      `分类内行数=${total}`,
      `Ctrl+A 后选中=${selAll}（期望 ${total}）`,
      `Esc 后选中=${afterEsc}（期望 0）`,
      `Delete 弹出确认=${confirmShown}；toast=${toast}`,
      `Alt+Left 从 i:${fx.company.ipA} 回到 ${afterAltLeft}`,
    ].join("\n"));
    rec("T-P2-06", "DYNAMIC-BROWSER", selAll === total && afterEsc === 0 ? "PASS" : "FAIL",
      `Ctrl+A 选中 ${selAll}/${total}，Esc 清空=${afterEsc === 0}，Delete 确认=${confirmShown}，Alt+Left → ${afterAltLeft}`,
      "Ctrl+A 全选、Esc 取消、Delete 有确认、Alt+Left 返回上级");
  })();

  /* ---------- T-P2-07 搜索跳转与附件命中映射 ---------- */
  await (async function T_P2_07() {
    await evalJs("Drive.state.view='files'; Drive.state.folderId='root'; Drive.render();");
    await sleep(300);
    async function search(query) {
      await evalJs("(() => { const input=document.querySelector('#searchInput'); input.value=" + JSON.stringify(query) + "; input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
      await sleep(2500);
      return await evalJs("[...document.querySelectorAll('#viewRoot .row')].map(r=>r.dataset.id)");
    }
    const expectedArchiveId="af:" + fx.archive.records[0];
    const archiveRows=await search("档案-01");
    const archiveFound=archiveRows.includes(expectedArchiveId);
    if(archiveFound) {
      const selector='#viewRoot .row[data-id=' + JSON.stringify(expectedArchiveId) + ']';
      await evalJs("document.querySelector(" + JSON.stringify(selector) + ")?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
      await sleep(700);
    }
    const archiveAt=await evalJs("({folderId:Drive.state.folderId,crumbs:[...document.querySelectorAll('[data-crumb]')].map(b=>b.innerText.trim())})");
    const archiveNavigated=archiveAt.folderId===expectedArchiveId;
    await evalJs("Drive.resetSearch(); Drive.state.view='files'; Drive.state.folderId='root'; Drive.render();");
    await sleep(250);
    const expectedFileId="f:" + fx.files.general.linkId + ":" + fx.files.general.version;
    const fileRows=await search("综合资料附件.txt");
    const fileFound=fileRows.includes(expectedFileId);
    const fileMeta=fileFound?await evalJs("(() => { const n=findById(" + JSON.stringify(expectedFileId) + "); const p=findParent(" + JSON.stringify(expectedFileId) + "); const m=VaultStore.metaOf(" + JSON.stringify(expectedFileId) + "); return {nodeId:n?.id||null,parentId:p?.id||null,fileId:m?.fileId??null,linkId:m?.linkId??null,version:m?.version??null}; })()"):null;
    const fileMapped=!!fileMeta && fileMeta.parentId==="af:" + fx.company.general &&
      Number(fileMeta.fileId)===Number(fx.files.general.fileId) && Number(fileMeta.linkId)===Number(fx.files.general.linkId);
    await shot("T-P2-07-search");
    ev("T-P2-07", [
      "搜索『档案-01』结果：" + JSON.stringify(archiveRows),
      "期望档案节点：" + expectedArchiveId + "；精确命中=" + archiveFound,
      "双击后位置：" + JSON.stringify(archiveAt) + "；正确跳转=" + archiveNavigated,
      "",
      "搜索『综合资料附件.txt』结果：" + JSON.stringify(fileRows),
      "期望附件节点：" + expectedFileId + "；命中=" + fileFound,
      "附件元数据与所属记录：" + JSON.stringify(fileMeta) + "；fileId→linkId 映射正确=" + fileMapped,
    ].join("\n"));
    const ok=archiveFound&&archiveNavigated&&fileFound&&fileMapped;
    rec("T-P2-07","DYNAMIC-BROWSER",ok?"PASS":"FAIL",
      "档案精确跳转=" + archiveNavigated + "（" + archiveAt.folderId + "）；附件命中=" + fileFound + "；归属映射=" + fileMapped,
      "搜索必须命中预期档案节点并跳转；附件搜索必须映射到真实 link 节点及正确所属记录");
    await evalJs("Drive.resetSearch(); Drive.render();").catch(()=>{});
  })();

  /* ---------- T-P2-09 连续滚动 PDF 实际渲染 ---------- */
  await (async function T_P2_09() {
    // Previous search may leave current rows filtered. Inspect the fixture
    // file in the actual project tree by its FileId rather than row text.
    await evalJs("Drive.resetSearch();Drive.openFolder('p:" + fx.company.projectA + "')");
    await waitFor("!!findById('p:" + fx.company.projectA + "')",10000,"PDF project tree");
    const rows=await evalJs("(() => {const n=findById('p:" + fx.company.projectA + "');return (n?.children||[]).filter(x=>x.type==='file').map(x=>({id:x.id,name:x.name,fileId:Number(VaultStore.metaOf(x.id)?.fileId||0)}));})()");
    const pdfRow=rows.find(x=>x.fileId===Number(fx.files.pdf.fileId));
    if(!pdfRow)return rec("T-P2-09","DYNAMIC-BROWSER","FAIL",
      "PDF FileId="+fx.files.pdf.fileId+" 缺失，项目节点="+JSON.stringify(rows),
      "项目两页 PDF 必须可定位并完成两页 Canvas 渲染");
    await evalJs("previewFile("+JSON.stringify(pdfRow.id)+")");
    await waitFor("document.querySelectorAll('.preview-mask .pdf-page').length===2",15000,"连续 PDF 两个页面容器").catch(()=>{});
    async function pageState(page) {
      const idx=page-1;
      const stateExpr=[
        "(() => {",
        "const box=document.querySelector('.preview-mask');",
        "const slots=box?.querySelectorAll('.pdf-page')||[];",
        "const canvas=slots["+idx+"]?.querySelector('canvas.pdf-canvas');",
        "const status=box?.querySelector('.pdf-render-status')?.textContent.trim()||'';",
        "const label=box?.querySelector('.pdf-count')?.textContent.trim()||'';",
        "return {page:"+page+",slots:slots.length,canvasWidth:canvas?.width||0,",
        "canvasHeight:canvas?.height||0,status,label,",
        "ready:slots.length===2&&!!canvas&&canvas.width>0&&canvas.height>0&&status===''};",
        "})()"
      ].join("\n");
      return evalJs(stateExpr);
    }
    async function readyPage(page) {
      const idx=page-1;
      const condition="(() => {const box=document.querySelector('.preview-mask');const slot=box?.querySelectorAll('.pdf-page')["+idx+"];const c=slot?.querySelector('canvas.pdf-canvas');return !!c&&c.width>0&&c.height>0&&box?.querySelector('.pdf-render-status')?.textContent.trim()==='';})()";
      await waitFor(condition,15000,"PDF 第"+page+"页真实渲染").catch(()=>{});
      return pageState(page);
    }
    const first=await readyPage(1);
    await shot("T-P2-09-pdf-page1");
    await evalJs("(() => {const area=document.querySelector('.preview-mask .pdf-canvas-area');const page=area?.querySelectorAll('.pdf-page')[1];if(!area||!page)return false;area.scrollTop=page.offsetTop;area.dispatchEvent(new Event('scroll'));return true;})()");
    const second=await readyPage(2);
    await shot("T-P2-09-pdf-page2");
    const ok=first.ready&&second.ready&&first.slots===2&&second.slots===2&&
      /\/ 2 页/.test(first.label)&&/\/ 2 页/.test(second.label);
    ev("T-P2-09",[
      "PDF 行："+JSON.stringify(pdfRow),
      "第 1 页状态："+JSON.stringify(first),
      "滚动后第 2 页状态："+JSON.stringify(second),
      "判据：连续滚动容器含两个页面槽位，两页独立 Canvas 已实际绘制；",
      "status 清空；页码总页数为 2。现行设计没有“下一页”按钮。",
      "fixture.cjs 使用带有效 xref、字体资源和准确 stream Length 的两页 PDF。"
    ].join("\n"));
    rec("T-P2-09","DYNAMIC-BROWSER",ok?"PASS":"FAIL",
      "page1="+first.ready+"("+first.label+")；page2="+second.ready+"("+second.label+")",
      "连续滚动模式两页 Canvas 分别完成渲染并显示总页数 2");
  })();

  /* ---------- T-P2-11 响应式 ---------- */
  await (async function T_P2_11() {
    const sizes = [[1366, 768, 1], [1920, 1080, 1], [1366, 768, 1.5]];
    const out = [];
    for (const [w, h, dpr] of sizes) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
      await sleep(500);
      const m = await evalJs(`(() => {
        const head = document.querySelector('#listHead');
        const row = document.querySelector('#viewRoot .row');
        const r1 = head && head.getBoundingClientRect(), r2 = row && row.getBoundingClientRect();
        return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
                 headH: r1 && Math.round(r1.height), rowH: r2 && Math.round(r2.height) };
      })()`);
      out.push(Object.assign({ w, h, dpr }, m));
      await shot(`T-P2-11-${w}x${h}-${dpr}x`);
    }
    await send("Emulation.clearDeviceMetricsOverride");
    ev("T-P2-11", ["三种视口下的布局指标：", JSON.stringify(out, null, 1),
      "", "判定：横向不出现滚动条（scrollW<=clientW），表头与行高度稳定。"].join("\n"));
    rec("T-P2-11", "DYNAMIC-BROWSER", out.every((x) => x.scrollW <= x.clientW) ? "PASS" : "FAIL",
      out.map((x) => `${x.w}x${x.h}@${x.dpr}x scroll=${x.scrollW}/${x.clientW}`).join("；"),
      "三种视口不横向溢出、不重叠");
  })();

  /* ---------- S5 true MCP -> Explorer -> MCP, one isolated dataset ---------- */
  await (async function S5_E2E() {
    const crypto=require("node:crypto");
    const tag="S5-"+RUNID.replace(/[^a-zA-Z0-9]/g,"").slice(-14);
    const need=(ok,why)=>{if(!ok)throw Error("S5 E2E: "+why);};
    const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
    L.setToken(resume.token);
    const auth=await L.post("/api/mcp",{enabled:true});
    need(auth.ok,"MCP authorization on isolated test vault");
    const exe=path.resolve(__dirname,"../../../src/IPSys.Web/bin/Debug/net8.0-windows/IPSys.Web.exe");
    need(fs.existsSync(exe),"Debug --mcp executable present");
    const cp=spawn(exe,["--mcp"],{stdio:["pipe","pipe","pipe"],windowsHide:true});
    let output="",seq=0,ended=false,err="";
    const waiters=new Map();
    cp.stderr.on("data",x=>{err=(err+String(x)).slice(-2000);});
    cp.stdout.on("data",x=>{
      output+=String(x);let idx;
      while((idx=output.indexOf("\n"))>=0){
        const line=output.slice(0,idx).trim();output=output.slice(idx+1);
        let msg;try{msg=JSON.parse(line);}catch{continue;}
        const w=waiters.get(msg.id);
        if(w){waiters.delete(msg.id);clearTimeout(w.timer);
          msg.error?w.reject(Error(JSON.stringify(msg.error))):w.resolve(msg);}
      }
    });
    cp.on("exit",code=>{ended=true;for(const w of waiters.values()){
      clearTimeout(w.timer);w.reject(Error("--mcp exit="+code+" "+err));
    }waiters.clear();});
    const rpc=(method,params)=>new Promise((resolve,reject)=>{
      if(ended)return reject(Error("MCP child ended"));
      const id=++seq,timer=setTimeout(()=>{waiters.delete(id);reject(Error("MCP timeout "+method));},30000);
      waiters.set(id,{resolve,reject,timer});
      cp.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
    });
    const tool=async(name,args)=>{
      const x=(await rpc("tools/call",{name,arguments:args})).result;
      const v=JSON.parse(x?.content?.[0]?.text||"null");
      if(x?.isError||v?.ok===false||v?.status==="failed")throw Error("MCP "+name+": "+JSON.stringify(v));
      return v;
    };
    const idOf=v=>Number(v?.id??v?.reference?.id??0);
    const folders=async()=>{
      const r=await L.get("/api/v2/ui/folders/company");
      need(r.ok&&Array.isArray(r.data?.folders),"folder HTTP snapshot");
      return r.data.folders;
    };
    const links=async id=>{
      const r=await L.get("/api/v2/files/company/folders/"+id+"/links?includeDeleted=false");
      need(r.ok,"folder links "+id);
      return Array.isArray(r.data)?r.data:(r.data?.items||[]);
    };
    async function pickGeneral() {
      await waitFor("!!document.querySelector('#attachmentFolderPicker')",10000,"GUI folder picker");
      const ok=await evalJs("(() => {const m=document.querySelector('#attachmentFolderPicker');m.querySelector('[data-picker-go=\"root\"]')?.click();const target=m.querySelector('[data-picker-enter=\"k:general\"]');target?.click();m.querySelector('[data-picker-current]')?.click();const b=m.querySelector('[data-picker-submit]');if(!target||!b||b.disabled)return false;b.click();return true;})()");
      need(ok,"GUI select general root");
      await waitFor("!document.querySelector('#attachmentFolderPicker')",12000,"GUI picker submitted");
    }
    const evidence=[];
    try {
      await rpc("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"IPSys S5",version:"1"}});
      const p1=idOf(await tool("create_project",{workspace:"company",name:tag+"P1",project_type:"科研项目"}));
      const p2=idOf(await tool("create_project",{workspace:"company",name:tag+"P2",project_type:"科研项目"}));
      need(p1>0&&p2>0,"MCP creates P1 and P2");
      const d1=idOf(await tool("create_folder",{workspace:"company",section:"project",parent_id:p1,name:tag+"D1"}));
      const d2=idOf(await tool("create_folder",{workspace:"company",section:"project",parent_id:d1,name:tag+"D2"}));
      need(d1>0&&d2>0,"MCP creates nested D1/D2");
      evidence.push("MCP P1="+p1+" P2="+p2+" D1="+d1+" D2="+d2);
      const one=Buffer.from(tag+" first"),two=Buffer.from(tag+" second-version");
      const upload=await L.upload(d2,tag+"F.txt",one);
      const fileId=Number(upload.fileId);
      await L.addVersion("company",fileId,tag+"F.txt",two);
      const original=(await links(d2)).find(x=>Number(x.fileId)===fileId);
      const linkId=Number(original?.id??original?.linkId);
      need(fileId>0&&linkId>0,"FileId and LinkId");
      const download=async(id,v)=>{
        const r=await L.call("GET","/api/v2/files/company/"+id+"/versions/"+v+"/download",{raw:true});
        need(r.ok,"version download v"+v);
        return Buffer.from(await r.arrayBuffer());
      };
      need(sha(await download(fileId,1))===sha(one)&&sha(await download(fileId,2))===sha(two),"two version bytes");
      evidence.push("FileId="+fileId+" LinkId="+linkId+" SHA1="+sha(one)+" SHA2="+sha(two));
      await evalJs("Drive.resetSearch();refreshCurrent()");
      await waitFor("!!findById('af:"+d2+"')",12000,"GUI sees MCP directory");
      const view=await evalJs("(() => {const a=findById('af:"+d1+"'),b=findById('af:"+d2+"');return {a:a?.biz?.parentId,b:b?.biz?.parentId,hasFile:!!b?.children?.some(n=>n.type==='file'&&Number(VaultStore.metaOf(n.id)?.fileId)==="+fileId+")};})()");
      need(Number(view.a)===p1&&Number(view.b)===d1&&view.hasFile,"GUI sees exact MCP IDs and FileId");
      evidence.push("Explorer same FolderId/FileId visible");
      await evalJs("moveSelectedItems([findById('af:"+d1+"')])");
      await pickGeneral();
      await waitFor("findById('af:"+d1+"')?.biz?.section==='general'",12000,"GUI in-place move");
      const shifted=(await folders()).find(x=>Number(x.id)===d1);
      need(shifted?.section==="general"&&shifted.parentId==null,"GUI move preserves FolderId");
      need((await links(d2)).some(x=>Number(x.fileId)===fileId&&Number(x.id??x.linkId)===linkId),"GUI move preserves LinkId");
      evidence.push("GUI move project → general preserves IDs");
      const returned=await tool("move_folder",{workspace:"company",section:"general",folder_id:d1,target_section:"project",parent_id:p2,request_id:tag+"moveBack"});
      need(idOf(returned)===d1,"MCP original FolderId after move back");
      await evalJs("refreshCurrent()");
      await waitFor("findById('af:"+d1+"')?.biz?.section==='project'",12000,"GUI sees MCP move");
      evidence.push("MCP moved to P2; GUI sees original FolderId");
      await evalJs("transferFolderBatch([findById('af:"+d1+"')],false)");
      await pickGeneral();
      let all=await folders();
      const shared=all.find(x=>x.section==="general"&&x.name===tag+"D1"&&Number(x.id)!==d1&&x.parentId==null);
      need(shared?.id>0,"GUI sharing creates new FolderId");
      const sharedD2=all.find(x=>Number(x.parentId)===Number(shared.id)&&x.name===tag+"D2");
      need(sharedD2?.id>0,"GUI sharing nested FolderIds");
      need((await links(sharedD2.id)).some(x=>Number(x.fileId)===fileId&&Number(x.id??x.linkId)!==linkId),"share same FileId new LinkId");
      evidence.push("GUI shared tree new FolderIds and LinkId, same FileId");
      const clone=await tool("transfer_folder",{workspace:"company",section:"project",folder_id:d1,target_workspace:"company",target_section:"project",target_folder_id:p1,move:false});
      const copiedId=idOf(clone);
      need(copiedId>0&&copiedId!==d1,"MCP independent new FolderId");
      all=await folders();
      const copiedD2=all.find(x=>Number(x.parentId)===copiedId&&x.name===tag+"D2");
      need(copiedD2?.id>0,"independent full tree");
      const copiedFile=Number((await links(copiedD2.id))[0]?.fileId);
      need(copiedFile>0&&copiedFile!==fileId,"independent new FileId");
      need(sha(await download(copiedFile,1))===sha(one)&&sha(await download(copiedFile,2))===sha(two),"independent copies both bytes");
      await evalJs("refreshCurrent()");
      await waitFor("!!findById('af:"+copiedId+"')",12000,"GUI sees MCP copied tree");
      evidence.push("MCP independent copy new FileId with both versions visible to GUI");
      const extra=idOf(await tool("create_folder",{workspace:"company",section:"project",parent_id:p2,name:tag+"sort"}));
      const getOrder=async()=> (await tool("list_folder_entries",{workspace:"company",section:"project",parent_id:p2})).map(x=>Number(x?.folder?.ref?.id));
      const oldOrder=await getOrder();
      need(oldOrder.includes(d1)&&oldOrder.includes(extra),"MCP sibling set");
      const ordered=[...oldOrder].reverse();
      await tool("reorder_entries",{workspace:"company",section:"project",parent_id:p2,items:ordered.map(id=>({kind:"folder",id})),request_id:tag+"sort"});
      need(JSON.stringify(await getOrder())===JSON.stringify(ordered),"MCP persisted order");
      await evalJs("refreshCurrent()");
      const guiOrder=await evalJs("(() => {Drive.openFolder('p:"+p2+"');Drive.state.sortBy='position';Drive.state.sortDir='asc';Drive.render();return Drive.sortedItems.filter(n=>n.biz?.kind==='archive_folder').map(n=>Number(n.biz.id));})()");
      need(JSON.stringify(guiOrder)===JSON.stringify(ordered),"GUI same custom sibling order");
      evidence.push("MCP reorder persisted in GUI");
      await evalJs("(() => {deleteArchiveFolder(findById('af:"+d1+"'));return true;})()");
      await waitFor("!!document.querySelector('#confirmMask.show')",10000,"GUI delete confirmation");
      await evalJs("document.querySelector('#confirmOk').click()");
      await waitFor("!findById('af:"+d1+"')",12000,"GUI delete result");
      const trash=await tool("list_trash",{workspace:"company"});
      const row=trash.find(x=>Number(x.id)===d1);
      need(row?.kind==="v2_archive_folder","MCP sees GUI trash");
      await tool("restore_trash",{workspace:"company",kind:row.kind,id:d1,section:row.section});
      await evalJs("refreshCurrent()");
      await waitFor("!!findById('af:"+d2+"')",12000,"MCP restore visible in GUI");
      need((await links(d2)).some(x=>Number(x.fileId)===fileId&&Number(x.id??x.linkId)===linkId),"restored same link");
      evidence.push("GUI delete → MCP restore, same FileId/LinkId");
      await tool("delete_folder",{workspace:"company",section:"general",folder_id:Number(shared.id)});
      const gone=(await tool("list_trash",{workspace:"company"})).find(x=>Number(x.id)===Number(shared.id));
      need(!!gone,"disposable shared tree in trash");
      await tool("purge_trash",{workspace:"company",kind:gone.kind,id:Number(shared.id),section:gone.section,confirm:true,request_id:tag+"purge"});
      need(sha(await download(fileId,1))===sha(one)&&sha(await download(fileId,2))===sha(two),"purge shared tree keeps original versions");
      evidence.push("MCP purge disposable shared tree preserves both source versions");
      ev("S5-E2E",evidence.join("\n"));
      await shot("S5-E2E-mcp-gui");
      rec("S5-E2E","MCP/EDGE/SQLCIPHER","PASS",evidence.join("；"),"同批对象双向 GUI/MCP 目录移动、共享和独立复制、排序、回收恢复、共享清理与两版本字节一致");
    } finally {
      cp.stdin.end();
      cp.kill();
    }
  })();

  fs.writeFileSync(path.join(EVID, "browser-results.json"), JSON.stringify(results, null, 2), "utf8");
  console.log("\n=== 浏览器层汇总 ===");
  for (const r of results) console.log(`${r.id}\t${r.result}\t${r.observed}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .finally(async () => {
    try { ws && ws.close(); } catch {}
    await sleep(300);
    /* 只关自己起的那个进程，绝不按映像名杀 msedge —— 用户可能正开着浏览器 */
    try { await send("Browser.close"); } catch {}
    await sleep(500);
    try { if (browserProc && !browserProc.killed) browserProc.kill(); } catch {}
  });
