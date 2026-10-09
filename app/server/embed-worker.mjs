// 嵌入推理工作线程。
//
// 为什么单独开线程：transformers.js 的 ONNX 推理是 CPU 密集型的，
// 跑在主线程会把事件循环卡住 —— 实测构建向量索引期间，
// 连 /api/health 都要 1000~1400ms（平时约 1ms），整个 API 变卡，
// 对外的重排请求也会因此超时。
//
// 放到 worker 后主线程只处理 HTTP，构建期间接口依然灵敏。
import { parentPort } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

// 推理不能被并发调用，串成一条队列
let chain = Promise.resolve();

parentPort.on('message', (msg) => {
  const { id, type, texts, model } = msg;
  chain = chain.then(async () => {
    try {
      if (type === 'status') {
        parentPort.postMessage({ id, ok: true, loaded: !!pipe, model: pipeModel });
        return;
      }
      const p = await getPipeline(model);
      const out = await p(texts, { pooling: 'cls', normalize: true });
      parentPort.postMessage({ id, ok: true, vectors: out.tolist(), model: pipeModel });
    } catch (e) {
      parentPort.postMessage({ id, ok: false, error: String((e && e.message) || e) });
    }
  });
});
