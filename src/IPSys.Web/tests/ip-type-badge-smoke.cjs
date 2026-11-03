/* 知识产权、项目业务类型固定分类色，与名称字体尺寸一致。 */
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
// Extract the actual method boundary; surrounding navigation comments may change.
const cellEnd = app.indexOf("\n  },", cellStart);
assert.ok(cellStart >= 0 && cellEnd > cellStart, "cellHtml method boundary must exist");
const fn = vm.runInContext("({" + app.slice(cellStart, cellEnd + 5) + "}).cellHtml", context);
const call = (v, f) => fn.call({cellValue: () => v}, {name: v}, {k:"typeName",f}, false);
types.forEach(type => {
  const html = call(type, "ip-type");
  assert.ok(html.includes("pill ip-type " + badgeTone(type)), "Wrong class: " + type);
  assert.ok(html.includes(type) && html.includes('title="' + type + '"'));
});
const projectTone = value => vm.runInContext("projectTypeTone(" + JSON.stringify(value) + ")", context);
const projectTypes = ["科研项目", "横向项目", "其他项目"];
const projectClasses = projectTypes.map(projectTone);
assert.deepEqual(projectClasses, ["research", "horizontal", "other"]);
assert.equal(projectTone("未知项目类型"), "neutral");
assert.match(app, /\{ k: "typeName", t: "项目类型", w: "92px", f: "project-type" \}/);
const projectRule = css.match(/\.pill\.project-type\s*\{([^}]+)\}/);
assert.ok(projectRule, "Project type badge must have dedicated CSS");
assert.equal(font(projectRule[1]), font(nameRule[1]),
  "Project badge must match the project name font");
assert.match(projectRule[1], /height:\s*24px/);
assert.match(projectRule[1], /line-height:\s*24px/);
assert.match(projectRule[1], /font-weight:\s*400/);
const projectSwatches = projectTypes.map(type => {
  const tone = projectTone(type);
  const rule = css.match(new RegExp("\\.pill\\.project-type\\." + tone + "\\s*\\{([^}]+)\\}"));
  assert.ok(rule, "Project palette missing " + type);
  const bg = rule[1].match(/background:\s*(#[a-f\d]{6})/i)?.[1];
  const fg = rule[1].match(/color:\s*(#[a-f\d]{6})/i)?.[1];
  assert.ok(bg && fg, "Project background and text colors required");
  return bg + "/" + fg;
});
assert.equal(new Set(projectSwatches).size, projectTypes.length);
projectTypes.forEach(type => {
  const html = call(type, "project-type");
  assert.ok(html.includes("pill project-type " + projectTone(type)), "Wrong project color: " + type);
  assert.ok(html.includes('title="' + type + '"'), "Missing original project type");
});
assert.match(call("未知项目类型", "project-type"), /pill project-type neutral/);
assert.match(call("<类型>", "project-type"), /&lt;类型&gt;/);
assert.doesNotMatch(call("<类型>", "project-type"), /<类型>/);
assert.match(css, /\.row\.is-project-ledger \.cell,\s*\.row\.is-project-ledger \.mono\s*\{\s*font-size:\s*13\.5px/);
assert.match(app, /cols === LEDGER_COLS\.project \? " is-project-ledger"/);
assert.match(call("普通标签", "tag"), /class="pill tag"/);
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

console.log("TYPE BADGE SMOKE PASS: IP 10 tones, project 3 tones, consistent project row font sizes");
