/* ==========================================================================
   Excel 台账导入导出（自旧壳 app.js 移植）
   --------------------------------------------------------------------------
   这是本次换壳里唯一需要从旧界面取代码的地方:`/api/v2/excel/*` 的调用全部写在
   旧 app.js 里,export.js 一行都没有。

   后端契约(未改动):
     POST /api/v2/excel/{ws}/{kind}/export[?section=]   body {mode,ids} → xlsx
     POST /api/v2/excel/{ws}/{kind}/import?policy=&section=  body=文件 → 报告 JSON
   kind ∈ project | ip | general | archive;archive 必须带 section。
   mode 只有 all / filtered 两种,新壳没有台账行概念,统一用 all。
   ========================================================================== */

/* 分类 id → 后端台账。分类 id 恰好等于 archive 的 section 名。 */
const EXCEL_TARGETS = {
  certificate: { kind: "archive", section: "certificate", label: "资质" },
  achievement: { kind: "archive", section: "achievement", label: "业务档案" },
  academic: { kind: "archive", section: "academic", label: "学术成果" },
  project: { kind: "project", section: "", label: "项目台账" },
  ip: { kind: "ip", section: "", label: "知识产权" },
  general: { kind: "general", section: "", label: "综合资料" },
};

function excelTargetOf(categoryId) {
  return EXCEL_TARGETS[categoryId] || null;
}

function excelQueryOf(target) {
  return target.kind === "archive" ? `?section=${encodeURIComponent(target.section)}` : "";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportLedger(categoryId) {
  const target = excelTargetOf(categoryId);
  if (!target) return toast("当前分类不支持 Excel 导出");

  const ws = VaultStore.ws;
  try {
    const res = await api(`/api/v2/excel/${ws}/${target.kind}/export${excelQueryOf(target)}`, {
      method: "POST",
      json: { mode: "all", ids: null },
    });
    downloadBlob(await res.blob(), `${target.label}-${ws}.xlsx`);
    toast("Excel 已导出");
  } catch (error) {
    notice("Excel 导出失败：" + error.message, true);
  }
}

/* 四种重复策略。旧壳也是四个按钮,askConfirm 只有两态,这里保留原生 dialog。 */
function chooseExcelDuplicatePolicy() {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "input-dialog";
    dialog.innerHTML =
      "<h3>重复记录如何处理？</h3>" +
      '<p class="hint">系统会按项目编号、知识产权统一编号与类型等识别疑似重复项。正确行继续导入，错误行单独报告。</p>' +
      '<div class="excel-choice">' +
      '<button class="btn" data-excel-policy="skip">跳过重复记录（推荐）</button>' +
      '<button class="btn" data-excel-policy="update">更新已有记录</button>' +
      '<button class="btn" data-excel-policy="create">将重复记录另建一条</button>' +
      '<button class="btn" data-excel-policy="cancel">取消导入</button></div>';
    document.body.append(dialog);

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.addEventListener("click", (event) => {
      const value = event.target.closest("[data-excel-policy]")?.dataset.excelPolicy;
      if (value) finish(value === "cancel" ? null : value);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.showModal();
  });
}

function showExcelImportReport(report) {
  const details = report.errors || [];
  const dialog = document.createElement("dialog");
  dialog.className = "input-dialog excel-report";
  dialog.innerHTML =
    "<h3>Excel 导入结果</h3>" +
    `<p>新增 ${Number(report.created) || 0} 条，更新 ${Number(report.updated) || 0} 条，` +
    `跳过 ${Number(report.skipped) || 0} 条，失败 ${Number(report.failed) || 0} 条。</p>` +
    (report.omittedErrors
      ? `<p class="hint">另有 ${Number(report.omittedErrors)} 行错误未展开显示，请先修正已列出的错误再导入。</p>`
      : "") +
    (details.length
      ? '<div class="excel-errors">' +
        details.map((e) => `<p>第 ${Number(e.row)} 行：${esc(e.error)}</p>`).join("") +
        "</div>"
      : "") +
    '<div class="dialogactions"><button class="btn primary" data-excel-close="1">关闭</button></div>';
  document.body.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-excel-close]")) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

async function importLedger(categoryId) {
  const target = excelTargetOf(categoryId);
  if (!target) return toast("当前分类不支持 Excel 导入");

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx";
  /* 必须挂进 DOM 再 click:游离节点的选择器在部分环境下不触发事件,
     自动化测试也拿不到它的节点句柄。 */
  input.hidden = true;
  document.body.append(input);
  input.addEventListener("cancel", () => input.remove(), { once: true });
  input.addEventListener("change", async () => {
    input.remove();
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      return notice("请使用小于 8 MiB 的固定 XLSX 模板。", true);
    }

    const policy = await chooseExcelDuplicatePolicy();
    if (!policy) return;

    const ws = VaultStore.ws;
    const query = `?policy=${encodeURIComponent(policy)}` +
      (target.kind === "archive" ? `&section=${encodeURIComponent(target.section)}` : "");
    try {
      const res = await api(`/api/v2/excel/${ws}/${target.kind}/import${query}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: file,
      });
      const report = await res.json();
      await refreshCurrent();
      showExcelImportReport(report);
    } catch (error) {
      notice("Excel 导入失败：" + error.message, true);
    }
  }, { once: true });
  input.click();
}

/* ---------------- 命令栏按钮 ---------------- */

/* 只有分类页(且该分类有台账)才显示这两个按钮。 */
function ledgerCategoryOf() {
  const id = Drive.state.folderId;
  if (typeof id !== "string" || !id.startsWith("k:")) return "";
  const category = id.slice(2);
  return excelTargetOf(category) ? category : "";
}

function renderExcelButtons() {
  const category = ledgerCategoryOf();
  const show = !!category && Drive.state.view !== "recycle" && Drive.state.ready;
  $("#excelActions")?.classList.toggle("hidden", !show);
  $("#excelSep")?.classList.toggle("hidden", !show);
}

function bindExcelActions() {
  $("#btnExcelExport")?.addEventListener("click", () => {
    const category = ledgerCategoryOf();
    if (category) void exportLedger(category);
  });
  $("#btnExcelImport")?.addEventListener("click", () => {
    const category = ledgerCategoryOf();
    if (category) void importLedger(category);
  });
}
