import { useEffect, useRef, useState } from 'react';
import { resolveSource, importSource, getSourceJobs, deleteSource } from '../api';
import type { SourceJob } from '../api';

const LIMITS = [
  { v: 500, label: '最近 500 条' },
  { v: 2000, label: '最近 2000 条' },
  { v: 10000, label: '最近 1 万条' },
  { v: 50000, label: '尽量全量' },
];

export function AddSourceModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported?: () => void }) {
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(2000);
  const [jobs, setJobs] = useState<SourceJob[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const timer = useRef<any>(null);

  async function refresh() {
    try { const r = await getSourceJobs(); setJobs((r.jobs || []).slice(0, 12)); setSources(r.sources || []); onImported && r.jobs.filter(j => j.finishedAt).length && onImported(); } catch (e) {}
  }
  useEffect(() => {
    if (!open) return;
    refresh();
    timer.current = setInterval(refresh, 1500);
    return () => clearInterval(timer.current);
  }, [open]);

  if (!open) return null;

  const links = text.split('\n').map(s => s.trim()).filter(Boolean);

  async function doCheck() {
    if (!links.length) return;
    setMsg({ kind: 'info', text: '正在识别…' });
    const r = await resolveSource(links[0]);
    setCheck(r);
    if (!r.ok) setMsg({ kind: 'err', text: r.error });
    else if (r.kind === 'channel') setMsg({ kind: 'ok', text: '公开频道「' + (r.title || r.username) + '」可抓取' + (r.existing ? '，库里已有 ' + r.existing + ' 条（将增量补新）' : '') });
    else if (r.kind === 'web') setMsg({ kind: 'ok', text: '网页《' + (r.title || r.host) + '》可采集' });
    else setMsg({ kind: 'info', text: r.note || '该链接不支持抓取' });
  }

  async function doImport() {
    if (!links.length) return;
    setBusy(true);
    setMsg({ kind: 'info', text: '已提交 ' + links.length + ' 个链接，正在抓取…' });
    for (const l of links) { try { await importSource(l, limit); } catch (e) {} }
    setBusy(false);
    await refresh();
  }

  const st = (j: SourceJob) => j.status === 'done' ? { c: 'var(--green)', t: '完成' }
    : j.status === 'unsupported' ? { c: 'var(--amber)', t: '不支持' }
    : j.status === 'failed' ? { c: 'var(--rose)', t: '失败' }
    : { c: 'var(--accent)', t: j.phase || '进行中' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 720, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', background: 'var(--bg-1)', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>按链接抓取内容</div>
        <div style={{ fontSize: 13, color: 'var(--fg-dim)', marginBottom: 16, lineHeight: 1.75 }}>
          粘贴链接，抓取的内容会走同一套分类器进入检索库，能被搜索和 AI 问答命中。<br />
          支持：<b>Telegram 公开频道</b>（t.me/xxx、t.me/s/xxx、@xxx）、<b>任意网页</b>（文章、博客、工具页）。
        </div>

        <label style={{ fontSize: 12.5, color: 'var(--fg-mute)' }}>链接（一行一个，支持批量）</label>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
          placeholder={'https://t.me/somechannel\nhttps://example.com/some-article\n@anotherchannel'}
          style={{ width: '100%', margin: '5px 0 12px', resize: 'vertical', lineHeight: 1.7, fontSize: 13.5 }} />

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 12.5, color: 'var(--fg-mute)' }}>抓取范围</span>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ padding: '5px 10px' }}>
            {LIMITS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--fg-mute)' }}>频道越大耗时越久；已抓过的消息会自动跳过</span>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <button className="btn" onClick={doCheck} disabled={!links.length}>先识别第一个链接</button>
          <button className="btn primary" onClick={doImport} disabled={busy || !links.length}>{busy ? '提交中…' : '开始抓取'}</button>
        </div>

        {msg && (
          <div style={{ marginBottom: 14, padding: '9px 12px', borderRadius: 9, fontSize: 13, lineHeight: 1.7, background: msg.kind === 'err' ? 'color-mix(in srgb, var(--rose) 13%, transparent)' : msg.kind === 'ok' ? 'color-mix(in srgb, var(--green) 13%, transparent)' : 'var(--bg-3)', color: msg.kind === 'err' ? 'var(--rose)' : msg.kind === 'ok' ? 'var(--green)' : 'var(--fg-dim)' }}>{msg.text}</div>
        )}

        {check && check.kind !== 'channel' && check.kind !== 'web' && (
          <div className="card" style={{ padding: '12px 14px', marginBottom: 16, borderColor: 'var(--amber)' }}>
            <div style={{ fontSize: 13.5, color: 'var(--amber)', fontWeight: 600, marginBottom: 4 }}>这类链接拿不到内容</div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-dim)', lineHeight: 1.75 }}>
              {check.note}
              <br />
              群里想收录内容，只有一条路：把机器人拉进群并设为管理员，然后用上一节的「收录群消息」。
            </div>
          </div>
        )}

        {jobs.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', marginBottom: 8 }}>抓取任务</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {jobs.map(j => {
                const s = st(j);
                return (
                  <div key={j.id} className="card" style={{ padding: '9px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge" style={{ background: 'color-mix(in srgb, ' + s.c + ' 15%, transparent)', color: s.c }}>{s.t}</span>
                      <span style={{ fontSize: 13, flex: 1, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.title || j.input}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--fg-mute)' }}>
                        {j.status === 'unsupported' ? '无法抓取' : ('新增 ' + j.imported + (j.skipped ? ' · 跳过 ' + j.skipped : '') + (j.scanned ? ' / 扫描 ' + j.scanned : ''))}
                      </span>
                    </div>
                    {j.note && <div style={{ fontSize: 12, color: 'var(--fg-mute)', marginTop: 4, lineHeight: 1.6 }}>{j.note}</div>}
                    {j.error && <div style={{ fontSize: 12, color: 'var(--rose)', marginTop: 4 }}>{j.error}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sources.length > 0 && (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', marginBottom: 8 }}>已添加的来源</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sources.map(s => (
                <div key={s.id} className="card" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="badge" style={{ background: 'var(--bg-3)', color: 'var(--fg-dim)' }}>{s.kind}</span>
                  <span style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.id}</span>
                  <span style={{ fontSize: 12, color: 'var(--fg-mute)' }}>{s.last_sync ? s.last_sync.slice(0, 16).replace('T', ' ') : ''}</span>
                  <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--rose)' }} onClick={async () => { await deleteSource(s.id); refresh(); }}>移除</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
