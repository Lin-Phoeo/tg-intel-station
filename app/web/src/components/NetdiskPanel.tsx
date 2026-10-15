import { useEffect, useState } from 'react';
import {
  getNetdisk, getNetdiskFacets, getNetdiskItem, startNetdiskScan, getNetdiskScanStatus,
  startNetdiskAi, getNetdiskAiStatus, stopNetdiskAi, getSettings,
  type NetdiskRow, type NetdiskFacets,
} from '../api';

const SORTS = [
  { v: 'date', label: '最新' }, { v: 'value', label: '价值分' }, { v: 'title', label: '标题' },
];
const PAGE_SIZE = 30;

export function NetdiskPanel({ onOpenPost }: { onOpenPost: (id: number) => void }) {
  const [fac, setFac] = useState<NetdiskFacets | null>(null);
  const [platform, setPlatform] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('date');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: NetdiskRow[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<NetdiskRow | null>(null);
  const [scan, setScan] = useState<any>({ running: false });
  const [aiSt, setAiSt] = useState<any>({ running: false });
  const [activeModel, setActiveModel] = useState<string>('');
  const [msg, setMsg] = useState<string>('');

  useEffect(() => {
    getNetdiskFacets().then(setFac).catch(() => {});
    getSettings().then(r => {
      const p = (r.settings?.profiles || []).find((x: any) => x.id === r.settings?.activeId);
      if (p) setActiveModel(p.name + ' · ' + p.model);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getNetdisk({ platform, category, q, sort, page, size: PAGE_SIZE })
      .then(r => { if (alive) setData({ total: r.total, items: r.items }); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [platform, category, q, sort, page]);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const s = await getNetdiskScanStatus();
        const a = await getNetdiskAiStatus();
        setScan(s); setAiSt(a);
        if (!s.running && !a.running) { clearInterval(t); refresh(); }
      } catch (e) {}
    }, 1500);
    return () => clearInterval(t);
  }, [scan.running, aiSt.running]);

  async function doScan(mode: 'full' | 'incremental') {
    setMsg(mode === 'full' ? '正在全量扫描…' : '正在增量扫描…');
    const r = await startNetdiskScan(mode);
    if (!r.ok) { setMsg(r.error || '扫描启动失败'); return; }
    setScan({ running: true });
  }
  async function doAi() {
    setMsg('正在启动 AI 整理…');
    const r = await startNetdiskAi(0);
    if (!r.ok) { setMsg(r.error || 'AI 整理启动失败'); return; }
    setAiSt({ running: true, total: r.total });
  }
  function refresh() { getNetdiskFacets().then(setFac).catch(() => {}); setPage(1); }

  async function openDetail(row: NetdiskRow) {
    try { setSel(await getNetdiskItem(row.id)); } catch (e) { setSel(row); }
  }
  function copy(row: NetdiskRow) {
    const txt = row.pwd ? (row.shareUrl + ' 提取码：' + row.pwd) : row.shareUrl;
    navigator.clipboard.writeText(txt).then(() => setMsg('已复制链接' + (row.pwd ? '与提取码' : '')));
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const labelOf = new Map((fac?.platforms || []).map(p => [p.k, p.label || p.k]));
  const platName = (k: string) => labelOf.get(k) || k;

  const card: any = { background: 'var(--bg-2)', border: '1px solid var(--border-soft)', borderRadius: 12, padding: '12px 14px', marginBottom: 10 };

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '14px 18px 60px' }}>
        <div style={{ maxWidth: 1020, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'color-mix(in srgb, var(--violet) 10%, var(--bg-2))', border: '1px solid color-mix(in srgb, var(--violet) 24%, var(--border-soft))' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 13.5 }}>AI 整理会自动整理资源名称、分类、标签和简介</div>
              <div style={{ color: 'var(--fg-mute)', fontSize: 12, marginTop: 4 }}>当前模型：{activeModel || '未检测到，请在设置中配置'}。AI 会把原帖标题整理成资源名，生成类别、标签和简介。首次点击「开始 AI 整理」后会后台处理未整理条目，消耗模型额度；可停止，之后从剩余条目继续。</div>
              {aiSt.running && <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--fg-dim)' }}>已整理 {aiSt.done || 0} / {aiSt.total || 0} · 失败 {aiSt.failed || 0} · 跳过 {aiSt.skipped || 0} · 待整理 {aiSt.pending || 0}</div>
                <div style={{ height: 5, borderRadius: 4, background: 'var(--bg-3)', marginTop: 5, overflow: 'hidden' }}>
                  <div style={{ width: ((aiSt.total ? Math.min(100, Math.round(((aiSt.done || 0) + (aiSt.failed || 0) + (aiSt.skipped || 0)) / aiSt.total * 100)) : 0) + '%'), height: '100%', background: 'var(--violet)' }} />
                </div>
              </div>}
            </div>
            <button className="btn primary" onClick={doAi} disabled={aiSt.running}>{aiSt.running ? 'AI 整理中…' : '开始 AI 整理'}</button>
            {aiSt.running && <button className="btn ghost" onClick={() => stopNetdiskAi().then(() => setMsg('已请求停止，当前一批结束后会停；下次开始会从剩余条目继续'))}>停止</button>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="搜索资源名或标签…" style={{ flex: 1, minWidth: 220, height: 38 }} />
            <select value={platform} onChange={e => { setPlatform(e.target.value); setPage(1); }} style={{ height: 38 }}>
              <option value="">全部平台</option>
              {(fac?.platforms || []).map(p => <option key={p.k} value={p.k}>{(p.label || p.k) + '（' + p.n + '）'}</option>)}
            </select>
            <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} style={{ height: 38 }}>
              <option value="">全部类别</option>
              {(fac?.categories || []).map(c => <option key={c.k} value={c.k}>{c.k + '（' + c.n + '）'}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)} style={{ height: 38 }}>
              {SORTS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <button className="btn ghost" onClick={() => doScan('incremental')} disabled={scan.running}>{scan.running ? '扫描中…' : '扫描更新'}</button>
            <button className="btn ghost" onClick={() => doScan('full')} disabled={scan.running}>全量重扫</button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12.5, color: 'var(--fg-dim)' }}>共 {data.total} 条{(scan.found ? ' · 本次抽出 ' + scan.found : '')}{(aiSt.pending != null ? ' · 待整理 ' + aiSt.pending : '')}</span>
          </div>

          {msg && <div style={{ ...card, fontSize: 12.5, color: 'var(--fg-dim)' }}>{msg}</div>}

          {loading && <div style={{ color: 'var(--fg-mute)', padding: 20 }}>加载中…</div>}
          {!loading && data.items.length === 0 && (
            <div className="empty"><div className="empty-title">还没有网盘资源。点「扫描更新」从情报库里抽取。</div></div>
          )}

          {data.items.map(row => (
            <div key={row.id} style={card} onClick={() => openDetail(row)}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="chip on" style={{ flexShrink: 0 }}>{platName(row.platform)}</span>
                {row.category && <span className="chip" style={{ flexShrink: 0 }}>{row.category}</span>}
                <div style={{ fontWeight: 620, fontSize: 14, flex: 1, minWidth: 0 }}>{row.aiTitle || row.title || '(无标题)'}</div>
                <span style={{ fontSize: 12, color: 'var(--fg-mute)' }}>{row.value}分</span>
              </div>
              {row.aiSummary && <div style={{ fontSize: 13, color: 'var(--fg-dim)', marginTop: 6 }}>{row.aiSummary}</div>}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--fg-mute)', flexWrap: 'wrap' }}>
                <span>@{row.channel} · {row.postDate}</span>
                {row.mergeCount > 1 && <span>· {row.mergeCount} 个来源</span>}
                {row.pwd && <span>· 提取码 <code>{row.pwd}</code></span>}
                {row.tags && <span>· {row.tags}</span>}
              </div>
            </div>
          ))}

          {pages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 20 }}>
              <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>上一页</button>
              <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--fg-dim)' }}>{page} / {pages}</span>
              <button className="btn" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}>下一页</button>
            </div>
          )}
        </div>
      </div>

      {sel && (
        <aside className="surface" style={{ width: 380, flexShrink: 0, borderLeft: '1px solid var(--border-soft)', overflowY: 'auto', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="chip on">{platName(sel.platform)}</span>
            {sel.category && <span className="chip">{sel.category}</span>}
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => setSel(null)}>关闭</button>
          </div>
          <div style={{ fontWeight: 650, fontSize: 16, marginTop: 10 }}>{sel.aiTitle || sel.title || '(无标题)'}</div>
          {sel.aiSummary && <div style={{ fontSize: 13.5, color: 'var(--fg-dim)', marginTop: 8, lineHeight: 1.7 }}>{sel.aiSummary}</div>}
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <div style={{ wordBreak: 'break-all' }}><a className="link" href={sel.shareUrl} target="_blank" rel="noreferrer">{sel.shareUrl}</a></div>
            {sel.pwd && <div style={{ marginTop: 6 }}>提取码：<code>{sel.pwd}</code></div>}
            {sel.tags && <div style={{ marginTop: 6, color: 'var(--fg-dim)' }}>标签：{sel.tags}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => copy(sel)}>复制链接{sel.pwd ? '+提取码' : ''}</button>
            <a className="btn ghost" href={sel.shareUrl} target="_blank" rel="noreferrer">打开分享页</a>
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', marginBottom: 6 }}>全部来源（{sel.sources.length}）</div>
            {sel.sources.map((s, i) => (
              <div key={i} style={{ ...card, padding: '8px 10px', marginBottom: 6, cursor: 'pointer' }} onClick={() => onOpenPost(s.post_id)}>
                <div style={{ fontSize: 13 }}>@{s.channel} · {s.date} · {s.value}分</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', wordBreak: 'break-all' }}>{s.url}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', marginTop: 14 }}>资源名取自原帖文本，链接来自原帖，可能已失效。</div>
        </aside>
      )}
    </div>
  );
}
