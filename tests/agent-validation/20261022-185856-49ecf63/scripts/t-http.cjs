/* HTTP 层真实用例（V3）。只用隔离库；破坏性用例全部建临时对象，不动主 fixture。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-http.cjs <runid> */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v3a";
const COMMIT = process.env.IPSYS_COMMIT || "49ecf63";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const CASES = path.join(EVID, "cases");
const TMP = path.resolve(ROOT, "..", "..", "..", "build-retest", "agent-validation-v3");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));
const log = L.makeLog(path.join(EVID, "http-run.log"));

/* 7 个系统目录的固定名称：/api/v2/ui/archive/company 的 folders 还包含用户自建目录，
   所以只能用"这 7 个名字都在"来判定，不能拿总数等于 7。 */
const SYS_NAMES = ["申报与认定", "规划与管理", "汇报与宣传", "会议与活动", "专项工作与合作", "政策与行业资料", "其他业务资料"];
/* reorder 的 Kind 词表只有 folder / record，与 ref.kind 的 archive_folder / archive 不是一套 */
const KIND = (refKind) => (refKind === "archive_folder" ? "folder" : "record");

const results = [];
const nowISO = () => new Date().toISOString();
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function rec(o) {
  const row = Object.assign({ runId: RUNID, testedCommit: COMMIT, at: nowISO() }, o);
  results.push(row);
  fs.writeFileSync(path.join(CASES, (o.id || "unknown") + ".json"), JSON.stringify(row, null, 2), "utf8");
  fs.writeFileSync(
    path.join(EVID, (o.id || "unknown") + "-http.txt"),
    [`# ${o.id} ${o.feature || ""}`, `结果: ${o.result}`, `预期: ${o.expected}`, `实际: ${JSON.stringify(o.observed, null, 2)}`,
     o.defect ? `缺陷: ${o.defect}` : "", o.notes ? `备注: ${o.notes}` : ""].filter(Boolean).join("\n") + "\n",
    "utf8");
  log.add(`[${o.result}] ${o.id} ${o.feature || ""}${o.defect ? " -> " + o.defect : ""}`);
  return row;
}

async function caseRun(id, feature, expected, fn) {
  const steps = [];
  const put = (s) => { steps.push(s); log.add("    " + s); };
  try {
    const r = await fn(put);
    return rec(Object.assign({ id, feature, expected, steps, result: r.result || "PASS", observed: r.observed, defect: r.defect, notes: r.notes }, {}));
  } catch (e) {
    return rec({ id, feature, expected, steps, result: "TEST_ERROR", observed: { error: String(e && e.stack || e) }, notes: "测试器异常，未形成产品结论" });
  }
}

/* 建临时 IP 记录并上传带两版本的附件（破坏性用例专用，不碰主 fixture） */
let scratchSeq = 0;
async function mkScratchIp(name) {
  scratchSeq++;
  const r = await L.post("/api/v2/folders/company/ip",
    { Ip: { Name: `${name}-${scratchSeq}`, IpType: "实用新型专利", Status: "已申请", ApplicationNo: `SZ-${scratchSeq}` } });
  if (!r.ok) throw new Error("scratch ip " + r.status + JSON.stringify(r.data));
  const ipId = r.data.id;
  const buf = Buffer.from(`scratch ${name} v1 ${Date.now()}`, "utf8");
  const up = await L.upload(ipId, `${name}.txt`, buf);
  const linkId = await linkIdOf(ipId, up.fileId);
  const v2 = await L.addVersion("company", up.fileId, `${name}.txt`, Buffer.from(`scratch ${name} v2 内容略长`, "utf8"));
  return { ipId, fileId: up.fileId, linkId, v1: up, v2, sha: sha(buf) };
}
async function linkIdOf(folderId, fileId) {
  const r = await L.get(`/api/v2/files/company/folders/${folderId}/links?includeDeleted=false`);
  const arr = Array.isArray(r.data) ? r.data : (r.data.items || []);
  const hit = arr.filter((x) => Number(x.fileId) === Number(fileId)).pop();
  if (!hit) throw new Error("no link for file " + fileId + " in " + folderId);
  return hit.id ?? hit.linkId;
}

