import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Zap, Radio, Star, Sparkles, Link2, Bell, Search, X, Settings, FileText,
  Sun, Moon, Type, PanelRightClose, RefreshCw, SlidersHorizontal,
} from 'lucide-react';
import {
  search as searchApi, facets as facetsApi, getPost, related as relApi, getSettings, getClusterMembers,
  listFavorites, addFavorite, removeFavorite, getState, setState, checkSubscriptions, semanticQuery, runSync,
} from './api';
import type { Post, Facets } from './api';
import { PostCard } from './components/PostCard';
import { Detail } from './components/Detail';
import { ChatPanel } from './components/ChatPanel';
import { SettingsModal } from './components/SettingsModal';
import { AddSourceModal } from './components/AddSourceModal';
import { TopProgress } from './components/TopProgress';
import { SyncConfirm } from './components/SyncConfirm';
import { SubscriptionsModal } from './components/SubscriptionsModal';
import { CommandPalette } from './components/CommandPalette';
import type { Cmd } from './components/CommandPalette';
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
  const [relBy, setRelBy] = useState('');
  const [rel, setRel] = useState<Post[]>([]);
  const [cluster, setCluster] = useState<Post[]>([]);
  const [collapse, setCollapse] = useState(() => localStorage.getItem('tg.collapse') !== '0');
  const [panel, setPanel] = useState<'chat' | 'detail'>('chat');
  const [rightOpen, setRightOpen] = useState(true);
  const [favIds, setFavIds] = useState<number[]>([]);
  const [subsOpen, setSubsOpen] = useState(false);
  const [newSince, setNewSince] = useState(0);       // 上次访问以来的新内容条数
  const [sinceFilter, setSinceFilter] = useState(0); // 当前是否只看新内容
  const [topKw, setTopKw] = useState<string[]>([]);  // 订阅命中提醒
  const [semantic, setSemantic] = useState(() => localStorage.getItem('tg.semantic') === '1');
  const [semanticNote, setSemanticNote] = useState('');
  const [useRerank, setUseRerank] = useState(() => localStorage.getItem('tg.rerank') !== '0');
  const [showFilters, setShowFilters] = useState(false);
  const [winW, setWinW] = useState(() => (typeof window === 'undefined' ? 1600 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const narrow = winW < 1180;   // 窄窗口：右栏改为覆盖式抽屉
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cursor, setCursor] = useState(0);           // 键盘选中的卡片下标
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPos = useRef<Record<string, number>>({});
  const [view, setView] = useState<'feed' | 'favs'>('feed');
  const [favPosts, setFavPosts] = useState<Post[]>([]);
  const [askPost, setAskPost] = useState<Post | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(() => params.get('settings') === '1');
  const [settingsTab, setSettingsTab] = useState<'ai' | 'bot'>('ai');
  const [addSourceOpen, setAddSourceOpen] = useState(() => params.get('addsource') === '1');
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('tg.theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.setAttribute('data-size', size); localStorage.setItem('tg.size', size); }, [size]);
  // 收藏改为落库：换浏览器、清缓存都不会丢。
  // 首次运行时把浏览器里已有的旧收藏迁移上去。
  useEffect(() => {
    (async () => {
      try {
        const r = await listFavorites();
        setFavIds(r.ids || []);
        if (!(r.ids || []).length) {
          let old: number[] = [];
          try { old = JSON.parse(localStorage.getItem('tg.favs') || '[]'); } catch (e) {}
          for (const id of old) { try { await addFavorite(id); } catch (e) {} }
          if (old.length) { const r2 = await listFavorites(); setFavIds(r2.ids || []); localStorage.removeItem('tg.favs'); }
        }
      } catch (e) {}
    })();
  }, []);

  useEffect(() => { const t = setTimeout(() => { runSubCheck(); }, 2500); return () => clearTimeout(t); }, []);

  // 上次访问以来的新内容：先读旧时间点算差值，再把时间点推进到当前
  useEffect(() => {
    (async () => {
      try {
        const st = await getState('lastVisit');
        const prev = Number(st.v || 0);
        const now = Math.floor(Date.now() / 1000);
        if (prev > 0) {
          const r = await searchApi({ q: '', since: prev, size: 1, sort: 'date' });
          setNewSince(Number(r.total || 0));
        }
        await setState('lastVisit', String(now));
      } catch (e) {}
    })();
  }, []);
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

  // 光标是否在可输入的地方。全局快捷键必须先问这个，否则在表单里打字
  // 会被快捷键抢走 —— 之前填模型配置时输入 "/" 就会跳到搜索框。
  const isTyping = () => {
    const t = document.activeElement as HTMLElement | null;
    if (!t) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // 正在输入时不抢键
      if (e.key === '/' && !isTyping()) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') { setSettingsOpen(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const from = useMemo(() => days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : '', [days]);
  const filters = useMemo(() => ({ q: dq, category: cat, channel, tags, sort, from, collapse, since: sinceFilter }), [dq, cat, channel, tags, sort, from, collapse, sinceFilter]);
  useEffect(() => { localStorage.setItem('tg.collapse', collapse ? '1' : '0'); }, [collapse]);
  useEffect(() => { localStorage.setItem('tg.semantic', semantic ? '1' : '0'); }, [semantic]);
  useEffect(() => { localStorage.setItem('tg.rerank', useRerank ? '1' : '0'); }, [useRerank]);
  useEffect(() => { if (view === 'feed' && (semantic || dq)) load(1); }, [semantic, useRerank]);

  async function load(p: number) {
    // 语义模式：把整段查询交给向量模型做「意思相近」的召回，
    // 它不是分页检索，一次给完，因此只支持第一页。
    if (semantic && dq.trim()) {
      setLoading(true);
      try {
        const r = await semanticQuery(dq.trim(), 60, useRerank);
        if (r.ok) {
          setItems(r.items || []); setTotal((r.items || []).length); setMode('semantic');
          const parts = ['语义检索'];
          if (r.model) parts.push(r.model);
          if (r.rerankModel) parts.push('重排 ' + r.rerankModel);
          if (r.rerankError) parts.push('重排不可用：' + String(r.rerankError).slice(0, 40));
          setSemanticNote(parts.join(' · '));
        }
        else { setItems([]); setTotal(0); setSemanticNote(r.error || '语义检索不可用'); }
        setPage(1);
      } catch (e) { setSemanticNote('语义检索失败：' + String(e)); }
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await searchApi({ ...filters, page: p, size: PAGE });
      setItems(prev => (p === 1 ? r.items : prev.concat(r.items)));
      setTotal(r.total);
      setMode(r.mode);
      setSemanticNote('');
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
    setCluster([]);
    relApi(p.id).then(r => { setRel(r.items || []); setRelBy(r.by || ''); }).catch(() => {});
    if (p.clusterSize > 1) getClusterMembers(p.repId || p.id).then(r => setCluster(r.items || [])).catch(() => {});
  }
  async function openById(id: number) {
    try { const p = await getPost(id); if (p && (p as any).id) openPost(p); } catch (e) {}
  }
  function toggleFav(p: Post) {
    const on = favIds.includes(p.id);
    setFavIds(prev => on ? prev.filter(x => x !== p.id) : prev.concat([p.id]));
    (on ? removeFavorite(p.id) : addFavorite(p.id)).then(r => { if (r && r.ids) setFavIds(r.ids); }).catch(() => {});
  }
  async function showFavs() {
    setView('favs');
    try { const r = await listFavorites(); setFavPosts(r.items || []); setFavIds(r.ids || []); } catch (e) { setFavPosts([]); }
  }
  // 所有「一键补齐」的入口都先走这里：弹二次确认，并记下触发来源。
  // 之前点一下就直接开跑，误触过；而且不留痕迹，数据变多了查不出是哪来的。
  const [syncAsk, setSyncAsk] = useState<{ open: boolean; by: string }>({ open: false, by: '' });
  function startSync(by: string) { setSyncAsk({ open: true, by: by }); }
  async function confirmSync() {
    const by = syncAsk.by;
    setSyncAsk({ open: false, by: '' });
    try { await runSync(2000, by); } catch (e) {}
  }

  async function runSubCheck() {
    try {
      const r = await checkSubscriptions();
      const hit = (r.results || []).filter((x: any) => x.count > 0);
      setTopKw(hit.map((x: any) => x.keyword + ' ' + x.count));
    } catch (e) {}
  }
  function ask(p: Post) { setAskPost(p); setPanel('chat'); setRightOpen(true); }

  const terms = useMemo(() => dq.split(/\s+/).filter(Boolean), [dq]);
  const shown = view === 'favs' ? favPosts : items;

  // ---------- 命令面板 ----------
  const commands = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    const CATS = ['羊毛优惠', '项目副业', '实用工具', '开源项目', 'AI与科技', '服务器网络', '账号会员', '学习资源', '数码硬件', '资讯热点'];
    for (const c of CATS) out.push({ id: 'cat:' + c, label: '分类：' + c, group: '筛选', run: () => { setView('feed'); setCat(cat === c ? '' : c); } });
    for (const s of SORTS) out.push({ id: 'sort:' + s.v, label: '排序：' + s.label, group: '排序', run: () => setSort(s.v) });
    for (const d of DAYS) out.push({ id: 'day:' + d.v, label: '时间：' + d.label, group: '筛选', run: () => setDays(d.v) });
    if (fac) for (const ch of fac.channels.slice(0, 30)) out.push({ id: 'ch:' + ch.k, label: '只看频道：' + ch.k, group: '频道', hint: fmtNum(ch.n), run: () => { setView('feed'); setChannel(ch.k); } });
    out.push({ id: 'act:favs', label: '打开：我的收藏', group: '操作', run: showFavs });
    out.push({ id: 'act:feed', label: '打开：全部信息流', group: '操作', run: () => { setView('feed'); setCat(''); setChannel(''); setTags([]); setQ(''); } });
    out.push({ id: 'act:subs', label: '打开：关键词订阅', group: '操作', run: () => setSubsOpen(true) });
    out.push({ id: 'act:src', label: '打开：按链接抓取', group: '操作', run: () => setAddSourceOpen(true) });
    out.push({ id: 'act:ai', label: '打开：AI 情报助手', group: '操作', run: () => { setPanel('chat'); setRightOpen(true); } });
    out.push({ id: 'act:settings', label: '打开：设置', group: '操作', run: () => setSettingsOpen(true) });
    // 之前这里是 dispatchEvent('tg:sync')，但监听它的组件在改版时删掉了，
    // 导致命令面板里这条命令点了没有任何反应（还查不出原因）。改成直接调用。
    out.push({ id: 'act:sync', label: '执行：一键补齐（增量同步全部来源）', group: '操作',
      run: () => { startSync('命令面板'); } });
    out.push({ id: 'act:collapse', label: '切换：合并重复来源（当前 ' + (collapse ? '开' : '关') + '）', group: '操作', run: () => setCollapse(v => !v) });
    out.push({ id: 'act:theme', label: '切换：' + (theme === 'dark' ? '浅色' : '深色') + '主题', group: '操作', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') });
    out.push({ id: 'act:size', label: '切换：卡片密度（当前 ' + size + '）', group: '操作', run: () => setSize(size === 's' ? 'm' : size === 'm' ? 'l' : 's') });
    if (dq.trim()) out.push({ id: 'search:' + dq, label: '搜索情报：' + dq, group: '搜索', run: () => { setView('feed'); } });
    return out;
  }, [fac, cat, collapse, theme, size, dq, sort, from]);

  // ---------- 全局快捷键 ----------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if (paletteOpen) return;
      if (typing) { if (e.key === 'Escape') t && t.blur(); return; }
      if (e.key === '/') { e.preventDefault(); if (searchRef.current) searchRef.current.focus(); return; }
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, Math.max(0, shown.length - 1))); return; }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); return; }
      if (e.key === 'Enter') { const p = shown[cursor]; if (p) { e.preventDefault(); openPost(p); } return; }
      if (e.key === 's') { const p = shown[cursor]; if (p) { e.preventDefault(); toggleFav(p); } return; }
      if (e.key === '?') { e.preventDefault(); setPaletteOpen(true); return; }
      if (e.key === 'Escape') { setPaletteOpen(false); setRightOpen(false); return; }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, cursor, shown, favIds]);

  // 窄窗口下右栏改为覆盖式抽屉，默认收起，避免遮挡内容
  useEffect(() => { if (narrow) setRightOpen(false); }, [narrow]);

  // 键盘移动时把选中卡片滚进视野
  useEffect(() => {
    const host = scrollRef.current;
    if (!host) return;
    const el = host.querySelector('[data-idx="' + cursor + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // 切换视图：光标复位，并恢复该视图上次的滚动位置
  useEffect(() => {
    setCursor(0);
    const host = scrollRef.current;
    if (!host) return;
    const want = scrollPos.current[view] || 0;
    const id = requestAnimationFrame(() => { host.scrollTop = want; });
    return () => cancelAnimationFrame(id);
  }, [view]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* ---------- 图标导航条 ---------- */}
      {/* 从 248px 侧栏改为 56px 图标条：导航不再和分类抢垂直空间，
          分类移到主内容区顶部的筛选条。 */}
      <aside className="rail">
        <div className="rail-logo" title="电报情报站" aria-hidden="true"><Zap size={15} color="#fff" strokeWidth={2.2} /></div>

        <button className={'rail-btn' + (view === 'feed' ? ' on' : '')} title="全部信息流" aria-label="全部信息流"
          onClick={() => { setView('feed'); setCat(''); setTags([]); setChannel(''); setQ(''); }}><Radio size={17} strokeWidth={1.75} /></button>
        <button className={'rail-btn' + (view === 'favs' ? ' on' : '')} title={'我的收藏' + (favIds.length ? '（' + favIds.length + ' 条）' : '')} aria-label="我的收藏"
          onClick={showFavs}><Star size={17} strokeWidth={1.75} /></button>
        <button className={'rail-btn' + (rightOpen && panel === 'chat' ? ' on' : '')} title="AI 情报助手" aria-label="AI 情报助手"
          onClick={() => { setPanel('chat'); setRightOpen(true); }}><Sparkles size={17} strokeWidth={1.75} /></button>
        <button className="rail-btn" title="按链接抓取" aria-label="按链接抓取" onClick={() => setAddSourceOpen(true)}><Link2 size={17} strokeWidth={1.75} /></button>
        <button className="rail-btn" title={'关键词订阅' + (topKw.length ? '（' + topKw.length + ' 个命中）' : '')} aria-label="关键词订阅"
          onClick={() => setSubsOpen(true)}><Bell size={17} strokeWidth={1.75} /></button>

        <div className="rail-sep" />
        <button className="rail-btn" title="一键补齐：增量抓取全部来源" aria-label="一键补齐"
          onClick={() => startSync('侧栏按钮')}><RefreshCw size={17} strokeWidth={1.75} /></button>

        <span style={{ flex: 1 }} />

        <button className="rail-btn" title={theme === 'dark' ? '切换到浅色' : '切换到深色'} aria-label="切换深浅色主题"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}</button>
        <button className="rail-btn" title={'字号：' + (size === 's' ? '紧凑' : size === 'l' ? '宽松' : '舒适')} aria-label="切换字号"
          onClick={() => setSize(size === 'm' ? 'l' : size === 'l' ? 's' : 'm')}><Type size={17} strokeWidth={1.75} /></button>
        <button className="rail-btn" title="设置" aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings size={17} strokeWidth={1.75} /></button>
      </aside>



      {/* ---------- main ---------- */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <h1 className="sr-only">电报情报站 · 技术线报与项目雷达</h1>
        <TopProgress onOpenPost={id => openById(id)} />
        <div className="surface" style={{ borderBottom: '1px solid var(--border-soft)', padding: '12px 16px 0' }}>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
              <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="搜索 85 万条帖子：免费 VPS、GitHub、AI 中转站、副业…  （按 / 聚焦）" style={{ width: '100%', paddingLeft: 34, height: 38 }} />
              <span style={{ position: 'absolute', left: 11, top: 11, color: 'var(--fg-mute)', pointerEvents: 'none' }}><Search size={15} strokeWidth={1.75} /></span>
              {q && <button className="btn ghost" style={{ position: 'absolute', right: 5, top: 6, padding: '4px 7px' }} onClick={() => setQ('')} title="清空"><X size={14} strokeWidth={2} /></button>}
            </div>
            <select value={sort} onChange={e => setSort(e.target.value)} style={{ height: 38 }}>{SORTS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}</select>
            <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ height: 38 }}>{DAYS.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}</select>
            {providers.length > 0 && (
              <select value={activeId} onChange={e => switchProvider(e.target.value)} title="切换 AI 服务商" style={{ height: 38, maxWidth: 190 }}>
                {providers.map(p => <option key={p.id} value={p.id}>{(p.hasKey ? '● ' : '○ ') + p.name}</option>)}
              </select>
            )}
            <button className={'btn' + (rightOpen && panel === 'chat' ? ' primary' : '')} style={{ height: 38 }} onClick={() => { setPanel('chat'); setRightOpen(true); }}><Sparkles size={14} strokeWidth={1.75} /> AI 助手</button>
          </div>
        </div>

        {/* 分类筛选条：从侧栏移到这里。横向滚动，不占垂直空间，
            也不会再把分类列表挤下去。 */}
        <div className="surface catbar">
          <span className={'chip' + (!cat ? ' on' : '')} onClick={() => setCat('')}>
            全部<span className="cn">{fac ? fmtNum(Number(fac.meta.visible || fac.meta.count || 0)) : ''}</span>
          </span>
          {fac && fac.categories.slice().sort((a, b) => catRank(a.k) - catRank(b.k)).map(c => (
            <span key={c.k} className={'chip' + (cat === c.k ? ' on' : '')} onClick={() => setCat(cat === c.k ? '' : c.k)}>
              <span className="cdot" style={{ background: catColor(c.k) }} />{c.k}<span className="cn">{fmtNum(c.n)}</span>
            </span>
          ))}
          <span style={{ flex: 1, minWidth: 12 }} />
          <span className={'chip' + (showFilters ? ' on' : '')} onClick={() => setShowFilters(v => !v)} title="展开标签与频道筛选">
            <SlidersHorizontal size={12} strokeWidth={2} />筛选
            {(tags.length + (channel ? 1 : 0)) > 0 ? <span className="cn">{tags.length + (channel ? 1 : 0)}</span> : null}
          </span>
        </div>

        {showFilters && (
          <div className="surface catbar" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 9, paddingBottom: 11 }}>
            <span className="catbar-label">标签</span>
            {fac && fac.tags.slice(0, 20).map(t => (
              <span key={t.k} className={'chip' + (tags.includes(t.k) ? ' on' : '')}
                onClick={() => setTags(prev => prev.includes(t.k) ? prev.filter(x => x !== t.k) : prev.concat([t.k]))}>{t.k}</span>
            ))}
            <span className="catbar-gap" />
            <span className="catbar-label">频道</span>
            {fac && fac.channels.map(c => (
              <span key={c.k} className={'chip' + (channel === c.k ? ' on' : '')}
                onClick={() => setChannel(channel === c.k ? '' : c.k)}>{'@' + c.k}</span>
            ))}
          </div>
        )}

        <div className="surface" style={{ borderBottom: '1px solid var(--border-soft)', padding: '8px 16px' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9, flexWrap: 'wrap' }}>
            <span aria-live="polite" style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-dim)' }}>
              {view === 'favs' ? <>{'收藏 ' + favPosts.length + ' 条'}</> : <>{loading && page === 1 ? '检索中…' : ('找到约 ' + fmtNum(total) + ' 条')}</>}
              {newSince > 0 && !sinceFilter && view === 'feed' && (
                <button className="btn ghost" style={{ padding: '1px 9px', fontSize: 12, marginLeft: 10, color: 'var(--green)', borderColor: 'color-mix(in srgb, var(--green) 45%, transparent)' }}
                  onClick={() => setSinceFilter(Math.floor(Date.now() / 1000))} title="只看上次访问之后新增的内容">
                  {'上次访问后有 ' + fmtNum(newSince) + ' 条新内容'}
                </button>
              )}
              {sinceFilter > 0 && (
                <button className="btn ghost" style={{ padding: '1px 9px', fontSize: 12, marginLeft: 10 }} onClick={() => setSinceFilter(0)}>取消「只看新内容」</button>
              )}
              {semanticNote && <span style={{ fontSize: 12, color: 'var(--violet)', marginLeft: 10 }}>{semanticNote}</span>}
            </span>
            {(cat || channel || tags.length > 0 || dq) && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {cat && <span className="chip on" onClick={() => setCat('')}>{cat}<X size={11} strokeWidth={2.5} /></span>}
                {channel && <span className="chip on" onClick={() => setChannel('')}>{'@' + channel}<X size={11} strokeWidth={2.5} /></span>}
                {tags.map(t => <span key={t} className="chip on" onClick={() => setTags(prev => prev.filter(x => x !== t))}>{t}<X size={11} strokeWidth={2.5} /></span>)}
                <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => { setCat(''); setChannel(''); setTags([]); setQ(''); }}>清空筛选</button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--fg-dim)', cursor: 'pointer' }} title="同一事件被多个来源发布时只显示一条">
                  <input type="checkbox" checked={collapse} onChange={e => setCollapse(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                  合并重复来源
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: semantic ? 'var(--violet)' : 'var(--fg-dim)', cursor: 'pointer' }} title="按意思找，不只是按字面匹配（需要在设置里先建好向量索引）">
                  <input type="checkbox" checked={semantic} onChange={e => setSemantic(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                  语义检索
                </label>
                {semantic && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: useRerank ? 'var(--green)' : 'var(--fg-dim)', cursor: 'pointer' }} title="向量粗排召回后再用 cross-encoder 精排，结果顺序更合理">
                    <input type="checkbox" checked={useRerank} onChange={e => setUseRerank(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                    重排
                  </label>
                )}
              </span>
            )}
          </div>
        </div>

        <div ref={scrollRef} onScroll={e => { scrollPos.current[view] = (e.target as HTMLElement).scrollTop; }}
          style={{ flex: 1, overflowY: 'auto', padding: '0 0 56px' }}>
          {view === 'favs' && favPosts.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--fg-mute)', paddingTop: 80, fontSize: 'var(--fs-text)' }}>还没有收藏。点击任意条目右侧的星标即可收藏。</div>
          )}
          <div style={{ maxWidth: 1020, margin: '0 auto' }}>
            {shown.map((p, i) => (
            <div key={p.id} data-idx={i} ref={i === cursor ? (el => { if (el && scrollRef.current && scrollRef.current.contains(el)) {} }) : undefined}>
              <PostCard post={p} active={sel?.id === p.id || i === cursor} terms={terms} onOpen={p2 => { setCursor(i); openPost(p2); }} />
            </div>
          ))}
          </div>
          {view === 'feed' && loading && page === 1 && <div style={{ textAlign: 'center', color: 'var(--fg-mute)', padding: 48, fontSize: 'var(--fs-text)' }}>正在检索…</div>}
          {view === 'feed' && !loading && items.length === 0 && <div style={{ textAlign: 'center', color: 'var(--fg-mute)', padding: 70, fontSize: 'var(--fs-text)' }}>没有匹配的结果，试试换个关键词或清空筛选。</div>}
          {view === 'feed' && items.length > 0 && items.length < total && (
            <div ref={sentinelRef} style={{ textAlign: 'center', padding: 24 }}>
              <button className="btn" onClick={() => load(page + 1)} disabled={loading}>{loading ? '加载中…' : '加载更多'}</button>
            </div>
          )}
        </div>
      </main>

      {/* ---------- right panel ---------- */}
      {rightOpen && (
        <aside className={'surface' + (narrow ? ' panel-overlay' : '')}
          style={narrow
            ? { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 92vw)', zIndex: 60, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '-8px 0 32px -12px rgba(0,0,0,.7)' }
            : { width: 440, flexShrink: 0, borderLeft: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--border-soft)' }}>
            <button className={'btn ghost' + (panel === 'chat' ? '' : '')} style={{ background: panel === 'chat' ? 'var(--bg-3)' : 'transparent', color: panel === 'chat' ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={() => setPanel('chat')}><Sparkles size={14} strokeWidth={1.75} /> AI 助手</button>
            <button className="btn ghost" style={{ background: panel === 'detail' ? 'var(--bg-3)' : 'transparent', color: panel === 'detail' ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={() => setPanel('detail')} disabled={!sel}><FileText size={14} strokeWidth={1.75} /> 详情</button>
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => setRightOpen(false)} title="收起" aria-label="收起右侧面板"><PanelRightClose size={15} strokeWidth={1.75} /></button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {panel === 'chat'
              ? <ChatPanel filters={filters} pendingPost={askPost} onConsumePending={() => setAskPost(null)} onOpenPost={openById} />
              : (sel
                ? <div style={{ height: '100%', overflowY: 'auto' }}><Detail post={sel} rel={rel} relBy={relBy} cluster={cluster} fav={favIds.includes(sel.id)} onFav={toggleFav} onOpen={openPost} onAsk={ask} /></div>
                : <div style={{ padding: 30, color: 'var(--fg-mute)', textAlign: 'center' }}>从左侧点开任意一条查看详情</div>)}
          </div>
        </aside>
      )}

      <SettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); refreshProviders(); }} onActiveChange={refreshProviders} initialTab={settingsTab} />
      <AddSourceModal open={addSourceOpen} onClose={() => setAddSourceOpen(false)} onImported={() => { facetsApi().then(setFac); load(1); }} />
      <SubscriptionsModal open={subsOpen} onClose={() => { setSubsOpen(false); runSubCheck(); }} onPick={kw => { setView('feed'); setQ(kw); setDq(kw); setSinceFilter(0); }} />
      {narrow && rightOpen && (
        <div onClick={() => setRightOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 55 }} />
      )}
      <SyncConfirm open={syncAsk.open} by={syncAsk.by}
        onCancel={() => setSyncAsk({ open: false, by: '' })}
        onConfirm={confirmSync} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
