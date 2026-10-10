// 检索质量评测（可复跑）。
//
//   node eval/rag-eval.mjs            # 报告
//   node eval/rag-eval.mjs --strict   # 低于基线则退出码非 0（用于回归门禁）
//
// 为什么要分三类查询：混合检索的收益来自「稠密与稀疏不一致」的地方。
// 只测一类会得出片面结论 —— 全用生僻词则关键词必胜，全用改述则向量必胜。
// 分开测才能看清各自强在哪、以及改动到底动了哪一块。
//
// 指标：Hit@10（目标帖是否进前 10）与 MRR（首次命中排名的倒数）。
// MRR 更能反映「相关的东西排得够不够前」，比只看命中率灵敏。
import * as ai from '../app/server/ai.mjs';
import * as rag from '../app/server/rag.mjs';
import * as semantic from '../app/server/semantic.mjs';

// 基线：macOS/Windows 上跑出的历史值。低于它说明检索退化了。
// 23 条评测集上的实测值。低于它说明检索退化了。
const BASELINE = { hit10: 0.74, mrr: 0.65 };

const CASES = [
  // ── 改述类：查询刻意不含帖子里的原词，考验「换种说法也能找到」 ──
  { q: '有没有能免费看小说的阅读应用', expect: 30746, type: '改述' },
  { q: '怎么搜索 BT 种子和磁力链接', expect: 861698, type: '改述' },
  { q: '想把字幕直接烧进视频里的工具', expect: 26190, type: '改述' },
  { q: '远程控制另一台电脑的开源方案', expect: 145272, type: '改述' },
  { q: '能不能把 B 站当音乐播放器用', expect: 861014, type: '改述' },
  { q: '开发者白嫖 AI 资源的清单', expect: 26915, type: '改述' },
  { q: '绕过系统检测的录屏软件', expect: 870481, type: '改述' },
  { q: '把开源仓库变成 AI 能直接调用的技能', expect: 29003, type: '改述' },

  // ── 生僻词类：查询带专名或编号，考验精确匹配 ──
  { q: 'AnycastIP 保加利亚 新节点', expect: 855960, type: '生僻词' },
  { q: 'OpenClaw Windows Hub', expect: 870465, type: '生僻词' },
  { q: 'Formance Stack 是什么', expect: 21064, type: '生僻词' },
  { q: 'TritonParse 内核编译分析', expect: 18764, type: '生僻词' },
  { q: 'SaaSBench 企业 SaaS 编程任务', expect: 865538, type: '生僻词' },
  { q: 'Decimen Optical Transfer', expect: 26206, type: '生僻词' },
  { q: 'Miniflux 中文全文搜索魔改版', expect: 878105, type: '生僻词' },

  // ── 混合类：既有专名又有改述意图 ──
  { q: 'Pika Labs 免费无限生成视频怎么弄', expect: 27647, type: '混合' },
  { q: 'Qoder Flash 免费额度延长了吗', expect: 865257, type: '混合' },
  { q: '阿里云轻量带宽 200mbps 是真的吗', expect: 856584, type: '混合' },
  { q: '本周 Epic 限免有哪几个游戏', expect: 861534, type: '混合' },
  { q: '香港开放下载图书馆 电子书', expect: 873469, type: '混合' },
  { q: 'HookVip 能解锁哪些会员', expect: 33015, type: '混合' },
  { q: '番茄免费小说 本地高级解锁版', expect: 30746, type: '混合' },
  { q: 'CrossDesk Web 远程桌面', expect: 145272, type: '混合' },
];

const strict = process.argv.includes('--strict');
const TYPES = ['改述', '生僻词', '混合'];
const out = [];
function say(s) { out.push(s); console.log(s); }

function run(name, idsOf) {
  const s = { name: name, hit: 0, mrr: 0, byType: {}, miss: [] };
  for (const k of TYPES) s.byType[k] = { n: 0, hit: 0 };
  for (const c of CASES) {
    const ids = idsOf(c);
    const pos = ids.indexOf(c.expect);
    const hit = pos >= 0 && pos < 10;
    if (hit) s.hit++;
    s.mrr += pos >= 0 ? 1 / (pos + 1) : 0;
    s.byType[c.type].n++; if (hit) s.byType[c.type].hit++;
    if (!hit) s.miss.push(c.q);
  }
  s.mrr = s.mrr / CASES.length;
  return s;
}

function report(s) {
  say('【' + s.name + '】');
  say('  Hit@10 ' + s.hit + '/' + CASES.length + ' (' + (s.hit / CASES.length * 100).toFixed(0) + '%)   MRR ' + s.mrr.toFixed(3));
  say('  ' + TYPES.map(k => k + ' ' + s.byType[k].hit + '/' + s.byType[k].n).join('   '));
  if (s.miss.length) say('  未命中: ' + s.miss.slice(0, 4).join(' / '));
  say('');
}

(async () => {
  say('检索评测 · ' + CASES.length + ' 条查询（' + TYPES.map(k => k + ' ' + CASES.filter(c => c.type === k).length).join(' / ') + '）');
  say('');

  // 预热向量缓存，避免第一次把读盘时间算进来
  await semantic.semanticSearch('预热', 5);

  const kw = run('纯关键词（对照）', (c) => ai.retrieve(c.q, {}, 10).map(p => p.id));

  const hybIds = {};
  for (const c of CASES) {
    const d = await rag.retrieveDetailed(c.q, {}, 10);
    hybIds[c.q] = d.fused.slice(0, 10).map(x => x.id);
  }
  const hyb = run('混合 RRF', (c) => hybIds[c.q] || []);

  const fullIds = {};
  for (const c of CASES) {
    fullIds[c.q] = (await rag.retrieve(c.q, {}, 10)).map(p => p.id);
  }
  const full = run('混合 + 重排（当前）', (c) => fullIds[c.q] || []);

  report(kw); report(hyb); report(full);

  const pass = full.hit / CASES.length >= BASELINE.hit10 - 0.01 && full.mrr >= BASELINE.mrr - 0.02;
  say('基线 Hit@10 ' + (BASELINE.hit10 * 100).toFixed(0) + '% / MRR ' + BASELINE.mrr.toFixed(2)
    + '  →  当前 ' + (full.hit / CASES.length * 100).toFixed(0) + '% / ' + full.mrr.toFixed(3)
    + '   ' + (pass ? '✅ 达标' : '❌ 低于基线'));

  if (strict && !pass) process.exit(1);
})().catch(e => { console.error('评测失败: ' + e.message); process.exit(2); });
