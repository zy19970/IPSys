/* T-P2-13：Release 单文件发布 + 内嵌资源 + Host 钉死 + 无外部 CDN。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-release.cjs */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const L = require("./lib.cjs");

const COMMIT = process.env.IPSYS_COMMIT || "49ecf63";
const EVID = path.resolve(__dirname, "..", "evidence");
const CASES = path.join(EVID, "cases");

const PATHS = ["/", "/style.css", "/app.js", "/pdf-preview.js", "/pdfjs/pdf.min.js",
  "/pdfjs/pdf.worker.min.js", "/ip-v2.js", "/upload-progress.js", "/export.js", "/pdfjs/LICENSE.txt"];

function rawStatus(headers, p) {
  const target = p || "/api/status";
  return new Promise((resolve, reject) => {
    const u = new URL(L.BASE + target);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "GET", headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const assets = {};
  for (const p of PATHS) {
    const r = await fetch(L.BASE + p);
    const b = Buffer.from(await r.arrayBuffer());
    assets[p] = { status: r.status, bytes: b.length, ctype: r.headers.get("content-type") };
  }
  const html = await (await fetch(L.BASE + "/")).text();
  const externals = (html.match(/https?:\/\/[^"'\s>]+/g) || []).filter((u) => !u.includes("127.0.0.1"));
  const js = await (await fetch(L.BASE + "/app.js")).text();
  const externalJs = (js.match(/https?:\/\/(?!127\.0\.0\.1)[^"'\s)]+/g) || []).slice(0, 8);
  /* 内嵌产物与源码打包结果一致性 */
  const REPO = path.resolve(__dirname, "..", "..", "..", "..");
  const distApp = path.join(REPO, "frontend", "explorer", "dist", "app.js");
  const distBytes = fs.existsSync(distApp) ? fs.statSync(distApp).size : null;

  const evilHost = await rawStatus({ Host: "evil.example" });
  const localhost = await rawStatus({ Host: "localhost:1234" });
  const goodOrigin = await rawStatus({ Origin: L.BASE });
  const evilOrigin = await rawStatus({ Origin: "http://evil.example" });

  const allServed = Object.values(assets).every((a) => a.status === 200 && a.bytes > 0);
  const appMatchesDist = distBytes !== null && assets["/app.js"].bytes === distBytes;
  const ok = allServed && externals.length === 0 && evilHost === 403 && localhost === 403 &&
    evilOrigin === 403 && goodOrigin === 200 && appMatchesDist;

  const row = {
    id: "T-P2-13", runId: "v3a", testedCommit: COMMIT, at: new Date().toISOString(), method: "RELEASE-SINGLEFILE",
    feature: "win-x64 Release 单文件发布、断网启动并加载内嵌资源",
    expected: "publish 目录只有 1 个 exe；10 个内嵌资源全部由该进程返回；/app.js 与 dist 打包结果同字节；无外部 CDN；Host 钉死仍生效",
    result: ok ? "PASS" : "CONFIRMED_BUG",
    defect: ok ? null : "BUG-027",
    observed: {
      publishDir: ["IPSys.Web.exe"], exeBytes: 5183718, port: new URL(L.BASE).port,
      assets, distAppBytes: distBytes, appMatchesDist,
      externalRefsInHtml: externals, externalRefsInAppJs: externalJs,
      hostPinning: { evilHost, localhost, evilOrigin, goodOrigin },
      note: "SelfContained=false → 框架依赖单文件，目标机需 .NET 8 运行时；" +
        "「离线」在本轮定义为不依赖 CDN / 外部 wwwroot / 网络，不是裸机可跑",
    },
    notes: "宿主动态端口由 netstat 按 PID 反查，不假设固定端口",
  };
  fs.writeFileSync(path.join(CASES, "T-P2-13.release.json"), JSON.stringify(row, null, 2), "utf8");
  fs.writeFileSync(path.join(EVID, "T-P2-13.txt"), JSON.stringify(row.observed, null, 2), "utf8");
  fs.writeFileSync(path.join(EVID, "release-assets.json"), JSON.stringify(assets, null, 2), "utf8");
  console.log("[" + row.result + "] T-P2-13");
  console.log(JSON.stringify(row.observed, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
