/* 最小 HTTP 客户端：只用 Node 内置 fetch，无依赖。
   base 必须是 http://127.0.0.1:<port> —— 宿主对 Host 做严格校验，localhost 会 403。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.IPSYS_BASE || "";
if (!BASE) throw new Error("IPSYS_BASE 未设置，例如 http://127.0.0.1:51868");
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("BASE 必须是 127.0.0.1，不是 " + BASE);

let TOKEN = "";

function setToken(t) { TOKEN = t || ""; }
function token() { return TOKEN; }

async function call(method, p, { json, body, headers, raw } = {}) {
  const h = Object.assign({}, headers);
  if (TOKEN) h["X-IPSys-Token"] = TOKEN;
  let payload;
  if (json !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  } else if (body !== undefined) {
    payload = body;
  }
  const res = await fetch(BASE + p, { method, headers: h, body: payload, redirect: "manual" });
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

const get = (p, o) => call("GET", p, o);
const post = (p, json, o) => call("POST", p, Object.assign({ json }, o));
const put = (p, json, o) => call("PUT", p, Object.assign({ json }, o));
const del = (p, o) => call("DELETE", p, o);

async function openVault(dbPath, password, create = true) {
  const r = await post("/api/open", { path: dbPath, password, create });
  if (!r.ok || !r.data || !r.data.token) throw new Error("open failed: " + r.status + " " + JSON.stringify(r.data));
  setToken(r.data.token);
  return r.data;
}

/* 库已打开时 /api/open 会 409，此时用 /api/resume 拿同一会话的 token */
async function connect(dbPath, password) {
  const r = await post("/api/open", { path: dbPath, password, create: false });
  if (r.ok && r.data && r.data.token) { setToken(r.data.token); return { via: "open" }; }
  if (r.status === 409) {
    const rr = await post("/api/resume", { password });
    if (!rr.ok || !rr.data || !rr.data.token) throw new Error("resume failed: " + rr.status + " " + JSON.stringify(rr.data));
    setToken(rr.data.token);
    return { via: "resume" };
  }
  throw new Error("connect failed: " + r.status + " " + JSON.stringify(r.data));
}

/* 上传：folderId 是业务记录（folder）的 id。返回 {fileId, linkId, ...} */
async function upload(folderId, name, buf, extra = {}) {
  const enc = encodeURIComponent(name);
  const h = {
    "X-File-Name": enc,
    "X-File-Description": encodeURIComponent(extra.description || ""),
    "X-File-Tags": encodeURIComponent(extra.tags || ""),
    "X-File-Number": encodeURIComponent(extra.number || ""),
    "X-File-Date": encodeURIComponent(extra.date || ""),
    "Content-Type": "application/octet-stream",
  };
  const r = await call("POST", `/api/v2/files/company/upload?folderId=${folderId}`, { body: buf, headers: h });
  if (!r.ok) throw new Error(`upload ${name} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function uploadIn(ws, folderId, name, buf) {
  const enc = encodeURIComponent(name);
  const r = await call("POST", `/api/v2/files/${ws}/upload?folderId=${folderId}`, {
    body: buf,
    headers: { "X-File-Name": enc, "X-File-Description": "", "X-File-Tags": "", "X-File-Number": "", "X-File-Date": "", "Content-Type": "application/octet-stream" },
  });
  if (!r.ok) throw new Error(`uploadIn ${name} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function addVersion(ws, fileId, name, buf) {
  const enc = encodeURIComponent(name);
  const r = await call("POST", `/api/v2/files/${ws}/${fileId}/versions`, {
    body: buf,
    headers: { "X-File-Name": enc, "X-File-Description": "", "X-File-Tags": "", "X-File-Number": "", "X-File-Date": "", "X-Version-Note": "", "Content-Type": "application/octet-stream" },
  });
  if (!r.ok) throw new Error(`version ${name} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

/* 把每次请求记进日志，报告里可直接引用 */
function makeLog(file) {
  ensureDir(path.dirname(file));
  const lines = [];
  return {
    add(s) { lines.push(s); console.log(s); },
    flush() { fs.writeFileSync(file, lines.join("\n") + "\n", "utf8"); },
  };
}

module.exports = { BASE, call, get, post, put, del, openVault, connect, upload, uploadIn, addVersion, setToken, token, ensureDir, makeLog };
