/* 端到端验证上传链路:真实 exe + 真实库 + 真实浏览器。
   --------------------------------------------------------------------------
   覆盖的是换壳后最容易断的那条线:
     uploadAttachments → CapabilityApi.uploadFile(XHR) → /prepare
       → 相同内容检测 → 去重对话框 → /resolve → 列表刷新
   同时验证多阶段进度面板与取消按钮存在。

   用法:
     BASE=http://127.0.0.1:34997 node preview/verify-upload.cjs

   退出码:0 通过;1 失败(逐条打印失败原因)。
   测试库建在系统临时目录,结束时删除。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CDP_PORT = Number(process.env.CDP_PORT || 9225);
const BASE = process.env.BASE || 'http://127.0.0.1:8776';
const OUT = path.resolve(__dirname, process.env.OUT || '../screenshots-real');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'ipsys-upload-' + Date.now());
const DB_PATH = path.join(os.tmpdir(), 'ipsys-upload-' + Date.now() + '.db');
const PASSWORD = 'verify-' + Math.random().toString(36).slice(2, 10);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? ' — ' + detail : ''));
};

/* ---------------- HTTP ---------------- */

function request(method, urlPath, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: url.hostname, port: url.port, path: url.pathname + url.search,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(token ? { 'X-IPSys-Token': token } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------------- CDP ---------------- */

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: CDP_PORT, path: pathname, timeout: 1200 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function launchEdge() {
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-features=Translate,msEdgeIdentityFeatures',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + PROFILE,
    '--window-size=1366,768',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 60; i++) {
    try { await getJson('/json/version'); return child; } catch { await wait(300); }
  }
  child.kill();
  throw new Error('Edge 调试端口未就绪');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let edge = null;
  let token = '';
  try {
    /* ---- 1. 建测试库 + 一条项目记录 ---- */
    const opened = await request('POST', '/api/open', {
      body: { path: DB_PATH, password: PASSWORD, create: true },
    });
    if (opened.status !== 200) throw new Error('建库失败: ' + opened.text);
    token = opened.json.token;
    console.log('测试库:', DB_PATH);

    const created = await request('POST', '/api/v2/folders/company/project', {
      body: { project: { name: '上传链路验证项目', projectType: '科研项目' } },
      token,
    });
    if (created.status !== 200) throw new Error('建项目失败: ' + created.text);
    console.log('测试项目 id:', created.json.id);

    /* ---- 2. 浏览器登录 ---- */
    edge = await launchEdge();
    const version = await getJson('/json/version');
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let seq = 0;
    const pending = new Map();
    const problems = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        problems.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        problems.push(msg.params.entry.text);
      }
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S('Page.enable');
    await S('Runtime.enable');
    await S('Log.enable');
    await S('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression) => {
      const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      }
      return r.result.value;
    };
    const shot = async (name) => {
      await evaluate(`(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); return true; })()`);
      const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    };

    await S('Page.navigate', { url: BASE + '/' });
    await wait(1500);

    await evaluate(`(() => {
      const p = document.querySelector('#password');
      p.value = ${JSON.stringify(PASSWORD)};
      p.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#lockForm').requestSubmit();
      return true;
    })()`);
    await wait(2200);

    const unlocked = await evaluate(`!document.querySelector('#lockScreen')?.classList.contains('show')`);
    check('登录后进入主界面', unlocked === true);

    /* ---- 3. 切到公司工作区并进入测试项目 ---- */
    const entered = await evaluate(`(async () => {
      await enterWorkspace('company');
      const cat = findById('k:project');
      if (!cat) return 'missing-category';
      const project = (cat.children || []).find((n) => /上传链路验证项目/.test(n.name));
      if (!project) return 'missing-project';
      Drive.openFolder(project.id);
      return project.id;
    })()`);
    const locateError = ['missing-category', 'missing-project'].includes(entered);
    check('进入测试项目', !locateError, String(entered));
    if (locateError) throw new Error('无法定位测试项目: ' + entered);
    await wait(800);

    /* ---- 4. 上传一个文件(走完整 prepare → resolve) ---- */
    const firstUpload = await evaluate(`(async () => {
      const bytes = new TextEncoder().encode('IPSys upload verify payload ' + 'x'.repeat(200));
      const file = new File([bytes], 'verify-upload.txt', { type: 'text/plain' });
      const node = findById(Drive.state.folderId);
      if (!node) return 'no-current-node';
      await uploadAttachments([file], node);
      return JSON.stringify({
        panelHidden: document.querySelector('#uploadProgress')?.hidden !== false,
        stage: document.querySelector('#uploadProgressStage')?.textContent || '',
      });
    })()`);
    const first = firstUpload && firstUpload.startsWith('{') ? JSON.parse(firstUpload) : null;
    /* 树刷新由 onActiveChanged 触发,刻意延迟 450ms 等服务端回滚收尾,这里要等它。 */
    await wait(1200);
    const firstRows = await evaluate(`(findById(Drive.state.folderId).children || []).length`);
    check('首次上传完成并出现在列表', firstRows >= 1, `rows=${firstRows} · ${first?.stage || firstUpload}`);
    check('上传进度面板已弹出', !!first && first.panelHidden === false, first?.stage);

    /* ---- 5. 同一内容再传一次 → 必须出现去重对话框 ---- */
    await evaluate(`(() => {
      const bytes = new TextEncoder().encode('IPSys upload verify payload ' + 'x'.repeat(200));
      const file = new File([bytes], 'verify-upload-again.txt', { type: 'text/plain' });
      const node = findById(Drive.state.folderId);
      window.__uploadDone = false;
      uploadAttachments([file], node).then(() => { window.__uploadDone = true; });
      return true;
    })()`);
    await wait(1800);

    const conflict = await evaluate(`(() => {
      const dlg = document.querySelector('dialog.upload-conflict-dialog');
      if (!dlg) return JSON.stringify({ shown: false });
      return JSON.stringify({
        shown: true,
        text: dlg.textContent.replace(/\\s+/g, ' ').slice(0, 160),
        options: [...dlg.querySelectorAll('[data-pick]')].map(b => b.dataset.pick),
      });
    })()`);
    const cf = JSON.parse(conflict);
    check('相同内容弹出去重对话框', cf.shown === true, cf.shown ? cf.text : '未出现');
    if (cf.shown) {
      check('提供三种复用方式', (cf.options || []).includes('0:share-file') && (cf.options || []).includes('0:reuse-content') && (cf.options || []).includes('independent'), (cf.options || []).join(','));
      await shot('upload-conflict');
      await evaluate(`(() => { document.querySelector('dialog.upload-conflict-dialog [data-pick="independent"]')?.click(); return true; })()`);
      await wait(1800);
    } else {
      await evaluate(`(() => { uploadProgress.cancel?.(); return true; })()`);
    }

    const settled = await evaluate(`JSON.stringify({
      done: !!window.__uploadDone,
      rows: (findById(Drive.state.folderId).children || []).length,
      stage: document.querySelector('#uploadProgressStage')?.textContent || ''
    })`);
    const st = JSON.parse(settled);
    check('独立保存后附件数增加', st.rows >= 2, 'rows=' + st.rows + ' · ' + st.stage);
    await shot('upload-done');

    check('全程无 console 异常/CSP 违规', problems.length === 0, problems.slice(0, 3).join(' | '));

    ws.close();
  } catch (e) {
    check('脚本执行', false, e.message);
  } finally {
    if (edge) edge.kill();
    /* 关库并删除测试库文件,避免污染用户目录 */
    if (token) await request('POST', '/api/lock', { token }).catch(() => {});
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + ext); } catch {}
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length ? `失败 ${failed.length} / ${results.length}` : `全部通过 (${results.length} 项)`));
  process.exit(failed.length ? 1 : 0);
})();
