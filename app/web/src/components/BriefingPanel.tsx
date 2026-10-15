import { useEffect, useRef, useState } from 'react';
import { FileDown, Newspaper, RefreshCw, Sparkles, ExternalLink } from 'lucide-react';
import { getBriefing, runBriefing, previewBriefing, generateSelectedBriefing, facets as getFacets } from '../api';
import type { Briefing, BriefingFilters, Facets } from '../api';
import { catColor } from '../lib/util';

export function BriefingPanel({ onOpenPost }: { onOpenPost: (id: number) => void }) {
  const [data, setData] = useState<Briefing | null>(null);
  const [selectedResult, setSelectedResult] = useState<Briefing | null>(null);
  const [hour, setHour] = useState(9);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [facets, setFacets] = useState<Facets | null>(null);
  const [filters, setFilters] = useState<BriefingFilters>({ windowDays: 4, pushTags: [], minValue: 5, pushLimit: 8 });
  const [range, setRange] = useState<'7' | '30' | '365' | 'all' | 'custom'>('7');
  const [candidates, setCandidates] = useState<Briefing['items']>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [previewed, setPreviewed] = useState(false);
  const active = useRef(true);
  const generating = useRef(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    active.current = true;
    let disposed = false;
    async function refresh() {
      if (generating.current) return;
      const version = ++requestVersion.current;
      const current = () => !disposed && version === requestVersion.current;
      try {
        const r = await getBriefing();
        if (current()) {
          setData(r.latest); setHour(r.pushHour);
          setFilters(f => ({ ...f, ...(r.defaults || {}), pushTags: r.defaults?.pushTags || f.pushTags }));
        }
      } catch (e) { if (current()) setMsg(String(e instanceof Error ? e.message : e)); }
      finally { if (current()) setLoading(false); }
    }
    refresh();
    getFacets().then(f => { if (!disposed) setFacets(f); }).catch(e => { if (!disposed) setMsg(String(e instanceof Error ? e.message : e)); });
    const timer = setInterval(refresh, 60000);
    return () => { disposed = true; active.current = false; clearInterval(timer); };
  }, []);

  function updateFilter(patch: Partial<BriefingFilters>) {
    setFilters(f => ({ ...f, ...patch })); setPreviewed(false); setSelectedResult(null);
  }
  function dateForRange(value: typeof range) {
    if (value === 'all') return { from: undefined, to: undefined, windowDays: undefined };
    if (value === 'custom') return { windowDays: undefined };
    const days = Number(value); const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
    return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), windowDays: undefined };
  }
  function changeRange(value: typeof range) { setRange(value); updateFilter(dateForRange(value)); }
  async function preview() {
    setBusy(true); setMsg('正在预览候选…');
    try {
      const r = await previewBriefing(filters);
      setCandidates(r.candidates || []); setSelectedIds(new Set((r.candidates || []).map(x => x.id))); setPreviewed(true);
      setMsg('已找到 ' + r.count + ' 条候选，默认全部选中。');
    } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); setPreviewed(false); }
    finally { setBusy(false); }
  }
  async function generateSelected() {
    if (!previewed || busy) return;
    setBusy(true); setMsg('正在生成本次筛选简报…');
    try {
      const r = await generateSelectedBriefing(filters, [...selectedIds]);
      if (!r.ok || !r.briefing) throw new Error(r.error || '生成失败');
      setSelectedResult(r.briefing); setMsg('已生成本次筛选简报，共 ' + r.briefing.count + ' 条。');
    } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (generating.current) return;
    requestVersion.current++; generating.current = true; setBusy(true); setLoading(false); setMsg('');
    try {
      const r = await runBriefing();
      if (!r.ok || !r.briefing) throw new Error(r.error || '生成失败');
      if (active.current) { setData(r.briefing); setMsg('已生成当天简报，桌面通知受 Windows 通知设置控制。'); }
    } catch (e) { if (active.current) setMsg(String(e instanceof Error ? e.message : e)); }
    finally { generating.current = false; if (active.current) setBusy(false); }
  }
  function download() {
    const result = selectedResult || data;
    if (!result) return;
    const manual = !!selectedResult;
    const lines = ['# ' + (manual ? '筛选简报' : '今日简报') + ' · ' + result.date, '', '生成时间：' + new Date(result.generatedAt).toLocaleString('zh-CN'), ''];
    if (result.intro) lines.push(result.intro, '');
    if (!result.items.length) lines.push('筛选窗口内没有符合条件的条目。');
    result.items.forEach((it, i) => {
      lines.push('## ' + (i + 1) + '. ' + it.category + ' · ' + it.value + ' 分', '', it.text, '', '@' + it.channel + ' · ' + it.date);
      if (it.link) lines.push('资源：' + it.link);
      if (it.url) lines.push('原文：' + it.url);
      lines.push('');
    });
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = (manual ? '筛选简报-' : '今日简报-') + result.date + '.md';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const toggleTag = (tag: string) => updateFilter({ tags: (filters.tags || []).includes(tag) ? (filters.tags || []).filter(x => x !== tag) : [...(filters.tags || []), tag] });
  const shown = selectedResult || data;
  const box = { padding: '14px 16px', marginBottom: 12 };
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><Newspaper size={18} strokeWidth={1.75} /><h2 style={{ fontSize: 16, margin: 0 }}>今日简报</h2></div>
      <div style={{ fontSize: 12, color: 'var(--fg-mute)', marginBottom: 14, fontVariantNumeric: 'tabular-nums' }}>{shown ? shown.date + ' · ' + new Date(shown.generatedAt).toLocaleTimeString('zh-CN') + ' · 共 ' + shown.count + ' 条' : '每天 ' + String(hour).padStart(2, '0') + ':00 后自动生成'}</div>
      <div className="card" style={box}>
        <div style={{ fontSize: 12, color: 'var(--fg-mute)', marginBottom: 8 }}>本次筛选</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <select value={filters.category || ''} onChange={e => updateFilter({ category: e.target.value || undefined })}><option value="">全部分类</option>{(facets?.categories || []).map(x => <option key={x.k} value={x.k}>{x.k}</option>)}</select>
          <select value={filters.channel || ''} onChange={e => updateFilter({ channel: e.target.value || undefined })}><option value="">全部频道</option>{(facets?.channels || []).map(x => <option key={x.k} value={x.k}>{x.k}</option>)}</select>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '9px 0' }}>{(facets?.tags || []).slice(0, 16).map(x => <button key={x.k} className={'chip' + ((filters.tags || []).includes(x.k) ? ' on' : '')} onClick={() => toggleTag(x.k)}>{x.k}</button>)}</div>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--fg-mute)' }}>最低价值分：{filters.minValue ?? 0}<input type="range" min="0" max="10" step="0.5" value={filters.minValue ?? 0} onChange={e => updateFilter({ minValue: Number(e.target.value) })} style={{ width: '100%' }} /></label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}><span style={{ fontSize: 12, color: 'var(--fg-mute)' }}>时间</span><select value={range} onChange={e => changeRange(e.target.value as typeof range)}><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="365">近 1 年</option><option value="all">全部时间</option><option value="custom">自定义</option></select></div>
        {range === 'custom' && <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><input type="date" value={filters.from || ''} onChange={e => updateFilter({ from: e.target.value || undefined })} /><input type="date" value={filters.to || ''} onChange={e => updateFilter({ to: e.target.value || undefined })} /></div>}
        <div style={{ display: 'flex', gap: 7, marginTop: 10 }}><button className="btn" onClick={preview} disabled={busy}>预览候选</button><button className="btn" onClick={() => setSelectedIds(new Set(candidates.map(x => x.id)))} disabled={!candidates.length}>全选</button><button className="btn" onClick={() => setSelectedIds(new Set())} disabled={!candidates.length}>清空</button><button className="btn primary" onClick={generateSelected} disabled={!previewed || busy}>{busy ? '处理中…' : '生成本次简报'}</button></div>
      </div>
      {previewed && <div className="card" style={box}><div style={{ fontSize: 12, color: 'var(--fg-mute)', marginBottom: 8 }}>候选 {candidates.length} 条，已选 {selectedIds.size} 条</div>{candidates.map(it => <label key={it.id} style={{ display: 'flex', gap: 8, padding: '7px 0', borderTop: '1px solid var(--border-soft)', fontSize: 12.5, cursor: 'pointer' }}><input type="checkbox" checked={selectedIds.has(it.id)} onChange={() => setSelectedIds(s => { const n = new Set(s); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })} /><span style={{ flex: 1 }}>{it.text}</span><b>{it.value}</b></label>)}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}><button className="btn" onClick={generate} disabled={busy}><RefreshCw size={14} />{busy ? '生成中…' : '立即生成默认日报'}</button><button className="btn" onClick={download} disabled={!shown || busy}><FileDown size={14} />导出 Markdown</button></div>
      {msg && <div role="status" style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--fg-dim)', marginBottom: 14 }}>{msg}</div>}
      {loading && !shown ? <div style={{ padding: 20, color: 'var(--fg-mute)' }}>正在读取简报…</div> : !shown ? <div className="card" style={box}>今天还没有简报。到点会自动生成，也可以点「立即生成默认日报」。</div> : <>
        {shown.intro && <div className="card" style={box}><div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--accent)', marginBottom: 8 }}><Sparkles size={14} />{selectedResult ? '本次筛选导读' : 'AI 导读'}</div><div style={{ fontSize: 13.5, lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>{shown.intro}</div></div>}
        {!shown.items.length && <div className="card" style={box}><div style={{ fontWeight: 600, marginBottom: 6 }}>筛选窗口内没有符合条件的条目</div><div style={{ color: 'var(--fg-dim)', fontSize: 13, lineHeight: 1.8 }}>可以调整筛选条件，或者先手动同步来源。</div></div>}
        {shown.items.map((it, i) => <div className="card" key={it.id} style={box}><button onClick={() => onOpenPost(it.id)} aria-label={'打开简报条目 ' + (i + 1)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: 0, color: 'var(--fg)', cursor: 'pointer' }}><div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 12, color: 'var(--fg-dim)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: catColor(it.category) }} /><span>{it.category}</span><span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{it.value} 分</span></div><div style={{ fontSize: 13.5, lineHeight: 1.8, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.text}</div><div style={{ color: 'var(--fg-mute)', fontSize: 11.5, marginTop: 8 }}>@{it.channel} · {it.date}</div></button>{/^https?:\/\//i.test(it.link) && <a href={it.link} target="_blank" rel="noopener noreferrer" className="link" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12, marginTop: 8 }}><ExternalLink size={12} />资源链接</a>}</div>)}
      </>}
      <div style={{ fontSize: 11.5, lineHeight: 1.8, color: 'var(--fg-mute)', marginTop: 18 }}>筛选条件只影响本次手动简报，不会改变自动日报设置或历史结果。自动日报仍按「设置 → 电报机器人 → 日报内容」生成，机器人不开也能用。</div>
    </div>
  );
}
