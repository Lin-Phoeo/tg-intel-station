# 网盘资源结构化提取模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把情报库里约 1 万条帖子中的网盘分享链接抽成结构化条目，做一个可筛选、可看详情与全部来源的独立页面，并用 AI 整理类别、标签与简介。

**Architecture:** 纯解析逻辑放 `core/netdisk.mjs`（无 DB、无网络，易单测）；建表与数据读写由 `app/server/store.mjs` 承担（保持「store 是唯一写库方」）；扫描编排在 `app/server/netdisk.mjs`；AI 整理在 `app/server/netdisk-ai.mjs`（复刻 `ai-classify.mjs` 的批处理范式）；HTTP 路由集中在 `app/server/index.mjs`；前端新增独立页面 `NetdiskPanel.tsx`。

**Tech Stack:** Node ≥24、`node:sqlite`、`node:http`、`node:test`、React 19 + TypeScript + Vite。不新增任何依赖。

**Spec:** `docs/superpowers/specs/2026-10-15-netdisk-resource-module-design.md`

## Global Constraints

- 不联网：不请求任何分享页，资源名只取自帖子文本。
- 不新增 npm 依赖，不新增数据库之外的存储。
- `store.mjs` 是唯一写库方；建表、迁移、写入都在 store 内完成。
- 不改检索/RAG/评测标答、Telegram、`posts` 表结构、日报与同步既有行为（同步只新增一个「完成后触发增量扫描」的旁路调用）。
- **不提交、不推送**：本项目长期规则是未经用户明确要求不 commit。本计划中每个任务末尾的「检查点」步骤只运行测试与 `git diff --check`，不执行 `git commit`。若用户已明确授权提交，再按需补 commit。
- 平台识别与提取码正则移植自 `syhyz1990/panAI`，不自行发明。
- 嵌套 `node --test` 必须剥离 `NODE_TEST_CONTEXT` 并断言子测试确实执行（`/ℹ pass [1-9]/`）。
- UI 改动必须 `npm run build:web` 并用浏览器验收，不能只用构建代替。

## Review Focus

1. **同一分享链接被多频道分享** → 合并为一条，`sources` 列全来源、`merge_count` 正确，绝不产生重复行（唯一键 `(platform, share_key)`）。
2. **蓝奏云 / 123 盘多域名变体** → 归一到同一 `platform`，`share_key` 提取正确（`qiuyw.lanzouq.com/xxx`、`1812337903.share.123pan.cn/123pan/xxx`）。
3. **提取码边界** → 无提取码返回空串；URL 上 `?pwd=`/`?p=` 优先；正文 `提取码：abcd` 能取到；不误吞正文里无关的 4 位数字。
4. **空/畸形输入** → 空文本、无链接、`javascript:` 伪链接不写入条目、不抛异常。
5. **扫描幂等与增量游标** → 同一批帖子重复扫描不重复插入；增量只处理游标之后的新帖子，全量忽略游标。

---

## File Structure

- Create `core/netdisk.mjs` —— 纯函数：平台表、`detectPlatform`、`normalizeShareUrl`、`parsePwd`、`cleanTitle`、`extractNetdisk`。
- Modify `app/server/store.mjs` —— 新增 `netdisk_resources` 表、迁移与数据函数。
- Create `app/server/netdisk.mjs` —— 扫描编排与状态。
- Create `app/server/netdisk-ai.mjs` —— AI 整理后台任务。
- Modify `app/server/sync.mjs` —— 同步完成后触发一次增量扫描（旁路、不阻断）。
- Modify `app/server/index.mjs` —— 新增 `/api/netdisk*` 路由与参数校验。
- Modify `app/web/src/api.ts` —— 类型与请求函数。
- Create `app/web/src/components/NetdiskPanel.tsx` —— 独立页面。
- Modify `app/web/src/App.tsx` —— 新增 `view='netdisk'`、导航按钮、命令面板入口、主区渲染。
- Create `test/netdisk-parse.test.mjs`、`test/netdisk-store.test.mjs`、`test/netdisk-scan.test.mjs`、`test/netdisk-ai.test.mjs`、`test/netdisk-routes.test.mjs`、`test/fixtures/netdisk-routes.mjs`。
- Modify `docs/07-交接文档.md`、`README.md`。

---

### Task 1: 纯解析层 `core/netdisk.mjs`

**Files:**
- Create: `core/netdisk.mjs`
- Test: `test/netdisk-parse.test.mjs`

**Interfaces:**
- Produces:
  - `PLATFORMS: Array<{key:string,label:string,frag:string,host:RegExp,re:RegExp}>`
  - `detectPlatform(url:string) -> {platform:string,shareKey:string} | null`
  - `normalizeShareUrl(url:string) -> string`
  - `parsePwd(text:string, url:string) -> string`（空串表示无）
  - `cleanTitle(text:string) -> string`
  - `extractNetdisk(links:string[], text:string) -> Array<{platform,shareKey,shareUrl,pwd}>`

- [ ] **Step 1: 写失败测试**

创建 `test/netdisk-parse.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, detectPlatform, normalizeShareUrl, parsePwd, cleanTitle, extractNetdisk } from '../core/netdisk.mjs';

test('平台识别：语料里真实出现过的链接', () => {
  assert.deepEqual(detectPlatform('https://pan.quark.cn/s/e58c8afd10c6'), { platform: 'quark', shareKey: 'e58c8afd10c6' });
  assert.deepEqual(detectPlatform('https://qiuyw.lanzouq.com/iFQs23r46m2f'), { platform: 'lanzou', shareKey: 'iFQs23r46m2f' });
  assert.deepEqual(detectPlatform('https://1812337903.share.123pan.cn/123pan/2zw8Vv-L9EAH'), { platform: 'pan123', shareKey: '2zw8Vv-L9EAH' });
  assert.deepEqual(detectPlatform('https://pan.baidu.com/s/1a2b3cXd'), { platform: 'baidu', shareKey: '1a2b3cXd' });
  assert.deepEqual(detectPlatform('https://www.aliyundrive.com/s/abc123XYZ'), { platform: 'aliyun', shareKey: 'abc123XYZ' });
  assert.deepEqual(detectPlatform('https://pan.xunlei.com/s/VN-abcdefghijklmn'), { platform: 'xunlei', shareKey: 'VN-abcdefghijklmn' });
});

test('平台识别：蓝奏多域名归一', () => {
  for (const u of ['https://wwa.lanzoui.com/abc123', 'https://www.lanzoux.com/abc123', 'https://lanzn.com/abc123']) {
    assert.equal(detectPlatform(u).platform, 'lanzou', u);
  }
});

test('平台识别：非网盘与伪链接返回 null', () => {
  assert.equal(detectPlatform('https://github.com/a/b'), null);
  assert.equal(detectPlatform('javascript:alert(1)'), null);
  assert.equal(detectPlatform(''), null);
});

test('normalizeShareUrl 去查询、去哈希、小写域名、去尾标点', () => {
  assert.equal(normalizeShareUrl('https://Pan.Quark.CN/s/AbC?entry=x#frag'), 'https://pan.quark.cn/s/AbC');
  assert.equal(normalizeShareUrl('https://pan.baidu.com/s/1a2b3cXd）'), 'https://pan.baidu.com/s/1a2b3cXd');
});

test('提取码：无码返回空串', () => {
  assert.equal(parsePwd('夸克盘资源下载', 'https://pan.quark.cn/s/abc'), '');
});

test('提取码：URL 上的 pwd/p 参数优先', () => {
  assert.equal(parsePwd('随便写点说明', 'https://pan.baidu.com/s/1a2b3cXd?pwd=k9m2'), 'k9m2');
  assert.equal(parsePwd('', 'https://pan.quark.cn/s/abc?p=8h3k'), '8h3k');
});

test('提取码：正文里的「提取码：xxxx」', () => {
  assert.equal(parsePwd('资源说明\n提取码：abcd\n请自取', 'https://pan.baidu.com/s/1x'), 'abcd');
  assert.equal(parsePwd('密码 8h3k', 'https://pan.baidu.com/s/1x'), '8h3k');
});

test('提取码：不误吞正文里无关的数字', () => {
  assert.equal(parsePwd('2026年10月更新，共 1234 个文件', 'https://pan.quark.cn/s/abc'), '');
});

test('cleanTitle：剥模板噪音与 Telegram 尾巴', () => {
  const t = '🙂标题：洛雪音乐_v2.12.3 Beta.2绿色版 免费听音乐 🙂说明：聚合多平台音乐搜索接口 🙂下载地址：夸克盘 / 蓝奏云 🙂标签：#洛雪音乐 #pc #音乐 Please open Telegram to view this post VIEW IN TELEGRAM ❤4';
  assert.equal(cleanTitle(t), '洛雪音乐_v2.12.3 Beta.2绿色版 免费听音乐');
});

test('cleanTitle：无「标题：」时取第一句', () => {
  assert.equal(cleanTitle('小宾AI抠图 本地离线AI抠图神器。支持 Windows 与 macOS。'), '小宾AI抠图 本地离线AI抠图神器');
});

test('extractNetdisk：从 links 与 text 里去重抽出网盘条目', () => {
  const links = ['https://pan.quark.cn/s/e58c8afd10c6', 'https://qiuyw.lanzouq.com/iFQs23r46m2f', 'https://t.me/x/1'];
  const text = '下载地址：夸克盘 / 蓝奏云 提取码：abcd https://pan.quark.cn/s/e58c8afd10c6';
  const out = extractNetdisk(links, text);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(x => x.platform).sort(), ['lanzou', 'quark']);
  assert.equal(out.find(x => x.platform === 'quark').pwd, 'abcd');
});

test('extractNetdisk：空输入返回空数组且不抛错', () => {
  assert.deepEqual(extractNetdisk([], ''), []);
  assert.deepEqual(extractNetdisk(['javascript:alert(1)'], 'no link here'), []);
});

test('PLATFORMS 覆盖语料里出现的全部平台', () => {
  const keys = PLATFORMS.map(p => p.key);
  for (const k of ['quark', 'baidu', 'aliyun', 'lanzou', 'pan123', 'xunlei', '115', 'tianyi', 'caiyun', 'weiyun', 'uc', 'google', 'mega', 'pikpak']) {
    assert.ok(keys.includes(k), 'missing platform ' + k);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/netdisk-parse.test.mjs`
