// AI layer: multi-provider profiles, retrieval-augmented generation, streaming
import fs from 'node:fs';
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

const DEFAULT_PROFILES = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '', headers: '' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', apiKey: '', headers: '' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: '', headers: '' },
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
    s.profiles = s.profiles.map(p => Object.assign({ id: '', name: '', baseUrl: '', model: '', apiKey: '', headers: '' }, p));
    return s;
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
}

export function saveSettings(patch) {
  const cur = loadSettings();
  const next = Object.assign({}, cur, patch || {});
  if (patch && Array.isArray(patch.profiles)) {
    next.profiles = patch.profiles.map(p => {
      const old = cur.profiles.find(c => c.id === p.id) || {};
      const merged = Object.assign({ id: '', name: '', baseUrl: '', model: '', apiKey: '', headers: '' }, old, p);
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
    profiles: s.profiles.map(p => ({
      id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model,
      hasKey: !!p.apiKey, keyHint: p.apiKey ? p.apiKey.slice(0, 4) + '****' + p.apiKey.slice(-4) : '',
      headers: p.headers || '',
    })),
  };
}

function headersFor(profile) {
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (profile.apiKey || '') };
  if (profile.headers) {
    try { const extra = JSON.parse(profile.headers); for (const k of Object.keys(extra)) h[k] = String(extra[k]); } catch (e) {}
  }
  return h;
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
