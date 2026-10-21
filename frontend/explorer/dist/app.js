/* 资料库前端 — 由 tools/bundle.cjs 生成,请勿直接编辑。
   源文件: js/icons.js → js/data.js → js/store.js → js/app.js → js/forms.js → js/interactions.js */

/* ===== js/icons.js ===== */
/* ==========================================================================
   Fluent-style icon set — 24x24 grid, 1.6px stroke, round caps
   ========================================================================== */

const ICON_PATHS = {
  search: '<circle cx="10.8" cy="10.8" r="6.4"/><path d="M15.6 15.6 20 20"/>',
  help: '<circle cx="12" cy="12" r="8.6"/><path d="M9.7 9.5a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1 .9-1 1.8"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  settings: '<circle cx="12" cy="12" r="2.7"/><path d="M12 3.4v1.9M12 18.7v1.9M20.6 12h-1.9M5.3 12H3.4M18.1 5.9l-1.35 1.35M7.25 16.75 5.9 18.1M18.1 18.1l-1.35-1.35M7.25 7.25 5.9 5.9"/>',
  home: '<path d="M4.5 10.4 12 4l7.5 6.4"/><path d="M6.4 9.4V19a1 1 0 0 0 1 1h3.1v-4.6h3v4.6h3.1a1 1 0 0 0 1-1V9.4"/>',
  folder: '<path d="M3.6 7.4a1.6 1.6 0 0 1 1.6-1.6h3.3l1.6 1.9h7.7a1.6 1.6 0 0 1 1.6 1.6v7.2a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z"/>',
  photo: '<rect x="3.8" y="5.2" width="16.4" height="13.6" rx="2"/><circle cx="8.9" cy="9.9" r="1.5"/><path d="M4.4 16.6l4.1-4a1.4 1.4 0 0 1 2 0l3 3M13 14.4l1.7-1.7a1.4 1.4 0 0 1 2 0l2.9 2.9"/>',
  user: '<circle cx="12" cy="8.4" r="3.4"/><path d="M5.2 19.4c0-3.1 3-5.2 6.8-5.2s6.8 2.1 6.8 5.2"/>',
  /* 默认头像:实心人形剪影,直接放进圆形头像按钮里(不用文字首字) */
  avatar:
    '<circle cx="12" cy="8.7" r="4.1" fill="currentColor" stroke="none"/>' +
    '<path d="M12 14.4c-4.5 0-8.1 2.5-8.1 5.6v.3c0 .7.6 1.3 1.3 1.3h13.6c.7 0 1.3-.6 1.3-1.3v-.3c0-3.1-3.6-5.6-8.1-5.6z" fill="currentColor" stroke="none"/>',
  building: '<path d="M4.9 19.4V6.3a1.5 1.5 0 0 1 1.5-1.5h6a1.5 1.5 0 0 1 1.5 1.5v13.1"/><path d="M13.9 10.6h3.7a1.5 1.5 0 0 1 1.5 1.5v7.3"/><path d="M3.4 19.4h17.2"/><path d="M7.6 8.3h2.4M7.6 11.6h2.4M7.6 14.9h2.4"/>',
  trash: '<path d="M4.8 7.2h14.4M9.4 7.2V5.4a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v1.8"/><path d="M6.6 7.2l.8 11.2a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3l.8-11.2"/><path d="M10.4 10.6v5.6M13.6 10.6v5.6"/>',
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  upload: '<path d="M12 16.2V4.8"/><path d="M7.8 9 12 4.8 16.2 9"/><path d="M4.6 15.4v2.2a1.8 1.8 0 0 0 1.8 1.8h11.2a1.8 1.8 0 0 0 1.8-1.8v-2.2"/>',
  download: '<path d="M12 4.8v11.4"/><path d="M7.8 12 12 16.2 16.2 12"/><path d="M4.6 15.4v2.2a1.8 1.8 0 0 0 1.8 1.8h11.2a1.8 1.8 0 0 0 1.8-1.8v-2.2"/>',
  sort: '<path d="M4.8 7.4h9M4.8 12h6.4M4.8 16.6h3.6"/><path d="M17.4 8.2v9.2M17.4 17.4l2.4-2.4M17.4 17.4 15 15"/>',
  listView: '<path d="M8.4 6.6h10.8M8.4 12h10.8M8.4 17.4h10.8"/><circle cx="4.9" cy="6.6" r=".9" fill="currentColor" stroke="none"/><circle cx="4.9" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="4.9" cy="17.4" r=".9" fill="currentColor" stroke="none"/>',
  gridView: '<rect x="4.4" y="4.4" width="6.2" height="6.2" rx="1.2"/><rect x="13.4" y="4.4" width="6.2" height="6.2" rx="1.2"/><rect x="4.4" y="13.4" width="6.2" height="6.2" rx="1.2"/><rect x="13.4" y="13.4" width="6.2" height="6.2" rx="1.2"/>',
  chevronDown: '<path d="M6.4 9.4 12 15l5.6-5.6"/>',
  chevronUp: '<path d="M6.4 14.6 12 9l5.6 5.6"/>',
  more: '<circle cx="6.2" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="17.8" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
  rename: '<path d="M14.8 5.6l3.6 3.6"/><path d="M4.8 19.2l.9-4.4L15.9 4.6a1.6 1.6 0 0 1 2.3 0l1.2 1.2a1.6 1.6 0 0 1 0 2.3L9.2 18.3z"/>',
  copy: '<rect x="8.6" y="8.6" width="10.6" height="10.6" rx="1.8"/><path d="M15.4 5.4H6.2a1.8 1.8 0 0 0-1.8 1.8v9.2"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4"/><circle cx="12" cy="7.9" r=".95" fill="currentColor" stroke="none"/>',
  close: '<path d="M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/>',
  check: '<path d="M4.8 12.6l4.6 4.6L19.2 7.6"/>',
  refresh: '<path d="M19.2 12a7.2 7.2 0 1 1-2.3-5.3"/><path d="M19.6 4.8v4.4h-4.4"/>',
  star: '<path d="M12 4.4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 10.1l5.4-.8z"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2"/>',
  cloud: '<path d="M7.4 18.2a4.2 4.2 0 0 1-.3-8.4 5.4 5.4 0 0 1 10.3-1.1 3.9 3.9 0 0 1 .2 9.5z"/>',
  eye: '<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.7"/>',
  restore: '<path d="M4.4 12a7.6 7.6 0 1 0 2.4-5.5"/><path d="M4 4.8v4.4h4.4"/>',
  trashForever: '<path d="M4.8 7.2h14.4M9.4 7.2V5.4a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v1.8"/><path d="M6.6 7.2l.8 11.2a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3l.8-11.2"/><path d="M10.2 10.8l3.6 3.6M13.8 10.8l-3.6 3.6"/>',
  filter: '<path d="M4.4 6.6h15.2M7.2 12h9.6M10.2 17.4h3.6"/>',
  minus: '<path d="M5.2 12h13.6"/>',
  folderPlus: '<path d="M3.6 7.4a1.6 1.6 0 0 1 1.6-1.6h3.3l1.6 1.9h7.7a1.6 1.6 0 0 1 1.6 1.6v7.2a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z"/><path d="M12 10.6v5M9.5 13.1h5"/>',
  doc: '<path d="M6.2 4.6h7.4l4.2 4.2v10.6a1.2 1.2 0 0 1-1.2 1.2H6.2a1.2 1.2 0 0 1-1.2-1.2V5.8a1.2 1.2 0 0 1 1.2-1.2z"/><path d="M13.4 4.8v4.4h4.4"/>',
  image: '<rect x="3.8" y="5.2" width="16.4" height="13.6" rx="2"/><circle cx="8.9" cy="9.9" r="1.5"/><path d="M4.4 16.6l4.1-4a1.4 1.4 0 0 1 2 0l3 3M13 14.4l1.7-1.7a1.4 1.4 0 0 1 2 0l2.9 2.9"/>',
  play: '<circle cx="12" cy="12" r="8.6"/><path d="M10.2 8.8l5.4 3.2-5.4 3.2z"/>',
  archive: '<rect x="4.2" y="4.6" width="15.6" height="4.4" rx="1"/><path d="M5.4 9v9.4a1.2 1.2 0 0 0 1.2 1.2h10.8a1.2 1.2 0 0 0 1.2-1.2V9"/><path d="M10 12.4h4"/>',
  brief: '<rect x="3.6" y="7.4" width="16.8" height="12.1" rx="2"/><path d="M9 7.4V5.6a1.4 1.4 0 0 1 1.4-1.4h3.2A1.4 1.4 0 0 1 15 5.6v1.8"/><path d="M3.8 12.5h16.4"/>',
  cert: '<circle cx="12" cy="9.2" r="4.7"/><path d="M9.3 13.1 8 20.4l4-2.3 4 2.3-1.3-7.3"/>',
  shield: '<path d="M12 3.6 18.9 6v6.3c0 4-3 7.1-6.9 8.2-3.9-1.1-6.9-4.2-6.9-8.2V6z"/><path d="M9.3 12.1l2 2 3.5-3.8"/>',
  trophy: '<path d="M8.2 4.4h7.6v4.1a3.8 3.8 0 0 1-7.6 0z"/><path d="M8.2 5.9H6a1.9 1.9 0 0 0 1.9 3.2M15.8 5.9H18a1.9 1.9 0 0 1-1.9 3.2"/><path d="M12 12.3v3.3"/><path d="M8.9 19.6h6.2"/><path d="M10.2 15.6h3.6l.6 4H9.6z"/>',
  book: '<path d="M5.2 5.4a1.7 1.7 0 0 1 1.7-1.7h11.9v14.8H6.9a1.7 1.7 0 0 0-1.7 1.7z"/><path d="M5.2 18.9a1.7 1.7 0 0 1 1.7-1.7h11.9"/><path d="M8.8 7.6h6.2M8.8 10.6h4.2"/>',
};

function icon(name, size = 20, extraClass = "") {
  const p = ICON_PATHS[name];
  if (!p) return "";
  return `<svg class="${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* ---------- OneDrive brand mark ----------
   渐变 id 必须按实例唯一:登录层是 display:none 时,
   它内部定义的渐变不参与绘制,顶栏复用同名 id 就会变成透明。 */

function brandLogo(size = 26, uid = "a") {
  const g1 = `odg-${uid}-1`;
  const g2 = `odg-${uid}-2`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="${g1}" x1="5" y1="7" x2="23" y2="23" gradientUnits="userSpaceOnUse">
        <stop stop-color="#4FA8F5"/><stop offset="1" stop-color="#0B5CAB"/>
      </linearGradient>
      <linearGradient id="${g2}" x1="4" y1="10" x2="20" y2="24" gradientUnits="userSpaceOnUse">
        <stop stop-color="#7CC4FA"/><stop offset="1" stop-color="#2E8DE0"/>
      </linearGradient>
    </defs>
    <!-- 一层云:左、顶、右三个圆 + 底部圆角矩形,同色填充自然合成一个轮廓 -->
    <g fill="url(#${g1})">
      <circle cx="10.2" cy="15.1" r="5.3"/>
      <circle cx="16.4" cy="11.9" r="5.1"/>
      <circle cx="21.4" cy="15.7" r="4.4"/>
      <rect x="6.3" y="14.3" width="17.6" height="7.5" rx="3.75"/>
    </g>
    <!-- 左上高光,制造体积感 -->
    <ellipse cx="10.1" cy="12.7" rx="4.1" ry="3.1" fill="url(#${g2})" opacity=".9"/>
  </svg>`;
}

/* ---------- File type icons ----------
   按扩展名给一个中性色标,页脚显示扩展名本身。
   不使用 W / X / P 这类 Office 产品字母徽章。 */

const FILE_TINT = {
  doc: "#4A6FA5", docx: "#4A6FA5", odt: "#4A6FA5", rtf: "#4A6FA5", wps: "#4A6FA5",
  xls: "#3F7F5F", xlsx: "#3F7F5F", csv: "#3F7F5F", ods: "#3F7F5F", et: "#3F7F5F",
  ppt: "#B05A3C", pptx: "#B05A3C", odp: "#B05A3C", dps: "#B05A3C",
  pdf: "#C0392B",
  txt: "#6B7280", log: "#6B7280", md: "#6B7280", json: "#6B7280",
  xml: "#6B7280", yml: "#6B7280", ini: "#6B7280",
  zip: "#A6752C", rar: "#A6752C", "7z": "#A6752C", tar: "#A6752C", gz: "#A6752C",
};

const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
const VID_EXT = ["mp4", "mov", "avi", "mkv", "webm"];
const AUD_EXT = ["mp3", "wav", "flac", "aac", "m4a"];

function fileIcon(name, size = 20) {
  const ext = (name.split(".").pop() || "").toLowerCase();

  if (IMG_EXT.includes(ext) || VID_EXT.includes(ext) || AUD_EXT.includes(ext)) {
    const tint = IMG_EXT.includes(ext) ? "#2E7A6F" : VID_EXT.includes(ext) ? "#6E5AA6" : "#9B4A55";
    const glyph = IMG_EXT.includes(ext)
      ? `<circle cx="8.6" cy="8.4" r="1.2" fill="#fff" opacity=".9"/>
         <path d="M4.6 15.6l3.2-3.1 2.4 2.3M11 13.6l1.6-1.5 2.6 2.6" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`
      : VID_EXT.includes(ext)
      ? `<path d="M9.4 7.6l5.2 3.4-5.2 3.4z" fill="#fff" opacity=".92"/>`
      : `<path d="M9 10.6v4M12 9.4v6.4M15 10.2v5" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".92"/>`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.2" y="5" width="17.6" height="14" rx="2.4" fill="${tint}"/>
      ${glyph}
    </svg>`;
  }

  const tint = FILE_TINT[ext] || "#8A8F98";
  const label = (ext || "?").slice(0, 4).toUpperCase();
  const fs = label.length >= 4 ? 3.5 : label.length === 3 ? 4.1 : label.length === 2 ? 5.1 : 6;
  const baseline = 14.6 + fs * 0.36;

  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6.1 3.5h7.5l4.6 4.6v12.4a1.2 1.2 0 0 1-1.2 1.2H6.1a1.2 1.2 0 0 1-1.2-1.2V4.7a1.2 1.2 0 0 1 1.2-1.2z"
          fill="#fff" stroke="${tint}" stroke-width="1.15"/>
    <path d="M13.3 3.7v4.5h4.4" fill="none" stroke="${tint}" stroke-width="1.05"/>
    <rect x="3.5" y="11.4" width="13.4" height="6.3" rx="1.2" fill="${tint}"/>
    <text x="10.2" y="${baseline.toFixed(2)}" font-size="${fs}" font-weight="700" fill="#fff"
          text-anchor="middle" font-family="Segoe UI, sans-serif" letter-spacing="-.15">${label}</text>
  </svg>`;
}

/* ---------- Folder icon ----------
   单用户网盘没有共享态,文件夹统一一种琥珀色。 */

function folderIcon(size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M2.8 7.1a1.6 1.6 0 0 1 1.6-1.6h4.3l1.9 2.1h7.6a1.6 1.6 0 0 1 1.6 1.6v9.2a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6z"
          fill="#EFA90B"/>
    <path d="M4.4 11.2h15.2a.9.9 0 0 1 .88 1.06l-1.16 6.4a1.5 1.5 0 0 1-1.48 1.24H4.4a.9.9 0 0 1-.9-.9v-6.9a.9.9 0 0 1 .9-.9z"
          fill="#FFC83D"/>
    <path d="M4.4 11.2h15.2a.9.9 0 0 1 .88 1.06l-.1.54H5.3a.9.9 0 0 0-.87.66l-.93 3.3v-4.66a.9.9 0 0 1 .9-.9z"
          fill="#E39C08" opacity=".45"/>
  </svg>`;
}

/* ---------- 固定分类图标 ----------
   分类是系统预置的归档类型,不是用户自己建的目录,所以不用文件夹形状。
   类型 → 图标 + 固定色,换数据源、换工作区都不变。
   记录(装附件的归档单元)仍然是文件夹,两者一眼能分开。 */

const CAT_TYPES = {
  project:     { glyph: "brief",   color: "#0F6CBD", soft: "#E8F1FB" },
  certificate: { glyph: "cert",    color: "#A9760A", soft: "#FBF2DE" },
  achievement: { glyph: "trophy",  color: "#C2410C", soft: "#FCEDE5" },
  academic:    { glyph: "book",    color: "#0F7B7B", soft: "#E3F4F4" },
  ip:          { glyph: "shield",  color: "#2F6B4F", soft: "#E7F3EC" },
  general:     { glyph: "archive", color: "#5B6570", soft: "#EFF1F3" },
};

function hasCat(section) {
  return Object.prototype.hasOwnProperty.call(CAT_TYPES, section);
}

/* plate = 带浅色底的方块,用在分类目录、网格、详情大图这类需要份量的位置;
   普通尺寸只给描边图标,避免导航被色块压住。 */
function catIcon(section, size = 20, plate = false) {
  const t = CAT_TYPES[section] || CAT_TYPES.general;
  const path = ICON_PATHS[t.glyph] || ICON_PATHS.archive;
  const g = plate ? Math.round(size * 0.54) : size;
  const svg = `<svg width="${g}" height="${g}" viewBox="0 0 24 24" fill="none" stroke="${t.color}"
    stroke-width="${plate ? 1.7 : 1.65}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

  if (!plate) return svg;
  return `<span class="cat-plate" style="width:${size}px;height:${size}px;background:${t.soft}" aria-hidden="true">${svg}</span>`;
}


/* ===== js/data.js ===== */
/* ==========================================================================
   数据层基础 — 树模型 + 格式化工具
   --------------------------------------------------------------------------
   节点结构与 Microsoft Graph driveItem 同构:
     { id, name, type, size, mtime, children[], biz }

   biz 是本系统特有的扩展:保存业务记录(项目/合同/资质/知产/资料)的原始字段,
   供右侧详细信息面板与表单读取。文件节点没有 biz。

   真实数据由 store.js 从后端拉取后填充 ROOT / RECYCLE;
   data.js 只负责模型定义与工具函数,不产生任何假数据。
   ========================================================================== */

const ME = { name: "陈明远", initials: "陈" };

/* 可变根节点 —— store.js 加载完成后替换 children */
let ROOT = { id: "root", name: "我的文件", type: "folder", mtime: null, children: [] };
let RECYCLE = [];

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const DAY = 86400000;

let _uid = 0;
const uid = (p) => `${p}-${++_uid}`;

const F = (name, opts = {}) => ({
  id: opts.id ?? uid("f"),
  name,
  type: "folder",
  mtime: opts.mtime ?? null,
  children: opts.children ?? [],
  biz: opts.biz ?? null,
  synthetic: opts.synthetic ?? false,
});

const D = (name, size, opts = {}) => ({
  id: opts.id ?? uid("f"),
  name,
  type: "file",
  size: size ?? 0,
  mtime: opts.mtime ?? null,
  starred: opts.starred ?? false,
  biz: opts.biz ?? null,
});

/* ---------- 树遍历 ---------- */

function walk(node, fn, parents = []) {
  fn(node, parents);
  if (node.children) {
    for (const c of node.children) walk(c, fn, [...parents, node]);
  }
}

function findById(id, node = ROOT) {
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const hit = findById(id, c);
    if (hit) return hit;
  }
  return null;
}