Expected: FAIL，`Cannot find module '../core/netdisk.mjs'`

- [ ] **Step 3: 实现 `core/netdisk.mjs`**

```js
// 网盘分享链接解析（纯函数，无 DB、无网络）
// 平台识别与提取码正则移植自 syhyz1990/panAI。

// frag 是 domains 字段里的子串，供扫描时 SQL 预筛用。
export const PLATFORMS = [
  { key: 'quark', label: '夸克网盘', frag: 'pan.quark.cn', host: /pan\.quark\.cn/, re: /https?:\/\/pan\.quark\.cn\/s\/([a-zA-Z\d-]+)/i },
  { key: 'baidu', label: '百度网盘', frag: 'pan.baidu.com', host: /(pan|e?yun)\.baidu\.com/, re: /https?:\/\/(?:e?yun|pan)\.baidu\.com\/(?:doc\/|enterprise\/)?(?:s\/([\w~-]+)|share\/(\S{4,}))/i },
  { key: 'aliyun', label: '阿里云盘', frag: 'aliyundrive.com', host: /(aliyundrive|alipan)\.com|alywp\.net/, re: /https?:\/\/(?:(?:www\.)?(?:aliyundrive|alipan)\.com\/s|alywp\.net)\/([a-zA-Z\d]+)/i },
  { key: 'lanzou', label: '蓝奏云', frag: 'lanzou', host: /(lanzou[a-z]|lanzn)\.com/, re: /https?:\/\/(?:[a-zA-Z0-9\-.]+)?(?:lanzou[a-z]|lanzn)\.com\/([a-zA-Z\d_-]+)/i },
  { key: 'pan123', label: '123 盘', frag: '123pan', host: /123pan\.(com|cn)|123684\.com|123865\.com|123912\.com/, re: /https?:\/\/(?:[a-zA-Z0-9\-.]+)?(?:123pan\.(?:com|cn)|123684\.com|123865\.com|123912\.com)\/(?:s\/|123pan\/)?([\w-]{6,})/i },
  { key: 'xunlei', label: '迅雷云盘', frag: 'pan.xunlei.com', host: /pan\.xunlei\.com/, re: /https?:\/\/pan\.xunlei\.com\/s\/([\w-]{8,})/i },
  { key: '115', label: '115 网盘', frag: '115.com', host: /(115\.com|115cdn\.com|anxia\.com)/, re: /https?:\/\/(?:115\.com|115cdn\.com|anxia\.com)\/s\/([a-zA-Z\d]+)/i },
  { key: 'tianyi', label: '天翼云盘', frag: 'cloud.189.cn', host: /cloud\.189\.cn/, re: /https?:\/\/cloud\.189\.cn\/(?:t\/|web\/share\?code=)?([a-zA-Z\d]+)/i },
  { key: 'caiyun', label: '和彩云', frag: 'caiyun.139.com', host: /caiyun\.139\.com/, re: /https?:\/\/caiyun\.139\.com\/(?:m\/i|w\/i\/|web\/|front\/#\/detail)\??(?:linkID=)?([a-zA-Z\d]+)/i },
  { key: 'weiyun', label: '腾讯微云', frag: 'weiyun.com', host: /share\.weiyun\.com/, re: /https?:\/\/share\.weiyun\.com\/([a-zA-Z\d]+)/i },
  { key: 'uc', label: 'UC 网盘', frag: 'drive.uc.cn', host: /drive\.uc\.cn/, re: /https?:\/\/drive\.uc\.cn\/s\/([a-zA-Z\d]+)/i },
  { key: 'ctfile', label: '城通网盘', frag: 'ctfile', host: /(ctfile|545c|u062)\.com/, re: /https?:\/\/(?:[a-zA-Z\d\-.]+)?(?:ctfile|545c|u062)\.com\/\w+\/([a-zA-Z\d-]+)/i },
  { key: 'cowtransfer', label: '奶牛快传', frag: 'cowtransfer.com', host: /cowtransfer\.com/, re: /https?:\/\/(?:[a-zA-Z\d\-.]+)?cowtransfer\.com\/s\/([a-zA-Z\d]+)/i },
  { key: 'wenshushu', label: '文叔叔', frag: 'wenshushu', host: /(wenshushu|ws28)\.cn/, re: /https?:\/\/(?:www\.wenshushu|ws28)\.cn\/(?:k|box|f)\/(\w+)/i },
  { key: 'jianguoyun', label: '坚果云', frag: 'jianguoyun.com', host: /jianguoyun\.com/, re: /https?:\/\/www\.jianguoyun\.com\/p\/([\w-]+)/i },
  { key: 'flowus', label: 'FlowUs', frag: 'flowus.cn', host: /flowus\.cn/, re: /https?:\/\/flowus\.cn\/[\S ^/]*\/?share\/([a-z\d-]{20,})/i },
  { key: 'google', label: 'Google Drive', frag: 'drive.google.com', host: /drive\.google\.com/, re: /https?:\/\/drive\.google\.com\/(?:file\/d\/|drive\/folders\/|open\?id=)([a-zA-Z\d_-]+)/i },
  { key: 'mega', label: 'MEGA', frag: 'mega.nz', host: /mega\.(nz|co\.nz)/, re: /https?:\/\/mega\.(?:nz|co\.nz)\/(?:#F!|file\/|folder\/)?([\w!-]{8,})/i },
  { key: 'pikpak', label: 'PikPak', frag: 'pikpak', host: /(mypikpak|pikpak)\.(com|me)/, re: /https?:\/\/(?:mypikpak\.com|pikpak\.me)\/s\/([\w-]+)/i },
  { key: 'mediafire', label: 'MediaFire', frag: 'mediafire.com', host: /mediafire\.com/, re: /https?:\/\/www\.mediafire\.com\/file\/([\w-]+)/i },
  { key: 'wetransfer', label: 'WeTransfer', frag: 'wetransfer.com', host: /wetransfer\.com/, re: /https?:\/\/wetransfer\.com\/downloads\/([\w-]+)/i },
];

export function detectPlatform(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return null;
  for (const p of PLATFORMS) {
    const m = u.match(p.re);
    if (m && m[1]) return { platform: p.key, shareKey: m[1] };
  }
  for (const p of PLATFORMS) {
    if (p.host.test(u)) {
      try { const seg = new URL(u).pathname.split('/').filter(Boolean).pop() || ''; if (seg) return { platform: p.key, shareKey: seg }; } catch (e) {}
    }
  }
  return null;
}

export function normalizeShareUrl(url) {
  const raw = String(url || '').trim().replace(/[）)】\]，,。.、；;!！?？"'”’]+$/, '');
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch (e) { return raw; }
}

const PWD_RE = /wss:[a-zA-Z0-9]+|(?<=\s*(?:密|提取|访问|訪問|key|password|pwd|#|\?p=)\s*[码碼]?\s*[：:=]?\s*)[a-zA-Z0-9]{3,8}/i;

export function parsePwd(text, url) {
  const u = String(url || '');
  const qm = u.match(/[?&](?:pwd|p)=([a-zA-Z0-9]{3,8})/i);
  if (qm) return qm[1];
  const t = String(text || '').replace(/​/g, '').replace(/%3A/gi, ':');
  const m = t.match(PWD_RE);
  return m ? m[0].replace(/^wss:/i, '') : '';
}

const TG_NOISE = /Please open Telegram to view this post[\s\S]*$/i;

export function cleanTitle(text) {
  let t = String(text || '').replace(/​/g, '').replace(TG_NOISE, '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/标题\s*[：:]\s*(.+?)(?=\s*(?:说明|简介|下载地址|标签|资源|链接|类型)\s*[：:]|$)/);
  if (m && m[1]) t = m[1];
  else t = t.split(/[。！？!?]/)[0];
  t = t.replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '');
  t = t.replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 120);
}

export function extractNetdisk(links, text) {
  const urls = [];
  for (const u of (Array.isArray(links) ? links : [])) if (u) urls.push(String(u));
  const inText = String(text || '').match(/https?:\/\/[^\s<>"'）)】\]]+/g);
  if (inText) for (const u of inText) urls.push(u);

  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const d = detectPlatform(u);
    if (!d) continue;
    const k = d.platform + '|' + d.shareKey;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ platform: d.platform, shareKey: d.shareKey, shareUrl: normalizeShareUrl(u), pwd: parsePwd(text, u) });
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/netdisk-parse.test.mjs`
Expected: PASS，全部断言通过

- [ ] **Step 5: 检查点（不提交）**

Run: `node --check core/netdisk.mjs && git diff --check`
Expected: 无输出、退出码 0。不要 `git commit`。

---

### Task 2: 表结构与数据函数（`app/server/store.mjs`）

