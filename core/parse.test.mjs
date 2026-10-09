import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLink, parseMessages, extractWeb } from '../core/parse.mjs';

test('parseLink: 七种输入形式', () => {
  assert.equal(parseLink('https://t.me/somechan').username, 'somechan');
  assert.equal(parseLink('https://t.me/s/somechan').username, 'somechan');
  assert.equal(parseLink('t.me/somechan').username, 'somechan');
  assert.equal(parseLink('@somechan').username, 'somechan');
  assert.equal(parseLink('https://t.me/somechan/123').msgId, 123);
  assert.equal(parseLink('https://t.me/+AbCdEf').kind, 'invite');
  assert.equal(parseLink('https://t.me/c/12345/67').kind, 'private');
  assert.equal(parseLink('https://example.com/a').kind, 'web');
  assert.equal(parseLink('https://example.com/a').host, 'example.com');
  assert.equal(parseLink('随便一句话'), null);
  assert.equal(parseLink(''), null);
});

const WIDGET = '<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="testchan/123">' +
  '<div class="tgme_widget_message_bubble"><div class="tgme_widget_message_text js-message_text" dir="auto">免费 VPS 领取 <a href="https://example.com/a">链接</a><br/>第二行</div>' +
  '<div class="tgme_widget_message_footer compact js-message_footer"><div class="tgme_widget_message_info short js-message_info">' +
  '<span class="tgme_widget_message_views">1.2K</span><span class="tgme_widget_message_meta">' +
  '<a class="tgme_widget_message_date" href="https://t.me/testchan/123"><time datetime="2026-01-02T03:04:05+00:00" class="time">03:04</time></a>' +
  '</span></div></div></div></div></div>';

test('parseMessages: 提取 id/时间/浏览量/正文/外链', () => {
  const msgs = parseMessages(WIDGET, 'testchan');
  assert.equal(msgs.length, 1);
  const m = msgs[0];
  assert.equal(m.i, 123);
  assert.equal(m.v, 1200);
  assert.equal(m.ts, Math.floor(Date.parse('2026-01-02T03:04:05+00:00') / 1000));
  assert.ok(m.t.includes('免费 VPS 领取'));
  assert.ok(m.t.includes('第二行'));
  assert.deepEqual(m.lk, ['https://example.com/a']);
});

test('parseMessages: 空输入返回空数组', () => {
  assert.deepEqual(parseMessages('', 'x'), []);
  assert.deepEqual(parseMessages(null, 'x'), []);
  assert.deepEqual(parseMessages('<html>无消息</html>', 'x'), []);
});

test('extractWeb: 优先 og:title，回退 title；正文去脚本样式', () => {
  const html = '<html><head><title>回退标题</title>' +
    '<meta property="og:title" content="OG 标题">' +
    '<meta name="description" content="描述文本"></head>' +
    '<body><script>var x=1</script><style>.a{}</style><p>正文内容</p></body></html>';
  const r = extractWeb(html, 'https://e.com');
  assert.equal(r.title, 'OG 标题');
  assert.ok(r.text.includes('描述文本'));
  assert.ok(r.text.includes('正文内容'));
  assert.ok(!r.text.includes('var x=1'));
  assert.ok(!r.text.includes('.a{}'));
});
