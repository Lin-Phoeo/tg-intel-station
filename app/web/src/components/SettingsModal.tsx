import { useEffect, useState } from 'react';
import { getSettings, saveSettings, testSettings } from '../api';
import { ModelPicker } from './ModelPicker';
import { BotSettings } from './BotSettings';
import { BackupPanel } from './BackupPanel';
import { SemanticPanel } from './SemanticPanel';

type Profile = { id: string; name: string; baseUrl: string; model: string; apiKey?: string; hasKey?: boolean; keyHint?: string; headers?: string; apiFormat?: string; modelsUrl?: string };
const blank = (): Profile => ({ id: 'p' + Date.now().toString(36), name: '新服务商', baseUrl: '', model: '', apiKey: '', headers: '', apiFormat: 'openai', modelsUrl: '' });

export function SettingsModal({ open, onClose, onActiveChange, initialTab }: { open: boolean; onClose: () => void; onActiveChange?: (name: string) => void; initialTab?: 'ai' | 'bot' }) {
  const [presets, setPresets] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState('');
  const [temp, setTemp] = useState(0.3);
  const [topK, setTopK] = useState(14);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'ai' | 'bot' | 'data'>(() => (initialTab || (new URLSearchParams(window.location.search).get('tab') === 'bot' ? 'bot' : 'ai')));
  useEffect(() => { if (open && initialTab) setTab(initialTab); }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    getSettings().then(r => {
      setPresets(r.presets || []);
      setProfiles((r.settings.profiles || []).map((p: any) => ({ ...p })));
      setActiveId(r.settings.activeId);
      setTemp(r.settings.temperature);
      setTopK(r.settings.topK);
      setEditing(null);
      setMsg(null);
    });
  }, [open]);

  if (!open) return null;
  const active = profiles.find(p => p.id === activeId) || profiles[0] || null;

  function addFromPreset(pid: string) {
    const pre = presets.find(x => x.id === pid);
    const p: Profile = { id: 'p' + Date.now().toString(36), name: (pre && pre.label) || '自定义中转', baseUrl: (pre && pre.baseUrl) || '', model: (pre && pre.model) || '', apiKey: '', headers: '', apiFormat: (pre && pre.apiFormat) || 'openai', modelsUrl: '' };
    setProfiles(prev => prev.concat([p]));
    setEditing(p.id);
    setMsg(null);
  }
  const upd = (id: string, k: string, v: any) => setProfiles(prev => prev.map(p => p.id === id ? { ...p, [k]: v } : p));
  const del = (id: string) => { setProfiles(prev => prev.filter(p => p.id !== id)); if (activeId === id) setActiveId(profiles.filter(p => p.id !== id)[0]?.id || ''); };

  async function persist(silent?: boolean) {
    setBusy(true);
    const r = await saveSettings({ profiles, activeId, temperature: temp, topK: topK });
    setProfiles((r.settings.profiles || []).map((p: any) => ({ ...p })));
    setActiveId(r.settings.activeId);
    setBusy(false);
    if (onActiveChange) onActiveChange(r.settings.activeId);
    if (!silent) setMsg({ kind: 'ok', text: '已保存，当前使用：' + ((profiles.find(p => p.id === activeId) || {}).name || '-') });
  }

  async function activate(id: string) {
    setActiveId(id);
    setBusy(true);
    await saveSettings({ activeId: id });
    setBusy(false);
    if (onActiveChange) onActiveChange(id);
    setMsg({ kind: 'ok', text: '已切换到：' + ((profiles.find(p => p.id === id) || {}).name || '-') });
  }

  async function doTest() {
    if (!active) return;
    setBusy(true);
    setMsg({ kind: 'info', text: '正在测试 ' + active.name + ' …' });
    const payload: any = { baseUrl: active.baseUrl, model: active.model, headers: active.headers };
    if (active.apiKey) payload.apiKey = active.apiKey;
    const r = await testSettings(payload);
    setBusy(false);
    if (r.ok) setMsg({ kind: 'ok', text: '连接成功：' + active.name + ' / ' + (r.result && r.result.model) });
    else setMsg({ kind: 'err', text: '失败：' + (r.error || '未知错误') });
  }

  const box: any = { width: '100%', margin: '4px 0 10px' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 680, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', background: 'var(--bg-1)', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <button className="btn" style={{ background: tab === 'ai' ? 'var(--bg-3)' : 'transparent', borderColor: tab === 'ai' ? 'var(--accent)' : 'var(--border)' }} onClick={() => setTab('ai')}>AI 模型</button>
          <button className="btn" style={{ background: tab === 'data' ? 'var(--bg-3)' : 'transparent', borderColor: tab === 'data' ? 'var(--accent)' : 'var(--border)', color: tab === 'data' ? 'var(--fg)' : 'var(--fg-dim)' }} onClick={() => setTab('data')}>数据备份</button>
          <button className="btn" style={{ background: tab === 'bot' ? 'var(--bg-3)' : 'transparent', borderColor: tab === 'bot' ? 'var(--accent)' : 'var(--border)' }} onClick={() => setTab('bot')}>🤖 电报机器人</button>
        </div>

        {tab === 'ai' && (<>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>AI 模型设置</div>
        <div style={{ fontSize: 13, color: 'var(--fg-dim)', marginBottom: 18, lineHeight: 1.7 }}>
          可保存多个服务商并随时切换（类似 ccswitch）。支持任何 OpenAI 兼容接口，包括自建/第三方中转站。密钥只保存在本机 <code>app/data/settings.json</code>。
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--fg-mute)' }}>添加服务商：</span>
          <select defaultValue="" onChange={e => { if (e.target.value) { addFromPreset(e.target.value); e.target.value = ''; } }} style={{ minWidth: 220 }}>
            <option value="">— 选择预设 —</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button className="btn" onClick={() => { const p = blank(); setProfiles(prev => prev.concat([p])); setEditing(p.id); }}>+ 空白自定义</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {profiles.map(p => {
            const on = p.id === activeId;
            return (
              <div key={p.id} className="card" style={{ padding: '10px 13px', borderColor: on ? 'var(--accent)' : 'var(--border-soft)', background: on ? 'var(--accent-soft)' : 'var(--bg-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <input type="radio" checked={on} onChange={() => activate(p.id)} style={{ accentColor: 'var(--accent)' }} />
                  <span style={{ fontWeight: 620 }}>{p.name}</span>
                  {p.hasKey ? <span className="badge" style={{ background: 'color-mix(in srgb, var(--green) 16%, transparent)', color: 'var(--green)' }}>已配置</span> : <span className="badge" style={{ background: 'var(--bg-3)', color: 'var(--fg-mute)' }}>未配置密钥</span>}
                  <span style={{ fontSize: 12, color: 'var(--fg-mute)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.model ? p.model + '  ·  ' : ''}{(p.baseUrl || '（未填写 Base URL）')}</span>
                  <button className="btn ghost" style={{ padding: '2px 9px', fontSize: 12 }} onClick={() => setEditing(editing === p.id ? null : p.id)}>{editing === p.id ? '收起' : '编辑'}</button>
                  <button className="btn ghost" style={{ padding: '2px 9px', fontSize: 12, color: 'var(--rose)' }} onClick={() => del(p.id)}>删除</button>
                </div>

                {editing === p.id && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
                    <label style={{ fontSize: 12, color: 'var(--fg-mute)' }}>名称</label>
                    <input value={p.name} onChange={e => upd(p.id, 'name', e.target.value)} style={box} />
                    <label style={{ fontSize: 12, color: 'var(--fg-mute)' }}>Base URL（OpenAI 兼容，通常以 /v1 结尾）</label>
                    <input value={p.baseUrl} onChange={e => upd(p.id, 'baseUrl', e.target.value)} placeholder="https://api.deepseek.com/v1 或 https://你的中转站/v1" style={box} />
                    <label style={{ fontSize: 12, color: 'var(--fg-mute)' }}>模型名 <span style={{ opacity: .8 }}>· 点「获取模型」可从服务商拉取列表后选择</span></label>
                    <div style={{ margin: '4px 0 10px' }}>
                      <ModelPicker
                        value={p.model}
                        onChange={v => upd(p.id, 'model', v)}
                        baseUrl={p.baseUrl}
                        apiKey={p.apiKey}
                        apiFormat={p.apiFormat || 'openai'}
                        modelsUrl={p.modelsUrl || ''}
                        headers={p.headers || ''}
                        hasKey={p.hasKey}
                      />
                    </div>
                    <label style={{ fontSize: 12, color: 'var(--fg-mute)' }}>模型接口地址（可选，自动识别失败时填）</label>
                    <input value={p.modelsUrl || ''} onChange={e => upd(p.id, 'modelsUrl', e.target.value)} placeholder="https://xxx.com/v1/models" style={box} />
                    <label style={{ fontSize: 12, color: 'var(--fg-mute)' }}>鉴权方式</label>
                    <select value={p.apiFormat || 'openai'} onChange={e => upd(p.id, 'apiFormat', e.target.value)} style={box}>
                      <option value="openai">Authorization: Bearer（绝大多数）</option>
                      <option value="anthropic">x-api-key（Anthropic 风格中转）</option>
                      <option value="google">x-goog-api-key（Google 风格）</option>
                    </select>
                    <label style={{ fontSize: 12, color: 'var(--fg-mute)' }}>API Key {p.hasKey && <span style={{ color: 'var(--green)' }}>· 已保存 {p.keyHint}（留空则不修改）</span>}</label>
                    <input type="password" value={p.apiKey || ''} onChange={e => upd(p.id, 'apiKey', e.target.value)} placeholder={p.hasKey ? '留空保持不变' : 'sk-...'} style={box} />
                    <label style={{ fontSize: 12, color: 'var(--fg-mute)' }}>自定义请求头（可选，JSON，用于需要额外头的聚合站/中转）</label>
                    <input value={p.headers || ''} onChange={e => upd(p.id, 'headers', e.target.value)} placeholder='{"HTTP-Referer":"https://x.com"}' style={box} />
                  </div>
                )}
              </div>
            );
          })}
          {profiles.length === 0 && <div style={{ color: 'var(--fg-mute)', fontSize: 13 }}>还没有服务商，从上面选一个预设添加。</div>}
        </div>

        <div style={{ display: 'flex', gap: 18, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12.5, color: 'var(--fg-mute)' }}>温度 {temp}</label>
            <input type="range" min={0} max={1} step={0.1} value={temp} onChange={e => setTemp(Number(e.target.value))} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12.5, color: 'var(--fg-mute)' }}>每次检索条数 {topK}</label>
            <input type="range" min={4} max={30} step={2} value={topK} onChange={e => setTopK(Number(e.target.value))} style={{ width: '100%' }} />
          </div>
        </div>

        {msg && (
          <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 9, fontSize: 13, background: msg.kind === 'err' ? 'color-mix(in srgb, var(--rose) 13%, transparent)' : msg.kind === 'ok' ? 'color-mix(in srgb, var(--green) 13%, transparent)' : 'var(--bg-3)', color: msg.kind === 'err' ? 'var(--rose)' : msg.kind === 'ok' ? 'var(--green)' : 'var(--fg-dim)' }}>{msg.text}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={doTest} disabled={busy || !active}>测试当前服务商</button>
          <button className="btn primary" onClick={() => persist()} disabled={busy}>保存全部</button>
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
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>数据备份</div>
          <BackupPanel />
        </>)}
      </div>
    </div>
  );
}
