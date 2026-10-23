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
  flag: '<path d="M5.4 20.5V4.1"/><path d="M5.7 5.3c2.9-1.8 5.5 1.8 8.4 0 1.7-1 3.2-.7 4.5-.1v9.1c-1.6-.8-3.2-1.1-4.9 0-2.8 1.6-5.5-1.9-8 .1"/>',
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
  party:       { glyph: "flag",    color: "#C42B31", soft: "#FCEBEC" },
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
