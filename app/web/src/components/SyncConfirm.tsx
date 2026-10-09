import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { getSyncStatus, listSources } from '../api';

// 一键补齐的二次确认。
// 起因：同步是个会跑几分钟、会改变数据量的操作，之前点一下就直接开跑，
// 容易误触（实际发生过）。这里先说清楚要抓多少来源、上次抓了什么。
export function SyncConfirm({ open, by, onCancel, onConfirm }: {
  open: boolean; by: string; onCancel: () => void; onConfirm: () => void;
}) {
  const [st, setSt] = useState<any>(null);
  const [srcCount, setSrcCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    getSyncStatus().then(setSt).catch(() => {});
    // 来源数量要按「当前实际会抓的」来算。
    // 之前用的是上次同步记录里的数字（那次的快照），与本次不符会误导。
    listSources()
      .then(r => setSrcCount((r.sources || []).filter((s: any) => s.kind === 'channel' || s.kind === 'web').length))
      .catch(() => setSrcCount(null));
  }, [open]);

  if (!open) return null;

  const running = !!(st && st.running);
  const last = (st && st.lastSync) || null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onCancel}>
      <div className="card" style={{ width: 460, maxWidth: '100%', background: 'var(--bg-1)', padding: 22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
          <RefreshCw size={16} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>执行一键补齐？</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" style={{ padding: '3px 6px' }} onClick={onCancel} aria-label="关闭"><X size={14} strokeWidth={2} /></button>
        </div>

        {running ? (
          <div style={{ fontSize: 'var(--fs-text)', color: 'var(--amber)', lineHeight: 1.7, marginBottom: 16 }}>
            已经有一个同步在跑了（{st.done}/{st.total} 个来源）。重复触发不会更快，等它跑完即可。
          </div>
        ) : (
          <>
            <div style={{ fontSize: 'var(--fs-text)', color: 'var(--fg-dim)', lineHeight: 1.75, marginBottom: 14 }}>
              将按顺序增量抓取全部<strong style={{ color: 'var(--fg)' }}>频道与网页</strong>来源，
              把新帖子并入情报库。
            </div>
            <div className="sync-info">
              {srcCount != null && <div><span className="k">本次将抓取</span><span className="v">{srcCount} 个来源</span></div>}
              <div><span className="k">触发方式</span><span className="v">{by}</span></div>
              {last && <div><span className="k">上次同步</span><span className="v">{String(last.finishedAt || '').slice(0, 16).replace('T', ' ')} · 新增 {last.imported} 条</span></div>}
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)', lineHeight: 1.7, margin: '12px 0 18px' }}>
              同步是增量的，重复跑不会重复入库。抓取期间界面可以正常使用，
              进度显示在顶部横条上，随时能看出是谁触发的。
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel}>取消</button>
          {!running && <button className="btn primary" onClick={onConfirm}><RefreshCw size={13} strokeWidth={2} />开始抓取</button>}
        </div>
      </div>
    </div>
  );
}
