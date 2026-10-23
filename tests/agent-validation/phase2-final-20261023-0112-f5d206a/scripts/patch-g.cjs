/* 一次性补丁：把 run-g.cjs 里的文件节点 id 改成 f:<linkId>:<version> */
"use strict";
const fs = require("node:fs");
const file = "run-g.cjs";
let s = fs.readFileSync(file, "utf8");

s = s.split("'f:${f.fileId}'").join("'${fid}'");
s = s.split("ds.payload === `f:${f.fileId}`").join("ds.payload === fid");

const helper = [
  "  const fileNode = async (ws, fileId, linkId) => {",
  "    const d = (await L.get(`/api/v2/files/${ws}/${fileId}`)).data;",
  "    const v = Math.max(...((d && d.versions) || [{ version: 1 }]).map((x) => Number(x.version)));",
  "    return `f:${linkId}:${v}`;",
  "  };",
  "",
].join("\n");
if (!s.includes("const fileNode =")) s = s.replace("  const b = await launch(", helper + "  const b = await launch(");

s = s.replace(/(const f = await api\.attach\([^\n]*\n)/g, (m) =>
  m + '      const fid = await fileNode("company", f.fileId, f.linkId);\n');

fs.writeFileSync(file, s);
console.log("fid refs:", (s.match(/fid/g) || []).length, "fileNode:", s.includes("const fileNode"));
