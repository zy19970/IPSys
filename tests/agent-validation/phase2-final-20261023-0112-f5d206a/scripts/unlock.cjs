/* 关闭当前已打开的测试库：用 cred 文件里的口令 resume 拿 token，再 /api/lock */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");

const credPath = process.argv[2];
if (!credPath) throw new Error("用法: node unlock.cjs <cred.json>");
const cred = JSON.parse(fs.readFileSync(credPath, "utf8"));

(async () => {
  const r = await L.post("/api/resume", { password: cred.password });
  if (!r.ok) throw new Error("resume failed: " + r.status + " " + JSON.stringify(r.data));
  L.setToken(r.data.token);
  const lock = await L.post("/api/lock", {});
  console.log("lock ->", lock.status, JSON.stringify(lock.data));
  const s = await L.get("/api/status");
  console.log("status ->", JSON.stringify(s.data));
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
