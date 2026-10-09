// 同事件聚簇：给出条目的「聚簇键」，键相同且跨频道出现才视为同一事件。
// 纯函数，无 IO。
//
// 实测依据（87 万条语料）：
//   - 前 60 字完全相同仅 2.4% -> 精确重复已被建库去重覆盖，不做 SimHash
//   - 「第一条链接相同」44.3% 是假信号，那是 t.me/<作者名> 个人主页
//   - linux.do 同一话题被两个镜像频道同时搬运达 63.3% -> 最值得聚合
//   - 归一化时必须保留 ?v= ?id= 这类内容标识，否则会把不同视频/应用并成一条
//   - 单段路径 + 无有效查询 = 个人主页或通用页面（/home.php、/cart.php），不聚合
//   - 同一链接在同频道的每篇都出现 = 签名，靠「跨频道」条件排掉

const TRACKING_EXACT = new Set(['si', 'ref', 'from', 'spm', 'share_source', 'share_medium', 'share_plat', 'share_session_id', 'share_tag', 'timestamp', 'unique_k', 'vd_source', 'feature', 'src', 'source', 'fbclid', 'gclid', 'yclid', 'igshid', 'mc_cid', 'mc_eid', '_ga', 'ref_src', 'ref_url']);
const TRACKING_PREFIX = /^(utm_|share_|spm_|_hs|pk_)/i;

// 搜索页不是内容页，不参与聚合
const SEARCH_PATH = /\/(search|query|so|s)(\/|$)/i;
const SEARCH_PARAM = /^(q|query|keyword|kw|wd|search|word)$/i;

export function normalizeUrl(u) {
  try {
    const x = new URL(String(u).startsWith('//') ? 'https:' + u : String(u));
    const host = x.hostname.replace(/^www\./i, '').toLowerCase();
    if (SEARCH_PATH.test(x.pathname)) return null;
    for (const [k] of x.searchParams) if (SEARCH_PARAM.test(k)) return null;
    const path = x.pathname.replace(/\/+$/, '').toLowerCase();
    // 保留有意义的查询参数（?v= ?id=），只丢跟踪参数
    const keep = [];
    for (const [k, v] of x.searchParams) {
      if (TRACKING_EXACT.has(k.toLowerCase()) || TRACKING_PREFIX.test(k)) continue;
      keep.push(k + '=' + v);
    }
    keep.sort();
    const q = keep.length ? '?' + keep.join('&') : '';
    const segs = path.split('/').filter(Boolean);
    // 单段路径且无有效查询 -> 个人主页 / 通用页面，放弃聚合
    if (segs.length < 2 && !keep.length) return null;
    return host + path + q;
  } catch (e) { return null; }
}

const TME_SINGLE = /^https?:\/\/t\.me\/[^\/]+\/?$/i;
const NOISE_HOST = /telegram\.org|telesco\.pe|cdn.*telegram/i;

export function clusterKey(links) {
  const arr = (links || []).filter(Boolean);
  // 1) linux.do 论坛话题：两个镜像频道会搬运同一条，精度最高。
  //    但正文里可能引用别的话题（实测占 1.65%），那时无法判断哪条是本体，放弃聚合。
  const topics = new Set();
  for (const u of arr) {
    const m = String(u).match(/linux\.do\/t\/(?:[^\/]+\/)?(\d+)/);
    if (m) topics.add(m[1]);
  }
  if (topics.size === 1) return 'topic:' + [...topics][0];
  if (topics.size > 1) return null;

  // 2) 具体内容页链接。t.me 链接一律排除：指向 Telegram 帖子本身，
  //    实测多是频道签名/互推（同一链接横跨多个频道但正文毫不相关）。
  for (const u of arr) {
    if (/^https?:\/\/t\.me\//i.test(u) || NOISE_HOST.test(u)) continue;
    const n = normalizeUrl(u);
    if (n) return 'link:' + n;
  }
  return null;
}

export function isProfileLink(u) { return TME_SINGLE.test(u); }
