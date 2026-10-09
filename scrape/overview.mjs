// Generate the overview / usage guide markdown
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'output');
const stats = JSON.parse(fs.readFileSync(path.join(DATA, 'stats.json'), 'utf8'));
let ins = { perChannelValuable: {}, topDomains: [], topMentions: [], topTags: [], valuableTotal: 0 };
try { ins = JSON.parse(fs.readFileSync(path.join(DATA, 'insights.json'), 'utf8')); } catch (e) {}

const T = stats.totals;
const chTitle = stats.channels || {};
const L = [];
const P = (s) => L.push(s);

P('# Telegram 频道资源精选库 · 总览');
P('');
P('> 自动抓取并整理 11 个公开 Telegram 频道的历史帖子，过滤广告/垃圾/黑产，按用途分类，');
P('> 用于发现可落地的项目、实用工具与优惠羊毛。');
P('');
P('## 一、抓取概况');
P('');
P('| 指标 | 数值 |');
P('|---|---|');
P('| 抓取原始帖子 | ' + T.raw.toLocaleString() + ' 条 |');
P('| 重复内容（同 id / 跨频道转发） | ' + (T.dupId + T.dupText).toLocaleString() + ' 条 |');
P('| 判定为广告/垃圾/黑产并剔除 | ' + T.spam.toLocaleString() + ' 条 |');
P('| 去重清洗后有效帖子 | ' + T.clean.toLocaleString() + ' 条 |');
P('| 高价值精选条目 | ' + T.valuable.toLocaleString() + ' 条 |');
P('| 时间跨度 | ' + (stats.dateRange && stats.dateRange[0] ? stats.dateRange[0] + ' ~ ' + stats.dateRange[1] : '-') + ' |');
P('| 覆盖频道 | ' + Object.keys(stats.byChannel || {}).length + ' 个 |');
P('');
P('抓取方式：通过 Telegram 官方公开预览页 \`t.me/s/<频道>\` 逐页回溯，**无需登录、不涉及私密内容**，仅采集任何人访问网页都能看到的信息。');
P('');
P('## 二、频道维度');
P('');
P('| 频道 | 名称 | 有效帖子 | 精选条目 |');
P('|---|---|---|---|');
const chOrder = Object.entries(stats.byChannel || {}).sort((a, b) => b[1] - a[1]);
for (const [ch, n] of chOrder) {
  P('| [@' + ch + '](https://t.me/' + ch + ') | ' + String(chTitle[ch] || '').replace(/\|/g, '/').slice(0, 42) + ' | ' + n.toLocaleString() + ' | ' + ((ins.perChannelValuable || {})[ch] || 0).toLocaleString() + ' |');
}
P('');
P('> 说明：**@qiuyueww** 是群组而非频道，Telegram 群组不提供匿名公开预览，因此无法采集；其内容与 @qiuyuezt 同源。');
P('');
P('## 三、分类维度');
P('');
P('| 分类 | 有效帖子 | 说明 |');
P('|---|---|---|');
const DESC = {
  '羊毛优惠': '免费领取、折扣、限时优惠、抽奖、补贴、返现',
  '项目副业': '可落地变现的项目、副业思路、信息差、流量玩法',
  '实用工具': '软件、网站、脚本、插件、效率神器',
  '开源项目': 'GitHub 仓库、自建方案、可二次开发的源码',
  'AI与科技': 'AI 模型/智能体、科技数码资讯',
  '服务器网络': 'VPS、节点、CDN、域名、网络加速',
  '账号会员': '账号、会员、激活码、合租拼车',
  '学习资源': '教程、课程、电子书、资料',
  '数码硬件': '硬件、外设、评测、开箱',
  '资讯热点': '行业资讯、热点事件',
  '其他': '未归入上述分类',
};
const catOrder = Object.entries(stats.byCategory || {}).sort((a, b) => b[1] - a[1]);
for (const [c, n] of catOrder) P('| ' + c + ' | ' + n.toLocaleString() + ' | ' + (DESC[c] || '') + ' |');
P('');
P('## 四、标签维度（内容特征）');
P('');
if ((ins.topTags || []).length) {
  P('| 标签 | 命中条目 |');
  P('|---|---|');
  for (const t of ins.topTags.slice(0, 20)) P('| ' + t[0] + ' | ' + t[1].toLocaleString() + ' |');
  P('');
}
P('## 五、月度分布');
P('');
const months = Object.entries(stats.byMonth || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
if (months.length) {
  const maxV = Math.max.apply(null, months.map(m => m[1]));
  P('| 月份 | 帖子数 | 趋势 |');
  P('|---|---|---|');
  for (const m of months) {
    const bars = Math.max(1, Math.round(m[1] / maxV * 40));
    P('| ' + m[0] + ' | ' + m[1].toLocaleString() + ' | ' + '█'.repeat(bars) + ' |');
  }
  P('');
}
P('## 六、文件导航');
P('');
P('| 文件 | 用途 |');
P('|---|---|');
P('| \`output/index.html\` | **交互式检索仪表盘**：搜索、分类/标签筛选、按价值/时间/热度排序 |');
P('| \`output/01-深度洞察与变现建议.md\` | 基于数据得出的项目与变现方向分析 |');
P('| \`output/分类报告/00-全网价值TOP500.md\` | 跨频道最高价值 500 条 |');
P('| \`output/分类报告/01~10-*.md\` | 各分类精选清单（按月份分组） |');
P('| \`output/分类报告/98-高频资源网站TOP300.md\` | 被反复推荐的站点，适合挖掘选品/工具 |');
P('| \`output/分类报告/99-推荐频道账号TOP200.md\` | 被高频提及的频道，可继续扩充信源 |');
P('| \`output/数据/Telegram资源精选.xlsx\` | 多工作表 Excel，可自行筛选排序 |');
P('| \`output/数据/精华内容-*.csv\` | 精选条目 CSV |');
P('| \`output/数据/全部有效内容.csv\` | 全部有效条目 CSV（含未精选） |');
P('| \`data/clean.jsonl\` | 全量清洗后数据（JSON Lines，供二次开发） |');
P('| \`data/raw/<频道>/\` | 原始抓取分段数据 |');
P('');
P('## 七、怎么用最省事');
P('');
P('1. **先开仪表盘**：双击 \`output/index.html\`，用搜索框直接找「免费 VPS」「GitHub」「AI 副业」这类关键词。');
P('2. **找项目**：看 \`01-深度洞察与变现建议.md\` 与 \`分类报告/02-项目副业.md\`。');
P('3. **薅羊毛**：看 \`分类报告/01-羊毛优惠.md\`，标签「免费」「限时」的最优先。');
P('4. **找工具**：看 \`分类报告/03-实用工具.md\` 与 \`04-开源项目.md\`，配合 \`98-高频资源网站\` 一起用。');
P('5. **做选品/建站**：\`98-高频资源网站TOP300.md\` 里的域名按出现频次排序，频次越高说明被越多频道反复验证过。');
P('');
P('## 八、免责声明');
P('');
P('- 所有内容均为 Telegram 公开频道中的公开信息，版权归原作者所有，仅供学习研究使用。');
P('- 频道中常含破解软件、第三方节点、账号交易等灰色内容，**使用前请自行判断风险**；标签含「风险」「破解」的条目已在报告中标注。');
P('- 建议对任何需要付款、实名、提供账号密码的“机会”保持警惕。');
P('');
P('---');
P('生成时间：' + (stats.generatedAt || '').slice(0, 19).replace('T', ' '));
fs.writeFileSync(path.join(OUT, '00-总览与使用说明.md'), L.join('\n'), 'utf8');
console.log('wrote 00-总览与使用说明.md,', L.length, 'lines');
