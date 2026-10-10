import * as rag from './rag.mjs';
import * as ai from './ai.mjs';
import fs from 'node:fs';
const out = [];
(async () => {
  const t0 = Date.now();
  const posts = await rag.retrieve('有没有能免费看小说的阅读应用', {}, 5);
  out.push('检索 ' + (Date.now() - t0) + 'ms  拿到 ' + posts.length + ' 条');
  const prompt = '判断相关度 2/1/0，只输出 5 行「序号|分数」\n\n查询：免费看小说\n\n=== 资料 ===\n'
    + posts.map((p, i) => (i + 1) + '. ' + String(p.text || '').replace(/\s+/g, ' ').slice(0, 200)).join('\n');
  const t1 = Date.now();
  const ans = await ai.completeLLM([
    { role: 'system', content: '你只输出规定格式的行。' },
    { role: 'user', content: prompt },
  ]);
  out.push('裁判调用 ' + (Date.now() - t1) + 'ms');
  out.push('返回: ' + JSON.stringify(String(ans).slice(0, 120)));
  fs.writeFileSync('app/tmp-j1.txt', out.join('\n'), 'utf8');
  console.log('ok');
})().catch(e => { fs.writeFileSync('app/tmp-j1.txt', 'ERR ' + e.message + '\n' + String(e.stack).slice(0,400), 'utf8'); console.log('err'); });