function findParent(id, node = ROOT) {
  for (const c of node.children || []) {
    if (c.id === id) return node;
    const hit = findParent(id, c);
    if (hit) return hit;
  }
  return null;
}

function pathTo(id, node = ROOT, acc = []) {
  if (node.id === id) return [...acc, node];
  for (const c of node.children || []) {
    const hit = pathTo(id, c, [...acc, node]);
    if (hit) return hit;
  }
  return null;
}

function allFiles(node = ROOT, acc = []) {
  for (const c of node.children || []) {
    if (c.type === "file") acc.push(c);
    else allFiles(c, acc);
  }
  return acc;
}

/* 递归统计文件夹内的文件数与总字节数 */
function folderStats(node) {
  let count = 0;
  let bytes = 0;
  for (const c of node.children || []) {
    if (c.type === "file") {
      count++;
      bytes += c.size || 0;
    } else {
      const s = folderStats(c);
      count += s.count;
      bytes += s.bytes;
    }
  }
  return { count, bytes };
}

/* ---------- 格式化 ---------- */

function fmtSize(bytes) {
  if (bytes == null) return "";
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(0)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(2)} GB`;
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d)) return "—";
  const t = Date.now();
  const startOfToday = new Date(t).setHours(0, 0, 0, 0);
  const diffDays = Math.floor((startOfToday - new Date(ts).setHours(0, 0, 0, 0)) / DAY);

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");

  if (diffDays === 0) return `今天 ${hh}:${mm}`;
  if (diffDays === 1) return `昨天 ${hh}:${mm}`;
  if (diffDays > 1 && diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 0) {
    const ahead = -diffDays;
    if (ahead === 1) return "明天";
    if (ahead < 7) return `${ahead} 天后`;
  }
  if (d.getFullYear() === new Date().getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtDateLong(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d)) return "—";
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function extOf(name) {
  const i = (name || "").lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/* --------------------------------------------------------------------------
   中文按拼音排序 —— 与 Windows 资源管理器 / OneDrive 一致。
   浏览器 ICU 对中文 collation 的覆盖不可靠(实测 Edge 退化为码点序),
   所以这里显式给出首字拼音;首字相同再退回 localeCompare。
   -------------------------------------------------------------------------- */
const PY_HEAD = {
  我: "wo", 工: "gong", 项: "xiang", 智: "zhi", 对: "dui", 设: "she", 团: "tuan",
  财: "cai", 法: "fa", 制: "zhi", 合: "he", 招: "zhao", 组: "zu", 印: "yin",
  需: "xu", 系: "xi", 接: "jie", 验: "yan", 差: "cha", 技: "ji", 启: "qi",
  图: "tu", 色: "se", 年: "nian", 安: "an", 矿: "kuang", 颁: "ban", 费: "fei",
  旅: "lv", 经: "jing", 产: "chan", 客: "ke", 会: "hui", 数: "shu", 公: "gong",
  未: "wei", 旧: "jiu", 废: "fei", 重: "chong", 临: "lin", 集: "ji", 月: "yue",
  供: "gong", 第: "di", 季: "ji", 员: "yuan", 预: "yu", 战: "zhan", 培: "pei",
  销: "xiao", 仓: "cang", 文: "wen", 章: "zhang", 用: "yong", 登: "deng",
  记: "ji", 表: "biao", 依: "yi", 标: "biao", 指: "zhi", 距: "ju", 分: "fen",
  析: "xi", 报: "bao", 告: "gao", 调: "diao", 研: "yan", 问: "wen", 卷: "juan",
  方: "fang", 案: "an", 里: "li", 程: "cheng", 碑: "bei", 页: "ye", 规: "gui",
  范: "fan", 统: "tong", 总: "zong", 览: "lan", 建: "jian", 影: "ying", 议: "yi",
  现: "xian", 场: "chang", 察: "cha", 仪: "yi", 式: "shi", 度: "du", 明: "ming",
  细: "xi", 准: "zhun", 品: "pin", 周: "zhou", 拜: "bai", 访: "fang", 录: "lu",
  汇: "hui", 纪: "ji", 要: "yao", 据: "ju", 备: "bei", 份: "fen", 训: "xun",
  终: "zhong", 版: "ban", 命: "ming", 档: "dang", 初: "chu", 稿: "gao", 副: "fu",
  本: "ben", 资: "zi", 料: "liao", 能: "neng", 山: "shan", 期: "qi", 流: "liu",
  排: "pai", 时: "shi", 间: "jian", 活: "huo", 动: "dong", 添: "tian", 加: "jia",
  上: "shang", 传: "chuan", 收: "shou", 站: "zhan", 首: "shou", 照: "zhao",
  片: "pian", 专: "zhuan", 利: "li", 著: "zhu", 作: "zuo", 权: "quan", 商: "shang",
  软: "ruan", 件: "jian", 证: "zheng", 书: "shu", 许: "xu", 可: "ke", 资: "zi",
  质: "zhi", 等: "deng", 级: "ji", 荣: "rong", 誉: "yu", 奖: "jiang", 励: "li",
  科: "ke", 成: "cheng", 果: "guo", 学: "xue", 术: "shu", 综: "zong", 管: "guan",
  理: "li", 制: "zhi", 度: "du", 办: "ban", 法: "fa", 通: "tong", 知: "zhi",
  会: "hui", 计: "ji", 审: "shen", 计: "ji", 税: "shui", 务: "wu", 人: "ren",
  事: "shi", 行: "xing", 政: "zheng", 党: "dang", 建: "jian", 工: "gong",
  国: "guo", 尾: "wei", 选: "xuan", 申: "shen", 其: "qi", 企: "qi", 业: "ye",
};

function pinyinHead(name) {
  const ch = (name || "")[0] || "";
  return PY_HEAD[ch] || ch.toLowerCase();
}

function cmpName(a, b) {
  const pa = pinyinHead(a.name);
  const pb = pinyinHead(b.name);
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
}

/* 类型名只按扩展名归类,不绑定任何 Office 产品名。 */
function typeLabel(item) {
  if (item.type === "folder") return item.biz?.typeName || "文件夹";
  const ext = extOf(item.name);
  const kind = {
    doc: "文档", docx: "文档", odt: "文档", rtf: "文档", wps: "文档",
    xls: "表格", xlsx: "表格", csv: "表格", ods: "表格", et: "表格",
    ppt: "演示文稿", pptx: "演示文稿", odp: "演示文稿", dps: "演示文稿",
    pdf: "PDF 文档",
    txt: "文本文档", log: "日志文件", md: "Markdown 文件", json: "JSON 文件",
    zip: "压缩文件", rar: "压缩文件", "7z": "压缩文件", tar: "压缩文件", gz: "压缩文件",
    png: "PNG 图像", jpg: "JPEG 图像", jpeg: "JPEG 图像", gif: "GIF 图像",
    webp: "WebP 图像", svg: "SVG 图像", bmp: "BMP 图像",
    mp4: "视频", mov: "视频", mkv: "视频", avi: "视频",
    mp3: "音频", wav: "音频", flac: "音频", m4a: "音频",
  }[ext];
  return `${ext.toUpperCase()} ${kind || "文件"}`;
}

function isImage(item) {
  return item.type === "file" && ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(extOf(item.name));
}


/* ===== js/store.js ===== */
/* ==========================================================================
   Store — 业务数据 → OneDrive 文件树
   --------------------------------------------------------------------------
   本系统没有"文件系统",只有台账记录。为了让界面真正是 OneDrive 的交互,
   这里做一层语义映射:

     每条业务记录(项目/资质/成果/知产/资料)  →  一个文件夹
     每个该记录下挂的附件                        →  文件夹里的文件

   于是"双击进入项目看附件""右键删除一条资质""拖拽文件到项目里"
   全部复用 OneDrive 原生交互,不需要另造一套表格操作。

   业务字段完整保留在 node.biz 里,由右侧详细信息面板与表单消费。
   ========================================================================== */

/* 业务记录本身没有"修改时间",用业务上的关键日期作为时间轴。
   这是真实字段,不是补造数据;没有日期就留空,界面显示为「—」。 */
const toTs = (s) => {
  if (!s) return null;
  const str = String(s).trim();
  const d = new Date(str.length === 4 ? str + "-01-01" : str);
  return isNaN(d) ? null : d.getTime();
};

/* ---------------- 分类目录 ----------------
   工作区不同,分类的名称、顺序、有无都不一样。这张表是唯一权威:
   导航、首页、表头、新建菜单、详情面板、回收站全部从这里取名字,
   不要在别处再写一遍中文名。

   来源:E:/Github/管理系统/src/IPSys.Web/wwwroot/app.js companyNav / personalNav。
   合同不在其中 —— 它不是业务模块(老系统里只能从项目详情新建),
   「查看全部合同」汇总视图也不做。 */
const WS_CATS = {
  company: [
    { id: "certificate", label: "企业资质" },
    { id: "achievement", label: "业务档案" },
    { id: "project", label: "公司项目" },
    { id: "ip", label: "知识产权" },
    { id: "general", label: "综合资料" },
  ],
  personal: [
    { id: "certificate", label: "身份与资质" },
    { id: "ip", label: "知识产权与著作" },
    { id: "project", label: "科研与合作项目" },
    { id: "achievement", label: "成果与奖励" },
    { id: "academic", label: "学术与社会活动" },
    { id: "general", label: "其他资料" },
  ],
};

const catsOf = (ws) => WS_CATS[ws] || WS_CATS.personal;
const catLabel = (id, ws) => (catsOf(ws || VaultStore.ws).find((c) => c.id === id) || {}).label || id;

/* 公司「业务档案」的一级是目录(7 个系统目录),不是同类记录 ——
   这一层不能出台账列,进了目录才出。 */
const catIsDir = (id, ws) => id === "achievement" && (ws || VaultStore.ws) === "company";

const VaultStore = {
  ws: "personal",
  token: "",
  dbName: "",
  locked: true,
  loading: false,
  error: null,

  /* nodeId -> 业务数据 */
  biz: new Map(),
  /* nodeId -> 附件元信息(下载/预览需要 fileId + version) */
  fileMeta: new Map(),

  /* ---------------- HTTP ---------------- */

  async api(path, opts = {}) {
    const headers = new Headers(opts.headers || {});
    if (this.token) headers.set("X-IPSys-Token", this.token);
    if (opts.json !== undefined) {
      headers.set("Content-Type", "application/json");
      opts.body = JSON.stringify(opts.json);
    }
    const res = await fetch(path, { ...opts, headers, cache: "no-store" });
    if (!res.ok) {
      let msg = `请求失败：${res.status}`;
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch {}
      if (res.status === 401) {
        this.token = "";
        this.locked = true;
      }
      throw new Error(msg);
    }
    return res;
  },

  async getJson(path) {
    return (await this.api(path)).json();
  },

  /* ---------------- 会话 ---------------- */

  async status() {
    const s = await this.getJson("/api/status");
    this.locked = !s.unlocked;
    return s;
  },

  async open(path, password, create = false) {
    const res = await this.api("/api/open", {
      method: "POST",
      json: { path, password, create },
    });
    const r = await res.json();
    this.token = r.token;
    this.dbName = r.name;
    this.locked = false;
    return r;
  },

  /* 服务端资料库仍是打开状态、但浏览器已丢失 token(换标签页/刷新后)时,
     只能用密码重新换一个 token,不能再走 /api/open。 */
  async resume(password) {
    const res = await this.api("/api/resume", { method: "POST", json: { password } });
    const r = await res.json();
    this.token = r.token;
    this.dbName = r.name;
    this.locked = false;
    return r;
  },

  /* ---------------- 加载 ---------------- */

  async loadAll(ws = "company") {
    this.ws = ws;
    this.loading = true;
    this.error = null;
    const w = encodeURIComponent(ws);

    const [projects, archive, ip, projectFiles] = await Promise.all([
      this.getJson(`/api/v2/ui/projects/${w}`).catch(() => []),
      this.getJson(`/api/v2/ui/archive/${w}`).catch(() => ({})),
      this.getJson(`/api/v2/ui/ip/${w}`).catch(() => ({})),
      this.getJson(`/api/v2/ui/project-files/${w}`).catch(() => []),
    ]);

    this.biz.clear();
    this.fileMeta.clear();

    ROOT = this.buildTree({ ws, projects, archive, ip, projectFiles });
    RECYCLE = await this.loadRecycle(ws);
    this.loading = false;
    return ROOT;
  },

  /* 后端回收站是扁平的 {kind,id,name,section,parent} 列表,
     kind 用 v2_* 前缀区分资源类型。这里翻译成可浏览的节点。 */
  async loadRecycle(ws) {
    const KIND_MAP = {
      project: { typeName: "项目", folder: true },
      ip: { typeName: "知识产权", folder: true },
      v2_archive: { typeName: "档案记录", folder: true },
      v2_general: { typeName: "综合资料", folder: true },
      v2_ip_file: { typeName: "知识产权附件", folder: false },
      v2_file: { typeName: "项目附件", folder: false },
      v2_archive_file: { typeName: "档案附件", folder: false },
    };

    try {
      const rows = await this.getJson(`/api/trash/${encodeURIComponent(ws)}`);
      const list = Array.isArray(rows) ? rows : rows.items || [];
      /* 合同不是业务模块,恢复出来也没有地方放 —— 不进回收站列表 */
      return list
        .filter((r) => r.kind !== "contract")
        .map((r) => {
          const info = KIND_MAP[r.kind] || { typeName: r.kind || "记录", folder: true };
          const id = `t:${r.kind}:${r.id}`;
          const node = info.folder
            ? F(r.name || "未命名", { id })
            : D(r.name || "未命名", 0, { id });
          node.biz = {
            kind: "trash",
            typeName: info.typeName,
            folder: info.folder,
            raw: r,
          };
          return node;
        });
    } catch {
      return [];
    }
  },

  /* ---------------- 建树 ---------------- */

  buildTree({ ws, projects, archive, ip, projectFiles }) {
    const root = F("我的文件", { id: "root", mtime: Date.now() });
    root.children = [];

    /* 附件按 owner 分组 —— 各接口字段名不统一,这里统一成 ownerId */
    const byOwner = new Map();
    const push = (ownerId, node) => {
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
      byOwner.get(ownerId).push(node);
    };

    for (const f of projectFiles || []) {
      const node = D(f.displayName || f.name || "附件", f.size, {
        id: `f:${f.linkId}:${f.version}`,
      });
      node.biz = { kind: "file", ownerKind: f.kind };
      this.fileMeta.set(node.id, {
        fileId: f.fileId,
        version: f.version,
        linkId: f.linkId,
        name: f.name,
        sha256: f.sha256,
      });
      push(f.folderId, node);
    }

    const archiveFiles = archive?.files || [];
    for (const f of archiveFiles) {
      const node = D(f.name || "附件", f.size, { id: `f:${f.linkId}:${f.version}` });
      node.biz = { kind: "file", ownerKind: f.kind, section: f.section, category: f.category };
      this.fileMeta.set(node.id, {
        fileId: f.fileId,
        version: f.version,
        linkId: f.linkId,
        name: f.name,
        sha256: f.sha256,
      });
      push(f.ownerId, node);
    }

    for (const f of ip?.files || []) {
      const node = D(f.displayName || f.name || "附件", f.size, { id: `f:${f.linkId}:${f.version}` });
      node.biz = { kind: "file", ownerKind: "ip" };
      this.fileMeta.set(node.id, {
        fileId: f.fileId,
        version: f.version,
        linkId: f.linkId,
        name: f.name,
        sha256: f.sha256,
      });
      push(f.folderId, node);
    }

    const attach = (node, ownerId) => {
      const kids = byOwner.get(ownerId) || [];
      kids.sort((a, b) => cmpName(a, b));
      node.children = kids;
      const bytes = kids.reduce((s, k) => s + (k.size || 0), 0);
      node.size = bytes;
      return node;
    };

    /* ---- 各分类的记录 ----
       分类的顺序、名称、有无全部由 WS_CATS 决定,这里只负责把数据装进去。 */

    /* 档案类(资质 / 成果 / 学术)字段完全一致,共用一套构造 */
    const archiveRecordsOf = (section) =>
      (archive?.archives || [])
        .filter((a) => a.section === section)
        .map((a) => {
          const node = F(a.name || `记录 ${a.id}`, { id: `a:${section}:${a.id}` });
          node.mtime = toTs(a.year);
          node.dateLabel = a.year ? `${a.year} 年` : "";
          node.biz = {
            kind: "archive",
            section,
            typeName: catLabel(section, ws),
            status: "",
            code: "",
            owner: "",
            year: a.year || "",
            category: a.category || "",
            remarks: a.remarks || "",
            tags: a.tags || "",
            folderId: a.folderId ?? null,
            raw: a,
            id: a.id,
          };
          this.biz.set(node.id, node.biz);
          return attach(node, a.id);
        });

    const builders = {
      certificate: () => archiveRecordsOf("certificate"),
      achievement: () => archiveRecordsOf("achievement"),
      academic: () => archiveRecordsOf("academic"),

      project: () =>
        (projects || []).map((p) => {
          const node = F(p.name || `项目 ${p.id}`, { id: `p:${p.id}` });
          node.mtime = toTs(p.endDate || p.startDate);
          node.dateLabel = p.endDate || p.startDate || "";
          node.biz = {
            kind: "project",
            typeName: p.projectType || "项目",
            status: p.projectStatus || "",
            code: p.projectNo || "",
            owner: p.leader || "",
            org: p.undertakingOrg || "",
            start: p.startDate || "",
            end: p.endDate || "",
            category: p.category || "",
            remarks: p.remarks || "",
            tags: p.tags || "",
            raw: p,
            id: p.id,
          };
          this.biz.set(node.id, node.biz);
          return attach(node, p.id);
        }),

      ip: () =>
        (ip?.rows || []).map((row) => {
          const d = row.data || row;
          const node = F(d.name || d.Name || `知识产权 ${row.id}`, { id: `i:${row.id}` });
          node.mtime = toTs(d.applicationDate || d.ApplicationDate || d.grantDate || d.GrantDate);
          node.dateLabel = d.applicationDate || d.ApplicationDate || d.grantDate || d.GrantDate || "";
          node.biz = {
            kind: "ip",
            typeName: d.ipType || d.IpType || "知识产权",
            status: d.status || d.Status || "",
            code: d.applicationNo || d.ApplicationNo || "",
            owner: d.rightHolders || d.RightHolders || "",
            start: d.applicationDate || d.ApplicationDate || "",
            end: d.grantDate || d.GrantDate || "",
            category: d.category || d.Category || "",
            remarks: d.remarks || d.Remarks || "",
            tags: d.tags || d.Tags || "",
            applicants: d.applicants || d.Applicants || "",
            creators: d.creators || d.Creators || "",
            raw: d,
            id: row.id,
          };
          this.biz.set(node.id, node.biz);
          return attach(node, row.id);
        }),

      general: () =>
        (archive?.general || []).map((g) => {
          const node = F(g.title || `资料 ${g.id}`, { id: `g:${g.id}` });
          node.biz = {
            kind: "general",
            typeName: "综合资料",
            status: "",
            code: "",
            owner: "",
            remarks: "",
            tags: "",
            raw: g,
            id: g.id,
          };
          this.biz.set(node.id, node.biz);
          const kids = (g.files || []).map((f) => {
            const n = D(f.name || "附件", f.size, { id: `f:${f.linkId}:${f.version}` });
            n.biz = { kind: "file", ownerKind: "general" };
            this.fileMeta.set(n.id, {
              fileId: f.fileId,
              version: f.version,
              linkId: f.linkId,
              name: f.name,
              sha256: f.sha256,
            });
            return n;
          });
          kids.sort((a, b) => cmpName(a, b));
          node.children = kids;
          node.size = kids.reduce((s, k) => s + (k.size || 0), 0);
          return node;
        }),
    };

    /* 公司「业务档案」的一级是目录树:7 个系统目录(后端 is_system=1),
       记录按 folderId 挂进目录;目录本身不是业务记录。 */
    const buildArchiveDirs = (records) => {
      const dirs = (archive?.folders || [])
        .filter((f) => f.parentId === null || f.parentId === undefined)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((f) => {
          const d = F(f.name || "未命名目录", { id: `af:${f.id}` });
          d.biz = { kind: "archive_folder", typeName: "目录", id: f.id, isSystem: !!f.isSystem };
          /* order 是后端 position:系统目录有固定业务顺序(申报与认定打头),
             不能被拼音序打乱。见 app.js sortedItems。 */
          d.order = Number(f.position) || 0;
          d.children = [];
          return d;
        });

      const byId = new Map(dirs.map((d) => [String(d.biz.id), d]));
      const loose = [];
      for (const r of records) {
        const dir = r.biz.folderId != null ? byId.get(String(r.biz.folderId)) : null;
        if (dir) dir.children.push(r);
        else loose.push(r);
      }

      for (const d of dirs) {
        d.children.sort((a, b) => cmpName(a, b));
        const times = d.children.map((x) => x.mtime).filter(Boolean);
        d.mtime = times.length ? Math.max(...times) : null;
        d.size = d.children.reduce((n, x) => n + (x.size || 0), 0);
      }
      /* 目录在前(按后端 position 排),没归目录的记录跟在后面 */
      return [...dirs, ...loose.sort((a, b) => cmpName(a, b))];
    };

    root.children = catsOf(ws).map(({ id, label }, i) => {
      const k = F(label, { id: `k:${id}`, synthetic: true });
      /* 分类的先后由 WS_CATS 决定,不参与拼音排序(见 app.js sortedItems) */
      k.order = i;
      const records = builders[id] ? builders[id]() : [];

      if (catIsDir(id, ws)) k.children = buildArchiveDirs(records);
      else k.children = records.sort((a, b) => cmpName(a, b));

      /* 根节点时间 = 最新子项时间，用于排序稳定 */
      const times = k.children.map((x) => x.mtime).filter(Boolean);
      k.mtime = times.length ? Math.max(...times) : null;
      return k;
    });

    return root;
  },

  /* ---------------- 查询 ---------------- */

  bizOf(id) {
    return this.biz.get(id) || findById(id)?.biz || null;
  },

  metaOf(id) {
    return this.fileMeta.get(id) || null;
  },

  /* 分类汇总，首页与导航用。
     条数按「业务记录」递归数,不能拿 children.length ——
     公司业务档案的一级是 7 个目录,那些不是记录。 */
  summary() {
    const RECORD_KINDS = new Set(["project", "archive", "ip", "general"]);
    const out = [];
    for (const c of ROOT.children || []) {
      const st = folderStats(c);
      let count = 0;
      walk(c, (n) => {
        if (n !== c && n.type === "folder" && RECORD_KINDS.has((n.biz || {}).kind)) count++;
      });
      out.push({
        id: c.id,
        name: c.name,
        count,
        files: st.count,
        bytes: st.bytes,
        mtime: c.mtime || null,
        kind: c.id.slice(2),
      });
    }
    return out;
  },
};


/* ===== js/app.js ===== */
/* ==========================================================================
   OneDrive UI — 渲染层
   --------------------------------------------------------------------------
   数据来自 store.js 构建的文件树:每条业务记录是一个文件夹,附件是文件。
   渲染管线本身与 OneDrive 一致:
     导航 → 命令栏 → 面包屑 → 列表/网格 → 详细信息
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const NAV_ITEMS = [
  { id: "home", label: "首页", icon: "home" },
  { id: "files", label: "我的文件", icon: "folder" },
  { id: "recycle", label: "回收站", icon: "trash" },
];

/* 本机偏好:只影响界面,不写服务端。键统一 ipsys.* */
const Prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`ipsys.${key}`);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`ipsys.${key}`, String(value));
    } catch {}
  },
};

/* ==========================================================================
   台账列集
   --------------------------------------------------------------------------
   一条铁律:**列集由上层分类决定,不由节点自己声明**。
   分类节点(k:*)下面建的文件夹必然是这一类记录(用户口径:「项目台账下建的
   文件夹全是项目,知识产权下建的全是专利、软著」),所以"现在该用哪套列"
   只看 state.folderId,不需要读 biz.kind,也不需要判断这批节点是否同构。

   反过来说,下面这些界面没有单一分类,天然没有列集,统一退回
   「名称 / 修改日期 / 大小」——这不是缺陷,是定义:
     根目录     六类并列
     搜索结果   跨类混排(还可能命中附件)
     回收站     各类混在一起
     记录内部   那是附件列表,按文件语义看
   ========================================================================== */

/* 资质 / 成果 / 学术 共用一套档案列:它们的字段完全一致(年度 + 类别 + 备注) */
/* 名称列也写进列集里。它的位置各分类不同(项目台账/资质第二列,知识产权第三列),
   所以不能像以前那样硬编码在行首 —— 位置由列集决定。排序键统一映射到 name。 */
const NAME = (t) => ({ k: "_name", t, w: "minmax(180px,1fr)" });

/* 年份:档案类后端直接给 year,项目与知产只有起止日期,统一从日期里取前四位。
   见 Drive.yearOf()。 */
const YEAR = { k: "_year", t: "年份", w: "84px", f: "num" };

const ARCHIVE_COLS = [
  YEAR,
  NAME("名称"),
  { k: "category", t: "类别", w: "104px" },
  { k: "remarks", t: "备注", w: "minmax(140px,1.15fr)", f: "sub" },
  { k: "_files", t: "附件", w: "56px", f: "num", r: 1 },
  { k: "_bytes", t: "大小", w: "88px", f: "size", r: 1 },
];

const LEDGER_COLS = {
  project: [
    YEAR,
    NAME("项目名称"),
    { k: "typeName", t: "项目类型", w: "92px", f: "tag" },
    { k: "code", t: "项目编号", w: "124px", f: "mono" },
    { k: "_files", t: "附件数量", w: "84px", f: "num", r: 1 },
  ],
  ip: [
    YEAR,
    { k: "typeName", t: "类型", w: "92px", f: "tag" },
    NAME("名称"),
    { k: "code", t: "申请/登记号", w: "132px", f: "mono" },
    { k: "owner", t: "当前权利人", w: "176px" },
    { k: "status", t: "状态", w: "96px", f: "pill" },
    { k: "_files", t: "附件", w: "56px", f: "num", r: 1 },
  ],
  certificate: ARCHIVE_COLS,
  achievement: ARCHIVE_COLS,
  academic: ARCHIVE_COLS,
  general: [
    NAME("资料名称"),
    { k: "remarks", t: "备注", w: "minmax(160px,1fr)", f: "sub" },
    { k: "_files", t: "附件", w: "56px", f: "num", r: 1 },
    { k: "_bytes", t: "大小", w: "88px", f: "size", r: 1 },
  ],
};

/* 状态 → 颜色。先判负向,再判正向,最后判进行中;都不中就是中性灰。
   顺序不能反:"已完成"含"完成","已终止"里没有正向词,先判红才不会误判。 */
function statusTone(v) {
  const s = String(v || "");
  if (/终止|驳回|撤销|失效|逾期|超期|废止|解除|退款|作废/.test(s)) return "red";
  if (/完成|结题|已结|归档|通过|授权|有效|已签|在用|结项/.test(s)) return "green";
  if (/进行|在研|执行|审查|受理|申请|公示|待|草稿|拟|立项/.test(s)) return "blue";
  return "gray";
}

/* 金额千分位。解析不出数字就原样返回("面议"这类不该被抹成 0) */
function fmtMoney(v) {
  const n = Number(String(v).replace(/[,\s]/g, ""));
  if (!isFinite(n) || n === 0) return String(v);
  return n.toLocaleString("zh-CN");
}

const Drive = {
  state: {
    view: "home",
    folderId: "root",
    sortBy: "name",
    sortDir: "asc",
    viewMode: Prefs.get("view", "list") === "grid" ? "grid" : "list",
    selection: new Set(),
    anchorId: null,
    query: "",
    detailOpen: Prefs.get("detail", window.innerWidth > 1200 ? "1" : "0") === "1",
    navCollapsed: false,
    history: [],
    extFilter: null,
    statusFilter: null,
    lastSelectedIds: [],
    ready: false,
    loadError: null,
    wsPending: null,
  },

  /* ---------- derived ---------- */

  get currentFolder() {
    return findById(this.state.folderId) || ROOT;
  },

  get sourceItems() {
    const s = this.state;
    let out;

    if (s.query.trim()) {
      const q = s.query.trim().toLowerCase();
      const pool = s.view === "recycle" ? RECYCLE : allFiles(ROOT);
      /* 搜索同时覆盖文件夹名与业务编号 */
      const flat = [];
      walk(ROOT, (n) => {
        if (n === ROOT) return;
        const hay = [n.name, n.biz?.code, n.biz?.status, n.biz?.owner, n.biz?.tags]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (hay.includes(q)) flat.push(n);
      });
      out = s.view === "recycle" ? pool.filter((i) => i.name.toLowerCase().includes(q)) : flat;
    } else {
      switch (s.view) {
        case "home":
          out = [];
          break;
        case "files":
          out = this.currentFolder.children || [];
          break;
        case "recycle":
          out = RECYCLE;
          break;
        default:
          out = [];
      }
    }

    /* 两套筛选各管一段:台账里按记录状态筛,通用视图里按扩展名筛文件。
       台账里也曾能点扩展名筛选,但那一屏全是文件夹,点了只会把列表清空 —— 已掐断。 */
    if (s.statusFilter) {
      out = out.filter((i) => (i.biz || {}).status === s.statusFilter);
    }
    if (s.extFilter) {
      out = out.filter((i) => i.type === "file" && s.extFilter.includes(extOf(i.name)));
    }
    return out;
  },

  /* ---------- 台账列集 ----------
     columns() 是「现在有没有列集」的唯一答案:null = 通用三列。
     渲染、表头、排序都从这里取,不要在别处另算一遍。 */

  columns() {
    const s = this.state;
    /* 搜索、回收站、首页、记录内部一律没有列集 —— 那里没有单一分类 */
    if (s.view !== "files" || s.query.trim()) return null;
    const id = String(s.folderId || "");
    /* 业务档案的目录里装的仍然是同类记录,照样出台账 */
    if (id.startsWith("af:")) return ARCHIVE_COLS;
    if (!id.startsWith("k:")) return null;
    const sec = id.slice(2);
    /* 公司「业务档案」这一层是目录树(7 个系统目录),不是同类记录 → 通用三列 */
    if (catIsDir(sec)) return null;
    return LEDGER_COLS[sec] || null;
  },

  colTemplate(cols) {
    if (!cols) return "minmax(0,1fr) 168px 96px 56px";
    /* 名称列已在列集里;万一某个列集漏了它,补一列兜底,免得整行没有名字 */
    const tpl = cols.some((c) => c.k === "_name")
      ? cols.map((c) => c.w)
      : ["minmax(150px,1fr)", ...cols.map((c) => c.w)];
    return [...tpl, "56px"].join(" ");
  },

  headHtml(cols) {
    if (!cols) {
      return `<button class="head-check" id="selectAll" title="全选"></button>
        <div class="col-name"><button class="th-sort" data-sort="name">名称<span class="caret">▾</span></button></div>
        <div class="col-date"><button class="th-sort" data-sort="mtime">修改日期<span class="caret">▾</span></button></div>
        <div class="col-size"><button class="th-sort" data-sort="size">大小<span class="caret">▾</span></button></div>
        <div class="col-gap"></div>`;
    }
    /* 台账表头:逐列生成,名称列不再是固定槽位。
       第一格要往左让出 26px 给勾选框(勾选框是 absolute)。 */
    const cells = cols
      .map((c, i) => {
        const key = c.k === "_name" ? "name" : c.k;
        const cls = [
          "cell",
          c.k === "_name" ? "col-name" : "",
          c.r ? "ta-r" : "",
          i === 0 ? "is-first" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<div class="${cls}"><button class="th-sort" data-sort="${key}">${esc(c.t)}<span class="caret">▾</span></button></div>`;
      })
      .join("");
    return `<button class="head-check" id="selectAll" title="全选"></button>${cells}<div class="col-gap"></div>`;
  },

  /* 年份:档案类有 year 字段,项目/知产只有日期。都从这两个地方取,
     取不到就留空(表格显示「—」),不要拿创建时间凑。 */
  yearOf(it) {
    const b = it.biz || {};
    const y = String(b.year || "").match(/\d{4}/);
    if (y) return y[0];
    const d = String(b.start || b.end || "").match(/\d{4}/);
    return d ? d[0] : "";
  },

  cellValue(it, c) {
    if (c.k === "_name") return it.name || "";
    if (c.k === "_year") return this.yearOf(it);
    if (c.k === "_files") return (it.children || []).length;
    if (c.k === "_bytes") return (it.children || []).reduce((n, x) => n + (x.size || 0), 0);
    return (it.biz || {})[c.k] ?? "";
  },

  cellHtml(it, c, first) {
    const v = this.cellValue(it, c);
    const cls = `cell${c.r ? " ta-r" : ""}${first ? " is-first" : ""}`;
    if (v === "" || v === null || v === undefined) return `<div class="${cls}"><span class="c-nil">—</span></div>`;
    let inner;
    switch (c.f) {
      case "pill":
        inner = `<span class="pill ${statusTone(v)}">${esc(v)}</span>`;
        break;
      case "tag":
        inner = `<span class="pill tag">${esc(v)}</span>`;
        break;
      case "mono":
        inner = `<span class="mono" title="${esc(v)}">${esc(v)}</span>`;
        break;
      case "date":
        inner = `<span class="mono">${esc(String(v).slice(0, 10))}</span>`;
        break;
      case "money":
        inner = `<span class="mono">${esc(fmtMoney(v))}</span>`;
        break;
      case "size":
        inner = `<span class="mono">${fmtSize(Number(v) || 0)}</span>`;
        break;
      case "num":
        inner = Number(v) ? `<span class="mono">${esc(v)}</span>` : `<span class="c-nil">—</span>`;
        break;
      default:
        inner = `<span class="c-txt" title="${esc(v)}">${esc(v)}</span>`;
    }
    return `<div class="${cls}">${inner}</div>`;
  },

  /* 导航到新上下文后的统一收尾:
     1) 旧排序键在新列集里可能不存在(在项目台账按「项目编号」排,再进根目录)
        → 退回按名称;
     2) 进分类 = 进台账,列多,右侧详情面板会把名称列压到 180px 左右 → 自动收起。
        用户仍可手动打开,那是他自己选的窄。 */
  enterContext() {
    this.resetSort();
    if (this.columns()) this.state.detailOpen = false;
    /* 筛选是跟着分类列的,换目录一定得清,否则进另一个分类会莫名其妙少一半行 */
    this.state.statusFilter = null;
    this.state.extFilter = null;
  },

  resetSort() {
    const s = this.state;
    const cols = this.columns();
    const keys = cols ? ["name", ...cols.map((c) => c.k)] : ["name", "mtime", "size"];
    if (!keys.includes(s.sortBy)) {
      s.sortBy = "name";
      s.sortDir = "asc";
    }
  },

  get sortedItems() {
    const { sortBy, sortDir } = this.state;
    const dir = sortDir === "asc" ? 1 : -1;
    const items = [...this.sourceItems];
    const col = this.columns()?.find((c) => c.k === sortBy);

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      if (col) {
        /* 名称列走拼音序,和通用列表的「名称」保持一致 */
        if (col.k === "_name") return cmpName(a, b) * dir;
        const x = this.cellValue(a, col);
        const y = this.cellValue(b, col);
        const xe = x === "" || x === null || x === undefined;
        const ye = y === "" || y === null || y === undefined;
        /* 空值恒定沉底,不跟着升降序翻转 —— 否则降序时空行会全冒到顶上 */
        if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;
        if (col.f === "money" || col.f === "num" || col.f === "size") {
          return ((Number(x) || 0) - (Number(y) || 0)) * dir;
        }
        return String(x).localeCompare(String(y), "zh-CN") * dir;
      }
      let r = 0;
      if (sortBy === "name") {
        /* 业务档案的系统目录带 order(后端 position),按业务顺序排;
           其余节点没有 order,照旧按拼音。 */
        const ao = a.order ?? null;
        const bo = b.order ?? null;
        r = ao !== null && bo !== null ? ao - bo : cmpName(a, b);
      } else if (sortBy === "mtime") r = (a.mtime || 0) - (b.mtime || 0);
      else if (sortBy === "size") r = (a.size || 0) - (b.size || 0);
      return r * dir;
    });
    return items;
  },

  get selectedItems() {
    return [...this.state.selection]
      .map((id) => findById(id) || RECYCLE.find((i) => i.id === id))
      .filter(Boolean);
  },

  /* ---------- navigation ---------- */

  navigate(view, folderId) {
    this.state.history.push({ view: this.state.view, folderId: this.state.folderId });
    this.state.view = view;
    if (folderId) this.state.folderId = folderId;
    else if (view === "files") this.state.folderId = "root";
    this.state.selection.clear();
    this.state.anchorId = null;
    this.state.query = "";
    const si = $("#searchInput");
    if (si) si.value = "";
    $("#searchWrap")?.classList.remove("has-value");
    this.enterContext();
    this.render();
  },

  openFolder(id) {
    const node = findById(id);
    if (!node || node.type !== "folder") return;
    this.state.history.push({ view: this.state.view, folderId: this.state.folderId });
    this.state.view = "files";
    this.state.folderId = id;
    this.state.selection.clear();
    this.state.query = "";
    const si = $("#searchInput");
    if (si) si.value = "";
    this.enterContext();
    this.render();
  },

  goBack() {
    const prev = this.state.history.pop();
    if (!prev) return;
    this.state.view = prev.view;
    this.state.folderId = prev.folderId;
    this.state.selection.clear();
    this.enterContext();
    this.render();
  },

  /* ---------- selection ----------
     三档:点行 = 单选;点行首勾选框 = 多选(逐条累加/取消);Shift = 连选,
     Ctrl+Shift = 区间并进已有选择。表头勾选框 = 全选,
     0 < 已选 < 总数 时表头显示半选态 —— 这就是「中间态」。 */

  select(id, mode = "single") {
    const list = this.sortedItems.map((i) => i.id);
    const sel = this.state.selection;
    const anchor = this.state.anchorId;

    if (mode === "toggle") {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      this.state.anchorId = id;
    } else if (mode === "range" || mode === "range-add") {
      const a = list.indexOf(anchor || id);
      const b = list.indexOf(id);
      if (a < 0 || b < 0) {
        if (mode === "range") sel.clear();
        sel.add(id);
      } else {
        if (mode === "range") sel.clear();
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(list[i]);
      }
      this.state.anchorId = anchor || id;
    } else {
      sel.clear();
      sel.add(id);
      this.state.anchorId = id;
    }
    this.renderChrome();
    this.renderDetail();
  },

  /* 表头勾选框与 Ctrl+A 共用:全选 ↔ 全不选 */
  toggleSelectAll() {
    const ids = this.sortedItems.map((i) => i.id);
    const all = ids.length > 0 && ids.every((id) => this.state.selection.has(id));
    this.state.selection = new Set(all ? [] : ids);
    this.state.anchorId = null;
    this.renderChrome();
    this.renderDetail();
  },

  clearSelection() {
    this.state.selection.clear();
    this.state.anchorId = null;
    this.renderChrome();
    this.renderDetail();
  },

  /* ---------- render ---------- */

  render() {
    this.renderNav();
    this.renderChrome();
    this.renderCrumb();
    this.renderContent();
    this.renderDetail();
  },

  renderNav() {
    const s = this.state;
    const counts = { files: (ROOT.children || []).length, recycle: RECYCLE.length };

    $("#navMain").innerHTML = NAV_ITEMS.map((n) => {
      const active = s.view === n.id;
      const c = counts[n.id];
      return `<button class="nav-item ${active ? "is-active" : ""}" data-nav="${n.id}">
        ${icon(n.icon, 20)}
        <span class="nav-label">${n.label}</span>
        ${c ? `<span class="nav-count">${c}</span>` : ""}
      </button>`;
    }).join("");

    /* 快捷访问 = 六个固定分类。分类用类型图标,不是文件夹 */
    const quick = ROOT.children || [];
    $("#navQuick").innerHTML = quick
      .map(
        (f) => `<button class="nav-item" data-quick="${f.id}" title="${esc(f.name)}">
          <span class="nav-ico">${this.nodeMark(f, 20)}</span>
          <span class="nav-label">${esc(f.name)}</span>
          <span class="nav-count">${this.recordCount(f)}</span>
        </button>`
      )
      .join("");

    /* 存储条改成资料量 */
    const all = allFiles(ROOT);
    const bytes = all.reduce((a, b) => a + (b.size || 0), 0);
    const fill = $("#storageFill");
    if (fill) {
      /* 以 10 GB 为参考刻度,只表达量级,不假装有配额 */
      const pct = Math.min(100, (bytes / (10 * GB)) * 100);
      fill.style.width = `${Math.max(pct, 1.5)}%`;
      fill.style.background = "";
    }
    const st = $(".storage-text");
    if (st) st.innerHTML = `<b>${fmtSize(bytes)}</b> · ${all.length} 个附件`;
  },

  /* 顶栏的工作区标识。数据未回来前先用待切换的目标,
     避免「点了切换、标签还是旧值」的错位感。 */
  renderWorkspace() {
    const btn = $("#wsSwitchBtn");
    if (!btn) return;
    const ws = this.state.wsPending || VaultStore.ws || "personal";
    const personal = ws === "personal";

    const ico = $("#wsSwitchIcon");
    if (ico && ico.dataset.ws !== ws) {
      ico.dataset.ws = ws;
      ico.innerHTML = icon(personal ? "user" : "building", 17);
    }
    const lb = $("#wsSwitchLabel");
    if (lb) lb.textContent = personal ? "个人工作区" : "企业工作区";
    const ct = $("#wsSwitchCaret");
    if (ct && !ct.dataset.done) {
      ct.dataset.done = "1";
      ct.innerHTML = icon("chevronDown", 14);
    }
    btn.title = `${personal ? "个人资料" : "公司资料与项目台账"} · 点击切换工作区`;
    btn.classList.toggle("ws-loading", !!this.state.wsPending);
  },

  renderChrome() {
    this.renderWorkspace();
    const s = this.state;
    const locked = s.view === "recycle" || !s.ready;

    for (const id of ["btnNew", "btnUpload", "btnFilter"]) {
      const b = $(`#${id}`);
      if (b) b.disabled = locked;
    }
    $("#btnFilter")?.classList.toggle("is-active", !!(s.extFilter || s.statusFilter));
    const et = $("#btnEmptyTrash");
    if (et) {
      et.classList.toggle("hidden", s.view !== "recycle");
      et.innerHTML = `${icon("trashForever", 17)}<span>清空回收站</span>`;
    }

    /* 表头由列集生成。只在列集变了时重建 —— 否则每次勾选/排序都重建,
       按钮的焦点和 hover 都会丢。 */
    const cols = this.columns();
    const hd = $("#listHead");
    if (hd) {
      const sig = cols ? cols.map((c) => c.k).join(",") : "generic";
      if (hd.dataset.sig !== sig) {
        hd.dataset.sig = sig;
        hd.innerHTML = this.headHtml(cols);
      }
      hd.classList.toggle("is-ledger", !!cols);
    }

    const vt = $("#btnViewToggle");
    if (vt) {
      vt.innerHTML = s.viewMode === "list" ? icon("gridView", 20) : icon("listView", 20);
      vt.title = cols
        ? "台账视图固定为表格"
        : s.viewMode === "list"
        ? "切换到网格视图"
        : "切换到列表视图";
      vt.classList.toggle("is-active", s.viewMode === "grid" && !cols);
      vt.disabled = !!cols;
    }

    $("#btnDetailToggle")?.classList.toggle("is-active", s.detailOpen);

    $$("#viewRoot .row, #viewRoot .tile, #viewRoot .photo-cell").forEach((el) => {
      el.classList.toggle("is-selected", s.selection.has(el.dataset.id));
    });

    const n = s.selection.size;
    const bar = $("#selbar");
    if (bar) bar.classList.toggle("show", n > 0);
    const sc = $("#selCount");
    if (sc) sc.textContent = `已选择 ${n} 项`;
    $("#selDownload")?.classList.toggle("hidden", locked);
    const sd = $("#selDelete");
    if (sd) sd.innerHTML = `${icon("trash", 18)}<span>${locked ? "彻底删除" : "删除"}</span>`;

    const allIds = this.sortedItems.map((i) => i.id);
    const total = allIds.length;
    const picked = allIds.filter((id) => s.selection.has(id)).length;
    const allSel = total > 0 && picked === total;
    /* 0 < 已选 < 总数 = 中间态,表头显示横线 */
    const someSel = picked > 0 && !allSel;
    const head = $("#selectAll");
    if (head) {
      head.innerHTML = someSel ? icon("minus", 11) : icon("check", 11);
      head.classList.toggle("all", allSel);
      head.classList.toggle("some", someSel);
      head.title = allSel ? "取消全选" : someSel ? `已选 ${picked} 项，点此全选` : "全选";
      head.setAttribute("aria-checked", someSel ? "mixed" : allSel ? "true" : "false");
    }

    $$(".th-sort").forEach((th) => {
      const active = th.dataset.sort === s.sortBy;
      th.dataset.active = active;
      th.classList.toggle("ascending", active && s.sortDir === "asc");
      th.classList.toggle("descending", active && s.sortDir === "desc");
      const c = th.querySelector(".caret");
      if (c) c.textContent = active ? (s.sortDir === "asc" ? "▲" : "▼") : "▾";
    });
  },

  renderCrumb() {
    const s = this.state;
    const bar = $("#crumbbar");

    if (s.query.trim()) {
      bar.innerHTML = `<span class="crumb current">“${esc(s.query)}” 的搜索结果</span>`;
      return;
    }

    if (s.view !== "files") {
      const label = NAV_ITEMS.find((n) => n.id === s.view)?.label || "";
      bar.innerHTML = `<span class="crumb current">${label}</span>`;
      return;
    }

    const path = pathTo(s.folderId) || [ROOT];
    bar.innerHTML = path
      .map((node, i) => {
        const last = i === path.length - 1;
        const crumb = `<button class="crumb ${last ? "current" : ""}" data-crumb="${node.id}">${esc(node.name)}</button>`;
        return last ? crumb : crumb + `<span class="crumb-sep">›</span>`;
      })
      .join("");
  },

  renderContent() {
    const root = $("#viewRoot");
    const content = $("#content");
    const s = this.state;
    /* 首页是工作台,不是列表:命令栏/面包屑在这一页没有意义,整块隐掉 */
    const isHome = s.view === "home" && !s.query.trim();

    $("#main")?.classList.toggle("home-mode", isHome);
    content.classList.toggle("is-home", isHome);

    if (isHome) {
      $("#listHead").classList.add("hidden");
      content.classList.remove("view-grid");
      root.innerHTML = this.dashboard();
      return;
    }

    if (!s.ready) {
      $("#listHead").classList.add("hidden");
      content.classList.remove("view-grid");
      root.innerHTML = s.loadError ? this.errorHtml(s.loadError) : this.loadingHtml();
      return;
    }

    const cols = this.columns();
    /* 台账只有表格一种形态:列集存在时忽略网格偏好,切换按钮同时置灰 */
    const useGrid = s.viewMode === "grid" && !cols;
    content.style.setProperty("--cols", this.colTemplate(cols));
    content.classList.toggle("is-ledger", !!cols);

    const items = this.sortedItems;
    $("#listHead").classList.toggle("hidden", useGrid);
    content.classList.toggle("view-grid", useGrid);

    if (!items.length) {
      root.innerHTML = this.emptyHtml();
      return;
    }

    root.innerHTML = useGrid ? this.renderGrid(items) : this.renderList(items);
  },

  /* ---------- 首页 ---------- */

  /* ---------- 图标口径 ----------
     一个地方决定,列表 / 网格 / 详情 / 首页不会各画各的:
       固定分类(k:*) → 类型图标
       记录、目录     → 琥珀色文件夹
       附件           → 扩展名色块 */

  sectionOf(node) {
    if (!node) return "";
    if (node.synthetic && String(node.id).startsWith("k:")) return node.id.slice(2);
    const b = node.biz || {};
    if (b.kind === "project") return "project";
    if (b.kind === "ip") return "ip";
    if (b.kind === "archive") return b.section || "";
    if (b.kind === "general") return "general";
    return "";
  },

  nodeMark(node, size = 20, plate = false) {
    if (!node) return folderIcon(size);
    if (node.type === "file") return fileIcon(node.name, size);
    const sec = this.sectionOf(node);
    if (node.synthetic && hasCat(sec)) return catIcon(sec, size, plate);
    return folderIcon(size);
  },

  /* 一个节点下有多少条业务记录。公司业务档案的目录不是记录,不能算进去。 */
  recordCount(node) {
    const kinds = new Set(["project", "archive", "ip", "general"]);
    let n = 0;
    walk(node, (x) => {
      if (x !== node && x.type === "folder" && kinds.has((x.biz || {}).kind)) n++;
    });
    return n;
  },

  /* 一条记录所属的顶层分类。业务档案里的记录父级是目录,
     直接取 findParent 会显示成「申报与认定」而不是「业务档案」。 */
  categoryOf(node) {
    const path = pathTo(node.id) || [];
    const k = [...path].reverse().find((n) => String(n.id).startsWith("k:"));
    return k ? k.name : "";
  },

  shortDate(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return "—";
    const p = (n) => String(n).padStart(2, "0");
    const md = `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`;
  },

  dashboard() {
    const s = this.state;
    if (!s.ready) {
      return s.loadError ? this.errorHtml(s.loadError) : this.loadingHtml();
    }

    const sum = VaultStore.summary();
    const files = allFiles(ROOT);
    const bytes = files.reduce((a, b) => a + (b.size || 0), 0);

    /* 记录 = 挂在分类下的文件夹。分类本身是 synthetic 节点,没有 biz;
       业务档案的目录也不是记录(它只是分组的壳)。 */
    const records = [];
    walk(ROOT, (n) => {
      if (n.type === "folder" && n.biz && n.biz.kind !== "archive_folder") records.push(n);
    });

    /* 最近更新按业务日期倒序。未来计划日不算「最近」,所以优先只取今天及以前;
       全库都是未来日期时才退回完整列表,避免面板空着。 */
    const todayEnd = new Date().setHours(23, 59, 59, 999);
    const past = records.filter((r) => r.mtime && r.mtime <= todayEnd).sort((a, b) => b.mtime - a.mtime);
    const pool = past.length ? past : records.filter((r) => r.mtime).sort((a, b) => b.mtime - a.mtime);
    /* 右栏只有 300px,两行一条刚好;条数按栏高收敛,不要滚动条 */
    const recent = pool.slice(0, 7);

    const personal = VaultStore.ws === "personal";
    const dbName = VaultStore.dbName || "本地资料库";
    /* 页头只留一句规模描述,不再摊成指标卡:这里是资料库,不是管理看板 */
    const sub = `${records.length} 条记录 · ${files.length} 个附件${bytes ? ` · ${fmtSize(bytes)}` : ""}`;

    const pct = Math.min(100, Math.max(1.5, (bytes / (10 * GB)) * 100));

    return `
    <div class="dash">
      <header class="pagehead">
        <div class="ph-txt">
          <h1>${personal ? "个人工作台" : "公司工作台"}</h1>
          <p title="${esc(dbName)} · ${esc(sub)}">${esc(dbName)} · ${esc(sub)}</p>
        </div>
        <div class="ph-acts">
          <button class="btn" data-page-act="upload">${icon("upload", 16)}<span>导入资料</span></button>
          <button class="btn solid" data-page-act="new">${icon("plus", 16)}<span>新建记录</span></button>
        </div>
      </header>

      <div class="home-grid">
        <!-- 主区:先把「往哪儿放东西」摆出来。分类就是工作目录,点进去才是记录列表 -->
        <section class="workdirs">
          <div class="sec-head">
            <h2>分类目录</h2>
            <span class="sec-n">${sum.length} 类</span>
          </div>
          <div class="catgrid">
            ${sum
              .map((c) => {
                const ct = CAT_TYPES[c.kind] || CAT_TYPES.general;
                const empty = !c.count && !c.files;
                const meta = empty
                  ? "暂无记录"
                  : `${c.count} 条记录 · ${c.files} 个附件${c.bytes ? ` · ${fmtSize(c.bytes)}` : ""}`;
                return `<button class="catcard ${empty ? "is-empty" : ""}" data-quick="${c.id}"
                    style="--cat:${ct.color};--cat-soft:${ct.soft}" title="${esc(c.name)}">
                  <span class="cc-head">
                    <span class="cc-plate">${catIcon(c.kind, 46, true)}</span>
                    <span class="cc-when">${c.mtime ? `更新 ${this.shortDate(c.mtime)}` : ""}</span>
                  </span>
                  <span class="cc-name">${esc(c.name)}</span>
                  <span class="cc-meta">${meta}</span>
                </button>`;
              })
              .join("")}
          </div>
        </section>

        <div class="home-col">
          <section class="panel">
            <div class="ph">
              <h3>最近更新</h3><span class="sp"></span>
              <button class="link" data-nav="files">查看全部</button>
            </div>
            <div class="plist tight">
              ${
                recent.length
                  ? recent
                      .map((r) => {
                        const cat = this.categoryOf(r);
                        return `<button class="home-row" data-open="${r.id}" title="${esc(r.name)}">
                          <span class="fi">${this.nodeMark(r, 18)}</span>
                          <span class="ht">
                            <span class="nm">${esc(r.name)}</span>
                            <span class="sub">${esc(cat)}${cat && r.mtime ? " · " : ""}${r.mtime ? this.shortDate(r.mtime) : ""}</span>
                          </span>
                        </button>`;
                      })
                      .join("")
                  : `<div class="panel-empty">这个工作区还没有记录,点右上角「新建记录」开始。</div>`
              }
            </div>
          </section>

          <section class="panel">
            <div class="ph"><h3>资料库</h3></div>
            <div class="store">
              <div class="dbname" title="${esc(dbName)}">${esc(dbName)}</div>
              <div class="lbl"><span>已用 ${fmtSize(bytes) || "0 B"}</span><span>${files.length} 个附件</span></div>
              <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
              <div class="note">本地数据库，进度按 10 GB 参考刻度</div>
            </div>
          </section>
        </div>
      </div>
    </div>`;
  },


  /* ---------- 列表 / 网格 ---------- */

  renderList(items) {
    const cols = this.columns();
    if (cols) return this.renderLedger(items, cols);

    const searching = !!this.state.query.trim();

    return items
      .map((it) => {
        const sel = this.state.selection.has(it.id);
        const isFolder = it.type === "folder";
        const b = it.biz || {};

        let sub = "";
        if (searching) {
          const par = findParent(it.id);
          const cat = this.categoryOf(it);
          /* 业务档案里的记录,父级是目录 —— 带上顶层分类,否则只看到「申报与认定」 */
          const where = par && par.id !== "root" ? (cat && cat !== par.name ? `${cat} › ${par.name}` : par.name) : "";
          sub = where ? `<span class="row-sub">› ${esc(where)}</span>` : "";
        } else if (isFolder) {
          const bits = [b.code, b.status, b.category, b.year].filter(Boolean);
          if (b.kind === "trash" && b.typeName) sub = `<span class="row-sub">${esc(b.typeName)}</span>`;
          else if (bits.length) sub = `<span class="row-sub">${esc(bits.join(" · "))}</span>`;
          /* 没有业务副标题就留空 —— 子项数量已经由「大小」列给出,不再重复一遍 */
        }

        return `<div class="row ${sel ? "is-selected" : ""}" data-id="${esc(it.id)}" draggable="true">
          <span class="row-check">${icon("check", 10)}</span>
          <div class="col-name">
            <span class="row-icon">${this.nodeMark(it, 20)}</span>
            <span class="row-title">${esc(it.name)}</span>
            ${it.starred ? `<span style="color:#c19c00;display:flex">${icon("star", 12)}</span>` : ""}
            ${sub}
          </div>
          <div class="col-date">${isFolder && it.dateLabel ? esc(it.dateLabel) : fmtDate(it.mtime)}</div>
          <div class="col-size">${isFolder ? (it.children?.length ? `${it.children.length} 项` : "—") : fmtSize(it.size)}</div>
          <div class="col-gap"></div>
          <div class="row-actions">
            <button class="icon-btn" data-row-act="more" data-id="${esc(it.id)}" title="更多">${icon("more", 15)}</button>
          </div>
        </div>`;
      })
      .join("");
  },

  /* 台账行:按列集顺序铺开,名称列也由列集给出位置。
     第一列的勾选框和末尾的「更多」都是 absolute,不参与网格排版。 */
  renderLedger(items, cols) {
    return items
      .map((it) => {
        const sel = this.state.selection.has(it.id);
        const cells = cols
          .map((c, i) => {
            if (c.k === "_name") {
              return `<div class="col-name${i === 0 ? " is-first" : ""}">
                <span class="row-icon">${this.nodeMark(it, 20)}</span>
                <span class="row-title">${esc(it.name)}</span>
                ${it.starred ? `<span style="color:#c19c00;display:flex">${icon("star", 12)}</span>` : ""}
              </div>`;
            }
            const html = this.cellHtml(it, c, i === 0);
            return html;
          })
          .join("");
        return `<div class="row is-ledger ${sel ? "is-selected" : ""}" data-id="${esc(it.id)}" draggable="true">
          <span class="row-check">${icon("check", 10)}</span>
          ${cells}
          <div class="col-gap"></div>
          <div class="row-actions">
            <button class="icon-btn" data-row-act="more" data-id="${esc(it.id)}" title="更多">${icon("more", 15)}</button>
          </div>
        </div>`;
      })
      .join("");
  },

  renderGrid(items) {
    return `<div class="grid">${items
      .map((it) => {
        const sel = this.state.selection.has(it.id);
        const isFolder = it.type === "folder";
        return `<div class="tile ${sel ? "is-selected" : ""}" data-id="${esc(it.id)}" draggable="true">
          <span class="tile-check">${icon("check", 11)}</span>
          <div class="tile-thumb">${this.nodeMark(it, 52, true)}</div>
          <div class="tile-name">${esc(it.name)}</div>
          <div class="tile-meta">${isFolder ? `${(it.children || []).length} 项` : fmtSize(it.size)}</div>
        </div>`;
      })
      .join("")}</div>`;
  },

  loadingHtml() {
    return `<div class="empty"><div class="spinner"></div><h3>正在读取资料库</h3><p>首次打开需要几秒钟。</p></div>`;
  },

  errorHtml(msg) {
    return `<div class="empty">${icon("info", 44)}<h3>读取失败</h3>
      <p>${esc(msg)}</p>
      <button class="btn" style="margin-top:14px" data-retry>重试</button></div>`;
  },

  emptyHtml() {
    const s = this.state;
    if (s.query.trim()) {
      return `<div class="empty">${icon("search", 44)}<h3>没有找到“${esc(s.query)}”</h3><p>请检查拼写,或尝试其他关键词。</p></div>`;
    }
    if (s.view === "recycle") {
      return `<div class="empty">${icon("trash", 44)}<h3>回收站是空的</h3><p>删除的记录会在这里保留 30 天。</p></div>`;
    }
    /* 筛选造成的空,和"这个分类本来就没东西"要分开说,否则用户会以为数据丢了 */
    if (s.statusFilter || s.extFilter) {
      const what = s.statusFilter ? `状态为「${esc(s.statusFilter)}」的记录` : "符合条件的文件";
      return `<div class="empty">${icon("filter", 44)}<h3>没有${what}</h3>
        <p>再点一次顶部的「筛选」,选「全部」即可清除条件。</p></div>`;
    }
    return `<div class="empty">${icon("folder", 44)}<h3>这里还没有内容</h3>
      <p>点击“新建”添加一条记录,或把文件拖进来。</p></div>`;
  },

  /* ---------- 详细信息面板 ---------- */

  renderDetail() {
    const panel = $("#detail");
    /* 首页把库概况并进了右栏「资料库」卡片,再开详情就是重复信息 */
    const open = this.state.detailOpen && this.state.view !== "home";
    panel.classList.toggle("open", open);
    if (!open) return;

    const s = this.state;
    const items = this.selectedItems;
    const body = $("#detailBody");
    const locked = s.view === "recycle";

    /* 未选中：当前文件夹信息 */
    if (items.length === 0) {
      const f = s.view === "files" ? this.currentFolder : null;
      if (!f) {
        const sum = s.ready ? VaultStore.summary() : [];
        const all = s.ready ? allFiles(ROOT) : [];
        body.innerHTML = `
          <div class="detail-hero">
            <div class="big-icon">${s.view === "home" ? icon("home", 56) : icon("trash", 56)}</div>
            <div class="detail-title">${esc(s.view === "home" ? VaultStore.dbName || "资料库" : "回收站")}</div>
            <div class="detail-sub">${
              s.view === "recycle" ? RECYCLE.length + " 项" : `${all.length} 个附件`
            }</div>
          </div>
          ${
            s.view === "home" && sum.length
              ? `<div class="detail-section" style="border-bottom:0">
                  <h4>资料构成</h4>
                  ${sum
                    .map(
                      (c) =>
                        `<div class="detail-line"><span>${esc(c.name)}</span><span>${c.count} 条 / ${c.files} 份</span></div>`
                    )
                    .join("")}
                </div>`
              : ""
          }`;
        return;
      }
      const kids = f.children || [];
      const files = kids.filter((k) => k.type === "file").length;
      const folders = kids.length - files;
      /* 分类文件夹里挂的是记录,附件在记录里,所以附件数要递归统计 */
      const st = folderStats(f);
      body.innerHTML = `
        <div class="detail-hero">
          <div class="big-icon">${this.nodeMark(f, 56, true)}</div>
          <div class="detail-title">${esc(f.name)}</div>
          <div class="detail-sub">${folders ? `${folders} 条记录 · ${st.count} 个附件` : `${files} 个附件`}</div>
        </div>
        <div class="detail-section" style="border-bottom:0">
          <h4>位置</h4>
          <div class="detail-line"><span>路径</span><span>${esc((pathTo(f.id) || [ROOT]).map((x) => x.name).join(" / "))}</span></div>
        </div>`;
      return;
    }

    /* 多选 */
    if (items.length > 1) {
      const total = items.reduce((a, b) => a + (b.size || 0), 0);
      body.innerHTML = `
        <div class="detail-hero">
          <div class="big-icon" style="color:var(--brand)">${icon("copy", 56)}</div>
          <div class="detail-title">已选择 ${items.length} 项</div>
          <div class="detail-sub">${total ? `共 ${fmtSize(total)}` : "均为记录"}</div>
        </div>
        <div class="detail-actions">
          ${locked ? "" : `<button class="btn" data-detail-act="download">${icon("download", 16)}下载</button>`}
          <button class="btn" data-detail-act="delete">${icon("trash", 16)}${locked ? "彻底删除" : "删除"}</button>
        </div>
        <div class="detail-section" style="border-bottom:0">
          <h4>包含</h4>
          ${items
            .slice(0, 6)
            .map(
              (i) =>
                `<div class="detail-line"><span class="ellipsis">${esc(i.name)}</span><span>${
                  i.type === "folder" ? `${(i.children || []).length} 项` : fmtSize(i.size)
                }</span></div>`
            )
            .join("")}
          ${items.length > 6 ? `<div class="detail-line"><span>…还有 ${items.length - 6} 项</span><span></span></div>` : ""}
        </div>`;
      return;
    }

    const it = items[0];
    const b = it.biz || {};
    const parent = findParent(it.id);
    const path = parent ? (pathTo(parent.id) || [ROOT]).map((n) => n.name).join(" / ") : "回收站";
    const isFolder = it.type === "folder";

    /* 「修改」入口:只有挂在分类下、带业务字段的记录才给。
       固定分类(没有记录可改)、附件、回收站里的删除项都不出现这个按钮。 */
    const canEdit = isFolder && !it.synthetic && !locked && !!b.kind && b.kind !== "trash" && b.kind !== "archive_folder" && !!b.id;
    const editAct = canEdit
      ? `<button class="sec-act" data-detail-act="edit" title="修改这条记录的属性">${icon("rename", 13)}<span>修改</span></button>`
      : "";

    const actions = `
      <div class="detail-actions">
        ${
          isFolder
            ? `<button class="btn solid" data-detail-act="open">${icon("folder", 16)}打开</button>`
            : `<button class="btn solid" data-detail-act="preview">${icon("eye", 16)}预览</button>`
        }
        ${
          locked
            ? `<button class="btn" data-detail-act="restore">${icon("restore", 16)}还原</button>`
            : `<button class="btn" data-detail-act="download">${icon("download", 16)}下载</button>
               <button class="btn" data-detail-act="delete">${icon("trash", 16)}删除</button>`
        }
      </div>`;

    /* 业务字段：只显示有值的行 */
    const rows = [];
    const line = (k, v) => {
      if (v === undefined || v === null || v === "") return;
      rows.push(`<div class="detail-line"><span>${k}</span><span class="ellipsis">${esc(v)}</span></div>`);
    };

    if (isFolder) {
      line("编号", b.code);
      line("类型", b.typeName);
      line("状态", b.status);
      line("负责人", b.owner);
      line("承担单位", b.org);
      line("开始日期", b.start);
      line("结束日期", b.end);
      line("所属年度", b.year);
      line("类别", b.category);
      line("标签", b.tags);
    } else {
      line("大小", fmtSize(it.size));
      const meta = VaultStore.metaOf(it.id);
      if (meta) {
        line("版本", meta.version > 1 ? `第 ${meta.version} 版` : "初版");
        line("摘要", meta.sha256 ? meta.sha256.slice(0, 16) + "…" : "");
      }
    }

    body.innerHTML = `
      <div class="detail-hero">
        <div class="big-icon">${this.nodeMark(it, 56, true)}</div>
        <div class="detail-title">${esc(it.name)}</div>
        <div class="detail-sub">${
          isFolder
            ? it.synthetic
              ? `固定分类 · ${(it.children || []).length} 条记录`
              : b.typeName || "文件夹"
            : typeLabel(it)
        }</div>
      </div>

      ${actions}

      ${
        rows.length
          ? `<div class="detail-section">
              <h4>属性${editAct}</h4>
              ${rows.join("")}
              <div class="detail-line"><span>位置</span><span class="ellipsis">${esc(path)}</span></div>
            </div>`
          : `<div class="detail-section">
              <h4>属性${editAct}</h4>
              ${isFolder ? "" : `<div class="detail-line"><span>大小</span><span>${fmtSize(it.size)}</span></div>`}
              <div class="detail-line"><span>位置</span><span class="ellipsis">${esc(path)}</span></div>
            </div>`
      }

      ${
        isFolder && (it.children || []).length
          ? `<div class="detail-section" style="border-bottom:0">
              <h4>包含 ${it.children.length} 项</h4>
              ${it.children
                .slice(0, 5)
                .map(
                  (c) =>
                    `<div class="detail-line"><span class="ellipsis">${esc(c.name)}</span><span>${
                      c.type === "folder" ? "文件夹" : fmtSize(c.size)
                    }</span></div>`
                )
                .join("")}
              ${it.children.length > 5 ? `<div class="detail-line"><span>…还有 ${it.children.length - 5} 项</span><span></span></div>` : ""}
            </div>`
          : ""
      }

      ${
        b.remarks
          ? `<div class="detail-section" style="border-bottom:0">
              <h4>备注</h4>
              <p class="detail-note">${esc(b.remarks)}</p>
            </div>`
          : ""
      }`;
  },
};