/* Host/Origin 注入必须走 node:http —— undici 会覆盖 Host */
const rawStatus = (headers, p = "/api/status") => new Promise((resolve, reject) => {
  const u = new URL(L.BASE + p);
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET", headers }, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8").slice(0, 200) }));
  });
  req.on("error", reject);
  req.setTimeout(8000, () => req.destroy(new Error("timeout")));
  req.end();
});

(async () => {
  const c = await L.connect(cred.db, cred.password);
  log.add(`connect via ${c.via}，BASE=${L.BASE}，RUNID=${RUNID}`);
  log.add(`fixture: 二级=${fx.archive.lvl2} 三级=${fx.archive.lvl3} 项目A=${fx.company.projectA} 合同C1=${fx.company.contractC1} 合同C2=${fx.company.contractC2} IP-A=${fx.company.ipA} IP-B=${fx.company.ipB} IP-C=${fx.company.ipC}`);

  /* ============ T-P0-01 三级业务档案目录 ============ */
  await caseRun("T-P0-01", "三级业务档案目录可达性", "每个合法层级可读；记录只出现在其真实父级；parentId 链完整", async (put) => {
    const ar = (await L.get("/api/v2/ui/archive/company")).data;
    const dirs = ar.folders || [];
    put(`GET /api/v2/ui/archive/company -> 系统目录 ${dirs.length} 个`);
    const byId = new Map(dirs.map((d) => [Number(d.id), d]));

    /* 逐级读 entries，确认三级链路 */
    const sys1 = fx.archive.system[0].id;
    const e1 = (await L.get(`/api/v2/folders/company/entries?section=achievement&parentId=${sys1}`)).data || [];
    const e2 = (await L.get(`/api/v2/folders/company/entries?section=achievement&parentId=${fx.archive.lvl2}`)).data || [];
    const e3 = (await L.get(`/api/v2/folders/company/entries?section=achievement&parentId=${fx.archive.lvl3}`)).data || [];
    const refOf = (e) => Number(e.folder?.ref?.id ?? e.folder?.id);
    put(`entries(sys=${sys1}) -> ${e1.length} 条: ${e1.map(refOf).join(",")}`);
    put(`entries(二级=${fx.archive.lvl2}) -> ${e2.length} 条: ${e2.map(refOf).join(",")}`);
    put(`entries(三级=${fx.archive.lvl3}) -> ${e3.length} 条: ${e3.map(refOf).join(",")}`);

    const lvl2InSys1 = e1.some((e) => refOf(e) === Number(fx.archive.lvl2));
    const lvl3InLvl2 = e2.some((e) => refOf(e) === Number(fx.archive.lvl3));
    const recInLvl3 = e3.some((e) => refOf(e) === Number(fx.archive.records[0]));
    /* 档案-01 只应出现在三级下，不应出现在一级 */
    const recLeakedToSys1 = e1.some((e) => refOf(e) === Number(fx.archive.records[0]));
    const archives = ar.archives || [];
    const r1 = archives.find((x) => Number(x.id) === Number(fx.archive.records[0]));
    put(`档案-01 的 folderId = ${r1 && r1.folderId}（期望 ${fx.archive.lvl3}）`);

    const observed = {
      allArchiveFolders: dirs.length,
      systemNamesPresent: SYS_NAMES.filter((n) => dirs.some((d) => d.name === n)).length,
      lvl2InSys1, lvl3InLvl2, recInLvl3, recLeakedToSys1,
      record01FolderId: r1 && r1.folderId, entriesSizes: [e1.length, e2.length, e3.length],
    };
    const ok = observed.systemNamesPresent === 7 && lvl2InSys1 && lvl3InLvl2 && recInLvl3 && !recLeakedToSys1;
    return { result: ok ? "PASS" : "CONFIRMED_BUG", observed, defect: ok ? null : "BUG-001",
      notes: "HTTP 层三级链路完整；UI 树是否丢节点另由 t-tree.cjs 裁决（buildTree 是纯函数，可确定性复现）" };
  });

  /* ============ T-P0-02 同 LinkId 多版本显示 ============ */
  await caseRun("T-P0-02", "同一 LinkId 多版本只显示一条逻辑附件", "同一 linkId 只占一行，默认最新版；不同 linkId 分别展示", async (put) => {
    const ip = (await L.get("/api/v2/ui/ip/company")).data || {};
    const files = ip.files || [];
    put(`GET /api/v2/ui/ip/company -> files ${files.length} 条`);
    const mine = files.filter((f) => Number(f.fileId) === Number(fx.files.ipA.fileId));
    put(`fileId=${fx.files.ipA.fileId} 的记录: ${JSON.stringify(mine)}`);
    const links = new Set(mine.map((f) => Number(f.linkId)));
    put(`涉及 linkId: ${[...links].join(",")}（IP-A 侧 ${fx.files.ipA.linkId}，IP-B 侧 ${fx.files.ipAssoc.linkIdOnIpB}）`);

    /* 关键口径：接口是"一 link 一行"还是"一版本一行" */
    const perLink = {};
    for (const f of mine) perLink[f.linkId] = (perLink[f.linkId] || 0) + 1;
    const dupLink = Object.entries(perLink).filter(([, n]) => n > 1);

    /* 版本清单单独取 */
    const vers = await L.get(`/api/v2/files/company/${fx.files.ipA.fileId}/versions`);
    put(`GET versions -> ${vers.status} ${JSON.stringify(vers.data).slice(0, 300)}`);

    const observed = {
      rowsForFile: mine.length, distinctLinks: links.size, rowsPerLink: perLink,
      duplicatedLinkRows: dupLink, versionsStatus: vers.status,
      versionsCount: Array.isArray(vers.data) ? vers.data.length : (vers.data?.items || []).length,
    };
    /* 期望：每个 linkId 恰好 1 行；两个 linkId → 2 行 */
    const ok = dupLink.length === 0 && mine.length === links.size && links.size === 2;
    return {
      result: ok ? "PASS" : "CONFIRMED_BUG", observed, defect: ok ? null : "BUG-002",
      notes: "本轮 fixture 的 IP-A 附件 v1/v2 共用 fileId=3/linkId=3，associate 到 IP-B 生成 linkId=4",
    };
  });

  /* ============ T-P0-03 重复删除与局部失败 ============ */
  await caseRun("T-P0-03", "同一 LinkId 不重复解除；局部失败有明细", "同 linkId 只操作一次；失败项不影响已成功项；界面/服务端一致", async (put) => {
    const s = await mkScratchIp("T-P0-03");
    put(`临时 IP=${s.ipId} fileId=${s.fileId} linkId=${s.linkId}（v1+v2）`);
    const d1 = await L.del(`/api/v2/files/company/${s.fileId}/links/${s.linkId}`);
    put(`第 1 次 DELETE -> ${d1.status} ${JSON.stringify(d1.data).slice(0, 160)}`);
    const d2 = await L.del(`/api/v2/files/company/${s.fileId}/links/${s.linkId}`);
    put(`第 2 次 DELETE（同 linkId）-> ${d2.status} ${JSON.stringify(d2.data).slice(0, 160)}`);

    /* 服务端最终状态 */
    const after = await L.get(`/api/v2/files/company/folders/${s.ipId}/links?includeDeleted=false`);
    const arr = Array.isArray(after.data) ? after.data : [];
    put(`删除后该目录存活 link 数 = ${arr.length}`);

    const observed = {
      firstStatus: d1.status, secondStatus: d2.status, secondBody: d2.data,
      liveLinksAfter: arr.length,
      secondIsIdempotent: d2.status === 200,
      secondRejected: d2.status === 409 || d2.status === 404,
    };
    /* 后端对重复解除的正确形状是 409「关联已解除。」；第二次仍 200 也不算错，
       真正的产品判据在 UI 层：是否对同一 link 发两次请求。这里只记录 HTTP 语义。 */
    const ok = d1.status === 200 && arr.length === 0 && d2.status !== 500;
    return {
      result: ok ? "PASS" : "CONFIRMED_BUG", observed, defect: ok ? null : "BUG-003",
      notes: "HTTP 语义层通过；「是否重复发请求」由浏览器用例 T-P2-05 裁决",
    };
  });

  /* ============ T-P0-04 任务占用时关库 ============ */
  await caseRun("T-P0-04", "有活动任务时关库", "服务端拒绝时给出准确原因且不清会话；成功后确实已锁", async (put) => {
    /* 用真实的重压缩任务制造活动窗口：reusableBytes>0 已具备 */
    const info = (await L.get("/api/vault/compact/info")).data;
    put(`compact/info -> reusableBytes=${info.reusableBytes} canCompact=${info.canCompact}`);
    const cp = await L.post("/api/vault/compact", { confirm: true });
    put(`POST /api/vault/compact -> ${cp.status} ${JSON.stringify(cp.data)}`);

    /* 立刻尝试关库，抓服务端在任务窗口内的真实反应 */
    const lock = await L.post("/api/lock", {});
    put(`任务窗口内 POST /api/lock -> ${lock.status} ${JSON.stringify(lock.data).slice(0, 300)}`);

    let taskStates = [];
    if (cp.ok && cp.data?.taskId) {
      for (let i = 0; i < 25; i++) {
        const t = await L.get(`/api/vault/compact/task`);
        const st = t.data?.state;
        if (st && taskStates[taskStates.length - 1] !== st) taskStates.push(st);
        if (["succeeded", "failed", "canceled"].includes(st)) break;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    put(`压缩任务状态轨迹: ${taskStates.join(" -> ")}`);
    const st = await L.get("/api/status");
    put(`关库尝试后 GET /api/status -> ${st.status} ${JSON.stringify(st.data).slice(0, 200)}`);

    const observed = {
      compactInfo: info, compactSubmit: { status: cp.status, body: cp.data },
      lockDuringTask: { status: lock.status, body: lock.data },
      taskStates, statusAfter: st.data,
      stillUnlocked: !!(st.data && (st.data.unlocked === true || st.data.opened === true)),
    };
    /* 判定：若 lock 返回 409/423 且 /api/status 仍 unlocked → 拒绝关库且会话保留 = PASS；
       若 lock 200 且 status 已锁 → 也 PASS（成功关库，但需证明服务端真锁）。 */
    const rejected = (lock.status === 409 || lock.status === 423) && observed.stillUnlocked;
    const accepted = lock.status === 200 && !observed.stillUnlocked;
    return {
      result: rejected || accepted ? "PASS" : "CONFIRMED_BUG", observed,
      defect: rejected || accepted ? null : "BUG-004",
      notes: rejected ? "服务端拒绝关库且会话保留" : accepted ? "关库成功且服务端确实已锁" : "锁状态与响应不一致",
    };
  });

  /* 关库会踢掉 token，后面要 resume 回来 */
  const re = await L.connect(cred.db, cred.password);
  log.add(`重新连接 via ${re.via}`);

  /* ============ T-P0-05 跨记录共享引用 ============ */
  await caseRun("T-P0-05", "跨记录共享引用互不影响", "同一 fileId 两个 linkId 各自独立可读；删一处另一处仍能取到最新版", async (put) => {
    const fA = fx.files.ipA, fB = fx.files.ipAssoc;
    put(`IP-A linkId=${fA.linkId} / IP-B linkId=${fB.linkIdOnIpB}，都指向 fileId=${fA.fileId}`);
    const distinct = Number(fA.linkId) !== Number(fB.linkIdOnIpB);
    put(`两个 linkId 不同: ${distinct}`);

    const dlA = await L.get(`/api/v2/ip/company/${fx.company.ipA}/files/${fA.fileId}/versions/2/download`, { raw: true });
    const bufA = Buffer.from(await dlA.arrayBuffer());
    const dlB = await L.get(`/api/v2/ip/company/${fx.company.ipB}/files/${fA.fileId}/versions/2/download`, { raw: true });
    const bufB = Buffer.from(await dlB.arrayBuffer());
    put(`IP-A v2 下载 ${dlA.status} ${bufA.length}B；IP-B v2 下载 ${dlB.status} ${bufB.length}B`);
    put(`两侧 sha256 ${sha(bufA).slice(0, 16)} / ${sha(bufB).slice(0, 16)}`);

    /* 前端是否有入口：查 UI payload 是否带可用的 target 列表 */
    const ipUi = (await L.get("/api/v2/ui/ip/company")).data || {};
    const hasAssocHint = JSON.stringify(ipUi).includes("linkId");
    put(`IP UI payload 含 linkId 字段: ${hasAssocHint}`);

    const observed = {
      distinctLinks: distinct, dlA: { status: dlA.status, bytes: bufA.length, sha256: sha(bufA) },
      dlB: { status: dlB.status, bytes: bufB.length, sha256: sha(bufB) },
      sameBytes: sha(bufA) === sha(bufB),
    };
    const ok = distinct && dlA.status === 200 && dlB.status === 200 && observed.sameBytes;
    return { result: ok ? "PASS" : "CONFIRMED_BUG", observed, defect: ok ? null : "BUG-005" };
  });

  /* ============ T-P1-02② 单独删除合同 ============ */
  await caseRun("T-P1-02", "合同单删的回收站与恢复（子场景②）", "单删合同后合同独立出现在回收站；恢复后回到原项目；与项目级联是两件事", async (put) => {
    const trashBefore = (await L.get("/api/trash/company")).data || [];
    const c1InTrash = trashBefore.find((x) => x.kind === "contract" && Number(x.id) === Number(fx.company.contractC1));
    put(`回收站里 合同C1(${fx.company.contractC1}) -> ${JSON.stringify(c1InTrash)}`);

    /* 单独删 C2（父项目 A 仍存活） */
    const d = await L.del(`/api/v2/folders/company/contract/${fx.company.contractC2}`);
    put(`DELETE 合同C2(${fx.company.contractC2}) -> ${d.status} ${JSON.stringify(d.data).slice(0, 200)}`);
    const trashAfter = (await L.get("/api/trash/company")).data || [];
    const c2InTrash = trashAfter.find((x) => x.kind === "contract" && Number(x.id) === Number(fx.company.contractC2));
    put(`删除后回收站里的 合同C2 -> ${JSON.stringify(c2InTrash)}`);

    /* 项目 A 不应因合同单删而消失 */
    const proj = (await L.get("/api/v2/ui/projects/company")).data || [];
    const pAAlive = (Array.isArray(proj) ? proj : []).some((p) => Number(p.id) === Number(fx.company.projectA));
    put(`项目A 仍在 projects 列表: ${pAAlive}`);

    /* 恢复 */
    const rest = await L.post("/api/trash/company/restore",
      { items: [{ kind: "contract", id: fx.company.contractC2, section: "" }] });
    put(`restore -> ${rest.status} ${JSON.stringify(rest.data).slice(0, 200)}`);
    const cons = (await L.get("/api/v2/ui/contracts/company")).data || [];
    const c2Back = (Array.isArray(cons) ? cons : []).find((x) => Number(x.id) === Number(fx.company.contractC2));
    put(`恢复后合同C2 回读 -> ${JSON.stringify(c2Back)}`);

    const observed = {
      c1IndependentlyInTrash: !!c1InTrash, c1ParentField: c1InTrash && c1InTrash.parent,
      deleteStatus: d.status, c2InTrash: !!c2InTrash, c2ParentField: c2InTrash && c2InTrash.parent,
      projectAStillAlive: pAAlive, restoreStatus: rest.status,
      c2BackProjectId: c2Back && c2Back.projectId, expectProject: fx.company.projectA,
    };
    const ok = !!c1InTrash && !!c2InTrash && d.status === 200 && pAAlive &&
      rest.status === 200 && c2Back && Number(c2Back.projectId) === Number(fx.company.projectA);
    return { result: ok ? "PASS" : "CONFIRMED_BUG", observed, defect: ok ? null : "BUG-007",
      notes: "子场景①（项目级联）上轮已 PASS，本轮不重复计入本行" };
  });

  /* ============ T-P1-04 目录 CRUD 与保护 ============ */
  await caseRun("T-P1-04", "档案目录新建/改名/移动/删除与保护规则", "系统目录与非空目录必须被后端拒绝；新建/改名/移动合法时成功", async (put) => {
    const sys1 = fx.archive.system[0].id;
    const e1 = await L.del(`/api/v2/folders/company/archive_folder/${sys1}`);
    put(`删系统目录 ${sys1} -> ${e1.status} ${JSON.stringify(e1.data).slice(0, 160)}`);
    const e2 = await L.del(`/api/v2/folders/company/archive_folder/${fx.archive.lvl2}`);
    put(`删非空目录 二级-A(${fx.archive.lvl2}) -> ${e2.status} ${JSON.stringify(e2.data).slice(0, 160)}`);

    /* 新建空目录 → 改名 → 移动 → 删除。名字带时间戳，避免重跑撞名 409 */
    const uniq = "T104-" + Date.now().toString(36);
    const mk = await L.post("/api/v2/folders/company/archive_folder",
      { ArchiveFolder: { Name: uniq, ParentId: sys1 }, Section: "achievement" });
    const tmpId = mk.data && mk.data.id;
    put(`新建目录 ${uniq} -> ${mk.status} id=${tmpId}`);
    if (!tmpId) throw new Error("新建目录失败，无法继续：" + mk.status + " " + JSON.stringify(mk.data));
    const rn = await L.put(`/api/v2/folders/company/archive_folder/${tmpId}`,
      { ArchiveFolder: { Name: uniq + "-已改名", ParentId: sys1 }, Section: "achievement" });
    put(`改名 -> ${rn.status} ${JSON.stringify(rn.data).slice(0, 160)}`);
    const mv = await L.post(`/api/v2/folders/company/archive_folder/${tmpId}/move`, { ParentId: fx.archive.lvl2 });
    put(`移动 -> ${mv.status} ${JSON.stringify(mv.data).slice(0, 160)}`);
    /* 成环：把 二级-A 移到它自己的子级（刚移进去的 tmpId）下 */
    const cyc = await L.post(`/api/v2/folders/company/archive_folder/${fx.archive.lvl2}/move`, { ParentId: tmpId });
    put(`成环移动 -> ${cyc.status} ${JSON.stringify(cyc.data).slice(0, 160)}`);
    const rm = await L.del(`/api/v2/folders/company/archive_folder/${tmpId}`);
    put(`删空目录 -> ${rm.status}`);
    const gone = await L.get(`/api/v2/folders/company/archive_folder/${tmpId}`);
    put(`删后回读 -> ${gone.status}`);

    const observed = {
      deleteSystemRoot: { status: e1.status, body: e1.data },
      deleteNonEmpty: { status: e2.status, body: e2.data },
      create: mk.status, rename: rn.status, move: mv.status, cycle: cyc.status,
      remove: rm.status, readAfterDelete: gone.status,
    };
    const ok = (e1.status === 409 || e1.status === 400 || e1.status === 403) &&
      (e2.status === 409 || e2.status === 400 || e2.status === 403) &&
      mk.status === 200 && rn.status === 200 && mv.status === 200 &&
      cyc.status === 409 && (rm.status === 200 || rm.status === 204) && gone.status === 404;
    return { result: ok ? "PASS" : "CONFIRMED_BUG", observed, defect: ok ? null : "BUG-009" };
  });

  /* ============ T-P1-05 / R-04 混排持久排序 ============ */
  await caseRun("T-P1-05", "目录与本级记录混排且持久（服务端 position）", "reorder 后 entries 顺序按提交顺序返回，重开仍保持", async (put) => {
    const sys = fx.archive.system[0].id;
    const before = (await L.get(`/api/v2/folders/company/entries?section=achievement&parentId=${sys}`)).data || [];
    const norm = (arr) => arr.map((e) => ({ kind: e.folder?.ref?.kind, id: Number(e.folder?.ref?.id), name: e.folder?.name, pos: e.folder?.position }));
    put(`排序前 entries: ${JSON.stringify(norm(before))}`);

    if (before.length < 2) throw new Error("该层条目不足 2，无法测混排");
    /* 逆序提交全量排列（Kind 必须转成 folder/record 词表） */
    const items = norm(before).reverse().map((x) => ({ Kind: KIND(x.kind), Id: x.id }));
    put(`提交逆序 order: ${JSON.stringify(items)}`);
    const r = await L.post(`/api/v2/folders/company/entries/reorder?section=achievement`, { ParentId: sys, Items: items });
    put(`POST entries/reorder -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);

    const after = (await L.get(`/api/v2/folders/company/entries?section=achievement&parentId=${sys}`)).data || [];
    put(`排序后 entries: ${JSON.stringify(norm(after))}`);

    /* 非全量排列必须 409 */
    const partial = await L.post(`/api/v2/folders/company/entries/reorder?section=achievement`,
      { ParentId: sys, Items: items.slice(0, 1) });
    put(`非全量排列 -> ${partial.status} ${JSON.stringify(partial.data).slice(0, 160)}`);

    const beforeIds = norm(before).map((x) => x.id);
    const afterIds = norm(after).map((x) => x.id);
    const expected = beforeIds.slice().reverse();
    const persisted = JSON.stringify(afterIds) === JSON.stringify(expected);

    /* 还原，避免污染后续用例 */
    const restore = await L.post(`/api/v2/folders/company/entries/reorder?section=achievement`,
      { ParentId: sys, Items: norm(before).map((x) => ({ Kind: KIND(x.kind), Id: x.id })) });
    put(`还原顺序 -> ${restore.status}`);

    const observed = { before: norm(before), after: norm(after), expectedIds: expected, partialReorderStatus: partial.status };
    const ok = r.status === 200 && persisted && partial.status === 409;
    return { result: ok ? "PASS" : "CONFIRMED_BUG", observed, defect: ok ? null : "BUG-010",
      notes: "只验证服务端持久 position；前端是否有拖动入口由 X-02 浏览器用例裁决" };
  });

  /* ============ T-P1-10 上传新版本 / 关联后同步 ============ */
  await caseRun("T-P1-10", "版本上传与关联后的回读同步（A/B）", "A: 新版本成为默认最新版；B: 已存在 FileId 关联到新记录后目标记录可见", async (put) => {
    const s = await mkScratchIp("T-P1-10");
    put(`A: 临时 fileId=${s.fileId} linkId=${s.linkId}，v1+${JSON.stringify(s.v2)}`);
    /* 后端没有"版本列表"GET 路由（只有 .../versions/{version}/download），
       所以 A 只能从 UI payload 回读 —— 顺带把这条 API 缺口记下来。 */
    const versProbe = await L.get(`/api/v2/files/company/${s.fileId}/versions`);
    put(`A: GET .../versions 探测 -> ${versProbe.status}（无该路由，预期 405）`);
    const uiA = (await L.get("/api/v2/ui/ip/company")).data?.files || [];
    const rowsA = uiA.filter((f) => Number(f.fileId) === Number(s.fileId) && Number(f.linkId) === Number(s.linkId));
    put(`A: 该 linkId 的 UI 行 -> ${JSON.stringify(rowsA)}`);
    const latest = rowsA.reduce((m, x) => Math.max(m, Number(x.version) || 0), 0);

    /* B: 关联到 IP-C */
    const assoc = await L.post(`/api/v2/files/company/${s.fileId}/associate`,
      { linkId: s.linkId, targetFolderId: fx.company.ipC, move: false });
    put(`B: associate -> ${assoc.status} ${JSON.stringify(assoc.data)}`);
    const newLink = await linkIdOf(fx.company.ipC, s.fileId);
    const uiB = (await L.get("/api/v2/ui/ip/company")).data?.files || [];
    const rowsB = uiB.filter((f) => Number(f.fileId) === Number(s.fileId));
    put(`B: fileId=${s.fileId} 在 IP UI 里的行 -> ${JSON.stringify(rowsB)}`);

    const observed = {
      versionsListRoute: versProbe.status,
      A: { latestVersionSeen: latest, uiRows: rowsA, defaultRowIsLatest: rowsA[0] && Number(rowsA[0].version) === latest },
      B: { assocStatus: assoc.status, newLinkId: newLink, rowsForFile: rowsB.length,
           distinctLinks: new Set(rowsB.map((x) => x.linkId)).size, rows: rowsB },
    };
    /* A 判据：该 linkId 至少在 UI 里出现过 version=2（上传的新版本生效）
       B 判据：关联后该 fileId 出现 2 个不同 linkId */
    const okA = latest === 2;
    const okB = assoc.status === 200 && observed.B.distinctLinks === 2;
    return { result: okA && okB ? "PASS" : "CONFIRMED_BUG", observed, defect: okA && okB ? null : "BUG-012",
      notes: `A=${okA} B=${okB}；注意 UI 对同一 linkId 出现多行属 BUG-002 的同一根因` };
  });

  /* ============ T-P2-12 Host / Origin / token ============ */
  await caseRun("T-P2-12", "Host 与 Origin 钉死、无 token 拒绝", "非法 Host 403；非法 Origin 403；无 token 拒绝业务接口；127.0.0.1 正常", async (put) => {
    const good = await rawStatus({});
    const evilHost = await rawStatus({ Host: "evil.example" });
    const loopback = await rawStatus({ Host: `localhost:${new URL(L.BASE).port}` });
    const evilOrigin = await rawStatus({ Origin: "http://evil.example" });
    const okOrigin = await rawStatus({ Origin: L.BASE });
    put(`127.0.0.1 -> ${good.status}；evil Host -> ${evilHost.status}；localhost -> ${loopback.status}；evil Origin -> ${evilOrigin.status}；正确 Origin -> ${okOrigin.status}`);

    /* 无 token 访问业务接口：用裸 fetch 不带 X-IPSys-Token */
    const bare = await fetch(L.BASE + "/api/v2/ui/projects/company");
    const bareBody = await bare.text();
    put(`无 token GET /api/v2/ui/projects/company -> ${bare.status} ${bareBody.slice(0, 120)}`);

    const observed = {
      loopbackHost: good.status, evilHost: evilHost.status, localhostHost: loopback.status,
      evilOrigin: evilOrigin.status, goodOrigin: okOrigin.status,
      noToken: { status: bare.status, body: bareBody.slice(0, 200) },
    };
    const ok = good.status === 200 && evilHost.status === 403 && loopback.status === 403 &&
      evilOrigin.status === 403 && okOrigin.status === 200 && (bare.status === 401 || bare.status === 403);
    return { result: ok ? "PASS" : "CONFIRMED_BUG", observed, defect: ok ? null : "BUG-011",
      notes: "localhost 返回 403 是 Host 钉死的预期行为，不记缺陷" };
  });

  fs.writeFileSync(path.join(EVID, "http-results.json"), JSON.stringify(results, null, 2), "utf8");
  log.add(`共 ${results.length} 项，结果写入 evidence/http-results.json`);
  log.flush();
  const tally = {};
  for (const r of results) tally[r.result] = (tally[r.result] || 0) + 1;
  console.log("\n=== 汇总 ===");
  console.log(JSON.stringify(tally, null, 2));
})().catch((e) => {
  log.add("HTTP SUITE FAILED: " + (e && e.stack || e));
  log.flush();
  fs.writeFileSync(path.join(EVID, "http-results.json"), JSON.stringify(results, null, 2), "utf8");
  process.exit(1);
});
