import { useEffect, useRef, useState } from 'react';
import { semanticStatus, buildSemanticIndex, clearSemanticIndex, getSettings, saveSettings } from '../api';

// 向量服务预设。全部接口地址都实测过可达（401 = 地址正确、只差有效 Key）。
// 免费额度以服务商页面为准 —— 我没法在没有 Key 的情况下验证配额。
const PRESETS = [
  // 完全免费 / 不花钱
  { label: '本机 Ollama（完全免费·不联网）', baseUrl: 'http://127.0.0.1:11434/v1', model: 'bge-m3', free: true },
  { label: '模力方舟 Gitee AI（社区实测无频率限制）', baseUrl: 'https://ai.gitee.com/v1', model: 'Qwen3-Embedding-8B', free: true },
  { label: 'Google Gemini（官方免费档）', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'text-embedding-004', free: true },
  { label: '硅基流动 BAAI/bge-m3', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', free: true },
  { label: '魔搭 ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1', model: 'Qwen/Qwen3-Embedding-8B', free: true },
  { label: 'Jina AI（有免费额度）', baseUrl: 'https://api.jina.ai/v1', model: 'jina-embeddings-v3', free: true },
  // 有免费额度、用超了按量付费
  { label: '智谱 GLM embedding-3', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3' },
  { label: '阿里通义 text-embedding-v3', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v3' },
  { label: '无问芯穹 bge-m3', baseUrl: 'https://cloud.infini-ai.com/maas/v1', model: 'bge-m3' },
  { label: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-embedding' },
  { label: 'OpenAI text-embedding-3-small', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
];

// 向量索引管理：语义检索的前提。只给价值分达标的帖子建索引。
export function SemanticPanel() {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [cfg, setCfg] = useState<any>(null);
  const [embedKey, setEmbedKey] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<any>(null);

  async function refresh() {
    try { setSt(await semanticStatus()); } catch (e) {}
    try { const s = await getSettings(); setCfg(s.settings || {}); } catch (e) {}
  }
  useEffect(() => { refresh(); return () => { if (timer.current) clearInterval(timer.current); }; }, []);

  async function saveCfg(patch: any) {
    setSaving(true);
    try {
      const r = await saveSettings(patch);
      setCfg(r.settings || {});
      setMsg('已保存向量配置');
    } catch (e) { setMsg('保存失败：' + String(e)); }
    setSaving(false);
  }

  async function build() {
    setBusy(true); setMsg('正在分批向量化…过程可能要几分钟到几十分钟，取决于条数。');
    const r = await buildSemanticIndex({ minValue: 4, batch: 32 });
    if (!r.ok) { setBusy(false); setMsg(r.error || '启动失败'); return; }
    timer.current = setInterval(async () => {
      const s = await semanticStatus();
      setSt(s);
      if (!s.running) {
        clearInterval(timer.current); timer.current = null; setBusy(false);
        setMsg(s.error ? ('中断：' + s.error) : ('完成：本次新增 ' + (s.done || 0) + ' 条，失败 ' + (s.failed || 0) + ' 条'));
      }
    }, 2000);
  }

  const stats = (st && st.stats) || {};
  const pct = st && st.total ? Math.round((st.done / st.total) * 100) : 0;
  const embedBaseUrl = (cfg && cfg.embedBaseUrl) || '';
  const embedModel = (cfg && cfg.embedModel) || '';

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--fg-dim)', lineHeight: 1.8, marginBottom: 14 }}>
        开启后，搜索会按<b>意思</b>找，而不只是按字面匹配 —— 搜「怎么白嫖服务器」
        也能命中讲 VPS 优惠的帖子。<br />
        只给<b>价值分 ≥ 4</b> 的帖子建索引（约 13 万条），向量以 int8 存储，约 1KB/条。
      </div>

      <div className="card" style={{ padding: '13px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>向量服务</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', lineHeight: 1.75, marginBottom: 10 }}>
          可以和你聊天用的服务商<b>分开</b>。留空则跟随当前服务商。下面几个是社区里常见的（额度以服务商页面为准）：
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {PRESETS.map(pr => (
            <button key={pr.label} className="btn ghost"
              style={{ padding: '3px 10px', fontSize: 12, color: pr.free ? 'var(--green)' : 'var(--fg-dim)', borderColor: pr.free ? 'color-mix(in srgb, var(--green) 40%, transparent)' : 'var(--border)' }}
              onClick={() => saveCfg({ embedBaseUrl: pr.baseUrl, embedModel: pr.model })}
              title={pr.baseUrl + '  ->  ' + pr.model}>{pr.label}</button>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', marginBottom: 12 }}>
          绿框的是免费选项。这些接口地址我都实测过可达（返回 401 表示地址正确、只差有效 Key）；
          具体免费额度以服务商页面为准。
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={embedBaseUrl} onChange={e => setCfg(Object.assign({}, cfg, { embedBaseUrl: e.target.value }))}
            placeholder="向量接口地址，留空=跟随当前服务商" style={{ flex: '1 1 260px', padding: '7px 11px', fontSize: 13 }} />
          <input value={embedModel} onChange={e => setCfg(Object.assign({}, cfg, { embedModel: e.target.value }))}
            placeholder="向量模型，留空=自动尝试" style={{ width: 200, padding: '7px 11px', fontSize: 13 }} />
          <input value={embedKey} onChange={e => setEmbedKey(e.target.value)} type="password"
            placeholder={cfg && cfg.hasEmbedKey ? ('已保存 ' + cfg.embedKeyHint) : 'API Key（留空=用当前服务商的）'}
            style={{ flex: '1 1 220px', padding: '7px 11px', fontSize: 13 }} />
          <button className="btn" disabled={saving}
            onClick={() => saveCfg(embedKey ? { embedBaseUrl: embedBaseUrl, embedModel: embedModel, embedApiKey: embedKey } : { embedBaseUrl: embedBaseUrl, embedModel: embedModel })}
            >{saving ? '保存中…' : '保存'}</button>
          {embedKey && <button className="btn ghost" onClick={() => { saveCfg({ embedApiKey: '' }); setEmbedKey(''); }}>清除 Key</button>}
        </div>
      </div>

      <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
          <span>已建立向量：<b>{Number(stats.indexed || 0).toLocaleString()}</b> 条</span>
          <span>达标待建：<b>{Math.max(0, Number(stats.eligible || 0) - Number(stats.indexed || 0)).toLocaleString()}</b> 条</span>
          {stats.dim ? <span>维度：<b>{stats.dim}</b></span> : null}
          {stats.model ? <span>模型：<b>{stats.model}</b></span> : null}
        </div>
      </div>

      {st && st.running && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 5, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: 'var(--violet)', transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-mute)', marginTop: 6 }}>
            {'已处理 ' + (st.done || 0) + ' / ' + (st.total || 0) + ' 条' + (st.failed ? '（失败 ' + st.failed + '）' : '')}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn primary" onClick={build} disabled={busy}>{busy ? '向量化中…' : '建立 / 继续向量索引'}</button>
        <button className="btn ghost" onClick={async () => { if (!window.confirm('清空全部向量？语义检索会失效，直到重新建立。')) return; await clearSemanticIndex(); refresh(); setMsg('已清空'); }} disabled={busy}>清空索引</button>
      </div>

      {msg && <div style={{ padding: '9px 12px', borderRadius: 9, fontSize: 12.5, background: 'var(--bg-3)', color: 'var(--fg-dim)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{msg}</div>}
    </div>
  );
}