/* ==========================================================================
   Boot
   ========================================================================== */

function bootStaticIcons() {
  const set = (id, svg) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = svg;
  };
  set("brandLogo", brandLogo(26, "top"));
  set("lockLogo", brandLogo(24, "lock"));
  set("searchIcon", icon("search", 16));
  set("searchClear", icon("close", 13));
  set("btnHelp", icon("help", 18));
  set("btnSettings", icon("settings", 18));
  set("settingsClose", icon("close", 15));

  const av = $("#btnAvatar");
  if (av) {
    /* 头像是矢量剪影,不再用姓氏首字 */
    av.innerHTML = icon("avatar", 21);
    av.title = ME.name;
  }

  set("icoNewSide", icon("plus", 18));
  set("icoNew", icon("plus", 17));
  set("icoUpload", icon("upload", 17));
  set("icoRefresh", icon("refresh", 17));
  set("icoSort", icon("sort", 17));
  set("icoFilter", icon("filter", 17));
  set("btnPinFolder", icon("plus", 14));
  set("btnDetailToggle", icon("info", 20));
  set("icoSelDownload", icon("download", 17));
  set("selClear", icon("close", 14));
  set("detailClose", icon("close", 15));
  set("upToggle", icon("chevronDown", 15));
  set("upClosePanel", icon("close", 15));
  set("icoUpCloud", icon("cloud", 15));
  set("icoSelDelete", icon("trash", 17));
}


