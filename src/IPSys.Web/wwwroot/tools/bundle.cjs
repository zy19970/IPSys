/* 打包 IPSys 唯一正式前端，产物在编译时嵌入 EXE。
   --------------------------------------------------------------------------
   服务端通过 EmbeddedWebAssets 提供固定的前端资源路径:
     /  /index.html  /style.css  /app.js
   所以前端必须收敛成 index.html + style.css + app.js 三个文件。

   用法: node src/IPSys.Web/wwwroot/tools/bundle.cjs */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "dist");

/* bridge 是前端交互与同目录能力模块的接口适配，不引入额外业务状态。
   excel 负责 V2 台账，二者先于 interactions 加载。 */
const ORDER = ["js/icons.js", "js/data.js", "js/store.js", "js/app.js", "js/forms.js", "js/bridge.js", "js/excel.js", "js/interactions.js"];

fs.mkdirSync(OUT, { recursive: true });

const parts = ORDER.map((rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return `\n/* ===== ${rel} ===== */\n${src}`;
});

const header = `/* 资料库前端 — 由 tools/bundle.cjs 生成,请勿直接编辑。
   源文件: ${ORDER.join(" → ")} */\n`;

fs.writeFileSync(path.join(OUT, "app.js"), header + parts.join("\n"), "utf8");
fs.writeFileSync(path.join(OUT, "style.css"), fs.readFileSync(path.join(ROOT, "css/app.css"), "utf8"), "utf8");
fs.writeFileSync(path.join(OUT, "index.html"), fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), "utf8");

const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1) + " KB";
console.log(`bundle → ${OUT}`);
for (const f of ["index.html", "style.css", "app.js"]) console.log(`  ${f.padEnd(12)} ${size(f)}`);
