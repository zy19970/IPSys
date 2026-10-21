/* 用原生 CDP 驱动 Edge（不依赖 puppeteer）批量截图。
   node capture.cjs  → 输出到 ../screenshots-new/ */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CDP_PORT = 9223;
const BASE = process.env.BASE || 'http://127.0.0.1:8776';
const W = Number(process.env.W || 1440);
const H = Number(process.env.H || 900);
const OUT = path.resolve(__dirname, process.env.OUT || '../screenshots-new');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(require('os').tmpdir(), 'ipsys-edge-' + Date.now());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: CDP_PORT, path: pathname, timeout: 1200 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function launchEdge() {
  const child = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,msEdgeIdentityFeatures',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + PROFILE,
    '--window-size=' + W + ',' + H,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 60; i++) {
    try { await getJson('/json/version'); return child; } catch { await wait(300); }
  }
  child.kill();
  throw new Error('Edge 调试端口未就绪');
}

async function connect() {
  const version = await getJson('/json/version');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { ws, send };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const edge = await launchEdge();
  try {
    const { ws, send } = await connect();
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);

    await S('Page.enable');
    await S('Runtime.enable');
    await S('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression) => {
      const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      }
      return r.result.value;
    };

    const shot = async (name) => {
      /* 截图前把还在跑的 CSS 动画强制推到终态。headless 下动画帧不会自己推进,
         停在中间态截出来的对话框是半透明的(能看到背后的分类卡片)。 */
      await evaluate(`(() => {
        document.getAnimations().forEach(a => { try { a.finish(); } catch {} });
        return true;
      })()`);
      const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
      console.log('shot', name);
    };

    const goto = async (url) => {
      await S('Page.navigate', { url });
      await wait(1000);
    };

    const click = async (sel, ms = 500) => {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) throw new Error('未找到 ${sel}'); el.click(); return true; })()`);
      await wait(ms);
    };

    const dbl = async (sel, ms = 600) => {
      await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if(!el) throw new Error('未找到 ${sel}');
        el.dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
        return true;
      })()`);
      await wait(ms);
    };

    const waitReady = async (limit = 60) => {
      for (let i = 0; i < limit; i++) {
        const ok = await evaluate(`!!(typeof Drive !== "undefined" && Drive.state.ready)`);
        if (ok) return true;
        await wait(250);
      }
      const diag = await evaluate(`JSON.stringify({
        app: typeof Drive,
        ready: typeof Drive !== "undefined" ? Drive.state.ready : null,
        err: typeof Drive !== "undefined" ? Drive.state.loadError : null,
        hint: document.getElementById('lockHint') ? document.getElementById('lockHint').textContent : null,
        lock: document.getElementById('lockScreen').classList.contains('show'),
        scripts: [...document.scripts].map(s => s.src.split('/').pop())
      })`);
      throw new Error('数据加载超时 ' + diag);
    };

    /* 1. 登录 */
    await goto(BASE + '/');
    await wait(500);
    await shot('01-登录');

    /* 2. 打开资料库 → 首页 */
    await evaluate(`
      (() => {
        document.getElementById('dbPath').value = 'D:\\\\IPSys\\\\研发管理.db';
        document.getElementById('password').value = 'preview';
        document.getElementById('lockForm').requestSubmit();
        return true;
      })()
    `);
    await waitReady();
    await wait(700);
    await shot('02-首页（默认个人）');

    /* 2b. 登录后默认落在个人工作区,手动切到企业再看台账 */
    await click('#wsSwitchBtn', 400);
    await click('[data-act="ws:company"]', 4600);
    await shot('02b-公司工作台');

    /* 2c. 首页页头的新建菜单（命令栏在首页隐藏，主操作在页头） */
    await click('[data-page-act="new"]', 400);
    await shot('02c-首页新建菜单');
    await evaluate(`(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true; })()`);
    await wait(200);

    /* 2d. 首页「最近更新」里的一条 → 直接进到这条记录 */
    await click('.home-row', 800);
    await shot('02d-从首页打开记录');
    await click('[data-nav="home"]', 600);

    /* 3. 我的文件（分类） */
    await click('[data-nav="files"]', 700);
    await shot('03-我的文件');

    /* 4. 项目台账(进分类 = 台账视图,列由该分类决定) */
    await click('[data-quick="k:project"]', 700);
    await shot('04-项目台账');

    /* 4a. 分类内新建:只有这一类,不再让用户选类型 */
    await click('#btnNew', 420);
    await shot('04a-分类内新建菜单');
    /* 菜单是靠 mousedown 收起的,element.click() 不触发,直接调 hideCtx */
    await evaluate('hideCtx(), true');
    await wait(300);

    /* 5. 选中一条 → 详细信息面板(进台账时面板自动收起,这里手动打开) */
    await click('#btnDetailToggle', 350);
    await click('#viewRoot .row', 500);
    await shot('05-选中与详细信息');

    /* 5a. 面板「修改」→ 业务表单(改完取消,不动数据) */
    await click('[data-detail-act="edit"]', 600);
    await shot('05a-修改属性表单');
    await click('#formMask [data-close]', 400);

    /* 5b. 再勾一条 → 表头半选(中间态) */
    await click('#viewRoot .row:nth-child(2) .row-check', 300);
    await shot('05b-中间态');

    /* 5c. 表头全选 → 页脚批量操作 */
    await click('#selectAll', 450);
    await shot('05c-全选');
    await click('#selectAll', 300);

    /* 6. 进入项目 → 里面的附件(退回通用三列,右侧面板继续显示这条记录) */
    await dbl('#viewRoot .row', 700);
    await shot('06-项目内的附件');

    /* 7. 右键菜单 */
    await evaluate(`
      (() => {
        const row = document.querySelector('#viewRoot .row');
        const r = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:r.left+120, clientY:r.top+16}));
        return true;
      })()
    `);
    await wait(400);
    await shot('07-右键菜单');

    /* 8. 新建项目表单 */
    await evaluate(`document.body.click(); true`);
    await wait(200);
    await click('[data-quick="k:project"]', 600);
    await click('#btnNew', 300);
    await evaluate(`document.querySelector('[data-act="new-project"]').click(); true`);
    await wait(500);
    await shot('08-新建项目');

    /* 9. 业务档案：一级是 7 个系统目录，不是台账 */
    await evaluate(`document.querySelector('#formMask [data-close]').click(); true`);
    await wait(200);
    await click('[data-quick="k:achievement"]', 700);
    await shot('09-业务档案');

    /* 9a. 进入「申报与认定」，目录里才出档案台账 */
    await dbl('#viewRoot .row', 700);
    await shot('09a-业务档案-目录内');

    /* 10. 企业资质 */
    await click('[data-quick="k:certificate"]', 700);
    await shot('10-企业资质');

    /* 11. 知识产权 */
    await click('[data-quick="k:ip"]', 700);
    await shot('11-知识产权');

    /* 12. 综合资料 */
    await click('[data-quick="k:general"]', 700);
    await shot('12-综合资料');

    /* 13. 网格视图 */
    await click('[data-quick="k:project"]', 600);
    await click('#btnViewToggle', 500);
    await shot('13-网格视图');

    /* 14. 回收站 */
    await click('#btnViewToggle', 300);
    await click('[data-nav="recycle"]', 600);
    await shot('14-回收站');

    /* 15. 搜索 */
    await click('[data-nav="files"]', 400);
    await evaluate(`
      (() => {
        const i = document.getElementById('searchInput');
        i.value = '智能';
        i.dispatchEvent(new Event('input', {bubbles:true}));
        return true;
      })()
    `);
    await wait(700);
    await shot('15-搜索结果');

    /* 16. 工作区切换菜单 */
    await evaluate(`
      (() => {
        const i = document.getElementById('searchInput');
        i.value = '';
        i.dispatchEvent(new Event('input', {bubbles:true}));
        return true;
      })()
    `);
    await wait(400);
    await click('[data-nav="home"]', 500);
    await click('#wsSwitchBtn', 500);
    await shot('16-工作区切换');

    /* 17. 个人工作区 */
    await click('[data-act="ws:personal"]', 4600);
    await shot('17-个人工作区首页');

    await click('[data-quick="k:academic"]', 700);
    await shot('18-个人学术与社会活动');

    /* 18. 切回企业工作区 */
    await click('#wsSwitchBtn', 400);
    await click('[data-act="ws:company"]', 4600);
    await shot('19-切回企业工作区');

    /* 19. 头像菜单(含「设置」)与设置面板 */
    await click('#btnAvatar', 400);
    await shot('20-头像菜单');
    await click('[data-act="settings"]', 900);
    await shot('21-设置面板');
    await click('#settingsDone', 300);

    await send('Target.closeTarget', { targetId });
    ws.close();
    console.log('done ->', OUT);
  } finally {
    edge.kill();
  }
  process.exit(0);
})().catch((error) => {
  console.error('CAPTURE FAILED:', error.message);
  process.exit(1);
});
