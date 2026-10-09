import { useEffect, useRef, useState } from 'react';
import { getSettings, saveSettings, testSettings, detectSettings } from '../api';
import { ModelPicker } from './ModelPicker';
import {
  ArrowLeft, Check, Plus, Trash2, Pencil, Zap, Download, Upload, Loader2, AlertCircle, KeyRound, Radar,
} from 'lucide-react';

type Profile = {
  id: string; name: string; baseUrl: string; model: string;
  apiKey?: string; hasKey?: boolean; keyHint?: string;
  headers?: string; apiFormat?: string; modelsUrl?: string;
  resolvedUrl?: string; resolvedFormat?: string;
};
type Health = { state: 'idle' | 'testing' | 'ok' | 'fail'; ms?: number; error?: string };

const blank = (): Profile => ({
  id: 'p' + Date.now().toString(36), name: '新服务商', baseUrl: '', model: '',
  apiKey: '', headers: '', apiFormat: 'openai', modelsUrl: '',
});

// 配置界面按「列表 → 编辑」两态组织，而不是把表单内联展开在列表里。
// 内联展开会把列表撑得很长、点一下整页跳动，多个服务商时很难扫。
export function ModelSettings({ onActiveChange }: { onActiveChange?: (id: string) => void }) {
  const [presets, setPresets] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState('');
  const [temp, setTemp] = useState(0.3);
  const [topK, setTopK] = useState(14);
  const [view, setView] = useState<'list' | 'edit'>('list');
  const [editing, setEditing] = useState<Profile | null>(null);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSettings().then(r => {
      setPresets(r.presets || []);
      setProfiles((r.settings.profiles || []).map((p: any) => ({ ...p })));
      setActiveId(r.settings.activeId);
      setTemp(r.settings.temperature);
      setTopK(r.settings.topK);
    });
  }, []);

  const setHealthFor = (id: string, h: Health) => setHealth(prev => ({ ...prev, [id]: h }));

  async function persist(next: Profile[], nextActive: string, opts?: { t?: number; k?: number; silent?: boolean }) {
    const r = await saveSettings({
      profiles: next,
      activeId: nextActive,
      temperature: opts && opts.t != null ? opts.t : temp,
      topK: opts && opts.k != null ? opts.k : topK,
    });
    setProfiles((r.settings.profiles || []).map((p: any) => ({ ...p })));
    setActiveId(r.settings.activeId);
    if (onActiveChange) onActiveChange(r.settings.activeId);
  }

  async function activate(p: Profile) {
    if (p.id === activeId) return;
    setActiveId(p.id);
    await saveSettings({ activeId: p.id });
    if (onActiveChange) onActiveChange(p.id);
    setMsg({ kind: 'ok', text: '已切换到 ' + p.name });
  }

  // 测速：真实的 chat/completions 调用，同时验地址、密钥、模型名
  async function testOne(p: Profile) {
    const localKey = editing && editing.id === p.id ? editing.apiKey : p.apiKey;
    if (!p.baseUrl) { setHealthFor(p.id, { state: 'fail', error: '未填 Base URL' }); return; }
    if (!p.model) { setHealthFor(p.id, { state: 'fail', error: '未填模型名' }); return; }
    if (!p.hasKey && !localKey) { setHealthFor(p.id, { state: 'fail', error: '未配置密钥' }); return; }
    setHealthFor(p.id, { state: 'testing' });
    const payload: any = { baseUrl: p.baseUrl, model: p.model, headers: p.headers, apiFormat: p.apiFormat || 'openai' };
    if (localKey) payload.apiKey = localKey;
    const r = await testSettings(payload);
    if (r.ok) setHealthFor(p.id, { state: 'ok', ms: (r.result && r.result.ms) || 0 });
    else setHealthFor(p.id, { state: 'fail', error: (r.error || '未知错误').slice(0, 80) });
    return r.ok;
  }

  // 自动探测接口地址：中转站地址形态五花八门（根域名 / 要补 /v1 / 带 /api/claudecode），
  // 与其让用户猜，不如逐个探一遍，找到能用的那个并记住。
  async function autoDetect(p: Profile) {
    if (!p.baseUrl) { setMsg({ kind: 'err', text: '请先填写 Base URL' }); return; }
    if (!p.model) { setMsg({ kind: 'err', text: '请先填写模型名' }); return; }
    setHealthFor(p.id, { state: 'testing' });
    setMsg({ kind: 'info', text: '正在逐个探测可用地址…' });
    const payload: any = { baseUrl: p.baseUrl, model: p.model, apiFormat: p.apiFormat || 'openai', headers: p.headers };
    if (p.apiKey) payload.apiKey = p.apiKey;
    const r = await detectSettings(payload);
    if (r.ok) {
      setHealthFor(p.id, { state: 'ok', ms: 0 });
      setMsg({ kind: 'ok', text: '找到可用地址：' + r.url + '（' + (r.format === 'anthropic' ? 'Anthropic' : 'OpenAI') + ' 协议），已记住' });
    } else {
      setHealthFor(p.id, { state: 'fail', error: '未找到可用地址' });
      setMsg({ kind: 'err', text: (r.hint || '未找到可用地址') + '  试过：' + (r.tried || []).slice(0, 4).join('；') });
    }
  }

  async function testAll() {
    if (!profiles.length) { setMsg({ kind: 'info', text: '还没有服务商' }); return; }
    setTestingAll(true);
    // 全部跑一遍（testOne 内部会先检查必要条件）。
    // 之前只测「配好密钥的」，结果一个都没测时界面只显示「已测速 0 个」，
    // 看起来像功能坏了 —— 现在每个都给出明确原因。
    await Promise.all(profiles.map(p => testOne(p)));
    setTestingAll(false);
    setMsg({ kind: 'ok', text: '已检查 ' + profiles.length + ' 个服务商' });
  }

  function addFromPreset(pid: string) {
    const pre = presets.find(x => x.id === pid);
    if (!pre) return;
    const p: Profile = {
      ...blank(),
      name: pre.label || '自定义中转',
      baseUrl: pre.baseUrl || '',
      model: pre.model || '',
    };
    setEditing(p); setView('edit'); setMsg(null);
  }

  function startEdit(p: Profile) { setEditing({ ...p }); setView('edit'); setMsg(null); }

  async function saveEdit() {
    if (!editing) return;
    const exists = profiles.some(p => p.id === editing.id);
    const next = exists ? profiles.map(p => (p.id === editing.id ? editing : p)) : profiles.concat([editing]);
    const nextActive = activeId || editing.id;
    await persist(next, nextActive);
    setEditing(null); setView('list');
    setMsg({ kind: 'ok', text: '已保存「' + editing.name + '」' });
  }

  async function remove(p: Profile) {
    const next = profiles.filter(x => x.id !== p.id);
    const nextActive = activeId === p.id ? (next[0] ? next[0].id : '') : activeId;
    await persist(next, nextActive);
    setMsg({ kind: 'info', text: '已删除「' + p.name + '」' });
  }

  function exportCfg() {
    const blob = new Blob([JSON.stringify({ profiles, activeId, temperature: temp, topK: topK }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ai-profiles-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importCfg(file: File) {
    try {
      const j = JSON.parse(await file.text());
      if (!Array.isArray(j.profiles)) { setMsg({ kind: 'err', text: '文件里没有 profiles 数组' }); return; }
      const clean = j.profiles.map((p: any) => ({ ...blank(), ...p, apiKey: p.apiKey || '' }));
      await persist(clean, j.activeId || (clean[0] && clean[0].id) || '');
      setMsg({ kind: 'ok', text: '已导入 ' + clean.length + ' 个服务商' });
    } catch (e) { setMsg({ kind: 'err', text: '导入失败：文件不是合法 JSON' }); }
  }

  const box: any = { width: '100%', margin: '4px 0 12px' };
  const lbl: any = { fontSize: 'var(--fs-meta)', color: 'var(--fg-mute)' };

  // ---------- 状态徽标 ----------
  function StatusBadge({ id }: { id: string }) {
    const h = health[id];
    if (!h || h.state === 'idle') return <span className="mstat idle">未测速</span>;
    if (h.state === 'testing') return <span className="mstat idle"><Loader2 size={11} className="spin" />测速中</span>;
    if (h.state === 'ok') return <span className="mstat ok"><Check size={11} strokeWidth={3} />可用 {h.ms}ms</span>;
    return <span className="mstat fail" title={h.error}><AlertCircle size={11} />{h.error}</span>;
  }

  // ---------- 编辑视图 ----------
  if (view === 'edit' && editing) {
    const p = editing;
    const upd = (k: string, v: any) => setEditing({ ...p, [k]: v });
    const exists = profiles.some(x => x.id === p.id);
    return (
      <div>
        <button className="btn ghost" style={{ padding: '3px 8px', marginBottom: 12 }} onClick={() => { setEditing(null); setView('list'); }}>
          <ArrowLeft size={14} strokeWidth={1.75} />返回列表
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{exists ? '编辑' : '添加'}服务商</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-mute)' }}>密钥只保存在本机</span>
        </div>

        <label style={lbl}>名称</label>
        <input value={p.name} onChange={e => upd('name', e.target.value)} placeholder="给自己看的名字" style={box} />

        <label style={lbl}>Base URL<span style={{ opacity: .75 }}> · OpenAI 兼容，通常以 /v1 结尾</span></label>
        <input value={p.baseUrl} onChange={e => upd('baseUrl', e.target.value)} placeholder="https://api.deepseek.com/v1" style={box} />

        <label style={lbl}>API Key</label>
        <div style={{ position: 'relative', margin: '4px 0 12px' }}>
          <input type="password" value={p.apiKey || ''} onChange={e => upd('apiKey', e.target.value)}
            placeholder={p.hasKey ? '已保存（留空保持不变）' : 'sk-…'} style={{ ...box, paddingLeft: 32, margin: 0 }} autoComplete="off" spellCheck={false} />
          <KeyRound size={13} strokeWidth={1.75} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--fg-mute)', pointerEvents: 'none' }} />
        </div>
        {p.hasKey && <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--green)', marginTop: -8, marginBottom: 10 }}>已保存 {p.keyHint || ''}</div>}

        <label style={lbl}>模型名<span style={{ opacity: .75 }}> · 可点「获取模型」从服务商拉列表后选择</span></label>
        <div style={{ margin: '4px 0 12px' }}>
          <ModelPicker value={p.model} onChange={v => upd('model', v)} baseUrl={p.baseUrl}
            apiKey={p.apiKey} apiFormat={p.apiFormat || 'openai'} modelsUrl={p.modelsUrl || ''}
            headers={p.headers || ''} hasKey={p.hasKey} />
        </div>

        <details style={{ marginBottom: 14 }}>
          <summary style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-dim)', cursor: 'pointer', padding: '4px 0' }}>高级选项</summary>
          <div style={{ paddingTop: 10 }}>
            <label style={lbl}>协议与鉴权<span style={{ opacity: .75 }}> · 选错了也没关系，会自动尝试另一种</span></label>
            <select value={p.apiFormat || 'openai'} onChange={e => upd('apiFormat', e.target.value)} style={box}>
              <option value="openai">OpenAI 兼容（Bearer + /chat/completions）</option>
              <option value="anthropic">Anthropic（x-api-key + /messages）· Claude 系中转站</option>
              <option value="google">Google（x-goog-api-key）</option>
            </select>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)', marginTop: -6, marginBottom: 12, lineHeight: 1.6 }}>
              很多 Claude 中转站只开 Anthropic 端点，用 OpenAI 端点打过去会被拦成 403 网页。
              这里选的是**首选**，失败会自动换另一种协议重试，所以不确定的话保持默认即可。
            </div>
            <label style={lbl}>模型接口地址<span style={{ opacity: .75 }}> · 可选，自动识别失败时填</span></label>
            <input value={p.modelsUrl || ''} onChange={e => upd('modelsUrl', e.target.value)} placeholder="https://xxx.com/v1/models" style={box} spellCheck={false} />
            <label style={lbl}>自定义请求头<span style={{ opacity: .75 }}> · 可选，JSON</span></label>
            <input value={p.headers || ''} onChange={e => upd('headers', e.target.value)} placeholder='{"HTTP-Referer":"https://x.com"}' style={box} spellCheck={false} />
          </div>
        </details>

        {msg && <div className={'amsg ' + msg.kind}>{msg.text}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn primary" onClick={saveEdit}>保存</button>
          {(() => {
            const h = health[p.id];
            return (
              <button className="btn" disabled={h && h.state === 'testing'}
                onClick={async () => { const ok = await testOne({ ...p, hasKey: p.hasKey || !!p.apiKey }); if (ok) setMsg({ kind: 'ok', text: '连接成功' }); }}>
                <Zap size={13} strokeWidth={1.75} />测试连接
              </button>
            );
          })()}
          <button className="btn" disabled={!!(health[p.id] && health[p.id].state === 'testing')} onClick={() => autoDetect(p)} title="逐个探测可用的接口地址与协议">
            <Radar size={13} strokeWidth={1.75} />自动检测地址
          </button>
          <span style={{ flex: 1 }} />
          {exists && <button className="btn ghost" style={{ color: 'var(--rose)' }} onClick={() => { remove(p); setEditing(null); setView('list'); }}><Trash2 size={13} strokeWidth={1.75} />删除</button>}
        </div>
        {health[p.id] && <div style={{ marginTop: 10 }}><StatusBadge id={p.id} /></div>}
        {p.resolvedUrl && (
          <div style={{ marginTop: 10, fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)' }}>
            已识别地址：<code>{p.resolvedUrl}</code>
          </div>
        )}
      </div>
    );
  }

  // ---------- 列表视图 ----------
  const usable = profiles.filter(p => health[p.id] && health[p.id].state === 'ok');
  const fastest = usable.length ? usable.reduce((a, b) => (health[a.id].ms || 1e9) <= (health[b.id].ms || 1e9) ? a : b) : null;

  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>AI 模型设置</div>
      <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-dim)', marginBottom: 16, lineHeight: 1.7 }}>
        可保存多个服务商，点卡片即切换。支持任何 OpenAI 兼容接口，含自建/第三方中转站。
      </div>

      {/* 快速添加 */}
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)', letterSpacing: '.06em', marginBottom: 7 }}>快速添加</div>
      <div className="preset-grid">
        {presets.filter(x => x.baseUrl).map(x => (
          <button key={x.id} className="preset-card" onClick={() => addFromPreset(x.id)} title={x.note || x.baseUrl}>
            <span className="pc-name">{x.label}</span>
            {x.note ? <span className="pc-note">{x.note}</span> : null}
          </button>
        ))}
        <button className="preset-card add" onClick={() => { setEditing(blank()); setView('edit'); }}>
          <Plus size={13} strokeWidth={2} /><span className="pc-name">自定义</span>
        </button>
      </div>

      {/* 服务商列表 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 9px' }}>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-mute)', letterSpacing: '.06em' }}>服务商 {profiles.length ? '（' + profiles.length + '）' : ''}</span>
        <span style={{ flex: 1 }} />
        {fastest && <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--green)' }}>最快：{fastest.name} {health[fastest.id].ms}ms</span>}
        {profiles.length > 0 && (
          <button className="btn ghost" style={{ padding: '2px 9px', fontSize: 'var(--fs-meta)' }} onClick={testAll} disabled={testingAll}>
            {testingAll ? <Loader2 size={12} className="spin" /> : <Zap size={12} strokeWidth={1.75} />}全部测速
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
        {profiles.map(p => {
          const on = p.id === activeId;
          return (
            <div key={p.id} className={'mprov' + (on ? ' on' : '')} onClick={() => activate(p)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') activate(p); }}>
              <div className="mp-radio" aria-label={on ? '当前使用' : '点击切换'}>{on ? <Check size={11} strokeWidth={3} /> : null}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span className="mp-name">{p.name}</span>
                  {on && <span className="mp-cur">当前</span>}
                  {!p.hasKey && !p.apiKey && <span className="mp-nokey">未配密钥</span>}
                  {p.resolvedUrl && <span className="mp-ok-url" title={'已自动识别：' + p.resolvedUrl}>地址已识别</span>}
                  <StatusBadge id={p.id} />
                </div>
                <div className="mp-sub">{(p.model || '未填模型') + ' · ' + (p.baseUrl ? p.baseUrl.replace(/^https?:\/\//, '') : '未填地址')}</div>
              </div>
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button className="btn ghost iconbtn" title="自动检测地址" onClick={() => autoDetect(p)}><Radar size={13} strokeWidth={1.75} /></button>
                <button className="btn ghost iconbtn" title="测速" onClick={() => testOne(p)}><Zap size={13} strokeWidth={1.75} /></button>
                <button className="btn ghost iconbtn" title="编辑" onClick={() => startEdit(p)}><Pencil size={13} strokeWidth={1.75} /></button>
                <button className="btn ghost iconbtn" title="删除" style={{ color: 'var(--rose)' }} onClick={() => remove(p)}><Trash2 size={13} strokeWidth={1.75} /></button>
              </div>
            </div>
          );
        })}
        {profiles.length === 0 && <div style={{ color: 'var(--fg-mute)', fontSize: 'var(--fs-text)', padding: '14px 0' }}>还没有服务商，点上面的预设卡片快速添加。</div>}
      </div>

      {/* 生成参数 */}
      <div style={{ display: 'flex', gap: 18, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>温度 {temp}</label>
          <input type="range" min={0} max={1} step={0.1} value={temp}
            onChange={e => { const v = Number(e.target.value); setTemp(v); }}
            onMouseUp={() => persist(profiles, activeId, { t: temp, silent: true })} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>每次检索条数 {topK}</label>
          <input type="range" min={4} max={30} step={2} value={topK}
            onChange={e => { const v = Number(e.target.value); setTopK(v); }}
            onMouseUp={() => persist(profiles, activeId, { k: topK, silent: true })} style={{ width: '100%' }} />
        </div>
      </div>

      {msg && <div className={'amsg ' + msg.kind}>{msg.text}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <button className="btn ghost" style={{ padding: '4px 10px', fontSize: 'var(--fs-meta)' }} onClick={exportCfg}><Download size={13} strokeWidth={1.75} />导出配置</button>
        <button className="btn ghost" style={{ padding: '4px 10px', fontSize: 'var(--fs-meta)' }} onClick={() => fileRef.current && fileRef.current.click()}><Upload size={13} strokeWidth={1.75} />导入配置</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files && e.target.files[0]; if (f) importCfg(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}
