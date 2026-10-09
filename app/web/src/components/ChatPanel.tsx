import { useEffect, useRef, useState } from 'react';
import { chat as chatApi, Post } from '../api';
import { Markdown } from './Markdown';
import { catColor } from '../lib/util';

type Source = { id: number; date: string; channel: string; category: string; text: string; url: string; value: number };
type Msg = { role: 'user' | 'assistant'; content: string; sources?: Source[]; error?: boolean; stage?: string };

const QUICK = ['最近有哪些免费 VPS / 云服务器羊毛？', '有没有能直接变现的开源项目？', '总结一下最近 AI 工具的新东西', '有哪些便宜的 AI API 渠道？', '找几个好用的下载/转写工具'];

export function ChatPanel({ filters, pendingPost, onConsumePending, onOpenPost }: {
  filters: any; pendingPost: Post | null; onConsumePending: () => void; onOpenPost: (id: number) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [noKey, setNoKey] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, stage]);

  useEffect(() => {
    if (pendingPost) {
      send('请分析这条情报的价值、可信度，以及我可以怎么利用它：\n\n' + pendingPost.text.slice(0, 1500));
      onConsumePending();
    }
  }, [pendingPost]);

  async function send(q?: string) {
    const question = String(q == null ? input : q).trim();
    if (!question || busy) return;
    setInput('');
    setBusy(true);
    setStage('检索中');
    const history = msgs.map(m => ({ role: m.role, content: m.content }));
    setMsgs(prev => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    const patch = (fn: (m: Msg) => Msg) => setMsgs(prev => {
      const next = prev.slice();
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
    await chatApi({ question, history, filters }, {
      onStatus: (s) => setStage(s === 'retrieving' ? '检索资料中…' : '思考中…'),
      onSources: (items) => patch(m => ({ ...m, sources: items })),
      onDelta: (t) => patch(m => ({ ...m, content: m.content + t })),
      onError: (msg, raw) => {
        if (raw && raw.hint === 'no-key') setNoKey(true);
        patch(m => ({ ...m, content: msg, error: true }));
      },
      onDone: () => setStage(''),
    });
    setStage('');
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={boxRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
        {msgs.length === 0 && (
          <div style={{ paddingTop: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>AI 情报助手</div>
            <div style={{ color: 'var(--fg-dim)', fontSize: 13.5, lineHeight: 1.75, marginBottom: 16 }}>
              直接在 85 万条频道帖子里实时检索并回答。回答里的 [1][2] 可以点开对应原文，搜索结果会跟随左侧当前筛选条件。
            </div>
            {noKey && (
              <div className="card" style={{ padding: '12px 14px', marginBottom: 14, borderColor: 'var(--amber)' }}>
                <div style={{ fontSize: 13.5, color: 'var(--amber)', fontWeight: 600, marginBottom: 4 }}>未配置 AI 模型</div>
                <div style={{ fontSize: 13, color: 'var(--fg-dim)' }}>当前只返回检索原文。点击左下角「设置」填入任意 OpenAI 兼容的 API Key（推荐 DeepSeek），即可获得 AI 总结与分析。</div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {QUICK.map(q => (
                <button key={q} className="btn" style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '9px 13px' }} onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            {m.role === 'user' ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ background: 'var(--accent-soft)', color: 'var(--fg)', border: '1px solid var(--border-soft)', borderRadius: 12, padding: '9px 13px', maxWidth: '88%', whiteSpace: 'pre-wrap', fontSize: 13.8 }}>{m.content}</div>
              </div>
            ) : (
              <div>
                {m.sources && m.sources.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--fg-mute)', marginBottom: 6 }}>{'检索到 ' + m.sources.length + ' 条相关资料'}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {m.sources.map((s, n) => (
                        <button key={s.id} className="chip" onClick={() => onOpenPost(s.id)} title={s.text} style={{ maxWidth: 220 }}>
                          <span style={{ color: catColor(s.category), fontWeight: 700 }}>{n + 1}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.text.slice(0, 20)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {m.content
                  ? <div style={{ fontSize: 14, color: m.error ? 'var(--rose)' : 'var(--fg)', lineHeight: 1.8 }}><Markdown text={m.content} onCite={(n) => { const s = m.sources && m.sources[n - 1]; if (s) onOpenPost(s.id); }} /></div>
                  : (busy && i === msgs.length - 1 ? <div style={{ color: 'var(--fg-mute)', fontSize: 13.5 }}><span className="cursor-blink">▍</span> {stage || '思考中…'}</div> : null)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border-soft)', padding: '12px 14px', background: 'var(--bg-1)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={taRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="问点什么，比如：最近有什么免费额度可以薅？"
            rows={2}
            style={{ flex: 1, resize: 'none', lineHeight: 1.6, fontSize: 14 }}
          />
          <button className="btn primary" disabled={busy || !input.trim()} onClick={() => send()} style={{ height: 40 }}>{busy ? '生成中' : '发送'}</button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', marginTop: 6 }}>Enter 发送 · Shift+Enter 换行 · 回答基于检索到的真实帖子，可能存在时效偏差</div>
      </div>
    </div>
  );
}
