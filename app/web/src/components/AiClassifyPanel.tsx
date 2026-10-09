import { useEffect, useRef, useState } from 'react';
import { Sparkles, Play, Square, RotateCcw, Loader2, AlertCircle, Trash2 } from 'lucide-react';

// AI 辅助分类与评分。
//
// 为什么需要它：规则分类器是关键词打分，多类目得分接近时会选错；
// 价值分也只是「类目基础分 + 标签加成 + 浏览量」的粗估。
// 实测它能把规则漏进「其他」的实用帖捞出来 ——
// 比如「无羁音乐播放器」原判 其他/3.5，模型判 实用工具/7。
//
// 但吞吐受模型速度限制（实测约 13 秒/条），所以重点在**限定范围**：
// 全量 90 万条不现实，挑最有价值的子集跑。
const SCOPES = [
  { v: 'other3', label: '「其他」里价值分 ≥ 3 的', desc: '规则漏判最可能发生的地方，条数少、收益最直接', scope: { scope: 'other', minValue: 3 } },
  { v: 'other', label: '「其他」全部', desc: '范围大，条数多，建议只在闲时跑', scope: { scope: 'other' } },
  { v: 'low', label: '低分帖（价值分 ≤ 3）', desc: '重新评估是不是被规则低估了', scope: { scope: 'lowvalue' } },
  { v: 'high', label: '高分帖（价值分 ≥ 5）', desc: '复核已经高分的是否虚高', scope: { scope: 'highvalue' } },
  { v: 'recent', label: '最近 7 天的帖子', desc: '只处理新抓进来的', scope: { scope: 'all', days: 7 } },
];

function fmtDur(sec) {
  if (!isFinite(sec) || sec <= 0) return '--';
  const s = Math.round(sec);
  if (s < 60) return s + ' 秒';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时 ' + (m % 60) + ' 分';
  return Math.floor(h / 24) + ' 天 ' + (h % 24) + ' 小时';
}

