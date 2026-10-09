// AI layer: multi-provider profiles, retrieval-augmented generation, streaming
import fs from 'node:fs';
import * as local from './local-embed.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETTINGS_PATH = path.join(ROOT, 'app', 'data', 'settings.json');

export const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: '中文好、便宜，官方直连' },
  { id: 'siliconflow', label: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', note: '国内直连，注册送额度，有免费模型' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', note: 'glm-4-flash 免费额度' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', note: '需海外网络' },
  { id: 'moonshot', label: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', note: '长文本强' },
  { id: 'dashscope', label: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', note: '阿里云百炼' },
  { id: 'ark', label: '火山方舟 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k', note: '模型名填推理接入点 ID' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', note: '聚合站，需海外网络' },
  { id: 'relay', label: '自定义中转 / 自建站', baseUrl: '', model: '', note: '任何 OpenAI 兼容接口，可加自定义请求头' },
];

const PROFILE_SHAPE = { id: '', name: '', baseUrl: '', model: '', apiKey: '', headers: '', apiFormat: 'openai', modelsUrl: '' };
const DEFAULT_PROFILES = [
  Object.assign({}, PROFILE_SHAPE, { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
  Object.assign({}, PROFILE_SHAPE, { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' }),
  Object.assign({}, PROFILE_SHAPE, { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' }),
];
const DEFAULT_SETTINGS = { activeId: 'deepseek', profiles: DEFAULT_PROFILES, temperature: 0.3, topK: 14 };

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.profiles)) return raw;
  if (raw.baseUrl) {
    return { activeId: 'migrated', profiles: [{ id: 'migrated', name: raw.preset || '自定义', baseUrl: raw.baseUrl, model: raw.model || '', apiKey: raw.apiKey || '', headers: '' }], temperature: raw.temperature, topK: raw.topK };
  }
  return null;
}

export function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const m = migrate(raw);
    if (!m) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const s = Object.assign({}, DEFAULT_SETTINGS, m);
    if (!Array.isArray(s.profiles) || !s.profiles.length) s.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
    if (!s.profiles.some(p => p.id === s.activeId)) s.activeId = s.profiles[0].id;
    s.profiles = s.profiles.map(p => Object.assign({}, PROFILE_SHAPE, p));
    return s;
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
}

export function saveSettings(patch) {
  const cur = loadSettings();
  const next = Object.assign({}, cur, patch || {});
  if (patch && Array.isArray(patch.profiles)) {
    next.profiles = patch.profiles.map(p => {
      const old = cur.profiles.find(c => c.id === p.id) || {};
      const merged = Object.assign({}, PROFILE_SHAPE, old, p);
      if (!p.apiKey) merged.apiKey = old.apiKey || '';
      return merged;
    });
  }
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function activeProfile() {
  const s = loadSettings();
  return s.profiles.find(p => p.id === s.activeId) || s.profiles[0] || null;
}

export function publicSettings() {
  const s = loadSettings();
  return {
    activeId: s.activeId,
    temperature: s.temperature,
    topK: s.topK,
    // 向量化可以单独指向别的服务商（例如对话用 DeepSeek、向量用硅基流动的免费 bge-m3）
    embedBaseUrl: s.embedBaseUrl || '',
    embedModel: s.embedModel || '',
    hasEmbedKey: !!s.embedApiKey,
    embedKeyHint: s.embedApiKey ? s.embedApiKey.slice(0, 4) + '****' + s.embedApiKey.slice(-4) : '',
    rerankBaseUrl: s.rerankBaseUrl || '',
    rerankModel: s.rerankModel || '',
    hasRerankKey: !!s.rerankApiKey,
    rerankKeyHint: s.rerankApiKey ? s.rerankApiKey.slice(0, 4) + '****' + s.rerankApiKey.slice(-4) : '',
    profiles: s.profiles.map(p => ({
      id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model,
      hasKey: !!p.apiKey, keyHint: p.apiKey ? p.apiKey.slice(0, 4) + '****' + p.apiKey.slice(-4) : '',
      headers: p.headers || '', apiFormat: p.apiFormat || 'openai', modelsUrl: p.modelsUrl || '',
    })),
  };
}

function headersFor(profile) {
  const h = { 'Content-Type': 'application/json' };
  const key = profile.apiKey || '';
  const fmt = profile.apiFormat || 'openai';
  if (key) {
    if (fmt === 'anthropic') h['x-api-key'] = key;
    else if (fmt === 'google') h['x-goog-api-key'] = key;
    else h['Authorization'] = 'Bearer ' + key;
  }
  if (profile.headers) {
    try { const extra = JSON.parse(profile.headers); for (const k of Object.keys(extra)) h[k] = String(extra[k]); } catch (e) {}
  }
  return h;
}

// ---------------------------------------------------------------------------
// 模型列表自动获取
// 思路参考开源项目 farion1231/cc-switch（MIT）：候选地址按序尝试 +
// 剥离 Anthropic 兼容子路径兜底 + 兼容多种响应结构 + 区分 401 与 404。
// ---------------------------------------------------------------------------
const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode', '/api/anthropic', '/apps/anthropic', '/api/coding',
  '/claudecode', '/anthropic', '/step_plan', '/coding', '/claude',
];

export function buildModelsUrlCandidates(baseUrl, modelsUrl) {
  const out = [];
  const seen = new Set();
  const push = (u) => { const s = String(u || '').trim().replace(/\/+$/, ''); if (s && !seen.has(s) && /^https?:/i.test(s)) { seen.add(s); out.push(s); } };
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (modelsUrl && String(modelsUrl).trim()) { push(modelsUrl); return out; }
  if (!base) return out;
  if (/\/models$/i.test(base)) { push(base); return out; }

  // 1) 最常用：直接拼 /models（base 已含 /v1 时它就是正确答案）
  push(base + '/models');

  // 2) 兼容子路径（/anthropic、/api/coding…）：剥离后重试。
  //    实测 Moonshot 这类把 Anthropic 协议挂子路径的源，正确答案在剥离后的 /v1/models，
  //    所以放在第二优先，避免多打 3 次无效请求。
  let root = null;
  const lower = base.toLowerCase();
  for (const suf of KNOWN_COMPAT_SUFFIXES) {
    if (lower.endsWith(suf)) { root = base.slice(0, base.length - suf.length); break; }
  }
  if (root) { push(root + '/v1/models'); push(root + '/models'); }

  // 3) base 未带版本号时，再试 /v1/models 与 /api/v1/models
  if (!/\/v\d+[a-z]*$/i.test(base)) {
    push(base + '/v1/models');
    push(base + '/api/v1/models');
  }

  // 4) 兜底：把结尾的 /v4 之类版本段换成 /v1（实测智谱 /api/paas/v4 → /api/paas/v1/models 命中）
  const m = base.match(/^(.*)\/v\d+[a-z]*$/i);
  if (m) { push(m[1] + '/v1/models'); push(m[1] + '/models'); }
  if (root) push(root + '/api/v1/models');
  return out;
}

function parseModelList(json) {
  const out = [];
  const seen = new Set();
  const add = (id, owner) => {
    if (typeof id !== 'string') return;
    const v = id.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ id: v, ownedBy: owner ? String(owner) : null });
  };
  if (json && typeof json === 'object') {
    if (Array.isArray(json.data)) {
      for (const m of json.data) {
        if (typeof m === 'string') add(m, null);
        else if (m && typeof m === 'object') add(m.id, m.owned_by);
      }
    }
    if (Array.isArray(json.models)) {
      for (const m of json.models) {
        if (typeof m === 'string') add(m, null);
        else if (m && typeof m === 'object') add(m.slug || m.id || m.name, m.owned_by);
      }
    }
    if (Array.isArray(json.result)) for (const m of json.result) if (m && typeof m === 'object') add(m.id, m.owned_by);
  }
  return out;
}

export async function fetchModels(cfg) {
  cfg = cfg || {};
  const candidates = buildModelsUrlCandidates(cfg.baseUrl, cfg.modelsUrl);
  if (!candidates.length) return { ok: false, kind: 'config', error: '请先填写 Base URL', tried: [] };
  // 部分服务商（如 OpenRouter）的 /models 是公开端点，无 Key 也允许尝试；失败会返回 401 提示
  const headers = headersFor({ apiKey: cfg.apiKey, apiFormat: cfg.apiFormat, headers: cfg.headers });
  delete headers['Content-Type'];
  const tried = candidates;

  // 并发探测全部候选：失败时把「N 次串行超时」压缩成 1 次；再按候选顺序挑最优结果。
  const probed = await Promise.all(candidates.map(async (url, idx) => {
    try {
      const res = await fetch(url, { headers: headers, signal: AbortSignal.timeout(12000), redirect: 'follow' });
      if (res.ok) {
        let json = null;
        try { json = await res.json(); } catch (e) { return { url: url, idx: idx, status: res.status, tag: 'parse' }; }
        const models = parseModelList(json);
        return { url: url, idx: idx, status: res.status, tag: models.length ? 'ok' : 'empty', models: models };
      }
      const tag = (res.status === 401 || res.status === 403) ? 'auth'
        : (res.status === 404 || res.status === 405) ? 'notfound' : 'http';
      const body = tag === 'http' ? (await res.text().catch(() => '')).slice(0, 200) : '';
      return { url: url, idx: idx, status: res.status, tag: tag, body: body };
    } catch (e) {
      return { url: url, idx: idx, status: 0, tag: 'network' };
    }
  }));
  probed.sort((a, b) => a.idx - b.idx);
  const pick = (t) => probed.find(r => r.tag === t);

  const ok = pick('ok');
  if (ok) {
    ok.models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { ok: true, models: ok.models, tried: tried, url: ok.url, count: ok.models.length };
  }
  const auth = pick('auth');
  if (auth) return { ok: false, kind: 'auth', error: 'API Key 无效或无权限（HTTP ' + auth.status + '），也可能这个地址不是该服务商的模型接口', tried: tried };
  const empty = pick('empty');
  if (empty) return { ok: false, kind: 'empty', error: '接口返回成功，但没解析到任何模型（格式可能不兼容，请手动填写）', tried: tried };
  const http = pick('http');
  if (http) return { ok: false, kind: 'http', error: 'HTTP ' + http.status + ' ' + String(http.body || '').replace(/\s+/g, ' ').slice(0, 160), tried: tried };
  const parse = pick('parse');
  if (parse) return { ok: false, kind: 'parse', error: '接口返回的不是 JSON（这个地址可能不是模型接口）', tried: tried };
  return {
    ok: false,
    kind: 'notfound',
    error: '试过的 ' + candidates.length + ' 个地址都没有 /models 接口。该服务商可能不开放模型列表，请手动填写模型名，或在下面填「模型接口地址」。',
    tried: tried,
  };
}

// ---------- retrieval ----------
export function retrieve(question, filters, topK) {
  const seen = new Map();
  const push = (items, weight) => {
    for (const it of items) {
      const prev = seen.get(it.id);
      const tags = it.tags || [];
      let sc = (weight || 1) * (1 + (it.value || 0) / 4);
      if (it.date && it.date > '2026-04') sc *= 1.18;
      if (tags.includes('免费') || tags.includes('限时')) sc *= 1.3;
      if ((it.links || []).length) sc *= 1.15;
      if (tags.includes('风险')) sc *= 0.5;
      if (/求推荐|求助|请问|怎么弄|有没有人|吗？|\?$/.test(String(it.text || '').slice(0, 80))) sc *= 0.6;
      if (String(it.text || '').length < 45) sc *= 0.55;
      if (!prev || sc > prev.sc) seen.set(it.id, { post: it, sc: sc });
    }
  };
  const q = String(question || '').trim();
  const whole = q.replace(/[?？。，,！!]/g, ' ').trim();
  if ([...whole].length >= 3) {
    try { push(store.search(Object.assign({}, filters, { q: whole, size: 12, sort: 'relevance' })).items, 1.4); } catch (e) {}
  }
  const terms = store.splitTerms(q).filter(t => [...t].length >= 2);
  for (const t of terms.slice(0, 6)) {
    try { push(store.search(Object.assign({}, filters, { q: t, size: 8, sort: 'relevance' })).items, 1.0); } catch (e) {}
  }
  const cjk = q.match(/[\u4e00-\u9fa5]{3,}/g) || [];
  for (const run of cjk) {
    for (let i = 0; i + 4 <= run.length && i < 8; i += 3) {
      const frag = run.slice(i, i + 4);
      try { push(store.search(Object.assign({}, filters, { q: frag, size: 6, sort: 'relevance' })).items, 0.8); } catch (e) {}
    }
  }
  if (!seen.size) {
    try { push(store.search(Object.assign({}, filters, { q: '', size: 12, sort: 'value' })).items, 0.4); } catch (e) {}
  }
  return [...seen.values()].sort((a, b) => b.sc - a.sc).slice(0, topK || 14).map(x => x.post);
}

// ---------- prompt ----------
export function buildMessages(question, posts, history) {
  const lines = [];
  lines.push('你是「电报情报站」的检索分析助手。下面是从 85 万条 Telegram 公开频道帖子中实时检索出的资料。');
  lines.push('规则：');
  lines.push('1. 只依据下面的资料回答，不要编造资料中没有的事实；资料不足时明确说明。');
  lines.push('2. 用简体中文回答，结构清晰，可用小标题和列表。');
  lines.push('3. 每条结论后面用 [序号] 标注来源，例如「免费 VPS 有学生优惠 [3]」。');
  lines.push('4. 涉及价格、免费额度、优惠码时，提醒用户以官方最新信息为准。');
  lines.push('5. 如果资料里明显有广告或风险内容，直接指出风险。');
  lines.push('');
  lines.push('=== 检索到的资料 ===');
  posts.forEach((p, i) => {
    const parts = [];
    parts.push('[' + (i + 1) + '] 日期:' + (p.date || '?') + ' 频道:@' + p.channel + ' 分类:' + p.category + ' 热度:' + (p.views || 0));
    if (p.tags && p.tags.length) parts.push('标签:' + p.tags.join('/'));
    parts.push('内容:' + String(p.text || '').replace(/\s+/g, ' ').slice(0, 420));
    if (p.links && p.links.length) parts.push('链接:' + p.links.slice(0, 3).join(' , '));
    lines.push(parts.join('\n'));
    lines.push('');
  });
  lines.push('=== 资料结束 ===');
  lines.push('');
  lines.push('用户问题：' + question);
  const msgs = [{ role: 'system', content: lines.join('\n') }];
  for (const h of (history || []).slice(-6)) {
    if (h.role === 'user' || h.role === 'assistant') msgs.push({ role: h.role, content: String(h.content || '').slice(0, 4000) });
  }
  msgs.push({ role: 'user', content: question });
  return msgs;
}

export function extractiveAnswer(question, posts) {
  if (!posts.length) return '没有检索到相关资料。可以换一个关键词，或者放宽左上角的筛选条件。';
  const out = [];
  out.push('**未配置 AI 模型，以下是数据库检索到的原始资料**（点左下角 ⚙ 选择服务商并填入 API Key，即可获得 AI 分析与总结）：\n');
  posts.slice(0, 10).forEach((p, i) => {
    out.push('**[' + (i + 1) + '] ' + (p.date || '') + ' · @' + p.channel + ' · ' + p.category + '**');
    out.push(String(p.text || '').replace(/\s+/g, ' ').slice(0, 300));
    if (p.links && p.links[0]) out.push('链接：' + p.links[0]);
    out.push('');
  });
  return out.join('\n');
}

// ---------- LLM streaming ----------
export async function streamLLM(messages, onDelta) {
  const s = loadSettings();
  const p = activeProfile();
  if (!p || !p.baseUrl || !p.apiKey) throw new Error('NO_KEY');
  const baseUrl = String(p.baseUrl).replace(/\/+$/, '');
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: headersFor(p),
    body: JSON.stringify({ model: p.model, messages: messages, stream: true, temperature: s.temperature == null ? 0.3 : s.temperature }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('模型返回 ' + res.status + '：' + t.slice(0, 300));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const line of parts) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (delta) { full += delta; onDelta(delta); }
      } catch (e) {}
    }
  }
  return full;
}

