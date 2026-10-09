// 把数据库导出为 JSON Lines 归档格式（供迁移、外部工具、离线分析使用）。
// 注意：DB 是唯一真相，本脚本只是导出，不参与任何读取链路。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../app/server/store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const only = process.argv.includes('--valuable-only');

const cleanOut = fs.createWriteStream(path.join(DATA, 'clean.jsonl'));
const valOut = fs.createWriteStream(path.join(DATA, 'valuable.jsonl'));
let n = 0, v = 0;

store.forEachPost({ size: 5000 }, (batch) => {
  for (const p of batch) {
    const rec = {
      channel: p.channel, id: p.msgId, url: p.url, date: p.date, ts: p.ts,
      views: p.views, media: p.media, text: p.text, primary: p.category,
      cats: p.categories, tags: p.tags, hashtags: p.hashtags,
      value: p.value, content: p.content, links: p.links, domains: p.domains,
      source: p.source,
    };
    const line = JSON.stringify(rec) + '\n';
    if (!only) { cleanOut.write(line); }
    n++;
    if ((p.content || 0) >= 2 && (p.text || '').length >= 10) { valOut.write(line); v++; }
  }
});

await new Promise(r => cleanOut.end(r));
await new Promise(r => valOut.end(r));
console.log(JSON.stringify({ exported: n, valuable: v, clean: path.join('data', 'clean.jsonl'), val: path.join('data', 'valuable.jsonl') }, null, 2));
