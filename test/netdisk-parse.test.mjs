import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, detectPlatform, normalizeShareUrl, parsePwd, cleanTitle, extractNetdisk, titleForLink } from '../core/netdisk.mjs';

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

test('normalizeShareUrl 保留 MEGA 的密钥（在 fragment 里）', () => {
  assert.equal(normalizeShareUrl('https://mega.nz/file/AbCdEfGh#KkLlMmNnOoPp'), 'https://mega.nz/file/AbCdEfGh#KkLlMmNnOoPp');
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

test('cleanTitle：剥掉夹带的 URL', () => {
  assert.equal(cleanTitle('电商详情PSD素材文件大全82GB https://pan.baidu.com/s/1x'), '电商详情PSD素材文件大全82GB');
});

test('cleanTitle：剥掉结尾的「链接：」标签', () => {
  assert.equal(cleanTitle('运维自动化shell脚本编程实战 链接：'), '运维自动化shell脚本编程实战');
  assert.equal(cleanTitle('海昏侯.Marquis.of.Haihun.2019 链接:'), '海昏侯.Marquis.of.Haihun.2019');
});

test('titleForLink：合辑帖取每条资源上方的标题行', () => {
  const t = '#转载杂志\n电商详情PSD素材文件大全82GB\nhttps://pan.baidu.com/s/1lfenSKpX1GhcxZIjKUDnwQ 提取码: dhuj\n【转载】分享了百度OCR接口自建教程，欢迎大家下载学习自建\nhttps://yoyodadada.lanzoui.com/idfQ9va7x2d';
  assert.equal(titleForLink(t, '1lfenSKpX1GhcxZIjKUDnwQ'), '电商详情PSD素材文件大全82GB');
  assert.equal(titleForLink(t, 'idfQ9va7x2d'), '【转载】分享了百度OCR接口自建教程，欢迎大家下载学习自建');
});

test('titleForLink：链接不在正文时退回整帖标题', () => {
  const t = '🙂标题：洛雪音乐绿色版 🙂下载地址：夸克盘 / 蓝奏云';
  assert.equal(titleForLink(t, 'e58c8afd10c6'), '洛雪音乐绿色版');
});

test('titleForLink：跳过「❶链接:」这类纯标签行，取更上方的标题', () => {
  const t = '精选付费短剧10.5-11\n❶链接:\nhttps://pan.quark.cn/s/abc123\n❷链接:\nhttps://pan.baidu.com/s/def456';
  assert.equal(titleForLink(t, 'abc123'), '精选付费短剧10.5-11');
  assert.equal(titleForLink(t, 'def456'), '精选付费短剧10.5-11');
});

test('titleForLink：链接不在正文时取正文首个有效行，不整段拼接', () => {
  const t = '零基础Photoshop CC入门到精通\n某手买的 完整的，适合有会员的\n链接: 百度网盘\n请输入提取码 提取码: xca7';
  assert.equal(titleForLink(t, 'zzz999'), '零基础Photoshop CC入门到精通');
});

test('titleForLink：上下都是标签行时返回空串，交给 AI 整理', () => {
  const t = '百度网盘链接：\nhttps://pan.baidu.com/s/1x2y3z';
  assert.equal(titleForLink(t, '1x2y3z'), '');
});
