/* 最小 CDP 驱动：自起 Edge（独立 user-data-dir），只关自己的进程。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch({ profileDir, width = 1366, height = 768, port } = {}) {
  if (!EDGE) throw new Error("找不到 Edge/Chrome");
  const cdpPort = port || (9600 + Math.floor(Math.random() * 200));
  const profile = profileDir || path.join(process.env.TEMP || ".", "ipsys-cdp-" + Date.now());
  const proc = spawn(EDGE, [
    "--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
    `--window-size=${width},${height}`, "about:blank",
  ], { stdio: "ignore", detached: false });
  const wsUrl = await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      http.get({ host: "127.0.0.1", port: cdpPort, path: "/json/list" }, (res) => {
        let b = ""; res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            const page = JSON.parse(b).find((x) => x.type === "page");
            if (page) resolve(page.webSocketDebuggerUrl); else retry();
          } catch { retry(); }
        });
      }).on("error", retry);
    };
    const retry = () => { if (Date.now() - t0 > 20000) reject(new Error("CDP 启动超时")); else setTimeout(poll, 200); };
    poll();
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let msgId = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
    } else if (m.method) {
      for (const fn of listeners) { try { fn(m); } catch {} }
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("cdp timeout: " + method)); } }, 30000);
  });
  await send("Page.enable");
  await send("Runtime.enable");
  const api = {
    proc, profile, port: cdpPort, send, listeners,
    on(fn) { listeners.push(fn); },
    async evalJs(expression, awaitPromise = true) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || "eval error");
      }
      return r.result ? r.result.value : undefined;
    },
    async goto(url) {
      await send("Page.navigate", { url });
      await sleep(400);
      await api.waitFor("document.readyState === 'complete'", 15000, "document ready");
    },
    async waitFor(expr, timeout = 12000, label = expr) {
      const t0 = Date.now(); let last = null;
      while (Date.now() - t0 < timeout) {
        try { const v = await api.evalJs(expr); if (v) return v; } catch (e) { last = e; }
        await sleep(150);
      }
      throw new Error("等待超时: " + label + (last ? " / " + last.message : ""));
    },
    async shot(file) {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    async close() {
      try { ws.close(); } catch {}
      try { proc.kill(); } catch {}
    },
  };
  return api;
}

module.exports = { launch, sleep, EDGE };