/* ===== js/forms.js ===== */
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
        const opts = (f.options || []).map(
          (o) => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(o)}</option>`
        );
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
          if (parentId != null) payload.parentId = Number(parentId);
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
            applicationNo: r.applicationNo || "",
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
        { key: "applicationNo", label: "申请号" },
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
            name: d.name,
            ipType: d.ipType,
            status: d.status,
            applicants: d.applicants,
            rightHolders: d.rightHolders,
            creators: d.creators,
            applicationNo: d.applicationNo,
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

  /* ---------------- 分发 ---------------- */

  edit(node) {
    const kind = node?.biz?.kind;
    if (kind === "project") return this.project(node);
    if (kind === "archive") return this.archive(node.biz.section, node);
    if (kind === "ip") return this.ip(node);
    if (kind === "general") return this.general(node);
    toast("这条记录没有可编辑的业务字段");
  },
};


/* ===== js/interactions.js ===== */
/* ==========================================================================
   交互层 — OneDrive 的指针/键盘模型
   --------------------------------------------------------------------------
   单击选中、Ctrl/Shift 多选、双击进入、右键菜单、框选、拖拽、F2 重命名、
   Delete 删除、Backspace 返回上级。所有业务动作直接调用原服务端接口。
   ========================================================================== */

/* ---------------- 基础 UI ---------------- */

function toast(msg, { action, onAction, ms = 3400 } = {}) {
  const host = $("#toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement("button");
    b.className = "t-action";
    b.textContent = action;
    b.addEventListener("click", () => {
      onAction?.();
      el.remove();
    });
    el.append(b);
  }
  host.append(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 220);
  }, ms);
}

let _resolveConfirm = null;
function askConfirm({ title = "确认", text = "", okText = "确定", danger = false } = {}) {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  const ok = $("#confirmOk");
  ok.textContent = okText;
  ok.classList.toggle("danger", danger);
  $("#confirmMask").classList.add("show");
  return new Promise((resolve) => {
    _resolveConfirm = resolve;
  });
}

function settleConfirm(v) {
  $("#confirmMask").classList.remove("show");
  _resolveConfirm?.(v);
  _resolveConfirm = null;
}

const MI = (act, ic, label, shortcut = "", danger = false, disabled = false) =>
  `<button class="ctx-item ${danger ? "danger" : ""}" data-act="${act}" ${disabled ? "disabled" : ""}>
    ${ic ? (ic.startsWith("cat:") ? catIcon(ic.slice(4), 18) : icon(ic, 18)) : '<span class="ctx-dot"></span>'}
    <span>${label}</span>
    ${shortcut ? `<kbd>${shortcut}</kbd>` : ""}
  </button>`;

function showCtx(x, y, html, handlers) {
  const menu = $("#ctxMenu");

  /* 先解绑上一次的处理器:同一元素会被反复复用,
     只记最后一个 cleanup 会让旧监听器累积并抢走本次点击。 */
  hideCtx();

  menu.innerHTML = html;
  menu.classList.add("show");
  menu.style.left = "0px";
  menu.style.top = "0px";

  const r = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 8);
  const py = Math.min(y, window.innerHeight - r.height - 8);
  menu.style.left = `${Math.max(8, px)}px`;
  menu.style.top = `${Math.max(8, py)}px`;

  const onClick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    hideCtx();
    handlers[act]?.(b);
  };
  menu.addEventListener("click", onClick);
  menu._cleanup = () => menu.removeEventListener("click", onClick);
}

function hideCtx() {
  const menu = $("#ctxMenu");
  menu.classList.remove("show");
  menu._cleanup?.();
  $("#wsSwitchBtn")?.setAttribute("aria-expanded", "false");
}

document.addEventListener("mousedown", (e) => {
  /* 工作区按钮自己要处理「再点一次收起」,这里不抢它的 mousedown */
  if (e.target.closest("#ctxMenu") || e.target.closest("#wsSwitchBtn")) return;
  hideCtx();
});

/* ---------------- 节点解析 ---------------- */

/* id 前缀:
   root / k:分类 / af:业务档案目录 / p:项目 / a:section:档案 / i:知产 / g:综合 / f:link:版本 / t:kind:id */
function nodeTag(id) {
  return String(id).split(":")[0];
}

function isTrashNode(id) {
  return nodeTag(id) === "t";
}

function bizKindOf(node) {
  const b = node.biz || {};
  if (b.kind) return b.kind;
  const t = nodeTag(node.id);
  return { p: "project", af: "archive_folder", a: "archive", i: "ip", g: "general" }[t] || "";
}

/* ==========================================================================
   Boot
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  bootStaticIcons();
  Drive.render();
  if (typeof bootInteractions === "function") bootInteractions();
  startSession();
});

async function startSession() {
  try {
    const st = await VaultStore.status();
    if (st.unlocked && sessionStorage.getItem("od-token")) {
      VaultStore.token = sessionStorage.getItem("od-token");
      VaultStore.dbName = sessionStorage.getItem("od-db") || "";
      try {
        await VaultStore.api("/api/check");
        await enterWorkspace(defaultWorkspace());
        return;
      } catch {
        VaultStore.token = "";
        sessionStorage.clear();
      }
    }
  } catch (e) {
    showLogin(`本地服务不可用:${e.message}`);
    return;
  }
  showLogin();
}

function showLogin(hint) {
  const mask = $("#lockScreen");
  if (!mask) return;
  mask.classList.add("show");
  const hp = $("#lockHint");
  if (hp) hp.textContent = hint || "";

  VaultStore.getJson("/api/status")
    .then((s) => {
      /* 服务端已解锁但没有 token:改为密码恢复模式,路径只读 */
      VaultStore.needsResume = !!s.unlocked;
      const p = $("#dbPath");
      if (p && s.suggestion) p.value = s.suggestion;
      if (s.unlocked) {
        if (p) p.disabled = true;
        const sub = $(".lock-sub");
        if (sub) sub.textContent = "资料库仍处于打开状态。输入密码即可重新连接，数据全部保存在本地。";
      }
    })
    .catch(() => {});
}

/* 登录后统一进个人工作区。OneDrive 的默认落点就是「我的文件」,
   个人/企业是企业网盘附加的维度,不该抢默认位置。
   这里刻意不记忆上次选择:每次进来都从个人开始,需要看企业再手动切。 */
function defaultWorkspace() {
  /* 默认落在个人资料;设置里改过「启动工作区」就按设置来。
     注意:顶栏临时切换不写这个键,只有设置面板会改它。 */
  return Prefs.get("startWs", "personal") === "company" ? "company" : "personal";
}

async function enterWorkspace(ws) {
  ws = ws === "company" ? "company" : "personal";

  $("#lockScreen")?.classList.remove("show");
  const shell = $("#appShell");
  shell?.removeAttribute("aria-hidden");

  Drive.state.ready = false;
  Drive.state.loadError = null;
  Drive.state.wsPending = ws;
  Drive.render();

  try {
    await VaultStore.loadAll(ws);
    Drive.state.ready = true;
    Drive.state.wsPending = null;
    Drive.state.folderId = "root";
    Drive.state.view = "home";
    Drive.navigate("home");
    const av = $("#btnAvatar");
    if (av) av.title = VaultStore.dbName || ME.name;
  } catch (e) {
    Drive.state.ready = false;
    Drive.state.loadError = e.message;
    Drive.state.wsPending = null;
    Drive.render();
  }
}

/* 切换工作区:两套资料在服务端是独立命名空间,必须整树重载。
   文件夹 id 也带工作区前缀,不能沿用旧位置,统一回首页。 */
async function switchWorkspace(ws) {
  if (Drive.state.wsPending) {
    toast("正在加载，请稍候");
    return;
  }
  const cur = VaultStore.ws === "company" ? "company" : "personal";
  if (ws === cur) {
    toast(ws === "personal" ? "当前已在个人工作区" : "当前已在企业工作区");
    return;
  }
  Drive.state.selection.clear();
  Drive.state.history = [];
  await enterWorkspace(ws);
  if (!Drive.state.loadError) {
    toast(ws === "personal" ? "已切换到个人工作区" : "已切换到企业工作区");
  }
}

/* ==========================================================================
   Bind
   ========================================================================== */

function bootInteractions() {
  bindLockScreen();
  bindWorkspaceSwitch();
  bindTopBar();
  bindNav();
  bindCmdbar();
  bindContent();
  bindSelectionBar();
  bindDetail();
  bindSearch();
  bindSettings();
  bindKeyboard();
  bindOverlays();
  bindUploadPanel();
}

function bindLockScreen() {
  const form = $("#lockForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#submitOpen");
    btn.disabled = true;
    $("#lockHint").textContent = "";
    try {
      if (VaultStore.needsResume) {
        await VaultStore.resume($("#password").value);
      } else {
        await VaultStore.open($("#dbPath").value.trim(), $("#password").value, false);
      }
      sessionStorage.setItem("od-token", VaultStore.token);
      sessionStorage.setItem("od-db", VaultStore.dbName);
      $("#password").value = "";
      await enterWorkspace(defaultWorkspace());
    } catch (err) {
      $("#lockHint").textContent = err.message;
      btn.disabled = false;
    }
  });
}

function bindWorkspaceSwitch() {
  const btn = $("#wsSwitchBtn");
  if (!btn) return;

  const item = (ws, ic, label, cur) => `
    <button class="ctx-item ${ws === cur ? "is-current" : ""}" data-act="ws:${ws}">
      ${icon(ic, 18)}
      <span>${label}</span>
      ${ws === cur ? `<span class="ctx-check">${icon("check", 14)}</span>` : ""}
    </button>`;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if ($("#ctxMenu").classList.contains("show")) {
      hideCtx();
      return;
    }
    const cur = VaultStore.ws === "personal" ? "personal" : "company";
    const r = btn.getBoundingClientRect();
    showCtx(
      r.left,
      r.bottom + 6,
      [
        '<div class="ctx-title">切换工作区</div>',
        item("personal", "user", "个人工作区", cur),
        item("company", "building", "企业工作区", cur),
        '<div class="ctx-sep"></div>',
        `<div class="ctx-note">两套资料的分类与记录相互独立</div>`,
      ].join(""),
      {
        "ws:company": () => switchWorkspace("company"),
        "ws:personal": () => switchWorkspace("personal"),
      }
    );
    btn.setAttribute("aria-expanded", "true");
  });
}

function bindTopBar() {
  $("#brandBtn").addEventListener("click", () => Drive.navigate("home"));

  $("#btnHelp").addEventListener("click", () =>
    toast("单击选中,Ctrl 多选,Shift 连选,双击打开,右键更多")
  );

  $("#btnSettings").addEventListener("click", () => openSettings());

  $("#btnAvatar").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const other = VaultStore.ws === "company" ? "personal" : "company";
    showCtx(
      r.right - 210,
      r.bottom + 6,
      [
        `<div class="ctx-title">${esc(VaultStore.dbName || "资料库")}</div>`,
        MI("switch", "user", VaultStore.ws === "company" ? "切换到个人资料" : "切换到公司资料"),
        MI("settings", "settings", "设置"),
        '<div class="ctx-sep"></div>',
        MI("reload", "refresh", "刷新"),
        '<div class="ctx-sep"></div>',
        MI("lock", "info", "关闭资料库"),
      ].join(""),
      {
        switch: () => switchWorkspace(other),
        settings: () => openSettings(),
        reload: () => enterWorkspace(VaultStore.ws),
        lock: () => lockVault(),
      }
    );
  });
}

/* ---------------- 设置 ---------------- */

function openSettings() {
  const mask = $("#settingsMask");
  if (!mask) return;
  paintSettings();
  mask.classList.add("show");
}

function closeSettings() {
  $("#settingsMask")?.classList.remove("show");
}

function paintSettings() {
  const startWs = Prefs.get("startWs", "personal") === "company" ? "company" : "personal";

  $$("#settingsMask .seg").forEach((seg) => {
    const cur = seg.dataset.seg === "startWs" ? startWs : Drive.state.viewMode;
    $$("button", seg).forEach((b) => b.classList.toggle("is-on", b.dataset.v === cur));
  });

  const detail = $("#setDetail");
  if (detail) detail.checked = !!Drive.state.detailOpen;

  const db = $("#setDb");
  if (db) db.textContent = VaultStore.dbName || "未打开";
  /* 工作区与版本压到底栏一行:它们只读、只用于确认"我在哪",不值得占一整组 */
  const meta = $("#setFootMeta");
  if (meta) {
    meta.textContent = `${VaultStore.ws === "company" ? "企业工作区" : "个人工作区"} · 资料库 Web 0.9`;
  }

  /* 数据库块的三项状态都要现拉:MCP 开关是服务端状态,压缩信息每次都变,
     写死在 HTML 里会立刻过期。 */
  void paintMcpRow();
  void paintCompactRow();
}

/* ---------------- 设置 · 数据库块 ---------------- */

/* 压缩任务进行中时这个对象非空。对话框关掉再打开也要能接着显示,
   所以状态放在模块级而不是 DOM 上。 */
let compactTask = null;

function setCompactUi(text, { busy = false, can = false, tone = "" } = {}) {
  const btn = $("#setCompact");
  const msg = $("#setCompactMsg");
  if (!btn || !msg) return;
  msg.textContent = text;
  msg.className = tone;
  btn.textContent = busy ? "压缩中…" : "压缩";
  btn.disabled = busy || !can;
}

async function paintCompactRow() {
  const btn = $("#setCompact");
  if (!btn) return;
  if (compactTask) {
    setCompactUi("正在压缩，请保持程序运行…", { busy: true });
    return;
  }
  setCompactUi("正在读取空间信息…");
  try {
    const i = await VaultStore.getJson("/api/vault/compact/info");
    const bytes = Number(i.fileBytes) || 0;
    const free = Number(i.reusableBytes) || 0;
    setCompactUi(`当前 ${fmtSize(bytes) || "0 B"} · 空闲页约 ${fmtSize(free) || "0 B"}`, {
      can: !!i.canCompact,
    });
    btn.title = i.canCompact
      ? "永久删除释放的空间可被后续写入复用；压缩需额外磁盘空间，期间请勿关闭程序，不会自动备份"
      : "磁盘或系统临时目录剩余空间不足";
  } catch (e) {
    setCompactUi("无法读取空间信息：" + e.message);
  }
}

async function paintMcpRow() {
  const box = $("#setMcp");
  const msg = $("#setMcpMsg");
  if (!box || !msg) return;
  box.disabled = true;
  try {
    const r = await VaultStore.getJson("/api/mcp");
    box.checked = !!r.enabled;
    msg.textContent = r.enabled
      ? "已开启 · 本机可通过 MCP 操作资料库"
      : "默认关闭 · 仅当前 Windows 用户可用";
    box.disabled = false;
  } catch (e) {
    box.checked = false;
    msg.textContent = "当前环境不支持本机 MCP";
  }
}

async function runIntegrityCheck(btn) {
  const msg = $("#setCheckMsg");
  if (!msg) return;
  btn.disabled = true;
  msg.className = "";
  msg.textContent = "正在检查…";
  try {
    const r = await VaultStore.getJson("/api/check");
    /* 真实后端返回 { result, incomplete };预览服务早期只回了 { ok } */
    const result = r.result || (r.ok ? "ok" : "error");
    const ok = result === "ok";
    const inc = Number(r.incomplete) || 0;
    msg.className = ok ? "is-ok" : "is-bad";
    msg.textContent = ok
      ? `完整性正常，未完成附件 ${inc} 个`
      : `完整性异常：${result}`;
    if (ok) toast("数据库完整性检查通过");
  } catch (e) {
    msg.className = "is-bad";
    msg.textContent = "检查失败：" + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function startCompact() {
  if (compactTask) return;
  let info;
  try {
    info = await VaultStore.getJson("/api/vault/compact/info");
  } catch (e) {
    toast("无法读取空间信息：" + e.message);
    return;
  }
  if (!info.canCompact) {
    toast("磁盘或临时目录剩余空间不足，暂不能压缩");
    return;
  }
  const ok = await askConfirm({
    title: "压缩数据库",
    text:
      `数据库文件 ${fmtSize(Number(info.fileBytes) || 0)}，其中约 ${fmtSize(Number(info.reusableBytes) || 0)} 可回收。` +
      `压缩需要额外约 ${fmtSize(Number(info.requiredFreeBytes) || 0)} 磁盘空间，期间请勿关闭程序，也不会自动备份。`,
    okText: "开始压缩",
    danger: true,
  });
  if (!ok) return;

  try {
    const res = await VaultStore.api("/api/vault/compact", {
      method: "POST",
      json: { confirm: true },
    });
    const r = await res.json();
    compactTask = { id: r.taskId, timer: null };
    setCompactUi("正在压缩，请保持程序运行…", { busy: true });
    void pollCompact();
  } catch (e) {
    toast("无法启动压缩：" + e.message);
  }
}

async function pollCompact() {
  if (!compactTask) return;
  let st;
  try {
    st = await VaultStore.getJson("/api/vault/compact/task");
    if (compactTask && st.taskId && st.taskId !== compactTask.id) {
      throw new Error("压缩任务身份已变化");
    }
  } catch (e) {
    /* 读不到状态不等于任务失败,继续重试 */
    if (!compactTask) return;
    setCompactUi("状态暂时无法获取，继续重试…", { busy: true });
    compactTask.timer = setTimeout(pollCompact, 1300);
    return;
  }

  const terminal = ["succeeded", "failed", "canceled"].includes(st.state);
  if (!terminal) {
    setCompactUi(`${st.stage || "处理中"}…请保持程序运行`, { busy: true });
    compactTask.timer = setTimeout(pollCompact, 700);
    return;
  }

  clearTimeout(compactTask.timer);
  compactTask = null;
  if (st.state === "succeeded") {
    toast(
      `数据库压缩完成：${fmtSize(Number(st.bytesBefore) || 0)} → ${fmtSize(Number(st.bytesAfter) || 0)}`
    );
  } else {
    toast(`压缩未完成：${st.error || st.stage || st.state}`);
  }
  void paintCompactRow();
}

/* 头像菜单和设置面板共用同一段关库逻辑 */
async function lockVault() {
  const ok = await askConfirm({
    title: "关闭资料库",
    text: "关闭后需要重新输入密码，程序继续运行。",
    okText: "关闭",
    danger: true,
  });
  if (!ok) return;
  closeSettings();
  try {
    await VaultStore.api("/api/lock", { method: "POST" });
  } catch {}
  VaultStore.token = "";
  sessionStorage.clear();
  location.reload();
}

function bindSettings() {
  $("#settingsClose").addEventListener("click", closeSettings);
  $("#settingsDone").addEventListener("click", closeSettings);
  $("#settingsMask").addEventListener("mousedown", (e) => {
    if (e.target.id === "settingsMask") closeSettings();
  });

  $("#setCheck").addEventListener("click", (e) => runIntegrityCheck(e.currentTarget));
  $("#setCompact").addEventListener("click", () => startCompact());
  $("#setLock").addEventListener("click", () => lockVault());

  $("#setMcp").addEventListener("change", async (e) => {
    const box = e.currentTarget;
    const msg = $("#setMcpMsg");
    const want = box.checked;
    box.disabled = true;
    try {
      const res = await VaultStore.api("/api/mcp", { method: "POST", json: { enabled: want } });
      const r = await res.json();
      box.checked = !!r.enabled;
      if (msg) {
        msg.className = "";
        msg.textContent = r.enabled
          ? "已开启 · 本机可通过 MCP 操作资料库"
          : "默认关闭 · 仅当前 Windows 用户可用";
      }
      toast(r.enabled ? "已启用本机 MCP" : "已关闭本机 MCP");
    } catch (err) {
      box.checked = !want;
      if (msg) {
        msg.className = "is-bad";
        msg.textContent = "切换失败：" + err.message;
      }
    } finally {
      box.disabled = false;
    }
  });

  $("#settingsMask").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg button");
    if (!btn) return;
    const seg = btn.closest(".seg");
    const v = btn.dataset.v;

    if (seg.dataset.seg === "startWs") {
      Prefs.set("startWs", v);
      paintSettings();
      toast(`下次打开直接进入${v === "company" ? "企业" : "个人"}工作区`);
      return;
    }

    if (seg.dataset.seg === "view") {
      Prefs.set("view", v);
      Drive.state.viewMode = v;
      paintSettings();
      Drive.render();
    }
  });

  $("#setDetail").addEventListener("change", (e) => {
    const on = e.target.checked;
    Prefs.set("detail", on ? "1" : "0");
    Drive.state.detailOpen = on;
    Drive.renderDetail();
  });
}

function bindNav() {
  document.addEventListener("click", (e) => {
    /* 表头是动态生成的(列集变了就重建),所以勾选框和列排序必须走委托:
       一次性 addEventListener 绑在旧元素上,innerHTML 一换就失效。 */
    if (e.target.closest("#selectAll")) {
      Drive.toggleSelectAll();
      return;
    }
    const th = e.target.closest("#listHead .th-sort");
    if (th) {
      sortBy(th.dataset.sort);
      return;
    }

    /* 面包屑:点任意一段回到那一层(根节点 id 是 root,findById 认它) */
    const crumb = e.target.closest("[data-crumb]");
    if (crumb) {
      const id = crumb.dataset.crumb;
      if (id !== Drive.state.folderId) Drive.openFolder(id);
      return;
    }

    const nav = e.target.closest("[data-nav]");
    if (nav) {
      Drive.navigate(nav.dataset.nav);
      return;
    }
    const quick = e.target.closest("[data-quick]");
    if (quick) {
      Drive.state.history.push({ view: Drive.state.view, folderId: Drive.state.folderId });
      Drive.state.view = "files";
      Drive.state.folderId = quick.dataset.quick;
      Drive.state.selection.clear();
      Drive.state.query = "";
      const si = $("#searchInput");
      if (si) si.value = "";
      Drive.enterContext();
      Drive.render();
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) {
      const id = open.dataset.open;
      const node = findById(id);
      if (node?.type === "folder") Drive.openFolder(id);
      return;
    }
    /* 首页页头的主操作:命令栏在首页是隐藏的,入口在这里 */
    const pageAct = e.target.closest("[data-page-act]");
    if (pageAct) {
      const a = pageAct.dataset.pageAct;
      if (a === "upload") pickFiles();
      else if (a === "new") openNewMenu(pageAct);
      return;
    }
    if (e.target.closest("[data-retry]")) {
      enterWorkspace(VaultStore.ws);
    }
  });

  $("#btnNewSide").addEventListener("click", (e) => openNewMenu(e.currentTarget));
  $("#btnPinFolder").addEventListener("click", () => toast("「快捷访问」已按资料分类自动生成"));
}

function bindCmdbar() {
  $("#btnNew").addEventListener("click", (e) => openNewMenu(e.currentTarget));
  $("#btnUpload").addEventListener("click", () => pickFiles());

  $("#btnRefresh").addEventListener("click", async () => {
    const keep = Drive.state.folderId;
    await enterWorkspace(VaultStore.ws);
    const node = findById(keep);
    if (node) {
      Drive.state.folderId = keep;
      Drive.state.view = "files";
      Drive.render();
    }
    toast("已刷新");
  });

  $("#btnEmptyTrash").addEventListener("click", () => emptyRecycle());

  $("#btnSort").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = Drive.state;
    /* 台账里能排的是该分类的列;通用视图仍是文件语义的三项。
       名称列在列集里叫 _name,但排序键统一是 name —— 菜单直接用列标题,不再单列一项。 */
    const cols = Drive.columns();
    const items = cols
      ? cols.map((c) => [c.k === "_name" ? "name" : c.k, c.t])
      : [["name", "名称"], ["mtime", "修改日期"], ["size", "大小"]];
    showCtx(
      r.left,
      r.bottom + 6,
      items.map(([key, label]) => MI(`s-${key}`, s.sortBy === key ? "check" : "", label)).join("") +
        '<div class="ctx-sep"></div>' +
        MI("dir", "sort", s.sortDir === "asc" ? "升序" : "降序"),
      {
        ...Object.fromEntries(items.map(([key]) => [`s-${key}`, () => sortBy(key)])),
        dir: () => {
          s.sortDir = s.sortDir === "asc" ? "desc" : "asc";
          Drive.render();
        },
      }
    );
  });

  $("#btnFilter").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = Drive.state;

    /* 台账里筛的是「状态」,通用视图里筛的是扩展名。
       台账那一屏全是文件夹,按扩展名筛等于把列表清空,所以两条路分开走。 */
    if (Drive.columns()) {
      const pool = [...new Set((Drive.currentFolder.children || []).map((n) => n.biz?.status).filter(Boolean))];
      if (!pool.length) {
        toast("这个分类的记录还没有状态字段");
        return;
      }
      const opts = pool.map((v, i) => ({ id: `v-${i}`, label: v }));
      const apply = (v) => {
        s.statusFilter = v;
        Drive.renderContent();
        Drive.renderChrome();
      };
      showCtx(
        r.left,
        r.bottom + 6,
        MI("vf-all", s.statusFilter ? "" : "check", "全部状态") +
          '<div class="ctx-sep"></div>' +
          opts.map((o) => MI(o.id, s.statusFilter === o.label ? "check" : "", o.label)).join(""),
        {
          "vf-all": () => apply(null),
          ...Object.fromEntries(opts.map((o) => [o.id, () => apply(o.label)])),
        }
      );
      return;
    }

    const groups = [
      ["文档", ["doc", "docx", "pdf", "txt", "md", "wps"]],
      ["表格", ["xls", "xlsx", "csv"]],
      ["演示", ["ppt", "pptx"]],
      ["图片", ["png", "jpg", "jpeg", "gif", "webp", "bmp"]],
      ["压缩包", ["zip", "rar", "7z"]],
    ];
    showCtx(
      r.left,
      r.bottom + 6,
      MI("all", "minus", "全部文件") + '<div class="ctx-sep"></div>' + groups.map(([l], i) => MI(`g-${i}`, "filter", l)).join(""),
      {
        all: () => filterExt(null),
        ...Object.fromEntries(groups.map(([, exts], i) => [`g-${i}`, () => filterExt(exts)])),
      }
    );
  });

  $("#btnViewToggle").addEventListener("click", () => {
    Drive.state.viewMode = Drive.state.viewMode === "list" ? "grid" : "list";
    Drive.render();
  });

  $("#btnDetailToggle").addEventListener("click", () => {
    Drive.state.detailOpen = !Drive.state.detailOpen;
    Drive.renderDetail();
    Drive.renderChrome();
  });

}

function sortBy(key) {
  const s = Drive.state;
  if (s.sortBy === key) s.sortDir = s.sortDir === "asc" ? "desc" : "asc";
  else {
    s.sortBy = key;
    s.sortDir = "asc";
  }
  Drive.render();
}

function filterExt(exts) {
  Drive.state.extFilter = exts;
  Drive.renderContent();
  Drive.renderChrome();
}

/* ---------------- 新建菜单 ---------------- */

function openNewMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  const s = Drive.state;

  /* 首页没有"当前分类",新建时全部开放:表单提交时会把 kind/section
     写进自己的接口地址,记录自然落到对应分类,不依赖当前目录。 */
  const onHome = s.view === "home" && !s.query.trim();
  const tag = nodeTag(s.folderId);
  const cur = tag === "k" ? s.folderId.slice(2) : "";
  /* 公司「业务档案」的目录节点:在这里新建 = 建到该目录下 */
  const inDir = tag === "af" ? "achievement" : "";
  const parentId = tag === "af" ? s.folderId.slice(3) : null;
  const here = inDir || cur;

  /* 菜单项直接由当前工作区的分类表生成 —— 有几个模块就几项,
     顺序也和左侧导航一致,不另写一份清单。 */
  const rows = catsOf(VaultStore.ws).map((c) => {
    const label =
      c.id === "project" ? "新建项目" : c.id === "ip" ? "新建知识产权" : c.id === "general" ? "新建资料" : `新建${c.label}`;
    return { id: c.id, label, can: onHome || c.id === here };
  });

  const handlers = {
    upload: () => pickFiles(),
  };
  for (const m of rows) {
    handlers[`new-${m.id}`] =
      m.id === "project"
        ? () => RecordForms.project()
        : m.id === "ip"
        ? () => RecordForms.ip()
        : m.id === "general"
        ? () => RecordForms.general()
        : () => RecordForms.archive(m.id, null, m.id === "achievement" ? parentId : null);
  }

  /* 站在分类里,分类已经决定了子项类型,只留这一项 —— 不让用户再选一次。
     根目录 / 记录内部没有分类上下文,仍然全列出来但置灰,并提示先进入分类。 */
  const items = !onHome && here ? rows.filter((m) => m.can) : rows;

  showCtx(
    r.left,
    r.bottom + 6,
    items.map((m) => MI(`new-${m.id}`, `cat:${m.id}`, m.label, "", false, !m.can)).join("") +
      '<div class="ctx-sep"></div>' +
      MI("upload", "upload", "上传文件"),
    handlers
  );

  if (!onHome && !here) toast("先进入某个资料分类，才能新建记录");
}

/* ---------------- 内容区 ---------------- */

function bindContent() {
  const content = $("#content");

  content.addEventListener("click", (e) => {
    const actBtn = e.target.closest("[data-row-act]");
    if (actBtn) {
      e.stopPropagation();
      const r = actBtn.getBoundingClientRect();
      showItemMenu(actBtn.dataset.id, r.left, r.bottom + 4);
      return;
    }

    const row = e.target.closest(".row, .tile");
    if (!row) return;

    const id = row.dataset.id;
    const onCheck = e.target.closest(".row-check, .tile-check");
    /* Shift = 连选,Ctrl+Shift = 区间并入已有选择;
       点行首勾选框 = 逐条累加/取消(不需要按 Ctrl);点行内其它位置 = 单选。 */
    if (e.shiftKey) Drive.select(id, e.ctrlKey || e.metaKey ? "range-add" : "range");
    else if (e.ctrlKey || e.metaKey) Drive.select(id, "toggle");
    else if (onCheck) Drive.select(id, "toggle");
    else Drive.select(id, "single");

    row.focus?.();
  });

  content.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) return;
    const id = row.dataset.id;
    const item = findById(id) || RECYCLE.find((i) => i.id === id);
    if (!item) return;
    if (item.type === "folder" && !isTrashNode(id)) Drive.openFolder(id);
    else if (item.type === "file") previewFile(id);
  });

  content.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) {
      e.preventDefault();
      showBlankMenu(e.clientX, e.clientY);
      return;
    }
    e.preventDefault();
    const id = row.dataset.id;
    if (!Drive.state.selection.has(id)) Drive.select(id, "single");
    showItemMenu(id, e.clientX, e.clientY);
  });

  content.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".row, .tile, .icon-btn, .dash")) return;
    startMarquee(e);
  });

  /* 拖拽:把文件拖到记录上 = 把该附件挂到这条记录 */
  content.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) return;
    const item = findById(row.dataset.id);
    if (!item || item.type !== "file") {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", row.dataset.id);
    row.classList.add("is-dragging");
  });

  content.addEventListener("dragend", (e) => {
    e.target.closest(".row, .tile")?.classList.remove("is-dragging");
  });

  content.addEventListener("dragover", (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) return;
    const item = findById(row.dataset.id);
    if (!item || item.type !== "folder") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    row.classList.add("is-drop");
  });

  content.addEventListener("dragleave", (e) => {
    e.target.closest(".row, .tile")?.classList.remove("is-drop");
  });

  content.addEventListener("drop", async (e) => {
    const row = e.target.closest(".row, .tile");
    if (!row) return;
    row.classList.remove("is-drop");
    const target = findById(row.dataset.id);
    if (!target || target.type !== "folder") return;
    e.preventDefault();

    /* 外部文件拖入 → 上传到该记录 */
    if (e.dataTransfer.files?.length) {
      uploadFiles(e.dataTransfer.files, target);
      return;
    }

    const srcId = e.dataTransfer.getData("text/plain");
    const src = findById(srcId);
    if (!src || src === target) return;
    toast("附件移动需要后端支持 link 迁移；当前请用「上传」挂到目标记录");
  });

  /* 整页拖入 */
  ["dragover", "drop"].forEach((t) =>
    document.addEventListener(t, (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
    })
  );
  document.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    const node = findById(Drive.state.folderId);
    if (node?.type === "folder") uploadFiles(e.dataTransfer.files, node);
  });
}

function showItemMenu(id, x, y) {
  const item = findById(id) || RECYCLE.find((i) => i.id === id);
  if (!item) return;
  const trash = isTrashNode(id);
  const isFolder = item.type === "folder";
  const b = item.biz || {};

  if (trash) {
    showCtx(x, y, [
      MI("restore", "restore", "还原"),
      MI("purge", "trashForever", "彻底删除", "", true),
    ].join(""), {
      restore: () => recycleAction([item], "restore"),
      purge: () => recycleAction([item], "purge"),
    });
    return;
  }

  const html = [
    isFolder ? MI("open", "folder", "打开") : MI("open", "eye", "预览"),
    isFolder && b.kind !== "archive_folder" ? MI("props", "info", "属性") : "",
    !isFolder ? MI("download", "download", "下载") : "",
    '<div class="ctx-sep"></div>',
    isFolder && b.kind !== "archive_folder" ? MI("rename", "rename", "重命名", "F2") : "",
    b.kind !== "archive_folder" ? MI("delete", "trash", "删除", "Del", true) : "",
  ]
    .filter(Boolean)
    .join("");

  showCtx(x, y, html, {
    open: () => (isFolder ? Drive.openFolder(id) : previewFile(id)),
    props: () => RecordForms.edit(item),
    download: () => downloadFile(id),
    rename: () => toast("重命名请点「修改」或右键「属性」"),
    delete: () => deleteNodes([...Drive.state.selection].map((i) => findById(i) || RECYCLE.find((n) => n.id === i)).filter(Boolean)),
  });
}

function showBlankMenu(x, y) {
  const s = Drive.state;
  if (s.view !== "files") {
    showCtx(x, y, MI("refresh", "refresh", "刷新"), { refresh: () => enterWorkspace(VaultStore.ws) });
    return;
  }
  const cur = nodeTag(s.folderId) === "k" ? s.folderId.slice(2) : "";
  showCtx(
    x,
    y,
    [MI("new", "plus", "新建"), MI("upload", "upload", "上传"), '<div class="ctx-sep"></div>', MI("refresh", "refresh", "刷新")].join(""),
    {
      new: () => ($(`#btnNew`) ? openNewMenu($("#btnNew")) : null),
      upload: () => pickFiles(),
      refresh: () => enterWorkspace(VaultStore.ws),
    }
  );
}

