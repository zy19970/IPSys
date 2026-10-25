/* ==========================================================================
   业务表单 — OneDrive 风格的属性对话框
   --------------------------------------------------------------------------
   字段与后端 BusinessRules 的校验规则严格对齐:
     项目:名称必填、类型/状态白名单、日期 yyyy-MM-dd
     知产:名称必填、七种类型、状态随类型联动
     档案:名称必填、年度四位
   分类的中文名一律走 store.js 的 catLabel(section),按工作区取 ——
   个人工作区的 certificate 叫「身份与资质」,不是「企业资质」。
   ========================================================================== */

const IP_TYPES = {
  发明专利: ["准备中", "已申请", "已公开", "实质审查中", "已授权", "已失效"],
  实用新型专利: ["准备中", "已申请", "已授权", "已失效"],
  外观设计专利: ["准备中", "已申请", "已授权", "已失效"],
  软件著作权: ["准备中", "登记中", "已登记"],
  其他著作权: ["准备中", "登记中", "已登记"],
  商标: ["准备中", "申请中", "已注册", "已失效"],
  集成电路布图设计: ["准备中", "登记中", "已登记"],
  国家标准: ["准备中", "制定中", "已发布", "已废止"],
  行业标准: ["准备中", "制定中", "已发布", "已废止"],
  企业标准: ["准备中", "制定中", "已发布", "已废止"],
};

