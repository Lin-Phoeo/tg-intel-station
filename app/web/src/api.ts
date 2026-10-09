// API client
export type Post = {
  id: number; channel: string; msgId: number; date: string; ts: number; views: number;
  media: string; text: string; category: string; categories: string[]; tags: string[];
  hashtags: string[]; value: number; content: number; url: string; links: string[];
  domains: string[]; lpTitle: string;
};
export type Facets = {
  categories: { k: string; n: number }[];
  channels: { k: string; n: number }[];
  tags: { k: string; n: number }[];
  meta: Record<string, string>;
};
export type Filters = {
  q?: string; category?: string; channel?: string; from?: string; to?: string;
  tags?: string[]; sort?: string; page?: number; size?: number; minValue?: number;
};
export type SearchResult = { mode: string; total: number; page: number; size: number; items: Post[] };

function qs(params: Filters) {
  const u = new URLSearchParams();
  for (const k of Object.keys(params) as (keyof Filters)[]) {
    const v = params[k];
    if (v === undefined || v === null || v === '' ) continue;
    if (Array.isArray(v)) { if (v.length) u.set(String(k), v.join(',')); }
    else u.set(String(k), String(v));
  }
  return u.toString();
}

export async function search(params: Filters): Promise<SearchResult> {
  const r = await fetch('/api/search?' + qs(params));
  if (!r.ok) throw new Error('search failed ' + r.status);
  return r.json();
}
export async function facets(): Promise<Facets> {
  const r = await fetch('/api/facets');
  return r.json();
}
export async function getPost(id: number): Promise<Post> {
  return (await fetch('/api/post/' + id)).json();
}
export async function related(id: number): Promise<{ items: Post[] }> {
  return (await fetch('/api/related/' + id)).json();
}
export async function getSettings(): Promise<{ settings: any; presets: any[] }> {
  return (await fetch('/api/settings')).json();
}
export async function saveSettings(patch: any): Promise<{ settings: any; presets: any[] }> {
  const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  return r.json();
}
export type FetchedModel = { id: string; ownedBy: string | null };
export type ModelFetchResult = { ok: boolean; models?: FetchedModel[]; error?: string; kind?: string; tried?: string[]; url?: string; count?: number };

export async function fetchModelsForConfig(payload: any): Promise<ModelFetchResult> {
  const r = await fetch('/api/settings/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return r.json();
}

export async function testSettings(payload: any): Promise<{ ok: boolean; error?: string; result?: any }> {
  const r = await fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return r.json();
}

export type ChatHandlers = {
  onStatus?: (stage: string) => void;
  onSources?: (items: any[]) => void;
  onDelta?: (text: string) => void;
  onDone?: (info: any) => void;
  onError?: (message: string, raw?: any) => void;
};

export async function chat(body: any, h: ChatHandlers) {
  let res: Response;
  try {
    res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e: any) { h.onError && h.onError('无法连接本地服务：' + String(e.message || e)); return; }
  if (!res.ok || !res.body) { h.onError && h.onError('请求失败 HTTP ' + res.status); return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      let j: any;
      try { j = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
      if (j.type === 'status') h.onStatus && h.onStatus(j.stage);
      else if (j.type === 'sources') h.onSources && h.onSources(j.items || []);
      else if (j.type === 'delta') h.onDelta && h.onDelta(j.text || '');
      else if (j.type === 'done') h.onDone && h.onDone(j);
      else if (j.type === 'error') h.onError && h.onError(j.message || '未知错误', j);
    }
  }
}
