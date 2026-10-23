/* 用例记录器：从任务书 CSV 读取 priority/expected/group/steps，脚本只提供实际结果。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c === "\r") {}
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const PLAN_CSV = path.resolve(__dirname, "..", "..", "..", "docs", "IPSys_Explorer_Phase2_Agent_Test_Cases.csv");
const planRows = parseCsv(fs.readFileSync(PLAN_CSV, "utf8").replace(/^\uFEFF/, ""));
const head = planRows[0].map((x) => x.trim());
const PLAN = new Map();
for (const r of planRows.slice(1)) {
  if (!r[0] || !r[0].trim()) continue;
  const o = {};
  head.forEach((h, i) => (o[h] = r[i] || ""));
  PLAN.set(o.case_id.trim(), o);
}

function makeRecorder({ evidenceDir, runId, commit, method }) {
  const casesDir = path.join(evidenceDir, "cases");
  fs.mkdirSync(casesDir, { recursive: true });
  const resultsFile = path.join(evidenceDir, "results.json");
  // 支持分脚本增量执行：已有结果按 case_id 覆盖，不丢前一批
  let rows = [];
  if (fs.existsSync(resultsFile)) {
    try { rows = JSON.parse(fs.readFileSync(resultsFile, "utf8")); } catch { rows = []; }
  }
  function rec({ id, status, actual, workspace, recordIds, evidence, notes, priority }) {
    const plan = PLAN.get(id);
    if (!plan) throw new Error("任务书没有用例 " + id);
    const row = {
      case_id: id,
      priority: priority || plan.priority,
      group: plan.group,
      status,
      actual: actual || "",
      expected: plan.expected,
      workspace: workspace || "",
      record_ids: Array.isArray(recordIds) ? recordIds.join(" ") : (recordIds || ""),
      evidence_paths: Array.isArray(evidence) ? evidence.join(" ") : (evidence || ""),
      notes: notes || "",
      timestamp: new Date().toISOString(),
      method: method || "DYNAMIC",
      run_id: runId,
      tested_commit: commit,
    };
    const i = rows.findIndex((r) => r.case_id === id);
    if (i >= 0) rows[i] = row; else rows.push(row);
    fs.writeFileSync(path.join(casesDir, id + ".json"), JSON.stringify(row, null, 2), "utf8");
    console.log(`[${status}] ${id} ${row.notes.slice(0, 90)}`);
    return row;
  }
  function flush() {
    rows.sort((a, b) => a.case_id.localeCompare(b.case_id));
    fs.writeFileSync(resultsFile, JSON.stringify(rows, null, 2), "utf8");
    console.log(`\n已记录 ${rows.length} 条 -> ${resultsFile}`);
  }
  return { rec, flush, rows };
}

module.exports = { makeRecorder, PLAN, parseCsv };
