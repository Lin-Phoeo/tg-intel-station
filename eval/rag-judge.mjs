// LLM 裁判：用模型判断「检索回来的东西到底相不相关」。
//
// 为什么需要它：known-item 评测（只认一条标准答案）对热门主题过于严苛 ——
// 库里讲 B 站音乐播放器的帖子有一堆，返回任何一条对用户都是对的，
// 但 known-item 只要不是那一条就算未命中。
// 所以 Hit@10 是「真实体验的下限」。裁判则给出更贴近实际的相关度。
//
//   node eval/rag-judge.mjs            只跑裁判
//   node eval/rag-judge.mjs --pipeline 对比两个方案
import * as ai from '../app/server/ai.mjs';
import * as rag from '../app/server/rag.mjs';
import * as semantic from '../app/server/semantic.mjs';

// 只抽样一部分：裁判用的是推理模型，做判断类任务单次要约 70 秒
// （实测 deepseek-v4-pro 在「只输出 5 行」的简单任务上也要 71s），
// 16 条就要跑 19 分钟。抽 6 条够看出趋势。
// 想做全量就自己把 CASES 补回去，或者换一个快模型当裁判。
const CASES = [
  { q: '有没有能免费看小说的阅读应用', type: '改述' },
  { q: '远程控制另一台电脑的开源方案', type: '改述' },
  { q: '能不能把 B 站当音乐播放器用', type: '改述' },
  { q: '绕过系统检测的录屏软件', type: '改述' },
  { q: 'Pika Labs 免费无限生成视频怎么弄', type: '混合' },
  { q: '本周 Epic 限免有哪几个游戏', type: '混合' },
];

// 让模型逐条打分。用固定格式输出，避免 JSON 解析失败。
async function judge(query, posts) {
  const lines = [
    '下面是一个用户查询，以及检索系统返回的 5 条资料。',
    '请判断每一条与查询的相关程度：2=直接回答了查询，1=沾边但没直接回答，0=不相关。',
    '',
    '用户查询：' + query,
    '',
    '=== 资料 ===',
  ];
  posts.forEach((p, i) => {
    lines.push((i + 1) + '. ' + String(p.text || '').replace(/\s+/g, ' ').slice(0, 220));
  });
  lines.push('');
  lines.push('只输出 5 行，每行格式：序号|分数');
  const ans = await ai.completeLLM([
    { role: 'system', content: '你只输出规定格式的行，不输出任何其它内容。' },
    { role: 'user', content: lines.join('\n') },
  ]);
  const scores = [];
  for (const raw of String(ans || '').split('\n')) {
    const m = raw.trim().match(/^(\d+)\s*[|｜]\s*([012])/);
    if (m) scores[Number(m[1]) - 1] = Number(m[2]);
  }
  return scores;
}

(async () => {
  await semantic.semanticSearch('预热', 5);
  const rows = [];
  let direct = 0, anyRel = 0, sumRel = 0, sumDirect = 0, n = 0;
  for (const c of CASES) {
    const posts = await rag.retrieve(c.q, {}, 5);
    let sc = [];
    try { sc = await judge(c.q, posts); } catch (e) { sc = []; }
    const nn = sc.filter(x => x !== undefined).length;
    const d = sc.filter(x => x === 2).length;
    const r = sc.filter(x => x >= 1).length;
    if (nn) {
      n++;
      sumDirect += d; sumRel += r;
      if (d > 0) direct++;
      if (r > 0) anyRel++;
    }
    rows.push({ q: c.q, type: c.type, sc: sc, direct: d, rel: r, nn: nn });
  }
  console.log('检索相关性裁判 · ' + CASES.length + ' 条查询\n');
  console.log('类型    查询                                    直接相关  沾边  评分明细');
  for (const x of rows) {
    console.log('  ' + x.type.padEnd(5) + ' ' + x.q.slice(0, 30).padEnd(33)
      + String(x.direct).padEnd(9) + String(x.rel).padEnd(6) + JSON.stringify(x.sc));
  }
  console.log('');
  console.log('平均直接相关条数: ' + (sumDirect / n).toFixed(2) + ' / 5');
  console.log('平均沾边以上条数: ' + (sumRel / n).toFixed(2) + ' / 5');
  console.log('至少一条直接相关: ' + direct + '/' + n + ' (' + (direct / n * 100).toFixed(0) + '%)');
  console.log('至少一条沾边以上: ' + anyRel + '/' + n + ' (' + (anyRel / n * 100).toFixed(0) + '%)');
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
