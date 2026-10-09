import { useEffect, useState } from 'react';
import { BotSettings } from './BotSettings';
import { ModelSettings } from './ModelSettings';
import { Bot, Sparkles, Database } from 'lucide-react';
import { BackupPanel } from './BackupPanel';
import { SemanticPanel } from './SemanticPanel';
import { AiClassifyPanel } from './AiClassifyPanel';

export function SettingsModal({ open, onClose, onActiveChange, initialTab }: {
  open: boolean;
  onClose: () => void;
  onActiveChange?: (id: string) => void;
  initialTab?: 'ai' | 'bot' | 'data';
}) {
  const [tab, setTab] = useState<'ai' | 'bot' | 'data'>(() =>
    initialTab || (new URLSearchParams(window.location.search).get('tab') === 'bot' ? 'bot' : 'ai')
  );
  // 所有 hook 必须放在早退之前 —— 否则 open 变化时 hook 数量不一致，React 会直接抛错
  useEffect(() => { if (open && initialTab) setTab(initialTab); }, [open, initialTab]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 680, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', background: 'var(--bg-1)', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <button className="btn" style={{ background: tab === 'ai' ? 'var(--bg-3)' : 'transparent', borderColor: tab === 'ai' ? 'var(--accent)' : 'var(--border)' }} onClick={() => setTab('ai')}><Sparkles size={14} strokeWidth={1.75} />AI 模型</button>
          <button className="btn" style={{ background: tab === 'data' ? 'var(--bg-3)' : 'transparent', borderColor: tab === 'data' ? 'var(--accent)' : 'var(--border)', color: tab === 'data' ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={() => setTab('data')}><Database size={14} strokeWidth={1.75} />数据备份</button>
          <button className="btn" style={{ background: tab === 'bot' ? 'var(--bg-3)' : 'transparent', borderColor: tab === 'bot' ? 'var(--accent)' : 'var(--border)' }} onClick={() => setTab('bot')}><Bot size={14} strokeWidth={1.75} />电报机器人</button>
        </div>

        {tab === 'ai' && (<>
          <ModelSettings onActiveChange={onActiveChange} />
          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onClose}>关闭</button>
          </div>
        </>)}

        {tab === 'bot' && (<>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>电报机器人</div>
          <div style={{ fontSize: 13, color: 'var(--fg-dim)', marginBottom: 16, lineHeight: 1.7 }}>
            让机器人在你的群里提供搜索、AI 问答，并定时推送情报日报。Token 只保存在本机 <code>app/data/bot.json</code>。
          </div>
          <BotSettings />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn ghost" onClick={onClose}>关闭</button>
          </div>
        </>)}

        {tab === 'data' && (<>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>数据备份</div>
          <div style={{ fontSize: 13, color: 'var(--fg-dim)', marginBottom: 16, lineHeight: 1.7 }}>
            把整个情报库和配置打包留档，随时可以退回。误删了抓来的数据、想换电脑、升级前留底，都用得上。
          </div>
          <div className="divider" style={{ margin: '22px 0 16px' }} />
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>语义检索（向量索引）</div>
          <SemanticPanel />
          <div className="divider" style={{ margin: '22px 0 16px' }} />
          <AiClassifyPanel />
          <div className="divider" style={{ margin: '22px 0 16px' }} />
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>数据备份</div>
          <BackupPanel />
        </>)}
      </div>
    </div>
  );
}
