// 纯解析：Telegram 公开预览页 / 链接 / 网页正文
import { decodeEntities, stripTags } from './text.mjs';

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

// 解析 t.me/s 预览页 HTML -> 消息数组
export function parseMessages(html, channel) {
  const out = [];
  if (!html) return out;
  const blocks = String(html).split('js-widget_message_wrap">').slice(1);
  for (const b of blocks) {
    const dp = b.match(/data-post="([^"]+)\/(\d+)"/);
    if (!dp) continue;
    const id = parseInt(dp[2], 10);
    const dt = (b.match(/<time datetime="([^"]+)"/) || [])[1] || null;
    const viewsRaw = (b.match(/tgme_widget_message_views">([^<]*)</) || [])[1] || null;

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
      i: id, d: dt,
      ts: dt ? Math.floor(Date.parse(dt) / 1000) : null,
      v: viewNum(viewsRaw), t: text, m: flags.join("+"),
      lp: lp.length ? lp : undefined,
      lk: lk.length ? [...new Set(lk)].slice(0, 12) : undefined,
      fw: fwd, au: author,
    });
  }
  return out;
}

// 解析用户粘贴的链接
//   t.me/xxx | t.me/s/xxx | @xxx | t.me/+invite | t.me/c/xxx | 任意 http(s)
export function parseLink(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const at = raw.match(/^@([A-Za-z][A-Za-z0-9_]{3,31})$/);
  if (at) return { kind: 'tme', username: at[1], msgId: null, url: 'https://t.me/' + at[1] };

  const m = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(.+)$/i);
  if (m) {
    let rest = m[1].replace(/^s\//i, '').replace(/\/+$/, '');
    const parts = rest.split('/');
    const username = parts[0];
    if (/^\+|^joinchat$/i.test(username)) return { kind: 'invite', username: '', msgId: null, url: raw };
    if (username.toLowerCase() === 'c') return { kind: 'private', username: '', msgId: null, url: raw };
    const msgId = parts[1] && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null;
    return { kind: 'tme', username: username, msgId: msgId, url: 'https://t.me/' + username };
  }

  if (/^https?:\/\//i.test(raw)) {
    let host = '';
    try { host = new URL(raw).hostname; } catch (e) { return null; }
    return { kind: 'web', username: '', msgId: null, url: raw, host: host };
  }
  return null;
}

// 网页正文提取：优先 og:*，回退 title/description + 去标签正文
export function extractWeb(html, url) {
  const src = String(html || '');
  const pick = (re) => { const m = src.match(re); return m ? decodeEntities(m[1]).trim() : ''; };
  const title = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) || pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const desc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const body = src
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ');
  const text = stripTags(body).replace(/[ \t]{2,}/g, ' ');
  const combined = (title ? title + '\n' : '') + (desc ? desc + '\n' : '') + text;
  return { title: title, text: combined.slice(0, 6000) };
}
