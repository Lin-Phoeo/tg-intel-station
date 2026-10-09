import { useEffect, useMemo, useRef, useState } from 'react';

export type Cmd = { id: string; label: string; group: string; hint?: string; run: () => void };

// Ctrl+K 命令面板：所有操作都能键盘完成，不离开输入区
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Cmd[] }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); } }, [open]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return commands.slice(0, 40);
    const score = (c: Cmd) => {
      const l = c.label.toLowerCase();
      if (l.startsWith(kw)) return 0;
      if (l.includes(kw)) return 1;
      // 松散匹配：按字符顺序出现即可
      let i = 0;
      for (const ch of l) { if (ch === kw[i]) i++; if (i >= kw.length) return 2; }
      return 99;
    };
    return commands.map(c => ({ c: c, s: score(c) })).filter(x => x.s < 99)
      .sort((a, b) => a.s - b.s).slice(0, 40).map(x => x.c);
  }, [q, commands]);

  useEffect(() => { setIdx(i => Math.min(i, Math.max(0, shown.length - 1))); }, [shown.length]);

  // 注意：所有 hook 必须在下面这个提前 return 之前，否则 open 变化时
  // hook 数量不一致，React 会抛错。
  useEffect(() => {
    if (!open) return;
    const el = listRef.current && listRef.current.querySelector('[data-active="1"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [idx, open]);

  if (!open) return null;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = shown[idx]; if (c) { onClose(); c.run(); } }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  let lastGroup = '';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 200, display: 'flex', justifyContent: 'center', paddingTop: '12vh' }} onClick={onClose}>
      <div className="card" style={{ width: 620, maxWidth: '92vw', maxHeight: '70vh', background: 'var(--bg-1)', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="输入命令，或直接搜情报…（↑↓ 选择，Enter 执行，Esc 关闭）"
          style={{ border: 'none', borderBottom: '1px solid var(--border-soft)', borderRadius: 0, padding: '15px 18px', fontSize: 14.5, background: 'transparent' }} />
        <div ref={listRef} style={{ overflowY: 'auto', padding: 6 }}>
          {shown.length === 0 && <div style={{ padding: '18px 14px', fontSize: 13, color: 'var(--fg-mute)' }}>没有匹配的命令。按 Enter 直接用它搜索情报。</div>}
          {shown.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : '';
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head && <div style={{ fontSize: 11, color: 'var(--fg-mute)', padding: '9px 12px 4px', letterSpacing: '.08em' }}>{head}</div>}
                <div data-active={i === idx ? '1' : '0'} onMouseEnter={() => setIdx(i)} onClick={() => { onClose(); c.run(); }}
                  style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, background: i === idx ? 'var(--bg-3)' : 'transparent', color: i === idx ? 'var(--fg)' : 'var(--fg-dim)' }}>
                  <span style={{ flex: 1, fontSize: 13.5 }}>{c.label}</span>
                  {c.hint && <span style={{ fontSize: 11.5, color: 'var(--fg-mute)' }}>{c.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
