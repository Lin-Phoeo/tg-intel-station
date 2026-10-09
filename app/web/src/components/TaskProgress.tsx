import { useEffect, useRef, useState } from 'react';
import { semanticStatus, buildSemanticIndex, getSyncStatus } from '../api';

// ---------- 小工具 ----------
function fmtDur(sec: number) {
  if (!isFinite(sec) || sec <= 0) return '--';
  const s = Math.round(sec);
  if (s < 60) return s + ' 秒';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + ' 分' + (r ? ' ' + r + ' 秒' : '');
  return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
}
function fmtClock(ts: number) {
  if (!ts) return '--';
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
const n = (v: any) => Number(v || 0);

// ---------- 阶段步进器 ----------
function Stepper({ stages, current }: { stages: { key: string; label: string }[]; current: string }) {
  const idx = Math.max(0, stages.findIndex(s => s.key === current));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 13, padding: '0 2px' }}>
      {stages.map((s, i) => {
        const done = i < idx, now = i === idx;
        const color = done ? 'var(--green)' : now ? 'var(--violet)' : 'var(--bg-3)';
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'flex-start', flex: i === stages.length - 1 ? '0 0 auto' : 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 44 }}>
              <div className={now ? 'tp-dot-now' : ''} style={{
                width: now ? 10 : 8, height: now ? 10 : 8, borderRadius: 6,
                background: color, marginTop: now ? -1 : 0,
                boxShadow: now ? '0 0 0 4px color-mix(in srgb, var(--violet) 18%, transparent)' : 'none',
              }} />
              <span style={{ fontSize: 9.5, letterSpacing: '.02em', color: done ? 'var(--green)' : now ? 'var(--violet)' : 'var(--fg-mute)', fontWeight: now ? 700 : 400, whiteSpace: 'nowrap' }}>{s.label}</span>
            </div>
            {i < stages.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? 'var(--green)' : 'var(--bg-3)', marginTop: 4, borderRadius: 1 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 9.5, color: 'var(--fg-mute)', letterSpacing: '.05em' }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 650, color: accent || 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// 后台任务的常驻进度面板。
// 设计目标：一眼看清「在做什么、到哪一步了、还要多久」，不用点进设置翻。
export function TaskProgress() {
  const [sem, setSem] = useState<any>(null);
  const [sync, setSync] = useState<any>(null);
  const timer = useRef<any>(null);

  async function tick() {
    try { setSem(await semanticStatus()); } catch (e) {}
    try { setSync(await getSyncStatus()); } catch (e) {}
    const busy = (sem && sem.running) || (sync && sync.running);
    if (!busy && timer.current) { clearInterval(timer.current); timer.current = null; }
  }

  useEffect(() => {
    tick();
    timer.current = setInterval(tick, 2500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const [resuming, setResuming] = useState(false);
  async function resume() {
    setResuming(true);
    try { await buildSemanticIndex({ minValue: 4, batch: 32, maxChars: 512 }); await tick(); } catch (e) {}
    setResuming(false);
    if (!timer.current) timer.current = setInterval(tick, 2500);
  }

  const sStats = (sem && sem.stats) || {};
  const indexed = n(sStats.indexed), eligible = n(sStats.eligible);
  const syncing = !!(sync && sync.running);
  const building = !!(sem && sem.running);
  const remain = eligible - indexed;
  const pending = !building && remain > 0;
  if (!building && !pending && !syncing) return null;

  const stages = (sem && sem.stages) || [
    { key: 'preparing', label: '准备' }, { key: 'loading', label: '载入模型' },
    { key: 'embedding', label: '向量化' }, { key: 'done', label: '完成' },
  ];
  // 主进度条展示**总进度**（已建向量 / 待建总量），而不是本次会话的进度 ——
  // 否则中断后继续跑会显示成「从 1.5% 开始」，让人以为白跑了。
  const sessionDone = building ? n(sem.done) : 0;
  const done = indexed;
  const total = eligible;
  const pct = total ? Math.min(100, (done / total) * 100) : 0;

  return (
    <div style={{ padding: '0 10px 8px' }}>
      <style>{'@keyframes tp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.86)}} .tp-dot-now{animation:tp-pulse 1.6s ease-in-out infinite}'}</style>

      <div className="card" style={{ padding: '13px 14px 14px', borderColor: building ? 'color-mix(in srgb, var(--violet) 35%, transparent)' : 'var(--border)' }}>

        {/* 标题行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
          <span className={building ? 'tp-dot-now' : ''} style={{
            width: 8, height: 8, borderRadius: 5, flexShrink: 0,
            background: building ? 'var(--violet)' : (pending ? 'var(--amber)' : 'var(--green)'),
          }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.01em' }}>
            {building ? '向量索引构建' : (pending ? '向量索引未完成' : '一键补齐')}
          </span>
          <span style={{ flex: 1 }} />
          <span className="badge" style={{
            fontSize: 10, padding: '1px 7px',
            background: building ? 'color-mix(in srgb, var(--violet) 16%, transparent)' : (pending ? 'color-mix(in srgb, var(--amber) 16%, transparent)' : 'color-mix(in srgb, var(--green) 16%, transparent)'),
            color: building ? 'var(--violet)' : (pending ? 'var(--amber)' : 'var(--green)'),
          }}>{building ? '进行中' : (pending ? '待继续' : '进行中')}</span>
        </div>

        {/* 向量索引 */}
        {(building || pending) && (
          <>
            {building && <Stepper stages={stages} current={sem.stage} />}

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 21, fontWeight: 750, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em', color: building ? 'var(--violet)' : 'var(--amber)' }}>
                {pct.toFixed(1)}<span style={{ fontSize: 12, fontWeight: 600, marginLeft: 1 }}>%</span>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--fg-mute)', fontVariantNumeric: 'tabular-nums' }}>
                {done.toLocaleString() + ' / ' + total.toLocaleString() + ' 条'}
              </span>
              {building && sessionDone > 0 && (
                <span style={{ fontSize: 10.5, color: 'var(--green)', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                  {'本次 +' + sessionDone.toLocaleString()}
                </span>
              )}
            </div>

            <div style={{ height: 6, background: 'var(--bg-3)', borderRadius: 4, overflow: 'hidden', marginBottom: 11 }}>
              <div style={{
                width: pct + '%', height: '100%', borderRadius: 4,
                background: building ? 'linear-gradient(90deg, var(--violet), var(--accent))' : 'var(--amber)',
                transition: 'width .5s cubic-bezier(.4,0,.2,1)',
              }} />
            </div>

            {/* 现在在干嘛 */}
            {building && (
              <div style={{ marginBottom: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 9.5, color: 'var(--fg-mute)', letterSpacing: '.05em' }}>
                    {sem.stageText ? String(sem.stageText) : '正在处理'}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 9.5, color: 'var(--fg-mute)', fontVariantNumeric: 'tabular-nums' }}>
                    {'还剩 ' + Math.max(0, total - done).toLocaleString() + ' 条'}
                  </span>
                </div>
                {sem.current && (
                  <div style={{
                    fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.6,
                    background: 'var(--bg-2)', borderRadius: 6, padding: '6px 8px',
                    borderLeft: '2px solid var(--violet)',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>{sem.current + '…'}</div>
                )}
              </div>
            )}

            {/* 数据网格 */}
            {building ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 8px', marginBottom: 10 }}>
                <Stat label="速度" value={(sem.rate ? sem.rate.toFixed(1) : '--') + ' 条/秒'} />
                <Stat label="已用" value={fmtDur(sem.elapsed)} />
                <Stat label="剩余" value={fmtDur(sem.etaSec)} accent="var(--cyan)" />
                <Stat label="预计完成" value={fmtClock(sem.finishAt)} accent="var(--cyan)" />
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.7, marginBottom: 10 }}>
                {'已完成 ' + indexed.toLocaleString() + ' 条，还剩 ' + remain.toLocaleString() + ' 条。'}
                <div style={{ color: 'var(--fg-mute)', marginTop: 2 }}>接着跑会跳过已建好的，不会重复计算。</div>
              </div>
            )}

            {n(sem && sem.failed) > 0 && (
              <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 8 }}>{'失败 ' + n(sem.failed) + ' 条（不影响其余）'}</div>
            )}
            {building && (
              <div style={{ fontSize: 10.5, color: 'var(--fg-mute)', lineHeight: 1.6, marginBottom: 4 }}>
                {'模型 ' + (sem.model || '--') + (sem.dim ? ' · ' + sem.dim + ' 维' : '') + '　可关掉页面，任务在后台继续'}
              </div>
            )}
            {!building && (
              <button className="btn primary" style={{ width: '100%', justifyContent: 'center', height: 30, fontSize: 12.5 }}
                onClick={resume} disabled={resuming}>{resuming ? '启动中…' : '继续向量化'}</button>
            )}
            {sem && sem.error && !building && (
              <div style={{ fontSize: 10.5, color: 'var(--rose)', marginTop: 7, lineHeight: 1.6 }}>{String(sem.error).split('\n')[0].slice(0, 100)}</div>
            )}
          </>
        )}

        {/* 一键补齐 */}
        {syncing && (
          <>
            {(building || pending) && <div className="divider" style={{ margin: '13px 0 12px' }} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
              <span className="tp-dot-now" style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--cyan)' }} />
              <span style={{ fontSize: 12, fontWeight: 650 }}>增量抓取</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--fg-mute)', fontVariantNumeric: 'tabular-nums' }}>
                {n(sync.done) + ' / ' + n(sync.total) + ' 个来源'}
              </span>
            </div>
            <div style={{ height: 5, background: 'var(--bg-3)', borderRadius: 4, overflow: 'hidden', marginBottom: 9 }}>
              <div style={{ width: (sync.total ? (n(sync.done) / n(sync.total)) * 100 : 0) + '%', height: '100%', background: 'var(--cyan)', transition: 'width .5s' }} />
            </div>
            {sync.current && (
              <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {'正在抓：' + String(sync.current).slice(0, 40)}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 8px' }}>
              <Stat label="新增" value={n(sync.imported).toLocaleString() + ' 条'} accent="var(--green)" />
              <Stat label="已扫描" value={n(sync.scanned).toLocaleString() + ' 条'} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
