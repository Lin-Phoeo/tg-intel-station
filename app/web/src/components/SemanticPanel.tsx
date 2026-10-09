import { useEffect, useRef, useState } from 'react';
import { semanticStatus, buildSemanticIndex, clearSemanticIndex } from '../api';

// 向量索引管理：语义检索的前提。只给价值分达标的帖子建索引。
export function SemanticPanel() {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef<any>(null);

  async function refresh() { try { setSt(await semanticStatus()); } catch (e) {} }
  useEffect(() => { refresh(); return () => { if (timer.current) clearInterval(timer.current); }; }, []);

  async function build() {
    setBusy(true); setMsg('正在分批向量化…这个过程可能要几分钟到几十分钟，取决于条数。');
    const r = await buildSemanticIndex({ minValue: 4, batch: 32 });
    if (!r.ok) { setBusy(false); setMsg(r.error || '启动失败'); return; }
    timer.current = setInterval(async () => {
      const s = await semanticStatus();
      setSt(s);
      if (!s.running) {
        clearInterval(timer.current); timer.current = null; setBusy(false);
        setMsg(s.error ? ('中断：' + s.error) : ('完成：本次新增 ' + (s.done || 0) + ' 条，失败 ' + (s.failed || 0) + ' 条'));
      }
    }, 2000);
  }

  const stats = (st && st.stats) || {};
  const pct = st && st.total ? Math.round((st.done / st.total) * 100) : 0;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--fg-dim)', lineHeight: 1.8, marginBottom: 14 }}>
        开启后，搜索会按<b>意思</b>找，而不只是按字面匹配 —— 搜「怎么白嫖服务器」
        也能命中讲 VPS 优惠的帖子。<br />
        只给<b>价值分 ≥ 4</b> 的帖子建索引（约 12 万条），用量和存储都更划算。
        向量以 int8 存储，约 1KB/条。
      </div>

      <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
          <span>已建立向量：<b>{Number(stats.indexed || 0).toLocaleString()}</b> 条</span>
          <span>达标待建：<b>{Math.max(0, Number(stats.eligible || 0) - Number(stats.indexed || 0)).toLocaleString()}</b> 条</span>
          {stats.dim ? <span>维度：<b>{stats.dim}</b></span> : null}
          {stats.model ? <span>模型：<b>{stats.model}</b></span> : null}
        </div>
      </div>

      {st && st.running && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 5, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: 'var(--violet)', transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-mute)', marginTop: 6 }}>
            {'已处理 ' + (st.done || 0) + ' / ' + (st.total || 0) + ' 条' + (st.failed ? '（失败 ' + st.failed + '）' : '')}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn primary" onClick={build} disabled={busy}>{busy ? '向量化中…' : '建立 / 继续向量索引'}</button>
        <button className="btn ghost" onClick={async () => { if (!window.confirm('清空全部向量？语义检索会失效，直到重新建立。')) return; await clearSemanticIndex(); refresh(); setMsg('已清空'); }} disabled={busy}>清空索引</button>
      </div>

      {msg && <div style={{ padding: '9px 12px', borderRadius: 9, fontSize: 12.5, background: 'var(--bg-3)', color: 'var(--fg-dim)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{msg}</div>}
    </div>
  );
}