/* ---------------- 框选 ---------------- */

function startMarquee(startEvt) {
  const box = $("#marquee");
  if (!box) return;
  const startX = startEvt.clientX;
  const startY = startEvt.clientY;
  /* 按住 Ctrl 拖框 = 并进已有选择,否则替换 */
  const base = startEvt.ctrlKey || startEvt.metaKey ? new Set(Drive.state.selection) : null;
  let dragging = false;

  const onMove = (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.abs(dx) + Math.abs(dy) < 4) return;
    dragging = true;

    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    box.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

    const rect = { left: x, top: y, right: x + w, bottom: y + h };
    const hits = base ? new Set(base) : new Set();
    $$("#viewRoot .row, #viewRoot .tile").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) hits.add(el.dataset.id);
    });
    Drive.state.selection = hits;
    Drive.renderChrome();
    Drive.renderDetail();
  };

  const onUp = () => {
    box.style.cssText = "display:none";
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (!dragging) Drive.clearSelection();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/* ---------------- 选择栏 ---------------- */

function bindSelectionBar() {
  $("#selClear").addEventListener("click", () => Drive.clearSelection());

  $("#selDownload").addEventListener("click", () => {
    const items = Drive.selectedItems.filter((i) => i.type === "file");
    if (!items.length) return toast("请选择附件后再下载");
    items.forEach((i, idx) => setTimeout(() => downloadFile(i.id), idx * 300));
  });

  $("#selDelete").addEventListener("click", () => {
    const items = Drive.selectedItems;
    if (!items.length) return;
    if (Drive.state.view === "recycle") recycleAction(items, "purge");
    else deleteNodes(items);
  });
}

function bindDetail() {
  $("#detailClose").addEventListener("click", () => {
    Drive.state.detailOpen = false;
    Drive.renderDetail();
    Drive.renderChrome();
  });

  $("#detailBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-detail-act]");
    if (!btn) return;
    const items = Drive.selectedItems;
    const one = items[0];

    switch (btn.dataset.detailAct) {
      case "open":
        if (one?.type === "folder") Drive.openFolder(one.id);
        break;
      case "preview":
        if (one) previewFile(one.id);
        break;
      case "download":
        items.filter((i) => i.type === "file").forEach((i) => downloadFile(i.id));
        if (!items.some((i) => i.type === "file")) toast("文件夹不包含可直接下载的附件");
        break;
      case "delete":
        if (Drive.state.view === "recycle") recycleAction(items, "purge");
        else deleteNodes(items);
        break;
      case "restore":
        recycleAction(items, "restore");
        break;
      case "edit":
        if (one) RecordForms.edit(one);
        break;
    }
  });
}

