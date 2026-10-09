// Telegram public preview (t.me/s) parser + fetcher
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

export function stripTags(html) {
  if (!html) return "";
  let s = html;
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|blockquote|li|tr|h[1-6])>/gi, "\n");
  s = s.replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, "$1");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  s = s.replace(/[ \t\u00a0]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function viewNum(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^([\d.]+)\s*([KMkm])?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2]) n *= (m[2].toLowerCase() === "k" ? 1000 : 1000000);
  return Math.round(n);
}

const BOUNDARIES = [
  '<a class="tgme_widget_message_link_preview',
  '<div class="tgme_widget_message_footer',
  '<div class="tgme_widget_message_reply',
  '<div class="tgme_widget_message_poll',
  '<a class="tgme_widget_message_document_wrap',
];

export function parseMessages(html, channel) {
  const out = [];
  if (!html) return out;
  const blocks = html.split('js-widget_message_wrap">').slice(1);
  for (const b of blocks) {
    const dp = b.match(/data-post="([^"]+)\/(\d+)"/);
    if (!dp) continue;
    const id = parseInt(dp[2], 10);
    const dt = (b.match(/<time datetime="([^"]+)"/) || [])[1] || null;
    const viewsRaw = (b.match(/tgme_widget_message_views">([^<]*)</) || [])[1] || null;

    // ---- text ----
    let text = "";
    const marker = 'js-message_text" dir="auto">';
    const tIdx = b.indexOf(marker);
    let rawHtml = "";
    if (tIdx >= 0) {
      const start = tIdx + marker.length;
      let end = b.length;
      for (const c of BOUNDARIES) { const i = b.indexOf(c, start); if (i >= 0 && i < end) end = i; }
      rawHtml = b.slice(start, end);
      rawHtml = rawHtml.replace(/^<div class="tgme_widget_message_text js-message_text" dir="auto">/, "");
      text = stripTags(rawHtml);
    }

    // ---- link previews ----
    const lp = [];
    const lpRe = /<a class="tgme_widget_message_link_preview"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    let lm;
    while ((lm = lpRe.exec(b))) {
      const inner = lm[2];
      lp.push({
        u: decodeEntities(lm[1]),
        s: stripTags((inner.match(/link_preview_site_name[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ""),
        t: stripTags((inner.match(/link_preview_title[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ""),
      });
    }

    // ---- links in text ----
    const lk = [];
    const lkRe = /href="([^"]+)"/g;
    let km;
    while ((km = lkRe.exec(rawHtml))) {
      let u = decodeEntities(km[1]);
      if (/^(https?:)?\/\/(telegram\.org|t\.me\/share|cdn\d*\.telesco\.pe|cdn\d*\.telegram\.org)/.test(u)) continue;
      if (u.startsWith("//")) u = "https:" + u;
      if (!/^https?:/.test(u)) continue;
      lk.push(u);
    }

    // ---- media ----
    const flags = [];
    if (b.includes("tgme_widget_message_photo_wrap")) flags.push("photo");
    if (b.includes("grouped_media_wrap") || b.includes("js-message_grouped")) flags.push("album");
    if (b.includes("tgme_widget_message_video_wrap") || /<video[\s>]/.test(b)) flags.push("video");
    if (b.includes("tgme_widget_message_document_wrap")) flags.push("file");
    if (b.includes("tgme_widget_message_poll")) flags.push("poll");
    if (b.includes("tgme_widget_message_sticker")) flags.push("sticker");
    if (b.includes("tgme_widget_message_voice")) flags.push("voice");
    if (b.includes("tgme_widget_message_service")) flags.push("service");
    if (b.includes("tgme_widget_message_roundvideo")) flags.push("roundvideo");

    const fwd = stripTags((b.match(/tgme_widget_message_forwarded_from_name[^>]*>([\s\S]*?)<\/div>/) || [])[1] || (b.match(/tgme_widget_message_forwarded_from[^>]*>([\s\S]*?)<\/a>/) || [])[1] || "") || null;
    const author = stripTags((b.match(/tgme_widget_message_from_author[^>]*>([^<]*)</) || [])[1] || "") || null;

    out.push({
      i: id,
      d: dt,
      ts: dt ? Math.floor(Date.parse(dt) / 1000) : null,
      v: viewNum(viewsRaw),
      t: text,
      m: flags.join("+"),
      lp: lp.length ? lp : undefined,
      lk: lk.length ? [...new Set(lk)].slice(0, 12) : undefined,
      fw: fwd,
      au: author,
    });
  }
  return out;
}

let REQ = 0;
export function reqCount() { return REQ; }

export async function fetchHtml(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
        signal: AbortSignal.timeout(30000),
      });
      REQ++;
      if (r.status === 200) {
        const t = await r.text();
        if (t.length > 500) return t;
        return t;
      }
      if (r.status === 429 || r.status === 500 || r.status === 502) { await sleep(1200 * (i + 1)); continue; }
      return null;
    } catch (e) { await sleep(600 * (i + 1)); }
  }
  return null;
}
