// Rule-based classifier, spam filter and value scorer for Telegram channel posts
export const CATS = [
  { key: "羊毛优惠", kw: ["羊毛", "白嫖", "限免", "免费领取", "免费送", "免费下载", "0元", "零元", "优惠券", "优惠码", "优惠", "特价", "折扣", "打折", "返现", "返利", "补贴", "试用", "抽奖", "红包", "福利", "免费", "降价", "促销", "薅羊毛", "白给", "限时免费", "领取", "白送", "免费版", "代金券", "满减", "秒杀", "拼团", "到手价", "抢购", "免费送", "白嫖党", "看广告免费"] },
  { key: "实用工具", kw: ["工具", "软件", "神器", "插件", "脚本", "app", "客户端", "扩展", "油猴", "tampermonkey", "chrome", "浏览器", "绿色版", "便携版", "破解", "工具站", "在线工具", "网站", "效率", "自动化", "cli", "编辑器", "摸鱼", "下载器", "转换器", "生成器"] },
  { key: "开源项目", kw: ["github", "开源", "repo", "star", "源码", "self-host", "自建", "docker", "部署", "gitlab", "gitee", "npm", "仓库", "开源项目", "开源工具"] },
  { key: "AI与科技", kw: ["ai", "人工智能", "大模型", "gpt", "chatgpt", "claude", "gemini", "deepseek", "llm", "agent", "智能体", "aigc", "midjourney", "stable diffusion", "模型", "算法", "科技", "数码", "芯片", "机器人", "元宇宙", "prompt", "提示词", "算力", "推理", "微调", "rag", "mcp"] },
  { key: "项目副业", kw: ["副业", "变现", "赚钱", "盈利", "收益", "创业", "独立开发", "indie", "接单", "外包", "电商", "跨境", "带货", "私域", "流量", "被动收入", "passive", "商机", "蓝海", "月入", "日入", "赚美金", "广告变现", "affiliate", "联盟", "项目", "零成本", "信息差", "选品", "独立站"] },
  { key: "学习资源", kw: ["教程", "课程", "电子书", "pdf", "学习", "资料", "教材", "培训", "讲座", "公开课", "入门", "指南", "手册", "文档", "题库", "笔记", "自学", "刷题", "资源合集", "干货"] },
  { key: "服务器网络", kw: ["vps", "服务器", "节点", "订阅", "机场", "科学上网", "代理", "梯子", "域名", "cdn", "hosting", "clash", "v2ray", "sing-box", "trojan", "隧道", "cn2", "cloudflare", "dns", "nat", "小鸡", "带宽", "中转", "公益站", "订阅链接"] },
  { key: "账号会员", kw: ["账号", "会员", "合租", "拼车", "共享账号", "激活码", "兑换码", "license", "授权", "年费", "订阅制", "礼品卡", "steam", "netflix", "spotify", "office", "plus", "pro号"] },
  { key: "数码硬件", kw: ["手机", "电脑", "显卡", "cpu", "nas", "路由器", "键盘", "鼠标", "耳机", "显示器", "固态", "硬盘", "主机", "笔记本", "外设", "评测", "开箱", "矿机", "内存", "主板", "机箱"] },
  { key: "资讯热点", kw: ["资讯", "新闻", "发布", "上线", "宣布", "报告", "摘要", "热议", "消息", "预告", "泄漏", "爆料", "回应", "更新", "版本"] },
];

export const HASHTAGS = {
  "工具": ["实用工具", 2], "软件": ["实用工具", 2], "神器": ["实用工具", 2], "app": ["实用工具", 1.5],
  "资源参考": ["实用工具", 1], "资源": ["实用工具", 1], "下载工具": ["实用工具", 2], "网站": ["实用工具", 1.5],
  "开源": ["开源项目", 2], "github": ["开源项目", 2], "源码": ["开源项目", 1.5], "开源项目": ["开源项目", 2],
  "ai": ["AI与科技", 1.5], "人工智能": ["AI与科技", 1.5], "大模型": ["AI与科技", 1.5], "智能体": ["AI与科技", 1.5], "gpt": ["AI与科技", 1.5],
  "白嫖": ["羊毛优惠", 2], "羊毛": ["羊毛优惠", 2], "优惠": ["羊毛优惠", 2], "免费": ["羊毛优惠", 2], "福利": ["羊毛优惠", 1.5], "薅羊毛": ["羊毛优惠", 2],
  "副业": ["项目副业", 2], "赚钱": ["项目副业", 2], "变现": ["项目副业", 2], "创业": ["项目副业", 1.5],
  "教程": ["学习资源", 2], "课程": ["学习资源", 2], "学习": ["学习资源", 1.5], "资料": ["学习资源", 1],
  "节点": ["服务器网络", 2], "vps": ["服务器网络", 2], "机场": ["服务器网络", 2], "服务器": ["服务器网络", 1.5], "科学上网": ["服务器网络", 2],
  "账号": ["账号会员", 1.5], "会员": ["账号会员", 1.5], "合租": ["账号会员", 1.5],
  "数码": ["数码硬件", 1.5], "评测": ["数码硬件", 1], "开箱": ["数码硬件", 1],
  "资讯": ["资讯热点", 0.5], "新闻": ["资讯热点", 0.5],
};

