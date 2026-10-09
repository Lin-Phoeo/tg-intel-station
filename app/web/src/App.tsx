import { useEffect, useMemo, useRef, useState } from 'react';
import { search as searchApi, facets as facetsApi, getPost, related as relApi, getSettings } from './api';
import type { Post, Facets } from './api';
import { PostCard } from './components/PostCard';
import { Detail } from './components/Detail';
import { ChatPanel } from './components/ChatPanel';
import { SettingsModal } from './components/SettingsModal';
import { catColor, fmtNum } from './lib/util';

const PAGE = 40;
const DAYS = [
  { v: 0, label: '全部时间' },
  { v: 7, label: '近 7 天' },
  { v: 30, label: '近 30 天' },
  { v: 90, label: '近 90 天' },
  { v: 365, label: '近一年' },
];
const SORTS = [
  { v: 'relevance', label: '相关度' },
  { v: 'value', label: '价值分' },
  { v: 'date', label: '最新' },
  { v: 'views', label: '热度' },
];

const CAT_ORDER = ['羊毛优惠', '项目副业', '实用工具', '开源项目', 'AI与科技', '服务器网络', '账号会员', '学习资源', '数码硬件', '资讯热点', '其他'];
function catRank(k: string) { const i = CAT_ORDER.indexOf(k); return i < 0 ? 99 : i; }

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const [theme, setTheme] = useState(() => params.get('theme') || localStorage.getItem('tg.theme') || 'dark');
  const [size, setSize] = useState(() => localStorage.getItem('tg.size') || 'm');
  const [fac, setFac] = useState<Facets | null>(null);
  const [q, setQ] = useState(() => params.get('q') || '');
  const [dq, setDq] = useState(() => params.get('q') || '');
  const [cat, setCat] = useState(() => params.get('cat') || '');
  const [tags, setTags] = useState<string[]>([]);
  const [channel, setChannel] = useState('');
  const [days, setDays] = useState(0);
  const [sort, setSort] = useState('relevance');
  const [items, setItems] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('');
  const [sel, setSel] = useState<Post | null>(null);
  const [rel, setRel] = useState<Post[]>([]);
  const [panel, setPanel] = useState<'chat' | 'detail'>('chat');
  const [rightOpen, setRightOpen] = useState(true);
  const [favIds, setFavIds] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem('tg.favs') || '[]'); } catch (e) { return []; } });
  const [view, setView] = useState<'feed' | 'favs'>('feed');
  const [favPosts, setFavPosts] = useState<Post[]>([]);
  const [askPost, setAskPost] = useState<Post | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(() => params.get('settings') === '1');
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('tg.theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.setAttribute('data-size', size); localStorage.setItem('tg.size', size); }, [size]);
  useEffect(() => { localStorage.setItem('tg.favs', JSON.stringify(favIds)); }, [favIds]);
  useEffect(() => { facetsApi().then(setFac); }, []);
  const [providers, setProviders] = useState<{ id: string; name: string; hasKey: boolean }[]>([]);
  const [activeId, setActiveId] = useState('');
  function refreshProviders() {
    getSettings().then(r => { setProviders(r.settings.profiles || []); setActiveId(r.settings.activeId || ''); }).catch(() => {});
  }
  useEffect(() => { refreshProviders(); }, []);
  async function switchProvider(id: string) {
    setActiveId(id);
    try {
      await fetch('/api/settings/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) });
    } catch (e) {}
  }
  useEffect(() => { const t = setTimeout(() => setDq(q), 260); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') { setSettingsOpen(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const from = useMemo(() => days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : '', [days]);
  const filters = useMemo(() => ({ q: dq, category: cat, channel, tags, sort, from }), [dq, cat, channel, tags, sort, from]);

  async function load(p: number) {
    setLoading(true);
    try {
      const r = await searchApi({ ...filters, page: p, size: PAGE });
      setItems(prev => (p === 1 ? r.items : prev.concat(r.items)));
      setTotal(r.total);
      setMode(r.mode);
      setPage(p);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => { setView('feed'); load(1); }, [filters]);

  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get('post');
    if (pid) openById(Number(pid));
  }, []);

  useEffect(() => {
    const u = new URLSearchParams();
    if (dq) u.set('q', dq);
    if (cat) u.set('cat', cat);
    if (sel) u.set('post', String(sel.id));
    if (theme === 'light') u.set('theme', 'light');
    const s = u.toString();
    try { history.replaceState(null, '', s ? '?' + s : window.location.pathname); } catch (e) {}
  }, [dq, cat, sel, theme]);

  useEffect(() => {
    if (view !== 'feed') return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading && items.length < total && items.length > 0) load(page + 1);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [view, loading, items.length, total, page, filters]);

  async function openPost(p: Post) {
    setSel(p);
    setPanel('detail');
    setRightOpen(true);
    setRel([]);
    relApi(p.id).then(r => setRel(r.items || [])).catch(() => {});
  }
  async function openById(id: number) {
    try { const p = await getPost(id); if (p && (p as any).id) openPost(p); } catch (e) {}
  }
  function toggleFav(p: Post) {
    setFavIds(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : prev.concat([p.id]));
  }
  async function showFavs() {
    setView('favs');
    const ps = await Promise.all(favIds.slice(0, 80).map(id => getPost(id).catch(() => null)));
    setFavPosts(ps.filter(Boolean) as Post[]);
  }
  function ask(p: Post) { setAskPost(p); setPanel('chat'); setRightOpen(true); }

  const terms = useMemo(() => dq.split(/\s+/).filter(Boolean), [dq]);
  const shown = view === 'favs' ? favPosts : items;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* ---------- sidebar ---------- */}
      <aside className="surface" style={{ width: 248, flexShrink: 0, borderRight: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg, var(--accent), var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>⚡</div>
            <div>
              <div style={{ fontWeight: 750, fontSize: 15, letterSpacing: '.02em' }}>电报情报站</div>
              <div style={{ fontSize: 11, color: 'var(--fg-mute)' }}>{'技术线报 · 项目雷达'}</div>
            </div>
          </div>
        </div>

        <div style={{ padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button className="btn ghost" style={{ justifyContent: 'flex-start', background: view === 'feed' ? 'var(--bg-3)' : 'transparent', color: view === 'feed' ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={() => { setView('feed'); setCat(''); setTags([]); setChannel(''); setQ(''); }}>📡 全部信息流</button>
          <button className="btn ghost" style={{ justifyContent: 'flex-start', background: view === 'favs' ? 'var(--bg-3)' : 'transparent', color: view === 'favs' ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={showFavs}>{'★ 我的收藏 (' + favIds.length + ')'}</button>
          <button className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { setPanel('chat'); setRightOpen(true); }}>✨ AI 情报助手</button>
        </div>

        <div className="divider" style={{ margin: '10px 0' }} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 20px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', padding: '0 6px 6px', letterSpacing: '.08em' }}>分类</div>
          <button className="btn ghost" style={{ justifyContent: 'space-between', width: '100%', background: !cat ? 'var(--bg-3)' : 'transparent', color: !cat ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={() => setCat('')}><span>全部分类</span><span style={{ fontSize: 11.5 }}>{fac ? fmtNum(fac.meta.count ? Number(fac.meta.count) : 0) : ''}</span></button>
          {fac && fac.categories.slice().sort((a, b) => catRank(a.k) - catRank(b.k)).map(c => (
            <button key={c.k} className="btn ghost" style={{ justifyContent: 'space-between', width: '100%', background: cat === c.k ? 'var(--bg-3)' : 'transparent', color: cat === c.k ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={() => setCat(cat === c.k ? '' : c.k)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: catColor(c.k) }} />
                {c.k}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--fg-mute)' }}>{fmtNum(c.n)}</span>
            </button>
          ))}

          <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', padding: '16px 6px 6px', letterSpacing: '.08em' }}>热门标签</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 4px' }}>
            {fac && fac.tags.slice(0, 22).map(t => (
              <span key={t.k} className={'chip' + (tags.includes(t.k) ? ' on' : '')} onClick={() => setTags(prev => prev.includes(t.k) ? prev.filter(x => x !== t.k) : prev.concat([t.k]))}>{t.k}</span>
            ))}
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', padding: '16px 6px 6px', letterSpacing: '.08em' }}>频道</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 4px' }}>
            {fac && fac.channels.map(c => (
              <span key={c.k} className={'chip' + (channel === c.k ? ' on' : '')} onClick={() => setChannel(channel === c.k ? '' : c.k)}>{'@' + c.k}</span>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-soft)', padding: 10, display: 'flex', gap: 6 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀ 浅色' : '☾ 深色'}</button>
          <button className="btn ghost" title="字号" onClick={() => setSize(size === 'm' ? 'l' : size === 'l' ? 's' : 'm')}>{'A' + (size === 's' ? '-' : size === 'l' ? '+' : '')}</button>
          <button className="btn ghost" onClick={() => setSettingsOpen(true)}>⚙</button>
        </div>
      </aside>

      {/* ---------- main ---------- */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="surface" style={{ borderBottom: '1px solid var(--border-soft)', padding: '12px 18px' }}>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
              <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="搜索 85 万条帖子：免费 VPS、GitHub、AI 中转站、副业…  （按 / 聚焦）" style={{ width: '100%', paddingLeft: 34, height: 38 }} />
              <span style={{ position: 'absolute', left: 12, top: 9, color: 'var(--fg-mute)' }}>🔍</span>
              {q && <button className="btn ghost" style={{ position: 'absolute', right: 6, top: 5, padding: '3px 8px' }} onClick={() => setQ('')}>✕</button>}
            </div>
            <select value={sort} onChange={e => setSort(e.target.value)} style={{ height: 38 }}>{SORTS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}</select>
            <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ height: 38 }}>{DAYS.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}</select>
            {providers.length > 0 && (
              <select value={activeId} onChange={e => switchProvider(e.target.value)} title="切换 AI 服务商" style={{ height: 38, maxWidth: 190 }}>
                {providers.map(p => <option key={p.id} value={p.id}>{(p.hasKey ? '● ' : '○ ') + p.name}</option>)}
              </select>
            )}
            <button className={'btn' + (rightOpen && panel === 'chat' ? ' primary' : '')} style={{ height: 38 }} onClick={() => { setPanel('chat'); setRightOpen(true); }}>✨ AI 助手</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: 'var(--fg-dim)' }}>
              {view === 'favs' ? <>{'收藏 ' + favPosts.length + ' 条'}</> : <>{loading && page === 1 ? '检索中…' : ('找到约 ' + fmtNum(total) + ' 条')}{mode === 'like' ? '（短词模糊匹配）' : ''}</>}
            </span>
            {(cat || channel || tags.length > 0 || dq) && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {cat && <span className="chip on" onClick={() => setCat('')}>{cat + ' ✕'}</span>}
                {channel && <span className="chip on" onClick={() => setChannel('')}>{'@' + channel + ' ✕'}</span>}
                {tags.map(t => <span key={t} className="chip on" onClick={() => setTags(prev => prev.filter(x => x !== t))}>{t + ' ✕'}</span>)}
                <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => { setCat(''); setChannel(''); setTags([]); setQ(''); }}>清空筛选</button>
              </span>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 60px' }}>
          {view === 'favs' && favPosts.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--fg-mute)', paddingTop: 80 }}>还没有收藏。点击任意条目右上角的 ☆ 收藏。</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 900, margin: '0 auto' }}>
            {shown.map(p => <PostCard key={p.id} post={p} active={sel?.id === p.id} terms={terms} onOpen={openPost} />)}
          </div>
          {view === 'feed' && loading && page === 1 && <div style={{ textAlign: 'center', color: 'var(--fg-mute)', padding: 40 }}>正在检索…</div>}
          {view === 'feed' && !loading && items.length === 0 && <div style={{ textAlign: 'center', color: 'var(--fg-mute)', padding: 70 }}>没有匹配的结果，试试换个关键词或清空筛选。</div>}
          {view === 'feed' && items.length > 0 && items.length < total && (
            <div ref={sentinelRef} style={{ textAlign: 'center', padding: 24 }}>
              <button className="btn" onClick={() => load(page + 1)} disabled={loading}>{loading ? '加载中…' : '加载更多'}</button>
            </div>
          )}
        </div>
      </main>

      {/* ---------- right panel ---------- */}
      {rightOpen && (
        <aside className="surface" style={{ width: 500, flexShrink: 0, borderLeft: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--border-soft)' }}>
            <button className={'btn ghost' + (panel === 'chat' ? '' : '')} style={{ background: panel === 'chat' ? 'var(--bg-3)' : 'transparent', color: panel === 'chat' ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={() => setPanel('chat')}>✨ AI 助手</button>
            <button className="btn ghost" style={{ background: panel === 'detail' ? 'var(--bg-3)' : 'transparent', color: panel === 'detail' ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={() => setPanel('detail')} disabled={!sel}>📄 详情</button>
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => setRightOpen(false)} title="收起">✕</button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {panel === 'chat'
              ? <ChatPanel filters={filters} pendingPost={askPost} onConsumePending={() => setAskPost(null)} onOpenPost={openById} />
              : (sel
                ? <div style={{ height: '100%', overflowY: 'auto' }}><Detail post={sel} rel={rel} fav={favIds.includes(sel.id)} onFav={toggleFav} onOpen={openPost} onAsk={ask} /></div>
                : <div style={{ padding: 30, color: 'var(--fg-mute)', textAlign: 'center' }}>从左侧点开任意一条查看详情</div>)}
          </div>
        </aside>
      )}

      <SettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); refreshProviders(); }} onActiveChange={refreshProviders} />
    </div>
  );
}
