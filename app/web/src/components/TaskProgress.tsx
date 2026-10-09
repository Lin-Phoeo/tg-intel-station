import { useEffect, useRef, useState } from 'react';
import { semanticStatus, buildSemanticIndex } from '../api';

function fmtEta(ms: number) {
  if (!isFinite(ms) || ms <= 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return '不到 1 分钟';
  if (m < 60) return '约 ' + m + ' 分钟';
  return '约 ' + Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分钟';
}

// 后台任务的常驻进度。向量化一跑就是一两个小时，
// 不该逼用户反复点进设置里看。
export function TaskProgress() {
  const [st, setSt] = useState<any>(null);
  const [eta, setEta] = useState('');
  const [resuming, setResuming] = useState(false);
  const timer = useRef<any>(null);

  async function tick() {
    try {
      const s = await semanticStatus();
      setSt(s);
      if (s.running && s.startedAt && s.done > 50) {
        const speed = (Date.now() - s.startedAt) / s.done;
        setEta(fmtEta((s.total - s.done) * speed));
      } else setEta('');
      // 跑完就降频，省得一直打接口
      if (!s.running && timer.current) { clearInterval(timer.current); timer.current = null; }
    } catch (e) {}
  }

  useEffect(() => {
    tick();
    timer.current = setInterval(tick, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  if (!st || !st.stats) return null;
  const stats = st.stats;
  const indexed = Number(stats.indexed || 0);
  const eligible = Number(stats.eligible || 0);
  const running = st.running;
  // 没在跑、也没有未完成的量，就不占地方
  if (!running && (!eligible || indexed >= eligible)) return null;

  const done = running ? (st.done || 0) : indexed;
  const total = running ? (st.total || 0) : eligible;
  const pct = total ? Math.min(100, (done / total) * 100) : 0;

  async function resume() {
    setResuming(true);
    try { await buildSemanticIndex({ minValue: 4, batch: 32, maxChars: 512 }); await tick(); } catch (e) {}
    setResuming(false);
    if (!timer.current) timer.current = setInterval(tick, 3000);
  }

  return (
    <div style={{ padding: '0 10px 8px' }}>
      <div className="card" style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: running ? 'var(--violet)' : 'var(--fg-dim)' }}>
            {running ? '⟳ 正在向量化' : '⚠ 向量索引未完成'}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: 'var(--fg-mute)' }}>{pct.toFixed(1) + '%'}</span>
        </div>
        <div style={{ height: 4, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden', marginBottom: 7 }}>
          <div style={{ width: pct + '%', height: '100%', background: running ? 'var(--violet)' : 'var(--amber)', transition: 'width .4s' }} />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', lineHeight: 1.7 }}>
          {done.toLocaleString() + ' / ' + total.toLocaleString() + ' 条'}
          {st.failed ? <span style={{ color: 'var(--amber)' }}>{' · 失败 ' + st.failed}</span> : null}
          {eta && <div>{'剩余 ' + eta + '（可关掉这个页面，任务在后台继续）'}</div>}
          {!running && <div style={{ marginTop: 2 }}>{'已完成 ' + indexed.toLocaleString() + ' 条，还剩 ' + (total - done).toLocaleString() + ' 条没跑'}</div>}
        </div>
        {!running && (
          <button className="btn ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '3px 0', fontSize: 12 }}
            onClick={resume} disabled={resuming}>{resuming ? '启动中…' : '继续向量化'}</button>
        )}
        {st.error && !running && (
          <div style={{ fontSize: 11, color: 'var(--rose)', marginTop: 6, lineHeight: 1.6 }}>{String(st.error).slice(0, 90)}</div>
        )}
      </div>
    </div>
  );
}