**Files:**
- Modify: `app/server/store.mjs`
- Test: `test/netdisk-store.test.mjs`

**Interfaces:**
- Consumes: 无（独立表）。
- Produces:
  - `netdiskUpsert(rec) -> {inserted?:boolean, merged?:boolean, id:number}`，`rec = {platform, shareKey, shareUrl, pwd, title, postId, channel, postDate, postUrl, value}`
  - `netdiskList(opts) -> {total:number, page:number, size:number, items:NetdiskRow[]}`
  - `netdiskFacets() -> {platforms:{k,n}[], categories:{k,n}[], total:number}`
  - `netdiskGet(id) -> NetdiskRow | null`
  - `netdiskPendingCount() -> number`
  - `netdiskPending(limit) -> Array<{id, title, text}>`
  - `netdiskSaveAi(rows) -> number`，`rows = Array<{id, category, tags, summary, aiTitle}>`
  - `NetdiskRow = {id, platform, shareUrl, shareKey, pwd, title, aiTitle, aiSummary, category, tags, postId, channel, postDate, value, sources, mergeCount, aiAt}`

- [ ] **Step 1: 写失败测试**

创建 `test/netdisk-store.test.mjs`：

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = path.join(os.tmpdir(), 'tg-netdisk-store-' + process.pid + '-' + Date.now() + '.db');
process.env.DB_PATH = tmp;
const store = await import('../app/server/store.mjs');

after(() => {
  store.close();
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
});

function post(over) {
  return Object.assign({
    channel: 'ndtest', msgId: Math.floor(Math.random() * 1e9), date: '2026-10-10', ts: 1791580000,
    text: '测试资源', category: '实用工具', tags: '', value: 6,
    url: 'https://t.me/ndtest/1', links: '', domains: '',
  }, over);
}

test('netdiskUpsert 首次插入', () => {
  const r = store.netdiskUpsert({ platform: 'quark', shareKey: 'abc1', shareUrl: 'https://pan.quark.cn/s/abc1', pwd: 'k9m2', title: '资源A', postId: 1, channel: 'c1', postDate: '2026-10-10', postUrl: 'https://t.me/c1/1', value: 6 });
  assert.equal(r.inserted, true);
  const list = store.netdiskList({});
  assert.equal(list.total, 1);
  assert.equal(list.items[0].shareKey, 'abc1');
  assert.equal(list.items[0].pwd, 'k9m2');
  assert.equal(list.items[0].mergeCount, 1);
});

test('netdiskUpsert 同 (platform,shareKey) 合并来源，不新增行', () => {
  store.netdiskUpsert({ platform: 'quark', shareKey: 'abc1', shareUrl: 'https://pan.quark.cn/s/abc1', title: '资源A', postId: 2, channel: 'c2', postDate: '2026-10-11', postUrl: 'https://t.me/c2/2', value: 3 });
  const list = store.netdiskList({});
  assert.equal(list.total, 1);
  const row = list.items[0];
  assert.equal(row.mergeCount, 2);
  assert.equal(row.sources.length, 2);
  assert.deepEqual(row.sources.map(s => s.channel).sort(), ['c1', 'c2']);
});

test('netdiskUpsert 同 postId 重复并入幂等', () => {
  const before = store.netdiskList({}).items[0].mergeCount;
  store.netdiskUpsert({ platform: 'quark', shareKey: 'abc1', shareUrl: 'https://pan.quark.cn/s/abc1', title: '资源A', postId: 2, channel: 'c2', postDate: '2026-10-11', postUrl: 'https://t.me/c2/2', value: 3 });
  assert.equal(store.netdiskList({}).items[0].mergeCount, before);
});

test('netdiskUpsert 高价值来源成为主来源', () => {
  store.netdiskUpsert({ platform: 'quark', shareKey: 'abc1', shareUrl: 'https://pan.quark.cn/s/abc1', title: '资源A', postId: 3, channel: 'c3', postDate: '2026-10-12', postUrl: 'https://t.me/c3/3', value: 9 });
  const row = store.netdiskList({}).items[0];
  assert.equal(row.channel, 'c3');
  assert.equal(row.value, 9);
});

test('netdiskList 按平台与关键词筛选', () => {
  store.netdiskUpsert({ platform: 'baidu', shareKey: 'bd1', shareUrl: 'https://pan.baidu.com/s/bd1', title: '教程合集', postId: 4, channel: 'c4', postDate: '2026-10-10', postUrl: 'https://t.me/c4/4', value: 5 });
  assert.equal(store.netdiskList({ platform: 'baidu' }).total, 1);
  assert.equal(store.netdiskList({ q: '教程' }).total, 1);
  assert.equal(store.netdiskList({ q: '不存在的词xyz' }).total, 0);
  assert.equal(store.netdiskList({}).total, 2);
});

test('netdiskFacets 返回平台计数', () => {
  const f = store.netdiskFacets();
  assert.equal(f.total, 2);
  assert.ok(f.platforms.some(p => p.k === 'quark' && p.n === 1));
});

test('netdiskPending 只返回未整理条目', () => {
  assert.equal(store.netdiskPendingCount(), 2);
  const pend = store.netdiskPending(10);
  assert.equal(pend.length, 2);
  assert.ok(pend[0].id > 0);
});

test('netdiskSaveAi 写回并清空待办', () => {
  const ids = store.netdiskPending(10).map(r => r.id);
  store.netdiskSaveAi(ids.map(id => ({ id, category: '软件工具', tags: '工具,免费', summary: '一句话简介', aiTitle: '规范标题' })));
  assert.equal(store.netdiskPendingCount(), 0);
  const row = store.netdiskGet(ids[0]);
  assert.equal(row.category, '软件工具');
  assert.equal(row.aiTitle, '规范标题');
  assert.ok(row.aiAt);
});