/* ---------------- 搜索 ---------------- */

function bindSearch() {
  const input = $("#searchInput");
  const wrap = $("#searchWrap");
  let timer = null;

  input.addEventListener("input", () => {
    wrap.classList.toggle("has-value", !!input.value);
    clearTimeout(timer);
    timer = setTimeout(() => {
      Drive.state.query = input.value;
      Drive.state.selection.clear();
      Drive.resetSort();
      if (Drive.state.query.trim() && Drive.state.view === "home") Drive.state.view = "files";
      Drive.render();
    }, 180);
  });

  $("#searchClear").addEventListener("click", () => {
    input.value = "";
    wrap.classList.remove("has-value");
    Drive.state.query = "";
    Drive.resetSort();
    Drive.render();
    input.focus();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      wrap.classList.remove("has-value");
      Drive.state.query = "";
      Drive.render();
      input.blur();
    }
  });
}

/* ---------------- 键盘 ---------------- */

function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    /* 设置面板在最上层,先处理它 */
    if ($("#settingsMask")?.classList.contains("show")) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSettings();
      }
      return;
    }

    if (e.target.matches("input, textarea, select")) return;
    if ($("#lockScreen")?.classList.contains("show")) return;

    const s = Drive.state;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      Drive.toggleSelectAll();
      return;
    }

    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      $("#searchInput").focus();
      return;
    }

    if (e.key === "Delete") {
      const items = Drive.selectedItems;
      if (!items.length) return;
      e.preventDefault();
      if (s.view === "recycle") recycleAction(items, "purge");
      else deleteNodes(items);
      return;
    }

    if (e.key === "F2") {
      e.preventDefault();
      if (s.selection.size === 1) toast("重命名请点「修改」或右键「属性」");
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      if (s.view === "files" && s.folderId !== "root") {
        const parent = findParent(s.folderId);
        if (parent) Drive.openFolder(parent.id);
      }
      return;
    }

    if (e.key === "Escape") {
      if ($("#ctxMenu").classList.contains("show")) return hideCtx();
      if (s.selection.size) return Drive.clearSelection();
    }

    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      Drive.goBack();
      return;
    }

    /* 上下键在列表内移动选中 */
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const ids = Drive.sortedItems.map((i) => i.id);
      if (!ids.length) return;
      e.preventDefault();
      const cur = s.anchorId || ids[0];
      const i = ids.indexOf(cur);
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      Drive.select(next, e.shiftKey ? "range" : "single");
      $$(`#viewRoot [data-id="${CSS.escape(next)}"]`)[0]?.scrollIntoView({ block: "nearest" });
    }
  });
}

