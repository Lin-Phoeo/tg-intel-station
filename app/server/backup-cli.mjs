// 备份命令行：node app/server/backup-cli.mjs [list|create [备注]|delete <id>]
import * as backup from './backup.mjs';

const cmd = process.argv[2] || 'create';
const arg = process.argv[3] || '';

if (cmd === 'list') {
  const items = backup.listBackups();
  if (!items.length) { console.log('还没有备份。'); process.exit(0); }
  console.log('备份目录: ' + backup.BK_DIR + '\n');
  for (const b of items) {
    console.log('  ' + b.id + '  ' + String(b.dbMB + ' MB').padStart(9) + '  ' + String(b.posts).padStart(9) + ' 条  ' + (b.label || ''));
  }
} else if (cmd === 'create') {
  console.log('正在备份（数据库用 VACUUM INTO 生成一致快照）…');
  const r = backup.createBackup(arg);
  console.log('完成: ' + r.id + '  ' + r.dbMB + ' MB  ' + String(r.posts).toLocaleString() + ' 条  用时 ' + (r.tookMs / 1000).toFixed(1) + 's');
  console.log('位置: ' + r.dir);
} else if (cmd === 'delete') {
  console.log(backup.deleteBackup(arg) ? '已删除 ' + arg : '未找到 ' + arg);
} else {
  console.log('用法: backup-cli.mjs [list | create "备注" | delete <id>]');
}