const CAT_CONTENT = {
  "羊毛优惠": 3, "项目副业": 2.5, "实用工具": 2, "开源项目": 2,
  "服务器网络": 2, "账号会员": 2, "学习资源": 1.5, "AI与科技": 1, "数码硬件": 0.5,
  "资讯热点": 0, "其他": 0,
};

export const TAGS = [
  ["免费", ["免费", "白嫖", "0元", "零元", "限免", "免费领取", "白送", "白给"]],
  ["限时", ["限时", "截止", "最后一天", "今晚", "24小时", "即将结束", "倒计时", "限时免费"]],
  ["需注册", ["注册", "报名", "填写", "申请", "问卷", "实名"]],
  ["破解", ["破解", "绿色版", "crack", "激活工具", "注册机", "po解", "去广告版", "pojie"]],
  ["风险", ["赌博", "博彩", "色情", "洗钱", "跑分", "诈骗", "割韭菜", "灰色", "黑产", "违法", "代考", "办证"]],
  ["付费", ["付费", "收费", "会员价", "赞助", "打赏", "付费下载"]],
  ["开源", ["开源", "github", "gitlab", "gitee"]],
  ["教程", ["教程", "指南", "手把手", "保姆级", "入门", "详解", "教学"]],
  ["节点", ["节点", "机场", "订阅", "科学上网", "梯子", "clash", "v2ray"]],
  ["账号", ["账号", "会员", "激活码", "兑换码", "合租", "拼车"]],
];

const SPAM = [
  [4, ["博彩", "赌博", "洗钱", "跑分", "色情", "约炮", "楼凤", "外围", "代考", "办证", "枪手", "代开发票", "黑客接单"]],
  [3, ["商务合作", "广告投放", "接广告", "广告位", "推广合作", "投放广告", "投稿联系", "商务微信", "接推广", "广告咨询", "付费推广"]],
  [2, ["招代理", "代理招募", "高额返佣", "一级代理", "拉人头", "发展下线"]],
  [1, ["加微信", "加qq", "私聊我", "扫码进群", "飞机号", "tg号", "联系我"]],
];

export function normalizeText(t) {
  if (!t) return "";
  return String(t)
    .replace(/\u200b|\ufeff/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function domainOf(u) {
  try { return new URL(u.startsWith("//") ? "https:" + u : u).hostname.replace(/^www\./, ""); }
  catch (e) { return null; }
}

export function classify(m) {
  const text = normalizeText(m.t || "");
  const lower = text.toLowerCase();
  const lpText = (m.lp || []).map(x => ((x.t || "") + " " + (x.s || "")).toLowerCase()).join(" ");
  const hay = lower + " " + lpText;

  const scores = {};
  for (const c of CATS) {
    let s = 0;
    for (const k of c.kw) if (hay.includes(k)) s += k.length >= 4 ? 1.6 : 1;
    if (s > 0) scores[c.key] = s;
  }

  const tags = [];
  for (const t of TAGS) if (t[1].some(k => hay.includes(k))) tags.push(t[0]);

  const hashtags = [];
  const hRe = /#([A-Za-z0-9_\u4e00-\u9fa5]{1,24})/g;
  let hm;
  while ((hm = hRe.exec(text))) {
    const raw = hm[1];
    const k = raw.toLowerCase();
    hashtags.push(raw);
    const map = HASHTAGS[k];
    if (map) {
      scores[map[0]] = (scores[map[0]] || 0) + map[1];
      if (!tags.includes(map[0])) tags.push(map[0]);
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = ranked.length ? ranked[0][0] : "其他";
  const labels = ranked.filter(e => e[1] >= 1.5).slice(0, 4).map(e => e[0]);
  if (!labels.length) labels.push("其他");

  let spam = 0;
  const spamHits = [];
  for (const sw of SPAM) for (const k of sw[1]) if (hay.includes(k)) { spam += sw[0]; spamHits.push(k); }
  const links = [...(m.lk || []), ...(m.lp || []).map(x => x.u)].filter(Boolean);
  if (text.length < 12 && links.length && !tags.includes("免费")) spam += 2;

  let content = CAT_CONTENT[primary] || 0;
  if (tags.includes("免费")) content += 1;
  if (tags.includes("限时")) content += 0.5;
  if (tags.includes("教程")) content += 0.5;
  if (tags.includes("开源")) content += 0.5;
  if (links.some(u => /github\.com/.test(u))) content += 1;
  if (tags.includes("风险")) content -= 3;
  if (text.length < 8 && !links.length) content -= 2;

  const pop = Math.min(2, Math.log10(1 + (m.v || 0)) * 0.7);
  const recent = m.ts && (Date.now() / 1000 - m.ts) < 180 * 86400 ? 0.5 : 0;
  const value = +(content + pop + recent).toFixed(2);

  const domains = [...new Set(links.map(domainOf).filter(Boolean))];

  return { text, primary, cats: labels, tags, hashtags, spam: +spam.toFixed(1), spamHits, content: +content.toFixed(2), value, domains, links };
}
