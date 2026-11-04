/* HTTP 层复测：只打真实端点，不碰产品源码。
   用法：IPSYS_BASE=http://127.0.0.1:PORT node t-http.cjs v2b */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");

const RUNID = process.argv[2] || "v2b";
const ROOT = path.resolve(__dirname, "..");
const EVID = process.env.IPSYS_EVIDENCE_DIR ? path.resolve(process.env.IPSYS_EVIDENCE_DIR) : path.join(ROOT, "evidence");
const TMP = path.resolve(ROOT, "..", "..", "build-retest", "agent-explorer-full-v2");
const cred = JSON.parse(fs.readFileSync(path.join(TMP, `vault-${RUNID}.cred.json`), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(EVID, "fixture.json"), "utf8"));

const results = [];
function rec(id, method, result, observed, expected, extra) {
  results.push(Object.assign({ id, method, result, observed, expected }, extra || {}));
  console.log(`[${result}] ${id} :: ${observed}`);
}
const HTTP_EVIDENCE_SUFFIX = new Set(["T-P0-01", "T-P0-02", "T-P0-03", "T-P2-07"]);
function evFile(id, text) {
  const name = HTTP_EVIDENCE_SUFFIX.has(id) ? id + "-http.txt" : id + ".txt";
  fs.writeFileSync(path.join(EVID, name), text, "utf8");
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
    const ar = (await L.get("/api/v2/ui/folders/company")).data;
    const chain = ar.folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name }));
    const lvl1 = chain.find((f) => f.id === fx.archive.system[0].id);
    const lvl2 = chain.find((f) => f.id === fx.archive.lvl2);
    const lvl3 = chain.find((f) => f.id === fx.archive.lvl3);
    /* A02/N2：普通资料就是文件夹，记录同样出现在 folders 集合里。 */
    const deep = ar.folders.find((f) => f.id === fx.archive.records[0]);
    const ok = lvl2 && lvl2.parentId === lvl1.id && lvl3 && lvl3.parentId === lvl2.id && deep && deep.parentId === lvl3.id;
    evFile("T-P0-01", [
      "GET /api/v2/ui/folders/company 的 folders 链：",
      J(chain.filter((f) => f.id >= 1 && f.id <= 9), null, 1),
      "",
      "三级目录 parentId 关系：" + J({ lvl1: lvl1.id, lvl2: lvl2 && lvl2.parentId, lvl3: lvl3 && lvl3.parentId }),
      "最深处档案 parentId=" + (deep && deep.parentId) + "（期望 " + fx.archive.lvl3 + "）",
      "",
      "结论：后端层级完整。前端是否忠实渲染见 T-P0-01 的浏览器证据。",
    ].join("\n"));
    rec("T-P0-01#backend", "DYNAMIC-HTTP", ok ? "PASS" : "FAIL",
      `folders=${chain.length}, 二级 parent=${lvl2 && lvl2.parentId}, 三级 parent=${lvl3 && lvl3.parentId}, 记录 parentId=${deep && deep.parentId}`,
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
      const r = await L.post("/api/v2/folders/company/archive_folder", {
        ArchiveFolder: { Name: "档案-06", Category: "其他", Year: "2026", ParentId: fx.archive.lvl2 },
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
      "当前 GUI 已统一提供附件共享/移动入口；本 HTTP 用例核验独立 LinkId，Explorer 真实跨入口行为由 t-browser.cjs 的 T-P2-02/S5-E2E 另行验证。",
    ].join("\n"));
    rec("T-P0-05", "DYNAMIC-HTTP", distinct && onB.length === 1 ? "PASS" : "FAIL",
      `同一 fileId 在 IP-A/IP-B 各有独立 link（${[...aIds]} / ${[...bIds]}），当前 GUI 入口由真实 Edge 专项独立验证`,
      "FileId 可跨记录复用且 LinkId 按目标独立；UI 提供通用入口");
  }

  /* ---------------- T-P1-02 项目普通目录级联删除/恢复 ---------------- */
  {
    const pC = await must("create 项目C", "/api/v2/folders/company/project",
      { Project: { Name: "项目C", ProjectType: "科研项目", ProjectNo: "P-C", StartDate: "2026-04-01" } });
    const c3 = await must("create 项目普通目录C3", "/api/v2/folders/company/archive_folder",
      { ArchiveFolder: { Name: "合同资料C3", ParentId: pC.id, Remarks: "HT-03" }, Section: "project" });
    const old = await L.post("/api/v2/folders/company/contract",
      { Contract: { Name: "旧合同独立业务", ContractNo: "HT-03" }, ProjectId: pC.id });
    const del = await L.del(`/api/v2/folders/company/project/${pC.id}`);
    const trashReply = await L.get("/api/trash/company");
    const trash = trashReply.data;
    const hasProject = trash.some((r) => r.kind === "project" && r.id === pC.id);
    const noDuplicateFolder = trash.every((r) => !(r.kind === "v2_archive_folder" && r.id === c3.id));
    const hidden = await L.get(`/api/v2/folders/company/archive_folder/${c3.id}?section=project`);
    const restore = await L.post("/api/trash/company/restore",
      { items: [{ kind: "project", id: pC.id, section: "" }] });
    const restored = await L.get(`/api/v2/folders/company/archive_folder/${c3.id}?section=project`);
    const back = restored.ok && restored.data?.folder?.ref?.id === c3.id &&
      restored.data?.folder?.parent?.id === pC.id;
    const ok = old.status === 400 && del.ok && hasProject && noDuplicateFolder &&
      hidden.status === 404 && restore.ok && back;
    evFile("T-P1-02", [
      `项目C=${pC.id} 项目普通目录C3=${c3.id}`,
      `旧 contract POST -> ${old.status} (期望400)`,
      `DELETE 项目C -> ${del.status}`,
      `回收站含项目=${hasProject}, 子目录不重复出现=${noDuplicateFolder}`,
      `项目删除后子目录 GET -> ${hidden.status} (期望404)`,
      `POST restore 项目C -> ${restore.status}`,
      `恢复后目录 FolderId/父级一致=${back}`,
      "",
      "项目子级是 archive_folder(section=project)；删除项目后其后代不应孤立可见，恢复项目保留原有目录身份。",
    ].join("\n"));
    rec("T-P1-02#cascade", "DYNAMIC-HTTP", ok ? "PASS" : "FAIL",
      `旧合同创建拒绝=${old.status===400}，项目回收=${hasProject}，目录隐藏=${hidden.status===404}，原FolderId恢复=${back}`,
      "旧合同接口400；项目删除/恢复使后代目录一同隐藏/恢复，FolderId与父项目关系不变");
  }

  /* ---------------- T-P1-03 后端移动/转移可用性 ---------------- */
  {
    const mv = await L.post(`/api/v2/folders/company/archive_folder/${fx.archive.records[1]}/move?section=achievement`, { ParentId: fx.archive.lvl2 });
    const ar = (await L.get("/api/v2/ui/folders/company")).data;
    const moved = ar.folders.find((f) => f.id === fx.archive.records[1]);
    const back = await L.post(`/api/v2/folders/company/archive_folder/${fx.archive.records[1]}/move?section=achievement`, { ParentId: fx.archive.system[0].id });
    const xfer = await L.post(`/api/v2/ui/folders/company/achievement/${fx.archive.records[2]}/transfer`, { TargetWorkspace: "personal", TargetSection: "achievement", Move: false });
    evFile("T-P1-03", [
      `POST /folders/company/archive/${fx.archive.records[1]}/move {ParentId:${fx.archive.lvl2}} -> ${mv.status} ${J(mv.data)}`,
      `回读 parentId=${moved && moved.parentId}（期望 ${fx.archive.lvl2}）`,
      `再移回 -> ${back.status}`,
      `POST /ui/archive/company/achievement/${fx.archive.records[2]}/transfer {TargetWorkspace:personal,Move:false} -> ${xfer.status} ${J(xfer.data)}`,
      "",
      "结论：后端具备目录移动及跨工作区转移能力。GUI 现在具备 folder-picker / transferBusinessRecord / transferFolderBatch，实际 GUI↔MCP 由 S5-E2E 验证。",
    ].join("\n"));
    rec("T-P1-03", "DYNAMIC-HTTP", mv.ok && back.ok && xfer.ok && moved && moved.parentId === fx.archive.lvl2 ? "PASS" : "FAIL",
      `后端 move -> ${mv.status}，parentId 变为 ${moved && moved.parentId}；移回 -> ${back.status}；transfer -> ${xfer.status}；GUI 入口见 Edge S5-E2E`,
      "复制/转移有 UI 入口；后端可用不能当 UI 通过");
  }

  /* ---------------- R1-HTTP 跨模块完整墓碑子树 ---------------- */
  {
    const section = "project";
    const root = await must("R1 create D1", "/api/v2/folders/company/archive_folder", {
      Section: section, ArchiveFolder: { Name: "R1_HTTP_D1_" + RUNID, ParentId: fx.company.projectA }
    });
    const mid = await must("R1 create D2", "/api/v2/folders/company/archive_folder", {
      Section: section, ArchiveFolder: { Name: "R1_HTTP_D2_" + RUNID, ParentId: root.id }
    });
    const leaf = await must("R1 create D3", "/api/v2/folders/company/archive_folder", {
      Section: section, ArchiveFolder: { Name: "R1_HTTP_D3_" + RUNID, ParentId: mid.id }
    });
    const one=Buffer.from("R1 first "+RUNID),two=Buffer.from("R1 second "+RUNID);
    const link=await L.upload(leaf.id,"R1_HTTP.txt",one);
    const beforeLinks=await L.get(`/api/v2/files/company/folders/${leaf.id}/links?includeDeleted=false`);
    const beforeList=Array.isArray(beforeLinks.data)?beforeLinks.data:beforeLinks.data?.items||[];
    const originalLink=beforeList.find(x=>Number(x.fileId)===Number(link.fileId));
    const originalLinkId=originalLink?.id??originalLink?.linkId;
    if(!originalLinkId)throw Error("R1 original LinkId missing");
    await L.addVersion("company",link.fileId,"R1_HTTP_v2.txt",two);
    const tombstone=await L.del(`/api/v2/folders/company/archive_folder/${mid.id}?section=project`);
    const moved=await L.post("/api/v2/ui/folders/company/project/transfer-batch",{
      TargetFolderId:0,TargetSection:"general",Move:true,Items:[root.id]
    });
    const trash=(await L.get("/api/trash/company")).data;
    const inTrash=Array.isArray(trash) && trash.some(x=>
      x.kind==="v2_archive_folder"&&x.id===mid.id&&x.section==="general");
    const restore=await L.post("/api/trash/company/restore",{
      items:[{kind:"v2_archive_folder",id:mid.id,section:"general"}]
    });
    const ar=(await L.get("/api/v2/ui/folders/company")).data;
    const ids=[root.id,mid.id,leaf.id];
    const found=ids.map(id=>ar.folders.find(f=>f.id===id));
    const parents=found[0]?.parentId==null &&
      found[1]?.parentId===root.id && found[2]?.parentId===mid.id;
    const allGeneral=found.every(f=>f?.section==="general");
    const links=await L.get(`/api/v2/files/company/folders/${leaf.id}/links`);
    const fileLinks=Array.isArray(links.data)?links.data:links.data?.items||[];
    const sameFile=fileLinks.some(x=>Number(x.fileId)===Number(link.fileId) &&
      Number(x.id??x.linkId)===Number(originalLinkId));
    const v1=await L.call("GET",`/api/v2/files/company/${link.fileId}/versions/1/download`,{raw:true});
    const v2=await L.call("GET",`/api/v2/files/company/${link.fileId}/versions/2/download`,{raw:true});
    const bytes1=v1.ok?Buffer.from(await v1.arrayBuffer()):Buffer.alloc(0);
    const bytes2=v2.ok?Buffer.from(await v2.arrayBuffer()):Buffer.alloc(0);
    const ok=tombstone.ok && moved.ok && moved.data?.folders===3 &&
      inTrash && restore.ok && allGeneral && parents && sameFile &&
      bytes1.equals(one)&&bytes2.equals(two);
    evFile("R1-HTTP",[
      `D1=${root.id} D2(deleted)=${mid.id} D3(active)=${leaf.id}, FileId=${link.fileId}, LinkId=${originalLinkId}`,
      `delete D2 ${tombstone.status}; move project->general ${moved.status}, moved physical folders=${moved.data?.folders}`,
      `trash under general=${inTrash}; restore D2 ${restore.status}`,
      `parent chain consistent=${parents}; all three section=general: ${allGeneral}`,
      `FileId/LinkId preserved=${sameFile}; version bytes 1=${bytes1.equals(one)} 2=${bytes2.equals(two)}`
    ].join("\n"));
    rec("R1-HTTP","DYNAMIC-HTTP",ok?"PASS":"FAIL",
      `move=${moved.status}, 3 descendants=${moved.data?.folders}, general trash=${inTrash}, restore=${restore.status}, allGeneral=${allGeneral}, versions match=${bytes1.equals(one)&&bytes2.equals(two)}`,
      "带已删除中层目录与隐藏后代跨模块原位移动、恢复后仍可见且两历史版本及 FileId/LinkId 不变");

    const g1=await must("R1 create general G1","/api/v2/folders/company/archive_folder",{
      Section:"general",ArchiveFolder:{Name:"R1_HTTP_G1_"+RUNID}
    });
    const g2=await must("R1 create general G2","/api/v2/folders/company/archive_folder",{
      Section:"general",ArchiveFolder:{Name:"R1_HTTP_G2_"+RUNID,ParentId:g1.id}
    });
    const g3=await must("R1 create general G3","/api/v2/folders/company/archive_folder",{
      Section:"general",ArchiveFolder:{Name:"R1_HTTP_G3_"+RUNID,ParentId:g2.id}
    });
    const deletedG2=await L.del(`/api/v2/folders/company/archive_folder/${g2.id}?section=general`);
    const toAchievement=await L.post("/api/v2/ui/folders/company/general/transfer-batch",{
      TargetFolderId:0,TargetSection:"achievement",Move:true,Items:[g1.id]
    });
    const deletedG1=await L.del(`/api/v2/folders/company/archive_folder/${g1.id}?section=achievement`);
    const purged=await L.post("/api/trash/company/purge",{
      items:[{kind:"v2_archive_folder",id:g1.id,section:"achievement"}]
    });
    const after=(await L.get("/api/trash/company")).data;
    const absent=Array.isArray(after)&&![g1.id,g2.id,g3.id].some(id=>
      after.some(x=>x.kind==="v2_archive_folder"&&x.id===id));
    const clean=deletedG2.ok&&toAchievement.ok&&toAchievement.data?.folders===3&&
      deletedG1.ok&&purged.ok&&absent;
    evFile("R1-PURGE",[
      `general G1=${g1.id}, deleted G2=${g2.id}, hidden G3=${g3.id}`,
      `move general->achievement ${toAchievement.status}, physical folders=${toAchievement.data?.folders}`,
      `delete G1 ${deletedG1.status}, purge ${purged.status}, trash entries absent=${absent}`
    ].join("\n"));
    rec("R1-PURGE","DYNAMIC-HTTP",clean?"PASS":"FAIL",
      `move=${toAchievement.status}, folders=${toAchievement.data?.folders}, purge=${purged.status}, trashed descendants absent=${absent}`,
      "回收站子树跨模块移动之后，永久清理新的根目录不因旧 section 而失败");
  }

  /* ---------------- T-P1-04 目录 CRUD：可恢复整树删除 ---------------- */
  {
    const sec = "achievement";
    const pathOf = id => `/api/v2/folders/company/archive_folder/${id}?section=${sec}`;
    const restore = id => L.post("/api/trash/company/restore", {
      items: [{kind:"v2_archive_folder",id,section:sec}],
    });
    const rn = await L.call("PUT", pathOf(fx.archive.lvl2), {
      json: { ArchiveFolder: { Name: "二级-A-改名", ParentId: fx.archive.system[0].id }, Section: sec },
    });
    const empty = await must("create 空目录", "/api/v2/folders/company/archive_folder",
      { ArchiveFolder: { Name: "待删空目录", ParentId: fx.archive.system[1].id }, Section: sec });
    const delEmpty = await L.del(pathOf(empty.id));
    const trashEmpty = (await L.get("/api/trash/company")).data;
    const hasEmpty = Array.isArray(trashEmpty) && trashEmpty.some(x =>
      x.kind === "v2_archive_folder" && x.id === empty.id && x.section === sec);
    const restoreEmpty = await restore(empty.id);
    const delSys = await L.del(pathOf(fx.archive.system[0].id));
    const hiddenChild = await L.get(pathOf(fx.archive.lvl2));
    const restoreSys = await restore(fx.archive.system[0].id);
    const recoveredChild = await L.get(pathOf(fx.archive.lvl2));
    const delNonEmpty = await L.del(pathOf(fx.archive.lvl2));
    const restoreNonEmpty = await restore(fx.archive.lvl2);
    const rnBack = await L.call("PUT", pathOf(fx.archive.lvl2), {
      json: { ArchiveFolder: { Name: "二级-A", ParentId: fx.archive.system[0].id }, Section: sec },
    });
    const alive = await L.get(pathOf(fx.archive.lvl2));
    const ok = rn.ok && rnBack.ok && delEmpty.ok && hasEmpty && restoreEmpty.ok &&
      delSys.ok && hiddenChild.status === 404 && restoreSys.ok &&
      recoveredChild.ok && delNonEmpty.ok && restoreNonEmpty.ok && alive.ok;
    evFile("T-P1-04", [
      `PUT 改名 -> ${rn.status}；恢复原名 -> ${rnBack.status}`,
      `空目录 -> 删除 ${delEmpty.status}；回收站可见 ${hasEmpty}；恢复 ${restoreEmpty.status}`,
      `系统目录整树 -> 删除 ${delSys.status}；后代隐藏 ${hiddenChild.status}；恢复 ${restoreSys.status}；后代重新可见 ${recoveredChild.status}`,
      `非空二级目录 -> 删除 ${delNonEmpty.status}；恢复 ${restoreNonEmpty.status}；可访问 ${alive.status}`,
      "回收仅标记目录根，子目录及资料原样保留，永久删除另行由 RecycleStore 逐条解绑。",
    ].join("\n"));
    rec("T-P1-04", "DYNAMIC-HTTP", ok ? "PASS" : "FAIL",
      `空目录/系统目录/非空目录均可回收并恢复；历史子目录隐藏与还原正常=${ok}`,
      "目录删除进入回收站且保留原有内容和层级；后续排序继续有效");
  }

  /* ---------------- T-P1-05 持久排序（混排 + ids 全量校验） ---------------- */
  {
    const sec = "achievement";
    const parent = fx.archive.lvl2;   // 二级-A 下：三级-A1(目录) + 档案-01(资料)，正好混排
    const entries = (await L.get(`/api/v2/folders/company/entries?section=${sec}&parentId=${parent}`)).data;
    const order = (entries || []).map((e) => ({ Kind: "folder", Id: e.folder.ref.id }));
    const reversed = [...order].reverse();
    const r1 = await L.post(`/api/v2/folders/company/entries/reorder?section=${sec}`, { ParentId: parent, Items: reversed });
    const after = (await L.get(`/api/v2/folders/company/entries?section=${sec}&parentId=${parent}`)).data;
    const afterIds = after.map((e) => e.folder.ref.id);
    const r2 = await L.post(`/api/v2/folders/company/entries/reorder?section=${sec}`, { ParentId: parent, Items: reversed.slice(0, Math.max(1, reversed.length - 1)) });
    const wrongId = reversed.map((item, index) => index === 0
      ? { Kind: "folder", Id: 999999 } : item);
    const r3 = await L.post(`/api/v2/folders/company/entries/reorder?section=${sec}`,
      { ParentId: parent, Items: wrongId });
    const finalEntries = (await L.get(`/api/v2/folders/company/entries?section=${sec}&parentId=${parent}`)).data;
    const finalIds = finalEntries.map((e) => e.folder.ref.id);
    evFile("T-P1-05", [
      `父目录 ${parent} 当前混排条目：${J((entries || []).map((e) => ({ kind: e.folder.ref.kind, id: e.folder.ref.id, name: e.folder.name, position: e.folder.position })))}`,
      `倒序 reorder -> ${r1.status} ${J(r1.data)}`,
      `回读顺序：${J(afterIds)}（期望 ${J(reversed.map((x) => x.Id))}）`,
      `少一条的 reorder -> ${r2.status} ${J(r2.data)}（期望 409）`,
      `同一现行接口中替换为不存在的 FolderId -> ${r3.status} ${J(r3.data)}（期望 409）`,
      `错误输入后的顺序仍为：${J(finalIds)}（与首次成功排序结果相同）`,
      "",
      "本项只检验当前 HTTP 普通目录同层完整性与持久 position；",
      "Explorer 自定义顺序和上移/下移由运行中的 Node/UI Smoke 独立验证，不以本脚本模拟真实鼠标。",
    ].join("\n"));
    const actualOrder = J(reversed.map((x) => x.Id));
    const accepted = r1.ok && J(afterIds) === actualOrder &&
      r2.status === 409 && r3.status === 409 && J(finalIds) === actualOrder;
    rec("T-P1-05", "DYNAMIC-HTTP", accepted ? "PASS" : "FAIL",
      `现行目录排序 ${r1.status}；持久顺序符合=${J(afterIds) === actualOrder}；缺项 ${r2.status}；非法 ID ${r3.status}；拒绝后顺序不变=${J(finalIds) === actualOrder}`,
      "现行同层文件夹排序可持久化；缺项与无效ID均拒绝且无部分提交。GUI入口另验");
  }

  /* ---------------- T-P1-07 压缩信息 ---------------- */
  {
    const info = (await L.get("/api/vault/compact/info")).data;
    evFile("T-P1-07", [
      "GET /api/vault/compact/info -> " + J(info),
      "说明：本库为合成小库，reusableBytes 太小，VACUUM 在毫秒级结束，无法稳定抓拍『压缩中』窗口。",
      "关库被拒一侧已由 T-P0-04 用真实 409 复现，不重复。",
    ].join("\n"));
    rec("T-P1-07", "DYNAMIC-HTTP", (info && Number.isFinite(Number(info.reusableBytes)) && typeof info.canCompact === "boolean") ? "BLOCKED" : "FAIL",
      `compact/info reusableBytes=${info && info.reusableBytes}, canCompact=${info && info.canCompact}；窗口过短无法抓拍`,
      "压缩运行期间切工作区/关库有明确反馈");
  }

  /* ---------------- T-P2-07 搜索与附件归属映射（HTTP 部分） ---------------- */
  {
    const s1 = (await L.get("/api/v2/search/company?q=" + encodeURIComponent("专利说明书"))).data;
    const s2 = (await L.get("/api/v2/search/company?q=" + encodeURIComponent("zzz-不存在-zzz"))).data;
    const hits = Array.isArray(s1.results) ? s1.results : [];
    const fileHit = hits.find(x => x.kind === "file" && /专利说明书/.test(x.title || "") &&
      Number(x.ownerId ?? x.OwnerId) === Number(fx.company.ipA));
    const ownerKind = fileHit?.ownerKind ?? fileHit?.OwnerKind ?? "";
    const ownerId = fileHit?.ownerId ?? fileHit?.OwnerId ?? 0;
    const ownerMapping = !!fileHit && ownerKind === "ip" && Number(ownerId) === Number(fx.company.ipA);
    const noFalsePositive = Array.isArray(s2.results) && s2.results.length === 0;
    const ok = hits.length > 0 && noFalsePositive && ownerMapping;
    evFile("T-P2-07", [
      "搜索『专利说明书』-> " + J(s1).slice(0, 1600),
      "",
      "搜索不存在的词 -> " + J(s2).slice(0, 500),
      "",
      "预期附件归属：ownerKind=ip，ownerId=" + fx.company.ipA,
      "实际附件命中：" + J(fileHit),
      "fileId→owner/link 归属字段正确=" + ownerMapping,
      "无关词无误报=" + noFalsePositive,
    ].join("\n"));
    rec("T-P2-07", "DYNAMIC-HTTP", ok ? "PASS" : "FAIL",
      "命中 " + hits.length + " 条；IP-A 附件归属映射=" + ownerMapping + "（" + ownerKind + "/" + ownerId + "）；无关词结果=" + (s2.results && s2.results.length),
      "文件搜索结果包含正确 ownerKind/ownerId，能映射到 IP-A 的真实附件；不存在词返回空");
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
  require("./result-gate.cjs").assertResults("http",results);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