const RecordForms = {
  /* ---------------- 通用对话框 ---------------- */

  open({ title, fields, values = {}, submitText = "保存", onSubmit }) {
    const old = $("#formMask");
    old?.remove();

    const mask = document.createElement("div");
    mask.className = "mask show form-mask";
    mask.id = "formMask";

    const fieldHtml = (f) => {
      const v = values[f.key] ?? f.value ?? "";
      const cls = `field-item${f.span === 2 ? " span-2" : ""}`;
      let control = "";

      if (f.type === "select") {
        const opts = (f.options || []).map((o) => {
          const value = typeof o === "string" ? o : o.value;
          const label = typeof o === "string" ? o : o.label;
          return `<option value="${esc(value)}" ${String(value) === String(v) ? "selected" : ""}>${esc(label)}</option>`;
        });
        control = `<select data-key="${f.key}" ${f.required ? "required" : ""}>
          <option value="">${esc(f.placeholder || "请选择")}</option>${opts.join("")}</select>`;
      } else if (f.type === "textarea") {
        control = `<textarea data-key="${f.key}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`;
      } else if (f.type === "date") {
        control = `<input type="date" data-key="${f.key}" value="${esc(v)}">`;
      } else {
        control = `<input type="text" data-key="${f.key}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" ${
          f.required ? "required" : ""
        }>`;
      }

      return `<div class="${cls}">
        <label>${esc(f.label)}${f.required ? '<span class="req">*</span>' : ""}</label>
        ${control}
        ${f.hint ? `<small class="field-hint">${esc(f.hint)}</small>` : ""}
      </div>`;
    };

    mask.innerHTML = `
      <div class="dialog form-dialog">
        <div class="dlg-head">
          <h2>${esc(title)}</h2>
          <button class="icon-btn sm" data-close>${icon("close", 15)}</button>
        </div>
        <form class="dlg-body form-grid" novalidate>
          ${fields.map(fieldHtml).join("")}
        </form>
        <div class="dlg-foot">
          <span class="form-error" data-err></span>
          <span class="spacer"></span>
          <button class="btn" data-close>取消</button>
          <button class="btn solid" data-submit>${esc(submitText)}</button>
        </div>
      </div>`;

    document.body.append(mask);

    const close = () => mask.remove();
    mask.addEventListener("mousedown", (e) => {
      if (e.target === mask) close();
    });
    mask.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));

    /* 知产:类型变化时重建状态下拉 */
    const typeSel = mask.querySelector('[data-key="ipType"]');
    const statusSel = mask.querySelector('[data-key="status"]');
    if (typeSel && statusSel) {
      const sync = () => {
        const list = IP_TYPES[typeSel.value] || [];
        const cur = statusSel.value;
        statusSel.innerHTML =
          `<option value="">请选择</option>` +
          list.map((s) => `<option value="${s}" ${s === cur ? "selected" : ""}>${s}</option>`).join("");
      };
      typeSel.addEventListener("change", sync);
      sync();
    }

    const err = mask.querySelector("[data-err]");
    const submit = mask.querySelector("[data-submit]");

    const run = async () => {
      const data = {};
      let bad = null;
      mask.querySelectorAll("[data-key]").forEach((el) => {
        data[el.dataset.key] = el.value.trim();
        if (el.required && !data[el.dataset.key] && !bad) bad = el;
      });
      if (bad) {
        err.textContent = "请填写必填项";
        bad.focus();
        return;
      }
      err.textContent = "";
      submit.disabled = true;
      try {
        await onSubmit(data, (msg) => {
          err.textContent = msg;
        });
        close();
      } catch (e) {
        err.textContent = e.message || "保存失败";
      } finally {
        submit.disabled = false;
      }
    };

    submit.addEventListener("click", run);
    mask.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      run();
    });
    mask.querySelector("form").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        run();
      }
      if (e.key === "Escape") close();
    });

    setTimeout(() => mask.querySelector("[data-key]")?.focus(), 30);
    return mask;
  },

  /* ---------------- 项目 ---------------- */

  project(node) {
    const isEdit = !!node;
    const b = node?.biz || {};
    const r = b.raw || {};

    this.open({
      title: isEdit ? "项目属性" : "新建项目",
      submitText: isEdit ? "保存" : "创建",
      values: isEdit
        ? {
            name: r.name || "",
            projectType: r.projectType || "",
            projectNo: r.projectNo || "",
            leader: r.leader || "",
            undertakingOrg: r.undertakingOrg || "",
            projectStatus: r.projectStatus || "",
            startDate: r.startDate || "",
            endDate: r.endDate || "",
            category: r.category || "",
            tags: r.tags || "",
            remarks: r.remarks || "",
          }
        : {},
      fields: [
        { key: "name", label: "项目名称", span: 2, required: true },
        { key: "projectType", label: "项目类型", type: "select", options: ["科研项目", "横向项目", "其他项目"], required: true },
        { key: "projectNo", label: "项目编号" },
        { key: "projectStatus", label: "项目状态", type: "select", options: ["筹备中", "进行中", "已完成", "已终止"] },
        { key: "leader", label: "负责人" },
        { key: "undertakingOrg", label: "承担单位" },
        { key: "category", label: "类别" },
        { key: "startDate", label: "开始日期", type: "date" },
        { key: "endDate", label: "结束日期", type: "date" },
        { key: "tags", label: "标签", span: 2 },
        { key: "remarks", label: "备注", type: "textarea", span: 2 },
      ],
      onSubmit: async (d) => {
        const payload = {
          project: {
            name: d.name,
            projectType: d.projectType,
            projectNo: d.projectNo,
            leader: d.leader,
            undertakingOrg: d.undertakingOrg,
            startDate: d.startDate,
            endDate: d.endDate,
            projectStatus: d.projectStatus,
            category: d.category,
            remarks: d.remarks,
            tags: d.tags,
          },
        };
        if (isEdit) {
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/project/${b.id}`, { method: "PUT", json: payload });
        } else {
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/project`, { method: "POST", json: payload });
        }
        toast(isEdit ? "项目已保存" : "项目已创建");
        await refreshCurrent();
      },
    });
  },

  /* ---------------- 档案（资质 / 成果 / 学术） ---------------- */

  archive(section, node, parentId = null) {
    const isEdit = !!node;
    const b = node?.biz || {};
    const r = b.raw || {};
    const sec = section || b.section || "certificate";
    const label = catLabel(sec);

    this.open({
      title: isEdit ? `${label}属性` : `新建${label}`,
      submitText: isEdit ? "保存" : "创建",
      values: isEdit
        ? {
            name: r.name || "",
            category: r.category || "",
            year: r.year || "",
            tags: r.tags || "",
            remarks: r.remarks || "",
          }
        : {},
      fields: [
        { key: "name", label: "名称", span: 2, required: true },
        { key: "category", label: "类别" },
        { key: "year", label: "年度", placeholder: "如 2026" },
        { key: "tags", label: "标签", span: 2 },
        {
          key: "remarks",
          label: "备注",
          type: "textarea",
          span: 2,
          hint: sec === "certificate" ? "备注里可写明有效期(如 2027-06-30),方便到期前查找" : "",
        },
      ],
      onSubmit: async (d) => {
        const payload = {
          archive: {
            name: d.name,
            category: d.category,
            year: d.year,
            remarks: d.remarks,
            tags: d.tags,
          },
          section: sec,
        };
        if (isEdit) {
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/archive/${b.id}?section=${encodeURIComponent(sec)}`, {
            method: "PUT",
            json: payload,
          });
        } else {
          /* 站在业务档案的目录里新建 → 记到该目录下(parentId) */
          if (parentId != null) payload.archive.folderId = Number(parentId);
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/archive?section=${encodeURIComponent(sec)}`, {
            method: "POST",
            json: payload,
          });
        }
        toast(isEdit ? "已保存" : "已创建");
        await refreshCurrent();
      },
    });
  },

  /* ---------------- 知识产权 ---------------- */

  ip(node) {
    const isEdit = !!node;
    const b = node?.biz || {};
    const r = b.raw || {};

    this.open({
      title: isEdit ? "知识产权属性" : "新建知识产权",
      submitText: isEdit ? "保存" : "创建",
      values: isEdit
        ? {
            name: r.name || "",
            ipType: r.ipType || "",
            status: r.status || "",
            number: r.number || "",
            publicationNo: r.publicationNo || "",
            grantNoticeNo: r.grantNoticeNo || "",
            applicationDate: r.applicationDate || "",
            applicants: r.applicants || "",
            rightHolders: r.rightHolders || "",
            creators: r.creators || "",
            grantDate: r.grantDate || "",
            category: r.category || "",
            tags: r.tags || "",
            remarks: r.remarks || "",
          }
        : {},
      fields: [
        { key: "name", label: "名称", span: 2, required: true },
        { key: "ipType", label: "类型", type: "select", options: Object.keys(IP_TYPES), required: true },
        { key: "status", label: "状态", type: "select" },
        { key: "number", label: "编号", hint: "专利填申请号，著作权填登记号，商标填申请/注册号，标准填标准号" },
        { key: "publicationNo", label: "公开号", hint: "仅专利有此编号时填写，其余类型留空" },
        { key: "grantNoticeNo", label: "授权公告号", hint: "仅专利有此编号时填写，其余类型留空" },
        { key: "applicationDate", label: "申请日", type: "date" },
        { key: "grantDate", label: "授权日", type: "date" },
        { key: "category", label: "类别" },
        { key: "applicants", label: "申请人" },
        { key: "rightHolders", label: "权利人" },
        { key: "creators", label: "发明人" },
        { key: "tags", label: "标签", span: 2 },
        { key: "remarks", label: "备注", type: "textarea", span: 2 },
      ],
      onSubmit: async (d) => {
        const payload = {
          ip: {
            // Keep optional metadata not displayed in the compact form,
            // such as notice/registration dates and publication information.
            ...r,
            name: d.name,
            ipType: d.ipType,
            status: d.status,
            applicants: d.applicants,
            rightHolders: d.rightHolders,
            creators: d.creators,
            number: d.number,
            publicationNo: d.publicationNo,
            grantNoticeNo: d.grantNoticeNo,
            applicationDate: d.applicationDate,
            grantDate: d.grantDate,
            category: d.category,
            remarks: d.remarks,
            tags: d.tags,
          },
        };
        if (isEdit) {
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/ip/${b.id}`, { method: "PUT", json: payload });
        } else {
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/ip`, { method: "POST", json: payload });
        }
        toast(isEdit ? "已保存" : "已创建");
        await refreshCurrent();
      },
    });
  },

  /* ---------------- 综合资料 ---------------- */

  general(node) {
    const isEdit = !!node;
    const b = node?.biz || {};
    const r = b.raw || {};

    this.open({
      title: isEdit ? "资料属性" : "新建资料",
      submitText: isEdit ? "保存" : "创建",
      values: isEdit ? { title: r.title || node.name || "" } : {},
      fields: [{ key: "title", label: "资料名称", span: 2, required: true }],
      onSubmit: async (d) => {
        if (isEdit) {
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/general/${b.id}`, {
            method: "PUT",
            json: { general: { title: d.title } },
          });
        } else {
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/general`, {
            method: "POST",
            json: { general: { title: d.title } },
          });
        }
        toast(isEdit ? "已保存" : "已创建");
        await refreshCurrent();
      },
    });
  },

  /* ---------------- 合同 ----------------
     合同跟着项目走,必须有归属项目:编辑时取节点自己的 projectId,
     新建时由调用方(项目节点的新建入口)传进来。拿不到归属就拒绝,
     不允许建出挂不上树的合同。 */
  contract(node, parentId) {
    const isEdit = !!node;
    const b = node?.biz || {};
    const r = b.raw || {};
    const ownerId = isEdit ? b.projectId : parentId;
    if (!ownerId) {
      toast("请在项目内新建合同");
      return;
    }

    this.open({
      title: isEdit ? "合同属性" : "新建合同",
      submitText: isEdit ? "保存" : "创建",
      values: isEdit
        ? {
            name: r.name || "",
            contractNo: r.contractNo || "",
            signDate: r.signDate || "",
            amount: r.amount || "",
            signingParties: r.signingParties || "",
            category: r.category || "",
            tags: r.tags || "",
            remarks: r.remarks || "",
          }
        : {},
      fields: [
        { key: "name", label: "合同名称", span: 2, required: true },
        { key: "contractNo", label: "合同编号" },
        { key: "signDate", label: "签订日期", type: "date" },
        { key: "amount", label: "合同金额" },
        { key: "signingParties", label: "签约方" },
        { key: "category", label: "类别" },
        { key: "tags", label: "标签", span: 2 },
        { key: "remarks", label: "备注", type: "textarea", span: 2 },
      ],
      onSubmit: async (d) => {
        const payload = {
          contract: {
            name: d.name,
            contractNo: d.contractNo,
            signDate: d.signDate,
            amount: d.amount,
            signingParties: d.signingParties,
            category: d.category,
            tags: d.tags,
            remarks: d.remarks,
          },
        };
        if (isEdit) {
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/contract/${b.id}`, {
            method: "PUT",
            json: payload,
          });
        } else {
          payload.parentId = Number(ownerId);
          await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/contract`, {
            method: "POST",
            json: payload,
          });
        }
        toast(isEdit ? "已保存" : "已创建");
        await refreshCurrent();
      },
    });
  },

  /* ---------------- 所有格式附件共用文件属性 ---------------- */

  async file(node) {
    const meta = VaultStore.metaOf(node?.id);
    if (!meta?.fileId || node?.type !== "file") return toast("附件信息缺失，无法编辑属性");
    const workspace = VaultStore.ws;
    const id = meta.fileId;
    try {
      const url = `/api/v2/files/${encodeURIComponent(workspace)}/${id}`;
      const current = await VaultStore.getJson(url);
      if (VaultStore.ws !== workspace || !current) return;
      this.open({
        title: "文件属性",
        values: {
          name: current.name || "",
          description: current.description || "",
          tags: current.tags || "",
          fileNumber: current.fileNumber || "",
          fileDate: current.fileDate || "",
        },
        fields: [
          { key: "name", label: "文件名称", span: 2, required: true },
          { key: "description", label: "文件说明", type: "textarea", span: 2 },
          { key: "tags", label: "标签", span: 2, hint: "多个标签用中文或英文分号分隔，保存时自动去重" },
          { key: "fileNumber", label: "文件编号" },
          { key: "fileDate", label: "文件日期", type: "date" },
        ],
        onSubmit: async (data) => {
          if (VaultStore.ws !== workspace) throw new Error("工作区已切换，请重新打开文件属性");
          await VaultStore.api(url + "/metadata", { method: "PUT", json: {
            name: data.name, description: data.description, tags: data.tags,
            fileNumber: data.fileNumber, fileDate: data.fileDate,
          }});
          toast("文件属性已保存");
          await refreshCurrent();
        },
      });
    } catch (e) {
      toast("无法加载文件属性：" + (e.message || String(e)), { tone: "error" });
    }
  },

  /* ---------------- 分发 ---------------- */

  edit(node) {
    const kind = node?.biz?.kind;
    if (kind === "project") return this.project(node);
    if (kind === "contract") return this.contract(node);
    if (kind === "archive") return this.archive(node.biz.section, node);
    if (kind === "ip") return this.ip(node);
    if (kind === "general") return this.general(node);
    if (kind === "file") return this.file(node);
    toast("这条记录没有可编辑的业务字段");
  },
};
