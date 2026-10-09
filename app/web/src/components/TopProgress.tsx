import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { semanticStatus, buildSemanticIndex, getSyncStatus } from '../api';

function fmtDur(sec: number) {
  if (!isFinite(sec) || sec <= 0) return '--';
  const s = Math.round(sec);
  if (s < 60) return s + ' 秒';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + ' 分' + (r ? ' ' + r + '秒' : '');
  return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
}
function fmtClock(ts: number) {
  if (!ts) return '';
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
const n = (v: any) => Number(v || 0);

// 顶部任务进度条。
// 放在主内容区最上方而不是侧栏：始终可见，但不占侧栏的垂直空间，
// 也不会把分类列表挤下去。点击展开细节。
export function TopProgress() {
  const [sem, setSem] = useState<any>(null);
  const [sync, setSync] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<any>(null);

  async function tick() {
    try { setSem(await semanticStatus()); } catch (e) {}
    try { setSync(await getSyncStatus()); } catch (e) {}
  }
  useEffect(() => {
    tick();
    timer.current = setInterval(tick, 2500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  async function resume() {
    setBusy(true);
    try { await buildSemanticIndex({ minValue: 4, batch: 32, maxChars: 512 }); await tick(); } catch (e) {}
    setBusy(false);
  }

  const st = (sem && sem.stats) || {};
  const indexed = n(st.indexed), eligible = n(st.eligible);
  const building = !!(sem && sem.running);
  const syncing = !!(sync && sync.running);
  const remain = Math.max(0, eligible - indexed);
  const pending = !building && remain > 0;
  if (!building && !syncing && !pending) return null;

  const pct = eligible ? Math.min(100, (indexed / eligible) * 100) : 0;
  const stages = (sem && sem.stages) || [];
  const curIdx = stages.findIndex((s: any) => s.key === sem.stage);

  return (
    <div className={'topbar-prog' + (open ? ' open' : '') + (building || syncing ? ' live' : '')} onClick={() => setOpen(o => !o)}>
      <div className="tpp-line" />
      <div className="tpp-head">
        <span className={'tpp-dot' + (building || syncing ? ' live' : '')} />
        <span className="tpp-title">
          {building ? '向量索引' : syncing ? '增量抓取' : '向量索引待继续'}
        </span>
        <span className="tpp-pct">{building || pending ? pct.toFixed(1) + '%' : (sync && sync.total ? Math.round((n(sync.done) / n(sync.total)) * 100) + '%' : '')}</span>
        <span className="tpp-sub">
          {building && <>
            {indexed.toLocaleString() + ' / ' + eligible.toLocaleString() + ' 条'}
            {' · ' + (sem.stageText || '')}
            {sem.rate ? ' · ' + sem.rate.toFixed(1) + ' 条/秒' : ''}
            {' · 剩余 ' + fmtDur(sem.etaSec)}
            {sem.finishAt ? '（预计 ' + fmtClock(sem.finishAt) + ' 完成）' : ''}
          </>}
          {!building && pending && <>剩 {remain.toLocaleString()} 条未处理</>}
          {syncing && !building && <>正在抓取 {n(sync.done)}/{n(sync.total)} 个来源 · 新增 {n(sync.imported)} 条</>}
        </span>
        <span style={{ flex: 1 }} />
        <span className="tpp-chev">{open ? <ChevronUp size={13} strokeWidth={2} /> : <ChevronDown size={13} strokeWidth={2} />}</span>
      </div>

      {open && (
        <div className="tpp-detail" onClick={e => e.stopPropagation()}>
          {/* 阶段步进器 */}
          {building && (
            <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 11 }}>
              {stages.map((s: any, i: number) => {
                const done = i < curIdx, now = i === curIdx;
                const col = done ? 'var(--green)' : now ? 'var(--accent)' : 'var(--bg-4)';
                return (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'flex-start', flex: i === stages.length - 1 ? '0 0 auto' : 1 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 52 }}>
                      <div className={now ? 'tpp-pulse' : ''} style={{ width: now ? 9 : 7, height: now ? 9 : 7, borderRadius: 5, background: col }} />
                      <span style={{ fontSize: 'var(--fs-micro)', color: done ? 'var(--green)' : now ? 'var(--accent)' : 'var(--fg-mute)', fontWeight: now ? 600 : 400, whiteSpace: 'nowrap' }}>{s.label}</span>
                    </div>
                    {i < stages.length - 1 && <div style={{ flex: 1, height: 1.5, background: done ? 'var(--green)' : 'var(--bg-4)', marginTop: 4 }} />}
                  </div>
                );
              })}
            </div>
          )}

          {building && sem.current && (
            <div className="tpp-now">
              <span className="tpp-now-label">{sem.stageText || '正在处理'}</span>
              <span className="tpp-now-text">{sem.current}…</span>
            </div>
          )}

          <div className="tpp-grid">
            {building && <>
              <div><span className="k">已建</span><span className="v">{indexed.toLocaleString()} 条</span></div>
              <div><span className="k">本次</span><span className="v" style={{ color: 'var(--green)' }}>+{n(sem.done).toLocaleString()} 条</span></div>
              <div><span className="k">速率</span><span className="v">{sem.rate ? sem.rate.toFixed(1) + ' 条/秒' : '--'}</span></div>
              <div><span className="k">已用</span><span className="v">{fmtDur(sem.elapsed)}</span></div>
              <div><span className="k">剩余</span><span className="v">{fmtDur(sem.etaSec)}</span></div>
              <div><span className="k">模型</span><span className="v">{sem.dim ? sem.dim + ' 维' : '--'}</span></div>
            </>}
            {syncing && <>
              <div><span className="k">来源</span><span className="v">{n(sync.done)} / {n(sync.total)}</span></div>
              <div><span className="k">新增</span><span className="v" style={{ color: 'var(--green)' }}>{n(sync.imported).toLocaleString()} 条</span></div>
              <div><span className="k">已扫描</span><span className="v">{n(sync.scanned).toLocaleString()} 条</span></div>
              <div><span className="k">当前</span><span className="v">{String(sync.current || '--').slice(0, 16)}</span></div>
            </>}
          </div>

          {!building && pending && (
            <button className="btn primary" style={{ marginTop: 10, height: 28, fontSize: 'var(--fs-meta)' }} onClick={resume} disabled={busy}>
              {busy ? '启动中…' : '继续向量化'}
            </button>
          )}
          {sem && sem.error && !building && (
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--rose)', marginTop: 8 }}>{String(sem.error).split('\n')[0].slice(0, 110)}</div>
          )}
        </div>
      )}
    </div>
  );
}
