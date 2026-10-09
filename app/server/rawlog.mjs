// 原始日志：增量采集到的内容在入库的同时追加到这里。
// 目的：data/raw 永远是「所有抓到的原始数据」的完整集合，DB 可随时完整重建。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE_DIR = path.join(ROOT, 'data', 'raw', '_live');

let ready = false;
function ensureDir() {
  if (ready) return;
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  ready = true;
}

export function appendRaw(rec) {
  try {
    ensureDir();
    const f = path.join(LIVE_DIR, new Date().toISOString().slice(0, 7) + '.jsonl');
    fs.appendFileSync(f, JSON.stringify(rec) + '\n', 'utf8');
    return true;
  } catch (e) { return false; }
}

export function liveDir() { return LIVE_DIR; }
