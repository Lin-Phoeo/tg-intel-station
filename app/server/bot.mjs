// Telegram 机器人：群内命令 + 情报日报推送
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.mjs';
import { appendRaw } from './rawlog.mjs';
import * as ai from './ai.mjs';
import { classify } from '../../core/classify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_PATH = path.join(ROOT, 'app', 'data', 'bot.json');

const DEFAULTS = {
  enabled: false,
  token: '',
  pushChatId: '',
  allowedChatIds: '',
  autoPush: false,
  pushHour: 9,
  pushMinValue: 5,
  pushTags: ['免费', '限时'],
  pushLimit: 8,
  windowDays: 4,
  allowAsk: true,
  ingestGroups: false,
  pushedIds: [],
  lastPushDate: '',
};

export function loadConfig() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}

export function saveConfig(patch) {
  const cur = loadConfig();
  const next = Object.assign({}, cur, patch || {});
  if (patch && !patch.token) next.token = cur.token;
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function publicConfig() {
  const c = loadConfig();
  return {
    enabled: c.enabled, hasToken: !!c.token,
    tokenHint: c.token ? c.token.slice(0, 8) + '…' + c.token.slice(-4) : '',
    pushChatId: c.pushChatId, allowedChatIds: c.allowedChatIds,
    autoPush: c.autoPush, pushHour: c.pushHour, pushMinValue: c.pushMinValue,
    pushTags: c.pushTags, pushLimit: c.pushLimit, windowDays: c.windowDays,
    allowAsk: c.allowAsk, lastPushDate: c.lastPushDate,
    pushedCount: (c.pushedIds || []).length,
    ingestGroups: c.ingestGroups,
    ingestedCount: (status.ingested || 0),
    lastIngest: status.lastIngest || null,
  };
}

// ---------------- 群消息收录（公开预览页抓不到群，机器人可以）----------------
function extractLinks(msg, text) {
  const out = [];
  const push = (u) => { if (u && /^https?:/i.test(u) && out.indexOf(u) < 0) out.push(u); };
  for (const e of (msg.entities || msg.caption_entities || [])) {
    if (e.type === 'text_link' && e.url) push(e.url);
    else if (e.type === 'url') push(text.slice(e.offset, e.offset + e.length));
  }
  const m = text.match(/https?:\/\/[^\s<>"'）)】]+/g);
  if (m) for (const u of m) push(u);
  return out.slice(0, 12);
}

function domainList(links) {
  const out = [];
  for (const u of links) {
    try { const h = new URL(u).hostname.replace(/^www./, ''); if (out.indexOf(h) < 0) out.push(h); } catch (e) {}
  }
  return out;
}

async function ingestGroupMessage(msg) {
  const c = loadConfig();
  if (!c.ingestGroups) return;
  const chatType = (msg.chat && msg.chat.type) || '';
  if (chatType !== 'group' && chatType !== 'supergroup') return;
  if (msg.from && msg.from.is_bot) return;
  const raw = (msg.text || msg.caption || '').trim();
  if (raw.length < 8) return;
  if (raw.charAt(0) === '/') return;

  const chatId = String(msg.chat.id);
  const channel = msg.chat.username ? ('g_' + msg.chat.username) : ('group_' + chatId);
  const links = extractLinks(msg, raw);
  const domains = domainList(links);

  let cls;
  try { cls = classify({ t: raw, lk: links, lp: [], v: 0, ts: msg.date, d: msg.date ? new Date(msg.date * 1000).toISOString() : null }); }
  catch (e) { return; }

  const author = [msg.from && msg.from.first_name, msg.from && msg.from.last_name].filter(Boolean).join(' ') || (msg.from && msg.from.username) || '';
  let r;
  const rec = {
    channel: channel, msgId: msg.message_id,
    date: msg.date ? new Date(msg.date * 1000).toISOString().slice(0, 10) : '',
    ts: msg.date || 0,
    text: cls.text, category: cls.primary, categories: (cls.cats || []).join(','),
    tags: (cls.tags || []).join(','), hashtags: (cls.hashtags || []).join(','),
    value: cls.value, content: cls.content,
    url: 'https://t.me/' + (msg.chat.username ? msg.chat.username : 'c/' + chatId) + '/' + msg.message_id,
    links: links.join(' '), domains: domains.join(' '), lpTitle: '',
    source: 'group', author: author, groupTitle: msg.chat.title || '',
  };
  try {
    r = store.insertPost(rec);
    if (r.inserted) appendRaw(rec);
  } catch (e) { status.lastError = '写入群消息失败：' + String(e.message || e); return; }

  if (r.inserted) {
    status.ingested = (status.ingested || 0) + 1;
    status.lastIngest = { chat: msg.chat.title || chatId, text: cls.text.slice(0, 60), category: cls.primary, at: Date.now() };
  }
}

// ---------------- Telegram API ----------------
// 可指向自建 Bot API 服务器；测试时也可指向本地 mock
function apiRoot() { return String(process.env.TG_API_BASE || 'https://api.telegram.org').replace(/\/+$/, ''); }
function apiBase(token) { return apiRoot() + '/bot' + token; }

export async function callApi(method, payload, tokenOverride) {
  const token = tokenOverride || loadConfig().token;
  if (!token) throw new Error('未配置 Bot Token');
  const res = await fetch(apiBase(token) + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(40000),
  });
  const j = await res.json().catch(() => null);
  if (!j || !j.ok) throw new Error('Telegram: ' + String((j && j.description) || ('HTTP ' + res.status)));
  return j.result;
}

export async function getMe(tokenOverride) { return callApi('getMe', {}, tokenOverride); }

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendMessage(chatId, html, opts) {
  const body = Object.assign({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }, opts || {});
  return callApi('sendMessage', body);
}

// ---------------- 日报 ----------------
export function buildDigest(opts) {
  const cfg = loadConfig();
  const o = Object.assign({}, cfg, opts || {});
  const from = new Date(Date.now() - (o.windowDays || 4) * 86400000).toISOString().slice(0, 10);
  const r = store.search({ q: '', tags: o.pushTags || [], from: from, sort: 'value', size: 80, minValue: o.pushMinValue || 5 });
  const pushed = new Set(cfg.pushedIds || []);
  const items = (r.items || []).filter(x => !pushed.has(x.id)).slice(0, o.pushLimit || 8);

  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push('⚡ <b>电报情报日报</b> · ' + today);
  if (!items.length) {
    lines.push('');
    lines.push('今天没有新的高分羊毛/工具条目。可以放宽筛选条件，或先跑一次抓取。');
    return { html: lines.join('\n'), items: [], count: 0 };
  }
  lines.push('精选 <b>' + items.length + '</b> 条 · 标签 ' + (o.pushTags || []).join('/') + ' · 分数 ≥ ' + o.pushMinValue);
  items.forEach((it, i) => {
    const link = (it.links && it.links[0]) || (it.lp && it.lp[0] && it.lp[0].u) || '';
    const domain = (it.domains && it.domains[0]) || '';
    let text = String(it.text || '').replace(/\s+/g, ' ').trim();
    if (text.length > 180) text = text.slice(0, 180) + '…';
    lines.push('');
    lines.push('<b>' + (i + 1) + '. [' + it.category + '·' + it.value + '分]</b> ' + esc(text));
    const meta = [];
    if (link) meta.push('<a href="' + esc(link) + '">' + esc(domain || '资源链接') + '</a>');
    meta.push('<a href="' + esc(it.url) + '">原文</a>');
    meta.push(esc('@' + it.channel + ' · ' + (it.date || '')));
    lines.push('　' + meta.join(' · '));
  });
  let html = lines.join('\n');
  if (html.length > 3900) html = html.slice(0, 3900) + '\n…（内容过长已截断）';
  return { html: html, items: items, count: items.length };
}

export async function pushDigest(chatId, opts) {
  const cfg = loadConfig();
  const target = chatId || cfg.pushChatId;
  if (!target) throw new Error('未设置推送目标群/频道');
  const d = buildDigest(opts);
  await sendMessage(target, d.html);
  if (d.items.length) {
    const ids = (cfg.pushedIds || []).concat(d.items.map(x => x.id));
    saveConfig({ pushedIds: ids.slice(-5000), lastPushDate: new Date().toISOString().slice(0, 10) });
  }
  return { sent: d.count, chatId: target, html: d.html };
}

// ---------------- 群内命令 ----------------
function allowed(chatId) {
  const c = loadConfig();
  const list = String(c.allowedChatIds || '').split(/[\s,]+/).filter(Boolean);
  if (!list.length) return true;
  return list.indexOf(String(chatId)) >= 0;
}

function helpText() {
  return [
    '🤖 <b>电报情报站机器人</b>',
    '',
    '我接的是本地那个 85 万条频道库，直接在群里用：',
    '',
    '/so <关键词> — 搜情报（例：<code>/so 免费 VPS</code>）',
    '/free — 最近的免费/限时高分羊毛',
    '/ask <问题> — 让 AI 检索后回答',
    '/sub — 把这个群设为日报推送目标',
    '/unsub — 取消订阅',
    '/id — 查看这个群的 chat id',
    '/status — 运行状态',
    '',
    '想收日报就在群里发 /sub。',
  ].join('\n');
}

async function reply(chatId, html, messageId) {
  const body = { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
  if (messageId) body.reply_to_message_id = messageId;
  try { await callApi('sendMessage', body); }
  catch (e) { await callApi('sendMessage', { chat_id: chatId, text: html, disable_web_page_preview: true }); }
}

function formatResults(items, title) {
  if (!items.length) return title + '\n\n没搜到。换个关键词试试。';
  const out = [title, ''];
  items.forEach((it, i) => {
    let t = String(it.text || '').replace(/\s+/g, ' ').trim();
    if (t.length > 150) t = t.slice(0, 150) + '…';
    const link = (it.links && it.links[0]) || '';
    out.push('<b>' + (i + 1) + '.</b> ' + esc(t));
    const meta = [];
    if (link) meta.push('<a href="' + esc(link) + '">链接</a>');
    meta.push('<a href="' + esc(it.url) + '">原文</a>');
    meta.push(esc('@' + it.channel + ' · ' + (it.date || '') + ' · ' + it.value + '分'));
    out.push('　' + meta.join(' · '));
    out.push('');
  });
  let html = out.join('\n');
  if (html.length > 3900) html = html.slice(0, 3900) + '\n…';
  return html;
}

async function handleUpdate(u) {
  const msg = u.message || u.channel_post || u.edited_message;
  if (!msg) return;
  if (msg.text && msg.text.charAt(0) !== '/') {
    await ingestGroupMessage(msg);
    return;
  }
  if (!msg.text) return;
  const chatId = msg.chat.id;
  const chatTitle = msg.chat.title || msg.chat.username || msg.chat.first_name || String(chatId);
  const text = msg.text.trim();
  if (!allowed(chatId)) { await reply(chatId, '这个群没有权限使用。', msg.message_id); return; }

  const m = text.match(/^\/([A-Za-z_]+)(?:@[A-Za-z0-9_]+)?\s*([\s\S]*)$/);
  if (!m) return;
  const cmd = m[1].toLowerCase();
  const arg = (m[2] || '').trim();
  await ingestGroupMessage(msg);
  status.lastCommand = { cmd: cmd, chat: chatTitle, at: Date.now() };

  try {
    if (cmd === 'start' || cmd === 'help') { await reply(chatId, helpText(), msg.message_id); return; }

    if (cmd === 'id') {
      await reply(chatId, '这个会话的 chat id：<code>' + chatId + '</code>\n标题：' + esc(chatTitle), msg.message_id);
      return;
    }

    if (cmd === 'status') {
      const c = loadConfig();
      const f = store.facets();
      await reply(chatId, [
        '📊 <b>运行状态</b>',
        '索引帖子：' + Number((f.meta && f.meta.count) || 0).toLocaleString() + ' 条',
        'AI 模型：' + (ai.hasKey() ? '已配置' : '未配置（/ask 不可用）'),
        '日报推送：' + (c.pushChatId ? ('已设置 ' + c.pushChatId + (c.autoPush ? ' · 每天 ' + c.pushHour + ' 点' : ' · 仅手动')) : '未设置'),
        '已推送条目：' + (c.pushedIds || []).length,
        '群消息收录：' + (c.ingestGroups ? ('已开启 · 本次运行收录 ' + (status.ingested || 0) + ' 条') : '未开启'),
      ].join('\n'), msg.message_id);
      return;
    }

    if (cmd === 'sub') {
      saveConfig({ pushChatId: String(chatId) });
      await reply(chatId, '✅ 已把本群设为日报推送目标。\n用户可在应用里打开「每天自动推送」，或随时手动推。', msg.message_id);
      return;
    }
    if (cmd === 'unsub') {
      const c = loadConfig();
      if (String(c.pushChatId) === String(chatId)) saveConfig({ pushChatId: '' });
      await reply(chatId, '已取消本群的日报推送。', msg.message_id);
      return;
    }

    if (cmd === 'so' || cmd === 'search') {
      if (!arg) { await reply(chatId, '用法：<code>/so 免费 VPS</code>', msg.message_id); return; }
      const r = store.search({ q: arg, sort: 'relevance', size: 5, minValue: 0 });
      await reply(chatId, formatResults(r.items, '🔍 「' + esc(arg) + '」 找到约 ' + Number(r.total).toLocaleString() + ' 条，前 5 条：'), msg.message_id);
      return;
    }

    if (cmd === 'free') {
      const cfg = loadConfig();
      const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const r = store.search({ q: '', tags: ['免费', '限时'], from: from, sort: 'value', size: 6, minValue: 5 });
      await reply(chatId, formatResults(r.items, '🎁 近 7 天免费/限时高分羊毛：'), msg.message_id);
      return;
    }

    if (cmd === 'ask') {
      const c = loadConfig();
      if (!c.allowAsk) { await reply(chatId, '本群未开启 /ask。', msg.message_id); return; }
      if (!arg) { await reply(chatId, '用法：<code>/ask 最近有什么免费额度可以薅</code>', msg.message_id); return; }
      if (!ai.hasKey()) { await reply(chatId, '⚠️ 还没在应用里配置 AI 模型，暂时只能用 /so 搜索。', msg.message_id); return; }
      await reply(chatId, '🔎 正在检索并思考…', msg.message_id);
      const posts = ai.retrieve(arg, {}, ai.loadSettings().topK || 14);
      const msgs = ai.buildMessages(arg, posts, []);
      const answer = await ai.completeLLM(msgs);
      const out = answer.length > 3600 ? answer.slice(0, 3600) + '…' : answer;
      await reply(chatId, esc(out), msg.message_id);
      return;
    }
  } catch (e) {
    status.lastError = String(e.message || e);
    await reply(chatId, '出错了：' + esc(String(e.message || e)), msg.message_id).catch(() => {});
  }
}

// ---------------- 长轮询 + 定时 ----------------
const status = { running: false, me: null, lastError: null, lastUpdateAt: null, lastCommand: null, startedAt: null, updates: 0, ingested: 0, lastIngest: null };
let stopFlag = false;
let loopPromise = null;
let schedTimer = null;

export function getStatus() {
  const c = loadConfig();
  return {
    running: status.running, me: status.me, lastError: status.lastError,
    lastUpdateAt: status.lastUpdateAt, lastCommand: status.lastCommand,
    startedAt: status.startedAt, updates: status.updates,
    autoPush: c.autoPush, pushHour: c.pushHour, lastPushDate: c.lastPushDate,
  };
}

async function loop() {
  const cfg = loadConfig();
  let offset = 0;
  try {
    const me = await getMe(cfg.token);
    status.me = { id: me.id, username: me.username, name: me.first_name };
    status.running = true;
    status.lastError = null;
  } catch (e) {
    status.running = false;
    status.lastError = 'Token 校验失败：' + String(e.message || e);
    return;
  }
  while (!stopFlag) {
    const c = loadConfig();
    if (!c.enabled || !c.token) break;
    try {
      const updates = await callApi('getUpdates', { offset: offset, timeout: 30, allowed_updates: ['message', 'channel_post', 'edited_message'] }, c.token);
      if (!updates || !updates.length) { await new Promise(r => setTimeout(r, 800)); continue; }
      for (const u of updates) {
        offset = u.update_id + 1;
        status.updates++;
        status.lastUpdateAt = Date.now();
        await handleUpdate(u);
      }
    } catch (e) {
      status.lastError = String(e.message || e);
      await new Promise(r => setTimeout(r, 4000));
    }
  }
  status.running = false;
}

function scheduleLoop() {
  if (schedTimer) clearInterval(schedTimer);
  schedTimer = setInterval(async () => {
    const c = loadConfig();
    if (!c.enabled || !c.autoPush || !c.pushChatId) return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() !== Number(c.pushHour)) return;
    if (c.lastPushDate === today) return;
    try { await pushDigest(c.pushChatId); status.lastError = null; }
    catch (e) { status.lastError = '自动推送失败：' + String(e.message || e); }
  }, 5 * 60 * 1000);
}

export function start() {
  const c = loadConfig();
  if (!c.enabled || !c.token) { status.running = false; return { started: false, reason: '未启用或未配置 Token' }; }
  if (loopPromise) return { started: false, reason: '已在运行' };
  stopFlag = false;
  loopPromise = loop().finally(() => { loopPromise = null; });
  scheduleLoop();
  return { started: true };
}

export function stop() {
  stopFlag = true;
  if (loopPromise) { try { callApi('getUpdates', { offset: -1, timeout: 0, limit: 1 }).catch(() => {}); } catch (e) {} }
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  status.running = false;
  return { stopped: true };
}

export function restart() { stop(); return start(); }
