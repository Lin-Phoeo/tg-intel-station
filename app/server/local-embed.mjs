// 本机内置向量模型：用 transformers.js 推理，不需要注册、不需要 API Key，
// 模型下载一次后完全离线可用。
//
// 推理跑在独立的 worker 线程里（见 embed-worker.mjs）：
// ONNX 推理是 CPU 密集型的，留在主线程会把事件循环卡住，
// 导致构建索引期间整个 HTTP API 变慢、对外请求超时。
//
// 依赖是可选安装的：没有装 @huggingface/transformers 时，
// 这里会给出明确提示，而不是让整个服务崩掉。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const LOCAL_PREFIX = 'local:';
export const DEFAULT_LOCAL_MODEL = 'Xenova/bge-small-zh-v1.5';

// 本机可选模型（都能离线跑，体积与速度是实测量级）
export const LOCAL_MODELS = [
  { id: 'Xenova/bge-small-zh-v1.5', dim: 512, size: '约 95 MB', speed: '最快', note: '中文，小体量，13 万条约 15 分钟' },
  { id: 'Xenova/bge-base-zh-v1.5', dim: 768, size: '约 400 MB', speed: '中等', note: '中文，效果更好' },
  { id: 'Xenova/bge-m3', dim: 1024, size: '约 570 MB', speed: '较慢', note: '多语言，社区最主流' },
];

export function isLocal(baseUrl) {
  return String(baseUrl || '').toLowerCase().indexOf('local') === 0;
}

export function localModelName(model) {
  return String(model || '').trim() || DEFAULT_LOCAL_MODEL;
}

let worker = null;
let seq = 0;
let lastModel = '';
const waiting = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./embed-worker.mjs', import.meta.url));
  worker.on('message', (m) => {
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) { if (m.model) lastModel = m.model; w.resolve(m); }
    else w.reject(new Error(m.error || '嵌入推理失败'));
  });
  worker.on('error', (e) => {
    for (const w of waiting.values()) w.reject(e);
    waiting.clear();
    worker = null;
  });
  worker.on('exit', () => {
    // 线程退出时把还挂着的请求失败掉，下次调用会自动重建
    for (const w of waiting.values()) w.reject(new Error('嵌入线程已退出'));
    waiting.clear();
    worker = null;
  });
  worker.unref();
  return worker;
}

function call(payload, timeoutMs) {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage(Object.assign({ id }, payload));
    setTimeout(() => {
      if (waiting.has(id)) { waiting.delete(id); reject(new Error('嵌入推理超时')); }
    }, timeoutMs || 300000);
  });
}

export async function localEmbed(texts, model) {
  const m = localModelName(model);
  const r = await call({ type: 'embed', texts: texts, model: m });
  return { vectors: r.vectors, model: r.model || m, url: 'local' };
}

export function localStatus() {
  return { loaded: !!worker && !!lastModel, model: lastModel, models: LOCAL_MODELS, threaded: true };
}
