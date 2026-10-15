// 网盘资源扫描：把 posts 里的网盘分享链接抽成结构化条目。
// 纯本地：不联网、不调用 AI。
import * as store from './store.mjs';
import { PLATFORMS, extractNetdisk, titleForLink } from '../../core/netdisk.mjs';

const CURSOR_KEY = 'netdisk:scannedPostId';
const BATCH = 2000;

const status = { running: false, mode: '', scanned: 0, found: 0, inserted: 0, merged: 0, startedAt: null, finishedAt: null, error: null };

export function getScanStatus() { return Object.assign({}, status); }
export function lastScanCursor() { return Number(store.getState(CURSOR_KEY, '0')) || 0; }

function ndWhere() { return PLATFORMS.map(() => 'domains LIKE ?').join(' OR '); }
function ndParams() { return PLATFORMS.map(p => '%' + p.frag + '%'); }

export function scanPosts(mode) {
  const d = store.open();
  const sinceId = mode === 'full' ? 0 : lastScanCursor();
  status.mode = mode; status.scanned = 0; status.found = 0; status.inserted = 0; status.merged = 0; status.error = null;

  let cursor = sinceId;
  const stmt = d.prepare('SELECT id,text,links,channel,date,url,value FROM posts WHERE id > ? AND (' + ndWhere() + ') ORDER BY id ASC LIMIT ?');
  const params = ndParams();

  for (;;) {
    const rows = stmt.all(cursor, ...params, BATCH);
    if (!rows.length) break;
    for (const row of rows) {
      cursor = Number(row.id);
      status.scanned++;
      const links = String(row.links || '').split(/\s+/).filter(Boolean);
      const items = extractNetdisk(links, row.text);
      if (!items.length) continue;
      for (const it of items) {
        status.found++;
        const r = store.netdiskUpsert({
          platform: it.platform, shareKey: it.shareKey, shareUrl: it.shareUrl, pwd: it.pwd,
          title: titleForLink(row.text, it.shareKey), postId: Number(row.id), channel: row.channel || '', postDate: row.date || '',
          postUrl: row.url || '', value: Number(row.value || 0),
        });
        if (r.inserted) status.inserted++; else if (r.merged) status.merged++;
      }
    }
    if (rows.length < BATCH) break;
  }

  if (cursor > sinceId) store.setState(CURSOR_KEY, String(cursor));
  return { scanned: status.scanned, found: status.found, inserted: status.inserted, merged: status.merged, maxId: cursor };
}

export function startScan(mode) {
  if (status.running) return { ok: false, error: '已有扫描任务在进行中' };
  const m = mode === 'full' ? 'full' : 'incremental';
  status.running = true; status.startedAt = Date.now(); status.finishedAt = null;
  Promise.resolve().then(() => scanPosts(m)).catch(e => {
    status.error = String(e.message || e);
  }).finally(() => {
    status.running = false; status.finishedAt = Date.now();
  });
  return { ok: true, started: true };
}
