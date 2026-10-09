// Generate the data-driven deep-dive & monetization report
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'output');
const stats = JSON.parse(fs.readFileSync(path.join(DATA, 'stats.json'), 'utf8'));
let ins = { topDomains: [], topMentions: [], topTags: [], perChannelValuable: {} };
try { ins = JSON.parse(fs.readFileSync(path.join(DATA, 'insights.json'), 'utf8')); } catch (e) {}

const KW = ["中转站", "公益站", "副业", "变现", "赚钱", "AI工具", "套壳", "API", "白嫖", "免费", "VPS", "服务器", "学生", "网盘", "课程", "节点", "机场", "破解", "ChatGPT", "Claude", "Gemini", "DeepSeek", "Cursor", "自动化", "爬虫", "独立开发", "出海", "跨境电商", "选品", "接单", "信息差", "开源", "GitHub", "提示词", "智能体", "Agent", "封号", "拼车", "合租", "抽奖", "优惠"];
const kwCount = Object.fromEntries(KW.map(k => [k, 0]));
const freeDeals = [], ghMap = new Map(), catTop = new Map();

const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATA, 'valuable.jsonl')), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let it; try { it = JSON.parse(line); } catch (e) { continue; }
  const hay = it.text + " " + (it.lp || []).map(x => x.t || "").join(" ");
  for (const k of KW) if (hay.includes(k)) kwCount[k]++;
  const tg = it.tags || [];
  if ((tg.includes("免费") || tg.includes("限时")) && it.text.length >= 25 && !tg.includes("风险")) freeDeals.push(it);
  for (const u of it.links || []) {
    const m = u.match(/^https?:\/\/github\.com\/([^\/\s?#]+)\/([^\/\s?#]+)/);
    if (m) {
      const repo = m[1] + "/" + m[2].replace(/\.git$/, "");
      const prev = ghMap.get(repo);
      if (!prev || it.value > prev.value) ghMap.set(repo, { repo: repo, value: it.value, text: it.text, date: it.date, channel: it.channel });
    }
  }
  if (!catTop.has(it.primary)) catTop.set(it.primary, []);
  const arr = catTop.get(it.primary);
  if (arr.length < 8) arr.push(it);
}

freeDeals.sort((a, b) => b.value - a.value);
const deals = freeDeals.slice(0, 70);
const repos = [...ghMap.values()].sort((a, b) => b.value - a.value).slice(0, 90);

const L = [];
const P = (s) => L.push(s);
const cut = (t, n) => { t = String(t || "").replace(/\s*\n+\s*/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
const firstLink = (it) => (it.links && it.links[0]) || (it.lp && it.lp[0] && it.lp[0].u) || "";
const tagCount = (name) => { const f = (ins.topTags || []).filter(t => t[0] === name); return f.length ? f[0][1].toLocaleString() : "0"; };

P("# 深度洞察与变现建议");
P("");
P("> 这份报告不是数据罗列，而是把 86 万条帖子里的**信息差**翻译成可执行的判断。");
P("> 所有结论都有数据支撑，可对照分类报告与原始帖子链接自行验证。");
P("");
P("## 一、先看清楚这堆数据是什么");
P("");
P("| 维度 | 数值 |");
P("|---|---|");
P("| 抓取原始帖子 | " + stats.totals.raw.toLocaleString() + " 条 |");
P("| 去重清洗后有效 | " + stats.totals.clean.toLocaleString() + " 条 |");
P("| 判定有价值（进入精选库） | " + stats.totals.valuable.toLocaleString() + " 条 |");
P("| 时间跨度 | " + (stats.dateRange[0] || "") + " ~ " + (stats.dateRange[1] || "") + " |");
P("");
P("**最重要的结构性认识**：数据里 96% 来自两个 linux.do 自动转发频道（linuxdoit 34 万条、linux_do_channel 48 万条），它们是中文技术圈最大的“羊毛 + 工具 + 踩坑”实时信息池；剩下 4% 是 9 个精选内容频道，**信息密度高得多**。");
P("");
P("| 频道 | 定位 | 有效帖子 | 建议用途 |");
P("|---|---|---|---|");
const chDesc = {
  JIKE0906: "GitHub 严选，每天 5 款开源神器", goodlearnclub: "AI 资源 / 大模型 / 创业", iGitHub: "GitHub 开源项目精选",
  piracy6: "黑洞资源笔记，开源项目点评", linuxdoit: "linux.do 热门话题", linux_do_channel: "linux.do 话题更新",
  zaihuapd: "科技 / AI / 数码资讯", qiuyuezt: "软件 / 工具资源", pgkj666: "白嫖分享社",
  baipiaou: "严选实用分享", QingLongAndroid: "搞机 / 数码",
};
for (const e of Object.entries(stats.byChannel).sort((a, b) => b[1] - a[1])) {
  const isLd = e[0].indexOf("linux") === 0;
  P("| [@" + e[0] + "](https://t.me/" + e[0] + ") | " + (chDesc[e[0]] || "") + " | " + e[1].toLocaleString() + " | " + (isLd ? "找一手羊毛/踩坑/项目讨论" : "找成熟工具与项目") + " |");
}
P("");
P("## 二、关键词热度：钱在哪里");
P("");
P("下表是各关键词在 32 万条精选内容中的出现次数，**次数越高说明该方向讨论越密集、信息差越容易被抹平**（也意味着竞争越激烈）。");
P("");
P("| 关键词 | 出现次数 | 解读 |");
P("|---|---|---|");
const kwNote = {
  AI工具: "最卷但需求最真实", 套壳: "最低门槛的变现形态", 中转站: "AI API 转售，利润核心", 公益站: "免费额度来源，变化快", API: "所有人的成本项",
  副业: "直接相关", 变现: "直接相关", 赚钱: "直接相关", 信息差: "本项目要找的东西", 接单: "最容易起步的现金流",
  免费: "羊毛体量最大", 白嫖: "同上", 优惠: "可做比价/提醒", 抽奖: "引流玩法", VPS: "可做低门槛服务", 服务器: "同上",
  节点: "灰色但刚需", 机场: "订阅制生意", 破解: "版权风险，不建议商业化", 学生: "教育优惠是最稳定的羊毛入口",
  网盘: "资源流通方式", 课程: "知识付费原料", 出海: "变现天花板更高", 跨境电商: "同上", 选品: "电商第一步",
  独立开发: "个人开发者主力", 自动化: "接单效率工具", 爬虫: "数据服务基础", 开源: "免费原料库", GitHub: "项目源头",
  提示词: "可做课程/模板生意", 智能体: "当下最热", Agent: "同上", 封号: "账号赛道最大风险", 拼车: "低成本用高价服务", 合租: "同上",
  ChatGPT: "需求最大", Claude: "开发者首选", Gemini: "免费额度多", DeepSeek: "国产低价", Cursor: "编程工具新宠",
};
for (const e of Object.entries(kwCount).sort((a, b) => b[1] - a[1])) {
  if (e[1] === 0) continue;
  P("| " + e[0] + " | " + e[1].toLocaleString() + " | " + (kwNote[e[0]] || "") + " |");
}
P("");
P("## 三、六条可以动手的赛道");
P("");
P("### 赛道 1 · AI 工具站 / 套壳应用 —— 门槛最低、可复制性最强");
P("");
P("**数据信号**：AI 与科技类 26.7 万条居首；社区里已有人完整公开《我做 AI 工具站时踩过的 7 个坑》《自建中转站变现》等实战复盘；goodlearnclub 几乎每天分享 1-5 个可直接用的 AI 开源项目。");
P("");
P("**为什么可行**：做 AI 应用如今不需要算法能力，核心公式是「细分场景 + 便宜的 API 渠道 + 不丑的前端 + 一个真实痛点」。频道里同时提供了原料（开源项目）、成本（API 渠道讨论）、避坑（踩坑帖）三样东西。");
P("");
P("**最小路径**：从 04-开源项目.md 里挑一个你亲手会用的小工具（OCR、视频下载、语音转写、字幕翻译）→ 用 Next.js/Vercel 做成在线版 → 接兼容 OpenAI 的 API → 按次收费或挂广告。");
P("");
P("**检索词**：AI工具站、套壳、中转站、Agent、MCP、RAG、工作流");
P("");
P("### 赛道 2 · 开源项目二次开发与本地化 —— 素材最充足");
P("");
P("**数据信号**：github.com 在精选内容中外部域名排名第一（1.85 万次）；仅「开源项目」分类就有 4.3 万条，其中大量是“英文项目”的现成素材。");
P("");
P("**为什么可行**：绝大多数频道分享的开源项目只有英文文档，中文用户用不起来。把这些项目做成**中文一键部署版、中文文档、中文教程**，本身就是产品。");
P("");
P("**最小路径**：选 20 个高频开源项目 → 写成中文保姆级部署教程 → 顺带提供托管版/一键脚本收费。");
P("");
P("### 赛道 3 · 资源整理与导航站 —— 把信息差变成搜索流量");
P("");
P("**数据信号**：98-高频资源网站TOP300.md 显示被反复推荐的站点高度集中（github 1.85 万次、telegra.ph 4154 次、大量工具站数百次），而用户真正缺的是**分类与筛选**。");
P("");
P("**为什么可行**：这批数据本身就是一份现成的“全网工具热度榜”。做成垂直导航站（AI 工具导航 / VPS 优惠导航 / 开源替代品导航），靠 SEO + 广告 + 联盟链接变现。");
P("");
P("**最小路径**：用本项目的 index.html 思路，选一个细分领域（例如“AI Agent 工具导航”）做成公开站点，用 98-高频资源网站TOP300.md 作为选品池。");
P("");
P("### 赛道 4 · 羊毛 / 优惠信息聚合与提醒 —— 最容易起步的现金流");
P("");
P("**数据信号**：羊毛优惠类 5.8 万条；带「免费」标签 " + tagCount("免费") + " 条、「限时」" + tagCount("限时") + " 条；出现大量“学生 VPS 羊毛列表”“免费 20GB 云存储”“X Premium 限时 40%”这类高价值单点信息。");
P("");
P("**为什么可行**：羊毛信息的价值随时间快速衰减，**“快”比“全”更值钱**。做 Telegram 频道/公众号/小程序的聚合 + 推送，靠导流和联盟佣金变现。");
P("");
P("**最小路径**：用本项目的抓取脚本每天增量跑一次 → 只推「免费 + 限时」标签且价值分 > 6 的条目 → 形成稳定的羊毛日报。");
P("");
P("### 赛道 5 · 教程与知识付费 —— 用别人的教程做自己的课");
P("");
P("**数据信号**：带「教程」标签 " + tagCount("教程") + " 条；学习资源类 2.1 万条；goodlearnclub 长期搬运得到/樊登等课程网盘资源（注意版权风险）。");
P("");
P("**为什么可行**：频道里的教程 90% 是碎片化帖子，做成**结构化课程 + 可复现环境**就有价值。典型例子是《从零开始入坑域名、云服务器并部署 New API + Open WebUI》这类完整链路教程。");
P("");
P("**风险**：直接倒卖网盘课程属于侵权，建议走“自己重写 + 自己演示”的路线。");
P("");
P("### 赛道 6 · 低门槛自动化服务 —— 用免费工具接单");
P("");
P("**数据信号**：服务器网络类 4.9 万条；「自动化」「爬虫」合计近万次提及；频道里大量免费的自动化/爬虫/数据处理开源项目。");
P("");
P("**为什么可行**：中小企业与个体户有大量重复劳动需求（数据采集、批量处理、自动发布），而开源工具让交付成本极低。");
P("");
P("**最小路径**：把 3-5 个开源自动化工具用熟 → 在闲鱼/淘宝/小红书挂“数据采集/表格自动化”服务 → 单笔 200-2000 元。");
P("");
P("## 四、羊毛清单 TOP " + deals.length + "（免费 / 限时，按价值分排序）");
P("");
P("> 选取规则：带「免费」或「限时」标签、排除「风险」标签、按价值分排序。完整清单见 01-羊毛优惠.md。");
P("");
for (const it of deals) {
  const lk = firstLink(it);
  P("- **[" + it.value + "分]** " + cut(it.text, 170) + (lk ? "  [链接](" + lk + ")" : "") + "  <sub>" + (it.date || "").slice(0, 10) + " · @" + it.channel + " · [原文](" + it.url + ")</sub>");
}
P("");
P("## 五、开源利器 TOP " + repos.length + "（按被推荐热度，已按仓库去重）");
P("");
P("> 频道里被反复推荐、价值分最高的 GitHub 仓库，可直接作为产品原料或工具收藏。");
P("");
for (const r of repos) {
  P("- **[" + r.value + "分]** [" + r.repo + "](https://github.com/" + r.repo + ") — " + cut(r.text.replace(/https?:\/\/\S+/g, ""), 130) + "  <sub>" + (r.date || "").slice(0, 10) + " · @" + r.channel + "</sub>");
}
P("");
P("## 六、各分类 TOP 8（快速浏览）");
P("");
for (const c of ["羊毛优惠", "项目副业", "实用工具", "开源项目", "AI与科技", "服务器网络", "账号会员", "学习资源"]) {
  const arr = catTop.get(c);
  if (!arr || !arr.length) continue;
  P("### " + c + "（共 " + ((stats.byCategory || {})[c] || 0).toLocaleString() + " 条）");
  P("");
  for (const it of arr) {
    const lk = firstLink(it);
    P("- " + cut(it.text, 150) + (lk ? "  [链接](" + lk + ")" : "") + "  <sub>" + (it.date || "").slice(0, 10) + " · @" + it.channel + " · [原文](" + it.url + ")</sub>");
  }
  P("");
}
P("## 七、风险清单（务必先读）");
P("");
P("| 风险项 | 数据表现 | 建议 |");
P("|---|---|---|");
P("| 破解软件 / 激活工具 | 「破解」标签 " + tagCount("破解") + " 条 | 自用可以，**不要商用分发**，版权与法律风险由分发者承担 |");
P("| 账号 / 代充 / 礼品卡 | 账号会员类 3.3 万条；社区《Gpt Plus Pro 封号原因分析》点名低价区礼品卡 | 封号、退款纠纷、资金损失都归你；只做信息整理，不做代收代付 |");
P("| 第三方节点 / 机场 | 服务器网络类 4.9 万条 | 免费节点普遍记录流量，不要登录重要账号；付费机场有跑路风险 |");
P("| 网盘课程 / 电子书 | goodlearnclub 大量百度网盘链接 | 属侵权内容，传播/售卖风险高 |");
P("| 抽奖 / 免费额度 | 大量抽奖引流帖 | 多为引流，注意隐私与实名风险 |");
P("");
P("## 八、下一步还能做什么");
P("");
P("1. **增量更新**：scrape/scrape.mjs 支持断点续跑，每天跑一次即可保持数据最新（已完成的分段会自动跳过）。");
P("2. **换关键词**：想专攻某方向（例如只看“独立开发/出海”），改 scrape/classify.mjs 的关键词表后重跑 build.mjs 即可。");
P("3. **接通知**：把「免费+限时+分数>6」的条目推送到自己的 Telegram Bot，就是一条羊毛日报流水线。");
P("4. **扩信源**：99-推荐频道账号TOP200.md 里的账号被这些频道反复提及，可作为下一批抓取目标。");
P("");
fs.writeFileSync(path.join(OUT, "01-深度洞察与变现建议.md"), L.join("\n"), "utf8");
console.log("wrote 01-深度洞察与变现建议.md lines=", L.length, "deals=", deals.length, "repos=", repos.length);