// 非流式调用，供机器人等场景使用
export async function completeLLM(messages) {
  const s = loadSettings();
  const p = activeProfile();
  if (!p || !p.baseUrl || !p.apiKey) throw new Error('NO_KEY');
  const baseUrl = String(p.baseUrl).replace(/\/+$/, '');
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: headersFor(p),
    body: JSON.stringify({ model: p.model, messages: messages, stream: false, temperature: s.temperature == null ? 0.3 : s.temperature }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error('模型返回 ' + res.status + '：' + (await res.text().catch(() => '')).slice(0, 200));
  const j = await res.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}

// ---------------------------------------------------------------------------
// 向量化（语义检索用）
// 复用当前服务的 baseUrl / apiKey，模型可单独指定。
// ---------------------------------------------------------------------------
const EMBED_FALLBACKS = ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-v3', 'BAAI/bge-m3', 'bge-m3', 'nomic-embed-text', 'embedding-2'];

export function embeddingProfile() {
  const s = loadSettings();
  const p = activeProfile();
  // 本机模型不需要任何服务商配置
  if (local.isLocal(s.embedBaseUrl)) {
    return { baseUrl: s.embedBaseUrl, apiKey: '', model: s.embedModel || '', apiFormat: 'openai', headers: '' };
  }
  if (!p) return null;
  return {
    baseUrl: s.embedBaseUrl || p.baseUrl || '',
    apiKey: s.embedApiKey || p.apiKey || '',
    model: s.embedModel || '',
    apiFormat: p.apiFormat || 'openai',
    headers: p.headers || '',
  };
}

function baseOf(url) {
  return String(url || '').replace(/\/+$/, '').replace(/\/(chat\/completions|embeddings|models)$/, '');
}

function embedUrls(base) {
  const b = baseOf(base);
  const out = [b + '/embeddings'];
  if (!/\/v1$/.test(b)) out.push(b + '/v1/embeddings');
  return [...new Set(out)];
}

function parseEmbedding(j) {
  const arr = (j && j.data) || (j && j.embeddings) || [];
  if (!Array.isArray(arr) || !arr.length) return null;
  const first = arr[0];
  const vec = Array.isArray(first) ? first : (first && first.embedding);
  if (!Array.isArray(vec) || !vec.length) return null;
  return arr.map(x => (Array.isArray(x) ? x : x.embedding));
}

// 返回 { vectors, model, url }。cfg 可覆盖 baseUrl/apiKey/model。
// baseUrl 以 local 开头时走本机内置模型，不联网、不需要 Key。
export async function embed(texts, cfg) {
  const p = Object.assign(embeddingProfile() || {}, cfg || {});
  if (local.isLocal(p.baseUrl)) {
    return await local.localEmbed(texts, p.model);
  }
  if (!p.baseUrl) throw new Error('未配置服务地址，无法向量化');
  const headers = headersFor({ apiKey: p.apiKey, apiFormat: p.apiFormat, headers: p.headers });
  const models = p.model ? [p.model] : EMBED_FALLBACKS;
  const urls = embedUrls(p.baseUrl);
  const errors = [];

  for (const model of models) {
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ model: model, input: texts }),
          signal: AbortSignal.timeout(90000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          errors.push(model + ' @ ' + url + ' -> ' + res.status + ' ' + body.slice(0, 120));
          if (res.status === 401 || res.status === 403) throw new Error('鉴权失败（' + res.status + '），请检查 API Key');
          continue;
        }
        const j = await res.json();
        const vecs = parseEmbedding(j);
        if (vecs) return { vectors: vecs, model: model, url: url };
        errors.push(model + ' @ ' + url + ' -> 返回结构无法解析');
      } catch (e) {
        if (String(e.message || '').indexOf('鉴权失败') >= 0) throw e;
        errors.push(model + ' @ ' + url + ' -> ' + String(e.message || e).slice(0, 100));
      }
    }
  }
  const err = new Error('没有可用的向量模型。可在设置里手动指定「向量模型」。已尝试：\n' + errors.slice(0, 6).join('\n'));
  err.detail = errors.slice(0, 12);
  throw err;
}

