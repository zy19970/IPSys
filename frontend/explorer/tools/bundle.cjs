/* 生成可部署到真实服务端的静态产物。
   --------------------------------------------------------------------------
   原服务端把页面作为程序集资源(EmbeddedWebAssets),只暴露固定的 11 个路径:
     /  /index.html  /style.css  /app.js
   所以前端必须收敛成 index.html + style.css + app.js 三个文件。

   用法: node tools/bundle.cjs */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "dist");

/* bridge 是本壳与 wwwroot 能力层之间的适配:它只做形状转换,不引业务逻辑。
   excel 是唯一从旧壳移植的业务代码(/api/v2/excel/* 全在旧 app.js 里)。
   两者都放在 interactions 之前,保证交互层运行时已就位。 */
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
