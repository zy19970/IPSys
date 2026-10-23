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