// ---------------------------------------------------------------------------
// 重排（Rerank）
// 先粗排召回一批候选，再用 cross-encoder 精排。比单纯向量余弦准得多。
// 协议沿用 Jina / 硅基流动 / 模力方舟通用的 {base}/rerank。
// ---------------------------------------------------------------------------
const RERANK_FALLBACKS = ['bge-reranker-v2-m3', 'BAAI/bge-reranker-v2-m3', 'Qwen3-Reranker-4B', 'jina-reranker-v2-base-multilingual', 'bge-reranker-large'];

export function rerankProfile() {
  const s = loadSettings();
  const p = activeProfile();
  if (!p) return null;
  return {
    baseUrl: s.rerankBaseUrl || s.embedBaseUrl || p.baseUrl || '',
    apiKey: s.rerankApiKey || s.embedApiKey || p.apiKey || '',
    model: s.rerankModel || '',
    apiFormat: p.apiFormat || 'openai',
    headers: p.headers || '',
  };
}

function rerankUrls(base) {
  const b = baseOf(base);
  const out = [b + '/rerank'];
  if (!/\/v1$/.test(b)) out.push(b + '/v1/rerank');
  return [...new Set(out)];
}

function parseRerank(j) {
  const arr = (j && j.results) || (j && j.data) || [];
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.map((x, i) => ({
    index: x.index == null ? i : Number(x.index),
    score: Number(x.relevance_score != null ? x.relevance_score : (x.score != null ? x.score : 0)),
  }));
}