/* ---------------- 遮罩层 ---------------- */

function bindOverlays() {
  $("#confirmOk").addEventListener("click", () => settleConfirm(true));
  $("#confirmCancel").addEventListener("click", () => settleConfirm(false));
  $("#confirmMask").addEventListener("mousedown", (e) => {
    if (e.target.id === "confirmMask") settleConfirm(false);
  });
}

/* ==========================================================================
   业务动作 — 全部走真实接口
   ========================================================================== */

async function deleteNodes(nodes) {
  /* 业务档案的系统目录不是记录,不能删;混合选中时把它们摘出去 */
  const dirs = nodes.filter((n) => (n.biz || {}).kind === "archive_folder");
  if (dirs.length) {
    nodes = nodes.filter((n) => (n.biz || {}).kind !== "archive_folder");
    toast("业务档案的目录不能删除");
  }
  if (!nodes.length) return;
  const ok = await askConfirm({
    title: "删除",
    text: `将 ${nodes.length} 项移到回收站？可以稍后还原。`,
    okText: "删除",
    danger: true,
  });
  if (!ok) return;

  try {
    for (const n of nodes) {
      if (n.type === "file") {
        const meta = VaultStore.metaOf(n.id);
        if (!meta) {
          toast(`${n.name}:找不到附件引用`, { ms: 5000 });
          continue;
        }
        await VaultStore.api(`/api/v2/files/${VaultStore.ws}/${meta.fileId}/links/${meta.linkId}`, { method: "DELETE" });
      } else {
        const b = n.biz || {};
        const kind = bizKindOf(n);
        if (!kind || !b.id) continue;
        const qs = kind === "archive" ? `?section=${encodeURIComponent(b.section || "")}` : "";
        await VaultStore.api(`/api/v2/folders/${VaultStore.ws}/${kind}/${b.id}${qs}`, { method: "DELETE" });
      }
    }
    toast(`已删除 ${nodes.length} 项`);
    Drive.clearSelection();
    await refreshCurrent();
  } catch (e) {
    toast(e.message, { ms: 6000 });
  }
}

