/* ==========================================================================
   能力层适配（bridge）
   --------------------------------------------------------------------------
   `src/IPSys.Web/wwwroot/` 下的四个脚本不是本壳的源码,它们有自建 DOM 与固定的
   对外契约。这里的职责只有两件:**把 VaultStore 包装成它们期望的请求对象形状**,
   以及**把本壳的节点翻译成它们要的参数**。不复制任何业务逻辑。

   为什么要这一层:ip-v2.js 要求 `api` 同时是三样东西 ——
     1. `api(path, {method,json,signal})` → Response
     2. `api.uploadFile(path, {method,headers,body})` → {ok,status,json()}
     3. `api.uploadProgress` → IPSysUploadProgress
   普通 JSON 请求走 fetch,上传必须走 XHR(只有 XHR 能拿到真实字节进度),
   两者共用同一个 token,所以只能在外层拼一个混合对象。
   ========================================================================== */

/* 单个原件上限。后端 Kestrel 的 MaxRequestBodySize 是 66 MiB,但 prepare 端点
   会放宽到 8 GiB,与旧壳保持一致。 */
const MAX_ORIGINAL_BYTES = 8 * 1024 ** 3;

const CapabilityApi = Object.assign(
  (path, opts = {}) => VaultStore.api(path, opts),
  {
    uploadProgress: globalThis.IPSysUploadProgress,

    async uploadFile(path, opts) {
      try {
        return await this.uploadProgress.request(path, opts, VaultStore.token);
      } catch (error) {
        /* 上传走 XHR,不经过 VaultStore.api,所以 401 要在这里自己收口:
           否则界面会停在一个已失效的 token 上,后续每个请求都静默失败。 */
        if (error?.status === 401) {
          VaultStore.token = "";
          VaultStore.locked = true;
          showLogin("登录已失效,请重新解锁资料库");
        }
        throw error;
      }
    },
  }
);

/* 能力层任务是否在跑 —— 工作区切换要据此互斥,否则切走时上传还在发,
   结果会落到新工作区的路径上。 */
let fileTaskActive = false;
CapabilityApi.uploadProgress.onActiveChanged = (active) => {
  fileTaskActive = !!active;
  if (!active) {
    /* 取消时服务端还要回滚暂存对象,晚一点刷新才看得到真实结果。 */
    setTimeout(() => refreshCurrent().catch(() => {}), 450);
  }
};

function fileTaskBusy() {
  return fileTaskActive || !!CapabilityApi.uploadProgress.status().active;
}

/* ---------------- 上传 ---------------- */

const UPLOADABLE_KINDS = ["project", "archive", "ip", "general"];

/* 批量上传:去重提示、阶段文案、取消全部由 ip-v2 + upload-progress 负责,
   这里只做「一次 begin / 逐件 file / 一次 finish」的编排。 */
async function uploadAttachments(files, node) {
  const list = Array.from(files || []);
  if (!list.length) return;

  const ownerId = node?.biz?.id;
  const kind = node?.biz?.kind;
  if (!ownerId || !UPLOADABLE_KINDS.includes(kind)) {
    return toast("当前记录无法接收附件");
  }

  const progress = CapabilityApi.uploadProgress;
  if (!progress.begin(list.length)) return toast("已有文件任务,请等待完成");

  const workspace = VaultStore.ws;
  const meta = { kind, ownerId };
  const errors = [];
  let completed = 0;
  let skipped = 0;

  try {
    for (let i = 0; i < list.length; i++) {
      if (progress.cancelled()) break;
      progress.file(list[i], i + 1);

      if (list[i].size > MAX_ORIGINAL_BYTES) {
        errors.push(`${list[i].name}:超过 8 GiB`);
        continue;
      }

      try {
        const saved = await globalThis.IPSysNativeIp.upload(CapabilityApi, list[i], meta, workspace);
        /* null = 用户在去重对话框里点了「取消上传」 */
        if (saved) completed++;
        else skipped++;
      } catch (e) {
        if (progress.cancelled() || e?.name === "AbortError") {
          skipped++;
          break;
        }
        errors.push(`${list[i].name}:${e.message}`);
      }
    }
  } finally {
    progress.finish({ completed, errors, skipped });
  }
}

/* ---------------- 上传新版本 / 关联原件 ---------------- */

/* 把本壳的附件节点翻译成 ip-v2 需要的 record。
   附件节点自己不记 ownerId,要顺着父节点找(fileMeta 只有 fileId/version)。 */
function recordOfAttachment(node) {
  const meta = VaultStore.fileMeta.get(node.id);
  if (!meta) return null;
  const owner = findParent(node.id);
  return {
    kind: node.biz?.ownerKind || owner?.biz?.kind || "",
    ownerId: owner?.biz?.id ?? null,
    fileId: meta.fileId,
    version: meta.version,
    category: node.biz?.category || "其他材料",
    name: node.name,
  };
}

async function uploadNewVersion(node) {
  if (!node || node.type !== "file") return;
  const record = recordOfAttachment(node);
  if (!record?.fileId || !record.ownerId) return toast("附件信息缺失,无法上传新版本");

  const result = await globalThis.IPSysNativeIp.newVersion(CapabilityApi, record, VaultStore.ws);
  if (result === true) toast("新版本已保存");
  else if (result instanceof Error) toast(result.message, { ms: 6000 });
}

async function associateOriginal(node) {
  if (!node || node.type !== "file") return;
  const record = recordOfAttachment(node);
  if (!record?.fileId) return toast("附件信息缺失");

  /* ip-v2.associate 期望 records 里每项是 {id, ownerId, data:{name}}。 */
  const records = [];
  walkNodes((n) => {
    if (n.type === "folder" && n.biz?.kind === "ip" && n.biz?.id != null) {
      records.push({ id: n.biz.id, ownerId: n.biz.id, data: { name: n.name } });
    }
  });
  if (records.length < 2) return toast("当前工作区还没有其它知识产权记录");

  const ok = await globalThis.IPSysNativeIp.associate(
    CapabilityApi,
    { ...record, kind: "ip", ownerId: record.ownerId },
    VaultStore.ws,
    records
  );
  if (ok) toast("已共享到目标知识产权");
}

/* 遍历当前已加载的整棵树(含未展开的分支)。 */
function walkNodes(visit) {
  walk(ROOT, (n) => visit(n));
}
