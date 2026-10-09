import { useEffect, useState } from 'react';
import { listSubscriptions, saveSubscription, removeSubscription, checkSubscriptions, getState } from '../api';

// 关键词订阅：命中就提醒。检查时会用与检索完全相同的规则（单字分词 + 同事件聚合）。
export function SubscriptionsModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick?: (kw: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [kw, setKw] = useState('');
  const [minValue, setMinValue] = useState(0);
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<any[] | null>(null);
  const [msg, setMsg] = useState('');

  async function refresh() { try { const r = await listSubscriptions(); setItems(r.items || []); } catch (e) {} }
  useEffect(() => { if (open) { refresh(); setHits(null); setMsg(''); } }, [open]);
  if (!open) return null;

  async function add() {
    const k = kw.trim();
    if (!k) return;
    setBusy(true);
    const r = await saveSubscription({ keyword: k, minValue: minValue, tags: tags.split(/[\s,]+/).filter(Boolean) });
    setItems(r.items || []);
    setKw(''); setTags(''); setMinValue(0);
    setBusy(false);
    setMsg('已添加「' + k + '」');
  }

  async function check() {
    setBusy(true); setMsg('正在按订阅逐条检索…'); setHits(null);
    try {
      // 用「上次检查订阅」的时间点，而不是页面加载时间，
      // 否则刚打开应用时 lastVisit 已推进到现在，永远查不到新命中。
      let since = 0;
      try { const st = await getState('lastSubCheck'); since = Number(st.v || 0); } catch (e) {}
      const r = await checkSubscriptions(since || undefined);
      setHits(r.results || []);
      const n = (r.results || []).reduce((a, x) => a + (x.count || 0), 0);
      const from = r.since ? new Date(r.since * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '最开始';
      setMsg(n ? ('自 ' + from + ' 起共命中 ' + n + ' 条') : ('自 ' + from + ' 起没有新命中'));
    } catch (e) { setMsg('检查失败：' + String(e)); }
    setBusy(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 760, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', background: 'var(--bg-1)', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>关键词订阅</div>
        <div style={{ fontSize: 13, color: 'var(--fg-dim)', marginBottom: 18, lineHeight: 1.75 }}>
          订阅你关心的词，点「检查命中」就会用<b>和检索完全相同的规则</b>逐条跑一遍，
          告诉你每个词自上次访问以来新增了多少条。点结果可直接跳到信息流。
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <input value={kw} onChange={e => setKw(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="关键词，例如：免费 VPS、中转站、Claude"
            style={{ flex: '1 1 280px', padding: '8px 12px', fontSize: 13.5 }} />
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="限定标签（可空）"
            style={{ width: 150, padding: '8px 12px', fontSize: 13.5 }} />
          <select value={minValue} onChange={e => setMinValue(Number(e.target.value))} style={{ padding: '8px 10px' }}>
            <option value={0}>不限价值分</option>
            <option value={3}>≥ 3 分</option>
            <option value={5}>≥ 5 分</option>
            <option value={7}>≥ 7 分</option>
          </select>
          <button className="btn primary" onClick={add} disabled={busy || !kw.trim()}>添加</button>
        </div>

        {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--fg-mute)', padding: '18px 0' }}>还没有订阅。加几个词，以后一眼就知道有没有新东西。</div>}

        {items.map(s => {
          const hit = hits && hits.find(h => h.id === s.id);
          return (
            <div key={s.id} className="card" style={{ padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 13.5, fontWeight: 600 }}
                  onClick={() => { onPick && onPick(s.keyword); onClose(); }} title="在信息流里搜索这个词">{s.keyword}</button>
                {s.tags.map((t: string) => <span key={t} className="badge" style={{ background: 'var(--bg-3)', color: 'var(--fg-dim)' }}>{t}</span>)}
                {s.minValue > 0 && <span className="badge" style={{ background: 'var(--bg-3)', color: 'var(--fg-dim)' }}>{'≥' + s.minValue + ' 分'}</span>}
                {hit && <span className="badge" style={{ background: hit.count ? 'color-mix(in srgb, var(--green) 16%, transparent)' : 'var(--bg-3)', color: hit.count ? 'var(--green)' : 'var(--fg-mute)' }}>{hit.count ? '新命中 ' + hit.count : '无新命中'}</span>}
                <span style={{ flex: 1 }} />
                {s.hitCount > 0 && <span style={{ fontSize: 12, color: 'var(--fg-mute)' }}>{'累计命中 ' + s.hitCount}</span>}
                <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12 }}
                  onClick={async () => { const r = await saveSubscription({ id: s.id, keyword: s.keyword, tags: s.tags, minValue: s.minValue, enabled: !s.enabled }); setItems(r.items || []); }}>
                  {s.enabled ? '暂停' : '启用'}
                </button>
                <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--rose)' }}
                  onClick={async () => { const r = await removeSubscription(s.id); setItems(r.items || []); setHits(prev => prev ? prev.filter(x => x.id !== s.id) : prev); }}>删除</button>
              </div>
              {hit && hit.items && hit.items.length > 0 && (
                <div style={{ marginTop: 9, borderTop: '1px solid var(--border-soft)', paddingTop: 9 }}>
                  {hit.items.slice(0, 3).map((p: any) => (
                    <div key={p.id} style={{ fontSize: 12.5, color: 'var(--fg-dim)', lineHeight: 1.7, marginBottom: 3 }}>
                      {'· ' + String(p.text).replace(/\s+/g, ' ').slice(0, 78)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18 }}>
          <button className="btn" onClick={check} disabled={busy || !items.length}>{busy ? '检查中…' : '检查命中'}</button>
          {msg && <span style={{ fontSize: 12.5, color: 'var(--fg-dim)' }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}