test('netdiskGet 不存在返回 null', () => {
  assert.equal(store.netdiskGet(999999), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/netdisk-store.test.mjs`
Expected: FAIL，`store.netdiskUpsert is not a function`

- [ ] **Step 3: 建表**

在 `app/server/store.mjs` 的 `createSchema()` 末尾（`idx_posts_rep_value` 那行之后）加：

```js
  db.exec([
    'CREATE TABLE IF NOT EXISTS netdisk_resources(',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  platform TEXT NOT NULL, share_url TEXT, share_key TEXT NOT NULL, pwd TEXT DEFAULT \'\',',
    '  title TEXT DEFAULT \'\', ai_title TEXT DEFAULT \'\', ai_summary TEXT DEFAULT \'\',',
    '  category TEXT DEFAULT \'\', tags TEXT DEFAULT \'\',',
    '  post_id INTEGER, channel TEXT, post_date TEXT, value REAL,',
    '  sources TEXT DEFAULT \'[]\', merge_count INTEGER DEFAULT 1,',
    '  created_at TEXT, updated_at TEXT, ai_at TEXT',
    ')',
  ].join('\n'));
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_nd_key ON netdisk_resources(platform, share_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_nd_platform ON netdisk_resources(platform)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_nd_category ON netdisk_resources(category)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_nd_ai ON netdisk_resources(ai_at)');
```

并在 `migrate()` 末尾追加同样的 `CREATE TABLE IF NOT EXISTS ... / CREATE INDEX IF NOT EXISTS ...` 语句（旧库升级路径）。

- [ ] **Step 4: 加数据函数**

在 `app/server/store.mjs` 末尾（`textOf` 之后）追加：

```js
// ---------- 网盘资源 ----------
const ND_COLS = 'id,platform,share_url,share_key,pwd,title,ai_title,ai_summary,category,tags,post_id,channel,post_date,value,sources,merge_count,ai_at';

function ndRow(r) {
  return {
    id: Number(r.id), platform: String(r.platform || ''), shareUrl: String(r.share_url || ''),
    shareKey: String(r.share_key || ''), pwd: String(r.pwd || ''), title: String(r.title || ''),
    aiTitle: String(r.ai_title || ''), aiSummary: String(r.ai_summary || ''),
    category: String(r.category || ''), tags: String(r.tags || ''),
    postId: r.post_id == null ? null : Number(r.post_id), channel: String(r.channel || ''),
    postDate: String(r.post_date || ''), value: Number(r.value || 0),
    sources: (() => { try { return JSON.parse(r.sources || '[]'); } catch (e) { return []; } })(),
    mergeCount: Number(r.merge_count || 1), aiAt: r.ai_at || null,
  };
}

export function netdiskUpsert(rec) {
  const d = open();
  const now = new Date().toISOString();
  const src = { post_id: rec.postId, channel: rec.channel || '', date: rec.postDate || '', url: rec.postUrl || '', value: Number(rec.value || 0) };
  const ex = d.prepare('SELECT id,sources,merge_count,post_id,value,pwd,title FROM netdisk_resources WHERE platform = ? AND share_key = ?').get(rec.platform, rec.shareKey);
  if (!ex) {
    const r = d.prepare('INSERT INTO netdisk_resources(platform,share_url,share_key,pwd,title,category,tags,post_id,channel,post_date,value,sources,merge_count,created_at,updated_at,ai_at) VALUES(?,?,?,?,?,\'\',\'\',?,?,?,?,?,1,?,?,NULL)')
      .run(rec.platform, rec.shareUrl || '', rec.shareKey, rec.pwd || '', rec.title || '', rec.postId, rec.channel || '', rec.postDate || '', Number(rec.value || 0), JSON.stringify([src]), now, now);
    return { inserted: true, id: Number(r.lastInsertRowid) };
  }
  const id = Number(ex.id);
  const list = (() => { try { return JSON.parse(ex.sources || '[]'); } catch (e) { return []; } })();
  if (list.some(s => s.post_id === rec.postId)) return { merged: false, id };
  list.push(src);
  // 主来源取价值更高者；价值相同时保留原主来源（更早）
  const mainId = Number(rec.value || 0) > Number(ex.value || 0) ? rec.postId : ex.post_id;
  const mainChannel = Number(rec.value || 0) > Number(ex.value || 0) ? (rec.channel || '') : undefined;
  const mainDate = Number(rec.value || 0) > Number(ex.value || 0) ? (rec.postDate || '') : undefined;
  const mainValue = Number(rec.value || 0) > Number(ex.value || 0) ? Number(rec.value || 0) : Number(ex.value || 0);
  d.prepare('UPDATE netdisk_resources SET sources = ?, merge_count = ?, updated_at = ?, post_id = ?, value = ?'
    + (mainChannel !== undefined ? ', channel = ?, post_date = ?' : '')
    + ' WHERE id = ?')
    .run(...(mainChannel !== undefined
      ? [JSON.stringify(list), list.length, now, mainId, mainValue, mainChannel, mainDate, id]
      : [JSON.stringify(list), list.length, now, mainId, mainValue, id]));
  // 补齐缺失的提取码/标题
  if ((!ex.pwd && rec.pwd) || (!ex.title && rec.title)) {
    d.prepare('UPDATE netdisk_resources SET pwd = COALESCE(NULLIF(pwd,\'\'),?), title = COALESCE(NULLIF(title,\'\'),?) WHERE id = ?')
      .run(rec.pwd || '', rec.title || '', id);
  }
  return { merged: true, id };
}

function netdiskFilters(opts) {
  const { platform = '', category = '', q = '', from = '', to = '' } = opts || {};
  const where = [];
  const params = [];
  if (platform) { where.push('platform = ?'); params.push(platform); }
  if (category) { where.push('category = ?'); params.push(category); }
  if (from) { where.push('post_date >= ?'); params.push(from); }
  if (to) { where.push('post_date <= ?'); params.push(to); }
  if (q) { where.push("(title LIKE ? OR ai_title LIKE ? OR tags LIKE ?)"); const like = '%' + q + '%'; params.push(like, like, like); }
  return { where, params };
}

export function netdiskList(opts) {
  const { sort = 'date', page = 1, size = 30 } = opts || {};
  const d = open();
  const { where, params } = netdiskFilters(opts);
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const order = sort === 'value' ? 'value DESC, id DESC' : sort === 'title' ? 'COALESCE(NULLIF(ai_title,\'\'),title) ASC' : 'COALESCE(post_date,\'\') DESC, id DESC';
  const lim = Math.min(100, Math.max(1, Number(size) || 30));
  const off = (Math.max(1, Number(page) || 1) - 1) * lim;
  const items = d.prepare('SELECT ' + ND_COLS + ' FROM netdisk_resources' + w + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?').all(...params, lim, off).map(ndRow);
  const total = Number(d.prepare('SELECT COUNT(*) AS n FROM netdisk_resources' + w).get(...params).n);
  return { total, page: Number(page) || 1, size: lim, items };
}

export function netdiskFacets() {
  const d = open();
  const platforms = d.prepare('SELECT platform AS k, COUNT(*) AS n FROM netdisk_resources GROUP BY platform ORDER BY n DESC').all();
  const categories = d.prepare("SELECT category AS k, COUNT(*) AS n FROM netdisk_resources WHERE category != '' GROUP BY category ORDER BY n DESC").all();
  const total = Number(d.prepare('SELECT COUNT(*) AS n FROM netdisk_resources').get().n);
  return { platforms, categories, total };
}

export function netdiskGet(id) {
  const r = open().prepare('SELECT ' + ND_COLS + ' FROM netdisk_resources WHERE id = ?').get(Number(id));
  return r ? ndRow(r) : null;
}

export function netdiskPendingCount() {
  return Number(open().prepare('SELECT COUNT(*) AS n FROM netdisk_resources WHERE ai_at IS NULL').get().n);
}

export function netdiskPending(limit) {
  return open().prepare('SELECT r.id, r.title, p.text FROM netdisk_resources r LEFT JOIN posts p ON p.id = r.post_id WHERE r.ai_at IS NULL ORDER BY r.id ASC LIMIT ?')
    .all(Number(limit || 20))
    .map(r => ({ id: Number(r.id), title: String(r.title || ''), text: String(r.text || '') }));
}

export function netdiskSaveAi(rows) {
  const d = open();
  const at = new Date().toISOString();
  const stmt = d.prepare('UPDATE netdisk_resources SET category = ?, tags = ?, ai_summary = ?, ai_title = ?, ai_at = ? WHERE id = ?');
  d.exec('BEGIN');
  for (const r of rows) stmt.run(r.category || '', r.tags || '', r.summary || '', r.aiTitle || '', at, Number(r.id));
  d.exec('COMMIT');
  return rows.length;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/netdisk-store.test.mjs`
Expected: PASS

- [ ] **Step 6: 跑全量测试确认未破坏既有行为**

Run: `npm test`
Expected: 既有 86 项 + 新增用例全部通过，无失败

- [ ] **Step 7: 检查点（不提交）**

Run: `git diff --check`
Expected: 无输出。不要 `git commit`。

---

### Task 3: 扫描管线（`app/server/netdisk.mjs`）

**Files:**
- Create: `app/server/netdisk.mjs`
- Modify: `app/server/sync.mjs`
- Test: `test/netdisk-scan.test.mjs`

**Interfaces:**
- Consumes: `core/netdisk.mjs` 的 `PLATFORMS`/`extractNetdisk`/`cleanTitle`；`store.netdiskUpsert`；`store.getState`/`setState`/`open`。
- Produces:
  - `scanPosts(mode) -> {scanned:number, found:number, inserted:number, merged:number, maxId:number}`，`mode` 为 `'full' | 'incremental'`
  - `startScan(mode) -> {ok:boolean, started:boolean, error?:string}`
  - `getScanStatus() -> {running, mode, scanned, found, inserted, merged, startedAt, finishedAt, error}`
  - `lastScanCursor() -> number`

- [ ] **Step 1: 写失败测试**

创建 `test/netdisk-scan.test.mjs`：

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = path.join(os.tmpdir(), 'tg-netdisk-scan-' + process.pid + '-' + Date.now() + '.db');
process.env.DB_PATH = tmp;
const store = await import('../app/server/store.mjs');
const netdisk = await import('../app/server/netdisk.mjs');

after(() => {
  store.close();
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
});

let mid = 0;
function seed(text, links, domains) {
  return store.insertPost({
    channel: 'scanchan', msgId: ++mid, date: '2026-10-10', ts: 1791580000 + mid,
    text, category: '实用工具', tags: '', value: 6,
    url: 'https://t.me/scanchan/' + mid, links, domains,
  }).id;
}

test('scanPosts 从帖子抽出网盘条目', () => {
  seed('🙂标题：洛雪音乐绿色版 🙂下载地址：夸克盘 / 蓝奏云 🙂标签：#音乐 Please open Telegram to view this post', 'https://pan.quark.cn/s/aaa111 https://qiuyw.lanzouq.com/bbb222', 'pan.quark.cn qiuyw.lanzouq.com');
  const r = netdisk.scanPosts('full');
  assert.equal(r.inserted, 2);
  const list = store.netdiskList({});
  assert.equal(list.total, 2);
  const quark = list.items.find(x => x.platform === 'quark');
  assert.equal(quark.title, '洛雪音乐绿色版');
  assert.equal(quark.channel, 'scanchan');
});

test('scanPosts 增量：无新帖子时零插入', () => {
  const r = netdisk.scanPosts('incremental');
  assert.equal(r.inserted, 0);
  assert.equal(r.merged, 0);
});

test('scanPosts 增量：只处理游标之后的新帖子', () => {
  seed('新资源 标题：工具X 下载地址：夸克盘', 'https://pan.quark.cn/s/ccc333', 'pan.quark.cn');
  const r = netdisk.scanPosts('incremental');
  assert.equal(r.inserted, 1);
  assert.equal(store.netdiskList({}).total, 3);
});

test('scanPosts 全量幂等：重复全量不新增行', () => {
  const before = store.netdiskList({}).total;
  const r = netdisk.scanPosts('full');
  assert.equal(r.inserted, 0);
  assert.equal(store.netdiskList({}).total, before);
});

test('scanPosts 同一链接多频道合并', () => {
  store.insertPost({ channel: 'otherchan', msgId: 9001, date: '2026-10-11', ts: 1791589999, text: '同一资源 标题：工具X', category: '实用工具', value: 8, url: 'https://t.me/otherchan/9001', links: 'https://pan.quark.cn/s/ccc333', domains: 'pan.quark.cn' });
  netdisk.scanPosts('full');
  const row = store.netdiskList({ platform: 'quark', q: '工具X' }).items[0];
  assert.equal(row.mergeCount, 2);
  assert.equal(row.channel, 'otherchan'); // 价值 8 > 6，成为主来源
});

test('scanPosts 无网盘链接的帖子不写入', () => {
  const before = store.netdiskList({}).total;
  seed('普通帖子，没有网盘链接 https://github.com/a/b', 'https://github.com/a/b', 'github.com');
  netdisk.scanPosts('full');
  assert.equal(store.netdiskList({}).total, before);
});

test('startScan 后台运行并落状态', async () => {
  const s = netdisk.startScan('incremental');
  assert.equal(s.ok, true);
  assert.equal(s.started, true);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(netdisk.getScanStatus().running, false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/netdisk-scan.test.mjs`
Expected: FAIL，`Cannot find module '../app/server/netdisk.mjs'`

- [ ] **Step 3: 实现 `app/server/netdisk.mjs`**

```js
// 网盘资源扫描：把 posts 里的网盘分享链接抽成结构化条目。
// 纯本地：不联网、不调用 AI。
import * as store from './store.mjs';
import { PLATFORMS, extractNetdisk, cleanTitle } from '../../core/netdisk.mjs';

const CURSOR_KEY = 'netdisk:scannedPostId';
const BATCH = 2000;

const status = { running: false, mode: '', scanned: 0, found: 0, inserted: 0, merged: 0, startedAt: null, finishedAt: null, error: null };

export function getScanStatus() { return Object.assign({}, status); }
export function lastScanCursor() { return Number(store.getState(CURSOR_KEY, '0')) || 0; }

function ndWhere() {
  return PLATFORMS.map(() => 'domains LIKE ?').join(' OR ');
}
function ndParams() {
  return PLATFORMS.map(p => '%' + p.frag + '%');
}

export function scanPosts(mode) {
  const d = store.open();
  const sinceId = mode === 'full' ? 0 : lastScanCursor();
  status.mode = mode; status.scanned = 0; status.found = 0; status.inserted = 0; status.merged = 0; status.error = null;

  let cursor = sinceId;
  const sql = 'SELECT id,text,links,channel,date,url,value FROM posts WHERE id > ? AND (' + ndWhere() + ') ORDER BY id ASC LIMIT ?';
  const stmt = d.prepare(sql);
  const params = ndParams();

  for (;;) {
    const rows = stmt.all(cursor, ...params, BATCH);
    if (!rows.length) break;
    for (const row of rows) {
      cursor = Number(row.id);
      status.scanned++;
      const links = String(row.links || '').split(/\s+/).filter(Boolean);
      const items = extractNetdisk(links, row.text);
      if (!items.length) continue;
      const title = cleanTitle(row.text);
      for (const it of items) {
        status.found++;
        const r = store.netdiskUpsert({
          platform: it.platform, shareKey: it.shareKey, shareUrl: it.shareUrl, pwd: it.pwd,
          title, postId: Number(row.id), channel: row.channel || '', postDate: row.date || '',
          postUrl: row.url || '', value: Number(row.value || 0),
        });
        if (r.inserted) status.inserted++; else if (r.merged) status.merged++;
      }
    }
    if (rows.length < BATCH) break;
  }

  if (cursor > sinceId) store.setState(CURSOR_KEY, String(cursor));
  return { scanned: status.scanned, found: status.found, inserted: status.inserted, merged: status.merged, maxId: cursor };
}

export function startScan(mode) {
  if (status.running) return { ok: false, error: '已有扫描任务在进行中' };
  const m = mode === 'full' ? 'full' : 'incremental';
  status.running = true; status.startedAt = Date.now(); status.finishedAt = null;
  Promise.resolve().then(() => scanPosts(m)).catch(e => {
    status.error = String(e.message || e);
  }).finally(() => {
    status.running = false; status.finishedAt = Date.now();
  });
  return { ok: true, started: true };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/netdisk-scan.test.mjs`
Expected: PASS

- [ ] **Step 5: 在同步完成后触发增量扫描**

在 `app/server/sync.mjs` 的 `runFullSync` 里、`return { ok: true, imported: ... }` 之前插入：

```js
  // 一键补齐完成后跑一次增量网盘扫描（纯本地、不联网）。失败不阻断同步结果。
  try {
    const netdisk = await import('./netdisk.mjs');
    netdisk.startScan('incremental');
  } catch (e) { /* 扫描失败不影响同步 */ }
```

- [ ] **Step 6: 验证同步模块未破坏**

Run: `node --check app/server/sync.mjs && npm test`
Expected: 语法检查通过，全部测试通过

- [ ] **Step 7: 检查点（不提交）**

Run: `git diff --check`
Expected: 无输出。不要 `git commit`。

---

### Task 4: AI 整理（`app/server/netdisk-ai.mjs`）

**Files:**
- Create: `app/server/netdisk-ai.mjs`
- Test: `test/netdisk-ai.test.mjs`

**Interfaces:**
- Consumes: `store.netdiskPending`/`netdiskPendingCount`/`netdiskSaveAi`；`ai.completeLLM`/`ai.hasKey`/`ai.activeProfile`。
- Produces:
  - `ND_CATS: string[]`
  - `buildPrompt(rows) -> string`
  - `parseAnswer(text, rows) -> Array<{id, category, tags, summary, aiTitle}>`
  - `getStatus() -> {running, done, total, failed, current, startedAt, finishedAt, error}`
  - `startOrganize(opts) -> {ok, started?, total?, error?}`
  - `requestStop() -> boolean`

- [ ] **Step 1: 写失败测试**

创建 `test/netdisk-ai.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ND_CATS, buildPrompt, parseAnswer } from '../app/server/netdisk-ai.mjs';

const rows = [
  { id: 11, title: '洛雪音乐绿色版', text: '🙂标题：洛雪音乐 聚合多平台音乐搜索' },
  { id: 12, title: 'PS 2024 安装包', text: '🙂标题：PS 2024 设计素材' },
];

test('ND_CATS 是固定类别集', () => {
  assert.ok(ND_CATS.includes('软件工具'));
  assert.ok(ND_CATS.includes('其他'));
  assert.equal(ND_CATS.length, 10);
});

test('buildPrompt 包含类别集与每条序号', () => {
  const p = buildPrompt(rows);
  assert.ok(p.includes('软件工具'));
  assert.ok(p.includes('1. '));
  assert.ok(p.includes('2. '));
  assert.ok(p.includes('洛雪音乐'));
});

test('parseAnswer 解析定长行', () => {
  const out = parseAnswer('1|软件工具|音乐,开源|聚合多平台音乐搜索|洛雪音乐\n2|软件工具|设计,素材|PS 安装包|PS2024安装包', rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 11);
  assert.equal(out[0].category, '软件工具');
  assert.equal(out[0].tags, '音乐,开源');
  assert.equal(out[1].aiTitle, 'PS2024安装包');
});

test('parseAnswer 越界类别归一为其他、坏行跳过', () => {
  const out = parseAnswer('1|随便编的类|标签|简介|标题\n这一行是废话\n2|影视|电影|高清资源|某电影', rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].category, '其他');
  assert.equal(out[1].category, '影视');
});

test('parseAnswer 空输入返回空数组', () => {
  assert.deepEqual(parseAnswer('', rows), []);
  assert.deepEqual(parseAnswer(null, rows), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/netdisk-ai.test.mjs`
Expected: FAIL，`Cannot find module '../app/server/netdisk-ai.mjs'`

- [ ] **Step 3: 实现 `app/server/netdisk-ai.mjs`**

```js
// 网盘资源 AI 整理：归类、打标签、写简介、规范标题。
// 复刻 ai-classify.mjs 的范式：定长行输出、坏行跳过、可停、可续跑。
import * as store from './store.mjs';
import * as ai from './ai.mjs';

export const ND_CATS = ['软件工具', '教程课程', '影视', '音乐', '游戏', '电子书', '素材模板', '系统镜像', '办公文档', '其他'];
const BATCH = 15;

let state = { running: false, done: 0, total: 0, failed: 0, current: '', startedAt: null, finishedAt: null, error: null, stop: false };

export function getStatus() { return Object.assign({}, state, { pending: store.netdiskPendingCount() }); }
export function requestStop() { state.stop = true; return true; }

export function buildPrompt(rows) {
  const lines = [];
  lines.push('你在整理网盘资源清单。下面每条给出资源名和原帖片段，请判断它是什么。');
  lines.push('');
  lines.push('可选类别（必须从这里选）：' + ND_CATS.join(' / '));
  lines.push('');
  lines.push('每条输出一行，格式固定为：');
  lines.push('序号|类别|标签(逗号分隔,最多3个)|一句话简介(不超过30字)|规范标题(不超过30字)');
  lines.push('');
  lines.push('除了这些行不要输出任何其它内容。');
  lines.push('');
  lines.push('=== 资源 ===');
  rows.forEach((r, i) => {
    const t = String(r.text || '').replace(/\s+/g, ' ').slice(0, 200);
    lines.push((i + 1) + '. ' + (r.title || '') + ' ｜ ' + t);
  });
  return lines.join('\n');
}

export function parseAnswer(text, rows) {
  const byIndex = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(/^\||\|$/g, '');
    if (!line) continue;
    const m = line.match(/^(\d+)\s*[|｜]\s*([^|｜]+?)\s*[|｜]\s*([^|｜]*?)\s*[|｜]\s*([^|｜]*?)\s*[|｜]\s*(.*)$/);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (idx < 0 || idx >= rows.length) continue;
    let cat = String(m[2]).trim();
    if (ND_CATS.indexOf(cat) < 0) {
      const hit = ND_CATS.find(k => cat.indexOf(k) >= 0 || k.indexOf(cat) >= 0);
      cat = hit || '其他';
    }
    byIndex[idx] = {
      id: rows[idx].id, category: cat,
      tags: String(m[3]).trim().slice(0, 60),
      summary: String(m[4]).trim().slice(0, 60),
      aiTitle: String(m[5] || '').trim().slice(0, 60),
    };
  }
  const out = [];
  for (let i = 0; i < rows.length; i++) if (byIndex[i]) out.push(byIndex[i]);
  return out;
}

export async function runOrganize(opts) {
  if (state.running) return { ok: false, error: '已有整理任务在进行中' };
  const o = opts || {};
  const limit = Number(o.limit || 0);
  const total = store.netdiskPendingCount();
  const target = limit > 0 ? Math.min(limit, total) : total;
  if (!target) return { ok: false, error: '没有待整理的网盘条目' };

  state = { running: true, done: 0, total: target, failed: 0, current: '', startedAt: Date.now(), finishedAt: null, error: null, stop: false };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    while (state.done + state.failed < target) {
      if (state.stop) break;
      const want = Math.min(BATCH, target - state.done - state.failed);
      const rows = store.netdiskPending(want);
      if (!rows.length) break;
      state.current = String(rows[0].title || '').slice(0, 40);
      let answer = '';
      try {
        answer = await ai.completeLLM([
          { role: 'system', content: '你只输出规定格式的行，不输出任何其它内容。' },
          { role: 'user', content: buildPrompt(rows) },
        ], o.profileId || undefined);
      } catch (e) {
        state.failed += rows.length;
        state.error = String(e.message || e).slice(0, 200);
        if (state.failed >= BATCH * 3) break;
        await sleep(1200);
        continue;
      }
      const parsed = parseAnswer(answer, rows);
      if (parsed.length) { store.netdiskSaveAi(parsed); state.done += parsed.length; }
      await sleep(120);
    }
  } catch (e) { state.error = String(e.message || e).slice(0, 300); }

  state.running = false; state.finishedAt = Date.now(); state.current = '';
  return { ok: !state.error, done: state.done, failed: state.failed, error: state.error || null };
}

export function startOrganize(opts) {
  if (state.running) return { ok: false, error: '已有整理任务在进行中' };
  if (!ai.hasKey()) return { ok: false, error: '还没配置 AI 模型' };
  runOrganize(opts).catch(e => { state.running = false; state.error = String(e.message || e); state.finishedAt = Date.now(); });
  return { ok: true, started: true, total: Number((opts && opts.limit) || 0) || store.netdiskPendingCount() };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/netdisk-ai.test.mjs`
Expected: PASS

- [ ] **Step 5: 检查点（不提交）**

Run: `node --check app/server/netdisk-ai.mjs && git diff --check`
Expected: 无输出。不要 `git commit`。

---

### Task 5: API 路由与隔离测试

**Files:**
- Modify: `app/server/index.mjs`
- Create: `test/fixtures/netdisk-routes.mjs`
- Create: `test/netdisk-routes.test.mjs`

**Interfaces:**
- Consumes: `store.netdiskList`/`netdiskFacets`/`netdiskGet`；`netdisk.startScan`/`getScanStatus`；`netdiskAi.startOrganize`/`getStatus`/`requestStop`。
- Produces HTTP：
  - `GET /api/netdisk?platform&category&q&from&to&sort&page&size` → `{total,page,size,items}`
  - `GET /api/netdisk/facets` → `{platforms,categories,total}`
  - `GET /api/netdisk/:id` → 行对象或 404
  - `GET /api/netdisk/export?format=md|csv&...` → 文本下载
  - `POST /api/netdisk/scan` `{mode}` → `{ok,started}`
  - `GET /api/netdisk/scan/status` → 状态
  - `POST /api/netdisk/ai` `{limit}` → `{ok,started,total}`
  - `GET /api/netdisk/ai/status` → 状态
  - `POST /api/netdisk/ai/stop` → `{ok}`

- [ ] **Step 1: 写路由 fixture**

创建 `test/fixtures/netdisk-routes.mjs`：

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-netdisk-route-'));
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
});
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.PORT = String(port);
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(input, options);
  throw new Error('network forbidden in netdisk route tests');
};
process.env.NODE_ENV = 'test';

const store = await import('../../app/server/store.mjs');
store.netdiskUpsert({ platform: 'quark', shareKey: 'aaa', shareUrl: 'https://pan.quark.cn/s/aaa', pwd: 'k9m2', title: '洛雪音乐', postId: 1, channel: 'c1', postDate: '2026-10-10', postUrl: 'https://t.me/c1/1', value: 6 });
store.netdiskUpsert({ platform: 'baidu', shareKey: 'bbb', shareUrl: 'https://pan.baidu.com/s/bbb', title: '教程合集', postId: 2, channel: 'c2', postDate: '2026-10-09', postUrl: 'https://t.me/c2/2', value: 5 });

const serverModule = await import('../../app/server/index.mjs');
const server = serverModule.server;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
const base = 'http://127.0.0.1:' + port;
const get = async (route) => { const r = await fetch(base + route); return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() }; };

after(async () => {
  await new Promise(r => server.close(r));
  store.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
});

test('GET /api/netdisk 返回全部条目', async () => {
  const r = await get('/api/netdisk');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.text);
  assert.equal(j.total, 2);
  assert.equal(j.items.length, 2);
});

test('GET /api/netdisk 按平台筛选', async () => {
  const j = JSON.parse((await get('/api/netdisk?platform=baidu')).text);
  assert.equal(j.total, 1);
  assert.equal(j.items[0].platform, 'baidu');
});

test('GET /api/netdisk 非法 size 被夹紧', async () => {
  const j = JSON.parse((await get('/api/netdisk?size=9999')).text);
  assert.ok(j.size <= 100);
});

test('GET /api/netdisk/facets 返回平台计数', async () => {
  const j = JSON.parse((await get('/api/netdisk/facets')).text);
  assert.equal(j.total, 2);
  assert.ok(j.platforms.some(p => p.k === 'quark'));
});

test('GET /api/netdisk/:id 返回详情与全部来源', async () => {
  const id = JSON.parse((await get('/api/netdisk')).text).items[0].id;
  const j = JSON.parse((await get('/api/netdisk/' + id)).text);
  assert.equal(j.id, id);
  assert.ok(Array.isArray(j.sources));
});

test('GET /api/netdisk/:id 不存在返回 404', async () => {
  assert.equal((await get('/api/netdisk/999999')).status, 404);
});

test('GET /api/netdisk/export 返回 Markdown 附件', async () => {
  const r = await get('/api/netdisk/export?format=md');
  assert.equal(r.status, 200);
  assert.ok(r.type.includes('text/markdown'));
  assert.ok(r.text.includes('洛雪音乐'));
  assert.ok(r.text.includes('pan.quark.cn/s/aaa'));
});

test('GET /api/netdisk/export CSV 含表头', async () => {
  const r = await get('/api/netdisk/export?format=csv');
  assert.ok(r.type.includes('text/csv'));
  assert.ok(r.text.split('\n')[0].includes('platform'));
});

test('POST /api/netdisk/scan 启动扫描', async () => {
  const r = await fetch(base + '/api/netdisk/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'incremental' }) });
  const j = await r.json();
  assert.equal(j.ok, true);
});

test('POST /api/netdisk/ai 无模型时给出明确错误', async () => {
  const r = await fetch(base + '/api/netdisk/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 5 }) });
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.ok(j.error);
});
```

创建 `test/netdisk-routes.test.mjs`：

```js
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('netdisk HTTP routes work in an isolated service', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const out = execFileSync(process.execPath, [
    '--test', fileURLToPath(new URL('./fixtures/netdisk-routes.mjs', import.meta.url)),
  ], { encoding: 'utf8', stdio: 'pipe', timeout: 60000, env });
  if (!/ℹ pass [1-9]/.test(out)) throw new Error('netdisk route fixture did not execute tests:\n' + out);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/netdisk-routes.test.mjs`
Expected: FAIL（fixture 内断言失败：路由不存在）

- [ ] **Step 3: 加路由**

在 `app/server/index.mjs` 顶部 import 区加：

```js
import * as netdisk from './netdisk.mjs';
import * as netdiskAi from './netdisk-ai.mjs';
```

在 `if (pathname === '/api/briefing/run' ...)` 之后插入（注意：`/facets`、`/export`、`/scan`、`/ai` 必须排在 `/api/netdisk/:id` 之前）：

```js
  if (pathname === '/api/netdisk/facets') return send(res, 200, store.netdiskFacets());

  if (pathname === '/api/netdisk/scan/status') return send(res, 200, netdisk.getScanStatus());
  if (pathname === '/api/netdisk/scan' && req.method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, netdisk.startScan(body.mode === 'full' ? 'full' : 'incremental'));
  }

  if (pathname === '/api/netdisk/ai/status') return send(res, 200, Object.assign({}, netdiskAi.getStatus(), { pending: store.netdiskPendingCount() }));
  if (pathname === '/api/netdisk/ai/stop' && req.method === 'POST') return send(res, 200, { ok: netdiskAi.requestStop() });
  if (pathname === '/api/netdisk/ai' && req.method === 'POST') {
    const body = await readBody(req);
    const limit = Number(body.limit || 0);
    if (!Number.isFinite(limit) || limit < 0 || limit > 100000) return send(res, 400, { ok: false, error: '条数范围无效' });
    return send(res, 200, netdiskAi.startOrganize({ limit }));
  }

  if (pathname === '/api/netdisk/export') {
    const opts = netdiskQuery(query);
    const rows = store.netdiskList(Object.assign({}, opts, { page: 1, size: 100 })).items;
    const fmt = query.format === 'csv' ? 'csv' : query.format === 'json' ? 'json' : 'md';
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="netdisk-' + stamp + '.json"' });
      return res.end(JSON.stringify(rows, null, 2));
    }
    if (fmt === 'csv') {
      const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      const head = ['platform', 'title', 'ai_title', 'category', 'tags', 'pwd', 'share_url', 'channel', 'post_date', 'value'];
      const lines = [head.join(',')].concat(rows.map(r => [r.platform, r.title, r.aiTitle, r.category, r.tags, r.pwd, r.shareUrl, r.channel, r.postDate, r.value].map(esc).join(',')));
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="netdisk-' + stamp + '.csv"' });
      return res.end('﻿' + lines.join('\n'));
    }
    const md = ['# 网盘资源清单 · ' + stamp, '', '共 ' + rows.length + ' 条', ''].concat(rows.map(r => {
      const t = r.aiTitle || r.title || '(无标题)';
      const pwd = r.pwd ? ' 提取码 `' + r.pwd + '`' : '';
      return '- **' + t + '** · ' + r.platform + (r.category ? ' · ' + r.category : '') + '\n  ' + r.shareUrl + pwd + '\n  来源 @' + r.channel + ' · ' + r.postDate;
    }));
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="netdisk-' + stamp + '.md"' });
    return res.end(md.join('\n'));
  }

  if (pathname === '/api/netdisk') return send(res, 200, store.netdiskList(netdiskQuery(query)));

  const mNd = pathname.match(/^\/api\/netdisk\/(\d+)$/);
  if (mNd) {
    const row = store.netdiskGet(Number(mNd[1]));
    return row ? send(res, 200, row) : send(res, 404, { error: 'not found' });
  }
```

并在 `filtersFrom` 附近加参数解析函数：

```js
function netdiskQuery(q) {
  const sort = ['date', 'value', 'title'].includes(q.sort) ? q.sort : 'date';
  const dateOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return {
    platform: String(q.platform || '').slice(0, 40),
    category: String(q.category || '').slice(0, 40),
    q: String(q.q || '').slice(0, 100),
    from: dateOk(q.from) ? q.from : '',
    to: dateOk(q.to) ? q.to : '',
    sort,
    page: Math.max(1, Number(q.page) || 1),
    size: Math.min(100, Math.max(1, Number(q.size) || 30)),
  };
}
```

- [ ] **Step 4: 运行路由测试确认通过**

Run: `node --test test/netdisk-routes.test.mjs`
Expected: PASS

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 6: 检查点（不提交）**

Run: `node --check app/server/index.mjs && git diff --check`
Expected: 无输出。不要 `git commit`。

---

### Task 6: 前端页面 `NetdiskPanel.tsx`

**Files:**
- Modify: `app/web/src/api.ts`
- Create: `app/web/src/components/NetdiskPanel.tsx`
- Modify: `app/web/src/App.tsx`

**Interfaces:**
- Consumes: Task 5 的 HTTP 路由。
- Produces: 前端类型 `NetdiskRow`、`NetdiskFilters`；函数 `getNetdisk`、`netdiskFacets`、`getNetdiskItem`、`startNetdiskScan`、`getNetdiskScanStatus`、`startNetdiskAi`、`getNetdiskAiStatus`、`stopNetdiskAi`、`netdiskExportUrl`。

- [ ] **Step 1: 加 API 客户端**

在 `app/web/src/api.ts` 末尾追加：

```ts
// ---------- 网盘资源 ----------
export type NetdiskRow = {
  id: number; platform: string; shareUrl: string; shareKey: string; pwd: string;
  title: string; aiTitle: string; aiSummary: string; category: string; tags: string;
  postId: number | null; channel: string; postDate: string; value: number;
  sources: Array<{ post_id: number; channel: string; date: string; url: string; value: number }>;
  mergeCount: number; aiAt: string | null;
};
export type NetdiskFilters = {
  platform?: string; category?: string; q?: string; from?: string; to?: string;
  sort?: string; page?: number; size?: number;
};
export type NetdiskResult = { total: number; page: number; size: number; items: NetdiskRow[] };
export type NetdiskFacets = { platforms: { k: string; n: number }[]; categories: { k: string; n: number }[]; total: number };

export async function getNetdisk(f: NetdiskFilters): Promise<NetdiskResult> {
  const r = await fetch('/api/netdisk?' + qs(f as any));
  if (!r.ok) throw new Error('读取网盘资源失败 HTTP ' + r.status);
  return r.json();
}
export async function getNetdiskFacets(): Promise<NetdiskFacets> {
  return (await fetch('/api/netdisk/facets')).json();
}
export async function getNetdiskItem(id: number): Promise<NetdiskRow> {
  const r = await fetch('/api/netdisk/' + id);
  if (!r.ok) throw new Error('读取详情失败 HTTP ' + r.status);
  return r.json();
}
export async function startNetdiskScan(mode: 'full' | 'incremental'): Promise<any> {
  const r = await fetch('/api/netdisk/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
  return r.json();
}
export async function getNetdiskScanStatus(): Promise<any> {
  return (await fetch('/api/netdisk/scan/status')).json();
}
export async function startNetdiskAi(limit: number): Promise<any> {
  const r = await fetch('/api/netdisk/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit }) });
  return r.json();
}
export async function getNetdiskAiStatus(): Promise<any> {
  return (await fetch('/api/netdisk/ai/status')).json();
}
export async function stopNetdiskAi(): Promise<any> {
  return (await fetch('/api/netdisk/ai/stop', { method: 'POST' })).json();
}
export function netdiskExportUrl(f: NetdiskFilters, format: 'md' | 'csv' | 'json'): string {
  return '/api/netdisk/export?' + qs({ ...(f as any), format });
}
```

- [ ] **Step 2: 创建页面组件**

创建 `app/web/src/components/NetdiskPanel.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  getNetdisk, getNetdiskFacets, getNetdiskItem, startNetdiskScan, getNetdiskScanStatus,
  startNetdiskAi, getNetdiskAiStatus, stopNetdiskAi, netdiskExportUrl,
  type NetdiskRow, type NetdiskFacets,
} from '../api';

const SORTS = [
  { v: 'date', label: '最新' }, { v: 'value', label: '价值分' }, { v: 'title', label: '标题' },
];
const PAGE_SIZE = 30;

export function NetdiskPanel({ onOpenPost }: { onOpenPost: (id: number) => void }) {
  const [fac, setFac] = useState<NetdiskFacets | null>(null);
  const [platform, setPlatform] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('date');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: NetdiskRow[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<NetdiskRow | null>(null);
  const [scan, setScan] = useState<any>({ running: false });
  const [aiSt, setAiSt] = useState<any>({ running: false });
  const [msg, setMsg] = useState<string>('');

  useEffect(() => { getNetdiskFacets().then(setFac).catch(() => {}); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getNetdisk({ platform, category, q, sort, page, size: PAGE_SIZE })
      .then(r => { if (alive) setData({ total: r.total, items: r.items }); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [platform, category, q, sort, page]);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const s = await getNetdiskScanStatus(); setScan(s);
        const a = await getNetdiskAiStatus(); setAiSt(a);
        if (!s.running && !a.running) clearInterval(t);
      } catch (e) {}
    }, 1500);
    return () => clearInterval(t);
  }, [scan.running, aiSt.running]);

  async function doScan(mode: 'full' | 'incremental') {
    setMsg(mode === 'full' ? '正在全量扫描…' : '正在增量扫描…');
    const r = await startNetdiskScan(mode);
    if (!r.ok) { setMsg(r.error || '扫描启动失败'); return; }
    setScan({ running: true });
  }
  async function doAi() {
    setMsg('正在启动 AI 整理…');
    const r = await startNetdiskAi(0);
    if (!r.ok) { setMsg(r.error || 'AI 整理启动失败'); return; }
    setAiSt({ running: true, total: r.total });
  }
  function refresh() { getNetdiskFacets().then(setFac).catch(() => {}); setPage(1); }

  async function openDetail(row: NetdiskRow) {
    try { setSel(await getNetdiskItem(row.id)); } catch (e) { setSel(row); }
  }
  function copy(row: NetdiskRow) {
    const txt = row.pwd ? (row.shareUrl + ' 提取码：' + row.pwd) : row.shareUrl;
    navigator.clipboard.writeText(txt).then(() => setMsg('已复制链接' + (row.pwd ? '与提取码' : '')));
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const platLabel = useMemo(() => {
    const m = new Map<string, string>();
    (fac?.platforms || []).forEach(p => m.set(p.k, p.k));
    return m;
  }, [fac]);

  const card: any = { background: 'var(--bg-2)', border: '1px solid var(--border-soft)', borderRadius: 12, padding: '12px 14px', marginBottom: 10 };

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '14px 18px 60px' }}>
        <div style={{ maxWidth: 1020, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="搜索资源名或标签…" style={{ flex: 1, minWidth: 220, height: 38 }} />
            <select value={platform} onChange={e => { setPlatform(e.target.value); setPage(1); }} style={{ height: 38 }}>
              <option value="">全部平台</option>
              {(fac?.platforms || []).map(p => <option key={p.k} value={p.k}>{p.k + '（' + p.n + '）'}</option>)}
            </select>
            <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} style={{ height: 38 }}>
              <option value="">全部类别</option>
              {(fac?.categories || []).map(c => <option key={c.k} value={c.k}>{c.k + '（' + c.n + '）'}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)} style={{ height: 38 }}>
              {SORTS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <button className="btn" onClick={() => doScan('incremental')} disabled={scan.running}>{scan.running ? '扫描中…' : '扫描更新'}</button>
            <button className="btn ghost" onClick={() => doScan('full')} disabled={scan.running}>全量重扫</button>
            <button className="btn" onClick={doAi} disabled={aiSt.running}>{aiSt.running ? 'AI 整理中…' : 'AI 整理'}</button>
            {aiSt.running && <button className="btn ghost" onClick={() => stopNetdiskAi()}>停止</button>}
            <a className="btn ghost" href={netdiskExportUrl({ platform, category, q, sort }, 'md')} download>导出 Markdown</a>
            <a className="btn ghost" href={netdiskExportUrl({ platform, category, q, sort }, 'csv')} download>导出 CSV</a>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12.5, color: 'var(--fg-dim)' }}>共 {data.total} 条{(scan.found ? ' · 本次抽出 ' + scan.found : '')}{(aiSt.pending != null ? ' · 待整理 ' + aiSt.pending : '')}</span>
          </div>

          {msg && <div style={{ ...card, fontSize: 12.5, color: 'var(--fg-dim)' }}>{msg}</div>}

          {loading && <div style={{ color: 'var(--fg-mute)', padding: 20 }}>加载中…</div>}
          {!loading && data.items.length === 0 && (
            <div className="empty"><div className="empty-title">还没有网盘资源。点「扫描更新」从情报库里抽取。</div></div>
          )}

          {data.items.map(row => (
            <div key={row.id} style={card} onClick={() => openDetail(row)}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="chip on" style={{ flexShrink: 0 }}>{row.platform}</span>
                {row.category && <span className="chip" style={{ flexShrink: 0 }}>{row.category}</span>}
                <div style={{ fontWeight: 620, fontSize: 14, flex: 1, minWidth: 0 }}>{row.aiTitle || row.title || '(无标题)'}</div>
                <span style={{ fontSize: 12, color: 'var(--fg-mute)' }}>{row.value}分</span>
              </div>
              {row.aiSummary && <div style={{ fontSize: 13, color: 'var(--fg-dim)', marginTop: 6 }}>{row.aiSummary}</div>}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--fg-mute)', flexWrap: 'wrap' }}>
                <span>@{row.channel} · {row.postDate}</span>
                {row.mergeCount > 1 && <span>· {row.mergeCount} 个来源</span>}
                {row.pwd && <span>· 提取码 <code>{row.pwd}</code></span>}
                {row.tags && <span>· {row.tags}</span>}
              </div>
            </div>
          ))}

          {pages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 20 }}>
              <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>上一页</button>
              <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--fg-dim)' }}>{page} / {pages}</span>
              <button className="btn" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}>下一页</button>
            </div>
          )}
        </div>
      </div>

      {sel && (
        <aside className="surface" style={{ width: 380, flexShrink: 0, borderLeft: '1px solid var(--border-soft)', overflowY: 'auto', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="chip on">{sel.platform}</span>
            {sel.category && <span className="chip">{sel.category}</span>}
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => setSel(null)}>关闭</button>
          </div>
          <div style={{ fontWeight: 650, fontSize: 16, marginTop: 10 }}>{sel.aiTitle || sel.title || '(无标题)'}</div>
          {sel.aiSummary && <div style={{ fontSize: 13.5, color: 'var(--fg-dim)', marginTop: 8, lineHeight: 1.7 }}>{sel.aiSummary}</div>}
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <div style={{ wordBreak: 'break-all' }}><a className="link" href={sel.shareUrl} target="_blank" rel="noreferrer">{sel.shareUrl}</a></div>
            {sel.pwd && <div style={{ marginTop: 6 }}>提取码：<code>{sel.pwd}</code></div>}
            {sel.tags && <div style={{ marginTop: 6, color: 'var(--fg-dim)' }}>标签：{sel.tags}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => copy(sel)}>复制链接{sel.pwd ? '+提取码' : ''}</button>
            <a className="btn ghost" href={sel.shareUrl} target="_blank" rel="noreferrer">打开分享页</a>
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', marginBottom: 6 }}>全部来源（{sel.sources.length}）</div>
            {sel.sources.map((s, i) => (
              <div key={i} style={{ ...card, padding: '8px 10px', marginBottom: 6, cursor: 'pointer' }} onClick={() => onOpenPost(s.post_id)}>
                <div style={{ fontSize: 13 }}>@{s.channel} · {s.date} · {s.value}分</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', wordBreak: 'break-all' }}>{s.url}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', marginTop: 14 }}>资源名取自原帖文本，链接来自原帖，可能已失效。</div>
        </aside>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 接入 App.tsx**

在 `app/web/src/App.tsx`：

1. import 区加 `import { NetdiskPanel } from './components/NetdiskPanel';` 和导航图标（如 `import { HardDrive } from 'lucide-react';`，与现有 lucide 导入合并）。
2. `view` 的联合类型加上 `'netdisk'`：`useState<'chat' | 'detail' | 'briefing'>` 是 panel；`view` 处 `useState<'feed' | 'favs'>` 改为 `useState<'feed' | 'favs' | 'netdisk'>`。
3. 左侧导航条在「我的收藏」按钮之后加：

```tsx
        <button className={'rail-btn' + (view === 'netdisk' ? ' on' : '')} title="网盘资源" aria-label="网盘资源"
          onClick={() => { setView('netdisk'); }}><HardDrive size={17} strokeWidth={1.75} /></button>
```

4. 命令面板 `commands` 里加一条：

```tsx
    out.push({ id: 'act:netdisk', label: '打开：网盘资源', group: '操作', run: () => setView('netdisk') });
```

5. 主内容区：当 `view === 'netdisk'` 时渲染整块页面，隐藏信息流区域。在 `<div ref={scrollRef} ...>` 那个滚动容器之前插入：

```tsx
        {view === 'netdisk' && (
          <div style={{ flex: 1, minHeight: 0 }}>
            <NetdiskPanel onOpenPost={id => openById(id)} />
          </div>
        )}
```

并把原滚动容器包一层条件：`{view !== 'netdisk' && (<div ref={scrollRef} ...> ... </div>)}`。同时把上方搜索/筛选条在 `view === 'netdisk'` 时隐藏（给 `TopProgress` 下方那段 `surface` 容器加 `view !== 'netdisk' &&`）。

- [ ] **Step 4: 构建**

Run: `npm run build:web`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 5: 浏览器验收**

启动服务 `npm start`（或已有的 8317 端口），在 `http://127.0.0.1:8317/` 逐项走：
1. 点侧栏「网盘资源」→ 页面出现。
2. 点「扫描更新」→ 状态变为扫描中，结束后条目数增加。
3. 点「AI 整理」→ 若未配模型，出现明确错误提示；若已配模型，进度推进。
4. 平台/类别/关键词筛选与排序生效；分页可用。
5. 点条目 → 右侧详情出现，含全部来源；「复制链接+提取码」可用；点来源跳到原帖。
6. 「导出 Markdown」「导出 CSV」下载文件，内容与当前筛选一致。
Expected: 以上全部符合预期，控制台无报错。

- [ ] **Step 6: 检查点（不提交）**

Run: `git diff --check`
Expected: 无输出。不要 `git commit`。

---

### Task 7: 文档与最终验收

**Files:**
- Modify: `docs/07-交接文档.md`
- Modify: `README.md`

- [ ] **Step 1: 更新交接文档**

在 `docs/07-交接文档.md` 中新增一节，记录：网盘资源模块的数据表 `netdisk_resources`、扫描游标 `app_state.netdisk:scannedPostId`、平台识别移植自 panAI、AI 整理为手动触发、一键补齐完成后自动增量扫描、不联网的已知限制。

- [ ] **Step 2: 更新 README**

在 README 的功能列表加一行「网盘资源」：从全库抽取夸克/百度/蓝奏等网盘分享链接，结构化展示平台、提取码、来源频道，并可用 AI 归类与生成简介。

- [ ] **Step 3: 最终全量验证**

Run: `npm test`
Expected: 全部通过（既有 86 项 + 新增用例）

Run: `npm run build:web`
Expected: 构建成功

Run: `node --check core/netdisk.mjs && node --check app/server/netdisk.mjs && node --check app/server/netdisk-ai.mjs && node --check app/server/index.mjs && node --check app/server/sync.mjs && node --check app/server/store.mjs`
Expected: 无输出、退出码 0

Run: `git diff --check`
Expected: 无输出

- [ ] **Step 4: 检查点（不提交）**

未获用户明确授权前不 `git commit`、不 `git push`。向用户报告验证结果并等待指示。

---

## Self-Review

- **Spec coverage**：数据模型 → Task 2；提取管线（平台表/提取码/标题/扫描/增量） → Task 1 + Task 3；AI 整理 → Task 4；API 路由 → Task 5；前端页面 → Task 6；一键补齐后自动增量扫描 → Task 3 Step 5；文档 → Task 7。全部覆盖。
- **Placeholder scan**：无 TBD/TODO；每个代码步骤都给了完整代码。
- **Type consistency**：`netdiskUpsert` 入参字段名（platform/shareKey/shareUrl/pwd/title/postId/channel/postDate/postUrl/value）在 Task 2、Task 3 一致；`NetdiskRow` 字段名在 store `ndRow`、API 客户端、组件中一致；`extractNetdisk` 返回 `{platform,shareKey,shareUrl,pwd}` 与 Task 3 消费一致；`netdiskSaveAi` 入参 `{id,category,tags,summary,aiTitle}` 与 Task 4 的 `parseAnswer` 输出一致。
- **Review Focus 覆盖**：多频道合并 → Task 2 + Task 3 测试；蓝奏/123 多域名归一 → Task 1 测试；提取码边界 → Task 1 测试；空/畸形输入 → Task 1 + Task 3 测试；扫描幂等与增量游标 → Task 3 测试。
