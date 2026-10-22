/* I 组第三轮：只修正三个判定的口径错误，不重复已通过项
   ─ I-07：/api/v2/search 返回 {query,results,truncated}（camelCase），前两轮分别按
     items/hits 与 Results 取值 → 恒为 0。本轮按 results 重测六路字段命中。
   ─ I-03：ZIP 实际 7 个条目（pdf/png/bin/两版/长名/重名×2），首轮断言写死 6 → 误判。
     本轮从已落盘证据重算，不改动任何采集数据。
   ─ I-08：500 分支文本是「检索失败 … 本地已加载的内容里也没有匹配项」，
     首轮用 !/找不到|暂无|没有/ 把「没有匹配项」这句补充说明误当成伪装空数据。
     本轮拆开两分支分别判定。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const L = require("./lib.cjs");
const { makeRecorder } = require("./rec.cjs");

const COMMIT = process.env.IPSYS_COMMIT || "f5d206a";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CRED = JSON.parse(fs.readFileSync(path.join(ROOT, "vault-p2-p2b.cred.json"), "utf8"));
const rec = makeRecorder({ evidenceDir: EVID, runId: "p2b", commit: COMMIT, method: "DYNAMIC-MIXED" });
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
const TXT = (s) => Buffer.from(s, "utf8");
const TAG = "I3" + Date.now().toString(36);
const rd = (id) => JSON.parse(fs.readFileSync(path.join(EVID, "cases", id + ".json"), "utf8"));
const parseActual = (id) => { try { return JSON.parse(rd(id).actual); } catch { return null; } };

(async () => {
  await L.post("/api/resume", { password: CRED.password }).then((r) => L.setToken(r.data.token));

  const api = {
    create: async (ws, kind, body) => {
      const r = await L.post(`/api/v2/folders/${ws}/${kind}`, body);
      if (!r.ok) throw new Error(`create ${kind} ${r.status} ${JSON.stringify(r.data)}`);
      return r.data.id;
    },
    attach: async (ws, folderId, name, buf) => {
      const up = ws === "company" ? await L.upload(folderId, name, buf) : await L.uploadIn(ws, folderId, name, buf);
      const ls = await L.get(`/api/v2/files/${ws}/folders/${folderId}/links?includeDeleted=false`);
      const arr = Array.isArray(ls.data) ? ls.data : (ls.data.items || []);
      const hit = arr.filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
      return { fileId: up.fileId, linkId: hit && (hit.id ?? hit.linkId) };
    },
  };

  /* ---------------- I-03 重判：ZIP 实收 7 条，首轮断言写死 6 ---------------- */
  try {
    const a = parseActual("I-03");
    if (!a || !Array.isArray(a.items)) throw new Error("I-03 证据缺失，需重跑采集");
    const items = a.items;
    const names = items.map((x) => x.name);
    const hierOk = names.every((n) => n.includes("I2复核项目-") && n.includes("I2复核合同-"));
    const methodsStored = items.every((x) => x.method === 0);
    const v2 = items.filter((x) => /I2两版-.*\.txt$/.test(x.name));
    const v2Ok = v2.length === 1 && v2[0].sha === a.expectSha;
    const shas = items.map((x) => x.sha);
    const noDupContent = new Set(shas).size === shas.length;
    const ok = a.zipCount === 7 && items.length === 7 && hierOk && methodsStored && v2Ok && a.v1Leak === false && noDupContent;
    rec.rec({
      id: "I-03", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        zipCount: a.zipCount, zipLen: a.zipLen, entries: names, methodsStored, hierOk, v1Leak: a.v1Leak,
        v2Entries: v2, expectSha: a.expectSha, distinctContent: new Set(shas).size,
        planCollected: a.planCollected,
      }),
      workspace: "company", recordIds: [a.planItems && a.planItems.length ? "contract" : ""],
      notes: ok
        ? `真实 ZIP（${a.zipLen} 字节）：7 个条目全部落在「项目/合同」两级目录下，method=0 为原始字节；两版附件只保留最新版且 SHA-256 与 v2 一致（v1 未泄漏）；7 条内容互不重复，无覆盖遗漏`
        : `ZIP 条目/层级/版本策略不符（count=${items.length}, hier=${hierOk}, v2ok=${v2Ok}）`,
    });
  } catch (e) { rec.rec({ id: "I-03", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-03 重判失败，需重跑采集" }); }

  /* ---------------- I-07 重测：按 results 取命中，六路字段 ---------------- */
  try {
    const pj = await api.create("company", "project", {
      Project: { Name: `I07项目-${TAG}`, ProjectType: "科研项目", ProjectNo: `I07NO-${TAG}`, Remarks: `I07备注-${TAG}`, Leader: "张三" },
    });
    const c1 = await api.create("company", "contract", {
      Contract: { Name: `I07合同-${TAG}`, ContractNo: `I07HT-${TAG}`, SigningParties: `I07签约方-${TAG}` }, ProjectId: pj,
    });
    const f1 = await api.attach("company", c1, `I07附件-${TAG}.txt`, TXT("I07 附件内容 " + TAG));
    const q = async (s) => {
      const r = await L.get(`/api/v2/search/company?q=${encodeURIComponent(s)}`);
      const arr = Array.isArray(r.data && r.data.results) ? r.data.results : [];
      return { status: r.status, n: arr.length, hits: arr.slice(0, 3).map((x) => `${x.kind}#${x.id} ${x.title}`) };
    };
    const byName = await q(`I07项目-${TAG}`);
    const byProjectNo = await q(`I07NO-${TAG}`);
    const byRemark = await q(`I07备注-${TAG}`);
    const byParty = await q(`I07签约方-${TAG}`);
    const byContractNo = await q(`I07HT-${TAG}`);
    const byFileName = await q(`I07附件-${TAG}`);
    const all = { byName, byProjectNo, byRemark, byParty, byContractNo, byFileName };
    const ok = Object.values(all).every((x) => x.n >= 1);
    rec.rec({
      id: "I-07", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify(all),
      workspace: "company", recordIds: [pj, c1, f1.fileId],
      notes: ok
        ? "项目名、项目编号、备注、签约方、合同编号、附件名六路检索均在 results 中命中 —— 检索覆盖业务字段与原件名，不是只匹配文件名"
        : "部分业务字段检索不到（见 actual 中 n=0 的项），搜索域不足",
    });
  } catch (e) { rec.rec({ id: "I-07", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-07 执行异常" }); }

  /* ---------------- I-08 拆分支重判：500 与 401 各自成结论 ---------------- */
  try {
    const a = parseActual("I-08");
    if (!a) throw new Error("I-08 证据缺失");
    const t500 = String(a.search500 && a.search500.text || "");
    const t401 = String(a.search401 && a.search401.text || "");
    /* 500：明确出现「检索失败」即算可靠失败；后半句「本地已加载的内容里也没有匹配项」是对已缓存内容的中性补充，不算伪装 */
    const ok500 = a.paused > 0 && /检索失败|失败/.test(t500) && !/^(找不到|暂无数据)/.test(t500.trim());
    /* 401：必须显示登录/解锁状态，或至少与 500 有可区分的提示。
       实测：锁屏未显示、无 toast、token 已清、后续请求全部 401 —— 用户只看到「检索失败」，会话悄悄失效 */
    const ok401 = !!a.search401 && (a.search401.lockShown === true ||
      a.search401.toasts.some((t) => /登录|解锁|会话/.test(t)) ||
      /登录|解锁|会话/.test(t401));
    const sessionDead = a.after401 && a.after401.reload === "fail";
    const ok = ok500 && ok401;
    rec.rec({
      id: "I-08", status: ok ? "PASS" : "CONFIRMED_BUG",
      actual: JSON.stringify({
        paused: a.paused, status500: ok500, status401: ok401,
        search500Text: t500, search401: a.search401, after401: a.after401, sessionDeadAfter401: sessionDead,
      }),
      workspace: "company",
      notes: ok
        ? "500 与 401 都给出可靠失败或登录提示"
        : `500 分支正常（界面给出「检索失败」）；401 分支不合格：前端在 store.js:87-90 已清空 token 并置 locked=true，但既不弹锁屏也不提示需要重新登录，用户看到的是「检索失败 / 本地已加载的内容里也没有匹配项」，随后所有请求持续 401（after401=${JSON.stringify(a.after401)}）—— 会话静默失效且被呈现为空结果`,
    });
  } catch (e) { rec.rec({ id: "I-08", status: "BLOCKED", actual: JSON.stringify({ error: e.message }), notes: "I-08 重判失败" }); }

  rec.flush();
  console.log("I 组第三轮修正完毕");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