export function AiClassifyPanel() {
  const [scope, setScope] = useState('other3');
  const [st, setSt] = useState<any>(null);
  const [cand, setCand] = useState<any>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  const [profileId, setProfileId] = useState('');
  const timer = useRef<any>(null);

  const cur = SCOPES.find(s => s.v === scope) || SCOPES[0];

  async function refresh() {
    try {
      const j = await (await fetch('/api/ai-classify/status')).json();
      setSt(j);
      setProfileId(prev => prev || j.profileId || '');
    } catch (e) {}
  }
  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);
  useEffect(() => {
    setCand(null); setPreview([]);
    const p = new URLSearchParams();
    Object.keys(cur.scope).forEach(k => p.set(k, String(cur.scope[k])));
    p.set('n', '3');
    fetch('/api/ai-classify/preview?' + p.toString()).then(r => r.json())
      .then(j => { setCand(j.candidates || 0); setPreview(j.items || []); })
      .catch(() => {});
  }, [scope]);

  async function start() {
    setBusy(true); setMsg(null);
    const r = await (await fetch('/api/ai-classify/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: cur.scope, limit: 0 }),
    })).json();
    setBusy(false);
    if (r.ok) { setMsg({ kind: 'ok', text: '已开始，共 ' + Number(r.total).toLocaleString() + ' 条' }); refresh(); }
    else setMsg({ kind: 'err', text: r.error || '启动失败' });
  }
  async function stop() {
    await fetch('/api/ai-classify/stop', { method: 'POST' });
    setMsg({ kind: 'info', text: '已请求停止，会在当前批次结束后停下' });
  }
  async function rollback() {
    if (!window.confirm('把所有 AI 标注的帖子恢复成标注前的类目与价值分？\n（标注记录也会一并清空）')) return;
    const r = await (await fetch('/api/ai-classify/rollback', { method: 'POST' })).json();
    await fetch('/api/ai-classify/clear', { method: 'POST' });
    setMsg({ kind: 'info', text: '已回滚 ' + Number(r.restored).toLocaleString() + ' 条' });
    refresh();
  }

  const running = !!(st && st.running);
  const done = st ? st.done : 0;
  const total = st ? st.total : 0;
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  const rate = st ? Number(st.rate || 0) : 0;
  // 估时用于给用户一个量级预期。
  // 瓶颈是**每次调用的固定延迟**（实测最简请求也要 70 秒以上），不是输出长度 ——
  // 所以批量越大摊得越薄。每批 20 条时实测约 1.8 秒/条；这里按 3 秒/条保守估。
  const SEC_PER_ITEM = rate > 0 ? 1 / rate : 3;
  const estSec = cand ? cand * SEC_PER_ITEM : 0;

  async function saveProfile(id: string) {
    await fetch('/api/ai-classify/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) });
    refresh();
  }

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>AI 辅助分类与评分</div>
      <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-dim)', lineHeight: 1.75, marginBottom: 14 }}>
        规则分类器是关键词打分，多类目得分接近时会选错；价值分也只是「类目基础分 + 标签加成 + 浏览量」的粗估。
        交给模型逐条判断会准得多 —— 实测它能把规则漏进「其他」的实用帖捞出来，同时把纯资讯正确压低。
      </div>

      <label style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-mute)' }}>用哪个模型</label>
      <select value={profileId} onChange={e => { setProfileId(e.target.value); saveProfile(e.target.value); }}
        disabled={running} style={{ width: '100%', margin: '4px 0 6px' }}>
        <option value="">跟随当前对话模型</option>
        {(st && st.profiles || []).filter((p: any) => p.hasKey).map((p: any) => (
          <option key={p.id} value={p.id}>{p.name} · {p.model}</option>
        ))}
      </select>
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)', marginBottom: 12, lineHeight: 1.6 }}>
        分类只是做简单判断，<b style={{ color: 'var(--fg-dim)' }}>用旗舰推理模型是浪费</b> ——
        实测最简请求也要 70 秒以上，瓶颈在每次调用的固定延迟。
        换一个快的小模型（比如 glm-4-flash），速度能差几十倍。
      </div>

      <label style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-mute)' }}>处理范围</label>
      <select value={scope} onChange={e => setScope(e.target.value)} disabled={running} style={{ width: '100%', margin: '4px 0 6px' }}>
        {SCOPES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
      </select>
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)', marginBottom: 12 }}>{cur.desc}</div>

      <div className="sync-info" style={{ marginBottom: 12 }}>
        <div><span className="k">待处理</span><span className="v">{cand == null ? '统计中…' : cand.toLocaleString() + ' 条'}</span></div>
        <div><span className="k">预计耗时</span><span className="v">{cand == null ? '—' : fmtDur(estSec)}</span></div>
        <div><span className="k">已标注累计</span><span className="v">{st ? Number(st.labeled || 0).toLocaleString() + ' 条' : '—'}</span></div>
        <div><span className="k">实测速度</span><span className="v">{rate > 0 ? rate.toFixed(2) + ' 条/秒' : '约 ' + SEC_PER_ITEM + ' 秒/条'}</span></div>
      </div>

      {preview.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)', marginBottom: 5 }}>范围预览（前几条）</div>
          {preview.map(p => (
            <div key={p.id} style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-dim)', lineHeight: 1.7, marginBottom: 3 }}>
              <span style={{ color: 'var(--fg-mute)' }}>[{p.value}] {p.category}</span> {p.text}
            </div>
          ))}
        </div>
      )}

      {running && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Loader2 size={13} className="spin" style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 'var(--fs-meta)', fontWeight: 600 }}>{pct.toFixed(1)}%</span>
            <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)' }}>{done.toLocaleString()} / {total.toLocaleString()}</span>
            {st.etaSec > 0 && <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)' }}>剩余 {fmtDur(st.etaSec)}</span>}
          </div>
          <div style={{ height: 3, background: 'var(--bg-4)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)', transition: 'width .5s' }} />
          </div>
          {st.current && <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)', marginTop: 5 }}>正在处理：{String(st.current).slice(0, 50)}…</div>}
        </div>
      )}

      {st && st.error && !running && (
        <div className="amsg err" style={{ marginBottom: 10 }}><AlertCircle size={12} /> {String(st.error).slice(0, 160)}</div>
      )}
      {msg && <div className={'amsg ' + msg.kind}>{msg.text}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {!running
          ? <button className="btn primary" onClick={start} disabled={busy || !cand}>
              <Play size={13} strokeWidth={2} />开始标注
            </button>
          : <button className="btn" onClick={stop}><Square size={13} strokeWidth={2} />停止</button>}
        {!running && (st && Number(st.labeled) > 0) && (
          <button className="btn ghost" onClick={rollback} style={{ color: 'var(--rose)' }}>
            <RotateCcw size={13} strokeWidth={1.75} />回滚全部标注
          </button>
        )}
      </div>
    </div>
  );
}
