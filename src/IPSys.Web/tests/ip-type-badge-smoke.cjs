/* 知识产权类型十色标签:字号与名称一致,不改变项目类型或状态。 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../wwwroot");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/app.css"), "utf8");
const forms = fs.readFileSync(path.join(root, "js/forms.js"), "utf8");

const formTypes = forms.match(/const IP_TYPES = (\{[\s\S]*?\n\});/);
assert.ok(formTypes, "IP_TYPES form whitelist must exist");
const types = Object.keys(vm.runInNewContext("(" + formTypes[1] + ")"));
assert.equal(types.length, 10, "Keep all ten knowledge-property business types");

const start = app.indexOf("const IP_TYPE_TONES = Object.freeze({");
const end = app.indexOf("/* 状态 → 颜色。先判负向", start);
assert.ok(start >= 0 && end > start, "Dedicated IP type palette must exist");
const context = vm.createContext({
  esc: value => String(value).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]),
  fmtSize: () => "0 B"
});
vm.runInContext(app.slice(start, end), context);
const statusStart = app.indexOf("function statusTone(v) {", end);
const statusEnd = app.indexOf("/* 金额千分位", statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart, "Original status classifier must exist");
vm.runInContext(app.slice(statusStart, statusEnd), context);
const colorOf = value => vm.runInContext("statusTone(" + JSON.stringify(value) + ")", context);
assert.equal(colorOf("已登记"), "green");
assert.equal(colorOf("准备中"), "blue");
assert.equal(colorOf("已失效"), "red");
assert.equal(colorOf("未知状态"), "gray");
const badgeTone = value => vm.runInContext("ipTypeTone(" + JSON.stringify(value) + ")", context);
const tones = types.map(badgeTone);
assert.equal(new Set(tones).size, 10, "Each IP type needs a distinct color class");
assert.ok(tones.every(t => /^[a-z-]+$/.test(t) && t !== "neutral"));
assert.equal(badgeTone("尚未定义的类型"), "neutral", "Unknown values stay neutral");

const nameRule = css.match(/\.row-title\s*\{([^}]+)\}/);
const badgeRule = css.match(/\.pill\.ip-type\s*\{([^}]+)\}/);
assert.ok(nameRule && badgeRule);
const font = rule => rule.match(/font-size:\s*([\d.]+px)/)?.[1];
assert.equal(font(nameRule[1]), "13.5px");
assert.equal(font(badgeRule[1]), font(nameRule[1]), "IP type font must match folder-name font");
assert.match(badgeRule[1], /height:\s*24px/);
assert.match(app, /\{ k: "typeName", t: "类型", w: "148px", f: "ip-type" \}/,
  "Long names need a readable dedicated IP column");

const swatches = types.map(type => {
  const tone = badgeTone(type);
  const rule = css.match(new RegExp("\\.pill\\.ip-type\\." + tone + "\\s*\\{([^}]+)\\}"));
  assert.ok(rule, "Missing CSS palette for " + type);
  const bg = rule[1].match(/background:\s*(#[a-f\d]{6})/i)?.[1];
  const fg = rule[1].match(/color:\s*(#[a-f\d]{6})/i)?.[1];
  assert.ok(bg && fg, "Each type must have foreground and background");
  return bg + "/" + fg;
});
assert.equal(new Set(swatches).size, 10, "Palette colors cannot all be the same");
assert.match(css, /\.pill\.ip-type\.neutral\s*\{/);

const cellStart = app.indexOf("  cellHtml(it, c, first) {");
const cellEnd = app.indexOf("  /* 导航只重置", cellStart);
assert.ok(cellStart >= 0 && cellEnd > cellStart);
const fn = vm.runInContext("({" + app.slice(cellStart, cellEnd) + "}).cellHtml", context);
const call = (v, f) => fn.call({cellValue: () => v}, {name: v}, {k:"typeName",f}, false);
types.forEach(type => {
  const html = call(type, "ip-type");
  assert.ok(html.includes("pill ip-type " + badgeTone(type)), "Wrong class: " + type);
  assert.ok(html.includes(type) && html.includes('title="' + type + '"'));
});
assert.match(call("科研项目", "tag"), /class="pill tag"/, "Project badges stay neutral");
const statusRule = css.match(/\.pill\.status\s*\{([^}]+)\}/);
assert.ok(statusRule, "Status badges need dedicated readable typography");
assert.equal(font(statusRule[1]), font(nameRule[1]), "Status font must match both folder name and IP type");
assert.equal(font(statusRule[1]), font(badgeRule[1]), "All IP table badge text should have the same size");
assert.match(statusRule[1], /height:\s*24px/, "Status badge should fit the larger font");
assert.match(call("已登记", "pill"), /class="pill status green"/, "Registered status stays green");
assert.match(call("准备中", "pill"), /class="pill status blue"/, "In-progress status stays blue");
assert.match(call("已失效", "pill"), /class="pill status red"/, "Invalid status stays red");
assert.match(call("未知状态", "pill"), /class="pill status gray"/, "Unknown status stays gray");
assert.match(call("<state>", "pill"), /&lt;state&gt;/, "Status text remains escaped");
assert.doesNotMatch(css.match(/\.pill\.tag\s*\{([^}]+)\}/)?.[1] || "", /font-size:\s*13\.5px/,
  "Project type label styling must not be broadened by accident");
assert.match(call("<sample>", "ip-type"), /&lt;sample&gt;/, "Untrusted type values remain escaped");
assert.doesNotMatch(call("<sample>", "ip-type"), /<sample>/);

console.log("IP TYPE BADGE SMOKE PASS: 10 tones, status + type at folder font size, semantic colors, safe fallback");
