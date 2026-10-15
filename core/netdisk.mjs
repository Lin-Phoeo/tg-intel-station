// 网盘分享链接解析（纯函数，无 DB、无网络）
// 平台识别与提取码正则移植自 syhyz1990/panAI。

// frag 是 domains 字段里的子串，供扫描时 SQL 预筛用。
export const PLATFORMS = [
  { key: 'quark', label: '夸克网盘', frag: 'pan.quark.cn', host: /pan\.quark\.cn/, re: /https?:\/\/pan\.quark\.cn\/s\/([a-zA-Z\d-]+)/i },
  { key: 'baidu', label: '百度网盘', frag: 'pan.baidu.com', host: /(pan|e?yun)\.baidu\.com/, re: /https?:\/\/(?:e?yun|pan)\.baidu\.com\/(?:doc\/|enterprise\/)?(?:s\/([\w~-]+)|share\/(\S{4,}))/i },
  { key: 'aliyun', label: '阿里云盘', frag: 'aliyundrive.com', host: /(aliyundrive|alipan)\.com|alywp\.net/, re: /https?:\/\/(?:(?:www\.)?(?:aliyundrive|alipan)\.com\/s|alywp\.net)\/([a-zA-Z\d]+)/i },
  { key: 'lanzou', label: '蓝奏云', frag: 'lanzou', host: /(lanzou[a-z]|lanzn)\.com/, re: /https?:\/\/(?:[a-zA-Z0-9\-.]+)?(?:lanzou[a-z]|lanzn)\.com\/([a-zA-Z\d_-]+)/i },
  { key: 'pan123', label: '123 盘', frag: '123pan', host: /123pan\.(com|cn)|123684\.com|123865\.com|123912\.com/, re: /https?:\/\/(?:[a-zA-Z0-9\-.]+)?(?:123pan\.(?:com|cn)|123684\.com|123865\.com|123912\.com)\/(?:s\/|123pan\/)?([\w-]{6,})/i },
  { key: 'xunlei', label: '迅雷云盘', frag: 'pan.xunlei.com', host: /pan\.xunlei\.com/, re: /https?:\/\/pan\.xunlei\.com\/s\/([\w-]{8,})/i },
  { key: '115', label: '115 网盘', frag: '115.com', host: /(115\.com|115cdn\.com|anxia\.com)/, re: /https?:\/\/(?:115\.com|115cdn\.com|anxia\.com)\/s\/([a-zA-Z\d]+)/i },
  { key: 'tianyi', label: '天翼云盘', frag: 'cloud.189.cn', host: /cloud\.189\.cn/, re: /https?:\/\/cloud\.189\.cn\/(?:t\/|web\/share\?code=)?([a-zA-Z\d]+)/i },
  { key: 'caiyun', label: '和彩云', frag: 'caiyun.139.com', host: /caiyun\.139\.com/, re: /https?:\/\/caiyun\.139\.com\/(?:m\/i|w\/i\/|web\/|front\/#\/detail)\??(?:linkID=)?([a-zA-Z\d]+)/i },
  { key: 'weiyun', label: '腾讯微云', frag: 'weiyun.com', host: /share\.weiyun\.com/, re: /https?:\/\/share\.weiyun\.com\/([a-zA-Z\d]+)/i },
  { key: 'uc', label: 'UC 网盘', frag: 'drive.uc.cn', host: /drive\.uc\.cn/, re: /https?:\/\/drive\.uc\.cn\/s\/([a-zA-Z\d]+)/i },
  { key: 'ctfile', label: '城通网盘', frag: 'ctfile', host: /(ctfile|545c|u062)\.com/, re: /https?:\/\/(?:[a-zA-Z\d\-.]+)?(?:ctfile|545c|u062)\.com\/\w+\/([a-zA-Z\d-]+)/i },
  { key: 'cowtransfer', label: '奶牛快传', frag: 'cowtransfer.com', host: /cowtransfer\.com/, re: /https?:\/\/(?:[a-zA-Z\d\-.]+)?cowtransfer\.com\/s\/([a-zA-Z\d]+)/i },
  { key: 'wenshushu', label: '文叔叔', frag: 'wenshushu', host: /(wenshushu|ws28)\.cn/, re: /https?:\/\/(?:www\.wenshushu|ws28)\.cn\/(?:k|box|f)\/(\w+)/i },
  { key: 'jianguoyun', label: '坚果云', frag: 'jianguoyun.com', host: /jianguoyun\.com/, re: /https?:\/\/www\.jianguoyun\.com\/p\/([\w-]+)/i },
  { key: 'flowus', label: 'FlowUs', frag: 'flowus.cn', host: /flowus\.cn/, re: /https?:\/\/flowus\.cn\/[\S ^/]*\/?share\/([a-z\d-]{20,})/i },
  { key: 'google', label: 'Google Drive', frag: 'drive.google.com', host: /drive\.google\.com/, re: /https?:\/\/drive\.google\.com\/(?:file\/d\/|drive\/folders\/|open\?id=)([a-zA-Z\d_-]+)/i },
  { key: 'mega', label: 'MEGA', frag: 'mega.nz', host: /mega\.(nz|co\.nz)/, re: /https?:\/\/mega\.(?:nz|co\.nz)\/(?:#F!|file\/|folder\/)?([\w!-]{8,})/i },
  { key: 'pikpak', label: 'PikPak', frag: 'pikpak', host: /(mypikpak|pikpak)\.(com|me)/, re: /https?:\/\/(?:mypikpak\.com|pikpak\.me)\/s\/([\w-]+)/i },
  { key: 'mediafire', label: 'MediaFire', frag: 'mediafire.com', host: /mediafire\.com/, re: /https?:\/\/www\.mediafire\.com\/file\/([\w-]+)/i },
  { key: 'wetransfer', label: 'WeTransfer', frag: 'wetransfer.com', host: /wetransfer\.com/, re: /https?:\/\/wetransfer\.com\/downloads\/([\w-]+)/i },
];

export function detectPlatform(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return null;
  for (const p of PLATFORMS) {
    const m = u.match(p.re);
    if (m && m[1]) return { platform: p.key, shareKey: m[1] };
  }
  for (const p of PLATFORMS) {
    if (p.host.test(u)) {
      try {
        const seg = new URL(u).pathname.split('/').filter(Boolean).pop() || '';
        if (seg) return { platform: p.key, shareKey: seg };
      } catch (e) {}
    }
  }
  return null;
}

export function normalizeShareUrl(url) {
  const raw = String(url || '').trim().replace(/[）)】\]，,。.、；;!！?？"'”’]+$/, '');
  try {
    const parsed = new URL(raw);
    // MEGA 的解密密钥就在 fragment 里，去掉整条链接就废了
    if (!/mega\.(nz|co\.nz)$/i.test(parsed.hostname)) parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch (e) { return raw; }
}

const PWD_RE = /wss:[a-zA-Z0-9]+|(?<=\s*(?:密|提取|访问|訪問|key|password|pwd|#|\?p=)\s*[码碼]?\s*[：:=]?\s*)[a-zA-Z0-9]{3,8}/i;

export function parsePwd(text, url) {
  const u = String(url || '');
  const qm = u.match(/[?&](?:pwd|p)=([a-zA-Z0-9]{3,8})/i);
  if (qm) return qm[1];
  const t = String(text || '').replace(/​/g, '').replace(/%3A/gi, ':');
  const m = t.match(PWD_RE);
  return m ? m[0].replace(/^wss:/i, '') : '';
}

const TG_NOISE = /Please open Telegram to view this post[\s\S]*$/i;

export function cleanTitle(text) {
  let t = String(text || '').replace(/​/g, '').replace(TG_NOISE, '').replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/标题\s*[：:]\s*(.+?)(?=\s*(?:说明|简介|下载地址|标签|资源|链接|类型)\s*[：:]|$)/);
  if (m && m[1]) t = m[1];
  else t = t.split(/[。！？!?]/)[0];
  // 模板里字段之间常用 emoji 分隔，捕获段尾部会带上它
  t = t.replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '');
  t = t.replace(/[\s\p{Extended_Pictographic}️‍·|/、，,]+$/u, '');
  t = t.replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
  // 行尾常挂一个字段标签（「…实战 链接：」）；要求带冒号，避免误伤「免费资源」这类结尾词
  t = t.replace(/\s*(?:链接|地址|下载地址|提取码|密码|网盘|资源)\s*[:：]\s*$/, '').trim();
  return t.slice(0, 120);
}

// 「❶链接:」「百度网盘链接：」这类只是字段标签，不是资源名
const LABEL_ONLY = /^(?:[❶-❿①-⑳0-9.、)）\s]|百度网盘|夸克网盘|阿里云盘|迅雷网盘|网盘|链接|地址|下载地址|下载|提取码|密码|资源|分享|备用|线路|说明|复制这段内容|请输入|打开|手机App|来自|的|和|与|[:：=，,。.、/\\|｜\-—]+)*$/;

function isLabelLine(s) {
  if (!s) return true;
  return LABEL_ONLY.test(s);
}

function cleanLines(text) {
  return String(text || '').replace(/​/g, '').replace(TG_NOISE, '').split('\n').map(s => s.trim());
}

// 正文里第一个像资源名的行（跳过 URL、纯标签、字段标签行）
function firstGoodLine(text) {
  for (const cand of cleanLines(text)) {
    if (!cand) continue;
    if (/^https?:\/\//i.test(cand)) continue;
    if (/^#[^\s#]+(\s+#[^\s#]+)*$/.test(cand)) continue;
    const cleaned = cleanTitle(cand);
    if (!cleaned || isLabelLine(cleaned)) continue;
    return cleaned.slice(0, 80);
  }
  return '';
}

// 合辑帖里一个帖子含多条资源，每条上方通常有自己的标题行。
// 优先取该链接所在行的上一有效行；找不到就取正文首个有效行。
export function titleForLink(text, shareKey) {
  const lines = cleanLines(text);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (shareKey && lines[i].includes(shareKey)) { idx = i; break; }
  }
  if (idx >= 0) {
    for (let i = idx - 1; i >= 0; i--) {
      const cand = lines[i];
      if (!cand) continue;
      if (/^https?:\/\//i.test(cand)) continue;
      if (/^#[^\s#]+(\s+#[^\s#]+)*$/.test(cand)) continue;
      const cleaned = cleanTitle(cand);
      if (!cleaned || isLabelLine(cleaned)) continue;
      return cleaned.slice(0, 80);
    }
  }
  return firstGoodLine(text);
}

export function extractNetdisk(links, text) {
  const urls = [];
  for (const u of (Array.isArray(links) ? links : [])) if (u) urls.push(String(u));
  const inText = String(text || '').match(/https?:\/\/[^\s<>"'）)】\]]+/g);
  if (inText) for (const u of inText) urls.push(u);

  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const d = detectPlatform(u);
    if (!d) continue;
    const k = d.platform + '|' + d.shareKey;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ platform: d.platform, shareKey: d.shareKey, shareUrl: normalizeShareUrl(u), pwd: parsePwd(text, u) });
  }
  return out;
}
