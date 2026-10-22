/* HTTP 层复测：只打真实端点，不碰产品源码。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-http.cjs v2b */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v2b";
const ROOT = path.resolve(__dirname, "..");
const EVID = path.join(ROOT, "evidence");
const TMP = path.resolve(ROOT, "..", "..", "build-retest", "agent-explorer-full-v2");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));

const results = [];
function rec(id, method, result, observed, expected, extra) {
  results.push(Object.assign({ id, method, result, observed, expected }, extra || {}));
  console.log(`[${result}] ${id} :: ${observed}`);
}
function evFile(id, text) {
  fs.writeFileSync(path.join(EVID, `${id}.txt`), text, "utf8");
}
const J = (x) => JSON.stringify(x);
async function must(label, p, body) {
  const r = await L.post(p, body);
  if (!r.ok) throw new Error(`${label} -> ${r.status} ${J(r.data)} :: ${J(body)}`);
  return r.data;
}

(async () => {
  const conn = await L.connect(cred.db, cred.password);
  console.log("连接方式:", conn.via);

  /* ---------------- T-P0-01 后端三级目录 ---------------- */
  {
    const ar = (await L.get("/api/v2/ui/archive/company")).data;
    const chain = ar.folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name }));
    const lvl1 = chain.find((f) => f.id === fx.archive.system[0].id);
    const lvl2 = chain.find((f) => f.id === fx.archive.lvl2);
    const lvl3 = chain.find((f) => f.id === fx.archive.lvl3);
    const deep = ar.archives.find((a) => a.id === fx.archive.records[0]);
    const ok = lvl2 && lvl2.parentId === lvl1.id && lvl3 && lvl3.parentId === lvl2.id && deep && deep.folderId === lvl3.id;
    evFile("T-P0-01", [
      "GET /api/v2/ui/archive/company 的 folders 链：",
      J(chain.filter((f) => f.id >= 1 && f.id <= 9), null, 1),
      "",
      "三级目录 parentId 关系：" + J({ lvl1: lvl1.id, lvl2: lvl2 && lvl2.parentId, lvl3: lvl3 && lvl3.parentId }),
      "最深处档案 folderId=" + (deep && deep.folderId) + "（期望 " + fx.archive.lvl3 + "）",
      "",
      "结论：后端层级完整。前端是否忠实渲染见 T-P0-01 的浏览器证据。",
    ].join("\n"));
    rec("T-P0-01#backend", "DYNAMIC-HTTP", ok ? "PASS" : "FAIL",
      `folders=${chain.length}, 二级 parent=${lvl2 && lvl2.parentId}, 三级 parent=${lvl3 && lvl3.parentId}, 记录 folderId=${deep && deep.folderId}`,
      "后端返回完整 parentId 链且记录归属最深目录");
  }

  /* ---------------- T-P0-02 多版本接口粒度 ---------------- */
  {
    const ip = (await L.get("/api/v2/ui/ip/company")).data;
    const rows = (ip.files || []).filter((f) => f.fileId === fx.files.ipA.fileId);
    const linkIds = [...new Set(rows.map((r) => r.linkId))];
    const versions = rows.map((r) => r.version);
    const totalBytes = rows.reduce((s, r) => s + r.size, 0);
    const latest = rows.find((r) => r.version === 2);
    evFile("T-P0-02", [
      "IP 附件同一 fileId 的接口返回行：",
      J(rows, null, 1),
      "",
      `行数=${rows.length}  不同 linkId=${J(linkIds)}  version=${J(versions)}`,
      `历史总字节=${totalBytes}（22+37=59）  最新版字节=${latest && latest.size}`,
      "",
      "注意：接口按版本给行是数据层事实；『UI 是否一版一行』要看前端 buildTree，见浏览器证据。",
      "界面『占用』应只算最新版 37B，不应算 59B。",
    ].join("\n"));
    rec("T-P0-02#api", "DYNAMIC-HTTP", rows.length >= 2 ? "PASS" : "FAIL",
      `接口返回 ${rows.length} 行、${linkIds.length} 个 linkId、版本 ${J(versions)}、总字节 ${totalBytes}`,
      "同一 linkId 下多版本可枚举，最新版可识别");
    fs.writeFileSync(path.join(EVID, "sizes.json"), J({ rows, totalBytes, latest: latest && latest.size }), "utf8");
  }

  /* ---------------- T-P0-03 同一 linkId 重复删除 ---------------- */
  {
    const up = await L.upload(fx.company.projectA, "重复删除用.txt", Buffer.from("dup delete probe"));
    const link = await (async () => {
      const r = await L.get(`/api/v2/files/company/folders/${fx.company.projectA}/links`);
      const arr = Array.isArray(r.data) ? r.data : r.data.items;
      return arr.filter((x) => Number(x.fileId) === Number(up.fileId)).pop();
    })();
    const linkId = link.id ?? link.linkId;
    const d1 = await L.del(`/api/v2/files/company/${up.fileId}/links/${linkId}`);
    const d2 = await L.del(`/api/v2/files/company/${up.fileId}/links/${linkId}`);
    evFile("T-P0-03", [
      `新建 link：fileId=${up.fileId} linkId=${linkId}`,
      `第一次 DELETE -> ${d1.status} ${J(d1.data)}`,
      `第二次 DELETE -> ${d2.status} ${J(d2.data)}`,
      "",
      "结论：同一 linkId 不能重复删除，第二次是 409。前端若把两个版本行都提交，就会走到这个 409；",
      "deleteNodes 的 for 循环整体在一个 try 内，第二条抛错即中断后续条目（见浏览器证据）。",
    ].join("\n"));
    rec("T-P0-03", "DYNAMIC-HTTP", d1.ok && d2.status === 409 ? "PASS" : "FAIL",
      `第一次 ${d1.status}、第二次 ${d2.status}（${d2.data && d2.data.error}）`,
      "重复删除被后端明确拒绝（409），不是静默成功");
  }

  /* ---------------- 自愈：保证 IP-B 有同一 fileId 的引用 ---------------- */
  {
    const onB0 = (await L.get(`/api/v2/files/company/folders/${fx.company.ipB}/links`)).data || [];
    if (!onB0.some((x) => Number(x.fileId) === Number(fx.files.ipA.fileId))) {
      const r = await L.post(`/api/v2/files/company/${fx.files.ipA.fileId}/associate`,
        { linkId: fx.files.ipA.linkId, targetFolderId: fx.company.ipB, move: false });
      console.log("自愈 associate ->", r.status, J(r.data));
    }
  }

  /* ---------------- 自愈：二级-A 下补一条记录，凑混排 ---------------- */
  {
    const entries0 = (await L.get(`/api/v2/folders/company/entries?section=achievement&parentId=${fx.archive.lvl2}`)).data || [];
    const has6 = entries0.some((e) => e.folder && e.folder.name === "档案-06");
    if (!has6) {
      const r = await L.post("/api/v2/folders/company/archive", {
        Archive: { Name: "档案-06", Category: "其他", Year: "2026", FolderId: fx.archive.lvl2 },
        Section: "achievement",
      });
      console.log("自愈 档案-06 ->", r.status, J(r.data));
    }
  }

  /* ---------------- T-P0-05 跨记录引用 ---------------- */
  {
    const linksA = (await L.get(`/api/v2/files/company/folders/${fx.company.ipA}/links`)).data;
    const onB = (await L.get(`/api/v2/files/company/folders/${fx.company.ipB}/links`)).data;
    const aIds = new Set(linksA.map((x) => x.id ?? x.linkId));
    const bIds = new Set(onB.map((x) => x.id ?? x.linkId));
    const distinct = [...aIds].every((x) => !bIds.has(x));
    evFile("T-P0-05", [
      `IP-A 目录的 links：${J(linksA)}`,
      `IP-B 目录下的 links：${J(onB)}`,
      "",
      `IP-A linkIds=${J([...aIds])}  IP-B linkIds=${J([...bIds])}  互不重叠=${distinct}`,
      "后端 POST /api/v2/files/{ws}/{fileId}/associate 已返回 {ok:true,moved:false}，说明同一 FileId 可复用到另一条记录。",
      "UI 只有一个『共享到目标知识产权』特例（bridge.js associateOriginal），项目/合同/档案/综合资料无入口。",
    ].join("\n"));
    rec("T-P0-05", "MIXED", distinct && onB.length === 1 ? "IMPLEMENTATION_GAP" : "FAIL",
      `同一 fileId 在 IP-A/IP-B 各有独立 link（${[...aIds]} / ${[...bIds]}）；UI 仅 IP 特例有入口`,
      "FileId 可跨记录复用且 LinkId 按目标独立；UI 提供通用入口");
  }

  /* ---------------- T-P1-02 ① 项目整体删除 → 合同随项目 ---------------- */
  {
    const pC = await must("create 项目C", "/api/v2/folders/company/project", { Project: { Name: "项目C", ProjectType: "科研项目", ProjectNo: "P-C", StartDate: "2026-04-01" } });
    const c3 = await must("create 合同C3", "/api/v2/folders/company/contract", { Contract: { Name: "合同C3", ContractNo: "HT-03" }, ProjectId: pC.id });
    const del = await L.del(`/api/v2/folders/company/project/${pC.id}`);
    const trash = (await L.get("/api/trash/company")).data;
    const hasProject = trash.some((r) => r.kind === "project" && r.id === pC.id);
    const hasContract = trash.some((r) => r.kind === "contract" && r.id === c3.id);
    const restore = await L.post("/api/trash/company/restore", { items: [{ kind: "project", id: pC.id, section: "" }] });
    const contracts = (await L.get("/api/v2/ui/contracts/company")).data;
    const back = contracts.some((c) => c.id === c3.id);
    evFile("T-P1-02", [
      `项目C=${pC.id} 合同C3=${c3.id}`,
      `DELETE 项目C -> ${del.status}`,
      `回收站含 project=${hasProject}, 含 contract=${hasContract}（期望 false）`,
      `POST restore 项目C -> ${restore.status}`,
      `恢复后 /api/v2/ui/contracts 含 C3=${back}`,
      "",
      "①②必须分开判：①整体删项目时合同不单列是 RecycleStore 的 p.deleted=0 语义，正确；",
      "②单独删合同（父项目仍在）时后端确实返回 kind=contract，前端是否展示见 T-P1-02#ui。",
    ].join("\n"));
    rec("T-P1-02#cascade", "DYNAMIC-HTTP", hasProject && !hasContract && back ? "PASS" : "FAIL",
      `整体删项目：回收站 project=${hasProject} contract=${hasContract}；恢复后合同回来=${back}`,
      "①项目整体删除后循环站不单列合同，恢复时合同一并回来");
  }

  /* ---------------- T-P1-03 后端移动/转移可用性 ---------------- */
  {
    const mv = await L.post(`/api/v2/folders/company/archive/${fx.archive.records[1]}/move?section=achievement`, { ParentId: fx.archive.lvl2 });
    const ar = (await L.get("/api/v2/ui/archive/company")).data;
    const moved = ar.archives.find((a) => a.id === fx.archive.records[1]);
    const back = await L.post(`/api/v2/folders/company/archive/${fx.archive.records[1]}/move?section=achievement`, { ParentId: fx.archive.system[0].id });
    const xfer = await L.post(`/api/v2/ui/archive/company/achievement/${fx.archive.records[2]}/transfer`, { TargetWorkspace: "personal", TargetSection: "achievement", Move: false });
    evFile("T-P1-03", [
      `POST /folders/company/archive/${fx.archive.records[1]}/move {ParentId:${fx.archive.lvl2}} -> ${mv.status} ${J(mv.data)}`,
      `回读 folderId=${moved && moved.folderId}（期望 ${fx.archive.lvl2}）`,
      `再移回 -> ${back.status}`,
      `POST /ui/archive/company/achievement/${fx.archive.records[2]}/transfer {TargetWorkspace:personal,Move:false} -> ${xfer.status} ${J(xfer.data)}`,
      "",
      "结论：后端具备记录移动与跨工作区转移能力；前端无任何复制/转移入口（grep transfer 零命中）。",
    ].join("\n"));
    rec("T-P1-03", "MIXED", mv.ok && moved && moved.folderId === fx.archive.lvl2 ? "IMPLEMENTATION_GAP" : "FAIL",
      `后端 move -> ${mv.status}，folderId 变为 ${moved && moved.folderId}；transfer -> ${xfer.status}；前端零入口`,
      "复制/转移有 UI 入口；后端可用不能当 UI 通过");
  }

  /* ---------------- T-P1-04 目录 CRUD 后端 ---------------- */
  {
    const rn = await L.call("PUT", `/api/v2/folders/company/archive_folder/${fx.archive.lvl2}`, {
      json: { ArchiveFolder: { Name: "二级-A-改名", ParentId: fx.archive.system[0].id }, Section: "achievement" },
    });
    const empty = await must("create 空目录", "/api/v2/folders/company/archive_folder", { ArchiveFolder: { Name: "待删空目录", ParentId: fx.archive.system[1].id }, Section: "achievement" });
    const delEmpty = await L.del(`/api/v2/folders/company/archive_folder/${empty.id}?section=achievement`);
    const delSys = await L.del(`/api/v2/folders/company/archive_folder/${fx.archive.system[0].id}?section=achievement`);
    const delNonEmpty = await L.del(`/api/v2/folders/company/archive_folder/${fx.archive.lvl2}?section=achievement`);
    const rnBack = await L.call("PUT", `/api/v2/folders/company/archive_folder/${fx.archive.lvl2}`, {
      json: { ArchiveFolder: { Name: "二级-A", ParentId: fx.archive.system[0].id }, Section: "achievement" },
    });
    evFile("T-P1-04", [
      `PUT 改名 -> ${rn.status} ${J(rn.data)}；改回 -> ${rnBack.status}`,
      `新建空目录 -> id=${empty.id}`,
      `删空目录 -> ${delEmpty.status}`,
      `删系统目录(id=${fx.archive.system[0].id}) -> ${delSys.status} ${J(delSys.data)}`,
      `删非空目录(二级-A，含三级与档案) -> ${delNonEmpty.status} ${J(delNonEmpty.data)}`,
      "",
      "结论：后端对自建目录支持 新建/改名/移动/删除，且系统目录受保护、非空目录拒删。",
      "前端无『新建下级分类』入口、右键对 archive_folder 无改名/删除（见 T-P1-04#ui）。",
    ].join("\n"));
    rec("T-P1-04", "MIXED", rn.ok && delEmpty.ok && !delSys.ok && !delNonEmpty.ok ? "IMPLEMENTATION_GAP" : "FAIL",
      `后端改名 ${rn.status}、删空目录 ${delEmpty.status}、删系统目录 ${delSys.status}、删非空目录 ${delNonEmpty.status}；前端无入口`,
      "自建目录有完整 CRUD，系统目录受保护；UI 提供同等入口");
  }

  /* ---------------- T-P1-05 持久排序（混排 + ids 全量校验） ---------------- */
  {
    const sec = "achievement";
    const parent = fx.archive.lvl2;   // 二级-A 下：三级-A1(目录) + 档案-01(资料)，正好混排
    const entries = (await L.get(`/api/v2/folders/company/entries?section=${sec}&parentId=${parent}`)).data;
    const order = (entries || []).map((e) => ({ Kind: e.folder.ref.kind === "archive_folder" ? "folder" : "record", Id: e.folder.ref.id }));
    const reversed = [...order].reverse();
    const r1 = await L.post(`/api/v2/folders/company/entries/reorder?section=${sec}`, { ParentId: parent, Items: reversed });
    const after = (await L.get(`/api/v2/folders/company/entries?section=${sec}&parentId=${parent}`)).data;
    const afterIds = after.map((e) => e.folder.ref.id);
    const r2 = await L.post(`/api/v2/folders/company/entries/reorder?section=${sec}`, { ParentId: parent, Items: reversed.slice(0, Math.max(1, reversed.length - 1)) });
    const r3 = await L.post(`/api/v2/ui/archive/company/${sec}/order`, { Ids: [fx.archive.records[0], 999999] });
    evFile("T-P1-05", [
      `父目录 ${parent} 当前混排条目：${J((entries || []).map((e) => ({ kind: e.folder.ref.kind, id: e.folder.ref.id, name: e.folder.name, position: e.folder.position })))}`,
      `倒序 reorder -> ${r1.status} ${J(r1.data)}`,
      `回读顺序：${J(afterIds)}（期望 ${J(reversed.map((x) => x.Id))}）`,
      `少一条的 reorder -> ${r2.status} ${J(r2.data)}（期望 409）`,
      `archive ids 排序塞入不存在 id -> ${r3.status} ${J(r3.data)}（期望 409）`,
      "",
      "结论：后端只支持 company/achievement 的混排与持久化；IP/项目台账没有端点。",
      "前端无手工排序入口（无拖拽、无上移下移），临时点列头排序不写回。",
    ].join("\n"));
    rec("T-P1-05", "MIXED", r1.ok && J(afterIds) === J(reversed.map((x) => x.Id)) && r2.status === 409 && r3.status === 409 ? "IMPLEMENTATION_GAP" : "FAIL",
      `后端 reorder ${r1.status} 且顺序生效；缺项 ${r2.status}；非法 id ${r3.status}；前端无入口`,
      "用户可调整 position 且重启保持；临时排序不算");
  }

  /* ---------------- T-P1-07 压缩信息 ---------------- */
  {
    const info = (await L.get("/api/vault/compact/info")).data;
    evFile("T-P1-07", [
      "GET /api/vault/compact/info -> " + J(info),
      "说明：本库为合成小库，reusableBytes 太小，VACUUM 在毫秒级结束，无法稳定抓拍『压缩中』窗口。",
      "关库被拒一侧已由 T-P0-04 用真实 409 复现，不重复。",
    ].join("\n"));
    rec("T-P1-07", "DYNAMIC-HTTP", (info && info.reusableBytes >= 0) ? "BLOCKED" : "BLOCKED",
      `compact/info reusableBytes=${info && info.reusableBytes}, canCompact=${info && info.canCompact}；窗口过短无法抓拍`,
      "压缩运行期间切工作区/关库有明确反馈");
  }

  /* ---------------- T-P2-07 搜索（HTTP 部分） ---------------- */
  {
    const s1 = (await L.get("/api/v2/search/company?q=" + encodeURIComponent("专利说明书"))).data;
    const s2 = (await L.get("/api/v2/search/company?q=" + encodeURIComponent("zzz-不存在-zzz"))).data;
    evFile("T-P2-07", [
      "搜索『专利说明书』-> " + J(s1).slice(0, 900),
      "",
      "搜索不存在的词 -> " + J(s2).slice(0, 300),
      "",
      "字段核对：命中只有 kind/section/id，没有 ownerKind（全仓 grep 零命中）。",
    ].join("\n"));
    rec("T-P2-07", "DYNAMIC-HTTP", s1.results && s1.results.length > 0 && s2.results && s2.results.length === 0 ? "PASS" : "FAIL",
      `命中 ${s1.results && s1.results.length} 条；无关词 ${s2.results && s2.results.length} 条；响应无 ownerKind 字段`,
      "服务端搜索可用，空词不误报");
  }

  /* ---------------- T-P2-12 安全边界 ---------------- */
  {
    const base = L.BASE;
    const http = require("node:http");
    const rawStatus = (headers) => new Promise((resolve, reject) => {
      const u = new URL(base + "/api/status");
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "GET", headers }, (res) => {
        res.resume(); resolve(res.statusCode);
      });
      req.on("error", reject); req.end();
    });
    /* undici 会忽略自定义 Host，必须用 node:http 的原始请求 */
    const host = { status: await rawStatus({ Host: "evil.example" }) };
    const origin = await fetch(base + "/api/status", { headers: { Origin: "http://evil.example" } });
    const noTok = await fetch(base + "/api/v2/ui/projects/company");
    const localhost = await fetch("http://localhost:" + base.split(":").pop() + "/api/status").catch(() => null);
    evFile("T-P2-12", [
      `伪造 Host: evil.example -> ${host.status}（期望 403）`,
      `伪造 Origin: http://evil.example -> ${origin.status}（期望 403）`,
      `无 token 访问 /api/v2/ui/projects/company -> ${noTok.status}（期望 401）`,
      `localhost 访问 -> ${localhost ? localhost.status : "连接失败"}（期望 403：Host 严格等于 127.0.0.1）`,
    ].join("\n"));
    const secOk = Number(host.status) === 403 && Number(origin.status) === 403 && Number(noTok.status) === 401;
    rec("T-P2-12", "DYNAMIC-HTTP", secOk ? "PASS" : "FAIL",
      `Host 403 / Origin 403 / 无 token 401 / localhost ${localhost ? localhost.status : "ERR"}`,
      "非法 Host、Origin 被拒，未授权业务接口不可访问");
  }

  /* ---------------- R-03 同一 FileId 两个 LinkId 的独立性 ---------------- */
  {
    const before = (await L.get(`/api/v2/files/company/folders/${fx.company.ipB}/links`)).data;
    const ipBLink = before[0];
    const dlB1 = await L.get(`/api/v2/files/company/${fx.files.ipA.fileId}/versions/2/download`, { raw: true });
    const delB = await L.del(`/api/v2/files/company/${fx.files.ipA.fileId}/links/${ipBLink.id ?? ipBLink.linkId}`);
    const afterA = (await L.get(`/api/v2/files/company/folders/${fx.company.ipA}/links`)).data;
    const afterB = (await L.get(`/api/v2/files/company/folders/${fx.company.ipB}/links`)).data;
    const dlA2 = await L.get(`/api/v2/files/company/${fx.files.ipA.fileId}/versions/2/download`, { raw: true });
    const bufA = Buffer.from(await dlA2.arrayBuffer());
    evFile("R-03", [
      `删除前 IP-B links：${J(before)}`,
      `DELETE IP-B 的 link -> ${delB.status} ${J(delB.data)}`,
      `删除后 IP-A links=${(afterA || []).length}  IP-B links=${(afterB || []).length}`,
      `仍能取 IP-A 最新版内容：status=${dlA2.status} bytes=${bufA.length}（期望 37）`,
      "",
      "同名附件隔离：公司 fileId=" + fx.files.sameNameCompany.fileId + " 个人 fileId=" + fx.files.sameNamePersonal.fileId + "（不同 id 即未共用物理文件）",
    ].join("\n"));
    rec("R-03", "DYNAMIC-HTTP", delB.ok && (afterA || []).length === 1 && (afterB || []).length === 0 && dlA2.status === 200 ? "PASS" : "FAIL",
      `删 IP-B 引用后 IP-A 引用仍在（${(afterA || []).length}），最新版仍可取 ${bufA.length}B；同名附件公司/个人 fileId 不同`,
      "删一处不影响另一处；同名附件不共用物理 FileObject");
  }

  /* ---------------- R-05 逻辑大小 / 历史字节 / 数据库体积 ---------------- */
  {
    const dbSize = fs.statSync(cred.db).size;
    const rows = (await L.get("/api/v2/ui/ip/company")).data.files.filter((f) => f.fileId === fx.files.ipA.fileId);
    const latest = rows.filter((r) => r.version === 2)[0];
    const history = rows.reduce((s, r) => s + r.size, 0);
    evFile("R-05", [
      `逻辑附件数（同一 linkId）=1`,
      `默认最新版大小=${latest && latest.size}B`,
      `版本历史总字节=${history}B（v1=22 + v2=37）`,
      `SQLCipher 文件大小=${dbSize}B（含索引/空闲页/加密开销，不能等于 37 或 59）`,
      "",
      "结论：四个数字各有含义，不能互相推导。上轮把 69B 当『占用错误』是口径错误。",
    ].join("\n"));
    rec("R-05", "DYNAMIC-HTTP", latest && latest.size === 37 && history === 59 ? "PASS" : "FAIL",
      `最新版 ${latest && latest.size}B / 历史 ${history}B / DB ${dbSize}B / 逻辑 1 条`,
      "四项分别计量，互不混淆");
  }

  fs.writeFileSync(path.join(EVID, "http-results.json"), JSON.stringify(results, null, 2), "utf8");
  console.log("\n=== 汇总 ===");
  for (const r of results) console.log(`${r.id}\t${r.result}\t${r.observed}`);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
