import { useEffect, useRef, useState } from 'react';
import { semanticStatus, buildSemanticIndex, clearSemanticIndex, getSettings, saveSettings } from '../api';

// 向量服务预设。接口地址都实测过可达（401 = 地址正确、只差有效 Key）。
// 标 free 的是服务商明示免费的模型（模力方舟清单，2026-10 核对）。
const EMBED_PRESETS = [
  { label: '模力方舟 · bge-m3（推荐·均衡）', baseUrl: 'https://ai.gitee.com/v1', model: 'bge-m3', note: '1024维 · 8K · 多语言' },
  { label: '模力方舟 · Qwen3-Embedding-0.6B（轻快）', baseUrl: 'https://ai.gitee.com/v1', model: 'Qwen3-Embedding-0.6B', note: '1024维 · 32K' },
  { label: '模力方舟 · Qwen3-Embedding-4B（更准·2.5倍存储）', baseUrl: 'https://ai.gitee.com/v1', model: 'Qwen3-Embedding-4B', note: '2560维 · 32K' },
  { label: '模力方舟 · bge-large-zh-v1.5（中文）', baseUrl: 'https://ai.gitee.com/v1', model: 'bge-large-zh-v1.5', note: '1024维 · 中文' },
  { label: '模力方舟 · bce-embedding-base_v1（有道中文）', baseUrl: 'https://ai.gitee.com/v1', model: 'bce-embedding-base_v1', note: '768维 · 中文' },
  { label: '本机 Ollama（完全免费·不联网）', baseUrl: 'http://127.0.0.1:11434/v1', model: 'bge-m3', note: '本地推理' },
  { label: 'Google Gemini text-embedding-004', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'text-embedding-004', note: '官方免费档' },
  { label: '硅基流动 BAAI/bge-m3', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', note: '社区长期推荐' },
  { label: 'Jina embeddings-v3', baseUrl: 'https://api.jina.ai/v1', model: 'jina-embeddings-v3', note: '有免费额度' },
  { label: '魔搭 ModelScope Qwen3-8B', baseUrl: 'https://api-inference.modelscope.cn/v1', model: 'Qwen/Qwen3-Embedding-8B', note: '4096维' },
  { label: '智谱 embedding-3', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3' },
  { label: '阿里通义 text-embedding-v3', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v3' },
];

// 重排模型预设。重排是提升准确率最有效的一环，且模力方舟这几个都免费。
const RERANK_PRESETS = [
  { label: '模力方舟 · bge-reranker-v2-m3（推荐）', baseUrl: 'https://ai.gitee.com/v1', model: 'bge-reranker-v2-m3' },
  { label: '模力方舟 · Qwen3-Reranker-4B', baseUrl: 'https://ai.gitee.com/v1', model: 'Qwen3-Reranker-4B' },
  { label: '模力方舟 · Qwen3-Reranker-0.6B（最快）', baseUrl: 'https://ai.gitee.com/v1', model: 'Qwen3-Reranker-0.6B' },
  { label: '模力方舟 · bge-reranker-large', baseUrl: 'https://ai.gitee.com/v1', model: 'bge-reranker-large' },
  { label: '硅基流动 bge-reranker-v2-m3', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-reranker-v2-m3' },
  { label: 'Jina Reranker v2', baseUrl: 'https://api.jina.ai/v1', model: 'jina-reranker-v2-base-multilingual' },
];

export function SemanticPanel() {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [cfg, setCfg] = useState<any>(null);
  const [embedKey, setEmbedKey] = useState('');
  const [rerankKey, setRerankKey] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<any>(null);

  async function refresh() {
    try { setSt(await semanticStatus()); } catch (e) {}
    try { const s = await getSettings(); setCfg(s.settings || {}); } catch (e) {}
  }
  useEffect(() => { refresh(); return () => { if (timer.current) clearInterval(timer.current); }; }, []);

  async function saveCfg(patch: any) {
    setSaving(true);
    try { const r = await saveSettings(patch); setCfg(r.settings || {}); setMsg('已保存'); }
    catch (e) { setMsg('保存失败：' + String(e)); }
    setSaving(false);
  }
  const setLocal = (k: string, v: any) => setCfg(Object.assign({}, cfg, { [k]: v }));

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
  const C = cfg || {};

  const btnStyle = (active: boolean) => ({
    padding: '3px 10px', fontSize: 12,
    color: active ? 'var(--green)' : 'var(--fg-dim)',
    borderColor: active ? 'color-mix(in srgb, var(--green) 55%, transparent)' : 'var(--border)',
  });

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--fg-dim)', lineHeight: 1.8, marginBottom: 14 }}>
        开启后，搜索会按<b>意思</b>找。只给<b>价值分 ≥ 4</b> 的帖子建索引（约 13 万条），
        向量以 int8 存储，约 1KB/条。
      </div>

      {/* ---- 向量服务 ---- */}
      <div className="card" style={{ padding: '13px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>向量服务</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', lineHeight: 1.75, marginBottom: 10 }}>
          可以和聊天用的服务商分开。点下面的按钮即可填好地址与模型（绿框=免费）：
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {EMBED_PRESETS.map(pr => (
            <button key={pr.label} className="btn ghost"
              style={btnStyle(C.embedBaseUrl === pr.baseUrl && C.embedModel === pr.model)}
              onClick={() => saveCfg({ embedBaseUrl: pr.baseUrl, embedModel: pr.model })}
              title={pr.baseUrl + '  ->  ' + pr.model + (pr.note ? '   [' + pr.note + ']' : '')}>{pr.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={C.embedBaseUrl || ''} onChange={e => setLocal('embedBaseUrl', e.target.value)}
            placeholder="向量接口地址" style={{ flex: '1 1 240px', padding: '7px 11px', fontSize: 13 }} />
          <input value={C.embedModel || ''} onChange={e => setLocal('embedModel', e.target.value)}
            placeholder="向量模型" style={{ width: 190, padding: '7px 11px', fontSize: 13 }} />
          <input value={embedKey} onChange={e => setEmbedKey(e.target.value)} type="password"
            placeholder={C.hasEmbedKey ? ('已保存 ' + C.embedKeyHint) : 'API Key'}
            style={{ flex: '1 1 190px', padding: '7px 11px', fontSize: 13 }} />
          <button className="btn" disabled={saving}
            onClick={() => { const p: any = { embedBaseUrl: C.embedBaseUrl || '', embedModel: C.embedModel || '' }; if (embedKey) p.embedApiKey = embedKey; saveCfg(p); }}
            >{saving ? '…' : '保存'}</button>
          {embedKey && <button className="btn ghost" onClick={() => { saveCfg({ embedApiKey: '' }); setEmbedKey(''); }}>清除 Key</button>}
        </div>
      </div>

      {/* ---- 重排服务 ---- */}
      <div className="card" style={{ padding: '13px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>重排服务（可选，但强烈建议开）</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', lineHeight: 1.75, marginBottom: 10 }}>
          先用向量<b>粗排召回</b>一批候选，再用 cross-encoder <b>精排</b>。
          粗排负责「找得到」，精排负责「排得准」——开了之后结果顺序会明显更合理。<br />
          模力方舟这几个重排模型都是<b>免费</b>的。
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {RERANK_PRESETS.map(pr => (
            <button key={pr.label} className="btn ghost"
              style={btnStyle(C.rerankBaseUrl === pr.baseUrl && C.rerankModel === pr.model)}
              onClick={() => saveCfg({ rerankBaseUrl: pr.baseUrl, rerankModel: pr.model })}
              title={pr.baseUrl + '  ->  ' + pr.model}>{pr.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={C.rerankBaseUrl || ''} onChange={e => setLocal('rerankBaseUrl', e.target.value)}
            placeholder="重排接口地址（留空=跟随向量服务）" style={{ flex: '1 1 240px', padding: '7px 11px', fontSize: 13 }} />
          <input value={C.rerankModel || ''} onChange={e => setLocal('rerankModel', e.target.value)}
            placeholder="重排模型" style={{ width: 190, padding: '7px 11px', fontSize: 13 }} />
          <input value={rerankKey} onChange={e => setRerankKey(e.target.value)} type="password"
            placeholder={C.hasRerankKey ? ('已保存 ' + C.rerankKeyHint) : 'API Key（留空=跟随向量服务）'}
            style={{ flex: '1 1 190px', padding: '7px 11px', fontSize: 13 }} />
          <button className="btn" disabled={saving}
            onClick={() => { const p: any = { rerankBaseUrl: C.rerankBaseUrl || '', rerankModel: C.rerankModel || '' }; if (rerankKey) p.rerankApiKey = rerankKey; saveCfg(p); }}
            >{saving ? '…' : '保存'}</button>
          {rerankKey && <button className="btn ghost" onClick={() => { saveCfg({ rerankApiKey: '' }); setRerankKey(''); }}>清除 Key</button>}
        </div>
      </div>

      {/* ---- 索引状态 ---- */}
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
