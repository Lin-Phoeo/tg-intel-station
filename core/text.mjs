// 纯文本工具：无 IO、无副作用，可直接单测
export function decodeEntities(s) {
  if (!s) return "";
  return String(s)
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

export function stripTags(html) {
  if (!html) return "";
  let s = String(html);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|blockquote|li|tr|h[1-6])>/gi, "\n");
  s = s.replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, "$1");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  s = s.replace(/[ \t\u00a0]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export function normalizeText(t) {
  if (!t) return "";
  return String(t)
    .replace(/\u200b|\ufeff/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// FNV-1a 32 位，用于快速去重哈希
export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function domainOf(u) {
  try { return new URL(String(u).startsWith("//") ? "https:" + u : u).hostname.replace(/^www\./, ""); }
  catch (e) { return null; }
}

// 查询分词：按标点与空白切分
export function splitTerms(q) {
  return String(q || "")
    .replace(/[，。！？、；：""''（）【】《》,.!?;:()\[\]{}<>|\\/]/g, " ")
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// 单字分词：把 CJK 逐字用空格隔开，ASCII 保持连续。
// 索引侧与查询侧必须使用同一实现，否则短语查询无法命中。
//   "免费VPS加速" -> "免 费 VPS 加 速"
//   "中转站"      -> "中 转 站"
export function toGram(s) {
  return String(s || "")
    .replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, " $& ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniq(arr) { return [...new Set(arr)]; }
