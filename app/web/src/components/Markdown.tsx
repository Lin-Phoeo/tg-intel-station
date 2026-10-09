import { Fragment, ReactNode } from 'react';

// Minimal, safe markdown renderer tuned for LLM answers.
function inline(text: string, keyBase: string, onCite?: (n: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\\\`[^\\\`]+\\\`)|(\\[\\d+\\])/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = keyBase + '-' + (i++);
    if (tok.startsWith('**')) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('[') && tok.includes('](')) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (mm) out.push(<a key={key} className="link" href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>);
      else out.push(tok);
    } else if (tok.startsWith('\\\`')) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (/^\[\d+\]$/.test(tok)) {
      const n = parseInt(tok.slice(1, -1), 10);
      out.push(<button key={key} onClick={() => onCite && onCite(n)} className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: 'none', cursor: onCite ? 'pointer' : 'default', margin: '0 2px', verticalAlign: 'baseline' }}>{tok}</button>);
    } else out.push(tok);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  const lines = String(text || '').split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let k = 0;

  const flush = () => {
    if (list.length) {
      blocks.push(listType === 'ol' ? <ol key={'l' + k++}>{list}</ol> : <ul key={'l' + k++}>{list}</ul>);
      list = []; listType = null;
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flush(); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const Tag = (h[1].length <= 2 ? 'h2' : 'h3') as any;
      blocks.push(<Tag key={'h' + k++}>{inline(h[2], 'h' + k, onCite)}</Tag>);
      continue;
    }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ol) { if (listType !== 'ol') flush(); listType = 'ol'; list.push(<li key={'i' + k++}>{inline(ol[2], 'i' + k, onCite)}</li>); continue; }
    if (ul) { if (listType !== 'ul') flush(); listType = 'ul'; list.push(<li key={'i' + k++}>{inline(ul[1], 'i' + k, onCite)}</li>); continue; }
    flush();
    blocks.push(<p key={'p' + k++}>{inline(line, 'p' + k, onCite)}</p>);
  }
  flush();
  return <div className="md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
