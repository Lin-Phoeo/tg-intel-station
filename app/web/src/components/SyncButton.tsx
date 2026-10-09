import { useEffect, useRef, useState } from 'react';
import { getSyncStatus, runSync } from '../api';
import { timeAgo } from '../lib/util';

// 一键补齐：手动触发所有来源的增量抓取。
// 不做后台定时器 —— 由用户点一下决定，可控、可预期。
export function SyncButton({ onDone }: { onDone?: () => void }) {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef<any>(null);

  async function poll() {
    try {
      const s = await getSyncStatus();
      setSt(s);
      if (!s.running) {
        if (timer.current) { clearInterval(timer.current); timer.current = null; }
        setBusy(false);
        if (s.finishedAt) {
          setMsg('补齐完成 · 新增 ' + s.imported + ' 条 / 扫描 ' + s.scanned + ' 条');
          if (onDone) onDone();
        }
      }
    } catch (e) { /* 轮询失败忽略 */ }
  }

  useEffect(() => {
    getSyncStatus().then(s => { setSt(s); if (s.running) { setBusy(true); timer.current = setInterval(poll, 1500); } }).catch(() => {});
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  async function start() {
    setMsg('');
    setBusy(true);
    const r = await runSync(2000);
    if (!r.ok) { setBusy(false); setMsg(r.error || '启动失败'); return; }
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(poll, 1500);
    poll();
  }

  const running = busy || (st && st.running);
  const total = st && st.total ? st.total : 0;
  const done = st && st.done ? st.done : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const last = st && st.lastSync;

  return (
    <div style={{ padding: '0 10px 6px' }}>
      <button
        className="btn"
        onClick={start}
        disabled={running}
        style={{ width: '100%', justifyContent: 'center', height: 38, fontWeight: 600, borderColor: running ? 'var(--border)' : 'var(--accent)', color: running ? 'var(--fg-dim)' : 'var(--accent)' }}
      >
        {running ? '⟳ 补齐中…' : '⟳ 一键补齐'}
      </button>

      {running && (
        <div style={{ marginTop: 7 }}>
          <div style={{ height: 4, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', marginTop: 5, lineHeight: 1.6 }}>
            {'来源 ' + done + '/' + total + ' · 已新增 ' + (st.imported || 0) + ' 条'}
            {st.current ? <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{'正在抓：' + st.current}</div> : null}
          </div>
        </div>
      )}

      {!running && (
        <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', marginTop: 6, lineHeight: 1.6 }}>
          {last
            ? ('上次补齐 ' + timeAgo((last.date || '').slice(0, 10)) + ' · 新增 ' + (last.imported || 0) + ' 条')
            : '还没补齐过'}
        </div>
      )}

      {msg && !running && (
        <div style={{ fontSize: 11.5, color: 'var(--green)', marginTop: 4, lineHeight: 1.6 }}>{msg}</div>
      )}
    </div>
  );
}
