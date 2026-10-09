import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchModelsForConfig } from '../api';
import type { FetchedModel } from '../api';

type Props = {
  value: string;
  onChange: (v: string) => void;
  baseUrl: string;
  apiKey?: string;
  apiFormat: string;
  modelsUrl: string;
  headers: string;
  hasKey?: boolean;
};

export function ModelPicker({ value, onChange, baseUrl, apiKey, apiFormat, modelsUrl, headers, hasKey }: Props) {
  const [models, setModels] = useState<FetchedModel[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string; detail?: string } | null>(null);
  const [srcUrl, setSrcUrl] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function load() {
    if (!baseUrl.trim()) { setMsg({ kind: 'err', text: '请先填写 Base URL' }); return; }
    setBusy(true);
    setMsg({ kind: 'info', text: '正在获取模型列表…' });
    const r = await fetchModelsForConfig({ baseUrl, apiKey, apiFormat, modelsUrl, headers });
    setBusy(false);
    if (r.ok && r.models) {
      setModels(r.models);
      setSrcUrl(r.url || '');
      setMsg({ kind: 'ok', text: '获取到 ' + r.models.length + ' 个模型' });
      setOpen(true);
      setFilter('');
      if (!value && r.models.length) onChange(r.models[0].id);
    } else {
      setModels([]);
      setMsg({ kind: 'err', text: r.error || '获取失败', detail: (r.tried && r.tried.length > 1) ? '尝试过：' + r.tried.join('  →  ') : undefined });
    }
  }

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const arr = f ? models.filter(m => m.id.toLowerCase().includes(f)) : models;
    return arr.slice(0, 500);
  }, [models, filter]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} ref={boxRef}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            value={value}
            onChange={e => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => { if (models.length) setOpen(true); }}
            placeholder="deepseek-chat（可点右侧「获取模型」自动拉取）"
            style={{ width: '100%' }}
          />
          {open && models.length > 0 && (
            <div className="card" style={{ position: 'absolute', zIndex: 40, top: 'calc(100% + 5px)', left: 0, right: 0, maxHeight: 280, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--bg-1)', boxShadow: 'var(--shadow)' }}>
              <div style={{ padding: 7, borderBottom: '1px solid var(--border-soft)' }}>
                <input autoFocus value={filter} onChange={e => setFilter(e.target.value)} placeholder={'搜索 ' + models.length + ' 个模型…'} style={{ width: '100%', fontSize: 13, padding: '5px 9px' }} />
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {shown.map(m => (
                  <div
                    key={m.id}
                    data-model-row={m.id}
                    onClick={() => { onChange(m.id); setOpen(false); setFilter(''); }}
                    style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', background: m.id === value ? 'var(--accent-soft)' : 'transparent', color: m.id === value ? 'var(--accent)' : 'var(--fg)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = m.id === value ? 'var(--accent-soft)' : 'transparent')}
                  >
                    {m.id}
                    {m.ownedBy && <span style={{ color: 'var(--fg-mute)', fontSize: 11.5, marginLeft: 8 }}>{m.ownedBy}</span>}
                  </div>
                ))}
                {shown.length === 0 && <div style={{ padding: 14, color: 'var(--fg-mute)', fontSize: 13 }}>没有匹配的模型</div>}
              </div>
              {shown.length < models.length && <div style={{ padding: '5px 12px', fontSize: 11.5, color: 'var(--fg-mute)', borderTop: '1px solid var(--border-soft)' }}>{'显示前 ' + shown.length + ' / ' + models.length + ' 个，继续输入可缩小范围'}</div>}
            </div>
          )}
        </div>
        <button className="btn" onClick={load} disabled={busy} style={{ whiteSpace: 'nowrap' }}>{busy ? '获取中…' : '获取模型'}</button>
        {models.length > 0 && <button className="btn ghost" onClick={() => setOpen(v => !v)} title="展开模型列表">{open ? '▲' : '▼'}</button>}
      </div>

      {msg && (
        <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.6, color: msg.kind === 'err' ? 'var(--rose)' : msg.kind === 'ok' ? 'var(--green)' : 'var(--fg-dim)' }}>
          {msg.text}
          {srcUrl && <span style={{ color: 'var(--fg-mute)' }}>{' · ' + srcUrl}</span>}
          {msg.detail && <div style={{ color: 'var(--fg-mute)', fontSize: 11.5, wordBreak: 'break-all' }}>{msg.detail}</div>}
          {msg.kind === 'err' && <div style={{ color: 'var(--fg-mute)', fontSize: 11.5 }}>不支持的话直接手动填模型名即可，不影响使用。</div>}
        </div>
      )}
    </div>
  );
}
