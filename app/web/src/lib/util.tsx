import { ReactNode } from 'react';

export function cx(...parts: any[]) { return parts.filter(Boolean).join(' '); }

// 分类色：大幅降饱和。它们只是"哪个分类"的微弱提示，
// 不该和正文、强调色抢注意力。色相保留以维持辨识度。
export const CAT_COLOR: Record<string, string> = {
  '羊毛优惠': '#4f9e6a',
  '项目副业': '#a8823f',
  '实用工具': '#5e6ad2',
  '开源项目': '#7a6bb5',
  'AI与科技': '#4a8fa8',
  '服务器网络': '#a06a8a',
  '账号会员': '#9a8a45',
  '学习资源': '#4f9690',
  '数码硬件': '#a8734a',
  '资讯热点': 'var(--fg-mute)',
  '其他': 'var(--fg-mute)',
};
export function catColor(c: string) { return CAT_COLOR[c] || 'var(--fg-dim)'; }

function esc(s: string) { return s.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&'); }

export function highlight(text: string, terms: string[]): ReactNode {
  const t = String(text || '');
  const ts = (terms || []).map(x => String(x).trim()).filter(x => x.length >= 1 && x.length <= 24).slice(0, 8);
  if (!ts.length) return t;
  let re: RegExp;
  try { re = new RegExp('(' + ts.map(esc).join('|') + ')', 'gi'); } catch (e) { return t; }
  const parts = t.split(re);
  if (parts.length === 1) return t;
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p));
}

export function timeAgo(date: string) {
  if (!date) return '';
  const t = Date.parse(date + 'T00:00:00');
  if (isNaN(t)) return date;
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  if (d < 30) return d + ' 天前';
  if (d < 365) return Math.floor(d / 30) + ' 个月前';
  return Math.floor(d / 365) + ' 年前';
}

export function splitTitleBody(text: string) {
  const t = String(text || '').trim();
  const nl = t.indexOf('\n');
  if (nl > 0 && nl < 90) return { title: t.slice(0, nl), body: t.slice(nl + 1) };
  return { title: t.slice(0, 90), body: t.slice(90) };
}

export function fmtNum(n: number) {
  if (n == null) return '0';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
