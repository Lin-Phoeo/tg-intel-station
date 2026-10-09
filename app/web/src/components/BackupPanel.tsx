import { useEffect, useState } from 'react';
import { listBackups, createBackup, deleteBackup, restoreBackup } from '../api';

// 备份管理：数据库用 VACUUM INTO 生成一致快照，配置一并打包。
export function BackupPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [label, setLabel] = useState('');

  async function refresh() {
    try { const r = await listBackups(); setItems(r.items || []); setDir(r.dir || ''); } catch (e) {}
  }
  useEffect(() => { refresh(); }, []);

  async function make() {
    setBusy('create'); setMsg('正在备份…（1.5GB 的库大约需要十几秒）');
    try {
      const r = await createBackup(label);
      setMsg(r.ok ? ('备份完成：' + r.backup.id + '（' + r.backup.dbMB + ' MB）') : ('失败：' + r.error));
      setLabel('');
      await refresh();
    } catch (e) { setMsg('失败：' + String(e)); }
    setBusy('');
  }

  async function restore(id: string) {
    if (!window.confirm('确定用这个备份覆盖当前数据吗？\n当前数据会被替换，服务将自动重启。')) return;
    setBusy('restore'); setMsg('正在恢复…');
    try {
      const r = await restoreBackup(id);
      setMsg(r.ok || r.restarting ? '已恢复，服务正在用新数据重启，请稍候刷新页面。' : ('失败：' + r.error));
    } catch (e) { setMsg('页面断开属正常现象——服务正在重启。'); }
    setBusy('');
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--fg-dim)', lineHeight: 1.8, marginBottom: 14 }}>
        备份使用 SQLite 的 <code>VACUUM INTO</code> 生成<b>一致快照</b>，不受正在写入的数据影响。<br />
        备份包含：<b>数据库 + AI 配置 + 机器人 Token</b>。恢复后服务会自动重启。
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="备注（可空），例如：扩容前"
          style={{ flex: '1 1 220px', padding: '8px 12px', fontSize: 13.5 }} />
        <button className="btn primary" onClick={make} disabled={!!busy}>{busy === 'create' ? '备份中…' : '立即备份'}</button>
      </div>

      {msg && <div style={{ marginBottom: 14, padding: '9px 12px', borderRadius: 9, fontSize: 13, background: 'var(--bg-3)', color: 'var(--fg-dim)', lineHeight: 1.7 }}>{msg}</div>}

      {dir && <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', marginBottom: 8 }}>{'备份目录：' + dir}</div>}

      {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--fg-mute)', padding: '10px 0' }}>还没有备份。</div>}

      {items.map(b => (
        <div key={b.id} className="card" style={{ padding: '11px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{b.id}{b.label ? ' · ' + b.label : ''}</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', marginTop: 2 }}>
              {b.dbMB + ' MB · ' + Number(b.posts).toLocaleString() + ' 条 · 含配置 ' + b.configs.length + ' 项'}
            </div>
          </div>
          <button className="btn" style={{ padding: '3px 12px', fontSize: 12.5 }} onClick={() => restore(b.id)} disabled={!!busy}>恢复</button>
          <button className="btn ghost" style={{ padding: '3px 10px', fontSize: 12.5, color: 'var(--rose)' }}
            onClick={async () => { if (!window.confirm('删除这个备份？')) return; const r = await deleteBackup(b.id); setItems(r.items || []); }}>删除</button>
        </div>
      ))}
    </div>
  );
}
