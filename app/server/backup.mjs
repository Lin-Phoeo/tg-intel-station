// 备份 / 恢复：数据库用 VACUUM INTO 生成一致快照，配置一并打包。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// 备份目录可用 BK_DIR 覆盖，测试必须指到临时目录，
// 绝不能让单元测试的清理逻辑删掉用户的真实备份。
export const BK_DIR = process.env.BK_DIR || path.join(ROOT, 'backups');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'app', 'data', 'intel.db');

const CONFIGS = ['app/data/settings.json', 'app/data/bot.json'];

function dirOf(id) {
  if (!/^[0-9T:-]+$/.test(String(id || ''))) throw new Error('非法备份 id');
  return path.join(BK_DIR, String(id));
}

export function listBackups() {
  if (!fs.existsSync(BK_DIR)) return [];
  return fs.readdirSync(BK_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dir = path.join(BK_DIR, d.name);
      const db = path.join(dir, 'intel.db');
      let info = {};
      try { info = JSON.parse(fs.readFileSync(path.join(dir, 'info.json'), 'utf8')); } catch (e) {}
      const st = fs.existsSync(db) ? fs.statSync(db) : null;
      const cfgs = CONFIGS.map(f => path.basename(f)).filter(n => fs.existsSync(path.join(dir, n)));
      return {
        id: d.name, dbMB: st ? +(st.size / 1048576).toFixed(1) : 0,
        createdAt: info.createdAt || '', label: info.label || '', posts: info.posts || 0,
        configs: cfgs,
      };
    })
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

export function createBackup(label) {
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(BK_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'intel.db');
  try { fs.unlinkSync(dest); } catch (e) {}
  const t0 = Date.now();
  // VACUUM INTO 写出的是一致且紧凑的副本，不受 WAL 与并发写入影响
  store.open().prepare('VACUUM INTO ?').run(dest);
  for (const rel of CONFIGS) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, path.basename(rel)));
  }
  const info = {
    createdAt: new Date().toISOString(), label: String(label || '').slice(0, 60),
    posts: store.liveCount(), tookMs: Date.now() - t0,
  };
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info, null, 2));
  const mb = +(fs.statSync(dest).size / 1048576).toFixed(1);
  return Object.assign({ id: id, dir: dir, dbMB: mb }, info);
}

export function deleteBackup(id) {
  const dir = dirOf(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// 恢复：把备份库换回原位。必须重启进程，因此由外层看门狗负责拉起。
export function restoreBackup(id) {
  const dir = dirOf(id);
  const src = path.join(dir, 'intel.db');
  if (!fs.existsSync(src)) throw new Error('备份里没有数据库文件');
  store.close();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
  fs.copyFileSync(src, DB_PATH);
  for (const rel of CONFIGS) {
    const s = path.join(dir, path.basename(rel));
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(ROOT, rel));
  }
  return { ok: true, restoredFrom: id, dbMB: +(fs.statSync(DB_PATH).size / 1048576).toFixed(1) };
}
