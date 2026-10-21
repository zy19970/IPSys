/* 对真实服务端做一次浏览器级体检:抓 console 报错、未捕获异常、CSP 违规,并截图。
   --------------------------------------------------------------------------
   与 capture.cjs 的区别:capture 打的是 mock 预览服务(不发 CSP),这里打真实
   IPSys.Web.exe —— 只有真实服务端才会暴露 CSP 拦截、内嵌资源缺失、路由 404。

   用法:
     BASE=http://127.0.0.1:34997 node preview/verify-real.cjs
     BASE=... OUT=../screenshots-real node preview/verify-real.cjs

   退出码:0 = 无错误;1 = 有 console 错误/CSP 违规/异常。 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CDP_PORT = Number(process.env.CDP_PORT || 9224);
const BASE = process.env.BASE || 'http://127.0.0.1:8776';
const W = Number(process.env.W || 1366);
const H = Number(process.env.H || 768);
const OUT = path.resolve(__dirname, process.env.OUT || '../screenshots-real');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(require('os').tmpdir(), 'ipsys-verify-' + Date.now());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
    '--window-size=' + W + ',' + H,
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
  const edge = await launchEdge();
  const problems = [];
  try {
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
        return;
      }
      // —— 三类问题都收进来 ——
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        problems.push('异常: ' + (d.exception?.description || d.text));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        problems.push('console.error: ' + msg.params.args
          .map((a) => a.value ?? a.description ?? a.type).join(' '));
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        const e = msg.params.entry;
        problems.push((e.source === 'security' ? 'CSP 违规: ' : '日志错误: ') + e.text
          + (e.url ? ' @ ' + e.url : ''));
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
    await S('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression) => {
      const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };

    await S('Page.navigate', { url: BASE + '/' });
    await wait(1800);

    // 检查能力层全局对象是否都到齐(脚本没加载成功时首页看起来完全正常,但功能全废)
    // 注意用不带 window 前缀的 typeof:新壳用 const 顶层声明,是全局词法绑定,不挂到 window 上。
    const globals = await evaluate(`JSON.stringify({
      VaultStore: typeof VaultStore,
      Drive: typeof Drive,
      IPSysNativeIp: typeof window.IPSysNativeIp,
      IPSysUploadProgress: typeof window.IPSysUploadProgress,
      IPSysExport: typeof window.IPSysExport,
      IPSysPdfViewer: typeof window.IPSysPdfViewer,
      pdfjsLib: typeof window.pdfjsLib,
      lockVisible: !!document.querySelector('#lockScreen') && getComputedStyle(document.querySelector('#lockScreen')).display !== 'none'
    })`);
    const g = JSON.parse(globals);
    console.log('全局对象:', g);

    await evaluate(`(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); return true; })()`);
    const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, 'real-1366.png'), Buffer.from(data, 'base64'));
    console.log('shot →', path.join(OUT, 'real-1366.png'));

    for (const [k, v] of Object.entries(g)) {
      if (k === 'pdfjsLib' || k === 'lockVisible') continue; // pdfjs 按需加载;lockVisible 视库状态而定
      if (v === 'undefined') problems.push(`能力层缺失: window.${k} 未定义(脚本未加载或解析失败)`);
    }

    ws.close();
  } finally {
    edge.kill();
  }

  if (problems.length) {
    console.log('\n发现 ' + problems.length + ' 个问题:');
    problems.forEach((p) => console.log('  - ' + p));
    process.exit(1);
  }
  console.log('\n真实服务端体检通过:无 console 错误、无 CSP 违规、能力层全部就位。');
})();
