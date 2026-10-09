// 本机内置向量模型：用 transformers.js 在 Node 进程里直接推理。
// 不需要注册、不需要 API Key、不联网（模型下载一次后离线可用）。
//
// 依赖是可选安装的：没有装 @huggingface/transformers 时，
// 这里会给出明确提示，而不是让整个服务崩掉。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

let pipe = null;
let pipeModel = '';
let loading = null;

async function loadTransformers() {
  try {
    return await import('@huggingface/transformers');
  } catch (e) {
    const err = new Error('没有安装本机向量依赖。在项目根目录执行：npm install @huggingface/transformers');
    err.hint = 'npm install @huggingface/transformers';
    throw err;
  }
}

// 同一时刻只允许一个加载过程，避免并发重复下载
async function getPipeline(model) {
  if (pipe && pipeModel === model) return pipe;
  if (loading && pipeModel === model) return loading;
  pipeModel = model;
  loading = (async () => {
    const tf = await loadTransformers();
    tf.env.cacheDir = process.env.HF_CACHE_DIR || path.join(ROOT, 'app', 'data', 'models');
    tf.env.allowRemoteModels = true;
    const p = await tf.pipeline('feature-extraction', model, { dtype: 'fp32' });
    pipe = p;
    loading = null;
    return p;
  })();
  return loading;
}

export async function localEmbed(texts, model) {
  const m = localModelName(model);
  const p = await getPipeline(m);
  const out = await p(texts, { pooling: 'cls', normalize: true });
  return { vectors: out.tolist(), model: m, url: 'local' };
}

export function localStatus() {
  return { loaded: !!pipe, model: pipeModel || '', models: LOCAL_MODELS };
}