// 返回按相关度从高到低排好序的 [{index, score}]
export async function rerank(query, documents, cfg) {
  const p = Object.assign(rerankProfile() || {}, cfg || {});
  if (!p.baseUrl) throw new Error('未配置重排服务地址');
  if (!documents || !documents.length) return [];
  const headers = headersFor({ apiKey: p.apiKey, apiFormat: p.apiFormat, headers: p.headers });
  const models = p.model ? [p.model] : RERANK_FALLBACKS;
  const urls = rerankUrls(p.baseUrl);
  const errors = [];

  for (const model of models) {
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ model: model, query: String(query).slice(0, 2000), documents: documents, top_n: documents.length }),
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          errors.push(model + ' @ ' + url + ' -> ' + res.status + ' ' + body.slice(0, 100));
          if (res.status === 401 || res.status === 403) throw new Error('重排鉴权失败（' + res.status + '）');
          continue;
        }
        const j = await res.json();
        const list = parseRerank(j);
        if (list) return { results: list.sort((a, b) => b.score - a.score), model: model, url: url };
        errors.push(model + ' @ ' + url + ' -> 返回结构无法解析');
      } catch (e) {
        if (String(e.message || '').indexOf('鉴权失败') >= 0) throw e;
        errors.push(model + ' @ ' + url + ' -> ' + String(e.message || e).slice(0, 90));
      }
    }
  }
  const err = new Error('没有可用的重排模型。可在设置里手动指定「重排模型」');
  err.detail = errors.slice(0, 12);
  throw err;
}

export function hasKey() {
  const p = activeProfile();
  return !!(p && p.apiKey && p.baseUrl && p.model);
}

export async function testConnection(profile) {
  const s = loadSettings();
  const active = activeProfile();
  const baseUrl = String((profile && profile.baseUrl) || (active && active.baseUrl) || '').replace(/\/+$/, '');
  const apiKey = (profile && profile.apiKey) || (active && active.apiKey) || '';
  const model = (profile && profile.model) || (active && active.model) || '';
  if (!baseUrl) throw new Error('请先填写 Base URL');
  if (!apiKey) throw new Error('请先填写 API Key');
  if (!model) throw new Error('请先填写模型名');
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: headersFor({ apiKey: apiKey, headers: profile && profile.headers }),
    body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
  return { ok: true, model: model };
}