async function recycleAction(nodes, op) {
  if (!nodes.length) return;
  if (op === "purge") {
    const ok = await askConfirm({
      title: "彻底删除",
      text: `将永久删除 ${nodes.length} 项,无法恢复。`,
      okText: "彻底删除",
      danger: true,
    });
    if (!ok) return;
  }

  try {
    const items = nodes
      .map((n) => {
        const r = n.biz?.raw;
        if (!r) return null;
        return { kind: r.kind, id: r.id, section: r.section || "" };
      })
      .filter(Boolean);

    if (!items.length) return toast("这些条目缺少回收站标识");

    await VaultStore.api(`/api/trash/${VaultStore.ws}/${op}`, { method: "POST", json: { items } });
    toast(op === "restore" ? `已还原 ${items.length} 项` : `已彻底删除 ${items.length} 项`);
    Drive.clearSelection();
    await refreshCurrent();
  } catch (e) {
    toast(e.message, { ms: 6000 });
  }
}

async function emptyRecycle() {
  if (!RECYCLE.length) return toast("回收站已经是空的");
  recycleAction(RECYCLE, "purge");
}

async function refreshCurrent() {
  const keep = Drive.state.folderId;
  const view = Drive.state.view;
  await VaultStore.loadAll(VaultStore.ws);
  const node = findById(keep);
  Drive.state.ready = true;
  if (node) {
    Drive.state.folderId = node.type === "folder" ? keep : findParent(keep)?.id || "root";
    Drive.state.view = view === "recycle" ? "recycle" : "files";
  } else {
    Drive.state.folderId = "root";
    Drive.state.view = "home";
  }
  Drive.render();
}

/* ---------------- 文件下载 / 预览 ---------------- */

function fileUrlOf(id) {
  const meta = VaultStore.metaOf(id);
  if (!meta) return null;
  const node = findById(id);
  const ownerKind = node?.biz?.ownerKind || "";
  if (ownerKind === "ip") {
    /* 知识产权附件走专属路由 */
    const owner = findParent(id);
    const ipId = owner ? Number(String(owner.id).split(":")[1]) : 0;
    return `/api/v2/ip/${VaultStore.ws}/${ipId}/files/${meta.fileId}/versions/${meta.version}/download`;
  }
  return `/api/v2/files/${VaultStore.ws}/${meta.fileId}/versions/${meta.version}/download`;
}

async function downloadFile(id) {
  const url = fileUrlOf(id);
  const node = findById(id);
  if (!url || !node) return toast("附件信息缺失");
  try {
    const res = await VaultStore.api(url);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = node.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 60000);
    toast(`已下载:${node.name}`);
  } catch (e) {
    toast(e.message, { ms: 6000 });
  }
}

async function previewFile(id) {
  const node = findById(id);
  if (!node) return;
  const url = fileUrlOf(id);
  if (!url) return toast("附件信息缺失");

  const ext = extOf(node.name);
  const isPdf = ext === "pdf";
  const isImg = ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext);

  if (!isPdf && !isImg) {
    const ok = await askConfirm({
      title: "预览",
      text: `「${node.name}」无法在浏览器内预览,是否下载？`,
      okText: "下载",
    });
    if (ok) downloadFile(id);
    return;
  }

  try {
    const res = await VaultStore.api(url);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);

    const mask = document.createElement("div");
    mask.className = "mask show preview-mask";
    mask.innerHTML = `
      <div class="preview-box">
        <div class="preview-head">
          <span>${esc(node.name)}</span>
          <button class="icon-btn sm" data-x>${icon("close", 15)}</button>
        </div>
        <div class="preview-body">${
          isPdf
            ? `<iframe src="${obj}" title="${esc(node.name)}"></iframe>`
            : `<img src="${obj}" alt="${esc(node.name)}">`
        }</div>
      </div>`;
    document.body.append(mask);
    const close = () => {
      mask.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 1000);
    };
    mask.querySelector("[data-x]").addEventListener("click", close);
    mask.addEventListener("mousedown", (e) => {
      if (e.target === mask) close();
    });
  } catch (e) {
    toast(e.message, { ms: 6000 });
  }
}

/* ---------------- 上传 ---------------- */

function pickFiles() {
  const node = findById(Drive.state.folderId);
  if (!node || node.type !== "folder") return toast("请先进入一条记录,再上传附件");
  if (nodeTag(node.id) === "k") return toast("请先进入具体记录,再上传附件");

  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.addEventListener("change", () => {
    if (input.files?.length) uploadFiles(input.files, node);
  });
  input.click();
}

const UploadQueue = [];
let uploading = false;

function uploadFiles(files, node) {
  if (!node || node.type !== "folder") return;
  const ownerId = node.biz?.id;
  if (!ownerId) return toast("当前记录无法接收附件");

  for (const f of files) {
    UploadQueue.push({ file: f, node, ownerId, progress: 0, state: "wait" });
  }
  openUploadPanel();
  pumpUpload();
}

function bindUploadPanel() {
  $("#upClosePanel")?.addEventListener("click", closeUploadPanel);
  $("#upToggle")?.addEventListener("click", () => $("#uploadPanel").classList.toggle("collapsed"));
  $("#upPause")?.addEventListener("click", () => toast("暂停需要在原客户端操作"));
}

function openUploadPanel() {
  $("#uploadPanel").classList.add("show", "expanded");
  renderUpload();
}

function closeUploadPanel() {
  $("#uploadPanel").classList.remove("show", "expanded");
}

function renderUpload() {
  const list = $("#upList");
  if (!list) return;
  list.innerHTML = UploadQueue.map(
    (it) => `<div class="upl-row ${it.state === "done" ? "is-done" : it.state === "error" ? "is-error" : ""}">
      <span class="upl-name">${esc(it.file.name)}</span>
      <span class="upl-pct">${it.state === "done" ? "已完成" : it.state === "error" ? "失败" : Math.round(it.progress) + "%"}</span>
      <div class="upl-bar"><div class="upl-fill" style="width:${it.progress}%"></div></div>
      ${it.state === "error" ? `<span class="upl-err">${esc(it.message || "")}</span>` : ""}
    </div>`
  ).join("");

  const done = UploadQueue.filter((i) => i.state === "done").length;
  const sum = $("#upSum");
  if (sum) sum.textContent = `${done} / ${UploadQueue.length}`;
  const ft = $("#upFooterText");
  if (ft) ft.textContent = done === UploadQueue.length ? "全部完成" : "正在上传…";
}

async function pumpUpload() {
  if (uploading) return;
  uploading = true;

  while (UploadQueue.some((i) => i.state === "wait")) {
    const it = UploadQueue.find((i) => i.state === "wait");
    it.state = "run";
    renderUpload();

    try {
      await uploadOne(it);
      it.progress = 100;
      it.state = "done";
    } catch (e) {
      it.state = "error";
      it.message = e.message;
    }
    renderUpload();
  }

  uploading = false;
  const failed = UploadQueue.filter((i) => i.state === "error").length;
  if (failed) toast(`${failed} 个文件上传失败`, { ms: 6000 });
  else toast(`已上传 ${UploadQueue.length} 个文件`);

  UploadQueue.length = 0;
  setTimeout(closeUploadPanel, 1600);
  await refreshCurrent();
}

function uploadOne(it) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const qs = `?folderId=${it.ownerId}`;

    xhr.open("POST", `/api/v2/files/${VaultStore.ws}/prepare${qs}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(it.file.name));
    if (VaultStore.token) xhr.setRequestHeader("X-IPSys-Token", VaultStore.token);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        it.progress = (e.loaded / e.total) * 90;
        renderUpload();
      }
    };

    xhr.onload = async () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let msg = `上传失败:${xhr.status}`;
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch {}
        return reject(new Error(msg));
      }

      let prepared;
      try {
        prepared = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error("暂存响应无法解析"));
      }

      try {
        await VaultStore.api(`/api/v2/files/${VaultStore.ws}/prepared/${prepared.ticket}/resolve`, {
          method: "POST",
          json: { choice: "independent" },
        });
        it.progress = 100;
        renderUpload();
        resolve();
      } catch (e) {
        reject(e);
      }
    };

    xhr.onerror = () => reject(new Error("网络中断"));
    xhr.send(it.file);
  });
}
