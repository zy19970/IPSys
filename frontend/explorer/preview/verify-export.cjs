/* 端到端验证 ZIP 导出:真实 exe + 真实库 + 真实浏览器。
   --------------------------------------------------------------------------
   覆盖 collectExportEntries → IPSysExport.start('zip') → 下载 → 打包 全链路。
   File System Access API 在 headless 里不可用,这里替换 showSaveFilePicker
   为内存 writer,直接对生成的 ZIP 字节做断言(签名 + 目录结构 + 文件名)。

   用法: BASE=http://127.0.0.1:34997 node preview/verify-export.cjs */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CDP_PORT = Number(process.env.CDP_PORT || 9226);
const BASE = process.env.BASE || 'http://127.0.0.1:8776';
const OUT = path.resolve(__dirname, process.env.OUT || '../screenshots-real');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'ipsys-export-' + Date.now());
const DB_PATH = path.join(os.tmpdir(), 'ipsys-export-' + Date.now() + '.db');
const PASSWORD = 'verify-' + Math.random().toString(36).slice(2, 10);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? ' — ' + detail : ''));
};

function request(method, urlPath, { body, token, headers, raw } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const payload = raw ? raw : body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: {
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...(raw ? {} : payload ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-IPSys-Token': token } : {}),
        ...(headers || {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

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

async function uploadOne(token, folderId, name, content) {
  const prepared = await request('POST', `/api/v2/files/company/prepare?folderId=${folderId}`, {
    token,
    raw: Buffer.from(content, 'utf8'),
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
    },
  });
  if (prepared.status !== 200) throw new Error('prepare 失败: ' + prepared.text);
  const resolved = await request('POST',
    `/api/v2/files/company/prepared/${prepared.json.ticket}/resolve`,
    { token, body: { choice: 'independent' } });
  if (resolved.status !== 200) throw new Error('resolve 失败: ' + resolved.text);
  return prepared.json.ticket;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let edge = null;
  let token = '';
  try {
    const opened = await request('POST', '/api/open', {
      body: { path: DB_PATH, password: PASSWORD, create: true },
    });
    if (opened.status !== 200) throw new Error('建库失败: ' + opened.text);
    token = opened.json.token;

    const created = await request('POST', '/api/v2/folders/company/project', {
      body: { project: { name: '导出验证项目', projectType: '科研项目' } },
      token,
    });
    if (created.status !== 200) throw new Error('建项目失败: ' + created.text);
    const projectId = created.json.id;

    await uploadOne(token, projectId, '附件甲.txt', 'ZIP EXPORT PAYLOAD A ' + 'a'.repeat(300));
    await uploadOne(token, projectId, '附件乙.txt', 'ZIP EXPORT PAYLOAD B ' + 'b'.repeat(300));
    console.log('已上传 2 个附件到项目', projectId);

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

    /* 进入项目,让附件进入已加载的树 */
    const located = await evaluate(`(async () => {
      await enterWorkspace('company');
      const project = (findById('k:project').children || []).find(n => /导出验证项目/.test(n.name));
      if (!project) return 'missing-project';
      Drive.openFolder(project.id);
      return project.id;
    })()`);
    check('定位导出项目', located !== 'missing-project', String(located));
    if (located === 'missing-project') throw new Error('项目未找到');
    await wait(900);

    const files = await evaluate(`JSON.stringify((findById(Drive.state.folderId).children || []).map(n => ({ name: n.name, type: n.type, size: n.size })))`);
    check('附件已加载', JSON.parse(files).length === 2, files);

    /* 替换保存对话框:headless 里没有文件选择器,直接收进内存 */
    await evaluate(`(() => {
      window.__zipParts = [];
      window.showSaveFilePicker = async () => ({
        createWritable: async () => ({
          write: async (chunk) => { window.__zipParts.push(chunk); },
          truncate: async () => { window.__zipParts.length = 0; },
          seek: async () => {},
          close: async () => {},
        }),
      });
      return true;
    })()`);

    /* 选整个项目目录 → 打包 */
    await evaluate(`(() => {
      const node = findById(Drive.state.folderId);
      window.__exportDone = false;
      exportNodes([node]).then(() => { window.__exportDone = true; });
      return true;
    })()`);

    for (let i = 0; i < 40 && !(await evaluate(`!!window.__exportDone`)); i++) await wait(200);
    check('导出任务结束', await evaluate(`!!window.__exportDone`));

    const zip = await evaluate(`(() => {
      const parts = window.__zipParts || [];
      const total = parts.reduce((n, p) => n + p.byteLength, 0);
      const all = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { all.set(new Uint8Array(p), off); off += p.byteLength; }
      const head = [...all.slice(0, 4)];
      const tail = [...all.slice(Math.max(0, total - 22), total - 18)];
      const text = new TextDecoder('utf-8', { fatal: false }).decode(all);
      return JSON.stringify({
        total, head, tail,
        hasA: text.includes('附件甲.txt'),
        hasB: text.includes('附件乙.txt'),
        report: document.querySelector('#exportResult')?.textContent || '',
        status: document.querySelector('#exportStatusText')?.textContent || '',
      });
    })()`);
    const z = JSON.parse(zip);

    check('生成的 ZIP 非空', z.total > 0, z.total + ' bytes');
    check('ZIP 局部文件头正确', z.head[0] === 0x50 && z.head[1] === 0x4b && z.head[2] === 0x03 && z.head[3] === 0x04, JSON.stringify(z.head));
    check('ZIP 中央目录结束标记正确', z.tail[0] === 0x50 && z.tail[1] === 0x4b && z.tail[2] === 0x05 && z.tail[3] === 0x06, JSON.stringify(z.tail));
    check('包含 附件甲.txt', z.hasA === true);
    check('包含 附件乙.txt', z.hasB === true);
    check('导出报告显示成功', /成功 2/.test(z.status) || /成功 2/.test(z.report), z.status || z.report);

    await evaluate(`(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); return true; })()`);
    const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, 'export-done.png'), Buffer.from(shot.data, 'base64'));

    check('全程无 console 异常', problems.length === 0, problems.slice(0, 3).join(' | '));
    ws.close();
  } catch (e) {
    check('脚本执行', false, e.message);
  } finally {
    if (edge) edge.kill();
    if (token) await request('POST', '/api/lock', { token }).catch(() => {});
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + ext); } catch {}
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length ? `失败 ${failed.length} / ${results.length}` : `全部通过 (${results.length} 项)`));
  process.exit(failed.length ? 1 : 0);
})();
