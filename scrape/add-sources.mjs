// 批量添加精选来源并做首次抓取
import * as store from '../app/server/store.mjs';
import { importInto } from '../app/server/source.mjs';

const PICKS = [
  // 羊毛 / 优惠 / 免费
  'NiNiShare', 'zuanke8', 'appfans', 'DigitalSpecialDeals', 'freeresource', 'BaccanoSoul',
  'AppsSweepstakesNews', 'Lottery_home', 'baipiaodang', 'zaihuatb',
  // VPS / 主机 / 网络
  'lowendaff_blog', 'hostcab', 'vpscang', 'Tjjcfx', 'VPS_spiders', 'V1_BLOG', 'HostlocPro',
  'express91yun', 'vps_reviews', 'laoliuvps', 'vps_test', 'mjjpro',
  // 工具 / 软件
  'youyousharechannel', 'lihaiba', 'geekshare', 'gotoshare', 'abskoop', 'feiyu123',
  'WidgetChannel', 'huizong0917', 'macapp_channel', 'kkaifenxiang', 'alistshare',
  'notonlyshare', 'mtalk', 'SharedResources', 'appmew',
  // AI
  'AwesomeChatGPT', 'aigcnote', 'AI_News_CN', 'aigc1024', 'LptTech', 'sharecentre', 'agentONE_R',
  // 科技资讯
  'sspai', 'scitech_fans', 'readhub_cn', 'kejiqu', 'newmobilelife', 'misakatech', 'AppDoDo',
  'appinnfeed', 'pushings', 'outvivid', 'nnpai', 'hilinuxcn',
  // 开源 / 开发
  'awesomeopensource', 'githubtrending', 'archlinuxcn', 'cndevdaily', 'pythontrendingweekly',
  'decohack', 'linuxdotcn', 'Hello_1024', 'useless_project_ideas', 'pythonres', 'PythonHub',
  // 资源 / 学习
  'gdsharing', 'PDFtushuguan', 'daily_read', 'dailyrss', 'ruyoblog', 'AWAvenue', 'titan_pain',
  'FindBlog', 'aboutrss', 'GoReading',
];

const MAX = Number(process.env.MAX || 350);
const known = new Set(store.listSources().map(s => String(s.id).toLowerCase()));
const todo = PICKS.filter(p => !known.has(p.toLowerCase()));
console.log('计划添加 ' + todo.length + ' 个（已排除已存在的 ' + (PICKS.length - todo.length) + ' 个）');

let added = 0, imported = 0, failed = 0;
for (let i = 0; i < todo.length; i++) {
  const name = todo[i];
  const target = { id: 'add', input: name, status: 'running', phase: '', imported: 0, skipped: 0, scanned: 0, total: 0, error: null, kind: '', title: '', note: '', startedAt: Date.now(), finishedAt: null };
  try {
    await importInto(target, 'https://t.me/' + name, { maxMessages: MAX });
  } catch (e) { target.status = 'failed'; target.error = String(e.message || e); }
  if (target.status === 'done') { added++; imported += target.imported || 0; }
  else failed++;
  console.log('[' + (i + 1) + '/' + todo.length + '] @' + name.padEnd(24) + String(target.status).padEnd(10) + '新增 ' + String(target.imported || 0).padStart(4) + ' / 扫描 ' + (target.scanned || 0) + (target.error ? '  ERR: ' + String(target.error).slice(0, 40) : ''));
  await new Promise(r => setTimeout(r, 250));
}
console.log('\n=== 完成 ===');
console.log('成功 ' + added + ' 个来源 · 失败 ' + failed + ' 个 · 新增 ' + imported + ' 条');
console.log('库内总数: ' + store.liveCount().toLocaleString());
